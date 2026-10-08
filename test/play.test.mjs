// Ізометрія, рух гравця, пристрій для стрибків, формат файлу збереження.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toScreen, fromScreen, pick, LEVEL } from '../js/iso.js';
import { step, hits, support, standable, SPEED, PH1, GRAVITY, JUMP_V, FLOAT_Z, jumpHeight, SPRINT, FLY_SPEED, FLY_V } from '../js/player.js';
import { landing, landingChunks, createDevice, CHARGE, HISTORY } from '../js/device.js';
import { serialize, deserialize } from '../js/save.js';
import { B_AIR, B_LIQ, B_GRASS, B_STONE } from '../js/gen/chunk.js';

// Світ з рядків: символ — стовпець. Цифра або буква a…z — висота суходолу в блоках (0…35; 'T' — висота 2 з деревом);
// 'w' — водойма: дно на 2, рідина до 6 (де можна плавати чи ні — liquid); поза мапою — не згенеровано (−1)
const SEA = 6;
function world(rows, liquid = { swim: true, why: '' }) {
  const hOf = (ch) => ch === 'T' ? 2 : /[0-9]/.test(ch) ? +ch : ch.charCodeAt(0) - 87;
  return {
    liquid,
    block(x, y, k) {
      const ch = rows[y] && rows[y][x];
      if (ch === undefined) return -1;
      if (k < 0) return B_STONE;
      if (ch === 'w') return k < 2 ? B_STONE : k < SEA ? B_LIQ : B_AIR;
      return k < hOf(ch) ? B_GRASS : B_AIR;
    },
    obj: (x, y) => rows[y] && rows[y][x] === 'T' ? 2 : -1,
  };
}
const at = (P, x, y) => { let k = 40; while (k > 0 && P.block(Math.floor(x), Math.floor(y), k - 1) === B_AIR) k--; return k * LEVEL; };
const man = (P, x, y) => ({ x, y, z: at(P, x, y), vz: 0, ground: true });
const run = (p, ix, iy, n, P, ph, jump = false) => { for (let i = 0; i < n; i++) step(p, ix, iy, jump && i === 0, 1 / 60, P, ph); };

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

test('рух: на уступ в 1 блок — сам, на 2 — ні; униз пішки — на 1 блок, на 2 — ні (сторожа)', () => {
  const P = world(['444444', '444566', '444444', '442444']);
  const p = man(P, 2.5, 1.5);
  run(p, 1, 1, 40, P);                                      // +x: 4 → 5 (крок), далі 5 → 6 (крок)
  assert.ok(p.x > 4.3 && Math.abs(p.z - 6 * LEVEL) < 1e-9, `на уступи: ${p.x} ${p.z}`);
  const q = man(P, 2.5, 1.5);
  run(q, -1, 1, 60, P);                                     // +y: 4 → 4 → 2 (униз на 2) — сторожа не пускає
  assert.ok(q.y < 3 + 0.25 && Math.abs(q.z - 4 * LEVEL) < 1e-9, `сторожа: ${q.y} ${q.z}`);
  assert.equal(hits(P, 10, 10, 0), true);                   // незгенероване — стіна
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

test('легка гравітація: пішки на 2 блоки; приземлення рахує вихід за гравітацією', () => {
  const light = { up: 2, down: 3, speed: 1, settle: 8, g: 0.5 };
  const P = world(['444444', '444688', '444444']);
  const p = man(P, 2.5, 1.5), q = man(P, 2.5, 1.5);
  run(p, 1, 1, 40, P);                                      // при 1 g: 4 → 6 — ні
  run(q, 1, 1, 40, P, light);                               // при 0,5 g — так, і далі 6 → 8
  assert.ok(p.x < 3.3 && q.x > 4.3 && Math.abs(q.z - 8 * LEVEL) < 1e-9, `${p.x} ${q.x} ${q.z}`);
  const pillar = world(['000', '060', '000']);               // стовп 6 і сусіди 0: при 1 g не зійти
  assert.equal(landing(pillar, 1.5, 1.5, 3, PH1)?.join(), '1.5,0.5,0');   // приземлиться поруч, на 0
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

test('приземлення: на місці, якщо можна; інакше найближче з виходом; ніде — null', () => {
  const P = world(['44444', '4www4', '4www4', '4www4', '44444'], { swim: false, why: 'лава' });
  assert.deepEqual(landing(P, 0.5, 0.5, 2), [0.5, 0.5, 2]);
  assert.deepEqual(landing(P, 2.5, 2.5, 2), [2.5, 0.5, 2]);                   // у лаву — ні, найближче на березі
  assert.equal(landing(world(Array(30).fill('w'.repeat(30)), { swim: false }), 15, 15, 2), null);
  assert.ok(landingChunks(0, 0, 16).length >= 4);
});

test('пристрій: заряджання, скасування повторним натисканням, історія', () => {
  const dev = createDevice([[0, 1]]);
  assert.equal(dev.start(1), 'start');
  assert.equal(dev.update(CHARGE / 2), false);
  assert.equal(dev.start(1), 'cancel');
  assert.equal(dev.charge, null);
  dev.start(-1);
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

test('плавання: з берега у воду й назад, у воді повільніше й без стрибка; у небезпечну рідину не пускає', () => {
  const rows = ['77777', '7www7', '7www7', '77777'];
  const P = world(rows), H = world(rows, { swim: false, why: 'лава' });
  const p = man(P, 0.5, 1.5);
  run(p, 1, 1, 40, P);                                      // +x: з берега (7) у воду
  run(p, 0, 0, 90, P);
  const surf = SEA * LEVEL - 0.15;
  assert.ok(p.swim && Math.abs(p.z - (surf - FLOAT_Z)) < 0.03, `пливе? ${p.swim} z ${p.z}`);
  const x0 = p.x;
  step(p, 1, 1, true, 1 / 60, P);
  assert.ok(p.vz < 2, 'з води стрибнув');
  assert.ok(p.x - x0 < SPEED * 0.6 * Math.SQRT2 / 60, 'у воді не повільніше');
  run(p, 1, 1, 120, P);                                     // далі — на берег (7 блоків)
  assert.ok(p.x > 4 && Math.abs(p.z - 7 * LEVEL) < 1e-9 && p.ground, `вийшов? ${p.x} ${p.z}`);
  const q = man(H, 0.5, 1.5);
  run(q, 1, 1, 60, H);
  assert.ok(q.x < 1.3 && q.why === 'лава', `у лаву: ${q.x} ${q.why}`);   // край берега — ноги ще над ним
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
