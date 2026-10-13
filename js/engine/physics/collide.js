// engine/physics/collide.js — геометрія зіткнень: список трикутників (земля, предмети, тіла — однаково), найближча
// точка трикутника, рух кулі проти трикутників (перша точка дотику), перетин кулі, промінь. Без імпортів гри.
// Трикутник — 12 чисел: вершини a, b, c і одинична нормаль (назовні, у повітря). Грань — лише з лицевого боку
// (тіла замкнені: зсередини можна вийти), ребра й вершини — з будь-якого.
// Джерела: Ericson, «Real-Time Collision Detection», 5.1.5 (найближча точка трикутника); рух кулі — сума Мінковського:
// грань, зсунута на R, і капсули ребер (як capIntersect І. Квілеса); промінь — Möller–Trumbore.

const TOL = 1e-4;          // куля, ближча за R − TOL, уже перетинає (такий трикутник рух пропускає — виштовхування окремо)

// ---- список ----
export function createList(cap = 256) { return { t: new Float64Array(cap * 12), ref: new Array(cap), n: 0 }; }
export function clearList(L) { L.n = 0; }
function room(L) {
  if (L.n * 12 < L.t.length) return;
  const t = new Float64Array(L.t.length * 2); t.set(L.t); L.t = t; L.ref.length = L.t.length / 12;
}
// Трикутник a-b-c; нормаль — cross(b − a, c − a), повернута за підказкою (hx, hy, hz), якщо вона є (≠ 0). Повернута —
// b і c міняються місцями: обхід вершин завжди проти годинникової стрілки, якщо дивитись з боку нормалі (на цьому стоїть
// inTri; інакше внутрішня частина такої грані не тримала — лише ребра)
export function pushTri(L, ax, ay, az, bx, by, bz, cx, cy, cz, ref = null, hx = 0, hy = 0, hz = 0) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-12) return;
  nx /= l; ny /= l; nz /= l;
  const flip = nx * hx + ny * hy + nz * hz < 0;
  if (flip) { nx = -nx; ny = -ny; nz = -nz; }
  room(L);
  const t = L.t, o = L.n * 12, b = flip ? o + 6 : o + 3, c = flip ? o + 3 : o + 6;
  t[o] = ax; t[o + 1] = ay; t[o + 2] = az; t[b] = bx; t[b + 1] = by; t[b + 2] = bz;
  t[c] = cx; t[c + 1] = cy; t[c + 2] = cz; t[o + 9] = nx; t[o + 10] = ny; t[o + 11] = nz;
  L.ref[L.n++] = ref;
}

// ---- найближча точка трикутника (Ericson 5.1.5) ----
// out ← [x, y, z]; t — масив, o — зсув трикутника
export function closestOnTri(px, py, pz, t, o, out) {
  const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return out; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return out; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return out; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return out; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return out; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + w * (cx - bx); out[1] = by + w * (cy - by); out[2] = bz + w * (cz - bz); return out;
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
  return out;
}

const Q = [0, 0, 0];
const dist2 = (px, py, pz, t, o) => { closestOnTri(px, py, pz, t, o, Q); return (px - Q[0]) ** 2 + (py - Q[1]) ** 2 + (pz - Q[2]) ** 2; };

