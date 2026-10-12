// Ізометрія, рух гравця, пристрій для стрибків, формат файлу збереження.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toScreen, fromScreen, pick, LEVEL } from '../js/iso.js';
import { step, hits, support, standable, settle, SPEED, PH1, GRAVITY, JUMP_V, FLOAT_Z, jumpHeight, SPRINT, FLY_SPEED, FLY_V, shapeOf } from '../js/player.js';
import { landing, landingChunks, createDevice, CHARGE, HISTORY } from '../js/device.js';
import { serialize, deserialize } from '../js/save.js';
import { B_AIR, B_LIQ, B_GRASS, B_STONE } from '../js/gen/chunk.js';

// Світ з рядків: символ — стовпець. Цифра або буква a…z — висота суходолу в блоках (0…35; 'T' — висота 2 з деревом,
// 'R' — висота 2 з каменем 0,4 заввишки); 'w' — водойма: дно на 2, рідина до 6 (тримає чи ні — liquid);
// мапа продовжується крайніми стовпцями ще на PAD клітинок (поверхня видима — плавна: біля краю, де стіна, вона скошена),
// далі — не згенеровано (−1)
const SEA = 6, PAD = 4;
function world(rows, liquid = { swim: true, danger: '', density: 1 }) {
  const hOf = (ch) => ch === 'T' || ch === 'R' ? 2 : /[0-9]/.test(ch) ? +ch : ch.charCodeAt(0) - 87;
  const cl = (v, n) => v < 0 ? 0 : v >= n ? n - 1 : v;
  const chAt = (x, y) => {
    if (y < -PAD || y >= rows.length + PAD) return undefined;
    const r = rows[cl(y, rows.length)];
    if (x < -PAD || x >= r.length + PAD) return undefined;
    const ch = r[cl(x, r.length)];
    return (x < 0 || y < 0 || x >= r.length || y >= rows.length) && (ch === 'T' || ch === 'R') ? '2' : ch;
  };
  return {
    liquid,
    block(x, y, k) {
      const ch = chAt(x, y);
      if (ch === undefined) return -1;
      if (k < 0) return B_STONE;
      if (ch === 'w') return k < 2 ? B_STONE : k < SEA ? B_LIQ : B_AIR;
      return k < hOf(ch) ? B_GRASS : B_AIR;
    },
    obj: (x, y) => {
      const ch = chAt(x, y);
      return ch === 'T' ? { cx: x + 0.5, cy: y + 0.5, z0: LEVEL * 2, z1: LEVEL * 2 + 2, r: 0.18 }
        : ch === 'R' ? { cx: x + 0.5, cy: y + 0.5, z0: LEVEL * 2, z1: LEVEL * 2 + 0.4, r: 0.4 } : null;
    },
  };
}
const at = (P, x, y) => { let k = 40; while (k > 0 && P.block(Math.floor(x), Math.floor(y), k - 1) === B_AIR) k--; return k * LEVEL; };
const man = (P, x, y) => ({ x, y, z: at(P, x, y), vz: 0, ground: true });
const run = (p, ix, iy, n, P, ph, jump = false, mb) => { for (let i = 0; i < n; i++) step(p, ix, iy, jump && i === 0, 1 / 60, P, ph, mb); };

test('ізометрія: ромб 2:1, екран ↔ площина туди й назад', () => {
  const [ax, ay] = toScreen(1, 0, 0), [bx, by] = toScreen(0, 1, 0);
  assert.ok(Math.abs(ax - 32) < 1e-9 && Math.abs(ay - 16) < 1e-9);     // +x — униз-праворуч
  assert.ok(Math.abs(bx + 32) < 1e-9 && Math.abs(by - 16) < 1e-9);     // +y — униз-ліворуч
  for (const [x, y, z] of [[3.2, -7.5, 1], [0, 0, 0], [-12.25, 4, 3.5]]) {
    const [sx, sy] = toScreen(x, y, z), [rx, ry] = fromScreen(sx, sy, z);
    assert.ok(Math.abs(rx - x) < 1e-9 && Math.abs(ry - y) < 1e-9);
  }
});

test('вибір клітинки: на рівнині — та, що під курсором; вежа попереду закриває ту, що позаду', () => {
  const H = new Map([['5,5', 6]]);
  const heightAt = (x, y) => H.get(`${x},${y}`) ?? 0;
  const cam = [0, 0, 0];
  for (const [x, y] of [[2, 3], [-4, 1], [0, 0]]) {
    const [sx, sy] = toScreen(x + 0.5, y + 0.5, 0);
    assert.deepEqual(pick(sx, sy, cam, heightAt, 10), [x, y]);
  }
  // клітинка (4, 4) прямо за вежею (5, 5): точка її поверхні на екрані припадає на бік вежі
  const [sx, sy] = toScreen(4.5, 4.5, 0);
  assert.deepEqual(pick(sx, sy, cam, heightAt, 10), [5, 5]);
  // верх вежі
  const [tx, ty] = toScreen(5.5, 5.5, 6 * LEVEL);
  assert.deepEqual(pick(tx, ty, cam, heightAt, 10), [5, 5]);
});

test('рух: «праворуч» на екрані — уздовж (1, −1) світу, швидкість SPEED', () => {
  const P = world(Array(20).fill('4'.repeat(20))), p = man(P, 10.5, 10.5);
  run(p, 1, 0, 30, P);
  const d = SPEED * 0.5 * Math.SQRT1_2;
  assert.ok(Math.abs(p.x - (10.5 + d)) < 1e-9 && Math.abs(p.y - (10.5 - d)) < 1e-9 && p.ground);
});

test('рух: на уступ в 1 блок — сам (на вигляд схил), на 2 — ні; з обриву будь-якої висоти — падаєш', () => {
  const X = [[1, 0], [0, 1]], P = world(Array(9).fill('4444445566666666'));
  const p = man(P, 2.5, 4.5);
  run(p, 1, 0, 150, P, PH1, false, X);                      // 4 → 5 → 6: схили, без кроку
  assert.ok(p.x > 12 && p.z === 6 * LEVEL && p.ground, `на уступи: ${p.x} ${p.z}`);
  const W = world(Array(9).fill('4444446666666666')), w = man(W, 2.5, 4.5);
  run(w, 1, 0, 150, W, PH1, false, X);                      // 4 → 6 — схил 56°: не вийти
  assert.ok(w.x < 6 && w.z < 5 * LEVEL && w.ground, `стіна: ${w.x} ${w.z}`);
  const C = world(Array(9).fill('4444444400000000')), q = man(C, 2.5, 4.5);
  run(q, 1, 0, 150, C, PH1, false, X);                      // 4 → 0 (униз на 4) — падає
  assert.ok(q.x > 9 && q.z === 0 && q.ground, `з обриву: ${q.x} ${q.z}`);
  assert.equal(hits(P, 40, 40, 0), true);                   // незгенероване — стіна
});

test('каміння: вище пів блоку — перешкода, на яку стаєш (крок чи стрибок); дерево — крізь не пройти', () => {
  const P = world(['22222', '22R22', '22222']);
  assert.equal(hits(P, 2.5, 1.5, LEVEL * 2), true);
  assert.equal(support(P, 2.5, 1.5, LEVEL * 2 + 0.5).z, LEVEL * 2 + 0.4);     // верх каменя — опора
  const p = man(P, 0.5, 1.5);
  run(p, 1, 0, 30, P, PH1, false, [[1, 0], [0, 1]]);
  assert.ok(p.x > 2 && Math.abs(p.z - (LEVEL * 2 + 0.4)) < 1e-9, `на камінь: ${p.x} ${p.z}`);
});

