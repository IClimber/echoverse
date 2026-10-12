// Закони фізики світу (п. 4 roadmap, 12.10.2026): нормальний розподіл, еталонні тіла, біля старту, розподіли величин
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lawsOf, zOfLane, SPREAD } from '../js/universe.js';
import { starOf, planetOf, pMin, tEq, airOf, tSurf, fieldOf } from '../js/astro.js';
import { nsqrt, nsin, ncos, PI } from '../js/num.js';
import { noise2 } from '../js/noise.js';
import { hashStr } from '../js/rng.js';

const near = (v, want, eps, msg) => assert.ok(Math.abs(v - want) <= eps, `${msg}: ${v} замість ${want} ± ${eps}`);
// Закони фізики світу (нормальні): частки рівнів однакові для всіх
const PHYS = ['зоря', 'відстань до зорі', 'альбедо', 'радіус планети', 'густина планети', 'обертання', 'нахил осі', 'широта', 'поле',
  'тиск', 'кисень', 'вуглекислий газ', 'метан', 'серпанок', 'вітер', 'плин часу', 'аномалії', 'кільця', 'компаньйон'];

test('точна арифметика: корінь і синус', () => {
  for (const v of [1e-9, 0.003, 0.5, 1, 2, 17, 1234.5, 9e7]) near(nsqrt(v), Math.sqrt(v), Math.sqrt(v) * 1e-12, `√${v}`);
  for (let x = -7; x < 7; x += 0.37) { near(nsin(x), Math.sin(x), 0.0017, `sin ${x}`); near(ncos(x), Math.cos(x), 0.0017, `cos ${x}`); }
});

test('нормальний розподіл: z з номера — стандартне нормальне', () => {
  let N = 0, s = 0, s2 = 0, a15 = 0, a25 = 0;
  for (let k = 1; k < 11; k++) for (let n = 0; n < 60000; n += 3) {
    const sd = Math.imul(k, 0x9e3779b9), v = noise2(sd, n / 37, k * 7 + 0.5) + 0.25 * noise2(sd ^ 0x5bd1e995, n / (37 * 0.4), 0.5), z = zOfLane(v);
    N++; s += z; s2 += z * z; a15 += Math.abs(z) > 1.5; a25 += Math.abs(z) > 2.5;
  }
  const m = s / N, sd = Math.sqrt(s2 / N - m * m);
  near(m, 0, 0.03, 'середнє'); near(sd, 1, 0.05, 'σ'); near(a15 / N * 100, 13.4, 1, '|z| > 1,5, %'); near(a25 / N * 100, 1.24, 0.3, '|z| > 2,5, %');
  assert.ok(SPREAD[1][1] <= 0.403, 'у звичайних всесвітах (qs < 0,3) |t| < 1,5 завжди');
});

test('закони фізики світу: частки рівнів (d 0); у звичайних всесвітах — жодного незвичного', () => {
  const seed = hashStr('stats'), N = 20000, lv = {};
  for (let i = 0; i < N; i++) {
    const L = lawsOf(seed, 0, (i & 1 ? -1 : 1) * (101 + (i >> 1) * 7));
    for (const k of PHYS) { const t = L.tiers[k] || 0; (lv[k] ||= [0, 0, 0, 0])[t]++; if (L.strange.cls === 0) assert.equal(t, 0, `${k} у звичайному`); }
  }
  for (const k of PHYS) {
    const a = lv[k], u = (a[1] + a[2] + a[3]) / N * 100, x = (a[2] + a[3]) / N * 100, l = a[3] / N * 100;
    assert.ok(u > 4.5 && u < 8.5 && x > 0.5 && x < 1.6 && l > 0.03 && l < 0.4, `${k}: незвичне+ ${u.toFixed(2)} %, крайнє+ ${x.toFixed(2)} %, легендарне ${l.toFixed(2)} %`);
  }
});

test('еталонні тіла: тяжіння, температура, розрив, рік, захоплення, утримання повітря', () => {
  near(planetOf(1, 0.8).g0, 1, 0.01, 'Земля g'); near(planetOf(0.532, 0.68).g0, 0.38, 0.02, 'Марс g');
  near(planetOf(0.273, 0.6).g0, 0.165, 0.01, 'Місяць g'); near(planetOf(0.383, 0.96).g0, 0.38, 0.02, 'Меркурій g');
  const Te = tEq(1, 0.3);
  near(Te, 255, 1, 'Земля T_рівн');
  const earth = airOf({ Pb: 1, R: 1, rho: planetOf(1, 0.8).rho, Teq: Te, B: 1, O2: 0.21, CO2: 0.0004 });
  near(tSurf(Te, earth.tau), 288, 1.5, 'Земля T_пов'); assert.equal(earth.gas, 0);
  const vTe = tEq(1 / (0.723 * 0.723), 0.77), venus = airOf({ Pb: 90, R: 0.95, rho: planetOf(0.95, 0.8).rho, Teq: vTe, B: 1, O2: 0, CO2: 0.965 });
  const Tv = tSurf(vTe, venus.tau);
  assert.ok(Tv > 700 && Tv < 760, `Венера ${Tv}`);
  const mTe = tEq(1 / (1.524 * 1.524), 0.25), mars = planetOf(0.532, 0.68);
  const mAir = airOf({ Pb: 0.05, R: 0.532, rho: mars.rho, Teq: mTe, B: fieldOf(0.68, 0.532, 24.6, 1), O2: 0, CO2: 0.95 });
  const Tm = tSurf(mTe, mAir.tau);
  assert.ok(Tm > 205 && Tm < 215 && mAir.P < 0.01 && mAir.gas === 1, `Марс ${Tm} K, ${mAir.P} атм`);
  near(pMin(1, 1), 1.41, 0.01, 'розрив Землі, год');
  for (const [R, rho0] of [[0.273, 0.6], [0.383, 0.96]]) {
    const p = planetOf(R, rho0), a = airOf({ Pb: 1, R, rho: p.rho, Teq: R < 0.3 ? 270 : 440, B: 1, O2: 0.21, CO2: 0 });
    assert.equal(a.gas, 4, `R ${R}: без повітря`);
  }
  // захоплення: a³/M < 0,014 (Сонце й Земля — ні; червоний карлик 3200 K на тій самій інсоляції — так)
  const sun = starOf(5772), red = starOf(3200), aR = nsqrt(red.L);
  assert.ok(1 / sun.M >= 0.014 && aR * aR * aR / red.M < 0.014, 'захоплення');
  near(sun.L, 1, 1e-9, 'світність Сонця'); assert.equal(sun.cls, 2);
});

