// universe.js — закони всесвіту за адресою (глибина d, номер n): рельєф, клімат, рослинність, палітра, світло.
// Кожен закон — плавний шум уздовж номера: сусідні всесвіти схожі, за десятки стрибків — інші.
// Глибина міняє зерно цілком (новий «поверх»), і чим глибше, тим ширший розкид (weird).
// Усе тут — детерміновані числа; кольори — [r, g, b] 0…255.
import { hash2, hash3, unit } from './rng.js';
import { noise2 } from './noise.js';
import { BIOMES, BIOME_IN_ZONE, ZONES } from './gen/biomes.js';

export const GEN = 5;        // версія генератора; зберігається у світі (змінений генератор — інші незмінені чанки)
                             // 2 — гравітація (07.10.2026): рельєф, рослини, ширяюче каміння
                             // 3 — рідини (07.10.2026): дно водойм, вид рідини, сухі русла
                             // 4 — вокселі (07.10.2026): блоки-півблоки, печери, нависання, ширяючі острови
                             // 5 — біоми й види рослин за областями (08.10.2026)
export const WORLD_H = 96;   // висота світу в блоках (блок — 1×1×LEVEL)
export const SEA = 6;        // рівень поверхні рідини в рівнях висоти; дно — нижче (0…SEA−1), суходіл — від SEA + 1

// Рідина у водоймах всесвіту. Плавати можна лише у воді прийнятної температури; густина менша за SINK — тонеш
export const L_WATER = 0, L_ACID = 1, L_METHANE = 2, L_LAVA = 3, L_DRY = 4;
export const LIQUID_NAMES = ['вода', 'кислота', 'рідкий метан', 'лава', 'сухо'];
export const SINK = 0.8;            // густина відносно води, нижче якої не тримає
export const HOT = 45, COLD = 5;    // межі температури води (°C), у якій можна плавати
export const MAX_AMP = 24;   // найбільша амплітуда рельєфу в рівнях (легка гравітація — вищі гори)
export const FLOAT_G = 0.6;  // гравітація, нижче якої частина каміння ширяє в повітрі

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const frac = (v) => v - Math.floor(v);

// HSL → RGB (кусково-лінійно, без тригонометрії)
export function hsl(h, s, l) {
  h = frac(h); s = clamp01(s); l = clamp01(l);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const ch = (t) => {
    t = frac(t);
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255);
  };
  return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)];
}

// Плавний параметр i уздовж номера n з періодом per стрибків: ≈ −0,7…0,7
function lane(ds, i, n, per) {
  const s = ds ^ Math.imul(i + 1, 0x9e3779b9);
  return noise2(s, n / per, i * 7.31 + 0.5) + 0.25 * noise2(s ^ 0x5bd1e995, n / (per * 0.4), 0.5);
}

