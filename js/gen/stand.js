// gen/stand.js — стенд руху ?move (п. 3 roadmap): полігон замість генерованого світу — рівнина з трави (верх k = 7, z 4) і
// зони: A — лази (присідання, повзання), B — стіни (лазіння: камінь, лід, драбина, ліана, навіс), C — схили (сповзання:
// скеля й лід), D — басейн зі щілиною під водою (пірнання), E — рослини й каміння (ціль, обрис). Ті самі роботи генератора
// (job.js: стовпець, секція, рослини, далечінь, предмет) — з цього модуля, закони — всесвіту (0, 0) зерна «stand».
import { CS, CW, SEC, ci, bv, solidB, B_AIR, B_LIQ, B_ICE, B_GRASS, B_ROCK, B_SOIL, B_STONE, B_BED, B_LADDER, B_VINE, O_TREE, O_ROCK, O_COVER, T_LUSH, T_WATER } from './chunk.js';
import { BIOMES } from './biomes.js';
import { speciesOf, regionAt, pickSpecies, groundTint } from './flora.js';
import { M_LUSH } from './materials.js';
import { LEVEL } from '../iso.js';
import { stoneTemplate } from './mesh.js';
import { footprint } from './plants.js';
import { hash2 } from '../rng.js';

const G = 7;                                   // верхній блок рівнини (z верху — 4)
const inR = (v, a, b) => v >= a && v <= b;
// Ходи зони A (x 10…21, підлога k = 8): [y0, y1, висота в рівнях]. Гравець 1,8 м (12.10.2026): 3 × 4 (2 м) — стоячи,
// 1 × 4 і 3 × 3, 1 × 3 — присівши (видимо 1,75 / 1,5 / 1,25), 3 × 2, 1 × 2 — лежачи (1,0 / 0,75), 2 × 1 і 1 × 1 — ні
const LAZ = [[2, 4, 4], [7, 7, 4], [10, 12, 3], [15, 15, 3], [18, 20, 2], [23, 23, 2], [26, 27, 1], [30, 30, 1]];
// Стіни зони B (від k = 8): [y0, y1, висота, блок, x1]
const WALLS = [[4, 10, 4, B_ROCK, 31], [13, 19, 12, B_ROCK, 31], [22, 28, 40, B_ROCK, 33], [31, 37, 12, B_ICE, 31], [40, 42, 12, B_ROCK, 31], [45, 47, 12, B_ROCK, 31], [50, 54, 10, B_ROCK, 31]];
// Рампи зони C (від x = 50 угору по +x, 10 клітинок, далі плато до x = 64): [y0, y1, блоків на den клітинок, den, блок]
const RAMPS = [[2, 6, 1, 1, B_ROCK], [9, 13, 2, 1, B_ROCK], [16, 20, 3, 1, B_ROCK], [23, 27, 4, 1, B_ROCK], [30, 34, 1, 2, B_ICE], [37, 41, 1, 1, B_ICE]];

