// Рушій: черга генератора, пул воркерів (прив'язка стовпця), далі — щільні меші, алокатор, такт
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, workerOf } from '../js/gen/queue.js';

const drain = (Q, w) => { const r = []; for (let t; (t = Q.take(w));) r.push(t[0]); return r; };

test('черга: пріоритети й повторний запит', () => {
  const Q = createQueue(2);
  Q.want('a', {}, 5, 0); Q.want('b', {}, 1, 0); Q.want('c', {}, 3, 0);
  assert.deepEqual(drain(Q, 0), ['b', 'c', 'a']);
  assert.equal(Q.take(0), null);
  Q.want('a', {}, 5, 0); Q.want('b', {}, 1, 0); Q.want('c', {}, 3, 0); Q.want('b', {}, 10, 0);
  assert.deepEqual(drain(Q, 0), ['c', 'a', 'b']);
  assert.equal(Q.size, 0);
});

test('черга: вільні роботи — будь-кому, прив\'язані — своєму; keepOnly', () => {
  const Q = createQueue(2);
  Q.want('x', {}, 2, -1); Q.want('y', {}, 1, 1);
  assert.deepEqual(Q.take(0)[0], 'x');
  assert.equal(Q.take(0), null);
  assert.deepEqual(Q.take(1)[0], 'y');
  Q.want('p', {}, 1, 0); Q.want('q', {}, 2, 1); Q.want('r', {}, 3, -1);
  Q.keepOnly(new Set(['q']));
  Q.compact();
  assert.equal(Q.size, 1);
  assert.equal(Q.take(0), null);
  assert.deepEqual(drain(Q, 1), ['q']);
});

test('workerOf: стовпець і його секції — в одного, далечінь — вільна, рівномірно', () => {
  const c = { type: 'col', d: 0, n: 3, cx: -4, cy: 7 }, s = { ...c, type: 'sec', cz: 2 };
  assert.equal(workerOf(c, 6), workerOf(s, 6));
  assert.equal(workerOf({ type: 'far', d: 0, n: 0, tx: 1, ty: 1 }, 6), -1);
  const cnt = new Array(6).fill(0);
  for (let cx = -10; cx < 10; cx++) for (let cy = -10; cy < 10; cy++) cnt[workerOf({ type: 'col', d: 0, n: 0, cx, cy }, 6)]++;
  for (const k of cnt) assert.ok(k >= 40 && k <= 100, `${cnt}`);
});

// ================= Щільна вершина, алокатор, еталон мешів =================
import { hashStr, rng } from '../js/rng.js';
import { lawsOf } from '../js/universe.js';
import { genChunk, genCol, genSection, CS, SEC } from '../js/gen/chunk.js';
import { chunkMesh, objPose } from '../js/gen/mesh.js';
import { colSummary } from '../js/gen/job.js';
import { packMesh, unpack, meshHash, meshDigest, regionOf, frameOf, packStats, VB, RS } from '../js/gen/pack.js';
import { createAlloc } from '../js/arena.js';
import { SPOTS, MESH_GOLD } from '../js/golden.js';
import { LEVEL } from '../js/iso.js';

test('щільна вершина: позиції з точністю 1/256, нормаль, колір, матеріал — точно', () => {
  const L = lawsOf(hashStr('меш'), 0, 4);
  let cx = 3;
  while (Math.min(...genChunk(L, cx, 3).h) < 1) cx++;
  const m = chunkMesh(genChunk(L, cx, 3), L).solid, o0 = packStats.overflow, P = packMesh(m, 16, 32, 8), u = unpack(P.buf), D = [16, 32, 8];
  assert.equal(P.n, m.count);
  assert.equal(packStats.overflow, o0);
  for (let j = 0; j < P.n; j++) {
    const v = m.idx[j];
    for (let a = 0; a < 3; a++) {
      const p = u.pos[j * 3 + a];
      assert.ok(Math.abs(p - (m.pos[v * 3 + a] + D[a])) <= 1 / 256);
      assert.ok(p >= P.bb[a] && p <= P.bb[a + 3]);
      assert.equal(u.nor[j * 3 + a], m.nor[v * 3 + a]);
      assert.equal(u.col[j * 3 + a], m.col[v * 3 + a]);
    }
    assert.equal(u.mat[j], m.mat[v]);
  }
});

