// Зорі з масою, відстанню й потоком; тісні пари; далекі за орбітою планети; припливне захоплення (13.10.2026)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lawsOf } from '../js/universe.js';
import { hashStr } from '../js/rng.js';
import { skyState, bodiesOf, lightsOf, starColor, skyAxes } from '../js/sky.js';

const near = (v, want, eps, msg) => assert.ok(Math.abs(v - want) <= eps, `${msg}: ${v} замість ${want} ± ${eps}`);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const L0 = lawsOf(hashStr('test'), 0, 0), s0 = L0.sky.suns[0];
const skyL = (sky, extra = {}) => ({ ...L0, sky: { ...L0.sky, ...sky }, ...extra });
// небесні координати напряму (рядки cel) і назад
const toCel = (C, v) => [C[0] * v[0] + C[1] * v[1] + C[2] * v[2], C[3] * v[0] + C[4] * v[1] + C[5] * v[2], C[6] * v[0] + C[7] * v[1] + C[8] * v[2]];
const fromCel = (C, c) => [0, 1, 2].map((k) => C[k] * c[0] + C[3 + k] * c[1] + C[6 + k] * c[2]);

test('небо: зорі, далекі сонця й сонце йдуть в один бік — зі сходу на захід', () => {
  const E = skyAxes(L0).e, day = L0.sky.dayMin * 60;
  for (let i = 0; i < 24; i++) {
    const t = i * day / 24, a = skyState(L0, t), b = skyState(L0, t + 20);
    const c = toCel(a.cel, a.suns[0].dir), st0 = fromCel(a.cel, c), st1 = fromCel(b.cel, c);   // зоря там, де зараз сонце
    const ds = sub(b.suns[0].dir, a.suns[0].dir), dz = sub(st1, st0);
    near(ang(st0, a.suns[0].dir), 0, 1e-6, 'зоря на місці сонця');
    assert.ok(dot(ds, dz) > 0.95 * Math.hypot(...ds) * Math.hypot(...dz), `година ${i}: зоря й сонце — у різні боки`);
    near(Math.hypot(...dz) / Math.hypot(...ds), 1, 0.08, 'зоряна доба ≈ сонячна');
    if (Math.abs(a.phase - 0.5) < 0.1) assert.ok(dot(ds, E) < 0, 'опівдні сонце йде на захід');
  }
  // далеке сонце нерухоме відносно зір
  let L = null;
  for (let n = 100; n < 60000 && !L; n += 7) { const V = lawsOf(hashStr('test'), 3, n); if (V.star.extra.some((e) => !e.close)) L = V; }
  const i = bodiesOf(L).suns.findIndex((s) => s.far), a = skyState(L, 100), b = skyState(L, 900);
  const ca = toCel(a.cel, a.suns[i].dir), cb = toCel(b.cel, b.suns[i].dir);
  for (let k = 0; k < 3; k++) near(ca[k], cb[k], 1e-9, 'далеке сонце серед зір');
});

test('яскравість — за законом обернених квадратів, без обрізання; найяскравіше — звичайний день', () => {
  const far = (o) => ({ ...s0, main: false, close: false, a2: L0.star.a, dec: 0.3, off: 0.2, ...o });
  let B = bodiesOf(skyL({ suns: [s0, far({ a2: 2 * L0.star.a })] }));
  near(B.suns[0].b0, 1, 1e-12, 'головна'); near(B.suns[1].b0, 0.25, 1e-12, 'та сама зоря вдвічі далі — учетверо тьмяніша');
  B = bodiesOf(skyL({ suns: [s0, far({ L: 4 * s0.L })] }));
  near(B.suns[1].b0, 1, 1e-12, 'яскравіша далека'); near(B.suns[0].b0, 0.25, 1e-12, 'головна — відносно найяскравішої');
});

test('колір світла — повний колір зорі; кілька сонць — суміш з вагою потоку', () => {
  const vac = { air: { ...L0.air, vacuum: true, pressure: 0, tauA: 0 } }, red = { ...s0, T: 2400 };
  assert.deepEqual(starColor(2400).map(Math.round), [255, 156, 61]);
  const st = skyState(skyL({ suns: [red], moons: [], off: 0.5 }, vac), 0), l = lightsOf(st, 3).dirs[0];
  [255, 156, 61].forEach((v, k) => near(l.col[k] * 255, v, 1, 'світло червоного карлика'));
  // біле яскраве + червоне вчетверо тьмяніше в тому самому місці
  const two = skyState(skyL({ suns: [s0, { ...red, main: false, close: false, a2: L0.star.a, L: s0.L / 4, dec: 0, off: 0 }], moons: [], off: 0.5, year: { ...L0.sky.year, off: 0 } }, vac), 0);
  const w = [1, 0.25], lit = two.suns.map((s) => s.lit);
  for (let k = 0; k < 3; k++) near(two.tint[k], (w[0] * lit[0][k] + w[1] * lit[1][k]) / 1.25 / 255, 1e-9, 'суміш');
  assert.ok(two.tint[2] < lit[0][2] / 255 - 0.05 && two.tint[2] > lit[1][2] / 255, 'червоного — трохи');
});

// тісна пара зі справжніх законів
function pairL() {
  for (let d = 2; d <= 12; d++) for (let n = 100; n < 40000; n += 11) {
    const V = lawsOf(hashStr('test'), d, n);
    if (V.star.extra.length === 1 && V.star.extra[0].close && V.star.extra[0].M < 0.8 * V.star.M && !V.sky.lock) return V;
  }
}

