// player.js — рух гравця у світі з блоків: габарит (FOOT × FOOT × BODY) проти блоків і предметів, гравітація, стрибок,
// автоматичний крок на уступ, сторожа від падіння з високого уступу пішки, плавання. Без DOM.
// Позиція — у клітинках (x, y) і висота ніг z у світі; vz — вертикальна швидкість; ground — стоїть на опорі.
// P — доступ до світу: block(x, y, k) → вид блоку (−1 — не згенеровано: стіна), obj(x, y) → блок основи предмета
// або −1, liquid — рідина всесвіту ({swim, why}). ph — рух від гравітації (physOf): up, down, speed, settle, g.
import { LEVEL } from './iso.js';
import { solidB, B_LIQ } from './gen/chunk.js';

export const SPEED = 4.2;            // клітинок за секунду (при 1 g)
export const FOOT = 0.24;            // півширина габариту
export const BODY = 0.98;            // висота габариту (2 блоки)
export const OBJ = 0.18;             // півширина стовбура предмета в центрі клітинки
export const GRAVITY = 25.6;         // прискорення при 1 g, одиниць/с²
export const JUMP_V = 7.67;          // поштовх стрибка: при 1 g — 1,15 одиниці (2 блоки) і 0,6 с у повітрі
export const FLOAT_Z = 0.6;          // той, хто пливе, тримається ногами на стільки нижче поверхні
export const SPRINT = 1.6;           // біг (Shift): множник швидкості пішки (у воді — половина надбавки)
export const FLY_SPEED = 12;         // політ: клітинок за секунду по горизонталі
export const FLY_V = 8;              // політ: швидкість угору / униз
const FLY_TOP = 70;                  // політ: вище цієї висоти не піднятися
const CLIMB_OUT = 3;                 // з води можна вилізти на берег до 3 блоків заввишки
export const PH1 = { up: 1, down: 1, speed: 1, settle: 14, g: 1 };
const R2 = Math.SQRT1_2;
const MB45 = [[R2, -R2], [R2, R2]];  // базис руху ізометрії з азимутом 45°: праворуч, униз екрана
const EPS = 1e-4;

export const jumpHeight = (g) => JUMP_V * JUMP_V / (2 * GRAVITY * g);

const wall = (P, b) => b === -1 || solidB(b) || (b === B_LIQ && !P.liquid.swim);   // небезпечна рідина — як підлога

// Чи перетинає габарит у (x, y, z) тверде (блоки чи стовбури предметів)
export function hits(P, x, y, z) {
  const k0 = Math.floor(z / LEVEL + EPS), k1 = Math.floor((z + BODY) / LEVEL - EPS);
  const x0 = Math.floor(x - FOOT), x1 = Math.floor(x + FOOT), y0 = Math.floor(y - FOOT), y1 = Math.floor(y + FOOT);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) for (let k = k0; k <= k1; k++) {
    const b = P.block(tx, ty, k);
    if (b === -1 || solidB(b)) return true;
  }
  for (let ty = Math.floor(y) - 1; ty <= Math.floor(y) + 1; ty++) for (let tx = Math.floor(x) - 1; tx <= Math.floor(x) + 1; tx++) {
    const ok = P.obj(tx, ty);
    if (ok < 0) continue;
    const oz = ok * LEVEL;
    if (Math.abs(x - tx - 0.5) < OBJ + FOOT && Math.abs(y - ty - 0.5) < OBJ + FOOT && z < oz + 2 && z + BODY > oz) return true;
  }
  return false;
}

// Опора під габаритом не нижче за z − drop: {z (верх опори), hazard (небезпечна рідина)} або null
export function support(P, x, y, z, drop = 40) {
  const kTop = Math.floor(z / LEVEL + EPS) - 1, kBot = Math.max(-1, Math.floor((z - drop) / LEVEL));   // нижче світу — камінь
  let best = null;
  for (const [ox, oy] of [[-FOOT, -FOOT], [FOOT, -FOOT], [-FOOT, FOOT], [FOOT, FOOT]]) {
    const tx = Math.floor(x + ox), ty = Math.floor(y + oy);
    for (let k = kTop; k >= kBot; k--) {
      const b = P.block(tx, ty, k);
      if (wall(P, b)) {
        const top = (k + 1) * LEVEL - (b === B_LIQ ? 0.15 : 0);
        if (!best || top > best.z) best = { z: top, hazard: b === B_LIQ };
        break;
      }
    }
  }
  return best;
}

// Рідина, де можна плавати, на висоті тіла: поверхня (z) або null
function liquidAt(P, x, y, z) {
  if (!P.liquid.swim) return null;
  const tx = Math.floor(x), ty = Math.floor(y);
  let k = Math.floor((z + 0.35) / LEVEL);
  if (P.block(tx, ty, k) !== B_LIQ) return null;
  while (P.block(tx, ty, k + 1) === B_LIQ) k++;
  return (k + 1) * LEVEL - 0.15;
}

