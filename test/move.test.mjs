// Рух п. 3 roadmap: пози (присів, лежить), край, сповзання, лазіння (стіна, драбина, ліана), пірнання, політ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL } from '../js/iso.js';
import { step, hits, shapeOf, slideZ, SPEED, SNEAK, PH1, FOOT, CLIMB_V, SPRINT, FLY_SPEED, FLY_FAST, FLOAT_Z } from '../js/player.js';
import { B_AIR, B_LIQ, B_GRASS, B_STONE, B_ICE, B_LADDER, B_VINE, solidB } from '../js/gen/chunk.js';

const X = [[1, 0], [0, 1]];                  // базис руху: праворуч = +x, униз екрана = +y (iy −1 — уздовж −y)
const DT = 1 / 120;
// Світ з функції блоків f(x, y, k); за межами ±40 — не згенеровано
const box = (f, liquid = { swim: true, danger: '', density: 1, visc: 1 }, obj = () => null) => ({
  liquid, obj, block: (x, y, k) => (Math.abs(x) > 40 || Math.abs(y) > 40 ? -1 : k < -2 ? B_STONE : f(x, y, k)),
});
// Крок за кроком: ctl — {crouch, sprint, …} чи функція від номера кроку; ix, iy — так само
function go(p, P, n, ix, iy, ctl = {}, ph = PH1, mb = X, jumpAt = -1) {
  for (let i = 0; i < n; i++) {
    const c = typeof ctl === 'function' ? ctl(i) : ctl;
    step(p, typeof ix === 'function' ? ix(i) : ix, typeof iy === 'function' ? iy(i) : iy, i === jumpAt, DT, P, ph, mb, c);
  }
  return p;
}
const man = (x, y, z) => ({ x, y, z, vz: 0, ground: true });

// Печера: зала x < 3 (4 блоки заввишки), далі хід: y — ws…we, заввишки hc блоків, з x ≥ 7 — lo блоків (до x < x1),
// потім знову зала; підлога — верх k = 1
const cave = (ws, we, hc, lo, x1 = 99) => box((x, y, k) => {
  if (k < 2) return B_STONE;
  if (x < 3 || x >= x1) return y >= -3 && y <= 5 && k < 6 ? B_AIR : B_STONE;
  return y >= ws && y <= we && k < 2 + (x >= 7 ? lo : hc) ? B_AIR : B_STONE;
});
const free = (P, p) => !hits(P, p.x, p.y, p.z, shapeOf(p));

test('присідання: коридор 1×2 під стелею (прямі стіни — видимо рівно 1 м) — і стоячи, і з Ctrl; швидкість ×0,3', () => {
  const P = cave(1, 1, 2, 2);
  const a = go(man(1.5, 1.5, 1), P, 400, 1, 0);
  assert.ok(a.x > 10 && a.pose === 'stand' && free(P, a), `стоячи: ${a.x} ${a.pose}`);
  const b = go(man(1.5, 1.5, 1), P, 1600, 1, 0, { crouch: true });
  assert.ok(b.x > 10 && b.pose === 'crouch' && free(P, b), `з Ctrl: ${b.x} ${b.pose}`);
  // швидкість присіду — на рівнині за 1 с
  const F = box((x, y, k) => k < 2 ? B_STONE : B_AIR), c = go(man(0.5, 0.5, 1), F, 120, 1, 0, { crouch: true });
  assert.ok(Math.abs(c.x - 0.5 - SPEED * SNEAK) < SPEED * SNEAK * 0.03, `присід за 1 с: ${c.x - 0.5}`);
  // біг у присіді — ні
  const d = go(man(0.5, 0.5, 1), F, 120, 1, 0, { crouch: true, sprint: true });
  assert.ok(Math.abs(d.x - c.x) < 1e-9, `біг у присіді: ${d.x} / ${c.x}`);
});

