// laws-stand.js — стенд законів фізики світу (index.html?laws[&seed=&d=&n=&N=]; п. 4 roadmap): розподіли законів на N
// всесвітах глибини d (рівні — кольором, частки незвичного / крайнього / легендарного, класи всесвітів), картка
// всесвіту (d, n) в одиницях СІ, графіки в часі в одному місці (тяжіння з припливом, температура, вітер, погода, частка
// часу «зносить») і прев'ю неба з оптики для набору атмосфер і зір. Лише показ: генерацію не змінює.
import { lawsOf, physOf, STRANGE_NAMES, TIER_NAMES } from './universe.js';
import { hashStr } from './rng.js';
import { fmtN } from './debug.js';
import { skyOptics } from './optics.js';
import { starColor, skyState, clockStr, dayPhase, starsText, heldText } from './sky.js';
import { physAt3 } from './worldphys.js';
import { tempAt } from './climate.js';
import { weatherAt, WEATHER_NAMES } from './weather.js';

const TIER_COL = ['#5d6b86', '#e0c060', '#f08a4b', '#ff4d6d'];
const WCOL = ['#8fb8e8', '#9aa3b0', '#4f79b8', '#3c3f8f', '#c9ccd2', '#d6a65a'];
const el = (tag, css = '', txt = '') => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt) e.textContent = txt; return e; };
const fx = (v, d = 2) => v.toFixed(d).replace('.', ',').replace('-', '−');
const css = (c) => `rgb(${c.map((v) => Math.max(0, Math.min(255, v)) | 0).join(',')})`;

// Величини для гістограм: назва, функція від законів, закон рівнів (кольором), логарифмічна вісь
const QTY = [
  ['тяжіння, g', (L) => L.grav, ['радіус планети', 'густина планети', 'обертання'], true],
  ['температура ділянки, °C', (L) => L.clim.Tpatch - 273.15, ['відстань до зорі', 'альбедо', 'тиск', 'вуглекислий газ', 'широта']],
  ['тиск, атм', (L) => Math.max(1e-4, L.air.pressure), ['тиск'], true],
  ['температура зорі, K', (L) => L.star.T, ['зоря'], true],
  ['відстань до зорі (земних)', (L) => L.star.d, ['відстань до зорі']],
  ['радіус планети, км', (L) => L.planet.R * 6371, ['радіус планети'], true],
  ['обертання, год', (L) => L.planet.rot, ['обертання'], true],
  ['нахил осі, °', (L) => L.planet.obliq, ['нахил осі']],
  ['широта, °', (L) => L.planet.lat, ['широта']],
  ['поле B (Земля 1)', (L) => Math.max(0.005, L.mag.B), ['поле'], true],
  ['радіація', (L) => L.air.rad, ['поле', 'зоря']],
  ['вітер у ясну, м/с', (L) => Math.max(0.1, L.air.wind), ['вітер'], true],
  ['кисень, частка', (L) => L.air.comp.O2, ['кисень']],
  ['серпанок τ', (L) => Math.max(0.005, L.air.tauA), ['серпанок'], true],
  ['плин часу', (L) => L.phys.time, ['плин часу'], true],
  ['доба гри, хв', (L) => L.sky.lock ? 0.5 : L.sky.dayMin, ['обертання'], true],
];

