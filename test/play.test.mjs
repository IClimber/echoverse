// Ізометрія, рух гравця, пристрій для стрибків, формат файлу збереження.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toScreen, fromScreen, pick, LEVEL } from '../js/iso.js';
import { step, hits, support, standable, SPEED, PH1, GRAVITY, JUMP_V, FLOAT_Z, jumpHeight, SPRINT, FLY_SPEED, FLY_V } from '../js/player.js';
import { landing, landingChunks, createDevice, CHARGE, HISTORY } from '../js/device.js';
import { serialize, deserialize } from '../js/save.js';
import { B_AIR, B_LIQ, B_GRASS, B_STONE } from '../js/gen/chunk.js';

// Світ з рядків: символ — стовпець. Цифра або буква a…z — висота суходолу в блоках (0…35; 'T' — висота 2 з деревом,
// 'R' — висота 2 з каменем 0,4 заввишки); 'w' — водойма: дно на 2, рідина до 6 (тримає чи ні — liquid);
// поза мапою — не згенеровано (−1)
const SEA = 6;
function world(rows, liquid = { swim: true, danger: '', density: 1 }) {
  const hOf = (ch) => ch === 'T' || ch === 'R' ? 2 : /[0-9]/.test(ch) ? +ch : ch.charCodeAt(0) - 87;
  return {
    liquid,
    block(x, y, k) {
      const ch = rows[y] && rows[y][x];
      if (ch === undefined) return -1;
      if (k < 0) return B_STONE;
      if (ch === 'w') return k < 2 ? B_STONE : k < SEA ? B_LIQ : B_AIR;
      return k < hOf(ch) ? B_GRASS : B_AIR;
    },
    obj: (x, y) => {
      const ch = rows[y] && rows[y][x];
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

test('рух: на уступ в 1 блок — сам, на 2 — ні; з обриву будь-якої висоти — падаєш', () => {
  const P = world(['444444', '444566', '444444', '440444']);
  const p = man(P, 2.5, 1.5);
  run(p, 1, 1, 40, P);                                      // +x: 4 → 5 (крок), далі 5 → 6 (крок)
  assert.ok(p.x > 4.3 && Math.abs(p.z - 6 * LEVEL) < 1e-9, `на уступи: ${p.x} ${p.z}`);
  const w = man(world(['444444', '444466', '444444']), 2.5, 1.5);
  run(w, 1, 1, 40, world(['444444', '444466', '444444']));  // 4 → 6 — стіна
  assert.ok(w.x < 3.8 && Math.abs(w.z - 4 * LEVEL) < 1e-9, `стіна: ${w.x}`);
  const q = man(P, 2.5, 1.5);
  run(q, -1, 1, 60, P);                                     // +y: 4 → 4 → 0 (униз на 4) — падає
  assert.ok(q.y > 3.3 && q.z === 0 && q.ground, `з обриву: ${q.y} ${q.z}`);
  assert.equal(hits(P, 10, 10, 0), true);                   // незгенероване — стіна
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

test('печера: під стелею проходиш, у низький лаз (1 блок) — ні', () => {
  // стовпці з «дахом»: блоки 0…1 — підлога, 2…3 — порожньо (печера 2 блоки), 4…7 — стеля; 'L' — лаз заввишки 1 блок
  const P = {
    liquid: { swim: true }, obj: () => -1,
    block(x, y, k) { if (y < 0 || y > 2 || x < 0 || x > 9) return -1; const low = x >= 6; return k < 2 ? B_STONE : k < (low ? 3 : 4) ? B_AIR : k < 8 ? B_STONE : B_AIR; },
  };
  const p = { x: 0.5, y: 1.5, z: 2 * LEVEL, vz: 0, ground: true };
  run(p, 1, 1, 90, P);
  assert.ok(p.x > 5.2 && p.x < 6 && Math.abs(p.z - LEVEL * 2) < 1e-9, `${p.x} ${p.z}`);
});

test('легка гравітація: пішки на 2 блоки; приземлення шукає місце з виходом', () => {
  const light = { up: 2, speed: 1, settle: 8, g: 0.5 };
  const P = world(['444444', '444688', '444444']);
  const p = man(P, 2.5, 1.5), q = man(P, 2.5, 1.5);
  run(p, 1, 1, 40, P);                                      // при 1 g: 4 → 6 — ні
  run(q, 1, 1, 40, P, light);                               // при 0,5 g — так, і далі 6 → 8
  assert.ok(p.x < 3.3 && q.x > 4.3 && Math.abs(q.z - 8 * LEVEL) < 1e-9, `${p.x} ${q.x} ${q.z}`);
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
  const P = world(['44444444', '44444666', '44444666', '44444444']);
  const p = man(P, 2.5, 1.5);
  run(p, 1, 1, 120, P);
  assert.ok(p.x < 5 && p.ground, `пішки: ${p.x}`);
  run(p, 1, 1, 120, P, PH1, true);
  assert.ok(p.x > 5 && Math.abs(p.z - 6 * LEVEL) < 1e-9 && p.ground, `стрибок: ${p.x} ${p.z}`);
});

test('падіння: зі стрибка — з будь-якої висоти; приземлення на опору', () => {
  const P = world(['8800', '8800', '8800']);
  const p = man(P, 1.5, 0.5);
  run(p, 1, 1, 120, P, PH1, true);
  assert.ok(p.x > 2.2 && p.z === 0 && p.ground, `${p.x} ${p.z}`);
  assert.equal(support(P, 3.5, 1.5, 4).z, 0);
});

test('приземлення: на місці, якщо можна; інакше найближче з виходом; ніде стати — у рідині чи в повітрі, але завжди', () => {
  const P = world(['44444', '4www4', '4www4', '4www4', '44444'], { swim: true, danger: '1100 °C', density: 2.8 });
  assert.deepEqual(landing(P, 0.5, 0.5, 2), [0.5, 0.5, 2]);
  assert.deepEqual(landing(P, 2.5, 2.5, 2), [2.5, 0.5, 2]);                   // у рідині — найближче на березі
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
  const rows = ['77777', '7www7', '7www7', '77777'];
  const P = world(rows), H = world(rows, { swim: true, danger: '1100 °C', density: 2.8 }), M = world(rows, { swim: false, danger: 'тонеш', density: 0.42 });
  const p = man(P, 0.5, 1.5);
  run(p, 1, 1, 40, P);                                      // +x: з берега (7) у воду
  run(p, 0, 0, 90, P);
  const surf = SEA * LEVEL - 0.15;
  assert.ok(p.swim && p.wet && Math.abs(p.z - (surf - FLOAT_Z)) < 0.03, `пливе? ${p.swim} z ${p.z}`);
  const x0 = p.x;
  step(p, 1, 1, false, 1 / 60, P);
  assert.ok(p.x - x0 < SPEED * 0.6 * Math.SQRT2 / 60, 'у воді не повільніше');
  step(p, 0, 0, true, 1 / 60, P);
  assert.ok(p.vz > 4, `з води не вистрибнув: ${p.vz}`);
  run(p, 0, 0, 120, P);
  run(p, 1, 1, 120, P);                                     // далі — на берег (7 блоків)
  assert.ok(p.x > 4 && Math.abs(p.z - 7 * LEVEL) < 1e-9 && p.ground, `вийшов? ${p.x} ${p.z}`);
  const q = man(H, 0.5, 1.5);
  run(q, 1, 1, 60, H);                                      // у лаву — можна (густа: тримає вище)
  run(q, 0, 0, 90, H);
  assert.ok(q.x > 1.3 && q.swim && q.z > surf - FLOAT_Z + 0.2, `у лаву: ${q.x} ${q.z}`);
  const m = man(M, 0.5, 1.5);
  run(m, 1, 1, 30, M);                                      // метан не тримає: на дно
  run(m, 0, 0, 120, M);
  assert.ok(m.wet && !m.swim && m.ground && Math.abs(m.z - 2 * LEVEL) < 1e-9, `у метані: ${m.z}`);
  run(m, 1, 1, 200, M);                                     // по дну — і на берег (з дна 5 блоків угору: до 2 над поверхнею)
  assert.ok(m.x > 4 && Math.abs(m.z - 7 * LEVEL) < 1e-9, `з метану: ${m.x} ${m.z}`);
});

test('з води на берег: мілко (1 блок) — на 2 блоки над поверхнею виходиш кроком', () => {
  const P = world(['8888', '5558', '5558', '8888'].map((r) => r.replace(/5/g, 'w')), { swim: true, danger: '', density: 1 });
  const p = { x: 1.5, y: 1.5, z: 2 * LEVEL, vz: 0, ground: true };
  run(p, 0, 0, 30, P);
  run(p, 1, 0, 120, P, PH1, false, [[1, 0], [0, 1]]);
  assert.ok(p.x > 3 && Math.abs(p.z - 8 * LEVEL) < 1e-9, `не вийшов: ${p.x} ${p.z}`);
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
  for (let i = 0; i < 30; i++) step(p, 1, 0, false, 1 / 60, P, PH1);
  assert.ok(Math.abs(Math.hypot(p.x - x0, p.y - y0) - FLY_SPEED * 0.5) < 1e-6);
  for (let i = 0; i < 120; i++) step(p, 0, 0, false, 1 / 60, P, PH1, undefined, { vert: -1 });
  assert.ok(!p.fly && p.ground && Math.abs(p.z - z0) < 1e-9);
  // у стіну не влетиш
  const W = world(['44444', '44f44', '44444']), q = man(W, 0.5, 1.5);
  q.fly = true;
  for (let i = 0; i < 60; i++) step(q, 1, 0, false, 1 / 60, W, PH1, [[1, 0], [0, 1]]);
  assert.ok(q.x > 1.5 && q.x < 2 - 0.24 + 1e-6, `влетів у стіну: x ${q.x}`);
});

test('небо й час: біля старту — одне сонце, місяць, доба ~20 хв; далі — кілька сонць, кільця, вічний день; полудень світліший', async () => {
  const { lawsOf } = await import('../js/universe.js');
  const { skyState, dayPhase, clockStr } = await import('../js/sky.js');
  const { hashStr } = await import('../js/rng.js');
  const seed = hashStr('небо');
  let multi = 0, rings = 0, lock = 0, noMoon = 0;
  for (let n = -1500; n <= 1500; n++) {
    const S = lawsOf(seed, 0, n).sky;
    assert.ok(S.suns.length >= 1 && S.suns.length <= 3 && S.moons.length <= 3 && S.dayMin >= 6 && S.dayMin <= 40 && S.night > 0.1);
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
    assert.ok(A.pressure > 0 && A.pressure < 3.5 && A.rad >= 0 && A.rad <= 1 && A.haze >= 0 && A.haze <= 1);
    gases.add(A.gas); vac += A.pressure < 0.1;
  }
  assert.ok(gases.size === 5 && vac > 5, `видів повітря ${gases.size}, без повітря ${vac}`);
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
  assert.ok(s > 20 && bo > 20 && tm > 100 && small > 50, `ковзких ${s}, пружних ${bo}, з іншим часом ${tm}, малих ${small}`);
  const L0 = lawsOf(seed, 0, 0);
  assert.ok(physOf({ ...L0, air: { ...L0.air, pressure: 2.5 } }).vT < physOf({ ...L0, air: { ...L0.air, pressure: 0.3 } }).vT);
});
