// gen/mesh.js — геометрія пласких граней: земля чанка, рослини, каміння, фігури. Без DOM і WebGL — лише масиви:
// позиції (float32 ×3), нормалі (int8 ×3), кольори (uint8 ×3), матеріали (uint8 — шар текстури), індекси.
// Світло, туман і текстуру (за матеріалом, координати — проєкцією на площину грані) додає шейдер.
// Земля — з блоків: грань лише між твердим і порожнім.
import { CS, ci, bi, H, O_TREE, O_FLOAT, O_COVER, solidB, B_AIR, B_LIQ, B_ICE, B_SAND, B_GRASS, B_DRY, B_DESERT, B_SNOW, B_ROCK, B_BED, B_MUD, B_SOIL, B_STONE, B_SANDSTONE } from './chunk.js';
import { L_LAVA, SEA } from '../universe.js';
import { LEVEL } from '../iso.js';
import { template, place } from './plants.js';
import { groundTint } from './flora.js';
import { M_FLAT, M_ROCK, M_CLIFF, M_WATER, M_LAVA, M_ICE, M_SAND, M_LUSH, M_DRY, M_DESERT, M_SNOW, M_BED, M_MUD, M_SOIL, M_SANDSIDE, M_LIP } from './materials.js';

export const shade = (c, k) => [Math.min(255, c[0] * k | 0), Math.min(255, c[1] * k | 0), Math.min(255, c[2] * k | 0)];
const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k | 0, a[1] + (b[1] - a[1]) * k | 0, a[2] + (b[2] - a[2]) * k | 0];

export class Mesh {
  constructor() { this.p = []; this.nr = []; this.c = []; this.mt = []; this.i = []; this.n = 0; }
  vert(x, y, z, nx, ny, nz, c, m) {
    this.p.push(x, y, z); this.nr.push(nx, ny, nz); this.c.push(c[0], c[1], c[2]); this.mt.push(m);
    return this.n++;
  }
  // Чотирикутник a-b-c-d (точки [x, y, z]) з однією нормаллю (одиничний вектор); mat — матеріал (materials.js)
  quad(a, b, c, d, nx, ny, nz, col, mat = M_FLAT) {
    const N = [nx * 127 | 0, ny * 127 | 0, nz * 127 | 0], i = this.n;
    for (const q of [a, b, c, d]) this.vert(q[0], q[1], q[2], N[0], N[1], N[2], col, mat);
    this.i.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  // Трикутник; нормаль — з векторного добутку (лише вигляд, тож sqrt тут дозволений),
  // повернута вгору (up) чи вниз (низ ширяючого каменя)
  tri(a, b, c, col, up = true, mat = M_FLAT) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const s = ((nz < 0) === up ? -127 : 127) / l, i = this.n;
    for (const q of [a, b, c]) this.vert(q[0], q[1], q[2], nx * s | 0, ny * s | 0, nz * s | 0, col, mat);
    this.i.push(i, i + 1, i + 2);
  }
  // Ящик: верх і чотири бічні грані (низу не видно)
  box(x0, y0, z0, x1, y1, z1, col, mat = M_FLAT) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, col, mat);
    this.quad([x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0], 1, 0, 0, col, mat);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0, col, mat);
    this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], -1, 0, 0, col, mat);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], 0, -1, 0, col, mat);
  }
  // Піраміда з квадратною основою (усі 4 грані: у пласких пірамід видно й задні)
  pyr(cx, cy, z0, r, h, col, mat = M_FLAT) {
    const top = [cx, cy, z0 + h], A = [cx - r, cy - r, z0], B = [cx + r, cy - r, z0], C = [cx + r, cy + r, z0], D = [cx - r, cy + r, z0];
    this.tri(B, C, top, col, true, mat); this.tri(C, D, top, col, true, mat); this.tri(D, A, top, col, true, mat); this.tri(A, B, top, col, true, mat);
  }
  // Перевернута піраміда: основа вгорі (zTop), вістря внизу
  spike(cx, cy, zTop, r, h, col, mat = M_FLAT) {
    const bot = [cx, cy, zTop - h], A = [cx - r, cy - r, zTop], B = [cx + r, cy - r, zTop], C = [cx + r, cy + r, zTop], D = [cx - r, cy + r, zTop];
    this.tri(B, C, bot, col, false, mat); this.tri(C, D, bot, col, false, mat); this.tri(D, A, bot, col, false, mat); this.tri(A, B, bot, col, false, mat);
  }
  finish() {
    const idx = this.n > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i);
    return { pos: new Float32Array(this.p), nor: new Int8Array(this.nr), col: new Uint8Array(this.c), mat: new Uint8Array(this.mt), idx, count: this.i.length };
  }
}

