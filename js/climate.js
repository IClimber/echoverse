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
// ±150; найтепліше о 14:00) + сезон (нахил осі × широта: Земля на 38° — ±7) + погода (дощ −2, гроза −4, сніг −3)
export function tempAt(L, x, y, z, clock, W = null) {
  const C = L.clim, zs = z - SEA * LEVEL;
  let T = C.Tpatch - 273.15 + 19.2 * fbm3(L.sT, x / 800, y / 800, L.n * 0.03, 3);
  T = Math.max(0.84 * C.Teq - 273.15, T - C.lapse * Math.max(0, zs));
  if (!L.sky.lock) T += C.Ad * (1 - 0.5 * (W ? W.clouds : 0)) * Math.cos(TAU * (dayPhase(L, clock) - 0.58));
  if (L.sky.year && !L.sky.lock) T += C.As * Math.sin(TAU * (yearPhase(L, clock) - 0.08));
  if (W) T -= W.kind === 3 ? 4 : W.precip > 0.3 ? 2 : 0;
  return T;
}
// Сніг чи дощ за температурою в точці з гістерезисом: нижче 0 °C — сніг, вище 1,5 °C — дощ, між — як було
export const snowy = (T, prev) => T < 0 ? true : T > 1.5 ? false : !!prev;
// Повітря на висоті z: тиск (атм) і густина (кг/м³) — e^(−z / H), H — висота однорідної атмосфери (L.air.H, ×1/8 земної)
export function airAt(L, z) {
  const A = L.air, f = A.vacuum ? 0 : Math.exp(-Math.max(0, z - SEA * LEVEL) / A.H);
  return { P: A.pressure * f, rho: A.rho * f };
}
