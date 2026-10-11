// Прицілювання й дії п. 3 roadmap: ціль уздовж променя (блок за згладженою поверхнею, тіло, рослина, досяжність),
// промінь з курсора (згори й у перспективі — той самий, що малюється), тіло в руках (чи піднімеш, утримання, кидок).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL } from '../js/iso.js';
import { B_AIR, B_STONE, solidB } from '../js/gen/chunk.js';
import { aimRay, blockDDA, isoAim, screenRay, REACH } from '../js/aim.js';
import { createCamera, setYaw, viewProj, project, ISO, THIRD } from '../js/camera.js';
import { makeBody, stepBody, configureBodies } from '../js/engine/physics/bodies.js';
import { GRAVITY, PLAYER_MASS, PLAYER_AREA, HIT_IMPULSE } from '../js/player.js';
import { canLift, holdBody, throwBody, THROW_V, LIFT_W } from '../js/carry.js';

configureBodies({ level: LEVEL, solid: solidB, gravity: GRAVITY, refMass: PLAYER_MASS, refArea: PLAYER_AREA });

// Світ з функції блоків; тіла — список; за межами ±lim — не згенеровано
const world = (f, bodies = [], lim = 40) => ({
  liquid: { swim: true, danger: '', density: 1, visc: 1 }, obj: () => null,
  bodies: (x, y, r) => bodies.filter((b) => Math.hypot(b.x - x, b.y - y) < r + 2),
  block: (x, y, k) => (Math.abs(x) > lim || Math.abs(y) > lim ? -1 : k < -2 ? B_STONE : f(x, y, k)),
});
const norm = (v) => { const l = Math.hypot(...v); return v.map((a) => a / l); };
// Підлога — верх k = 1 (z 1); з x ≥ 5 — уступ в 1 блок (k = 2, z 1,5); x ≥ 9 — стіна до k = 12
const step = (x, y, k) => (k < 2 || (x >= 5 && k < 3) || (x >= 9 && k < 13) ? B_STONE : B_AIR);

test('ціль: блок за згладженою поверхнею — твердий, а не повітря, де влучив промінь', () => {
  const P = world(step);
  let behind = 0;
  for (let x = 4.05; x < 5.6; x += 0.1) {
    const a = aimRay(P, null, [x, 0.5, 2.5], [0, 0, -1], REACH);
    assert.ok(a && a.kind === 'block', `x ${x}: ${a && a.kind}`);
    assert.ok(solidB(P.block(a.x, a.y, a.k)), `x ${x}: блок ${a.x} ${a.k} — не твердий`);
    // точка влучання на фасці кута — у повітряному блоці, ціль — твердий під нею
    if (P.block(Math.floor(a.p[0]), Math.floor(a.p[1]), Math.floor(a.p[2] / LEVEL)) === B_AIR) behind++;
    assert.equal(a.n[2], 1, 'грань входу — верх');
  }
  assert.ok(behind >= 2, `влучань у фаску над повітряним блоком: ${behind}`);
  // DDA сам по собі: перший твердий уздовж променя
  const q = blockDDA(P, [2.5, 0.5, 2.2], norm([1, 0, -0.32]), 20);
  assert.deepEqual([q.x, q.k, q.n[0]], [5, 2, -1]);
});

test('ціль: тіло перед стіною — тіло; рослина перед землею — предмет; далі REACH — нічого', () => {
  const body = makeBody({ x: 7, y: 0.5, z: 1.5, hx: 0.2, hy: 0.2, hz: 0.12 });
  const P = world(step, [body]);
  const a = aimRay(P, null, [5.2, 0.5, 1.62], [1, 0, 0], REACH);
  assert.ok(a && a.kind === 'body' && a.body === body && Math.abs(a.t - (7 - 0.2 - 5.2)) < 1e-6, JSON.stringify(a && { k: a.kind, t: a.t }));
  // рослина (циліндр r 0,3 на 0…0,4 над землею) у клітинці (3, 0); з неї — земля
  const plant = { o: { cx: 3.5, cy: 0.5, z: 2, r: 0, top: 0, ar: 0.3, az0: 0, ah: 0.4 }, C: { cx: 0, cy: 0 } };
  const objAt = (x, y) => (x === 3 && y === 0 ? plant : null);
  const d = norm([1.5, 0, -0.2]), b = aimRay(P, objAt, [2, 0.5, 1.2], d, REACH);
  assert.ok(b && b.kind === 'obj' && b.obj === plant, b && b.kind);
  assert.ok(Math.abs(b.p[0] - 3.2) < 0.01, `вхід у циліндр: ${b.p[0]}`);
  // без рослини — земля далі
  const c = aimRay(P, null, [2, 0.5, 1.2], d, REACH);
  assert.ok(c && c.kind === 'block' && c.t > b.t);
  // стіна за 4 — далі досяжності
  assert.equal(aimRay(P, null, [5.0, 0.5, 3], [1, 0, 0], REACH), null);
  assert.ok(aimRay(P, null, [5.0, 0.5, 3], [1, 0, 0], 5).kind === 'block');
});

