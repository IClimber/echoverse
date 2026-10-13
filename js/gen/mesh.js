// gen/mesh.js — геометрія пласких граней: земля чанка, рослини, каміння, фігури. Без DOM і WebGL — лише масиви:
// позиції (float32 ×3), нормалі (int8 ×3), кольори (uint8 ×3), матеріали (uint8 — шар текстури), індекси.
// Світло, туман і текстуру (за матеріалом, координати — проєкцією на площину грані) додає шейдер.
// Земля — з блоків: грань лише між твердим і порожнім.
import { CS, FR, ci, SEC, H, O_TREE, O_FLOAT, O_COVER, solidB, B_AIR, B_LIQ, B_ICE, B_SAND, B_GRASS, B_DRY, B_DESERT, B_SNOW, B_ROCK, B_BED, B_MUD, B_SOIL, B_STONE, B_SANDSTONE, B_MAGMA, B_FLOAT, B_LADDER, B_VINE } from './chunk.js';
import { L_LAVA, SEA, gravityAt, LEVEL } from '../universe.js';
import { template, place, footprint, extent } from './plants.js';
import { groundTint } from './flora.js';
import { M_FLAT, M_ROCK, M_CLIFF, M_WATER, M_LAVA, M_ICE, M_SAND, M_LUSH, M_DRY, M_DESERT, M_SNOW, M_BED, M_MUD, M_SOIL, M_SANDSIDE, M_LIP, M_BARK, M_LEAF, THIN_N } from './materials.js';
import { hash3 } from '../rng.js';

export const shade = (c, k) => [Math.min(255, c[0] * k | 0), Math.min(255, c[1] * k | 0), Math.min(255, c[2] * k | 0)];
const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k | 0, a[1] + (b[1] - a[1]) * k | 0, a[2] + (b[2] - a[2]) * k | 0];