test('meshHash не залежить від порядку трикутників і повороту вершин', () => {
  const L = lawsOf(hashStr('меш'), 0, 4), P = packMesh(chunkMesh(genChunk(L, 3, 3), L).solid), nt = P.n / 3;
  const src = new Uint8Array(P.buf), dst = new Uint8Array(P.buf.byteLength), r = rng(7);
  const order = [...Array(nt).keys()];
  for (let i = nt - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  order.forEach((t, i) => {
    const s = Math.floor(r() * 3);
    for (let k = 0; k < 3; k++) dst.set(src.subarray((t * 3 + (k + s) % 3) * VB, (t * 3 + (k + s) % 3 + 1) * VB), (i * 3 + k) * VB);
  });
  assert.deepEqual(meshHash(dst.buffer), meshHash(P.buf));
});

test('регіони: regionOf, frameOf', () => {
  assert.deepEqual(regionOf(-1, -1, -1), [-1, -1, -1]);
  assert.deepEqual(regionOf(8, 15, 7), [1, 1, 0]);
  assert.deepEqual(frameOf(9, -1, 9), [16, 112, 8]);
});

test('алокатор: first-fit, злиття, ріст, без перекриттів', () => {
  const A = createAlloc(100);
  assert.deepEqual([A.alloc(30), A.alloc(30), A.alloc(30)], [0, 30, 60]);
  assert.equal(A.alloc(20), -1);
  A.free(30, 30);
  assert.equal(A.alloc(20), 30);
  A.free(0, 30); A.free(30, 20); A.free(60, 30);
  assert.equal(A.used, 0);
  assert.equal(A.alloc(100), 0);
  A.free(0, 100);
  A.grow(200);
  assert.equal(A.alloc(150), 0);
  // випадкові alloc / free проти карти зайнятості
  const B = createAlloc(4096), busy = new Uint8Array(4096), live = [], r = rng(1);
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    if (live.length && r() < 0.45) {
      const [off, n] = live.splice(Math.floor(r() * live.length), 1)[0];
      B.free(off, n); busy.fill(0, off, off + n); sum -= n;
    } else {
      const n = 1 + Math.floor(r() * 64), off = B.alloc(n);
      if (off < 0) continue;
      for (let k = off; k < off + n; k++) { assert.equal(busy[k], 0); busy[k] = 1; }
      live.push([off, n]); sum += n;
    }
    assert.equal(B.used, sum);
  }
});

// Відбитки мешів поточного chunkMesh у кадрі регіону (MESH_GOLD): твердe, рідина, далекі рослини по секціях,
// рослини зблизька — сумою на стовпець. Переробки мешів мусять їх зберегти
export function meshDigests(seedText) {
  const seed = hashStr(seedText), out = {};
  SPOTS.forEach(([d, n, cx, cy], i) => {
    const L = lawsOf(seed, d, n), col = genCol(L, cx, cy);
    for (const o of col.obj) objPose(col, L, o);
    const S = colSummary(col, L), [dx, dy] = frameOf(cx, cy, S.czLo), rz0 = Math.floor(S.czLo / RS);
    let near = 0, nn = 0;
    const czs = [];
    for (let cz = S.czLo; cz <= S.czHi; cz++) czs.push(cz);
    for (const cz of S.isl) if (!czs.includes(cz)) czs.push(cz);
    for (const cz of czs) {
      const sec = genSection(L, col, cz);
      if (sec.empty) continue;
      const m = chunkMesh({ cx, cy, h: col.h, bm: col.bm, v: col.v, b: sec.b, k0: sec.k0, nk: sec.nk, obj: col.obj, sp: col.sp }, L);
      const dz = cz * SEC * LEVEL - rz0 * RS * SEC * LEVEL;
      out[`${i}:${cz}:solid`] = meshDigest(meshHash(packMesh(m.solid, dx, dy, dz).buf));
      if (m.liquid) out[`${i}:${cz}:liq`] = meshDigest(meshHash(packMesh(m.liquid, dx, dy, dz).buf));
      if (m.far) out[`${i}:${cz}:far`] = meshDigest(meshHash(packMesh(m.far, dx, dy, dz).buf));
      if (m.flora) { const h = meshHash(packMesh(m.flora, dx, dy, dz).buf); near = (near + h.sum) >>> 0; nn += h.n; }
    }
    out[`${i}:near`] = meshDigest({ n: nn, sum: near });
  });
  return out;
}

