// test/bench.mjs — заміри генерації (не в npm test): мс на стовпець за етапами і стовпців/с в один потік.
// node test/bench.mjs [зерно] [стовпців на бік]
import { performance } from 'node:perf_hooks';
import { hashStr } from '../js/rng.js';
import { lawsOf } from '../js/universe.js';
import { genCol, genSection, tile } from '../js/gen/chunk.js';
import { chunkMesh, floraMesh, objPose } from '../js/gen/mesh.js';
import { colSummary, runJob } from '../js/gen/job.js';

const seed = hashStr(process.argv[2] || 'test'), N = +(process.argv[3] || 6);
const T = { tile: 0, col: 0, sum: 0, sec: 0, mesh: 0, flora: 0, job: 0 };
let cols = 0;
for (const n of [0, 37, 1000]) {
  const L = lawsOf(seed, 0, n);
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
    let t = performance.now();
    for (let y = -1; y <= 16; y++) for (let x = -1; x <= 16; x++) tile(L, cx * 16 + x, cy * 16 + y);
    T.tile += performance.now() - t; t = performance.now();
    const col = genCol(L, cx, cy);
    for (const o of col.obj) objPose(col, L, o);
    T.col += performance.now() - t; t = performance.now();
    const S = colSummary(col, L);
    T.sum += performance.now() - t;
    for (let cz = S.czLo; cz <= S.czHi; cz++) {
      t = performance.now();
      const sec = genSection(L, col, cz);
      T.sec += performance.now() - t;
      if (sec.empty) continue;
      t = performance.now();
      chunkMesh({ cx, cy, h: col.h, bm: col.bm, v: col.v, b: sec.b, k0: sec.k0, nk: sec.nk, obj: col.obj, sp: col.sp }, L, { near: false });
      T.mesh += performance.now() - t;
    }
    t = performance.now();
    floraMesh(col, L, 0).finish();
    T.flora += performance.now() - t;
    // повна робота, як у воркері (кеш стовпця свіжий)
    const cache = new Map();
    t = performance.now();
    const C = runJob(L, { type: 'col', d: 0, n, cx, cy }, cache).data;
    for (let cz = C.czLo; cz <= C.czHi; cz++) runJob(L, { type: 'sec', d: 0, n, cx, cy, cz }, cache);
    runJob(L, { type: 'flora', d: 0, n, cx, cy }, cache);
    T.job += performance.now() - t;
    cols++;
  }
}
const f = (v) => (v / cols).toFixed(2);
console.log(`стовпців ${cols}: tile ×324 ${f(T.tile)} · genCol ${f(T.col)} · зведення ${f(T.sum)} · секції ${f(T.sec)} · меш землі ${f(T.mesh)} · рослини ${f(T.flora)} мс`);
console.log(`робота стовпця повністю ${f(T.job)} мс → ${(1000 / (T.job / cols)).toFixed(0)} стовпців/с на потік`);