// Меш: типізовані масиви, що ростуть ×2 (без push у JS-масиви); значення перетворюються так само, як у finish
// (float32, int8, uint8 із загортанням)
export class Mesh {
  constructor(cap = 256) {
    this.p = new Float32Array(cap * 3); this.nr = new Int8Array(cap * 3); this.c = new Uint8Array(cap * 3); this.mt = new Uint16Array(cap); this.a = new Uint8Array(cap);
    this.i = new Uint32Array(cap * 2); this.n = 0; this.ni = 0;
  }
  // Місце ще на nv вершин і nidx індексів
  room(nv, nidx) {
    if (this.n + nv > this.mt.length) {
      let c = this.mt.length * 2;
      while (c < this.n + nv) c *= 2;
      const g = (a, k) => { const b = new a.constructor(c * k); b.set(a); return b; };
      this.p = g(this.p, 3); this.nr = g(this.nr, 3); this.c = g(this.c, 3); this.mt = g(this.mt, 1); this.a = g(this.a, 1);
    }
    if (this.ni + nidx > this.i.length) {
      let c = this.i.length * 2;
      while (c < this.ni + nidx) c *= 2;
      const b = new Uint32Array(c); b.set(this.i); this.i = b;
    }
  }
  // ao — затінення вершини (AO: 255 — відкрито, 0 — темно)
  vert(x, y, z, nx, ny, nz, c, m, ao = 255) {
    this.room(1, 0);
    const n = this.n, j = n * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.nr[j] = nx; this.nr[j + 1] = ny; this.nr[j + 2] = nz;
    this.c[j] = c[0]; this.c[j + 1] = c[1]; this.c[j + 2] = c[2]; this.mt[n] = m; this.a[n] = ao;
    return this.n++;
  }
  idx(a, b, c) { this.room(0, 3); const i = this.i, k = this.ni; i[k] = a; i[k + 1] = b; i[k + 2] = c; this.ni = k + 3; }
  // Чотирикутник a-b-c-d (точки [x, y, z]) з однією нормаллю (одиничний вектор); mat — матеріал (materials.js)
  quad(a, b, c, d, nx, ny, nz, col, mat = M_FLAT, ao = 255) {
    const N = [nx * 127 | 0, ny * 127 | 0, nz * 127 | 0], i = this.n;
    for (const q of [a, b, c, d]) this.vert(q[0], q[1], q[2], N[0], N[1], N[2], col, mat, ao);
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
    return { pos: this.p.slice(0, n * 3), nor: this.nr.slice(0, n * 3), col: this.c.slice(0, n * 3), mat: this.mt.slice(0, n), ao: this.a.slice(0, n), idx, count: this.ni };
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
// Трикутники твердого — проти годинникової ззовні (з повітря): рендер відсікає задні грані (матеріали CULLFACE_BACK, js/scene.js); гладкі
// орієнтує smoothTri, жадібні — порядок вершин у злитті.
// Позиції — локальні (0…16 по x і y), висота — k · LEVEL. Меші: тверде, поверхня рідини (окремо, напівпрозоро),
// рослини й каміння зблизька (flora: повна будова, трава й квіти) і здалеку (far: спрощені великі рослини й каміння).
// Трава, степ і пустеля — відтінку біому клітинки (межі біомів — усереднення по сусідах 3×3)
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// AO вершини: кут (твердих блоків у кубі 2×2×2 навколо вершини) і відкритість неба (верх укриття вище вершини на d блоків)
// тверде (solidB) таблицею — у гарячих циклах: драбина й ліана не тверді, їх меш — окремо (climbMesh)
const SOL = new Uint8Array(256);
for (let b = 0; b < 256; b++) SOL[b] = solidB(b) ? 1 : 0;
const AOB = [255, 255, 255, 255, 255, 227, 199, 168, 140];
export const skyK = (d) => d <= 1 ? 1 : d >= 9 ? 0 : 1 - (d - 1) / 8;

const CLIMB_N = [[-1, 0], [1, 0], [0, -1], [0, 1]], LADDER_COL = [120, 84, 52];
// Драбина чи ліана: (wx, wy) — середина грані стіни внизу блоку (z0), (nx, ny) — нормаль від стіни. Точка (d — від стіни,
// s — уздовж стіни праворуч (−ny, nx), z). Грані — проти годинникової ззовні (тверде — з відсіканням задніх)
function climbMesh(M, b, wx, wy, z0, nx, ny, col, ao) {
  const tx = -ny, ty = nx, at = (d, s, z) => [wx + nx * d + tx * s, wy + ny * d + ty * s, z];
  const face = (a, bb, c, d, n) => {
    const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const ccw = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] > 0;
    if (ccw) M.quad(a, bb, c, d, n[0], n[1], n[2], col, mt, ao); else M.quad(a, d, c, bb, n[0], n[1], n[2], col, mt, ao);
  };
  const mt = b === B_LADDER ? M_BARK : M_LEAF, N = [nx, ny, 0], Nb = [-nx, -ny, 0], Tp = [tx, ty, 0], Tn = [-tx, -ty, 0];
  const cuboid = (d0, d1, s0, s1, z0, z1) => {
    face(at(d1, s0, z0), at(d1, s1, z0), at(d1, s1, z1), at(d1, s0, z1), N);
    face(at(d0, s0, z0), at(d0, s0, z1), at(d0, s1, z1), at(d0, s1, z0), Nb);
    face(at(d0, s1, z0), at(d0, s1, z1), at(d1, s1, z1), at(d1, s1, z0), Tp);
    face(at(d0, s0, z0), at(d1, s0, z0), at(d1, s0, z1), at(d0, s0, z1), Tn);
    face(at(d0, s0, z1), at(d0, s1, z1), at(d1, s1, z1), at(d1, s0, z1), [0, 0, 1]);
    face(at(d0, s0, z0), at(d1, s0, z0), at(d1, s1, z0), at(d0, s1, z0), [0, 0, -1]);
  };
  const z1 = z0 + LEVEL;
  if (b === B_LADDER) {
    cuboid(0.04, 0.1, -0.33, -0.27, z0, z1); cuboid(0.04, 0.1, 0.27, 0.33, z0, z1);   // стійки
    cuboid(0.045, 0.095, -0.27, 0.27, z0 + LEVEL / 2 - 0.025, z0 + LEVEL / 2 + 0.025);  // щабель
  } else {
    face(at(0.03, -0.45, z0), at(0.03, 0.45, z0), at(0.03, 0.45, z1), at(0.03, -0.45, z1), N);     // лицем від стіни
    face(at(0.03, -0.45, z0), at(0.03, -0.45, z1), at(0.03, 0.45, z1), at(0.03, 0.45, z0), Nb);    // і до стіни
  }
}

export function chunkMesh(C, L, { near = true, far = true } = {}) {
  const M = new Mesh(), W = new Mesh(), Mc = new Mesh(), P = L.pal, B = C.b;
  // груба ґратка (рівні деталізації, genCoarse): ST — крок точок у блоках, N — точок на бік; координати сітки → локальні
  // блоки: × ST + (1 − ST) / 2 (клітинка — навколо точки); при ST = 1 — ті самі числа
  // рамка масивів FB: точна секція — FR (2: прямі стіни дивляться на блок далі за куб), груба ґратка — 1
  const ST = C.step || 1, N = CS / ST, FB = ST === 1 ? FR : 1, NW = N + 2 * FB, OF = (1 - ST) / 2, OZ = OF * LEVEL;
  // об'єм: висоти K0…K0+NK−1 (локальні k від 0), рамка — k = −FB…−1 і NK…NK+FB−1
  const NK = C.nk ?? H, K0 = C.k0 ?? 0, SKK = NK + 2 * FB, cix = (x, y) => (y + FB) * NW + x + FB, bi = (x, y, k) => cix(x, y) * SKK + k + FB;
  const mp = (x, y, z) => [x * ST + OF, y * ST + OF, z * ST + OZ];
  let T = M;                                       // куди пишуть гладкі грані (обрізи — у Mc)
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
      const xx = Math.max(-1, Math.min(N, x + i)), yy = Math.max(-1, Math.min(N, y + j)), c = tintOf(b, C.bm[cix(xx, yy)] || 0);
      r += c[0]; g += c[1]; bl += c[2];
    }
    return [Math.round(r / 27) * 3, Math.round(g / 27) * 3, Math.round(bl / 27) * 3];
  };
  // Вигляд грані: [матеріал, колір] (темряву печер дає світло рушія: тіні й AO вершин)
  // дно водойм темнішає з глибиною — і верх, і боки (бік крутого схилу дна — так само: інакше на глибині круті трикутники
  // вдвічі яскравіші за пологі поруч — яскраві «зубці», 12.10.2026)
  const look = (b, d, x, y, k) => {
    const kb = k * ST, dk = b === B_BED ? 0.62 + 0.38 * Math.max(0, Math.min(1, (kb + K0) / SEA)) : 1;
    let m, c;
    if (d === 4) { m = TOPM[b]; c = b === B_BED ? shade(COL[b], dk) : colOf(b, x, y); }
    else if (d === 5) { m = SIDEM[b]; c = shade(COL[b === B_GRASS || b === B_DRY ? B_SOIL : b], 0.8 * dk); }
    else if (LIP.has(b) && !solidB(B[bi(x, y, k + 1)])) { m = b === B_SNOW ? M_SNOW : M_LIP; c = shade(colOf(b, x, y), 0.86); }
    else { m = SIDEM[b]; c = shade(b === B_DESERT ? colOf(b, x, y) : COL[b === B_GRASS || b === B_DRY ? B_SOIL : b], (k & 1 ? 1 : 0.92) * dk); }
    return [m, c];
  };
  const key = (lk) => lk[0] * 16777216 + (lk[1][0] << 16 | lk[1][1] << 8 | lk[1][2]);
  const mask = new Float64Array(N * N), looks = new Array(N * N);
  // Подвійна ґратка: вершина куба з нижнім кутом у центрі блоку (x, y, k), x, y ∈ −1…CS−1, k ∈ −1…NK−1 (кеш)
  const NX = N + 1, VC = new Float32Array(NX * NX * (NK + 1) * 3).fill(NaN), VA = new Uint8Array(NX * NX * (NK + 1));
  // T-стики: вершина однієї грані посеред ребра іншої — растеризатор лишає щілини в піксель (видно небо: шов уздовж
  // межі чанків). Тож злиті прямокутники відкладаємо (FQ) і в кінці ділимо їхні ребра в точках, де є вершина будь-якої
  // іншої грані секції (VS — цілі точки ґратки: x, y ∈ −1…N+1, рівень k ∈ −1…NK+1), а на межах секції (x, y = 0 чи N,
  // k = 0 чи NK) — у кожній цілій точці: сусідня секція робить те саме, і з обох боків вершини збігаються
  const VSX = N + 3, VSK = NK + 3, VS = new Uint8Array(VSX * VSX * VSK), FQ = [];
  const vsI = (x, y, k) => x < -1 || y < -1 || k < -1 || x > N + 1 || y > N + 1 || k > NK + 1 ? -1 : ((k + 1) * VSX + y + 1) * VSX + x + 1;
  const markV = (x, y, k) => { if (x === Math.round(x) && y === Math.round(y) && k === Math.round(k)) { const i = vsI(x, y, k); if (i >= 0) VS[i] = 1; } };
  // AO вершини (0fps, «Ambient occlusion for Minecraft-like worlds»): кут — за кількістю твердих блоків куба 2×2×2 навколо
  // вершини (до 4 — відкрито, далі — увігнутий кут темніший); небо — наскільки верх укриття клітинки (C.top, блоки) вище
  // вершини: ≤ 1 блок — відкрито, ≥ 9 — темно (печера, під навісом); середнє чотирьох клітинок навколо вершини
  const TOP = ST === 1 ? C.top : null;
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cornerSolid = new Uint8Array(8), EA = EDGES.map((e) => e[0]), EB = EDGES.map((e) => e[1]);
  // середина ребра (від нижнього кута куба) і зсув кута в масиві блоків
  const EX = EDGES.map(([a, b]) => ((a & 1) + (b & 1)) / 2), EY = EDGES.map(([a, b]) => ((a >> 1 & 1) + (b >> 1 & 1)) / 2), EZ = EDGES.map(([a, b]) => ((a >> 2) + (b >> 2)) / 2);
  const CO = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => bi(c & 1, c >> 1 & 1, c >> 2) - bi(0, 0, 0));
  // Прямі стіни (12.10.2026, скарга: «прямих кутів в грі бути не може» — Surface Nets зрізав і внутрішні кути, прохід між
  // стінами за 1 м мав на підлозі 0,5 м). Лише під стелею (рішення користувача: печери, ходи, лази, навіси; відкритий
  // рельєф під небом — ями, уступи, круті схили — плавний, як був): куб, де повітря нижче верху ґрунту клітинки C.sky
  // (блок; водойма — −1). Без C.sky (груба ґратка) — плавно. Перетин горизонтального ребра (a, b) — грань блоку; «та сама грань» у сусідньому
  // шарі / ряду — пара блоків зі зсувом d з тим самим боком твердого
  const SKY = ST === 1 ? C.sky : null;
  const covered = (x, y, k, o0) => {
    for (let c = 0; c < 8; c++) {
      const q = B[o0 + CO[c]];
      if (!SOL[q] && q !== B_LIQ && K0 + k + (c >> 2) < SKY[cix(x + (c & 1), y + (c >> 1 & 1))]) return true;
    }
    return false;
  };
  const same = (oa, ob, d) => SOL[B[oa + d]] === SOL[B[oa]] && SOL[B[ob + d]] === SOL[B[ob]];
  // куб o0 — стіна: вертикальна грань (перетин горизонтального ребра) тягнеться ≥ 2 блоки — є й шаром вище чи нижче
  // (у кубі чи на блок за ним). Уступ в 1 блок — ні (лишається схилом)
  const wallCube = (o0) => {
    for (let e = 0; e < 8; e++) {
      const a = EA[e], b = EB[e];
      if (cornerSolid[a] === cornerSolid[b]) continue;
      const oa = o0 + CO[a], ob = o0 + CO[b];
      if (same(oa, ob, a & 4 ? -1 : 1) || same(oa, ob, a & 4 ? 1 : -1)) return true;
    }
    return false;
  };
  // грань уздовж осі ax (0 — x-ребра, 1 — y-ребра) пряма в плані: є й у сусідньому ряду (у кубі чи на клітинку за ним)
  const straight = (o0, ax) => {
    const D = ax ? SKK : NW * SKK, bit = ax ? 1 : 2;   // сусідній ряд: для x-ребер — по y, для y-ребер — по x
    for (let e = ax * 4; e < ax * 4 + 4; e++) {
      const a = EA[e], b = EB[e];
      if (cornerSolid[a] === cornerSolid[b]) continue;
      const oa = o0 + CO[a], ob = o0 + CO[b];
      if (same(oa, ob, a & bit ? -D : D) || same(oa, ob, a & bit ? D : -D)) return true;
    }
    return false;
  };
  const dualV = (x, y, k) => {
    const o = (((k + 1) * NX + y + 1) * NX + x + 1) * 3;
    if (VC[o] === VC[o]) return o;
    const o0 = bi(x, y, k);
    for (let c = 0; c < 8; c++) cornerSolid[c] = SOL[B[o0 + CO[c]]];
    let sx = 0, sy = 0, sz = 0, n = 0, hx = 0, hy = 0, hn = 0;
    for (let e = 0; e < 12; e++) {
      if (cornerSolid[EA[e]] === cornerSolid[EB[e]]) continue;
      sx += EX[e]; sy += EY[e]; sz += EZ[e]; n++;
      if (e < 8) { hx += EX[e]; hy += EY[e]; hn++; }   // ребра 0–3 — уздовж x, 4–7 — уздовж y, 8–11 — уздовж z
    }
    if (!n) { sx = sy = sz = 0.5; n = 1; }             // поверхня не перетинає куб (лише обрізи грубої ґратки) — центр
    if (FB === 2 && SKY && hn && covered(x, y, k, o0) && wallCube(o0)) {
      // стіна (вертикальна грань ≥ 2 блоки): підлога, стеля й верхнє ребро доходять до неї прямим кутом (z — центр куба);
      // у плані — середнє лише горизонтальних перетинів (діагональ сходинками — скіс), а пряма в плані грань — точно
      sz = 0.5 * n;
      sx = straight(o0, 0) ? 0.5 * n : hx / hn * n;
      sy = straight(o0, 1) ? 0.5 * n : hy / hn * n;
    }
    VC[o] = x + 0.5 + sx / n; VC[o + 1] = y + 0.5 + sy / n; VC[o + 2] = (k + 0.5 + sz / n) * LEVEL;
    let ns = 0;
    for (let c = 0; c < 8; c++) ns += cornerSolid[c];
    let sky = 1;
    if (TOP) {
      const zb = K0 + VC[o + 2] / LEVEL;
      sky = (skyK(TOP[cix(x, y)] - zb) + skyK(TOP[cix(x + 1, y)] - zb) + skyK(TOP[cix(x, y + 1)] - zb) + skyK(TOP[cix(x + 1, y + 1)] - zb)) / 4;
    }
    VA[o / 3] = Math.round(AOB[ns] * sky);
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
  const smoothTri = (x, y, k, d, b, a, bb, c, force) => {
    const ux = VC[bb] - VC[a], uy = VC[bb + 1] - VC[a + 1], uz = VC[bb + 2] - VC[a + 2], vx = VC[c] - VC[a], vy = VC[c + 1] - VC[a + 1], vz = VC[c + 2] - VC[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    const D = DIRS[d], flip = nx * D[0] + ny * D[1] + nz * D[2] < 0;
    nx /= flip ? -l : l; ny /= flip ? -l : l; nz /= flip ? -l : l;
    let lk;
    if (force) lk = force;
    else if (nz > 0.42) { let kt = k; while (kt + 1 <= NK && solidB(B[bi(x, y, kt + 1)])) kt++; lk = look(B[bi(x, y, kt)], 4, x, y, kt); }
    else if (nz < -0.42) lk = look(b, 5, x, y, k);
    else lk = look(b, d, x, y, k);
    const N0 = nx * 127 | 0, N1 = ny * 127 | 0, N2 = nz * 127 | 0, i = T.n, p1 = flip ? c : bb, p2 = flip ? bb : c, cl = lk[1], m = lk[0];
    if (T === M) for (const o of [a, bb, c]) markV(VC[o], VC[o + 1], VC[o + 2] / LEVEL);
    T.vert(VC[a] * ST + OF, VC[a + 1] * ST + OF, VC[a + 2] * ST + OZ, N0, N1, N2, cl, m, VA[a / 3]);
    T.vert(VC[p1] * ST + OF, VC[p1 + 1] * ST + OF, VC[p1 + 2] * ST + OZ, N0, N1, N2, cl, m, VA[p1 / 3]);
    T.vert(VC[p2] * ST + OF, VC[p2 + 1] * ST + OF, VC[p2 + 2] * ST + OZ, N0, N1, N2, cl, m, VA[p2 / 3]);
    T.idx(i, i + 1, i + 2);
  };
  // Грань (x, y, k, d) рівна? Ні — одразу малюємо гладкою й не віддаємо в злиття
  const flatFace = (x, y, k, d, b) => {
    const q = quadOf(x, y, k, d);
    if (flatQ(q, x, y, k, d)) return true;
    smoothFace(x, y, k, d, q, b);
    return false;
  };
  // Рівна грань після flatFace (кути — у QO): AO кутів однакове — повертає його (у злиття, ключ — з AO); різне —
  // одразу два трикутники з AO кожного кута, діагональ — за 0fps (уздовж пари з більшою сумою), і −1
  const flatAO = (x, y, k, d, b, lk) => {
    const q0 = QO[0], q1 = QO[1], q2 = QO[2], q3 = QO[3], a0 = VA[q0 / 3], a1 = VA[q1 / 3], a2 = VA[q2 / 3], a3 = VA[q3 / 3];
    if (a0 === a1 && a1 === a2 && a2 === a3) return a0;
    if (a0 + a2 < a1 + a3) { smoothTri(x, y, k, d, b, q0, q1, q3, lk); smoothTri(x, y, k, d, b, q1, q2, q3, lk); }
    else { smoothTri(x, y, k, d, b, q0, q1, q2, lk); smoothTri(x, y, k, d, b, q0, q2, q3, lk); }
    return -1;
  };
  const aoM = new Uint8Array(N * N);
  // Злитий прямокутник (кути — точки ґратки [x, y, рівень], по колу назовні): у FQ, кути — у VS
  const fq = (a, b, c, d, nx, ny, nz, col, mt, ao) => { for (const p of [a, b, c, d]) markV(p[0], p[1], p[2]); FQ.push([a, b, c, d, nx, ny, nz, col, mt, ao]); };
  // Шари без граней (усе своє й сусіди — суцільне, чи твердого немає) пропускаємо: результат той самий, у рази швидше.
  // inS[k] — твердих у шарі k (без рамки), allS[k] — з рамкою, inL[k] — рідини (без рамки); k ∈ −1…NK
  const inS = new Int32Array(NK + 2), allS = new Int32Array(NK + 2), inL = new Int32Array(NK + 2);
  for (let y = -1; y <= N; y++) for (let x = -1; x <= N; x++) {
    const inner = x >= 0 && y >= 0 && x < N && y < N, o = bi(x, y, -1);
    for (let k = 0; k < NK + 2; k++) {
      const b = B[o + k];
      if (SOL[b]) { allS[k]++; if (inner) inS[k]++; }
      else if (b === B_LIQ && inner) inL[k]++;
    }
  }
  // Маска граней шару: fm[y·CS + x] — біт 1 << d, якщо блок твердий, а сусід у напрямку d — ні; rows[d·CS + r] — є
  // такі в ряду r (для ±x — стовпчик x, для ±y — рядок y)
  const fm = new Uint8Array(N * N), rows = new Uint8Array(6 * N), SX = SKK, SY = NW * SKK;
  const NB = [SX, -SX, SY, -SY, 1, -1];
  for (let k = 0; k < NK; k++) {
    if (!inS[k + 1] || (allS[k + 1] === (N + 2) * (N + 2) && inS[k + 2] === N * N && inS[k] === N * N)) continue;
    rows.fill(0);
    let anyF = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = bi(x, y, k);
      let f = 0;
      if (SOL[B[o]]) for (let d = 0; d < 6; d++) if (!SOL[B[o + NB[d]]]) { f |= 1 << d; rows[d * N + (d < 2 ? x : y)] = 1; }
      fm[y * N + x] = f; anyF |= f;
    }
    if (!anyF) continue;
    // Верх (d = 4) і низ (d = 5): маска шару 16×16, жадібне злиття прямокутників
    for (const d of [4, 5]) {
      if (!(anyF & 1 << d)) continue;
      let any = false;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = y * N + x, b = B[bi(x, y, k)];
        mask[i] = 0;
        if (fm[i] & 1 << d && flatFace(x, y, k, d, b)) {
          const lk = look(b, d, x, y, k), ao = flatAO(x, y, k, d, b, lk);
          if (ao >= 0) { mask[i] = key(lk) * 256 + ao + 1; looks[i] = lk; aoM[i] = ao; any = true; }
        }
      }
      if (!any) continue;
      const kz = d === 4 ? k + 1 : k, nz = d === 4 ? 1 : -1;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; ) {
        const m = mask[y * N + x];
        if (!m) { x++; continue; }
        let w = 1; while (x + w < N && mask[y * N + x + w] === m) w++;
        let h = 1;
        grow: while (y + h < N) { for (let q = 0; q < w; q++) if (mask[(y + h) * N + x + q] !== m) break grow; h++; }
        for (let yy = 0; yy < h; yy++) for (let q = 0; q < w; q++) mask[(y + yy) * N + x + q] = 0;
        const [mt, c] = looks[y * N + x], ao = aoM[y * N + x], p0 = [x, y, kz], p1 = [x + w, y, kz], p2 = [x + w, y + h, kz], p3 = [x, y + h, kz];
        if (d === 4) fq(p0, p1, p2, p3, 0, 0, nz, c, mt, ao); else fq(p0, p3, p2, p1, 0, 0, nz, c, mt, ao);   // низ — навпаки
        x += w;
      }
    }
    // Боки: уздовж ряду (для ±x — уздовж y, для ±y — уздовж x)
    for (let d = 0; d < 4; d++) {
      if (!(anyF & 1 << d)) continue;
      const [dx, dy] = DIRS[d];
      for (let r = 0; r < N; r++) {
        if (!rows[d * N + r]) continue;
        let run = 0, rk = 0, rl = null, ra = 255;
        const flush = (end) => {
          if (!run) return;
          const s0 = end - run, [mt, c] = rl, ao = ra;
          // порядок p0…p3 дає −x і +y; для +x і −y — навпаки (назовні)
          if (dx) {
            const X = dx > 0 ? r + 1 : r, p0 = [X, s0, k + 1], p1 = [X, end, k + 1], p2 = [X, end, k], p3 = [X, s0, k];
            if (dx < 0) fq(p0, p1, p2, p3, dx, 0, 0, c, mt, ao); else fq(p0, p3, p2, p1, dx, 0, 0, c, mt, ao);
          } else {
            const Y = dy > 0 ? r + 1 : r, p0 = [s0, Y, k + 1], p1 = [end, Y, k + 1], p2 = [end, Y, k], p3 = [s0, Y, k];
            if (dy > 0) fq(p0, p1, p2, p3, 0, dy, 0, c, mt, ao); else fq(p0, p3, p2, p1, 0, dy, 0, c, mt, ao);
          }
          run = 0;
        };
        for (let s = 0; s < N; s++) {
          const x = dx ? r : s, y = dx ? s : r, b = B[bi(x, y, k)];
          let kk = 0, lk = null, ao = 255;
          if (fm[y * N + x] & 1 << d && flatFace(x, y, k, d, b)) {
            lk = look(b, d, x, y, k); ao = flatAO(x, y, k, d, b, lk);
            if (ao >= 0) kk = key(lk) * 256 + ao + 1;
          }
          if (kk !== rk) { flush(s); rk = kk; rl = lk; ra = ao; }
          if (kk) run++;
        }
        flush(N);
      }
    }
  }
  // Злиті прямокутники: ребро — з точками поділу (VS чи межа секції); немає — два трикутники, є — віяло від центру
  // (вершини по колу, жодного виродженого трикутника)
  const ring = [], onB = (v, n) => v === 0 || v === n;
  for (const [a, b, c, d, nx, ny, nz, col, mt, ao] of FQ) {
    ring.length = 0;
    let split = false;
    for (const [p, q] of [[a, b], [b, c], [c, d], [d, a]]) {
      ring.push(p);
      const ax = p[0] !== q[0] ? 0 : p[1] !== q[1] ? 1 : 2, len = Math.abs(q[ax] - p[ax]), st = q[ax] > p[ax] ? 1 : -1;
      if (ax === 2 || len < 2) continue;                   // уздовж висоти ребро — один рівень
      const o = 1 - ax, bord = onB(p[o], N) || onB(p[2], NK);
      for (let t = 1; t < len; t++) {
        const r = p.slice(); r[ax] += st * t;
        if (bord || VS[vsI(r[0], r[1], r[2])]) { ring.push(r); split = true; }
      }
    }
    const N3 = [nx * 127 | 0, ny * 127 | 0, nz * 127 | 0];
    if (!split) { M.quad(mp(a[0], a[1], a[2] * LEVEL), mp(b[0], b[1], b[2] * LEVEL), mp(c[0], c[1], c[2] * LEVEL), mp(d[0], d[1], d[2] * LEVEL), nx, ny, nz, col, mt, ao); continue; }
    const cp = mp((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2 * LEVEL), i0 = M.vert(cp[0], cp[1], cp[2], N3[0], N3[1], N3[2], col, mt, ao);
    for (const r of ring) { const q = mp(r[0], r[1], r[2] * LEVEL); M.vert(q[0], q[1], q[2], N3[0], N3[1], N3[2], col, mt, ao); }
    for (let j = 0; j < ring.length; j++) M.idx(i0, i0 + 1 + j, i0 + 1 + (j + 1) % ring.length);
  }
  // Обрізи (лише груба ґратка): грані власних твердих точок на 4 бічних межах секції в бік твердої точки рамки — так,
  // ніби там повітря, — лише біля поверхні (у площині межі поруч, у власному шарі чи в рамці, є не тверда точка).
  // Окремий меш: рендер малює його біля кіл переходу між рівнями — промінь з тоншого рівня не пролізе в щілину між поверхнями
  if (ST > 1) {
    T = Mc;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      for (let r = 0; r < N; r++) for (let k = 0; k < NK; k++) {
        const x = dx ? (dx > 0 ? N - 1 : 0) : r, y = dx ? r : (dy > 0 ? N - 1 : 0), b = B[bi(x, y, k)];
        if (!SOL[b] || !SOL[B[bi(x + dx, y + dy, k)]]) continue;
        let rim = false;
        for (let a = -1; a <= 1 && !rim; a++) for (let c = -1; c <= 1 && !rim; c++) {
          const xx = dx ? x : x + a, yy = dx ? y + a : y;
          if (!SOL[B[bi(xx, yy, k + c)]] || !SOL[B[bi(xx + dx, yy + dy, k + c)]]) rim = true;
        }
        if (rim) smoothFace(x, y, k, d, quadOf(x, y, k, d), b);
      }
    }
    T = M;
  }
  // Драбини й ліани (лише точна ґратка): тонка панель на стіні — на першому твердому сусіді (−x, +x, −y, +y). У твердому
  // меші — тож і в зіткненнях (collision.js): стійки й щаблі драбини, площина ліани
  if (ST === 1) for (let k = 0; k < NK; k++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const b = B[bi(x, y, k)];
    if (b !== B_LADDER && b !== B_VINE) continue;
    let nx = 0, ny = 0;
    for (const [dx, dy] of CLIMB_N) if (SOL[B[bi(x + dx, y + dy, k)]]) { nx = -dx; ny = -dy; break; }
    if (!nx && !ny) continue;
    const ao = TOP ? Math.round(255 * skyK(TOP[cix(x, y)] - (K0 + k + 0.5))) : 255;
    climbMesh(M, b, x + 0.5 - nx * 0.5, y + 0.5 - ny * 0.5, k * LEVEL, nx, ny, b === B_LADDER ? LADDER_COL : shade(P.lush, 0.8), ao);
  }
  // Поверхня рідини: верхній блок рідини під повітрям (трохи нижче за край блоку)
  // і бічні грані там, де рідина межує з повітрям (печера біля водойми): об'єм рідини завжди замкнений
  const LM = lavaish ? M_LAVA : M_WATER;
  if (ST === 1) for (let k = 0; k < NK; k++) for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
    if (!inL[k + 1]) break;
    if (B[bi(x, y, k)] !== B_LIQ) continue;
    const open = B[bi(x, y, k + 1)] === B_AIR, top = (k + 1) * LEVEL - (open ? 0.15 : 0), z0 = k * LEVEL;
    const c = mixc(P.liquid, P.liquidDeep, Math.min(1, C.v[cix(x, y)] / 160)), la = TOP ? Math.round(255 * skyK(TOP[cix(x, y)] - (K0 + k + 1))) : 255;
    if (open) W.quad([x, y, top], [x + 1, y, top], [x + 1, y + 1, top], [x, y + 1, top], 0, 0, 1, c, LM, la);
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      if (B[bi(x + dx, y + dy, k)] !== B_AIR) continue;
      const sc = shade(c, 0.85);
      if (dx) { const X = dx > 0 ? x + 1 : x; W.quad([X, y, top], [X, y + 1, top], [X, y + 1, z0], [X, y, z0], dx, 0, 0, sc, LM, la); }
      else { const Y = dy > 0 ? y + 1 : y; W.quad([x, Y, top], [x + 1, Y, top], [x + 1, Y, z0], [x, Y, z0], 0, dy, 0, sc, LM, la); }
    }
  }
  else {
    // груба: верх рідини власних точок — точно на рівні, квадрати ST×ST, вирівняні з секцією; ряд однакових — одним
    for (let y = 0; y < N; y++) for (let x = 0; x < N; ) {
      const t = C.lt[cix(x, y)], v = C.v[cix(x, y)];
      if (t < 0) { x++; continue; }
      let w = 1;
      while (x + w < N && C.lt[cix(x + w, y)] === t && C.v[cix(x + w, y)] === v) w++;
      const z = (t - K0 + 1) * LEVEL - 0.15, c = mixc(P.liquid, P.liquidDeep, Math.min(1, v / 160));
      W.quad([x * ST, y * ST, z], [(x + w) * ST, y * ST, z], [(x + w) * ST, (y + 1) * ST, z], [x * ST, (y + 1) * ST, z], 0, 0, 1, c, LM);
      x += w;
    }
  }
  const { F, Ff } = objMeshes(C, L, K0, NK, near, far);
  return { solid: M.finish(), liquid: W.n ? W.finish() : null, caps: Mc.n ? Mc.finish() : null, flora: F.n ? F.finish() : null, far: Ff.n ? Ff.finish() : null };
}

