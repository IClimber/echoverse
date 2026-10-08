// gen/chunk.js — чанк 16×16 клітинок × WORLD_H блоків (блок — 1×1×LEVEL): блоки, поверхня, предмети. Без DOM.
// Основа — поверхня клітинки (tile: висота, тип, предмет) — чиста функція законів і світових координат, тож межі
// сусідніх чанків збігаються самі. Поверх неї — об'ємні закони: печери, нависання, ширяючі острови (3D-шум на
// грубій ґратці 4×4×4 блоки з трилінійною інтерполяцією). Рельєф — шум від (x, y, n): сусідні номери схожі.
import { hash2, hash3, unit } from '../rng.js';
import { noise2, noise3, fbm3 } from '../noise.js';
import { SEA, L_WATER, L_DRY, WORLD_H, floats, gravityAt } from '../universe.js';
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

// Чи r клітинки (x, y) — найменший серед сусідів у радіусі rs (дерева не стоять впритул: між стовбурами завжди прохід;
// великі — рідше); dense — лише сусіди навхрест (густіше, лише при rs = 1)
function lonely(L, x, y, r, dense, rs) {
  for (let j = -rs; j <= rs; j++) for (let i = -rs; i <= rs; i++) {
    if ((!i && !j) || (dense && rs === 1 && i && j)) continue;
    if (unit(hash3(L.sO, x + i, y + j)) < r) return false;
  }
  return true;
}

// Квадратний корінь ітераціями Ньютона: лише + − × ÷, тож однаковий у всіх рушіях (Math.sqrt — ні)
function nsqrt(v) {
  if (v <= 0) return 0;
  let r = v < 1 ? 0.5 + 0.5 * v : 0.5 * v + 0.5;
  for (let i = 0; i < 10; i++) r = 0.5 * (r + v / r);
  return r;
}
const absv = (v) => v < 0 ? -v : v;
// Об'єкт на ґратці з кроком S (кратер, вулкан, шпиль): у клітинці ґратки — з імовірністю prob, центр — у середніх
// 40 % клітинки (тож радіус до 1,3 S видно лише з сусідніх клітинок). f(dx, dy, h) — внесок; сума внесків
function onGrid(seed, px, py, S, prob, f) {
  const gx = Math.floor(px / S), gy = Math.floor(py / S);
  let sum = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const h = hash3(seed, gx + i, gy + j);
    if (unit(h) >= prob) continue;
    const cx = (gx + i + 0.3 + 0.4 * unit(hash2(h, 1))) * S, cy = (gy + j + 0.3 + 0.4 * unit(hash2(h, 2))) * S;
    sum += f(px - cx, py - cy, h);
  }
  return sum;
}

