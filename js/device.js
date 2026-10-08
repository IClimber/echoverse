// device.js — пристрій для стрибків між всесвітами (номер ±1 на тій самій глибині; для перевірок — будь-яка адреса).
// Без DOM. Стрибків скільки завгодно, але кожен — CHARGE с заряджання (повторне натискання скасовує).
// Координати зберігаються; якщо там, куди потрапиш, не можна стояти, — найближча клітинка, де можна, у радіусі
// LAND_R; такої немає — вільне місце в тому самому стовпці (у рідині — пливеш, у повітрі — падаєш). Стрибок вдається завжди.
import { standable, hits } from './player.js';
import { LEVEL } from './iso.js';

export const CHARGE = 1.0;
export const LAND_R = 8;
export const HISTORY = 64;           // скільки останніх всесвітів пам'ятає пристрій

// Зсуви в межах кола LAND_R, від найближчих (за рівності — сталий порядок: результат однаковий усюди)
const OFFS = [];
for (let dy = -LAND_R; dy <= LAND_R; dy++) for (let dx = -LAND_R; dx <= LAND_R; dx++)
  if (dx * dx + dy * dy <= LAND_R * LAND_R) OFFS.push([dx, dy]);
OFFS.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);

// Куди стати після стрибка, ноги були в (x, y, z): P — «щуп» світу (player.js), ph — рух від гравітації.
// Спершу — найближче місце, де можна стояти: по стовпцях від найближчих, у кожному — висота, найближча до z
// (не вище +8 і не нижче −16 блоків), і хоч на одного сусіда можна перейти (не стовп у ямі). Немає — вільне місце
// в тому самому стовпці, найближче до z (рідина, повітря над урвищем), зрештою — над стовпцем. Повертає [x, y, z]
export function landing(P, x, y, z, ph = { up: 1 }) {
  const fx = Math.floor(x), fy = Math.floor(y), kp = Math.max(0, Math.round(z / LEVEL));
  const exit = (cx, cy, zz) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => {
    for (let q = -16; q <= ph.up; q++) if (standable(P, cx + ax, cy + ay, zz + q * LEVEL)) return true;
    return false;
  });
  if (standable(P, x, y, kp * LEVEL) && exit(x, y, kp * LEVEL)) return [x, y, kp * LEVEL];
  for (const [dx, dy] of OFFS) {
    const cx = fx + dx + 0.5, cy = fy + dy + 0.5;
    for (let s = 0; s <= 16; s++) for (const k of s ? [kp + s, kp - s] : [kp]) {
      if (k < kp - 16 || k > kp + 8 || k < 0) continue;
      if (standable(P, cx, cy, k * LEVEL) && exit(cx, cy, k * LEVEL)) return [cx, cy, k * LEVEL];
    }
  }
  for (let s = 0; s <= TOP; s++) for (const k of s ? [kp + s, kp - s] : [kp]) {
    if (k >= 0 && k <= TOP && !hits(P, x, y, k * LEVEL)) return [x, y, k * LEVEL];
  }
  return [x, y, TOP * LEVEL];
}
const TOP = 100;                     // вище світу (96 блоків) завжди вільно

// Чанки, які мають бути готові до приземлення: усі, яких торкається коло LAND_R (+1 на сусідів)
export function landingChunks(x, y, cs) {
  const out = [];
  for (let cy = Math.floor((y - LAND_R - 1) / cs); cy <= Math.floor((y + LAND_R + 1) / cs); cy++)
    for (let cx = Math.floor((x - LAND_R - 1) / cs); cx <= Math.floor((x + LAND_R + 1) / cs); cx++) out.push([cx, cy]);
  return out;
}

export function createDevice(history = []) {
  return {
    charge: null,                    // {to: [d, n] — куди, tag — яка кнопка, t} — заряджається
    history: history.slice(-HISTORY),
    // Почати заряджання стрибка в to; та сама кнопка вдруге (tag) — скасувати
    start(to, tag = to.join()) {
      if (this.charge && this.charge.tag === tag) { this.charge = null; return 'cancel'; }
      this.charge = { to, tag, t: 0 };
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