test('рух: між двома деревами по діагоналі можна пройти, крізь дерево — ні', () => {
  const P = world(['22222', '22T22', '222T2', '22222']);
  assert.equal(hits(P, 2.5, 1.5, LEVEL * 2), true);
  assert.equal(hits(P, 2.95, 1.05, LEVEL * 2), false);
  const p = man(P, 1.5, 2.5);
  run(p, 1, 0, 120, P);
  assert.ok(p.x > 3.2 && p.y < 0.8, `застряг у (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
});

test('печера (гравець 1,8 м): широка (3 клітинки) заввишки 4 рівні (2 м) — проходиш; 3 рівні — ні; вузька (1 клітинка) у 4 рівні (видимо 1,75) — ні (лише присівши, п. 3)', () => {
  // зала x < 3 (6 рівнів заввишки), далі хід: y — ws…we, заввишки hc рівнів, з x ≥ 7 — lo рівнів; підлога — верх k = 1
  const cave = (ws, we, hc, lo) => ({
    liquid: { swim: true }, obj: () => null,
    block(x, y, k) {
      if (x < -6 || x > 20 || y < -6 || y > 8) return -1;
      if (k < 2) return B_STONE;
      if (x < 3) return y >= -3 && y <= 5 && k < 8 ? B_AIR : B_STONE;
      return y >= ws && y <= we && k < 2 + (x >= 7 ? lo : hc) ? B_AIR : B_STONE;
    },
  });
  const go = (P) => { const p = { x: 1.5, y: 1.5, z: 2 * LEVEL, vz: 0, ground: true }; run(p, 1, 0, 200, P, PH1, false, [[1, 0], [0, 1]]); return p; };
  const a = go(cave(0, 2, 4, 4)), b = go(cave(0, 2, 4, 3)), c = go(cave(1, 1, 4, 4));
  assert.ok(a.x > 10 && a.z === 2 * LEVEL, `широка: ${a.x} ${a.z}`);
  assert.ok(b.x > 5.6 && b.x < 7.3 && b.z === 2 * LEVEL, `3 рівні: ${b.x} ${b.z}`);
  assert.ok(c.x < 4.5, `вузька: ${c.x}`);
});

test('легка гравітація: пішки на 2 блоки; приземлення шукає місце з виходом', () => {
  const light = { up: 2, speed: 1, settle: 8, g: 0.5 }, X = [[1, 0], [0, 1]];
  const P = world(Array(9).fill('4444446666888888'));
  const p = man(P, 2.5, 4.5), q = man(P, 2.5, 4.5);
  run(p, 1, 0, 150, P, PH1, false, X);                      // при 1 g: 4 → 6 (схил 56°) — ні
  run(q, 1, 0, 150, P, light, false, X);                    // при 0,5 g — так, і далі 6 → 8
  assert.ok(p.x < 6 && q.x > 12 && q.z === 8 * LEVEL, `${p.x} ${q.x} ${q.z}`);
  const pit = world(['77777', '77777', '77077', '77777', '77777']);   // яма 7 блоків: з неї не вилізти
  assert.notEqual(landing(pit, 2.5, 2.5, 0, PH1).join(), '2.5,2.5,0');
});

test('стрибок: висота й час у повітрі від гравітації; на уступ, з якого пішки не вилізти', () => {
  assert.ok(jumpHeight(1) > 2 * LEVEL && jumpHeight(1) < 3 * LEVEL);
  assert.ok(jumpHeight(2) < 2 * LEVEL && jumpHeight(0.5) > 4 * LEVEL);
  const air = (g) => {
    const P = world(Array(9).fill('4'.repeat(9))), p = man(P, 4.5, 4.5), z0 = p.z, ph = { ...PH1, g };
    step(p, 0, 0, true, 1 / 240, P, ph);
    let t = 1 / 240, top = 0;
    while (!p.ground && t < 5) { step(p, 0, 0, false, 1 / 240, P, ph); t += 1 / 240; top = Math.max(top, p.z - z0); }
    return [t, top];
  };
  const [t1, h1] = air(1), [t5, h5] = air(0.5);
  assert.ok(Math.abs(h1 - jumpHeight(1)) < 0.05 && Math.abs(t1 - 2 * JUMP_V / GRAVITY) < 0.03, `${t1} ${h1}`);
  assert.ok(t5 > 1.9 * t1 && h5 > 1.9 * h1);
  const P = world(Array(9).fill('4444466666666666')), X = [[1, 0], [0, 1]];
  const p = man(P, 2.5, 4.5);
  run(p, 1, 0, 120, P, PH1, false, X);
  assert.ok(p.x < 5 && p.ground, `пішки: ${p.x}`);
  // у повітрі не керуєш (як у житті): стрибок з розбігу за ~1,4 клітинки до уступу
  const j = man(P, 3.4, 4.5);
  run(j, 1, 0, 120, P, PH1, true, X);
  assert.ok(j.x > 6 && j.z === 6 * LEVEL && j.ground, `стрибок: ${j.x} ${j.z}`);
});

test('падіння: зі стрибка — з будь-якої висоти; приземлення на опору', () => {
  const P = world(Array(9).fill('88888000000'));
  const p = man(P, 3.5, 4.5);
  run(p, 1, 0, 120, P, PH1, true, [[1, 0], [0, 1]]);
  assert.ok(p.x > 6 && p.z === 0 && p.ground, `${p.x} ${p.z}`);
  assert.equal(support(P, 8.5, 4.5, 4).z, 0);
});

test('приземлення: на місці, якщо можна; інакше найближче з виходом; ніде стати — у рідині чи в повітрі, але завжди', () => {
  const P = world(['44444', '4www4', '4www4', '4www4', '44444'], { swim: true, danger: '1100 °C', density: 2.8 });
  // місце шукається по блоках, потім ноги — на видиму поверхню (біля води берег скошений)
  const near = (a, b) => a[0] === b[0] && a[1] === b[1] && Math.abs(a[2] - b[2]) <= 0.3 && standable(P, ...a);
  const l1 = landing(P, -1.5, 0.5, 2), l2 = landing(P, 2.5, 2.5, 2);
  assert.ok(near(l1, [-1.5, 0.5, 2]), `на місці: ${l1}`);
  assert.ok(near(l2, [2.5, 0.5, 2]), `у рідині — найближче на березі: ${l2}`);
  const sea = world(Array(30).fill('w'.repeat(30)));
  const at = landing(sea, 15.2, 15.7, 2.5);
  assert.ok(at[0] === 15.2 && at[1] === 15.7 && !hits(sea, ...at), `у морі: ${at}`);    // пливе там само
  const rock = world(Array(30).fill('z'.repeat(30)));                          // суцільна скеля вище за ноги
  const up = landing(rock, 15.5, 15.5, 1);
  assert.ok(up && !hits(rock, ...up) && up[2] >= 35 * LEVEL, `у скелі: ${up}`);
  assert.ok(landingChunks(0, 0, 16).length >= 4);
});

test('пристрій: заряджання, скасування повторним натисканням, історія', () => {
  const dev = createDevice([[0, 1]]);
  assert.equal(dev.start([0, 2], 'next'), 'start');
  assert.equal(dev.update(CHARGE / 2), false);
  assert.equal(dev.start([0, 2], 'next'), 'cancel');
  assert.equal(dev.charge, null);
  dev.start([0, 0], 'prev');
  assert.equal(dev.start([3, 77], 'random'), 'start');                         // інша кнопка — новий заряд
  assert.deepEqual(dev.charge.to, [3, 77]);
  assert.equal(dev.update(CHARGE), true);
  dev.done([0, 0]);
  assert.equal(dev.charge, null);
  assert.deepEqual(dev.history, [[0, 1], [0, 0]]);
  for (let i = 0; i < HISTORY + 10; i++) dev.done([0, i]);
  assert.equal(dev.history.length, HISTORY);
});

test('файл збереження: туди й назад, перевірка пошкоджених', () => {
  const w = { id: 'a1', name: 'Світ «x»', seedText: 'x', seed: 123, gen: 1, created: 1, played: 2, player: { d: 0, n: -3, x: 1.5, y: -2.25 }, history: [[0, -2]] };
  assert.deepEqual(deserialize(serialize(w)).world, w);
  assert.throws(() => deserialize('{'), /не JSON/);
  assert.throws(() => deserialize('{"format":"інше"}'), /не збереження/);
  assert.throws(() => deserialize(JSON.stringify({ format: 'echoverse', v: 99, world: w })), /новішої/);
  assert.throws(() => deserialize(JSON.stringify({ format: 'echoverse', v: 1, world: { ...w, seed: -1 } })), /пошкоджене/);
  assert.throws(() => deserialize(JSON.stringify({ format: 'echoverse', v: 1, world: { ...w, player: { d: 0, n: 0, x: 'a', y: 0 } } })), /пошкоджене/);
});

test('камера: ізометрія з азимутом 45° збігається з toScreen; базис руху; третя особа дивиться на ціль', async () => {
  const { createCamera, viewProj, project, moveBasis, chunksInView, ISO, THIRD } = await import('../js/camera.js');
  const c = createCamera(ISO);
  c.zoom = 1; c.yaw = Math.PI / 4; c.pitch = Math.PI / 6;
  const W = 1600, H = 900, { m } = viewProj(c, W, H);
  for (const p of [[3, -2, 1], [0, 0, 0], [-7.5, 4, 2.5]]) {
    const [sx, sy] = project(m, p, W, H), [ex, ey] = toScreen(p[0], p[1], p[2]);
    assert.ok(Math.abs(sx - W / 2 - ex) < 1e-3 && Math.abs(sy - H / 2 - ey) < 1e-3, `${p}: ${sx - W / 2},${sy - H / 2} ≠ ${ex},${ey}`);
  }
  const [r, d] = moveBasis(c);
  assert.ok(Math.abs(r[0] - Math.SQRT1_2) < 1e-12 && Math.abs(r[1] + Math.SQRT1_2) < 1e-12 && Math.abs(d[0] - d[1]) < 1e-12);
  const t = createCamera(THIRD), v = viewProj(t, W, H, 6);
  const at = project(v.m, [0, 0, 0], W, H);
  assert.ok(Math.abs(at[0] - W / 2) < 1e-6 && Math.abs(at[1] - H / 2) < 1e-6);   // ціль — у центрі екрана
  assert.equal(project(v.m, [v.eye[0] * 2, v.eye[1] * 2, v.eye[2] * 2], W, H), null);  // за камерою — не видно
  const list = chunksInView(v.m, [0, 0, 0], 112, [0, 15]);
  assert.ok(list.length > 10 && list.length < 200 && list[0].dist2 <= list[list.length - 1].dist2);
});

test('текстури: усі шари, шар 0 нейтральний, різні всесвіти — різні візерунки', async () => {
  const { texturesOf, TEX } = await import('../js/textures.js');
  const { lawsOf } = await import('../js/universe.js');
  const { LAYERS } = await import('../js/gen/materials.js');
  const a = texturesOf(lawsOf(1, 0, 0)), b = texturesOf(lawsOf(1, 2, 300));
  assert.equal(a.length, LAYERS * TEX * TEX * 4);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += a[i] !== b[i];
  assert.ok(diff > a.length * 0.2);
  for (let i = 0; i < TEX * TEX * 4; i += 4) assert.equal(a[i], 128);   // шар 0 — нейтральний
});

test('плавання: з берега у воду й назад, у воді повільніше; з поверхні — вистрибнути; у небезпечну рідину — можна', () => {
  const rows = [...Array(3).fill('7'.repeat(24)), ...Array(4).fill('7777wwww' + '7'.repeat(16)), ...Array(3).fill('7'.repeat(24))];
  const P = world(rows), H = world(rows, { swim: true, danger: '1100 °C', density: 2.8 }), M = world(rows, { swim: false, danger: 'тонеш', density: 0.42 });
  const p = man(P, 2.5, 5);
  run(p, 1, 1, 40, P);                                      // +x: з берега (7) у воду
  run(p, 0, 0, 90, P);
  const surf = SEA * LEVEL - 0.15;
  assert.ok(p.swim && p.wet && Math.abs(p.z - (surf - FLOAT_Z)) < 0.03, `пливе? ${p.swim} z ${p.z}`);
  const x0 = p.x;
  step(p, 1, 1, false, 1 / 60, P);
  assert.ok(p.x - x0 < SPEED * 0.6 * Math.SQRT2 / 60, 'у воді не повільніше');
  step(p, 0, 0, true, 1 / 60, P);
  assert.ok(p.vz > JUMP_V * 0.7, `з води не вистрибнув: ${p.vz}`);
  run(p, 0, 0, 120, P);
  run(p, 1, 1, 120, P);                                     // далі — на берег (7 блоків)
  assert.ok(p.x > 9 && p.z === 7 * LEVEL && p.ground, `вийшов? ${p.x} ${p.z}`);
  const q = man(H, 2.5, 5);
  run(q, 1, 1, 60, H);                                      // у лаву — можна (густа: тримає вище)
  run(q, 0, 0, 90, H);
  assert.ok(q.x > 4.3 && q.swim && q.z > surf - FLOAT_Z + 0.2, `у лаву: ${q.x} ${q.z}`);
  const m = man(M, 2.5, 5);
  run(m, 1, 1, 40, M);                                      // метан не тримає: на дно
  run(m, 0, 0, 120, M);
  assert.ok(m.wet && !m.swim && m.ground && m.z === 2 * LEVEL, `у метані: ${m.x} ${m.z}`);
  run(m, 1, 1, 200, M);                                     // по дну — і на берег (з дна 5 блоків угору: до 2 над поверхнею)
  assert.ok(m.x > 9 && m.z === 7 * LEVEL, `з метану: ${m.x} ${m.z}`);
});

test('з води на берег: мілко (1 блок) — на 2 блоки над поверхнею виходиш кроком', () => {
  const P = world([...Array(3).fill('8'.repeat(16)), ...Array(4).fill('wwww' + '8'.repeat(12)), ...Array(3).fill('8'.repeat(16))], { swim: true, danger: '', density: 1 });
  const p = { x: 1.5, y: 5, z: 2 * LEVEL, vz: 0, ground: true };
  run(p, 0, 0, 30, P);
  run(p, 1, 0, 120, P, PH1, false, [[1, 0], [0, 1]]);
  assert.ok(p.x > 6 && p.z === 8 * LEVEL, `не вийшов: ${p.x} ${p.z}`);
});

test('біг і політ: Shift — швидше; у польоті без гравітації, крізь стіну — ні, униз до землі — політ скінчився', () => {
  const P = world(Array(20).fill('4'.repeat(20))), a = man(P, 3.5, 10.5), b = man(P, 3.5, 10.5);
  for (let i = 0; i < 30; i++) { step(a, 0, -1, false, 1 / 60, P, PH1); step(b, 0, -1, false, 1 / 60, P, PH1, undefined, { sprint: true }); }
  const da = Math.hypot(a.x - 3.5, a.y - 10.5), db = Math.hypot(b.x - 3.5, b.y - 10.5);
  assert.ok(Math.abs(db / da - SPRINT) < 0.02, `біг ×${db / da}`);
  // політ: угору, зависає, летить швидко
  const p = man(P, 10.5, 10.5), z0 = p.z;
  p.fly = true;
  for (let i = 0; i < 30; i++) step(p, 0, 0, false, 1 / 60, P, PH1, undefined, { vert: 1 });
  assert.ok(Math.abs(p.z - z0 - FLY_V * 0.5) < 1e-6 && p.fly && p.air);
  const zh = p.z;
  for (let i = 0; i < 60; i++) step(p, 0, 0, false, 1 / 60, P, PH1);
  assert.equal(p.z, zh);                                   // без гравітації
  const x0 = p.x, y0 = p.y;
  for (let i = 0; i < 10; i++) step(p, 1, 0, false, 1 / 60, P, PH1);   // 1/6 с: карта 20 клітинок
  assert.ok(Math.abs(Math.hypot(p.x - x0, p.y - y0) - FLY_SPEED / 6) < 1e-6);
  for (let i = 0; i < 120; i++) step(p, 0, 0, false, 1 / 60, P, PH1, undefined, { vert: -1 });
  assert.ok(!p.fly && p.ground && Math.abs(p.z - z0) < 1e-9);
  // у стіну не влетиш
  const W = world(Array(9).fill('4444f4444')), q = man(W, 0.5, 4.5);
  q.fly = true;
  for (let i = 0; i < 60; i++) step(q, 1, 0, false, 1 / 60, W, PH1, [[1, 0], [0, 1]]);
  assert.ok(q.x > 3.5 && q.x < 4 - 0.24 + 1e-6, `влетів у стіну: x ${q.x}`);
});

test('небо й час: біля старту — одне сонце, місяць, доба ~20 хв; далі — кілька сонць, кільця, вічний день; полудень світліший', async () => {
  const { lawsOf } = await import('../js/universe.js');
  const { skyState, dayPhase, clockStr } = await import('../js/sky.js');
  const { hashStr } = await import('../js/rng.js');
  const seed = hashStr('небо');
  let multi = 0, rings = 0, lock = 0, noMoon = 0;
  for (let n = -1500; n <= 1500; n++) {
    const S = lawsOf(seed, 0, n).sky;
    assert.ok(S.suns.length >= 1 && S.suns.length <= 3 && S.moons.length <= 3 && S.dayMin >= 2 && S.dayMin <= 240 && S.night > 0.1);
    if (Math.abs(n) <= 8) assert.ok(S.suns.length === 1 && S.moons.length === 1 && !S.lock && !S.rings && S.dayMin >= 16 && S.dayMin <= 24, `біля старту ${n}`);
    multi += S.suns.length > 1; rings += !!S.rings; lock += S.lock; noMoon += !S.moons.length;
  }
  assert.ok(multi > 100 && rings > 100 && lock > 10 && noMoon > 50, `сонць ${multi}, кілець ${rings}, вічних ${lock}, без місяця ${noMoon}`);
  const L = lawsOf(seed, 0, 0), day = L.sky.dayMin * 60, at = (ph) => ((ph - L.sky.off + 1) % 1) * day;
  assert.ok(Math.abs(dayPhase(L, at(0.5)) - 0.5) < 1e-9 && clockStr(0.5) === '12:00' && clockStr(0.25) === '06:00');
  const noon = skyState(L, at(0.5)), night = skyState(L, at(0));
  assert.ok(noon.day > 0.95 && night.day < 0.05 && noon.lightK[1] > night.lightK[1] * 2 && night.lightK[1] > 0.05, 'ніч не темрява, день світліший');
  assert.ok(noon.suns[0].dir[2] > 0.3 && night.suns[0].dir[2] < -0.3 && noon.light[2] >= 0.25 && night.light[2] >= 0.25);
  assert.ok(night.stars > noon.stars && noon.horizon[2] > night.horizon[2]);
  assert.ok(skyState(L, at(0.25)).dusk > 0.5, 'на світанку — захід (світіння обрію)');
  // збереження годинника
  const w = { id: 'a', name: 'x', seedText: 'x', seed: 1, gen: 6, created: 1, played: 1, player: { d: 0, n: 0, x: 0, y: 0 }, history: [], clock: 1234.5 };
  assert.equal(deserialize(serialize(w)).world.clock, 1234.5);
});

test('світла неба: головне (з тінню) — найяскравіше; сонце, що показалось над обрієм на 1 %, яскравіше за місяць; серп слабший за повню; захід без провалу й стрибка яскравості', async () => {
  const { lightsOf, aboveHorizon } = await import('../js/sky.js');
  const n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const r = 0.04, zOf = (f) => { let lo = -1, hi = 1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (aboveHorizon(Math.sin(m * r), r) < f) lo = m; else hi = m; } return Math.sin(lo * r); };
  assert.ok(Math.abs(aboveHorizon(0, r) - 0.5) < 1e-9 && aboveHorizon(-0.1, r) === 0 && aboveHorizon(0.1, r) === 1);
  const sky = (sunZ, moonDir) => {
    const sun = { dir: n([Math.sqrt(1 - sunZ * sunZ), 0, sunZ]), col: [255, 240, 200], size: r, bright: 1 };
    const t = Math.max(0, Math.min(1, (sunZ + 0.1) / 0.32)), day = t * t * (3 - 2 * t);   // як skyState: доба й рівень світла
    return { suns: [sun], moons: [{ dir: n(moonDir), col: [200, 200, 200], size: 0.08 }], main: sun, duskCol: [255, 140, 60], lock: false, I: 0.24 + 0.76 * day, amb: 0.3, day };
  };
  const full = [-0.3, 0, 0.95];                                     // високо, майже навпроти сонця — повня
  let L = lightsOf(sky(zOf(0.01), full), 3).dirs;
  assert.ok(L[0].dir[0] > 0.9, 'сонце на 1 % над обрієм — головне'); assert.ok(L.every((l, i) => !i || l.k < L[0].k * 0.01), 'поки сонце видно, місяць прямо не світить');
  L = lightsOf(sky(-0.05, full), 3).dirs;
  assert.equal(L.length, 1); assert.ok(L[0].dir[2] > 0.9, 'сонце під обрієм — головний місяць');
  const bFull = L[0].b, bNew = lightsOf(sky(-0.05, [0.95, 0, 0.3]), 3).dirs[0].b;   // за 17° від сонця — вузький серп
  assert.ok(bNew < bFull * 0.05, 'серп світить у десятки разів слабше за повню');
  // захід без провалу й стрибка: верх (освітлений і в тіні) змінюється плавно; освітлений не світлішає, поки сонце сідає
  for (const moon of [full, [0.3, 0, -0.5]]) {
    let pl = null, ps = null;
    for (let z = 0.4; z >= -0.2; z -= 0.002) {
      const o = lightsOf(sky(z, moon), 3), lit = o.amb + o.dirs.reduce((s, l) => s + l.k * Math.max(0, l.dir[2]), 0), sh = o.amb;
      if (pl !== null) {
        assert.ok(Math.abs(lit - pl) < 0.012 && Math.abs(sh - ps) < 0.012, `стрибок яскравості на z = ${z.toFixed(3)}`);
        if (moon !== full && z > -0.05) assert.ok(lit <= pl + 1e-9, `освітлене світлішає на z = ${z.toFixed(3)}`);
      }
      pl = lit; ps = sh;
    }
  }
});

test('атмосфера й погода: біля старту — придатне повітря ~1 атм; трапляються інші; погода детермінована й змінюється; місце уточнює', async () => {
  const { lawsOf } = await import('../js/universe.js');
  const { weatherAt, localWeather, W_STORM } = await import('../js/weather.js');
  const { skyState, applyWeather } = await import('../js/sky.js');
  const { hashStr } = await import('../js/rng.js');
  const seed = hashStr('повітря'), gases = new Set();
  let vac = 0;
  for (const d of [0, 3]) for (let n = -1000; n <= 1000; n++) {
    const A = lawsOf(seed, d, n).air;
    if (d === 0 && Math.abs(n) <= 8) assert.ok(A.breath && A.pressure > 0.8 && A.pressure < 1.2 && A.rad < 0.1, `біля старту ${n}`);
    assert.ok(A.pressure > 0 && A.pressure <= 10 && A.rad >= 0 && A.rad <= 1 && A.haze >= 0 && A.haze <= 1);
    gases.add(A.gas); vac += A.pressure < 0.1;
  }
  for (let n = 1001; !vac && n < 200000; n += 3) vac += lawsOf(seed, 3, n).air.pressure < 0.1;   // без повітря — рідкість
  assert.ok(gases.size >= 4 && vac > 0, `видів повітря ${gases.size}, без повітря ${vac}`);
  const L = lawsOf(seed, 0, 0), kinds = new Set();
  for (let t = 0; t < 3600 * 10; t += 20) { const W = weatherAt(L, t); kinds.add(W.kind); assert.deepEqual(weatherAt(L, t), W); }
  assert.ok(kinds.size >= 3, `погод лише ${kinds.size}`);
  const W = { kind: 2, clouds: 0.85, vis: 0.7, precip: 0.7, dust: 0, dim: 0.3, wind: [1, 0], windK: 1, flash: 0 };
  assert.equal(localWeather(L, W, false, false).type, L.air.acid ? 'acid' : 'rain');
  assert.equal(localWeather(L, W, true, false).type, 'snow');
  assert.equal(localWeather(L, W, false, true).type, null);                     // у пустелі дощ не долітає
  const D = { ...W, kind: 5, precip: 0, dust: 1 };
  assert.equal(localWeather(L, D, false, false, true).type, 'dust');
  assert.equal(localWeather(L, D, false, false, false).type, null);              // пилова буря — лише в сухому
  // без повітря — чорне небо із зорями вдень
  const st = skyState(L, (0.5 - L.sky.off + 1) % 1 * L.sky.dayMin * 60), sv = applyWeather(skyState(L, (0.5 - L.sky.off + 1) % 1 * L.sky.dayMin * 60), { ...L, air: { ...L.air, pressure: 0.02 } }, { ...W, precip: 0, clouds: 0, dim: 0 }, 0);
  assert.ok(sv.zenith[2] < st.zenith[2] * 0.4 && sv.stars > 0.5 && !sv.cloud, 'без повітря');
  assert.ok(W_STORM === 3);
});

test('інша фізика: ковзкий ґрунт — інерція; опір повітря — межа падіння й ширяння; пружний ґрунт — відскок', async () => {
  const { lawsOf, physOf } = await import('../js/universe.js');
  const { hashStr } = await import('../js/rng.js');
  const P = world(Array(40).fill('4'.repeat(40)));
  // ковзко: розганяєшся повільно і після відпускання ще їдеш
  const slip = { ...PH1, friction: 0.15 }, a = man(P, 5.5, 20.5), b = man(P, 5.5, 20.5);
  step(a, 1, 0, false, 1 / 60, P, PH1, [[1, 0], [0, 1]]); step(b, 1, 0, false, 1 / 60, P, slip, [[1, 0], [0, 1]]);
  assert.ok(b.x - 5.5 < (a.x - 5.5) * 0.3, 'на ковзкому розгін не повільніший');
  for (let i = 0; i < 60; i++) step(b, 1, 0, false, 1 / 60, P, slip, [[1, 0], [0, 1]]);
  const x1 = b.x;
  for (let i = 0; i < 30; i++) step(b, 0, 0, false, 1 / 60, P, slip, [[1, 0], [0, 1]]);
  assert.ok(b.x - x1 > 0.4, `не ковзає після відпускання: ${b.x - x1}`);
  const c = man(P, 5.5, 25.5);
  for (let i = 0; i < 30; i++) step(c, 1, 0, false, 1 / 60, P, PH1, [[1, 0], [0, 1]]);
  const x2 = c.x; step(c, 0, 0, false, 1 / 60, P, PH1, [[1, 0], [0, 1]]);
  assert.equal(c.x, x2);                                    // звичайний ґрунт — зупинка одразу
  // межа падіння: з висоти швидкість не більша за vT; пробіл — ширяння (повільніше)
  const fall = (vert) => { const p = { x: 5.5, y: 5.5, z: 30, vz: 0, ground: false }; for (let i = 0; i < 120; i++) step(p, 0, 0, false, 1 / 60, P, { ...PH1, vT: 8 }, undefined, { vert }); return p; };
  const f0 = fall(0), f1 = fall(1);
  assert.ok(f0.vz >= -8.5 && f0.vz < -7, `vT: ${f0.vz}`);
  assert.ok(f1.z > f0.z + 2 && f1.glide, `ширяння: ${f1.z} ${f0.z}`);
  // відскок
  const q = { x: 5.5, y: 5.5, z: 8, vz: 0, ground: false };
  let up = false;
  for (let i = 0; i < 200; i++) { step(q, 0, 0, false, 1 / 60, P, { ...PH1, bounce: 0.6 }); if (q.vz > 3) up = true; }
  assert.ok(up && q.bounced, 'не відскочив');
  // закони: біля старту — звичайна фізика; трапляються ковзкі, пружні, інший плин часу, малі планети; густе повітря — повільніше падіння
  const seed = hashStr('фізика');
  let s = 0, bo = 0, tm = 0, small = 0;
  for (let n = -1000; n <= 1000; n++) {
    const L = lawsOf(seed, 0, n), F = L.phys;
    if (Math.abs(n) <= 8) assert.ok(F.friction === 1 && F.bounce === 0 && F.time === 1, `біля старту ${n}`);
    s += F.friction < 1; bo += F.bounce > 0; tm += Math.abs(F.time - 1) > 0.3; small += F.planetR < 800;
  }
  assert.ok(s > 20 && bo > 20 && tm > 20 && small > 3, `ковзких ${s}, пружних ${bo}, з іншим часом ${tm}, малих ${small}`);
  const L0 = lawsOf(seed, 0, 0);
  assert.ok(physOf({ ...L0, air: { ...L0.air, pressure: 2.5 } }).vT < physOf({ ...L0, air: { ...L0.air, pressure: 0.3 } }).vT);
});

test('нові сили: вітер — чесний опір (на землі — понад поріг від g і густини), в\'язка рідина повільніша, поверхневий натяг тримає на бігу, нахил тяжіння штовхає', () => {
  // чесний вітер (опір ∝ густина × швидкість²): на землі при 1 g зносить лише понад vT·√тертя (vT 18 — ≈ 117 км/год)
  const P = world(Array(40).fill('4'.repeat(40))), ph1 = { ...PH1, vT: 18 };
  const onGround = (ph, w) => { const m = man(P, 20.5, 20.5); for (let i = 0; i < 60; i++) step(m, 0, 0, false, 1 / 60, P, ph, undefined, { wind: [w, 0] }); return m.x - 20.5; };
  assert.equal(onGround(ph1, 15), 0, '1 g, 15 кл/с — не зносить');
  assert.ok(onGround(ph1, 20) > 0.5, '1 g, 20 кл/с — зносить');
  assert.ok(onGround({ ...PH1, g: 0.165, vT: 7.1 }, 8) > 0.3, 'Місяць, 8 кл/с — зносить');
  const rows = ['77777777', '7wwwwww7', '7wwwwww7', '77777777'];
  const W1 = world(rows), W5 = world(rows, { swim: true, danger: '', density: 1, visc: 5 });
  const s1 = { x: 2.5, y: 1.5, z: 2.25, vz: 0, ground: false }, s5 = { x: 2.5, y: 1.5, z: 2.25, vz: 0, ground: false };
  for (let i = 0; i < 40; i++) { step(s1, 1, 0, false, 1 / 60, W1, PH1, [[1, 0], [0, 1]]); step(s5, 1, 0, false, 1 / 60, W5, PH1, [[1, 0], [0, 1]]); }
  assert.ok(s5.x - 2.5 < (s1.x - 2.5) * 0.6, `в'язкість: ${s5.x} ${s1.x}`);
  const T = world(rows, { swim: true, danger: '', density: 1, tension: true }), r = man(T, 0.5, 1.5);
  for (let i = 0; i < 60; i++) step(r, 1, 0, false, 1 / 60, T, PH1, [[1, 0], [0, 1]], { sprint: true });
  assert.ok(r.x > 4 && !r.wet && r.z > 2.8, `натяг: ${r.x} ${r.z} ${r.wet}`);
  const q = man(P, 20.5, 20.5);
  for (let i = 0; i < 30; i++) step(q, 0, 0, false, 1 / 60, P, { ...PH1, tilt: [0.3, 0] });
  assert.ok(q.x > 21, `нахил: ${q.x}`);
});

test('тіла: левітуюче висить на висоті появи, звичайне падає й лежить; удар — легке відлітає, важке ледь зрушить; на тіло можна стати', async () => {
  const { configureBodies } = await import('../js/engine/physics/bodies.js'); const { solidB: sB } = await import('../js/gen/chunk.js'); const pl = await import('../js/player.js'); const { LEVEL: LV } = await import('../js/iso.js');
  configureBodies({ level: LV, solid: sB, gravity: pl.GRAVITY, refMass: pl.PLAYER_MASS, refArea: pl.PLAYER_AREA });
  const { makeBody, stepBody, push, rayBody } = await import('../js/engine/physics/bodies.js'); const { HIT_IMPULSE } = pl;
  const P = world(Array(40).fill('4'.repeat(40))), env = { g: 1, vT: 20, bounce: 0, friction: 1, wind: [0, 0] };
  const run = (b, n) => { for (let i = 0; i < n; i++) stepBody(b, 1 / 60, P, env); };
  const fl = makeBody({ x: 20.5, y: 20.5, z: 4 * LEVEL + 2, hx: 0.2, hy: 0.2, hz: 0.15, lift: 1.3, hover: 1.5 });
  fl.sleep = false; run(fl, 300);
  assert.ok(Math.abs(fl.z - fl.hz - (4 * LEVEL + 2)) < 0.02, `висота появи: ${fl.z}`);
  const rock = makeBody({ x: 10.5, y: 10.5, z: 4 * LEVEL + 3, hx: 0.2, hy: 0.2, hz: 0.15, lift: 0 });
  rock.sleep = false; run(rock, 300);
  assert.ok(Math.abs(rock.z - rock.hz - 4 * LEVEL) < 0.05 && rock.sleep, `лежить: ${rock.z} ${rock.sleep}`);
  const small = makeBody({ x: 5.5, y: 5.5, z: 4 * LEVEL + 1, hx: 0.12, hy: 0.12, hz: 0.1, lift: 1.3, hover: 1 });
  const big = makeBody({ x: 5.5, y: 30.5, z: 4 * LEVEL + 1, hx: 1.2, hy: 1.2, hz: 1, lift: 1.3, hover: 1 });
  const x0 = small.x, x1 = big.x;
  push(small, [HIT_IMPULSE, 0, 0]); push(big, [HIT_IMPULSE, 0, 0]);
  run(small, 60); run(big, 60);
  assert.ok(small.x - x0 > 1 && big.x - x1 < 0.05, `легке ${small.x - x0}, важке ${big.x - x1}`);
  const hitR = rayBody([big, fl], 18.5, 20.5, fl.z, [1, 0, 0], 3);
  assert.equal(hitR.b, fl);
  // гравець стає на тіло
  const Pb = { ...P, bodies: () => [fl] };
  assert.ok(Math.abs(support(Pb, fl.x, fl.y, fl.z + fl.hz + 0.5).z - (fl.z + fl.hz)) < 1e-9);
});

test('плавний спуск: уступ у 1 блок униз — ноги на землі (не падіння); з урвища — падіння, а не стрибок', () => {
  const P = world(Array(8).fill('8888777766665555'), undefined), mb = [[1, 0], [0, 1]];
  const p = man(P, 0.5, 3.5);
  let air = 0;
  for (let i = 0; i < 200; i++) { step(p, 1, 0, false, 1 / 60, P, PH1, mb); if (!p.ground) air++; }
  assert.ok(p.x > 13 && air === 0 && Math.abs(p.z - 5 * LEVEL) < 1e-9, `спуск: ${p.x} ${p.z} у повітрі ${air}`);
  const C = world(Array(8).fill('88880000'));
  const q = man(C, 2.5, 3.5);
  let fell = false;
  for (let i = 0; i < 120; i++) { step(q, i < 40 ? 1 : 0, 0, false, 1 / 60, C, PH1, mb); if (q.air) { fell = true; assert.ok(!q.jumped, 'падіння — не стрибок'); } }
  assert.ok(fell && q.ground && q.z === 0, `урвище: ${q.z}`);
  const j = man(C, 1.5, 3.5);
  step(j, 0, 0, true, 1 / 60, C, PH1, mb);
  assert.ok(j.jumped && !j.ground, 'стрибок позначено');
});

test('вітер: затишок за стіною, деревом чи каменем з навітряного боку (до 3 клітинок) і в печері; у повітрі не керуєш, вітер — опором', async () => {
  const { windShelter } = await import('../js/player.js');
  const open = world(Array(20).fill('4'.repeat(20)));
  assert.equal(windShelter(open, 10.5, 10.5, 4 * LEVEL, [5, 0]), 1);
  // стіна на x = 7 (вітер дує в +x — з боку меншого x)
  const wall = world(Array(20).fill('4444444e444444444444'));
  assert.equal(windShelter(wall, 9.5, 10.5, 4 * LEVEL, [5, 0]), 0, 'за стіною');
  assert.equal(windShelter(wall, 5.5, 10.5, 4 * LEVEL, [5, 0]), 1, 'перед стіною — дує');
  assert.equal(windShelter(wall, 13.5, 10.5, 4 * LEVEL, [5, 0]), 1, 'далеко за стіною — дує');
  const tree = world(Array(20).fill('44444444T44444444444').map((r, i) => i === 10 ? r : '4'.repeat(20)));
  assert.equal(windShelter(tree, 10.5, 10.5, 2 * LEVEL, [5, 0]), 0, 'за деревом');
  assert.equal(windShelter(tree, 10.5, 13.5, 4 * LEVEL, [5, 0]), 1, 'збоку від дерева — дує');
  // печера: стеля над головою, з навітряного боку — стіна за 10 клітинок
  const cave = {
    liquid: { swim: true, danger: '', density: 1 },
    block: (x, y, k) => k < 4 ? B_STONE : x < 2 || k >= 10 ? B_STONE : B_AIR,
    obj: () => null,
  };
  assert.equal(windShelter(cave, 12.5, 5.5, 4 * LEVEL, [5, 0]), 0, 'у печері');
  // у повітрі не керуєш: клавіші не змінюють швидкість; розбіг — летиш далі; вітер зносить слабко, ширяння — сильніше
  const P = world(Array(40).fill('4'.repeat(40))), ph1 = { ...PH1, vT: 18 };
  const jumpIn = (w, keys) => { const m = man(P, 20.5, 20.5); step(m, 0, 0, true, 1 / 60, P, ph1, undefined, { wind: [w, 0] }); while (!m.ground) step(m, keys, 0, false, 1 / 60, P, ph1, [[1, 0], [0, 1]], { wind: [w, 0] }); return m.x - 20.5; };
  assert.equal(jumpIn(0, 1), 0, 'у повітрі клавіші не діють');
  const drift = jumpIn(4.6, 0);
  assert.ok(drift > 0 && drift < 0.5, `звичайний вітер у стрибку: ${drift}`);
  const r = man(P, 5.5, 20.5);
  for (let i = 0; i < 10; i++) step(r, 1, 0, false, 1 / 60, P, ph1, [[1, 0], [0, 1]]);
  const v0 = r.vx;
  step(r, 1, 0, true, 1 / 60, P, ph1, [[1, 0], [0, 1]]);
  for (let i = 0; i < 10; i++) step(r, 0, 0, false, 1 / 60, P, ph1, [[1, 0], [0, 1]]);
  assert.ok(!r.ground && Math.abs(r.vx - v0) < 1e-9, `розбіг: ${r.vx} ${v0}`);
  const fall = (vert) => { const m = { x: 20.5, y: 20.5, z: 30, vz: 0, ground: false }; for (let i = 0; i < 60; i++) step(m, 0, 0, false, 1 / 60, P, ph1, undefined, { wind: [6, 0], vert }); return m.x - 20.5; };
  assert.ok(fall(1) > fall(0) * 1.5, `ширяння: ${fall(1)} ${fall(0)}`);
});

test('тіла й вітер: сплячий левітуючий камінь вітер будить і відхиляє (легкий — далі, важкий — ледь), поле не дає відлетіти', async () => {
  const { configureBodies } = await import('../js/engine/physics/bodies.js'); const { solidB: sB } = await import('../js/gen/chunk.js'); const pl = await import('../js/player.js'); const { LEVEL: LV } = await import('../js/iso.js');
  configureBodies({ level: LV, solid: sB, gravity: pl.GRAVITY, refMass: pl.PLAYER_MASS, refArea: pl.PLAYER_AREA });
  const { makeBody, stepBody } = await import('../js/engine/physics/bodies.js');
  const P = world(Array(60).fill('4'.repeat(60))), env = { g: 1.28, vT: 40, bounce: 0, friction: 1, wind: [20, 0] };
  const mk = (h) => makeBody({ x: 30.5, y: 30.5, z: 4 * LEVEL + 1.5, hx: h, hy: h, hz: h * 0.6, lift: 1.4, hover: 1.5 });
  const small = mk(0.15), big = mk(1.2);
  for (let i = 0; i < 600; i++) { stepBody(small, 1 / 60, P, env); stepBody(big, 1 / 60, P, env); }
  const ds = small.x - 30.5, db = big.x - 30.5;
  assert.ok(ds > 0.1 && ds < 8 && db >= 0 && db < ds * 0.5, `відхилення: легкий ${ds}, важкий ${db}`);
  const calm = mk(0.15);
  for (let i = 0; i < 300; i++) stepBody(calm, 1 / 60, P, { ...env, wind: [0, 0] });
  assert.ok(calm.sleep && Math.abs(calm.x - 30.5) < 1e-6, 'без вітру спить на місці');
});

test('левітуюче тіло тримає висоту появи: над уступом униз і над водою — та сама висота, не відстань до ґрунту', async () => {
  const { configureBodies, makeBody, stepBody } = await import('../js/engine/physics/bodies.js'); const { solidB: sB } = await import('../js/gen/chunk.js'); const pl = await import('../js/player.js');
  configureBodies({ level: LEVEL, solid: sB, gravity: pl.GRAVITY, refMass: pl.PLAYER_MASS, refArea: pl.PLAYER_AREA });
  // суходіл висотою 4 рівні (x 0…9), уступ униз на 2 рівні (x 10…19), далі вода (x 20…39)
  const P = world(Array(9).fill('4'.repeat(10) + '2'.repeat(10) + 'w'.repeat(20))), env = { g: 1, vT: 20, bounce: 0, friction: 1, wind: [0, 0] };
  const b = makeBody({ x: 4.5, y: 4.5, z: 4 * LEVEL + 1.2, hx: 0.3, hy: 0.3, hz: 0.2, lift: 1.3, hover: 1.2 }), alt = b.z;
  b.sleep = false; b.ax = null;                       // штовхнули: летить уздовж x над уступом і водою
  let dz = 0;
  for (let i = 0; i < 360 && b.x < 34; i++) { b.vx = 6; stepBody(b, 1 / 60, P, env); dz = Math.max(dz, Math.abs(b.z - alt)); }
  assert.ok(b.x > 30 && dz < 0.02, `x ${b.x}, найбільше відхилення висоти ${dz}`);
});

test('погода в місці не мигтить на межі пустелі: пустеля й сухість — за околом з гістерезисом', async () => {
  const { lawsOf } = await import('../js/universe.js');
  const { areaClimate } = await import('../js/weather.js');
  const { tile, T_DESERT, T_DRY } = await import('../js/gen/chunk.js');
  const { hashStr } = await import('../js/rng.js');
  const seed = hashStr('test');
  let checked = 0;
  for (let i = 0; i < 2000 && checked < 3; i++) {
    const L = lawsOf(seed, 0, 200 + 7 * i);
    if (L.wet > -0.3) continue;
    const typ = (x) => tile(L, x, 0).t, ar = (t) => t === T_DESERT || t === T_DRY;
    let x0 = null;                                   // рвана межа: тип перемикається ≥ 4 рази на 60 клітинках
    for (let a = -3000; a < 3000 && x0 === null; a += 30) {
      let f = 0, p = ar(typ(a));
      for (let x = a + 1; x < a + 60; x++) { const q = ar(typ(x)); if (q !== p) f++; p = q; }
      if (f >= 4) x0 = a;
    }
    if (x0 === null) continue;
    checked++;
    for (const key of ['arid', 'desert']) {
      const cellOf = key === 'arid' ? (t) => ar(t) : (t) => t === T_DESERT;
      let prev = null, last = null, flips = 0, cellFlips = 0, pc = null, pa = null;
      for (let x = x0 - 100; x < x0 + 160; x++) {
        prev = areaClimate(L, x + 0.5, 0.5, prev);
        if (pa !== null && prev[key] !== pa) { assert.ok(last === null || x - last >= 12, `${key}: перемикання через ${x - last} клітинок`); last = x; flips++; }
        pa = prev[key];
        const q = cellOf(typ(x)); if (pc !== null && q !== pc) cellFlips++; pc = q;
      }
      assert.ok(flips < cellFlips || cellFlips === 0, `${key}: ${flips} перемикань околу проти ${cellFlips} по клітинках`);
    }
  }
  assert.ok(checked > 0, 'не знайшлося рваної межі пустелі');
});

// Висота видимої поверхні під точкою (промінь проти трикутників зіткнень)
async function surfAt(P, x, y, top = 40) {
  const { colliderOf } = await import('../js/collision.js');
  const { createList, rayCast } = await import('../js/engine/physics/collide.js');
  const L = colliderOf(P).gather(x - 0.01, y - 0.01, -2, x + 0.01, y + 0.01, top, createList());
  const r = rayCast(L, x, y, top, 0, 0, -1, top + 2);
  return r ? top - r.t : null;
}

test('схили: стоїш (до 80°), ноги фігури — на видимій поверхні під центром; угору — на 1 блок на клітинку при 1 g, на 2 — у легкій', async () => {
  const X = [[1, 0], [0, 1]], light = { ...PH1, up: 2 };
  // сходи з рівних уступів: 1 блок на клітинку — на вигляд площина 26,6°; 2 — пилка (56° заввишки 0,75 і полога),
  // 3 — пилка (74° заввишки 1,25)
  const slope = (per) => world(Array(9).fill(Array.from({ length: 12 }, (_, i) => (i * per).toString(36)).join('')));
  for (const [per, ph, up] of [[1, PH1, true], [2, PH1, false], [2, light, true], [3, light, false]]) {
    const P = slope(per), p = { x: 5.5, y: 4.5, z: 5 * per * LEVEL + 0.3, vz: 0, ground: false };
    run(p, 0, 0, 120, P, ph);
    const zs = await surfAt(P, p.x, p.y);
    assert.ok(p.ground && Math.abs(p.x - 5.5) < 1e-9 && Math.abs(p.vis - zs) < 0.005, `${per}: стоїть ${p.ground}, x ${p.x}, ноги ${p.vis} / поверхня ${zs}`);
    const z0 = p.z;
    run(p, 1, 0, 60, P, ph, false, X);
    if (up) assert.ok(p.x > 7.5 && p.z > z0 + 0.9, `${per}, up ${ph.up}: угору ${p.x} ${p.z - z0}`);
    else assert.ok(p.x < 6.6 && p.z < z0 + 0.8, `${per}, up ${ph.up}: не вийти ${p.x} ${p.z - z0}`);
    let air = 0;
    for (let i = 0; i < 160; i++) { step(p, -1, 0, false, 1 / 120, P, ph, X); air += !p.ground; }
    assert.ok(p.x < 5 && (per > 2 || air === 0), `${per}: униз ${p.x}, у повітрі ${air}`);   // перепад 1,25 — падаєш
  }
});

test('прогулянка справжнім рельєфом: випадкове введення з бігом і стрибками — капсула ніколи не в поверхні, на землі підлога під ногами', async () => {
  const { lawsOf, physOf } = await import('../js/universe.js');
  const { hashStr } = await import('../js/rng.js');
  const { genChunk, bi, H } = await import('../js/gen/chunk.js');
  const { liquidAt } = await import('../js/player.js');
  const seed = hashStr('test');
  let rnd = 99;
  const r = () => { rnd = (rnd * 1103515245 + 12345) >>> 0; return rnd / 4294967296; };
  for (const n of [0, 37, 600]) {
    const L = lawsOf(seed, 0, n), ph = physOf(L), C = new Map();
    for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) C.set(`${cx},${cy}`, genChunk(L, cx, cy));
    const P = {
      liquid: L.liquid, laws: L, obj: () => null,
      block(x, y, k) {
        const c = C.get(`${Math.floor(x / 16)},${Math.floor(y / 16)}`);
        if (!c) return -1;
        if (k < 0) return B_STONE;
        if (k >= H) return B_AIR;
        return c.b[bi(x - Math.floor(x / 16) * 16, y - Math.floor(y / 16) * 16, k)];
      },
    };
    // старт — найближча до центру клітинка, де можна стати
    let p = null;
    for (let d = 0; d < 12 && !p; d++) for (let dy = -d; dy <= d && !p; dy++) for (let dx = -d; dx <= d && !p; dx++) {
      const x = 16 + dx + 0.5, y = 16 + dy + 0.5;
      for (let k = H; k > 0 && !p; k--) if (P.block(Math.floor(x), Math.floor(y), k - 1) !== B_AIR) { const s = settle(P, x, y, k * LEVEL); if (standable(P, ...s) && liquidAt(P, ...s) === null) p = { x: s[0], y: s[1], z: s[2], vz: 0, ground: true }; break; }
    }
    assert.ok(p, `${n}: ніде стати`);
    let ix = 0, iy = 0, sprint = false, jumps = 0, moved = 0, ground = 0;
    for (let i = 0; i < 3000; i++) {
      if (i % 40 === 0) { const a = r() * Math.PI * 2; ix = Math.round(Math.cos(a)); iy = Math.round(Math.sin(a)); sprint = r() < 0.3; }
      const jump = r() < 0.01, x0 = p.x, y0 = p.y;
      jumps += jump;
      step(p, ix, iy, jump, 1 / 120, P, ph, undefined, { sprint });
      moved += Math.hypot(p.x - x0, p.y - y0);
      assert.ok(!hits(P, p.x, p.y, p.z, shapeOf(p)), `${n}, крок ${i}: капсула в поверхні (${p.x}, ${p.y}, ${p.z})`);
      if (p.ground && !p.wet) { ground++; assert.ok(support(P, p.x, p.y, p.z, 0.02, false, shapeOf(p)), `${n}, крок ${i}: на землі без підлоги (${p.x}, ${p.y}, ${p.z})`); }
    }
    assert.ok(moved > 30 && ground > 10 && jumps > 10, `${n}: пройшов ${moved}, на землі ${ground}, стрибків ${jumps}`);
  }
});

