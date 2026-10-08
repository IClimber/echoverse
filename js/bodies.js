// bodies.js — тіла з масою (власна фізика, без рушія): ширяюче каміння, пізніше — речі, істоти. Без DOM.
// Тіло — коробка (піврозміри hx, hy, hz навколо центру x, y, z) з масою. Сили: тяжіння (місцева гравітація × (1 − підйом
// породи)), для левітуючих (lift > 1) — пружина до висоти ширяння над ґрунтом, опір повітря, вітер (за площею й масою).
// Зіткнення з блоками — рух по осях окремо, відскок і тертя від законів всесвіту. Тіло, що спокійно висить чи лежить,
// «спить» (не рахується), поки його не зачеплять. Удар — імпульс / маса: важке ледь зрушить.
// Інтерфейс (положення, швидкість, маса, форма) — такий, щоб за потреби пересадити на фізичний рушій.
import { LEVEL } from './iso.js';
import { solidB } from './gen/chunk.js';
import { GRAVITY } from './player.js';

const EPS = 1e-4;
const SLEEP_V = 0.06, SLEEP_T = 1.2;         // спокій: швидкість нижче й стільки секунд — засинає
const DENSITY = 1800;                         // маса одиниці об'єму каменю (умовна; гравець — PLAYER_MASS)
export const PLAYER_MASS = 70;
export const HIT_IMPULSE = 150;               // удар гравця (маса × швидкість): камінчик — ~6 од/с, брила — ледь

// Тіло з опису: {x, y, z (низ), hx, hy, hz, dens (×), lift, hover (висота ширяння низу над ґрунтом)}
export function makeBody(o) {
  const b = { vx: 0, vy: 0, vz: 0, yaw: 0, spin: 0, sleep: true, calm: 0, ...o };
  b.z = o.z + o.hz;                           // центр
  b.mass = DENSITY * (o.dens || 1) * 8 * o.hx * o.hy * o.hz;
  return b;
}

// Чи перетинає коробка тіла (центр x, y, z) тверді блоки. P — щуп світу (player.js)
function boxHits(P, b, x, y, z) {
  const x0 = Math.floor(x - b.hx), x1 = Math.floor(x + b.hx - EPS), y0 = Math.floor(y - b.hy), y1 = Math.floor(y + b.hy - EPS);
  const k0 = Math.floor((z - b.hz) / LEVEL + EPS), k1 = Math.floor((z + b.hz) / LEVEL - EPS);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) for (let k = k0; k <= k1; k++) {
    const v = P.block(tx, ty, k);
    if (v === -1 || solidB(v)) return true;
  }
  return false;
}

// Верх ґрунту під центром тіла (для висоти ширяння); немає в межах 40 одиниць — null
function groundBelow(P, x, y, z) {
  const tx = Math.floor(x), ty = Math.floor(y);
  for (let k = Math.floor(z / LEVEL); k >= Math.floor((z - 40) / LEVEL); k--) {
    const v = P.block(tx, ty, k);
    if (v === -1) return null;
    if (solidB(v)) return (k + 1) * LEVEL;
  }
  return null;
}

// Крок тіла: P — щуп, env — {g (сила тяжіння, g), vT, bounce, friction, wind [x, y]}
export function stepBody(b, dt, P, env) {
  if (b.sleep) return;
  const g = GRAVITY * env.g, lift = b.lift || 0;
  // тяжіння мінус підйом породи; левітуюче — пружина до висоти ширяння (немає ґрунту під — просто висить)
  let az = -g * (1 - Math.min(1, lift));
  if (lift > 1) {
    const gz = groundBelow(P, b.x, b.y, b.z), target = gz === null ? b.z : gz + b.hover + b.hz;
    az += (target - b.z) * 6 - b.vz * 2.2;
  }
  // опір повітря й вітер: легке й велике тіло зносить сильніше (площа / маса)
  const area = 4 * b.hx * b.hz, w = env.wind || [0, 0], kd = Math.min(4, 0.4 + 60 * area / b.mass);
  b.vx += ((w[0] - b.vx) * kd * 0.25 - b.vx * 0.3) * dt;
  b.vy += ((w[1] - b.vy) * kd * 0.25 - b.vy * 0.3) * dt;
  b.vz += az * dt;
  if (b.vz < -env.vT) b.vz = -env.vT;
  // рух по осях окремо, дробимо крок, щоб не проскочити крізь тонку стіну
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt / 0.2));
  const h = dt / n, rest = Math.max(0.15, env.bounce || 0.25), fr = env.friction ?? 1;
  for (let i = 0; i < n; i++) {
    for (const ax of ['x', 'y', 'z']) {
      const v = 'v' + ax, d = b[v] * h;
      if (!d) continue;
      const nx = ax === 'x' ? b.x + d : b.x, ny = ax === 'y' ? b.y + d : b.y, nz = ax === 'z' ? b.z + d : b.z;
      if (!boxHits(P, b, nx, ny, nz)) { b[ax] = ax === 'x' ? nx : ax === 'y' ? ny : nz; continue; }
      b[v] = ax === 'z' && b.vz < 0 && b.vz > -1.5 ? 0 : -b[v] * rest;   // повільно на опору — лягає, швидко — відскакує
      if (ax === 'z') { b.vx *= 1 - 0.5 * fr * Math.min(1, h * 30); b.vy *= 1 - 0.5 * fr * Math.min(1, h * 30); }   // тертя об опору
    }
  }
  b.yaw += b.spin * dt;
  b.spin *= Math.exp(-dt * 1.5);
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  b.calm = sp < SLEEP_V ? b.calm + dt : 0;
  if (b.calm > SLEEP_T) { b.sleep = true; b.vx = b.vy = b.vz = 0; }
}

// Імпульс (j — вектор маса × швидкість) у тіло: будить
export function push(b, j) {
  b.vx += j[0] / b.mass; b.vy += j[1] / b.mass; b.vz += j[2] / b.mass;
  b.spin += (Math.random() - 0.5) * Math.min(6, Math.hypot(j[0], j[1]) / b.mass * 2);
  b.sleep = false; b.calm = 0;
}

// Промінь з (ox, oy, oz) у напрямку d (одиничний) до maxT: найближче тіло зі списку й відстань, або null
export function rayBody(list, ox, oy, oz, d, maxT) {
  let best = null, bt = maxT;
  for (const b of list) {
    let t0 = 0, t1 = bt;
    for (const [o, dd, c, hh] of [[ox, d[0], b.x, b.hx], [oy, d[1], b.y, b.hy], [oz, d[2], b.z, b.hz]]) {
      if (Math.abs(dd) < 1e-9) { if (o < c - hh || o > c + hh) { t0 = 1; t1 = 0; } continue; }
      let a = (c - hh - o) / dd, e = (c + hh - o) / dd;
      if (a > e) [a, e] = [e, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, e);
    }
    if (t0 <= t1 && t0 < bt) { bt = t0; best = b; }
  }
  return best ? { b: best, t: bt } : null;
}
