// Прицілювання й дії п. 3 roadmap: ціль уздовж променя (блок за згладженою поверхнею, тіло, рослина, досяжність),
// промінь з курсора (згори й у перспективі — той самий, що малюється), тіло в руках (чи піднімеш, утримання, кидок).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL } from '../js/laws/universe.js';
import { B_AIR, B_STONE, solidB } from '../js/gen/chunk.js';
import { aimRay, blockDDA, REACH } from '../js/player/aim.js';
import { makeBody, stepBody, configureBodies } from '../js/engine/physics/bodies.js';
import { GRAVITY, PLAYER_MASS, PLAYER_AREA, HIT_IMPULSE } from '../js/player/player.js';
import { canLift, holdBody, throwBody, THROW_V, LIFT_W } from '../js/player/carry.js';

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

test('F3: рядок цілі — для кожного предмета будь-якого всесвіту, з назвою (камінь — стиль: брила, колода…)', async () => {
  // 12.10.2026: у каменю форма виду 'stone', якої немає у FORMS — рядок кидав виняток і зупиняв цикл гри
  const { aimLine } = await import('../js/debug.js');
  const { lawsOf } = await import('../js/laws/universe.js');
  const { runJob } = await import('../js/gen/job.js');
  const { O_FLOAT, O_ROCK } = await import('../js/gen/chunk.js');
  const names = new Set();
  for (const [d, n] of [[0, 51119], [4, 777], [8, -4242], [12, 99]]) {
    const L = lawsOf(1178118268, d, n), cache = new Map();
    for (const [cx, cy] of [[290, 391], [-111, 123], [0, 0]]) {
      const C = runJob(L, { type: 'col', d, n, cx, cy }, cache).data;
      C.cx = cx; C.cy = cy;
      C.obj.forEach((o, i) => {
        if (o.k === O_FLOAT) return;
        const s = aimLine({ kind: 'obj', t: 1, obj: { o, C, i } }, 1);
        assert.match(s, /^(камінь|дерево|рослина) \(.+\) · /, s);
        if (o.k === O_ROCK) names.add(s);
      });
    }
  }
  assert.ok(names.size >= 1, 'каміння трапилось');
});

test('ціль: дерево й камінь — точно за трикутниками того, що малюється (обрис); повз гілки — не дерево', async () => {
  // 13.10.2026: циліндр на розмах гілок нахиленого дерева перекривав колоду поруч — обводилось дерево, а не колода
  const { lawsOf } = await import('../js/laws/universe.js');
  const { runJob } = await import('../js/gen/job.js');
  const { O_TREE, O_COVER, O_FLOAT, CS } = await import('../js/gen/chunk.js');
  const { objMesh } = await import('../js/gen/mesh.js');
  const { rayTriSoup } = await import('../js/engine/physics/collide.js');
  const P = world(() => B_AIR, [], 1e9);
  let rnd = 12345;
  const r = () => ((rnd = Math.imul(rnd, 1103515245) + 12345 >>> 0) / 4294967296);
  let n = 0, hits = 0, trees = 0;
  for (const [d, nn, cx, cy] of [[0, 0, 0, 0], [0, 51119, 290, 391], [4, 777, -111, 123], [8, -4242, 0, 0]]) {
    const L = lawsOf(1178118268, d, nn), C = runJob(L, { type: 'col', d, n: nn, cx, cy }, new Map()).data;
    C.cx = cx; C.cy = cy;
    for (const o of C.obj) {
      if (o.k === O_FLOAT || o.k === O_COVER) continue;
      if (o.k === O_TREE) trees++;
      const q = { o, C, L }, M = objMesh(C, L, o), p = M.pos.slice(), nv = M.count;
      // меш у світових координатах, без індексів
      const w = new Float64Array(nv * 3);
      for (let i = 0; i < nv; i++) { const j = M.idx[i] * 3; w[i * 3] = p[j] + cx * CS; w[i * 3 + 1] = p[j + 1] + cy * CS; w[i * 3 + 2] = p[j + 2]; }
      const bx = cx * CS + o.cx, by = cy * CS + o.cy, bz = o.z * LEVEL;
      for (let k = 0; k < 40; k++) {
        // ціль — випадкова точка в описаному циліндрі, око — за 2,5 м від неї
        const a = r() * 6.283, rr = (o.ar + 0.3) * Math.sqrt(r()), tz = bz + r() * (o.ah + 0.2);
        const dir = norm([r() - 0.5, r() - 0.5, (r() - 0.5) * 0.6]);
        const tgt = [bx + rr * Math.cos(a), by + rr * Math.sin(a), tz], eye = tgt.map((v, i) => v - dir[i] * 2.5);
        const want = rayTriSoup(w, nv, eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], 4);
        const objAt = (x, y) => (x === Math.floor(bx) && y === Math.floor(by) ? q : null);
        const got = aimRay(P, objAt, eye, dir, 4);
        n++;
        if (want === Infinity) assert.ok(!got || got.kind !== 'obj', `повз предмет — не ціль (${got && got.t})`);
        else { hits++; assert.ok(got && got.kind === 'obj' && Math.abs(got.t - want) < 1e-3, `влучання ${want} → ${got && got.kind} ${got && got.t}`); }
      }
    }
  }
  assert.ok(trees > 0 && hits > n * 0.1 && hits < n * 0.9, `дерев ${trees}, влучань ${hits} з ${n}`);
});
