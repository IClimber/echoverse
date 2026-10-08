// Детермінізм і властивості генерації: хеші, шум, закони, чанки, межі чанків, схожість сусідніх всесвітів.
// Еталонні значення зафіксовано: зміна будь-якого з них = змінений генератор (незмінені місця в старих світах
// стануть іншими), тож тоді — підняти GEN у universe.js і оновити еталони свідомо.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hash2, hash3, hash4, hashStr, rng, unit } from '../js/rng.js';
import { noise2, noise3, fbm2, fbm3 } from '../js/noise.js';
import { lawsOf, hsl, GEN, SEA } from '../js/universe.js';
import { genChunk, digest, tile, ci, CS, T_WATER, blocks } from '../js/gen/chunk.js';
import { chunkMesh } from '../js/gen/mesh.js';
import { findSpawn } from '../js/world.js';
import { GOLD, SPOTS } from '../js/golden.js';

test('хеші й PRNG — еталонні значення', () => {
  assert.equal(hash2(1, 2), 3278122630);
  assert.equal(hash3(-5, 7, 123456789), 3998209988);
  assert.equal(hash4(0, 0, 0, 0), 2167721464);
  assert.equal(hashStr('test'), 718983719);
  assert.equal(hashStr('мій світ'), 2054874402);
  const r = rng(42);
  assert.deepEqual([r(), r(), r()], [0.15365219092927873, 0.3351755996700376, 0.20580738014541566]);
});

test('PRNG рівномірний, unit — [0, 1)', () => {
  const r = rng(7);
  let s = 0;
  for (let i = 0; i < 20000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); s += v; }
  assert.ok(Math.abs(s / 20000 - 0.5) < 0.01);
  assert.equal(unit(0xffffffff) < 1, true);
});

test('шум — еталонні значення, межі, неперервність', () => {
  assert.equal(noise2(7, 0.3, -1.7), -0.10684699798626311);
  assert.equal(noise3(7, 12.25, -3.5, 0.75), -0.008036613464355469);
  assert.equal(fbm2(9, 1.1, 2.2, 4), 0.20744540592679994);
  assert.equal(fbm3(9, -1.1, 2.2, 0.03, 3), 0.2406274916469641);
  for (let i = 0; i < 2000; i++) {
    const x = i * 0.137 - 50, y = i * 0.071 - 20, a = noise3(3, x, y, i * 0.01);
    assert.ok(a >= -1.01 && a <= 1.01);
    assert.ok(Math.abs(noise3(3, x + 0.001, y, i * 0.01) - a) < 0.01);   // крок 0,001 — зміна мала
  }
});

test('hsl — кольори в межах і відомі опорні', () => {
  assert.deepEqual(hsl(0, 1, 0.5), [255, 0, 0]);
  assert.deepEqual(hsl(1 / 3, 1, 0.5), [0, 255, 0]);
  assert.deepEqual(hsl(0.5, 0, 0.5), [128, 128, 128]);
  for (const c of Object.values(lawsOf(1, 3, -77).pal)) for (const v of c) assert.ok(v >= 0 && v <= 255 && Number.isInteger(v));
});


test(`чанки — еталонні відбитки (генератор v${GEN})`, () => {
  for (const [s, gold] of Object.entries(GOLD))
    SPOTS.forEach(([d, n, cx, cy], i) => assert.equal(digest(genChunk(lawsOf(hashStr(s), d, n), cx, cy)), gold[i], `${s} ${d}:${n} (${cx}, ${cy})`));
});

test('той самий чанк двічі — побайтно той самий; закони — з кешу чи наново однакові', () => {
  const L1 = lawsOf(5, 0, 3), L2 = lawsOf(5, 0, 3);
  assert.deepEqual(L1, L2);
  const a = genChunk(L1, -2, 7), b = genChunk(L2, -2, 7);
  assert.deepEqual([...a.h], [...b.h]);
  assert.deepEqual([...a.t], [...b.t]);
  assert.deepEqual(a.obj, b.obj);
});