// Тінь малої рослини в дальніх каскадах (scene.js, кидач малих рослин дальніх каскадів): одне просте тіло — восьмигранник
// у межах листя рослини (від найнижчого листка до верху; радіус — 0,6 охоплення: між листям просвіти) замість повної
// будови (50–150 трикутників); у кадрі не малюється. Мітка проріджування — та сама, що в рослини (рідшає разом з нею),
// матеріал — листя (гойдається вітром, як листя). Нижчі за 0,2 м — без тіні: у дальніх каскадах це менше за тексель
const SHADE_MIN = 0.2, SHADE_R = 0.6;
function shadeProxy(M, T, x, y, z, s, thin) {
  const e = extent(T), top = e.top * s, z0 = Math.min(e.z0 * s, 0.5 * top), r = SHADE_R * e.r * s, mt = M_LEAF | thin << 5;
  if (top < SHADE_MIN || r <= 0) return;
  const zm = z + (z0 + top) / 2, c = [128, 128, 128];
  const a = M.vert(x, y, z + top, 0, 0, 127, c, mt), b = M.vert(x, y, z + z0, 0, 0, -127, c, mt);
  const q = [M.vert(x + r, y, zm, 127, 0, 0, c, mt), M.vert(x, y + r, zm, 0, 127, 0, c, mt), M.vert(x - r, y, zm, -127, 0, 0, c, mt), M.vert(x, y - r, zm, 0, -127, 0, c, mt)];
  for (let i = 0; i < 4; i++) { const u = q[i], w = q[(i + 1) & 3]; M.idx(a, u, w); M.idx(b, w, u); }
}

