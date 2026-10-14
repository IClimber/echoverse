// num.js — точна детермінована арифметика для генерації (CLAUDE.md, «Детермінізм генерації»). Дозволено: + − × ÷,
// Math.floor / ceil / round / abs / min / max / imul / sqrt (точні за IEEE 754 — однакові до біта в будь-якому рушії JS),
// зсуви й функції цього модуля. Math.sin / cos / exp / log / pow / cbrt / ** — ні: їхній останній біт залежить від рушія
// (13.10.2026: Node 22, Chrome 155 і Firefox дають різні біти). Трансцендентні функції — stdlib (js/lib/stdlib: порти
// fdlibm / FreeBSD msun і Boost лише на точних операціях, похибка ≤ 1 ulp; до 13.10.2026 — власні наближення: синус
// Бхаскари I з похибкою до 0,0017). Лінтер (eslint.config.js) забороняє неточні Math.* у файлах генерації.
import sin from './lib/stdlib/sin.js';
import cos from './lib/stdlib/cos.js';
import cbrt from './lib/stdlib/cbrt.js';
import log10 from './lib/stdlib/log10.js';
import erfcinv from './lib/stdlib/erfcinv.js';

export const PI = 3.141592653589793;
export const nsqrt = (v) => v > 0 ? Math.sqrt(v) : 0;
export const nroot4 = (v) => v > 0 ? Math.sqrt(Math.sqrt(v)) : 0;
export const nsin = sin;
export const ncos = cos;
export const ncbrt = cbrt;
export const nlog10 = (v) => v > 0 ? log10(v) : -Infinity;
// Квантиль стандартного нормального розподілу Φ⁻¹(q), 0 < q < 1: −√2·erfc⁻¹(2q)
export const nqnorm = (q) => -1.4142135623730951 * erfcinv(2 * q);

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
export const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
// плавний крок 0…1 (t обрізано до 0…1) і між a та b
export const smooth01 = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const smoothstep = (a, b, v) => smooth01((v - a) / (b - a));
