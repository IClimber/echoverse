// mat.js — матриці 4×4 моделей (стовпцями, як у WebGL): зсув, повороти, масштаб, добуток. Лише вигляд.

export const ident = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function mul(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}
export const translate = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
export const scale = (x, y, z) => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
// Поворот навколо вертикалі (z): +x → +y
export function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
// Поворот навколо поперечної осі (y): додатний кут веде +z до +x (кінцівка, що звисає, — уперед)
export function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); }
// Добуток зліва направо: chain(A, B, C) = A·B·C
export function chain(...ms) { let r = ms[0]; for (let i = 1; i < ms.length; i++) r = mul(r, ms[i]); return r; }