// ---- перетин кулі ----
// Найглибший дотик кулі (c, R): {depth, nx, ny, nz (від трикутника до центру), ref} або null
export function overlapSphere(L, cx, cy, cz, R, out = {}) {
  let best = -1;
  const t = L.t, lim = (R - TOL) * (R - TOL);
  for (let i = 0; i < L.n; i++) {
    const d2 = dist2(cx, cy, cz, t, i * 12);
    if (d2 >= lim) continue;
    const d = Math.sqrt(d2), depth = R - d;
    if (depth <= best) continue;
    best = depth;
    if (d > 1e-9) { out.nx = (cx - Q[0]) / d; out.ny = (cy - Q[1]) / d; out.nz = (cz - Q[2]) / d; }
    else { out.nx = t[i * 12 + 9]; out.ny = t[i * 12 + 10]; out.nz = t[i * 12 + 11]; }
    out.depth = depth; out.ref = L.ref[i];
  }
  return best < 0 ? null : out;
}
// Найменша відстань від точки до трикутників (∞ — порожньо)
export function minDist(L, cx, cy, cz) {
  let m = Infinity;
  for (let i = 0; i < L.n; i++) m = Math.min(m, dist2(cx, cy, cz, L.t, i * 12));
  return Math.sqrt(m);
}
// Найближча точка списку: out = {d, x, y, z, i} або null (список порожній)
const NQ = [0, 0, 0];
export function nearest(L, cx, cy, cz, out = {}) {
  let m = Infinity, bi = -1;
  for (let i = 0; i < L.n; i++) { const d = dist2(cx, cy, cz, L.t, i * 12); if (d < m) { m = d; bi = i; } }
  if (bi < 0) return null;
  closestOnTri(cx, cy, cz, L.t, bi * 12, NQ);
  out.d = Math.sqrt(m); out.x = NQ[0]; out.y = NQ[1]; out.z = NQ[2]; out.i = bi;
  return out;
}

