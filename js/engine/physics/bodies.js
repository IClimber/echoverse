// js/engine/physics/bodies.js — тіла з масою (власна фізика, без рушія): ширяюче каміння, пізніше — речі, істоти. Без DOM.
// Тіло — коробка (піврозміри hx, hy, hz навколо центру x, y, z) з масою. Сили: тяжіння (місцева гравітація × (1 − підйом
// породи)), для левітуючих (lift > 1) — пружина до висоти ширяння над ґрунтом, опір повітря з вітром (квадратичний, від
// площі проєкції й маси).
// Зіткнення з блоками — рух по осях окремо, відскок і тертя від законів всесвіту. Тіло, що спокійно висить чи лежить,
// «спить» (не рахується), поки його не зачеплять. Удар — імпульс / маса: важке ледь зрушить.
// Інтерфейс (положення, швидкість, маса, форма) — такий, щоб за потреби пересадити на фізичний рушій.

// Сталі гри (висота блоку, що тверде, прискорення при 1 g, еталон маси й площі для межі падіння) — задає гра через
// configureBodies; рушій від гри не залежить
let LEVEL = 0.5, solidB = (v) => v > 0, GRAVITY = 25.6, REF_MASS = 70, REF_AREA = 0.47;
export function configureBodies({ level, solid, gravity, refMass = 70, refArea = 0.47 }) {
  LEVEL = level; solidB = solid; GRAVITY = gravity; REF_MASS = refMass; REF_AREA = refArea;
}

const EPS = 1e-4;
const SLEEP_V = 0.06, SLEEP_T = 1.2;         // спокій: швидкість нижче й стільки секунд — засинає
const DENSITY = 1800;                         // маса одиниці об'єму каменю (умовна; еталон — REF_MASS)