// Рослини й каміння предметів з основою в K0…K0+NK−1: шаблон виду (варіант будови — від хешу) з поворотом, віком,
// нахилом і розкидом кольору; висота — від K0. F — зблизька (повна будова, трава й квіти), Ff — здалеку (спрощені
// великі рослини й каміння); near / far — що рахувати; shade — за покривом F ще тіні малих рослин (F.ncv — кінець покриву)
function objMeshes(C, L, K0, NK, near, far, dz = 0, shade = false) {
  const F = new Mesh(), Ff = new Mesh(), cover = [], sh = [];
  F.nb = 0; F.objs = [];
  // зблизька — спершу великі (дерева, каміння), за ними малі (покрив): F.nb — індексів великих, F.objs — по 8 чисел на
  // великий предмет: перший індекс, індексів, коробка x0, y0, z0, x1, y1, z1 (scene.js малює великі поза зонами
  // розчинення, «вікна» й переходу матеріалом без дизерингу)
  for (let pass = 0; pass < 2; pass++) for (const o of pass ? cover : C.obj) {
    if (!pass && o.k === O_COVER) { if (near) cover.push(o); continue; }
    if (o.z < K0 || o.z >= K0 + NK) continue;                 // предмет — у секції своєї основи
    const z = (o.z - K0) * LEVEL + dz, v = o.v, g = C.sp[o.s], q = objPose(C, L, o);
    if (o.k === O_FLOAT) continue;                            // ширяюче каміння — тіла (bodies.js), малюються окремо
    const { cx, cy, rot, s, cj } = q, sk = C.top ? skyK(C.top[ci(o.x, o.y)] - o.z) : 1;   // AO неба над основою
    const v0 = F.n, i0 = F.ni;
    if (o.k === O_TREE) {
      const tl = ((v >> 2 & 7) / 7) * 0.1;
      if (near) place(F, template(g, v % 3, 0), cx, cy, z, rot, s, tl, cj, sk);
      if (far) place(Ff, template(g, v % 3, 1), cx, cy, z, rot, s, tl, cj, sk);   // той самий варіант, спрощений
    } else if (o.k === O_COVER) {
      if (near) {
        const T = template(g, v & 1, 0), thin = 1 + hash3(0x7f1a, o.x + C.cx * CS, o.y + C.cy * CS) % THIN_N;
        place(F, T, cx, cy, z, rot, s, 0, cj, sk, thin);
        if (shade) sh.push(T, cx, cy, z, s, thin);
      }
    }
    else { const T = template(o.st ? stoneGenome(L, g, o.st) : g, v & 3, 0, styleOf(g, v)); if (near) place(F, T, cx, cy, z, rot, s, 0, cj, sk); if (far) place(Ff, T, cx, cy, z, rot, s, 0, cj, sk); }
    if (!pass) {
      F.nb = F.ni;
      if (near && F.ni > i0) {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        for (let j = v0 * 3; j < F.n * 3; j += 3) {
          const a = F.p[j], b = F.p[j + 1], c = F.p[j + 2];
          if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; if (c < z0) z0 = c; if (c > z1) z1 = c;
        }
        F.objs.push(i0, F.ni - i0, x0, y0, z0, x1, y1, z1);
      }
    }
  }
  F.ncv = F.ni;
  for (let i = 0; i < sh.length; i += 6) shadeProxy(F, sh[i], sh[i + 1], sh[i + 2], sh[i + 3], sh[i + 4], sh[i + 5]);
  return { F, Ff };
}