// ---- рух кулі ----
// Куля (центр c, радіус R) рухається на d (t від 0 до 1). Перший дотик: out = {t, nx, ny, nz (від точки дотику до
// центру), px, py, pz (точка дотику), ref, i (номер трикутника в списку)} або null. Дотик рахується, лише коли куля наближається.
// Трикутники, що вже перетинають кулю (ближче за R − TOL), пропускаються.
export function sweepSphere(L, cx, cy, cz, dx, dy, dz, R, out = {}) {
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-12) return null;
  const ux = dx / len, uy = dy / len, uz = dz / len, t = L.t, lim = (R - TOL) * (R - TOL);
  // коробка руху (для швидкого відкидання)
  const x0 = Math.min(cx, cx + dx) - R, x1 = Math.max(cx, cx + dx) + R, y0 = Math.min(cy, cy + dy) - R, y1 = Math.max(cy, cy + dy) + R;
  const z0 = Math.min(cz, cz + dz) - R, z1 = Math.max(cz, cz + dz) + R;
  let best = len, hit = false;
  for (let i = 0; i < L.n; i++) {
    const o = i * 12;
    if (Math.max(t[o], t[o + 3], t[o + 6]) < x0 || Math.min(t[o], t[o + 3], t[o + 6]) > x1) continue;
    if (Math.max(t[o + 1], t[o + 4], t[o + 7]) < y0 || Math.min(t[o + 1], t[o + 4], t[o + 7]) > y1) continue;
    if (Math.max(t[o + 2], t[o + 5], t[o + 8]) < z0 || Math.min(t[o + 2], t[o + 5], t[o + 8]) > z1) continue;
    const nx = t[o + 9], ny = t[o + 10], nz = t[o + 11];
    const d0 = (cx - t[o]) * nx + (cy - t[o + 1]) * ny + (cz - t[o + 2]) * nz, dn = ux * nx + uy * ny + uz * nz;
    // площина далеко й рух від неї (чи вздовж) — нічого
    if (Math.abs(d0) > R && d0 * dn >= 0) continue;
    if (d0 > R && d0 - R > -dn * best) continue;
    if (dist2(cx, cy, cz, t, o) < lim) continue;      // уже перетинає
    let tb = best, hn = null;
    // грань (лицевий бік)
    if (d0 >= R - TOL && dn < -1e-12) {
      const s = Math.max(0, (R - d0) / dn);
      if (s < tb) {
        const qx = cx + ux * s - nx * R, qy = cy + uy * s - ny * R, qz = cz + uz * s - nz * R;
        if (inTri(t, o, qx, qy, qz, nx, ny, nz)) { tb = s; hn = 'f'; }
      }
    }
    // ребра (капсули з кулями на кінцях)
    for (let e = 0; e < 3; e++) {
      const a = o + e * 3, b = o + ((e + 1) % 3) * 3;
      const s = edgeSweep(cx, cy, cz, ux, uy, uz, t[a], t[a + 1], t[a + 2], t[b], t[b + 1], t[b + 2], R, tb);
      // ребро — теж лише з лицевого боку: центр у момент дотику не за площиною (інакше внутрішні ребра тримали б ззаду)
      if (s < tb && d0 + dn * s >= -1e-6) { tb = s; hn = 'e'; }
    }
    if (hn === null) continue;
    best = tb; hit = true;
    const px = cx + ux * tb, py = cy + uy * tb, pz = cz + uz * tb;
    if (hn === 'f') { out.nx = nx; out.ny = ny; out.nz = nz; }
    else {
      closestOnTri(px, py, pz, t, o, Q);
      const qx = px - Q[0], qy = py - Q[1], qz = pz - Q[2], ql = Math.hypot(qx, qy, qz) || 1;
      out.nx = qx / ql; out.ny = qy / ql; out.nz = qz / ql;
    }
    out.px = px - out.nx * R; out.py = py - out.ny * R; out.pz = pz - out.nz * R;
    out.ref = L.ref[i]; out.i = i;
  }
  if (!hit) return null;
  out.t = best / len;
  return out;
}
// Точка q (на площині трикутника) — усередині (з допуском)?
function inTri(t, o, qx, qy, qz, nx, ny, nz) {
  for (let e = 0; e < 3; e++) {
    const a = o + e * 3, b = o + ((e + 1) % 3) * 3;
    const ex = t[b] - t[a], ey = t[b + 1] - t[a + 1], ez = t[b + 2] - t[a + 2], wx = qx - t[a], wy = qy - t[a + 1], wz = qz - t[a + 2];
    const cx = ey * wz - ez * wy, cy = ez * wx - ex * wz, cz = ex * wy - ey * wx;
    if (cx * nx + cy * ny + cz * nz < -1e-12) return false;
  }
  return true;
}
// Перший дотик променя o + s·u (u — одиничний) з капсулою ребра p0–p1 радіуса R (з кулями на кінцях), s < lim; інакше lim
// Дотик до ребра чи вершини — лише якщо куля в цю мить наближається (косинус кута між рухом і нормаллю дотику
// < −GRAZE): по дотичній (куля котиться площиною на висоті R над ребром у цій самій площині) — ні, інакше похибка
// округлення зупиняла б на рівному
const GRAZE = 1e-3;
function edgeSweep(ox, oy, oz, ux, uy, uz, ax, ay, az, bx, by, bz, R, lim) {
  let best = lim;
  const ex = bx - ax, ey = by - ay, ez = bz - az, el = Math.hypot(ex, ey, ez);
  if (el > 1e-12) {
    const kx = ex / el, ky = ey / el, kz = ez / el;
    const wx = ox - ax, wy = oy - ay, wz = oz - az, we = wx * kx + wy * ky + wz * kz, ue = ux * kx + uy * ky + uz * kz;
    const px = wx - we * kx, py = wy - we * ky, pz = wz - we * kz, qx = ux - ue * kx, qy = uy - ue * ky, qz = uz - ue * kz;
    const A = qx * qx + qy * qy + qz * qz, B = px * qx + py * qy + pz * qz, C = px * px + py * py + pz * pz - R * R;
    if (A > 1e-12 && B < -1e-9) {
      const h = B * B - A * C;
      if (h >= 0) {
        const s = Math.max(0, (-B - Math.sqrt(h)) / A), y = we + s * ue;
        if (y >= 0 && y <= el && s < best && B + s * A < -GRAZE * R) best = s;
      }
    }
  }
  for (const [px, py, pz] of [[ax, ay, az], [bx, by, bz]]) {
    const wx = ox - px, wy = oy - py, wz = oz - pz, B = wx * ux + wy * uy + wz * uz;
    if (B >= -1e-9) continue;
    const C = wx * wx + wy * wy + wz * wz - R * R, h = B * B - C;
    if (h < 0) continue;
    const s = Math.max(0, -B - Math.sqrt(h));
    if (s < best && B + s < -GRAZE * R) best = s;
  }
  return best;
}

