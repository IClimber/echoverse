// carry.js — тіло в руках (п. 3 roadmap): чи піднімеш, кидок, утримання перед грудьми. Без DOM.
// Вага = маса · g · (1 − підйом породи) — не більше LIFT_W (50 кг при 1 g, 131 — при 0,38 g, 16 — при 3 g) і маса не
// більше M_MAX. Тримається перед грудьми (швидкість до точки, b.held — без тяжіння, поля й вітру), далі DROP_D — випадає
import { push } from './engine/physics/bodies.js';
import { HIT_IMPULSE, FOOT, BODY } from './player.js';

export const LIFT_W = 50, M_MAX = 300, HOLD_K = 12, HOLD_V = 15, THROW_V = 14, DROP_D = 1.5;
export const weightOf = (b, gg) => b.mass * gg * (1 - Math.min(1, b.lift || 0));
// Чи можна взяти тіло b за гравітації gg: {ok, w — вага, max — найбільша маса, яку тут можна підняти}
export function canLift(b, gg) {
  const w = weightOf(b, gg);
  return { ok: w <= LIFT_W && b.mass <= M_MAX, w, max: Math.min(M_MAX, gg > 0 ? LIFT_W / gg : Infinity) };
}
// Кинути уздовж d (одиничний): імпульс HIT_IMPULSE уздовж погляду + 0,25 угору, швидкість не більше THROW_V
export function throwBody(b, d) {
  b.held = false; b.dirty = true;
  b.vx = b.vy = b.vz = 0;
  push(b, [d[0] * HIT_IMPULSE, d[1] * HIT_IMPULSE, (d[2] + 0.25) * HIT_IMPULSE]);
  const v = Math.hypot(b.vx, b.vy, b.vz);
  if (v > THROW_V) { b.vx *= THROW_V / v; b.vy *= THROW_V / v; b.vz *= THROW_V / v; }
}
// Точка тримання: ноги + 0,55 · висота пози, уперед за поглядом d на R + піврозміру тіла + 0,25 (у першій особі — ще
// 0,4 · d_z); швидкість тіла — до неї. false — далі DROP_D: випадає
export function holdBody(b, me, d, first) {
  const dl = Math.hypot(d[0], d[1]) || 1, h = me.h || BODY, reach = FOOT + Math.max(b.hx, b.hy) + 0.25;
  const px = me.x + d[0] / dl * reach, py = me.y + d[1] / dl * reach, pz = me.z + 0.55 * h + (first ? 0.4 * d[2] : 0);
  const dx = px - b.x, dy = py - b.y, dz = pz - b.z;
  if (Math.hypot(dx, dy, dz) > DROP_D) return false;
  let vx = dx * HOLD_K, vy = dy * HOLD_K, vz = dz * HOLD_K;
  const v = Math.hypot(vx, vy, vz);
  if (v > HOLD_V) { vx *= HOLD_V / v; vy *= HOLD_V / v; vz *= HOLD_V / v; }
  b.vx = vx; b.vy = vy; b.vz = vz; b.yaw = me.yaw;
  return true;
}
