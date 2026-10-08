// gen/mesh.js — геометрія пласких граней: земля чанка, рослини, каміння, фігури. Без DOM і WebGL — лише масиви:
// позиції (float32 ×3), нормалі (int8 ×3), кольори (uint8 ×3), матеріали (uint8 — шар текстури), індекси.
// Світло, туман і текстуру (за матеріалом, координати — проєкцією на площину грані) додає шейдер.
// Земля — з блоків: грань лише між твердим і порожнім.
import { CS, CW, ci, bv, H, O_TREE, O_FLOAT, O_COVER, solidB, B_AIR, B_LIQ, B_ICE, B_SAND, B_GRASS, B_DRY, B_DESERT, B_SNOW, B_ROCK, B_BED, B_MUD, B_SOIL, B_STONE, B_SANDSTONE, B_MAGMA, B_FLOAT } from './chunk.js';
import { L_LAVA, SEA, gravityAt } from '../universe.js';
import { LEVEL } from '../iso.js';
import { template, place, footprint } from './plants.js';
import { groundTint } from './flora.js';
import { M_FLAT, M_ROCK, M_CLIFF, M_WATER, M_LAVA, M_ICE, M_SAND, M_LUSH, M_DRY, M_DESERT, M_SNOW, M_BED, M_MUD, M_SOIL, M_SANDSIDE, M_LIP } from './materials.js';

export const shade = (c, k) => [Math.min(255, c[0] * k | 0), Math.min(255, c[1] * k | 0), Math.min(255, c[2] * k | 0)];
const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k | 0, a[1] + (b[1] - a[1]) * k | 0, a[2] + (b[2] - a[2]) * k | 0];

// Меш: типізовані масиви, що ростуть ×2 (без push у JS-масиви); значення перетворюються так само, як у finish
// (float32, int8, uint8 із загортанням)
export class Mesh {
  constructor(cap = 256) {
    this.p = new Float32Array(cap * 3); this.nr = new Int8Array(cap * 3); this.c = new Uint8Array(cap * 3); this.mt = new Uint8Array(cap);
    this.i = new Uint32Array(cap * 2); this.n = 0; this.ni = 0;
  }
  // Місце ще на nv вершин і nidx індексів
  room(nv, nidx) {
    if (this.n + nv > this.mt.length) {
      let c = this.mt.length * 2;
      while (c < this.n + nv) c *= 2;
      const g = (a, k) => { const b = new a.constructor(c * k); b.set(a); return b; };
      this.p = g(this.p, 3); this.nr = g(this.nr, 3); this.c = g(this.c, 3); this.mt = g(this.mt, 1);
    }
    if (this.ni + nidx > this.i.length) {
      let c = this.i.length * 2;
      while (c < this.ni + nidx) c *= 2;
      const b = new Uint32Array(c); b.set(this.i); this.i = b;
    }
  }
  vert(x, y, z, nx, ny, nz, c, m) {
    this.room(1, 0);
    const n = this.n, j = n * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.nr[j] = nx; this.nr[j + 1] = ny; this.nr[j + 2] = nz;
    this.c[j] = c[0]; this.c[j + 1] = c[1]; this.c[j + 2] = c[2]; this.mt[n] = m;
    return this.n++;
  }
  idx(a, b, c) { this.room(0, 3); const i = this.i, k = this.ni; i[k] = a; i[k + 1] = b; i[k + 2] = c; this.ni = k + 3; }
  // Чотирикутник a-b-c-d (точки [x, y, z]) з однією нормаллю (одиничний вектор); mat — матеріал (materials.js)
  quad(a, b, c, d, nx, ny, nz, col, mat = M_FLAT) {
    const N = [nx * 127 | 0, ny * 127 | 0, nz * 127 | 0], i = this.n;
    for (const q of [a, b, c, d]) this.vert(q[0], q[1], q[2], N[0], N[1], N[2], col, mat);
    this.idx(i, i + 1, i + 2); this.idx(i, i + 2, i + 3);
  }
  // Трикутник; нормаль — з векторного добутку (лише вигляд, тож sqrt тут дозволений),
  // повернута вгору (up) чи вниз (низ ширяючого каменя)
  tri(a, b, c, col, up = true, mat = M_FLAT) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const s = ((nz < 0) === up ? -127 : 127) / l, i = this.n;
    for (const q of [a, b, c]) this.vert(q[0], q[1], q[2], nx * s | 0, ny * s | 0, nz * s | 0, col, mat);
    this.idx(i, i + 1, i + 2);
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
    const n = this.n, ix = this.i.subarray(0, this.ni), idx = n > 65535 ? ix.slice() : new Uint16Array(ix);
    return { pos: this.p.slice(0, n * 3), nor: this.nr.slice(0, n * 3), col: this.c.slice(0, n * 3), mat: this.mt.slice(0, n), idx, count: this.ni };
  }
}

