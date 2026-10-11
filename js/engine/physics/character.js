// engine/physics/character.js — контролер персонажа проти трикутників (collide.js): форма — набір куль (капсула —
// кулі на осі), рух землею з кроком на уступ і ходою вздовж схилу, ковзання в повітрі, пошук підлоги (куля донизу +
// промінь під центром), виштовхування. Як CharacterMovement в Unreal (FindFloor, StepUp з перевіркою висоти дотику,
// хід уздовж прохідної підлоги) і CharacterController в Unity (slopeLimit, stepOffset, skinWidth).
// src — джерело трикутників: gather(x0, y0, z0, x1, y1, z1, list) і solidAt(x, y, z) (точка в твердому).
// s — стан {x, y, z} (z — низ форми, «ноги»). Без імпортів гри.
import { createList, clearList, sweepSphere, overlapSphere, nearest, rayCast } from './collide.js';

export const SKIN = 0.002;           // відступ від дотику після руху
const EPS = 1e-4;

// Капсула: n куль радіуса R на осі, від ніг до висоти H
export function capsule(R, H, n = 4) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([0, 0, R + i * (H - 2 * R) / (n - 1)]);
  return { R, H, pts };
}

const LST = createList(1024), H1 = {}, H2 = {}, F1 = {}, OV = {}, RY = {}, NQ = {};
// Трикутники навколо форми в (x, y, z), зсунутої на (dx, dy, dz), із запасом m
function around(src, sh, x, y, z, dx, dy, dz, m) {
  clearList(LST);
  const r = sh.R + m;
  src.gather(Math.min(x, x + dx) - r, Math.min(y, y + dy) - r, Math.min(z, z + dz) - r, Math.max(x, x + dx) + r, Math.max(y, y + dy) + r, Math.max(z, z + dz) + sh.H + r, LST);
  return LST;
}

// Найглибший дотик форми з трикутниками {depth, nx, ny, nz, ref} або null. Куля, що поверхні не перетинає, але центр — у
// твердому: за найближчим трикутником (промінь до нього влучає в тильний бік) — усередині, depth = відстань + R уздовж
// нормалі того трикутника; трикутника ближче 0,6 нема — «глибоко всередині», depth = Infinity
export function overlap(src, sh, x, y, z) {
  const L = around(src, sh, x, y, z, 0, 0, 0, 0.7);
  let best = null;
  for (const [ox, oy, oz] of sh.pts) {
    const cx = x + ox, cy = y + oy, cz = z + oz;
    const o = overlapSphere(L, cx, cy, cz, sh.R, OV);
    if (o && (!best || o.depth > best.depth)) best = { depth: o.depth, nx: o.nx, ny: o.ny, nz: o.nz, ref: o.ref };
    if (o || !src.solidAt(cx, cy, cz)) continue;
    const q = nearest(L, cx, cy, cz, NQ);
    if (!q || q.d > 0.6) return { depth: Infinity, nx: 0, ny: 0, nz: 1, ref: null };
    const dx = (q.x - cx) * 1.05, dy = (q.y - cy) * 1.05, dz = (q.z - cz) * 1.05, r = rayCast(L, cx, cy, cz, dx, dy, dz, 1, RY);
    if (r && r.nx * dx + r.ny * dy + r.nz * dz > 0 && (!best || q.d + sh.R > best.depth)) best = { depth: q.d + sh.R, nx: r.nx, ny: r.ny, nz: r.nz, ref: r.ref };
  }
  return best;
}

// Рух форми на (dx, dy, dz): перший дотик {t, nx, ny, nz, px, py, pz, ref} (t — частка руху) або null
export function sweep(src, sh, x, y, z, dx, dy, dz, out = H1) {
  const L = around(src, sh, x, y, z, dx, dy, dz, 0.05);
  let best = null;
  for (const [ox, oy, oz] of sh.pts) {
    const h = sweepSphere(L, x + ox, y + oy, z + oz, dx, dy, dz, sh.R, H2);
    if (h && (!best || h.t < best.t)) { best = out; Object.assign(out, h); }
  }
  return best;
}