// ================= Земля чанка (блоки) =================
// Грань блоку — лише там, де сусід не твердий (повітря чи рідина). Однакові грані в одному шарі зливаються
// в прямокутники (верх і низ — у двох напрямках, боки — уздовж ряду): так вершин у рази менше.
// Позиції — локальні (0…16 по x і y), висота — k · LEVEL. Меші: тверде, поверхня рідини (окремо, напівпрозоро),
// рослини й каміння зблизька (flora: повна будова, трава й квіти) і здалеку (far: спрощені великі рослини й каміння).
// Трава, степ і пустеля — відтінку біому клітинки (межі біомів — усереднення по сусідах 3×3)
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export function chunkMesh(C, L) {
  const M = new Mesh(), W = new Mesh(), P = L.pal, B = C.b;
  const COL = [], TOPM = [], SIDEM = [];
  COL[B_ICE] = P.ice; COL[B_SAND] = P.sand; COL[B_GRASS] = P.lush; COL[B_DRY] = P.dry; COL[B_DESERT] = P.desert; COL[B_SNOW] = P.snow;
  COL[B_ROCK] = P.rock; COL[B_BED] = P.bed; COL[B_MUD] = shade(P.bed, 1.15); COL[B_SOIL] = P.soil; COL[B_STONE] = shade(P.rock, 0.82);
  COL[B_SANDSTONE] = shade(P.sand, 0.82);
  TOPM[B_ICE] = M_ICE; TOPM[B_SAND] = M_SAND; TOPM[B_GRASS] = M_LUSH; TOPM[B_DRY] = M_DRY; TOPM[B_DESERT] = M_DESERT; TOPM[B_SNOW] = M_SNOW;
  TOPM[B_ROCK] = M_ROCK; TOPM[B_BED] = M_BED; TOPM[B_MUD] = M_MUD; TOPM[B_SOIL] = M_SOIL; TOPM[B_STONE] = M_CLIFF; TOPM[B_SANDSTONE] = M_SANDSIDE;
  SIDEM[B_ICE] = M_ICE; SIDEM[B_SAND] = M_SANDSIDE; SIDEM[B_GRASS] = M_SOIL; SIDEM[B_DRY] = M_SOIL; SIDEM[B_DESERT] = M_SANDSIDE; SIDEM[B_SNOW] = M_SNOW;
  SIDEM[B_ROCK] = M_CLIFF; SIDEM[B_BED] = M_SOIL; SIDEM[B_MUD] = M_SOIL; SIDEM[B_SOIL] = M_SOIL; SIDEM[B_STONE] = M_CLIFF; SIDEM[B_SANDSTONE] = M_SANDSIDE;
  const LIP = new Set([B_GRASS, B_DRY, B_SNOW]);
  const lavaish = L.liquid.kind === L_LAVA;
  // Відтінок біому: колір блоку b у біомі bm; у клітинці — середнє по сусідах 3×3 (округлене: однакові зливаються)
  const tinted = new Map();
  const tintOf = (b, bm) => {
    const k = b * 256 + bm;
    let c = tinted.get(k);
    if (!c) tinted.set(k, c = groundTint(L, b === B_GRASS ? 'lush' : b === B_DRY ? 'dry' : 'desert', bm));
    return c;
  };
  const colOf = (b, x, y) => {
    if (b !== B_GRASS && b !== B_DRY && b !== B_DESERT) return COL[b];
    let r = 0, g = 0, bl = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = Math.max(-1, Math.min(CS, x + i)), yy = Math.max(-1, Math.min(CS, y + j)), c = tintOf(b, C.bm[ci(xx, yy)] || 0);
      r += c[0]; g += c[1]; bl += c[2];
    }
    return [Math.round(r / 27) * 3, Math.round(g / 27) * 3, Math.round(bl / 27) * 3];
  };
  // Вигляд грані: [матеріал, колір]; глибоко під поверхнею клітинки (печери) — темніше, сходинками
  const look = (b, d, x, y, k) => {
    const hc = C.h[ci(x, y)], dark = k < hc - 3 ? Math.max(0.45, 1 - 0.12 * Math.floor((hc - 3 - k) / 3 + 1)) : 1;
    let m, c;
    if (d === 4) { m = TOPM[b]; c = b === B_BED ? shade(COL[b], 0.62 + 0.38 * k / SEA) : colOf(b, x, y); }
    else if (d === 5) { m = SIDEM[b]; c = shade(COL[b === B_GRASS || b === B_DRY ? B_SOIL : b], 0.8); }
    else if (LIP.has(b) && !solidB(B[bi(x, y, k + 1)])) { m = b === B_SNOW ? M_SNOW : M_LIP; c = shade(colOf(b, x, y), 0.86); }
    else { m = SIDEM[b]; c = shade(b === B_DESERT ? colOf(b, x, y) : COL[b === B_GRASS || b === B_DRY ? B_SOIL : b], k & 1 ? 1 : 0.92); }
    return [m, dark === 1 ? c : shade(c, dark)];
  };
  const key = (lk) => lk[0] * 16777216 + (lk[1][0] << 16 | lk[1][1] << 8 | lk[1][2]);
  const mask = new Float64Array(CS * CS), looks = new Array(CS * CS);
  for (let k = 0; k < H; k++) {
    // Верх (d = 4) і низ (d = 5): маска шару 16×16, жадібне злиття прямокутників
    for (const d of [4, 5]) {
      const dk = d === 4 ? 1 : -1;
      let any = false;
      for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
        const b = B[bi(x, y, k)], i = y * CS + x, nk = k + dk;
        const nb = nk < 0 ? B_STONE : nk >= H ? B_AIR : B[bi(x, y, nk)];
        if (solidB(b) && !solidB(nb)) { const lk = look(b, d, x, y, k); mask[i] = key(lk) + 1; looks[i] = lk; any = true; } else mask[i] = 0;
      }
      if (!any) continue;
      const z = (d === 4 ? k + 1 : k) * LEVEL, nz = d === 4 ? 1 : -1;
      for (let y = 0; y < CS; y++) for (let x = 0; x < CS; ) {
        const m = mask[y * CS + x];
        if (!m) { x++; continue; }
        let w = 1; while (x + w < CS && mask[y * CS + x + w] === m) w++;
        let h = 1;
        grow: while (y + h < CS) { for (let q = 0; q < w; q++) if (mask[(y + h) * CS + x + q] !== m) break grow; h++; }
        for (let yy = 0; yy < h; yy++) for (let q = 0; q < w; q++) mask[(y + yy) * CS + x + q] = 0;
        const [mt, c] = looks[y * CS + x];
        M.quad([x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z], 0, 0, nz, c, mt);
        x += w;
      }
    }
    // Боки: уздовж ряду (для ±x — уздовж y, для ±y — уздовж x)
    const z0 = k * LEVEL, z1 = z0 + LEVEL;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      for (let r = 0; r < CS; r++) {
        let run = 0, rk = 0, rl = null;
        const flush = (end) => {
          if (!run) return;
          const s0 = end - run, [mt, c] = rl;
          if (dx) { const X = dx > 0 ? r + 1 : r; M.quad([X, s0, z1], [X, end, z1], [X, end, z0], [X, s0, z0], dx, 0, 0, c, mt); }
          else { const Y = dy > 0 ? r + 1 : r; M.quad([s0, Y, z1], [end, Y, z1], [end, Y, z0], [s0, Y, z0], 0, dy, 0, c, mt); }
          run = 0;
        };
        for (let s = 0; s < CS; s++) {
          const x = dx ? r : s, y = dx ? s : r, b = B[bi(x, y, k)];
          let kk = 0, lk = null;
          if (solidB(b) && !solidB(B[bi(x + dx, y + dy, k)])) { lk = look(b, d, x, y, k); kk = key(lk) + 1; }
          if (kk !== rk) { flush(s); rk = kk; rl = lk; }
          if (kk) run++;
        }
        flush(CS);
      }
    }
  }
  // Поверхня рідини: верхній блок рідини під повітрям (трохи нижче за край блоку)
  for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) for (let k = 0; k < H; k++) {
    if (B[bi(x, y, k)] !== B_LIQ || B[bi(x, y, k + 1)] !== B_AIR) continue;
    const z = (k + 1) * LEVEL - 0.15, c = mixc(P.liquid, P.liquidDeep, Math.min(1, C.v[ci(x, y)] / 160));
    W.quad([x, y, z], [x + 1, y, z], [x + 1, y + 1, z], [x, y + 1, z], 0, 0, 1, c, lavaish ? M_LAVA : M_WATER);
  }
  // Рослини й каміння: шаблон виду (варіант будови — від хешу) з поворотом, віком, нахилом і розкидом кольору
  const F = new Mesh(), Ff = new Mesh();
  for (const o of C.obj) {
    const z = o.z * LEVEL, v = o.v, g = C.sp[o.s];
    const cx = o.x + 0.5 + ((v & 15) / 15 - 0.5) * 0.24, cy = o.y + 0.5 + ((v >> 4 & 15) / 15 - 0.5) * 0.24;
    const rot = (v >> 8 & 255) / 256 * Math.PI * 2, age = (v >> 12 & 15) / 15, k = 0.92 + 0.16 * ((v >> 3 & 7) / 7);
    const cj = [k * (0.97 + 0.06 * (v >> 6 & 3) / 3), k, k * (0.97 + 0.06 * (v >> 1 & 3) / 3)];
    if (o.k === O_TREE) {
      const s = 0.6 + 0.8 * age, tl = ((v >> 2 & 7) / 7) * 0.1;
      place(F, template(g, v % 3, 0), cx, cy, z, rot, s, tl, cj);
      place(Ff, template(g, 0, 1), cx, cy, z, rot, s, tl, cj);
    } else if (o.k === O_COVER) place(F, template(g, v & 1, 0), cx, cy, z, rot, 0.6 + 0.8 * age, 0, cj);
    else if (o.k === O_FLOAT) { floater(F, cx, cy, z, g.leaf, v); floater(Ff, cx, cy, z, g.leaf, v); }
    else {
      const T = template(g, v & 3, 0, styleOf(g, v));
      place(F, T, cx, cy, z, rot, 0.8 + 0.4 * age, 0, cj); place(Ff, T, cx, cy, z, rot, 0.8 + 0.4 * age, 0, cj);
    }
  }
  return { solid: M.finish(), liquid: W.n ? W.finish() : null, flora: F.n ? F.finish() : null, far: Ff.n ? Ff.finish() : null };
}