// Форми рельєфу в просторі висоти e (до класифікації; span — e на блок): тераси й плато, річкові долини (до рівня
// моря — у руслі рідина), каньйони (у сухому кліматі W), кратери (чаша з валом; нижче моря — озеро)
function carve(L, px, py, e, W, span) {
  const R = L.relief;
  if (R.terrace > 0.15 && e > L.seaE) {
    const mk = noise2(L.sTr, px / 260, py / 260) + 0.35 * R.terrace - 0.2;
    if (mk > 0) {
      const q = (e - L.seaE) / span / R.terraceStep, fl = Math.floor(q), f = q - fl, k = 1 + 6 * R.terrace;
      const f2 = clamp01((f - 0.5) * k + 0.5), m = mk * 4 < 1 ? mk * 4 : 1;
      e += ((fl + f2) * R.terraceStep * span + L.seaE - e) * m;
    }
  }
  const wq = noise2(L.sRv ^ 0x77, px / 90, py / 90);
  if (R.rivers > 0.3 && e > L.seaE - 0.02) {
    const r = absv(noise2(L.sRv, px / R.riverS + wq * 0.3, py / R.riverS - wq * 0.3)), w = 0.004 + 0.016 * R.rivers, wv = w * 4;
    if (r < w) e = Math.min(e, L.seaE - 0.01 - 0.025 * (1 - r / w));
    else if (r < wv) { const m0 = 1 - (r - w) / (wv - w), m = m0 * m0 * (3 - 2 * m0); e = Math.min(e, e + (L.seaE + 0.004 - e) * m); }
  }
  if (R.canyons > 0.08 && e > L.seaE + 0.02) {
    const dry = clamp01((0.25 - W) * 2);
    if (dry > 0) {
      const c = absv(noise2(L.sCy, px / 150 + wq * 0.4, py / 150)), cw = 0.008 + 0.03 * R.canyons;
      if (c < cw * 1.5) {
        const fe = Math.max(L.seaE + 0.015, e - R.canyonD * dry), m = c < cw ? 1 : (cw * 1.5 - c) / (cw * 0.5);
        e += (fe - e) * m;
      }
    }
  }
  if (R.craters > 0.02) {
    const Rm = R.craterR;
    e += span * onGrid(L.sFt, px, py, Rm * 2 + 12, 0.55 * R.craters * R.craters, (dx, dy, h) => {
      const Rr = Rm * (0.35 + 0.65 * unit(hash2(h, 3))), u = (dx * dx + dy * dy) / (Rr * Rr);
      if (u >= 1.7) return 0;
      const depth = Rr * 0.4, rim = Rr * 0.12 + 1;
      return u < 1 ? -depth * (1 - u) * (1 - u * 0.3) + rim * u * u : rim * (1.7 - u) / 0.7;
    });
  }
  return e;
}

// Вершинні форми в блоках над поверхнею (без межі амплітуди): вулкани (конус з жерлом; діючий — лава в жерлі,
// out.magma) і гострі шпилі. Повертає блоки
function peaks(L, px, py, out) {
  const R = L.relief;
  let dh = 0;
  if (R.volcano > 0.05) {
    const Hm = R.volcanoH, S = 300;
    dh += onGrid(L.sFt ^ 0x51ed, px, py, S, 0.45 * R.volcano * R.volcano, (dx, dy, h) => {
      const Hv = Hm * (0.55 + 0.45 * unit(hash2(h, 4))), Rv = Hv * 1.7 + 12, d = nsqrt(dx * dx + dy * dy), t = 1 - d / Rv;
      if (t <= 0) return 0;
      const rc = 0.16;
      if (t < 1 - rc) return Hv * t * t * (1.6 - 0.6 * t);
      const t0 = 1 - rc, top = Hv * t0 * t0 * (1.6 - 0.6 * t0), s = d / (rc * Rv);
      if (R.volcanoLava && s < 0.8) out.magma = true;
      return top - Hv * 0.3 * (1 - s * s);
    });
  }
  if (R.spires > 0.01) {
    dh += onGrid(L.sFt ^ 0x2c1b, px, py, 16, 0.5 * R.spires, (dx, dy, h) => {
      const Rr = 1 + 2.2 * unit(hash2(h, 5)), u = (dx * dx + dy * dy) / (Rr * Rr);
      return u < 1 ? R.spireH * (0.5 + 0.5 * unit(hash2(h, 6))) * (1 - u) * (1 - u) : 0;
    });
  }
  return dh;
}
const DUNE_DIR = [[1, 0], [0.8, 0.6], [0.6, 0.8], [0, 1], [-0.6, 0.8], [-0.8, 0.6]];

