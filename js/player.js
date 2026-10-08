// player.js — рух гравця у світі з блоків: габарит (FOOT × FOOT × BODY) проти блоків і предметів, гравітація, стрибок,
// автоматичний крок на уступ, плавання (і в небезпечних рідинах: поки немає здоров'я — лише попередження). Без DOM.
// Позиція — у клітинках (x, y) і висота ніг z у світі; vz — вертикальна швидкість; ground — стоїть на опорі.
// P — доступ до світу: block(x, y, k) → вид блоку (−1 — не згенеровано: стіна), obj(x, y) → перешкода-предмет,
// що росте в клітинці ({cx, cy, z0, z1, r}: центр, низ і верх, півширина) або null, objR — найбільша півширина
// перешкод (скільки клітинок навколо перевіряти), liquid — рідина всесвіту ({swim — тримає на плаву, danger}).
// ph — рух від гравітації (physOf): up, speed, settle, g.
import { LEVEL } from './iso.js';
import { solidB, B_LIQ } from './gen/chunk.js';

export const SPEED = 4.2;            // клітинок за секунду (при 1 g)
export const FOOT = 0.24;            // півширина габариту
export const BODY = 0.98;            // висота габариту (2 блоки)
export const GRAVITY = 25.6;         // прискорення при 1 g, одиниць/с²
export const JUMP_V = 7.67;          // поштовх стрибка: при 1 g — 1,15 одиниці (2 блоки) і 0,6 с у повітрі
export const FLOAT_Z = 0.6;          // той, хто пливе у воді, тримається ногами на стільки нижче поверхні (густіша — вище)
export const SPRINT = 1.6;           // біг (Shift): множник швидкості пішки (у воді — половина надбавки)
export const FLY_SPEED = 12;         // політ: клітинок за секунду по горизонталі
export const FLY_V = 8;              // політ: швидкість угору / униз
const FLY_TOP = 70;                  // політ: вище цієї висоти не піднятися
const CLIMB_OUT = 2;                 // з рідини можна вилізти на берег до 2 блоків над її поверхнею
const LEAP = 0.3;                    // стрибок з рідини: стільки секунд рідина не тягне назад
export const PH1 = { up: 1, speed: 1, settle: 14, g: 1 };
const R2 = Math.SQRT1_2;
const MB45 = [[R2, -R2], [R2, R2]];  // базис руху ізометрії з азимутом 45°: праворуч, униз екрана
const EPS = 1e-4;

export const jumpHeight = (g) => JUMP_V * JUMP_V / (2 * GRAVITY * g);
const floatZ = (P) => FLOAT_Z * Math.min(1, 1 / P.liquid.density);

// Перешкоди-предмети біля (x, y): виклик f(o) для кожної, поки f не поверне true
function objsNear(P, x, y, f) {
  const R = Math.ceil((P.objR ?? 0.5) + FOOT - 0.5), fx = Math.floor(x), fy = Math.floor(y);
  for (let ty = fy - R; ty <= fy + R; ty++) for (let tx = fx - R; tx <= fx + R; tx++) {
    const o = P.obj(tx, ty);
    if (o && f(o)) return true;
  }
  return false;
}
const over = (o, x, y) => Math.abs(x - o.cx) < o.r + FOOT && Math.abs(y - o.cy) < o.r + FOOT;

// Чи перетинає габарит у (x, y, z) тверде (блоки чи предмети)
export function hits(P, x, y, z) {
  const k0 = Math.floor(z / LEVEL + EPS), k1 = Math.floor((z + BODY) / LEVEL - EPS);
  const x0 = Math.floor(x - FOOT), x1 = Math.floor(x + FOOT), y0 = Math.floor(y - FOOT), y1 = Math.floor(y + FOOT);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) for (let k = k0; k <= k1; k++) {
    const b = P.block(tx, ty, k);
    if (b === -1 || solidB(b)) return true;
  }
  return objsNear(P, x, y, (o) => over(o, x, y) && z < o.z1 - EPS && z + BODY > o.z0);
}

