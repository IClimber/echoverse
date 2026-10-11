// Геометрія зіткнень рушія: найближча точка трикутника, рух кулі, промінь, призма й коробка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createList, pushTri, closestOnTri, sweepSphere, overlapSphere, rayCast, prismTris, boxTris } from '../js/engine/physics/collide.js';

// детермінований генератор
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const r3 = (k = 2) => [(rnd() - 0.5) * k, (rnd() - 0.5) * k, (rnd() - 0.5) * k];
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function triList(a, b, c) { const L = createList(); pushTri(L, ...a, ...b, ...c); return L; }
// відстань від точки до трикутника — густою вибіркою
function bruteDist(p, a, b, c, N = 120) {
  let m = Infinity;
  for (let i = 0; i <= N; i++) for (let j = 0; i + j <= N; j++) {
    const u = i / N, v = j / N, w = 1 - u - v;
    const q = [a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v];
    m = Math.min(m, d2(p, q));
  }
  return Math.sqrt(m);
}

test('найближча точка трикутника — як густа вибірка; у вершинах і на ребрах точно', () => {
  const out = [0, 0, 0];
  for (let k = 0; k < 1000; k++) {
    const a = r3(), b = r3(), c = r3(), p = r3(3), L = triList(a, b, c);
    closestOnTri(...p, L.t, 0, out);
    const d = Math.sqrt(d2(p, out)), bd = bruteDist(p, a, b, c, 60);
    assert.ok(d <= bd + 1e-9 && bd - d < 2e-2, `${d} ${bd}`);
  }
  const L = triList([0, 0, 0], [1, 0, 0], [0, 1, 0]);
  assert.deepEqual(closestOnTri(-1, -1, 0, L.t, 0, out), [0, 0, 0]);
  assert.deepEqual(closestOnTri(0.5, -2, 3, L.t, 0, out), [0.5, 0, 0]);
  assert.deepEqual(closestOnTri(0.25, 0.25, 2, L.t, 0, out), [0.25, 0.25, 0]);
});

