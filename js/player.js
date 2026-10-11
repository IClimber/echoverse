// player.js — рух гравця: капсула (радіус FOOT, висота BODY) проти того, що малюється (collision.js: трикутники землі,
// призми стовбурів і каміння, коробки тіл; контролер — engine/physics/character.js), гравітація, стрибок, крок на уступ
// і хода схилами, плавання (і в небезпечних рідинах: поки немає здоров'я — лише попередження). Без DOM.
// Позиція — у клітинках (x, y) і висота ніг z у світі; vz — вертикальна швидкість; ground — стоїть на опорі.
// P — доступ до світу: block(x, y, k) → вид блоку (−1 — не згенеровано: стіна), obj(x, y) → перешкода-предмет,
// що росте в клітинці ({cx, cy, z0, z1, r}: центр, низ і верх, півширина) або null, objR — найбільша півширина
// перешкод (скільки клітинок навколо перевіряти), liquid — рідина всесвіту ({swim — тримає на плаву, danger}).
// ph — рух від гравітації (physOf): up, speed, settle, g.
import { LEVEL } from './iso.js';
import { solidB, climbB, climbSide, B_LIQ, B_ICE } from './gen/chunk.js';
import { KMIN } from './universe.js';
import { colliderOf } from './collision.js';
import { capsule, overlap, sweep, findFloor, floorNormal, stands, moveH, moveAir, depenetrate } from './engine/physics/character.js';

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
export const STEP = LEVEL;           // крок на вертикальний уступ (камінь, зрізаний край урвища): сам
const WALK_Z = [Math.cos(50 * Math.PI / 180), Math.cos(65 * Math.PI / 180)];   // схилом угору — до 50° (up 1: уступ в 1 блок
                                     // видимо ≤ 45°) і до 65° (up 2: у 2 блоки — 56°)
export const STAND_Z = 0.17;         // стояти — до 80° (круче — падаєш); між межею ходи й цією — сповзаєш (slideZ)
const SNAP = STEP;                   // схилом униз ноги прилипають до підлоги не глибше за крок
export const SHAPE = capsule(FOOT, BODY);
// Пози (п. 3 roadmap): присів — 1,5 блока (0,72 — пройти видимі 0,75 коридору 1×2); лежить і пливе під рідиною (біг) —
// 0,42 × радіус 0,2 (у лаз 2×1 видимо до 0,483 заввишки). Ноги на місці, форма росте вгору; підвестися — лише якщо
// вільно. Форма не обертається з гравцем (як коробка в Minecraft)
export const CROUCH_H = 0.72, CRAWL_R = 0.2, CRAWL_H = 0.42;
export const SHAPE_C = capsule(FOOT, CROUCH_H, 3), SHAPE_L = capsule(CRAWL_R, CRAWL_H, 2);
export const SHAPES = { stand: SHAPE, crouch: SHAPE_C, crawl: SHAPE_L, swim: SHAPE_L };
export const shapeOf = (p) => SHAPES[p.pose || 'stand'];
const RANK = { crawl: 0, swim: 0, crouch: 1, stand: 2 };
export const SNEAK = 0.3;            // присід і повзання: множник швидкості (sneak у Minecraft — 1,31 / 4,317)
// Лазіння (п. 3 roadmap): по стіні — з витривалістю, по драбині й ліані — легко
export const CLIMB_V = 1.0;          // стіна: од/с при 1 g (× clamp(1/√g; 0,5; 2) × хват)
export const LADDER_V = 2.2;         // драбина, ліана: од/с при 1 g (× clamp(1/√g; 0,7; 1,4))
const GRAB_MIN = 0.15, TIRED_UNTIL = 0.3, REGRAB = 0.4, REGEN = 0.4, REGEN_DELAY = 0.5;
const LEAP_COST = 0.2, LEAP_T = 0.25, LEAP_V = 2.4;   // ривок угору на стіні: +0,6 од за 0,25 с
const GRIP_SLIP = 0.3;               // хват нижче — угору не можна, сповзаєш
const WET_GRIP = 0.6;                // мокра стіна (дощ, сніг під відкритим небом)
const MANTLE = 0.35;                 // виліз нагору: підлога за R + MANTLE від стіни
export const SWIM_V = 2.0;           // під рідиною: угору / униз, од/с (/√в'язкість)
const walkZ = (ph) => WALK_Z[ph.up >= 2 ? 1 : 0];
// посилання трикутника зіткнень (collision.js): тіло (bodies.js) чи предмет (стовбур, камінь — круглі призми)
const isBody = (r) => !!r && r.hz !== undefined;
const round = (r) => !isBody(r);
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

// Блокові перевірки (габарит-коробка проти блоків): пошук місця появи й приземлення — швидко й детерміновано; потім
// settle ставить ноги на видиму поверхню. Чи перетинає габарит у (x, y, z) тверде (блоки чи предмети)
export function hitsB(P, x, y, z) {
  const k0 = Math.floor(z / LEVEL + EPS), k1 = Math.floor((z + BODY) / LEVEL - EPS);
  const x0 = Math.floor(x - FOOT), x1 = Math.floor(x + FOOT), y0 = Math.floor(y - FOOT), y1 = Math.floor(y + FOOT);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) for (let k = k0; k <= k1; k++) {
    const b = P.block(tx, ty, k);
    if (b === -1 || solidB(b)) return true;
  }
  if (objsNear(P, x, y, (o) => over(o, x, y) && z < o.z1 - EPS && z + BODY > o.z0)) return true;
  return !!bodyAtB(P, x, y, z);
}
// Тіло (bodies.js), з яким перетинається габарит у (x, y, z), або null
function bodyAtB(P, x, y, z) {
  if (!P.bodies) return null;
  for (const b of P.bodies(x, y)) {
    if (Math.abs(x - b.x) < b.hx + FOOT && Math.abs(y - b.y) < b.hy + FOOT && z < b.z + b.hz - EPS && z + BODY > b.z - b.hz) return b;
  }
  return null;
}