function histogram(title, vals, tiers, log) {
  const W = 300, H = 120, B = 40, cv = el('canvas'), box = el('figure', 'margin:0;width:300px;font-size:11px;color:#96a2bb');
  cv.width = W; cv.height = H;
  const tr = log ? (v) => Math.log10(v) : (v) => v, xs = vals.map(tr).filter(Number.isFinite).sort((a, b) => a - b);
  const lo = xs[Math.floor(xs.length * 0.001)], hi = xs[Math.ceil(xs.length * 0.999) - 1] + 1e-9, cnt = Array.from({ length: B }, () => [0, 0, 0, 0]);
  vals.forEach((v, i) => { const x = tr(v); if (!Number.isFinite(x)) return; const b = Math.max(0, Math.min(B - 1, Math.floor((x - lo) / (hi - lo) * B))); cnt[b][tiers[i]]++; });
  const mx = Math.max(...cnt.map((c) => c[0] + c[1] + c[2] + c[3])), ctx = cv.getContext('2d');
  ctx.fillStyle = '#141a26'; ctx.fillRect(0, 0, W, H);
  cnt.forEach((c, b) => {
    let y = H - 14;
    for (let t = 0; t < 4; t++) {                                  // корінь висоти — видно й рідкісні хвости
      const h = c[t] ? Math.max(1, (H - 18) * Math.sqrt(c[t] / mx)) : 0;
      ctx.fillStyle = TIER_COL[t]; ctx.fillRect(b * W / B + 1, y - h, W / B - 2, h); y -= h;
    }
  });
  const lab = (x) => { const v = log ? 10 ** x : x; return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? fx(v, 1) : v.toPrecision(2).replace('.', ','); };
  ctx.fillStyle = '#96a2bb'; ctx.font = '10px sans-serif';
  ctx.fillText(lab(lo), 2, H - 3); ctx.textAlign = 'right'; ctx.fillText(lab(hi), W - 2, H - 3); ctx.textAlign = 'center'; ctx.fillText(lab((lo + hi) / 2), W / 2, H - 3);
  const N = vals.length, sh = [1, 2, 3].map((t) => tiers.filter((x) => x >= t).length / N * 100);
  const med = xs[xs.length >> 1];
  box.append(el('div', 'color:#dfe6f3;font-weight:600', title), cv, el('div', '', `медіана ${lab(med)} · незвичне+ ${fx(sh[0], 1)} %, крайнє+ ${fx(sh[1], 2)} %, легендарне ${fx(sh[2], 2)} %`));
  return box;
}

// Картка всесвіту: усе в одиницях
function card(L, seedText) {
  const S = L.star, P = L.planet, A = L.air, C = L.clim, ph = physOf(L);
  const rows = [
    ['адреса', `зерно «${seedText}», глибина ${L.d}, всесвіт ${fmtN(L.n)} · ${STRANGE_NAMES[L.strange.cls]}${Object.keys(L.tiers).length ? ': ' + Object.entries(L.tiers).map(([k, t]) => `${k} — ${TIER_NAMES[t]}`).join(', ') : ''}`],
    ['зорі', starsText(L).join(' · ')],
    ['орбіта', `відстань ${fx(S.d)} земної (${fx(S.a)} а. о.), інсоляція ${fx(S.S)} земної, рік ${P.lock ? '—' : (P.year / 400).toPrecision(3).replace('.', ',') + ' земного'}`],
    ['планета', `R ${(P.R * 6371).toFixed(0)} км, ρ ${fx(P.rho * 5.51)} г/см³, M ${fx(P.M)} M⊕, g ${fx(L.grav)} (${fx(L.grav * 9.81)} м/с²), v₂ ${fx(P.vEsc, 1)} км/с`],
    ['обертання', `${P.lock ? 'вічний день' : `${fx(P.rot, 1)} год (доба гри ${fx(L.sky.dayMin, 1)} хв)`}, нахил ${P.obliq.toFixed(0)}°, широта ${P.lat.toFixed(0)}°${heldText(L) ? ' · ' + heldText(L) : ''}`],
    ['повітря', A.vacuum ? `майже немає (${A.pressure.toPrecision(2)} атм)` : `${fx(A.pressure)} атм, ${Object.entries(A.comp).filter(([, v]) => v >= 0.001).map(([k, v]) => `${k} ${fx(v * 100, 1)} %`).join(', ')}; ${A.gasName}; ρ ${fx(A.rho)} кг/м³, H ${A.H.toFixed(0)} м`],
    ['температура', `рівноважна ${fx(C.Teq - 273.15, 0)} °C, поверхні ${fx(C.Ts - 273.15, 0)} °C, ділянки ${fx(C.Tpatch - 273.15, 0)} °C; ${(C.lapse * 1000).toFixed(0)} °C/км, доба ±${C.Ad.toFixed(0)}, сезон ±${C.As.toFixed(0)}`],
    ['поле', `B ${fx(L.mag.B)} земного, сяйва ${(L.mag.k * 100).toFixed(0)} %, радіація ${(A.rad * 100).toFixed(0)} %, активність зорі ${fx(S.act, 1)}`],
    ['вітер', `у ясну ${fx(A.wind, 1)} м/с; межа падіння гравця ${fx(ph.vT, 1)} м/с — на землі зносить понад ${fx(ph.vT * Math.sqrt(L.phys.friction), 1)} м/с`],
    ['небо', `місяців ${L.sky.moons.length}${L.comp ? `, компаньйон (приплив ${fx(L.comp.f * 100, 1)} %)` : ''}${L.sky.rings ? ', кільця' : ''}`],
    ['аномалії', `гравітації ${(L.anom.freq * 100).toFixed(0)} %${L.anom.rev ? ', зворотні' : ''}${L.tanom ? `, часові ×${fx(L.tanom.ks)} / ×${fx(L.tanom.kf)}` : ''}; плин часу ×${fx(L.phys.time)}`],
  ];
  const t = el('table', 'font-size:13px;border-collapse:collapse;margin:8px 0');
  for (const [k, v] of rows) { const tr = el('tr'); tr.append(el('td', 'color:#96a2bb;padding:2px 12px 2px 0;vertical-align:top', k), el('td', 'color:#dfe6f3', v)); t.append(tr); }
  return t;
}

