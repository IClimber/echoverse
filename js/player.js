// player.js — рух гравця у світі з блоків: габарит (FOOT × FOOT × BODY) проти блоків і предметів, гравітація, стрибок,
// автоматичний крок на уступ, плавання (і в небезпечних рідинах: поки немає здоров'я — лише попередження). Без DOM.
// Позиція — у клітинках (x, y) і висота ніг z у світі; vz — вертикальна швидкість; ground — стоїть на опорі.
// P — доступ до світу: block(x, y, k) → вид блоку (−1 — не згенеровано: стіна), obj(x, y) → перешкода-предмет,
// що росте в клітинці ({cx, cy, z0, z1, r}: центр, низ і верх, півширина) або null, objR — найбільша півширина
// перешкод (скільки клітинок навколо перевіряти), liquid — рідина всесвіту ({swim — тримає на плаву, danger}).
// ph — рух від гравітації (physOf): up, speed, settle, g.
import { LEVEL } from './iso.js';
import { solidB, B_LIQ, B_ICE } from './gen/chunk.js';
import { KMIN } from './universe.js';

export const SPEED = 4.2;            // клітинок за секунду (при 1 g)
export const FOOT = 0.24;            // півширина габариту
export const BODY = 0.98;            // висота габариту (2 блоки)
export const PLAYER_MASS = 70;                // маса гравця (тисне тіло, на якому стоїть; штовхає)
export const PLAYER_AREA = 0.47;              // площа гравця проти вітру (2 · FOOT × BODY)
export const HIT_IMPULSE = 150;               // удар гравця (маса × швидкість): камінчик — ~6 од/с, брила — ледь
export const GRAVITY = 25.6;         // прискорення при 1 g, одиниць/с²
export const JUMP_V = 7.67;          // поштовх стрибка: при 1 g — 1,15 одиниці (2 блоки) і 0,6 с у повітрі
export const FLOAT_Z = 0.6;          // той, хто пливе у воді, тримається ногами на стільки нижче поверхні (густіша — вище)
export const SPRINT = 1.6;           // біг (Shift): множник швидкості пішки (у воді — половина надбавки)
export const FLY_SPEED = 12;         // політ: клітинок за секунду по горизонталі
export const FLY_V = 8;              // політ: швидкість угору / униз
const FLY_TOP = 2040;                // політ: вище цієї висоти не піднятися (майже верх світу)
const CLIMB_OUT = 2;                 // з рідини можна вилізти на берег до 2 блоків над її поверхнею
const LEAP = 0.3;                    // стрибок з рідини: стільки секунд рідина не тягне назад
export const PH1 = { up: 1, speed: 1, settle: 14, g: 1, vT: 1e9, friction: 1, bounce: 0 };
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
  if (objsNear(P, x, y, (o) => over(o, x, y) && z < o.z1 - EPS && z + BODY > o.z0)) return true;
  return !!bodyAt(P, x, y, z);
}
// Тіло (bodies.js), з яким перетинається габарит у (x, y, z), або null
export function bodyAt(P, x, y, z) {
  if (!P.bodies) return null;
  for (const b of P.bodies(x, y)) {
    if (Math.abs(x - b.x) < b.hx + FOOT && Math.abs(y - b.y) < b.hy + FOOT && z < b.z + b.hz - EPS && z + BODY > b.z - b.hz) return b;
  }
  return null;
}