test('межі чанків збігаються: рамка з кожного боку = крайній стовпець / рядок сусіда', () => {
  const L = lawsOf(hashStr('межі'), 0, 2);
  const A = genChunk(L, 0, 0), E = genChunk(L, 1, 0), S = genChunk(L, 0, 1), W = genChunk(L, -1, 0), N = genChunk(L, 0, -1);
  for (let k = 0; k < CS; k++) {
    assert.equal(A.h[ci(CS, k)], E.h[ci(0, k)], `схід, рядок ${k}`);
    assert.equal(A.h[ci(k, CS)], S.h[ci(k, 0)], `південь, стовпець ${k}`);
    assert.equal(A.h[ci(-1, k)], W.h[ci(CS - 1, k)], `захід, рядок ${k}`);
    assert.equal(A.h[ci(k, -1)], N.h[ci(k, CS - 1)], `північ, стовпець ${k}`);
  }
  // і з тим, що дає окрема клітинка
  const c = tile(L, 16, 5);
  assert.equal(A.h[ci(16, 5)], c.h);
  assert.equal(A.t[ci(16, 5)], c.t);
});

test('сусідні всесвіти схожі, далекі — ні', () => {
  const sim = (seed, n1, n2) => {
    const A = lawsOf(seed, 0, n1), B = lawsOf(seed, 0, n2), a = {}, b = {};
    let close = 0, N = 0;
    for (let y = -64; y < 64; y += 2) for (let x = -64; x < 64; x += 2) { tile(A, x, y, a); tile(B, x, y, b);
      // висота — з допуском 1 + 8 % висоти над морем (гори в сотні блоків трохи вищі чи нижчі — та сама форма); дно моря не порівнюємо
      close += a.t === T_WATER && b.t === T_WATER || Math.abs(a.h - b.h) <= 1 + 0.08 * Math.abs(a.h - SEA); N++;
    }
    return close / N;
  };
  const near = [], far = [];
  for (const s of ['test', 'abc', '42', 'q', 'zz']) for (const n of [0, 37, -120]) {
    near.push(sim(hashStr(s), n, n + 1)); far.push(sim(hashStr(s), n, n + 300));
  }
  const avg = (a) => a.reduce((x, y) => x + y) / a.length;
  assert.ok(Math.min(...near) > 0.8, `найменша схожість сусідів ${Math.min(...near)}`);
  assert.ok(avg(near) > 0.9, `середня схожість сусідів ${avg(near)}`);
  assert.ok(avg(far) < 0.45, `середня схожість далеких ${avg(far)}`);
});

test('різні глибини — різний рельєф (новий «поверх»)', () => {
  const s = hashStr('глибини'), a = {}, b = {};
  let same = 0;
  for (let i = 0; i < 400; i++) same += tile(lawsOf(s, 0, 0), i * 7, i * 3, a).h === tile(lawsOf(s, 1, 0), i * 7, i * 3, b).h;
  assert.ok(same < 200);
});

test('місце появи: детерміноване, на суходолі без предмета, що заважає, з виходом', () => {
  for (const s of ['test', 'abc', '42', 'q', 'zz']) {
    const seed = hashStr(s), p = findSpawn(seed);
    assert.deepEqual(p, findSpawn(seed));
    const c = tile(lawsOf(seed, 0, 0), Math.floor(p[0]), Math.floor(p[1]));
    assert.notEqual(c.t, T_WATER);
    assert.ok(!blocks(c.o));                                  // трава й квіти під ногами — можна
  }
});

test('меш чанка: масиви узгоджені, індекси в межах', () => {
  const L = lawsOf(hashStr('меш'), 0, 4);
  let cx = 3;
  while (Math.min(...genChunk(L, cx, 3).h) < 1) cx++;           // чанк на суходолі (тестовий стовпець — блоки 0…95)
  const C = genChunk(L, cx, 3), m = chunkMesh(C, L).solid, nv = m.pos.length / 3;
  assert.equal(m.nor.length, nv * 3);
  assert.equal(m.col.length, nv * 3);
  assert.equal(m.count % 3, 0);
  assert.ok(m.count >= 6);
  for (const i of m.idx) assert.ok(i < nv);
  for (let i = 0; i < m.pos.length; i += 3) assert.ok(m.pos[i] >= -0.5 && m.pos[i] <= CS + 0.5 && m.pos[i + 1] >= -0.5 && m.pos[i + 1] <= CS + 0.5);
});