test('камера третьої особи — куля: стіна, стовбур, тіло позаду — ближче; схил — око над ним; низька стеля — ціль під нею; не виходить з-під рідини', async () => {
  const { createCamera, camHead, camCollide, eyeDir, THIRD, HEAD, CAM_R } = await import('../js/camera.js');
  const { colliderOf, underLiquid } = await import('../js/collision.js');
  const cam = createCamera(THIRD);
  cam.yaw = Math.PI; cam.pitch3 = 0; cam.dist = 7;                   // око — у бік −x
  const at = (P, x, y, z) => { const src = colliderOf(P), head = [x, y, camHead(src, [x, y, z], HEAD)]; return { head, ...camCollide(cam, head, head, src, (a, b, c) => underLiquid(P, a, b, c)) }; };
  // відкрито — повна відстань; стіна (стовпці x = 2, 7,5 одиниці) — до неї мінус радіус кулі
  assert.equal(at(world(Array(9).fill('4'.repeat(16))), 8.5, 4.5, 2).dist, 7);
  const w = at(world(Array(9).fill('44f4444444444444')), 8.5, 4.5, 2);
  assert.ok(Math.abs(w.dist - (8.5 - 3 - CAM_R)) < 0.02, `стіна: ${w.dist}`);
  // стовбур (r 0,18) і тіло позаду
  const t = at(world(Array(9).fill('2'.repeat(16)).map((r, i) => i === 4 ? '222T222222222222' : r)), 8.5, 4.5, 1);
  assert.ok(Math.abs(t.dist - (8.5 - 3.5 - 0.18 - CAM_R)) < 0.03, `стовбур: ${t.dist}`);
  const flat = world(Array(9).fill("4".repeat(16))), box = { x: 4.5, y: 4.5, z: 3.7, hx: 0.3, hy: 0.3, hz: 0.3 };
  const b = at({ ...flat, bodies: () => [box] }, 8.5, 4.5, 2);
  assert.ok(Math.abs(b.dist - (8.5 - 4.8 - CAM_R)) < 0.02, `тіло: ${b.dist}`);
  // схил позаду (угору в бік −x): центр ока над поверхнею щонайменше на радіус кулі
  const S = world(Array(9).fill('ihgfedcba9876544')), saved = cam.pitch3;
  cam.pitch3 = 0.15;
  const s = at(S, 13.5, 4.5, 2), e = eyeDir(cam), eye = [s.target[0] + e[0] * s.dist, s.target[1] + e[1] * s.dist, s.target[2] + e[2] * s.dist];
  const zs = await surfAt(S, eye[0], eye[1]);
  assert.ok(s.dist < 7 && eye[2] - zs > CAM_R - 0.02, `схил: око ${eye[2]}, поверхня ${zs}`);
  cam.pitch3 = saved;
  // низька стеля (хід 2 блоки: підлога 1, стеля 2): ціль — під нею
  const cave = { liquid: { swim: true }, obj: () => null, block: (x, y, k) => k < 2 || k >= 4 ? B_STONE : B_AIR };
  const c = at(cave, 8.5, 4.5, 1);
  assert.ok(c.head[2] <= 2 - CAM_R + 1e-6 && c.head[2] > 1.7, `стеля: ${c.head[2]}`);
  // ціль під водою (поверхня 2,85): око не виходить над поверхню
  cam.pitch3 = 0.5;
  const W = world(Array(16).fill('w'.repeat(16))), u = camCollide(cam, [8.5, 8.5, 2.2], [8.5, 8.5, 2.2], colliderOf(W), (a, b2, c2) => underLiquid(W, a, b2, c2));
  const ue = eyeDir(cam), uz = 2.2 + ue[2] * u.dist;
  assert.ok(u.dist >= 0 && uz < 2.85 && uz > 2.6, `під водою: око ${uz}, відстань ${u.dist}`);
  cam.pitch3 = 0;
});

