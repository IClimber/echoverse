// num.js — точна арифметика для генерації (лише + − × ÷, Math.floor, порівняння): корені й тригонометрія, однакові до
// останнього біта в будь-якому рушії JS (Math.sqrt / sin / pow — ні: CLAUDE.md, «Детермінізм генерації»).
export const PI = 3.141592653589793;

// Квадратний корінь: зведення до [1/16, 16] множенням на степені 16 (точно в двійковому), далі Ньютон
export function nsqrt(v) {
  if (!(v > 0)) return 0;
  let s = 1;
  while (v > 16) { v /= 16; s *= 4; }
  while (v < 0.0625) { v *= 16; s /= 4; }
  let r = 0.5 * v + 0.5;
  for (let i = 0; i < 7; i++) r = 0.5 * (r + v / r);
  return r * s;
}
export const nroot4 = (v) => nsqrt(nsqrt(v));

// Синус (наближення Бхаскари I, похибка < 0,0017): x — будь-який кут у радіанах
export function nsin(x) {
  const T = 2 * PI;
  x -= Math.floor(x / T) * T;                     // 0…2π
  const neg = x > PI;
  if (neg) x -= PI;
  const p = x * (PI - x), v = 16 * p / (5 * PI * PI - 4 * p);
  return neg ? -v : v;
}
export const ncos = (x) => nsin(x + PI / 2);

// Кусково-лінійна функція за вузлами [[x, y], …] (x зростають); поза вузлами — крайні значення
export function pwl(T, x) {
  if (x <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (x <= T[i][0]) { const [x0, y0] = T[i - 1], [x1, y1] = T[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return T[T.length - 1][1];
}
// Те саме за окремими масивами вузлів X і значень Y
export function pwlXY(X, Y, x) {
  if (x <= X[0]) return Y[0];
  for (let i = 1; i < X.length; i++) if (x <= X[i]) return Y[i - 1] + (Y[i] - Y[i - 1]) * (x - X[i - 1]) / (X[i] - X[i - 1]);
  return Y[Y.length - 1];
}
export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
