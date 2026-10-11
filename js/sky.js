// sky.js — небо й час доби всесвіту (лише вигляд, тож тригонометрія дозволена). Без DOM.
// Годинник світу — секунди гри (clock, спільний для всіх всесвітів); фаза доби всесвіту — clock / тривалість доби
// + зсув (0 — північ, 0,5 — полудень). Сонця й місяці ходять небом, як на планеті на широті lat: шлях — коло навколо
// полюса світу; склонення dec зсуває шлях (подвійні зорі — поруч, зі зсувом фази). Місяць відстає від сонця на
// оберт за свій період — звідси фази. Зорі — нерухомі відносно полюса, обертаються з небом.
// Світові осі: x, y — горизонталь, z — угору; схід — за азимутом всесвіту.

const TAU = Math.PI * 2;
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

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

// Осі неба: схід e, північ nn, полюс світу pole (нахилений від півночі на широту)
function axes(L) {
  const az = L.sky.az + 0.6, lat = L.sky.lat * 1.2;
  const e = [Math.cos(az), Math.sin(az), 0], nn = [-Math.sin(az), Math.cos(az), 0];
  return { e, nn, lat, pole: [nn[0] * Math.cos(lat), nn[1] * Math.cos(lat), Math.sin(lat)] };
}
// Напрям на світило з годинним кутом h (0 — найвище) і склоненням dec
function bodyDir(A, h, dec) {
  const ce = -Math.cos(dec) * Math.sin(h), cn = Math.sin(dec) * Math.cos(A.lat) - Math.cos(dec) * Math.cos(h) * Math.sin(A.lat);
  const cu = Math.sin(dec) * Math.sin(A.lat) + Math.cos(dec) * Math.cos(h) * Math.cos(A.lat);
  return [A.e[0] * ce + A.nn[0] * cn, A.e[1] * ce + A.nn[1] * cn, cu];
}

// Стан неба всесвіту L у мить clock: світила, світло для граней, кольори неба й туману, зорі.
// light — напрям (до світила, z > 0), lightK — множник світла (з кольором), amb — частка розсіяного;
// zenith / horizon — небо, fog — колір туману (= обрій), day — 0…1 (ніч … день), dusk — сила заходу,
// stars — яскравість зір, cel — матриця «світ → небесна сфера» (рядки), для зір
export function skyState(L, clock) {
  const S = L.sky, P = L.pal, A = axes(L), phase = dayPhase(L, clock), h0 = TAU * (phase - 0.5);
  const suns = S.suns.map((s) => ({ dir: bodyDir(A, h0 + TAU * s.off, s.dec), col: s.col, size: s.size, bright: s.bright }));
  const days = localTime(L, clock) / (S.dayMin * 60);
  const moons = S.moons.map((m) => {
    const lag = (S.lock ? 0 : days / m.period) + m.off;
    return { dir: bodyDir(A, h0 - TAU * (lag - Math.floor(lag)), m.dec), col: m.col, size: m.size };
  });
  // день: найсильніше сонце над обрієм; захід — коли головне сонце біля обрію
  let day = 0, main = suns[0];
  for (const s of suns) { const k = s.bright * smooth(-0.1, 0.22, s.dir[2]); if (k > day) { day = k; main = s; } }
  const dusk = Math.max(0, 1 - Math.abs(suns[0].dir[2] - 0.02) / 0.22) * (S.lock ? 0.5 : 1);
  // світло: денне — від сонць над обрієм (колір — їхня суміш, біля обрію — тепліше), нічне — від місяців
  let lx = 0, ly = 0, lz = 0, cr = 0, cg = 0, cb = 0, w = 0;
  for (const s of suns) {
    const k = s.bright * smooth(-0.05, 0.25, s.dir[2]);
    if (k <= 0) continue;
    lx += s.dir[0] * k; ly += s.dir[1] * k; lz += s.dir[2] * k; cr += s.col[0] * k; cg += s.col[1] * k; cb += s.col[2] * k; w += k;
  }
  let sunCol = w ? [cr / w / 255, cg / w / 255, cb / w / 255] : [1, 1, 1];
  const warm = Math.max(0, dusk - 0.2);
  sunCol = mix(sunCol, [S.dusk[0] / 255, S.dusk[1] / 255, S.dusk[2] / 255], warm * 0.5);
  for (const m of moons) if (m.dir[2] > 0) { const k = (1 - day) * 0.5 * m.size / 0.08; lx += m.dir[0] * k; ly += m.dir[1] * k; lz += m.dir[2] * k; }
  let light = norm([lx, ly, Math.max(lz, 0.25 * Math.hypot(lx, ly) + 0.05)]);
  if (light[2] < 0.25) light = norm([light[0], light[1], 0.25]);
  const I = S.night + (1 - S.night) * day;
  const nightTint = [0.62, 0.72, 1.0];
  const tint = mix(nightTint, mix([1, 1, 1], sunCol, 0.6), day);
  // небо
  const dayH = P.sky, dayZ = [P.sky[0] * 0.72, P.sky[1] * 0.8, Math.min(255, P.sky[2] * 1.02)];
  const nZ = S.nightCol, nH = [S.nightCol[0] * 1.7 + 10, S.nightCol[1] * 1.7 + 10, S.nightCol[2] * 1.6 + 12];
  const horizon = mix(mix(nH, dayH, day), S.dusk, dusk * 0.6), zenith = mix(mix(nZ, dayZ, day), S.dusk, dusk * 0.15);
  // зорі: обертання навколо полюса на годинний кут
  const cel = celMatrix(A, h0);
  // полярне сяйво: у бік магнітного полюса (географічний північ, повернутий на нахил поля), лише вночі
  const M = L.mag || { k: 0, tilt: 0, hue: 0.35 }, ct = Math.cos(M.tilt), stl = Math.sin(M.tilt);
  const aurora = { dir: [A.nn[0] * ct - A.nn[1] * stl, A.nn[0] * stl + A.nn[1] * ct], k: Math.max(0, M.k - 0.25) * 1.6 * (1 - day), col: hsl3(M.hue), t: localTime(L, clock) };
  return {
    phase, day, dusk, suns, moons, main, light, lightK: [tint[0] * I, tint[1] * I, tint[2] * I], amb: L.light.amb, I, tint, lock: !!S.lock,
    aurora, zenith, horizon, fog: horizon, duskCol: S.dusk, stars: S.stars * (1 - day) * (1 - dusk * 0.5), starHue: S.starHue, rings: S.rings, pole: A.pole, cel,
  };
}