test('перша особа: цикл V, погляд — куди обернений гравець, кут огляду 70°, без згладжування; руки — у кутах кадру', async () => {
  const { createCamera, viewProj, project, basis, rotate, smooth, facing, setYaw, NEXT, FIRST, THIRD, ISO, FOV1, LIMITS } = await import('../js/camera.js');
  const { viewArms } = await import('../js/anim.js');
  const { PIVOT, HAND_Z } = await import('../js/gen/mesh.js');
  assert.deepEqual([NEXT[FIRST], NEXT[THIRD], NEXT[ISO]], [THIRD, ISO, FIRST]);
  const c = createCamera(FIRST);
  setYaw(c, 1.2 + Math.PI);
  const f = facing(c), u = basis(c).u;
  assert.ok(Math.abs(-u[0] - Math.cos(f)) < 1e-9 && Math.abs(-u[1] - Math.sin(f)) < 1e-9, 'погляд — куди обернений');
  // ціль (око) — у центрі; точка на відстані 1 під кутом FOV1/2 угору — на верхньому краї кадру
  const W = 1600, H = 900, v = viewProj(c, W, H, 5);
  assert.ok(v.eye.every((x) => x === 0), 'око — у цілі');
  const fw = [-u[0], -u[1], -u[2]], up = basis(c).up, k = Math.tan(FOV1 / 2) * 0.999;
  const top = project(v.m, [fw[0] + up[0] * k, fw[1] + up[1] * k, fw[2] + up[2] * k], W, H);
  assert.ok(Math.abs(top[0] - W / 2) < 1e-3 && top[1] > 0 && top[1] < 2, `верх кадру: ${top}`);
  // миша — одразу, нахил до ±89°
  rotate(c, 0, 1e5); smooth(c, 1 / 60);
  assert.equal(c.pitch1, LIMITS.first.pitch[1]);
  rotate(c, 50, 0); smooth(c, 1 / 60);
  assert.equal(c.yaw, c.yawT);
  // руки: кисті — у точках екрана (±0,6, −0,75)
  c.pitch1 = c.pitch1T = 0.3;
  const vp = viewProj(c, W, H), b = basis(c), A = viewArms({ arm: 0, punch: 0 }, {}, b, [0, 0, 0], W / H, FOV1);
  for (const [p, s] of [['armR', 1], ['armL', -1]]) {
    const M = A[p], py = p === 'armR' ? -PIVOT.armY : PIVOT.armY, hz = HAND_Z;
    const hand = [M[4] * py + M[8] * hz + M[12], M[5] * py + M[9] * hz + M[13], M[6] * py + M[10] * hz + M[14]];
    const q = project(vp.m, hand, W, H);
    assert.ok(Math.abs((q[0] / W * 2 - 1) - 0.6 * s) < 1e-6 && Math.abs((1 - q[1] / H * 2) + 0.75) < 1e-6, `${p}: ${q}`);
  }
});