// Тіло з опису: {x, y, z (низ), hx, hy, hz, dens (×), lift, hover (висота ширяння низу над ґрунтом у місці появи)}
export function makeBody(o) {
  const b = { vx: 0, vy: 0, vz: 0, yaw: 0, spin: 0, sleep: true, calm: 0, ...o };
  b.z = o.z + o.hz;                           // центр
  b.mass = DENSITY * (o.dens || 1) * 8 * o.hx * o.hy * o.hz;
  // поле породи тримає левітуюче тіло біля місця появи й на висоті появи (alt — центр): над уступом, урвищем чи водою
  // висота та сама, а не відстань до ґрунту під ним (рішення користувача 12.10.2026)
  if ((o.lift || 0) > 1) { b.ax = o.x; b.ay = o.y; b.alt = b.z; }
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

// Дорахунок тіла, що заснуло в русі (сутності: повернулось у зону симуляції): левітуюче — на висоті появи (без неї — на
// висоті ширяння над ґрунтом), поле тримає його тут; у зворотній плямі (eqAt(x, y) — висота рівноваги над ґрунтом чи
// null) — на рівновазі; решта — на опорі. Швидкості — нуль, сон. Ґрунту не знайдено
// (стовпець не завантажено) — де є
export function settle(b, P, eqAt = null) {
  const lev = (b.lift || 0) > 1;
  if (lev && b.alt !== undefined) b.z = b.alt;
  else {
    const gz = groundBelow(P, b.x, b.y, b.z);
    if (gz === null) return false;
    const eq = !lev && eqAt ? eqAt(b.x, b.y) : null;           // зворотна пляма — на висоті рівноваги
    b.z = gz + (eq !== null ? eq : lev ? b.hover || 0 : 0) + b.hz;
  }
  if (lev) { b.ax = b.x; b.ay = b.y; }
  b.vx = b.vy = b.vz = 0; b.sleep = true; b.calm = 0;
  return true;
}

const ANCHOR = 2;                             // пружність поля, що тримає левітуюче тіло біля місця (1/с²)
const CD_BOX = 1.05;                          // коефіцієнт опору коробки (куб гранню до потоку)
// Опір повітря тіла в напрямку (dx, dy, dz) (одиничний): k = ρ·Cd·A/(2m), A — площа проєкції коробки на площину,
// перпендикулярну до напрямку; ρ — з межі падіння гравця vT на цій висоті (k гравця = g₀ / vT² = ρ·CdA_гр / (2m_гр))
function dragK(b, env, dx, dy, dz) {
  const vT = env.vT;
  if (!(vT < 1e8)) return 0;
  const kP = GRAVITY * Math.abs(env.g0 ?? env.g) / (vT * vT);
  const A = 4 * (b.hy * b.hz * Math.abs(dx) + b.hx * b.hz * Math.abs(dy) + b.hx * b.hy * Math.abs(dz));
  return kP * (CD_BOX * A / b.mass) / (REF_AREA / REF_MASS);
}
// Чи зрушить тіло, що спить: тяжіння вгору; вітер — левітуюче: помітне прискорення, на ґрунті — сила вітру більша за
// тертя спокою μ·m·g (вага — за вирахуванням підйому породи)
export function windMoves(b, env) {
  if (env.g < -0.02 && (b.lift || 0) <= 1) return true;      // тяжіння тягне вгору (зворотна пляма, приплив) — прокидається
  const w = env.wind ? Math.hypot(env.wind[0], env.wind[1]) : 0;
  if (!w) return false;
  const a = dragK(b, env, env.wind[0] / w, env.wind[1] / w, 0) * w * w;
  return (b.lift || 0) > 1 ? a > 0.15 : a > GRAVITY * env.g * (1 - Math.min(1, b.lift || 0)) * (env.friction ?? 1);
}

// Крок тіла: P — щуп, env — {g (тяжіння униз у точці, g; може бути ≤ 0 — зворотна пляма, приплив), g0 і vT (тяжіння й
// межа падіння без аномалій — опір повітря), tilt [x, y] (горизонтальне тяжіння, g), rev (зворотна пляма: поле гасить
// вертикальні коливання — тіло зупиняється на висоті рівноваги), bounce, friction, wind [x, y]}
// b.held — у руках (швидкість задає той, хто тримає): без тяжіння, поля й вітру, не спить; зіткнення — як завжди
export function stepBody(b, dt, P, env) {
  const windy = !b.held && windMoves(b, env);
  if (b.held) { b.sleep = false; b.calm = 0; return moveBody(b, dt, P, env); }
  if (b.sleep) { if (!windy) return; b.sleep = false; b.calm = 0; }
  const g = GRAVITY * env.g, lift = b.lift || 0;
  // тяжіння мінус підйом породи; левітуюче — пружина до висоти появи (тіла без неї — до висоти ширяння над ґрунтом;
  // немає ґрунту під — просто висить)
  let az = -g * (1 - Math.min(1, lift));
  if (lift > 1) {
    let target = b.alt;
    if (target === undefined) { const gz = groundBelow(P, b.x, b.y, b.z); target = gz === null ? b.z : gz + b.hover + b.hz; }
    az += (target - b.z) * 6 - b.vz * 2.2;
  }
  // опір повітря з вітром: a = −k·|v_відн|·v_відн, k — від площі проєкції за напрямом руху й маси (важке й компактне
  // падає швидше й менше зноситься; межа падіння — асимптотично, без жорсткої межі)
  const w = env.wind || [0, 0];
  const rx = w[0] - b.vx, ry = w[1] - b.vy, rz = -b.vz, rl = Math.hypot(rx, ry, rz);
  if (rl > 1e-6) {
    const dv = Math.min(rl, dragK(b, env, rx / rl, ry / rl, rz / rl) * rl * rl * dt);
    b.vx += rx / rl * dv; b.vy += ry / rl * dv; b.vz += rz / rl * dv;
  }
  if (env.tilt) { b.vx += env.tilt[0] * GRAVITY * dt; b.vy += env.tilt[1] * GRAVITY * dt; }
  if (env.rev) az -= b.vz * 1.5;
  // левітуюче: поле тримає й по горизонталі — вітер лише відхиляє (легке — далі), після удару — нове місце, де спиниться
  if (lift > 1 && b.ax !== undefined && b.ax !== null) { b.vx += ((b.ax - b.x) * ANCHOR - b.vx * 1.6) * dt; b.vy += ((b.ay - b.y) * ANCHOR - b.vy * 1.6) * dt; }
  b.vz += az * dt;
  moveBody(b, dt, P, env);
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  b.calm = sp < SLEEP_V ? b.calm + dt : 0;
  if (b.calm > SLEEP_T && !windy) { b.sleep = true; b.vx = b.vy = b.vz = 0; }
  if (b.calm > SLEEP_T && lift > 1 && b.ax === null) { b.ax = b.x; b.ay = b.y; }   // після удару спинилось — тут і тримається
}

// Рух зі швидкістю (vx, vy, vz) за dt з зіткненнями з блоками
function moveBody(b, dt, P, env) {
  // рух по осях окремо, дробимо крок, щоб не проскочити крізь тонку стіну
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt / 0.2));
  const h = dt / n, rest = Math.max(0.15, env.bounce || 0.25), fr = env.friction ?? 1;
  for (let i = 0; i < n; i++) {
    for (const ax of ['x', 'y', 'z']) {
      const v = 'v' + ax, d = b[v] * h;
      if (!d) continue;
      const nx = ax === 'x' ? b.x + d : b.x, ny = ax === 'y' ? b.y + d : b.y, nz = ax === 'z' ? b.z + d : b.z;
      if (!boxHits(P, b, nx, ny, nz)) { b[ax] = ax === 'x' ? nx : ax === 'y' ? ny : nz; continue; }
      const vn = b[v];
      b[v] = ax === 'z' && b.vz < 0 && b.vz > -1.5 ? 0 : -b[v] * rest;   // повільно на опору — лягає, швидко — відскакує
      if (ax === 'z') {
        // тертя Кулона об опору (чи стелю): дотичний імпульс — не більше μ × нормального (|Δv_z|); лежить — μ·g·dt за крок
        const vt = Math.hypot(b.vx, b.vy), dvt = fr * Math.abs(b[v] - vn);
        if (vt > 0) { const k = Math.max(0, vt - dvt) / vt; b.vx *= k; b.vy *= k; }
      }
    }
  }
  b.yaw += b.spin * dt;
  b.spin *= Math.exp(-dt * 1.5);
}

