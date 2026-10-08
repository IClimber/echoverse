// device.js — пристрій для стрибків між сусідніми всесвітами (номер ±1 на тій самій глибині). Без DOM.
// Стрибків скільки завгодно, але кожен — CHARGE с заряджання (повторне натискання скасовує).
// Координати зберігаються; якщо там, куди потрапиш, не можна стояти, — найближча клітинка, де можна,
// у радіусі LAND_R; такої немає — стрибок не відбувається.
import { standable } from './player.js';
import { LEVEL } from './iso.js';

export const CHARGE = 1.0;
export const LAND_R = 8;
export const HISTORY = 64;           // скільки останніх всесвітів пам'ятає пристрій

// Зсуви в межах кола LAND_R, від найближчих (за рівності — сталий порядок: результат однаковий усюди)
const OFFS = [];
for (let dy = -LAND_R; dy <= LAND_R; dy++) for (let dx = -LAND_R; dx <= LAND_R; dx++)
  if (dx * dx + dy * dy <= LAND_R * LAND_R) OFFS.push([dx, dy]);
OFFS.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);

// Найближче місце, де можна стояти, від ніг (x, y, z): P — «щуп» світу (player.js), ph — рух від гравітації.
// Шукаємо по стовпцях від найближчих, у кожному — висоту, найближчу до z (не вище +8 і не нижче −16 блоків).
// Хоч на одного сусіда має бути можна зійти — щоб не приземлитися на стовп. Повертає [x, y, z] або null
export function landing(P, x, y, z, ph = { up: 1, down: 1 }) {
  const fx = Math.floor(x), fy = Math.floor(y), kp = Math.round(z / LEVEL);
  for (const [dx, dy] of OFFS) {
    const cx = fx + dx + 0.5, cy = fy + dy + 0.5;
    for (let s = 0; s <= 16; s++) for (const k of s ? [kp + s, kp - s] : [kp]) {
      if (k < kp - 16 || k > kp + 8 || k < 0) continue;
      const zz = k * LEVEL;
      if (!standable(P, cx, cy, zz)) continue;
      const exit = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => {
        for (let q = -ph.down; q <= ph.up; q++) if (standable(P, cx + ax, cy + ay, zz + q * LEVEL)) return true;
        return false;
      });
      if (exit) return [cx, cy, zz];
    }
  }
  return null;
}

// Чанки, які мають бути готові до приземлення: усі, яких торкається коло LAND_R (+1 на сусідів)
export function landingChunks(x, y, cs) {
  const out = [];
  for (let cy = Math.floor((y - LAND_R - 1) / cs); cy <= Math.floor((y + LAND_R + 1) / cs); cy++)
    for (let cx = Math.floor((x - LAND_R - 1) / cs); cx <= Math.floor((x + LAND_R + 1) / cs); cx++) out.push([cx, cy]);
  return out;
}

export function createDevice(history = []) {
  return {
    charge: null,                    // {dir, t} — заряджається
    history: history.slice(-HISTORY),
    start(dir) {
      if (this.charge && this.charge.dir === dir) { this.charge = null; return 'cancel'; }
      this.charge = { dir, t: 0 };
      return 'start';
    },
    // dt → true, коли заряд повний (стрибок можна виконувати, щойно готові чанки)
    update(dt) {
      if (!this.charge) return false;
      this.charge.t = Math.min(CHARGE, this.charge.t + dt);
      return this.charge.t >= CHARGE;
    },
    done(from) {
      this.history.push(from);
      if (this.history.length > HISTORY) this.history.shift();
      this.charge = null;
    },
  };
}