// Опора під габаритом не нижче за z − drop: {z (верх опори)} або null. Рідина — не опора (liq — опора: поверхневий
// натяг на бігу)
export function supportB(P, x, y, z, drop = 40, liq = false) {
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


// Чи перетинає капсула (sh — форма пози, типово стоячи) у (x, y, z) видиму поверхню, стовбур, камінь чи тіло
export const hits = (P, x, y, z, sh = SHAPE) => !!overlap(colliderOf(P), sh, x, y, z);

// Стійка (≤ 80°) підлога під капсулою не нижче за z − drop: {z, n (нормаль для ходи), body (тіло) | null} або null.
// Рідина — не підлога (liq — підлога: поверхневий натяг на бігу)
export function support(P, x, y, z, drop = 40, liq = false, sh = SHAPE) {
  const f = findFloor(colliderOf(P), sh, x, y, z, drop);
  let best = f && stands(f, STAND_Z) ? { z: f.z, n: floorNormal(f), body: isBody(f.ref) ? f.ref : null } : null;
  if (liq) { const t = liqFloor(P, x, y, z, drop); if (t !== null && (!best || t > best.z)) best = { z: t, n: [0, 0, 1], body: null }; }
  return best;
}

// Чи можна стати, ноги в (x, y, z): капсула вільна, не в рідині, підлога ближче за 0,02
export function standable(P, x, y, z) {
  if (P.block(Math.floor(x), Math.floor(y), Math.floor(z / LEVEL + EPS)) === B_LIQ || hits(P, x, y, z)) return false;
  return !!support(P, x, y, z, 0.02);
}

// Поставити ноги на видиму поверхню біля (x, y, z) — після блокового пошуку місця (поява, приземлення): вільно —
// донизу до підлоги (≤ 0,6); перетин — угору (до 1), потім донизу. Повертає [x, y, z]
export function settle(P, x, y, z) {
  const C = colliderOf(P);
  let zz = z;
  if (overlap(C, SHAPE, x, y, zz)) {
    let k = 1;
    while (k <= 50 && overlap(C, SHAPE, x, y, z + k * 0.02)) k++;
    if (k > 50) return [x, y, z];
    zz = z + k * 0.02;
  }
  const f = findFloor(C, SHAPE, x, y, zz, zz - z + 0.6);
  return [x, y, f && stands(f, STAND_Z) ? f.z : zz];
}

// Поверхня рідини під ногами не нижче за z − drop (на ній стоять при поверхневому натягу) або null
function liqFloor(P, x, y, z, drop) {
  const tx = Math.floor(x), ty = Math.floor(y);
  for (let k = Math.floor((z + 0.15) / LEVEL + EPS) - 1, kb = Math.floor((z - drop + 0.15) / LEVEL) - 1; k >= kb; k--) {
    const b = P.block(tx, ty, k);
    if (b === -1 || solidB(b)) return null;
    if (b !== B_LIQ) continue;
    return P.block(tx, ty, k + 1) === B_LIQ ? null : (k + 1) * LEVEL - 0.15;
  }
  return null;
}

// Блок під ногами (лід — ковзко, розпечена лава — попередження): перший твердий у стовпці під центром
function floorBlock(P, x, y, z) {
  const tx = Math.floor(x), ty = Math.floor(y), k0 = Math.floor((z + 0.2) / LEVEL);
  for (let k = k0; k >= k0 - 3; k--) { const b = P.block(tx, ty, k); if (b === -1 || solidB(b)) return b; }
  return 0;
}

// Рідина на висоті тіла: поверхня (z) або null
export function liquidAt(P, x, y, z) {
  const tx = Math.floor(x), ty = Math.floor(y);
  let k = Math.floor((z + 0.35) / LEVEL);
  if (P.block(tx, ty, k) !== B_LIQ) return null;
  while (P.block(tx, ty, k + 1) === B_LIQ) k++;
  return (k + 1) * LEVEL - 0.15;
}

// Межа стояння за тертям (cos кута): tan θs = μ·tan θw (θw — межа ходи). Звичайний ґрунт — та сама, що хода (на що не
// зійти — з того сповзаєш), лід при 1 g — 10,2°, ковзкий 0,3 — 19,7°
export function slideZ(mu, ph) {
  const wz = walkZ(ph), t = mu * Math.sqrt(1 - wz * wz) / wz;
  return 1 / Math.sqrt(1 + t * t);
}
const tanS = (mu, ph) => { const wz = walkZ(ph); return mu * Math.sqrt(1 - wz * wz) / wz; };

// Підвестися до бажаної пози (want), якщо форма там вільна; нижча — одразу. З лежачи — спершу встати, потім присісти.
// Ширша форма на схилі зачіпає його (капсула висить над схилом на R·(1/cos θ − 1)) — ноги трохи вище, до 0,15
const RISE = [0, 0.03, 0.06, 0.1, 0.15];
function poseTo(p, C, want) {
  if (RANK[p.pose] > RANK[want]) { p.pose = want; return; }
  const fits = (q) => {
    for (const dz of RISE) if (!overlap(C, SHAPES[q], p.x, p.y, p.z + dz)) { p.z += dz; p.stepOff -= dz; p.pose = q; return true; }
    return false;
  };
  if (RANK[p.pose] === RANK[want]) { if (p.pose !== want) fits(want); return; }
  for (const q of want === 'stand' ? ['stand', 'crouch'] : [want]) {
    if (RANK[q] <= RANK[p.pose] || fits(q)) return;
  }
}

// Драбина чи ліана в клітинці центру капсули на висоті тіла (ноги z, висота h): нормаль від стіни [nx, ny] або null
export function climbAt(P, x, y, z, h) {
  const tx = Math.floor(x), ty = Math.floor(y);
  for (let k = Math.floor((z + 0.05) / LEVEL), k1 = Math.floor((z + h - 0.05) / LEVEL); k <= k1; k++) {
    if (!climbB(P.block(tx, ty, k))) continue;
    const n = climbSide(P.block, tx, ty, k);
    if (n) return n;
  }
  return null;
}

// Крок: ix, iy — напрям на екрані (праворуч, униз); jump — стрибок; mb — [праворуч, униз] на землі від камери;
// ctl — {sprint (біг), vert (пробіл − Ctrl: політ і під рідиною — угору / униз), crouch (Ctrl утримується: присісти),
// crouchPress (Ctrl натиснуто: відпустити стіну), wind [x, y] (вітер, клітинок/с), wet (мокро: дощ чи сніг під відкритим
// небом — стіна слизька), carry (тіло в руках: вага / межа 0…1 — повільніше, не лізеш), look [x, y, z] (погляд — біг під
// рідиною)}. p.windPush — вітер зносить на землі. ph.tilt — нахил тяжіння
// (аномалія), P.liquid.visc — в'язкість, P.liquid.tension — поверхневий натяг (на бігу рідина тримає). p.fly — летить (як у Minecraft: без гравітації, торкнувся
// землі — політ скінчився). p.wet — тіло в рідині, p.swim — пливе (рідина тримає, дна немає), p.air — у повітрі,
// p.vis — висота ніг фігури (видима земля під центром, плавно після кроку), p.visX, p.visY — місце фігури, p.jumped — у повітрі після стрибка (інакше — падає),
// p.floorB — блок під ногами, p.floorN — нормаль підлоги, p.onBody — тіло, на якому стоїш.
// Пози: p.pose ('stand' | 'crouch' | 'crawl' | 'swim'), p.h — висота форми; p.slide — сповзає (p.slideA — кут, p.slideS — межа, рад);
// p.dive — під рідиною (Ctrl униз, пробіл угору); p.climb — {kind: 'wall' | 'ladder', nx, ny} (нормаль від стіни) чи null,
// p.stam — витривалість 0…1, p.tired — вичерпана (не чіпляєшся до TIRED_UNTIL), p.mantle — виліз нагору (с, для анімації)
export function step(p, ix, iy, jump, dt, P, ph = PH1, mb = MB45, ctl = {}) {
  if (p.stepOff === undefined) p.stepOff = 0;
  if (p.footOff === undefined) { p.footOff = 0; p.offX = 0; p.offY = 0; }
  if (!p.pose) { p.pose = 'stand'; p.stam = 1; p.stamT = 0; p.noGrab = 0; p.climb = null; p.tired = false; }
  // незгенероване під центром капсули (телепорт у печеру, секції ще в генераторі) — чекати на місці, як перед стіною
  if (P.block(Math.floor(p.x), Math.floor(p.y), Math.floor((p.z + 0.5) / LEVEL)) === -1) { p.vz = 0; p.moving = false; p.vis = p.z + p.stepOff + p.footOff; return; }
  const C = colliderOf(P);
  if (overlap(C, shapeOf(p), p.x, p.y, p.z)) depenetrate(C, shapeOf(p), p);    // тіло налетіло, секцію догенеровано, телепорт
  p.noGrab = Math.max(0, (p.noGrab || 0) - dt);
  p.mantle = Math.max(0, (p.mantle || 0) - dt);
  if (p.fly) {
    p.climb = null; p.dive = false; p.slide = false;
    if (p.pose === 'swim') p.pose = 'crawl';
    poseTo(p, C, 'stand');
    p.h = shapeOf(p).H;
    return fly(p, ix, iy, dt, P, C, ph, mb, ctl.vert || 0, !!ctl.sprint);
  }
  // витривалість відновлюється на землі чи на плаву (після паузи)
  if (!p.climb) {
    if (p.ground || p.swim) { p.stamT = (p.stamT || 0) + dt; if (p.stamT > REGEN_DELAY) p.stam = Math.min(1, p.stam + REGEN * dt); } else p.stamT = 0;
    if (p.tired && p.stam >= TIRED_UNTIL) p.tired = false;
  }
  const wasGround = p.ground;
  p.leap = Math.max(0, (p.leap || 0) - dt);
  const surf = liquidAt(P, p.x, p.y, p.z), buoy = P.liquid.swim, visc = P.liquid.visc || 1, vs = 1 / Math.sqrt(visc);
  const deep = surf !== null && !p.ground, inBuoy = surf !== null && buoy;
  // драбина чи ліана: у повітрі — чіпляєшся сам; на землі — коли йдеш до стіни
  if (!p.climb && !ctl.carry && p.noGrab <= 0 && !(inBuoy && !p.ground) && p.pose !== 'crawl' && p.pose !== 'swim') {
    const n = climbAt(P, p.x, p.y, p.z, shapeOf(p).H);
    if (n) {
      let into = !p.ground;
      if (!into && (ix || iy)) { const vx = ix * mb[0][0] + iy * mb[1][0], vy = ix * mb[0][1] + iy * mb[1][1]; into = vx * -n[0] + vy * -n[1] > 0.3 * Math.hypot(vx, vy); }
      if (into) { p.climb = { kind: 'ladder', nx: n[0], ny: n[1] }; p.vz = 0; p.vx = p.vy = 0; p.jumped = false; }
    }
  }
  if (p.climb && climbStep(p, ix, iy, jump, dt, P, C, ph, ctl)) return finish(p, dt, P, ph);
  // Пірнання (рідина тримає): Ctrl — униз; відпустив і без бігу дійшов до рівня плавання — знову на поверхні.
  // Біг під рідиною (Shift + W, не на дні) — уздовж погляду, поза плавання (низька форма: щілина в 1 блок)
  const swimFast = inBuoy && !p.ground && !!ctl.sprint && iy < 0 && !ctl.carry;
  if (!inBuoy) p.dive = false;
  else if (ctl.crouch || swimFast) p.dive = true;
  else if (p.dive && p.z >= surf - floatZ(P) - 0.05) p.dive = false;
  // Поза: бажана — присів (Ctrl на землі) чи стоячи; під рідиною Ctrl — униз, не присід
  if (p.pose === 'swim' && !inBuoy) p.pose = 'crawl';
  if (swimFast) p.pose = 'swim';
  else poseTo(p, C, ctl.crouch && !inBuoy ? 'crouch' : 'stand');
  let sh = shapeOf(p);
  const low = p.pose !== 'stand' && !inBuoy;            // присів чи лежить на суходолі: повільно, без бігу, з краю не падаєш
  // Горизонтальна швидкість. На землі й у рідині — наздоганяє бажану з прискоренням від тертя: звичайний ґрунт — одразу,
  // ковзкий (закон всесвіту, лід) — розганяєшся й гальмуєш повільно. У повітрі — як у житті: не керуєш (розбіг перед
  // стрибком важить), діють лише опір повітря з вітром і нахил тяжіння
  if (p.vx === undefined) { p.vx = 0; p.vy = 0; }
  const wind = ctl.wind, vT = ph.vT ?? 1e9, gA = GRAVITY * ph.g;
  const mu = p.ground && p.floorB === B_ICE ? 0.15 : ph.friction ?? 1;
  const fnz = p.floorN ? p.floorN[2] : 1;
  p.slide = p.ground && surf === null && fnz < slideZ(mu, ph);
  if (!p.slide) p.sv = null;
  let dirX = 0, dirY = 0;
  if (ix || iy) { const vx = ix * mb[0][0] + iy * mb[1][0], vy = ix * mb[0][1] + iy * mb[1][1], l = Math.hypot(vx, vy); dirX = vx / l; dirY = vy / l; }
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
  } else if (swimFast) {
    // біг під рідиною: уздовж погляду (3D), прискорення 8/с
    const lk = ctl.look || [dirX, dirY, 0], ll = Math.hypot(lk[0], lk[1], lk[2]) || 1, sp = 0.5 * SPEED * ph.speed * SPRINT * vs, a = Math.min(1, 8 * dt);
    p.vx += (lk[0] / ll * sp + ix * mb[0][0] * sp * 0.5 - p.vx) * a; p.vy += (lk[1] / ll * sp + ix * mb[0][1] * sp * 0.5 - p.vy) * a;
    p.vz += (lk[2] / ll * sp - p.vz) * a;
    p.yaw = Math.atan2(lk[1], lk[0]);
  } else {
    let tvx = 0, tvy = 0;
    if (ix || iy) {
      const run = ctl.sprint && !low && !ctl.carry ? (surf === null ? SPRINT : 1 + (SPRINT - 1) / 2) : 1;
      const sp = SPEED * ph.speed * run * (surf === null ? 1 : (deep || !buoy ? 0.5 : 0.7) * vs) * (low ? SNEAK : 1) * (1 - 0.4 * (ctl.carry || 0));
      tvx = dirX * sp; tvy = dirY * sp;
      p.yaw = Math.atan2(dirY, dirX);
    }
    const fr = surf !== null ? 1 : mu;
    // вітер на землі: зносить лише понад vT·√тертя (опір повітря сильніший за тертя; 1 g, 1 атм — ≈ 117 км/год);
    // нахил тяжіння (аномалія) — як схил
    if (wind && surf === null) {
      const wl = Math.hypot(wind[0], wind[1]), th = vT * Math.sqrt(fr);
      p.windPush = wl > th;
      if (wl > th) { tvx += wind[0] / wl * (wl - th); tvy += wind[1] / wl * (wl - th); }
    } else p.windPush = false;
    if (ph.tilt) { tvx += ph.tilt[0] * 9 * ph.g; tvy += ph.tilt[1] * 9 * ph.g; }
    if (p.slide) {
      // сповзання: прискорення вниз схилом g·(sin θ − cos θ·tan θs) (тертя ковзання — те саме, що межа), по горизонталі
      // × cos θ; керування — ×0,3
      const n = p.floorN, l = Math.hypot(n[0], n[1]) || 1, a = Math.max(0, gA * (l - n[2] * tanS(mu, ph))) * n[2];
      p.sv = p.sv || [p.vx, p.vy];
      p.sv[0] += n[0] / l * a * dt; p.sv[1] += n[1] / l * a * dt;
      p.vx = p.sv[0] + tvx * 0.3; p.vy = p.sv[1] + tvy * 0.3;
      p.slideA = Math.acos(Math.min(1, n[2])); p.slideS = Math.atan(tanS(mu, ph));
    } else {
      const acc = fr >= 1 ? 1 : fr * 12 * dt;                  // тертя 1 — одразу; 0,15 — за ~0,5 с
      if (acc >= 1) { p.vx = tvx; p.vy = tvy; }
      else { p.vx += (tvx - p.vx) * acc; p.vy += (tvy - p.vy) * acc; }
    }
  }
  p.moving = !!(ix || iy) || Math.hypot(p.vx, p.vy) > 0.5;
  if (p.vx || p.vy) {
    // на землі — уздовж підлоги, на уступ до кроку — сам (з рідини — на берег до CLIMB_OUT блоків над поверхнею); з
    // уступу — далі прилипання чи падіння. У повітрі — ковзання вздовж того, у що влучив
    const dx = p.vx * dt, dy = p.vy * dt;
    let walls;
    if ((p.ground || surf !== null) && !swimFast) {
      // з рідини на берег — не пірнувши (з глибини — ні: інакше «крок» з дна на кілька одиниць угору)
      const up = surf !== null && !p.dive ? Math.max(STEP, surf + 0.15 + CLIMB_OUT * LEVEL - p.z) : STEP;
      const o = { step: up, walkZ: walkZ(ph), standZ: STAND_Z, floorN: p.ground ? p.floorN : null, round };
      const r = groundMove(p, C, dx, dy, o, low && p.ground ? slideZ(mu, ph) : 0);
      sh = shapeOf(p);
      walls = r.walls;
      if (r.stepped > 0) { if (r.stepped > 0.05) p.stepOff -= r.stepped; p.offX -= r.ex; p.offY -= r.ey; p.vz = 0; p.ground = true; }
    } else {
      walls = moveAir(C, sh, p, dx, dy, 0, STAND_Z, walkZ(ph)).walls;
      // стрибок у стіну: чіпляєшся (у повітрі після стрибка, з введенням до стіни)
      if (!p.ground && surf === null && p.jumped && (dirX || dirY) && grab(p, C, sh, dirX, dirY, ph, ctl)) return finish(p, dt, P, ph);
    }
    for (const [nx, ny] of walls) {                                         // складова в стіну гасне
      const d = p.vx * nx + p.vy * ny; if (d < 0) { p.vx -= d * nx; p.vy -= d * ny; }
      if (p.sv) { const e = p.sv[0] * nx + p.sv[1] * ny; if (e < 0) { p.sv[0] -= e * nx; p.sv[1] -= e * ny; } }
    }
  } else if (!p.ground && surf === null && p.jumped && (dirX || dirY) && grab(p, C, sh, dirX, dirY, ph, ctl)) return finish(p, dt, P, ph);
  // Вертикаль: під рідиною — пробіл / Ctrl, без введення — повільно вгору; у рідині, що тримає, — виштовхує до поверхні
  // (м'яка пружина); у рідкій, що не тримає, — повільно тонеш (опір); інакше — гравітація
  const s2 = liquidAt(P, p.x, p.y, p.z);
  if (s2 !== null && buoy && p.dive) {
    if (!swimFast) {
      const rho = P.liquid.density || 1, tvz = ctl.vert > 0 ? SWIM_V * vs : ctl.vert < 0 ? -SWIM_V * vs : Math.min(2, (0.3 + 1.2 * Math.max(0, rho - 1)) * vs);
      p.vz += (tvz - p.vz) * Math.min(1, 8 * dt);
    }
  } else if (s2 !== null && buoy && !p.ground && !p.leap) p.vz += ((s2 - floatZ(P) - p.z) * 22 / visc - p.vz * 7 * Math.sqrt(visc)) * dt;
  else if (s2 !== null && !buoy) p.vz += (-GRAVITY * ph.g * 0.35 / visc - p.vz * 4 * visc) * dt;
  else {
    // опір повітря: падіння не швидше за vT; пробіл під час падіння — ширяння (у густому повітрі помітно):
    // межу досягнуто — далі не швидше; уже швидше за межу (почав ширяти) — плавно гальмуєш до неї
    const vT = (ph.vT ?? 1e9) * (ctl.vert > 0 && p.vz < 0 ? 0.45 : 1), v0 = p.vz;
    p.vz -= GRAVITY * ph.g * dt;
    if (p.vz < -vT) p.vz = v0 >= -vT ? -vT : v0 + (-vT - v0) * Math.min(1, dt * 6);
  }
  p.glide = !p.ground && s2 === null && ctl.vert > 0 && p.vz < 0;
  if (jump && p.pose !== 'crawl' && p.pose !== 'swim') {
    if (p.ground) { p.vz = JUMP_V * (s2 === null ? 1 : 0.85); p.jumped = true; }
    else if (s2 !== null && buoy && !p.dive && p.z > s2 - floatZ(P) - 0.25) { p.vz = JUMP_V * 0.8; p.leap = LEAP; }   // з поверхні — вистрибнути
  }
  const onLiq = !!P.liquid.tension && !!ctl.sprint && p.moving && s2 === null && !low;   // поверхневий натяг: на бігу рідина тримає
  p.floor = null;
  if (p.vz > 0) {
    if (moveAir(C, sh, p, 0, 0, p.vz * dt, STAND_Z).ceil) p.vz = 0;   // стеля
    p.ground = false; p.onBody = null;
  } else {
    // підлога в межах падіння за крок; на землі — ще й прилипання схилом униз (на вигляд схил: ноги лишаються на землі,
    // вигляд опускається плавно); стійкої немає — падаєш (крутий схил — ковзаєш уздовж нього)
    const drop = -p.vz * dt, snap = wasGround && s2 === null ? SNAP : 0;
    // поверхня рідини (натяг) нижча за падіння за крок — підлогу шукаємо до неї: інакше гравця ставило б на поверхню крізь
    // крутий берег між ними (стрес-тест, 11.10.2026)
    const lt = onLiq ? liqFloor(P, p.x, p.y, p.z, drop + snap) : null;
    const f = findFloor(C, sh, p.x, p.y, p.z, lt !== null ? Math.max(drop + snap, p.z - lt) : drop + snap), st = stands(f, STAND_Z);
    const fz = lt !== null && (!f || lt > f.z) ? lt : st ? f.z : null;
    if (fz !== null) {
      if (p.z - drop - fz > 0.05) p.stepOff += p.z - fz;
      p.z = fz;
      // пружний ґрунт: після падіння відскакуєш (слабкий удар — ні)
      if (ph.bounce && p.vz < -5 && s2 === null) { p.vz = -p.vz * ph.bounce; p.ground = false; p.bounced = true; }
      else { p.vz = 0; p.ground = true; p.jumped = false; }
      const onF = fz !== lt;
      p.onBody = onF && isBody(f.ref) ? f.ref : null;
      p.floorN = onF ? floorNormal(f) : null;
      p.floor = onF ? f : null;
    } else {
      moveAir(C, sh, p, 0, 0, -drop, STAND_Z);
      p.ground = false; p.onBody = null;
    }
  }
  finish(p, dt, P, ph);
}

