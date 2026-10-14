// Світло неба як у Minecraft (engine/world/skylight.js; 13.10.2026): заливка від неба, товщина укриття не важить,
// спад −1 рівень на метр, глобальне поле між секціями не залежить від порядку приходу, вершини на межах секцій однакові
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKYLIGHT, SKY_MAX, skyBright, floraMesh } from '../js/gen/mesh.js';
import { createLightField } from '../js/engine/world/skylight.js';
import { CS, FR, SEC, B_ROCK, O_FLOAT, solidB } from '../js/gen/chunk.js';
import { createWorld } from '../js/world.js';
import { hashStr } from '../js/laws/rng.js';
import { unpack, regionOf, RW, RH } from '../js/gen/pack.js';

const NW = CS + 2 * FR, wi = (x, y, k) => ((y + FR) * NW + x + FR) * NW + k + FR;
// вікно секції: solid(x, y, k) → тверде; top(x, y) — верх укриття клітинки (блоки)
function win(solid, top) {
  const b = new Uint8Array(NW * NW * NW), T = new Int16Array(NW * NW);
  for (let y = -FR; y < CS + FR; y++) for (let x = -FR; x < CS + FR; x++) {
    T[(y + FR) * NW + x + FR] = top(x, y);
    for (let k = -FR; k < SEC + FR; k++) if (solid(x, y, k)) b[wi(x, y, k)] = B_ROCK;
  }
  return SKYLIGHT.windowLight(b, T, 0).lw;
}

test('крива яскравості — Minecraft «Похмуро»: 1 м — 78 %, 3 м — 50 %, 5 м — 33 %, 8 м — 18 %, 12 м — 6 %', () => {
  const at = (m) => skyBright(SKY_MAX - 2 * m);
  assert.equal(skyBright(SKY_MAX), 1);
  assert.equal(skyBright(0), 0);
  for (const [m, p] of [[1, 0.78], [3, 0.5], [5, 0.33], [8, 0.18], [12, 0.06]]) assert.ok(Math.abs(at(m) - p) < 0.01, `${m} м: ${at(m)}`);
});

test('вікно: відкрите поле — усе небо; спад під навісом 1 м → 28, 3 м → 24; вертикаль −1 на блок; закрита порожнина — 0; арка 2 м — 28', () => {
  assert.equal(win((x, y, k) => k < 4, () => 4), null);
  // навіс над x ≥ 8 (дах k 8…9), відкрито при x < 8
  const eave = win((x, y, k) => k < 4 || (x >= 8 && k >= 8 && k < 10), (x) => x >= 8 ? 10 : 4);
  assert.equal(eave[wi(7, 5, 5)], 30);
  assert.equal(eave[wi(8, 5, 5)], 28);
  assert.equal(eave[wi(10, 5, 5)], 24);
  // шахта під дахом: клітинка (8, 8) — повітря k 4…15 під дахом, вихід на небо лише вгорі (сусід (9, 8) відкритий з k 14)
  const shaft = win((x, y, k) => k < 4 || (x === 8 && y === 8 ? k >= 16 : x === 9 && y === 8 ? k < 14 : true), (x, y) => x === 8 && y === 8 ? 18 : x === 9 && y === 8 ? 14 : 18);
  for (let k = 4; k <= 15; k++) assert.equal(shaft[wi(8, 8, k)], k >= 14 ? 28 : 28 - (14 - k), `k ${k}`);
  // замкнена порожнина за стіною в 1 блок поруч з відкритим небом
  const pocket = win((x, y, k) => k < 4 || (x >= 6 && x <= 10 && y >= 6 && y <= 10 && k <= 9 && !(x >= 7 && x <= 9 && y >= 7 && y <= 9 && k >= 5 && k <= 8)), (x, y) => x >= 6 && x <= 10 && y >= 6 && y <= 10 ? 10 : 4);
  assert.equal(pocket[wi(8, 8, 6)], 0);
  // арка 2 м завширшки (дах над x 8…9), відкрито з обох боків
  const arch = win((x, y, k) => k < 4 || (x >= 8 && x <= 9 && k >= 8 && k < 10), (x) => x >= 8 && x <= 9 ? 10 : 4);
  assert.equal(arch[wi(8, 5, 5)], 28); assert.equal(arch[wi(9, 5, 5)], 28);
});

