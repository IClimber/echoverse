// js/horizon.js — справжній обрій планети з ока. Світ опущено на d²/2R (кривизна, шейдер світу: R — L.phys.planetR), тож
// з висоти h над поверхнею обрій нижче горизонталі на кут з tg = √(2h/R), на відстані √(2hR). Небо (sky-shader.js) —
// від цього обрію: світила й тіла видно до нього, нижче — планета. До 14.10.2026 — від горизонталі: з висоти тіла
// обрізало над краєм намальованої землі (смуга неба між ними; на 250 м над планетою R 8,1 км — 14°)
import { tile, SURF_Z, T_WATER, T_ICE } from './gen/chunk.js';
import { LEVEL } from './universe.js';

export const HZ_N = 16;                     // напрямів (азимут від +x, рівний крок)
const RS = [0, 0.5, 1];                     // точки напряму: від краю далечі до відстані обрію (частки)

// Висота поверхні (м) у клітинці (x, y): рідина й лід — рівень моря, суходіл — верх блоку (скелі — ні: обрій — середнє)
function surfZ(L, x, y, o) {
  tile(L, x, y, o, true);
  return o.t === T_WATER || o.t === T_ICE ? SURF_Z : (o.h + 1) * LEVEL;
}

// Обрій навколо ока: update(L, x, y, z, R, farR) → Float32Array HZ_N — sin кута обрію під горизонталлю (≥ 0) за
// напрямами. Поверхня напряму — середнє точок між краєм далечі (farR: ближче — земля намальована й закриває сама) і
// відстанню обрію (D ≤ 4·farR); перерахунок — після зсуву > 32 м, зміни D > 10 % чи всесвіту (16 × 3 точки, ~0,25 мс)
export function createHorizon() {
  const zs = new Float32Array(HZ_N), out = new Float32Array(HZ_N), o = {};
  let at = { L: null, x: 0, y: 0, D: 0 }, D = 0;
  return function update(L, x, y, z, R, farR) {
    if (!R) { out.fill(0); return out; }
    const Dn = Math.min(4 * farR, Math.max(farR, D));
    if (L !== at.L || Math.hypot(x - at.x, y - at.y) > 32 || Math.abs(Dn - at.D) > 0.1 * at.D) {
      for (let i = 0; i < HZ_N; i++) {
        const a = i * 2 * Math.PI / HZ_N, c = Math.cos(a), s = Math.sin(a);
        let sum = 0;
        for (const k of RS) { const r = farR + (Dn - farR) * k; sum += surfZ(L, Math.floor(x + r * c), Math.floor(y + r * s), o); }
        zs[i] = sum / RS.length;
      }
      at = { L, x, y, D: Dn };
    }
    let hMax = 0;
    for (let i = 0; i < HZ_N; i++) {
      const h = Math.max(0, z - zs[i]), t2 = 2 * h / R;
      out[i] = Math.sqrt(t2 / (1 + t2));      // sin(atan √(2h/R))
      if (h > hMax) hMax = h;
    }
    D = Math.sqrt(2 * hMax * R);
    return out;
  };
}