// Графіки в часі в точці (0, 0): тяжіння (приплив), температура, вітер, смуга погоди — за span секунд гри
function timeline(L, span) {
  const W = 900, H = 70, N = 900, dt = span / N, ph0 = physOf(L), lim = ph0.vT * Math.sqrt(L.phys.friction);
  const g = [], T = [], w = [], k = [];
  let prev = null, push = 0, runs = [], since = 0;
  for (let i = 0; i < N; i++) {
    const t = i * dt, W0 = weatherAt(L, t, 0, 0, prev);
    if (prev && prev.kind !== W0.kind) { runs.push(t - since); since = t; }
    prev = W0;
    g.push(physAt3(L, 0, 0, 8, t).g); T.push(tempAt(L, 0, 0, 8, t, W0)); w.push(W0.windK); k.push(W0.kind);
    if (W0.windK > lim) push++;
  }
  const box = el('div');
  const plot = (title, v, col, fmt) => {
    const cv = el('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
    ctx.fillStyle = '#141a26'; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = col; ctx.beginPath();
    v.forEach((y, i) => { const px = i / N * W, py = H - 6 - (y - lo) / r * (H - 12); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke(); ctx.fillStyle = '#96a2bb'; ctx.font = '10px sans-serif'; ctx.fillText(`${title}: ${fmt(lo)} … ${fmt(hi)}`, 4, 11);
    box.append(cv, el('br'));
  };
  plot('тяжіння, g', g, '#7ee0c3', (v) => fx(v, 4));
  plot('температура, °C', T, '#f0a060', (v) => fx(v, 1));
  plot('вітер на рівнині, м/с', w, '#8fb8e8', (v) => fx(v, 1));
  const cv = el('canvas'); cv.width = W; cv.height = 16;
  const ctx = cv.getContext('2d');
  k.forEach((x, i) => { ctx.fillStyle = WCOL[x]; ctx.fillRect(i / N * W, 0, W / N + 1, 16); });
  box.append(cv);
  runs.sort((a, b) => a - b);
  box.append(el('div', 'font-size:12px;color:#96a2bb', `${(span / 3600).toFixed(1)} год гри · погода: змін ${runs.length}, тривалість стану — медіана ${runs.length ? fx(runs[runs.length >> 1] / 60, 1) : '—'} хв, найкоротша ${runs.length ? fx(runs[0] / 60, 1) : '—'} хв · «зносить» ${fx(push / N * 100, 1)} % часу (межа ${fx(lim, 1)} м/с) · ` + WEATHER_NAMES.map((n, i) => `${n} ${(k.filter((x) => x === i).length / N * 100).toFixed(0)} %`).join(', ')));
  return box;
}

// Прев'ю неба: зеніт, обрій і сяйво біля сонця за висотою сонця (−2…60°) для атмосфер і зір
const ATMOS = [
  ['Земля', 5772, { pressure: 1, comp: { CO2: 0.0004 }, tauA: 0.12, hazeKind: 0 }, 1],
  ['густе 5 атм', 5772, { pressure: 5, comp: { CO2: 0.01 }, tauA: 0.3, hazeKind: 0 }, 1],
  ['пилове (Марс)', 5772, { pressure: 0.6, comp: { CO2: 0.95 }, tauA: 0.5, hazeKind: 3 }, 0.38],
  ['сірчане', 5772, { pressure: 2, comp: { CO2: 0.05 }, tauA: 0.6, hazeKind: 1 }, 1],
  ['органічне (Титан)', 5772, { pressure: 1.5, comp: { CO2: 0 }, tauA: 1.2, hazeKind: 2 }, 0.14],
  ['розріджене 0,1 атм', 5772, { pressure: 0.1, comp: { CO2: 0.0004 }, tauA: 0.02, hazeKind: 0 }, 1],
  ['червоний карлик 3100 K', 3100, { pressure: 1, comp: { CO2: 0.0004 }, tauA: 0.12, hazeKind: 0 }, 1],
  ['блакитна 9800 K', 9800, { pressure: 1, comp: { CO2: 0.0004 }, tauA: 0.12, hazeKind: 0 }, 1],
  ['без повітря', 5772, { pressure: 0, vacuum: true, comp: { CO2: 0 }, tauA: 0, hazeKind: 0 }, 0.17],
];
function skyPreview() {
  const box = el('div', 'display:flex;flex-wrap:wrap;gap:10px'), H = [-2, 0, 2, 5, 10, 20, 35, 60];
  for (const [name, Ts, air, gr] of ATMOS) {
    const cv = el('canvas'); cv.width = H.length * 30; cv.height = 60;
    const ctx = cv.getContext('2d'), sc = starColor(Ts);
    H.forEach((h, i) => {
      const o = skyOptics({ air, grav: gr }, sc, h * Math.PI / 180), gd = ctx.createLinearGradient(0, 0, 0, 48);
      gd.addColorStop(0, css(o.zen)); gd.addColorStop(1, css(o.hor));
      ctx.fillStyle = gd; ctx.fillRect(i * 30, 0, 30, 48);
      ctx.fillStyle = css(o.glow); ctx.beginPath(); ctx.arc(i * 30 + 15, 40, 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#96a2bb'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(h + '°', i * 30 + 15, 58);
    });
    const f = el('figure', 'margin:0;font-size:11px;color:#96a2bb'); f.append(el('div', 'color:#dfe6f3', name), cv); box.append(f);
  }
  return box;
}

export function runLaws() {
  const q = new URLSearchParams(location.search);
  const seedText = q.get('seed') || 'test', seed = hashStr(seedText), d = +q.get('d') || 0, n = +q.get('n') || 0, N = +q.get('N') || 5000;
  document.getElementById('menu').hidden = true;
  document.getElementById('gl').hidden = true;
  Object.assign(document.body.style, { overflow: 'auto', userSelect: 'text', padding: '16px', background: '#0d1119', color: '#dfe6f3' });
  const root = el('div');
  root.append(el('h1', 'font-size:22px', 'Закони фізики світу'));
  const t0 = performance.now(), Ls = [];
  for (let i = 0; i < N; i++) Ls.push(lawsOf(seed, d, 101 + i * 7));            // далі від старту (біля нього — звичайне)
  // класи
  const cls = [0, 0, 0, 0];
  for (const L of Ls) cls[L.strange.cls]++;
  root.append(el('h2', '', `Глибина ${d}, ${N} всесвітів (номери 101…), зерно «${seedText}»`),
    el('div', 'font-size:14px', 'Класи: ' + cls.map((c, i) => `${STRANGE_NAMES[i]} ${fx(c / N * 100, 1)} %`).join(' · ')),
    el('div', 'font-size:12px;color:#96a2bb;margin:4px 0 10px', 'Рівні кольором: ' + TIER_NAMES.map((t, i) => `${t} — ${['сірий', 'жовтий', 'помаранчевий', 'червоний'][i]}`).join(', ') + '; висота стовпця — корінь частки (видно хвости)'));
  const grid = el('div', 'display:flex;flex-wrap:wrap;gap:12px');
  for (const [title, f, laws, log] of QTY) grid.append(histogram(title, Ls.map(f), Ls.map((L) => Math.max(0, ...laws.map((k) => L.tiers[k] || 0))), log));
  root.append(grid);
  const L = lawsOf(seed, d, n);
  root.append(el('h2', '', `Всесвіт ${L.d}:${fmtN(n)} (&n= — інший)`), card(L, seedText));
  const st = skyState(L, 0);
  root.append(el('div', 'font-size:12px;color:#96a2bb', `зараз (годинник 0): ${clockStr(dayPhase(L, 0))}, світил ${st.suns.length}, місяців ${st.moons.length}`));
  root.append(el('h3', '', 'У часі, точка (0, 0): доба й погода'), timeline(L, 86400));
  root.append(el('h3', '', 'Небо з оптики: зеніт → обрій, крапка — сяйво біля сонця; за висотою сонця'), skyPreview());
  root.append(el('p', 'font-size:12px;color:#96a2bb', `${(performance.now() - t0).toFixed(0)} мс`));
  document.body.append(root);
}