test('повзання: з присіду в лаз 3×1 і 2×1 (стіни в 1 блок — плавні, як були) лягаєш сам; 1×1 — ні; без Ctrl — ні; з лазу без Ctrl — встаєш', () => {
  for (const [ws, we] of [[0, 2], [0, 1]]) {
    const P = cave(ws, we, 2, 1);
    const a = go(man(1.5, 1.5, 1), P, 400, 1, 0);
    assert.ok(a.x < 6.6 && a.pose === 'stand', `${we - ws + 1}: стоячи ${a.x}`);
    let crawl = false;
    const b = go(man(1.5, 1.5, 1), P, 3000, 1, 0, (i) => { return { crouch: true }; });
    go(b, P, 1, 1, 0, { crouch: true }); crawl = b.pose === 'crawl';
    assert.ok(b.x > 10 && crawl && free(P, b), `${we - ws + 1}: з Ctrl ${b.x} ${b.pose}`);
  }
  const one = go(man(1.5, 1.5, 1), cave(1, 1, 2, 1), 3000, 1, 0, { crouch: true });
  assert.ok(one.x < 7.5, `1×1: ${one.x}`);       // вхід — у прямій стіні зали: на 0,27 заходиш, далі — ні
  // лаз 2×1 від x = 7 до 11, далі зала: Ctrl відпустив у лазі — лежиш (стеля), вийшов — стоїш
  const P = cave(0, 1, 2, 1, 11), p = go(man(1.5, 1.0, 1), P, 760, 1, 0, { crouch: true });
  assert.ok(p.x > 7.5 && p.x < 11 && p.pose === 'crawl', `у лазі: ${p.x} ${p.pose}`);
  go(p, P, 30, 0, 0);
  assert.ok(p.pose === 'crawl' && free(P, p), `під стелею без Ctrl: ${p.pose}`);
  go(p, P, 1600, 1, 0);
  assert.ok(p.x > 11.5 && p.pose === 'stand' && free(P, p), `вийшов: ${p.x} ${p.pose}`);
});

test('край: присів чи лежить — з уступу вище кроку не падаєш, на 1 блок — спускаєшся; стоячи — падаєш', () => {
  // платформа x 5…9 (верх k = 10, z 5), далі — підлога на висоті lo блоків
  const plat = (lo) => box((x, y, k) => k < 2 || (x >= 5 && x <= 9 && k < 10) || (x > 9 && k < lo) ? B_STONE : B_AIR);
  const P = plat(2), a = go(man(7.5, 0.5, 5), P, 360, 1, 0, { crouch: true });
  assert.ok(a.z > 4.75 && a.ground && a.x <= 10 + FOOT + 0.02 && a.x > 9.5, `присів: ${a.x} ${a.z}`);
  const b = go(man(7.5, 0.5, 5), P, 360, 1, 0);
  assert.ok(b.z < 2, `стоячи: ${b.z}`);
  // уздовж краю (рух під кутом) — ковзаєш уздовж, не падаєш
  const c = go(man(9.5, 0.5, 5), P, 240, 1, 1, { crouch: true });
  assert.ok(c.z > 4.75 && c.ground && c.y > 2, `уздовж краю: ${c.y} ${c.z}`);
  const d = go(man(7.5, 0.5, 5), plat(9), 360, 1, 0, { crouch: true });
  assert.ok(d.x > 11 && Math.abs(d.z - 4.5) < 1e-6, `1 блок: ${d.x} ${d.z}`);
  const e = go(man(7.5, 0.5, 5), plat(8), 360, 1, 0, { crouch: true });
  assert.ok(e.z > 4.75 && e.x < 10.5, `2 блоки: ${e.x} ${e.z}`);
});

// Рампа уздовж +x: верх стовпця x — base + per·x блоків (per — блоків на клітинку), з x0; матеріал mat
const ramp = (per, mat = B_GRASS, den = 1) => box((x, y, k) => k < 4 + Math.max(0, Math.floor(per * x / den)) ? (k < 2 ? B_STONE : mat) : B_AIR);
const surfZ = (P, x) => { let k = 200; while (k > 0 && !solidB(P.block(Math.floor(x), 0, k - 1))) k--; return k * LEVEL; };

