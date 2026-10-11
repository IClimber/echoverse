// gen/sprites.js — малі рослини площинами, як у Minecraft: вид (геном → 3D-шаблон, plants.js) один раз «фотографується»
// у спрайт SPR×SPR, рослина — дві схрещені площини з ним (лишайник — одна на землі): 12 вершин замість 100–250.
// Лише вигляд (Math.* можна). Спрайт: RGBA (sRGB, як текстури землі), альфа 0 / 255 (вирізання), колір прозорих пікселів
// — від сусідніх непрозорих (мип-мапи не темнять краї)
import { template } from './plants.js';

export const SPR = 32;
const SS = 2, N = SPR * SS;                         // надвибірка 2×2: піксель непрозорий, якщо вкрита хоч одна підточка
const cache = new Map();

// Чи лягає вид площиною на землю (вигляд згори), а не стоїть (вигляд спереду)
const flatForm = (g) => g.form === 'lichen';

// Спрайт виду g, варіант будови variant: {key, data: Uint8Array(SPR²·4), S — сторона квадрата (од.), z0 — низ, flat}
export function spriteOf(g, variant) {
  const key = `${g.key}:${variant}`;
  let sp = cache.get(key);
  if (sp) { cache.delete(key); cache.set(key, sp); return sp; }
  const T = template(g, variant, 0), P = T.p, C = T.c, Nn = T.n, A = T.a, flat = flatForm(g);
  // межі: спереду — u = x, w = z, глибина y (око з −y); згори — u = x, w = y, глибина −z
  let hw = 0, z0 = 0, z1 = 0;
  for (let i = 0; i < T.verts; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    hw = Math.max(hw, Math.abs(x), flat ? Math.abs(y) : 0);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  const S = Math.max(1e-3, flat ? hw * 2 : Math.max(hw * 2, z1 - z0)) * 1.02;
  const col = new Float32Array(N * N * 3), dep = new Float32Array(N * N).fill(Infinity);
  const U = (i) => (P[i * 3] / S + 0.5) * N;
  const W = flat ? (i) => (P[i * 3 + 1] / S + 0.5) * N : (i) => (P[i * 3 + 2] - z0) / S * N;
  const D = flat ? (i) => -P[i * 3 + 2] : (i) => P[i * 3 + 1];
  for (let t = 0; t + 2 < T.verts; t += 3) {
    const ax = U(t), ay = W(t), bx = U(t + 1), by = W(t + 1), cx = U(t + 2), cy = W(t + 2);
    const ar = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(ar) < 1e-9) continue;
    const da = D(t), db = D(t + 1), dc = D(t + 2);
    // колір трикутника: середній колір вершин × AO шаблону × світло за нормаллю (верх світліший)
    let r = 0, g2 = 0, b = 0, nz = 0, ao = 0;
    for (let k = 0; k < 3; k++) { const v = t + k; r += C[v * 3]; g2 += C[v * 3 + 1]; b += C[v * 3 + 2]; nz += Nn[v * 3 + 2] / 127; ao += A ? A[v] / 255 : 1; }
    const sh = (0.8 + 0.2 * (nz / 3)) * (ao / 3) / 3;
    r *= sh; g2 *= sh; b *= sh;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const qx = px + 0.5, qy = py + 0.5;
      const w0 = ((bx - qx) * (cy - qy) - (by - qy) * (cx - qx)) / ar, w1 = ((cx - qx) * (ay - qy) - (cy - qy) * (ax - qx)) / ar, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const d = w0 * da + w1 * db + w2 * dc, o = py * N + px;
      if (d >= dep[o]) continue;
      dep[o] = d; col[o * 3] = r; col[o * 3 + 1] = g2; col[o * 3 + 2] = b;
    }
  }
  // 2×2 → піксель; рядок 0 у пам'яті — v = 0 (низ рослини) і в WebGL, і в WebGPU
  const out = new Uint8Array(SPR * SPR * 4), cov = new Uint8Array(SPR * SPR);
  for (let y = 0; y < SPR; y++) for (let x = 0; x < SPR; x++) {
    let n = 0, r = 0, g2 = 0, b = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const o = (y * SS + j) * N + x * SS + i;
      if (dep[o] === Infinity) continue;
      n++; r += col[o * 3]; g2 += col[o * 3 + 1]; b += col[o * 3 + 2];
    }
    const o = (y * SPR + x) * 4;
    if (n) { out[o] = Math.min(255, r / n); out[o + 1] = Math.min(255, g2 / n); out[o + 2] = Math.min(255, b / n); out[o + 3] = 255; cov[y * SPR + x] = 1; }
  }
  bleed(out, cov);
  sp = { key, data: out, S, z0, flat };
  if (cache.size >= 1500) cache.delete(cache.keys().next().value);
  cache.set(key, sp);
  return sp;
}

