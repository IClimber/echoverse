// anim.js — анімація фігури гравця (лише вигляд): хода — ноги й руки навхрест і похитування,
// стрибок — руки вгору й ноги підібгані, падіння — руки вперед, приземлення — присідання, спокій — дихання.
// Стан — у me.anim; кути плавно наздоганяють ціль, тож переходи без ривків.
import { chain, translate, rotZ, rotY, scale } from './mat.js';
import { PIVOT } from './gen/mesh.js';

const RATE = 14;                     // як швидко кути наздоганяють ціль, 1/с
const STRIDE = 11;                   // кроків (радіан фази) на секунду при звичайній швидкості

export function animate(me, dt, now, speedK = 1) {
  const a = me.anim || (me.anim = { phase: 0, leg: 0, arm: 0, up: 0, tuck: 0, bob: 0, lean: 0, land: 0, wasAir: false });
  let leg = 0, arm = 0, up = 0, tuck = 0, bob = 0, lean = 0;
  if (me.swim) {                                       // пливе: руки гребуть уперед, ноги б'ють
    a.phase += dt * 6;
    const s = Math.sin(a.phase);
    up = 1.5 + 0.9 * s; arm = 0; leg = 0.35 * Math.sin(a.phase * 2); bob = 0.04 * s; lean = 0.55;
  } else if (me.fly) {                                 // летить: тіло нахилене вперед, руки трохи вбік, ноги разом
    up = 0.5; lean = me.moving ? 0.45 : 0.1; bob = 0.03 * Math.sin(now / 300);
  } else if (me.air) {
    if (me.vz > 0) { up = 2.6; tuck = 0.7; } else { up = 1.4; tuck = 0.25; }
  } else if (me.moving) {
    a.phase += dt * STRIDE * speedK;
    const s = Math.sin(a.phase);
    leg = 0.65 * s; arm = 0.55 * s; bob = 0.045 * Math.abs(Math.cos(a.phase)); lean = 0.1;
  } else bob = 0.008 * (1 + Math.sin(now / 520));
  if (a.wasAir && !me.air) a.land = 1;
  a.wasAir = me.air;
  a.land = Math.max(0, a.land - dt * 7);
  const k = Math.min(1, dt * RATE);
  a.leg += (leg - a.leg) * k; a.arm += (arm - a.arm) * k; a.up += (up - a.up) * k;
  a.tuck += (tuck - a.tuck) * k; a.bob += (bob - a.bob) * k; a.lean += (lean - a.lean) * k;
  return a;
}

// Матриці частин фігури: ox, oy, oz — ноги відносно камери. Кут «уперед» — від'ємний поворот навколо поперечної осі
export function poseMatrices(a, ox, oy, oz, yaw) {
  const sq = a.land * 0.14;
  const base = chain(translate(ox, oy, oz + a.bob), rotZ(yaw), scale(1 + sq / 2, 1 + sq / 2, 1 - sq), rotY(-a.lean));
  const joint = (z, fwd) => chain(base, translate(0, 0, z), rotY(-fwd), translate(0, 0, -z));
  return {
    core: base,
    legL: joint(PIVOT.hip, a.leg + a.tuck),
    legR: joint(PIVOT.hip, -a.leg + a.tuck * 0.4),
    armL: joint(PIVOT.shoulder, -a.arm + a.up),
    armR: joint(PIVOT.shoulder, a.arm + a.up),
  };
}
