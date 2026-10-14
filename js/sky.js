// sky.js — небо й час доби всесвіту (лише вигляд, тож тригонометрія дозволена). Без DOM.
// Годинник світу — секунди гри (clock, спільний для всіх всесвітів); фаза доби всесвіту — clock / тривалість доби
// + зсув (0 — північ, 0,5 — полудень). Сонця й місяці ходять небом, як на планеті на широті lat: шлях — коло навколо
// полюса світу; склонення dec зсуває шлях (подвійні зорі — поруч, зі зсувом фази). Місяць відстає від сонця на
// оберт за свій період — звідси фази. Зорі — нерухомі відносно полюса, обертаються з небом.
// Світові осі: x, y — горизонталь, z — угору; схід — за азимутом всесвіту.

import { skyOptics } from './optics.js';
import { hash3, unit } from './rng.js';
import { hsl } from './universe.js';
import { clamp01, smoothstep } from './num.js';

const TAU = Math.PI * 2;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Місцевий час всесвіту (с): годинник світу × плин часу (закон «інша фізика»)
export const localTime = (L, clock) => clock * (L.phys ? L.phys.time : 1);
// Фаза доби (0…1) всесвіту L у мить clock (с)
export function dayPhase(L, clock) {
  const S = L.sky;
  if (S.lock) return S.off;
  const p = localTime(L, clock) / (S.dayMin * 60) + S.off;
  return p - Math.floor(p);
}
// Місцевий час «гг:хх»
export function clockStr(phase) {
  const m = Math.floor(phase * 24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Колір чорного тіла (sRGB, Mitchell Charity) за температурою зорі, K
const BB = [[2000, 255, 137, 18], [2500, 255, 161, 72], [3000, 255, 180, 107], [3500, 255, 196, 137], [4000, 255, 209, 163],
  [5000, 255, 228, 206], [5772, 255, 240, 229], [6500, 255, 249, 253], [8000, 227, 233, 255], [10000, 204, 219, 255], [20000, 170, 191, 255]];
export function starColor(T) {
  if (T <= BB[0][0]) return BB[0].slice(1);
  for (let i = 1; i < BB.length; i++) if (T <= BB[i][0]) {
    const a = BB[i - 1], b = BB[i], t = (T - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  }
  return BB[BB.length - 1].slice(1);
}
// Світила неба з фізики (п. 4 roadmap; 13.10.2026 — зорі з масою, відстанню й потоком): кожне сонце — роль (main —
// головна, найважча з тісної групи; pair — тісна, кружляє з головною навколо центру мас; far — далека), маса, радіус,
// світність (сонячні), температура, колір чорного тіла, середня відстань a (а. о.), потік F = L/a², відносна яскравість
// b0 = F / F_ref (F_ref — найбільший потік: найяскравіше сонце в зеніті — звичайний день; без обрізання), видимий радіус ×10
// до справжнього (0,02…0,15 рад). Пара: період — за Кеплером, P = рік · θ^1,5 · √(M_групи / (M₀ + M_i)) (хв гри);
// видимий розліт — не менше 1,5 суми видимих радіусів (диски збільшено ×10), відстані — справжні. Місяці — видимий радіус
// ×10 (0,01…0,15), альбедо; кеш на закони
const bodyCache = new WeakMap();
export function bodiesOf(L) {
  let B = bodyCache.get(L);
  if (B) return B;
  const S = L.sky, st = L.star, Rpl = L.planet.R * 6371, Y = S.year ? S.year.min : 400;
  const vis = (R, a) => Math.min(0.15, Math.max(0.02, 10 * 0.00465 * R / a));
  const suns = S.suns.map((s, i) => {
    const role = i === 0 ? 'main' : s.close ? 'pair' : 'far', a = role === 'far' ? s.a2 : st.a;
    return {
      role, M: s.M, R: s.R, L: s.L, T: s.T, cls: s.cls, col: starColor(s.T), a, F: s.L / (a * a), size: vis(s.R, a),
      dec: role === 'far' ? s.dec : 0, off: role === 'far' ? s.off : 0, far: role === 'far',
      th: s.th || 0, tilt: s.tilt || 0, node: s.node || 0, ph: s.ph || 0,
      per: role === 'pair' ? Y * s.th ** 1.5 * Math.sqrt(st.Mtot / (S.suns[0].M + s.M)) : 0,
    };
  });
  const Fref = Math.max(...suns.map((s) => s.F));
  let vk = 1;
  for (const s of suns) {
    s.b0 = s.F / Fref; s.bright = Math.min(1, s.b0) ** (1 / 2.2);
    if (s.role === 'pair') vk = Math.max(vk, 1.5 * (suns[0].size + s.size) / s.th);
  }
  const moons = S.moons.map((m) => ({ ...m, size: Math.min(0.15, Math.max(0.01, 10 * m.Rkm / (m.D * Rpl))) }));
  // компаньйон (М7): кутовий радіус α і відстань D (радіусів планети) — із законів (universe.js: не ближче дотику й межі
  // Роша); тип 1 — газовий гігант, 2 — кам'яний, 3 — крижаний
  const C = L.comp;
  if (C) {
    const col = [hsl(0.06 + 0.08 * C.hue, 0.45, 0.68), hsl(C.hue, 0.25, 0.5), hsl(0.55 + 0.05 * C.hue, 0.2, 0.86)][C.type];
    const col2 = [hsl(0.03 + 0.1 * C.hue2, 0.5, 0.45), hsl(C.hue2, 0.35, 0.32), hsl(0.6, 0.15, 0.7)][C.type];
    moons.push({ D: C.D, size: Math.asin(C.sa), period: C.period, dec: C.inc, off: C.off, albedo: C.albedo, col, col2, comp: C.type + 1, fix: C.fix, face: C.face, spinH: C.spinH });
  }
  B = { suns, moons, Fref, vk };
  bodyCache.set(L, B);
  return B;
}
// Фаза року (0…1): сезон і зоряний час (при захопленні сонцем рік іде далі: зорі повертаються раз на рік)
export function yearPhase(L, clock) {
  const Y = L.sky.year;
  if (!Y) return 0;
  const p = localTime(L, clock) / (Y.min * 60) + Y.off;
  return p - Math.floor(p);
}

// Осі неба: схід e, північ nn, полюс світу pole (нахилений від півночі на широту)
function axes(L) {
  const az = L.sky.az + 0.6, lat = L.sky.lat;
  const e = [Math.cos(az), Math.sin(az), 0], nn = [-Math.sin(az), Math.cos(az), 0];
  return { e, nn, lat, pole: [nn[0] * Math.cos(lat), nn[1] * Math.cos(lat), Math.sin(lat)] };
}
export const skyAxes = (L) => axes(L);
// Напрям на світило з годинним кутом h (0 — найвище) і склоненням dec
function bodyDir(A, h, dec) {
  const ce = -Math.cos(dec) * Math.sin(h), cn = Math.sin(dec) * Math.cos(A.lat) - Math.cos(dec) * Math.cos(h) * Math.sin(A.lat);
  const cu = Math.sin(dec) * Math.sin(A.lat) + Math.cos(dec) * Math.cos(h) * Math.cos(A.lat);
  return [A.e[0] * ce + A.nn[0] * cn, A.e[1] * ce + A.nn[1] * cn, cu];
}

// Частка диска радіуса r1, закрита диском радіуса r2 на кутовій відстані d (площа перетину кругів)
export function covered(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r2 - r1)) return r2 >= r1 ? 1 : (r2 * r2) / (r1 * r1);
  const a = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)), b = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const A = r1 * r1 * a + r2 * r2 * b - 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return Math.min(1, A / (Math.PI * r1 * r1));
}
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

