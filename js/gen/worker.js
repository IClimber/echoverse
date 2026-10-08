// gen/worker.js — генерація чанків і їхньої геометрії у Web Worker (module), щоб не смикати кадри.
// Запит {id, seed, d, n, cx, cy} → {id, c (дані чанка), m (меш), ms}; масиви передаються без копіювання.
import { lawsOf } from '../universe.js';
import { genChunk } from './chunk.js';
import { chunkMesh } from './mesh.js';

const laws = new Map();
function lawsFor(seed, d, n) {
  const k = `${seed}:${d}:${n}`;
  let L = laws.get(k);
  if (!L) { if (laws.size > 64) laws.clear(); L = lawsOf(seed, d, n); laws.set(k, L); }
  return L;
}

onmessage = (e) => {
  const { id, seed, d, n, cx, cy } = e.data;
  const t0 = performance.now();
  const L = lawsFor(seed, d, n), c = genChunk(L, cx, cy), m = chunkMesh(c, L);
  const bufs = [c.h.buffer, c.t.buffer, c.v.buffer, c.bm.buffer];
  for (const x of [m.solid, m.liquid, m.flora, m.far]) if (x) bufs.push(x.pos.buffer, x.nor.buffer, x.col.buffer, x.mat.buffer, x.idx.buffer);
  postMessage({ id, c, m, ms: performance.now() - t0 }, bufs);
};