// Клітинка (x, y) → out: h (рівень; у водоймі — дна), t (тип), v (глибина 0…255), bm (біом), o (предмет),
// ov (варіант 0…65535), os (хеш вибору виду), magma (у жерлі вулкана — розпечена лава)
export function tile(L, x, y, out = {}) {
  const px = x + 0.5, py = y + 0.5;           // центр клітинки: не на вузлах ґратки шуму
  const T0 = L.temp + 0.6 * fbm3(L.sT, px / 300, py / 300, L.n * 0.03, 3);   // кілька октав: межі кліматів не прямі
  const W = L.wet + 0.65 * fbm3(L.sW, px / 220, py / 220, L.n * 0.03, 3);
  const span = (1 - L.seaE) / L.amp;          // висота e на один блок
  out.o = 0; out.ov = 0; out.os = 0; out.v = 0; out.bm = 0; out.cold = T0 < -0.6; out.magma = false;
  const e = carve(L, px, py, elevation(L, px, py), W, span);
  const xb = peaks(L, px, py, out), ex = e + xb * span;
  if (ex < L.seaE) {
    // Дно: що далі від берега (нижче рівня моря), то глибше; біля берега — мілина (рівень SEA − 1)
    out.h = Math.max(1, SEA - 1 - Math.floor((L.seaE - ex) * 22));   // дно — щонайменше 1 блок (під водою не порожнеча)
    out.v = Math.min(255, Math.floor((L.seaE - ex) * 1200));
    const k = L.liquid.kind;
    out.t = k === L_DRY ? T_BED : k === L_WATER && out.cold ? T_ICE : T_WATER;
    out.bed = out.h;
    if (out.t === T_ICE) out.h = SEA;
    return out;
  }
  // висота: основа — у межах амплітуди, вулкани й шпилі — понад неї
  let h = e >= L.seaE ? SEA + 1 + Math.min(L.amp - 1, Math.floor((e - L.seaE) / (1 - L.seaE) * L.amp)) + Math.floor(xb)
    : SEA + 1 + Math.floor((ex - L.seaE) / span);
  if (h > H - 8) h = H - 8;
  const T = T0 - 0.05 * (h - SEA - 1);        // вище — холодніше
  let t;
  if (T < -0.45) t = T_SNOW;
  else if (xb > 2 || out.magma) t = T_ROCK;
  else if (h - SEA >= Math.max(6, L.amp * 0.72)) t = T_ROCK;
  else if (h === SEA + 1 && ex - L.seaE < 0.025) t = T_SAND;
  else if (W < -0.35) t = T > 0.15 ? T_DESERT : T_DRY;
  else if (W < -0.05) t = T_DRY;
  else t = T_LUSH;
  // дюни: асиметрична хвиля (пологий навітряний схил, крутий підвітряний) уздовж напрямку вітру
  if (t === T_DESERT && L.relief.dunes > 0.2) {
    const [dx, dy] = DUNE_DIR[L.relief.duneDir], ph = (px * dx + py * dy) / L.relief.duneL + 0.8 * noise2(L.sDn, px / 50, py / 50), f = ph - Math.floor(ph);
    h += Math.floor((f < 0.75 ? f / 0.75 : (1 - f) / 0.25) * (1 + 3 * L.relief.dunes));
  }
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
  if (Bm.trees && unit(hash3(L.sO ^ 0x2545f491, x, y)) < L.flora * 6 * Bm.trees * patch && lonely(L, x, y, r, Bm.dense, L.treeH < 1.5 ? 1 : L.treeH < 3 ? 2 : 3)) out.o = O_TREE;
  else if (r > 1 - L.rocks * Bm.rocks) out.o = O_ROCK;
  else if (Bm.small.length && unit(hash3(L.sCv, x, y)) < Bm.cover * (0.35 + 1.3 * clamp01(0.5 + noise3(L.sCv, px / 14, py / 14, L.n * 0.06)))) out.o = O_COVER;
  if (out.o) { out.ov = hash3(L.sO, y, x) & 0xffff; out.os = hash3(L.sM, x, y); }
  // Порода каменю: з левітуючих порід всесвіту (частка кожної), інакше звичайна. Левітує — якщо умова породи виконана
  // за місцевої гравітації (аномалії) і підйомна сила більша за вагу. Левітуючі породи дають ще й окреме ширяюче каміння
  out.st = 0;
  if (L.stones.length && (out.o === O_ROCK || !out.o)) {
    let sum = 0;
    for (const st of L.stones) sum += st.share;
    const k = sum > 1 ? 1 / sum : 1, u = unit(hash3(L.sO ^ 0x51f1, x, y));
    let acc = 0, pick = -1;
    for (let i = 0; i < L.stones.length; i++) { acc += L.stones[i].share * k; if (u < acc) { pick = i; break; } }
    const extra = !out.o && unit(hash3(L.sO ^ 0x77e1, x, y)) < 0.006;
    if (pick >= 0 && (out.o === O_ROCK || extra)) {
      const st = L.stones[pick], g = L.grav * gravityAt(L, px, py).k;
      if (st.lift > 1 && floats(st, g, L.mag.k)) { out.o = O_FLOAT; out.st = pick + 1; }
      else if (out.o === O_ROCK) out.st = pick + 1;
      if (extra && out.o) { out.ov = hash3(L.sO, y, x) & 0xffff; out.os = hash3(L.sM, x, y); }
    }
  }
  if (out.magma) out.o = 0;                     // у жерлі — нічого не росте
  return out;
}