// Буря зорі (п. 4, М5): відрізки по ¼ доби (захоплена — 5 хв), імовірність 0,02 × активність / 0,3 (червоні карлики —
// частіше), сила 0,3…1: швидкий підйом, повільний спад. Та сама мить — та сама буря
let stormOver = null;
export const setStormOverride = (I) => { stormOver = I; };   // ?dev eco.starStorm(I): null — як за законами
export function stormAt(L, clock) {
  if (stormOver !== null) return stormOver;
  const len = L.sky.lock ? 300 : L.sky.dayMin * 15, t = localTime(L, clock) / len, seg = Math.floor(t), u = t - seg;
  const h = hash3(L.seed, seg, 0x5703);
  if (unit(h) >= 0.02 * (L.star ? L.star.act : 0.3) / 0.3) return 0;
  return (0.3 + 0.7 * unit(hash3(L.seed, seg, 0x5704))) * Math.min(1, u / 0.08) * (1 - smoothstep(0.3, 1, u));
}

// Стан неба всесвіту L у мить clock: світила, світло для граней, кольори неба й туману (оптика з фізики, optics.js), зорі,
// затемнення, компаньйон (серед місяців, comp > 0), сяйва за овалом, буря зорі.
// light — напрям (до світила, z > 0), lightK — множник світла (з кольором), amb — частка розсіяного;
// zenith / horizon — небо, fog — колір туману (= обрій), day — 0…1 (ніч … день), dusk — сила заходу,
// stars — яскравість зір, cel — матриця «світ → небесна сфера» (рядки), для зір
export function skyState(L, clock) {
  const S = L.sky, A = axes(L), phase = dayPhase(L, clock), h0 = TAU * (phase - 0.5), Bo = bodiesOf(L);
  // сезон: склонення сонця — нахил осі × синус фази року; зоряний час випереджає сонячний на оберт за рік
  const yp = yearPhase(L, clock), obl = S.year ? S.year.obliq : 0, dec0 = obl * Math.sin(TAU * yp), hs = h0 + TAU * yp;
  const cel = celMatrix(A, hs), tl = localTime(L, clock);
  // Сонця. Головна група (головна й тісні) — центр мас ходить шляхом сонця (сонячний час h0); тісні кружляють навколо
  // нього за Кеплером: орбіта пари з нахилом tilt до площини орбіти планети, з вузлом node — у нерухомій (екліптичній)
  // системі, промінь зору — від планети до центру мас (довгота λ = 2π·фаза року). Зміщення зорі від центру мас — у
  // частках a_планети: проєкція на небо (уздовж екліптики й поперек) і вздовж променя (відстань → потік, хто ближче
  // затуляє). Далекі — нерухомі відносно зір (зоряний час hs)
  const c0 = bodyDir(A, h0, dec0), lam = TAU * yp, dlam = 1e-3;
  const ue = norm(sub(bodyDir(A, h0 - dlam, obl * Math.sin(lam + dlam)), c0)), un = norm(cross(c0, ue));
  const se = [Math.cos(lam), Math.sin(lam), 0], ee = [-Math.sin(lam), Math.cos(lam), 0];
  const B0 = Bo.suns, Mg = B0.reduce((m, s) => m + (s.role === 'far' ? 0 : s.M), 0), rel = [];
  for (const s of B0) {
    if (s.role !== 'pair') { rel.push(null); continue; }
    const W = TAU * s.node, ph = TAU * (s.ph + tl / 60 / s.per), ct = Math.cos(s.tilt), stt = Math.sin(s.tilt);
    const N = [Math.cos(W), Math.sin(W), 0], Mv = [-Math.sin(W) * ct, Math.cos(W) * ct, stt];
    rel.push([0, 1, 2].map((k) => s.th * (Math.cos(ph) * N[k] + Math.sin(ph) * Mv[k])));
  }
  const cm = [0, 0, 0];
  B0.forEach((s, i) => { if (rel[i]) for (let k = 0; k < 3; k++) cm[k] -= s.M / Mg * rel[i][k]; });
  const suns = B0.map((s, i) => {
    let dir, dist;
    if (s.far) { dir = bodyDir(A, hs + TAU * s.off, s.dec); dist = s.a; }
    else {
      const o = rel[i] ? [rel[i][0] + cm[0], rel[i][1] + cm[1], rel[i][2] + cm[2]] : cm;
      const x = dot(o, ee) * Bo.vk, y = o[2] * Bo.vk;
      dir = norm([c0[0] + x * ue[0] + y * un[0], c0[1] + x * ue[1] + y * un[1], c0[2] + x * ue[2] + y * un[2]]);
      dist = s.a * (1 + dot(o, se));
    }
    const b = s.L / (dist * dist) / Bo.Fref;
    return { dir, dist, role: s.role, col: s.col, size: s.size, ang: 0.00465 * s.R / dist, bright: b ** (1 / 2.2), eclipse: 0 };
  });
  // місяці й компаньйон: відстають від сонця на оберт за свій період (фази); склонення — з екліптики (довгота сонця +
  // відставання) і нахилу орбіти (затемнення — лише біля вузлів). Захоплене тіло (fix) стоїть на небесному екваторі на
  // висоті 5°…(90° − широта) над обрієм. Візерунок компаньйона — у системі тіла (fa — вісь, fb — нульовий меридіан):
  // повернутий до нас одним боком (face) чи крутиться з власним періодом відносно зір
  const days = tl / (S.dayMin * 60);
  const moons = Bo.moons.map((m) => {
    let dir;
    if (m.fix) {
      const alt = (5 + (85 - S.lat * 180 / Math.PI) * m.fix.u) * Math.PI / 180;
      dir = bodyDir(A, m.fix.side * Math.acos(Math.min(1, Math.sin(alt) / Math.cos(S.lat))), 0);
    } else {
      const lag = days / m.period + m.off, lf = lag - Math.floor(lag), lon = TAU * (yp + lf);
      dir = bodyDir(A, h0 - TAU * lf, obl * Math.sin(lon) + m.dec * Math.sin(lon + TAU * m.off));
    }
    let fa = A.pole, fb = [cel[0], cel[1], cel[2]];
    if (m.comp && m.face) { fb = [-dir[0], -dir[1], -dir[2]]; fa = norm(sub(A.pole, scale(fb, dot(A.pole, fb)))); }
    else if (m.comp) { const ps = TAU * tl / (m.spinH * 50) + TAU * m.off; fb = [0, 1, 2].map((k) => cel[k] * Math.cos(ps) + cel[3 + k] * Math.sin(ps)); }
    return { dir, col: m.col, col2: m.col2, size: m.size, albedo: m.albedo, D: m.D, comp: m.comp || 0, eclipse: 0, fa, fb, fix: !!m.fix };
  });
  // затемнення: сонце під диском місяця, компаньйона чи ближчого сонця — його світло × (1 − частка; повне — 0, рішення
  // користувача 13.10.2026: закрите світило не світить); bright0 — незатемнене (ним світять місяці)
  const k10 = (m) => (m.comp ? 1 : 10), sh = (m) => k10(m) / m.D;
  for (const s of suns) {
    let f = 0;
    for (const m of moons) f = Math.max(f, covered(s.size, m.size, angle(s.dir, m.dir)));
    for (const o of suns) if (o.dist < s.dist) f = Math.max(f, covered(s.size, o.size, angle(s.dir, o.dir)));
    s.eclipse = f; s.bright0 = s.bright; s.bright *= 1 - f;
  }
  // день: сума світла сонць (лінійно, sunDay; рішення користувача 13.10.2026) — найяскравіше сонце в зеніті дає звичайний
  // день, інші додаються зверху (dayT > 1 — світліше за звичайний день); небо, зорі, сяйва — від day ≤ 1 (небо не
  // світлішає понад денне); main — сонце з найбільшим внеском (з затемненням): від нього колір неба (оптика); сяйво
  // заходу — окремо (нижче), тіла — від усіх сонць
  let C = 0, cMax = -1, main = suns[0];
  const cs = suns.map(sunDay);
  suns.forEach((s, i) => { const c = cs[i]; C += c; if (c > cMax) { cMax = c; main = s; } });
  // тіла (місяці, компаньйон) освітлюють усі сонця (14.10.2026, рішення користувача: «як і землю» — за яскравістю, кольором,
  // відстанню й положенням); тінь планети — від кожного сонця свій циліндр радіусом з планету з півтінню (у шейдері —
  // попіксельно, sky-shader.js). shadow — кутовий радіус тіні на відстані тіла (1 / D; місяці — у видимих розмірах ×10,
  // компаньйон — справжній), sizeK — масштаб розмірів тіла (півтінь — sizeK × справжній кутовий радіус сонця), ecl[k] —
  // частка диска в тіні від сонця k; eclipse і phase (освітлена частка диска з тінню) — середні за потоком сонць
  for (const m of moons) {
    m.shadow = sh(m); m.sizeK = k10(m);
    m.ecl = suns.map((s) => covered(m.size, m.shadow, angle(m.dir, [-s.dir[0], -s.dir[1], -s.dir[2]])));
    let W = 0, Ec = 0, Ph = 0;
    suns.forEach((s, k) => { const B = s.bright0 ** 2.2; W += B; Ec += B * m.ecl[k]; Ph += B * phaseOf(m, s) * (1 - 0.95 * m.ecl[k]); });
    m.eclipse = W > 0 ? Ec / W : 0; m.phase = W > 0 ? Ph / W : 0;
  }
  const dayT = C ** (1 / 2.2), day = Math.min(1, dayT);
  const air = L.air || {}, tauAir = air.vacuum ? 0 : 0.097 * (air.pressure || 0) / Math.max(0.02, L.grav) + (air.tauA || 0);
  // сяйво заходу — від сонця з найбільшим «захід × яскравість (з затемненням)»: тьмяна далека зоря на обрії й закрите
  // сонце заходу не дають, кількох на обрії — від яскравішого; duskDir — його напрям (шейдер неба, uDuskDir)
  let ds = suns[0], dk = -1;
  for (const s of suns) { const k = Math.max(0, 1 - Math.abs(s.dir[2] - 0.02) / 0.22) * Math.min(1, s.bright); if (k > dk) { dk = k; ds = s; } }
  const dusk = dk * (S.lock ? 0.5 : 1) * clamp01(tauAir * 6);
  // оптика: колір прямого світла кожного сонця (зоря × пропускання на його висоті); небо — суміш оптики сонць з вагою їхнього
  // внеску (13.10.2026, вимога користувача: колір кожної зорі — у загальний колір з урахуванням яскравості), сяйво заходу —
  // від сонця заходу (ds)
  const alt = (s, lo) => Math.max(lo, Math.asin(Math.max(-1, Math.min(1, s.dir[2]))));
  for (const s of suns) s.lit = skyOptics(L, s.col, alt(s, 0.02)).sun;
  // світло сонця на тілах — поза нашим повітрям і нашими затемненнями: sp — колір зорі (найяскравіший канал 1) × bright0;
  // shade — світло в тіні планети від нього: заломлене повітрям на краю диска планети — колір його заходу (висота 0,02),
  // пройдений двічі (червоніше); без повітря — 0. Сила — 0,3 при земній товщі повітря (τ ≈ 0,1)
  const shadeK = 0.3 * clamp01(tauAir / 0.1);
  for (const s of suns) {
    s.sp = s.col.map((v) => v / 255 * s.bright0);
    const ls = skyOptics(L, s.col, 0.02).sun.map((v) => (v / 255) ** 2), lm = Math.max(...ls, 1e-6);
    s.shade = ls.map((v) => v / lm * shadeK);
  }
  const O = skyOptics(L, main.col, alt(main, 0.035));
  if (suns.length > 1 && C > 0) {
    const z = [0, 0, 0], h = [0, 0, 0];
    let am = 0;
    for (let i = 0; i < suns.length; i++) {
      const s = suns[i], w = cs[i] / C;
      if (w < 1e-4) continue;
      const Os = s === main ? O : skyOptics(L, s.col, alt(s, 0.035));
      for (let k = 0; k < 3; k++) { z[k] += w * (Os.zen[k] / 255) ** 2.2; h[k] += w * (Os.hor[k] / 255) ** 2.2; }
      am += w * Os.amb;
    }
    O.zen = z.map((v) => 255 * v ** (1 / 2.2)); O.hor = h.map((v) => 255 * v ** (1 / 2.2)); O.amb = am;
  }
  const Og = ds === main ? O : skyOptics(L, ds.col, alt(ds, 0.035));   // сяйво заходу
  // світло: денне — від сонць над обрієм (колір — їхня суміш), нічне — від місяців
  let lx = 0, ly = 0, lz = 0, cr = 0, cg = 0, cb = 0, w = 0;
  for (const s of suns) {
    const k = (s.bright * smoothstep(-0.05, 0.25, s.dir[2])) ** 2.2;   // лінійна вага
    if (k <= 0) continue;
    lx += s.dir[0] * k; ly += s.dir[1] * k; lz += s.dir[2] * k; cr += s.lit[0] * k; cg += s.lit[1] * k; cb += s.lit[2] * k; w += k;
  }
  const sunCol = w ? [cr / w / 255, cg / w / 255, cb / w / 255] : [1, 1, 1];
  for (const m of moons) if (m.dir[2] > 0) { const k = (1 - day) * 0.5 * m.size / 0.08; lx += m.dir[0] * k; ly += m.dir[1] * k; lz += m.dir[2] * k; }
  let light = norm([lx, ly, Math.max(lz, 0.25 * Math.hypot(lx, ly) + 0.05)]);
  if (light[2] < 0.25) light = norm([light[0], light[1], 0.25]);
  // ніч: з повітрям — світло ночі законів (частка денного, ночі безпечні) і колір нічного неба; справжнє відбите світло тіл
  // (moonLight, лінійне, від усіх сонць) — без повітря завжди (14.10.2026, рішення користувача: як у реальності — небо
  // чорне, світять лише тіла; без них — темрява до мінімуму MIN_LIGHT), з повітрям — після заходу сонць (сутінки tw, як
  // їхнє пряме світло в lightsOf: поки сонце видно, місяць не світить) поверх рівня ночі (великий компаньйон у повні —
  // кілька відсотків денного). Між — плавно за товщею повітря (airN: τ 0 … 0,05; Земля — 1)
  const airN = clamp01(tauAir / 0.05), tw = twilightOf(suns), kB = 1 - airN * (1 - tw);
  let Bm = 0;
  for (const m of moons) { m.light = moonLight(m, suns); Bm += m.light; }
  const nl = S.night * airN, I = ((nl + (1 - nl) * dayT) ** 2.2 + kB * Bm) ** (1 / 2.2);
  const tint = mix(NIGHT_TINT, sunCol, day);   // повний колір зорі (13.10.2026, рішення користувача; було 60 % + 40 % білого)
  // небо: удень — оптика, уночі — колір ночі законів (× airN); захід — сяйво біля сонця
  const nZ = S.nightCol.map((v) => v * airN), nH = [(S.nightCol[0] * 1.7 + 10) * airN, (S.nightCol[1] * 1.7 + 10) * airN, (S.nightCol[2] * 1.6 + 12) * airN];
  const horizon = mix(mix(nH, O.hor, day), Og.glow, dusk * 0.6), zenith = mix(mix(nZ, O.zen, day), Og.glow, dusk * 0.15);
  // полярне сяйво (М5): овал на магнітній широті 67° (буря — до 20° ближче до екватора); у шейдері — завіси в шарі
  // 100–260 км над планетою (sky-shader.js), тож видно до ~2000 км від овалу — у бік полюса низько над обрієм, в овалі —
  // над головою; колір — від складу повітря (L.mag.hue). pole — горизонтальний напрям на магнітний полюс, dist — відстань
  // до середини овалу вздовж нього, км (від'ємна — овал з боку екватора), R — радіус планети, км
  const M = L.mag || { k: 0, tilt: 0, hue: 0.35, lon: 0 }, I0 = stormAt(L, clock), lonA = (M.lon || 0) * Math.PI;
  const phiM = S.lat - M.tilt * Math.cos(lonA), dl = (67 - 20 * I0) - phiM * 180 / Math.PI, rot = M.tilt * Math.sin(lonA);
  const ct = Math.cos(rot), stl = Math.sin(rot), sg = dl < 0 ? -1 : 1, Rkm = L.phys ? L.phys.planetR : 6371;
  const pole = [A.nn[0] * ct - A.nn[1] * stl, A.nn[0] * stl + A.nn[1] * ct];
  const aurora = {
    dir: [sg * pole[0], sg * pole[1]], pole, dist: dl * Math.PI / 180 * Rkm, R: Rkm, width: 150 + 150 * I0,
    k: Math.min(1, 1.2 * M.k) * (1 + 2 * I0) * smoothstep(20, 0, Math.abs(dl)) * (1 - day), col: hsl3(M.hue), t: localTime(L, clock),
  };
  // зорі вдень видно, якщо небо темне (розріджене повітря, вакуум, повне затемнення)
  const dark = clamp01(1 - Math.max(...zenith) / 90);
  return {
    phase, day, dusk, duskDir: ds.dir, suns, moons, main, airN, bary: c0, light, lightK: [tint[0] * I, tint[1] * I, tint[2] * I], amb: O.amb, I, tint, lock: !!S.lock, storm: I0,
    aurora, zenith, horizon, fog: horizon, duskCol: Og.glow, stars: Math.max(S.stars * (1 - day) * (1 - dusk * 0.5), 0.9 * dark), starHue: S.starHue, rings: S.rings, pole: A.pole, cel,
  };
}