test('плавна поверхня: рівнина — пласка на верху блоків, сходинка — схил, на межі чанків вершини збігаються', async () => {
  const { B_GRASS, B_AIR, bi: biF } = await import('../js/gen/chunk.js');
  const L = lawsOf(hashStr('меш'), 0, 4);
  // штучний чанк: ліворуч (x < 8) — 6 блоків, праворуч — 7; рамка — так само
  const mk = (hx) => {
    const C = genChunk(L, 3, 3);
    C.obj = [];
    for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) for (let k = -1; k < 96; k++) C.b[biF(x, y, k)] = k < hx(x) ? B_GRASS : B_AIR;   // і нижня рамка — суцільна
    return chunkMesh(C, L).solid;
  };
  const m = mk((x) => x < 8 ? 6 : 7), zs = new Set();
  for (let i = 0; i < m.pos.length; i += 3) {
    const x = m.pos[i], z = m.pos[i + 2];
    if (m.nor[i + 2] > 60) zs.add(z);
    if (x <= 6 && m.nor[i + 2] > 120) assert.equal(z, 3);                  // далеко від сходинки — рівно на верху блоків
  }
  assert.ok([...zs].some((z) => z > 3 && z < 3.5), 'сходинка не стала схилом');
  // вершини на межі чанків: однакові дані рамки → однакові точки в обох сусідів (тут — зсув на CS)
  const a = mk((x) => x < 16 ? 6 : 7), b = mk((x) => x < 0 ? 6 : 7), pa = new Set(), pb = new Set();   // b — сусід праворуч
  for (let i = 0; i < a.pos.length; i += 3) if (a.pos[i] >= CS - 0.5) pa.add(`${a.pos[i] - CS},${a.pos[i + 1]},${a.pos[i + 2]}`);
  for (let i = 0; i < b.pos.length; i += 3) if (b.pos[i] <= 0.5) pb.add(`${b.pos[i]},${b.pos[i + 1]},${b.pos[i + 2]}`);
  for (const p of pa) assert.ok(pb.has(p), `вершина ${p} є лише в одного з сусідів`);
  assert.ok(pa.size > 0 && pb.size > 0);
});

test('гравітація: розподіл з реальних тіл (0,027…3,4 g, медіана 1 g), ≈ 1 g біля старту; легка — вільніший рух', async () => {
  const { physOf, FLOAT_G } = await import('../js/universe.js');
  const seed = hashStr('гравітація'), G = [];
  let lo = null, hi = null;
  for (let i = 0; i < 20000; i++) {
    const n = i < 801 ? i - 400 : 200 + i * 7, g = lawsOf(seed, 0, n).grav;
    assert.ok(g >= 0.027 && g <= 3.4, `${n}: ${g}`);
    if (Math.abs(n) <= 5) assert.ok(g > 0.8 && g < 1.2, `біля старту ${n}: ${g}`);
    if (g < FLOAT_G && lo === null) lo = n;
    if (g > 1.4 && hi === null) hi = n;
    if (i >= 801) G.push(g);
  }
  assert.ok(lo !== null && hi !== null, 'немає легких чи важких всесвітів');
  G.sort((a, b) => a - b);
  const q = (p) => G[Math.floor(G.length * p)];
  for (const [p, v] of [[0.08, 0.38], [0.5, 1], [0.97, 2.3]]) assert.ok(Math.abs(q(p) - v) < 0.06 * v + 0.02, `квантиль ${p}: ${q(p)} замість ${v}`);
  const pl = physOf(lawsOf(seed, 0, lo)), ph = physOf(lawsOf(seed, 0, hi));
  assert.ok(pl.up >= ph.up && pl.speed > ph.speed);
});