// Колір сяйва за відтінком (яскравий, насичений)
function hsl3(h) {
  const f = (n) => { const k = (n + h * 12) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

// Світ → небесна сфера (рядки матриці 3×3): вісь z — полюс, обертання навколо нього на −h
function celMatrix(A, h) {
  const p = A.pole, x0 = A.e, y0 = [p[1] * x0[2] - p[2] * x0[1], p[2] * x0[0] - p[0] * x0[2], p[0] * x0[1] - p[1] * x0[0]];
  const c = Math.cos(h), s = Math.sin(h);
  const X = [x0[0] * c + y0[0] * s, x0[1] * c + y0[1] * s, x0[2] * c + y0[2] * s], Y = [y0[0] * c - x0[0] * s, y0[1] * c - x0[1] * s, y0[2] * c - x0[2] * s];
  return [...X, ...Y, ...p];
}

// Атмосфера й погода поверх стану неба st (змінює його): розріджене повітря — темніший зеніт, без повітря — чорне
// небо із зорями вдень; серпанок — колір обрію й видимість; хмари й опади — сіріше й темніше; пил — колір пустелі;
// блискавка — спалах. W — weather.js weatherAt, clock — для руху хмар. Додає st.cloud, st.flash, st.visK
export function applyWeather(st, L, W, clock) {
  const A = L.air, thin = clamp01(1 - A.pressure / 0.7), vac = A.pressure < 0.1, I = Math.min(1, st.lightK[1]);
  st.zenith = mix(st.zenith, [4, 6, 14], thin * 0.8);
  if (vac) { st.horizon = mix(st.horizon, [12, 14, 22], 0.85); st.stars = Math.max(st.stars, 0.9); st.dusk *= 0.2; }
  st.horizon = mix(st.horizon, A.hazeCol.map((v) => v * (0.25 + 0.75 * I)), A.haze * 0.45);
  const gray = [150 * (0.2 + 0.8 * I), 156 * (0.2 + 0.8 * I), 166 * (0.22 + 0.78 * I)];
  st.horizon = mix(st.horizon, gray, W.dim * 1.2 + (1 - W.vis) * 0.4 * (1 - W.dust));
  st.zenith = mix(st.zenith, gray, W.dim * 1.4);
  if (W.dust > 0) st.horizon = mix(st.horizon, L.pal.desert.map((v) => v * (0.3 + 0.7 * I)), W.dust * 0.75);
  const dimK = 1 - W.dim * 0.55, fl = W.flash * 1.6;
  st.dimK = dimK;
  st.lightK = [st.lightK[0] * dimK + fl, st.lightK[1] * dimK + fl, st.lightK[2] * dimK + fl * 1.1];
  st.fog = st.horizon;
  const cw = 0.0012 + 0.0004 * Math.min(1, A.wind / 6);         // хмари пливуть за вітром (зсув текстури — проти)
  st.cloud = vac ? null : { k: W.clouds, off: [13.7 - clock * W.wind[0] * cw, 5.1 - clock * W.wind[1] * cw], dark: W.dim * 1.3, col: [255 * (0.18 + 0.82 * I), 255 * (0.18 + 0.82 * I), 255 * (0.2 + 0.8 * I)] };
  st.flash = W.flash;
  if (st.aurora) st.aurora.k *= Math.min(1, A.pressure * 2) * (1 - W.clouds * 0.8);   // без повітря — без сяйв, хмари ховають
  st.visK = vac ? 1.15 : W.vis * (1 - 0.45 * A.haze);
  return st;
}

// Світла для рушія (лінійні, як у PlayCanvas). Числа законів (I — ніч/день, amb — частка розсіяного, MIN) задано для
// екрана, як у старому рендері: лінійне = екранне^2,2 — тож ніч, тінь і мінімум на екрані — як раніше.
// Напрямлені — світила над обрієм, найяскравіші (не більше max; перше — головне, кидає тінь): dir — до світила, col — колір
// (у гамі), b — яскравість, k — лінійна сила; amb — лінійне розсіяне (верх при сонці на REF_Z: Ea + Ed·REF_Z = S → колір
// палітри), min — мінімум яскравості.
// Яскравість (11.10.2026, вимога: «головним сонцем повинне бути те, яке яскравіше»; місяць світив і кидав тінь, коли сонце
// вже сходило): сонце — bright × частка диска над обрієм; місяць — відбите світло головного сонця: альбедо × кутовий
// радіус² × освітлена частка (фаза) × частка диска над обрієм (для Місяця й Сонця — ≈ 1/400 000; у грі місяці більші,
// але й найбільший у повню ≤ 0,0008 сонця). Тож сонце, що показалось над обрієм на 1 %, уже яскравіше за місяць.
// Пряме світло (Ed) ділиться за яскравістю, загальний рівень — від доби (I)
export const REF_Z = 0.77, MIN_LIGHT = 0.03, NIGHT_TINT = [0.62, 0.72, 1.0], MOON_ALBEDO = 0.12;
// Частка диска над обрієм: z — синус висоти центру, r — кутовий радіус (сегмент круга)
export function aboveHorizon(z, r) {
  const h = Math.max(-1, Math.min(1, Math.asin(Math.max(-1, Math.min(1, z))) / r));
  return (Math.acos(-h) + h * Math.sqrt(1 - h * h)) / Math.PI;
}
export function lightsOf(sk, max = 3) {
  const L = [];
  for (const s of sk.suns) {
    const b = s.bright * aboveHorizon(s.dir[2], s.size);
    if (b <= 0) continue;
    const dk = Math.max(0, 1 - Math.abs(s.dir[2] - 0.02) / 0.22) * (sk.lock ? 0.5 : 1), warm = Math.max(0, dk - 0.2);
    L.push({ dir: s.dir, b, col: mix(mix([1, 1, 1], s.col.map((v) => v / 255), 0.6), sk.duskCol.map((v) => v / 255), warm * 0.5) });
  }
  const M = sk.main;
  for (const m of sk.moons) {
    const lit = (1 - (m.dir[0] * M.dir[0] + m.dir[1] * M.dir[1] + m.dir[2] * M.dir[2])) / 2;   // фаза: повня — навпроти сонця
    const b = M.bright * MOON_ALBEDO * m.size * m.size * lit * aboveHorizon(m.dir[2], m.size);
    if (b > 0) L.push({ dir: m.dir, b, col: NIGHT_TINT });
  }
  L.sort((a, b) => b.b - a.b); L.length = Math.min(L.length, max);
  const B = L.reduce((s, l) => s + l.b, 0), S = (sk.I * (sk.dimK ?? 1)) ** 2.2, rho = sk.amb / (sk.amb + (1 - sk.amb) * REF_Z);
  const Ea = S * rho ** 2.2, Ed = S * (1 - rho ** 2.2) / REF_Z;
  for (const l of L) l.k = Ed * l.b / B;
  return { dirs: L, amb: (B > 0 ? Ea : Ea + Ed * REF_Z) + (sk.flash ? (sk.flash * 1.6) ** 2.2 : 0), min: MIN_LIGHT ** 2.2 };
}
// Лінійна сила → intensity PlayCanvas: менша за 1 множить колір до переведення в лінійне ((колір·i)^2,2), тож корінь
// 2,2-го степеня; від 1 — як є (src/scene/light.js, Light._updateLinearColor)
export const pcIntensity = (k) => k < 1 ? k ** (1 / 2.2) : k;
