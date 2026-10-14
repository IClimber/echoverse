// gen/queue.js — черга робіт генератора: купа за пріоритетом (менше — раніше) з лінивим видаленням. Робота прив'язана
// до воркера (стовпець і його секції — в одного: кеш стовпця у воркері) або вільна (w = −1: плитки далечі — будь-кому).
// Без DOM: тести в Node.
import { hash4 } from '../laws/rng.js';

export const workerOf = (q, nw) => q.type === 'far' ? -1 : hash4(q.d, q.n, q.cx, q.cy) % nw;

// Купа вузлів {key, q, pri, ver}
function push(h, v) {
  let i = h.length;
  h.push(v);
  while (i > 0) { const p = (i - 1) >> 1; if (h[p].pri <= v.pri) break; h[i] = h[p]; i = p; }
  h[i] = v;
}
function pop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    let i = 0;
    const n = h.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i, mv = last;
      if (l < n && h[l].pri < mv.pri) { m = l; mv = h[l]; }
      if (r < n && h[r].pri < mv.pri) { m = r; mv = h[r]; }
      if (m === i) break;
      h[i] = h[m]; i = m;
    }
    h[i] = last;
  }
  return top;
}

export function createQueue(nw) {
  const heaps = Array.from({ length: nw }, () => []), free = [], live = new Map();   // key → {ver, w}
  let ver = 0;
  const heapOf = (w) => w < 0 ? free : heaps[w];
  const fresh = (v) => { const e = live.get(v.key); return !!e && e.ver === v.ver; };
  // верх купи без застарілих
  const top = (h) => { while (h.length && !fresh(h[0])) pop(h); return h[0]; };
  return {
    // Запит; повторний — новий пріоритет (старий вузол застаріває)
    want(key, q, pri, w) {
      const v = { key, q, pri, ver: ++ver };
      live.set(key, { ver: v.ver, w });
      push(heapOf(w), v);
    },
    drop(key) { live.delete(key); },
    has: (key) => live.has(key),
    keepOnly(keys) { for (const k of live.keys()) if (!keys.has(k)) live.delete(k); },
    // Найважливіша робота для воркера w (його прив'язані чи вільні): [key, q] або null
    take(w) {
      const a = top(heaps[w]), b = top(free);
      if (!a && !b) return null;
      const h = !b || (a && a.pri <= b.pri) ? heaps[w] : free, v = pop(h);
      live.delete(v.key);
      return [v.key, v.q];
    },
    get size() { return live.size; },
    // Усі живі роботи [key, q, pri]; черга порожніє (перенос у нову чергу — gen/client.js, коли впали всі воркери)
    drain() {
      const out = [];
      for (const h of [...heaps, free]) { for (const v of h) if (fresh(v)) out.push([v.key, v.q, v.pri]); h.length = 0; }
      live.clear();
      return out;
    },
    // Прибрати застарілі вузли, якщо купи розрослися (багато оновлень пріоритету)
    compact() {
      for (const h of [...heaps, free]) if (h.length > live.size * 2 + 64) {
        const keep = h.filter(fresh);
        h.length = 0;
        for (const v of keep) push(h, v);
      }
    },
  };
}
