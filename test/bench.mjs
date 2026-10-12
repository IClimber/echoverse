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
  const { createCamera, camHead, camCollide, THIRD, HEAD } = await import('../js/camera.js');
  const { underLiquid } = await import('../js/collision.js');
  let secB = 0, nB = 0, secV = 0, nV = 0, stepT = 0, steps = 0, camT = 0, cams = 0;
  for (const n of [0, 37, 1000]) {
    const L = lawsOf(seed, 0, n), ph = physOf(L), C = new Map(), cols = new Map();
    for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++) { C.set(`${cx},${cy}`, genChunk(L, cx, cy)); cols.set(`${cx},${cy}`, genCol(L, cx, cy)); }
    const block = (x, y, k) => { const c = C.get(`${Math.floor(x / 16)},${Math.floor(y / 16)}`); if (!c) return -1; if (k < 0) return B_STONE; if (k >= H) return B_AIR; return c.b[bi(x - Math.floor(x / 16) * 16, y - Math.floor(y / 16) * 16, k)]; };
    const secs = new Map(), sec = (cx, cy, cz) => { const col = cols.get(`${cx},${cy}`); if (!col || cz < 0 || cz >= H / SEC) return undefined; const k = `${cx},${cy},${cz}`; if (!secs.has(k)) secs.set(k, genSection(L, col, cz)); return secs.get(k); };
    const sky = (cx, cy) => { const c = cols.get(`${cx},${cy}`); return c ? c.sky : null; };   // як у грі (world.probe)
    for (const P of [{ liquid: L.liquid, laws: L, obj: () => null, block, sec, sky }, { liquid: L.liquid, laws: L, obj: () => null, block, sky }]) {
      const b0 = stats.builds, t0 = stats.buildMs;
      colliderOf(P).gather(1, 1, 0, 47, 47, H * 0.5, createList(1 << 16));
      if (P.sec) { secB += stats.buildMs - t0; nB += stats.builds - b0; } else { secV += stats.buildMs - t0; nV += stats.builds - b0; }
    }
    const P = { liquid: L.liquid, laws: L, obj: () => null, block, sec, sky };
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
    // камера: обертається навколо гравця
    const cam = createCamera(THIRD), src = colliderOf(P), under = (a, b, c) => underLiquid(P, a, b, c), t2 = performance.now();
    for (let i = 0; i < 2000; i++) {
      cam.yaw = i * 0.01; cam.pitch3 = 0.3 + 0.3 * Math.sin(i * 0.003);
      const head = [p.x, p.y, camHead(src, [p.x, p.y, p.z], HEAD)];
      camCollide(cam, head, head, src, under);
    }
    camT += performance.now() - t2; cams += 2000;
  }
  console.log(`зіткнення: секція з b ${(secB / nB).toFixed(2)} мс (${nB}), віртуальна з block() ${(secV / nV).toFixed(2)} мс (${nV}); крок гравця ${(stepT / steps * 1000).toFixed(1)} мкс; камера ${(camT / cams * 1000).toFixed(1)} мкс`);
}

// Рух п. 3 (стенд ?move — gen/stand.js): крок гравця в позах (присів, лежить, на стіні, на драбині, під водою) і ціль
// (aimRay: з ока вздовж випадкових напрямків справжнім рельєфом)
{
  const { step, settle, PH1 } = await import('../js/player.js');
  const { standBlock, STAND_SPOTS } = await import('../js/gen/stand.js');
  const { aimRay, REACH } = await import('../js/aim.js');
  const { genCol, genSection, bv, solidB, B_STONE, B_AIR, SEC } = await import('../js/gen/chunk.js');
  const P = { liquid: { swim: true, danger: '', density: 1, visc: 1 }, obj: () => null, block: standBlock };
  const W = [[0, 1], [-1, 0]];                      // W — уздовж +x
  const at = (s) => { const [x, y] = STAND_SPOTS[s]; let k = 40; while (k > 0 && !solidB(standBlock(Math.floor(x), Math.floor(y), k - 1)) && standBlock(Math.floor(x), Math.floor(y), k - 1) !== 1) k--; const q = settle(P, x, y, k * 0.5); return { x: q[0], y: q[1], z: q[2], vz: 0, ground: true }; };
  const run = (s, ctl, jumpAt = -1) => {
    let p = at(s);
    for (let i = 0; i < 120; i++) step(p, 0, -1, i === jumpAt, 1 / 120, P, PH1, W, ctl);     // прогрів
    let t = 0, n = 0;
    for (let r = 0; r < 16; r++) {                // по 2 с: драбина й стіна — ще не нагорі
      p = at(s);
      const t0 = performance.now();
      for (let i = 0; i < 240; i++) step(p, 0, -1, i === jumpAt, 1 / 120, P, PH1, W, ctl);
      t += performance.now() - t0; n += 240;
    }
    return { us: (t / n * 1000).toFixed(1), p };
  };
  const out = [];
  for (const [name, s, ctl, j] of [['стоїть', 'A1', {}], ['присів', 'A2', { crouch: true }], ['лежить', 'A3', { crouch: true }], ['стіна', 'B3', {}, 20], ['драбина', 'B5', {}], ['під водою', 'D', { crouch: true, vert: -1 }]]) {
    const r = run(s, ctl, j);
    out.push(`${name} ${r.us} (${r.p.climb ? r.p.climb.kind : r.p.dive ? 'пірнає' : r.p.pose})`);
  }
  // ціль справжнім рельєфом (стовпці 3×3 зерна, як вище)
  const L = lawsOf(seed, 0, 37), cols = new Map(), secs = new Map();
  for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++) cols.set(`${cx},${cy}`, genCol(L, cx, cy));
  const sec = (cx, cy, cz) => { const col = cols.get(`${cx},${cy}`); if (!col) return undefined; const k = `${cx},${cy},${cz}`; if (!secs.has(k)) secs.set(k, genSection(L, col, cz)); return secs.get(k); };
  const block = (x, y, k) => { const cx = Math.floor(x / 16), cy = Math.floor(y / 16), S = sec(cx, cy, Math.floor(k / SEC)); if (!S) return -1; if (!S.b) return S.solid ? B_STONE : B_AIR; return S.b[bv(x - cx * 16, y - cy * 16, k - S.k0, S.nk)]; };
  const PA = { liquid: L.liquid, laws: L, obj: () => null, block, sec };
  let rs = 9, t = 0, n = 0, hit = 0;
  const r = () => { rs = (rs * 1103515245 + 12345) >>> 0; return rs / 4294967296; };
  for (let i = 0; i < 4000; i++) {
    const o = [16 + r() * 16, 16 + r() * 16, 0], a = r() * Math.PI * 2, e = -0.1 - r() * 1.2;
    let k = 300; while (k > -60 && block(Math.floor(o[0]), Math.floor(o[1]), k - 1) === B_AIR) k--;
    o[2] = k * 0.5 + 1.5;
    const d = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
    const t0 = performance.now();
    if (aimRay(PA, null, o, d, REACH)) hit++;
    if (i >= 400) { t += performance.now() - t0; n++; }
  }
  console.log(`рух п. 3: крок гравця, мкс — ${out.join(', ')}; ціль (aimRay) ${(t / n * 1000).toFixed(1)} мкс (влучань ${(hit / 40).toFixed(0)} %)`);
}
