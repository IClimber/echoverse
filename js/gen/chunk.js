// gen/chunk.js — чанк 16×16 клітинок × WORLD_H блоків (блок — 1×1×LEVEL): блоки, поверхня, предмети. Без DOM.
// Основа — поверхня клітинки (tile: висота, тип, предмет) — чиста функція законів і світових координат, тож межі
// сусідніх чанків збігаються самі. Поверх неї — об'ємні закони: печери, скелі (рельєф 3.1), ширяючі острови (3D-шум на
// грубій ґратці 4×4×4 блоки з трилінійною інтерполяцією). Рельєф — шум від (x, y, n): сусідні номери схожі.
import { hash2, hash3, unit } from '../rng.js';
import { noise2, noise3, fbm3 } from '../noise.js';
import { SEA, L_WATER, L_DRY, WORLD_H, KMIN, KMAX, floats, gravityAt } from '../universe.js';
import { LEVEL } from '../iso.js';
import { nsqrt } from '../num.js';
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

// Висота 0…1 у точці (x, y). coarseE — висота без дрібниць (для родин кривої 3.1), fineE — внесок дрібниць (e − coarseE;
// для клімату: сніг не за кожним горбиком). Ерозія: пагорби й дрібниці ×0,25…1,75 областями (пласкі рівнини ↔
// порізані землі; bias — закон всесвіту)
let fineE = 0, coarseE = 0;
export function elevation(L, x, y) {
  const z = L.n, E = L.land.ero;
  const c = noise3(L.sA, x / 192, y / 192, z * 0.01);         // материки: змінюються за ~100 стрибків
  const h = fbm3(L.sB, x / 48, y / 48, z * 0.025, 3);         // пагорби: за ~40, їх дрібні октави — швидше
  const f = noise3(L.sC, x / 12, y / 12, z * 0.15);           // дрібниці: помітно за кілька стрибків
  const ek = 0.25 + 1.5 * clamp01(0.5 + 0.9 * noise3(L.sEr, x / E.S, y / E.S, z * 0.005) + E.bias);
  const sum = L.wc + L.wh + L.wd;
  coarseE = clamp01(0.5 + L.contrast * (L.wc * c + L.wh * h * ek) / sum);
  const e = clamp01(0.5 + L.contrast * (L.wc * c + (L.wh * h + L.wd * f) * ek) / sum);
  fineE = e - coarseE;
  return e;
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

const absv = (v) => v < 0 ? -v : v;
const ss = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };   // плавний крок 0…1
// Маска області закону o = {share, thr} масштабу S (0 — поза, 1 — усередині; край — плавно); n — номер (області
// повільно змінюються вздовж номера)
function regionM(seed, o, S, px, py, n) {
  if (o.share <= 0.003) return 0;
  return ss((noise3(seed, px / S, py / S, n * 0.005) - o.thr) / 0.12 + 0.5);
}
const DIR6 = [[1, 0], [0.8, 0.6], [0.6, 0.8], [0, 1], [-0.6, 0.8], [-0.8, 0.6]];   // напрямки (дюни, куести, рифти)
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
// Гірські хребти (генератор v9), блоки над рельєфом: гребені шуму (1 − |шум|, загострені) у гористих землях.
// Лише від повільних полів зерна глибини (масштаб — з висотою), не від e: у сусідньому всесвіті гори ті самі (дрібна
// зміна e × сотні блоків дала б стіни), і додаються до висоти до перевірки моря — берег гори є її схилом (з моря —
// гористі острови). Річка
// прорізає V-подібну долину: ширина — від глибини, схил ≲ 3 блоки на клітинку
function mountain(L, px, py) {
  const M = L.mount;
  if (!M) return 0;
  const mask = noise2(L.sMt2, px / (M.S * 2), py / (M.S * 2)) + M.f - 0.6;
  if (mask <= 0) return 0;
  const r = 1 - absv(noise2(L.sMt, px / M.S, py / M.S)), r2 = r * r;
  let h = M.H * (mask * 3 < 1 ? mask * 3 : 1) * r2 * r2;
  const R = L.relief;
  if (R.rivers > 0.3 && h > 1) {
    const wq = noise2(L.sRv ^ 0x77, px / 90, py / 90), rv = absv(noise2(L.sRv, px / R.riverS + wq * 0.3, py / R.riverS - wq * 0.3));
    const w = 0.004 + 0.016 * R.rivers, v = clamp01((rv - w) / (h * 0.6 / R.riverS + 0.001));
    h *= v * v * (3 - 2 * v);
  }
  return h;
}

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

