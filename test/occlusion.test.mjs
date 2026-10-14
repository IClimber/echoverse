// Відсікання закритого: заслони секції (gen/vis.js), програмне відсікання (engine/graphics/occluder.js) і головне —
// видиме не відсікається: справжній світ навколо місця зі скарги (зерно «1qgt24p», всесвіт −16094: шахта з лісом над
// нею) і печер, промені з ока проти трикутників, що малюються (chunkMesh, з кривизною й без), — секція першого
// влучання мусить пройти перевірку box
import test from 'node:test';
import assert from 'node:assert/strict';
import { secOccluders } from '../js/gen/vis.js';
import { createOccluder } from '../js/engine/graphics/occluder.js';
import { createOcclusion } from '../js/render/occlusion.js';
import { lawsOf, LEVEL } from '../js/laws/universe.js';
import { hashStr, rng } from '../js/laws/rng.js';
import { genCol, genSection, shelterTop, bv, CS, CW, FR, SEC, B_AIR, B_STONE, solidB } from '../js/gen/chunk.js';
import { chunkMesh } from '../js/gen/mesh.js';
import { colSummary } from '../js/gen/job.js';
import { aabbInView } from '../js/engine/core/frustum.js';

const NK = SEC + 2 * FR;
// Секція з функції блоку f(x, y, k) у клітинках секції (рамка — теж f)
function secOf(f) {
  const b = new Uint8Array(CW * CW * NK);
  for (let x = -FR; x < CS + FR; x++) for (let y = -FR; y < CS + FR; y++) for (let k = -FR; k < SEC + FR; k++) b[bv(x, y, k, SEC)] = f(x, y, k);
  return b;
}
// прямокутники заслонів секції (o — результат secOccluders) масивами по 6
const quads = (o) => { const r = [], q = o && o.f; for (let i = 0; q && i < q.length; i += 6) r.push([...q.subarray(i, i + 6)]); return r; };

test('заслони секції: рівна земля — плита на 2 блоки нижче поверхні й межі секції; суцільна — межі; тунель — оболонка', () => {
  // тверде k < 8, вище повітря: глибокі блоки — k ≤ 6, грубі клітинки 2 × 2 × 2 — k ≤ 5 (у клітинці 6…7 блок 7 не
  // глибокий): грань +z на площині 6 на всю секцію; на межах секції (сусід — не глибокий) — бічні до площини 6 і низ
  const flat = secOccluders(secOf((x, y, k) => (k < 8 ? B_STONE : B_AIR)), SEC);
  assert.deepEqual(quads(flat), [[0, 0, 0, 0, 16, 6], [1, 16, 0, 0, 16, 6], [2, 0, 0, 0, 16, 6], [3, 16, 0, 0, 16, 6], [4, 0, 0, 0, 16, 16], [5, 6, 0, 0, 16, 16]]);
  // бічні маски: з боків глибокі грубі клітинки шарів 0…2 (рядки v — шари k), знизу — уся сторона, згори — нічого
  const SIDE = [255, 255, 255, 0, 0, 0, 0, 0];
  assert.deepEqual([...flat.s], [...SIDE, ...SIDE, ...SIDE, ...SIDE, ...Array(8).fill(255), ...Array(8).fill(0)]);
  assert.equal(secOccluders(secOf(() => B_AIR), SEC), null);
  const solid = secOccluders(secOf(() => B_STONE), SEC);
  assert.deepEqual(quads(solid), [0, 1, 2, 3, 4, 5].map((d) => [d, d & 1 ? 16 : 0, 0, 0, 16, 16]));
  assert.deepEqual([...solid.s], Array(48).fill(255));
  // тунель уздовж x (y 7…8, k 7…8): глибоке — усе, крім оболонки в клітинку (y 6…9 × k 6…9); грані всередині секції —
  // стінки цієї оболонки (y 6…10 × k 6…10)
  const q = quads(secOccluders(secOf((x, y, k) => (y >= 7 && y <= 8 && k >= 7 && k <= 8 ? B_AIR : B_STONE)), SEC)).filter(([, pl]) => pl !== 0 && pl !== 16);
  assert.equal(q.length, 4);
  for (const [dir, pl, u0, v0, u1, v1] of q) {
    assert.ok(dir >= 2, 'вздовж тунелю граней немає');
    if (dir === 2) assert.deepEqual([pl, u0, v0, u1, v1], [10, 0, 6, 16, 10]);       // −y на y = 10 (стінка з боку +y)
    if (dir === 3) assert.deepEqual([pl, u0, v0, u1, v1], [6, 0, 6, 16, 10]);
    if (dir === 4) assert.deepEqual([pl, u0, v0, u1, v1], [10, 0, 6, 16, 10]);
    if (dir === 5) assert.deepEqual([pl, u0, v0, u1, v1], [6, 0, 6, 16, 10]);
  }
});