test('сповзання: межа — tan θs = μ·tan θw; звичайний ґрунт — 50° (1 g) / 65° (легка), лід і ковзкий — менше', async () => {
  assert.ok(Math.abs(Math.acos(slideZ(1, PH1)) * 180 / Math.PI - 50) < 1e-6);
  assert.ok(Math.abs(Math.acos(slideZ(0.15, PH1)) * 180 / Math.PI - 10.15) < 0.05);
  assert.ok(Math.abs(Math.acos(slideZ(0.3, PH1)) * 180 / Math.PI - 19.7) < 0.05);
  // площина 26,6° (1 блок на клітинку): трава — стоїш, лід — сповзаєш, тертя 0,3 — сповзаєш, 0,5 — ні (межа 30,8°)
  const stay = (P, ph) => { const p = man(10.5, 0.5, surfZ(P, 10.5) + 0.1); go(p, P, 30, 0, 0, {}, ph); const z0 = p.z; go(p, P, 120, 0, 0, {}, ph); return p.z - z0; };
  assert.ok(Math.abs(stay(ramp(1), PH1)) < 0.01, 'трава 26,6°');
  assert.ok(stay(ramp(1, B_ICE), PH1) < -0.3, 'лід 26,6°');
  assert.ok(stay(ramp(1), { ...PH1, friction: 0.3 }) < -0.3, 'тертя 0,3');
  assert.ok(Math.abs(stay(ramp(1), { ...PH1, friction: 0.5 })) < 0.01, 'тертя 0,5');
  // пилка 2 блоки на клітинку (56° завширшки 0,5 і 27°): з крутого — униз на пологе при 1 g; у легкій (межа ходи 65°) — стоїш
  const P2 = box((x, y, k) => k < 4 + Math.max(0, 2 * x) ? B_GRASS : B_AIR);
  const on = (ph) => { const p = man(11.05, 0.5, 13); go(p, P2, 2, 0, 0, {}, ph); const x0 = p.x, z0 = p.z; go(p, P2, 120, 0, 0, {}, ph); return [x0, z0, p]; };
  const [x1, z1, p1] = on(PH1);
  assert.ok(p1.x < 10.85 && p1.z - z1 < -0.05 && p1.ground && !p1.slide, `56°, 1 g: x ${x1} → ${p1.x}, Δz ${p1.z - z1}`);
  const [x2, z2, p2] = on({ ...PH1, up: 2, g: 0.5 });
  assert.ok(Math.abs(p2.x - x2) < 0.01 && Math.abs(p2.z - z2) < 0.01, `56°, легка: Δx ${p2.x - x2}, Δz ${p2.z - z2}`);
  // на льоду сповзаєш довго: швидкість росте
  const I = ramp(1, B_ICE), q = man(20.5, 0.5, surfZ(I, 20.5) + 0.1);
  go(q, I, 60, 0, 0); const v1 = Math.hypot(q.vx, q.vy); go(q, I, 60, 0, 0);
  assert.ok(Math.hypot(q.vx, q.vy) > v1 * 1.5 && q.slide && q.vx < 0, `лід: швидкість ${v1} → ${Math.hypot(q.vx, q.vy)}`);
});

// Стіна з x ≥ 10 заввишки h блоків над підлогою (верх k = 1, z 1); mat — блок стіни; drabyna / ліана — у клітинці x = 9
const wallW = (h, mat = B_STONE, climb = 0, obj) => box((x, y, k) => {
  if (k < 2) return B_STONE;
  if (x >= 10) return k < 2 + h ? mat : B_AIR;
  if (climb && x === 9 && y === 0 && k < 2 + h) return climb;
  return B_AIR;
}, undefined, obj);
// базис руху: W (iy −1) — до стіни (+x), праворуч — +y (дзеркальна трійка камери: праворуч від того, хто дивиться в +x)
const TO_WALL = [[0, 1], [-1, 0]];
const climbGo = (p, P, n, ix, iy, ctl = {}, ph = PH1, jumpAt = -1) => go(p, P, n, ix, iy, ctl, ph, TO_WALL, jumpAt);

