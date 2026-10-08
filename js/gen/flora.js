// gen/flora.js — види рослин і каміння для місцевості. Карта поділена на області (клітини Вороного зі зсунутими
// межами, ~140–310 клітинок; сталі для глибини, тож у сусідніх всесвітах ті самі). Кожна область у кожному біомі
// має свій набір видів: великі (дерева, кактуси, кристали — заважають ходити) і малі (трава, квіти, кущики — ні),
// плюс стиль каміння. Вид — геном: форма й гени 0…1. Ген = родина біому (плавно вздовж номера всесвіту)
// + мутація області: плавна по карті (сусідні області схожі) і власна (кожна область своя). Тож за кожним пагорбом —
// нові види, у сусідніх всесвітах — ті самі, трохи змінені, у всесвіті — тисячі. Геометрію з генома будує gen/plants.js.
// Лише точна арифметика (генерація).
import { hash2, hash3, hash4, unit } from '../rng.js';
import { noise2, noise3 } from '../noise.js';
import { hsl } from '../universe.js';
import { BIOMES } from './biomes.js';

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

// Форми: big — великі (заважають ходити), h — висота в одиницях (до множника всесвіту treeH), name — для F3
const F = (big, lo, hi, name) => ({ big, h: [lo, hi], name });
export const FORMS = {
  broadleaf: F(1, 2.2, 4.5, 'листяне дерево'), birch: F(1, 3, 5.5, 'тонкостовбурне'), giant: F(1, 6, 9, 'велетень'),
  conifer: F(1, 2.5, 6, 'хвойне'), palm: F(1, 3, 5.5, 'пальма'), umbrella: F(1, 2, 3.5, 'дерево-парасоля'),
  willow: F(1, 2.5, 4.2, 'плакуче'), dead: F(1, 1.8, 4, 'сухостій'), bigshroom: F(1, 1.2, 3.5, 'гриб-велетень'),
  reed: F(1, 2, 4.5, 'бамбук'), coral: F(1, 1.2, 3, 'корал'), tentacle: F(1, 1.5, 3.5, 'щупальця'),
  cactus: F(1, 1, 2.8, 'кактус'), crystal: F(1, 1.6, 3.6, 'кристал'),
  grass: F(0, 0.2, 0.55, 'трава'), flower: F(0, 0.2, 0.6, 'квітка'), bush: F(0, 0.35, 0.9, 'кущ'),
  fern: F(0, 0.3, 0.8, 'папороть'), shroom: F(0, 0.1, 0.35, 'гриби'), lichen: F(0, 0.04, 0.12, 'лишайник'),
  shrub: F(0, 0.25, 0.6, 'чагарник'), succulent: F(0, 0.12, 0.35, 'сукулент'), reedlet: F(0, 0.5, 1.2, 'очерет'),
  coralbit: F(0, 0.2, 0.6, 'коралик'), smallcrystal: F(0, 0.15, 0.5, 'кристалики'),
};
const BIG = Object.keys(FORMS).filter((f) => FORMS[f].big), SMALL = Object.keys(FORMS).filter((f) => !FORMS[f].big);
export const STONES = ['boulder', 'slabs', 'spire', 'cairn', 'geode', 'log'];
export const GENES = 24;           // 0–8 — кольори, 9 — висота, 10 — поширеність, 15 — форма, решта — будова

// Колір поверхні kind ('lush' — трава, 'dry' — степ, 'desert' — пустеля) у біомі bm: палітра всесвіту з відтінком біому
export function groundTint(L, kind, bm) {
  const t = BIOMES[bm].tint, H = L.hue;
  return kind === 'lush' ? hsl(H.g + t[0], H.sat * t[1], H.gl * t[2]) : kind === 'dry' ? hsl(H.g - 0.07 + t[0], H.sat * 0.65 * t[1], 0.53 * t[2])
    : hsl(H.s + t[0], (0.2 + H.sat * 0.7) * t[1], 0.66 * t[2]);
}

