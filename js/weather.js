// weather.js — погода всесвіту в часі (лише вигляд; вплив на виживання — пізніше). Без DOM.
// Час поділено на відрізки (L.air.segMin хв); погода відрізка — з ваг законів (L.air.w) за хешем (всесвіт, відрізок),
// тож та сама мить — та сама погода. Між відрізками — плавний перехід. Гроза — зі спалахами блискавок.
// Місце уточнює: у холоді (сніг, лід) дощ — снігом, у пустелі й степу дощ не долітає; кислота — кислотний дощ.
// Холод, пустеля й сухість — за околом з гістерезисом (areaClimate), не за клітинкою під ногами.
import { hash3, unit } from './rng.js';
import { tile, T_DESERT, T_DRY } from './gen/chunk.js';

export const W_CLEAR = 0, W_CLOUDY = 1, W_RAIN = 2, W_STORM = 3, W_FOG = 4, W_DUST = 5;
const KINDS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'dust'];
export const WEATHER_NAMES = ['ясно', 'хмарно', 'дощ', 'гроза', 'туман', 'пилова буря'];
// Вигляд кожної погоди: хмарність, видимість (множник далечі туману), сила опадів, пил, вітер (множник), темніше
const LOOK = [
  { clouds: 0.18, vis: 1, precip: 0, dust: 0, wind: 1, dim: 0 },
  { clouds: 0.62, vis: 0.9, precip: 0, dust: 0, wind: 1.2, dim: 0.15 },
  { clouds: 0.85, vis: 0.7, precip: 0.7, dust: 0, wind: 1.3, dim: 0.3 },
  { clouds: 1, vis: 0.55, precip: 1, dust: 0, wind: 2.2, dim: 0.45 },
  { clouds: 0.5, vis: 0.3, precip: 0, dust: 0, wind: 0.5, dim: 0.2 },
  { clouds: 0.3, vis: 0.38, precip: 0, dust: 1, wind: 2.4, dim: 0.25 },
];
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

// Погода відрізка seg всесвіту L
function kindOf(L, seg) {
  const w = L.air.w, ws = KINDS.map((k) => w[k]);
  let sum = 0;
  for (const v of ws) sum += v;
  let u = unit(hash3(L.ds ^ 0x3ea7, L.n, seg)) * sum;
  for (let i = 0; i < ws.length; i++) { u -= ws[i]; if (u < 0) return i; }
  return W_CLEAR;
}

// Погода у мить clock: {kind, next, t (перехід 0…1), clouds, vis, precip, dust, dim, wind [x, y] (клітинок/с), flash}
export function weatherAt(L, clock) {
  clock *= L.phys ? L.phys.time : 1;                  // місцевий час (плин часу всесвіту)
  const len = L.air.segMin * 60, f = clock / len, seg = Math.floor(f), u = f - seg;
  const a = kindOf(L, seg), b = kindOf(L, seg + 1), t = clamp01((u - 0.85) / 0.15), A = LOOK[a], B = LOOK[b];
  const m = (k) => A[k] + (B[k] - A[k]) * t;
  const ws = L.air.wind * m('wind'), az = L.air.windAz + 0.4 * Math.sin(clock * 0.05);
  // блискавка: у грозу — спалах раз на кілька секунд (за хешем секунди), гасне за 0,25 с
  let flash = 0;
  const storm = (a === W_STORM ? 1 - t : 0) + (b === W_STORM ? t : 0);
  if (storm > 0.3) {
    const sec = Math.floor(clock * 2), h = unit(hash3(L.ds, sec, 0x1f1a));
    if (h < 0.09) flash = Math.max(0, 1 - (clock * 2 - sec) * 2) * (0.6 + 0.4 * unit(hash3(L.ds, sec, 7)));
  }
  return {
    kind: t < 0.5 ? a : b, clouds: m('clouds'), vis: m('vis'), precip: m('precip'), dust: m('dust'), dim: m('dim'),
    wind: [Math.cos(az) * ws, Math.sin(az) * ws], windK: ws, flash,
  };
}

// Погода в місці: cold — холодно (сніг, лід), desert — пустеля, arid — пустеля чи степ. Дощ у холоді — сніг,
// у пустелі не долітає; пилова буря — лише в пустелі й степу, деінде — просто вітер; кислота — кислотний дощ. Повертає {type: 'rain' | 'snow' | 'acid' |
// 'dust' | null, k (сила 0…1), name (для HUD), W (погода з поправкою на місце: видимість, пил)}
export function localWeather(L, W, cold, desert, arid = desert) {
  let name = WEATHER_NAMES[W.kind];
  if (L.air.pressure < 0.1) return { type: null, k: 0, name: 'без повітря', W };
  if (W.dust > 0.05) {
    if (arid) return { type: 'dust', k: W.dust, name, W };
    return { type: null, k: 0, name: 'вітряно', W: { ...W, dust: 0, vis: Math.max(W.vis, 0.85) } };
  }
  if (W.precip < 0.05) return { type: null, k: 0, name, W };
  if (desert) return { type: null, k: 0, name: W.kind === W_STORM ? 'суха гроза' : 'хмарно, дощ не долітає', W: { ...W, vis: Math.max(W.vis, 0.85) } };
  const type = cold ? 'snow' : L.air.acid ? 'acid' : 'rain';
  if (cold) name = W.kind === W_STORM ? 'хуртовина' : 'сніг';
  else if (type === 'acid') name = W.kind === W_STORM ? 'гроза, кислотний дощ' : 'кислотний дощ';
  return { type, k: W.precip, name, W };
}

// Клімат місця для погоди: холодно (сніг), пустеля (дощ не долітає), сухо (пилова буря) — за околом (3×3 точки з
// кроком CLIM_S клітинок: погода не знає про окремі клітинки) з гістерезисом: біля межі не перемикається на кожному
// кроці (скарга 08.10.2026: «в одному блоці пилова буря, а в сусідньому нема»). prev — попередній результат
const COLD_T = -0.45, COLD_H = 0.04, CLIM_S = 12;
export function areaClimate(L, x, y, prev) {
  const fx = Math.floor(x), fy = Math.floor(y);
  if (prev && prev.L === L && prev.x === fx && prev.y === fy) return prev;
  let T = 0, de = 0, ar = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const c = tile(L, fx + i * CLIM_S, fy + j * CLIM_S);
    T += c.T / 9;
    if (c.t === T_DESERT) de++;
    if (c.t === T_DESERT || c.t === T_DRY) ar++;
  }
  const p = prev && prev.L === L ? prev : null;
  return {
    L, x: fx, y: fy,
    cold: p ? (p.cold ? T < COLD_T + COLD_H : T < COLD_T - COLD_H) : T < COLD_T,
    desert: p && p.desert ? de >= 3 : de >= 6,       // вмикається з 6 із 9 точок, вимикається нижче 3
    arid: p && p.arid ? ar >= 3 : ar >= 6,
  };
}
