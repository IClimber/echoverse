// camera.js — камера: ізометрія (орто, обертається) і третя особа (перспектива, за спиною). Лише вигляд, без DOM.
// Камера дивиться на ціль (гравця); у шейдер ідуть координати відносно цілі. Напрям від цілі до камери —
// азимут yaw і нахил pitch: u = (cos p · cos yaw, cos p · sin yaw, sin p). Екранні осі: праворуч r = (sin yaw, −cos yaw, 0),
// угору up = (−sin p · cos yaw, −sin p · sin yaw, cos p). Ця трійка — дзеркальна (як і була фіксована ізометрія:
// +x — униз-праворуч, +y — униз-ліворуч), однакова в обох режимах, тож світ при перемиканні не віддзеркалюється.
import { S, LEVEL } from './iso.js';
import { CS } from './gen/chunk.js';

export const ISO = 'iso', THIRD = 'third';
const D2R = Math.PI / 180;
export const LIMITS = {
  iso: { pitch: [20 * D2R, 75 * D2R], zoom: [0.45, 2.5] },
  third: { pitch: [-70 * D2R, 80 * D2R], dist: [2.5, 16] },   // від'ємний нахил — погляд угору (eyeDir)
};
export const FOV = 55 * D2R;
// Дальність (третя особа) — налаштування гравця, 8–32 чанки (setViewChunks; живі прив'язки ES-модулів — імпортери бачать нове)
export let VIEW_R = 256;             // повні секції (клітинок)
export let FAR_R = 1400;             // далечінь (плитки поверхні, gen/far.js), далі — туман і небо
export let SEAM = VIEW_R - 8;        // шов: ближче — повні секції, далі — плитки далечі
export function setViewChunks(c) {
  c = Math.max(8, Math.min(32, c | 0));
  VIEW_R = c * CS; SEAM = VIEW_R - 8; FAR_R = Math.max(1400, Math.round(VIEW_R * 2.75));
  return c;
}
export const HEAD = 1.0;             // третя особа: камера дивиться на висоту голови
// Третя особа: куди дивиться камера (по горизонталі) — туди обернений гравець, спиною до камери
export const facing = (c) => c.yaw + Math.PI;

export function createCamera(mode = ISO) {
  const c = { mode, yaw: 0, pitch: 30 * D2R, zoom: 1.4, dist: 7, pitch3: 20 * D2R, distT: 7, zoomT: 1.4 };
  setYaw(c, Math.PI / 4);
  c.pitchT = c.pitch; c.pitch3T = c.pitch3;
  return c;
}
// Миттєво (перемикання вигляду, старт): і поточний кут, і ціль
export function setYaw(c, yaw) { c.yaw = c.yawT = yaw; }

const SENS = 0.0022;                 // радіан на піксель руху миші

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const pitchOf = (c) => c.mode === ISO ? c.pitch : c.pitch3;

// Третя особа: напрям від цілі до ока. Нахил угору (від'ємний) не опускає камеру під землю — вона лишається за
// спиною на висоті голови, а вгору повертається лише погляд (гравець — унизу екрана)
export function eyeDir(c) {
  const p = Math.max(0, pitchOf(c)), cp = Math.cos(p);
  return [cp * Math.cos(c.yaw), cp * Math.sin(c.yaw), Math.sin(p)];
}

export function basis(c) {
  const p = pitchOf(c), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  return { r: [sy, -cy, 0], up: [-sp * cy, -sp * sy, cp], u: [cp * cy, cp * sy, sp] };
}

// Напрями руху на землі для WASD: праворуч і «униз екрана» (до камери) — одиничні горизонтальні вектори
export function moveBasis(c) {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  return [[sy, -cy], [cy, sy]];
}