// Один предмет o стовпця C повністю (обрис цілі, scene.js): той самий шаблон, поворот, масштаб і колір, що в objMeshes;
// позиції — у чанку (x, y 0…16), висота — від блоку 0
export function objMesh(C, L, o) {
  const M = new Mesh(), v = o.v, g = C.sp[o.s], { cx, cy, rot, s, cj } = objPose(C, L, o), z = o.z * LEVEL;
  if (o.k === O_TREE) place(M, template(g, v % 3, 0), cx, cy, z, rot, s, ((v >> 2 & 7) / 7) * 0.1, cj);
  else if (o.k === O_COVER) place(M, template(g, v & 1, 0), cx, cy, z, rot, s, 0, cj);
  else if (o.k !== O_FLOAT) place(M, template(o.st ? stoneGenome(L, g, o.st) : g, v & 3, 0, styleOf(g, v)), cx, cy, z, rot, s, 0, cj);
  return M.finish();
}

// Рослини й каміння зблизька всього стовпця (окрема робота: потрібні лише біля камери); висота — від блоку K0. Індекси:
// [0, nb) — великі, [nb, ncv) — покрив, [ncv, ni) — тіні малих рослин для дальніх каскадів (у кадрі не малюються)
export function floraMesh(C, L, K0) { return objMeshes(C, L, K0, 1e9, true, false, 0, true).F; }
// Далекі рослини й каміння з основою в секції K0…K0+15 (груба секція: dz — опустити до грубої землі)
export function farFlora(C, L, K0, dz = 0) { return objMeshes(C, L, K0, SEC, false, true, dz).Ff; }

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
  const ga = gravityAt(L, C.cx * CS + cx, C.cy * CS + cy).k, gs = ga === 1 ? 1 : Math.min(2.2, Math.max(0.5, Math.pow(Math.max(0.27, ga), -0.6)));
  o.cx = cx; o.cy = cy; o.r = 0; o.top = 0;
  let s = 1, T = null;
  if (o.k === O_TREE) {
    s = (0.6 + 0.8 * age) * gs;
    T = template(g, v % 3, 0);
    const fp = footprint(T);
    o.r = Math.min(3.5, Math.max(0.12, fp.r * s * 0.8)); o.top = Math.max(2, fp.top * s);
  } else if (o.k === O_COVER) { s = (0.6 + 0.8 * age) * Math.sqrt(gs); T = template(g, v & 1, 0); }
  else if (o.k !== O_FLOAT) {
    s = 0.8 + 0.4 * age;
    T = template(o.st ? stoneGenome(L, g, o.st) : g, v & 3, 0, styleOf(g, v));
    const fp = footprint(T);
    if (fp.top * s > LEVEL / 2) { o.r = Math.min(0.5, fp.r * s * 0.8); o.top = fp.top * s; }
  }
  // обрис для прицілювання (aim.js): циліндр радіуса ar від az0 до ah над основою
  if (T) { const e = extent(T); o.ar = e.r * s; o.az0 = e.z0 * s; o.ah = Math.max(0.1, e.top * s); }
  return (o.pose = { cx, cy, rot, s, cj });
}