test('лазіння по стіні: лише стрибком у стіну; W — угору, нагорі вилазиш; витривалість витрачається', () => {
  const P = wallW(8);
  const a = climbGo(man(9.7, 0.5, 1), P, 60, 0, -1);
  assert.ok(!a.climb && a.ground, 'без стрибка — не чіпляєшся');
  const b = climbGo(man(9.7, 0.5, 1), P, 30, 0, -1, {}, PH1, 0);
  assert.ok(b.climb && b.climb.kind === 'wall' && Math.abs(b.climb.nx + 1) < 0.01, `стрибок у стіну: ${JSON.stringify(b.climb)}`);
  for (let n = 0; b.climb && n < 1200; n++) climbGo(b, P, 1, 0, -1);
  assert.ok(Math.abs(b.z - 5) < 0.06 && b.ground && !b.climb && b.x > 10.1 && b.stam > 0.3 && b.stam < 0.9, `нагорі: x ${b.x} z ${b.z} ${b.ground} витривалість ${b.stam}`);
  // при 3 g на стіні 40 блоків витривалість скінчиться до верху — зриваєшся й падаєш на землю
  const g3 = { ...PH1, g: 3 }, c = climbGo(man(9.7, 0.5, 1), wallW(40), 30, 0, -1, {}, g3, 0);
  assert.ok(c.climb, '3 g: зачепився');
  let top = 0;
  for (let i = 0; i < 2400 && (c.climb || !c.ground || i < 10); i++) { climbGo(c, wallW(40), 1, 0, -1, {}, g3); top = Math.max(top, c.z); }
  assert.ok(c.ground && !c.climb && top > 1.5 && top < 21 && c.z < 1.4, `3 g: найвище ${top}, тепер ${c.z}, витривалість ${c.stam}`);
});

test('лазіння: лід — сповзаєш; мокра стіна — повільніше; Ctrl — відпустити; круглу скелю обходиш по колу; по дереву — ні', () => {
  const d = climbGo(man(9.7, 0.5, 1), wallW(8, B_ICE), 30, 0, -1, {}, PH1, 0);
  const z0 = d.z;
  climbGo(d, wallW(8, B_ICE), 240, 0, -1);
  assert.ok(d.z <= z0 + 1e-9, `лід: ${z0} → ${d.z}`);
  const ph = { ...PH1, friction: 0.5 }, up = (wet) => { const p = climbGo(man(9.7, 0.5, 1), wallW(30), 30, 0, -1, {}, ph, 0); const z = p.z; climbGo(p, wallW(30), 240, 0, -1, { wet }, ph); return p.z - z; };
  const dry = up(false), wet = up(true);
  assert.ok(dry > 0.5 && wet < dry * 0.8, `мокра: ${wet} проти сухої ${dry}`);
  const e = climbGo(man(9.7, 0.5, 1), wallW(8), 30, 0, -1, {}, PH1, 0);
  climbGo(e, wallW(8), 60, 0, -1);
  climbGo(e, wallW(8), 1, 0, 0, { crouchPress: true });
  assert.ok(!e.climb, 'Ctrl — відпустив');
  climbGo(e, wallW(8), 120, 0, 0);
  const ref = climbGo(man(9.7, 0.5, 1), wallW(8), 60, 0, 0);
  assert.ok(e.ground && e.z < ref.z + 0.15, `упав: ${e.z} (стоячи біля стіни — ${ref.z})`);
  // кругла скеля (призма r 0,3, не дерево) у клітинці (10, 0): A — по колу, відстань від осі ~ R + r
  const col = (tree) => box((x, y, k) => k < 2 ? B_STONE : B_AIR, undefined, (x, y) => x === 10 && y === 0 ? { cx: 10.5, cy: 0.5, z0: 1, z1: 12, r: 0.3, tree } : null);
  const T = col(false);
  const f = climbGo(man(9.92, 0.5, 1), T, 30, 0, -1, {}, PH1, 0);
  assert.ok(f.climb, 'скеля: зачепився');
  // дерево — не чіпляєшся (12.10.2026, рішення користувача: лазіння по деревах прибрано)
  const tr = climbGo(man(9.92, 0.5, 1), col(true), 30, 0, -1, {}, PH1, 0);
  climbGo(tr, col(true), 120, 0, -1);
  assert.ok(!tr.climb && tr.z < 1.05, `дерево: ${tr.climb ? 'зачепився' : ''} z ${tr.z}`);
  let a = Math.atan2(f.y - 0.5, f.x - 10.5), turn = 0, dmin = 9, dmax = 0;
  for (let i = 0; i < 360; i++) {
    climbGo(f, T, 1, -1, 0);
    const dd = Math.hypot(f.x - 10.5, f.y - 0.5), b = Math.atan2(f.y - 0.5, f.x - 10.5);
    dmin = Math.min(dmin, dd); dmax = Math.max(dmax, dd);
    turn += Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); a = b;
  }
  assert.ok(f.climb && turn > Math.PI / 2 && dmin > FOOT + 0.25 && dmax < FOOT + 0.36, `скеля: поворот ${turn}, відстань ${dmin}…${dmax}`);
});

