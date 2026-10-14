// laws/noise.js — градієнтний шум (Perlin) 2D/3D і fBm від зерна. Лише + − × ÷ і Math.floor:
// без Math.sin/pow/sqrt, тож значення побітово однакові в усіх рушіях JS.
import { hash3, hash4 } from './rng.js';

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const D = 0.7071067811865476;
const G2 = [1, 0, -1, 0, 0, 1, 0, -1, D, D, -D, D, D, -D, -D, -D];
// 12 ребер куба, доповнені до 16 (як у Perlin «improved noise»)
const G3 = [
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  1, 1, 0, 0, -1, 1, -1, 1, 0, 0, -1, -1,
];

function g2(s, ix, iy, x, y) {
  const i = (hash3(s, ix, iy) & 7) * 2;
  return G2[i] * x + G2[i + 1] * y;
}
// ≈ −1…1 (крайні значення рідкісні, типово ±0,5)
export function noise2(s, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy, u = fade(fx), v = fade(fy);
  return 1.4142135623730951 * lerp(
    lerp(g2(s, ix, iy, fx, fy), g2(s, ix + 1, iy, fx - 1, fy), u),
    lerp(g2(s, ix, iy + 1, fx, fy - 1), g2(s, ix + 1, iy + 1, fx - 1, fy - 1), u), v);
}

function g3(s, ix, iy, iz, x, y, z) {
  const i = (hash4(s, ix, iy, iz) & 15) * 3;
  return G3[i] * x + G3[i + 1] * y + G3[i + 2] * z;
}
export function noise3(s, x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  return lerp(
    lerp(lerp(g3(s, ix, iy, iz, fx, fy, fz), g3(s, ix + 1, iy, iz, fx - 1, fy, fz), u),
      lerp(g3(s, ix, iy + 1, iz, fx, fy - 1, fz), g3(s, ix + 1, iy + 1, iz, fx - 1, fy - 1, fz), u), v),
    lerp(lerp(g3(s, ix, iy, iz + 1, fx, fy, fz - 1), g3(s, ix + 1, iy, iz + 1, fx - 1, fy, fz - 1), u),
      lerp(g3(s, ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), g3(s, ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1), u), v),
    w);
}

// fBm: октави з частотою ×2 і амплітудою × gain; результат нормовано до амплітуди першої октави.
// Зерно кожної октави своє, тож октави не корелюють.
const octSeed = (s, i) => s + Math.imul(i, 0x9e3779b9) | 0;
export function fbm3(s, x, y, z, oct, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise3(octSeed(s, i), x * f, y * f, z * f);
    norm += amp; amp *= gain; f *= 2;
  }
  return sum / norm;
}