// Хода землею; присів чи лежить на землі (guard — межа сповзання, cos) — з краю не падаєш, як maybeBackOffFromEdge у
// Minecraft: після руху під формою немає підлоги ближче за крок, з якої не сповзаєш (куля на ребрі урвища — дотик крутий),
// — хід скасовано, тоді лише x, лише y. Присів і не пройшов (< 20 %) — лягаєш, якщо лежачи проходиш (≥ 50 %)
function groundMove(p, C, dx, dy, o, guard) {
  const x0 = p.x, y0 = p.y, z0 = p.z, want = Math.hypot(dx, dy);
  const tryMove = (sh, ax, ay) => {
    p.x = x0; p.y = y0; p.z = z0;
    const r = moveH(C, sh, p, ax, ay, o);
    if (guard) {
      const f = findFloor(C, sh, p.x, p.y, p.z, STEP + 0.05);
      if (!stands(f, guard)) { p.x = x0; p.y = y0; p.z = z0; return null; }
    }
    return { walls: r.walls.slice(), stepped: r.stepped, ex: r.ex, ey: r.ey };
  };
  const along = (sh) => tryMove(sh, dx, dy) || (dx && dy && (tryMove(sh, dx, 0) || tryMove(sh, 0, dy))) || null;
  const moved = () => Math.hypot(p.x - x0, p.y - y0);
  let r = along(shapeOf(p));
  if (p.pose === 'crouch' && p.ground && moved() < want * 0.2) {
    const keep = r ? [p.x, p.y, p.z] : null;
    const rl = along(SHAPE_L);
    if (rl && moved() >= want * 0.5) { p.pose = 'crawl'; return rl; }
    if (keep) { p.x = keep[0]; p.y = keep[1]; p.z = keep[2]; } else { p.x = x0; p.y = y0; p.z = z0; }
  }
  return r || { walls: [], stepped: 0, ex: 0, ey: 0 };
}

