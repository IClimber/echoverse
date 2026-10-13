// weather.js — погода й вітер у просторі й часі (п. 4 roadmap, М8; лише рух, вигляд і показ — Math.* дозволено). Без DOM.
// Погода — поле: хмарність c = fBm((x − u·t)/S, (y − v·t)/S, t/T) пливе за переважним вітром (S — розмір плям,
// T — час зміни, закони L.air.cS / cT), переведене в рівномірне q (емпірична таблиця fBm); стан — за порогами q з ваг
// законів (ясно < хмарно < дощ < гроза), туман і пилова буря — свої поля. Параметри (хмарність, видимість, опади, пил,
// темніше, вітер) плавні через пороги (±0,05), назва — з гістерезисом 0,05. Та сама мить і місце — та сама погода.
// Вітер у точці: база (L.air.wind, ясно на рівнині) × погода × доба × пориви × висота й відкритість; напрям — комірки
// циркуляції за широтою й обертанням (пасати, західні; захоплена — з нічного боку до денного) ± відхилення поля.
// Без повітря — ні погоди, ні вітру. Місце уточнює: у холоді — сніг, у пустелі дощ не долітає, кислота — кислотний дощ.
import { hash3, unit } from './rng.js';
import { fbm3, noise2 } from './noise.js';
import { tile, T_DESERT, T_DRY } from './gen/chunk.js';
import { dayPhase, skyAxes, skyState } from './sky.js';
import { LEVEL } from './iso.js';
import { SEA } from './universe.js';

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
const PARAMS = ['clouds', 'vis', 'precip', 'dust', 'wind', 'dim'];
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const ss = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const EDGE = 0.05, HYST = 0.05, OCT = 2, MIN_HOLD = 60;

// Розподіл fBm3 (OCT октав): таблиця квантилів, раз на запуск (емпірично, 20 000 значень)
let FQ = null;
function fq(v) {
  if (!FQ) {
    const a = [];
    for (let i = 0; i < 20000; i++) a.push(fbm3(0x51ed, i * 0.6180339 % 97, i * 0.4142 % 89, i * 0.0731, OCT));
    a.sort((x, y) => x - y);
    FQ = []; for (let i = 0; i <= 100; i++) FQ.push(a[Math.min(a.length - 1, Math.floor(i / 100 * a.length))]);
  }
  if (v <= FQ[0]) return 0;
  if (v >= FQ[100]) return 1;
  let lo = 0, hi = 100;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (FQ[m] <= v) lo = m; else hi = m; }
  return (lo + (v - FQ[lo]) / (FQ[hi] - FQ[lo] || 1)) / 100;
}
// Пороги за вагами законів: хмарне поле — частки ясно, хмарно, дощ, гроза; туман і пил — частки серед усіх
function thresholds(L) {
  if (L._wth) return L._wth;
  const w = L.air.w, all = KINDS.reduce((s, k) => s + w[k], 0) || 1, four = w.clear + w.cloudy + w.rain + w.storm || 1;
  const t1 = w.clear / four, t2 = t1 + w.cloudy / four, t3 = t2 + w.rain / four;
  return (L._wth = { t: [t1, t2, t3], fog: 1 - w.fog / all, dust: 1 - w.dust / all });
}

// Переважний вітер (одиничний [x, y]) у всесвіті L: комірки циркуляції завширшки W = 30°·√(P/24) (0,5…3): парні — зі
// сходу з відхиленням до екватора (пасати), непарні — із заходу до полюса (західні); біля меж (±5°) — слабко (calm < 1)
export function prevailing(L, clock = 0) {
  const A = skyAxes(L), lat = L.sky.lat * 180 / Math.PI;
  if (L.sky.lock) {                                   // захоплена: з нічного боку до денного — до сонця
    const s = skyState(L, clock).suns[0].dir, l = Math.hypot(s[0], s[1]) || 1;
    return { dir: [s[0] / l, s[1] / l], calm: 1 };
  }
  const W = 30 * Math.min(3, Math.max(0.5, Math.sqrt(L.planet.rot / 24))), k = Math.floor(lat / W), r = lat - k * W;
  const sg = k % 2 === 0 ? -1 : 1, dx = sg * 0.94, dy = sg * 0.34;
  return { dir: [A.e[0] * dx + A.nn[0] * dy, A.e[1] * dx + A.nn[1] * dy], calm: 0.5 + 0.5 * ss(0, 5, Math.min(r, W - r)) };
}