test('промінь з курсора — той самий, що малюється (згори при 30°, 45°, 135°; третя особа); згори ціль — як перебором', () => {
  // вежа 2×2 до k = 10 на підлозі k < 2; світ — ±60 (початок променя — за 400 від цілі, там не згенеровано)
  const tower = (x, y, k) => (k < 2 || (x >= 3 && x <= 4 && y >= 3 && y <= 4 && k < 11) ? B_STONE : B_AIR);
  const P = world(tower, [], 60), W = 1600, H = 900, target = [4, 4, 1];
  for (const az of [30, 45, 135]) {
    const c = createCamera(ISO);
    setYaw(c, az * Math.PI / 180);
    const { m } = viewProj(c, W, H);
    let hits = 0, n = 0;
    for (let gy = -3; gy <= 10; gy++) for (let gx = -3; gx <= 10; gx++) {
      // центр верхньої грані: вежа — z 5,5, підлога — z 1
      const top = tower(gx, gy, 2) ? 5.5 : 1, Q = [gx + 0.5, gy + 0.5, top];
      const s = project(m, [Q[0] - target[0], Q[1] - target[1], Q[2] - target[2]], W, H);
      const ray = screenRay(c, target, null, s[0], s[1], W, H);
      // промінь проходить через Q
      const t = (Q[0] - ray.o[0]) * ray.d[0] + (Q[1] - ray.o[1]) * ray.d[1] + (Q[2] - ray.o[2]) * ray.d[2];
      const e = Math.hypot(ray.o[0] + ray.d[0] * t - Q[0], ray.o[1] + ray.d[1] * t - Q[1], ray.o[2] + ray.d[2] * t - Q[2]);
      assert.ok(e < 1e-3, `азимут ${az}: промінь мимо на ${e}`);
      // перебір: перший твердий блок кроком 0,01
      let bx = null;
      for (let u = 0; u < 900; u += 0.01) {
        const p = [ray.o[0] + ray.d[0] * u, ray.o[1] + ray.d[1] * u, ray.o[2] + ray.d[2] * u];
        const b = P.block(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2] / LEVEL));
        if (b === -1) continue;                     // незгенероване — повітря (як isoAim)
        if (solidB(b)) { bx = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2] / LEVEL)]; break; }
      }
      if (!bx) continue;
      const a = isoAim(P, null, ray);
      n++;
      if (a && a.kind === 'block' && a.x === bx[0] && a.y === bx[1] && a.k === bx[2]) hits++;
    }
    // розбіжність — лише біля граней вежі (поверхня плавна: фаска вже за краєм блоку)
    assert.ok(n > 150 && hits / n > 0.93, `азимут ${az}: ${hits} / ${n}`);
  }
  // третя особа: промінь з ока через точку, що малюється в (sx, sy)
  const c = createCamera(THIRD);
  setYaw(c, 1.1);
  c.pitch3 = 0.4;
  const { m, eye } = viewProj(c, W, H);
  for (const Q of [[1, 2, 0.5], [-3, 1, 2], [0.5, -2, -1]]) {
    const s = project(m, Q, W, H), ray = screenRay(c, [0, 0, 0], eye, s[0], s[1], W, H);
    const v = [Q[0] - ray.o[0], Q[1] - ray.o[1], Q[2] - ray.o[2]], l = Math.hypot(...v);
    assert.ok(Math.abs((v[0] * ray.d[0] + v[1] * ray.d[1] + v[2] * ray.d[2]) / l - 1) < 1e-6, `третя особа: ${Q}`);
  }
});

test('тіло в руках: чи піднімеш — від ваги (маса · g · (1 − підйом)); утримання без тяжіння; кидок — уздовж погляду, ≤ THROW_V', () => {
  const stone = (m, lift = 0) => { const hx = Math.cbrt(m / 8640); return makeBody({ x: 0.5, y: 0.5, z: 1, hx, hy: hx, hz: 0.6 * hx, lift }); };
  assert.ok(canLift(stone(45), 1).ok);
  assert.ok(!canLift(stone(60), 1).ok);
  assert.ok(canLift(stone(120), 0.38).ok);
  assert.ok(!canLift(stone(20), 3).ok);
  assert.ok(Math.abs(canLift(stone(20), 1).max - LIFT_W) < 1e-9);
  assert.ok(canLift(stone(250, 1.3), 1).ok, 'левітуюче — вага 0');
  assert.ok(!canLift(stone(400, 1.3), 1).ok, 'і левітуюче — не більше M_MAX');
  // утримання: held — без тяжіння, тримається біля точки перед грудьми; без held — падає
  const P = world((x, y, k) => (k < 2 ? B_STONE : B_AIR)), env = { g: 1, vT: 18, bounce: 0, friction: 1, wind: [0, 0] };
  const me = { x: 0.5, y: 0.5, z: 1, h: 0.98, yaw: 0 }, b = stone(20), free = stone(20);
  b.held = true; b.sleep = free.sleep = false; b.z = free.z = 2;
  for (let i = 0; i < 240; i++) {
    assert.ok(holdBody(b, me, [1, 0, 0], false));
    stepBody(b, 1 / 120, P, env); stepBody(free, 1 / 120, P, env);
  }
  assert.ok(Math.abs(b.z - (1 + 0.55 * 0.98)) < 0.02 && b.x > 0.9, `тримається: ${b.x} ${b.z}`);
  assert.ok(free.z < 1.2, `без рук падає: ${free.z}`);
  // далі 1,5 від точки — випадає
  me.x = 5;
  assert.equal(holdBody(b, me, [1, 0, 0], false), false);
  // кидок
  for (const [m, d] of [[5, norm([1, 0.3, 0.2])], [45, norm([-0.2, 1, -0.1])]]) {
    const s = stone(m);
    s.held = true;
    throwBody(s, d);
    const v = [s.vx, s.vy, s.vz], vl = Math.hypot(...v), w = norm([d[0], d[1], d[2] + 0.25]);
    assert.ok(!s.held && vl <= THROW_V + 1e-9, `швидкість ${vl}`);
    assert.ok(Math.acos(Math.min(1, (v[0] * w[0] + v[1] * w[1] + v[2] * w[2]) / vl)) < Math.PI / 180, 'напрям');
    if (m === 45) assert.ok(Math.abs(vl - HIT_IMPULSE / s.mass * Math.hypot(d[0], d[1], d[2] + 0.25)) < 1e-6, 'важче — імпульс / маса');
  }
});