// Родини кривої «материк → висота» (рельєф 3.1): блоки над морем від u (частка висоти суходолу без дрібниць: 0 —
// берег, 1 — найвище), A — амплітуда (L.amp), P — висота плато (блоки), c — поріг родини, N — сходинок трапів,
// V — долини (0…1). Усі F(0) = 0 (берег на місці); нижче моря (u ≤ 0) родини не діють. FAM_D — скільки дрібниць лишається
export const FAM_D = [0.5, 0.6, 1, 0.4, 0.3, 0.5];
export function famF(id, u, A, P, c, N, V) {
  if (id === 0) return A * 0.25 * u;                                                         // пенеплен: майже рівнина
  if (id === 1) return A * 0.3 * u + P * ss((u - c) / 0.08) * (1 - 0.9 * V);                  // плато, прорізане долинами
  if (id === 2) return A * 0.5 * u + P * ss((u - c) / 0.05) + A * 0.3 * (u > c ? u - c : 0);   // уступ до плоскогір'я
  if (id === 3) {                                                                             // трапові сходи
    const t = clamp01((u - 0.08) / 0.84) * N, f = Math.floor(t);
    return A * 0.3 * u + P * (f + ss((t - f - 0.7) / 0.3)) / N;
  }
  if (id === 4) return A * 0.4 * u + P * ss((u - c) / 0.025) + A * 0.1 * (u > c ? u - c : 0); // столові гори (тепуї)
  return P * ss(u / 0.12) - (1.25 * P + 4) * ss((u - 0.3) / 0.3);                            // перевернутий: високі береги, внутрішнє море
}
// Долини розчленованого плато: мережа (дві октави ліній нуля шуму з меандром), 0…1
function dissectV(L, px, py) {
  const S = L.land.dissS, wq = 0.4 * noise2(L.sDs ^ 0x2e, px / 120, py / 120);
  const r1 = absv(noise2(L.sDs, px / S + wq, py / S)), r2 = absv(noise2(L.sDs ^ 0x1d, px / (S * 0.4), py / (S * 0.4) + wq));
  const v1 = ss(1 - r1 / 0.07), v2 = 0.6 * ss(1 - r2 / 0.05);
  return v1 > v2 ? v1 : v2;
}

// Рельєф 3.1 у блоках над морем: суміш родин за масками областей (решта — плавна A·u), дрібниці (на плато — менше),
// куести (додають; у морі глибше 4 блоків — ні), рифти (віднімають; дно нижче моря — озеро).
// fineK — частка дрібниць, що лишилась; famTop — родина з вагою > 0,5 (−1 — плавна)
let fineK = 1, famTop = -1;
function relief3(L, px, py, uc, fineB) {
  const D = L.land, A = L.amp;
  let F = A * uc, dk = 1;
  famTop = -1;
  if (uc > 0) {
    const w = [0, 0, 0, 0, 0, 0];
    let ws = 0, best = 0.5;
    for (let i = 0; i < 6; i++) {
      const m = regionM(D.fam[i].seed, D.fam[i], D.famS, px, py, L.n);
      w[i] = m; ws += m;
      if (m > best) { best = m; famTop = i; }
    }
    if (ws > 0) {
      const k = ws > 1 ? 1 / ws : 1, rise = ss(uc / 0.05), V = w[1] > 0 ? dissectV(L, px, py) : 0;
      F = A * uc * (1 - ws * k); dk = 1 - ws * k;
      for (let i = 0; i < 6; i++) if (w[i] > 0) {
        F += w[i] * k * famF(i, uc, A, D.P, D.fam[i].c, D.trapN, V);
        dk += w[i] * k * (1 + (FAM_D[i] - 1) * rise);
      }
    }
  }
  let bl = F + fineB * dk;
  const Q = D.cuesta;                                     // куести: пологий схил уздовж напрямку, крутий уступ
  if (Q.share > 0.003) {
    const m = regionM(L.sCu, Q, Q.S, px, py, L.n);
    if (m > 0) {
      const [dx, dy] = DIR6[Q.dir], ph = (px * dx + py * dy) / Q.lam + 0.6 * noise2(L.sCu ^ 0x11, px / 150, py / 150), f = ph - Math.floor(ph);
      bl += Q.C * m * (f < 1 - Q.sc ? f / (1 - Q.sc) : (1 - f) / Q.sc) * clamp01(1 + bl / 4);
    }
  }
  const R = D.rift;                                       // рифти: дно шириною W, стіни — три уступи
  if (R.share > 0.003) {
    const m = regionM(L.sRf, R, R.S, px, py, L.n);
    if (m > 0) {
      const [dx, dy] = DIR6[R.dir], a = px * dx + py * dy, b = py * dx - px * dy;
      const wq = 0.3 * noise2(L.sRf ^ 0x3, a / 300, b / 300);
      const r = absv(noise2(L.sRf ^ 0x5, a / (R.Lb * 4), b / R.Lb + wq)) * R.Lb * 0.6;   // ≈ відстань від осі, клітинок
      const half = R.W / 2, ww = R.W * 0.6;
      let dep = 0;
      if (r < half) dep = 1;
      else if (r < half + ww) { const t = (r - half) / ww * 3, f = Math.floor(t); dep = 1 - (f + ss((t - f - 0.6) / 0.4)) / 3; }
      bl -= R.D * m * dep;
    }
  }
  fineK = dk;
  return bl;
}

// Останці (купола зі стрімкими боками — інзельберги) і баштовий карст (поля веж в областях). Блоки над поверхнею, скеля
function rocks3(L, px, py) {
  const I = L.land.insel, K = L.land.karst;
  let x = 0;
  if (I.prob > 0.003) x += onGrid(L.sIb, px, py, I.R * 6, I.prob, (dx, dy, h) => {
    const Rr = I.R * (0.5 + 0.5 * unit(hash2(h, 7))), u = (dx * dx + dy * dy) / (Rr * Rr);
    return u < 1 ? I.H * (0.5 + 0.5 * unit(hash2(h, 8))) * (1 - u * u * u) : 0;
  });
  if (K.share > 0.003) {
    const m = regionM(L.sKs, K, K.S, px, py, L.n);
    if (m > 0) x += m * onGrid(L.sKs ^ 0x6b, px, py, K.G, 0.8, (dx, dy, h) => {
      const Rr = K.R * (0.5 + 0.5 * unit(hash2(h, 9))), u = (dx * dx + dy * dy) / (Rr * Rr);
      return u < 1 ? K.H * (0.4 + 0.6 * unit(hash2(h, 10))) * (1 - u * u) : 0;
    });
  }
  return x;
}

