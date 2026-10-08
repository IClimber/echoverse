// gen/client.js — черга запитів до генератора з пріоритетами. У worker — не більше IN_FLIGHT запитів одночасно,
// решта чекає в черзі: так новий важливіший запит (чанк під ногами) не стоїть за сотнею далеких.
// Немає module worker — генерує в головному потоці (по кілька чанків за кадр).
import { lawsOf } from '../universe.js';
import { genChunk } from './chunk.js';
import { chunkMesh } from './mesh.js';

const IN_FLIGHT = 3;

export function createGen(seed, onDone) {
  const queue = new Map();          // key → {d, n, cx, cy, pri}
  const busy = new Map();           // id → [key, запит]
  let worker = null, nextId = 1;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const b = busy.get(e.data.id);
      busy.delete(e.data.id);
      if (b) onDone(b[0], e.data.c, e.data.m, e.data.ms);
      pump();
    };
    worker.onerror = (e) => {
      console.warn('генератор: worker недоступний, генеруємо в головному потоці', e.message);
      worker.terminate(); worker = null;
      for (const [key, q] of busy.values()) queue.set(key, q);   // незавершені — знову в чергу
      busy.clear();
    };
  } catch { worker = null; }

  function pump() {
    if (!worker) return;
    while (busy.size < IN_FLIGHT && queue.size) {
      let best = null;
      for (const [k, q] of queue) if (!best || q.pri < best[1].pri) best = [k, q];
      queue.delete(best[0]);
      const id = nextId++, q = best[1];
      busy.set(id, best);
      worker.postMessage({ id, seed, d: q.d, n: q.n, cx: q.cx, cy: q.cy });
    }
  }
  const inBusy = (key) => { for (const b of busy.values()) if (b[0] === key) return true; return false; };

  return {
    // Запит чанка; повторний — лише оновлює пріоритет (менше — раніше)
    want(key, d, n, cx, cy, pri) {
      const q = queue.get(key);
      if (q) { q.pri = pri; return; }
      if (inBusy(key)) return;
      queue.set(key, { d, n, cx, cy, pri });
    },
    // Прибрати з черги все, чого вже не треба
    keepOnly(keys) { for (const k of queue.keys()) if (!keys.has(k)) queue.delete(k); },
    // Щокадру: у worker — дослати; без worker — згенерувати кілька найважливіших тут
    tick(budgetMs = 6) {
      if (worker) return pump();
      const t0 = performance.now();
      while (queue.size && performance.now() - t0 < budgetMs) {
        let best = null;
        for (const [k, q] of queue) if (!best || q.pri < best[1].pri) best = [k, q];
        queue.delete(best[0]);
        const q = best[1], t1 = performance.now(), L = lawsOf(seed, q.d, q.n), c = genChunk(L, q.cx, q.cy);
        onDone(best[0], c, chunkMesh(c, L), performance.now() - t1);
      }
    },
    get pending() { return queue.size + busy.size; },
    stop() { if (worker) worker.terminate(); worker = null; queue.clear(); busy.clear(); },
  };
}