test('драбина й ліана: чіпляєшся, зайшовши; швидше за стіну, без витривалості; угорі вилазиш; не тверді, але в зіткненнях', async () => {
  const wall = (() => { const p = climbGo(man(9.7, 0.5, 1), wallW(8), 30, 0, -1, {}, PH1, 0); let n = 30; while (p.climb && n < 3000) { climbGo(p, wallW(8), 1, 0, -1); n++; } return n; })();
  for (const kind of [B_LADDER, B_VINE]) {
    const P = wallW(8, B_STONE, kind), p = man(9.4, 0.5, 1);
    climbGo(p, P, 2, 0, -1);
    assert.ok(p.climb && p.climb.kind === 'ladder', `${kind}: зачепився`);
    let n = 2;
    while (p.climb && n < 3000) { climbGo(p, P, 1, 0, -1); n++; }
    assert.ok(p.ground && Math.abs(p.z - 5) < 0.1 && p.x > 10.1 && p.stam === 1, `${kind}: нагорі ${p.x} ${p.z} ${p.stam}`);
    assert.ok(wall / n >= 1.8, `${kind}: швидше за стіну: ${n} кроків проти ${wall}`);
    // униз до підлоги — стоїш; назад від драбини (S) — ідеш
    const q = man(9.4, 0.5, 1);
    climbGo(q, P, 120, 0, -1); climbGo(q, P, 240, 0, 1);
    assert.ok(!q.climb && q.ground && Math.abs(q.z - 1) < 0.01, `${kind}: униз ${q.z}`);
    climbGo(q, P, 60, 0, 1);
    assert.ok(!q.climb && q.x < 9, `${kind}: від драбини ${q.x}`);
  }
  assert.equal(solidB(B_LADDER), false); assert.equal(solidB(B_VINE), false);
  const { colliderOf } = await import('../js/collision.js');
  const { createList, rayCast } = await import('../js/engine/physics/collide.js');
  const ray = (P, y) => { const L = colliderOf(P).gather(9, y - 0.1, 1.5, 10.5, y + 0.1, 2.5, createList()); const r = rayCast(L, 9.2, y, 2.1, 1, 0, 0, 2); return r ? 9.2 + r.t : null; };
  const lad = ray(wallW(8, B_STONE, B_LADDER), 0.8), bare = ray(wallW(8), 0.8);
  assert.ok(Math.abs(bare - 10) < 1e-6 && Math.abs(lad - 9.9) < 1e-3, `стійка: ${lad}, стіна ${bare}`);
});

// Басейн: дно — верх k = 1 (z 1), вода k 2…7 (поверхня 3,35); стіна x = 10 зі щілиною в 1 блок (k 3) на y −1…2
const pool = (wall = false) => box((x, y, k) => {
  if (k < 2) return B_STONE;
  if (wall && x === 10 && k < 8 && !(k === 3 && y >= -1 && y <= 2)) return B_STONE;
  return k < 8 ? B_LIQ : B_AIR;
});
const SURF = 4 - 0.15;