// Обертання мишею (px) і масштаб коліщатком: миша праворуч — погляд праворуч, униз — погляд униз
// Поворот задає ціль, а камера плавно її наздоганяє (smooth) — без ривків
export function rotate(c, dx, dy) {
  c.yawT += dx * SENS;
  if (c.mode === ISO) c.pitchT = clamp(c.pitchT + dy * SENS * 0.8, ...LIMITS.iso.pitch);
  else c.pitch3T = clamp(c.pitch3T + dy * SENS * 0.8, ...LIMITS.third.pitch);
}
export function wheel(c, w) {
  if (c.mode === ISO) c.zoomT = clamp(c.zoomT * Math.exp(-w * 0.0012), ...LIMITS.iso.zoom);
  else c.distT = clamp(c.distT * Math.exp(w * 0.0012), ...LIMITS.third.dist);
}
export function smooth(c, dt) {
  const k = Math.min(1, dt * 10), r = Math.min(1, dt * 16);
  c.zoom += (c.zoomT - c.zoom) * k;
  c.dist += (c.distT - c.dist) * k;
  c.yaw += (c.yawT - c.yaw) * r;
  c.pitch += (c.pitchT - c.pitch) * r;
  c.pitch3 += (c.pitch3T - c.pitch3) * r;
}

// Матриця «відносно цілі → clip» (стовпцями) і положення ока відносно цілі.
// dist — відстань до ока в третій особі (після зіткнення з рельєфом)
export function viewProj(c, W, H, dist = c.dist) {
  const { r, up, u } = basis(c);
  if (c.mode === ISO) {
    const sx = 2 * S * c.zoom / W, sy = 2 * S * c.zoom / H, k = -1 / 400;
    return {
      m: new Float32Array([r[0] * sx, up[0] * sy, u[0] * k, 0, r[1] * sx, up[1] * sy, u[1] * k, 0, r[2] * sx, up[2] * sy, u[2] * k, 0, 0, 0, 0, 1]),
      eye: [u[0] * 400, u[1] * 400, u[2] * 400], ortho: true,
    };
  }
  const e = eyeDir(c), eye = [e[0] * dist, e[1] * dist, e[2] * dist];
  const f = 1 / Math.tan(FOV / 2), near = 0.1, far = FAR_R * 1.6, A = (far + near) / (near - far), B = 2 * far * near / (near - far);
  const fx = f * H / W;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const tr = -dot(r, eye), tu = -dot(up, eye), tz = -dot(u, eye);
  // clip = P · V; V: рядки r, up, u (з переносом); P: перспектива
  return {
    m: new Float32Array([
      r[0] * fx, up[0] * f, u[0] * A, -u[0],
      r[1] * fx, up[1] * f, u[1] * A, -u[1],
      r[2] * fx, up[2] * f, u[2] * A, -u[2],
      tr * fx, tu * f, tz * A + B, -tz,
    ]), eye, ortho: false,
  };
}

// Точка (відносно цілі) → [x, y] у CSS px екрана і глибина gl_FragCoord.z; null — за камерою
export function project(m, p, W, H) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (w <= 1e-6) return null;
  return [(x / w + 1) / 2 * W, (1 - y / w) / 2 * H, (z / w + 1) / 2];
}

// Чанки, які треба малювати: у радіусі R (клітинок) від цілі й у піраміді видимості (кути об'єму чанка в clip).
// target — ціль у світі; zr — [найнижча, найвища] висота світу. Повертає [{cx, cy, dist2}], ближчі першими
export function chunksInView(m, target, R, zr) {
  const out = [], c0x = Math.floor((target[0] - R) / CS), c1x = Math.floor((target[0] + R) / CS);
  const c0y = Math.floor((target[1] - R) / CS), c1y = Math.floor((target[1] + R) / CS);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    const ax = cx * CS - target[0], ay = cy * CS - target[1], mx = ax + CS / 2, my = ay + CS / 2;
    const d2 = mx * mx + my * my;
    if (d2 > (R + CS * 0.71) * (R + CS * 0.71)) continue;
    if (!boxInView(m, ax, ay, zr[0] - target[2], zr[1] - target[2])) continue;
    out.push({ cx, cy, dist2: d2 });
  }
  return out.sort((a, b2) => a.dist2 - b2.dist2);
}