// Погода в точці (x, y) у мить clock: {kind, clouds, vis, precip, dust, dim, wind [x, y] (м/с, рівнина), windK, flash, q,
// drift [x, y] (м) — на скільки поле хмар зсунулось за вітром від clock 0: хмари неба пливуть з ним рівномірно};
// prev — попередній результат у цій точці (гістерезис назви: біля порогу й першу хвилину стану — як була)
// Поля погоди в точці: хмарне q, туман qf, пил qd (рівномірні 0…1) і параметри вигляду P (плавно через пороги)
function fields(L, clock, x, y, only) {
  const A = L.air, t = clock * (L.phys ? L.phys.time : 1), Pw = prevailingC(L, clock), v0 = A.wind;
  const ux = Pw.dir[0] * v0 * 0.5, uy = Pw.dir[1] * v0 * 0.5, S = A.cS, T = A.cT, sx = (x - ux * t) / S, sy = (y - uy * t) / S, st = t / T;
  const q = fq(fbm3(L.ds ^ 0x3ea7, sx, sy, st, OCT)), qf = fq(fbm3(L.ds ^ 0x7f0, sx * 1.7, sy * 1.7, st * 1.3, OCT)), qd = fq(fbm3(L.ds ^ 0xd57, sx * 0.8, sy * 0.8, st * 0.9, OCT));
  const Th = thresholds(L), [t1, t2, t3] = Th.t;
  // параметри: від ясної вгору порогами хмарного поля; туман і пил — поверх ясної й хмарної
  const P = {}, wet = ss(t2 - EDGE, t2 + EDGE, q), wf = ss(Th.fog - EDGE, Th.fog + EDGE, qf) * (1 - wet), wd = ss(Th.dust - EDGE, Th.dust + EDGE, qd) * (1 - wet) * (1 - wf);
  for (const k of only || PARAMS) {
    let v = LOOK[0][k] + (LOOK[1][k] - LOOK[0][k]) * ss(t1 - EDGE, t1 + EDGE, q) + (LOOK[2][k] - LOOK[1][k]) * wet + (LOOK[3][k] - LOOK[2][k]) * ss(t3 - EDGE, t3 + EDGE, q);
    v += (LOOK[W_FOG][k] - v) * wf; v += (LOOK[W_DUST][k] - v) * wd;
    P[k] = v;
  }
  return { q, qf, qd, P, Th, Pw, t, sx, sy, st, v0 };
}
// Хмарність у точці (карта хмар неба)
const ONLY_CLOUDS = ['clouds'];
export const cloudsAt = (L, clock, x, y) => L.air.vacuum ? 0 : fields(L, clock, x, y, ONLY_CLOUDS).P.clouds;
// Переважний вітер на мить (кеш на закони: однаковий для всіх точок)
function prevailingC(L, clock) {
  if (L._pwC !== clock) { L._pw = prevailing(L, clock); L._pwC = clock; }
  return L._pw;
}

