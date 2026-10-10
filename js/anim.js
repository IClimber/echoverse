// anim.js — анімація фігури гравця (лише вигляд): хода — ноги й руки навхрест і похитування,
// стрибок — руки вгору й ноги підібгані, падіння (не після стрибка) — руки трохи вперед і в сторони, приземлення — присідання, спокій — дихання;
// плавання (як у Minecraft): у русі тіло лягає горизонтально, руки гребуть брасом (уперед — у сторони — назад),
// ноги часто б'ють; на місці — тіло вертикально, руки повільно розводяться, ноги ступають у воді; ширяння — руки розкинуті;
// удар — права рука вперед.
// Стан — у me.anim; кути плавно наздоганяють ціль, тож переходи без ривків.
import { chain, translate, rotZ, rotY, rotX, scale } from './engine/core/mat.js';
import { PIVOT } from './gen/mesh.js';

const RATE = 14;                     // як швидко кути наздоганяють ціль, 1/с
const STRIDE = 11;                   // кроків (радіан фази) на секунду при звичайній швидкості

export function animate(me, dt, now, speedK = 1) {
  const a = me.anim || (me.anim = { phase: 0, leg: 0, arm: 0, up: 0, tuck: 0, bob: 0, lean: 0, land: 0, spread: 0, lift: 0, wasAir: false });
  let leg = 0, arm = 0, up = 0, tuck = 0, bob = 0, lean = 0, spread = 0, lift = 0;
  if (me.swim && me.moving) {                          // пливе: горизонтально, руки брасом, ноги б'ють
    a.phase = (a.phase + dt * 4.5 * speedK) % (2 * Math.PI);
    const t = a.phase;
    // гребок (0…π): з витягнутих уперед рук — через сторони до стегон (поворот у площині плечей);
    // повернення (π…2π): уздовж тіла знову вперед
    if (t < Math.PI) { spread = Math.PI - t; up = 0; } else { spread = 0; up = t - Math.PI; }
    leg = 0.3 * Math.sin(t * 3); lean = 1.35; lift = 0.38; bob = 0.03 * Math.sin(t);
  } else if (me.swim) {                                // на місці: тримається вертикально
    a.phase += dt * 3;
    const s = Math.sin(a.phase);
    up = 0.5 + 0.25 * s; spread = 0.7 + 0.35 * s; leg = 0.35 * Math.sin(a.phase * 1.5); bob = 0.035 * s; lean = 0.12;
  } else if (me.fly) {                                 // летить: тіло нахилене вперед, руки трохи вбік, ноги разом
    up = 0.5; lean = me.moving ? 0.45 : 0.1; bob = 0.03 * Math.sin(now / 300);
  } else if (me.air && me.glide) {                    // ширяє: руки розкинуті, ноги разом
    up = 0.15; spread = 1.45; lean = 0.15; bob = 0.02 * Math.sin(now / 200);
  } else if (me.air && me.jumped) {                   // стрибок: руки вгору, ноги підібгані
    if (me.vz > 0) { up = 2.6; tuck = 0.7; } else { up = 1.4; tuck = 0.25; }
  } else if (me.air) {                                 // падіння (з урвища): руки трохи вперед і в сторони, ноги прямі
    up = 0.55; spread = 0.45; tuck = 0.08; lean = -0.05; bob = 0.015 * Math.sin(now / 90);
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
  const k2 = Math.min(1, dt * 6);                      // тіло лягає й підводиться повільніше за махи
  a.spread += (spread - a.spread) * k; a.lift += (lift - a.lift) * k2;
  // удар: права рука різко вперед і назад (0,3 с)
  const ht = me.hitAt ? (now - me.hitAt) / 300 : 1;
  a.punch = ht < 1 ? Math.sin(ht * Math.PI) : 0;
  return a;
}

// Матриці частин фігури: ox, oy, oz — ноги відносно камери. Нахил тулуба вперед — додатний поворот навколо поперечної
// осі, кінцівки (звисають) уперед — від'ємний
export function poseMatrices(a, ox, oy, oz, yaw) {
  const sq = a.land * 0.14;
  const base = chain(translate(ox, oy, oz + a.bob + (a.lift || 0)), rotZ(yaw), scale(1 + sq / 2, 1 + sq / 2, 1 - sq), rotY(a.lean));
  const joint = (z, fwd) => chain(base, translate(0, 0, z), rotY(-fwd), translate(0, 0, -z));
  // рука: уперед (fwd) і вбік (spread) навколо плеча; side — +1 ліва (+y), −1 права
  const arm = (side, fwd) => {
    const y = side * PIVOT.armY, z = PIVOT.shoulder;
    return chain(base, translate(0, y, z), rotX(side * (a.spread || 0)), rotY(-fwd), translate(0, -y, -z));
  };
  return {
    core: base,
    legL: joint(PIVOT.hip, a.leg + a.tuck),
    legR: joint(PIVOT.hip, -a.leg + a.tuck * 0.4),
    armL: arm(1, -a.arm + a.up),
    armR: arm(-1, a.arm + a.up + (a.punch || 0) * 1.6),
  };
}