test('пірнання: Ctrl — униз, відпустив — спливаєш до рівня плавання; пробіл — угору; Shift — куди дивишся', () => {
  const P = pool(), p = man(5.5, 0.5, SURF - FLOAT_Z);
  go(p, P, 60, 0, 0);
  assert.ok(p.swim && Math.abs(p.z - (SURF - FLOAT_Z)) < 0.05, `на плаву: ${p.z}`);
  go(p, P, 120, 0, 0, { crouch: true, vert: -1 });
  assert.ok(p.z <= SURF - 1.0 && p.dive, `Ctrl: ${p.z}`);
  const z1 = p.z;
  go(p, P, 60, 0, 0, { vert: 1 });
  assert.ok(p.z > z1 + 0.5, `пробіл: ${z1} → ${p.z}`);
  go(p, P, 840, 0, 0);
  assert.ok(!p.dive && Math.abs(p.z - (SURF - FLOAT_Z)) < 0.05, `сплив: ${p.z} ${p.dive}`);
  // Shift + W з поглядом униз 45°: і вперед (+x), і вниз
  const q = man(3.5, 0.5, SURF - FLOAT_Z), L = [Math.SQRT1_2, 0, -Math.SQRT1_2];
  go(q, P, 30, 0, 0);
  const x0 = q.x, z0 = q.z;
  go(q, P, 120, 0, -1, { sprint: true, look: L }, PH1, TO_WALL);
  assert.ok(q.x - x0 > 1 && q.z - z0 < -0.5 && q.pose === 'swim', `Shift + W: Δx ${q.x - x0}, Δz ${q.z - z0}, ${q.pose}`);
});

test('плавання за поглядом: на поверхні до 30° униз — поверхнею, нижче — пірнаєш; під водою — за поглядом; відпустив — виштовхує', () => {
  const P = pool(), dir = (deg) => [Math.cos(deg * Math.PI / 180), 0, -Math.sin(deg * Math.PI / 180)], fz = SURF - FLOAT_Z;
  const p = man(-30.5, 0.5, fz);
  go(p, P, 60, 0, 0);
  const x0 = p.x;
  go(p, P, 120, 0, -1, { look: dir(20) }, PH1, TO_WALL);
  assert.ok(!p.dive && Math.abs(p.z - fz) < 0.05 && p.x - x0 > 1, `20° униз — поверхнею: ${p.z} ${p.dive} Δx ${p.x - x0}`);
  go(p, P, 120, 0, -1, { look: dir(45) }, PH1, TO_WALL);
  assert.ok(p.dive && p.z < fz - 0.5, `45° униз — пірнаєш: ${p.z}`);
  const z1 = p.z;
  go(p, P, 60, 0, -1, { look: dir(20) }, PH1, TO_WALL);
  assert.ok(p.z < z1 - 0.15, `під водою 20° униз — далі вниз: ${z1} → ${p.z}`);
  const z2 = p.z;
  go(p, P, 60, 0, -1, { look: dir(-30) }, PH1, TO_WALL);
  assert.ok(p.z > z2 + 0.2, `погляд угору — угору: ${z2} → ${p.z}`);
  go(p, P, 120, 0, -1, { look: dir(80) }, PH1, TO_WALL);
  const z3 = p.z;
  go(p, P, 1440, 0, 0);                                    // з дна (z 1) — 0,3 од/с
  assert.ok(!p.dive && Math.abs(p.z - fz) < 0.05 && z3 < fz - 1, `відпустив — виштовхує: ${z3} → ${p.z} ${p.dive}`);
});

test('під водою щілину в 1 блок пропливаєш бігом (поза плавання), без бігу — ні', () => {
  const P = pool(true), L = [1, 0, 0];
  const s = man(7.5, 0.5, 1.56);
  s.dive = true;
  go(s, P, 360, 0, -1, (i) => ({ sprint: true, look: L, vert: 0 }), PH1, TO_WALL);
  assert.ok(s.x > 11.5 && free(P, s), `бігом: ${s.x} ${s.z} ${s.pose}`);
  const t = man(7.5, 0.5, 1.56);
  go(t, P, 360, 0, -1, { crouch: true }, PH1, TO_WALL);
  assert.ok(t.x < 10, `без бігу: ${t.x}`);
});

