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
  // у повітрі не керуєш (як у житті): стрибок з розбігу за ~1,4 клітинки до уступу
  const j = man(P, 3.4, 1.5);
  run(j, 1, 1, 120, P, PH1, true);
  assert.ok(j.x > 5 && Math.abs(j.z - 6 * LEVEL) < 1e-9 && j.ground, `стрибок: ${j.x} ${j.z}`);
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

test('світла неба: головне (з тінню) — найяскравіше; сонце, що показалось над обрієм на 1 %, яскравіше за місяць; серп слабший за повню', async () => {
  const { lightsOf, aboveHorizon } = await import('../js/sky.js');
  const n = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const r = 0.04, zOf = (f) => { let lo = -1, hi = 1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (aboveHorizon(Math.sin(m * r), r) < f) lo = m; else hi = m; } return Math.sin(lo * r); };
  assert.ok(Math.abs(aboveHorizon(0, r) - 0.5) < 1e-9 && aboveHorizon(-0.1, r) === 0 && aboveHorizon(0.1, r) === 1);
  const sky = (sunZ, moonDir) => {
    const sun = { dir: n([Math.sqrt(1 - sunZ * sunZ), 0, sunZ]), col: [255, 240, 200], size: r, bright: 1 };
    return { suns: [sun], moons: [{ dir: n(moonDir), col: [200, 200, 200], size: 0.08 }], main: sun, duskCol: [255, 140, 60], lock: false, I: 0.4, amb: 0.3, day: 0.2 };
  };
  const full = [-0.3, 0, 0.95];                                     // високо, майже навпроти сонця — повня
  let L = lightsOf(sky(zOf(0.01), full), 3).dirs;
  assert.equal(L.length, 2); assert.ok(L[0].dir[0] > 0.9, 'сонце на 1 % над обрієм — головне'); assert.ok(L[0].k > L[1].k * 5);
  L = lightsOf(sky(-0.05, full), 3).dirs;
  assert.equal(L.length, 1); assert.ok(L[0].dir[2] > 0.9, 'сонце під обрієм — головний місяць');
  const bFull = L[0].b, bNew = lightsOf(sky(-0.05, [0.95, 0, 0.3]), 3).dirs[0].b;   // за 17° від сонця — вузький серп
  assert.ok(bNew < bFull * 0.05, 'серп світить у десятки разів слабше за повню');
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

test('тіла: левітуюче висить на висоті ширяння, звичайне падає й лежить; удар — легке відлітає, важке ледь зрушить; на тіло можна стати', async () => {
  const { configureBodies } = await import('../js/engine/physics/bodies.js'); const { solidB: sB } = await import('../js/gen/chunk.js'); const pl = await import('../js/player.js'); const { LEVEL: LV } = await import('../js/iso.js');
  configureBodies({ level: LV, solid: sB, gravity: pl.GRAVITY, refMass: pl.PLAYER_MASS, refArea: pl.PLAYER_AREA });
  const { makeBody, stepBody, push, rayBody } = await import('../js/engine/physics/bodies.js'); const { HIT_IMPULSE } = pl;
  const P = world(Array(40).fill('4'.repeat(40))), env = { g: 1, vT: 20, bounce: 0, friction: 1, wind: [0, 0] };
  const run = (b, n) => { for (let i = 0; i < n; i++) stepBody(b, 1 / 60, P, env); };
  const fl = makeBody({ x: 20.5, y: 20.5, z: 4 * LEVEL + 2, hx: 0.2, hy: 0.2, hz: 0.15, lift: 1.3, hover: 1.5 });
  fl.sleep = false; run(fl, 300);
  assert.ok(Math.abs(fl.z - fl.hz - (4 * LEVEL + 1.5)) < 0.1, `висота ширяння: ${fl.z}`);
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
  for (let i = 0; i < 60; i++) { step(q, 1, 0, false, 1 / 60, C, PH1, mb); if (q.air) { fell = true; assert.ok(!q.jumped, 'падіння — не стрибок'); } }
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
  const P = world(Array(60).fill('4'.repeat(60))), env = { g: 1.28, vT: 18, bounce: 0, friction: 1, wind: [9, 0] };
  const mk = (h) => makeBody({ x: 30.5, y: 30.5, z: 4 * LEVEL + 1.5, hx: h, hy: h, hz: h * 0.6, lift: 1.4, hover: 1.5 });
  const small = mk(0.15), big = mk(1.2);
  for (let i = 0; i < 600; i++) { stepBody(small, 1 / 60, P, env); stepBody(big, 1 / 60, P, env); }
  const ds = small.x - 30.5, db = big.x - 30.5;
  assert.ok(ds > 0.3 && ds < 8 && db >= 0 && db < ds * 0.5, `відхилення: легкий ${ds}, важкий ${db}`);
  const calm = mk(0.15);
  for (let i = 0; i < 300; i++) stepBody(calm, 1 / 60, P, { ...env, wind: [0, 0] });
  assert.ok(calm.sleep && Math.abs(calm.x - 30.5) < 1e-6, 'без вітру спить на місці');
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
