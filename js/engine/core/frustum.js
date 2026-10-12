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