// Імпульс (j — вектор маса × швидкість) у тіло: будить
export function push(b, j) {
  b.vx += j[0] / b.mass; b.vy += j[1] / b.mass; b.vz += j[2] / b.mass;
  b.spin += (Math.random() - 0.5) * Math.min(6, Math.hypot(j[0], j[1]) / b.mass * 2);
  b.sleep = false; b.calm = 0;
  if (b.ax !== undefined) b.ax = null;             // удар зриває з місця: поле підхопить там, де тіло спиниться
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

// Зіткнення тіл між собою (після кроку тіл): сітка сусідства 4×4 од. → пари; перекриття коробок → вісь найменшого
// проникнення; розсунути за оберненими масами (у блоки не штовхаємо: що впирається — стоїть, рухається інше), імпульс
// уздовж нормалі з відскоком і тертям (дотичний, не більше 0,5 · тертя · нормальний). Сплячі — як нерухомі перешкоди;
// сильний удар їх будить (левітуюче — зриває з місця). env — {bounce, friction}
const CELL = 4;
export function collideBodies(list, P, env) {
  if (list.length < 2) return;
  const grid = new Map(), seen = new Set(), e = Math.max(0.15, env.bounce || 0), fr = env.friction ?? 1;
  list.forEach((b, i) => {
    for (let gy = Math.floor((b.y - b.hy) / CELL); gy <= Math.floor((b.y + b.hy) / CELL); gy++) for (let gx = Math.floor((b.x - b.hx) / CELL); gx <= Math.floor((b.x + b.hx) / CELL); gx++) {
      const k = gx * 65536 + gy;
      let c = grid.get(k);
      if (!c) grid.set(k, (c = []));
      c.push(i);
    }
  });
  for (const c of grid.values()) for (let p = 0; p < c.length; p++) for (let q = p + 1; q < c.length; q++) {
    const i = Math.min(c[p], c[q]), j = Math.max(c[p], c[q]), pk = i * list.length + j;
    if (seen.has(pk)) continue;
    seen.add(pk);
    const A = list[i], B = list[j];
    if (A.sleep && B.sleep) continue;
    const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
    const ox = A.hx + B.hx - Math.abs(dx), oy = A.hy + B.hy - Math.abs(dy), oz = A.hz + B.hz - Math.abs(dz);
    if (ox <= 0 || oy <= 0 || oz <= 0) continue;
    // нормаль від A до B уздовж осі найменшого проникнення
    let nx = 0, ny = 0, nz = 0, pen;
    if (ox <= oy && ox <= oz) { nx = dx < 0 ? -1 : 1; pen = ox; } else if (oy <= oz) { ny = dy < 0 ? -1 : 1; pen = oy; } else { nz = dz < 0 ? -1 : 1; pen = oz; }
    let ia = A.sleep ? 0 : 1 / A.mass, ib = B.sleep ? 0 : 1 / B.mass;
    if (!ia && !ib) continue;
    // розсунути: частки за оберненими масами; хто впреться в блоки — стоїть, усе — іншому
    let sa = ia / (ia + ib), sb = ib / (ia + ib);
    if (sa && boxHits(P, A, A.x - nx * pen * sa, A.y - ny * pen * sa, A.z - nz * pen * sa)) { sa = 0; sb = 1; ia = 0; }
    else if (sb && boxHits(P, B, B.x + nx * pen * sb, B.y + ny * pen * sb, B.z + nz * pen * sb)) { sb = 0; sa = 1; ib = 0; }
    if (!ia && !ib) continue;
    A.x -= nx * pen * sa; A.y -= ny * pen * sa; A.z -= nz * pen * sa;
    B.x += nx * pen * sb; B.y += ny * pen * sb; B.z += nz * pen * sb;
    const rvx = B.vx - A.vx, rvy = B.vy - A.vy, rvz = B.vz - A.vz, vrel = rvx * nx + rvy * ny + rvz * nz;
    if (vrel >= 0) continue;
    const jn = -(1 + e) * vrel / (ia + ib);
    A.vx -= jn * ia * nx; A.vy -= jn * ia * ny; A.vz -= jn * ia * nz;
    B.vx += jn * ib * nx; B.vy += jn * ib * ny; B.vz += jn * ib * nz;
    // тертя: дотична відносна швидкість гаситься, не більше 0,5 · тертя · jn
    const tx = rvx - vrel * nx, ty = rvy - vrel * ny, tz = rvz - vrel * nz, tl = Math.hypot(tx, ty, tz);
    if (tl > 1e-9) {
      const jt = Math.min(tl / (ia + ib), 0.5 * fr * jn), ux = tx / tl, uy = ty / tl, uz = tz / tl;
      A.vx += jt * ia * ux; A.vy += jt * ia * uy; A.vz += jt * ia * uz;
      B.vx -= jt * ib * ux; B.vy -= jt * ib * uy; B.vz -= jt * ib * uz;
    }
    // сильний удар будить обидва; левітуюче з помітною зміною швидкості — зриває з місця
    if (-vrel > SLEEP_V) for (const [X, inv] of [[A, ia], [B, ib]]) {
      if (X.sleep) { X.sleep = false; X.calm = 0; }
      if (X.ax !== undefined && (inv ? jn * inv : -vrel) > 0.3) X.ax = null;
    }
  }
}