// Вид блоку стенду в (x, y, k)
export function standBlock(x, y, k) {
  // D — басейн: дно k ≤ 1, вода k 2…7; стіна x = 82 зі щілиною 1 м (k 3…4) на y 10…13
  if (inR(x, 75, 90) && inR(y, 4, 20)) {
    if (k <= 1) return k === 1 ? B_BED : B_STONE;
    if (x === 82 && k <= G && !((k === 3 || k === 4) && inR(y, 10, 13))) return B_ROCK;
    return k <= G ? B_LIQ : B_AIR;
  }
  if (k < G - 2) return B_STONE;
  if (k < G) return B_SOIL;
  if (k === G) return B_GRASS;
  // A — лази в брилі скелі (k 8…13)
  if (inR(x, 10, 21) && inR(y, 0, 32) && k <= 13) {
    for (const [y0, y1, h] of LAZ) if (inR(y, y0, y1) && k < 8 + h) return B_AIR;
    return B_ROCK;
  }
  // B — стіни; драбина й ліана — на клітинку перед стіною (x = 29); навіс над B7 (x 28…29, k 16…17)
  for (const [y0, y1, h, b, x1] of WALLS) {
    if (inR(y, y0, y1) && inR(x, 30, x1) && k < 8 + h) return b;
  }
  if (x === 29 && y === 41 && k < 20) return B_LADDER;
  if (x === 29 && y === 46 && k < 20) return B_VINE;
  if (inR(x, 28, 29) && inR(y, 50, 54) && (k === 16 || k === 17)) return B_ROCK;
  // C — рампи; C7 — платформа 4 блоки зі сходами з уступів у 1 блок з боку −x
  for (const [y0, y1, per, den, b] of RAMPS) {
    if (!inR(y, y0, y1) || !inR(x, 50, 64)) continue;
    const top = 8 + Math.floor(per * (Math.min(x, 59) - 49) / den);
    return k < top ? b : B_AIR;
  }
  if (inR(y, 46, 51)) {
    if (inR(x, 50, 55) && k < 12) return B_ROCK;
    if (inR(x, 47, 49) && k < 8 + (x - 46)) return B_ROCK;
  }
  return B_AIR;
}

// Предмети зони E (x 75…90, y 26…50): дерева, покрив, каміння — [x, y, вид предмета]
const OBJ = [[78, 30, O_TREE], [84, 36, O_TREE], [79, 44, O_TREE], [76, 27, O_COVER], [81, 28, O_COVER], [86, 30, O_COVER], [77, 34, O_COVER], [82, 40, O_COVER],
  [87, 42, O_COVER], [83, 47, O_COVER], [88, 48, O_COVER], [85, 26, O_ROCK], [77, 39, O_ROCK]];
const BM = Math.max(0, BIOMES.findIndex((b) => b.name === 'листяний ліс'));

// Місця стенду (?dev eco.spot): [x, y, погляд — азимут від +x]
export const STAND_SPOTS = {
  start: [4.5, 4.5, 0], A1: [8.5, 3.5, 0], A2: [8.5, 7.5, 0], A3: [8.5, 11.5, 0], A4: [8.5, 15.5, 0], A5: [8.5, 19.5, 0], A6: [8.5, 23.5, 0], A7: [8.5, 27.0, 0], A8: [8.5, 30.5, 0],
  B1: [29.3, 7.5, 0], B2: [29.3, 16.5, 0], B3: [29.3, 25.5, 0], B4: [29.3, 34.5, 0], B5: [29.6, 41.5, 0], B6: [29.6, 46.5, 0], B7: [27.5, 52.5, 0],
  C1: [47.5, 4.5, 0], C2: [55.5, 11.5, Math.PI], C3: [47.5, 18.5, 0], C4: [47.5, 25.5, 0], C5: [47.5, 32.5, 0], C6: [55.5, 39.5, Math.PI], C7: [52.5, 48.5, 0],
  D: [78.5, 12.5, 0], Dgap: [80.6, 11.5, 0], E: [73.5, 38.5, 0], bodies: [68.6, 33.0, 0],
};

