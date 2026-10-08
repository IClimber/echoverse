// gen/chunk.js — чанк 16×16 клітинок × WORLD_H блоків (блок — 1×1×LEVEL): блоки, поверхня, предмети. Без DOM.
// Основа — поверхня клітинки (tile: висота, тип, предмет) — чиста функція законів і світових координат, тож межі
// сусідніх чанків збігаються самі. Поверх неї — об'ємні закони: печери, нависання, ширяючі острови (3D-шум на
// грубій ґратці 4×4×4 блоки з трилінійною інтерполяцією). Рельєф — шум від (x, y, n): сусідні номери схожі.
import { hash3, unit } from '../rng.js';
import { noise2, noise3, fbm3 } from '../noise.js';
import { SEA, FLOAT_G, L_WATER, L_DRY, WORLD_H } from '../universe.js';
import { LEVEL } from '../iso.js';
import { BIOMES, pickBiome, Z_TEMP, Z_COLD, Z_HOT, Z_WET, Z_DRY, Z_DESERT, Z_SNOW, Z_PEAK, Z_BEACH } from './biomes.js';
import { regionAt, speciesOf, pickSpecies } from './flora.js';

export const CS = 16, CW = CS + 2;            // чанк і чанк із рамкою в одну клітинку з усіх боків (бічні грані)
export const ci = (x, y) => (y + 1) * CW + x + 1;   // індекс клітинки (x, y ∈ −1…CS) у масивах чанка
// T_WATER — водойма з рідиною всесвіту (вода, кислота, метан, лава): h — рівень дна, поверхня — SURF_Z;
// T_ICE — замерзла вода (по ній ходять, h = SEA); T_BED — сухе русло (водойма всесвіту без рідини, h — дно)
export const T_WATER = 0, T_ICE = 1, T_SAND = 2, T_LUSH = 3, T_DRY = 4, T_DESERT = 5, T_SNOW = 6, T_ROCK = 7, T_BED = 8;
export const TYPE_NAMES = ['рідина', 'лід', 'пісок', 'зелень', 'степ', 'пустеля', 'сніг', 'скеля', 'сухе русло'];
// O_TREE — велика рослина (дерево, кактус, кристал: заважає ходити), O_COVER — мала (трава, квіти, кущик: не заважає),
// O_FLOAT — камінь, що ширяє (легка гравітація): під ним можна пройти
export const O_TREE = 1, O_ROCK = 2, O_FLOAT = 3, O_COVER = 4;
export const blocks = (o) => o === O_TREE || o === O_ROCK;
export const SURF_Z = SEA * LEVEL - 0.15;     // поверхня рідини й льоду — трохи нижча за рівень моря

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
export const isWater = (t) => t === T_WATER;
export const topZ = (h, t) => t === T_ICE ? SURF_Z : h * LEVEL;   // висота твердої поверхні (у водоймі — дна)

// Висота 0…1 у точці (x, y)
export function elevation(L, x, y) {
  const z = L.n;
  const c = noise3(L.sA, x / 192, y / 192, z * 0.01);         // материки: змінюються за ~100 стрибків
  const h = fbm3(L.sB, x / 48, y / 48, z * 0.025, 3);         // пагорби: за ~40, їх дрібні октави — швидше
  const f = noise3(L.sC, x / 12, y / 12, z * 0.15);           // дрібниці: помітно за кілька стрибків
  return clamp01(0.5 + L.contrast * (L.wc * c + L.wh * h + L.wd * f) / (L.wc + L.wh + L.wd));
}

// Чи r клітинки (x, y) — найменший серед сусідів (дерева не стоять впритул: між стовбурами завжди прохід);
// dense — лише сусіди навхрест (густіше)
function lonely(L, x, y, r, dense) {
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    if ((!i && !j) || (dense && i && j)) continue;
    if (unit(hash3(L.sO, x + i, y + j)) < r) return false;
  }
  return true;
}

