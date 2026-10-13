// textures.js — процедурні текстури поверхонь (лише вигляд): шар 32×32 на матеріал (gen/materials.js),
// візерунок — від законів всесвіту (L.tex: стиль трави, квіти, хвилі, пласти, тріщини…). Піксельний шум — від зерна
// глибини, тож у сусідніх всесвітах текстури схожі. Значення — множник кольору вершини: 128 = ×1 (шар sRGB, шейдер × 4,595),
// тож колір дає палітра, а текстура — деталі. Усі текстури безшовні (період — 32 пікселі).
import { hash2, hash3, unit } from './rng.js';
import { hsl } from './universe.js';
import * as M from './gen/materials.js';

export const TEX = 32;
const TAU = Math.PI * 2;
const wrap = (v) => ((v % TEX) + TEX) % TEX;

export function texturesOf(L) {
  const T = L.tex, out = new Uint8Array(M.LAYERS * TEX * TEX * 4).fill(128);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const seedOf = (m) => hash2(L.ds, 1000 + m);
  // Шар m: buf — множники [r, g, b] на піксель; mul — помножити піксель, tint — помножити на колір
  const layer = (m) => {
    const buf = new Float32Array(TEX * TEX * 3).fill(1);
    const at = (x, y) => (wrap(y) * TEX + wrap(x)) * 3;
    const api = {
      s: seedOf(m),
      rnd: (...k) => unit(hash3(seedOf(m), k[0] | 0, (k[1] | 0) * 7919 + (k[2] | 0))),
      mul(x, y, k) { const i = at(x, y); buf[i] *= k; buf[i + 1] *= k; buf[i + 2] *= k; },
      tint(x, y, c) { const i = at(x, y); buf[i] *= c[0]; buf[i + 1] *= c[1]; buf[i + 2] *= c[2]; },
      all(fn) { for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) api.mul(x, y, fn(x, y)); },
      // Плавний безшовний шум 0…1 з P клітинками на текстуру
      smooth(x, y, P, salt = 0) {
        const f = P / TEX, gx = x * f, gy = y * f, ix = Math.floor(gx), iy = Math.floor(gy);
        const fx = gx - ix, fy = gy - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        const g = (a, b) => unit(hash3(seedOf(m) + salt, ((ix + a) % P + P) % P, ((iy + b) % P + P) % P));
        return g(0, 0) + (g(1, 0) - g(0, 0)) * u + (g(0, 1) - g(0, 0)) * v + (g(0, 0) - g(1, 0) - g(0, 1) + g(1, 1)) * u * v;
      },
      // Тріщина: випадкове блукання від (x, y)
      crack(x, y, len, k, dx = 0) {
        for (let i = 0; i < len; i++) {
          api.mul(x, y, k);
          const r = api.rnd(x, y, i + 500);
          if (r < 0.35) x += 1; else if (r < 0.7) x -= 1; else y += 1;
          x += dx;
        }
      },
      write() {
        const o = m * TEX * TEX * 4;
        for (let p = 0; p < TEX * TEX; p++) for (let c = 0; c < 3; c++)
          out[o + p * 4 + c] = Math.max(0, Math.min(255, Math.round(128 * buf[p * 3 + c])));
      },
    };
    return api;
  };
  const speckle = (t, amp) => t.all((x, y) => 1 + (t.rnd(x, y) - 0.5) * amp);
  const ripple = (t, k, amp, salt = 0) => t.all((x, y) => 1 + amp * Math.sin(TAU * (k[0] * x + k[1] * y) / TEX + 2.5 * t.smooth(x, y, 4, salt)));
  const flowerTint = (() => { const c = hsl(T.flowerHue, 0.8, 0.6), a = (c[0] + c[1] + c[2]) / 3; return c.map((v) => 0.35 + 0.95 * v / a); })();

  // Трава (верх зелені): чотири стилі — стебла, конюшина, мох, луска (дивний)
  { const t = layer(M.M_LUSH), C = T.grassC;
    speckle(t, 0.1 * C);
    if (T.grass === 0) for (let k = 0; k < 70; k++) { const x = t.rnd(k, 1) * TEX, y = t.rnd(k, 2) * TEX, len = 2 + (t.rnd(k, 3) * 3 | 0), m = t.rnd(k, 4) < 0.5 ? 1 - 0.16 * C : 1 + 0.12 * C; for (let i = 0; i < len; i++) t.mul(x | 0, (y | 0) - i, m); }
    else if (T.grass === 1) for (let k = 0; k < 40; k++) { const x = t.rnd(k, 1) * TEX | 0, y = t.rnd(k, 2) * TEX | 0, m = t.rnd(k, 4) < 0.6 ? 1 - 0.14 * C : 1 + 0.12 * C; t.mul(x, y, m); t.mul(x + 1, y, m); t.mul(x, y + 1, m); t.mul(x + 1, y + 1, m); }
    else if (T.grass === 2) t.all((x, y) => 1 + 0.22 * C * (t.smooth(x, y, 8) - 0.5) + 0.12 * C * (t.smooth(x, y, 16, 1) - 0.5));
    else t.all((x, y) => { const cx = (x % 8) - 3.5, cy = (y % 8) - 3.5; return 1 - 0.1 * C + 0.2 * C * Math.min(1, (cx * cx + cy * cy) / 16); });
    for (let k = 0; k < TEX * TEX * T.flowers; k++) t.tint(t.rnd(k, 7) * TEX | 0, t.rnd(k, 8) * TEX | 0, flowerTint);
    t.write(); }
  // Край дерну на бічній грані: та сама трава з довшими стеблами донизу
  { const t = layer(M.M_LIP);
    speckle(t, 0.1);
    for (let k = 0; k < 60; k++) { const x = t.rnd(k, 1) * TEX | 0, y = t.rnd(k, 2) * TEX | 0, len = 3 + (t.rnd(k, 3) * 5 | 0); for (let i = 0; i < len; i++) t.mul(x, y + i, 0.84); }
    t.write(); }
  // Степ: рідкі кущики й тріщини
  { const t = layer(M.M_DRY);
    speckle(t, 0.1);
    for (let k = 0; k < 18; k++) { const x = t.rnd(k, 1) * TEX | 0, y = t.rnd(k, 2) * TEX | 0; t.mul(x, y, 0.8); t.mul(x + 1, y, 0.85); t.mul(x, y - 1, 0.88); }
    for (let k = 0; k < T.cracks; k++) t.crack(t.rnd(k, 5) * TEX | 0, t.rnd(k, 6) * TEX | 0, 10, 0.86);
    t.write(); }
  // Пісок і пустеля: зерно й брижі (напрям і довжина хвилі — від законів)
  { const t = layer(M.M_SAND); speckle(t, 0.1); ripple(t, T.ripple, 0.04); t.write(); }
  { const t = layer(M.M_DESERT); speckle(t, 0.08); ripple(t, T.ripple, 0.08, 1); t.write(); }
  { const t = layer(M.M_SANDSIDE); speckle(t, 0.08); t.all((x, y) => 1 + 0.06 * (unit(hash2(t.s, (y / 3) | 0)) - 0.5)); t.write(); }
  // Сніг: ледь помітний шум і блискітки
  { const t = layer(M.M_SNOW);
    speckle(t, 0.03);
    for (let k = 0; k < TEX * TEX * T.sparkle; k++) t.mul(t.rnd(k, 1) * TEX | 0, t.rnd(k, 2) * TEX | 0, 1.12);
    t.write(); }
  // Скеля згори: плями й тріщини; збоку — пласти (товщина — від законів) і вертикальні тріщини
  { const t = layer(M.M_ROCK);
    t.all((x, y) => 1 + 0.2 * (t.smooth(x, y, 4) - 0.5) + 0.08 * (t.rnd(x, y) - 0.5));
    for (let k = 0; k < 2 + T.cracks; k++) t.crack(t.rnd(k, 5) * TEX | 0, t.rnd(k, 6) * TEX | 0, 14, 0.8);
    t.write(); }
  { const t = layer(M.M_CLIFF), th = T.strata;
    t.all((x, y) => 0.9 + 0.2 * unit(hash2(t.s, Math.floor(y / th))) + 0.07 * (t.rnd(x, y) - 0.5) + 0.06 * (t.smooth(x, y, 4) - 0.5));
    for (let k = 0; k < 1 + (T.cracks >> 1); k++) t.crack(t.rnd(k, 5) * TEX | 0, t.rnd(k, 6) * TEX | 0, 12, 0.8);
    t.write(); }
  // Ґрунт: шум і камінці
  { const t = layer(M.M_SOIL);
    speckle(t, 0.14);
    for (let k = 0; k < TEX * TEX * T.pebbles; k++) { const x = t.rnd(k, 1) * TEX | 0, y = t.rnd(k, 2) * TEX | 0, m = 1.18 + 0.1 * t.rnd(k, 3); t.mul(x, y, m); t.mul(x + 1, y, m); }
    t.write(); }
  // Вода: хвилі (у шейдері текстура пливе) і відблиски; лід — гладкий з білими тріщинами
  { const t = layer(M.M_WATER);
    ripple(t, T.wave, 0.07, 2);
    for (let k = 0; k < 10; k++) { const x = t.rnd(k, 1) * TEX | 0, y = t.rnd(k, 2) * TEX | 0; for (let i = 0; i < 3; i++) t.mul(x + i, y, 1.15); }
    t.write(); }
  { const t = layer(M.M_ICE);
    t.all((x, y) => 1 + 0.06 * (t.smooth(x, y, 4) - 0.5));
    for (let k = 0; k < 3 + T.cracks; k++) t.crack(t.rnd(k, 5) * TEX | 0, t.rnd(k, 6) * TEX | 0, 16, 1.16);
    t.write(); }
  // Листя: грудки (три стилі — дрібні, великі, смужки); кора — вертикальні смуги
  { const t = layer(M.M_LEAF);
    if (T.leaf === 0) t.all((x, y) => 1 + 0.3 * (t.smooth(x, y, 8) - 0.5) + 0.12 * (t.rnd(x, y) - 0.5));
    else if (T.leaf === 1) t.all((x, y) => (t.smooth(x, y, 4) > 0.55 ? 1.12 : 0.9) + 0.08 * (t.rnd(x, y) - 0.5));
    else t.all((x, y) => 1 + 0.12 * Math.sin(TAU * 4 * (x + y) / TEX) + 0.1 * (t.rnd(x, y) - 0.5));
    t.write(); }
  { const t = layer(M.M_BARK); t.all((x, y) => 0.85 + 0.3 * unit(hash2(t.s, x)) + 0.08 * (t.smooth(x, y, 8) - 0.5)); t.write(); }
  // Кристал: діагональні грані з відблисками; шапка гриба — світлі плями (кількість — від законів)
  { const t = layer(M.M_CRYSTAL); t.all((x, y) => 0.82 + 0.36 * (((x + y) * 3 / TEX) % 1)); t.write(); }
  { const t = layer(M.M_CAP);
    speckle(t, 0.06);
    for (let k = 0; k < T.spots; k++) {
      const cx = t.rnd(k, 1) * TEX, cy = t.rnd(k, 2) * TEX, r = 2 + t.rnd(k, 3) * 2;
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) if (x * x + y * y <= r * r) t.mul((cx + x) | 0, (cy + y) | 0, 1.45);
    }
    t.write(); }
  // Дно водойми: мул із камінцями; сухе русло — потріскана глина (багатокутники); лава — темна кірка з яскравими тріщинами
  { const t = layer(M.M_BED);
    t.all((x, y) => 1 + 0.12 * (t.smooth(x, y, 8) - 0.5) + 0.08 * (t.rnd(x, y) - 0.5));
    for (let k = 0; k < TEX * TEX * T.pebbles; k++) { const x = t.rnd(k, 1) * TEX | 0, y = t.rnd(k, 2) * TEX | 0; t.mul(x, y, 0.82); t.mul(x + 1, y, 0.86); }
    t.write(); }
  { const t = layer(M.M_MUD), P = 4;                           // клітини Вороного на безшовній ґратці 4×4
    const pts = [];
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) pts.push([(i + 0.15 + 0.7 * t.rnd(i, j, 1)) * TEX / P, (j + 0.15 + 0.7 * t.rnd(i, j, 2)) * TEX / P]);
    t.all((x, y) => {
      let a = 1e9, b = 1e9;
      for (const [px, py] of pts) for (const ox of [-TEX, 0, TEX]) for (const oy of [-TEX, 0, TEX]) {
        const dd = (x + 0.5 - px - ox) ** 2 + (y + 0.5 - py - oy) ** 2;
        if (dd < a) { b = a; a = dd; } else if (dd < b) b = dd;
      }
      return Math.sqrt(b) - Math.sqrt(a) < 1.1 ? 0.68 : 1 + 0.06 * (t.rnd(x, y) - 0.5);
    });
    t.write(); }
  { const t = layer(M.M_LAVA);
    t.all((x, y) => { const v = t.smooth(x, y, 4) * 0.6 + t.smooth(x, y, 8, 1) * 0.4; return v > 0.62 ? 1.45 : v > 0.55 ? 1.15 : 0.55 + 0.25 * v; });
    t.write(); }
  // Пелюстки: м'які прожилки від центру; лезо трави й папороті — поздовжні смуги; кактус — ребра з колючками;
  // корал — пори; стебло — волокна
  { const t = layer(M.M_PETAL); t.all((x, y) => 1 + 0.08 * Math.sin(TAU * 3 * x / TEX) + 0.06 * (t.smooth(x, y, 4) - 0.5) + 0.04 * (t.rnd(x, y) - 0.5)); t.write(); }
  { const t = layer(M.M_BLADE); t.all((x, y) => 0.92 + 0.16 * unit(hash2(t.s, x >> 1)) + 0.05 * (t.rnd(x, y) - 0.5)); t.write(); }
  { const t = layer(M.M_CACTUS);
    t.all((x, y) => 1 + 0.06 * Math.sin(TAU * 4 * x / TEX) + 0.05 * (t.rnd(x, y) - 0.5));
    for (let k = 0; k < 40; k++) t.mul(t.rnd(k, 1) * TEX | 0, t.rnd(k, 2) * TEX | 0, 1.35);
    t.write(); }
  { const t = layer(M.M_CORAL);
    t.all((x, y) => 1 + 0.08 * (t.smooth(x, y, 8) - 0.5));
    for (let k = 0; k < 26; k++) { const x = t.rnd(k, 1) * TEX | 0, y = t.rnd(k, 2) * TEX | 0; t.mul(x, y, 0.7); t.mul(x + 1, y, 0.8); t.mul(x, y + 1, 0.8); }
    t.write(); }
  { const t = layer(M.M_STEM); t.all((x, y) => 0.94 + 0.12 * unit(hash2(t.s, x)) + 0.04 * (t.smooth(x, y, 8) - 0.5)); t.write(); }
  return out;
}