// Клітинка (x, y) → out: h (рівень; у водоймі — дна), t (тип), v (глибина 0…255), bm (біом), o (предмет),
// ov (варіант 0…65535), os (хеш вибору виду), magma (у жерлі вулкана — розпечена лава), fam (родина кривої 3.1, −1 —
// плавна), скелі: fx (висота форм, блоки), fb (смуга блоків над h), fa (частка широких форм), cl (область скель з краєм).
// lite — лише висота, тип і скелі (запас навколо чанка для скель)
export function tile(L, x, y, out = {}, lite = false) {
  const px = x + 0.5, py = y + 0.5;           // центр клітинки: не на вузлах ґратки шуму
  const T0 = L.temp + 0.6 * fbm3(L.sT, px / 800, py / 800, L.n * 0.03, 3);   // кілька октав: межі кліматів не прямі
  const W = L.wet + 0.65 * fbm3(L.sW, px / 600, py / 600, L.n * 0.03, 3);
  const span = (1 - L.seaE) / L.amp;          // висота e на один блок
  out.o = 0; out.ov = 0; out.os = 0; out.v = 0; out.bm = 0; out.cold = T0 < -0.6; out.magma = false;
  // висота: e — материки, пагорби й дрібниці; рельєф 3.1 (родини кривої, куести, рифти) — у блоках над морем (bl),
  // назад у простір e; потім форми рельєфу (carve), вершини понад амплітуду, останці й карст (xr), гори
  elevation(L, px, py);
  const A = L.amp, uc = (coarseE - L.seaE) / (1 - L.seaE), fineB = fineE / span;   // fineB — дрібниці в блоках
  const bl = relief3(L, px, py, uc, fineB), dk = fineK;
  out.fam = famTop; out.fx = 0; out.fb = 0; out.cl = false;
  const e = carve(L, px, py, L.seaE + bl * span, W, span);
  const xr = rocks3(L, px, py), mt = mountain(L, px, py), xb = peaks(L, px, py, out) + mt + xr, ex = e + xb * span;
  if (ex < L.seaE) {
    // Дно: що далі від берега (нижче рівня моря), то глибше; біля берега — мілина (рівень SEA − 1)
    // дно: біля берега мілко, далі — глибина океанів закону (до сотень блоків); під водою не порожнеча
    // (глибина закону — від повільного шуму материків: далеко від них глибоко; від берега — схилом, не обривом)
    const M = L.mount;
    let deep = 0;
    if (M) {
      const cc = clamp01(0.3 - noise3(L.sA, px / 192, py / 192, L.n * 0.01) * 2) * M.ocean, q = (L.seaE - ex) * 80;
      deep = Math.floor(cc < q ? cc : q);
    }
    out.h = Math.max(KMIN + 8, SEA - 1 - Math.floor((L.seaE - ex) * 22) - deep);
    out.v = Math.min(255, Math.floor((L.seaE - ex) * 1200));
    const k = L.liquid.kind;
    out.t = k === L_DRY ? T_BED : k === L_WATER && out.cold ? T_ICE : T_WATER;
    out.bed = out.h; out.T = T0;
    if (out.t === T_ICE) out.h = SEA;
    return out;
  }
  // висота: основа (плато бувають вищі за амплітуду), вулкани, шпилі, останці, карст і гори — понад неї
  let h = e >= L.seaE ? SEA + 1 + Math.floor((e - L.seaE) / span) + Math.floor(xb) : SEA + 1 + Math.floor((ex - L.seaE) / span);
  if (h > KMAX - 64) h = KMAX - 64;
  // вище — холодніше (п. 4: земний градієнт 52 °C/км × g, у рівнях — L.clim.lapse / 64 одиниць температури; без
  // повітря — 0); висота для клімату — неперервна (не округлена до блоків) і без дрібниць рельєфу, інакше біля снігової
  // межі кожен горбик у 1–2 блоки — снігова пляма. Скеля вершин — за висотою без рельєфу 3.1 (плато — не скеля)
  const hT = (ex - L.seaE) / span - fineB * dk, hc = hT - (bl - fineB * dk - A * uc + xr), T = out.T = T0 - L.clim.lapse / 64 * hT;
  let t;
  if (T < -0.45) t = T_SNOW;
  else if (xb - mt > 2 || out.magma) t = T_ROCK;              // вулкани, шпилі, останці, карст — скеля (гори — за висотою)
  else if (hc + 1 >= Math.max(6, L.amp * 0.72) && T < -0.25) t = T_ROCK;   // вершини — скеля лише в холоді (альпійський пояс: до ~6 °C над сніговою межею)
  else if (h === SEA + 1 && ex - L.seaE < 0.025) t = T_SAND;
  else if (W < -0.35) t = T > 0.15 ? T_DESERT : T_DRY;
  else if (W < -0.05) t = T_DRY;
  else t = T_LUSH;
  // дюни: асиметрична хвиля (пологий навітряний схил, крутий підвітряний) уздовж напрямку вітру
  if (t === T_DESERT && L.relief.dunes > 0.2) {
    const [dx, dy] = DIR6[L.relief.duneDir], ph = (px * dx + py * dy) / L.relief.duneL + 0.8 * noise2(L.sDn, px / 50, py / 50), f = ph - Math.floor(ph);
    h += Math.floor((f < 0.75 ? f / 0.75 : (1 - f) / 0.25) * (1 + 3 * L.relief.dunes));
  }
  out.h = h; out.t = t; out.bed = h;
  // Скелі (фактор щільності, рельєф 3.1): в області закону над поверхнею стоять вежі й стовпи висотою до fx блоків
  // (висота форм × маска області × місцева висота 0,5…1); cl — область з краєм (печери тут не підходять до поверхні:
  // опори скель не підрізані); fa — частка широких форм (решта — вузькі); fb — смуга блоків над h. У жерлі — ні
  const C = L.land.cliff;
  if (C.share > 0.003 && !out.magma) {
    const v = noise3(L.sCl, px / C.S, py / C.S, L.n * 0.005), m = ss((v - C.thr) / 0.12 + 0.5);
    out.cl = v > C.thr - 0.1;
    if (m > 0) {
      out.fx = C.F * m * (0.5 + 0.5 * clamp01(0.5 + noise2(L.sCl ^ 0x4f1, px / 60, py / 60)));
      out.fa = clamp01(0.5 + 1.2 * noise2(L.sCl ^ 0x93b, px / 400, py / 400));
      out.fb = out.fx > 0.5 ? Math.floor(out.fx) + 1 : 0;
    }
  }
  if (lite) return out;
  // Біом: кліматична зона + варіант (окреме поле шуму з дрібнішою домішкою — межі не гладкі)
  const zone = t === T_SNOW ? Z_SNOW : t === T_ROCK ? Z_PEAK : t === T_SAND ? Z_BEACH : t === T_DESERT ? Z_DESERT : t === T_DRY ? Z_DRY
    : W > 0.45 && h - SEA <= 3 ? Z_WET : T < -0.15 ? Z_COLD : T > 0.35 ? Z_HOT : Z_TEMP;
  const vb = noise2(L.sBv, px / L.bioS, py / L.bioS) + 0.2 * noise2(L.sBv ^ 0x3c6e, px / 70, py / 70);
  const bm = out.bm = pickBiome(L, zone, clamp01(0.5 + 0.8 * vb)), Bm = BIOMES[bm];
  // Предмети: кандидат — хеш клітинки від зерна глибини (не номера), поріг — густота цього всесвіту й біому.
  // Тож у сусідніх всесвітах ліс той самий, лише рідший чи густіший. Дерево — лише там, де r найменший серед сусідів
  const r = unit(hash3(L.sO, x, y));
  const patch = 0.3 + 1.4 * clamp01(0.5 + noise3(L.sF, px / 24, py / 24, L.n * 0.06));
  if (Bm.trees && unit(hash3(L.sO ^ 0x2545f491, x, y)) < L.flora * 6 * Bm.trees * patch && lonely(L, x, y, r, Bm.dense, L.treeH < 1.5 ? 1 : L.treeH < 3 ? 2 : L.treeH < 6 ? 3 : 4)) out.o = O_TREE;
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
  B_BED = 9, B_MUD = 10, B_SOIL = 11, B_STONE = 12, B_SANDSTONE = 13, B_MAGMA = 14, B_FLOAT = 15,
  // по чому лазять (п. 3 roadmap): тонка панель на стіні (на першому твердому сусіді: −x, +x, −y, +y), крізь клітинку
  // проходиш; меш — у твердому (зіткнення — з ним). Генератор їх поки не ставить: ліани — п. 9, драбини — з будуванням
  B_LADDER = 16, B_VINE = 17;
export const BLOCK_NAMES = ['повітря', 'рідина', 'лід', 'пісок', 'трава', 'степ', 'пустеля', 'сніг', 'скеля', 'дно', 'глина', 'ґрунт', 'камінь', 'пісковик', 'розпечена лава', 'левітуюча порода', 'драбина', 'ліана'];
export const solidB = (b) => b >= B_ICE && b < B_LADDER;   // тверде (лід теж); рідина, повітря, драбина й ліана — ні
export const climbB = (b) => b === B_LADDER || b === B_VINE;
// Драбина чи ліана в (x, y, k): нормаль від стіни [nx, ny] (до першого твердого сусіда −x, +x, −y, +y) або null
export function climbSide(block, x, y, k) {
  for (const [dx, dy] of CLIMB_N) { const b = block(x + dx, y + dy, k); if (solidB(b)) return [-dx, -dy]; }
  return null;
}
const CLIMB_N = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const TOP_BLOCK = [B_BED, B_ICE, B_SAND, B_GRASS, B_DRY, B_DESERT, B_SNOW, B_ROCK, B_MUD];   // за типом поверхні T_*
const SUB_BLOCK = [B_SOIL, B_SOIL, B_SANDSTONE, B_SOIL, B_SOIL, B_SANDSTONE, B_SOIL, B_STONE, B_SOIL];
// Об'єм блоків (секція чи стовпець): x, y ∈ −1…CS (рамка), k ∈ −1…nk (рамка знизу й згори); індекс — стовпець
// за стовпцем. k — локальний (від k0 об'єму)
export const bv = (x, y, k, nk) => ((y + 1) * CW + x + 1) * (nk + 2) + k + 1;
export const bi = (x, y, k) => bv(x, y, k, H);           // стовпець 0…H−1 (тести, відбитки)
export const SEC = 16;                                    // секція — 16×16×16 блоків
const ISL0 = 44, ISL1 = 84, ISLC = 63;                    // смуга висот ширяючих островів (блоки)

// Груба ґратка 3D-шуму (крок G блоків, вузли — на спільній світовій сітці) над прямокутником клітинок і діапазоном
// висот kA…kB: шість полів — два для печер-тунелів (тунель — там, де обидва близькі до нуля), острови, великі
// порожнини («сир», масштаб — розмір залів hallS), ширина тунелів (змінюється по карті: є лази й широкі ходи), маска
// печерних областей (печери — лише там, де вона вища за поріг caveThr). Шуми печер — у світових одиницях однакові по
// горизонталі й вертикалі (блок — пів одиниці заввишки, тож k ділимо на вдвічі більше). Значення між вузлами —
// трилінійна інтерполяція (точна арифметика; від положення ґратки не залежить)
const G = 4, NF = 6;
function grid(x0, y0, x1, y1, kA, kB, nf, fill) {
  const gx0 = Math.floor(x0 / G), gy0 = Math.floor(y0 / G), nx = Math.floor(x1 / G) - gx0 + 2, ny = Math.floor(y1 / G) - gy0 + 2;
  const q0 = Math.floor(kA / G), nk = Math.floor(kB / G) - q0 + 2, F = new Float64Array(nx * ny * nk * nf);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) for (let q = 0; q < nk; q++) fill(F, ((j * nx + i) * nk + q) * nf, (gx0 + i) * G, (gy0 + j) * G, (q0 + q) * G);
  return { F, gx0, gy0, q0, nx, nk, nf };
}
function lattice(L, x0, y0, x1, y1, kA = 0, kB = H) {
  const isl = L.islands > 0.02, hs = L.hallS, mask = L.caveShare > 0 && L.caveShare < 0.999;
  return grid(x0, y0, x1, y1, kA, kB, NF, (F, o, x, y, k) => {
    F[o] = noise3(L.sK, x / 28, y / 28, k / 48);
    F[o + 1] = noise3(L.sK2, x / 28, y / 28, k / 48);
    F[o + 2] = isl && k >= ISL0 - G && k <= ISL1 + G ? 0.85 * noise3(L.sI, x / 22, y / 22, k / 8) + 0.35 * noise3(L.sI ^ 0x5bd1, x / 9, y / 9, k / 5) : -9;
    F[o + 3] = noise3(L.sCh, x / hs, y / hs, k / (hs * 1.53)) + 0.45 * noise3(L.sCh ^ 0x77, x / (hs * 0.36), y / (hs * 0.36), k / (hs * 0.55));
    F[o + 4] = noise3(L.sCw, x / 96, y / 96, k / 160);
    F[o + 5] = mask ? noise3(L.sCm, x / 200, y / 200, k / 300) : L.caveShare > 0 ? 9 : -9;
  });
}
function sample(Lt, f, x, y, k) {
  const gx = x / G - Lt.gx0, gy = y / G - Lt.gy0, gk = k / G - Lt.q0;
  const i = Math.floor(gx), j = Math.floor(gy), q = Math.floor(gk);
  const u = gx - i, v = gy - j, w = gk - q, nx = Lt.nx, nk = Lt.nk, F = Lt.F, nf = Lt.nf;
  const at = (a, b, c) => F[(((j + b) * nx + i + a) * nk + q + c) * nf + f];
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(at(0, 0, 0), at(1, 0, 0), u), l(at(0, 1, 0), at(1, 1, 0), u), v),
    l(l(at(0, 0, 1), at(1, 0, 1), u), l(at(0, 1, 1), at(1, 1, 1), u), v), w);
}

