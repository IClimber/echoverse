// gen/far.js — далечінь (LOD, крок 4в): плитка FT×FT клітинок поверхні з tile з кроком s (2, 4, 8) — висотне поле
// з кольорами палітри (трава, степ, пустеля — відтінку біому; ліс — темніше; водойма — рідина на рівні поверхні) і матеріалами
// (текстурами) верху, на крутому схилі — боку, як у повних секціях.
// «Спідниця» по краях (стрічка донизу) ховає щілини між плитками різного кроку. Лише вигляд: позиції — від
// куточка плитки, нормалі й кольори — float (рендер), генерація — tile (детермінована)
import { tile, SURF_Z, T_WATER, T_ICE, T_SAND, T_LUSH, T_DRY, T_DESERT, T_SNOW, T_ROCK, T_BED, O_TREE, O_ROCK } from './chunk.js';
import { groundTint } from './flora.js';
import { LEVEL } from '../iso.js';
import { L_LAVA } from '../universe.js';
import { M_LAVA, M_WATER, TOP_MAT, SIDE_MAT } from './materials.js';

export const FT = 128;                        // клітинок на бік плитки

// Плитка (tx, ty) з кроком s: {mesh, zmin, zmax}
export function farMesh(L, tx, ty, s) {
  const n = FT / s + 1, N = n + 2, x0 = tx * FT, y0 = ty * FT, P = L.pal;
  const TOP = [P.liquid, P.ice, P.sand, P.lush, P.dry, P.desert, P.snow, P.rock, P.bed];
  const Z = new Float32Array(N * N), C = new Uint8Array(n * n * 3), T = new Uint8Array(n * n), c = {};
  let zmin = Infinity, zmax = -Infinity;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    tile(L, x0 + (i - 1) * s, y0 + (j - 1) * s, c);
    const water = c.t === T_WATER, z = water || c.t === T_ICE ? SURF_Z : (c.t === T_BED ? c.bed : c.h) * LEVEL + LEVEL;   // верх верхнього блоку
    Z[j * N + i] = z;
    if (i < 1 || j < 1 || i > n || j > n) continue;
    if (z < zmin) zmin = z;
    if (z > zmax) zmax = z;
    const q = (j - 1) * n + i - 1;
    let col = water ? TOP[0].map((v, k) => v + (P.liquidDeep[k] - v) * Math.min(1, c.v / 160))
      : c.t === T_LUSH ? groundTint(L, 'lush', c.bm) : c.t === T_DRY ? groundTint(L, 'dry', c.bm) : c.t === T_DESERT ? groundTint(L, 'desert', c.bm) : TOP[c.t];
    if (c.o === O_TREE) col = col.map((v) => v * 0.62);
    else if (c.o === O_ROCK) col = col.map((v, k) => v * 0.7 + P.rock[k] * 0.3);
    C[q * 3] = Math.min(255, col[0]); C[q * 3 + 1] = Math.min(255, col[1]); C[q * 3 + 2] = Math.min(255, col[2]);
    T[q] = c.t;
  }
  // вершини сітки: нормаль — з різниць сусідніх висот
  const sk = 4 + s * 3, nv = n * n + 4 * n, pos = new Float32Array(nv * 3), nor = new Int8Array(nv * 3), col = new Uint8Array(nv * 3), mat = new Uint8Array(nv);
  const liq = L.liquid.kind === L_LAVA ? M_LAVA : M_WATER;
  // крутий схил (як бічні грані повних секцій): скеля й сніг — камінь, пісок і пустеля — пісковик, решта — ґрунт
  const side = (t) => t === T_SNOW || t === T_ROCK ? P.rock.map((v) => v * 0.82) : t === T_SAND || t === T_DESERT ? P.sand.map((v) => v * 0.82) : P.soil;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = j * n + i, a = (j + 1) * N + i + 1, dx = (Z[a - 1] - Z[a + 1]) / (2 * s), dy = (Z[a - N] - Z[a + N]) / (2 * s), l = Math.hypot(dx, dy, 1);
    pos[v * 3] = i * s; pos[v * 3 + 1] = j * s; pos[v * 3 + 2] = Z[a];
    nor[v * 3] = dx / l * 127; nor[v * 3 + 1] = dy / l * 127; nor[v * 3 + 2] = 1 / l * 127;
    const t = T[v], steep = t !== T_WATER && t !== T_ICE && 1 / l < 0.7, sc = steep ? side(t) : null;
    col[v * 3] = steep ? sc[0] : C[v * 3]; col[v * 3 + 1] = steep ? sc[1] : C[v * 3 + 1]; col[v * 3 + 2] = steep ? sc[2] : C[v * 3 + 2];
    mat[v] = t === T_WATER ? liq : steep ? SIDE_MAT[t] : TOP_MAT[t];
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i;
    idx.push(a, a + 1, a + n + 1, a, a + n + 1, a + n);
  }
  // спідниця: по краях — копія крайньої вершини на sk нижче, стрічка між ними (видно з обох боків — дві сторони)
  let e = n * n;
  const edges = [[0, 1], [n * (n - 1), 1], [0, n], [n - 1, n]];      // [початок, крок] по краю
  for (const [b, st] of edges) {
    const e0 = e;
    for (let k = 0; k < n; k++, e++) {
      const v = b + k * st;
      pos[e * 3] = pos[v * 3]; pos[e * 3 + 1] = pos[v * 3 + 1]; pos[e * 3 + 2] = pos[v * 3 + 2] - sk;
      nor[e * 3] = nor[v * 3]; nor[e * 3 + 1] = nor[v * 3 + 1]; nor[e * 3 + 2] = nor[v * 3 + 2];
      col[e * 3] = col[v * 3] * 0.8; col[e * 3 + 1] = col[v * 3 + 1] * 0.8; col[e * 3 + 2] = col[v * 3 + 2] * 0.8;
      mat[e] = mat[v];
    }
    for (let k = 0; k < n - 1; k++) {
      const a = b + k * st, b2 = b + (k + 1) * st, c0 = e0 + k, c1 = e0 + k + 1;
      idx.push(a, b2, c1, a, c1, c0, a, c1, b2, a, c0, c1);
    }
  }
  const I = nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { mesh: { pos, nor, col, mat, idx: I, count: I.length }, zmin: zmin - sk, zmax };
}