// ================= Земля чанка (блоки) =================
// Грань блоку — лише там, де сусід не твердий (повітря чи рідина). Вигляд плавний (Surface Nets): вершини поверхні —
// у подвійній ґратці (по одній на куб 2×2×2 центрів блоків, у середньому серед перетинів його ребер), грань блоку
// стає чотирикутником між чотирма такими вершинами — сходинки стають схилами, кути — фасками; під капотом світ
// лишається з блоків. Вершина залежить лише від 8 блоків навколо, тож на межах чанків (рамка) усе збігається.
// Рівна грань (вершини — точно в кутах грані блоку: рівнина, пряма стіна) іде в жадібне злиття: однакові в одному
// шарі зливаються в прямокутники (верх і низ — у двох напрямках, боки — уздовж ряду), так вершин у рази менше;
// решта — два трикутники з власною нормаллю (пласкі грані, низькополігональний вигляд).
// Позиції — локальні (0…16 по x і y), висота — k · LEVEL. Меші: тверде, поверхня рідини (окремо, напівпрозоро),
// рослини й каміння зблизька (flora: повна будова, трава й квіти) і здалеку (far: спрощені великі рослини й каміння).
// Трава, степ і пустеля — відтінку біому клітинки (межі біомів — усереднення по сусідах 3×3)
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export function chunkMesh(C, L, { near = true, far = true } = {}) {
  const M = new Mesh(), W = new Mesh(), P = L.pal, B = C.b;
  // об'єм: висоти K0…K0+NK−1 (локальні k від 0), рамка — k = −1 і k = NK
  const NK = C.nk ?? H, K0 = C.k0 ?? 0, bi = (x, y, k) => bv(x, y, k, NK);
  const COL = [], TOPM = [], SIDEM = [];
  COL[B_ICE] = P.ice; COL[B_SAND] = P.sand; COL[B_GRASS] = P.lush; COL[B_DRY] = P.dry; COL[B_DESERT] = P.desert; COL[B_SNOW] = P.snow;
  COL[B_ROCK] = P.rock; COL[B_BED] = P.bed; COL[B_MUD] = shade(P.bed, 1.15); COL[B_SOIL] = P.soil; COL[B_STONE] = shade(P.rock, 0.82);
  COL[B_SANDSTONE] = shade(P.sand, 0.82); COL[B_MAGMA] = [255, 120, 40];
  COL[B_FLOAT] = L.islandStone >= 0 ? L.stones[L.islandStone].col : P.rock;
  TOPM[B_ICE] = M_ICE; TOPM[B_SAND] = M_SAND; TOPM[B_GRASS] = M_LUSH; TOPM[B_DRY] = M_DRY; TOPM[B_DESERT] = M_DESERT; TOPM[B_SNOW] = M_SNOW;
  TOPM[B_ROCK] = M_ROCK; TOPM[B_BED] = M_BED; TOPM[B_MUD] = M_MUD; TOPM[B_SOIL] = M_SOIL; TOPM[B_STONE] = M_CLIFF; TOPM[B_SANDSTONE] = M_SANDSIDE; TOPM[B_MAGMA] = M_LAVA; TOPM[B_FLOAT] = M_ROCK;
  SIDEM[B_ICE] = M_ICE; SIDEM[B_SAND] = M_SANDSIDE; SIDEM[B_GRASS] = M_SOIL; SIDEM[B_DRY] = M_SOIL; SIDEM[B_DESERT] = M_SANDSIDE; SIDEM[B_SNOW] = M_SNOW;
  SIDEM[B_ROCK] = M_CLIFF; SIDEM[B_BED] = M_SOIL; SIDEM[B_MUD] = M_SOIL; SIDEM[B_SOIL] = M_SOIL; SIDEM[B_STONE] = M_CLIFF; SIDEM[B_SANDSTONE] = M_SANDSIDE; SIDEM[B_MAGMA] = M_LAVA; SIDEM[B_FLOAT] = M_CLIFF;
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
    const hc = C.h[ci(x, y)] - K0, dark = k < hc - 3 ? Math.max(0.45, 1 - 0.12 * Math.floor((hc - 3 - k) / 3 + 1)) : 1;
    let m, c;
    if (d === 4) { m = TOPM[b]; c = b === B_BED ? shade(COL[b], 0.62 + 0.38 * Math.max(0, Math.min(1, (k + K0) / SEA))) : colOf(b, x, y); }
    else if (d === 5) { m = SIDEM[b]; c = shade(COL[b === B_GRASS || b === B_DRY ? B_SOIL : b], 0.8); }
    else if (LIP.has(b) && !solidB(B[bi(x, y, k + 1)])) { m = b === B_SNOW ? M_SNOW : M_LIP; c = shade(colOf(b, x, y), 0.86); }
    else { m = SIDEM[b]; c = shade(b === B_DESERT ? colOf(b, x, y) : COL[b === B_GRASS || b === B_DRY ? B_SOIL : b], k & 1 ? 1 : 0.92); }
    return [m, dark === 1 ? c : shade(c, dark)];
  };
  const key = (lk) => lk[0] * 16777216 + (lk[1][0] << 16 | lk[1][1] << 8 | lk[1][2]);
  const mask = new Float64Array(CS * CS), looks = new Array(CS * CS);
  // Подвійна ґратка: вершина куба з нижнім кутом у центрі блоку (x, y, k), x, y ∈ −1…CS−1, k ∈ −1…NK−1 (кеш)
  const NX = CS + 1, VC = new Float32Array(NX * NX * (NK + 1) * 3).fill(NaN);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cornerSolid = new Uint8Array(8), EA = EDGES.map((e) => e[0]), EB = EDGES.map((e) => e[1]);
  // середина ребра (від нижнього кута куба) і зсув кута в масиві блоків
  const EX = EDGES.map(([a, b]) => ((a & 1) + (b & 1)) / 2), EY = EDGES.map(([a, b]) => ((a >> 1 & 1) + (b >> 1 & 1)) / 2), EZ = EDGES.map(([a, b]) => ((a >> 2) + (b >> 2)) / 2);
  const CO = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => bi(c & 1, c >> 1 & 1, c >> 2) - bi(0, 0, 0));
  const dualV = (x, y, k) => {
    const o = (((k + 1) * NX + y + 1) * NX + x + 1) * 3;
    if (VC[o] === VC[o]) return o;
    const o0 = bi(x, y, k);
    for (let c = 0; c < 8; c++) cornerSolid[c] = B[o0 + CO[c]] >= B_ICE ? 1 : 0;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      if (cornerSolid[EA[e]] === cornerSolid[EB[e]]) continue;
      sx += EX[e]; sy += EY[e]; sz += EZ[e]; n++;
    }
    VC[o] = x + 0.5 + sx / n; VC[o + 1] = y + 0.5 + sy / n; VC[o + 2] = (k + 0.5 + sz / n) * LEVEL;
    return o;
  };
  // Чотири вершини грані блоку (x, y, k) у напрямку d (DIRS) — по колу; flat — чи збігаються з кутами грані блоку
  // (спільний масив QO — до наступного виклику)
  const RU = [-1, 0, 0, -1], RV = [-1, -1, 0, 0], QO = new Int32Array(4), lo = new Int32Array(3);
  const quadOf = (x, y, k, d) => {
    const D = DIRS[d], ax = D[0] ? 0 : D[1] ? 1 : 2;
    lo[0] = x; lo[1] = y; lo[2] = k;
    if (D[0] + D[1] + D[2] < 0) lo[ax]--;               // ребро між центрами блоку й сусіда; навколо нього — 4 куби
    const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
    for (let r = 0; r < 4; r++) {
      const c0 = lo[0] + (o1 === 0 ? RU[r] : o2 === 0 ? RV[r] : 0), c1 = lo[1] + (o1 === 1 ? RU[r] : o2 === 1 ? RV[r] : 0), c2 = lo[2] + (o1 === 2 ? RU[r] : o2 === 2 ? RV[r] : 0);
      QO[r] = dualV(c0, c1, c2);
    }
    return QO;
  };
  const flatQ = (q, x, y, k, d) => {
    const [dx, dy, dk] = DIRS[d];
    for (const o of q) {
      const px = VC[o], py = VC[o + 1], pz = VC[o + 2] / LEVEL;
      if (dx && px !== (dx > 0 ? x + 1 : x)) return false;
      if (dy && py !== (dy > 0 ? y + 1 : y)) return false;
      if (dk && pz !== (dk > 0 ? k + 1 : k)) return false;
      if (px !== Math.round(px) || py !== Math.round(py) || pz !== Math.round(pz)) return false;
    }
    return true;
  };
  // Негладка грань — два трикутники; вигляд — за нормаллю: дивиться вгору — як верх стовпця (трава на схилі),
  // униз — як низ, інакше — як бік
  const smoothFace = (x, y, k, d, q, b) => {
    const q0 = q[0], q1 = q[1], q2 = q[2], q3 = q[3];
    const d02 = (VC[q0] - VC[q2]) ** 2 + (VC[q0 + 1] - VC[q2 + 1]) ** 2 + (VC[q0 + 2] - VC[q2 + 2]) ** 2;
    const d13 = (VC[q1] - VC[q3]) ** 2 + (VC[q1 + 1] - VC[q3 + 1]) ** 2 + (VC[q1 + 2] - VC[q3 + 2]) ** 2;
    if (d02 <= d13) { smoothTri(x, y, k, d, b, q0, q1, q2); smoothTri(x, y, k, d, b, q0, q2, q3); }
    else { smoothTri(x, y, k, d, b, q0, q1, q3); smoothTri(x, y, k, d, b, q1, q2, q3); }
  };
  // Трикутник гладкої грані (вершини — зсуви в VC)
  const smoothTri = (x, y, k, d, b, a, bb, c) => {
    const ux = VC[bb] - VC[a], uy = VC[bb + 1] - VC[a + 1], uz = VC[bb + 2] - VC[a + 2], vx = VC[c] - VC[a], vy = VC[c + 1] - VC[a + 1], vz = VC[c + 2] - VC[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    const D = DIRS[d], flip = nx * D[0] + ny * D[1] + nz * D[2] < 0;
    nx /= flip ? -l : l; ny /= flip ? -l : l; nz /= flip ? -l : l;
    let lk;
    if (nz > 0.42) { let kt = k; while (kt + 1 <= NK && solidB(B[bi(x, y, kt + 1)])) kt++; lk = look(B[bi(x, y, kt)], 4, x, y, kt); }
    else if (nz < -0.42) lk = look(b, 5, x, y, k);
    else lk = look(b, d, x, y, k);
    const N0 = nx * 127 | 0, N1 = ny * 127 | 0, N2 = nz * 127 | 0, i = M.n, p1 = flip ? c : bb, p2 = flip ? bb : c, cl = lk[1], m = lk[0];
    M.vert(VC[a], VC[a + 1], VC[a + 2], N0, N1, N2, cl, m);
    M.vert(VC[p1], VC[p1 + 1], VC[p1 + 2], N0, N1, N2, cl, m);
    M.vert(VC[p2], VC[p2 + 1], VC[p2 + 2], N0, N1, N2, cl, m);
    M.idx(i, i + 1, i + 2);
  };
  // Грань (x, y, k, d) рівна? Ні — одразу малюємо гладкою й не віддаємо в злиття
  const flatFace = (x, y, k, d, b) => {
    const q = quadOf(x, y, k, d);
    if (flatQ(q, x, y, k, d)) return true;
    smoothFace(x, y, k, d, q, b);
    return false;
  };
  // Шари без граней (усе своє й сусіди — суцільне, чи твердого немає) пропускаємо: результат той самий, у рази швидше.
  // inS[k] — твердих у шарі k (без рамки), allS[k] — з рамкою, inL[k] — рідини (без рамки); k ∈ −1…NK
  const inS = new Int32Array(NK + 2), allS = new Int32Array(NK + 2), inL = new Int32Array(NK + 2);
  for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) {
    const inner = x >= 0 && y >= 0 && x < CS && y < CS, o = bi(x, y, -1);
    for (let k = 0; k < NK + 2; k++) {
      const b = B[o + k];
      if (b >= B_ICE) { allS[k]++; if (inner) inS[k]++; }
      else if (b === B_LIQ && inner) inL[k]++;
    }
  }
  // Маска граней шару: fm[y·CS + x] — біт 1 << d, якщо блок твердий, а сусід у напрямку d — ні; rows[d·CS + r] — є
  // такі в ряду r (для ±x — стовпчик x, для ±y — рядок y)
  const fm = new Uint8Array(CS * CS), rows = new Uint8Array(6 * CS), SK = NK + 2, SX = SK, SY = CW * SK;
  const NB = [SX, -SX, SY, -SY, 1, -1];
  for (let k = 0; k < NK; k++) {
    if (!inS[k + 1] || (allS[k + 1] === CW * CW && inS[k + 2] === CS * CS && inS[k] === CS * CS)) continue;
    rows.fill(0);
    let anyF = 0;
    for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
      const o = ((y + 1) * CW + x + 1) * SK + k + 1;
      let f = 0;
      if (B[o] >= B_ICE) for (let d = 0; d < 6; d++) if (B[o + NB[d]] < B_ICE) { f |= 1 << d; rows[d * CS + (d < 2 ? x : y)] = 1; }
      fm[y * CS + x] = f; anyF |= f;
    }
    if (!anyF) continue;
    // Верх (d = 4) і низ (d = 5): маска шару 16×16, жадібне злиття прямокутників
    for (const d of [4, 5]) {
      if (!(anyF & 1 << d)) continue;
      let any = false;
      for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
        const i = y * CS + x, b = B[bi(x, y, k)];
        if (fm[i] & 1 << d && flatFace(x, y, k, d, b)) { const lk = look(b, d, x, y, k); mask[i] = key(lk) + 1; looks[i] = lk; any = true; } else mask[i] = 0;
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
      if (!(anyF & 1 << d)) continue;
      const [dx, dy] = DIRS[d];
      for (let r = 0; r < CS; r++) {
        if (!rows[d * CS + r]) continue;
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
          if (fm[y * CS + x] & 1 << d && flatFace(x, y, k, d, b)) { lk = look(b, d, x, y, k); kk = key(lk) + 1; }
          if (kk !== rk) { flush(s); rk = kk; rl = lk; }
          if (kk) run++;
        }
        flush(CS);
      }
    }
  }
  // Поверхня рідини: верхній блок рідини під повітрям (трохи нижче за край блоку)
  // і бічні грані там, де рідина межує з повітрям (печера біля водойми): об'єм рідини завжди замкнений
  const LM = lavaish ? M_LAVA : M_WATER;
  for (let k = 0; k < NK; k++) for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
    if (!inL[k + 1]) break;
    if (B[bi(x, y, k)] !== B_LIQ) continue;
    const open = B[bi(x, y, k + 1)] === B_AIR, top = (k + 1) * LEVEL - (open ? 0.15 : 0), z0 = k * LEVEL;
    const c = mixc(P.liquid, P.liquidDeep, Math.min(1, C.v[ci(x, y)] / 160));
    if (open) W.quad([x, y, top], [x + 1, y, top], [x + 1, y + 1, top], [x, y + 1, top], 0, 0, 1, c, LM);
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      if (B[bi(x + dx, y + dy, k)] !== B_AIR) continue;
      const sc = shade(c, 0.85);
      if (dx) { const X = dx > 0 ? x + 1 : x; W.quad([X, y, top], [X, y + 1, top], [X, y + 1, z0], [X, y, z0], dx, 0, 0, sc, LM); }
      else { const Y = dy > 0 ? y + 1 : y; W.quad([x, Y, top], [x + 1, Y, top], [x + 1, Y, z0], [x, Y, z0], 0, dy, 0, sc, LM); }
    }
  }
  const { F, Ff } = objMeshes(C, L, K0, NK, near, far);
  return { solid: M.finish(), liquid: W.n ? W.finish() : null, flora: F.n ? F.finish() : null, far: Ff.n ? Ff.finish() : null };
}

