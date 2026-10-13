// climate.js — температура й повітря в точці й мить (п. 4 roadmap, М4 і М6; лише рух, вигляд і показ — Math.*
// дозволено). Генерація бере лише температуру ділянки й градієнт (L.temp, L.clim.lapse у gen/chunk.js tile); тут —
// те саме плюс доба, сезон, погода, без обмеження ±2,5 одиниць (Венера в HUD — сотні градусів).
import { fbm3 } from './noise.js';
import { SEA } from './universe.js';
import { LEVEL } from './iso.js';
import { dayPhase, yearPhase } from './sky.js';

const TAU = Math.PI * 2;
// Температура (°C) у точці (x, y, z) у мить clock; W — погода (weather.js weatherAt; хмари гасять добу, опади холодять).
// Ділянка (широта, зоря, парниковий ефект) + біом (той самий шум, що в tile: 0,6 одиниці = 19,2 °C) − висота
// (52 °C/км × g, не нижче 0,84 рівноважної) + доба (амплітуда — від обертання й стовпа повітря: Земля ±6, без повітря до
// ±150; найтепліше о 14:00) + сезон (нахил осі × широта: Земля на 38° — ±9) + погода (дощ −2, гроза −4)
export function tempAt(L, x, y, z, clock, W = null) { return tempParts(L, x, y, z, clock, W).T; }
// Те саме з розкладом (F3, ?dev envAt): ділянка, біом, висота, доба, сезон, погода (°C)
export function tempParts(L, x, y, z, clock, W = null) {
  const C = L.clim, zs = z - SEA * LEVEL, patch = C.Tpatch - 273.15, biome = 19.2 * fbm3(L.sT, x / 800, y / 800, L.n * 0.03, 3);
  const height = Math.max(0.84 * C.Teq - 273.15, patch + biome - C.lapse * Math.max(0, zs)) - patch - biome;
  const day = L.sky.lock ? 0 : C.Ad * (1 - 0.5 * (W ? W.clouds : 0)) * Math.cos(TAU * (dayPhase(L, clock) - 0.58));
  const season = L.sky.year && !L.sky.lock ? C.As * Math.sin(TAU * (yearPhase(L, clock) - 0.08)) : 0;
  const weather = W ? (W.kind === 3 ? -4 : W.precip > 0.3 ? -2 : 0) : 0;
  return { T: patch + biome + height + day + season + weather, patch, biome, height, day, season, weather };
}
// Радіація зараз (0…1): база всесвіту (L.air.rad) + буря зорі сили I (sky.js stormAt): + 0,5·I·clamp(1,1 − B)/(1 + 4P/g)
// — поле й повітря захищають
export function radNow(L, I) {
  const B = L.mag ? L.mag.B : 1, P = L.air.vacuum ? 0 : L.air.pressure, g = Math.max(0.02, L.grav);
  return Math.min(1, L.air.rad + 0.5 * I * Math.min(1.1, Math.max(0.1, 1.1 - B)) / (1 + 4 * P / g));
}
// Сніг чи дощ за температурою в точці з гістерезисом: нижче 0 °C — сніг, вище 1,5 °C — дощ, між — як було
export const snowy = (T, prev) => T < 0 ? true : T > 1.5 ? false : !!prev;
// Повітря на висоті z: тиск (атм) і густина (кг/м³) — e^(−z / H), H — висота однорідної атмосфери (L.air.H, ×1/8 земної)
export function airAt(L, z) {
  const A = L.air, f = A.vacuum ? 0 : Math.exp(-Math.max(0, z - SEA * LEVEL) / A.H);
  return { P: A.pressure * f, rho: A.rho * f };
}