test('тяжіння на ділянці: відцентрова на екваторі при обертанні на межі розриву', () => {
  // L.grav = g₀·(1 − c·cos²lat), c = 1,977·(R/g₀)/P²; при P = 1,25·P_min c = 1,977 / (1,977·1,5625) = 0,64
  const R = 1, g0 = 1, P = 1.25 * pMin(R, g0), c = 1.977 * (R / g0) / (P * P);
  near(g0 * (1 - c), 0.36, 0.01, 'екватор'); near(g0 * (1 - c * ncos(PI / 2) * ncos(PI / 2)), 1, 1e-4, 'полюс');
});

test('біля старту — земні закони', () => {
  const seed = hashStr('старт');
  for (const s of ['старт', 'test', '1hsb1wu']) {
    const L = lawsOf(hashStr(s), 0, 0), T = L.clim.Tpatch - 273.15;
    assert.ok(L.grav > 0.97 && L.grav < 1.03 && T > 8 && T < 20 && L.air.pressure > 0.9 && L.air.pressure < 1.1 && L.sky.dayMin > 18 && L.sky.dayMin < 22,
      `${s}: g ${L.grav}, T ${T}, P ${L.air.pressure}, доба ${L.sky.dayMin}`);
  }
  for (let n = -8; n <= 8; n++) {
    const L = lawsOf(seed, 0, n), T = L.clim.Tpatch - 273.15;
    assert.ok(L.star.n === 1 && L.star.T > 5300 && L.star.T < 6200 && L.sky.moons.length === 1, `${n}: зоря ${L.star.T}, місяців ${L.sky.moons.length}`);
    assert.ok(L.grav > 0.85 && L.grav < 1.15 && T > 0 && T < 28 && L.air.pressure > 0.75 && L.air.pressure < 1.3 && L.air.breath, `${n}: g ${L.grav}, T ${T}, P ${L.air.pressure}`);
    assert.ok(L.sky.dayMin > 16 && L.sky.dayMin < 26 && !L.comp && !L.sky.rings && !L.anom.freq && !L.tanom && !L.anom.rev, `${n}`);
  }
});

test('розподіли величин (d 0) і крайнощі на глибинах', () => {
  const seed = hashStr('розподіл'), G = [], T = [];
  for (let i = 0; i < 20000; i++) { const L = lawsOf(seed, 0, 200 + 7 * i); G.push(L.grav); T.push(L.clim.Tpatch - 273.15); }
  G.sort((a, b) => a - b);
  const pc = (A, f) => A.filter(f).length / A.length * 100;
  assert.ok(G[10000] > 0.95 && G[10000] < 1.05 && pc(G, (g) => g < 0.38) < 1 && pc(G, (g) => g > 2) < 0.5, `g: медіана ${G[10000]}`);
  assert.ok(pc(T, (t) => t > -60 && t < 60) >= 95 && pc(T, (t) => t > 100) < 0.6, `T: у −60…60 — ${pc(T, (t) => t > -60 && t < 60)} %, > 100 — ${pc(T, (t) => t > 100)} %`);
  const seen = { light: 0, heavy: 0, hot: 0, vac: 0, sulf: 0, three: 0, comp: 0, rev: 0, time: 0 };
  for (let d = 0; d <= 12; d++) for (let i = 0; i < 3000; i++) {
    const L = lawsOf(seed, d, 300 + 11 * i);
    seen.light += L.grav < 0.1; seen.heavy += L.grav > 2.5; seen.hot += L.clim.Tpatch - 273.15 > 400; seen.vac += L.air.vacuum;
    seen.sulf += L.air.comp.SO2 > 0; seen.three += L.star.n === 3; seen.comp += !!(L.comp && L.comp.f >= 0.15); seen.rev += !!L.anom.rev; seen.time += !!L.tanom;
  }
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `не трапилось: ${k}`);
});

test('похолодання з висотою: 52 °C/км при 1 g, без повітря — 0', () => {
  const L = lawsOf(hashStr('test'), 0, 0);
  near(L.clim.lapse / L.grav, 0.052, 1e-9, '°C/м на g');
  // снігова межа в помірному кліматі (ділянка 14 °C, біом — середнє): сніг нижче −0,45 одиниць (1,6 °C), одиниця — 32 °C
  const snow = (1.6 - 14) / -0.052;
  assert.ok(snow > 200 && snow < 400, `снігова межа ${snow} м`);
  // у tile: T = T0 − lapse / 64 · висота в рівнях (рівень — 0,5 м, одиниця — 32 °C)
  near(L.clim.lapse / 64 * 2 * 32, L.clim.lapse, 1e-12, 'одиниці');
  for (let n = 300; n < 200000; n += 13) { const V = lawsOf(hashStr('test'), 3, n); if (V.air.vacuum) { assert.equal(V.clim.lapse, 0); return; } }
  assert.fail('вакуум не трапився');
});