// Стиль каміння клітинки — з ваг стилів області
function styleOf(g, v) {
  let sum = 0;
  for (const [, w] of g.styles) sum += w;
  let u = ((v * 2654435761 >>> 0) / 4294967296) * sum;
  for (const [s, w] of g.styles) { u -= w; if (u < 0) return s; }
  return g.styles[0][0];
}

// Ширяючий камінь (легка гравітація): брила з вістрям донизу, на висоті 1,2…2,6 над землею — вище за гравця
function floater(M, cx, cy, z, rockCol, v) {
  const f = (v >> 8 & 255) / 255, r = 0.18 + 0.2 * f, c = shade(rockCol, 0.9 + 0.2 * ((v >> 4 & 15) / 15));
  const base = z + 1.2 + 1.4 * ((v >> 6 & 15) / 15), top = base + 0.12 + 0.2 * f;
  M.box(cx - r, cy - r, base, cx + r, cy + r, top, c, M_ROCK);
  M.spike(cx, cy, base, r, 0.25 + 0.35 * f, shade(c, 0.85), M_CLIFF);
}

// ================= Фігура гравця =================
// Частини окремими мешами (для анімації): тулуб із головою й пристроєм, дві ноги, дві руки.
// Локальні координати: ноги в (0, 0, 0), обличчя — у бік +x; ліва сторона — +y. PIVOT — суглоби (кульш, плече)
export const FIG_K = 1.25;
export const PIVOT = { hip: 0.28 * FIG_K, shoulder: 0.58 * FIG_K, legY: 0.08 * FIG_K, armY: 0.21 * FIG_K };
export function figureParts(color) {
  const dark = [40, 38, 48], skin = [236, 200, 170], dev = [120, 240, 255], k = FIG_K;
  const part = (boxes) => {
    const M = new Mesh();
    for (const [x0, y0, z0, x1, y1, z1, c] of boxes) M.box(x0 * k, y0 * k, z0 * k, x1 * k, y1 * k, z1 * k, c);
    return M.finish();
  };
  return {
    core: part([
      [-0.13, -0.17, 0.28, 0.11, 0.17, 0.62, color],
      [-0.25, -0.12, 0.32, -0.13, 0.12, 0.58, dev],                // пристрій для стрибків — на спині
      [-0.11, -0.12, 0.62, 0.11, 0.12, 0.84, skin],
      [0.11, -0.08, 0.71, 0.125, -0.03, 0.77, dark],
      [0.11, 0.03, 0.71, 0.125, 0.08, 0.77, dark],
    ]),
    legL: part([[-0.08, 0.02, 0, 0.06, 0.14, 0.28, dark]]),
    legR: part([[-0.08, -0.14, 0, 0.06, -0.02, 0.28, dark]]),
    armL: part([[-0.05, 0.17, 0.33, 0.05, 0.25, 0.6, color], [-0.05, 0.17, 0.3, 0.05, 0.25, 0.34, skin]]),
    armR: part([[-0.05, -0.25, 0.33, 0.05, -0.17, 0.6, color], [-0.05, -0.25, 0.3, 0.05, -0.17, 0.34, skin]]),
  };
}