test('заслони секції: прямокутники — лише грані грубих глибоких клітинок; усі грані покрито, і на межі секції', () => {
  // глибокий блок — усі 26 сусідів тверді; груба клітинка 2 × 2 × 2 — глибока, якщо глибокі всі її блоки
  for (let t = 0; t < 40; t++) {
    const R = rng(hashStr(`vis:${t}`)), holes = [];
    for (let i = 0; i < 1 + Math.floor(R() * 6); i++) {
      const c = [R() * 20 - 2, R() * 20 - 2, R() * 20 - 2], h = [1 + R() * 5, 1 + R() * 5, 1 + R() * 5];
      holes.push([c[0] - h[0], c[1] - h[1], c[2] - h[2], c[0] + h[0], c[1] + h[1], c[2] + h[2]]);
    }
    const f = (x, y, k) => (holes.some((b) => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && k >= b[2] && k <= b[5]) ? B_AIR : B_STONE);
    const deep = (x, y, k) => { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let l = -1; l <= 1; l++) if (!solidB(f(x + i, y + j, k + l))) return false; return true; };
    const cell = (x, y, k) => { for (let q = 0; q < 8; q++) if (!deep(2 * x + (q & 1), 2 * y + (q >> 1 & 1), 2 * k + (q >> 2))) return false; return true; };
    const at = (ax, L, u, v) => (ax === 0 ? cell(L, u, v) : ax === 1 ? cell(u, L, v) : cell(u, v, L));
    const cov = new Set(), o = secOccluders(secOf(f), SEC);
    // бічні маски — глибокі грубі клітинки біля кожної сторони
    for (let dir = 0; dir < 6; dir++) for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++)
      assert.equal(!!(o && o.s[dir * 8 + v] >> u & 1), at(dir >> 1, dir & 1 ? 7 : 0, u, v), `секція ${t}: маска ${[dir, u, v]}`);
    for (const [dir, pl, u0, v0, u1, v1] of quads(o)) {
      const ax = dir >> 1, s = dir & 1 ? 1 : -1, L = (dir & 1 ? pl / 2 - 1 : pl / 2);   // груба клітинка з глибокого боку
      for (let u = u0 / 2; u < u1 / 2; u++) for (let v = v0 / 2; v < v1 / 2; v++) {
        assert.ok(at(ax, L, u, v), `секція ${t}: прямокутник ${[dir, pl, u0, v0, u1, v1]} поза глибоким`);
        if (L + s >= 0 && L + s <= 7) assert.ok(!at(ax, L + s, u, v), `секція ${t}: грань ${[dir, pl, u, v]} усередині глибокого`);
        cov.add(`${dir}:${pl}:${u}:${v}`);
      }
    }
    // грані глибокої клітинки до не глибокої й до межі секції (там сусід — не глибокий: оболонка без дірок) — під
    // прямокутником того самого напряму
    for (let ax = 0; ax < 3; ax++) for (let L = 0; L < 8; L++) for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) for (const s of [-1, 1]) {
      if (!at(ax, L, u, v) || (L + s >= 0 && L + s <= 7 && at(ax, L + s, u, v))) continue;
      const dir = ax * 2 + (s > 0 ? 1 : 0), pl = (s > 0 ? L + 1 : L) * 2;
      assert.ok(cov.has(`${dir}:${pl}:${u}:${v}`), `секція ${t}: грань ${[dir, pl, u, v]} не покрита`);
    }
  }
});

