// anim.js — анімація фігури гравця (лише вигляд): хода — ноги й руки навхрест, коліно згинається в маху, похитування,
// стрибок — руки вгору й ноги підібгані, падіння (не після стрибка) — руки трохи вперед і в сторони, приземлення — присідання, спокій — дихання;
// плавання (як у Minecraft): у русі тіло лягає горизонтально, руки гребуть брасом (уперед — у сторони — назад),
// ноги часто б'ють; на місці — тіло вертикально, руки повільно розводяться, ноги ступають у воді; під рідиною — тіло за
// напрямком руху; ширяння — руки розкинуті; присів — стегна вперед, коліна зігнуті, нахил у поясі; лежить — горизонтально,
// руки й коліна поперемінно; стіна, драбина — руки поперемінно вгору, коліна навхрест; сповзання — нахил назад, руки
// розведені; з тілом у руках — обидві руки вперед; удар — права рука вперед, кинути — обидві; голова — туди, куди погляд.
// Стан — у me.anim; кути плавно наздоганяють ціль, тож переходи без ривків. Ступні на землі: тіло опускається на стільки,
// на скільки зігнуті ноги (висота кульша — стегно й гомілка)
import { chain, translate, rotZ, rotY, rotX, scale } from './engine/core/mat.js';
import { PIVOT, SHIN_F, SHIN_B, HAND_Z } from './gen/mesh.js';

const RATE = 14;                     // як швидко кути наздоганяють ціль, 1/с
const STRIDE = 11;                   // кроків (радіан фази) на секунду при звичайній швидкості
const SEG = PIVOT.hip - PIVOT.knee;  // довжина стегна й гомілки (однакові)
// висота кульша над найнижчою точкою гомілки: стегно під кутом a вперед від вертикалі, коліно зігнуте на b (гомілка —
// брусок: нахилена, вона спирається на ребро — переднє, коли ступня позаду, заднє — коли попереду)
export const hipH = (a, b) => SEG * (Math.cos(a) + Math.cos(a - b)) + (a - b < 0 ? SHIN_F : SHIN_B) * Math.abs(Math.sin(a - b));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const KEYS = ['legL', 'legR', 'kneeL', 'kneeR', 'armL', 'armR', 'up', 'tuck', 'bob', 'lean', 'waist', 'spread', 'drop', 'shift', 'lookP', 'lookY'];

