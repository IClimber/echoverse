// gen/client.js — пул воркерів генератора з чергою пріоритетів (queue.js). Стовпець і його секції — завжди в того самого
// воркера (там кеш стовпця), плитки далечі — будь-якому вільному. У воркера не більше IN_FLIGHT робіт одночасно (8: роботи
// короткі, 1–3 мс — з 2 воркери простоювали, чекаючи головного потоку), решта чекає в черзі: так новий важливіший запит (секція під ногами) не стоїть за сотнею далеких.
// Запит q = {type: 'col' (зведення стовпця) | 'sec' (секція з мешем) | 'far' (плитка далечі), d, n, cx, cy, cz}.
// Немає module worker (чи всі впали) — генерує в головному потоці (по кілька робіт за кадр).
// Робота з винятком (генерація детермінована — повтор дасть те саме) — у консоль раз, далі не запитується; воркер живий.
import { lawsOf } from '../universe.js';
import { runJob } from './job.js';
import { createQueue, workerOf } from './queue.js';

const IN_FLIGHT = 8;
export const POOL = Math.max(1, Math.min(8, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 2));

export function createGen(seed, onDone) {
  const cache = new Map();          // стовпці (без worker)
  const busy = new Map();           // id → {key, q, w}
  const inWork = new Map();         // key → id
  const done = { col: 0, sec: 0, far: 0 };
  const failed = new Set();         // ключі робіт з винятком
  const jobError = (key, q, err) => {
    if (failed.size > 4096) failed.clear();
    failed.add(key);
    console.error(`генератор: робота ${key} (${q.type}) — виняток`, err);
  };
  let nextId = 1, ws = [], queue;

  const finish = (b, data, mesh, ms) => { done[b.q.type] = (done[b.q.type] || 0) + 1; onDone(b.key, b.q, data, mesh, ms); };
  const alive = () => ws.filter((x) => x.ok);

  try {
    if (typeof Worker === 'undefined') throw 0;
    for (let w = 0; w < POOL; w++) {
      const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }), W = { w, worker, ok: true, n: 0 };
      worker.onmessage = (e) => {
        const b = busy.get(e.data.id);
        if (b) {
          busy.delete(e.data.id); inWork.delete(b.key); W.n--;
          if (e.data.err) jobError(b.key, b.q, e.data.err); else finish(b, e.data.data, e.data.mesh, e.data.ms);
        }
        pump();
      };
      worker.onerror = (e) => fail(W, e);
      ws.push(W);
    }
  } catch { ws = []; }
  queue = createQueue(Math.max(1, ws.length));

  // Воркер упав: його роботи — наступному живому; живих немає — головний потік (одна купа)
  function fail(W, e) {
    if (!W.ok) return;
    console.warn(`генератор: воркер ${W.w} недоступний`, e && e.message);
    W.ok = false; W.worker.terminate();
    const live = alive(), back = [];
    for (const [id, b] of busy) if (b.w === W.w) { busy.delete(id); inWork.delete(b.key); back.push(b); }
    if (!live.length) {
      console.warn('генератор: воркерів немає, генеруємо в головному потоці');
      for (const b of busy.values()) back.push(b);
      busy.clear(); inWork.clear(); ws = [];
      const rest = queue.drain();                   // ще не взяті — прив'язані до воркерів, яких уже немає
      queue = createQueue(1);
      for (const [key, q, pri] of rest) queue.want(key, q, pri, 0);
      for (const b of back) queue.want(b.key, b.q, 0, 0);
      return;
    }
    // роботи, прив'язані до мертвого, переадресувати: черга сама не знає про мертвих — беремо їх його номером
    for (const b of back) queue.want(b.key, b.q, 0, b.w);
    pump();
  }

  // Кожному живому воркеру — до IN_FLIGHT робіт: з його черги, вільних і черг мертвих сусідів
  function pump() {
    for (const W of ws) {
      if (!W.ok) continue;
      while (W.n < IN_FLIGHT) {
        let t = queue.take(W.w);
        // роботи мертвих воркерів — бере найближчий наступний живий
        for (let k = 1; !t && k < ws.length; k++) {
          const v = ws[(W.w + k) % ws.length];
          if (v.ok) break;
          t = queue.take(v.w);
        }
        if (!t) break;
        const [key, q] = t, id = nextId++;
        busy.set(id, { key, q, w: W.w }); inWork.set(key, id); W.n++;
        W.worker.postMessage({ id, seed, q });
      }
    }
  }

  return {
    // Запит; повторний — лише оновлює пріоритет (менше — раніше)
    want(key, q, pri) {
      if (inWork.has(key) || failed.has(key)) return;
      queue.want(key, q, pri, ws.length ? workerOf(q, ws.length) : 0);
    },
    // Прибрати з черги все, чого вже не треба
    keepOnly(keys) { queue.keepOnly(keys); queue.compact(); },
    // Щокадру: воркерам — дослати; без них — згенерувати кілька найважливіших тут
    tick(budgetMs = 6) {
      if (ws.length) return pump();
      const t0 = performance.now();
      while (queue.size && performance.now() - t0 < budgetMs) {
        const t = queue.take(0);
        if (!t) break;
        const [key, q] = t, t1 = performance.now();
        let r;
        try { r = runJob(lawsOf(seed, q.d, q.n), q, cache); } catch (err) { jobError(key, q, err); continue; }
        finish({ key, q }, r.data, r.mesh || null, performance.now() - t1);
      }
    },
    get pending() { return queue.size + busy.size; },
    stats: () => ({ workers: alive().length, inflight: busy.size, queued: queue.size, done, failed: failed.size }),
    stop() { for (const W of ws) W.worker.terminate(); ws = []; queue = createQueue(1); busy.clear(); inWork.clear(); },
  };
}