// Клітинка (x, y) → out: h (рівень; у водоймі — дна), t (тип), v (глибина 0…255), bm (біом), o (предмет),
// ov (варіант 0…65535), os (хеш вибору виду)
export function tile(L, x, y, out = {}) {
  const px = x + 0.5, py = y + 0.5;           // центр клітинки: не на вузлах ґратки шуму
  const e = elevation(L, px, py);
  const T0 = L.temp + 0.6 * fbm3(L.sT, px / 300, py / 300, L.n * 0.03, 3);   // кілька октав: межі кліматів не прямі
  out.o = 0; out.ov = 0; out.os = 0; out.v = 0; out.bm = 0;
  if (e < L.seaE) {
    // Дно: що далі від берега (нижче рівня моря), то глибше; біля берега — мілина (рівень SEA − 1)
    out.h = Math.max(0, SEA - 1 - Math.floor((L.seaE - e) * 22));
    out.v = Math.min(255, Math.floor((L.seaE - e) * 1200));
    const k = L.liquid.kind;
    out.t = k === L_DRY ? T_BED : k === L_WATER && T0 < -0.6 ? T_ICE : T_WATER;
    out.bed = out.h;
    if (out.t === T_ICE) out.h = SEA;
    return out;
  }
  const h = SEA + 1 + Math.min(L.amp - 1, Math.floor((e - L.seaE) / (1 - L.seaE) * L.amp));
  const T = T0 - 0.05 * (h - SEA - 1);        // вище — холодніше
  const W = L.wet + 0.65 * fbm3(L.sW, px / 220, py / 220, L.n * 0.03, 3);
  let t;
  if (T < -0.45) t = T_SNOW;
  else if (h - SEA >= Math.max(6, L.amp * 0.72)) t = T_ROCK;
  else if (h === SEA + 1 && e - L.seaE < 0.025) t = T_SAND;
  else if (W < -0.35) t = T > 0.15 ? T_DESERT : T_DRY;
  else if (W < -0.05) t = T_DRY;
  else t = T_LUSH;
  out.h = h; out.t = t; out.bed = h;
  // Біом: кліматична зона + варіант (окреме поле шуму з дрібнішою домішкою — межі не гладкі)
  const zone = t === T_SNOW ? Z_SNOW : t === T_ROCK ? Z_PEAK : t === T_SAND ? Z_BEACH : t === T_DESERT ? Z_DESERT : t === T_DRY ? Z_DRY
    : W > 0.45 && h - SEA <= 3 ? Z_WET : T < -0.15 ? Z_COLD : T > 0.35 ? Z_HOT : Z_TEMP;
  const vb = noise2(L.sBv, px / L.bioS, py / L.bioS) + 0.3 * noise2(L.sBv ^ 0x3c6e, px / 40, py / 40);
  const bm = out.bm = pickBiome(L, zone, clamp01(0.5 + 0.8 * vb)), Bm = BIOMES[bm];
  // Предмети: кандидат — хеш клітинки від зерна глибини (не номера), поріг — густота цього всесвіту й біому.
  // Тож у сусідніх всесвітах ліс той самий, лише рідший чи густіший. Дерево — лише там, де r найменший серед сусідів
  const r = unit(hash3(L.sO, x, y));
  const patch = 0.3 + 1.4 * clamp01(0.5 + noise3(L.sF, px / 24, py / 24, L.n * 0.06));
  if (Bm.trees && unit(hash3(L.sO ^ 0x2545f491, x, y)) < L.flora * 6 * Bm.trees * patch && lonely(L, x, y, r, Bm.dense)) out.o = O_TREE;
  else if (r > 1 - L.rocks * Bm.rocks) out.o = O_ROCK;
  else if (Bm.small.length && unit(hash3(L.sCv, x, y)) < Bm.cover * (0.35 + 1.3 * clamp01(0.5 + noise3(L.sCv, px / 14, py / 14, L.n * 0.06)))) out.o = O_COVER;
  if (out.o) { out.ov = hash3(L.sO, y, x) & 0xffff; out.os = hash3(L.sM, x, y); }
  if (out.o === O_ROCK && L.grav < FLOAT_G && out.ov & 3) out.o = O_FLOAT;   // три чверті каміння ширяє
  return out;
}

// ================= Блоки =================
export const H = WORLD_H;
export const B_AIR = 0, B_LIQ = 1, B_ICE = 2, B_SAND = 3, B_GRASS = 4, B_DRY = 5, B_DESERT = 6, B_SNOW = 7, B_ROCK = 8,
  B_BED = 9, B_MUD = 10, B_SOIL = 11, B_STONE = 12, B_SANDSTONE = 13;
export const BLOCK_NAMES = ['повітря', 'рідина', 'лід', 'пісок', 'трава', 'степ', 'пустеля', 'сніг', 'скеля', 'дно', 'глина', 'ґрунт', 'камінь', 'пісковик'];
export const solidB = (b) => b >= B_ICE;                 // тверде (лід теж); рідина й повітря — ні
const TOP_BLOCK = [B_BED, B_ICE, B_SAND, B_GRASS, B_DRY, B_DESERT, B_SNOW, B_ROCK, B_MUD];   // за типом поверхні T_*
const SUB_BLOCK = [B_SOIL, B_SOIL, B_SANDSTONE, B_SOIL, B_SOIL, B_SANDSTONE, B_SOIL, B_STONE, B_SOIL];
// Індекс блоку (x, y ∈ −1…CS, k ∈ 0…H−1) у масиві чанка: стовпець за стовпцем
export const bi = (x, y, k) => ((y + 1) * CW + x + 1) * H + k;
const ISL0 = 44, ISL1 = 84, ISLC = 63;                   // смуга висот ширяючих островів (блоки)