// me — стан гравця (player.js) і ще: look {p — нахил погляду (+ — униз), y — поворот відносно тіла}, carry (тіло в руках),
// hitAt / throwAt / takeAt / useAt — мітки дій (мс)
export function animate(me, dt, now, speedK = 1) {
  const a = me.anim || (me.anim = { phase: 0, land: 0, lift: 0, wasAir: false, ...Object.fromEntries(KEYS.map((k) => [k, 0])) });
  const T = Object.fromEntries(KEYS.map((k) => [k, 0]));       // цілі цього кадру
  let lift = 0, rigid = true;
  const pose = me.pose || 'stand', cl = me.climb;
  if (cl) {                                                     // стіна, драбина: обличчям до стіни, руки й коліна поперемінно
    const f = (me.climbD || 0) * (cl.kind === 'wall' ? 5 : 10), s = Math.sin(f);
    if (me.moving) { T.armL = 2.6 + 0.5 * s; T.armR = 2.6 - 0.5 * s; T.kneeL = 0.75 + 0.45 * s; T.kneeR = 0.75 - 0.45 * s; T.legL = 0.35 + 0.25 * s; T.legR = 0.35 - 0.25 * s; }
    else { T.armL = T.armR = 2.4; T.kneeL = T.kneeR = 0.5; T.legL = T.legR = 0.25; }
    if (me.leapT > 0) { T.armL = T.armR = 3.0; }
    T.lean = -0.05; T.spread = 0.25;
  } else if (me.mantle > 0) {                                   // виліз нагору
    T.armL = T.armR = 0.5; T.lean = 0.6; T.legL = 0.5; T.kneeL = 1.0;
  } else if (pose === 'crawl') {                                // лежить: горизонтально, руки вперед поперемінно
    if (me.moving) a.phase += dt * 6 * speedK;
    const s = Math.sin(a.phase);
    T.lean = 1.5; T.shift = -1.3; lift = 0.12;
    T.armL = 2.95 + 0.3 * s; T.armR = 2.95 - 0.3 * s; T.spread = 0.2;
    T.kneeL = 0.4 + 0.4 * s; T.kneeR = 0.4 - 0.4 * s; T.legL = -0.1 * s; T.legR = 0.1 * s;
  } else if (me.swim && me.moving || pose === 'swim' || (me.dive && me.moving)) {   // пливе: горизонтально, руки брасом, ноги б'ють
    a.phase = (a.phase + dt * 4.5 * speedK) % (2 * Math.PI);
    const t = a.phase;
    // гребок (0…π): з витягнутих уперед рук — через сторони до стегон (поворот у площині плечей);
    // повернення (π…2π): уздовж тіла знову вперед
    if (t < Math.PI) { T.spread = Math.PI - t; T.up = 0; } else { T.spread = 0; T.up = t - Math.PI; }
    const kick = 0.3 * Math.sin(t * 3);
    // під рідиною — за напрямком руху (униз — головою вниз)
    const vh = Math.hypot(me.vx || 0, me.vy || 0), tilt = me.dive || pose === 'swim' ? Math.atan2(-(me.vz || 0), Math.max(0.3, vh)) : 0;
    T.lean = clamp(1.35 + tilt, 0.3, 2.6); lift = me.dive || pose === 'swim' ? 0.3 : 1.1; T.bob = 0.04 * Math.sin(t);
    T.shift = -0.85 * Math.sin(Math.min(T.lean, Math.PI - T.lean, 1.57));   // центр тіла — над формою, не голова в стіні
    T.legL = kick; T.legR = -kick;
  } else if (me.swim || me.dive) {                              // на місці: тримається вертикально
    a.phase += dt * 3;
    const s = Math.sin(a.phase);
    T.up = 0.5 + 0.25 * s; T.spread = 0.7 + 0.35 * s; T.legL = 0.35 * Math.sin(a.phase * 1.5); T.legR = -T.legL; T.bob = 0.035 * s; T.lean = 0.12;
    T.kneeL = T.kneeR = 0.3;
  } else if (me.fly) {                                          // летить: тіло нахилене вперед, руки трохи вбік, ноги разом
    T.up = 0.5; T.lean = me.moving ? 0.45 : 0.1; T.bob = 0.03 * Math.sin(now / 300); T.kneeL = T.kneeR = 0.2;
  } else if (me.air && me.glide) {                              // ширяє: руки розкинуті, ноги разом
    T.up = 0.15; T.spread = 1.45; T.lean = 0.15; T.bob = 0.02 * Math.sin(now / 200);
  } else if (me.air && me.jumped) {                             // стрибок: руки вгору, ноги підібгані
    if (me.vz > 0) { T.up = 2.6; T.legL = 0.7; T.legR = 0.28; T.kneeL = 1.2; T.kneeR = 0.6; } else { T.up = 1.4; T.legL = 0.25; T.legR = 0.1; T.kneeL = 0.5; T.kneeR = 0.3; }
  } else if (me.air) {                                          // падіння (з урвища): руки трохи вперед і в сторони, ноги прямі
    T.up = 0.55; T.spread = 0.45; T.legL = 0.08; T.legR = 0.03; T.lean = -0.05; T.bob = 0.015 * Math.sin(now / 90);
  } else if (me.slide) {                                        // сповзає: нахил назад, руки розведені, одна нога вперед
    T.lean = -0.35; T.spread = 1.0; T.up = 0.4; T.legL = 0.4; T.kneeL = 0.6; T.legR = -0.1; rigid = false;
  } else if (pose === 'crouch') {                               // присів: стегна вперед, коліна зігнуті, нахил у поясі
    rigid = false;
    let s = 0;
    if (me.moving) { a.phase += dt * STRIDE * 0.6 * speedK; s = Math.sin(a.phase); }
    T.legL = 1.25 + 0.3 * s; T.legR = 1.25 - 0.3 * s; T.kneeL = T.kneeR = 2.3; T.waist = 1.0;
    T.armL = -0.3 * s + 0.3; T.armR = 0.3 * s + 0.3;
  } else if (me.moving) {
    a.phase += dt * STRIDE * speedK;
    const s = Math.sin(a.phase), c = Math.cos(a.phase);
    T.legL = 0.65 * s; T.legR = -0.65 * s; T.armL = -0.55 * s; T.armR = 0.55 * s;
    // коліно згинається в маху (нога йде вперед)
    T.kneeL = 0.6 * Math.max(0, c); T.kneeR = 0.6 * Math.max(0, -c);
    T.bob = 0.06 * Math.abs(c); T.lean = 0.1;
  } else T.bob = 0.012 * (1 + Math.sin(now / 520));
  // тіло в руках — обидві руки вперед
  if (me.carry && !cl) { T.armL = T.armR = 1.35 - (T.waist || 0); T.up = 0; T.spread = -0.15; }
  // ступні на землі: тіло опускається на стільки, на скільки зігнута опорна нога
  const ground = !me.air && !me.swim && !me.dive && !me.fly && !cl && pose !== 'crawl' && pose !== 'swim';
  if (ground && !rigid) T.drop = PIVOT.hip - Math.max(hipH(T.legL, T.kneeL), hipH(T.legR, T.kneeR));
  else if (ground) T.drop = Math.max(0, PIVOT.hip - Math.max(hipH(T.legL, T.kneeL), hipH(T.legR, T.kneeR)));
  // голова — туди, куди погляд (відносно тулуба: нахил ±1,0, поворот ±1,2)
  const lk = me.look || { p: 0, y: 0 };
  // (лежачи голову назад — менше: інакше вона виходить за низький лаз)
  T.lookP = clamp(lk.p - T.lean - T.waist, pose === 'crawl' ? -0.5 : -1.0, 1.0); T.lookY = clamp(lk.y || 0, -1.2, 1.2);
  if (a.wasAir && !me.air) a.land = 1;
  a.wasAir = me.air;
  a.land = Math.max(0, a.land - dt * 7);
  const k = Math.min(1, dt * RATE), k2 = Math.min(1, dt * 6);   // тіло лягає й підводиться повільніше за махи
  for (const key of KEYS) a[key] += (T[key] - a[key]) * (key === 'lean' || key === 'shift' || key === 'drop' ? k2 * 1.6 : k);
  a.lift += (lift - a.lift) * k2;
  // дії: удар — права рука вперед і назад (0,3 с); кинути — обидві; взяти / покласти — обидві вперед-униз; використати — права ×0,6
  const ph = (t, ms) => { const x = t ? (now - t) / ms : 1; return x < 1 ? Math.sin(x * Math.PI) : 0; };
  a.punch = Math.max(ph(me.hitAt, 300), 0.6 * ph(me.useAt, 300));
  a.both = Math.max(ph(me.throwAt, 300), 0.6 * ph(me.takeAt, 300));
  return a;
}