// Колір прозорих пікселів — середнє сусідніх уже заповнених (хвилями), решта — середнє всього спрайта
function bleed(px, cov) {
  let done = cov.slice(), front = true;
  for (let pass = 0; pass < 4 && front; pass++) {
    front = false;
    const nd = done.slice();
    for (let y = 0; y < SPR; y++) for (let x = 0; x < SPR; x++) {
      const i = y * SPR + x;
      if (done[i]) continue;
      let n = 0, r = 0, g = 0, b = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= SPR || Y >= SPR || !done[Y * SPR + X]) continue;
        const o = (Y * SPR + X) * 4; n++; r += px[o]; g += px[o + 1]; b += px[o + 2];
      }
      if (n) { const o = i * 4; px[o] = r / n; px[o + 1] = g / n; px[o + 2] = b / n; nd[i] = 1; front = true; }
    }
    done = nd;
  }
  let n = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < SPR * SPR; i++) if (cov[i]) { n++; r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; }
  if (n) for (let i = 0; i < SPR * SPR; i++) if (!done[i]) { px[i * 4] = r / n; px[i * 4 + 1] = g / n; px[i * 4 + 2] = b / n; }
}

// Рослина-спрайт у меш M: схрещені площини (лишайник — одна на землі), сторона S·s, поворот rot; slot — номер спрайта
// в наборі стовпця; нормаль вершини несе координати спрайта: x — u (0 / 127), y — v (0 / 127), z — slot − 127 (рушій
// замінить на шар атласу); колір вершини — множники cj (128 = ×1), AO — небо над основою; mat — матеріал (з міткою
// проріджування у старших бітах, gen/materials.js)
export function placeSprite(M, sp, slot, x, y, z, rot, s, cj, sky, mat) {
  const S = sp.S * s, h = S / 2, c = Math.cos(rot), sn = Math.sin(rot), L = slot - 127;
  const col = [Math.min(255, 128 * cj[0] | 0), Math.min(255, 128 * cj[1] | 0), Math.min(255, 128 * cj[2] | 0)], ao = 255 * sky | 0;
  const v = (px, py, pz, u, w) => M.vert(px, py, pz, u, w, L, col, mat, ao);
  const quad = (a, b, d, e) => { const i = M.n; a(); b(); d(); e(); M.idx(i, i + 1, i + 2); M.idx(i, i + 2, i + 3); };
  if (sp.flat) {
    const zz = z + 0.02, ux = c * h, uy = sn * h, vx = -sn * h, vy = c * h;
    quad(() => v(x - ux - vx, y - uy - vy, zz, 0, 0), () => v(x + ux - vx, y + uy - vy, zz, 127, 0),
      () => v(x + ux + vx, y + uy + vy, zz, 127, 127), () => v(x - ux + vx, y - uy + vy, zz, 0, 127));
    return;
  }
  const zb = z + sp.z0 * s, zt = zb + S;
  for (const [dx, dy] of [[c, sn], [-sn, c]]) {
    const ax = dx * h, ay = dy * h;
    quad(() => v(x - ax, y - ay, zb, 0, 0), () => v(x + ax, y + ay, zb, 127, 0),
      () => v(x + ax, y + ay, zt, 127, 127), () => v(x - ax, y - ay, zt, 0, 127));
  }
}
