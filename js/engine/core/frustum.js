// js/engine/core/frustum.js — піраміда видимості: коробка проти матриці «камера × проєкція» (стовпці, як у WebGL).
// Без залежностей від гри.

// Довільна коробка (відносно цілі): хоч частково в піраміді видимості (aabbInView) / уся всередині (aabbInside).
// c — кривизна: вершинний шейдер опускає точку на c·(x² + y²) (x, y — від цілі), тож коробку — низ на c·d² найдальшої
// від цілі точки, верх — на c·d² найближчої (без кривизни коробка вища за те, що малюється: край кадру зрізав би далеке)
export function aabbInView(m, x0, y0, z0, x1, y1, z1, c = 0) {
  if (c > 0) { z0 -= c * far2(x0, y0, x1, y1); z1 -= c * near2(x0, y0, x1, y1); }
  let l = 0, rr = 0, b = 0, t = 0, back = 0;
  for (let k = 0; k < 8; k++) {
    const x = k & 1 ? x1 : x0, y = k & 2 ? y1 : y0, z = k & 4 ? z1 : z0;
    const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Wc = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (X < -Wc) l++; if (X > Wc) rr++; if (Y < -Wc) b++; if (Y > Wc) t++; if (Wc <= 0) back++;
  }
  return !(l === 8 || rr === 8 || b === 8 || t === 8 || back === 8);
}
export function aabbInside(m, x0, y0, z0, x1, y1, z1, c = 0) {
  if (c > 0) { z0 -= c * far2(x0, y0, x1, y1); z1 -= c * near2(x0, y0, x1, y1); }
  for (let k = 0; k < 8; k++) {
    const x = k & 1 ? x1 : x0, y = k & 2 ? y1 : y0, z = k & 4 ? z1 : z0;
    const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Wc = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (Wc <= 0 || X < -Wc || X > Wc || Y < -Wc || Y > Wc) return false;
  }
  return true;
}

// Квадрат відстані по горизонталі від початку (цілі) до найдальшої й найближчої точки прямокутника [x0, x1] × [y0, y1]
export function far2(x0, y0, x1, y1) { const x = x1 > -x0 ? x1 : -x0, y = y1 > -y0 ? y1 : -y0; return x * x + y * y; }
export function near2(x0, y0, x1, y1) { const x = x0 > 0 ? x0 : x1 < 0 ? -x1 : 0, y = y0 > 0 ? y0 : y1 < 0 ? -y1 : 0; return x * x + y * y; }