test('рух кулі — як перебір дрібними кроками: грань, ребро, вершина', () => {
  let faces = 0, edges = 0;
  for (let k = 0; k < 400; k++) {
    const a = r3(), b = r3(), c = r3(), L = triList(a, b, c), R = 0.1 + rnd() * 0.3;
    const p = r3(4), u = rnd(), v = rnd() * (1 - u), off = r3(0.6);
    const aim = [a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v + off[0], a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v + off[1], a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v + off[2]];
    const kk = 1.2 + rnd(), d = [(aim[0] - p[0]) * kk, (aim[1] - p[1]) * kk, (aim[2] - p[2]) * kk];
    const n = [L.t[9], L.t[10], L.t[11]];
    const dist0 = bruteDist(p, a, b, c, 80);
    if (dist0 < R + 0.02) continue;
    // перебір: перший крок, де куля торкнулась (відстань < R); грань — лише з лицевого боку
    let tb = null;
    const N = 2000;
    for (let i = 1; i <= N; i++) {
      const s = i / N, q = [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
      if (bruteDist(q, a, b, c, 40) < R) { tb = s; break; }
    }
    const h = sweepSphere(L, ...p, ...d, R);
    if (tb === null) { assert.ok(!h || h.t > 0.99, `зайвий дотик ${h && h.t}`); continue; }
    // з тильного боку грань пропускається (лише ребра): тоді дотик може бути пізніше чи зовсім ні
    const side = (q) => (q[0] - a[0]) * n[0] + (q[1] - a[1]) * n[1] + (q[2] - a[2]) * n[2];
    if (side(p) < 0 || side([p[0] + d[0] * tb, p[1] + d[1] * tb, p[2] + d[2] * tb]) < 0.01) continue;
    assert.ok(h, `не знайшов дотику (перебір ${tb})`);
    assert.ok(Math.abs(h.t - tb) < 3e-3 + 0.02 / Math.hypot(...d), `t ${h.t} проти ${tb}`);
    const at = [p[0] + d[0] * h.t, p[1] + d[1] * h.t, p[2] + d[2] * h.t];
    assert.ok(Math.abs(Math.hypot(at[0] - h.px, at[1] - h.py, at[2] - h.pz) - R) < 1e-6);
    if (Math.abs(h.nx * n[0] + h.ny * n[1] + h.nz * n[2] - 1) < 1e-9) faces++; else edges++;
  }
  assert.ok(faces > 20 && edges > 20, `граней ${faces}, ребер ${edges}`);
});

test('куля, що торкається площини й рухається вздовж неї, не зупиняється; униз — зупиняється одразу', () => {
  const L = createList();
  pushTri(L, -5, -5, 0, 5, -5, 0, 5, 5, 0, null, 0, 0, 1); pushTri(L, -5, -5, 0, 5, 5, 0, -5, 5, 0, null, 0, 0, 1);
  assert.equal(sweepSphere(L, 0, 0, 0.24, 1, 0.3, 0, 0.24), null);
  const h = sweepSphere(L, 0, 0, 0.24, 0.1, 0, -0.1, 0.24);
  assert.ok(h && h.t === 0 && h.nz === 1);
  assert.equal(sweepSphere(L, 0, 0, 0.5, 0, 0, -0.1, 0.24), null);
  assert.ok(Math.abs(sweepSphere(L, 0, 0, 0.5, 0, 0, -1, 0.24).t - 0.26) < 1e-12);
  // знизу (тильний бік) грань не тримає
  assert.equal(sweepSphere(L, 0, 0, -1, 0, 0, 2, 0.24), null);
  assert.equal(overlapSphere(L, 0, 0, 0.24, 0.24), null);
  assert.ok(Math.abs(overlapSphere(L, 0, 0, 0.1, 0.24).depth - 0.14) < 1e-12);
});

test('промінь на кубі з 12 трикутників; призма й коробка', () => {
  const L = createList();
  boxTris(L, 0, 0, 0, 1, 1, 1);
  assert.equal(L.n, 12);
  const h = rayCast(L, 0.5, 0.5, 5, 0, 0, -1, 10);
  assert.ok(Math.abs(h.t - 4) < 1e-12 && h.nz === 1);
  assert.ok(Math.abs(rayCast(L, -3, 0.3, 0.7, 1, 0, 0, 10).t - 3) < 1e-12);
  assert.equal(rayCast(L, 3, 3, 3, 1, 0, 0, 10), null);
  // нормалі коробки — назовні
  for (let i = 0; i < 12; i++) {
    const o = i * 12, cx = (L.t[o] + L.t[o + 3] + L.t[o + 6]) / 3 - 0.5, cy = (L.t[o + 1] + L.t[o + 4] + L.t[o + 7]) / 3 - 0.5, cz = (L.t[o + 2] + L.t[o + 5] + L.t[o + 8]) / 3 - 0.5;
    assert.ok(cx * L.t[o + 9] + cy * L.t[o + 10] + cz * L.t[o + 11] > 0);
  }
  // куля в коробку збоку
  const s = sweepSphere(L, -2, 0.5, 0.5, 3, 0, 0, 0.25);
  assert.ok(Math.abs(s.t * 3 - 1.75) < 1e-9 && s.nx === -1);
  // призма радіуса 0,4: куля 0,24 збоку зупиняється на 0,64 (± грань 12-кутника) від осі; згори — на верху
  const P = createList();
  prismTris(P, 0, 0, 0, 2, 0.4);
  const ps = sweepSphere(P, -3, 0, 1, 3, 0, 0, 0.24);
  const stop = -3 + ps.t * 3;
  assert.ok(stop < -0.4 * Math.cos(Math.PI / 12) - 0.24 + 1e-9 && stop > -0.64 - 1e-9, `${stop}`);
  const pt = sweepSphere(P, 0.1, 0.1, 5, 0, 0, -5, 0.24);
  assert.ok(Math.abs(5 - pt.t * 5 - 2.24) < 1e-9 && pt.nz === 1);
});

test('зіткнення = рендер: висота під променем — та сама, що в меші chunkMesh цілого стовпця; секція з b = віртуальна', async () => {
  const { lawsOf } = await import('../js/universe.js');
  const { hashStr } = await import('../js/rng.js');
  const { genChunk, genCol, genSection, bi, H, B_AIR, B_STONE, SEC } = await import('../js/gen/chunk.js');
  const { chunkMesh } = await import('../js/gen/mesh.js');
  const { colliderOf } = await import('../js/collision.js');
  const seed = hashStr('test');
  let rays = 0;
  for (const [n, cx, cy] of [[0, 3, 3], [37, -2, 5], [600, 1, -4]]) {
    const L = lawsOf(seed, 0, n), C = genChunk(L, cx, cy);
    const m = chunkMesh(C, L, { near: false, far: false }).solid, ref = createList();
    for (let i = 0; i < m.count; i += 3) {
      const v = (j) => [m.pos[m.idx[i + j] * 3] + cx * 16, m.pos[m.idx[i + j] * 3 + 1] + cy * 16, m.pos[m.idx[i + j] * 3 + 2]];
      pushTri(ref, ...v(0), ...v(1), ...v(2));
    }
    const block = (x, y, k) => {
      const lx = x - cx * 16, ly = y - cy * 16;
      if (k >= H) return B_AIR;
      if (k < -1) return B_STONE;
      if (lx < -1 || ly < -1 || lx > 16 || ly > 16) return -1;
      return C.b[bi(lx, ly, k)];
    };
    const P = { block, obj: () => null, liquid: L.liquid, laws: L };
    // та сама ділянка, але секції — з genSection (швидкий шлях, як у грі)
    const col = genCol(L, cx, cy), secs = new Map();
    const Ps = { ...P, sec: (x, y, z) => { if (x !== cx || y !== cy || z < 0 || z >= H / SEC) return undefined; if (!secs.has(z)) secs.set(z, genSection(L, col, z)); return secs.get(z); } };
    const A = colliderOf(P), B = colliderOf(Ps);
    for (let i = 0; i < 700; i++) {
      const x = cx * 16 + 0.3 + rnd() * 15.4, y = cy * 16 + 0.3 + rnd() * 15.4, top = H * 0.5 + 1;
      const r0 = rayCast(ref, x, y, top, 0, 0, -1, top + 1);
      const la = A.gather(x - 0.01, y - 0.01, -1, x + 0.01, y + 0.01, top, createList()), lb = B.gather(x - 0.01, y - 0.01, -1, x + 0.01, y + 0.01, top, createList());
      const ra = rayCast(la, x, y, top, 0, 0, -1, top + 1), rb = rayCast(lb, x, y, top, 0, 0, -1, top + 1);
      // під дном даних чанка (нижче k = 0) мешу рендеру немає — там не порівнюємо
      if (!r0 || top - r0.t < 0.5) continue;
      assert.ok(ra && rb, `${n} (${x}, ${y}): ${r0.t} ${ra && ra.t} ${rb && rb.t}`);
      rays++;
      assert.ok(Math.abs(r0.t - ra.t) < 1e-5 && Math.abs(ra.t - rb.t) < 1e-5, `${n} (${x}, ${y}): ${r0.t} ${ra.t} ${rb.t}`);
    }
  }
  assert.ok(rays > 1200, `променів ${rays}`);
});

test('нормаль, повернута за підказкою, — і обхід вершин теж: куля зупиняється на R від кожної грані коробки в будь-якій точці', () => {
  const L = createList();
  boxTris(L, 0, 0, 0, 2, 2, 2);
  for (let i = 0; i < 12; i++) {
    const o = i * 12, t = L.t;
    const c = [(t[o + 4] - t[o + 1]) * (t[o + 8] - t[o + 2]) - (t[o + 5] - t[o + 2]) * (t[o + 7] - t[o + 1]), (t[o + 5] - t[o + 2]) * (t[o + 6] - t[o]) - (t[o + 3] - t[o]) * (t[o + 8] - t[o + 2]), (t[o + 3] - t[o]) * (t[o + 7] - t[o + 1]) - (t[o + 4] - t[o + 1]) * (t[o + 6] - t[o])];
    assert.ok(c[0] * t[o + 9] + c[1] * t[o + 10] + c[2] * t[o + 11] > 0, `трикутник ${i}: обхід проти нормалі`);
  }
  // до 11.10.2026 грані −x і +y (повернуті) тримали лише ребрами: далеко від діагоналі куля проходила наскрізь
  for (let k = 0; k < 300; k++) {
    const ax = k % 3, sg = (k >> 1) % 2 ? 1 : -1, a = 0.3 + rnd() * 1.4, b = 0.3 + rnd() * 1.4;
    const p = [0, 0, 0], d = [0, 0, 0];
    p[ax] = sg > 0 ? 3 : -1; d[ax] = -sg; p[(ax + 1) % 3] = a; p[(ax + 2) % 3] = b;
    const h = sweepSphere(L, ...p, ...d, 0.24);
    assert.ok(h && Math.abs(h.t - 0.76) < 1e-9, `вісь ${ax}, бік ${sg}, (${a}, ${b}): ${h && h.t}`);
  }
});

test('підлога на вершині й гребені похилих трикутників — висота дотику, а не вершини «a» трикутника', async () => {
  const { capsule, findFloor } = await import('../js/engine/physics/character.js');
  const sh = capsule(0.24, 0.98), T = createList(), A = [0, 0, 1], B = [[-2, -2, 0], [2, -2, 0], [2, 2, 0], [-2, 2, 0]];
  for (let i = 0; i < 4; i++) pushTri(T, ...B[i], ...B[(i + 1) % 4], ...A, null, 0, 0, 1);
  const src = { gather: (x0, y0, z0, x1, y1, z1, L) => { for (let i = 0; i < T.n; i++) { const o = i * 12; pushTri(L, ...T.t.subarray(o, o + 9), null, T.t[o + 9], T.t[o + 10], T.t[o + 11]); } return L; }, solidAt: () => false };
  // точно над вершиною: куля торкається вершини знизу — ноги на її висоті (до 11.10.2026 — 0: висота вершини основи)
  const f = findFloor(src, sh, 0, 0, 2, 3);
  assert.ok(f && Math.abs(f.z - 1) < 0.01, `вершина: ${f && f.z}`);
  // над гребенем (ребро двох схилів, нормаль дотику вертикальна) — так само
  const g = findFloor(src, sh, 0.5, 0.5, 2, 3);
  assert.ok(g && g.z > 0.7 && g.z <= 1, `гребінь: ${g && g.z}`);
});