test('руки першої особи: viewArms читає зі стану гравця лише VIEW_KEYS — знімок для сцени дає те саме, що повний стан', async () => {
  const { viewArms, animate, VIEW_KEYS } = await import('../js/anim.js');
  const { createCamera, basis, FIRST, FOV1 } = await import('../js/camera.js');
  const b = basis(createCamera(FIRST));
  const states = [
    { swim: true, moving: true }, { dive: true, wet: true, ground: true, moving: true }, { wet: true, ground: true, moving: true },
    { climb: { kind: 'wall', nx: 1, ny: 0 }, climbD: 0.7, moving: true }, { climb: { kind: 'ladder', nx: 0, ny: 1 }, climbD: 0.3 },
    { carry: true }, { pose: 'crawl', moving: true }, { pose: 'swim', wet: true, moving: true }, { fly: true }, { moving: true },
  ];
  for (const st of states) {
    const me = { x: 0, y: 0, z: 0, yaw: 0.4, vx: 1, vy: 0, vz: -0.3, pose: 'stand', look: { p: 0, y: 0 }, ...st };
    for (let i = 0; i < 40; i++) animate(me, 1 / 60, i * 16.7);
    const read = new Set(), spy = new Proxy(me, { get: (t, k) => { read.add(k); return t[k]; } });
    const full = viewArms(me.anim, spy, b, [0, 0, 1], 16 / 9, FOV1);
    for (const k of read) assert.ok(VIEW_KEYS.includes(k), `viewArms читає «${String(k)}», а в VIEW_KEYS його немає (${JSON.stringify(st)})`);
    const snap = Object.fromEntries(VIEW_KEYS.map((k) => [k, me[k]])), part = viewArms(me.anim, snap, b, [0, 0, 1], 16 / 9, FOV1);
    assert.deepEqual(part, full, JSON.stringify(st));
  }
});