// Камера: око, ціль (початок матриці), азимут і нахил погляду, кут огляду по вертикалі, співвідношення сторін
function camera(eye, org, yaw, pitch, fov = 70 * Math.PI / 180, aspect = 2) {
  const fw = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
  let r = [fw[1], -fw[0], 0];
  const rl = Math.hypot(r[0], r[1]); r = [r[0] / rl, r[1] / rl, 0];
  const up = [r[1] * fw[2] - r[2] * fw[1], r[2] * fw[0] - r[0] * fw[2], r[0] * fw[1] - r[1] * fw[0]];
  const f = 1 / Math.tan(fov / 2), fx = f / aspect, e = [eye[0] - org[0], eye[1] - org[1], eye[2] - org[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const m = new Float64Array([r[0] * fx, up[0] * f, 0, fw[0], r[1] * fx, up[1] * f, 0, fw[1], r[2] * fx, up[2] * f, 0, fw[2], -dot(r, e) * fx, -dot(up, e) * f, 0, -dot(fw, e)]);
  const dir = (sx, sy) => { const a = sx / fx, b = sy / f, d = [fw[0] + a * r[0] + b * up[0], fw[1] + a * r[1] + b * up[1], fw[2] + a * r[2] + b * up[2]], l = Math.hypot(...d); return [d[0] / l, d[1] / l, d[2] / l]; };
  return { m, dir, fw };
}

test('програмне відсікання: стіна закриває коробку за собою, край і перед нею — видимі; біля ока — видима; кривизна', () => {
  const O = createOccluder({ width: 128 }), eye = [0, 0, 1];
  const { m } = camera(eye, eye, 0, 0);
  // стіна 4 × 4 м за 5 м: промені до коробки за нею (x 10…11) перетинають x = 5 удвічі ближче до осі
  const wall = (o) => o.poly(4, [5, 5, 5, 5], [-2, 2, 2, -2], [-1, -1, 3, 3]);
  O.begin(m, eye, 2); wall(O); O.end();
  assert.equal(O.box(10, -1, 0, 11, 1, 2), false);                // за стіною
  assert.equal(O.box(4, -1, 0, 4.5, 1, 2), true);                  // перед стіною
  assert.equal(O.box(10, 3, 0, 11, 6, 2), true);                    // за краєм стіни (промені на y 1,5…3)
  assert.equal(O.box(10, -1, 4.9, 11, 1, 6), true);                 // над краєм (промені на z 3…3,5)
  assert.equal(O.box(-1, -1, 0, 1, 1, 2), true);                    // навколо ока
  // без заслонів — усе видно
  O.begin(m, eye, 2); O.end();
  assert.equal(O.box(10, -1, 0, 11, 1, 2), true);
  // стіна від землі до 3 м: далека коробка на висоті 0…1 за нею; з кривизною (опущена на 160 м) — під стіною видно
  const low = (o) => o.poly(4, [5, 5, 5, 5], [-20, 20, 20, -20], [0, 0, 3, 3]);
  O.begin(m, eye, 2); low(O); O.end();
  assert.equal(O.box(400, -1, 0, 401, 1, 1), false);
  O.begin(m, eye, 2, [1e-3, eye[0], eye[1]]); low(O); O.end();
  assert.equal(O.box(400, -1, 0, 401, 1, 1), true);
});

// ---- Справжній світ ----
const SEED = hashStr('1qgt24p'), D = 0, N = -16094, L = lawsOf(SEED, D, N);
const CX = -7, CY = -41, RC = 3;                 // стовпці навколо шахти зі скарги (x −96, y −653)
const world = (() => {
  const secs = new Map(), tri = [], own = [], boxes = [];
  for (let cx = CX - RC; cx <= CX + RC; cx++) for (let cy = CY - RC; cy <= CY + RC; cy++) {
    const col = genCol(L, cx, cy), S = colSummary(col, L);
    const czs = new Set();
    for (let cz = S.czLo - 3; cz <= S.czHi; cz++) czs.add(cz);
    for (const cz of S.isl) czs.add(cz);
    for (const cz of czs) {
      const sec = genSection(L, col, cz), key = `${cx},${cy},${cz}`;
      if (sec.empty) { secs.set(key, { empty: true, solid: !!sec.solid }); continue; }
      const m = chunkMesh({ cx, cy, h: col.h, bm: col.bm, v: col.v, top: shelterTop(col, L), sky: col.sky, b: sec.b, k0: sec.k0, nk: sec.nk, obj: [], sp: [] }, L, { near: false, far: false }).solid;
      // без трикутників — не малюється (у грі не заслін і не перевіряється)
      if (!m.count) { secs.set(key, { b: sec.b, k0: sec.k0, nk: sec.nk, occ: null }); continue; }
      const id = boxes.length, bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < m.count; i += 3) {
        for (let v = 0; v < 3; v++) {
          const j = m.idx[i + v], p = [m.pos[j * 3] + cx * CS, m.pos[j * 3 + 1] + cy * CS, m.pos[j * 3 + 2] + sec.k0 * LEVEL];   // висота меша — від низу секції
          tri.push(p[0], p[1], p[2]);
          for (let a = 0; a < 3; a++) { if (p[a] < bb[a]) bb[a] = p[a]; if (p[a] > bb[a + 3]) bb[a + 3] = p[a]; }
        }
        own.push(id);
      }
      boxes.push({ cx, cy, cz, bb });
      const o = secOccluders(sec.b, sec.nk);
      secs.set(key, { b: sec.b, k0: sec.k0, nk: sec.nk, occ: o && o.f, occS: o && o.s, id });
    }
  }
  return { secs, tri: Float64Array.from(tri), own: Int32Array.from(own), boxes };
})();
const W = { sec: (d, n, cx, cy, cz) => world.secs.get(`${cx},${cy},${cz}`) };
const blockAt = (x, y, k) => {
  const cx = Math.floor(x / CS), cy = Math.floor(y / CS), cz = Math.floor(k / SEC), S = world.secs.get(`${cx},${cy},${cz}`);
  if (!S) return -1;
  if (S.empty) return S.solid ? B_STONE : B_AIR;
  return S.b[bv(x - cx * CS, y - cy * CS, k - S.k0, S.nk)];
};

// Трикутники (з кривизною навколо цілі, якщо c > 0) у кошиках 2 м для променів
const BK = 2;
function bucketsOf(c = 0, tx = 0, ty = 0) {
  const T = world.tri, n = T.length / 9, P = new Float64Array(T.length), B = new Map();
  for (let i = 0; i < T.length; i += 3) { P[i] = T[i]; P[i + 1] = T[i + 1]; P[i + 2] = T[i + 2] - c * ((T[i] - tx) ** 2 + (T[i + 1] - ty) ** 2); }
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const x0 = Math.floor(Math.min(P[o], P[o + 3], P[o + 6]) / BK), x1 = Math.floor(Math.max(P[o], P[o + 3], P[o + 6]) / BK);
    const y0 = Math.floor(Math.min(P[o + 1], P[o + 4], P[o + 7]) / BK), y1 = Math.floor(Math.max(P[o + 1], P[o + 4], P[o + 7]) / BK);
    const z0 = Math.floor(Math.min(P[o + 2], P[o + 5], P[o + 8]) / BK), z1 = Math.floor(Math.max(P[o + 2], P[o + 5], P[o + 8]) / BK);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = `${x},${y},${z}`;
      let a = B.get(k);
      if (!a) B.set(k, (a = []));
      a.push(t);
    }
  }
  return { P, B };
}
// Перше влучання променя в лицьову грань (як рендер з відсіканням задніх): номер трикутника або −1
function rayHit(G, o, d, tmax) {
  const { P, B } = G;
  let x = Math.floor(o[0] / BK), y = Math.floor(o[1] / BK), z = Math.floor(o[2] / BK);
  const sx = Math.sign(d[0]), sy = Math.sign(d[1]), sz = Math.sign(d[2]);
  const nx = (v, s, i) => (s > 0 ? ((i + 1) * BK - v) : (i * BK - v));
  let tx = d[0] ? nx(o[0], sx, x) / d[0] : Infinity, ty = d[1] ? nx(o[1], sy, y) / d[1] : Infinity, tz = d[2] ? nx(o[2], sz, z) / d[2] : Infinity;
  const dx = d[0] ? BK / Math.abs(d[0]) : Infinity, dy = d[1] ? BK / Math.abs(d[1]) : Infinity, dz = d[2] ? BK / Math.abs(d[2]) : Infinity;
  let best = Infinity, bi = -1, t = 0;
  while (t <= tmax) {
    const a = B.get(`${x},${y},${z}`);
    if (a) for (const i of a) {
      const q = i * 9;
      const e1x = P[q + 3] - P[q], e1y = P[q + 4] - P[q + 1], e1z = P[q + 5] - P[q + 2], e2x = P[q + 6] - P[q], e2y = P[q + 7] - P[q + 1], e2z = P[q + 8] - P[q + 2];
      const nX = e1y * e2z - e1z * e2y, nY = e1z * e2x - e1x * e2z, nZ = e1x * e2y - e1y * e2x;
      if (nX * d[0] + nY * d[1] + nZ * d[2] >= 0) continue;           // задня грань
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const iv = 1 / det, sX = o[0] - P[q], sY = o[1] - P[q + 1], sZ = o[2] - P[q + 2], u = (sX * px + sY * py + sZ * pz) * iv;
      if (u < 0 || u > 1) continue;
      const qx = sY * e1z - sZ * e1y, qy = sZ * e1x - sX * e1z, qz = sX * e1y - sY * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * iv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * iv;
      if (tt > 1e-6 && tt < best) { best = tt; bi = i; }
    }
    const tn = Math.min(tx, ty, tz);
    if (best <= tn) break;
    t = tn;
    if (tx === tn) { x += sx; tx += dx; } else if (ty === tn) { y += sy; ty += dy; } else { z += sz; tz += dz; }
  }
  return best <= tmax ? bi : -1;
}
// Найменша відстань від точки до трикутників поруч (перевірка, що око у відкритому, як камера: ≥ 0,2)
function clearance(G, p, r) {
  const { P, B } = G;
  let best = Infinity;
  for (let x = Math.floor((p[0] - r) / BK); x <= Math.floor((p[0] + r) / BK); x++) for (let y = Math.floor((p[1] - r) / BK); y <= Math.floor((p[1] + r) / BK); y++) for (let z = Math.floor((p[2] - r) / BK); z <= Math.floor((p[2] + r) / BK); z++) {
    const a = B.get(`${x},${y},${z}`);
    if (a) for (const i of a) {
      // відстань до трикутника — грубо: до найближчої з 7 точок (вершини, середини ребер, центр) — нижня межа не потрібна,
      // бо поріг з запасом; точніше — проєкція на площину, якщо всередині
      const q = i * 9;
      const ax = P[q], ay = P[q + 1], az = P[q + 2], bx = P[q + 3], by = P[q + 4], bz = P[q + 5], cx = P[q + 6], cy = P[q + 7], cz = P[q + 8];
      for (let s = 0; s <= 4; s++) for (let u = 0; u <= 4 - s; u++) {
        const w0 = s / 4, w1 = u / 4, w2 = 1 - w0 - w1;
        const d = Math.hypot(ax * w0 + bx * w1 + cx * w2 - p[0], ay * w0 + by * w1 + cy * w2 - p[1], az * w0 + bz * w1 + cz * w2 - p[2]);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// Перевірка: око — у повітрі; погляди; промені сіткою — секція першого влучання не відсічена. Повертає частку
// відсічених секцій (з тих, що в піраміді видимості)
function check(G, eyes, views, c, third) {
  const occ = createOcclusion(W), fails = [];
  let inView = 0, culled = 0, frames = 0, ms = 0;
  for (const eye of eyes) for (const v of views) {
    const R = rng(hashStr(`${eye}:${v}`)), yaw = R() * Math.PI * 2, pitch = (R() - 0.5) * 1.6;
    const fw0 = [Math.cos(yaw), Math.sin(yaw)];
    // третя особа: ціль — на 2,5 м уперед від ока (кривизна — навколо цілі); перша — ціль у оці
    const org = third ? [eye[0] + fw0[0] * 2.5, eye[1] + fw0[1] * 2.5, eye[2]] : eye;
    const cam = camera(eye, org, yaw, pitch);
    const t0 = performance.now();
    occ.begin(eye, D, N, cam.m, org, c, 2);
    for (const B of world.boxes) occ.add(B.cx, B.cy, B.cz);
    occ.end();
    for (const B of world.boxes) {
      const bb = B.bb;
      if (!aabbInView(cam.m, bb[0] - org[0], bb[1] - org[1], bb[2] - org[2], bb[3] - org[0], bb[4] - org[1], bb[5] - org[2])) continue;
      inView++;
      if (!occ.box(bb[0], bb[1], bb[2], bb[3], bb[4], bb[5])) culled++;
    }
    ms += performance.now() - t0; frames++;
    for (let j = 0; j < 32; j++) for (let i = 0; i < 64; i++) {
      const sx = -1 + (i + R()) / 32, sy = -1 + (j + R()) / 16, d = cam.dir(sx, sy), h = rayHit(G, eye, d, 400);
      if (h < 0) continue;
      const B = world.boxes[world.own[h]], bb = B.bb;
      if (!occ.box(bb[0], bb[1], bb[2], bb[3], bb[4], bb[5])) fails.push({ eye, yaw, pitch, sx, sy, sec: [B.cx, B.cy, B.cz] });
    }
  }
  return { fails, culledShare: culled / inView, ms: ms / frames };
}

// Очі: середини клітинок повітря (печери, шахта, над землею) у середніх стовпцях, далі 0,2 від поверхні
function eyesOf(G, count, seed) {
  const R = rng(hashStr(seed)), out = [];
  for (let tries = 0; out.length < count && tries < 200000; tries++) {
    const x = (CX - 1) * CS + Math.floor(R() * 3 * CS), y = (CY - 1) * CS + Math.floor(R() * 3 * CS), k = Math.floor(-40 + R() * 160);
    const b = blockAt(x, y, k);
    if (b !== B_AIR) continue;
    // половина — у печерах (над оком тверде в межах 12 м)
    let roof = false;
    for (let kk = k + 1; kk < k + 24; kk++) if (solidB(blockAt(x, y, kk))) { roof = true; break; }
    if ((out.length % 2 === 0) !== roof) continue;
    const p = [x + 0.5, y + 0.5, (k + 0.5) * LEVEL];
    if (clearance(G, p, 1) < 0.2) continue;
    out.push(p);
  }
  return out;
}

test('відсікання закритого: видиме не відсікається (шахта, печери, поверхня)', (t) => {
  const G = bucketsOf(), eyes = eyesOf(G, 16, 'occ-eyes');
  assert.ok(eyes.length >= 12, `очей ${eyes.length}`);
  // місце зі скарги: дно шахти, погляд на стіну (перша особа, око 0,92 над ногами)
  eyes.push([-96.24, -653.34, 8.07 + 0.92]);
  const r = check(G, eyes, [0, 1, 2, 3, 4, 5], 0, false);
  assert.deepEqual(r.fails.slice(0, 3), [], `відсічено видиме: ${r.fails.length}`);
  assert.ok(r.culledShare > 0.2, `відсічено лише ${(r.culledShare * 100).toFixed(0)} %`);
  t.diagnostic(`відсічено ${(r.culledShare * 100).toFixed(0)} % секцій у піраміді видимості, заслони й перевірки ${r.ms.toFixed(2)} мс/кадр`);
});

test('відсікання закритого: коробка до кінця заслонів (у всесвіту ще немає регіонів, а плитки далечі є) — без винятку', () => {
  const occ = createOcclusion(W), eye = [-96.24, -653.34, 9], cam = camera(eye, eye, 0.3, 0);
  for (let f = 0; f < 2; f++) {                                           // і після кадру з іншим розміром буфера
    occ.begin(eye, D, N, cam.m, eye, 0, f ? 1.5 : 2);
    assert.equal(typeof occ.box(eye[0] + 50, eye[1], eye[2] - 5, eye[0] + 60, eye[1] + 10, eye[2] + 5), 'boolean');
    occ.finish();
  }
});

test('відсікання закритого з кривизною (мала планета, c = 1e-3): третя особа — видиме не відсікається', () => {
  const eyes = eyesOf(bucketsOf(), 8, 'occ-bend');
  for (const e of eyes.slice(0, 4)) {
    // кривизна навколо цілі (2,5 м уперед від ока — та сама, що в check для кожного погляду)
    for (let v = 0; v < 3; v++) {
      const R = rng(hashStr(`${e}:${v}`)), yaw = R() * Math.PI * 2, t = [e[0] + Math.cos(yaw) * 2.5, e[1] + Math.sin(yaw) * 2.5];
      const G = bucketsOf(1e-3, t[0], t[1]);
      const r = check(G, [e], [v], 1e-3, true);
      assert.deepEqual(r.fails.slice(0, 3), [], `відсічено видиме: ${r.fails.length}`);
    }
  }
});