test('левітуючі породи: біля старту немає; трапляються з різними умовами; ширяюче каміння — лише з такої породи, де вона левітує; острови — з неї ж', async () => {
  const { floats, gravityAt } = await import('../js/universe.js');
  const { solidMask, O_FLOAT, B_FLOAT } = await import('../js/gen/chunk.js');
  const seed = hashStr('гравітація'), conds = new Set();
  let withFloat = null, islands = 0, anomU = null;
  for (let n = -800; n <= 800; n++) {
    const L = lawsOf(seed, 0, n);
    if (Math.abs(n) <= 8) assert.equal(L.stones.length, 0);
    for (const st of L.stones) { conds.add(st.cond); assert.equal(st.active, floats(st, L.grav, L.mag.k)); }
    if (withFloat === null && L.stones.some((st) => st.active && st.lift > 1)) withFloat = n;
    if (L.islandStone >= 0) { islands++; assert.ok(L.stones[L.islandStone].active && L.islands > 0); } else assert.equal(L.islands, 0);
    if (anomU === null && L.anom.freq > 0.3) anomU = n;
  }
  for (let n = 801; anomU === null && n < 60000; n += 3) if (lawsOf(seed, 0, n).anom.freq > 0.3) anomU = n;   // аномалії — рідкість
  assert.ok(conds.size === 4 && withFloat !== null && islands > 3 && islands < 120, `умов ${conds.size}, островів ${islands}`);
  let floatsN = 0;
  const L = lawsOf(seed, 0, withFloat);
  for (let cx = 0; cx < 12; cx++) {
    const C = genChunk(L, cx, 0), m = solidMask(C);
    for (const o of C.obj) if (o.k === O_FLOAT) {
      floatsN++; assert.equal(m[o.y * CS + o.x], 0);
      const st = L.stones[o.st - 1];
      assert.ok(st && st.lift > 1 && floats(st, L.grav * gravityAt(L, cx * CS + o.x + 0.5, o.y + 0.5).k, L.mag.k));
    }
  }
  assert.ok(floatsN > 0, 'немає ширяючого каміння');
  // аномалії гравітації: плями з іншою силою; поза ними — 1
  const A = lawsOf(seed, 0, anomU), ks = new Set();
  for (let y = 0; y < 3000; y += 7) for (let x = 0; x < 3000; x += 7) ks.add(Math.round(gravityAt(A, x, y).k * 10));
  assert.ok(ks.has(10) && ks.size > 3, `аномалій немає: ${[...ks]}`);
  assert.ok(B_FLOAT > 0);
});

test('рідини: біля старту — безпечна вода; трапляються інші; сухий всесвіт — русла без рідини; гаряча — небезпечна; дно — не порожнеча', async () => {
  const { L_WATER, L_DRY, HOT } = await import('../js/universe.js');
  const { T_BED, T_ICE } = await import('../js/gen/chunk.js');
  const seed = hashStr('рідини'), kinds = new Set();
  let dry = null, hot = null;
  for (let n = -600; n <= 600; n++) {
    const q = lawsOf(seed, 0, n).liquid;
    kinds.add(q.kind);
    if (Math.abs(n) <= 8) assert.ok(q.kind === L_WATER && q.swim && !q.danger, `біля старту ${n}`);
    if (q.kind === L_DRY && dry === null) dry = n;
    if (q.kind === L_WATER && q.tC > HOT && hot === null) hot = n;
    if (q.kind !== L_WATER && q.kind !== L_DRY) assert.ok(q.danger.length > 0);
    assert.equal(q.swim, q.kind !== L_DRY && q.density >= 0.8);
  }
  assert.ok(kinds.size >= 4, `видів рідин лише ${kinds.size}`);
  if (dry !== null) {
    const L = lawsOf(seed, 0, dry);
    let beds = 0;
    for (let cx = 0; cx < 6; cx++) for (const t of genChunk(L, cx, 0).t) { assert.notEqual(t, T_WATER); assert.notEqual(t, T_ICE); beds += t === T_BED; }
  }
  if (hot !== null) assert.ok(lawsOf(seed, 0, hot).liquid.danger.length > 0);
  // дно водойми — нижче поверхні (з v9 може бути й нижче нуля: глибина океанів — закон)
  const L = lawsOf(seed, 0, 0), c = {};
  let found = 0;
  for (let x = 0; x < 400 && found < 50; x++) { tile(L, x, 7, c); if (c.t === T_WATER) { found++; assert.ok(c.h < SEA, `дно ${c.h}`); } }
});