// Колір сяйва за відтінком (яскравий, насичений)
function hsl3(h) {
  const f = (n) => { const k = (n + h * 12) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

// Світ → небесна сфера (рядки матриці 3×3): вісь z — полюс, рядки — осі неба, повернуті на −h навколо полюса, як світила
// (bodyDir): зорі йдуть зі сходу на захід разом із сонцем (до 13.10.2026 — на +h: зорі заходили на сході, скарга
// користувача «небо йде в одну сторону, а сонце в іншу»)
function celMatrix(A, h) {
  const p = A.pole, x0 = A.e, y0 = [p[1] * x0[2] - p[2] * x0[1], p[2] * x0[0] - p[0] * x0[2], p[0] * x0[1] - p[1] * x0[0]];
  const c = Math.cos(h), s = Math.sin(h);
  const X = [x0[0] * c - y0[0] * s, x0[1] * c - y0[1] * s, x0[2] * c - y0[2] * s], Y = [y0[0] * c + x0[0] * s, y0[1] * c + x0[1] * s, y0[2] * c + x0[2] * s];
  return [...X, ...Y, ...p];
}

export const CLOUD_H = 800;   // висота шару хмар над камерою, м (карта хмар у scene.js, шейдер неба)

// Погода поверх стану неба st (змінює його): серпанок — видимість (колір — оптика); хмари й опади — сіріше й темніше;
// без повітря — без хмар; пил — колір пустелі;
// блискавка — спалах. W — weather.js weatherAt (W.drift — рух хмар). Додає st.cloud, st.flash, st.visK
export function applyWeather(st, L, W) {
  const A = L.air, vac = !!A.vacuum, I = Math.min(1, st.lightK[1]);   // колір неба й серпанку — уже з оптики (skyState)
  const gray = [150 * (0.2 + 0.8 * I), 156 * (0.2 + 0.8 * I), 166 * (0.22 + 0.78 * I)];
  st.horizon = mix(st.horizon, gray, W.dim * 1.2 + (1 - W.vis) * 0.4 * (1 - W.dust));
  st.zenith = mix(st.zenith, gray, W.dim * 1.4);
  if (W.dust > 0) st.horizon = mix(st.horizon, L.pal.desert.map((v) => v * (0.3 + 0.7 * I)), W.dust * 0.75);
  const dimK = 1 - W.dim * 0.55, fl = W.flash * 1.6;
  st.dimK = dimK;
  st.lightK = [st.lightK[0] * dimK + fl, st.lightK[1] * dimK + fl, st.lightK[2] * dimK + fl * 1.1];
  st.fog = st.horizon;
  // хмари пливуть разом з полем погоди (зсув текстури — проти): шар на висоті CLOUD_H, у шейдері uv = 0,9·r/H. Не вітер у
  // точці × годинник — пориви (τ 3–8 с) на тисячах секунд годинника кидали хмари туди й назад на десятки кілометрів
  const cw = 0.9 / CLOUD_H, dr = W.drift || [0, 0];
  st.cloud = vac ? null : { k: W.clouds, off: [13.7 - dr[0] * cw, 5.1 - dr[1] * cw], dark: W.dim * 1.3, col: [255 * (0.18 + 0.82 * I), 255 * (0.18 + 0.82 * I), 255 * (0.2 + 0.8 * I)] };
  st.flash = W.flash;
  if (st.aurora) st.aurora.k *= Math.min(1, A.pressure * 2) * (1 - W.clouds * 0.8);   // без повітря — без сяйв, хмари ховають
  st.visK = vac ? 1.15 : W.vis * (1 - 0.45 * A.haze);
  return st;
}

// Світла для рушія (лінійні, як у PlayCanvas). Числа законів (I — ніч/день, amb — частка розсіяного, MIN) задано для
// екрана, як у старому рендері: лінійне = екранне^2,2 — тож ніч, тінь і мінімум на екрані — як раніше.
// Напрямлені — світила над обрієм, найяскравіші (не більше max; перше — головне, кидає тінь): dir — до світила, col — колір
// (у гамі), b — лінійна яскравість, k — лінійна сила; all — усі світила над обрієм за яскравістю; amb — лінійне розсіяне (верх при сонці на REF_Z: Ea + Ed·REF_Z = S →
// колір палітри), min — мінімум яскравості.
// Яскравість (11.10.2026, вимога: «головним сонцем повинне бути те, яке яскравіше»; місяць світив і кидав тінь, коли сонце
// вже сходило): сонце — bright^2,2 (з затемненням) × частка диска над обрієм; місяць і компаньйон — відбите світло всіх
// сонць (moonLight; 14.10.2026): альбедо × sin² кутового радіуса × освітлена частка × частка диска над обрієм (для Місяця
// й Сонця — ≈ 1/400 000; у грі місяці більші, але й найбільший у повню ≤ 0,0008 сонця, компаньйон — до ~0,5: крижаний у 60° у повні).
// Тож сонце, що показалось над обрієм на 1 %, уже яскравіше за місяць.
// Кілька світил (13.10.2026, рішення користувача): світло — сума всіх (sunDay, лінійно; затемнене й зайшле не світить);
// тінь — лише від світила з найсильнішим прямим світлом k (слот 0), закрите — тінь від наступного (14.10.2026: до того —
// за яскравістю диска, а біля обрію пряме світло гасне раніше за диск: на заході тінь лишалась за головним сонцем, що вже
// майже не світить, — тіней не видно, — а високе друге світило без тіні); жодного видимого (чи лише непомітні —
// різниця світла й тіні < 1/255 на екрані) — напрямлених немає, тіні не рахуються, світло — розсіяне нічного рівня.
// Пряме світло (Ed): частка кожного сонця плавно спадає до 0 на останніх ~12° над обрієм (DIRECT_Z) — ковзне світло майже
// все в тіні, а решта йде в розсіяне; частка сонць P — середня за їхнім внеском у світло; місяців — лише після заходу,
// плавно за ~6° (TWILIGHT_Z, громадянські сутінки; сутінки кількох сонць — середні за яскравістю, twilightOf), × освітлена
// частка (серп — слабко); уночі пряме ділять сонця й тіла за справжньою яскравістю (14.10.2026: тьмяна далека зоря над
// обрієм не забирає його в компаньйона); що не пряме — розсіяне (×REF_Z), як і пряме світил понад max і непомітних.
// Компаньйон тіні не кидає (14.10.2026, рішення користувача): слот 0 — найсильнішому з тих, що кидають, інакше порожній
// (null). Загальний рівень — від доби (I). 11.10.2026, скарга: на заході темнішало (усе пряме — ковзному сонцю), а щойно диск зникав — ставало світліше
// (пряме — у розсіяне); верх: 26 → 12 → 29 %, тепер спадає плавно до нічного
export const REF_Z = 0.77, MIN_LIGHT = 0.03, NIGHT_TINT = [0.62, 0.72, 1.0], MOON_ALBEDO = 0.12, DIRECT_Z = 0.2, TWILIGHT_Z = 0.1;
// Освітлена сонцем s частка диска тіла m, як видно нам (повня — навпроти сонця)
export const phaseOf = (m, s) => (1 - (m.dir[0] * s.dir[0] + m.dir[1] * s.dir[1] + m.dir[2] * s.dir[2])) / 2;
// Відбите тілом (місяцем, компаньйоном) світло всіх сонць, лінійне (сонце в зеніті — 1; 14.10.2026 — від усіх сонць):
// Σ за сонцями bright0^2,2 (потік на поточній відстані, без наших затемнень) × освітлена ним частка диска × (1 − 0,95 ·
// частка диска в тіні планети від нього) × альбедо × sin² кутового радіуса (освітленість від диска рівномірної
// яскравості — π·L·sin²α; для малих — α²) × частка диска над обрієм
export function moonLight(m, suns) {
  let b = 0;
  suns.forEach((s, k) => { b += (s.bright0 ?? s.bright) ** 2.2 * phaseOf(m, s) * (1 - 0.95 * (m.ecl ? m.ecl[k] : m.eclipse || 0)); });
  return b * (m.albedo ?? MOON_ALBEDO) * Math.sin(m.size) ** 2 * aboveHorizon(m.dir[2], m.size);
}
// Сутінки сонць 0…1 (0 — світить хоч одне яскраве сонце, 1 — усі зайшли на ~6°, TWILIGHT_Z): середнє за яскравістю
// (bright^2,2, з затемненням) — тьмяна далека зоря над обрієм ночі не скасовує; усі закриті — 1
export function twilightOf(suns) {
  let T = 0, W = 0;
  for (const s of suns) { const z0 = -Math.sin(s.size), w = s.bright ** 2.2; T += w * (1 - smoothstep(z0 - TWILIGHT_Z, z0, s.dir[2])); W += w; }
  return W > 0 ? T / W : 1;
}
// Внесок сонця в денне світло, лінійно (головне в зеніті — 1): яскравість (з затемненням) × сутінки (світить і трохи
// під обрієм — розсіяне небом)
export const sunDay = (s) => (s.bright * smoothstep(-0.1, 0.22, s.dir[2])) ** 2.2;
// Частка диска над обрієм: z — синус висоти центру, r — кутовий радіус (сегмент круга)
export function aboveHorizon(z, r) {
  const h = Math.max(-1, Math.min(1, Math.asin(Math.max(-1, Math.min(1, z))) / r));
  return (Math.acos(-h) + h * Math.sqrt(1 - h * h)) / Math.PI;
}
const VISIBLE = 1 / 255;   // найменша помітна на екрані різниця освітленого й тіні
export function lightsOf(sk, max = 3) {
  const L = [];
  let C = 0, CP = 0, Bm = 0, Mm = 0;
  for (const s of sk.suns) {
    const z0 = -Math.sin(s.size), c = sunDay(s), b = s.bright ** 2.2 * aboveHorizon(s.dir[2], s.size);   // z0 — диск зайшов повністю
    C += c;
    if (b <= 0) continue;
    const p = c * smoothstep(z0, DIRECT_Z, s.dir[2]);                // пряме світло цього сонця
    CP += p;
    L.push({ dir: s.dir, b, p, sun: true, col: (s.lit || s.col).map((v) => v / 255) });   // повний колір зорі
  }
  const tw = twilightOf(sk.suns);
  for (const m of sk.moons) {
    const ph = m.phase ?? phaseOf(m, sk.main);                   // освітлена частка (skyState — середня за потоком сонць)
    const vis = aboveHorizon(m.dir[2], m.size), b = m.light ?? moonLight(m, sk.suns);
    // компаньйон тіні не кидає (диск 9–60°: тінь предмета розмита на метри — рішення користувача 14.10.2026)
    if (b > 0) { L.push({ dir: m.dir, b, sun: false, shadow: !m.comp, col: NIGHT_TINT }); Bm += b; Mm = Math.max(Mm, ph * vis); }
  }
  // справжнє світло тіл (у рівні I, skyState): без повітря — завжди, з повітрям — після заходу сонць (kB); ця частина —
  // пряма від них (EdX), решта — частка рівня; пряме решти — сонцям за їхнім прямим світлом CP, а вночі (tw) — разом з
  // тілами за справжньою яскравістю (C + tw·Bm): тьмяна далека зоря не забирає напрям і тінь у місяця чи компаньйона
  const kB = 1 - (sk.airN ?? 1) * (1 - tw);
  const S = (sk.I * (sk.dimK ?? 1)) ** 2.2, rho = sk.amb / (sk.amb + (1 - sk.amb) * REF_Z), X = kB * Bm * (sk.dimK ?? 1) ** 2.2;
  const Ea = S * rho ** 2.2, Ed = S * (1 - rho ** 2.2) / REF_Z, EdX = X * (1 - rho ** 2.2) / REF_Z, Cd = C + tw * Bm, P = Cd > 0 ? CP / Cd : 0, Pm = (1 - P) * tw * Mm;
  let K = 0;
  // Cd = 0 при сонці над обрієм — великий диск (s > 0,1) ще не зайшов, але sunDay уже 0: прямого світла немає (не 0 / 0)
  for (const l of L) { l.k = l.sun ? (Cd > 0 ? (Ed - EdX) * l.p / Cd : 0) : (Ed - EdX) * Pm * l.b / Bm + EdX * l.b / Bm; K += l.k; }
  L.sort((a, b) => b.k - a.k || b.b - a.b);
  // розсіяне, якби всі світила світили прямо; світило, чия тінь на екрані непомітна, і понад max — у розсіяне. Слот 0
  // (тінь) — найсильніше з тих, що кидають тінь; компаньйон — у наступних, без іншого слот 0 порожній (null): тіней немає
  const A = Ea + REF_Z * (Ed - K), A0 = A ** (1 / 2.2), seen = L.filter((l) => l.k > 0 && (A + l.k) ** (1 / 2.2) - A0 >= VISIBLE);
  const i0 = seen.findIndex((l) => l.shadow !== false), dirs = [];
  if (i0 >= 0 || (seen.length && max > 1)) {
    dirs.push(i0 >= 0 ? seen[i0] : null);
    for (const l of seen) if (l !== seen[i0] && dirs.length < max) dirs.push(l);
  }
  let used = 0;
  for (const l of dirs) if (l) used += l.k;
  return { dirs, all: L, amb: Ea + REF_Z * (Ed - used) + (sk.flash ? (sk.flash * 1.6) ** 2.2 : 0), min: MIN_LIGHT ** 2.2 };
}
// Кількість напрямлених світел (слотів) всесвіту: сонця + місяці + компаньйон, 1…3 (зміна — перекомпіляція)
export const lightSlots = (L) => { const B = bodiesOf(L); return Math.max(1, Math.min(3, B.suns.length + B.moons.length)); };
// Лінійна сила → intensity PlayCanvas: менша за 1 множить колір до переведення в лінійне ((колір·i)^2,2), тож корінь
// 2,2-го степеня; від 1 — як є (src/scene/light.js, Light._updateLinearColor)
export const pcIntensity = (k) => k < 1 ? k ** (1 / 2.2) : k;

// Опис для F3, ?laws, ?strip: зорі (роль, клас, T, M, R, L, відстань, потік — земних і відносно найяскравішої; пара — θ і
// період) і припливне захоплення
const ROLE = { main: 'головна', pair: 'тісна', far: 'далека' }, f2 = (v) => (v >= 100 ? v.toFixed(0) : v >= 0.01 ? v.toFixed(2) : v.toPrecision(2)).replace('.', ',');
export function starsText(L) {
  const B = bodiesOf(L);
  return B.suns.map((s) => `${ROLE[s.role]} ${'MKGFAB'[s.cls]} ${s.T.toFixed(0)} K: M ${f2(s.M)}, R ${f2(s.R)}, L ${f2(s.L)}, ${f2(s.a)} а. о., потік ${f2(s.F)} земного (${f2(s.b0 * 100)} %)`
    + (s.role === 'pair' ? `, θ ${f2(s.th)}, оберт пари ${f2(s.per)} хв` : ''));
}
export function heldText(L) {
  const h = L.planet.held, C = L.comp;
  const a = h === 'sun' ? 'захоплення сонцем: вічний день' : h === 'res' ? 'резонанс 3:2 з сонцем: доба — 2 роки' : h === 'comp' ? 'захоплення компаньйоном: стоїть на небі'
    : h === 'moon' ? 'захоплення місяцем: стоїть на небі' : '';
  const b = C ? (C.face ? 'компаньйон повернутий до нас одним боком' : `компаньйон обертається (${f2(C.spinH)} год)`) : '';
  return [a, b].filter(Boolean).join(', ');
}