// ================= Області =================
// Область клітинки (x, y): {id, cx, cy} — центр клітини Вороного. Межі зсунуті шумом (не прямі)
export function regionAt(L, x, y) {
  const S = L.regS, px = x + 0.5, py = y + 0.5;
  const wx = px + 30 * noise2(L.sRg, px / 70, py / 70), wy = py + 30 * noise2(L.sRg ^ 0x51ed, px / 70, py / 70);
  const gx = Math.floor(wx / S), gy = Math.floor(wy / S);
  let best = Infinity, id = 0, cx = 0, cy = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const h = hash3(L.ds ^ 0x7e61a2b3, gx + i, gy + j);
    const qx = (gx + i + 0.12 + 0.76 * unit(h)) * S, qy = (gy + j + 0.12 + 0.76 * unit(hash2(h, 1))) * S;
    const d = (qx - wx) * (qx - wx) + (qy - wy) * (qy - wy);
    if (d < best) { best = d; id = h; cx = qx; cy = qy; }
  }
  return { id, cx, cy };
}

// ================= Геноми =================
// Ген k виду в слоті slot біому bm області (id, cx, cy): родина + мутації. mut — сила мутацій (глибше — більша)
function gene(L, bm, slot, id, cx, cy, k, mut) {
  const s = hash4(L.ds, bm * 64 + slot, k, 0x6e7e);
  const fam = noise2(s, L.n / 45, 0.5) + 0.3 * noise2(s ^ 0x1b56, L.n / 12, 0.5);
  const near = noise3(s ^ 0x2c1b3c6d, cx / 800, cy / 800, L.n * 0.02);
  const own = unit(hash3(id, slot, k)) - 0.5;
  return clamp01(0.5 + 0.75 * fam + mut * (0.8 * near + 0.75 * own));
}
const pickW = (pairs, u) => {
  let sum = 0;
  for (const [, w] of pairs) sum += w;
  let acc = 0;
  for (const [f, w] of pairs) { acc += w / sum; if (u < acc) return f; }
  return pairs[pairs.length - 1][0];
};

function genome(L, bm, slot, big, reg, mut) {
  const Bm = BIOMES[bm], id = hash4(reg.id, bm, slot, 0x5bec);
  const p = new Array(GENES);
  for (let k = 0; k < GENES; k++) p[k] = gene(L, bm, slot, reg.id, reg.cx, reg.cy, k, mut);
  // форма: з набору біому за геном; зрідка — будь-яка свого ярусу (несподіванка)
  const pool = big ? Bm.big : Bm.small, odd = unit(hash3(id, 7, 99)) < 0.03 + 0.12 * L.weird;
  const form = odd ? (big ? BIG : SMALL)[hash2(id, 3) % (big ? BIG.length : SMALL.length)] : pickW(pool, p[15]);
  const F = FORMS[form], H = L.hue, t = Bm.tint, wide = 1 + L.weird;
  const h = (F.h[0] + (F.h[1] - F.h[0]) * p[9]) * (F.big ? L.treeH : 0.6 + 0.4 * L.treeH);
  // кольори: листя — від трави всесвіту й біому; кора; акцент (квіти, плоди, кінчики) — будь-який відтінок
  let leaf = hsl(H.g + t[0] * 0.7 + (p[0] - 0.5) * 0.16 * wide, H.sat * t[1] * (0.75 + 0.55 * p[1]), 0.24 + 0.2 * p[2]);
  let bark = hsl(0.05 + 0.08 * (p[3] - 0.5) * wide, 0.2 + 0.25 * p[4], 0.17 + 0.25 * p[5]);
  let acc = hsl(p[6] * wide, 0.6 + 0.35 * p[7], 0.48 + 0.2 * p[8]);
  if (form === 'grass' || form === 'reedlet' || form === 'fern' || form === 'bush')
    leaf = hsl(H.g + t[0] + (p[0] - 0.5) * 0.1 * wide, H.sat * t[1] * (0.85 + 0.35 * p[1]), H.gl * t[2] * (0.78 + 0.3 * p[2]));
  if (form === 'birch') bark = hsl(0.1 + 0.1 * p[3], 0.08 + 0.1 * p[4], 0.72 + 0.15 * p[5]);
  if (form === 'dead') bark = hsl(0.06 + 0.06 * p[3], 0.06 + 0.12 * p[4], 0.3 + 0.3 * p[5]);
  if (form === 'cactus' || form === 'succulent') leaf = hsl(H.g + 0.08 * (p[0] - 0.3) * wide, 0.25 + 0.35 * p[1], 0.3 + 0.18 * p[2]);
  if (form === 'crystal' || form === 'smallcrystal') leaf = hsl(H.w + (p[0] - 0.5) * 0.5 * wide, 0.4 + 0.4 * p[1], 0.55 + 0.2 * p[2]);
  if (form === 'coral' || form === 'coralbit' || form === 'tentacle') leaf = hsl(p[6] * wide + 0.5, 0.45 + 0.4 * p[1], 0.45 + 0.2 * p[2]);
  if (form === 'lichen' && L.weird < 0.3 && !L.exotic) acc = hsl(0.07 + 0.1 * p[6], 0.45 + 0.3 * p[7], 0.5 + 0.15 * p[8]);   // біля поверхні — природний
  if (Bm.name === 'кістяні пустища') { leaf = hsl(0.1, 0.12, 0.8 + 0.1 * p[2]); bark = leaf; }
  if (Bm.name === 'крижані шпилі') leaf = hsl(H.w + 0.05 * (p[0] - 0.5), 0.3, 0.85);
  // key — ключ кешу геометрії: гени залежать і від номера всесвіту
  return { id, key: `${L.seed}:${id}`, form, big, w: 0.3 + 1.4 * p[10], h, p, leaf, bark, acc, g: L.grav };
}