test('вокселі: стовпець окремо = стовпець у чанку; рамки сусідніх чанків збігаються; печери й острови трапляються', async () => {
  const { genColumn, bi, H, B_AIR, B_STONE, solidB } = await import('../js/gen/chunk.js');
  const seed = hashStr('вокселі'), L = lawsOf(seed, 0, 37);
  const A = genChunk(L, 2, -1), E = genChunk(L, 3, -1);
  for (const [x, y] of [[0, 0], [7, 9], [15, 15]]) {
    const { B } = genColumn(L, 2 * CS + x, -CS + y);
    for (let k = 0; k < H; k++) assert.equal(A.b[bi(x, y, k)], B[k], `(${x}, ${y}, ${k})`);
  }
  for (let y = 0; y < CS; y++) for (let k = 0; k < H; k++) assert.equal(A.b[bi(CS, y, k)], E.b[bi(0, y, k)]);
  // печери: повітря під поверхнею (не у водоймах) і острови: тверде високо над рельєфом — у якомусь із всесвітів
  let caves = 0, isl = 0;
  for (let n = 0; n < 20000 && (!caves || !isl); n += 7) {     // печери й острови — рідкість: шукаємо всесвіти з ними
    const M = lawsOf(seed, 1, n);
    if (M.caveShare < 0.3 && M.islands <= 0.02) continue;
    const C = genChunk(M, 0, 0);
    for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
      const h = C.h[ci(x, y)];
      for (let k = 2; k < h - 2; k++) if (C.b[bi(x, y, k)] === B_AIR) caves++;
      for (let k = 44; k < H; k++) if (solidB(C.b[bi(x, y, k)])) isl++;
    }
  }
  assert.ok(caves > 0, 'немає печер');
  assert.ok(isl > 0, 'немає ширяючих островів');
  assert.equal(A.b[bi(5, 5, 0)], B_STONE);
});