test('еталон мешів MESH_GOLD', () => {
  const o0 = packStats.overflow, got = meshDigests('test');
  if (!MESH_GOLD) { console.log(JSON.stringify(got)); return; }
  assert.deepEqual(got, MESH_GOLD);
  assert.equal(packStats.overflow, o0);
});

// ================= Роботи генератора в щільному форматі =================
import { runJob } from '../js/gen/job.js';

test('робота sec: op = тверде + далекі рослини, усе в коробці', () => {
  const L = lawsOf(hashStr('test'), 0, 0), cache = new Map(), C = runJob(L, { type: 'col', d: 0, n: 0, cx: 0, cy: 0 }, cache).data;
  let seen = 0;
  for (let cz = C.czLo; cz <= C.czHi; cz++) {
    const r = runJob(L, { type: 'sec', d: 0, n: 0, cx: 0, cy: 0, cz }, cache);
    if (!r.mesh) continue;
    const u = unpack(r.mesh.op), b = r.mesh.bb;
    assert.equal(u.n, r.mesh.ns + r.mesh.nf);
    for (let i = 0; i < u.n * 3; i++) assert.ok(u.pos[i] >= b[i % 3] && u.pos[i] <= b[i % 3 + 3]);
    seen++;
  }
  assert.ok(seen > 0);
});

test('робота flora: рослини зблизька стовпця — ті самі, що в MESH_GOLD', () => {
  const seed = hashStr('test');
  SPOTS.forEach(([d, n, cx, cy], i) => {
    const L = lawsOf(seed, d, n), cache = new Map(), C = runJob(L, { type: 'col', d, n, cx, cy }, cache).data;
    const r = runJob(L, { type: 'flora', d, n, cx, cy }, cache);
    if (!r.mesh.n) { assert.equal(MESH_GOLD[`${i}:near`], '0:00000000'); return; }
    // кадр еталона — регіон секції czLo: зсунути на різницю регіонів по висоті
    const dz = (r.data.rz - Math.floor(C.czLo / RS)) * RS * SEC * LEVEL, u = new Uint16Array(r.mesh.fl.slice(0));
    for (let j = 0; j < r.mesh.n; j++) u[j * 8 + 2] += dz * 128;
    assert.equal(meshDigest(meshHash(u.buffer)), MESH_GOLD[`${i}:near`]);
  });
});

// ================= Стрімінг =================
import { columnsInCircle, colPri } from '../js/stream.js';

test('стрімінг: коло дальності 32 чанки, у піраміді — раніше', () => {
  const n = columnsInCircle([1000.5, -300.25], 512).length, a = Math.PI * (512 / 16) ** 2;
  assert.ok(n >= 0.95 * a && n <= 1.1 * a, `${n} / ${a}`);
  for (const d of [60, 200, 500]) assert.ok(colPri(d, true) < colPri(d, false));
  assert.equal(colPri(30, false), colPri(30, true));
});

// ================= Такт =================
import { createTicker } from '../js/ticker.js';

test('такт: 240 к/с → 120 Гц, alpha у [0, 1), довгий кадр — не більше 8 кроків', () => {
  const T = createTicker(1 / 120);
  let n = 0;
  for (let i = 0; i < 1000; i++) { n += T.advance(1 / 240); assert.ok(T.alpha >= 0 && T.alpha < 1); }
  assert.ok(Math.abs(n - 500) <= 1, `${n}`);
  assert.equal(createTicker(1 / 120).advance(0.25), 8);
});