// Шаблон каменя виду каміння області g (стиль — від варіанта v): тіла стенду руху
export const stoneTemplate = (g, v) => template(g, v & 3, 0, styleOf(g, v));

// Стиль каміння клітинки — з ваг стилів області
export function styleOf(g, v) {
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
// Частини окремими мешами (для анімації): тулуб із пристроєм, голова, стегна, гомілки, руки.
// Локальні координати: ноги в (0, 0, 0), обличчя — у бік +x; ліва сторона — +y. PIVOT — суглоби (кульш, коліно, плече,
// шия). Ящики замкнені (з низом: лежачи й на стіні низ видно) і не мають спільних площин різного кольору (пристрій
// заходить у тулуб): інакше крізь відкритий низ було видно дві грані в одній площині — мерехтіли (плавання, 11.10.2026)
export const FIG_K = 1.25;
export const PIVOT = { hip: 0.28 * FIG_K, knee: 0.14 * FIG_K, shoulder: 0.58 * FIG_K, neck: 0.62 * FIG_K, legY: 0.08 * FIG_K, armY: 0.21 * FIG_K };
export function figureParts(color) {
  const dark = [40, 38, 48], dark2 = [52, 50, 62], skin = [236, 200, 170], dev = [120, 240, 255], k = FIG_K;
  const part = (boxes) => {
    const M = new Mesh();
    for (const [x0, y0, z0, x1, y1, z1, c] of boxes) {
      M.box(x0 * k, y0 * k, z0 * k, x1 * k, y1 * k, z1 * k, c);
      M.quad([x0 * k, y0 * k, z0 * k], [x0 * k, y1 * k, z0 * k], [x1 * k, y1 * k, z0 * k], [x1 * k, y0 * k, z0 * k], 0, 0, -1, c);   // низ
    }
    return M.finish();
  };
  return {
    core: part([
      [-0.13, -0.17, 0.28, 0.11, 0.17, 0.62, color],
      [-0.22, -0.12, 0.32, -0.12, 0.12, 0.58, dev],                // пристрій для стрибків — на спині (заходить у тулуб)
    ]),
    head: part([
      [-0.11, -0.12, 0.62, 0.11, 0.12, 0.84, skin],
      [0.105, -0.08, 0.71, 0.125, -0.03, 0.77, dark],
      [0.105, 0.03, 0.71, 0.125, 0.08, 0.77, dark],
    ]),
    legL: part([[-0.08, 0.02, 0.14, 0.06, 0.14, 0.28, dark]]),
    legR: part([[-0.08, -0.14, 0.14, 0.06, -0.02, 0.28, dark]]),
    shinL: part([[-0.075, 0.025, 0, 0.055, 0.135, 0.145, dark2]]),
    shinR: part([[-0.075, -0.135, 0, 0.055, -0.025, 0.145, dark2]]),
    armL: part([[-0.05, 0.17, 0.33, 0.05, 0.25, 0.6, color], [-0.045, 0.175, 0.3, 0.045, 0.245, 0.33, skin]]),
    armR: part([[-0.05, -0.25, 0.33, 0.05, -0.17, 0.6, color], [-0.045, -0.245, 0.3, 0.045, -0.175, 0.33, skin]]),
  };
}