test('біоми й види: у всесвіті багато біомів і тисячі видів; сусідні області схожі, далекі — ні; ті самі в сусідньому всесвіті', async () => {
  const { BIOMES } = await import('../js/gen/biomes.js');
  const { regionAt, speciesOf, GENES } = await import('../js/gen/flora.js');
  const seed = hashStr('біоми'), L = lawsOf(seed, 0, 30), c = {}, biomes = new Set(), species = new Set(), regs = new Map();
  for (let y = -3000; y < 3000; y += 41) for (let x = -3000; x < 3000; x += 41) {
    tile(L, x, y, c);
    if (!c.bm) continue;
    biomes.add(c.bm);
    const reg = regionAt(L, x, y), S = speciesOf(L, reg, c.bm);
    regs.set(reg.id, reg);
    for (const g of [...S.big, ...S.small]) {
      species.add(g.id);
      assert.equal(g.p.length, GENES);
      for (const v of g.p) assert.ok(v >= 0 && v <= 1);
      assert.ok(g.h > 0 && g.h < 14, `${g.form} ${g.h}`);
    }
  }
  assert.ok(biomes.size >= 8, `біомів ${biomes.size}`);
  assert.ok(species.size >= 1000, `видів ${species.size}`);
  // області — клітини ~140–310 клітинок: на 6000×6000 їх сотні
  assert.ok(regs.size > 300 && regs.size < 3000, `областей ${regs.size}`);
  // гени: області поруч схожіші, ніж далекі (той самий біом і слот)
  const bm = [...biomes].find((b) => BIOMES[b].big.length), list = [...regs.values()];
  const dist = (a, b) => { const A = speciesOf(L, a, bm).small[0] || speciesOf(L, a, bm).big[0], B = speciesOf(L, b, bm).small[0] || speciesOf(L, b, bm).big[0]; let s = 0; for (let k = 0; k < GENES; k++) s += Math.abs(A.p[k] - B.p[k]); return s / GENES; };
  let near = 0, far = 0, nn = 0, nf = 0;
  for (const a of list) for (const b of list) {
    if (a === b) continue;
    const d2 = (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
    if (d2 < 400 * 400 && nn < 300) { near += dist(a, b); nn++; } else if (d2 > 2500 * 2500 && nf < 300) { far += dist(a, b); nf++; }
  }
  assert.ok(near / nn < far / nf, `сусіди ${near / nn}, далекі ${far / nf}`);
  // сусідній всесвіт: ті самі області й види (ті самі id), гени трохи інші
  const L2 = lawsOf(seed, 0, 31), reg = list[0], A = speciesOf(L, reg, bm), B = speciesOf(L2, reg, bm);
  assert.deepEqual(A.big.map((g) => g.id), B.big.map((g) => g.id));
  if (A.big.length && A.big[0].form === B.big[0].form) { let s = 0; for (let k = 0; k < GENES; k++) s += Math.abs(A.big[0].p[k] - B.big[0].p[k]); assert.ok(s / GENES < 0.08, `гени сусідніх всесвітів ${s / GENES}`); }
});

test('рослини: дерева не впритул (між стовбурами — прохід), трава не заважає; шаблони всіх форм — валідні й у бюджеті', async () => {
  const { O_TREE, O_COVER, solidMask } = await import('../js/gen/chunk.js');
  const { template } = await import('../js/gen/plants.js');
  const { FORMS } = await import('../js/gen/flora.js');
  const seed = hashStr('ліс');
  let trees = 0, cover = 0;
  for (const n of [0, 20, 77]) for (let cx = 0; cx < 4; cx++) {
    const L = lawsOf(seed, 0, n), C = genChunk(L, cx * 25, cx * 13 + 1), m = solidMask(C), at = new Set();
    for (const o of C.obj) {
      if (o.k === O_TREE) { trees++; at.add(o.x + ',' + o.y); }
      if (o.k === O_COVER) { cover++; assert.equal(m[o.y * CS + o.x], 0); }
    }
    for (const o of C.obj) if (o.k === O_TREE) for (const [i, j] of [[1, 0], [0, 1]]) {
      // сусід навхрест — лише в густих біомах (джунглі, бамбук); інакше між деревами щонайменше клітинка
      if (at.has(o.x + i + ',' + (o.y + j))) assert.ok(['джунглі', 'бамбукові хащі'].includes((await import('../js/gen/biomes.js')).BIOMES[C.bm[ci(o.x, o.y)]].name));
    }
    const mesh = chunkMesh(C, L);
    for (const x of [mesh.flora, mesh.far]) if (x) { const nv = x.pos.length / 3; assert.equal(x.col.length, nv * 3); for (const i of x.idx) assert.ok(i < nv); }
  }
  assert.ok(trees > 10 && cover > 50, `дерев ${trees}, покриву ${cover}`);
  for (const form of Object.keys(FORMS)) for (let i = 0; i < 12; i++) {
    const p = Array.from({ length: 24 }, (_, k) => ((i * 7919 + k * 104729) % 997) / 997);
    const g = { id: i * 31 + 7, key: 't' + form + i, form, big: FORMS[form].big, h: FORMS[form].h[1], p, leaf: [60, 140, 60], bark: [90, 60, 40], acc: [220, 80, 120], g: 0.4 + i * 0.15 };
    for (const lod of FORMS[form].big ? [0, 1] : [0]) {
      const T = template(g, i % 3, lod);
      assert.ok(T.verts > 0 && T.verts % 3 === 0, form);
      assert.ok(T.verts <= (lod ? 700 : FORMS[form].big ? 3000 : 1200), `${form} lod ${lod}: ${T.verts} вершин`);
      for (const v of T.p) assert.ok(Number.isFinite(v) && Math.abs(v) < 20, form);
    }
  }
});

test('форми рельєфу: річки (вузькі смуги рідини), вулкани з лавою, вершини понад амплітуду, кратери й дюни трапляються', async () => {
  const seed = hashStr('test'), c = {};
  let magma = 0, high = 0, river = 0, vn = 200;
  while (!(lawsOf(seed, 0, vn).relief.volcano > 0.4 && lawsOf(seed, 0, vn).relief.volcanoLava)) vn += 7;   // вулкани — рідкість
  for (const n of [-130, -95, 0, 17, vn]) {
    const L = lawsOf(seed, 0, n);
    const r = n === vn ? 1500 : 600;
    for (let y = -r; y <= r; y += 5) for (let x = -r; x <= r; x += 5) {
      tile(L, x, y, c);
      magma += c.magma; if (c.t !== 0 && c.h > 6 + L.amp) high++;
    }
    if (n === 0) {                              // річка: рідина, а за кілька клітинок обабіч — суходіл
      for (let x = -300; x <= 300; x++) {
        tile(L, x, 0, c); if (c.t !== 0) continue;
        const a = tile(L, x - 6, 0, {}).t, b = tile(L, x + 6, 0, {}).t;
        if (a !== 0 && b !== 0) river++;
      }
    }
  }
  assert.ok(magma > 0 && high > 0 && river > 0, `лава ${magma}, вершин понад амплітуду ${high}, русел ${river}`);
  // закони: біля старту кратери, вулкани й шпилі — рідко
  for (let n = -5; n <= 5; n++) { const R = lawsOf(seed, 0, n).relief; assert.ok(R.craters <= 0.15 && R.volcano <= 0.25 && R.spires <= 0.2); }
});

test('далечінь: плитка — узгоджений меш, висоти вершин — поверхня tile', async () => {
  const { farMesh, FT } = await import('../js/gen/far.js');
  const { LEVEL } = await import('../js/iso.js');
  const { T_ICE } = await import('../js/gen/chunk.js');
  const L = lawsOf(hashStr('далечінь'), 0, 7);
  for (const s of [2, 4, 8]) {
    const { mesh: m, zmin, zmax } = farMesh(L, -1, 2, s), n = FT / s + 1, nv = m.pos.length / 3;
    assert.equal(m.nor.length, nv * 3); assert.equal(m.col.length, nv * 3); assert.equal(m.mat.length, nv);
    assert.equal(m.count % 3, 0);
    for (const i of m.idx) assert.ok(i < nv);
    assert.ok(zmin <= zmax);
    for (const [i, j] of [[0, 0], [n - 1, 3], [5, n - 1]]) {
      const c = tile(L, -FT + i * s, 2 * FT + j * s), z = m.pos[(j * n + i) * 3 + 2];
      if (c.t !== T_WATER && c.t !== T_ICE) assert.ok(Math.abs(z - (c.h + 1) * LEVEL) < 1e-6, `${z} / ${c.h}`);
    }
  }
});

test('печери: великі зали (порожнина ≥ 30 блоків заввишки), прохідні ходи', async () => {
  const { genCol, genBlocks, bv, B_AIR: AIR, CS: N } = await import('../js/gen/chunk.js');
  let big = 0, runs = [];
  const ns = [];                                  // печери — рідкість: беремо всесвіти, де печерних областей багато
  for (let n = 200; ns.length < 3; n += 7) if (lawsOf(hashStr('test'), 0, n).caveShare >= 0.5) ns.push(n);
  for (const n of ns) {
    const L = lawsOf(hashStr('test'), 0, n);
    for (let c = 0; c < 4; c++) {
      const col = genCol(L, c * 7, c * 3 - 5), k0 = col.hmin - 160, V = genBlocks(L, col, k0, 160);
      for (let x = 0; x < N; x += 3) for (let y = 0; y < N; y += 3) {
        let r = 0;
        for (let k = 0; k < 160; k++) if (V.b[bv(x, y, k, 160)] === AIR) r++; else { if (r) runs.push(r); r = 0; }
      }
    }
  }
  runs.sort((a, b) => a - b);
  big = runs.filter((r) => r >= 30).length;
  const med = runs[runs.length >> 1];
  assert.ok(big > 0, 'великі зали трапляються');
  assert.ok(med >= 4, `медіана висоти порожнин ${med} блоків — ходи прохідні (гравець — 2)`);
});

test('рідкісність законів: класи всесвітів 30 / 45 / 20 / 5 %, крайнє й легендарне — рідко, біля старту — лише звичайне', async () => {
  const { qOf, STRANGE_NAMES } = await import('../js/universe.js');
  const seed = hashStr('test'), N = 20000, cls = [0, 0, 0, 0], dec = new Array(10).fill(0);
  let none = 0, ext = 0, leg = 0, isl = 0, anom = 0, volc = 0, w360 = 0;
  const W = [];
  for (let i = 0; i < N; i++) {
    const L = lawsOf(seed, 0, 200 + i * 7), t = Object.values(L.tiers), m = t.length ? Math.max(...t) : 0;
    cls[L.strange.cls]++; dec[Math.min(9, Math.floor(qOf((i * 0.618034 % 1) * 2.2 - 1.1) * 10))]++;
    if (m === 0) none++; if (m >= 2) ext++; if (m === 3) leg++;
    if (L.islands > 0) isl++; if (L.anom.freq >= 0.02) anom++; if (L.relief.volcano > 0.4) volc++;
    const kmh = L.air.wind * 2.2 * 1.8 * 3.6; W.push(kmh); if (kmh > 360) w360++;
  }
  const pc = (v) => v / N * 100;
  [30, 45, 20, 5].forEach((v, i) => assert.ok(Math.abs(pc(cls[i]) - v) < 3, `${STRANGE_NAMES[i]}: ${pc(cls[i]).toFixed(1)} %`));
  assert.ok(pc(none) > 25 && pc(none) < 42, `без незвичного ${pc(none)}`);
  assert.ok(pc(ext) > 12 && pc(ext) < 30, `з крайнім ${pc(ext)}`);
  assert.ok(pc(leg) > 0.2 && pc(leg) < 2.5, `з легендарним ${pc(leg)}`);
  assert.ok(pc(isl) > 1.2 && pc(isl) < 6, `острови ${pc(isl)}`);
  assert.ok(pc(anom) < 25 && pc(volc) < 10, `аномалії ${pc(anom)}, вулкани ${pc(volc)}`);
  W.sort((a, b) => a - b);
  assert.ok(W[N >> 1] < 90 && pc(w360) < 1 && W[N - 1] > 400, `вітер: медіана ${W[N >> 1]}, > 360 — ${pc(w360)} %, максимум ${W[N - 1]}`);
  for (let n = -5; n <= 5; n++) { const L = lawsOf(seed, 0, n); assert.equal(Object.keys(L.tiers).length, 0, `біля старту ${n}: ${Object.keys(L.tiers)}`); }
});

test('рідкісність: qOf робить lane рівномірним', async () => {
  const { qOf } = await import('../js/universe.js');
  const { noise2 } = await import('../js/noise.js');
  const dec = new Array(10).fill(0);
  let N = 0;
  for (let s = 1; s < 9; s++) for (let n = 0; n < 20000; n += 3) {
    const sd = Math.imul(s, 0x9e3779b9), v = noise2(sd, n / 37, s * 7 + 0.5) + 0.25 * noise2(sd ^ 0x5bd1e995, n / (37 * 0.4), 0.5);
    dec[Math.min(9, Math.floor(qOf(v) * 10))]++; N++;
  }
  for (const c of dec) assert.ok(Math.abs(c / N - 0.1) < 0.015, `децилі: ${dec.map((c) => (c / N * 100).toFixed(1))}`);
});

test('печери за рідкісністю: лише в печерних областях (частка ≈ закону); звичайно мало, пронизані світи — рідкість', async () => {
  const { genCol, genBlocks, bv, B_AIR: AIR } = await import('../js/gen/chunk.js');
  const { noise3 } = await import('../js/noise.js');
  const seed = hashStr('test'), fr = [];
  const airOf = (L) => {
    let air = 0, tot = 0;
    for (let c = 0; c < 6; c++) {
      const col = genCol(L, c * 9 - 20, c * 5 - 11), k0 = col.hmin - 80, V = genBlocks(L, col, k0, 60);
      for (let x = 0; x < CS; x += 2) for (let y = 0; y < CS; y += 2) for (let k = 0; k < 60; k++) { tot++; if (V.b[bv(x, y, k, 60)] === AIR) air++; }
    }
    return air / tot * 100;
  };
  for (let i = 0; i < 40; i++) fr.push(airOf(lawsOf(seed, 0, 300 + i * 97)));
  fr.sort((a, b) => a - b);
  assert.ok(fr[20] < 4, `медіана повітря під землею ${fr[20]} %`);
  assert.ok(fr[0] < 0.5, `є світи майже без печер: ${fr[0]}`);
  let riddled = null;
  for (let n = 200; riddled === null; n += 7) if (lawsOf(seed, 0, n).caveShare > 0.85) riddled = n;
  assert.ok(airOf(lawsOf(seed, 0, riddled)) > 3, 'пронизаний світ — порожнистий');
  for (const n of [300, 397, riddled]) {
    const L = lawsOf(seed, 0, n);
    let inn = 0, t = 0;
    for (let i = 0; i < 20000; i++) { t++; if (noise3(L.sCm, ((i * 37) % 3000) / 200, ((i * 91) % 2900) / 200, -((i * 13) % 400) / 300) > L.caveThr) inn++; }
    assert.ok(Math.abs(inn / t - L.caveShare) < 0.08, `області ${inn / t} проти ${L.caveShare}`);
  }
});