// Під (x, y) не глибше за drop — поверхня рідини, де можна плавати
function swimBelow(P, x, y, z, drop) {
  if (!P.liquid.swim) return false;
  const tx = Math.floor(x), ty = Math.floor(y);
  for (let k = Math.floor(z / LEVEL + EPS) - 1; k >= 0 && (k + 1) * LEVEL >= z - drop; k--) {
    const b = P.block(tx, ty, k);
    if (b === B_LIQ) return true;
    if (b !== 0) return false;
  }
  return false;
}

// Крок: ix, iy — напрям на екрані (праворуч, униз); jump — стрибок; mb — [праворуч, униз] на землі від камери;
// ctl — {sprint (біг), vert (політ: 1 — угору, −1 — униз)}. p.fly — летить (як у Minecraft: без гравітації, торкнувся
// землі — політ скінчився). p.why — чому не пустило (небезпечна рідина), p.swim — пливе, p.air — у повітрі,
// p.vis — висота для малювання
export function step(p, ix, iy, jump, dt, P, ph = PH1, mb = MB45, ctl = {}) {
  p.why = '';
  if (p.stepOff === undefined) p.stepOff = 0;
  if (p.fly) return fly(p, ix, iy, dt, P, ph, mb, ctl.vert || 0);
  const surf = liquidAt(P, p.x, p.y, p.z);
  const deep = surf !== null && !p.ground;
  p.moving = !!(ix || iy);
  if (p.moving) {
    let vx = ix * mb[0][0] + iy * mb[1][0], vy = ix * mb[0][1] + iy * mb[1][1];
    const run = ctl.sprint ? (surf === null ? SPRINT : 1 + (SPRINT - 1) / 2) : 1;
    const l = Math.hypot(vx, vy), sp = SPEED * ph.speed * run * (surf === null ? 1 : deep ? 0.5 : 0.7) * dt;
    vx /= l; vy /= l;
    p.yaw = Math.atan2(vy, vx);
    const tryMove = (nx, ny) => {
      if (!hits(P, nx, ny, p.z)) {
        if (p.ground && surf === null) {                     // сторожа: не зійти пішки з високого уступу й не ступити в небезпечне
          const g = support(P, nx, ny, p.z, ph.down * LEVEL + 0.02);
          if (g && g.hazard) { p.why = P.liquid.why; return false; }
          if (!g && !swimBelow(P, nx, ny, p.z, (ph.down + CLIMB_OUT) * LEVEL)) return false;   // у воду з берега — можна
        }
        p.x = nx; p.y = ny;
        return true;
      }
      if (p.ground || surf !== null) {                       // крок на уступ (з води — вилізти на берег)
        const maxUp = surf !== null ? CLIMB_OUT : ph.up, base = Math.ceil(p.z / LEVEL - EPS) * LEVEL;
        for (let s = 1; s <= maxUp; s++) {
          const nz = base + s * LEVEL;
          if (nz - p.z > maxUp * LEVEL + EPS) break;
          if (hits(P, p.x, p.y, nz) || hits(P, nx, ny, nz)) continue;
          const g = support(P, nx, ny, nz, 0.01);
          if (!g || g.hazard) continue;
          p.stepOff -= nz - p.z; p.z = nz; p.x = nx; p.y = ny; p.vz = 0; p.ground = true;
          return true;
        }
      }
      return false;
    };
    const nx = p.x + vx * sp, ny = p.y + vy * sp;
    if (!tryMove(nx, ny)) { if (!(vx && tryMove(nx, p.y))) { if (vy) tryMove(p.x, ny); } }
  }
  // Вертикаль: у воді — виштовхує до поверхні (м'яка пружина), інакше — гравітація
  const s2 = liquidAt(P, p.x, p.y, p.z);
  if (s2 !== null && !p.ground) p.vz += ((s2 - FLOAT_Z - p.z) * 22 - p.vz * 7) * dt;
  else p.vz -= GRAVITY * ph.g * dt;
  if (jump && p.ground && s2 === null) p.vz = JUMP_V;
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
  p.swim = s2 !== null && !p.ground;
  p.air = !p.ground && !p.swim;
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
    if (g && nz <= g.z + EPS) { nz = g.z; if (!g.hazard) { p.fly = false; p.ground = true; } }
  } else if (vert > 0 && (nz > FLY_TOP || hits(P, p.x, p.y, nz))) nz = p.z;
  p.z = nz; p.vz = 0;
  p.stepOff *= Math.exp(-dt * ph.settle);
  p.vis = p.z + p.stepOff;
  p.swim = false;
  p.air = !p.ground;
}

// Чи можна стати, ноги в (x, y, z): габарит вільний, не в рідині, і є опора саме під ногами (не небезпечна рідина)
export function standable(P, x, y, z) {
  if (hits(P, x, y, z) || P.block(Math.floor(x), Math.floor(y), Math.floor(z / LEVEL + EPS)) === B_LIQ) return false;
  const g = support(P, x, y, z, 0.01);
  return !!g && !g.hazard && Math.abs(g.z - z) < 0.02;
}
