// aim.js — ціль гравця (п. 3 roadmap): промінь з ока уздовж погляду камери (як у Minecraft) до першого, у що влучає:
// видима поверхня (тоді блок — DDA по блоках від точки влучання: поверхня плавна, блок під нею — той, що зміниться
// в п. 6), тіло, предмет (стовбур, крона, трава, камінь — трикутники того самого шаблону, що малюється й обводиться,
// objShape; циліндр з даних стовпця лише відкидає зайве). Без DOM.
// P — «щуп» світу (player.js); objAt(x, y) → {o, C, L} — предмет клітинки (world.js) чи null; o — початок, d — напрям
// (одиничний), maxT — довжина
import { colliderOf } from './collision.js';
import { createList, clearList, rayCast, rayTriSoup } from './engine/physics/collide.js';
import { solidB, CS, O_COVER } from './gen/chunk.js';
import { objShape } from './gen/mesh.js';
import { LEVEL } from './universe.js';

export const REACH = 3;              // досяжність рук (як удар)
const isBody = (r) => !!r && r.hz !== undefined;
const LST = createList(4096);

// Перший твердий блок уздовж променя (Amanatides & Woo 1987, клітинка 1 × 1 × LEVEL): {x, y, k, b, t, n: [нормаль грані
// входу]} чи null; незгенероване (−1) — стоп (null)
export function blockDDA(P, o, d, maxT) {
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
    if (b === -1) return null;
    if (solidB(b)) return { x, y, k, b, t, n };
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

// Предмет q = {o, C, L} (світові координати): найближче влучання або Infinity. Дерево й камінь — точно, трикутниками того
// самого шаблону, що малюється й обводиться (objShape; циліндр на розмах гілок нахиленого дерева перекривав сусідні
// предмети); спершу — описаний циліндр. Покрив (трава, квіти — тонкі) і предмет без законів — циліндри: стовбур
// (o.r до o.top) і рослина, брила (o.ar від o.az0 до o.ah)
function objT(q, ro, d, maxT) {
  const o = q.o, C = q.C, cx = C.cx * CS + o.cx, cy = C.cy * CS + o.cy, z = o.z * LEVEL;
  const sh = q.L && o.pose && o.k !== O_COVER ? objShape(C, q.L, o) : null;
  if (sh) {
    const { rot, s } = o.pose, R = o.ar + o.ah * Math.sin(sh.tl) + 0.05;
    if (cylHit(ro, d, cx, cy, R, z - R, z + o.ah + 0.05, maxT) === Infinity) return Infinity;
    // промінь у систему шаблону (обернене до place: зсув, поворот −rot, масштаб 1/s, нахил −tl); t той самий
    const c = Math.cos(rot), sn = Math.sin(rot), ct = Math.cos(sh.tl), st = Math.sin(sh.tl);
    const loc = (x, y, zz) => { const a = x * c + y * sn, b = -x * sn + y * c; return [a / s, (b * ct + zz * st) / s, (-b * st + zz * ct) / s]; };
    const p = loc(ro[0] - cx, ro[1] - cy, ro[2] - z), v = loc(d[0], d[1], d[2]);
    return rayTriSoup(sh.T.p, sh.T.verts, p[0], p[1], p[2], v[0], v[1], v[2], maxT);
  }
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
      const t = objT(q, o, d, bt);
      if (t < bt) { bt = t; bo = q; }
    }
    if (!bo && prism) { bo = objAt(Math.floor(r.ref.cx), Math.floor(r.ref.cy)); bt = r.t; }   // стовбур без циліндра
  }
  if (bo) best = { kind: 'obj', t: bt, p: at(bt), obj: bo };
  return best;
}
