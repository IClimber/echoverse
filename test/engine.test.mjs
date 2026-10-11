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
import { packMesh, unpack, meshHash, meshDigest, regionOf, frameOf, packStats, VB, RS, RW, RH } from '../js/gen/pack.js';
import { createAlloc } from '../js/engine/graphics/arena.js';
import { SPOTS, MESH_GOLD } from '../js/golden.js';
import { LEVEL } from '../js/iso.js';

test('щільна вершина: позиції з точністю 1/256, нормаль, колір, матеріал (pos.w), AO (color.a) — точно', () => {
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
    assert.equal(u.ao[j], m.ao[v]);
  }
  const b = new Uint8Array(P.buf);
  for (let j = 0; j < P.n; j++) assert.ok(!b[j * 16 + 7] && !b[j * 16 + 11]);
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
      const m = chunkMesh({ cx, cy, h: col.h, bm: col.bm, v: col.v, top: col.top, b: sec.b, k0: sec.k0, nk: sec.nk, obj: col.obj, sp: col.sp }, L);
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

// Відсікання задніх граней (матеріали CULLFACE_BACK, js/scene.js): кожен трикутник твердого — проти годинникової ззовні, тобто (b − a) × (c − a)
// дивиться туди ж, куди нормаль (у повітря). Повні секції стовпців SPOTS і грубі (крок 2 і 4, з обрізами)
test('грані твердого — назовні (для відсікання задніх граней)', () => {
  const seed = hashStr('test');
  let n = 0;
  const check = (m, tag) => {
    if (!m) return;
    const P = m.pos, Q = m.nor, I = m.idx;
    for (let t = 0; t < m.count; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const dot = (uy * vz - uz * vy) * Q[a] + (uz * vx - ux * vz) * Q[a + 1] + (ux * vy - uy * vx) * Q[a + 2];
      assert.ok(dot > 0, `${tag}: трикутник ${t / 3} навиворіт`);
      n++;
    }
  };
  SPOTS.forEach(([d, nn, cx, cy], i) => {
    const L = lawsOf(seed, d, nn), col = genCol(L, cx, cy);
    for (const o of col.obj) objPose(col, L, o);
    const S = colSummary(col, L), czs = [];
    for (let cz = S.czLo; cz <= S.czHi; cz++) czs.push(cz);
    for (const cz of S.isl) if (!czs.includes(cz)) czs.push(cz);
    for (const cz of czs) {
      const sec = genSection(L, col, cz);
      if (!sec.empty) check(chunkMesh({ cx, cy, h: col.h, bm: col.bm, v: col.v, b: sec.b, k0: sec.k0, nk: sec.nk, obj: col.obj, sp: col.sp }, L, { near: false, far: false }).solid, `${i}:${cz}`);
      for (const s of [2, 4]) {
        const G = genCoarse(L, col, cz, s);
        if (G.empty) continue;
        const m = chunkMesh({ cx, cy, step: s, b: G.b, h: G.h, bm: G.bm, v: G.v, lt: G.lt, k0: G.k0, nk: G.n, obj: [], sp: [] }, L, { near: false, far: false });
        check(m.solid, `${i}:${cz}:крок ${s}`); check(m.caps, `${i}:${cz}:крок ${s}, обрізи`);
      }
    }
  });
  assert.ok(n > 4000, `${n}`);                   // повних ~5450 трикутників (MESH_GOLD) + грубі
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
import { columnsInCircle, colPri, visibleMissing } from '../js/stream.js';
import { createCamera, viewProj, THIRD } from '../js/camera.js';

test('стрімінг: коло дальності 32 чанки, у піраміді — раніше', () => {
  const n = columnsInCircle([1000.5, -300.25], 512).length, a = Math.PI * (512 / 16) ** 2;
  assert.ok(n >= 0.95 * a && n <= 1.1 * a, `${n} / ${a}`);
  for (const d of [60, 200, 500]) assert.ok(colPri(d, true) < colPri(d, false));
  assert.equal(colPri(30, false), colPri(30, true));
});

test('visibleMissing: стовпці без зведення, секції не в GPU; усе є — 0', () => {
  const cam = createCamera(THIRD), t = [8, 8, 10], cols = new Map(), state = { top: false };
  const g = { d: 0, n: 0, cam: t, view: { m: viewProj(cam, 1280, 720).m, rad: 256 },
    world: { col: (d, n, cx, cy) => cols.get(`${cx},${cy}`), sec: (d, n, cx, cy, cz) => ({ empty: cz === 1 && state.top }) } };
  const yes = { hasSection: () => true }, no = { hasSection: () => false };
  assert.ok(visibleMissing(g, cam, yes) > 30);                    // зведень немає — бракує кожного видимого стовпця
  for (const [cx, cy] of columnsInCircle(t, 600)) cols.set(`${cx},${cy}`, { czLo: 0, czHi: 1, isl: [] });   // з запасом: VIEW_R ≤ 512
  assert.equal(visibleMissing(g, cam, yes), 0);
  const two = visibleMissing(g, cam, no);
  state.top = true;                                               // верхня секція порожня — її не треба
  assert.ok(two > 0 && visibleMissing(g, cam, no) * 2 === two);
});

// ================= Такт =================
import { createTicker } from '../js/engine/core/ticker.js';

test('такт: 240 к/с → 120 Гц, alpha у [0, 1), довгий кадр — не більше 8 кроків', () => {
  const T = createTicker(1 / 120);
  let n = 0;
  for (let i = 0; i < 1000; i++) { n += T.advance(1 / 240); assert.ok(T.alpha >= 0 && T.alpha < 1); }
  assert.ok(Math.abs(n - 500) <= 1, `${n}`);
  assert.equal(createTicker(1 / 120).advance(0.25), 8);
});

// ================= Зіткнення тіл =================
import { makeBody, stepBody, collideBodies, configureBodies } from '../js/engine/physics/bodies.js';
import { GRAVITY as G_, PLAYER_MASS as PM_, PLAYER_AREA as PA_ } from '../js/player.js';
import { solidB as SB_ } from '../js/gen/chunk.js';
import { LEVEL as LV_ } from '../js/iso.js';
configureBodies({ level: LV_, solid: SB_, gravity: G_, refMass: PM_, refArea: PA_ });

const AIR = { block: () => 0 }, FLOOR = { block: (x, y, k) => k < 0 ? 8 : 0 };
const box = (x, y, z, h, o = {}) => { const b = makeBody({ x, y, z, hx: h, hy: h, hz: h, ...o }); b.sleep = false; return b; };
const move = (L, dt) => { for (const b of L) { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; } };

test('тіла: назустріч — не проходять одне крізь одне, імпульс зберігається', () => {
  const A = box(0, 0, 5, 0.5), B = box(3, 0.2, 5, 0.5), L = [A, B];
  A.vx = 4; B.vx = -4;
  const p0 = A.mass * A.vx + B.mass * B.vx;
  for (let i = 0; i < 120; i++) { move(L, 1 / 120); collideBodies(L, AIR, { bounce: 0, friction: 1 }); }
  assert.ok(B.x - A.x >= 1 - 1e-6, `${A.x} ${B.x}`);
  assert.ok(Math.abs(A.mass * A.vx + B.mass * B.vx - p0) <= 1e-6);
});

test('тіла: легке у важке — важке ледь зрушить', () => {
  const A = box(0, 0, 5, 0.25), B = box(1.2, 0, 5, 0.25 * Math.cbrt(100)), L = [A, B];
  A.vx = 5;
  for (let i = 0; i < 60; i++) { move(L, 1 / 120); collideBodies(L, AIR, { bounce: 0, friction: 1 }); }
  assert.ok(B.vx > 0 && B.vx <= 5 / 50, `${B.vx}`);
});

test('тіла: камінь на камені під тяжінням — не провалюється', () => {
  const lo = box(0, 0, 0, 0.5), hi = box(0.1, 0, 1.6, 0.4), L = [lo, hi], env = { g: 1, vT: 50, bounce: 0, friction: 1, wind: [0, 0] };
  for (let i = 0; i < 240; i++) { for (const b of L) stepBody(b, 1 / 120, FLOOR, env); collideBodies(L, FLOOR, env); }
  const top = lo.z + lo.hz;
  assert.ok(hi.z - hi.hz >= top - 0.02, `${hi.z - hi.hz} ${top}`);
  assert.ok(Math.abs(lo.z - lo.hz) < 0.05);
});

// ================= Рівні деталізації =================
import { genCoarse, genBlocks, tile, bv, B_LIQ, B_AIR } from '../js/gen/chunk.js';

// Точки грубої вибірки — ті самі блоки, що в повних секціях (зокрема рамка з сусідніх стовпців і секцій)
function checkCoarse(L, cx, cy) {
  const cols = new Map(), secs = new Map();
  const colAt = (x, y) => { const k = `${x}:${y}`; let c = cols.get(k); if (!c) cols.set(k, (c = genCol(L, x, y))); return c; };
  const fine = (wx, wy, wk) => {
    const X = Math.floor(wx / CS), Y = Math.floor(wy / CS), Z = Math.floor(wk / SEC), k = `${X}:${Y}:${Z}`;
    let V = secs.get(k);
    if (!V) secs.set(k, (V = genBlocks(L, colAt(X, Y), Z * SEC, SEC)));
    return V.b[bv(wx - X * CS, wy - Y * CS, wk - Z * SEC, SEC)];
  };
  const col = colAt(cx, cy), S = colSummary(col, L);
  let n0 = 0;
  for (const s of [2, 4]) for (let cz = S.czLo; cz <= S.czHi; cz++) {
    const G = genCoarse(L, col, cz, s), n = G.n, W = n + 2;
    for (let J = -1; J <= n; J++) for (let I = -1; I <= n; I++) {
      const wx = cx * CS + I * s, wy = cy * CS + J * s, i = (J + 1) * W + I + 1, c = tile(L, wx, wy);
      assert.equal(G.h[i], c.h); assert.equal(G.bm[i], c.bm); assert.equal(G.v[i], c.v);
      for (let Q = -1; Q <= n; Q++) { assert.equal(G.b[i * W + Q + 1], fine(wx, wy, G.k0 + Q * s), `s${s} cz${cz} ${I},${J},${Q}`); n0++; }
      if (I >= 0 && J >= 0 && I < n && J < n) {
        let t = -1;
        for (let k = G.k0 + SEC - 1; k >= G.k0; k--) if (fine(wx, wy, k) === B_LIQ && fine(wx, wy, k + 1) === B_AIR) { t = k; break; }
        assert.equal(G.lt[i], t);
      }
    }
  }
  return n0;
}

test('genCoarse: точки — ті самі блоки, що в повних секціях', () => {
  const seed = hashStr('test');
  for (const i of [0, 2]) { const [d, n, cx, cy] = SPOTS[i]; assert.ok(checkCoarse(lawsOf(seed, d, n), cx, cy) > 0); }
  // стовпець зі скелями в смузі рамки (x = −2)
  let found = -1;
  for (let n = 0; n <= 5000 && found < 0; n++) {
    const L = lawsOf(seed, 0, n);
    for (let y = -2; y <= 16; y++) if (tile(L, -2, y).fb > 0) { found = n; break; }
  }
  assert.ok(found >= 0);
  checkCoarse(lawsOf(seed, 0, found), 0, 0);
});

test('робота lod: op = тверде + далекі рослини + обрізи, у коробці; трикутників менше; обрізи — назовні', () => {
  const L = lawsOf(hashStr('test'), 0, 0), o0 = packStats.overflow, sum = [0, 0, 0];
  let caps = 0;
  for (let cy = -2; cy <= 2; cy++) for (let cx = -2; cx <= 2; cx++) {
    const cache = new Map(), C = runJob(L, { type: 'col', d: 0, n: 0, cx, cy }, cache).data;
    for (let cz = C.czLo; cz <= C.czHi; cz++) {
      const r0 = runJob(L, { type: 'sec', d: 0, n: 0, cx, cy, cz }, cache);
      if (r0.mesh) sum[0] += r0.mesh.ns;
      for (const lod of [1, 2]) {
        const m = runJob(L, { type: 'lod', lod, d: 0, n: 0, cx, cy, cz }, cache).mesh, u = unpack(m.op);
        assert.equal(u.n, m.ns + m.nf + m.nc);
        for (let i = 0; i < u.n * 3; i++) assert.ok(u.pos[i] >= m.bb[i % 3] && u.pos[i] <= m.bb[i % 3 + 3]);
        sum[lod] += m.ns;
        if (m.nc) caps++;
        const [dx, dy] = frameOf(cx, cy, cz);
        for (let j = m.ns + m.nf; j < u.n; j++) {
          const x = u.pos[j * 3] - dx, y = u.pos[j * 3 + 1] - dy, nx = u.nor[j * 3], ny = u.nor[j * 3 + 1];
          const ex = x < 4 ? -1 : x > 12 ? 1 : 0, ey = y < 4 ? -1 : y > 12 ? 1 : 0;
          if (ex && !ey) assert.ok(nx * ex > 0, `обріз x ${x} ${nx}`);
          if (ey && !ex) assert.ok(ny * ey > 0, `обріз y ${y} ${ny}`);
        }
      }
    }
  }
  assert.equal(packStats.overflow, o0);
  assert.ok(caps > 0);
  assert.ok(sum[1] <= 0.4 * sum[0] && sum[2] <= 0.12 * sum[0], `${sum}`);
  console.log(`# LOD1 ×${(sum[1] / sum[0]).toFixed(3)}, LOD2 ×${(sum[2] / sum[0]).toFixed(3)}`);
});

import { lodOf, keepLod, colDist } from '../js/camera.js';
test('рівні: пороги й гістерезис', () => {
  assert.deepEqual([0, 191.9, 192, 383.9, 384].map(lodOf), [0, 0, 1, 1, 2]);
  assert.equal(keepLod(200, 0), true); assert.equal(keepLod(230, 0), false);
  assert.equal(keepLod(370, 2), true); assert.equal(keepLod(340, 2), false);
  assert.equal(colDist(0, 0, [8, 8]), 0); assert.equal(colDist(2, 0, [8, 8]), 24);
});

// ---- AO у вершинах (10.10.2026): кути Surface Nets, відкритість неба (C.top), рослини ----
import { B_ROCK as B_R } from '../js/gen/chunk.js';
import { template as tmpl } from '../js/gen/plants.js';
import { speciesOf as spOf, regionAt as regAt } from '../js/gen/flora.js';
const NWa = CS + 2, NKa = 16;
// синтетична секція: solid(x, y, k) → тверде; top — верх укриття (блоки) чи null
function aoSection(solid, top) {
  const b = new Uint8Array(NWa * NWa * (NKa + 2));
  for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) for (let k = -1; k <= NKa; k++)
    if (solid(x, y, k)) b[((y + 1) * NWa + x + 1) * (NKa + 2) + k + 1] = B_R;
  const T = top === null ? null : new Int16Array(NWa * NWa);
  if (T) for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) T[(y + 1) * NWa + x + 1] = typeof top === 'function' ? top(x, y) : top;
  return { cx: 0, cy: 0, b, h: new Int16Array(NWa * NWa).fill(4), bm: new Uint8Array(NWa * NWa), v: new Uint8Array(NWa * NWa), top: T, k0: 0, nk: NKa, obj: [], sp: [] };
}
const upVerts = (m) => { const r = []; for (let v = 0; v < m.mat.length; v++) if (m.nor[v * 3 + 2] > 100) r.push(v); return r; };
test('AO: рівна відкрита поверхня — 255 і одним прямокутником; кут біля стіни — темніше; під укриттям — темно', () => {
  const L = lawsOf(hashStr('ao'), 0, 0);
  // один прямокутник: ребра на межах секції поділено в кожній цілій точці (64) + центр віяла
  const flat = chunkMesh(aoSection((x, y, k) => k < 4, 4), L).solid, up = upVerts(flat);
  assert.equal(up.length, 65);
  for (const v of up) assert.equal(flat.ao[v], 255);
  const wall = chunkMesh(aoSection((x, y, k) => k < 4 || (x >= 8 && k < 6), (x) => x >= 8 ? 6 : 4), L).solid;
  const foot = [], far = [];
  for (let v = 0; v < wall.mat.length; v++) {
    const x = wall.pos[v * 3], z = wall.pos[v * 3 + 2];
    if (z < 2.3 && Math.abs(x - 8) < 1.1) foot.push(wall.ao[v]);
    if (z < 2.05 && x < 5 && wall.nor[v * 3 + 2] > 100) far.push(wall.ao[v]);
  }
  assert.ok(foot.length && Math.min(...foot) < 255 && Math.min(...foot) >= 140, 'підніжжя стіни темніше');
  assert.ok(far.length && far.every((a) => a === 255), 'далі від стіни — відкрито');
  const deep = chunkMesh(aoSection((x, y, k) => k < 4, 16), L).solid;
  for (const v of upVerts(deep)) assert.equal(deep.ao[v], 0);
  const mid = chunkMesh(aoSection((x, y, k) => k < 4, 9), L).solid;
  for (const v of upVerts(mid)) assert.equal(mid.ao[v], 128);
});
// T-стики: вершина однієї грані посеред ребра іншої дає щілини (шов уздовж межі чанків) — у секціях їх немає
test('тверде без T-стиків: жодна вершина не лежить посеред осевого ребра (сусідні секції разом)', () => {
  const L = lawsOf(hashStr('test'), 0, 1), cache = new Map(), V = new Set(), E = [];
  const key = (p) => p.map((v) => Math.round(v * 8)).join(',');
  for (let cx = -2; cx < 1; cx++) for (let cy = -2; cy < 1; cy++) {
    const C = runJob(L, { type: 'col', d: 0, n: 1, cx, cy }, cache).data;
    for (let cz = C.czLo; cz <= C.czHi; cz++) {
      const r = runJob(L, { type: 'sec', d: 0, n: 1, cx, cy, cz }, cache);
      if (!r.mesh || !r.mesh.ns) continue;
      const u = unpack(r.mesh.op), [rx, ry, rz] = regionOf(cx, cy, cz), O = [rx * RW, ry * RW, rz * RH];
      for (let t = 0; t < r.mesh.ns; t += 3) {
        const v = [0, 1, 2].map((k) => [0, 1, 2].map((a) => u.pos[(t + k) * 3 + a] + O[a]));
        for (const p of v) V.add(key(p));
        for (let k = 0; k < 3; k++) E.push([v[k], v[(k + 1) % 3]]);
      }
    }
  }
  assert.ok(E.length > 1000);
  let tj = 0;
  for (const [a, b] of E) {
    const df = [0, 1, 2].filter((i) => a[i] !== b[i]);
    if (df.length !== 1) continue;
    const ax = df[0], s = ax === 2 ? LEVEL : 1, lo = Math.min(a[ax], b[ax]), hi = Math.max(a[ax], b[ax]);
    if (lo !== Math.round(lo / s) * s) continue;
    for (let t = lo + s; t < hi - 1e-9; t += s) { const p = a.slice(); p[ax] = t; if (V.has(key(p))) tj++; }
  }
  assert.equal(tj, 0);
});
test('AO шаблону рослини: темніше знизу, у 0…255', () => {
  const L = lawsOf(hashStr('ao'), 0, 0), reg = regAt(L, 10, 10);
  let T = null;
  for (let bm = 0; bm < 40 && !T; bm++) { const S = spOf(L, reg, bm); if (S && S.big.length) T = tmpl(S.big[0], 0, 0); }
  assert.ok(T && T.a && T.a.length === T.verts);
  let lo = 255, hi = 0;
  for (const a of T.a) { lo = Math.min(lo, a); hi = Math.max(hi, a); }
  assert.ok(lo < hi);
});

// ---- сутності (engine/world/entities.js) і дорахунок тіл (settle) ----
import { createEntities } from '../js/engine/world/entities.js';
import { settle as settleBody, makeBody as mkB, configureBodies as cfgB } from '../js/engine/physics/bodies.js';
const ent = (id, x, y) => ({ id, x, y, hx: 0.2, hy: 0.2 });
const KE = (cx, cy) => (cx + 0x8000) * 0x10000 + (cy + 0x8000);   // типовий keyOf
test('сутності: власник — чанк за позицією, near, зона 5×5', () => {
  const E = createEntities({ chunk: 16, zone: 2 });
  const k = KE;
  for (let cy = -4; cy <= 4; cy++) for (let cx = -4; cx <= 4; cx++) E.load(k(cx, cy), cx, cy, [ent(cx * 100 + cy + 1000, cx * 16 + 8, cy * 16 + 8)]);
  E.update(0, 0, 0);
  assert.equal(E.awake().length, 25);
  const e = E.get(1000);
  e.x = 20; e.dirty = true; E.moved(e);
  assert.equal(e.ek, k(1, 0));
  assert.ok(E.near(20, 8, 1).includes(e));
  assert.ok(!E.near(8, 8, 1).includes(e));
  E.load(k(0, 0), 0, 0, [ent(1000, 8, 8)]);           // повторний load — без копій
  assert.equal(E.stats().live, 81);
});
test('сутності: сон поза зоною і дорахунок при поверненні', () => {
  const calls = [];
  const E = createEntities({ chunk: 16, zone: 0, catchUp: (e, dt) => calls.push([e.id, dt]) });
  E.load(KE(0, 0), 0, 0, [ent(1, 8, 8)]); E.load(KE(5, 0), 5, 0, [ent(2, 88, 8)]);
  E.update(0, 0, 1000);
  assert.deepEqual(calls, []);                          // з даних — у спокої
  E.update(5, 0, 3000);                                  // 1 заснула о 3000, 2 прокинулась (з даних — без дорахунку)
  E.update(0, 0, 7500);
  assert.deepEqual(calls, [[1, 4500]]);
});
test('сутності: змінена переживає unload / load, незмінена — з даних, видалена — ні', () => {
  const E = createEntities({ chunk: 16, zone: 2 });
  E.load(KE(0, 0), 0, 0, [ent(1, 4, 4), ent(2, 6, 6), ent(3, 8, 8)]);
  const a = E.get(1); a.x = 5; a.dirty = true; a.hp = 7; E.moved(a);
  E.remove(3);
  E.unload(KE(0, 0));
  E.load(KE(0, 0), 0, 0, [ent(1, 4, 4), ent(2, 6, 6), ent(3, 8, 8)]);
  assert.equal(E.get(1), a); assert.equal(E.get(1).x, 5);
  assert.equal(E.get(2).x, 6);
  assert.equal(E.get(3), undefined);
});
test('сутності: змінена переїхала в сусідній чанк — немає ні її, ні копії з даних, поки той не завантажено', () => {
  const E = createEntities({ chunk: 16, zone: 2 });
  const A = (cx) => [ent(cx === 0 ? 1 : 9, cx * 16 + 8, 8)];
  E.load(KE(0, 0), 0, 0, A(0)); E.load(KE(1, 0), 1, 0, A(1));
  const e = E.get(1); e.x = 20; e.dirty = true; E.moved(e);
  assert.equal(e.ek, KE(1, 0));
  E.unload(KE(0, 0)); E.unload(KE(1, 0));
  E.load(KE(0, 0), 0, 0, A(0));
  assert.equal(E.get(1), undefined);
  E.load(KE(1, 0), 1, 0, A(1));
  assert.equal(E.get(1), e); assert.equal(E.get(1).x, 20);
});
test('settle: тіло в повітрі лягає на ґрунт, левітуюче — на висоту ширяння', () => {
  cfgB({ level: 0.5, solid: (v) => v > 0, gravity: 25.6 });
  const P = { block: (x, y, k) => (k < 10 ? 1 : 0) };   // ґрунт до висоти 5
  const b = mkB({ x: 1.5, y: 1.5, z: 9, hx: 0.3, hy: 0.3, hz: 0.25, dens: 1, lift: 0 });
  b.vz = -3; b.sleep = false;
  assert.ok(settleBody(b, P));
  assert.equal(b.z, 5.25); assert.equal(b.vz, 0); assert.ok(b.sleep);
  const f = mkB({ x: 1.5, y: 1.5, z: 12, hx: 0.3, hy: 0.3, hz: 0.25, dens: 1, lift: 1.5, hover: 2 });
  f.x = 3.5;
  assert.ok(settleBody(f, P));
  assert.equal(f.z, 7.25); assert.equal(f.ax, 3.5);
});