// Стиль каміння області: ваги стилів (від біому, з мутаціями), колір, грубість
function stones(L, bm, reg, mut) {
  const Bm = BIOMES[bm], p = [];
  for (let k = 0; k < 6; k++) p.push(gene(L, bm, 40, reg.id, reg.cx, reg.cy, k, mut));
  const ws = STONES.map((s, i) => [s, (Bm.stones[s] || 0) * (0.4 + 1.2 * p[i % 6])]).filter((e) => e[1] > 0);
  const H = L.hue;
  return {
    id: hash4(reg.id, bm, 40, 0x5bec), key: `${L.seed}:${hash4(reg.id, bm, 40, 0x5bec)}`, form: 'stone', big: true, styles: ws.length ? ws : [['boulder', 1]], p,
    leaf: hsl(H.r + (p[0] - 0.5) * 0.12, (0.1 + 0.16 * p[1]) * (0.7 + 0.6 * p[2]), 0.42 + 0.16 * p[3]),
    bark: L.pal.trunk, acc: L.pal.crystal,
  };
}

// Види області reg у біомі bm: {big: [геном…], small: [геном…], stone}. Кеш — за всесвітом, областю й біомом
const cache = new Map();
export function speciesOf(L, reg, bm) {
  const key = `${L.seed}:${reg.id}:${bm}`;
  let S = cache.get(key);
  if (S) return S;
  const Bm = BIOMES[bm], mut = 0.55 + 0.5 * L.weird;
  const cnt = ([lo, hi], salt) => lo + Math.floor(unit(hash3(reg.id, bm, salt)) * (hi - lo + 1));
  S = { big: [], small: [], stone: stones(L, bm, reg, mut) };
  if (Bm.big.length) for (let j = 0, n = cnt(Bm.nBig, 1); j < n; j++) S.big.push(genome(L, bm, j, true, reg, mut));
  if (Bm.small.length) for (let j = 0, n = cnt(Bm.nSmall, 2); j < n; j++) S.small.push(genome(L, bm, 8 + j, false, reg, mut));
  if (cache.size > 2000) cache.clear();
  cache.set(key, S);
  return S;
}

// Вид з набору за хешем клітинки (ваги — поширеність виду)
export function pickSpecies(list, h) {
  let sum = 0;
  for (const g of list) sum += g.w;
  let u = unit(h) * sum;
  for (const g of list) { u -= g.w; if (u < 0) return g; }
  return list[list.length - 1];
}