// Об'єм кидачів тіні напрямленого світла для зрізу піраміди (глибина від ока [near, far]): усі точки, з яких промінь
// уздовж світла входить у зріз, — опуклий об'єм, як у Unreal (ShadowSetup.cpp, ComputeShadowCullingVolume): грані зрізу,
// повернуті від світла (n·L ≤ 0: уздовж світла їх не перетнеш), і площини через ребра силуету зрізу (між гранню від світла
// й гранню до світла), паралельні світлу. Без площин силуету (silhouette = false) об'єм у бік граней до світла не
// обмежений (надмірно, але не хибно).
// m — «камера × проєкція» (стовпці, ліва, права, низ, верх — Gribb — Hartmann), eye — око, ud — до ока (одиничний; погляд —
// −ud), near — глибина ближньої грані (null — ближня площина m), far — дальньої, L — куди світить (одиничний), mg — запас
// назовні (одиниці світу); out (з off) — площини (a, b, c, d) нормовані, усередині a·x + b·y + c·z + d ≥ 0 (≤ 11 площин)
// → кількість площин. Коробку перевіряє boxOut
const CV_F = new Float64Array(6 * 4), CV_K = new Uint8Array(6), CV_C = new Float64Array(8 * 3);
// кут i + 2j + 4l — грані (i, 2 + j, 4 + l): 0 ліва, 1 права, 2 низ, 3 верх, 4 ближня, 5 дальня; ребра — пари суміжних
// граней і їхні кути
const CV_E = [[0, 2], [0, 3], [1, 2], [1, 3], [0, 4], [1, 4], [2, 4], [3, 4], [0, 5], [1, 5], [2, 5], [3, 5]].map(([f, g]) => {
  const cs = [];
  for (let ci = 0; ci < 8; ci++) { const fs = [ci & 1, 2 + (ci >> 1 & 1), 4 + (ci >> 2)]; if (fs.includes(f) && fs.includes(g)) cs.push(ci); }
  return [f, g, cs[0], cs[1]];
});
export function casterVolume(m, eye, ud, near, far, L, mg, silhouette, out, off = 0) {
  const L0 = L[0], L1 = L[1], L2 = L[2], ue = ud[0] * eye[0] + ud[1] * eye[1] + ud[2] * eye[2];
  let np = 0;
  const face = (f, a, b, c, d) => {
    const n = Math.hypot(a, b, c), o = f * 4;
    CV_F[o] = a / n; CV_F[o + 1] = b / n; CV_F[o + 2] = c / n; CV_F[o + 3] = d / n;
    CV_K[f] = CV_F[o] * L0 + CV_F[o + 1] * L1 + CV_F[o + 2] * L2 > 1e-6 ? 0 : 1;   // до світла — грань не обмежує
  };
  const add = (a, b, c, d) => { const o = off + np * 4; out[o] = a; out[o + 1] = b; out[o + 2] = c; out[o + 3] = d + mg; np++; };
  face(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]); face(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  face(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]); face(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  if (near === null) face(4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]); else face(4, -ud[0], -ud[1], -ud[2], ue - near);
  face(5, ud[0], ud[1], ud[2], far - ue);
  for (let f = 0; f < 6; f++) if (CV_K[f]) add(CV_F[f * 4], CV_F[f * 4 + 1], CV_F[f * 4 + 2], CV_F[f * 4 + 3]);
  if (!silhouette) return np;
  // кути зрізу — перетини трьох граней
  let gx = 0, gy = 0, gz = 0;
  for (let ci = 0; ci < 8; ci++) {
    const p = (ci & 1) * 4, q = (2 + (ci >> 1 & 1)) * 4, r = (4 + (ci >> 2)) * 4;
    const ax = CV_F[p], ay = CV_F[p + 1], az = CV_F[p + 2], bx = CV_F[q], by = CV_F[q + 1], bz = CV_F[q + 2], cx = CV_F[r], cy = CV_F[r + 1], cz = CV_F[r + 2];
    const ux = by * cz - bz * cy, uy = bz * cx - bx * cz, uz = bx * cy - by * cx;          // n2 × n3
    const vx = cy * az - cz * ay, vy = cz * ax - cx * az, vz = cx * ay - cy * ax;          // n3 × n1
    const wx = ay * bz - az * by, wy = az * bx - ax * bz, wz = ax * by - ay * bx;          // n1 × n2
    const det = ax * ux + ay * uy + az * uz, dp = CV_F[p + 3], dq = CV_F[q + 3], dr = CV_F[r + 3];
    const x = -(dp * ux + dq * vx + dr * wx) / det, y = -(dp * uy + dq * vy + dr * wy) / det, z = -(dp * uz + dq * vz + dr * wz) / det;
    CV_C[ci * 3] = x; CV_C[ci * 3 + 1] = y; CV_C[ci * 3 + 2] = z;
    gx += x; gy += y; gz += z;
  }
  gx /= 8; gy /= 8; gz /= 8;
  for (const [f, g, i, j] of CV_E) {
    if (CV_K[f] === CV_K[g]) continue;
    // площина через ребро, паралельна світлу; зріз — усередині
    const ex = CV_C[j * 3] - CV_C[i * 3], ey = CV_C[j * 3 + 1] - CV_C[i * 3 + 1], ez = CV_C[j * 3 + 2] - CV_C[i * 3 + 2];
    let a = ey * L2 - ez * L1, b = ez * L0 - ex * L2, c = ex * L1 - ey * L0;
    const n = Math.hypot(a, b, c);
    if (n < 1e-9 * Math.hypot(ex, ey, ez)) continue;                                        // ребро вздовж світла
    a /= n; b /= n; c /= n;
    let d = -(a * CV_C[i * 3] + b * CV_C[i * 3 + 1] + c * CV_C[i * 3 + 2]);
    if (a * gx + b * gy + c * gz + d < 0) { a = -a; b = -b; c = -c; d = -d; }
    add(a, b, c, d);
  }
  return np;
}
// Коробка цілком зовні хоч однієї з n площин P (з off; формат casterVolume)
export function boxOut(P, off, n, x0, y0, z0, x1, y1, z1) {
  for (let i = 0; i < n; i++) {
    const o = off + i * 4, a = P[o], b = P[o + 1], c = P[o + 2];
    if (a * (a >= 0 ? x1 : x0) + b * (b >= 0 ? y1 : y0) + c * (c >= 0 ? z1 : z0) + P[o + 3] < 0) return true;
  }
  return false;
}