// Скелі (рельєф 3.1). Блок j = k − h клітинки (0 ≤ j < fb) у скелі, якщо j + 0,5 < fx · T(N): N — суміш широкого й
// вузького 3D-шуму (fa), витягнутого вгору (масштаб по k — el разів більший); T — різкий поріг покриття: вежі зі
// стрімкими боками й пласкими верхівками; шум зсувається з номером (n·0,02 по k) — у далеких всесвітах інші вежі
const cliffT = (C, N) => { const t = (N - C.cov) * C.sh; return t < 0 ? 0 : t > 1 ? 1 : t; };
function cliffN(L, x, y, k) {
  const C = L.land.cliff, kz = L.n * 0.02;
  return [noise3(L.sCl ^ 0x11, x / C.S1, y / C.S1, k / (C.S1 * C.el) + kz), noise3(L.sCl ^ 0x22, x / C.S2, y / C.S2, k / (C.S2 * C.el) + kz)];
}
const cliffLattice = (L, x0, y0, x1, y1, kA, kB) => grid(x0, y0, x1, y1, kA, kB, 2, (F, o, x, y, k) => { const [a, b] = cliffN(L, x, y, k); F[o] = a; F[o + 1] = b; });

// Скелі прямокутника клітинок [x0, x0+nx) × [y0, y0+ny) (inner(i, j) — tile клітинки): клітинкам з fb > 0 — c.fk
// (Uint8Array(fb): 1 — блок h + j твердий); клітинкам з cl — c.cz (печери не вище: найнижча поверхня в околі CR, − 1).
// Тримається (рішення 08.10.2026: «відірваних шматків не допускати»): стовпець від поверхні суцільний (стоїть) або за
// CR проходів поруч навхрест на тій самій висоті блок, що тримається, чи ґрунт сусіда (нависання до CR клітинок); що
// стоїть на такому блоці чи висить під ним — теж. Решта — повітря. Запас CR клітинок навколо — легкі клітинки
// (tile lite): на межах чанків результат той самий
const CR = 3;
function cliffBands(L, x0, y0, nx, ny, inner) {
  let any = false;
  for (let j = 0; j < ny && !any; j++) for (let i = 0; i < nx; i++) if (inner(i, j).cl) { any = true; break; }
  if (!any) return;
  const W = nx + 2 * CR, Hn = ny + 2 * CR, Gc = new Array(W * Hn);
  let kLo = Infinity, kHi = -Infinity;
  for (let j = 0; j < Hn; j++) for (let i = 0; i < W; i++) {
    const ii = i - CR, jj = j - CR, c = ii >= 0 && jj >= 0 && ii < nx && jj < ny ? inner(ii, jj) : tile(L, x0 + ii, y0 + jj, {}, true);
    Gc[j * W + i] = c;
    if (c.fb) { if (c.h < kLo) kLo = c.h; if (c.h + c.fb > kHi) kHi = c.h + c.fb; }
  }
  for (let j = CR; j < CR + ny; j++) for (let i = CR; i < CR + nx; i++) {
    const c = Gc[j * W + i];
    if (!c.cl) continue;
    let m = Infinity;
    for (let b = -CR; b <= CR; b++) for (let a = -CR; a <= CR; a++) { const h = Gc[(j + b) * W + i + a].h; if (h < m) m = h; }
    c.cz = m - 1;
  }
  if (kLo === Infinity) return;
  const C = L.land.cliff, Lt = cliffLattice(L, x0 - CR, y0 - CR, x0 + nx - 1 + CR, y0 + ny - 1 + CR, kLo, kHi), S = new Array(W * Hn);
  // стан смуги: 0 — повітря, 1 — твердо, але без опори, 2 — тримається
  for (let j = 0; j < Hn; j++) for (let i = 0; i < W; i++) {
    const g = j * W + i, c = Gc[g];
    if (!c.fb) continue;
    const s = new Uint8Array(c.fb), px = x0 + i - CR + 0.5, py = y0 + j - CR + 0.5;
    for (let q = 0; q < c.fb; q++) {
      const k = c.h + q, N = c.fa * sample(Lt, 0, px, py, k) + (1 - c.fa) * sample(Lt, 1, px, py, k);
      s[q] = q + 0.5 < c.fx * cliffT(C, N) ? 1 : 0;
    }
    for (let q = 0; q < c.fb && s[q]; q++) s[q] = 2;
    S[g] = s;
  }
  const held = (g, k) => { const c = Gc[g]; if (k < c.h) return true; const s = S[g], q = k - c.h; return !!s && q < s.length && s[q] === 2; };
  for (let p = 1; p <= CR; p++) {
    const add = [];
    for (let j = p; j < Hn - p; j++) for (let i = p; i < W - p; i++) {
      const g = j * W + i, s = S[g];
      if (!s) continue;
      const h = Gc[g].h;
      for (let q = 0; q < s.length; q++) if (s[q] === 1 && (held(g - 1, h + q) || held(g + 1, h + q) || held(g - W, h + q) || held(g + W, h + q))) add.push(g, q);
    }
    for (let a = 0; a < add.length; a += 2) {
      const s = S[add[a]], q = add[a + 1];
      s[q] = 2;
      for (let u = q + 1; u < s.length && s[u] === 1; u++) s[u] = 2;     // що стоїть на ньому
      for (let u = q - 1; u >= 0 && s[u] === 1; u--) s[u] = 2;           // що висить під ним
    }
  }
  for (let j = CR; j < CR + ny; j++) for (let i = CR; i < CR + nx; i++) {
    const g = j * W + i, c = Gc[g];
    if (c.fb) c.fk = S[g].map((v) => v === 2 ? 1 : 0);
  }
}