// ================= Блоки =================
export const H = WORLD_H;
export const B_AIR = 0, B_LIQ = 1, B_ICE = 2, B_SAND = 3, B_GRASS = 4, B_DRY = 5, B_DESERT = 6, B_SNOW = 7, B_ROCK = 8,
  B_BED = 9, B_MUD = 10, B_SOIL = 11, B_STONE = 12, B_SANDSTONE = 13, B_MAGMA = 14, B_FLOAT = 15;
export const BLOCK_NAMES = ['повітря', 'рідина', 'лід', 'пісок', 'трава', 'степ', 'пустеля', 'сніг', 'скеля', 'дно', 'глина', 'ґрунт', 'камінь', 'пісковик', 'розпечена лава', 'левітуюча порода'];
export const solidB = (b) => b >= B_ICE;                 // тверде (лід теж); рідина й повітря — ні
const TOP_BLOCK = [B_BED, B_ICE, B_SAND, B_GRASS, B_DRY, B_DESERT, B_SNOW, B_ROCK, B_MUD];   // за типом поверхні T_*
const SUB_BLOCK = [B_SOIL, B_SOIL, B_SANDSTONE, B_SOIL, B_SOIL, B_SANDSTONE, B_SOIL, B_STONE, B_SOIL];
// Об'єм блоків (секція чи стовпець): x, y ∈ −1…CS (рамка), k ∈ −1…nk (рамка знизу й згори); індекс — стовпець
// за стовпцем. k — локальний (від k0 об'єму)
export const bv = (x, y, k, nk) => ((y + 1) * CW + x + 1) * (nk + 2) + k + 1;
export const bi = (x, y, k) => bv(x, y, k, H);           // стовпець 0…H−1 (тести, відбитки)
export const SEC = 16;                                    // секція — 16×16×16 блоків
const ISL0 = 44, ISL1 = 84, ISLC = 63;                    // смуга висот ширяючих островів (блоки)