// Груба ґратка 3D-шуму (крок G блоків) над прямокутником клітинок: чотири поля — два для печер (тунель — там, де
// обидва близькі до нуля), нависання, острови. Значення між вузлами — трилінійна інтерполяція (точна арифметика)
const G = 4;
function lattice(L, x0, y0, x1, y1) {
  const gx0 = Math.floor(x0 / G), gy0 = Math.floor(y0 / G), nx = Math.floor(x1 / G) - gx0 + 2, ny = Math.floor(y1 / G) - gy0 + 2, nk = H / G + 1;
  const F = new Float64Array(nx * ny * nk * 4), isl = L.islands > 0.02;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let q = 0; q < nk; q++) {
    const x = (gx0 + i) * G, y = (gy0 + j) * G, k = q * G, o = ((j * nx + i) * nk + q) * 4;
    F[o] = noise3(L.sK, x / 28, y / 28, k / 14);
    F[o + 1] = noise3(L.sK2, x / 28, y / 28, k / 14);
    F[o + 2] = noise3(L.sV, x / 20, y / 20, k / 10);
    F[o + 3] = isl && k >= ISL0 - G && k <= ISL1 + G ? 0.85 * noise3(L.sI, x / 22, y / 22, k / 8) + 0.35 * noise3(L.sI ^ 0x5bd1, x / 9, y / 9, k / 5) : -9;
  }
  return { F, gx0, gy0, nx, nk };
}
function sample(Lt, f, x, y, k) {
  const gx = x / G - Lt.gx0, gy = y / G - Lt.gy0, gk = k / G;
  const i = Math.floor(gx), j = Math.floor(gy), q = Math.min(Lt.nk - 2, Math.floor(gk));
  const u = gx - i, v = gy - j, w = gk - q, nx = Lt.nx, nk = Lt.nk, F = Lt.F;
  const at = (a, b, c) => F[(((j + b) * nx + i + a) * nk + q + c) * 4 + f];
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(at(0, 0, 0), at(1, 0, 0), u), l(at(0, 1, 0), at(1, 1, 0), u), v),
    l(l(at(0, 0, 1), at(1, 0, 1), u), l(at(0, 1, 1), at(1, 1, 1), u), v), w);
}

// Стовпець (x, y) у масив B з позиції o (H блоків знизу вгору). c — поверхня (tile), Lt — ґратка
function column(L, Lt, x, y, c, B, o) {
  const basin = c.t === T_WATER || c.t === T_ICE || c.t === T_BED;
  const px = x + 0.5, py = y + 0.5, top = TOP_BLOCK[c.t], sub = SUB_BLOCK[c.t];
  if (basin) {                                            // водойма: дно, рідина, лід зверху; печер і нависань не чіпаємо
    for (let k = 0; k < H; k++) B[o + k] = k < c.bed - 2 ? B_STONE : k < c.bed - 1 ? B_SOIL : k < c.bed ? top === B_ICE ? B_BED : top : B_AIR;
    if (c.t !== T_BED) for (let k = c.bed; k < SEA; k++) B[o + k] = c.t === T_ICE && k === SEA - 1 ? B_ICE : B_LIQ;
  } else {
    const ov = L.overhang * 5, cr = L.caveW * (0.5 + L.caves), cr2 = cr * cr;
    for (let k = 0; k < H; k++) {
      let s = k < c.h;
      // нависання й арки: поверхня зсувається 3D-шумом поблизу (тож профіль схилу буває не монотонним)
      if (ov > 0.2 && k > c.h - 7 && k < c.h + 7) s = k < c.h + sample(Lt, 2, px, py, k) * ov;
      // печери-тунелі: обидва поля близькі до нуля; не біля самого дна світу
      if (s && k > 1 && k < c.h + 1) { const a = sample(Lt, 0, px, py, k), b = sample(Lt, 1, px, py, k); if (a * a + b * b < cr2) s = false; }
      B[o + k] = s ? B_STONE : B_AIR;
    }
    // ширяючі острови: краплі щільності в смузі висот
    if (L.islands > 0.02) {
      const thr = 0.66 - 0.3 * L.islands;
      for (let k = ISL0; k <= ISL1; k++) {
        const dz = (k - ISLC) / 15;
        if (sample(Lt, 3, px, py, k) - dz * dz > thr) B[o + k] = B_STONE;
      }
    }
    // Матеріали зверху вниз: шар, що починається біля поверхні (чи на острові), — верхній блок поверхні, 2 блоки
    // підґрунтя, далі камінь; стеля й дно печер — камінь
    let depth = 0, surf = false;
    for (let k = H - 1; k >= 0; k--) {
      if (B[o + k] === B_AIR) { depth = 0; continue; }
      if (depth === 0) surf = k >= c.h - 7;
      B[o + k] = surf ? (depth === 0 ? top : depth < 3 ? sub : B_STONE) : B_STONE;
      depth++;
    }
  }
}