// Висота скелі в точці для далечі (лише вигляд): скільки блоків над h за шумом на рівні поверхні
export function cliffTop(L, x, y, c) {
  if (!c.fb) return 0;
  const [a, b] = cliffN(L, x + 0.5, y + 0.5, c.h), v = c.fx * cliffT(L.land.cliff, c.fa * a + (1 - c.fa) * b);
  return v > 0.5 ? Math.floor(v - 0.5) + 1 : 0;
}

// Сира щільність суходолу на висоті k: 0 — повітря, 1 — ґрунт, 2 — острів. Два нижні блоки світу — корінна порода
function raw(L, Lt, c, px, py, k) {
  if (k < KMIN + 2) return 1;
  const j = k - c.h;
  let s = j < 0 || (c.fk !== undefined && j < c.fk.length && c.fk[j] === 1);   // ґрунт чи скеля, що тримається
  // печери — лише в печерних областях: cm — 0 поза областю, 1 усередині (край — плавно: ходи звужуються, зали мілішають);
  // лише під поверхнею, в області скель — не вище cz (опори скель не підрізані)
  let cm = 0;
  if (s && j < 0 && (!c.cl || k < c.cz) && L.caveShare > 0) {
    const m = (sample(Lt, 5, px, py, k) - L.caveThr) / 0.06;
    cm = m <= 0 ? 0 : m >= 1 ? 1 : m;
  }
  // печери-тунелі: обидва поля близькі до нуля; ширина — від поля ширини (лази й широкі ходи); углиб — аж до дна світу
  if (cm > 0) {
    const w = 1 + 1.8 * sample(Lt, 4, px, py, k), cr = L.caveW * (0.5 + L.caves) * (w < 0.35 ? 0.35 : w) * cm;
    const a = sample(Lt, 0, px, py, k), b = sample(Lt, 1, px, py, k);
    if (a * a + b * b < cr * cr) s = false;
  }
  // великі порожнини («сир»): поріг росте до поверхні — схили не дірявить, ближче 12 блоків — ніколи
  const dep = c.h - k;
  if (s && cm > 0 && dep > 12 && L.cheese > 0) {
    const thr = 0.78 - 0.36 * L.cheese + (dep < 60 ? (60 - dep) * 0.008 : 0) + (1 - cm) * 2;
    if (sample(Lt, 3, px, py, k) > thr) s = false;
  }
  if (s) return 1;
  // ширяючі острови: краплі щільності в смузі висот
  if (L.islands > 0.02 && k >= ISL0 && k <= ISL1) {
    const dz = (k - ISLC) / 15;
    if (sample(Lt, 2, px, py, k) - dz * dz > 0.66 - 0.3 * L.islands) return 2;
  }
  return 0;
}
const isBasin = (c) => c.t === T_WATER || c.t === T_ICE || c.t === T_BED;