// Груба ґратка 3D-шуму (крок G блоків, вузли — на спільній світовій сітці) над прямокутником клітинок і діапазоном
// висот kA…kB: чотири поля — два для печер (тунель — там, де обидва близькі до нуля), нависання, острови. Значення між
// вузлами — трилінійна інтерполяція (точна арифметика; від положення ґратки не залежить)
const G = 4;
function lattice(L, x0, y0, x1, y1, kA = 0, kB = H) {
  const gx0 = Math.floor(x0 / G), gy0 = Math.floor(y0 / G), nx = Math.floor(x1 / G) - gx0 + 2, ny = Math.floor(y1 / G) - gy0 + 2;
  const q0 = Math.floor(kA / G), nk = Math.floor(kB / G) - q0 + 2;
  const F = new Float64Array(nx * ny * nk * 4), isl = L.islands > 0.02;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let q = 0; q < nk; q++) {
    const x = (gx0 + i) * G, y = (gy0 + j) * G, k = (q0 + q) * G, o = ((j * nx + i) * nk + q) * 4;
    F[o] = noise3(L.sK, x / 28, y / 28, k / 14);
    F[o + 1] = noise3(L.sK2, x / 28, y / 28, k / 14);
    F[o + 2] = noise3(L.sV, x / 20, y / 20, k / 10);
    F[o + 3] = isl && k >= ISL0 - G && k <= ISL1 + G ? 0.85 * noise3(L.sI, x / 22, y / 22, k / 8) + 0.35 * noise3(L.sI ^ 0x5bd1, x / 9, y / 9, k / 5) : -9;
  }
  return { F, gx0, gy0, q0, nx, nk };
}
function sample(Lt, f, x, y, k) {
  const gx = x / G - Lt.gx0, gy = y / G - Lt.gy0, gk = k / G - Lt.q0;
  const i = Math.floor(gx), j = Math.floor(gy), q = Math.floor(gk);
  const u = gx - i, v = gy - j, w = gk - q, nx = Lt.nx, nk = Lt.nk, F = Lt.F;
  const at = (a, b, c) => F[(((j + b) * nx + i + a) * nk + q + c) * 4 + f];
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(at(0, 0, 0), at(1, 0, 0), u), l(at(0, 1, 0), at(1, 1, 0), u), v),
    l(l(at(0, 0, 1), at(1, 0, 1), u), l(at(0, 1, 1), at(1, 1, 1), u), v), w);
}

// Сира щільність суходолу на висоті k: 0 — повітря, 1 — ґрунт, 2 — острів. Нижче світу (k < 0) — камінь
function raw(L, Lt, c, px, py, k) {
  if (k < 0) return 1;
  let s = k < c.h;
  // нависання й арки: поверхня зсувається 3D-шумом поблизу (тож профіль схилу буває не монотонним)
  const ov = L.overhang * 5;
  if (ov > 0.2 && k > c.h - 7 && k < c.h + 7) s = k < c.h + sample(Lt, 2, px, py, k) * ov;
  // печери-тунелі: обидва поля близькі до нуля; не біля самого дна світу
  if (s && k > 1 && k < c.h + 1) {
    const cr = L.caveW * (0.5 + L.caves), a = sample(Lt, 0, px, py, k), b = sample(Lt, 1, px, py, k);
    if (a * a + b * b < cr * cr) s = false;
  }
  if (s) return 1;
  // ширяючі острови: краплі щільності в смузі висот
  if (L.islands > 0.02 && k >= ISL0 && k <= ISL1) {
    const dz = (k - ISLC) / 15;
    if (sample(Lt, 3, px, py, k) - dz * dz > 0.66 - 0.3 * L.islands) return 2;
  }
  return 0;
}
const isBasin = (c) => c.t === T_WATER || c.t === T_ICE || c.t === T_BED;

// «Небо» стовпця суходолу: найвищий ґрунт нижче смуги островів біля поверхні (−1 — немає). Нижче моря й під
// відкритим небом — западина під рідиною
function skyOf(L, Lt, c, px, py) {
  for (let k = Math.min(ISL0 - 1, c.h + 7); k >= 0; k--) if (raw(L, Lt, c, px, py, k) === 1) return k;
  return -1;
}