// Матриці частин фігури: ox, oy, oz — ноги відносно камери. Нахил тулуба вперед — додатний поворот навколо поперечної
// осі, кінцівки (звисають) уперед — від'ємний. lean — уся фігура навколо ступень (плавання, політ), waist — тулуб навколо
// кульша (присів), drop — опускання на зігнутих ногах, shift — зсув уздовж погляду (лежачи: центр тіла — над капсулою)
export function poseMatrices(a, ox, oy, oz, yaw) {
  const sq = a.land * 0.14;
  const base = chain(translate(ox, oy, oz + a.bob + (a.lift || 0)), rotZ(yaw), translate(a.shift || 0, 0, 0), scale(1 + sq / 2, 1 + sq / 2, 1 - sq), rotY(a.lean), translate(0, 0, -(a.drop || 0)));
  const torso = chain(base, translate(0, 0, PIVOT.hip), rotY(a.waist || 0), translate(0, 0, -PIVOT.hip));
  const thigh = (fwd) => chain(base, translate(0, 0, PIVOT.hip), rotY(-fwd), translate(0, 0, -PIVOT.hip));
  // гомілка: від стегна, згин коліна — назад
  const shin = (T, bend) => chain(T, translate(0, 0, PIVOT.knee), rotY(bend), translate(0, 0, -PIVOT.knee));
  // рука: уперед (fwd) і вбік (spread) навколо плеча; side — +1 ліва (+y), −1 права
  const arm = (side, fwd) => {
    const y = side * PIVOT.armY, z = PIVOT.shoulder;
    return chain(torso, translate(0, y, z), rotX(side * (a.spread || 0)), rotY(-fwd), translate(0, -y, -z));
  };
  const tL = thigh(a.legL + a.tuck), tR = thigh(a.legR + a.tuck * 0.4), both = (a.both || 0) * 1.4;
  return {
    core: torso,
    head: chain(torso, translate(0, 0, PIVOT.neck), rotZ(a.lookY || 0), rotY(a.lookP || 0), translate(0, 0, -PIVOT.neck)),
    legL: tL, legR: tR, shinL: shin(tL, a.kneeL || 0), shinR: shin(tR, a.kneeR || 0),
    armL: arm(1, a.armL + a.up + both),
    armR: arm(-1, a.armR + a.up + (a.punch || 0) * 1.6 + both),
  };
}