test('політ: Ctrl — униз, пробіл — угору, Shift — по горизонталі швидше (FLY_FAST)', () => {
  const F = box((x, y, k) => k < 2 ? B_STONE : B_AIR), p = man(0.5, 0.5, 10);
  p.fly = true; p.ground = false;
  go(p, F, 60, 0, 0, { vert: -1, crouch: true });
  assert.ok(p.z < 10 - 3.9 && p.fly, `Ctrl: ${p.z}`);
  go(p, F, 60, 0, 0, { vert: 1 });
  assert.ok(p.z > 9.9, `пробіл: ${p.z}`);
  const a = p.x; go(p, F, 20, 1, 0);                 // 1/6 с: карта ±40, а політ — до 120 клітинок/с
  const b = p.x; go(p, F, 20, 1, 0, { sprint: true });
  assert.ok(Math.abs((p.x - b) / (b - a) - FLY_FAST / FLY_SPEED) < 0.04 && Math.abs(b - a - FLY_SPEED * 20 * DT) < 0.01, `Shift: ${b - a} → ${p.x - b}`);
});

test('фігура: голова — за поглядом; присів — ступні на землі й нижче; лежить — горизонтально над капсулою; на стіні — обличчям до неї', async () => {
  const { animate, poseMatrices } = await import('../js/anim.js');
  const { figureParts } = await import('../js/gen/mesh.js');
  const F = figureParts([200, 80, 60]);
  const pts = (me, part) => {
    let a; for (let i = 0; i < 200; i++) a = animate(me, 1 / 60, i * 16);
    const M = poseMatrices(a, 0, 0, 0, me.yaw || 0)[part], P = F[part].pos, out = [];
    for (let i = 0; i < P.length; i += 3) out.push([M[0] * P[i] + M[4] * P[i + 1] + M[8] * P[i + 2] + M[12], M[1] * P[i] + M[5] * P[i + 1] + M[9] * P[i + 2] + M[13], M[2] * P[i] + M[6] * P[i + 1] + M[10] * P[i + 2] + M[14]]);
    return out;
  };
  const all = (me) => Object.keys(F).flatMap((k) => pts(me, k));
  // голова з поглядом униз на 0,5: вісь погляду (+x голови) нахилена на 0,5 униз
  const { poseMatrices: pm } = await import('../js/anim.js');
  const me1 = { pose: 'stand', look: { p: 0.5, y: 0 } };
  let a1; for (let i = 0; i < 200; i++) a1 = animate(me1, 1 / 60, i * 16);
  const H = pm(a1, 0, 0, 0, 0).head, tilt = Math.atan2(-H[2], H[0]);
  assert.ok(Math.abs(tilt - 0.5) < 0.01, `голова: ${tilt}`);
  // присів: низ гомілок на землі, верх ≤ 0,74
  const cr = { pose: 'crouch' }, shins = [...pts(cr, 'shinL'), ...pts(cr, 'shinR')], zc = all(cr).map((p) => p[2]);
  const lowS = Math.min(...shins.map((p) => p[2]));
  assert.ok(lowS > -0.02 && lowS < 0.03 && Math.max(...zc) <= 0.74, `присів: низ ${lowS}, верх ${Math.max(...zc)}`);
  // лежить: верх ≤ 0,45, середнє x — біля центру капсули
  const ly = all({ pose: 'crawl' }), mx = ly.reduce((s, p) => s + p[0], 0) / ly.length;
  assert.ok(Math.max(...ly.map((p) => p[2])) <= 0.45 && Math.abs(mx) < 0.2, `лежить: верх ${Math.max(...ly.map((p) => p[2]))}, x ${mx}`);
  // стіна з нормаллю −x (стіна з боку +x): yaw = atan2(−ny, −nx) = 0 — обличчя (+x голови) до стіни
  const wl = { pose: 'stand', climb: { kind: 'wall', nx: -1, ny: 0 }, yaw: 0, moving: true, climbD: 1 }, Hd = pts(wl, 'head');
  const face = Math.max(...Hd.map((p) => p[0])), back = Math.min(...Hd.map((p) => p[0]));
  assert.ok(face > 0.1 && back < 0, `стіна: обличчя ${face}`);
});