// Рослини й каміння предметів з основою в K0…K0+NK−1: шаблон виду (варіант будови — від хешу) з поворотом, віком,
// нахилом і розкидом кольору; висота — від K0. F — зблизька (повна будова, трава й квіти), Ff — здалеку (спрощені
// великі рослини й каміння); near / far — що рахувати
function objMeshes(C, L, K0, NK, near, far) {
  const F = new Mesh(), Ff = new Mesh();
  for (const o of C.obj) {
    if (o.z < K0 || o.z >= K0 + NK) continue;                 // предмет — у секції своєї основи
    const z = (o.z - K0) * LEVEL, v = o.v, g = C.sp[o.s], q = objPose(C, L, o);
    if (o.k === O_FLOAT) continue;                            // ширяюче каміння — тіла (bodies.js), малюються окремо
    const { cx, cy, rot, s, cj } = q;
    if (o.k === O_TREE) {
      const tl = ((v >> 2 & 7) / 7) * 0.1;
      if (near) place(F, template(g, v % 3, 0), cx, cy, z, rot, s, tl, cj);
      if (far) place(Ff, template(g, 0, 1), cx, cy, z, rot, s, tl, cj);
    } else if (o.k === O_COVER) { if (near) place(F, template(g, v & 1, 0), cx, cy, z, rot, s, 0, cj); }
    else { const T = template(o.st ? stoneGenome(L, g, o.st) : g, v & 3, 0, styleOf(g, v)); if (near) place(F, T, cx, cy, z, rot, s, 0, cj); if (far) place(Ff, T, cx, cy, z, rot, s, 0, cj); }
  }
  return { F, Ff };
}

