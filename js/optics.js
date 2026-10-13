// optics.js — колір неба, заходу й світла з фізики (п. 4 roadmap, М9; лише вигляд). Три довжини хвиль (R, G, B):
// спектр — колір зорі (чорне тіло, sky.js starColor), розсіяння Релея τ_R ∝ стовп повітря P/g і λ⁻⁴, аерозоль τ_a
// (серпанок законів + пил погоди) з альбедо розсіяння за видом (вода, сірка, органіка, пил), повітряна маса —
// Kasten–Young. Пряме світло = зоря × e^(−τ·m(h)); зеніт — однократне розсіяння вздовж короткого шляху, обрій — насичене
// вздовж довгого (густе повітря — біліше), сяйво біля сонця — пряме світло, розсіяне вперед (пил — блакитне, як на Марсі).
// Каліброване під Землю: зеніт (70, 130, 220), обрій (185, 205, 230) при сонці на 60°; решта атмосфер відхиляються від
// неї фізично. Кольори на виході — екранні 0…255 (як палітри законів), лінійне = екранне^2,2.
import { starColor } from './sky.js';

const LAM = [0.43, 1, 2.44];                         // (550 / λ)⁴ для 680, 550, 440 нм
const OMEGA = [[0.98, 0.98, 0.98], [0.95, 0.9, 0.6], [0.9, 0.7, 0.4], [0.95, 0.8, 0.6]];     // вода, сірка, органіка, пил
const AER = [0.3, 1.2, 1, 1.8];                      // яскравість аерозолю в зеніті (водяний серпанок — уперед, мало вбік)
const FWD = [[1, 1, 1], [1, 1, 0.8], [1, 0.9, 0.7], [0.55, 0.8, 1.35]];                       // розсіяння вперед (пил — блакитне)
const WZ = 0.12, WH = 0.3, ZMAX = 1.6;               // рівень білого багаторазового розсіяння: зеніт, обрій; межа однократного
const lin = (v) => (v / 255) ** 2.2, scr = (v) => 255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2);
// Повітряна маса на висоті сонця h (рад; нижче обрію — як на обрії)
export function airMass(h) {
  const d = Math.max(0, h * 180 / Math.PI);
  return 1 / (Math.sin(d * Math.PI / 180) + 0.50572 * (d + 6.07995) ** -1.6364);
}
// Товщі й альбедо для законів L (+ пил погоди dust 0…1)
function depths(L, dust = 0) {
  const A = L.air, g = Math.max(0.02, L.grav), co2 = A.comp ? A.comp.CO2 : 0;
  const tR = A.vacuum ? 0 : 0.097 * (A.pressure / g) * (1 + 0.6 * co2);
  const kind = dust > 0.3 ? 3 : A.hazeKind || 0, ta = (A.vacuum ? 0 : A.tauA || 0) + 1.5 * dust;
  return { tR: LAM.map((k) => tR * k), ta, om: OMEGA[kind], fw: FWD[kind], aer: AER[kind] };
}
// Кольори при сонці на висоті h (рад) для зорі кольору sc (екранний rgb): zen, hor, glow (сяйво біля сонця, найяскравіший
// канал — 255), sun (колір прямого світла, так само), trans (пропускання прямого, зелений канал), amb (частка розсіяного)
let K = null;
export function skyOptics(L, sc, h, dust = 0) {
  if (!K) K = calibrate();
  return colors(depths(L, dust), sc.map(lin), h, K);
}
// Частини: дифузне пропускання (двопотокове: густе повітря не гасить, а розсіює), частка білого багаторазового
// розсіяння w, однократне розсіяння Релея (м'яко обмежене) й аерозолю
function parts(D, h) {
  const m = Math.min(airMass(h), 12), sG = D.tR[1] + D.om[1] * D.ta, w = 1 - Math.exp(-1.5 * sG), P = [];
  for (let c = 0; c < 3; c++) {
    const sg = D.tR[c] + D.om[c] * D.ta, ab = (1 - D.om[c]) * D.ta;
    P.push({ td: Math.exp(-ab * m * 0.5) / (1 + 0.75 * sg * m * 0.3), r1: 1 - Math.exp(-D.tR[c]), a1: D.om[c] * (1 - Math.exp(-D.ta)) * 0.35 * D.aer,
      h1: 1 - Math.exp(-sg * 8), habs: Math.exp(-ab * 4) });
  }
  return { m, w, P };
}
function colors(D, S, h, Kc) {
  const { w, P } = parts(D, h), zen = [], hor = [], glow = [], sun = [];
  for (let c = 0; c < 3; c++) {
    const p = P[c];
    zen[c] = S[c] * p.td * ((1 - w) * (ZMAX * (1 - Math.exp(-p.r1 * Kc.z[c] / ZMAX)) + p.a1) + w * WZ);
    hor[c] = S[c] * p.td * p.habs * ((1 - w) * p.h1 * Kc.h[c] + w * WH);
  }
  // пряме: колір — відносно найпрозорішого каналу (у густому повітрі без переповнення нуля), пропускання — окремо
  const am = airMass(h), te = D.tR.map((t) => t + D.ta), t0 = Math.min(...te);
  for (let c = 0; c < 3; c++) { sun[c] = S[c] * Math.exp(-(te[c] - t0) * am); glow[c] = sun[c] * D.fw[c]; }
  const nrm = (v) => { const mx = Math.max(v[0], v[1], v[2], 1e-9); return v.map((x) => scr(x / mx)); };
  const tG = D.tR[1] + D.ta;
  return { zen: zen.map(scr), hor: hor.map(scr), glow: nrm(glow), sun: nrm(sun), trans: Math.exp(-te[1] * am), amb: tG > 0 ? 0.42 + 0.3 * (1 - Math.exp(-2 * tG)) : 0.15 };
}
// Калібрування під Землю (Сонце 5772 K, 1 атм, 1 g, серпанок 0,12 водяний, сонце на 60°): множники Релея в зеніті
// (обернене до м'якого обмеження) й обрію
function calibrate() {
  const D = depths({ air: { pressure: 1, comp: { CO2: 0.0004 }, tauA: 0.12, hazeKind: 0 }, grav: 1 }), S = starColor(5772).map(lin);
  const { w, P } = parts(D, Math.PI / 3), zl = [70, 130, 220].map(lin), hl = [185, 205, 230].map(lin), z = [], hh = [];
  for (let c = 0; c < 3; c++) {
    const p = P[c], x = (zl[c] / (S[c] * p.td) - w * WZ) / (1 - w) - p.a1;
    z.push(-ZMAX * Math.log(1 - x / ZMAX) / p.r1);
    hh.push((hl[c] / (S[c] * p.td * p.habs) - w * WH) / ((1 - w) * p.h1));
  }
  return { z, h: hh };
}
