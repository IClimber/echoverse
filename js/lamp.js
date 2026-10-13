// lamp.js — налобний ліхтарик гравця (L; 13.10.2026): параметри й положення на кадр. Лише числа, без DOM і PlayCanvas
// (світло — кластерний прожектор PlayCanvas, scene.js; «Spot · Punctual — torch», manual graphics/lighting/lights.md).
// Рішення користувача: на лобі фігури; світить уздовж погляду камери (як приціл); конус 45° від краю до краю; дальність
// 50 м; тінь — лише в третій особі: у першій світло йде з ока, а з ока тіней не видно (кожна видима точка з'єднана зі
// світлом тим самим відрізком, що й з оком; світло крізь стіну падає лише на сховане нею)
import { poseMatrices } from './anim.js';
import { LAMP_AT } from './gen/mesh.js';
import { colliderOf } from './collision.js';
import { createList, clearList, rayCast } from './engine/physics/collide.js';

// inner / outer — від осі, як у PlayCanvas (shadow-renderer-local.js: fov тіні = 2·outer): повна яскравість до 18°, до 27°
// плавно гасне (smoothstep у spot.js) — пляма ~45°. Згасання — типове PlayCanvas, лінійне (R − d)/R: без адаптації
// експозиції обернено-квадратичне або сліпить зблизька, або не добиває. intensity — лінійна сила (від 1 PlayCanvas бере
// як є, sky.js pcIntensity): 2 — на 2 м ~1,7 сонця опівдні, на 25 м — як сонце. Зміщення тіні — приклад PlayCanvas
// clustered-spot-shadows
export const LAMP = { range: 50, inner: 18, outer: 27, intensity: 2, color: [1, 1, 1], bias: 0.4, normalBias: 0.1 };
const BACK = 0.03;                     // перешкода між ціллю камери й склом — джерело на стільки перед нею

const LST = createList(1024);
// Перешкода на відрізку o → o + d·maxT (d — одиничний): видима поверхня, стовбури, каміння, тіла (як aimRay) → t чи Infinity
export function segHit(P, o, d, maxT) {
  const e = [o[0] + d[0] * maxT, o[1] + d[1] * maxT, o[2] + d[2] * maxT];
  clearList(LST);
  colliderOf(P).gather(Math.min(o[0], e[0]) - 0.1, Math.min(o[1], e[1]) - 0.1, Math.min(o[2], e[2]) - 0.1, Math.max(o[0], e[0]) + 0.1, Math.max(o[1], e[1]) + 0.1, Math.max(o[2], e[2]) + 0.1, LST);
  const r = rayCast(LST, o[0], o[1], o[2], d[0], d[1], d[2], maxT, {});
  return r ? r.t : Infinity;
}

// Положення на кадр: {pos, dir, shadow}. first — перша особа: з ока eye, без тіні. Третя — зі скла на лобі: матриця голови
// пози (anim — стан анімації, foot — ноги, yaw — поворот фігури), з тінню; під низькою стелею голова фігури заходить у
// скелю — відрізок від цілі камери safe (вільна точка біля голови, camHead) до скла перевіряє hit(o, d, maxT) → t: є
// перешкода — джерело за BACK перед нею. look — одиничний погляд камери
export function lampPose({ first, eye, look, anim, foot, yaw, safe, hit }) {
  if (first) return { pos: [eye[0], eye[1], eye[2]], dir: [look[0], look[1], look[2]], shadow: false };
  const H = poseMatrices(anim, foot[0], foot[1], foot[2], yaw).head, [x, y, z] = LAMP_AT;
  let p = [H[0] * x + H[4] * y + H[8] * z + H[12], H[1] * x + H[5] * y + H[9] * z + H[13], H[2] * x + H[6] * y + H[10] * z + H[14]];
  const v = [p[0] - safe[0], p[1] - safe[1], p[2] - safe[2]], L = Math.hypot(v[0], v[1], v[2]);
  if (L > 1e-6 && hit) {
    const d = [v[0] / L, v[1] / L, v[2] / L], t = hit(safe, d, L);
    if (t < L) { const k = Math.max(0, t - BACK); p = [safe[0] + d[0] * k, safe[1] + d[1] * k, safe[2] + d[2] * k]; }
  }
  return { pos: p, dir: [look[0], look[1], look[2]], shadow: true };
}
