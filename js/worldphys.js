// worldphys.js — тяжіння й повітря в точці для руху (п. 4 roadmap, М10–М11; лише рух і вигляд — Math.* дозволено:
// фізика тіл і гравця не мусить бути однаковою на різних пристроях). Вектор тяжіння (у g, униз — додатне gz):
// база всесвіту (L.grav: радіус, густина, відцентрова) × аномалія плями (universe.js gravityAt) × зворотна гравітація
// за висотою над ґрунтом + нахил плями + приплив компаньйона (з його напряму на небі в мить clock).
import { physOf, gravityAt } from './universe.js';
import { skyState } from './sky.js';
import { airAt } from './climate.js';

const ss = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
// Зворотна пляма: множник тяжіння на висоті h (м) над ґрунтом — k₀ біля ґрунту до H_a, далі плавно до 1 за H_f
export function revK(L, k0, h) { const R = L.anom.rev; return k0 + (1 - k0) * ss((h - R.Ha) / R.Hf); }
// Висота рівноваги (k = 0) над ґрунтом у зворотній плямі (x, y) чи null (тяжіння тут не зворотне)
export function revEq(L, x, y) {
  const R = L.anom && L.anom.rev;
  if (!R) return null;
  const a = gravityAt(L, x, y);
  if (!a.rev || a.k >= 0) return null;
  let lo = R.Ha, hi = R.Ha + R.Hf;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (revK(L, a.k, m) < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// Приплив компаньйона (у g бази): a = (f/2)·(3(ŝ·ẑ)ŝ − ẑ) — у зеніті й надирі −f (легше), на обрії +f/2; кеш на мить
let tideC = { L: null, clock: NaN, v: [0, 0, 0] };
export function tideAt(L, clock) {
  if (!L.comp) return null;
  if (tideC.L === L && tideC.clock === clock) return tideC.v;
  const v = tideVec(L.comp.f, skyState(L, clock).moons.find((o) => o.comp).dir);
  tideC = { L, clock, v };
  return v;
}
// Припливне прискорення (у g) від тіла з силою f у напрямку s (одиничний, z — угору): угору — додатне z
export const tideVec = (f, s) => [1.5 * f * s[2] * s[0], 1.5 * f * s[2] * s[1], 0.5 * f * (3 * s[2] * s[2] - 1)];
// Рух у точці (x, y, z) у мить clock; ground(x, y) — висота ґрунту (лише в зворотних плямах; null — не знаємо): physOf з
// тяжінням униз g (може бути ≤ 0), tilt [x, y] — горизонтальне прискорення (у g, абсолютне), anom — множник плями,
// tide — приплив (вертикаль, у g бази), rev — у зворотній плямі, g0 і vT0 — без аномалій (опір повітря від g не залежить)
export function physAt3(L, x, y, z, clock = 0, ground = null) {
  const a = gravityAt(L, x, y), t = tideAt(L, clock), G = L.grav;
  let k = a.k;
  const gz0 = a.rev && ground ? ground(x, y) : null;
  if (gz0 !== null && gz0 !== undefined) k = revK(L, a.k, z - gz0);
  const gz = G * k - (t ? G * t[2] : 0);
  const tx = a.tx * G * Math.abs(k) + (t ? G * t[0] : 0), ty = a.ty * G * Math.abs(k) + (t ? G * t[1] : 0);
  // повітря на висоті (тиск — e^(−z / H)): межа падіння й сила вітру
  const A = airAt(L, z), La = A.P === L.air.pressure ? L : { ...L, air: { ...L.air, pressure: A.P } };
  const base = physOf({ ...La, grav: Math.max(0.02, Math.abs(gz)) });
  return { ...base, g: gz, g0: G, vT0: physOf(La).vT, P: A.P, rho: A.rho, tilt: tx || ty ? [tx, ty] : null, anom: a.k !== 1 ? k : null, tide: t ? -t[2] : 0, rev: !!a.rev };
}