// Чи потрапляє в піраміду видимості коробка size×size клітинок (за замовчуванням — чанк) з кутом (ax, ay) і висотами z0…z1 (відносно цілі)
export function boxInView(m, ax, ay, z0, z1, size = CS) {
  let l = 0, rr = 0, b = 0, t = 0, back = 0;
  for (let k = 0; k < 8; k++) {
    const x = ax + (k & 1 ? size : 0), y = ay + (k & 2 ? size : 0), z = k & 4 ? z1 : z0;
    const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Wc = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (X < -Wc) l++; if (X > Wc) rr++; if (Y < -Wc) b++; if (Y > Wc) t++; if (Wc <= 0) back++;
  }
  return !(l === 8 || rr === 8 || b === 8 || t === 8 || back === 8);
}

// Довільна коробка (відносно цілі): хоч частково в піраміді видимості (aabbInView) / уся всередині (aabbInside)
export function aabbInView(m, x0, y0, z0, x1, y1, z1) {
  let l = 0, rr = 0, b = 0, t = 0, back = 0;
  for (let k = 0; k < 8; k++) {
    const x = k & 1 ? x1 : x0, y = k & 2 ? y1 : y0, z = k & 4 ? z1 : z0;
    const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Wc = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (X < -Wc) l++; if (X > Wc) rr++; if (Y < -Wc) b++; if (Y > Wc) t++; if (Wc <= 0) back++;
  }
  return !(l === 8 || rr === 8 || b === 8 || t === 8 || back === 8);
}
export function aabbInside(m, x0, y0, z0, x1, y1, z1) {
  for (let k = 0; k < 8; k++) {
    const x = k & 1 ? x1 : x0, y = k & 2 ? y1 : y0, z = k & 4 ? z1 : z0;
    const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Wc = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (Wc <= 0 || X < -Wc || X > Wc || Y < -Wc || Y > Wc) return false;
  }
  return true;
}

// Ізометрія: радіус, що покриває екран (кути екрана на найнижчій і найвищій площині)
export function isoRadius(c, W, H, zr, targetZ) {
  const { r, up, u } = basis(c), hw = W / 2 / (S * c.zoom), hh = H / 2 / (S * c.zoom);
  let R = 0;
  for (const sx of [-hw, hw]) for (const sy of [-hh, hh]) for (const Z of zr) {
    const t = (Z - targetZ - sy * up[2]) / u[2];
    const x = sx * r[0] + sy * up[0] + t * u[0], y = sx * r[1] + sy * up[1] + t * u[1];
    R = Math.max(R, Math.hypot(x, y));
  }
  return R + 4;
}

// Третя особа: відстань до ока, щоб камера не заходила в блоки й рідину за спиною. solid(x, y, z) → чи там тверде.
// Промінь «товстий» (5 паралельних на відстані PAD — ближня площина не чіпляє стіну збоку); результат треба
// згладжувати (camDist): скорочувати одразу, відновлювати плавно — інакше на краях блоків камера тремтить
const PAD = 0.22;
export function clipDist(c, target, solid) {
  const u = eyeDir(c), { r, up } = basis(c);
  const offs = [[0, 0], [PAD, 0], [-PAD, 0], [0, PAD], [0, -PAD]];
  for (let t = 0.1; t <= c.dist; t += 0.1) {
    for (const [a, b] of offs) {
      const x = target[0] + u[0] * t + r[0] * a + up[0] * b, y = target[1] + u[1] * t + r[1] * a + up[1] * b, z = target[2] + u[2] * t + up[2] * b;
      if (solid(Math.floor(x), Math.floor(y), z)) return Math.max(0.15, t - PAD);
    }
  }
  return c.dist;
}
// Згладжена відстань: ближче — одразу, далі — плавно (≈ 4 одиниці за секунду на старті)
export function camDist(prev, want, dt) {
  if (prev === undefined || want < prev) return want;
  return prev + (want - prev) * Math.min(1, dt * 4);
}
export { LEVEL };