// Глобальне поле на синтетичних секціях: рядок стовпців cx 0…4, секції cz 0…7; земля k < 4, дах над x ∈ [24, 56)
// товщиною T блоків від k 8 — під дахом світло однакове для T = 1 і T = 100
function field(T) {
  const secs = new Map(), cols = new Map(), roofed = (x) => x >= 24 && x < 56;
  const solid = (x, y, k) => k < 4 || (roofed(x) && k >= 8 && k < 8 + T);
  const top = (x) => roofed(x) ? 8 + T : 4;
  const F = createLightField(SKYLIGHT, { sec: (cx, cy, cz) => secs.get(`${cx},${cy},${cz}`) || null, col: (cx, cy) => cols.get(`${cx},${cy}`) || null });
  for (let cx = 0; cx < 5; cx++) {
    const C = { top: new Int16Array(NW * NW), isl: [] };
    for (let y = -FR; y < CS + FR; y++) for (let x = -FR; x < CS + FR; x++) C.top[(y + FR) * NW + x + FR] = top(cx * CS + x);
    cols.set(`${cx},0`, C);
  }
  const order = [];
  for (let cx = 0; cx < 5; cx++) for (let cz = 0; cz < 8; cz++) order.push([cx, cz]);
  order.sort((a, b) => ((a[0] * 7 + a[1] * 13) % 11) - ((b[0] * 7 + b[1] * 13) % 11));
  for (const [cx, cz] of order) {
    const b = new Uint8Array(NW * NW * NW), Tp = new Int16Array(NW * NW);
    for (let y = -FR; y < CS + FR; y++) for (let x = -FR; x < CS + FR; x++) {
      Tp[(y + FR) * NW + x + FR] = top(cx * CS + x);
      for (let k = -FR; k < SEC + FR; k++) if (solid(cx * CS + x, y, cz * SEC + k)) b[wi(x, y, k)] = B_ROCK;
    }
    const w = SKYLIGHT.windowLight(b, Tp, cz * SEC), R = { cx, cy: 0, cz, b, lw: w.lw, lu: w.under };
    secs.set(`${cx},0,${cz}`, R);
    F.addSection(R);
  }
  for (let i = 0; i < 100 && !F.idle; i++) F.step(1000);
  return F;
}
test('глобальне: дах в 1 блок і в 100 блоків забирають однаково; спад від краю — 1 м → 28, 3 м → 24, 15 м і далі — 0', () => {
  const A = field(1), B = field(100);
  for (let x = 20; x < 60; x++) for (const k of [4, 5, 6, 7]) assert.equal(A.get(x, 3, k), B.get(x, 3, k), `x ${x}, k ${k}`);
  assert.equal(A.get(24, 3, 5), 28); assert.equal(A.get(26, 3, 5), 24);
  assert.equal(A.get(40, 3, 5), 0);            // 16 м від обох країв
  assert.equal(A.get(54, 3, 5), 26);           // 2 м від правого краю (x = 56 відкрито)
});

// Справжній світ: місце зі скарги (зерно «1qgt24p», всесвіт −4047, навіс біля 586, 397). Секції приходять у випадковому
// порядку, частину — двічі (як після витіснення); головний потік — lightTick, перебудови — роботи relit
function realWorld(rnd) {
  const seed = hashStr('1qgt24p'), d = 0, n = -4047, CX = 36, CY = 24, meshes = new Map();
  const W = createWorld(seed, (kind, dd, nn, k, q, data, m) => { if (kind === 'sec') meshes.set(k, { q, m }); });
  W.setCurrent(d, n);
  const hooks = { hasSection: () => true, hasFlora: () => false, target: [586, 397, 0] };
  const drain = () => { for (let i = 0; i < 100000 && W.gen.pending; i++) W.gen.tick(50); };
  const settle = () => { for (let i = 0; i < 1000; i++) { W.lightTick(50, hooks); drain(); if (!W.lightStats(d, n).queued && !W.lightStats(d, n).dirty && !W.lightStats(d, n).relit) break; } };
  for (let cx = CX - 2; cx <= CX + 2; cx++) for (let cy = CY - 2; cy <= CY + 2; cy++) W.wantCol(d, n, cx, cy, 0);
  drain();
  const all = [];
  for (let cx = CX - 2; cx <= CX + 2; cx++) for (let cy = CY - 2; cy <= CY + 2; cy++) {
    const C = W.col(d, n, cx, cy);
    for (let cz = C.czLo; cz <= C.czHi; cz++) { all.push([cx, cy, cz]); W.wantSec(d, n, cx, cy, cz, rnd() * 1000); }
  }
  drain(); settle();
  for (const [cx, cy, cz] of all) if (rnd() < 0.2) W.wantSec(d, n, cx, cy, cz, rnd() * 1000);   // знову — новий запис секції
  drain(); settle();
  return { W, d, n, CX, CY, all, meshes };
}
const lcg = (s) => () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
const WA = realWorld(lcg(1)), WB = realWorld(lcg(77));