// «Небо» стовпця суходолу: найвищий ґрунт біля поверхні (острови — ні; шукаємо до SKY_D блоків нижче поверхні).
// Нижче моря й під відкритим небом — западина під рідиною
const SKY_D = 24;
function skyOf(L, Lt, c, px, py) {
  for (let k = c.h + (c.fb || 0); k >= c.h - SKY_D; k--) if (raw(L, Lt, c, px, py, k) === 1) return k;
  return c.h - SKY_D - 1;
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

// Відкритий небу верхній непорожній блок клітинки нижче за below (предмети); не знайшли за SKY_D блоків — null
function surfaceAt(L, Lt, c, px, py, sky, below) {
  const one = new Uint8Array(1);
  for (let k = below - 1; k >= c.h - SKY_D; k--) { fillCell(L, Lt, c, px, py, sky, k, 1, one, 0); if (one[0] !== B_AIR) return k; }
  return null;
}

// Стовпець окремо (місце появи, перевірки): {c (поверхня), at(k) — блок на висоті k, B (блоки 0…H−1)}
export function genColumn(L, x, y) {
  const c = tile(L, x, y), px = x + 0.5, py = y + 0.5;
  cliffBands(L, x, y, 1, 1, () => c);
  let kA = Math.min(-8, c.h - SKY_D - 8), kB = Math.max(H, c.h + (c.fb || 0) + 16), Lt = lattice(L, x, y, x, y, kA, kB);
  const sky = isBasin(c) ? -1 : skyOf(L, Lt, c, px, py), B = new Uint8Array(H), one = new Uint8Array(1);
  fillCell(L, Lt, c, px, py, sky, 0, H, B, 0);
  const at = (k) => {
    if (k < KMIN) return B_STONE;
    if (k > KMAX) return B_AIR;
    if (k - 1 < kA || k + 4 > kB) { kA = Math.min(kA, k - 64); kB = Math.max(kB, k + 64); Lt = lattice(L, x, y, x, y, kA, kB); }
    fillCell(L, Lt, c, px, py, sky, k, 1, one, 0);
    return one[0];
  };
  return { c, B, at };
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
  cliffBands(L, x0 - 1, y0 - 1, CW, CW, (i, j) => cells[ci(i - 1, j - 1)]);
  let top = hmax;                                         // найвищий блок скель (острови в їхній смузі — з ґратки)
  for (const c of cells) if (c.h + c.fb > top) top = c.h + c.fb;
  const Lt = lattice(L, x0 - 1, y0 - 1, x0 + CS, y0 + CS, hmin - SKY_D - 8, top + 16);
  const obj = [], sp = [], spi = new Map();
  const spIndex = (g) => { let i = spi.get(g.id); if (i === undefined) { i = sp.length; sp.push(g); spi.set(g.id, i); } return i; };
  const one = new Uint8Array(3);
  for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) {
    const i = ci(x, y), c = cells[i], px = x0 + x + 0.5, py = y0 + y + 0.5;
    sky[i] = isBasin(c) ? -1 : skyOf(L, Lt, c, px, py);
    if (!c.o || x < 0 || y < 0 || x >= CS || y >= CS) continue;
    const k = surfaceAt(L, Lt, c, px, py, sky[i], c.h + (c.fb || 0) + 1);   // предмет стоїть на верхньому твердому блоці біля поверхні
    if (k === null) continue;
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

// Верх укриття кожної клітинки стовпця з рамкою (блоки): водойма — рівень рідини (сухо — дно), суходіл — над найвищим
// ґрунтом біля поверхні (острови — ні); у печеристому суходолі нижче моря при рідині — рівень моря. Для опадів (під дахом
// не падають) і AO мешів (відкритість неба над вершиною). Кеш у стовпці
export function shelterTop(col, L) {
  if (col.top) return col.top;
  const top = new Int16Array(CW * CW), pit = L.liquid.kind !== L_DRY;
  for (let i = 0; i < CW * CW; i++) {
    const c = col.cells[i], basin = c.t === T_WATER || c.t === T_ICE || c.t === T_BED, sky = col.sky[i];
    top[i] = basin ? Math.max(c.bed, c.t === T_BED ? 0 : SEA) : sky < SEA - 1 && pit ? SEA : sky + 1;
  }
  return (col.top = top);
}

// Чанк (cx, cy) стовпцем 0…H−1 (тести, відбитки, стенди): поверхня, блоки (індекс bi), предмети
export function genChunk(L, cx, cy) {
  const col = genCol(L, cx, cy), V = genBlocks(L, col, 0, H);
  return { d: L.d, n: L.n, cx, cy, h: col.h, t: col.t, v: col.v, bm: col.bm, top: shelterTop(col, L), b: V.b, k0: 0, nk: H, obj: col.obj, sp: col.sp };
}

// Секція (cx, cy, cz) стовпця col: блоки SEC заввишки; порожня (усе повітря) — {empty: true}
// Секція (cx, cy, cz) стовпця col: блоки SEC заввишки; усе повітря — {empty: true}, уся тверда (з рамкою: граней
// немає) — {empty: true, solid: true}
export function genSection(L, col, cz) {
  const V = genBlocks(L, col, cz * SEC, SEC);
  let air = 0, solid = 0;
  for (let i = 0; i < V.b.length; i++) { const b = V.b[i]; if (b === B_AIR) air++; else if (solidB(b)) solid++; }
  if (air === V.b.length) return { empty: true, k0: V.k0, nk: SEC };
  if (solid === V.b.length) return { empty: true, solid: true, k0: V.k0, nk: SEC };
  return V;
}

// Клітинки рамки грубої вибірки поза стовпцем (x чи y = −s): tile, скелі — смугою (рядок y = −s, x від −s до 16, і
// стовпчик x = −s, y від 0 до 16; скелі клітинки від прямокутника не залежать — як на межах чанків), «небо». Кеш — col.ext
function extCells(L, col, s) {
  const C = col.ext || (col.ext = new Map());
  let E = C.get(s);
  if (E) return E;
  const x0 = col.cx * CS, y0 = col.cy * CS, row = [], cl = [], cells = new Map(), sky = new Map(), key = (x, y) => (x + 8) * 64 + y + 8;
  for (let x = -s; x <= CS; x++) row.push(tile(L, x0 + x, y0 - s));
  for (let y = 0; y <= CS; y++) cl.push(tile(L, x0 - s, y0 + y));
  cliffBands(L, x0 - s, y0 - s, CS + s + 1, 1, (i) => row[i]);
  cliffBands(L, x0 - s, y0, 1, CS + 1, (i, j) => cl[j]);
  const put = (x, y, c) => {
    const kA = c.h - SKY_D - 1, kB = c.h + (c.fb || 0) + 1, Q = col.Lt;
    const Lt = kA - 1 >= Q.q0 * G && kB + 4 <= (Q.q0 + Q.nk - 1) * G ? Q : lattice(L, x0 + x, y0 + y, x0 + x, y0 + y, kA - 8, kB + 16);
    cells.set(key(x, y), c);
    sky.set(key(x, y), isBasin(c) ? -1 : skyOf(L, Lt, c, x0 + x + 0.5, y0 + y + 0.5));
  };
  for (let x = -s; x <= CS; x += s) put(x, -s, row[x + s]);
  for (let y = 0; y <= CS; y += s) put(-s, y, cl[y]);
  C.set(s, (E = { cells, sky, key }));
  return E;
}

// Груба вибірка секції cz стовпця col для далечі (рівні деталізації; лише вигляд): блоки в точках ґратки з кроком s
// (2 чи 4) — світові x, y, k кратні s, тож сусідні секції мають ті самі точки (поверхні сходяться). Рамка — точка з
// кожного боку: локальні x, y ∈ −s, 0, s, …, 16; k ∈ k0 − s … k0 + 16. Блок у точці — той самий, що в повній секції
// (fillCell з тими самими клітинкою, «небом» і ґраткою шуму); клітинки рамки поза стовпцем — extCells. Рідина: у власних
// точках — найвищий блок рідини з повітрям над ним у межах секції (−1 — немає).
// → {b — Uint8Array(W³), W = n + 2, індекс ((J + 1)·W + I + 1)·W + Q + 1; h, bm, v — клітинки точок, lt — Int16Array,
//    індекс (J + 1)·W + I + 1; n = 16 / s; s; k0; empty — ні граней, ні рідини}
export function genCoarse(L, col, cz, s) {
  const n = SEC / s, W = n + 2, k0 = cz * SEC, kA = k0 - s, NR = SEC + s + 1, x0 = col.cx * CS, y0 = col.cy * CS, E = extCells(L, col, s);
  const Q0 = col.Lt, Lt = kA - 1 >= Q0.q0 * G && kA + NR + 4 <= (Q0.q0 + Q0.nk - 1) * G ? Q0
    : lattice(L, x0 - s, y0 - s, x0 + CS, y0 + CS, kA - 1, kA + NR + 4);
  const b = new Uint8Array(W * W * W), h = new Int16Array(W * W), bm = new Uint8Array(W * W), v = new Uint8Array(W * W);
  const lt = new Int16Array(W * W).fill(-1), run = new Uint8Array(NR);
  let air = 0, solid = 0, liq = 0;
  for (let J = -1; J <= n; J++) for (let I = -1; I <= n; I++) {
    const x = I * s, y = J * s, i = (J + 1) * W + I + 1, own = I >= 0 && J >= 0;
    const c = own ? col.cells[ci(x, y)] : E.cells.get(E.key(x, y)), sky = own ? col.sky[ci(x, y)] : E.sky.get(E.key(x, y));
    h[i] = c.h; bm[i] = c.bm; v[i] = c.v;
    fillCell(L, Lt, c, x0 + x + 0.5, y0 + y + 0.5, sky, kA, NR, run, 0);     // run[j] — блок kA + j
    for (let q = 0; q < W; q++) { const t = run[q * s]; b[i * W + q] = t; if (t === B_AIR) air++; else if (solidB(t)) solid++; }
    if (own && I < n && J < n) for (let k = SEC - 1; k >= 0; k--) if (run[k + s] === B_LIQ && run[k + s + 1] === B_AIR) { lt[i] = k0 + k; liq++; break; }
  }
  return { b, h, bm, v, lt, n, s, k0, empty: !liq && (air === W * W * W || solid === W * W * W) };
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