// Чіплятися за стіну в стрибку: рух форми на 0,12 у напрямку введення влучає в поверхню, крутішу за межу ходи (не тіло,
// не стелю), і введення — до неї (кут < 60°); витривалість є, тіла в руках немає
function grab(p, C, sh, dirX, dirY, ph, ctl) {
  if (ctl.carry || p.pose !== 'stand' || p.noGrab > 0 || p.tired || p.stam < GRAB_MIN) return false;
  const h = sweep(C, sh, p.x, p.y, p.z, dirX * 0.12, dirY * 0.12, 0);
  if (!h || isBody(h.ref) || h.nz < -0.2 || h.nz >= walkZ(ph)) return false;
  const l = Math.hypot(h.nx, h.ny);
  if (l < 0.3) return false;
  const nx = h.nx / l, ny = h.ny / l;
  if (-(dirX * nx + dirY * ny) < 0.5) return false;
  const adv = Math.max(0, h.t - SKIN_C / 0.12);
  p.x += dirX * 0.12 * adv; p.y += dirY * 0.12 * adv;
  p.climb = { kind: 'wall', nx, ny };
  p.vx = p.vy = p.vz = 0; p.jumped = false; p.ground = false; p.leapT = 0;
  p.yaw = Math.atan2(-ny, -nx);
  return true;
}
const SKIN_C = 0.002;

