// aim.js — ціль гравця (п. 3 roadmap): промінь з ока (перша й третя особа — уздовж погляду камери, як у Minecraft) чи з
// курсора (згори) до першого, у що влучає: видима поверхня (тоді блок — DDA по блоках від точки влучання: поверхня
// плавна, блок під нею — той, що зміниться в п. 6), тіло, предмет (стовбур, крона, трава, камінь — циліндри з даних
// стовпця). Без DOM.
// P — «щуп» світу (player.js); objAt(x, y) → {o, C} — предмет клітинки (world.js) чи null; o — початок, d — напрям
// (одиничний), maxT — довжина
import { colliderOf } from './collision.js';
import { createList, clearList, rayCast } from './engine/physics/collide.js';
import { solidB, CS } from './gen/chunk.js';
import { LEVEL, S } from './iso.js';
import { basis, fovOf, ISO } from './camera.js';

export const REACH = 3;              // досяжність рук (як удар)
const isBody = (r) => !!r && r.hz !== undefined;
const LST = createList(4096);

// Перший твердий блок уздовж променя (Amanatides & Woo 1987, клітинка 1 × 1 × LEVEL): {x, y, k, b, t, n: [нормаль грані
// входу]} чи null; незгенероване (−1) — стоп (null), з pass — повітря (згори промінь починається далеко за дальністю)
export function blockDDA(P, o, d, maxT, pass = false) {
  const oz = o[2] / LEVEL, dz = d[2] / LEVEL;
  let x = Math.floor(o[0]), y = Math.floor(o[1]), k = Math.floor(oz);
  const sx = d[0] > 0 ? 1 : -1, sy = d[1] > 0 ? 1 : -1, sk = dz > 0 ? 1 : -1;
  const tdx = d[0] ? Math.abs(1 / d[0]) : Infinity, tdy = d[1] ? Math.abs(1 / d[1]) : Infinity, tdk = dz ? Math.abs(1 / dz) : Infinity;
  let tx = d[0] ? (d[0] > 0 ? x + 1 - o[0] : o[0] - x) * tdx : Infinity;
  let ty = d[1] ? (d[1] > 0 ? y + 1 - o[1] : o[1] - y) * tdy : Infinity;
  let tk = dz ? (dz > 0 ? k + 1 - oz : oz - k) * tdk : Infinity;
  let t = 0, n = [0, 0, 0];
  for (let i = 0; i < 4096 && t <= maxT; i++) {
    const b = P.block(x, y, k);
    if (b === -1 && !pass) return null;
    if (b !== -1 && solidB(b)) return { x, y, k, b, t, n };
    if (tx < ty && tx < tk) { t = tx; tx += tdx; x += sx; n = [-sx, 0, 0]; }
    else if (ty < tk) { t = ty; ty += tdy; y += sy; n = [0, -sy, 0]; }
    else { t = tk; tk += tdk; k += sk; n = [0, 0, -sk]; }
  }
  return null;
}

// Промінь проти вертикального циліндра (cx, cy, r, z0…z1): відстань до входу чи Infinity (з середини — 0)
export function cylHit(o, d, cx, cy, r, z0, z1, maxT) {
  const ox = o[0] - cx, oy = o[1] - cy, a = d[0] * d[0] + d[1] * d[1];
  let t0 = 0, t1 = maxT;
  if (a < 1e-12) { if (ox * ox + oy * oy > r * r) return Infinity; }
  else {
    const b = ox * d[0] + oy * d[1], c = ox * ox + oy * oy - r * r, D = b * b - a * c;
    if (D < 0) return Infinity;
    const q = Math.sqrt(D);
    t0 = Math.max(t0, (-b - q) / a); t1 = Math.min(t1, (-b + q) / a);
  }
  if (Math.abs(d[2]) < 1e-12) { if (o[2] < z0 || o[2] > z1) return Infinity; }
  else {
    const a0 = (z0 - o[2]) / d[2], a1 = (z1 - o[2]) / d[2];
    t0 = Math.max(t0, Math.min(a0, a1)); t1 = Math.min(t1, Math.max(a0, a1));
  }
  return t0 <= t1 ? t0 : Infinity;
}

// Предмет o стовпця C (світові координати): найближче влучання в його циліндри — стовбур (o.r до o.top) і крона, рослина,
// брила (o.ar від o.az0 до o.ah) — або Infinity
function objT(o, C, ro, d, maxT) {
  const cx = C.cx * CS + o.cx, cy = C.cy * CS + o.cy, z = o.z * LEVEL;
  let t = Infinity;
  if (o.r > 0) t = cylHit(ro, d, cx, cy, o.r, z, z + o.top, maxT);
  if (o.ar > 0) t = Math.min(t, cylHit(ro, d, cx, cy, o.ar, z + (o.az0 || 0), z + o.ah, maxT));
  return t;
}