test('у товщі породи (телепорт, секцію догенеровано) — нагору до першого вільного місця, а не крізь породу в печеру під нею', () => {
  const P = { liquid: { swim: true }, obj: () => null, block: (x, y, k) => k >= 6 && k < 10 ? B_AIR : k < 20 ? B_STONE : B_AIR };
  const p = { x: 5.5, y: 5.5, z: 6, vz: 0, ground: false };
  for (let i = 0; i < 120; i++) step(p, 0, 0, false, 1 / 120, P, PH1);
  assert.ok(p.z === 10 && p.ground, `${p.z} ${p.ground}`);
  // трохи під поверхнею (куля поверхні не перетинає, але центр — у породі): теж перетин, нагору
  assert.ok(hits(P, 5.5, 5.5, 9.6), 'під поверхнею — перетин');
  const q = { x: 5.5, y: 5.5, z: 9.6, vz: 0, ground: false };
  for (let i = 0; i < 60; i++) step(q, 0, 0, false, 1 / 120, P, PH1);
  assert.ok(Math.abs(q.z - 10) < 1e-6 && q.ground, `${q.z}`);
  // приземлення: вузький хід заввишки 2 блоки (по блоках можна стати, видимо 0,75) — ні; зала в 4 блоки — так
  const two = { liquid: { swim: true }, obj: () => null, block: (x, y, k) => (x < 9 ? y === 5 && k >= 6 && k < 8 : k >= 6 && k < 10) ? B_AIR : B_STONE };
  const l = landing(two, 5.5, 5.5, 3);
  assert.ok(l[0] >= 9 && !hits(two, ...l), `приземлення в ході у 2 блоки: ${l}`);
});