// Стовпець стенду: як genCol (gen/chunk.js) — поверхня клітинок з рамкою, «небо», укриття, предмети й види
export function standCol(L, cx, cy) {
  const n = CW * CW, h = new Int16Array(n), t = new Uint8Array(n), v = new Uint8Array(n), bm = new Uint8Array(n).fill(BM), sky = new Int16Array(n), top = new Int16Array(n);
  const cells = new Array(n), x0 = cx * CS, y0 = cy * CS;
  let hmin = Infinity, hmax = -Infinity;
  for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) {
    const i = ci(x, y), wx = x0 + x, wy = y0 + y;
    let k = 60;
    while (k > 0 && !solidB(standBlock(wx, wy, k))) k--;
    const pool = standBlock(wx, wy, G) === B_LIQ;
    h[i] = k + 1; t[i] = pool ? T_WATER : T_LUSH; sky[i] = pool ? -1 : k; top[i] = pool ? G + 1 : k + 1;
    cells[i] = { t: t[i], h: h[i], bed: pool ? 2 : k + 1, fb: 0 };
    hmin = Math.min(hmin, k + 1); hmax = Math.max(hmax, k + 1);
  }
  const obj = [], sp = [], spi = new Map();
  const spIndex = (g) => { let i = spi.get(g.id); if (i === undefined) { i = sp.length; sp.push(g); spi.set(g.id, i); } return i; };
  for (const [ox, oy, kind] of OBJ) {
    const x = ox - x0, y = oy - y0;
    if (x < 0 || y < 0 || x >= CS || y >= CS) continue;
    const S = speciesOf(L, regionAt(L, ox, oy), BM), hs = hash2(ox * 7919 + 13, oy * 104729 + 7) >>> 0;
    const g = kind === O_TREE ? S.big.length && pickSpecies(S.big, hs) : kind === O_COVER ? pickSpecies(S.small, hs) : S.stone;
    if (!g) continue;
    obj.push({ x, y, k: kind, v: hs & 0xffff, s: spIndex(g), z: G + 1, st: 0 });
  }
  return { d: L.d, n: L.n, cx, cy, h, t, v, bm, sky, top, cells, Lt: null, obj, sp, hmin, hmax, stand: true };
}

// Секція cz стовпця стенду: блоки з рамкою (як genSection)
export function standSection(col, cz) {
  const k0 = cz * SEC, b = new Uint8Array(CW * CW * (SEC + 2)), x0 = col.cx * CS, y0 = col.cy * CS;
  let air = 0, solid = 0;
  for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) for (let k = -1; k <= SEC; k++) {
    const q = standBlock(x0 + x, y0 + y, k0 + k);
    b[bv(x, y, k, SEC)] = q;
    if (q === B_AIR) air++; else if (solidB(q)) solid++;
  }
  if (air === b.length) return { empty: true, k0, nk: SEC };
  if (solid === b.length) return { empty: true, solid: true, k0, nk: SEC };
  return { b, k0, nk: SEC };
}

// Плитка далечі стенду: квадрат рівнини на висоті трави (за полігоном — та сама рівнина)
export function standFar(L, tx, ty, FT) {
  const z = (G + 1) * LEVEL, c = groundTint(L, 'lush', BM);
  const pos = new Float32Array([0, 0, z, FT, 0, z, FT, FT, z, 0, FT, z]), nor = new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127]);
  const col = new Uint8Array([...c, ...c, ...c, ...c].map((v) => Math.min(255, v))), mat = new Uint8Array(4).fill(M_LUSH), idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return { mesh: { pos, nor, col, mat, idx, count: 6 }, zmin: z, zmax: z };
}

// Тіла стенду (камені 5…600 кг і левітуючий 120 кг) біля зони E: описи для makeBody (engine/physics/bodies.js) — маса
// = 1800 · 8 · hx · hy · hz (hy = hx, hz = 0,6 · hx), вигляд — шаблон каменя області, масштаб — під коробку
export function standBodies(L) {
  const out = [], S = speciesOf(L, regionAt(L, 70, 36), BM);
  [[5, 70.5, 30.5, 0], [20, 70.5, 33.0, 0], [45, 70.5, 35.5, 0], [120, 70.5, 38.5, 0], [600, 70.5, 42.0, 0], [120, 72.5, 36.5, 1.3]].forEach(([m, x, y, lift], i) => {
    const hx = Math.cbrt(m / 8640), v = 37 + i * 11, T = stoneTemplate(S.stone, v), fp = footprint(T);
    const hover = lift > 1 ? 1.0 : 0;
    out.push({ id: 900001 + i, x, y, z: (G + 1) * LEVEL + hover, hx, hy: hx, hz: 0.6 * hx, dens: 1, lift, hover, T, s: hx / Math.max(0.05, fp.r * 0.75), tilt: 0, yaw: i * 0.7 });
  });
  return out;
}