// Блоки клітинки c на висотах k0…k0+n−1 у масив out (з позиції o, крок 1). sky — skyOf. Матеріали: шар, що
// починається біля поверхні (чи на острові), — верхній блок поверхні, 2 блоки підґрунтя, далі камінь; стеля й дно
// печер — камінь; острів — з левітуючої породи; западина нижче моря — під рідиною (дно — глина, холодна вода — лід)
function fillCell(L, Lt, c, px, py, sky, k0, n, out, o) {
  const top = c.magma ? B_MAGMA : TOP_BLOCK[c.t], sub = c.magma ? B_MAGMA : SUB_BLOCK[c.t];
  if (isBasin(c)) {                                       // водойма: дно, рідина, лід зверху; печер і нависань не чіпаємо
    for (let i = 0; i < n; i++) {
      const k = k0 + i;
      out[o + i] = k < c.bed - 2 ? B_STONE : k < c.bed - 1 ? B_SOIL : k < c.bed ? top === B_ICE ? B_BED : top
        : c.t !== T_BED && k < SEA ? (c.t === T_ICE && k === SEA - 1 ? B_ICE : B_LIQ) : B_AIR;
    }
    return;
  }
  const r = new Uint8Array(n + 3);
  for (let i = 0; i < n + 3; i++) r[i] = raw(L, Lt, c, px, py, k0 + i);
  const pit = sky < SEA - 1 && L.liquid.kind !== L_DRY;
  for (let i = 0; i < n; i++) {
    const k = k0 + i;
    let b = B_AIR;
    if (r[i]) {
      const deep = r[i] === 2 ? B_FLOAT : B_STONE;
      let d = 0;
      while (d < 3 && r[i + d + 1]) d++;
      b = d === 3 ? deep : k + d >= c.h - 7 ? (d === 0 ? top : sub) : deep;
    }
    if (pit) { if (k === sky) b = B_BED; else if (k > sky && k < SEA) b = c.cold && L.liquid.kind === L_WATER && k === SEA - 1 ? B_ICE : B_LIQ; }
    out[o + i] = b;
  }
}

// Відкритий небу верхній непорожній блок клітинки нижче за below (предмети, приземлення); −1 — немає
function surfaceAt(L, Lt, c, px, py, sky, below) {
  const one = new Uint8Array(1);
  for (let k = below - 1; k >= 0; k--) { fillCell(L, Lt, c, px, py, sky, k, 1, one, 0); if (one[0] !== B_AIR) return k; }
  return -1;
}

// Стовпець окремо (місце появи, перевірки): {c (поверхня), at(k) — блок на висоті k, B (блоки 0…H−1)}
export function genColumn(L, x, y) {
  const c = tile(L, x, y), px = x + 0.5, py = y + 0.5, Lt = lattice(L, x, y, x, y, -8, Math.max(H, c.h + 16));
  const sky = isBasin(c) ? -1 : skyOf(L, Lt, c, px, py), B = new Uint8Array(H), one = new Uint8Array(1);
  fillCell(L, Lt, c, px, py, sky, 0, H, B, 0);
  return { c, B, at: (k) => { if (k < 0) return B_STONE; fillCell(L, Lt, c, px, py, sky, k, 1, one, 0); return one[0]; } };
}

// Стовпець чанка (cx, cy): клітинки (tile) з рамкою — поверхня h / t / v / bm (індекс ci; h — рівень поверхні),
// «небо» кожної клітинки, ґратка шуму, предмети (лише у своїх клітинках і лише на відкритій поверхні: z — блок основи)
export function genCol(L, cx, cy) {
  const n = CW * CW, h = new Int16Array(n), t = new Uint8Array(n), v = new Uint8Array(n), bm = new Uint8Array(n), sky = new Int16Array(n);
  const cells = new Array(n), x0 = cx * CS, y0 = cy * CS;
  let hmin = Infinity, hmax = -Infinity;
  for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) {
    const c = tile(L, x0 + x, y0 + y), i = ci(x, y);
    cells[i] = c; h[i] = c.h; t[i] = c.t; v[i] = c.v; bm[i] = c.bm;
    if (c.h < hmin) hmin = c.h;
    if (c.h > hmax) hmax = c.h;
  }
  const Lt = lattice(L, x0 - 1, y0 - 1, x0 + CS, y0 + CS, Math.min(-8, hmin - 16), Math.max(H, hmax + 16));
  const obj = [], sp = [], spi = new Map();
  const spIndex = (g) => { let i = spi.get(g.id); if (i === undefined) { i = sp.length; sp.push(g); spi.set(g.id, i); } return i; };
  const one = new Uint8Array(3);
  for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) {
    const i = ci(x, y), c = cells[i], px = x0 + x + 0.5, py = y0 + y + 0.5;
    sky[i] = isBasin(c) ? -1 : skyOf(L, Lt, c, px, py);
    if (!c.o || x < 0 || y < 0 || x >= CS || y >= CS) continue;
    const k = surfaceAt(L, Lt, c, px, py, sky[i], c.h + 7);   // предмет стоїть на верхньому твердому блоці біля поверхні
    if (k < 0) continue;
    fillCell(L, Lt, c, px, py, sky[i], k, 3, one, 0);
    if (!solidB(one[0]) || one[1] !== B_AIR || (c.o !== O_COVER && one[2] !== B_AIR)) continue;
    // вид: з набору області в цьому біомі (каміння — стиль області)
    const S = speciesOf(L, regionAt(L, x0 + x, y0 + y), c.bm);
    const g = c.o === O_TREE ? S.big.length && pickSpecies(S.big, c.os) : c.o === O_COVER ? pickSpecies(S.small, c.os) : S.stone;
    if (!g) continue;
    obj.push({ x, y, k: c.o, v: c.ov, s: spIndex(g), z: k + 1, st: c.st });
  }
  return { d: L.d, n: L.n, cx, cy, h, t, v, bm, sky, cells, Lt, obj, sp, hmin, hmax };
}