// Перша особа: руки в кадрі (шар «Руки»). b — базис камери {r, up, u} (u — від погляду до ока), eye — око в тих самих
// координатах, що й матриці, aspect — ширина / висота, fovY — кут огляду по вертикалі. Кисть — у точці екрана (±0,6, −0,75)
// на глибині 0,45 від ока, вісь кисть → плече — назовні, униз і до ока; хода — кисті похитуються навхрест, удар — права
// вперед, плавання й політ — руки нижче. Права рука (б'є) — праворуч на екрані. Камера не хитається (рішення 11.10.2026).
// Стіна й драбина — кисті вгорі поперемінно; тіло в руках — обидві ближче до центру; лежачи — унизу поперемінно; під
// рідиною — брасом (з центру в сторони)
const ARM_D = 0.45;
// у рідині: довжина руки, плече відносно ока (праворуч, угору, уперед — винесено в кадр, як руки першої особи в іграх),
// стиснення вертикалі й нахил уперед напрямку руки — щоб гребок фігури йшов у кадрі (видно ~75 % циклу замість ~30 %)
const ARM_L = PIVOT.shoulder - HAND_Z, SH_R = 0.2, SH_UP = -0.15, SH_F = 0.25, SQ_UP = 0.35, FWD_B = 1.0;
// Поля стану гравця, які читає viewArms: сцена отримує знімок гравця (main.js) — саме з цими полями (тест — play.test)
export const VIEW_KEYS = ['yaw', 'swim', 'dive', 'wet', 'fly', 'pose', 'climb', 'climbD', 'carry'];
export function viewArms(a, me, b, eye, aspect, fovY) {
  const ty = Math.tan(fovY / 2), { r, up, u } = b, low = me.swim || me.fly ? 0.05 : 0;
  const out = {};
  // у рідині (пливе, під рідиною, ще лежить після плавання) — руки за позою фігури, як її тінь
  const fig = !me.climb && !me.carry && (me.swim || me.dive || me.pose === 'swim' || (me.wet && a.lean > 0.5)) ? poseMatrices(a, 0, 0, 0, me.yaw) : null;
  for (const [part, s, py] of [['armR', 1, -PIVOT.armY], ['armL', -1, PIVOT.armY]]) {
    const sw = (part === 'armR' ? a.armR : -a.armL) * s || 0;
    let nx = s * 0.6, ny = -0.75 + 0.02 * sw / ty / ARM_D - low / ty / ARM_D, d = ARM_D - 0.015 * sw + (s > 0 ? 0.22 * (a.punch || 0) : 0) + 0.2 * (a.both || 0);
    const alt = Math.sin(me.climb ? (me.climbD || 0) * (me.climb.kind === 'wall' ? 5 : 10) : a.phase || 0) * s;
    if (me.climb) { nx = s * 0.45; ny = -0.1 + 0.25 * alt; d = 0.35; }
    else if (me.carry) { nx = s * 0.35; ny = -0.55; d = 0.5; }
    else if (me.pose === 'crawl') { nx = s * 0.5; ny = -0.85; d = 0.35 + 0.1 * alt; }
    let H, A;
    if (fig) {
      // у рідині — напрям руки фігури (ті самі згладжені кути, що й у тіні: брас, на місці, перехід на дно), плече — біля
      // ока в кадрі; кисть — на довжину руки від плеча
      // (рука фігури того самого боку екрана: трійка осей дзеркальна — ліва рука фігури праворуч у кадрі); вертикаль
      // напрямку стиснуто (SQ_UP), напрям нахилено вперед (FWD_B): гребок у сторони той самий, а рука не ховається
      // глибоко під кадр і за край
      const m = fig[s > 0 ? 'armL' : 'armR'];
      const dr = -(m[8] * r[0] + m[9] * r[1] + m[10] * r[2]), du = -(m[8] * up[0] + m[9] * up[1] + m[10] * up[2]) * SQ_UP;
      const df = m[8] * u[0] + m[9] * u[1] + m[10] * u[2] + FWD_B, dl = Math.hypot(dr, du, df) || 1;
      A = [0, 1, 2].map((i) => -(r[i] * dr + up[i] * du - u[i] * df) / dl);   // від кисті до плеча
      const S = [0, 1, 2].map((i) => eye[i] + r[i] * s * SH_R + up[i] * SH_UP - u[i] * SH_F);
      H = [0, 1, 2].map((i) => S[i] - A[i] * ARM_L);
    } else {
      const kx = nx * ty * aspect * d, ky = ny * ty * d;
      H = [0, 1, 2].map((i) => eye[i] - u[i] * d + r[i] * kx + up[i] * ky);
      A = [0, 1, 2].map((i) => s * 0.35 * r[i] - 0.45 * up[i] + u[i]);
      const al = Math.hypot(...A); A = A.map((v) => v / al);
    }
    const fa = -(u[0] * A[0] + u[1] * A[1] + u[2] * A[2]);
    let X = [0, 1, 2].map((i) => -u[i] - fa * A[i]);
    const xl = Math.hypot(...X); X = X.map((v) => v / xl);
    const Y = [A[1] * X[2] - A[2] * X[1], A[2] * X[0] - A[0] * X[2], A[0] * X[1] - A[1] * X[0]];
    const hz = HAND_Z, T = [0, 1, 2].map((i) => H[i] - py * Y[i] - hz * A[i]);
    out[part] = [X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, A[0], A[1], A[2], 0, T[0], T[1], T[2], 1];
  }
  return out;
}