// Підлога під формою не нижче z − down: {z, nx, ny, nz, px, py, pz, ref, zU, nU}; null — немає. На рівній підлозі z —
// точно висота площини. zU — поверхня під центром (промінь до 0,25 нижче ніг) чи null, nU — її нормаль, якщо вона не
// нижча за ноги на 0,12 (інакше під центром уже інша поверхня — край уступу)
export function findFloor(src, sh, x, y, z, down) {
  // уся форма: верхні кулі біля стрімкого схилу теж можуть у нього впертися
  const L = around(src, sh, x, y, z, 0, 0, -down - 0.35, 0.05);
  let h = null;
  for (const [ox, oy, oz] of sh.pts) {
    const q = sweepSphere(L, x + ox, y + oy, z + oz, 0, 0, -down, sh.R, H2);
    if (q && (!h || q.t < h.t)) h = Object.assign(F1, q);
  }
  if (!h) return null;
  const f = { nx: h.nx, ny: h.ny, nz: h.nz, px: h.px, py: h.py, pz: h.pz, ref: h.ref, nU: null, zU: null };
  f.z = h.nz > 1 - 1e-9 ? L.t[h.i * 12 + 2] : Math.min(z, z - h.t * down + (h.t > 0 ? SKIN : 0));   // рівна — висота площини
  if (f.z > z) f.z = z;
  const r = rayCast(L, x, y, f.z + 0.1, 0, 0, -0.35, 1, RY);
  if (r && r.nz > 0) {
    f.zU = f.z + 0.1 - r.t * 0.35;
    if (f.zU >= f.z - 0.12) f.nU = [r.nx, r.ny, r.nz];
  }
  return f;
}
// Нормаль підлоги для ходи: під центром, якщо промінь близько, інакше — дотику
export const floorNormal = (f) => f.nU || [f.nx, f.ny, f.nz];
// Підлога стійка (кут ≤ межі standZ): дотик чи під центром
export const stands = (f, standZ) => !!f && (f.nz >= standZ || (!!f.nU && f.nU[2] >= standZ));
const walks = (f, walkZ) => !!f && (f.nz >= walkZ || (!!f.nU && f.nU[2] >= walkZ));

// Ковзання в повітрі на (dx, dy, dz), до 4 відбиттів. Повертає дотики: floor (дотик з n_z ≥ standZ), ceil, walls
// ([[nx, ny], …] горизонтальні нормалі)
export function moveAir(src, sh, s, dx, dy, dz, standZ) {
  const res = { floor: null, ceil: false, walls: [] };
  for (let it = 0; it < 4; it++) {
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) break;
    const h = sweep(src, sh, s.x, s.y, s.z, dx, dy, dz);
    if (!h) { s.x += dx; s.y += dy; s.z += dz; break; }
    const adv = Math.max(0, h.t - SKIN / len);
    s.x += dx * adv; s.y += dy * adv; s.z += dz * adv;
    dx *= 1 - adv; dy *= 1 - adv; dz *= 1 - adv;
    if (h.nz >= standZ) res.floor = { ...h };
    else if (h.nz < -0.3) res.ceil = true;
    else { const l = Math.hypot(h.nx, h.ny); if (l > 1e-6) res.walls.push([h.nx / l, h.ny / l]); }
    const dn = dx * h.nx + dy * h.ny + dz * h.nz;
    if (dn < 0) { dx -= dn * h.nx; dy -= dn * h.ny; dz -= dn * h.nz; }
  }
  return res;
}

// Хода землею на (dx, dy). o = {step — висота кроку на уступ, walkZ — межа схилу, на який заходиш (cos), standZ — на якому
// стоїш, floorN — нормаль підлоги ([x, y, z]) чи null, round(ref) — перешкода кругла (стовбур, камінь: лобом у неї —
// обходиш збоку)}. Повертає {walls, stepped (на скільки піднявся кроком), ex, ey (зсув кроком понад рух — для вигляду)}
export function moveH(src, sh, s, dx, dy, o) {
  const res = { walls: [], stepped: 0, ex: 0, ey: 0 };
  const x0 = s.x, y0 = s.y, want = Math.hypot(dx, dy);
  let last = null;
  let fn = o.floorN && o.floorN[2] >= o.walkZ ? o.floorN : null;
  let rx = dx, ry = dy;
  for (let it = 0; it < 4 && Math.hypot(rx, ry) > 1e-9; it++) {
    const dz = fn ? -(fn[0] * rx + fn[1] * ry) / fn[2] : 0;
    const len = Math.hypot(rx, ry, dz), h = sweep(src, sh, s.x, s.y, s.z, rx, ry, dz);
    if (!h) { s.x += rx; s.y += ry; s.z += dz; rx = ry = 0; break; }
    const adv = Math.max(0, h.t - SKIN / len);
    s.x += rx * adv; s.y += ry * adv; s.z += dz * adv;
    rx *= 1 - adv; ry *= 1 - adv;
    if (h.nz >= o.walkZ) { fn = [h.nx, h.ny, h.nz]; continue; }             // інший схил, теж прохідний — уздовж нього
    const st = o.step > 0 && h.pz <= s.z + o.step + EPS ? stepUp(src, sh, s, rx, ry, o) : null;
    if (st) { res.stepped = st.up; res.ex = st.ex; res.ey = st.ey; rx = ry = 0; break; }
    const l = Math.hypot(h.nx, h.ny);
    if (l < 1e-6) { fn = null; continue; }                                  // стеля над схилом — далі по горизонталі
    const nx = h.nx / l, ny = h.ny / l, d = rx * nx + ry * ny;
    res.walls.push([nx, ny]);
    last = { nx, ny, ref: h.ref };
    if (d < 0) { rx -= d * nx; ry -= d * ny; } else fn = null;
  }
  // уперся й майже не зрушив: лобом у круглу перешкоду — уздовж дотичної (обходиш збоку; точно в центр — ліворуч),
  // інакше — запасний хід по осях, як у блоковому світі (у кут — ні)
  if (want > 1e-9 && Math.hypot(s.x - x0, s.y - y0) < want * 0.05 && !res.stepped) {
    const tries = [[dx, 0], [0, dy]];
    if (last && last.ref && o.round && o.round(last.ref)) {
      const sg = -last.ny * dx + last.nx * dy >= -1e-9 ? 1 : -1;
      tries.unshift([-last.ny * sg * want, last.nx * sg * want]);
    }
    for (const [ax, ay] of tries) {
      if (!ax && !ay) continue;
      const h = sweep(src, sh, s.x, s.y, s.z, ax, ay, 0);
      const len = Math.hypot(ax, ay), adv = h ? Math.max(0, h.t - SKIN / len) : 1;
      if (adv * len > want * 0.05) { s.x += ax * adv; s.y += ay * adv; break; }
    }
  }
  return res;
}