// Відкритий небу верхній твердий блок стовпця (для предметів, приземлення); −1 — немає
export function surfaceK(B, o, below = H) {
  for (let k = Math.min(H, below) - 1; k >= 0; k--) if (B[o + k] !== B_AIR) return k;
  return -1;
}

// Стовпець окремо (місце появи, перевірки): {c (поверхня), B (H блоків)}
export function genColumn(L, x, y) {
  const c = tile(L, x, y), B = new Uint8Array(H);
  column(L, lattice(L, x, y, x, y), x, y, c, B, 0);
  return { c, B };
}

// Чанк (cx, cy): блоки CW×CW×H з рамкою (індекс — bi), поверхня клітинок h / t / v (індекс — ci; h — рівень
// поверхні з tile, для мінікарт і клімату), предмети — лише у своїх клітинках і лише на відкритій поверхні
export function genChunk(L, cx, cy) {
  const h = new Uint8Array(CW * CW), t = new Uint8Array(CW * CW), v = new Uint8Array(CW * CW), bm = new Uint8Array(CW * CW), b = new Uint8Array(CW * CW * H);
  const obj = [], sp = [], spi = new Map(), c = {}, x0 = cx * CS, y0 = cy * CS, Lt = lattice(L, x0 - 1, y0 - 1, x0 + CS, y0 + CS);
  const spIndex = (g) => { let i = spi.get(g.id); if (i === undefined) { i = sp.length; sp.push(g); spi.set(g.id, i); } return i; };
  for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) {
    tile(L, x0 + x, y0 + y, c);
    const i = ci(x, y), o = bi(x, y, 0);
    h[i] = c.h; t[i] = c.t; v[i] = c.v; bm[i] = c.bm;
    column(L, Lt, x0 + x, y0 + y, c, b, o);
    if (c.o && x >= 0 && y >= 0 && x < CS && y < CS) {
      const k = surfaceK(b, o, c.h + 7);                   // предмет стоїть на верхньому твердому блоці біля поверхні
      if (k < 0 || !solidB(b[o + k]) || b[o + k + 1] !== B_AIR || (c.o !== O_COVER && b[o + k + 2] !== B_AIR)) continue;
      // вид: з набору області в цьому біомі (каміння — стиль області)
      const S = speciesOf(L, regionAt(L, x0 + x, y0 + y), c.bm);
      const g = c.o === O_TREE ? S.big.length && pickSpecies(S.big, c.os) : c.o === O_COVER ? pickSpecies(S.small, c.os) : S.stone;
      if (!g) continue;
      obj.push({ x, y, k: c.o, v: c.ov, s: spIndex(g), z: k + 1 });
    }
  }
  return { d: L.d, n: L.n, cx, cy, h, t, v, bm, b, obj, sp };
}

// Клітинки з предметом, що заважає ходити (дерево, камінь на землі)
export function solidMask(C) {
  const m = new Uint8Array(CS * CS);
  for (const o of C.obj) if (blocks(o.k)) m[o.y * CS + o.x] = 1;
  return m;
}

// Відбиток чанка (свої клітинки й предмети) — для тестів і F3: однаковий у всіх рушіях
export function digest(C) {
  let a = 0x811c9dc5;
  const add = (x) => { a = Math.imul(a ^ x, 16777619); };
  for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
    const i = ci(x, y), o = bi(x, y, 0);
    add(C.h[i]); add(C.t[i]); add(C.v[i]);
    for (let k = 0; k < H; k++) add(C.b[o + k]);
  }
  for (const o of C.obj) { add(o.x | o.y << 4); add(o.k); add(o.v); add(C.sp[o.s].id); add(o.z); }
  return (a >>> 0).toString(16).padStart(8, '0');
}