// Рослини й каміння зблизька всього стовпця (окрема робота: потрібні лише біля камери); висота — від блоку K0
export function floraMesh(C, L, K0) { return objMeshes(C, L, K0, 1e9, true, false).F; }

// Положення, поворот, масштаб і колір предмета o стовпця C; перешкода для зіткнень — у самі дані предмета
// (o.cx, o.cy — центр у чанку, o.r — півширина, o.top — висота над основою): дерево — основа стовбура з корінням;
// камінь — уся брила, лише вищий за пів блоку (нижчий — переступаєш). У плямі аномалії гравітації рослини вищі (слабша)
// чи нижчі (сильніша)
export function objPose(C, L, o) {
  if (o.pose) return o.pose;
  const v = o.v, g = C.sp[o.s];
  const cx = o.x + 0.5 + ((v & 15) / 15 - 0.5) * 0.24, cy = o.y + 0.5 + ((v >> 4 & 15) / 15 - 0.5) * 0.24;
  const rot = (v >> 8 & 255) / 256 * Math.PI * 2, age = (v >> 12 & 15) / 15, k = 0.92 + 0.16 * ((v >> 3 & 7) / 7);
  const cj = [k * (0.97 + 0.06 * (v >> 6 & 3) / 3), k, k * (0.97 + 0.06 * (v >> 1 & 3) / 3)];
  const ga = gravityAt(L, C.cx * CS + cx, C.cy * CS + cy).k, gs = ga === 1 ? 1 : Math.min(2.2, Math.max(0.5, Math.pow(ga, -0.6)));
  o.cx = cx; o.cy = cy; o.r = 0; o.top = 0;
  let s = 1;
  if (o.k === O_TREE) {
    s = (0.6 + 0.8 * age) * gs;
    const fp = footprint(template(g, v % 3, 0));
    o.r = Math.min(3.5, Math.max(0.12, fp.r * s * 0.8)); o.top = Math.max(2, fp.top * s);
  } else if (o.k === O_COVER) s = (0.6 + 0.8 * age) * Math.sqrt(gs);
  else if (o.k !== O_FLOAT) {
    s = 0.8 + 0.4 * age;
    const fp = footprint(template(o.st ? stoneGenome(L, g, o.st) : g, v & 3, 0, styleOf(g, v)));
    if (fp.top * s > LEVEL / 2) { o.r = Math.min(0.5, fp.r * s * 0.8); o.top = fp.top * s; }
  }
  return (o.pose = { cx, cy, rot, s, cj });
}