export function weatherAt(L, clock, x = 0, y = 0, prev = null) {
  if (L.air.vacuum) return { kind: W_CLEAR, clouds: 0, vis: 1, precip: 0, dust: 0, dim: 0, wind: [0, 0], windK: 0, flash: 0, q: 0, since: clock, drift: [0, 0] };
  const { q, qf, qd, P, Th, Pw, t, sx, sy, st, v0 } = fields(L, clock, x, y), [t1, t2, t3] = Th.t;
  // назва: за порогами з гістерезисом (поруч із межею — як була)
  const kindQ = (h) => q < t1 + h[0] ? W_CLEAR : q < t2 + h[1] ? W_CLOUDY : q < t3 + h[2] ? W_RAIN : W_STORM;
  let kind = kindQ([0, 0, 0]);
  if (kind < W_RAIN && qf > Th.fog) kind = W_FOG;
  if (kind < W_RAIN && kind !== W_FOG && qd > Th.dust) kind = W_DUST;
  if (prev && prev.kind !== kind) {
    const pk = prev.kind, near = Math.min(Math.abs(q - t1), Math.abs(q - t2), Math.abs(q - t3), Math.abs(qf - Th.fog), Math.abs(qd - Th.dust));
    if (near < HYST || clock - prev.since < MIN_HOLD) kind = pk;   // біля порогу чи щойно змінилась — як була
  }
  const since = prev && prev.kind === kind ? prev.since : clock;
  // вітер на рівнині: база × погода × доба (удень сильніший) × пориви (τ 3–8 с; у грозу сильніші); напрям ± 40° поля
  const day = Math.max(0, Math.cos(2 * Math.PI * (dayPhase(L, clock) - 0.5)));
  const gust = 1 + (0.3 + 0.2 * (P.precip > 0.8 ? 1 : 0)) * noise2(L.ds ^ 0x6057, t / (3 + 5 * unit(hash3(L.ds, 0x6058, 0))), 0.5);
  const ws = v0 * P.wind * Pw.calm * (0.8 + 0.4 * day) * Math.max(0.4, gust);
  const dev = 0.7 * fbm3(L.ds ^ 0x4d1, sx * 0.5, sy * 0.5, st * 0.5, 2), c = Math.cos(dev), s = Math.sin(dev);
  const wx = Pw.dir[0] * c - Pw.dir[1] * s, wy = Pw.dir[0] * s + Pw.dir[1] * c;
  return { kind, clouds: P.clouds, vis: P.vis, precip: P.precip, dust: P.dust, dim: P.dim, wind: [wx * ws, wy * ws], windK: ws, flash: 0, q, since,
    drift: [Pw.dir[0] * v0 * 0.5 * t, Pw.dir[1] * v0 * 0.5 * t] };
}

// Вітер на висоті й відкритості: × clamp(1 + 0,35·(z − z̄)/32, 0,6…1,6) × (1 + висота над морем / 2000); z̄ — середня
// висота поверхні в 8 точках на колі 48 м (relief; рахувати після зсуву > 8 м)
export function reliefAt(L, x, y) {
  let s = 0;
  const o = {};
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; tile(L, Math.floor(x + 48 * Math.cos(a)), Math.floor(y + 48 * Math.sin(a)), o); s += Math.max(o.h, SEA) * LEVEL; }
  return s / 8;
}
export function windHeightK(z, zbar) {
  return Math.min(1.6, Math.max(0.6, 1 + 0.35 * (z - zbar) / 32)) * (1 + Math.max(0, z - SEA * LEVEL) / 2000);
}