test('глобальне: те саме світло за будь-якого порядку приходу секцій і з повторним приходом; центр — як заливка всієї ділянки', () => {
  const { W, d, n, CX, CY, all } = WA;
  // однаково в обох порядках
  for (const [cx, cy, cz] of all) for (let i = 0; i < 4096; i += 7) {
    const x = cx * CS + (i >> 4 & 15), y = cy * CS + (i >> 8), k = cz * SEC + (i & 15);
    assert.equal(W.lightAt(d, n, x, y, k), WB.W.lightAt(d, n, x, y, k));
  }
  // пряма заливка всієї ділянки (незавантажене — опакове, небо — вище верху укриття)
  const x0 = (CX - 2) * CS, y0 = (CY - 2) * CS, N = 5 * CS;
  let kLo = Infinity, kHi = -Infinity;
  for (const [, , cz] of all) { kLo = Math.min(kLo, cz * SEC); kHi = Math.max(kHi, cz * SEC + SEC); }
  const NK = kHi - kLo, V = N * N * NK, val = new Int8Array(V).fill(-1), op = new Uint8Array(V);
  const ix = (x, y, k) => ((y - y0) * N + x - x0) * NK + k - kLo;
  for (let y = y0; y < y0 + N; y++) for (let x = x0; x < x0 + N; x++) {
    const C = W.col(d, n, Math.floor(x / CS), Math.floor(y / CS)), top = C.top[(y - Math.floor(y / CS) * CS + FR) * NW + x - Math.floor(x / CS) * CS + FR];
    for (let k = kLo; k < kHi; k++) {
      const S = W.sec(d, n, Math.floor(x / CS), Math.floor(y / CS), Math.floor(k / SEC));
      let solid;
      if (S) solid = S.empty ? !!S.solid : solidB(S.b[wi(x - Math.floor(x / CS) * CS, y - Math.floor(y / CS) * CS, k - Math.floor(k / SEC) * SEC)]);
      else solid = !(k >= top && !C.isl.includes(Math.floor(k / SEC)));
      op[ix(x, y, k)] = solid ? 1 : 0;
      val[ix(x, y, k)] = solid ? 0 : k >= top ? 30 : 0;
    }
  }
  const Q = Array.from({ length: 31 }, () => []);
  for (let i = 0; i < V; i++) if (val[i] === 30) Q[30].push(i);
  for (let L = 30; L > 0; L--) for (const i of Q[L]) {
    if (val[i] !== L) continue;
    const k = i % NK, x = (i / NK | 0) % N, y = i / NK / N | 0;
    const go = (j, v) => { if (v > 0 && !op[j] && val[j] < v) { val[j] = v; Q[v].push(j); } };
    if (k > 0) go(i - 1, L - 1); if (k < NK - 1) go(i + 1, L - 1);
    if (x > 0) go(i - NK, L - 2); if (x < N - 1) go(i + NK, L - 2);
    if (y > 0) go(i - NK * N, L - 2); if (y < N - 1) go(i + NK * N, L - 2);
  }
  let low = 0, diff = 0;
  for (const [cx, cy, cz] of all) for (let i = 0; i < 4096; i++) {
    const x = cx * CS + (i >> 4 & 15), y = cy * CS + (i >> 8), k = cz * SEC + (i & 15), j = ix(x, y, k);
    if (op[j]) continue;
    const g = W.lightAt(d, n, x, y, k);
    if (g < val[j]) low++;                                       // нижня межа: заливка всього завантаженого — не більша
    if (cx === CX && cy === CY && g !== val[j]) diff++;          // центр (далі 15 м від країв ділянки) — точно
  }
  assert.equal(low, 0);
  assert.equal(diff, 0);
});