// Стиль каміння клітинки — з ваг стилів області
function styleOf(g, v) {
  let sum = 0;
  for (const [, w] of g.styles) sum += w;
  let u = ((v * 2654435761 >>> 0) / 4294967296) * sum;
  for (const [s, w] of g.styles) { u -= w; if (u < 0) return s; }
  return g.styles[0][0];
}

// Геном каменю з левітуючої породи st (1…): стилі області, колір породи
const SG = new Map();
function stoneGenome(L, g, st) {
  const key = g.key + ':st' + st;
  let r = SG.get(key);
  if (!r) { if (SG.size > 500) SG.clear(); const S = L.stones[st - 1]; r = { ...g, key, id: g.id ^ (st * 0x9e3779b9), leaf: S.col, acc: shade(S.col, 1.3) }; SG.set(key, r); }
  return r;
}
// Ширяючий камінь: шаблон каміння області в кольорі породи, розмір 0,3–3 блоки (масштаб шаблону), висота ширяння —
// від підйомної сили породи (більша — вище), нахил. Повертає {T, x, y, z, s, tilt}
export function floatPose(L, g, o, cx, cy, z) {
  const v = o.v, S = L.stones[(o.st || 1) - 1] || { lift: 1.3 }, u = ((v * 2654435761) >>> 0) / 4294967296, w = ((v * 40503 + 7) & 0xffff) / 65535;
  const T = template(stoneGenome(L, g, o.st || 1), v & 3, 0, styleOf(g, v));
  const s = 0.7 + 4.5 * u * u, lift = Math.min(1.5, S.lift - 1);
  return { T, x: cx, y: cy, z: z + 0.9 + lift * (2 + 5 * w) + s * 0.15, s, tilt: (w - 0.5) * 0.8 };
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