// Опора під габаритом не нижче за z − drop: {z (верх опори)} або null. Рідина — не опора (liq — опора: поверхневий
// натяг на бігу)
export function support(P, x, y, z, drop = 40, liq = false) {
  const kTop = Math.floor(z / LEVEL + EPS) - 1, kBot = Math.max(KMIN - 1, Math.floor((z - drop) / LEVEL));   // нижче світу — камінь
  let best = null;
  for (const [ox, oy] of [[-FOOT, -FOOT], [FOOT, -FOOT], [-FOOT, FOOT], [FOOT, FOOT]]) {
    const tx = Math.floor(x + ox), ty = Math.floor(y + oy);
    for (let k = liq ? kTop + 1 : kTop; k >= kBot; k--) {
      const b = P.block(tx, ty, k);
      if (k > kTop && (b !== B_LIQ || (k + 1) * LEVEL - 0.15 > z + EPS)) continue;   // поверхня рідини — нижче краю блоку
      if (b === -1 || solidB(b) || (liq && b === B_LIQ)) {
        const top = (k + 1) * LEVEL - (b === B_LIQ ? 0.15 : 0);
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
  // верх тіла (ширяючий камінь): на нього можна стати
  if (P.bodies) for (const b of P.bodies(x, y)) {
    const top = b.z + b.hz;
    if (Math.abs(x - b.x) < b.hx + FOOT && Math.abs(y - b.y) < b.hy + FOOT && top <= z + EPS && top >= z - drop && (!best || top > best.z)) best = { z: top, body: b };
  }
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
// ctl — {sprint (біг), vert (політ: 1 — угору, −1 — униз), wind [x, y] (вітер, клітинок/с)}. p.windPush — вітер зносить на землі. ph.tilt — нахил тяжіння
// (аномалія), P.liquid.visc — в'язкість, P.liquid.tension — поверхневий натяг (на бігу рідина тримає). p.fly — летить (як у Minecraft: без гравітації, торкнувся
// землі — політ скінчився). p.wet — тіло в рідині, p.swim — пливе (рідина тримає, дна немає), p.air — у повітрі,
// p.vis — висота для малювання, p.jumped — у повітрі після стрибка (інакше — падає)
export function step(p, ix, iy, jump, dt, P, ph = PH1, mb = MB45, ctl = {}) {
  if (p.stepOff === undefined) p.stepOff = 0;
  if (p.fly) return fly(p, ix, iy, dt, P, ph, mb, ctl.vert || 0);
  const wasGround = p.ground;
  p.leap = Math.max(0, (p.leap || 0) - dt);
  const surf = liquidAt(P, p.x, p.y, p.z), buoy = P.liquid.swim, visc = P.liquid.visc || 1, vs = 1 / Math.sqrt(visc);
  const deep = surf !== null && !p.ground;
  // Горизонтальна швидкість. На землі й у рідині — наздоганяє бажану з прискоренням від тертя: звичайний ґрунт — одразу,
  // ковзкий (закон всесвіту, лід) — розганяєшся й гальмуєш повільно. У повітрі — як у житті: не керуєш (розбіг перед
  // стрибком важить), діють лише опір повітря з вітром і нахил тяжіння
  if (p.vx === undefined) { p.vx = 0; p.vy = 0; }
  const wind = ctl.wind, vT = ph.vT ?? 1e9, gA = GRAVITY * ph.g;
  if (!p.ground && surf === null) {
    // опір ∝ густина × швидкість²: прискорення g·(v_відн / vT)² (vT — межа падіння; ширяння — більший опір)
    if (wind) {
      const rx = wind[0] - p.vx, ry = wind[1] - p.vy, rl = Math.hypot(rx, ry);
      if (rl > 1e-6) {
        const vTh = p.glide ? vT * 0.45 : vT, dv = Math.min(rl, gA * (rl / vTh) * (rl / vTh) * dt);
        p.vx += rx / rl * dv; p.vy += ry / rl * dv;
      }
    }
    if (ph.tilt) { p.vx += ph.tilt[0] * gA * dt; p.vy += ph.tilt[1] * gA * dt; }
  } else {
    let tvx = 0, tvy = 0;
    if (ix || iy) {
      let vx = ix * mb[0][0] + iy * mb[1][0], vy = ix * mb[0][1] + iy * mb[1][1];
      const run = ctl.sprint ? (surf === null ? SPRINT : 1 + (SPRINT - 1) / 2) : 1;
      const l = Math.hypot(vx, vy), sp = SPEED * ph.speed * run * (surf === null ? 1 : (deep || !buoy ? 0.5 : 0.7) * vs);
      tvx = vx / l * sp; tvy = vy / l * sp;
      p.yaw = Math.atan2(vy, vx);
    }
    const under = p.ground ? P.block(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z / LEVEL + EPS) - 1) : 0;
    const fr = surf !== null ? 1 : under === B_ICE ? 0.15 : ph.friction ?? 1;
    // вітер на землі: зносить лише понад vT·√тертя (опір повітря сильніший за тертя; 1 g, 1 атм — ≈ 117 км/год);
    // нахил тяжіння (аномалія) — як схил
    if (wind && surf === null) {
      const wl = Math.hypot(wind[0], wind[1]), th = vT * Math.sqrt(fr);
      p.windPush = wl > th;
      if (wl > th) { tvx += wind[0] / wl * (wl - th); tvy += wind[1] / wl * (wl - th); }
    } else p.windPush = false;
    if (ph.tilt) { tvx += ph.tilt[0] * 9 * ph.g; tvy += ph.tilt[1] * 9 * ph.g; }
    const acc = fr >= 1 ? 1 : fr * 12 * dt;                  // тертя 1 — одразу; 0,15 — за ~0,5 с
    if (acc >= 1) { p.vx = tvx; p.vy = tvy; }
    else { p.vx += (tvx - p.vx) * acc; p.vy += (tvy - p.vy) * acc; }
  }
  p.moving = !!(ix || iy) || Math.hypot(p.vx, p.vy) > 0.5;
  if (p.vx || p.vy) {
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
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
    if (!tryMove(nx, ny)) {                                   // уперся — ковзає вздовж стіни, складова в стіну гасне
      if (p.vx && tryMove(nx, p.y)) p.vy = 0;
      else if (p.vy && tryMove(p.x, ny)) p.vx = 0;
      else { p.vx = 0; p.vy = 0; }
    }
  }
  // Вертикаль: у рідині, що тримає, — виштовхує до поверхні (м'яка пружина); у рідкій, що не тримає, — повільно
  // тонеш (опір); інакше — гравітація
  const s2 = liquidAt(P, p.x, p.y, p.z);
  if (s2 !== null && buoy && !p.ground && !p.leap) p.vz += ((s2 - floatZ(P) - p.z) * 22 / visc - p.vz * 7 * Math.sqrt(visc)) * dt;
  else if (s2 !== null && !buoy) p.vz += (-GRAVITY * ph.g * 0.35 / visc - p.vz * 4 * visc) * dt;
  else {
    // опір повітря: падіння не швидше за vT; пробіл під час падіння — ширяння (у густому повітрі помітно):
    // межу досягнуто — далі не швидше; уже швидше за межу (почав ширяти) — плавно гальмуєш до неї
    const vT = (ph.vT ?? 1e9) * (ctl.vert > 0 && p.vz < 0 ? 0.45 : 1), v0 = p.vz;
    p.vz -= GRAVITY * ph.g * dt;
    if (p.vz < -vT) p.vz = v0 >= -vT ? -vT : v0 + (-vT - v0) * Math.min(1, dt * 6);
  }
  p.glide = !p.ground && s2 === null && ctl.vert > 0 && p.vz < 0;
  if (jump) {
    if (p.ground) { p.vz = JUMP_V * (s2 === null ? 1 : 0.85); p.jumped = true; }
    else if (s2 !== null && buoy && p.z > s2 - floatZ(P) - 0.25) { p.vz = JUMP_V * 0.8; p.leap = LEAP; }   // з поверхні — вистрибнути
  }
  let nz = p.z + p.vz * dt;
  const onLiq = !!P.liquid.tension && !!ctl.sprint && p.moving && s2 === null;   // поверхневий натяг: на бігу рідина тримає
  if (p.vz <= 0) {
    const g = support(P, p.x, p.y, p.z + EPS, p.z - nz + 0.05, onLiq);
    if (g && nz <= g.z + EPS) {
      nz = g.z;
      // пружний ґрунт: після падіння відскакуєш (слабкий удар — ні)
      if (ph.bounce && p.vz < -5 && s2 === null) { p.vz = -p.vz * ph.bounce; p.ground = false; p.bounced = true; }
      else { p.vz = 0; p.ground = true; p.jumped = false; }
      p.onBody = g.body || null;
    } else {
      // плавний спуск (уступ не вищий за крок угору — на вигляд схил): ноги лишаються на землі, вигляд опускається
      // плавно; глибше — падаєш
      const d = wasGround && s2 === null ? support(P, p.x, p.y, p.z + EPS, ph.up * LEVEL + 0.05) : null;
      if (d) { p.stepOff += p.z - d.z; nz = d.z; p.vz = 0; p.ground = true; p.onBody = d.body || null; }
      else { p.ground = false; p.onBody = null; }
    }
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

// Затишок від вітру для тіла з ногами в (x, y, z): множник вітру 0…1. Перешкода з навітряного боку вище за пояс (блоки,
// стовбур, камінь) ближче за 3 клітинки — вітру немає, до 4,5 — слабшає; під стелею (печера, навіс) — не дує, якщо з навітряного
// боку стіна ближче за 16 клітинок (у вхід печери, відкритий вітру, дує)
const LEE = 3, LEE_FADE = 1.5, CAVE_LEE = 16, ROOF = 48;
export function windShelter(P, x, y, z, wind) {
  const w = Math.hypot(wind[0], wind[1]);
  if (w < 1e-6) return 1;
  const ux = -wind[0] / w, uy = -wind[1] / w, k0 = Math.floor(z / LEVEL + EPS);
  let roof = false;
  for (let k = k0 + 2; k <= k0 + ROOF; k++) { const b = P.block(Math.floor(x), Math.floor(y), k); if (b !== -1 && solidB(b)) { roof = true; break; } }
  const R = roof ? CAVE_LEE : LEE + LEE_FADE;
  for (let d = 0.4; d <= R; d += 0.25) {
    const px = x + ux * d, py = y + uy * d, tx = Math.floor(px), ty = Math.floor(py);
    let hit = false;
    for (const dz of [0.55, 0.9]) { const b = P.block(tx, ty, Math.floor((z + dz) / LEVEL)); if (b !== -1 && solidB(b)) { hit = true; break; } }   // вище за пояс: уступ у блок — не стіна
    if (!hit) hit = objsNear(P, px, py, (o) => Math.abs(px - o.cx) < o.r + 0.1 && Math.abs(py - o.cy) < o.r + 0.1 && z + 0.55 < o.z1 && z + 0.9 > o.z0);
    if (hit) return roof || d <= LEE ? 0 : (d - LEE) / LEE_FADE;
  }
  return 1;
}

// Чи можна стати, ноги в (x, y, z): габарит вільний, не в рідині, і є опора саме під ногами
export function standable(P, x, y, z) {
  if (hits(P, x, y, z) || P.block(Math.floor(x), Math.floor(y), Math.floor(z / LEVEL + EPS)) === B_LIQ) return false;
  const g = support(P, x, y, z, 0.01);
  return !!g && Math.abs(g.z - z) < 0.02;
}