test('незгенероване під гравцем (телепорт у печеру, секції ще в генераторі) — чекає на місці, не падає й не виштовхується', () => {
  let ready = false;
  const P = { liquid: { swim: true }, obj: () => null, block: (x, y, k) => !ready && k < 16 ? -1 : k >= 6 && k < 10 ? B_AIR : k < 20 ? B_STONE : B_AIR };
  const p = { x: 5.5, y: 5.5, z: 3, vz: 0, ground: false };
  for (let i = 0; i < 60; i++) step(p, 1, 0, false, 1 / 120, P, PH1);
  assert.ok(p.z === 3 && p.x === 5.5, `чекає: ${p.x} ${p.z}`);
  ready = true;
  for (let i = 0; i < 60; i++) step(p, 0, 0, false, 1 / 120, P, PH1);
  assert.ok(p.z === 3 && p.ground, `у печері: ${p.z}`);
});

test('під рідиною: око нижче поверхні стовпця рідини (поверхня — 0,15 під краєм верхнього блоку); видимість — від прозорості', async () => {
  const { underLiquid, liquidVis } = await import('../js/collision.js');
  const P = world(Array(4).fill('wwww'));                               // дно — верх k = 1 (z 1), рідина k 2…5, поверхня 2,85
  assert.equal(underLiquid(P, 1.5, 1.5, 2.84), true);
  assert.equal(underLiquid(P, 1.5, 1.5, 2.86), false);
  assert.equal(underLiquid(P, 1.5, 1.5, 2.0), true);                    // межа блоків k 3 / 4 — та сама рідина
  assert.equal(underLiquid(P, 1.5, 1.5, 0.9), false);                   // у дні — не рідина
  const vis = [0.72, 0.82, 0.55, 1].map(liquidVis);                     // вода, кислота, метан, лава
  assert.ok(Math.abs(vis[0] - 15.56) < 0.01 && Math.abs(vis[1] - 8.78) < 0.01 && Math.abs(vis[2] - 32.73) < 0.01 && vis[3] === 0.8, `${vis}`);
});