// Блискавка в мить clock біля (x, y): клітини 1 км × відрізки 0,5 с, імовірність 0,005 × сила грози в клітині (у пиловій
// бурі — × DUST_BOLT); ціль —
// найвища точка в радіусі 30 м (висоти tile) — {x, y, t0 (початок), k (сила 0…1)} найближча в радіусі R чи null
const DUST_BOLT = 0.04;
export function lightningNear(L, clock, x, y, R = 3000) {
  if (L.air.vacuum) return null;
  const seg = Math.floor(clock * 2), cx0 = Math.floor((x - R) / 1000), cx1 = Math.floor((x + R) / 1000), cy0 = Math.floor((y - R) / 1000), cy1 = Math.floor((y + R) / 1000);
  let best = null, bd = Infinity;
  for (let s = seg - 1; s <= seg; s++) for (let j = cy0; j <= cy1; j++) for (let i = cx0; i <= cx1; i++) {
    const h = hash3(L.ds ^ 0x1f1a, s * 4099 + i, j);
    if (unit(h) > 0.005) continue;
    const px = (i + unit(hash3(h, 1, 0))) * 1000, py = (j + unit(hash3(h, 2, 0))) * 1000, W = weatherAt(L, s / 2, px, py);
    let storm = clamp01((W.precip - 0.7) / 0.3) * clamp01((W.dim - 0.3) / 0.15);
    // суха блискавка: у пиловій бурі частинки електризуються тертям (як у вулканічній хмарі) — над пустелею й степом,
    // у DUST_BOLT разів рідше, ніж у грозі (рішення користувача 12.10.2026)
    if (storm <= 0 && W.dust > 0.6) { const t = tile(L, Math.floor(px), Math.floor(py)).t; if (t === T_DESERT || t === T_DRY) storm = DUST_BOLT * clamp01((W.dust - 0.6) / 0.3); }
    if (unit(hash3(h, 5, 0)) >= storm) continue;
    const t0 = (s + unit(hash3(h, 3, 0)) * 0.5) / 2;
    if (clock < t0 || clock > t0 + 0.25) continue;
    const d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = { x: px, y: py, t0, k: 0.6 + 0.4 * unit(hash3(h, 4, 0)), h }; }
  }
  if (!best) return null;
  // ціль — найвища точка в радіусі 30 м (сітка 6 м)
  const o = {};
  let hz = -1e9, tx = best.x, ty = best.y;
  for (let dy = -30; dy <= 30; dy += 6) for (let dx = -30; dx <= 30; dx += 6) {
    if (dx * dx + dy * dy > 900) continue;
    tile(L, Math.floor(best.x + dx), Math.floor(best.y + dy), o);
    if (o.h > hz) { hz = o.h; tx = best.x + dx; ty = best.y + dy; }
  }
  return { ...best, cx: best.x, cy: best.y, x: Math.floor(tx) + 0.5, y: Math.floor(ty) + 0.5, z: (hz + 1) * LEVEL };
}

// Ламана розряду для сцени: від хмари (≈ 600 м над ціллю, зсув до 150 м) до цілі зигзагом (14 ланок) з 1–3 гілками;
// [[x0, y0, z0, x1, y1, z1, ширина], …] (детерміновано з хешу блискавки)
export function boltSegs(B) {
  const r = (i, j) => unit(hash3(B.h, i, j)) * 2 - 1, out = [];
  const top = [B.x + 150 * r(9, 1), B.y + 150 * r(9, 2), B.z + 600];
  let p = top;
  for (let i = 1; i <= 14; i++) {
    const f = i / 14, q = i === 14 ? [B.x, B.y, B.z] : [top[0] + (B.x - top[0]) * f + 30 * r(i, 1), top[1] + (B.y - top[1]) * f + 30 * r(i, 2), top[2] + (B.z - top[2]) * f + 8 * r(i, 3)];
    out.push([...p, ...q, 2.5]);
    if (i < 10 && r(i, 4) > 0.6) {                                // гілка вбік і вниз
      let g = q;
      for (let j = 0; j < 4; j++) { const n = [g[0] + 40 * r(i * 7 + j, 5), g[1] + 40 * r(i * 7 + j, 6), g[2] - 35 - 20 * Math.abs(r(i * 7 + j, 7))]; out.push([...g, ...n, 1.2]); g = n; }
    }
    p = q;
  }
  return out;
}