// Блоки стовпця col на висотах k0…k0+nk−1 (з рамкою з усіх боків, індекс bv): {b, k0, nk}
export function genBlocks(L, col, k0, nk) {
  const b = new Uint8Array(CW * CW * (nk + 2)), x0 = col.cx * CS, y0 = col.cy * CS;
  const Lt = k0 - 1 >= col.Lt.q0 * G && k0 + nk + 4 <= (col.Lt.q0 + col.Lt.nk - 1) * G ? col.Lt
    : lattice(L, x0 - 1, y0 - 1, x0 + CS, y0 + CS, k0 - 1, k0 + nk + 4);
  for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) {
    const i = ci(x, y);
    fillCell(L, Lt, col.cells[i], x0 + x + 0.5, y0 + y + 0.5, col.sky[i], k0 - 1, nk + 2, b, bv(x, y, -1, nk));
  }
  return { b, k0, nk };
}

// Чанк (cx, cy) стовпцем 0…H−1 (тести, відбитки, стенди): поверхня, блоки (індекс bi), предмети
export function genChunk(L, cx, cy) {
  const col = genCol(L, cx, cy), V = genBlocks(L, col, 0, H);
  return { d: L.d, n: L.n, cx, cy, h: col.h, t: col.t, v: col.v, bm: col.bm, b: V.b, k0: 0, nk: H, obj: col.obj, sp: col.sp };
}

// Секція (cx, cy, cz) стовпця col: блоки SEC заввишки; порожня (усе повітря) — {empty: true}
export function genSection(L, col, cz) {
  const V = genBlocks(L, col, cz * SEC, SEC);
  let any = false;
  for (let i = 0; i < V.b.length; i++) if (V.b[i] !== B_AIR) { any = true; break; }
  return any ? V : { empty: true, k0: V.k0, nk: SEC };
}

// Клітинки з предметом, що заважає ходити (дерево, камінь на землі)
export function solidMask(C) {
  const m = new Uint8Array(CS * CS);
  for (const o of C.obj) if (blocks(o.k)) m[o.y * CS + o.x] = 1;
  return m;
}

// Відбиток чанка (свої клітинки, блоки об'єму й предмети) — для тестів і F3: однаковий у всіх рушіях
export function digest(C) {
  let a = 0x811c9dc5;
  const add = (x) => { a = Math.imul(a ^ x, 16777619); };
  for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
    const i = ci(x, y);
    add(C.h[i]); add(C.t[i]); add(C.v[i]);
    if (C.b) for (let k = 0; k < C.nk; k++) add(C.b[bv(x, y, k, C.nk)]);
  }
  for (const o of C.obj) { add(o.x | o.y << 4); add(o.k); add(o.v); add(C.sp[o.s].id); add(o.z); add(o.st || 0); }
  return (a >>> 0).toString(16).padStart(8, '0');
}