export function lawsOf(seed, d, n) {
  const ds = hash3(seed, d, 0x5eed);            // зерно глибини: рельєф спільний для всіх номерів цієї глибини
  const weird = Math.min(1, d * 0.22);
  const L = (i, per) => lane(ds, i, n, per) * (1 + weird);
  const U = (i, per) => clamp01(0.5 + 1.1 * L(i, per));
  const cat = (u, k) => Math.min(k - 1, Math.floor(u * k));

  // Навколо стартового всесвіту (глибина 0, номер ≈ 0) закони м'якші (клімат, гравітація), крайнощі — далі
  const mild = d > 0 ? 1 : Math.min(1, 0.35 + Math.abs(n) / 40);
  // Гравітація — у g стартового всесвіту (0,35…2,2). Легка — вищі гори й рослини, ширяюче каміння,
  // гравець вилазить вище й безпечно сходить з вищих уступів; важка — пласкіший світ, приземкуваті рослини, повільніша хода
  const grav = Math.min(2.2, Math.max(0.35, 1 + 1.25 * mild * L(34, 50)));
  const gk = Math.min(1.33, Math.max(0.6, 1.45 - 0.45 * grav));     // множник висот: 0,35 g → 1,29; 1 g → 1; 2 g → 0,6
  // Рельєф: ваги трьох масштабів (материки, пагорби, дрібниці), контраст, рівень моря, амплітуда
  const seaE = 0.26 + 0.24 * U(0, 40);         // ≈ 10…45 % води; рідко — сухий світ чи океан
  const amp = Math.min(MAX_AMP, Math.round((6 + 12 * U(1, 30)) * gk));
  const wc = 0.3 + U(2, 50), wh = 0.4 + U(3, 25), wd = 0.06 + 0.22 * U(4, 15);
  const contrast = 1.0 + 0.9 * U(5, 35);
  // Клімат: зсуви температури й вологості (−1 холодно/сухо … 1 спекотно/волого)
  const temp = 0.75 * mild * L(6, 45), wet = 0.9 * L(7, 35);
  // Рослинність: густота, розмір; каміння (смуги 9–11 — колишні форми рослин, не вживати)
  const flora = 0.015 + 0.2 * U(8, 20);
  const treeH = (0.75 + 0.6 * U(12, 30)) * gk;
  const rocks = 0.004 + 0.03 * U(13, 25);

  // Палітра: відтінки трави, піску, води, скель; рідко (і щоразу на кілька сусідніх всесвітів) — «чужа» трава
  const exotic = U(14, 60) > 0.84 ? 0.42 + 0.2 * L(15, 20) : 0;
  const hG = 0.28 + 0.15 * L(16, 30) + exotic;
  const hS = 0.11 + 0.07 * L(17, 30);
  const hW = 0.57 + 0.09 * L(18, 30) + exotic * 0.5;
  const hR = 0.08 + 0.55 * U(19, 50);
  const sat = 0.32 + 0.36 * U(20, 25);
  const hSky = hW + 0.06 * L(21, 25);
  const pal = {
    lush: hsl(hG, sat, 0.42 + 0.08 * U(22, 20)),
    dry: hsl(hG - 0.07, sat * 0.65, 0.53),
    desert: hsl(hS, 0.2 + sat * 0.7, 0.66),
    sand: hsl(hS, 0.15 + sat * 0.6, 0.75),
    snow: hsl(hSky, 0.18, 0.93),
    rock: hsl(hR, 0.1 + 0.16 * U(23, 30), 0.52),
    soil: hsl(0.5 * (hR + hS), 0.22, 0.35),
    water: hsl(hW, 0.48, 0.47),
    deep: hsl(hW + 0.02, 0.55, 0.27),
    ice: hsl(hW, 0.35, 0.84),
    trunk: hsl(0.07 + 0.05 * L(24, 30), 0.35, 0.3),
    leafA: hsl(hG + 0.03 * L(25, 20), sat + 0.05, 0.34),
    leafB: hsl(hG + 0.07 + 0.12 * L(26, 20), sat, 0.42),
    crystal: hsl(hW + 0.35 * L(27, 30), 0.6, 0.62),
    cap: hsl(U(28, 30), 0.55, 0.5),
    sky: hsl(hSky, 0.3 + 0.25 * U(29, 30), 0.8),
  };
  // Рідина: на глибині 0 переважно вода (~10 % всесвітів — інша чи сухо), глибше — частіше дивна.
  // Температура води — від клімату, інколи гаряча (термальні джерела); замерзає — лід (у gen/chunk.js за місцевою температурою)
  const exoticLiq = mild > 0.6 && U(49, 60) > 0.86 - 0.3 * weird;     // біля старту — завжди звичайна вода
  const kind = exoticLiq ? 1 + cat(U(50, 40), 4) : L_WATER;
  const tC = kind === L_WATER ? Math.round(16 + 32 * temp + (mild > 0.6 && L(51, 30) > 0.5 + 0.2 * weird ? 48 : 0)) : [0, 25, -170, 1100, 0][kind];
  const density = [1, 1.3, 0.42, 2.8, 0][kind];
  const liquid = {
    kind, name: LIQUID_NAMES[kind], tC, density,
    swim: kind === L_WATER && tC >= COLD && tC <= HOT,
    // Чому туди не можна (поки немає здоров'я — просто не пускає); '' — можна
    why: kind === L_WATER ? (tC > HOT ? `вода гаряча (${tC} °C)` : tC < COLD ? `вода крижана (${tC} °C)` : '')
      : kind === L_ACID ? 'кислота роз\'їсть' : kind === L_METHANE ? 'метан: густина замала — підеш на дно' : kind === L_LAVA ? 'лава' : '',
    alpha: [0.72, 0.82, 0.55, 1, 0][kind],
  };
  pal.liquid = kind === L_WATER ? (tC > HOT ? hsl(hW - 0.05, 0.45, 0.6) : pal.water) : [pal.water, hsl(0.22 + 0.05 * L(52, 20), 0.85, 0.45), hsl(0.55, 0.25, 0.78), hsl(0.04 + 0.03 * L(53, 20), 0.95, 0.52), pal.water][kind];
  pal.liquidDeep = kind === L_WATER ? pal.deep : [pal.deep, hsl(0.25, 0.8, 0.28), hsl(0.58, 0.3, 0.6), hsl(0.01, 0.9, 0.35), pal.deep][kind];
  pal.bed = hsl(0.5 * (hR + hS), 0.18, 0.42);                    // дно й сухе русло
  // Біоми: у кожній кліматичній зоні — до 4 біомів з вагами (дивні — рідко біля старту, частіше на глибині й у
  // «чужих» всесвітах; смуги 60…, по одній на біом); розмір плям біомів і областей видів (клітини Вороного, gen/flora.js)
  const weirdK = 0.03 + 0.14 * (mild - 0.35) / 0.65 + 0.9 * weird + (exotic ? 0.4 : 0);
  const biomes = [];
  for (let z = 0; z < ZONES; z++) {
    const c = BIOME_IN_ZONE[z].map((id) => [id, (0.15 + U(60 + id, 25 + id % 3 * 10)) * (BIOMES[id].weird ? weirdK : BIOMES[id].harsh ? mild * mild : 1)]).sort((a, b) => b[1] - a[1]);
    const top = c.filter((e, i) => i < 4 && e[1] >= 0.2 * c[0][1]), sum = top.reduce((a, e) => a + e[1], 0);
    let acc = 0;
    biomes.push(top.map(([id, w]) => [id, acc += w / sum]));
  }
  // розміри — сталі для глибини: інакше далеко від центру межі зсувались би між сусідніми номерами
  const bioS = 150 + 230 * unit(hash2(ds, 0xb10)), regS = 140 + 170 * unit(hash2(ds, 0x4e9));
  // Об'ємний рельєф: печери (частота 0…1 і ширина), нависання й арки (сила 0…1), ширяючі острови (частота 0…1;
  // легка гравітація — частіше). Біля старту — помірно
  const caves = 0.15 + 0.7 * U(54, 40) * (0.5 + 0.5 * mild), caveW = 0.05 + 0.06 * U(55, 30);
  const overhang = U(56, 35) * (0.3 + 0.7 * mild);
  const islands = Math.min(1, Math.max(0, (U(57, 45) - 0.55) * 2.2 * mild + (grav < 0.75 ? (0.75 - grav) * 1.6 : 0)));
  // Світло (лише вигляд): зсув азимута в радіанах, колір, частка розсіяного
  const light = {
    az: 0.5 * L(30, 40),
    col: hsl(0.1 + 0.15 * L(31, 30), 0.3 * U(32, 30), 0.96),
    amb: 0.42 + 0.12 * U(33, 30),
  };
  // Візерунки текстур (лише вигляд, textures.js): стиль трави, квіти, хвилі піску й води, пласти скель, тріщини, плями
  const tex = {
    grass: cat(U(35, 30), 4), grassC: 0.6 + 0.8 * U(36, 25), flowers: 0.04 * U(37, 20) * U(37, 20) * 4, flowerHue: U(38, 15),
    ripple: [1 + cat(U(39, 25), 4), cat(U(40, 25), 3)], strata: 2 + cat(U(41, 30), 5), cracks: cat(U(42, 25), 6),
    pebbles: 0.01 + 0.05 * U(43, 25), sparkle: 0.01 + 0.04 * U(44, 30), leaf: cat(U(45, 30), 3), spots: 2 + cat(U(46, 20), 6),
    wave: [1 + cat(U(47, 25), 3), cat(U(48, 25), 3)],
  };
  return {
    d, n, seed: hash3(seed, d, n), ds, weird, exotic: exotic > 0, grav,
    seaE, amp, wc, wh, wd, contrast, temp, wet,
    flora, treeH, rocks, biomes, bioS, regS, pal,
    hue: { g: hG, s: hS, w: hW, r: hR, sat, gl: 0.42 + 0.08 * U(22, 20) }, light, tex, liquid, caves, caveW, overhang, islands,
    // зерна шумів (спільні для глибини: так рельєф сусідніх номерів зв'язаний)
    sA: hash2(ds, 1), sB: hash2(ds, 2), sC: hash2(ds, 3), sT: hash2(ds, 4), sW: hash2(ds, 5),
    sF: hash2(ds, 6), sM: hash2(ds, 7), sO: hash2(ds, 8), sK: hash2(ds, 9), sK2: hash2(ds, 10), sV: hash2(ds, 11), sI: hash2(ds, 12),
    sBv: hash2(ds, 13), sRg: hash2(ds, 14), sCv: hash2(ds, 15),
  };
}

// Рух у всесвіті від гравітації: на скільки рівнів можна піднятися (up) і безпечно зійти (down) за крок,
// множник швидкості ходи, як швидко ноги наздоганяють нову висоту (легка гравітація — «пливе»)
export function physOf(L) {
  const g = L.grav;
  return {
    up: g < FLOAT_G ? 2 : 1,
    down: g < 0.45 ? 4 : g < FLOAT_G ? 3 : g < 0.85 ? 2 : 1,
    speed: g > 1 ? 1 - 0.18 * (g - 1) : 1 + 0.1 * (1 - g),
    settle: Math.min(20, Math.max(5, 14 * g)),
    g,
  };
}