test('відкритість неба фігури й тіл: як AO неба вершин землі (skyK), білінійно між клітинками; немає даних — відкрито', async () => {
  const { skyOpenAt } = await import('../js/world.js');
  const { skyK } = await import('../js/gen/mesh.js');
  const { LEVEL } = await import('../js/iso.js');
  // клітинки x < 0 — під стелею на висоті 10 (печера), x ≥ 0 — відкрито (верх укриття — земля на 0)
  const top = (x) => x < 0 ? 10 : 0;
  assert.equal(skyOpenAt(top, 5.5, 0.5, 0.5), 1);
  assert.equal(skyOpenAt(top, -5.5, 0.5, 0.5), 0);
  // та сама величина, що й у вершини землі на тій самій висоті під укриттям
  const mid = (x) => x < 0 ? 0.5 + 5 * LEVEL : 0;
  assert.ok(Math.abs(skyOpenAt(mid, -5.5, 0.5, 0.5) - skyK(5)) < 1e-12);
  // на межі — посередині, без стрибка; уздовж кроку — монотонно
  assert.ok(Math.abs(skyOpenAt(top, 0, 0.5, 0.5) - 0.5) < 1e-12);
  let prev = -1;
  for (let x = -1; x <= 1; x += 0.05) { const k = skyOpenAt(top, x, 0.5, 0.5); assert.ok(k >= prev - 1e-12); prev = k; }
  assert.equal(skyOpenAt(() => null, 3.2, 7.9, -50), 1);
});

test('тіло чи стовбур накрили гравця (тіла з ним не зіштовхуються): це перетин — виходить до найближчої грані, не на верх', () => {
  const ground = (x, y, k) => k < 6 ? B_STONE : B_AIR;                  // земля — верх k = 5 (z 3)
  const body = { x: 5.4, y: 5.5, z: 4, hx: 1.2, hy: 1.2, hz: 1, mass: 500 };
  const P = { liquid: { swim: true }, obj: () => null, block: ground, bodies: () => [body] };
  assert.ok(hits(P, 5.5, 5.5, 3), 'усередині тіла — перетин');
  const p = { x: 5.5, y: 5.5, z: 3, vz: 0, ground: true };
  step(p, 0, 0, false, 1 / 120, P, PH1);
  assert.ok(!hits(P, p.x, p.y, p.z) && Math.abs(p.z - 3) < 1e-6 && p.x > 6.6 + 0.24 - 1e-3, `з тіла — убік: ${p.x} ${p.z}`);
  // стовбур-велетень (r 1,5, заввишки 30): убік, а не на верхівку
  const tree = { cx: 5.5, cy: 5.5, z0: 3, z1: 33, r: 1.5 };
  const T = { liquid: { swim: true }, objR: 1.5, obj: (x, y) => x === 5 && y === 5 ? tree : null, block: ground };
  assert.ok(hits(T, 5.9, 5.5, 3), 'у стовбурі — перетин');
  const q = { x: 5.9, y: 5.5, z: 3, vz: 0, ground: true };
  step(q, 0, 0, false, 1 / 120, T, PH1);
  assert.ok(!hits(T, q.x, q.y, q.z) && q.z < 3.1 && Math.hypot(q.x - 5.5, q.y - 5.5) > 1.5, `зі стовбура — убік: ${q.x} ${q.y} ${q.z}`);
  // печера під деревом: центр кулі під основою призми — не «усередині» (призма замкнена знизу)
  const cave = (x, y, k) => k >= 6 && k < 12 ? B_STONE : k < 2 ? B_STONE : B_AIR;   // підлога печери z 1, стеля k 6 (z 3), поверхня z 6
  const C = { liquid: { swim: true }, objR: 1.5, obj: (x, y) => x === 5 && y === 5 ? { cx: 5.5, cy: 5.5, z0: 6, z1: 36, r: 1.5 } : null, block: cave };
  assert.ok(!hits(C, 5.5, 5.5, 1), 'у печері під деревом — вільно');
});

test('поверхневий натяг: опускаючись на поверхню рідини біля крутого берега, гравець не входить у берег (стрес-тест)', async () => {
  const { lawsOf, physOf } = await import('../js/universe.js');
  const { hashStr } = await import('../js/rng.js');
  const { genChunk, bi, H } = await import('../js/gen/chunk.js');
  const L = lawsOf(hashStr('stress'), 2, 600), C = new Map();
  assert.ok(L.liquid.tension, 'у цьому всесвіті рідина з натягом');
  for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 3; cx++) C.set(`${cx},${cy}`, genChunk(L, cx, cy));
  const P = { liquid: L.liquid, laws: L, obj: () => null, block(x, y, k) { const c = C.get(`${Math.floor(x / 16)},${Math.floor(y / 16)}`); if (!c) return -1; if (k < 0) return B_STONE; if (k >= H) return B_AIR; return c.b[bi(x - Math.floor(x / 16) * 16, y - Math.floor(y / 16) * 16, k)]; } };
  // стан за кадр до перетину (до 11.10.2026: поставило на поверхню 2,85 на 0,035 у березі 64°)
  const p = { x: 28.054122908094406, y: 12.217532595552148, z: 2.9138528616076624, vz: 0.15155848212755305, ground: false, stepOff: 0, footOff: 0, offX: 0, offY: 0, leap: 0.1, vx: 1.4244183265294874, vy: -1.4244183265294874, jumped: true, floorN: null, floorB: 0 };
  assert.ok(!hits(P, p.x, p.y, p.z));
  step(p, 1, 0, false, 1 / 120, P, physOf(L), undefined, { sprint: true });
  assert.ok(!hits(P, p.x, p.y, p.z), `перетин: ${p.x} ${p.y} ${p.z}`);
});