// Опора під габаритом не нижче за z − drop: {z (верх опори)} або null. Рідина — не опора
export function support(P, x, y, z, drop = 40) {
  const kTop = Math.floor(z / LEVEL + EPS) - 1, kBot = Math.max(-1, Math.floor((z - drop) / LEVEL));   // нижче світу — камінь
  let best = null;
  for (const [ox, oy] of [[-FOOT, -FOOT], [FOOT, -FOOT], [-FOOT, FOOT], [FOOT, FOOT]]) {
    const tx = Math.floor(x + ox), ty = Math.floor(y + oy);
    for (let k = kTop; k >= kBot; k--) {
      const b = P.block(tx, ty, k);
      if (b === -1 || solidB(b)) {
        const top = (k + 1) * LEVEL;
        if (!best || top > best.z) best = { z: top };
        break;
      }
    }
  }
  // верх предмета (камінь, пень) під ногами
  objsNear(P, x, y, (o) => {
    if (over(o, x, y) && o.z1 <= z + EPS && o.z1 >= z - drop && (!best || o.z1 > best.z)) best = { z: o.z1 };
    return false;
  });
  return best;
}

// Рідина на висоті тіла: поверхня (z) або null
export function liquidAt(P, x, y, z) {
  const tx = Math.floor(x), ty = Math.floor(y);
  let k = Math.floor((z + 0.35) / LEVEL);
  if (P.block(tx, ty, k) !== B_LIQ) return null;
  while (P.block(tx, ty, k + 1) === B_LIQ) k++;
  return (k + 1) * LEVEL - 0.15;
}

// Крок: ix, iy — напрям на екрані (праворуч, униз); jump — стрибок; mb — [праворуч, униз] на землі від камери;
// ctl — {sprint (біг), vert (політ: 1 — угору, −1 — униз)}. p.fly — летить (як у Minecraft: без гравітації, торкнувся
// землі — політ скінчився). p.wet — тіло в рідині, p.swim — пливе (рідина тримає, дна немає), p.air — у повітрі,
// p.vis — висота для малювання
export function step(p, ix, iy, jump, dt, P, ph = PH1, mb = MB45, ctl = {}) {
  if (p.stepOff === undefined) p.stepOff = 0;
  if (p.fly) return fly(p, ix, iy, dt, P, ph, mb, ctl.vert || 0);
  p.leap = Math.max(0, (p.leap || 0) - dt);
  const surf = liquidAt(P, p.x, p.y, p.z), buoy = P.liquid.swim;
  const deep = surf !== null && !p.ground;
  p.moving = !!(ix || iy);
  if (p.moving) {
    let vx = ix * mb[0][0] + iy * mb[1][0], vy = ix * mb[0][1] + iy * mb[1][1];
    const run = ctl.sprint ? (surf === null ? SPRINT : 1 + (SPRINT - 1) / 2) : 1;
    const l = Math.hypot(vx, vy), sp = SPEED * ph.speed * run * (surf === null ? 1 : deep || !buoy ? 0.5 : 0.7) * dt;
    vx /= l; vy /= l;
    p.yaw = Math.atan2(vy, vx);
    const tryMove = (nx, ny) => {
      if (!hits(P, nx, ny, p.z)) { p.x = nx; p.y = ny; return true; }   // з уступу — просто падаєш
      if (p.ground || surf !== null) {                       // крок на уступ (з рідини — вилізти на берег)
        const base = Math.ceil(p.z / LEVEL - EPS) * LEVEL;
        const top = surf !== null ? Math.max(p.z + ph.up * LEVEL, surf + 0.15 + CLIMB_OUT * LEVEL) : p.z + ph.up * LEVEL;
        for (let nz = base + LEVEL; nz <= top + EPS; nz += LEVEL) {
          if (hits(P, p.x, p.y, nz) || hits(P, nx, ny, nz)) continue;
          if (!support(P, nx, ny, nz, 0.01)) continue;
          p.stepOff -= nz - p.z; p.z = nz; p.x = nx; p.y = ny; p.vz = 0; p.ground = true;
          return true;
        }
        // на верх предмета (камінь) — теж кроком, якщо невисоко
        const g = support(P, nx, ny, top + EPS, top + EPS - p.z);
        if (g && g.z > p.z + EPS && g.z <= top + EPS && !hits(P, p.x, p.y, g.z) && !hits(P, nx, ny, g.z)) {
          p.stepOff -= g.z - p.z; p.z = g.z; p.x = nx; p.y = ny; p.vz = 0; p.ground = true;
          return true;
        }
      }
      return false;
    };
    const nx = p.x + vx * sp, ny = p.y + vy * sp;
    if (!tryMove(nx, ny)) { if (!(vx && tryMove(nx, p.y))) { if (vy) tryMove(p.x, ny); } }
  }
  // Вертикаль: у рідині, що тримає, — виштовхує до поверхні (м'яка пружина); у рідкій, що не тримає, — повільно
  // тонеш (опір); інакше — гравітація
  const s2 = liquidAt(P, p.x, p.y, p.z);
  if (s2 !== null && buoy && !p.ground && !p.leap) p.vz += ((s2 - floatZ(P) - p.z) * 22 - p.vz * 7) * dt;
  else if (s2 !== null && !buoy) p.vz += (-GRAVITY * ph.g * 0.35 - p.vz * 4) * dt;
  else p.vz -= GRAVITY * ph.g * dt;
  if (jump) {
    if (p.ground) p.vz = JUMP_V * (s2 === null ? 1 : 0.85);
    else if (s2 !== null && buoy && p.z > s2 - floatZ(P) - 0.25) { p.vz = JUMP_V * 0.8; p.leap = LEAP; }   // з поверхні — вистрибнути
  }
  let nz = p.z + p.vz * dt;
  if (p.vz <= 0) {
    const g = support(P, p.x, p.y, p.z + EPS, p.z - nz + 0.05);
    if (g && nz <= g.z + EPS) { nz = g.z; p.vz = 0; p.ground = true; }
    else p.ground = false;
  } else if (hits(P, p.x, p.y, nz)) { nz = p.z; p.vz = 0; }   // стеля
  else p.ground = false;
  p.z = nz;
  p.stepOff *= Math.exp(-dt * ph.settle);
  p.vis = p.z + p.stepOff;
  const s3 = liquidAt(P, p.x, p.y, p.z);
  p.wet = s3 !== null;
  p.swim = p.wet && buoy && !p.ground;
  p.air = !p.ground && !p.wet;
}