// Метеори в мить clock (до 4): уночі з повітрям — у середньому раз на 20–40 с, у 3 % ночей — зоряний дощ ×15; кожен —
// {a (початок, напрям на небі), b (кінець), t (0…1 поступ)}; радіант дощу — спільний
export function meteorsAt(L, clock, night) {
  if (L.air.vacuum || night < 0.3) return [];
  const per = 20 + 20 * unit(hash3(L.ds, 0x3e7, 0)), nightN = Math.floor(clock / (L.sky.dayMin * 60 / (L.phys ? L.phys.time : 1)));
  const shower = unit(hash3(L.ds, nightN, 0x5407)) < 0.03, rate = (shower ? 15 : 1) / per, len = 0.7, seg = Math.floor(clock / len), out = [];
  const rad = [unit(hash3(L.ds, nightN, 1)) * 2 - 1, unit(hash3(L.ds, nightN, 2)) * 2 - 1];
  for (let s = seg - 1; s <= seg && out.length < 4; s++) for (let i = 0; i < 4 && out.length < 4; i++) {
    const h = hash3(L.ds ^ 0x3e70, s, i);
    if (unit(h) > rate * len / 4) continue;
    const t = (clock - s * len) / len;
    if (t < 0 || t > 1) continue;
    const az = unit(hash3(h, 1, 0)) * 6.283, el = 0.35 + 0.6 * unit(hash3(h, 2, 0));
    const a = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
    let mx = shower ? a[0] - rad[0] : Math.cos(az + 2), my = shower ? a[1] - rad[1] : Math.sin(az + 2);
    const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    const L2 = 0.2 + 0.15 * unit(hash3(h, 3, 0)), b = [a[0] + mx * L2, a[1] + my * L2, a[2] - 0.12 * L2];
    out.push({ a, b, t, k: 0.6 + 0.4 * unit(hash3(h, 4, 0)) });
  }
  return out;
}

// Погода в місці: cold — холодно (сніг; climate.js snowy — за температурою в точці), desert — пустеля, arid — пустеля чи
// степ. Дощ у холоді — сніг, у пустелі не долітає; пилова буря — лише в пустелі й степу, деінде — просто вітер; кислота —
// кислотний дощ. Повертає {type: 'rain' | 'snow' | 'acid' | 'dust' | null, k (сила 0…1), name (для HUD), W (погода з
// поправкою на місце: видимість, пил)}
export function localWeather(L, W, cold, desert, arid = desert) {
  let name = WEATHER_NAMES[W.kind];
  if (L.air.vacuum) return { type: null, k: 0, name: 'без повітря', W };
  if (W.dust > 0.05) {
    if (arid) return { type: 'dust', k: W.dust, name, W };
    return { type: null, k: 0, name: W.kind === W_DUST ? 'вітряно' : name, W: { ...W, dust: 0, vis: Math.max(W.vis, 0.85) } };
  }
  if (W.precip < 0.05) return { type: null, k: 0, name, W };
  if (desert) return { type: null, k: 0, name: W.kind === W_STORM ? 'суха гроза' : 'хмарно, дощ не долітає', W: { ...W, vis: Math.max(W.vis, 0.85) } };
  const type = cold ? 'snow' : L.air.acid ? 'acid' : 'rain';
  if (cold) name = W.kind === W_STORM ? 'хуртовина' : 'сніг';
  else if (type === 'acid') name = W.kind === W_STORM ? 'гроза, кислотний дощ' : 'кислотний дощ';
  return { type, k: W.precip, name, W };
}

// Клімат місця для погоди: пустеля (дощ не долітає), сухо (пилова буря) — за околом (3×3 точки з кроком CLIM_S клітинок:
// погода не знає про окремі клітинки) з гістерезисом: біля межі не перемикається на кожному кроці (скарга 08.10.2026:
// «в одному блоці пилова буря, а в сусідньому нема»). prev — попередній результат
const CLIM_S = 12;
export function areaClimate(L, x, y, prev) {
  const fx = Math.floor(x), fy = Math.floor(y);
  if (prev && prev.L === L && prev.x === fx && prev.y === fy) return prev;
  let de = 0, ar = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const c = tile(L, fx + i * CLIM_S, fy + j * CLIM_S);
    if (c.t === T_DESERT) de++;
    if (c.t === T_DESERT || c.t === T_DRY) ar++;
  }
  const p = prev && prev.L === L ? prev : null;
  return {
    L, x: fx, y: fy,
    desert: p && p.desert ? de >= 3 : de >= 6,       // вмикається з 6 із 9 точок, вимикається нижче 3
    arid: p && p.arid ? ar >= 3 : ar >= 6,
  };
}