// Лазіння: W / S — угору / униз, A / D — праворуч / ліворуч (гравець дивиться в стіну), пробіл — ривок (стіна) чи
// зістрибнути (драбина), Ctrl — відпустити. Щокроку — знову до стіни (нормаль нова: стовбур обходиш по колу); стіни
// не стало — угорі вилазиш, інакше зриваєшся. true — крок зроблено (ще на стіні чи виліз), false — відпустив
function climbStep(p, ix, iy, jump, dt, P, C, ph, ctl) {
  const cl = p.climb, wall = cl.kind === 'wall', sh = shapeOf(p), g = ph.g;
  const release = (stun = REGRAB) => { p.climb = null; p.noGrab = stun; p.leapT = 0; return false; };
  if (ctl.crouchPress || ctl.carry || p.pose !== 'stand') return release();
  const wz = walkZ(ph);
  // хват: тертя стіни (лід — 0,15), мокра — ×0,6
  let grip = 1;
  if (wall) {
    const bx = Math.floor(p.x - cl.nx * (sh.R + 0.3)), by = Math.floor(p.y - cl.ny * (sh.R + 0.3));
    const ice = P.block(bx, by, Math.floor((p.z + 0.5) / LEVEL)) === B_ICE;
    grip = (ice ? 0.15 : ph.friction ?? 1) * (ctl.wet ? WET_GRIP : 1);
  }
  p.grip = grip;
  const up = -iy, side = ix;
  const v = wall ? CLIMB_V * clamp(1 / Math.sqrt(g), 0.5, 2) * Math.min(1, grip / 0.6) : LADDER_V * clamp(1 / Math.sqrt(g), 0.7, 1.4);
  let vz = up * v, slip = false;
  if (wall && grip < GRIP_SLIP) { slip = true; vz = Math.min(up < 0 ? -v : 0, -2 * (1 - grip / GRIP_SLIP) * clamp(Math.sqrt(g), 0.5, 2)); }
  if (jump) {
    if (!wall) {
      // з драбини — зістрибнути від стіни
      p.climb = null; p.noGrab = REGRAB;
      p.vx = cl.nx * 2; p.vy = cl.ny * 2; p.vz = JUMP_V * 0.6; p.jumped = true; p.ground = false;
      return true;
    }
    const cost = LEAP_COST * clamp(g, 0.25, 3);
    if (p.stam >= cost && !slip) { p.stam -= cost; p.leapT = LEAP_T; }
  }
  if (p.leapT > 0) { vz += LEAP_V; p.leapT = Math.max(0, p.leapT - dt); }
  // праворуч від того, хто дивиться в стіну (−n): трійка осей дзеркальна (camera.js), праворуч = (n_y, −n_x)
  const rx = cl.ny * side * v, ry = -cl.nx * side * v;
  const z0 = p.z;
  moveAir(C, sh, p, rx * dt, ry * dt, vz * dt, STAND_Z);
  p.vx = rx; p.vy = ry; p.vz = vz;
  p.moving = !!(up || side) || p.leapT > 0 || slip;
  p.climbD = (p.climbD || 0) + Math.hypot(rx * dt, ry * dt, p.z - z0);    // пройдене (фаза анімації)
  // витривалість (стіна): у русі більше, вага — від гравітації, слизька — більше, сповзання — удвічі
  if (wall) {
    p.stam -= ((up || side) ? 0.1 : 0.06) * clamp(g, 0.25, 3) * Math.max(1, 0.6 / Math.max(grip, 0.05)) * (slip ? 2 : 1) * dt;
    p.stamT = 0;
    if (p.stam <= 0) { p.stam = 0; p.tired = true; release(); return false; }
  }
  // униз до стійкої підлоги — стоїш
  if (vz < 0 || slip) {
    const f = findFloor(C, sh, p.x, p.y, p.z, 0.05);
    if (f && stands(f, wz)) { p.z = f.z; p.climb = null; p.ground = true; p.vz = 0; p.floorN = floorNormal(f); p.floor = f; p.noGrab = REGRAB; return true; }
  }
  // знову до стіни (нова нормаль); драбина — поки в клітинці драбини
  let n = null;
  if (wall) {
    const h = sweep(C, sh, p.x, p.y, p.z, -cl.nx * 0.15, -cl.ny * 0.15, 0);
    const l = h ? Math.hypot(h.nx, h.ny) : 0;
    if (h && !isBody(h.ref) && h.nz >= -0.2 && h.nz < wz && l > 0.3) {
      const adv = Math.max(0, h.t - SKIN_C / 0.15);
      p.x -= cl.nx * 0.15 * adv; p.y -= cl.ny * 0.15 * adv;
      n = [h.nx / l, h.ny / l];
    }
  } else n = climbAt(P, p.x, p.y, p.z, sh.H);
  if (n) { cl.nx = n[0]; cl.ny = n[1]; p.yaw = Math.atan2(-cl.ny, -cl.nx); p.ground = false; return true; }
  // стіни не стало: ішов угору — вилазиш нагору, інакше зриваєшся
  if ((vz > 0 || up > 0) && mantle(p, C, sh, ph, cl.nx, cl.ny)) return true;
  release();
  p.vx = p.vy = 0;
  return false;
}