// Політ: рух уздовж осей окремо (ковзає вздовж стін), рідини не тримають і не заважають; униз до землі —
// політ скінчився (над небезпечною рідиною — лише зупиняється)
function fly(p, ix, iy, dt, P, ph, mb, vert) {
  p.moving = !!(ix || iy);
  if (p.moving) {
    let vx = ix * mb[0][0] + iy * mb[1][0], vy = ix * mb[0][1] + iy * mb[1][1];
    const l = Math.hypot(vx, vy), sp = FLY_SPEED * dt / l;
    vx *= sp; vy *= sp;
    p.yaw = Math.atan2(vy, vx);
    if (!hits(P, p.x + vx, p.y, p.z)) p.x += vx;
    if (!hits(P, p.x, p.y + vy, p.z)) p.y += vy;
  }
  let nz = p.z + vert * FLY_V * dt;
  p.ground = false;
  if (vert < 0) {
    const g = support(P, p.x, p.y, p.z + EPS, p.z - nz + 0.05);
    if (g && nz <= g.z + EPS) { nz = g.z; p.fly = false; p.ground = true; }
    else if (liquidAt(P, p.x, p.y, nz) !== null) p.fly = false;            // у рідину — політ скінчився
  } else if (vert > 0 && (nz > FLY_TOP || hits(P, p.x, p.y, nz))) nz = p.z;
  p.z = nz; p.vz = 0;
  p.stepOff *= Math.exp(-dt * ph.settle);
  p.vis = p.z + p.stepOff;
  p.swim = false; p.wet = false;
  p.air = !p.ground;
}

// Чи можна стати, ноги в (x, y, z): габарит вільний, не в рідині, і є опора саме під ногами
export function standable(P, x, y, z) {
  if (hits(P, x, y, z) || P.block(Math.floor(x), Math.floor(y), Math.floor(z / LEVEL + EPS)) === B_LIQ) return false;
  const g = support(P, x, y, z, 0.01);
  return !!g && Math.abs(g.z - z) < 0.02;
}