test('меші: вершини на межах секцій — однакове AO (після перебудов зі світлом); підлога під навісом зі скарги світла', () => {
  const { meshes } = WA, at = new Map();
  let under = [];
  for (const [key, { q, m }] of meshes) {
    if (!m || !m.ns) continue;
    const u = unpack(m.op), [rx, ry, rz] = regionOf(q.cx, q.cy, q.cz), O = [rx * RW, ry * RW, rz * RH];
    for (let v = 0; v < m.ns; v++) {
      const x = u.pos[v * 3] + O[0], y = u.pos[v * 3 + 1] + O[1], z = u.pos[v * 3 + 2] + O[2];
      const onB = x % CS === 0 || y % CS === 0 || (z / 0.5) % SEC === 0;
      if (onB) {
        const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
        if (!at.has(k)) at.set(k, new Map());
        const M = at.get(k);
        if (!M.has(key)) M.set(key, new Set());
        M.get(key).add(u.ao[v]);
      }
      // підлога під навісом (стеля над клітинками 586…590 × 396…399, підлога z 4,5)
      if (Math.abs(z - 4.5) < 0.01 && u.nor[v * 3 + 2] > 100 && x >= 586 && x <= 591 && y >= 397 && y <= 399) under.push(u.ao[v]);
    }
  }
  // у спільній точці двох секцій — однакові набори AO (в одній секції в точці межі можуть зійтися дві різні вершини)
  let bad = 0, shared = 0;
  const { W: Wa, d: da, n: na } = WA;
  // куб вершини (8 блоків навколо) — лише в завантажених секціях: біля незавантаженого кожна секція тримає свою оцінку
  // воркера, доки сусід не прийде
  const loaded = (x, y, z) => {
    const X = Math.floor(x - 0.5), Y = Math.floor(y - 0.5), K = Math.floor(z / 0.5 - 0.5);
    for (let c = 0; c < 8; c++) if (!Wa.sec(da, na, Math.floor((X + (c & 1)) / CS), Math.floor((Y + (c >> 1 & 1)) / CS), Math.floor((K + (c >> 2)) / SEC))) return false;
    return true;
  };
  for (const [k, M] of at) {
    if (M.size < 2 || !loaded(...k.split(',').map(Number))) continue;
    shared++;
    const sets = [...M.values()].map((s) => [...s].sort((a, b) => a - b).join(','));
    if (sets.some((t) => t !== sets[0])) bad++;
  }
  assert.ok(shared > 300, `спільних точок ${shared}`);
  assert.equal(bad, 0, `вершин межі з різним AO: ${bad}`);
  assert.ok(under.length > 5);
  assert.ok(Math.min(...under) >= 0.4 * 255, `найтемніше ${Math.min(...under)}`);    // раніше — 0 (лише мінімум 3 %)
  const { W, d, n } = WA;
  const f = W.skyLight(d, n, 588.5, 397.5, 5);
  assert.ok(f > 0.4 && f < 0.8, `фігура під навісом ${f}`);
  assert.equal(W.skyLight(d, n, 583.5, 397.5, 5), 1);
});

test('рослини зблизька: світло основ із головного потоку (0 — темно, null — як під небом)', async () => {
  const { genCol } = await import('../js/gen/chunk.js');
  const { lawsOf } = await import('../js/laws/universe.js');
  const { objPose } = await import('../js/gen/mesh.js');
  const L = lawsOf(hashStr('test'), 0, 0);
  let col = null;
  for (let cx = 0; cx < 20 && !col; cx++) { const c = genCol(L, cx, 0); if (c.obj.some((o) => o.k !== O_FLOAT)) col = c; }
  for (const o of col.obj) objPose(col, L, o);
  // видима частина (до тіней малих рослин — ncv індексів)
  const lit = floraMesh(col, L, 0), dark = floraMesh(col, L, 0, new Uint8Array(col.obj.length));
  assert.equal(lit.ncv, dark.ncv);
  let some = false;
  for (let j = 0; j < lit.ncv; j++) { if (lit.a[lit.i[j]] > 0) some = true; assert.equal(dark.a[dark.i[j]], 0); }
  assert.ok(some);
});
