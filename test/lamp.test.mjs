// Ліхтарик гравця (L, 13.10.2026): дія клавіші, положення й напрям (перша особа — з ока без тіні, третя — зі скла на лобі
// з тінню, перед перешкодою), ліхтарик на фігурі, перешкода на відрізку (видима поверхня)
import test from 'node:test';
import assert from 'node:assert/strict';
import { devKey, takeActions, clearInput } from '../js/input.js';
import { lampPose, segHit, LAMP } from '../js/lamp.js';
import { animate } from '../js/anim.js';
import { figureParts, LAMP_AT, FIG_K } from '../js/gen/mesh.js';
import { B_AIR, B_STONE } from '../js/gen/chunk.js';

test('L — дія lamp, без повтору, поки клавішу тримають', () => {
  clearInput();
  devKey('KeyL');
  assert.ok(takeActions().includes('lamp'));
  devKey('KeyL');
  assert.ok(!takeActions().includes('lamp'), 'утримання — без повтору');
  devKey('KeyL', false); devKey('KeyL');
  assert.ok(takeActions().includes('lamp'));
  clearInput();
});

test('ліхтарик: конус 45° від краю до краю (кути від осі), 50 м', () => {
  assert.equal(LAMP.inner + LAMP.outer, 45);
  assert.ok(LAMP.inner < LAMP.outer && LAMP.outer < 45);
  assert.equal(LAMP.range, 50);
});

test('перша особа — з ока, уздовж погляду, без тіні', () => {
  const r = lampPose({ first: true, eye: [1, 2, 3], look: [0, 1, 0] });
  assert.deepEqual(r, { pos: [1, 2, 3], dir: [0, 1, 0], shadow: false });
});

const stand = () => { const me = { pose: 'stand', look: { p: 0, y: 0 } }; let a; for (let i = 0; i < 200; i++) a = animate(me, 1 / 60, i * 16); return a; };

test('третя особа — зі скла на лобі фігури, з тінню; перешкода — джерело перед нею', () => {
  const anim = stand(), yaw = 0.7, foot = [10, 20, 5], look = [0.6, 0.8, 0];
  const r = lampPose({ first: false, look, anim, foot, yaw, safe: [10, 20, 6], hit: () => Infinity });
  const c = Math.cos(yaw), s = Math.sin(yaw), want = [10 + c * 0.1875, 20 + s * 0.1875, 5 + 0.994];
  assert.ok(Math.hypot(r.pos[0] - want[0], r.pos[1] - want[1], r.pos[2] - want[2]) < 0.05, `скло: ${r.pos} (очікувано ${want})`);
  const hz = Math.hypot(r.pos[0] - 10, r.pos[1] - 20);
  assert.ok(hz > 0.15 && hz < 0.23 && r.pos[2] - 5 > 0.9 && r.pos[2] - 5 < 1.06, `від ніг ${hz}, висота ${r.pos[2] - 5}`);
  assert.equal(r.shadow, true);
  assert.deepEqual(r.dir, look);
  // перешкода на 0,05 від цілі камери — джерело за 3 см перед нею
  const q = lampPose({ first: false, look, anim, foot, yaw, safe: [10, 20, 6], hit: () => 0.05 });
  assert.ok(Math.abs(Math.hypot(q.pos[0] - 10, q.pos[1] - 20, q.pos[2] - 6) - 0.02) < 1e-9);
});

test('фігура: ліхтарик на лобі, точка світла перед склом у межах висоти голови', () => {
  const H = figureParts([200, 80, 60]).head.pos;
  let mx = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < H.length; i += 3) { mx = Math.max(mx, H[i]); z0 = Math.min(z0, H[i + 2]); z1 = Math.max(z1, H[i + 2]); }
  assert.ok(mx >= 0.17 && mx < 0.11 * FIG_K + 0.05, `перед голови: ${mx}`);
  assert.ok(LAMP_AT[0] > mx && LAMP_AT[2] > z0 && LAMP_AT[2] < z1, `точка світла ${LAMP_AT}`);
});

test('перешкода на відрізку: стеля над головою — так, відкрите небо — ні', () => {
  const world = (f) => ({
    liquid: { swim: true, danger: '', density: 1, visc: 1 }, obj: () => null, bodies: () => [],
    block: (x, y, k) => (Math.abs(x) > 40 || Math.abs(y) > 40 ? -1 : f(x, y, k)),
  });
  const cave = world((x, y, k) => (k < 2 || k >= 6 ? B_STONE : B_AIR));        // підлога z 1, стеля z 3
  const t = segHit(cave, [0.5, 0.5, 1.5], [0, 0, 1], 5);
  assert.ok(Math.abs(t - 1.5) < 0.05, `стеля: ${t}`);
  const open = world((x, y, k) => (k < 2 ? B_STONE : B_AIR));
  assert.equal(segHit(open, [0.5, 0.5, 1.5], [0, 0, 1], 5), Infinity);
});
