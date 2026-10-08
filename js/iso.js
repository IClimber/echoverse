// iso.js — ізометрична орто-камера (азимут 45°, нахил 30°: ромб клітинки 2:1) і вибір клітинки під курсором.
// Світ: x — униз-праворуч на екрані, y — униз-ліворуч, z — угору; клітинка (x, y) — квадрат [x, x+1) × [y, y+1).
// Екран — px при зумі 1 відносно центру камери, y — униз.

export const TILE_W = 64;                      // ширина ромба клітинки, px при зумі 1
export const S = 45.254833995939045;           // px на світову одиницю: TILE_W / 2 / cos 45°
export const LEVEL = 0.5;                      // висота одного рівня рельєфу у світових одиницях
const RX = 0.7071067811865476;                 // cos 45°
const RY = 0.3535533905932738;                 // sin 30° · cos 45°
const VZ = 0.8660254037844386;                 // cos 30°
const DXY = 0.6123724356957945, DZ = 0.5;      // напрям до камери: (cos 30° · cos 45°, …, sin 30°)

// Зсув від камери (світові одиниці) → екран
export const toScreen = (dx, dy, dz) => [(dx - dy) * RX * S, ((dx + dy) * RY - dz * VZ) * S];
// Глибина: більше — ближче до камери
export const depthOf = (dx, dy, dz) => (dx + dy) * DXY + dz * DZ;
// Екран → точка на площині висоти dz (зсув від камери)
export function fromScreen(sx, sy, dz = 0) {
  const a = sx / (RX * S);                     // dx − dy
  const b = (sy / S + dz * VZ) / RY;           // dx + dy
  return [(a + b) / 2, (b - a) / 2];
}

// Клітинка під точкою екрана. Промінь від камери йде вниз і вглиб; перебираємо рівні згори вниз —
// перша клітинка, чий стовп сягає рівня, і є влучанням (вища клітинка попереду закриває ту, що позаду).
// heightAt(x, y) → рівень або −1 (невідомо); cam — [x, y, z] камери у світі.
export function pick(sx, sy, cam, heightAt, maxH) {
  for (let L = maxH; L >= 0; L--) {
    const [dx, dy] = fromScreen(sx, sy, L * LEVEL - cam[2]);
    const x = Math.floor(cam[0] + dx), y = Math.floor(cam[1] + dy);
    if (heightAt(x, y) >= L) return [x, y];
  }
  return null;
}