// Крок на уступ: угору на step, уперед, донизу. Уперед — на залишок руху, а не вийшло — на R/2 і R (куля, що впирається
// в стіну, інакше обминає скошений край уступу: за такт гравець проходить соті частки). Приймається, якщо підлога
// стійка, вища за z і не вища за z + step, і прохідна — вона сама чи на відстані R уперед (крутий край у пів блоку
// переступаєш, довгий крутий схил — ні). Повертає {up — підйом, ex, ey — зсув понад залишок (для вигляду)} або null
function stepUp(src, sh, s, rx, ry, o) {
  const z0 = s.z, hu = sweep(src, sh, s.x, s.y, s.z, 0, 0, o.step, H1);
  const up = hu ? Math.max(0, hu.t * o.step - SKIN) : o.step;
  if (up < 0.02) return null;
  const len = Math.hypot(rx, ry), ux = rx / len, uy = ry / len;
  for (const fw of [len, sh.R / 2, sh.R]) {
    if (fw < len - 1e-12) continue;
    const hf = sweep(src, sh, s.x, s.y, z0 + up, ux * fw, uy * fw, 0, H1);
    const adv = hf ? Math.max(0, hf.t * fw - SKIN) : fw;
    if (adv < 1e-5) return null;
    const x2 = s.x + ux * adv, y2 = s.y + uy * adv;
    const f = findFloor(src, sh, x2, y2, z0 + up, up + 0.05);
    if (!f || !stands(f, o.standZ) || f.z > z0 + o.step + EPS || f.z < z0 + 0.01) continue;
    let ok = walks(f, o.walkZ);
    if (!ok) {                                                           // прохідна підлога трохи далі?
      const h3 = sweep(src, sh, x2, y2, z0 + up, ux * sh.R, uy * sh.R, 0, H1);
      if (!h3) {
        const f3 = findFloor(src, sh, x2 + ux * sh.R, y2 + uy * sh.R, z0 + up, up + 0.05);
        ok = !!f3 && walks(f3, o.walkZ) && f3.z <= z0 + o.step + EPS;
      }
    }
    if (!ok) continue;
    const extra = Math.max(0, adv - len);
    s.x = x2; s.y = y2; s.z = f.z;
    return { up: f.z - z0, ex: ux * extra, ey: uy * extra };
  }
  return null;
}

// Виштовхнути форму з поверхні: уздовж найглибшого дотику (до 8 разів); не вийшло — найближче вільне до 1 (угору, униз,
// убік). Глибоко в твердому
// (трикутників поруч немає: телепорт, секцію догенеровано) — угору до maxUp, до першого вільного місця (інакше форма
// провалювалась би крізь товщу, де нема об чого спертися). true — вільно
export function depenetrate(src, sh, s, maxUp = 64) {
  let deep = false;
  for (let i = 0; i < 8; i++) {
    const o = overlap(src, sh, s.x, s.y, s.z);
    if (!o) return true;
    if (o.depth === Infinity) { deep = true; break; }
    const k = o.depth + SKIN;
    s.x += o.nx * k; s.y += o.ny * k; s.z += o.nz * k;
  }
  if (!overlap(src, sh, s.x, s.y, s.z)) return true;
  if (deep) { for (let dz = 0.5; dz <= maxUp + 1e-9; dz += 0.5) if (!overlap(src, sh, s.x, s.y, s.z + dz)) { s.z += dz; return true; } return false; }
  // затисло (стеля й підлога, тіло): найближче вільне місце — угору, униз, убік до 1
  for (let d = 0.05; d <= 1 + 1e-9; d += 0.05) {
    for (const [ax, ay, az] of [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) {
      if (!overlap(src, sh, s.x + ax * d, s.y + ay * d, s.z + az * d)) { s.x += ax * d; s.y += ay * d; s.z += az * d; return true; }
    }
  }
  return false;
}