// ---- промінь ----
// Промінь o + s·d (d — будь-якої довжини, s у частках d, до maxT): {t, nx, ny, nz (нормаль трикутника), ref} або null
export function rayCast(L, ox, oy, oz, dx, dy, dz, maxT = 1, out = {}) {
  const t = L.t;
  let best = maxT, hit = -1;
  for (let i = 0; i < L.n; i++) {
    const o = i * 12;
    const e1x = t[o + 3] - t[o], e1y = t[o + 4] - t[o + 1], e1z = t[o + 5] - t[o + 2];
    const e2x = t[o + 6] - t[o], e2y = t[o + 7] - t[o + 1], e2z = t[o + 8] - t[o + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det, sx = ox - t[o], sy = oy - t[o + 1], sz = oz - t[o + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (s < 0 || s >= best) continue;
    best = s; hit = i;
  }
  if (hit < 0) return null;
  out.t = best; out.nx = t[hit * 12 + 9]; out.ny = t[hit * 12 + 10]; out.nz = t[hit * 12 + 11]; out.ref = L.ref[hit];
  return out;
}

// Промінь проти трикутників без індексів (p — x, y, z вершин, кожні три — трикутник; nv — вершин), з обох боків:
// s першого влучання (у частках d) чи Infinity
export function rayTriSoup(p, nv, ox, oy, oz, dx, dy, dz, maxT = 1) {
  let best = Infinity;
  for (let o = 0, n = nv * 3; o + 8 < n; o += 9) {
    const e1x = p[o + 3] - p[o], e1y = p[o + 4] - p[o + 1], e1z = p[o + 5] - p[o + 2];
    const e2x = p[o + 6] - p[o], e2y = p[o + 7] - p[o + 1], e2z = p[o + 8] - p[o + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det, sx = ox - p[o], sy = oy - p[o + 1], sz = oz - p[o + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t >= 0 && t < best && t <= maxT) best = t;
  }
  return best;
}

// ---- прості тіла ----
// Призма: правильний sides-кутник радіуса r навколо (cx, cy) від z0 до z1 — бічні грані, верх і низ (замкнена: «усередині»
// — за всіма гранями, character.js; низ — у землі, знизу до нього не дістатися)
export function prismTris(L, cx, cy, z0, z1, r, sides = 12, ref = null) {
  for (let i = 0; i < sides; i++) {
    const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const am = (a0 + a1) / 2, hx = Math.cos(am), hy = Math.sin(am);
    pushTri(L, x0, y0, z0, x1, y1, z0, x1, y1, z1, ref, hx, hy, 0);
    pushTri(L, x0, y0, z0, x1, y1, z1, x0, y0, z1, ref, hx, hy, 0);
    pushTri(L, cx, cy, z1, x0, y0, z1, x1, y1, z1, ref, 0, 0, 1);
    pushTri(L, cx, cy, z0, x1, y1, z0, x0, y0, z0, ref, 0, 0, -1);
  }
}
// Коробка — 12 трикутників назовні
export function boxTris(L, x0, y0, z0, x1, y1, z1, ref = null) {
  const q = (a, b, c, d, hx, hy, hz) => { pushTri(L, ...a, ...b, ...c, ref, hx, hy, hz); pushTri(L, ...a, ...c, ...d, ref, hx, hy, hz); };
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1);
  q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], 0, 0, -1);
  q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 0, 0);
  q([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], -1, 0, 0);
  q([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 0, 1, 0);
  q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0);
}
