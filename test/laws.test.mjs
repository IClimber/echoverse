// Закони фізики світу (п. 4 roadmap, 12.10.2026): нормальний розподіл, еталонні тіла, біля старту, розподіли величин
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lawsOf, zOfLane, SPREAD } from '../js/universe.js';
import { starOf, planetOf, pMin, tEq, airOf, tSurf, fieldOf } from '../js/astro.js';
import { nsqrt, nroot4, nsin, ncos, ncbrt, nlog10, nqnorm, PI } from '../js/num.js';
import { LIB_GOLD, libDigest } from '../js/golden.js';
import { noise2 } from '../js/noise.js';
import { hashStr } from '../js/rng.js';

const near = (v, want, eps, msg) => assert.ok(Math.abs(v - want) <= eps, `${msg}: ${v} замість ${want} ± ${eps}`);
// Закони фізики світу (нормальні): частки рівнів однакові для всіх
const PHYS = ['зоря', 'відстань до зорі', 'альбедо', 'радіус планети', 'густина планети', 'обертання', 'нахил осі', 'широта', 'поле',
  'тиск', 'кисень', 'вуглекислий газ', 'метан', 'серпанок', 'вітер', 'плин часу', 'аномалії', 'кільця', 'компаньйон'];

test('точна арифметика: stdlib — похибка ≤ 1e-15, до біта однакова (LIB_GOLD)', () => {
  const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
  for (const v of [1e-9, 0.003, 0.5, 1, 2, 17, 1234.5, 9e7]) {
    assert.equal(nsqrt(v), Math.sqrt(v), `√${v}`);
    assert.ok(rel(nroot4(v), Math.pow(v, 0.25)) <= 1e-15, `⁴√${v}`);
    assert.ok(rel(ncbrt(v), Math.cbrt(v)) <= 1e-15, `∛${v}`); assert.ok(rel(ncbrt(-v), -Math.cbrt(v)) <= 1e-15, `∛−${v}`);
    assert.ok(rel(nlog10(v), Math.log10(v)) <= 1e-15 || Math.abs(nlog10(v) - Math.log10(v)) <= 1e-16, `lg ${v}`);
  }
  assert.equal(nsqrt(-1), 0); assert.equal(nsqrt(NaN), 0); assert.equal(nlog10(0), -Infinity);
  for (let x = -7; x < 7; x += 0.37) {
    assert.ok(Math.abs(nsin(x) - Math.sin(x)) <= 2e-16 * Math.max(1, Math.abs(x)), `sin ${x}`);
    assert.ok(Math.abs(ncos(x) - Math.cos(x)) <= 2e-16 * Math.max(1, Math.abs(x)), `cos ${x}`);
  }
  // Φ⁻¹: відомі квантилі
  for (const [q, z] of [[0.5, 0], [0.84134474606854293, 1], [0.975, 1.959963984540054], [0.999, 3.090232306167813], [0.9999, 3.719016485455709], [0.025, -1.959963984540054]])
    near(nqnorm(q), z, 1e-12, `Φ⁻¹(${q})`);
  // відбиток бібліотеки на фіксованих аргументах: оновлення js/lib/stdlib, що змінює хоч один біт, — тут (тоді й GEN)
  assert.equal(libDigest(), LIB_GOLD);
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

// Закони неба з одного всесвіту з підмінами (bodiesOf кешує за об'єктом — кожен виклик новий)
const skyL = (sky, extra = {}) => { const L = lawsOf(hashStr('test'), 0, 0); return { ...L, sky: { ...L.sky, ...sky }, ...extra }; };

test('небо: сезони (полудень сонцестояння на 45°), довший літній день, полярні день і ніч, захоплене сонце стоїть', async () => {
  const { skyState } = await import('../js/sky.js');
  const one = (lat, yoff, off = 0.5) => skyL({ lat: lat * PI / 180, off, year: { min: 1e9, off: yoff, obliq: 23 * PI / 180 }, lock: false });
  const el = (L) => Math.asin(skyState(L, 0).suns[0].dir[2]) * 180 / PI;
  near(el(one(45, 0.25)), 68, 1, 'полудень улітку'); near(el(one(45, 0.75)), 22, 1, 'полудень узимку');
  const dayFrac = (lat, yoff) => { let n = 0; for (let i = 0; i < 200; i++) n += el(one(lat, yoff, i / 200)) > 0; return n / 200; };
  assert.ok(dayFrac(45, 0.25) > 0.6 && dayFrac(45, 0.75) < 0.4, `день улітку ${dayFrac(45, 0.25)}, узимку ${dayFrac(45, 0.75)}`);
  assert.equal(dayFrac(80, 0.25), 1); assert.equal(dayFrac(80, 0.75), 0);
  // захоплене сонце стоїть (нахилу осі при захопленні немає), а рік іде: зорі повертаються раз на рік, місяці ходять
  const L0 = lawsOf(hashStr('test'), 0, 0), Lk = skyL({ lock: true, off: 0.6, year: { ...L0.sky.year, obliq: 0 } });
  const k0 = skyState(Lk, 0), k1 = skyState(Lk, 5000);
  assert.deepEqual(k0.suns[0].dir, k1.suns[0].dir);
  assert.notDeepEqual(k0.cel, k1.cel); assert.notDeepEqual(k0.moons[0].dir, k1.moons[0].dir);
});

test('небо: затемнення — частка диска, повне — сонце не світить; місяць у тіні планети темніє', async () => {
  const { skyState, covered } = await import('../js/sky.js');
  near(covered(0.05, 0.05, 0), 1, 1e-9, 'повне'); near(covered(0.05, 5, 5), 0.5, 0.01, 'половина'); assert.equal(covered(0.05, 0.05, 0.11), 0);
  const L0 = lawsOf(hashStr('test'), 0, 0), m = L0.sky.moons[0];
  const big = { ...m, Rkm: m.Rkm * 3, dec: 0, off: 0, period: 30 };
  const Le = skyL({ moons: [big], off: 0.5, year: { ...L0.sky.year, off: 0 } });
  const s = skyState(Le, 0);
  assert.ok(s.suns[0].eclipse === 1 && s.suns[0].bright === 0 && s.suns[0].bright0 > 0, `затемнення ${s.suns[0].eclipse}`);
  const Ll = skyL({ moons: [{ ...big, off: 0.5 }], off: 0.5, year: { ...L0.sky.year, off: 0 } });
  assert.ok(skyState(Ll, 0).moons[0].eclipse > 0.9, 'місячне затемнення в повню біля вузла');
});

test('світло кількох сонць: сума (головне — звичайний день, разом — світліше, небо — як з одним); закрите не світить, тінь — від наступного; без світил — нічний рівень без тіней', async () => {
  const { skyState, lightsOf, sunDay } = await import('../js/sky.js');
  const lit = (st) => { const o = lightsOf(st, 3); return o.amb + o.dirs.reduce((s, l) => s + l.k * Math.max(0, l.dir[2]), 0); };
  const L0 = lawsOf(hashStr('test'), 0, 0), s0 = L0.sky.suns[0], night = L0.sky.night;
  // одне сонце: рівень — як раніше (нічний + частка дня від найяскравішого)
  for (let i = 0; i < 24; i++) {
    const st = skyState(skyL({ moons: [] }), i * L0.sky.dayMin * 60 / 24), s = st.suns[0];
    near(st.I, night + (1 - night) * s.bright * Math.max(0, Math.min(1, ((t) => t * t * (3 - 2 * t))(Math.max(0, Math.min(1, (s.dir[2] + 0.1) / 0.32))))), 1e-9, `одне сонце, година ${i}`);
  }
  // два однакові сонця в одному місці (далеке на тій самій відстані, без зсуву): світло — сума (лінійно), небо — як з одним
  const same = (o) => ({ ...s0, main: false, close: false, a2: L0.star.a, dec: 0, off: 0, ...o });
  const a = skyState(skyL({ moons: [], off: 0.5, year: { ...L0.sky.year, off: 0 } }), 0), b = skyState(skyL({ moons: [], off: 0.5, year: { ...L0.sky.year, off: 0 }, suns: [s0, same()] }), 0);
  near(a.I, night + (1 - night) * sunDay(a.suns[0]) ** (1 / 2.2), 1e-9, 'одне в полудень');
  near(b.I, night + (1 - night) * (2 * sunDay(a.suns[0])) ** (1 / 2.2), 1e-9, 'два — сума');
  assert.ok(b.I > a.I * 1.2 && lit(b) > lit(a) * 1.5, `два сонця світліші: I ${a.I} → ${b.I}, світло ${lit(a)} → ${lit(b)}`);
  for (let k = 0; k < 3; k++) { near(b.zenith[k], a.zenith[k], 1e-6, 'зеніт'); near(b.horizon[k], a.horizon[k], 1e-6, 'обрій'); }
  assert.equal(b.day, a.day);
  assert.equal(lightsOf(b, 3).dirs.length, 2);
  // головне повністю закрите місяцем — не світить; тінь (слот 0) — від другого сонця; світло — лише від нього
  const m = L0.sky.moons[0], big = { ...m, Rkm: m.Rkm * 3, dec: 0, off: 0, period: 30 };
  const half = same({ L: s0.L * 0.5, off: 0.06 });
  const e = skyState(skyL({ moons: [big], off: 0.5, year: { ...L0.sky.year, off: 0 }, suns: [s0, half] }), 0);
  assert.equal(e.suns[0].eclipse, 1); assert.equal(e.suns[0].bright, 0); assert.equal(e.suns[1].eclipse, 0);
  near(e.I, night + (1 - night) * sunDay(e.suns[1]) ** (1 / 2.2), 1e-9, 'світло — від незакритого');
  const le = lightsOf(e, 3);
  assert.ok(le.dirs[0].sun && le.dirs[0].dir === e.suns[1].dir, 'тінь — від другого сонця');
  assert.ok(le.all.every((l) => l.dir !== e.suns[0].dir), 'закрите сонце не світить');
  assert.equal(e.main, e.suns[1]);
  // без світил (північ, без місяців): напрямлених немає (тіні не рахуються), розсіяне — нічний рівень
  const n0 = skyState(skyL({ moons: [], off: 0 }), 0), ln = lightsOf(n0, 3);
  assert.ok(n0.suns[0].dir[2] < -0.3); assert.equal(ln.dirs.length, 0);
  near(n0.I, night, 1e-9, 'нічний рівень'); near(ln.amb, night ** 2.2, 1e-9, 'розсіяне — нічний рівень');
});

test('компаньйон: видимий радіус з припливної сили, не ближче дотику й межі Роша, світить уночі, займає слот світла', async () => {
  const { bodiesOf, lightSlots } = await import('../js/sky.js');
  let n = 0;
  for (let d = 0; d <= 12; d += 3) for (let k = 100; k < 60000 && n < 400; k += 41) {
    const L = lawsOf(hashStr('test'), d, k), C = L.comp;
    if (!C) continue;
    n++;
    const B = bodiesOf(L), M = B.moons[B.moons.length - 1];
    near(2 * C.rhoR * C.sa ** 3, C.f, 1e-9, 'f = 2·(ρк/ρп)·sin³α'); near(M.size, Math.asin(C.sa), 1e-12, 'α'); assert.equal(M.comp, C.type + 1);
    const roche = C.Rr >= 1 ? 1.26 * C.Rr * Math.cbrt(C.rhoR) : 1.26 * Math.cbrt(1 / C.rhoR);
    assert.ok(C.D >= 1.05 * (1 + C.Rr) - 1e-9 && C.D >= roche - 1e-9 && C.sa <= 0.866, `компаньйон впритул: D ${C.D}, Rr ${C.Rr}, Роша ${roche}`);
    if (L.sky.rings) assert.ok(L.sky.rings.r0 + L.sky.rings.w < C.D - C.Rr, 'кільця всередині орбіти компаньйона');
    assert.equal(lightSlots(L), Math.min(3, B.suns.length + B.moons.length));
  }
  assert.ok(n > 300, `компаньйонів ${n}`);
});

test('оптика: Земля — блакитне небо й помаранчевий захід; без повітря — чорне; густе — біліше; червона зоря — тепліше світло', async () => {
  const { skyOptics } = await import('../js/optics.js');
  const { starColor } = await import('../js/sky.js');
  const air = (P, kind = 0, ta = 0.12) => ({ air: { pressure: P, comp: { CO2: 0.0004 }, tauA: ta, hazeKind: kind, vacuum: P < 0.002 }, grav: 1 });
  const E = skyOptics(air(1), starColor(5772), PI / 3), Es = skyOptics(air(1), starColor(5772), 2 * PI / 180);
  assert.deepEqual(E.zen.map(Math.round), [70, 130, 220]);
  assert.ok(Es.glow[0] > Es.glow[1] * 1.4 && Es.glow[1] > Es.glow[2] * 2, `захід ${Es.glow}`);
  assert.ok(Math.max(...skyOptics(air(0), starColor(5772), PI / 3).zen) < 1, 'вакуум');
  const T = skyOptics(air(5, 0, 0.2), starColor(5772), PI / 3), sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
  assert.ok(sat(T.zen) < sat(E.zen), 'густе — менш насичене');
  const R = skyOptics(air(1), starColor(3000), PI / 3);
  assert.ok(R.sun[2] / R.sun[0] < E.sun[2] / E.sun[0] * 0.6, 'червона зоря');
  const M = skyOptics(air(0.006, 3, 0.5), starColor(5772), 2 * PI / 180);
  assert.ok(M.glow[2] > M.glow[0], 'пиловий захід — блакитний');
});

test('приплив компаньйона: у зеніті −f, на обрії +f/2, на 45° убік 0,75·f', async () => {
  const { tideVec } = await import('../js/worldphys.js');
  const f = 0.05, z = tideVec(f, [0, 0, 1]), h = tideVec(f, [1, 0, 0]), c = Math.SQRT1_2, d = tideVec(f, [c, 0, c]);
  near(z[2], f, 1e-12, 'зеніт: угору (легше)'); near(h[2], -f / 2, 1e-12, 'обрій: униз (важче)');
  near(d[0], 0.75 * f, 1e-12, '45°: убік'); near(d[2], 0.25 * f, 1e-12, '45°: угору');
});

test('зворотна гравітація: тіло піднімається й зупиняється на висоті рівноваги; гравець там ширяє', async () => {
  const { physAt3, revEq, revK } = await import('../js/worldphys.js');
  const { gravityAt } = await import('../js/universe.js');
  const { makeBody, stepBody, configureBodies } = await import('../js/engine/physics/bodies.js');
  const { step, GRAVITY, PLAYER_MASS, PLAYER_AREA } = await import('../js/player.js');
  const { solidB, B_STONE, B_AIR } = await import('../js/gen/chunk.js');
  const { LEVEL } = await import('../js/universe.js');
  configureBodies({ level: LEVEL, solid: solidB, gravity: GRAVITY, refMass: PLAYER_MASS, refArea: PLAYER_AREA });
  // всесвіт із зворотною гравітацією й точка в плямі з k₀ < 0
  let L = null, pt = null;
  for (let d = 12; d >= 6 && !pt; d--) for (let n = 0; n < 60000 && !pt; n += 3) {
    const V = lawsOf(hashStr('test'), d, n);
    if (!V.anom.rev || V.anom.rev.k0 > -0.3) continue;
    for (let y = 0; y < 3000 && !pt; y += 23) for (let x = 0; x < 3000 && !pt; x += 23) { const a = gravityAt(V, x, y); if (a.rev && a.k < -0.3) { L = V; pt = [x + 0.5, y + 0.5]; } }
  }
  assert.ok(pt, 'зворотна пляма не трапилась');
  const eq = revEq(L, pt[0], pt[1]), g0 = () => 0;
  assert.ok(eq > L.anom.rev.Ha && Math.abs(revK(L, gravityAt(L, pt[0], pt[1]).k, eq)) < 1e-6, `рівновага ${eq}`);
  const P = { block: (x, y, k) => k < 0 ? B_STONE : B_AIR };
  const b = makeBody({ x: pt[0], y: pt[1], z: 0.3, hx: 0.3, hy: 0.3, hz: 0.3, mass: 30 });
  for (let i = 0; i < 120 * 60; i++) {
    const ph = physAt3(L, b.x, b.y, b.z - b.hz, 0, g0);
    stepBody(b, 1 / 120, P, { g: ph.g, g0: ph.g0, vT: ph.vT0, tilt: null, rev: ph.rev, bounce: 0, friction: 1 });
  }
  assert.ok(Math.abs(b.z - b.hz - eq) < 0.5, `тіло на ${b.z - b.hz}, рівновага ${eq}`);
  // гравець: з ґрунту піднімається й ширяє біля рівноваги
  const me = { x: pt[0], y: pt[1], z: 0, vz: 0, ground: true }, Pp = { liquid: { swim: true, density: 1, visc: 1 }, obj: () => null, block: P.block };
  for (let i = 0; i < 120 * 40; i++) step(me, 0, 0, false, 1 / 120, Pp, physAt3(L, me.x, me.y, me.z, 0, g0));
  assert.ok(me.hover && Math.abs(me.z - eq) < 1.5, `гравець на ${me.z}, рівновага ${eq}`);
});

test('температура в точці: доба, сезон, висота; повітря на висоті; сніг за температурою', async () => {
  const { tempAt, airAt, snowy } = await import('../js/climate.js');
  const { SEA } = await import('../js/universe.js');
  const L = lawsOf(hashStr('test'), 0, 0), z0 = SEA * 0.5, day = L.sky.dayMin * 60 / L.phys.time;
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < 48; i++) { const T = tempAt(L, 10, 10, z0, i * day / 48); lo = Math.min(lo, T); hi = Math.max(hi, T); }
  near((hi - lo) / 2, L.clim.Ad, 0.6, 'добова амплітуда'); assert.ok(L.clim.Ad > 4 && L.clim.Ad < 9, `Ad ${L.clim.Ad}`);
  near(tempAt(L, 10, 10, z0, 0) - tempAt(L, 10, 10, z0 + 1000, 0), 52 * L.grav, 0.5, '−52 °C/км × g');
  assert.ok(L.clim.As > 3 && L.clim.As < 12, `сезонна амплітуда ${L.clim.As}`);
  const A = airAt(L, z0 + L.air.H);
  near(A.P, L.air.pressure / Math.E, 1e-9, 'тиск на висоті H');
  assert.equal(snowy(-1, false), true); assert.equal(snowy(1, true), true); assert.equal(snowy(1, false), false); assert.equal(snowy(2, true), false);
  for (let n = 300; n < 300000; n += 13) { const V = lawsOf(hashStr('test'), 3, n); if (V.air.vacuum && !V.sky.lock) { assert.ok(V.clim.Ad > 60, `без повітря ±${V.clim.Ad}`); return; } }
  assert.fail('вакуум не трапився');
});

test('вітер: без повітря немає; межа падіння при 1 g і 1 атм ≈ 35 м/с; у розрідженому штовхає слабше; «не перестарайся»', async () => {
  const { physOf } = await import('../js/universe.js');
  const { weatherAt, windHeightK } = await import('../js/weather.js');
  const L = lawsOf(hashStr('test'), 0, 0), E = { ...L, grav: 1, air: { ...L.air, pressure: 1 } };
  near(physOf(E, 1.225).vT, 35, 1, 'межа падіння');
  near(physOf(L).vT, 35, 1.5, 'межа падіння біля старту (густина зі складу й температури)');
  const k = (P) => 1 / physOf(E, 1.225 * P).vT ** 2;   // опір ∝ (v / vT)² ∝ густина
  near(k(1) / k(0.1), 10, 0.01, 'у 10 разів слабше при 0,1 атм');
  for (let n = 300; n < 300000; n += 13) { const V = lawsOf(hashStr('test'), 3, n); if (V.air.vacuum) { const W = weatherAt(V, 1234, 5, 5); assert.ok(W.windK === 0 && W.precip === 0 && W.clouds === 0); break; } }
  assert.ok(windHeightK(80, 20) > windHeightK(20, 20) && windHeightK(20, 20) > windHeightK(0, 20), 'вершина — сильніше, долина — слабше');
  // частка часу, коли на рівнині вітер зносить (вище межі падіння × √тертя): медіана 0, p95 < 2 %, у звичайних — 0
  const F = [];
  for (let i = 0; i < 400; i++) {
    const V = lawsOf(hashStr('вітер'), 0, 200 + i * 37), vT = physOf(V).vT * Math.sqrt(V.phys.friction);
    let b = 0, N = 0;
    for (let m = 0; m < 100; m++) for (let p = 0; p < 5; p++) { N++; b += weatherAt(V, m * 997.3, p * 3001, p * 1709).windK > vT; }
    if (V.strange.cls === 0) assert.equal(b, 0, `звичайний всесвіт ${200 + i * 37}`);
    F.push(b / N);
  }
  F.sort((a, b) => a - b);
  assert.ok(F[200] === 0 && F[380] < 0.02, `медіана ${F[200]}, p95 ${F[380]}`);
});

test('погода в просторі: стан триває хвилини, сусідні точки — та сама погода, поле пливе за вітром', async () => {
  const { weatherAt, cloudsAt, prevailing } = await import('../js/weather.js');
  // «та сама за 100 м» — у середньому за трьома всесвітами > 0,9, у кожному > 0,85 (межа туману й хмарності за 100 м — частка
  // залежить від всесвіту: 13.10.2026, генератор v16, у всесвіті 300 вага грози змінилась у 4-му знаку — 0,917 → 0,895)
  let sameAll = 0;
  for (const n of [0, 300, -777]) {
    const L = lawsOf(hashStr('1hsb1wu'), 0, n);
    let prev = null, last = -1, t0 = 0, pa = null, pb = null, same = 0, N = 0;
    const durs = [];
    for (let t = 0; t < 86400; t += 2) { const W = weatherAt(L, t, 100, 100, prev); prev = W; if (W.kind !== last) { if (last >= 0) durs.push(t - t0); t0 = t; last = W.kind; } }
    for (let t = 0; t < 86400; t += 30) { N++; pa = weatherAt(L, t, 100, 100, pa); pb = weatherAt(L, t, 200, 100, pb); same += pa.kind === pb.kind; }
    durs.sort((a, b) => a - b);
    assert.ok(durs[durs.length >> 1] >= 240 && durs[0] >= 60 && same / N > 0.85, `${n}: медіана ${durs[durs.length >> 1]} с, найкоротший ${durs[0]} с, та сама за 100 м ${same / N}`);
    sameAll += same / N / 3;
  }
  assert.ok(sameAll > 0.9, `та сама за 100 м у середньому ${sameAll}`);
  // за вітром: хмарність у точці, зсунутій на u·Δt, ближча до попередньої, ніж на місці
  const L = lawsOf(hashStr('1hsb1wu'), 0, 300), Pw = prevailing(L), u = 0.5 * L.air.wind, dt = 600;
  let dMove = 0, dStay = 0;
  for (let i = 0; i < 300; i++) {
    const x = i * 211, y = i * 97, c0 = cloudsAt(L, 1000, x, y);
    dMove += Math.abs(cloudsAt(L, 1000 + dt, x + Pw.dir[0] * u * dt, y + Pw.dir[1] * u * dt) - c0);
    dStay += Math.abs(cloudsAt(L, 1000 + dt, x, y) - c0);
  }
  assert.ok(dMove < dStay, `за вітром ${dMove}, на місці ${dStay}`);
});

test('блискавки — у грозу й рідко в пиловій бурі над пустелею, у найвищу точку околу; метеори — лише з повітрям', async () => {
  const { weatherAt, lightningNear, meteorsAt } = await import('../js/weather.js');
  const { tile, T_DESERT, T_DRY } = await import('../js/gen/chunk.js');
  let L = null;
  for (let n = 100; n < 5000 && !L; n++) { const V = lawsOf(hashStr('1hsb1wu'), 0, n); if (V.air.w.storm > 0.3) L = V; }
  let hits = 0;
  for (let t = 0; t < 7200 && hits < 20; t += 0.1) {
    const B = lightningNear(L, t, 0, 0);
    if (!B || Math.abs(t - B.t0) > 0.05) continue;
    hits++;
    const W = weatherAt(L, Math.floor(B.t0 * 2) / 2, B.cx, B.cy);
    const tt = tile(L, Math.floor(B.cx), Math.floor(B.cy)).t;
    assert.ok(W.precip > 0.7 && W.dim > 0.3 || W.dust > 0.6 && (tt === T_DESERT || tt === T_DRY), `не гроза й не пилова буря: опади ${W.precip}, темніше ${W.dim}, пил ${W.dust}`);
    const o = {}; tile(L, Math.floor(B.x), Math.floor(B.y), o);
    assert.ok(Math.abs((o.h + 1) * 0.5 - B.z) < 1e-9, 'ціль — верх клітинки');
  }
  assert.ok(hits > 0, 'блискавок немає');
  // суха блискавка в пиловій бурі (всесвіт з частими бурями, пустеля; розряд о 65,3 с — пошуком, генератор v15)
  const D = lawsOf(hashStr('1hsb1wu'), 0, 757), Bd = lightningNear(D, 65.3, 0, 0, 1500);
  assert.ok(Bd, 'сухої блискавки немає');
  const Wd = weatherAt(D, Math.floor(Bd.t0 * 2) / 2, Bd.cx, Bd.cy);
  assert.ok(Wd.dust > 0.6 && Wd.precip < 0.05, `не пилова буря: пил ${Wd.dust}, опади ${Wd.precip}`);
  for (let n = 300; n < 300000; n += 13) { const V = lawsOf(hashStr('test'), 3, n); if (V.air.vacuum) { for (let t = 0; t < 3600; t += 1) assert.equal(meteorsAt(V, t, 1).length, 0); break; } }
  const E = lawsOf(hashStr('test'), 0, 0);
  let m = 0; for (let t = 0; t < 3600; t += 0.35) m += meteorsAt(E, t, 1).length > 0;
  assert.ok(m > 0, 'метеорів немає');
});

test('часові аномалії: повільні й швидкі плями не стикаються; тіло в повільній падає в 1/k разів довше', async () => {
  const { timeK } = await import('../js/worldphys.js');
  const { makeBody, stepBody, configureBodies } = await import('../js/engine/physics/bodies.js');
  const { GRAVITY, PLAYER_MASS, PLAYER_AREA } = await import('../js/player.js');
  const { solidB } = await import('../js/gen/chunk.js');
  configureBodies({ level: 0.5, solid: solidB, gravity: GRAVITY, refMass: PLAYER_MASS, refArea: PLAYER_AREA });
  let L = null;
  for (let d = 6; d <= 12 && !L; d++) for (let n = 100; n < 40000 && !L; n += 7) { const V = lawsOf(hashStr('test'), d, n); if (V.tanom) L = V; }
  assert.ok(L, 'всесвіту з часовими аномаліями немає');
  assert.ok(lawsOf(hashStr('test'), 0, 0).tanom === null || !lawsOf(hashStr('test'), 0, 0).tanom, 'біля старту — немає');
  let slow = null, fast = 0, both = 0, plain = 0;
  for (let y = 0; y < 6000; y += 7) for (let x = 0; x < 6000; x += 7) {
    const T = timeK(L, x, y);
    if (T.ws > 0 && T.wf > 0) both++;
    if (T.ws > 0.999 && !slow) slow = [x, y, T.k];
    fast += T.wf > 0.999; plain += T.k === 1;
    assert.ok(T.k >= Math.min(L.tanom.ks, 1) - 1e-9 && T.k <= L.tanom.kf + 1e-9);
  }
  assert.equal(both, 0, 'повільна й швидка стикаються');
  assert.ok(slow && fast > 0 && plain > 0, `повільна ${slow}, швидка ${fast}, звичайних ${plain}`);
  near(slow[2], L.tanom.ks, 0.01, 'k у ядрі повільної плями');
  // падіння з 20 м: у плямі (крок × k) — у 1/k разів довше (тіло живе у своєму часі)
  const FLOOR = { block: (x, y, k) => k < 0 ? 8 : 0 }, env = { g: 1, vT: 1e3, bounce: 0, friction: 1, wind: [0, 0] };
  const fall = (k) => { const b = makeBody({ x: 0, y: 0, z: 20, hx: 0.25, hy: 0.25, hz: 0.25 }); b.sleep = false; let t = 0; while (b.z - b.hz > 0.05 && b.vz <= 0 && t < 60) { stepBody(b, k / 120, FLOOR, env); t += 1 / 120; } return t; };
  near(fall(slow[2]) / fall(1), 1 / slow[2], 0.05 / slow[2], 'падіння в повільній плямі');
});