test('тісна пара: важча — головна й ближче до центру мас, період за Кеплером, ближча затемнює дальшу', () => {
  const L = pairL(), B = bodiesOf(L), [m, p] = B.suns, L1 = { ...L, sky: { ...L.sky, suns: [L.sky.suns[0], { ...L.sky.suns[1], tilt: 0 }] } };
  assert.ok(m.M > p.M && m.role === 'main' && p.role === 'pair');
  near(p.per, L.sky.year.min * p.th ** 1.5, 1e-9, 'період пари (хв гри)');
  // видимий період — синодичний: промінь зору повертається з планетою на оберт за рік
  const Ps = 1 / (1 / p.per - 1 / L.sky.year.min) / L.phys.time;   // хв годинника світу (плин часу)
  let eclipsed = 0;
  for (let i = 0; i < 400; i++) {
    const t = i * Ps * 60 / 200, st = skyState(L, t), [a, b] = st.suns;
    near(ang(a.dir, st.bary) / ang(b.dir, st.bary), p.M / m.M, 0.03, 'зміщення від центру мас — обернено до мас');
    const far = a.dist > b.dist ? a : b, nearS = far === a ? b : a;
    if (far.eclipse > 0.05) { eclipsed++; assert.ok(far.bright < far.bright0 && nearS.eclipse === 0, 'затемнює ближча'); }
    // у площині орбіти планети (нахил 0) картина повторюється за видимий період
    const a0 = skyState(L1, t), s2 = skyState(L1, t + Ps * 60);
    near(ang(s2.suns[0].dir, s2.suns[1].dir), ang(a0.suns[0].dir, a0.suns[1].dir), 0.02 * ang(a0.suns[0].dir, a0.suns[1].dir) + 1e-3, 'за видимий період пари — та сама відстань між зорями');
  }
  assert.ok(B.vk >= 1 && ang(...[0, 1].map((k) => skyState(L, Ps * 15).suns[k].dir)) > 0, 'пара видно розходиться');
  assert.ok(eclipsed > 0, 'пара не затемнює одна одну');
});

test('далека зоря — за орбітою планети (межа Хілла), група тягне сильніше; кільця — усередині орбіт місяців', () => {
  let far = 0;
  for (let d = 0; d <= 12; d++) for (let n = -60000; n < 60000; n += 79) {
    const L = lawsOf(hashStr('test'), d, n), S = L.star;
    for (const e of S.extra) if (!e.close) {
      far++;
      assert.ok(e.a2 >= 3 * S.a * Math.cbrt(e.M / S.Mtot) * (1 - 1e-9) && e.a2 > 2 * S.a, `далека біля планети: ${e.a2} / ${S.a}`);
      assert.ok(e.M / (e.a2 * e.a2) < S.Mtot / (S.a * S.a), 'далека тягне сильніше за групу');
    }
    const R = L.sky.rings;
    if (R) for (const m of L.sky.moons) assert.ok(R.r0 + R.w < m.D - m.rr, 'кільця за орбітою місяця');
  }
  assert.ok(far > 500, `далеких ${far}`);
});

test('припливне захоплення: частки, тіло стоїть над обрієм, 3:2 — доба 2 роки, біля старту — немає', () => {
  const k = { sun: 0, res: 0, comp: 0, moon: 0 };
  let comps = 0, gas = 0, gasF = 0, rock = 0, rockF = 0, N = 0, checked = 0;
  for (let d = 0; d <= 9; d += 3) for (let n = -90000; n < 90000; n += 61) {
    const L = lawsOf(hashStr('test'), d, n), h = L.planet.held;
    N++;
    if (h) k[h]++;
    if (L.comp) { comps++; if (L.comp.type === 0) { gas++; gasF += L.comp.face; } else { rock++; rockF += L.comp.face; } }
    if (h === 'res') near(L.sky.dayMin, 2 * L.sky.year.min, 1e-9, '3:2: доба — 2 роки');
    if ((h === 'comp' || h === 'moon') && checked < 60) {
      checked++;
      const a = skyState(L, 50), b = skyState(L, 50 + 0.37 * L.sky.dayMin * 60);
      const i = a.moons.findIndex((m) => m.fix), sa = Math.sin(4 * Math.PI / 180);
      assert.ok(i >= 0 && ang(a.moons[i].dir, b.moons[i].dir) < 1e-6 && a.moons[i].dir[2] > sa, `захоплене тіло рухається чи під обрієм: ${a.moons[i] && a.moons[i].dir[2]}`);
    }
    if (h === 'sun') {
      const Y = L.sky.year.min * 60 / L.phys.time, a = skyState(L, 10), b = skyState(L, 10 + Y), c = skyState(L, 10 + Y / 4);
      for (let j = 0; j < 9; j++) near(a.cel[j], b.cel[j], 1e-6, 'зорі — оберт за рік');
      assert.ok(Math.abs(a.cel[0] - c.cel[0]) + Math.abs(a.cel[1] - c.cel[1]) > 0.1, 'зорі при захопленні сонцем стоять');
    }
  }
  const sh = k.sun / (k.sun + k.res);
  assert.ok(sh > 0.03 && sh < 0.2, `сонце захоплює ${sh} фізично можливих`);
  assert.ok(k.comp / comps > 0.6 && k.comp / comps <= 0.82, `компаньйон захоплює ${k.comp / comps}`);
  assert.ok(gasF / gas < rockF / rock, `гігант повернутий до нас ${gasF / gas}, кам'яний / крижаний ${rockF / rock}`);
  assert.ok(k.moon > 0 && k.moon / N < 0.03, `місяць захоплює в ${k.moon} з ${N}`);
  assert.ok(checked > 20, `захоплених тіл перевірено ${checked}`);
  for (let n = -8; n <= 8; n++) assert.equal(lawsOf(hashStr('test'), 0, n).planet.held, null, `біля старту ${n}`);
});
