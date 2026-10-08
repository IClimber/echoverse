// gen/worker.js — генерація у Web Worker (module), щоб не смикати кадри: зведення стовпців і секції з мешами (job.js).
// Запит {id, seed, q} → {id, data, mesh, ms}; масиви секцій і мешів передаються без копіювання.
import { lawsOf } from '../universe.js';
import { runJob } from './job.js';

const laws = new Map(), cols = new Map();
function lawsFor(seed, d, n) {
  const k = `${seed}:${d}:${n}`;
  let L = laws.get(k);
  if (!L) { if (laws.size > 64) laws.clear(); L = lawsOf(seed, d, n); laws.set(k, L); }
  return L;
}

onmessage = (e) => {
  const { id, seed, q } = e.data;
  const t0 = performance.now();
  const r = runJob(lawsFor(seed, q.d, q.n), q, cols);
  postMessage({ id, data: r.data, mesh: r.mesh || null, ms: performance.now() - t0 }, r.bufs);
};