// Ціль уздовж променя: {kind: 'block' | 'body' | 'obj', t, p: [точка], n?, x, y, k, b (блок), body, obj: {o, C}} чи null
export function aimRay(P, objAt, o, d, maxT = REACH) {
  const e = [o[0] + d[0] * maxT, o[1] + d[1] * maxT, o[2] + d[2] * maxT];
  clearList(LST);
  colliderOf(P).gather(Math.min(o[0], e[0]) - 0.1, Math.min(o[1], e[1]) - 0.1, Math.min(o[2], e[2]) - 0.1, Math.max(o[0], e[0]) + 0.1, Math.max(o[1], e[1]) + 0.1, Math.max(o[2], e[2]) + 0.1, LST);
  const r = rayCast(LST, o[0], o[1], o[2], d[0], d[1], d[2], maxT, {});
  let best = null;
  const at = (t) => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  if (r && isBody(r.ref)) best = { kind: 'body', t: r.t, p: at(r.t), n: [r.nx, r.ny, r.nz], body: r.ref };
  else if (r && !r.ref) {
    // видима поверхня — блок під нею: DDA від точки трохи перед влучанням (поверхня плавна: блок може бути й глибше)
    const back = Math.min(0.3, r.t), s = at(r.t - back), q = blockDDA(P, s, d, back + 1.0);
    if (q) best = { kind: 'block', t: r.t, p: at(r.t), n: q.n, x: q.x, y: q.y, k: q.k, b: q.b };
  }
  // предмети (стовбур — і серед трикутників, крона й трава — лише тут): клітинки вздовж променя з запасом
  const prism = r && r.ref && !isBody(r.ref);
  let bt = best ? best.t : r ? r.t + (prism ? 0.05 : 0) : maxT, bo = null;
  if (objAt) {
    const R = 4, x0 = Math.floor(Math.min(o[0], e[0]) - R), x1 = Math.floor(Math.max(o[0], e[0]) + R), y0 = Math.floor(Math.min(o[1], e[1]) - R), y1 = Math.floor(Math.max(o[1], e[1]) + R);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const q = objAt(x, y);
      if (!q) continue;
      const t = objT(q.o, q.C, o, d, bt);
      if (t < bt) { bt = t; bo = q; }
    }
    if (!bo && prism) { bo = objAt(Math.floor(r.ref.cx), Math.floor(r.ref.cy)); bt = r.t; }   // стовбур без циліндра
  }
  if (bo) best = { kind: 'obj', t: bt, p: at(bt), obj: bo };
  return best;
}

// Промінь з курсора (sx, sy — у пікселях полотна W × H): згори — паралельний погляду, з площини на 400 від цілі;
// перспектива — з ока. target — ціль камери, eye — око відносно цілі. {o, d}
export function screenRay(c, target, eye, sx, sy, W, H) {
  const { r, up, u } = basis(c);
  if (c.mode === ISO) {
    const k = S * c.zoom, a = (sx - W / 2) / k, b = (H / 2 - sy) / k;
    return { o: [target[0] + r[0] * a + up[0] * b + u[0] * 400, target[1] + r[1] * a + up[1] * b + u[1] * 400, target[2] + r[2] * a + up[2] * b + u[2] * 400], d: [-u[0], -u[1], -u[2]] };
  }
  const f = Math.tan(fovOf(c) / 2), nx = (sx / W * 2 - 1) * f * W / H, ny = (1 - sy / H * 2) * f;
  const d = [-u[0] + r[0] * nx + up[0] * ny, -u[1] + r[1] * nx + up[1] * ny, -u[2] + r[2] * nx + up[2] * ny], l = Math.hypot(...d);
  return { o: [target[0] + eye[0], target[1] + eye[1], target[2] + eye[2]], d: [d[0] / l, d[1] / l, d[2] / l] };
}

// Ціль під курсором згори: довгий промінь (до 900) — спершу блоки (DDA; незгенероване — повітря: початок променя — за
// 400 від цілі, далеко за дальністю), біля першого твердого — точно (трикутники, тіла, предмети: коробка ±1,5 уздовж
// променя). Секції зіткнень уздовж усього променя будувати дорого
export function isoAim(P, objAt, ray) {
  const q = blockDDA(P, ray.o, ray.d, 900, true);
  // DDA минає тонке (рослина, крона, тіло, плавний горб над порожнім блоком): точний пошук — від висоти 12 над першим
  // твердим (дерева вищі — рідко) до 1,5 за ним
  const t0 = Math.max(0, (q ? q.t : 900) - Math.min(40, 12 / Math.max(0.3, Math.abs(ray.d[2])))), o = [ray.o[0] + ray.d[0] * t0, ray.o[1] + ray.d[1] * t0, ray.o[2] + ray.d[2] * t0];
  const a = aimRay(P, objAt, o, ray.d, (q ? q.t - t0 : 0) + 1.5);
  if (a) { a.t += t0; return a; }
  return q ? { kind: 'block', t: q.t, p: [ray.o[0] + ray.d[0] * q.t, ray.o[1] + ray.d[1] * q.t, ray.o[2] + ray.d[2] * q.t], n: q.n, x: q.x, y: q.y, k: q.k, b: q.b } : null;
}