// Виліз нагору: підлога за R + MANTLE від стіни (пошук від z + 0,9 униз на 1,4), прохідна, форма там вільна й прямо
// над місцем теж. Вигляд — плавно (stepOff, offX / offY)
function mantle(p, C, sh, ph, nx, ny) {
  // стіна — упритул, драбина — на відстані до клітинки: далі на чверть, доки підлога під центром не прохідна (не скіс краю)
  // і не нижча за ноги (не щабель драбини); під центром — поверхня (промінь), а не верхній край ліани
  let f = null, fx = 0, fy = 0;
  for (let d = sh.R + MANTLE; d <= sh.R + MANTLE + 0.76 && !f; d += 0.25) {
    fx = p.x - nx * d; fy = p.y - ny * d;
    const q = findFloor(C, sh, fx, fy, p.z + 0.9, 1.4);
    if (q && q.z >= p.z - 0.1 && q.nU && q.nU[2] >= walkZ(ph) && !overlap(C, sh, fx, fy, q.z) && !(q.z > p.z && overlap(C, sh, p.x, p.y, q.z))) f = q;
  }
  if (!f) return false;
  p.stepOff += p.z - f.z; p.offX += p.x - fx; p.offY += p.y - fy;
  p.x = fx; p.y = fy; p.z = f.z;
  p.climb = null; p.ground = true; p.vz = 0; p.vx = p.vy = 0; p.leapT = 0;
  p.floorN = floorNormal(f); p.floor = f; p.mantle = 0.3; p.noGrab = REGRAB;
  return true;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Кінець кроку: вигляд (уступ, ноги на видимій землі), блок під ногами, рідина
function finish(p, dt, P, ph) {
  p.stepOff *= Math.exp(-dt * ph.settle);
  visXY(p, dt, ph);
  // ноги фігури — на видиму землю під центром (на схилі капсула висить над нею на R·(1/cos θ − 1): 45° — 0,1, 56° — 0,19)
  const fu = p.ground && p.floor && p.floor.zU !== null ? p.floor.zU - p.z : 0;
  p.footOff += ((fu <= 0 && fu >= -0.2 ? fu : 0) - p.footOff) * Math.min(1, dt * 20);
  p.vis = p.z + p.stepOff + p.footOff;
  p.floorB = p.ground ? floorBlock(P, p.x, p.y, p.z) : 0;
  const s3 = liquidAt(P, p.x, p.y, p.z);
  p.wet = s3 !== null;
  p.swim = p.wet && P.liquid.swim && !p.ground && !p.climb;
  p.air = !p.ground && !p.wet && !p.climb;
  p.h = shapeOf(p).H;
  if (!p.ground) p.slide = false;
}

// Вигляд по горизонталі: крок на уступ, що зрушив далі за рух (край уступу), — плавно, як stepOff по висоті
function visXY(p, dt, ph) {
  const k = Math.exp(-dt * ph.settle);
  p.offX *= k; p.offY *= k;
  p.visX = p.x + p.offX; p.visY = p.y + p.offY;
}

// Політ: ковзає вздовж стін, рідини не тримають і не заважають; униз до стійкої підлоги — політ скінчився (у рідину —
// теж). vert — пробіл (угору) − Ctrl (униз); Shift — по горизонталі вдвічі швидше (як у Minecraft)
function fly(p, ix, iy, dt, P, C, ph, mb, vert, fast) {
  const sh = shapeOf(p);
  p.moving = !!(ix || iy);
  if (p.moving) {
    let vx = ix * mb[0][0] + iy * mb[1][0], vy = ix * mb[0][1] + iy * mb[1][1];
    const l = Math.hypot(vx, vy), sp = FLY_SPEED * (fast ? 2 : 1) * dt / l;
    vx *= sp; vy *= sp;
    p.yaw = Math.atan2(vy, vx);
    moveAir(C, sh, p, vx, vy, 0, 2);
  }
  const dz = vert * FLY_V * dt;
  p.ground = false;
  if (dz < 0) {
    const f = findFloor(C, sh, p.x, p.y, p.z, -dz);
    if (f && stands(f, STAND_Z)) { p.z = f.z; p.fly = false; p.ground = true; p.vz = 0; p.floor = f; p.floorN = floorNormal(f); }
    else { moveAir(C, sh, p, 0, 0, dz, 2); if (liquidAt(P, p.x, p.y, p.z) !== null) p.fly = false; }   // у рідину — політ скінчився
  } else if (dz > 0 && p.z + dz <= FLY_TOP) moveAir(C, sh, p, 0, 0, dz, 2);
  p.vz = 0;
  p.stepOff *= Math.exp(-dt * ph.settle);
  visXY(p, dt, ph);
  p.footOff *= Math.exp(-dt * 20);
  p.vis = p.z + p.stepOff + p.footOff;
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

// Блокове «чи можна стати», ноги в (x, y, z): габарит вільний, не в рідині, і є опора саме під ногами
export function standableB(P, x, y, z) {
  if (hitsB(P, x, y, z) || P.block(Math.floor(x), Math.floor(y), Math.floor(z / LEVEL + EPS)) === B_LIQ) return false;
  const g = supportB(P, x, y, z, 0.01);
  return !!g && Math.abs(g.z - z) < 0.02;
}
