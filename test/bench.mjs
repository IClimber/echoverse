// test/bench.mjs — заміри генерації (не в npm test): мс на стовпець за етапами і стовпців/с в один потік.
// node test/bench.mjs [зерно] [стовпців на бік]
import { performance } from 'node:perf_hooks';
import { hashStr } from '../js/rng.js';
import { lawsOf } from '../js/universe.js';
import { genCol, genSection, tile } from '../js/gen/chunk.js';
import { chunkMesh, floraMesh, objPose } from '../js/gen/mesh.js';
import { colSummary, runJob } from '../js/gen/job.js';

const seed = hashStr(process.argv[2] || 'test'), N = +(process.argv[3] || 6);
const T = { tile: 0, col: 0, sum: 0, sec: 0, mesh: 0, flora: 0, job: 0, colJob: 0, secJob: 0, lod1: 0, lod2: 0, tri0: 0, tri1: 0, tri2: 0, cap1: 0, cap2: 0 };
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
    floraMesh(col, L, 0);
    T.flora += performance.now() - t;
    // повна робота, як у воркері (кеш стовпця свіжий)
    const cache = new Map();
    t = performance.now();
    const C = runJob(L, { type: 'col', d: 0, n, cx, cy }, cache).data;
    T.colJob += performance.now() - t;
    for (let cz = C.czLo; cz <= C.czHi; cz++) { const r = runJob(L, { type: 'sec', d: 0, n, cx, cy, cz }, cache); if (r.mesh) T.tri0 += r.mesh.ns / 3; }
    T.secJob += performance.now() - t;
    runJob(L, { type: 'flora', d: 0, n, cx, cy }, cache);
    T.job += performance.now() - t;
    // грубі секції (рівні деталізації): стовпець — у кеші, як у воркері
    for (const lod of [1, 2]) {
      const c2 = new Map();
      runJob(L, { type: 'col', d: 0, n, cx, cy }, c2);
      t = performance.now();
      for (let cz = C.czLo; cz <= C.czHi; cz++) { const m = runJob(L, { type: 'lod', lod, d: 0, n, cx, cy, cz }, c2).mesh; T['tri' + lod] += m.ns / 3; T['cap' + lod] += m.nc / 3; }
      T['lod' + lod] += performance.now() - t;
    }
    cols++;
  }
}
const f = (v) => (v / cols).toFixed(2);
console.log(`стовпців ${cols}: tile ×324 ${f(T.tile)} · genCol ${f(T.col)} · зведення ${f(T.sum)} · секції ${f(T.sec)} · меш землі ${f(T.mesh)} · рослини ${f(T.flora)} мс`);
console.log(`робота стовпця повністю ${f(T.job)} мс → ${(1000 / (T.job / cols)).toFixed(0)} стовпців/с на потік`);
const c = T.colJob / cols, mix = 0.14 * T.secJob / cols + 0.42 * (c + T.lod1 / cols) + 0.44 * (c + T.lod2 / cols);
console.log(`LOD1 ${f(T.lod1)} мс · LOD2 ${f(T.lod2)} мс на стовпець (повні секції ${f(T.secJob - T.colJob)}); трикутників землі: LOD1 ×${(T.tri1 / T.tri0).toFixed(3)}, LOD2 ×${(T.tri2 / T.tri0).toFixed(3)} (+ обрізи ×${(T.cap1 / T.tri0).toFixed(3)} / ×${(T.cap2 / T.tri0).toFixed(3)})`);
console.log(`дальність 32 (14 / 42 / 44 % стовпців — повні / LOD1 / LOD2): ${(1000 / mix).toFixed(0)} стовпців/с на потік (без LOD — ${(1000 / (T.secJob / cols)).toFixed(0)})`);

// Зіткнення (collision.js): побудова секції — з масиву b (як у грі) і віртуальна з block(); крок гравця справжнім рельєфом
{
  const { colliderOf, stats } = await import('../js/collision.js');
  const { createList } = await import('../js/engine/physics/collide.js');
  const { step, standable, settle } = await import('../js/player.js');
  const { genChunk, bi, H, B_AIR, B_STONE, SEC } = await import('../js/gen/chunk.js');
  const { physOf } = await import('../js/universe.js');
  let secB = 0, nB = 0, secV = 0, nV = 0, stepT = 0, steps = 0;
  for (const n of [0, 37, 1000]) {
    const L = lawsOf(seed, 0, n), ph = physOf(L), C = new Map(), cols = new Map();
    for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++) { C.set(`${cx},${cy}`, genChunk(L, cx, cy)); cols.set(`${cx},${cy}`, genCol(L, cx, cy)); }
    const block = (x, y, k) => { const c = C.get(`${Math.floor(x / 16)},${Math.floor(y / 16)}`); if (!c) return -1; if (k < 0) return B_STONE; if (k >= H) return B_AIR; return c.b[bi(x - Math.floor(x / 16) * 16, y - Math.floor(y / 16) * 16, k)]; };
    const secs = new Map(), sec = (cx, cy, cz) => { const col = cols.get(`${cx},${cy}`); if (!col || cz < 0 || cz >= H / SEC) return undefined; const k = `${cx},${cy},${cz}`; if (!secs.has(k)) secs.set(k, genSection(L, col, cz)); return secs.get(k); };
    for (const P of [{ liquid: L.liquid, laws: L, obj: () => null, block, sec }, { liquid: L.liquid, laws: L, obj: () => null, block }]) {
      const b0 = stats.builds, t0 = stats.buildMs;
      colliderOf(P).gather(1, 1, 0, 47, 47, H * 0.5, createList(1 << 16));
      if (P.sec) { secB += stats.buildMs - t0; nB += stats.builds - b0; } else { secV += stats.buildMs - t0; nV += stats.builds - b0; }
    }
    const P = { liquid: L.liquid, laws: L, obj: () => null, block, sec };
    let p = null;
    for (let d = 0; d < 16 && !p; d++) for (let dy = -d; dy <= d && !p; dy++) for (let dx = -d; dx <= d && !p; dx++) {
      const x = 24 + dx + 0.5, y = 24 + dy + 0.5;
      for (let k = H; k > 0 && !p; k--) if (block(Math.floor(x), Math.floor(y), k - 1) !== B_AIR) { const s = settle(P, x, y, k * 0.5); if (standable(P, ...s)) p = { x: s[0], y: s[1], z: s[2], vz: 0, ground: true }; break; }
    }
    if (!p) continue;
    let rs = 5, ix = 1, iy = 0;
    const r = () => { rs = (rs * 1103515245 + 12345) >>> 0; return rs / 4294967296; };
    for (let i = 0; i < 300; i++) step(p, ix, iy, false, 1 / 120, P, ph);     // прогрів (секції в кеші)
    const t = performance.now();
    for (let i = 0; i < 5000; i++) {
      if (i % 60 === 0) { const a = r() * Math.PI * 2; ix = Math.round(Math.cos(a)); iy = Math.round(Math.sin(a)); }
      step(p, ix, iy, r() < 0.01, 1 / 120, P, ph, undefined, { sprint: i % 300 < 90 });
    }
    stepT += performance.now() - t; steps += 5000;
  }
  console.log(`зіткнення: секція з b ${(secB / nB).toFixed(2)} мс (${nB}), віртуальна з block() ${(secV / nV).toFixed(2)} мс (${nV}); крок гравця ${(stepT / steps * 1000).toFixed(1)} мкс`);
}
