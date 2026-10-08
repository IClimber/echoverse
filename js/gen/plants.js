// gen/plants.js — геометрія рослин і каміння з генома (gen/flora.js). Лише вигляд, тож тригонометрія дозволена.
// Вид будується раз — шаблон (кілька варіантів будови з різним зерном і спрощений — для далечі; кеш), а кожна
// рослина — шаблон з поворотом, нахилом, віком (масштаб) і розкидом кольору (place): однакових немає.
// Будова: дерева — рекурсивне галуження (рівні, кут, закрут, спад довжини й товщини, тропізм від гравітації,
// крона: кулі, грона, пластини, парасолі, звислі пасма, голки, кінчики), хвойні — яруси конусів, пальми — вигнутий
// стовбур і віяло листя; гриби (шапки шести форм), кактуси (ребра, рукави, пласкі сегменти), корали й щупальця,
// кристали, бамбук і очерет; трава, квіти, папороті, кущі, лишайник, сукуленти; каміння шести стилів.
import { rng } from '../rng.js';
import { M_LEAF, M_BARK, M_CRYSTAL, M_CAP, M_PETAL, M_BLADE, M_CACTUS, M_CORAL, M_STEM, M_ROCK, M_CLIFF } from './materials.js';

const TAU = Math.PI * 2;
const sh = (c, k) => [Math.min(255, c[0] * k | 0), Math.min(255, c[1] * k | 0), Math.min(255, c[2] * k | 0)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t | 0, a[1] + (b[1] - a[1]) * t | 0, a[2] + (b[2] - a[2]) * t | 0];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const UP = [0, 0, 1];

// Будівник шаблону: трикутники з власними вершинами (пласкі грані). Нормаль — від порядку вершин, повернута від
// точки ref (усередині тіла); без ref — угору; flatUp — завжди (0, 0, 1): трава й пелюстки освітлені як земля
class Geo {
  constructor(R, lod) { this.p = []; this.n = []; this.c = []; this.m = []; this.R = R; this.lod = lod; this.flatUp = false; }
  tri(a, b, c, col, mat, ref) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    if (this.flatUp) { nx = 0; ny = 0; nz = 1; } else {
      let flip = nz < 0;
      if (ref) flip = nx * ((a[0] + b[0] + c[0]) / 3 - ref[0]) + ny * ((a[1] + b[1] + c[1]) / 3 - ref[1]) + nz * ((a[2] + b[2] + c[2]) / 3 - ref[2]) < 0;
      const k = (flip ? -1 : 1) / l;
      nx *= k; ny *= k; nz *= k;
    }
    for (const q of [a, b, c]) { this.p.push(q[0], q[1], q[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.m.push(mat); }
  }
  quad(a, b, c, d, col, mat, ref) { this.tri(a, b, c, col, mat, ref); this.tri(a, c, d, col, mat, ref); }
  finish() {
    const n = new Int8Array(this.n.length);
    for (let i = 0; i < n.length; i++) n[i] = Math.round(this.n[i] * 127);
    return { p: new Float32Array(this.p), n, c: new Uint8Array(this.c), m: new Uint8Array(this.m), verts: this.p.length / 3 };
  }
}

// Два одиничні вектори, перпендикулярні d
function frame(d) {
  const u = norm(cross(d, Math.abs(d[2]) < 0.9 ? UP : [1, 0, 0]));
  return [u, cross(d, u)];
}
// Напрям d, відхилений на кут a в бік азимута az (у площині, перпендикулярній d)
function tilt(d, a, az) {
  const [u, v] = frame(d), s = Math.sin(a);
  return norm(add(mul(d, Math.cos(a)), add(mul(u, Math.cos(az) * s), mul(v, Math.sin(az) * s))));
}
// Зрізана призма від a до b (радіуси r0, r1; r1 = 0 — конус). o: rot — поворот перерізу, star — ребра (зірчастий
// переріз), cap / bot — кришка зверху / знизу (кольори capCol / botCol)
function prism(G, a, b, r0, r1, sides, col, mat, o = {}) {
  const d = norm(sub(b, a)), [u, v] = frame(d), n = o.star ? sides * 2 : sides, rot = o.rot || 0;
  const ring = (c, r) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = rot + i * TAU / n, rr = o.star && i & 1 ? r * (1 - o.star) : r;
      out.push(add(c, add(mul(u, Math.cos(t) * rr), mul(v, Math.sin(t) * rr))));
    }
    return out;
  };
  const A = ring(a, r0), mid = mul(add(a, b), 0.5);
  if (r1 <= 1e-5) { for (let i = 0; i < n; i++) G.tri(A[i], A[(i + 1) % n], b, col, mat, a); }
  else {
    const B = ring(b, r1);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; G.quad(A[i], A[j], B[j], B[i], col, mat, mid); }
    if (o.cap) for (let i = 0; i < n; i++) G.tri(B[i], B[(i + 1) % n], b, o.capCol || col, mat, a);
  }
  if (o.bot) for (let i = 0; i < n; i++) G.tri(A[i], A[(i + 1) % n], a, o.botCol || col, mat, b);
}
// Багатогранник: ікосаедр (у далечі й дрібний — октаедр) з розкиданими вершинами — грудка листя, камінь, шапка.
// o: az — поворот навколо вертикалі, jit — розкид, shade — грані трохи різні за світлістю
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2, v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { v, f };
})();
const OCT = { v: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], f: [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]] };
function blob(G, c, rx, ry, rz, col, mat, o = {}) {
  const P = G.lod || o.oct || Math.max(rx, ry, rz) < 0.1 ? OCT : ICO, R = G.R, jit = o.jit ?? 0.3, ca = Math.cos(o.az || 0), sa = Math.sin(o.az || 0);
  const V = P.v.map(([x, y, z]) => {
    const k = 1 + (R() - 0.5) * jit, X = x * rx * k, Y = y * ry * k;
    return [c[0] + X * ca - Y * sa, c[1] + X * sa + Y * ca, c[2] + z * rz * k];
  });
  for (const [i, j, k] of P.f) G.tri(V[i], V[j], V[k], o.shade ? sh(col, 0.9 + R() * 0.18) : col, mat, c);
}
// Пласка смужка вздовж точок pts з шириною w(t) (лист пальми, папороті): ширина — поперек напряму side
function strip(G, pts, side, w, col, mat) {
  for (let k = 1; k < pts.length; k++) {
    const t0 = (k - 1) / (pts.length - 1), t1 = k / (pts.length - 1), a = pts[k - 1], b = pts[k];
    G.quad(add(a, mul(side, -w(t0))), add(a, mul(side, w(t0))), add(b, mul(side, w(t1))), add(b, mul(side, -w(t1))), col, mat);
  }
}
// Лезо трави: від основи b угору на h з вигином у бік out, ширина w
function blade(G, b, out, h, lean, w, col, mat) {
  const side = [-out[1], out[0], 0];
  const m = add(b, [out[0] * h * lean * 0.35, out[1] * h * lean * 0.35, h * 0.55]), tip = add(b, [out[0] * h * lean, out[1] * h * lean, h]);
  const lb = add(b, mul(side, -w)), rb = add(b, mul(side, w)), ml = add(m, mul(side, -w * 0.7)), mr = add(m, mul(side, w * 0.7));
  G.tri(lb, rb, mr, col, mat); G.tri(lb, mr, ml, col, mat); G.tri(ml, mr, tip, col, mat);
}
const disc = (R, r) => { const a = R() * TAU, d = Math.sqrt(R()) * r; return [Math.cos(a) * d, Math.sin(a) * d, 0]; };

// ================= Дерево: рекурсивне галуження =================
// o: levels, nBr, ang, lenR, trunkF, trunkR, crown, leafR, trop, twist, fruit, lean, sides, apical, roots, flat, strand,
// barkCol, barkMat
function tree(G, g, o) {
  const R = G.R, lod = G.lod, H = g.h;
  let segs = o.small ? 8 : lod ? 5 : 18, leaves = o.small ? 6 : lod ? 4 : 12;
  const leafCols = [g.leaf, sh(g.leaf, 1.13), sh(g.leaf, 0.86)], barkCol = o.barkCol || g.bark, barkMat = o.barkMat || M_BARK;
  const flatAz = R() * TAU;
  const crown = (p, d) => {
    if (leaves-- <= 0) return;
    const s = o.leafR * (0.8 + 0.4 * R()), col = leafCols[R() * 3 | 0];
    switch (o.crown) {
      case 'ball': blob(G, p, s, s, s * 0.85, col, M_LEAF, { shade: 1 }); break;
      case 'cluster': for (let k = 0; k < (lod ? 1 : 3); k++) blob(G, add(p, mul(disc(R, s * 0.7), 1)), s * 0.6, s * 0.6, s * 0.5, leafCols[k % 3], M_LEAF, { shade: 1 }); break;
      case 'umbrella': blob(G, add(p, [0, 0, s * 0.15]), s * 1.5, s * 1.5, s * 0.42, col, M_LEAF, { shade: 1, jit: 0.2 }); break;
      case 'plates': prism(G, p, add(p, [0, 0, s * 0.2]), s * 1.25, s * 1.1, lod ? 5 : 7, col, M_LEAF, { rot: R() * TAU, cap: true, bot: !lod, botCol: sh(col, 0.8) }); break;
      case 'needles': prism(G, add(p, mul(d, -s * 0.3)), add(p, mul(d, s * 1.5)), s * 0.55, 0, 5, col, M_LEAF, { bot: true }); break;
      case 'droop':
        blob(G, p, s * 0.85, s * 0.85, s * 0.6, col, M_LEAF, { shade: 1 });
        if (!lod) for (let k = 0; k < 5; k++) { const q = add(p, disc(R, s * 0.8)); prism(G, q, add(q, [0, 0, -o.strand * (0.6 + 0.6 * R())]), 0.035, 0.012, 3, leafCols[k % 3], M_LEAF); }
        break;
      case 'tips': blob(G, p, s * 0.4, s * 0.4, s * 0.4, g.acc, M_CORAL); break;
      case 'crystal': prism(G, p, add(p, mul(d, s * 1.6)), s * 0.28, 0, 4, g.acc, M_CRYSTAL); break;
      default: break;                                                // 'none' — голі гілки
    }
    if (o.fruit && !lod && R() < o.fruit) for (let k = 0; k < 2; k++) blob(G, add(p, add(disc(R, s * 0.8), [0, 0, -s * 0.55])), s * 0.14, s * 0.14, s * 0.16, g.acc, M_PETAL);
  };
  const branch = (pos, dir, len, r, lvl, next) => {
    segs--;
    const d2 = norm([dir[0], dir[1], dir[2] + o.trop * 0.6]);
    const sides = lod ? (r > 0.06 ? 4 : 3) : r > 0.09 ? o.sides : r > 0.035 ? 4 : 3;
    let end;
    if (!lod && len > 0.6 && segs > 0) {
      const mid = add(pos, mul(dir, len / 2));
      end = add(mid, mul(d2, len / 2));
      prism(G, pos, mid, r, r * 0.86, sides, barkCol, barkMat);
      prism(G, mid, end, r * 0.86, r * 0.72, sides, barkCol, barkMat);
      segs--;
    } else { end = add(pos, mul(norm(add(dir, d2)), len)); prism(G, pos, end, r, r * 0.72, sides, barkCol, barkMat); }
    if (lvl >= o.levels || segs <= 0) { crown(end, d2); return; }
    const base = R() * TAU;
    for (let i = 0; i < o.nBr && segs > 0; i++) {
      const az = o.flat ? flatAz + (i & 1 ? Math.PI : 0) + (R() - 0.5) * 0.5 : base + i * TAU / o.nBr + (R() - 0.5) * o.twist;
      const cd = tilt(d2, o.ang * (0.75 + 0.5 * R()), az);
      branch(end, cd, next * (0.8 + 0.4 * R()), r * 0.62, lvl + 1, next * o.lenR);
    }
    if (o.apical && segs > 0) branch(end, tilt(d2, 0.15 * R(), R() * TAU), next * 0.9, r * 0.7, lvl + 1, next * o.lenR);
  };
  const trunkLen = H * o.trunkF, az = R() * TAU;
  const tdir = norm([Math.cos(az) * o.lean, Math.sin(az) * o.lean, 1]);
  if (o.roots && !lod) for (let k = 0, n = 3 + (R() * 3 | 0); k < n; k++) {
    const a = k * TAU / n + R() * 0.5, top = [0, 0, trunkLen * 0.22];
    prism(G, top, [Math.cos(a) * o.trunkR * 2.4, Math.sin(a) * o.trunkR * 2.4, -0.05], o.trunkR * 0.55, o.trunkR * 0.25, 4, barkCol, barkMat);
  }
  let series = 0;
  for (let l = 0; l < o.levels; l++) series += Math.pow(o.lenR, l);
  const L1 = Math.max(0.15, H - trunkLen - o.leafR * 0.7) / Math.max(1, series) / (0.45 + 0.55 * Math.cos(o.ang));
  branch([0, 0, -0.05], tdir, trunkLen, o.trunkR, 0, o.levels ? L1 : 0);
}

const pick = (list, u) => list[Math.min(list.length - 1, Math.floor(u * list.length))];
const fruitOf = (P) => P[22] > 0.62 ? (P[22] - 0.62) * 2.2 : 0;
// Тропізм від гравітації: легка — гілки вгору, важка — донизу
const gtrop = (g) => (1 - g.g) * 0.45;

const FORM = {
  broadleaf(G, g) {
    const P = g.p, H = g.h;
    tree(G, g, {
      levels: 2 + (P[11] > 0.55 ? 1 : 0), nBr: 2 + Math.floor(P[12] * 2.99), ang: 0.4 + 0.6 * P[13], lenR: 0.55 + 0.25 * P[14],
      trunkF: 0.3 + 0.25 * P[16], trunkR: H * (0.035 + 0.03 * P[17]), crown: pick(['ball', 'cluster', 'ball', 'cluster', 'plates', 'umbrella'], P[18]),
      leafR: H * (0.14 + 0.1 * P[19]), trop: -0.2 + 0.6 * P[20] + gtrop(g), twist: 0.5 + 1.5 * P[21], fruit: fruitOf(P), lean: 0.25 * P[23], sides: 5, apical: P[11] < 0.3,
    });
  },
  birch(G, g) {
    const P = g.p, H = g.h;
    tree(G, g, {
      levels: 2, nBr: 2 + Math.floor(P[12] * 1.99), ang: 0.3 + 0.35 * P[13], lenR: 0.5 + 0.2 * P[14], trunkF: 0.45 + 0.2 * P[16],
      trunkR: H * (0.02 + 0.012 * P[17]), crown: pick(['cluster', 'ball', 'needles'], P[18]), leafR: H * (0.08 + 0.06 * P[19]),
      trop: 0.3 + 0.4 * P[20] + gtrop(g), twist: 1, fruit: 0, lean: 0.12 * P[23], sides: 5, apical: true,
    });
  },
  giant(G, g) {
    const P = g.p, H = g.h;
    tree(G, g, {
      levels: 2 + (P[11] > 0.5 ? 1 : 0), nBr: 3 + Math.floor(P[12] * 1.99), ang: 0.5 + 0.5 * P[13], lenR: 0.55 + 0.2 * P[14],
      trunkF: 0.35 + 0.2 * P[16], trunkR: H * (0.06 + 0.03 * P[17]), crown: pick(['ball', 'cluster', 'umbrella'], P[18]), leafR: H * (0.13 + 0.06 * P[19]),
      trop: -0.1 + 0.5 * P[20] + gtrop(g), twist: 1, fruit: fruitOf(P), lean: 0.08 * P[23], sides: 6, apical: P[11] < 0.5, roots: true,
    });
  },
  willow(G, g) {
    const P = g.p, H = g.h;
    tree(G, g, {
      levels: 2, nBr: 3 + Math.floor(P[12] * 1.99), ang: 0.6 + 0.5 * P[13], lenR: 0.6 + 0.2 * P[14], trunkF: 0.35 + 0.15 * P[16],
      trunkR: H * (0.04 + 0.02 * P[17]), crown: 'droop', leafR: H * (0.12 + 0.06 * P[19]), strand: H * (0.25 + 0.2 * P[22]),
      trop: -0.1 + 0.3 * P[20] + gtrop(g), twist: 1, fruit: 0, lean: 0.2 * P[23], sides: 5,
    });
  },
  dead(G, g) {
    const P = g.p, H = g.h;
    tree(G, g, {
      levels: 2 + (P[11] > 0.5 ? 1 : 0), nBr: 2 + Math.floor(P[12] * 1.99), ang: 0.5 + 0.7 * P[13], lenR: 0.55 + 0.25 * P[14],
      trunkF: 0.3 + 0.3 * P[16], trunkR: H * (0.03 + 0.02 * P[17]), crown: P[18] > 0.85 ? 'tips' : 'none', leafR: H * 0.06,
      trop: -0.3 + 0.8 * P[20] + gtrop(g), twist: 2, fruit: 0, lean: 0.3 * P[23], sides: 5,
    });
  },
  umbrella(G, g) {
    const P = g.p, H = g.h;
    tree(G, g, {
      levels: 1 + (P[11] > 0.5 ? 1 : 0), nBr: 2 + Math.floor(P[12] * 2.99), ang: 0.5 + 0.4 * P[13], lenR: 0.6 + 0.2 * P[14],
      trunkF: 0.35 + 0.2 * P[16], trunkR: H * (0.035 + 0.02 * P[17]), crown: P[18] > 0.7 ? 'plates' : 'umbrella', leafR: H * (0.14 + 0.08 * P[19]),
      trop: 0.5 + gtrop(g), twist: 1, fruit: fruitOf(P), lean: 0.15 * P[23], sides: 5,
    });
  },
  coral(G, g) { coralTree(G, g, 3); },
  coralbit(G, g) { coralTree(G, g, 2); },
  conifer(G, g) {
    const P = g.p, H = g.h, R = G.R, lod = G.lod;
    const style = P[18] < 0.6 ? 'cones' : P[18] < 0.85 ? 'layers' : 'column';
    const az = R() * TAU, lean = 0.06 * P[23], top = [Math.cos(az) * lean * H, Math.sin(az) * lean * H, H * 0.92];
    prism(G, [0, 0, -0.05], top, H * (0.025 + 0.015 * P[17]), H * 0.01, lod ? 4 : 5, g.bark, M_BARK);
    const z0 = H * (0.12 + 0.25 * P[16]), rMax = H * (0.18 + 0.12 * P[19]) * (style === 'column' ? 0.6 : 1);
    const n = style === 'column' ? 2 : 3 + Math.floor(P[11] * 3.99), nn = lod ? Math.min(n, 3) : n;
    const sides = lod ? 4 : 5 + Math.floor(P[12] * 2.99), droop = (0.15 + 0.35 * P[20]) * Math.min(1.6, g.g);
    for (let i = 0; i < nn; i++) {
      const t = i / nn, zb = z0 + (H - z0) * t * 0.8, r = rMax * (1 - t * 0.68) * (0.9 + 0.2 * R()), h = (H - z0) / nn;
      const c = [top[0] * zb / H, top[1] * zb / H, zb], col = i & 1 ? sh(g.leaf, 0.9) : g.leaf;
      if (style === 'layers') prism(G, add(c, [0, 0, -droop * r * 0.3]), add(c, [0, 0, h * 0.35]), r, r * 0.7, sides, col, M_LEAF, { cap: true, bot: !lod, botCol: sh(col, 0.75), rot: R() * TAU });
      else prism(G, add(c, [0, 0, -droop * r * 0.4]), add(c, [0, 0, h * (style === 'column' ? 2.4 : 1.8)]), r, 0, sides, col, M_LEAF, { bot: !lod, botCol: sh(col, 0.7), rot: R() * TAU });
    }
    if (style === 'layers') prism(G, top, add(top, [0, 0, H * 0.12]), rMax * 0.25, 0, sides, g.leaf, M_LEAF);
  },
  palm(G, g) {
    const P = g.p, H = g.h, R = G.R, lod = G.lod;
    const n = lod ? 2 : 4, az = R() * TAU, bend = 0.12 + 0.5 * P[23];
    let pos = [0, 0, -0.05], r = H * (0.03 + 0.015 * P[17]);
    for (let k = 0; k < n; k++) {
      const a = bend * (k + 1) / n, d = [Math.cos(az) * Math.sin(a), Math.sin(az) * Math.sin(a), Math.cos(a)], nx = add(pos, mul(d, H / n));
      prism(G, pos, nx, r, r * 0.9, lod ? 4 : 6, k & 1 ? sh(g.bark, 0.9) : g.bark, M_BARK, { rot: k * 0.5 });
      pos = nx; r *= 0.9;
    }
    const nf = lod ? 5 : 5 + Math.floor(P[12] * 5), Lf = H * (0.32 + 0.18 * P[19]), droop = 0.45 + 0.5 * P[20] + (g.g - 1) * 0.3, seg = lod ? 2 : 4;
    for (let i = 0; i < nf; i++) {
      const a = i * TAU / nf + R() * 0.4, out = [Math.cos(a), Math.sin(a), 0], pts = [];
      for (let k = 0; k <= seg; k++) { const t = k / seg; pts.push(add(pos, [out[0] * Lf * t, out[1] * Lf * t, Lf * (0.35 * t - droop * t * t)])); }
      strip(G, pts, [-out[1], out[0], 0], (t) => Lf * (0.04 + 0.13 * Math.sin(Math.PI * Math.min(1, t * 1.1))), i & 1 ? sh(g.leaf, 0.88) : g.leaf, M_LEAF);
    }
    if (P[22] > 0.5 && !lod) for (let k = 0; k < 3; k++) blob(G, add(pos, add(disc(R, r * 2), [0, 0, -r * 2])), r * 1.1, r * 1.1, r * 1.1, g.acc, M_PETAL);
  },
  bigshroom(G, g) { mushroom(G, g, true); },
  shroom(G, g) { mushroom(G, g, false); },
  reed(G, g) { reeds(G, g, true); },
  reedlet(G, g) { reeds(G, g, false); },
  tentacle(G, g) {
    const P = g.p, H = g.h, R = G.R, lod = G.lod;
    const n = lod ? Math.min(2, 1 + Math.floor(P[12] * 3.99)) : 1 + Math.floor(P[12] * 3.99), segs = lod ? 3 : 7;
    const amp = 0.3 + 0.6 * P[13], freq = 1 + 2 * P[14];
    for (let i = 0; i < n; i++) {
      const h = H * (i ? 0.5 + 0.5 * R() : 1), phase = R() * TAU, az = R() * TAU;
      let pos = i ? add(disc(R, H * 0.22), [0, 0, -0.05]) : [0, 0, -0.05], r = H * (0.05 + 0.03 * P[17]) * (i ? 0.8 : 1);
      for (let k = 0; k < segs; k++) {
        const t = (k + 1) / segs, a = amp * Math.sin(freq * t * Math.PI + phase) * t;
        const d = [Math.cos(az) * Math.sin(a), Math.sin(az) * Math.sin(a), Math.cos(a)], nx = add(pos, mul(d, h / segs));
        prism(G, pos, nx, r, r * 0.82, lod ? 4 : 5, mix(g.leaf, g.acc, t * 0.7), M_CORAL);
        pos = nx; r *= 0.82;
      }
      blob(G, pos, r * 2.4, r * 2.4, r * 2.6, g.acc, M_CAP);
    }
  },
  cactus(G, g) {
    const P = g.p, H = g.h, R = G.R, lod = G.lod;
    const style = P[18] < 0.45 ? 'saguaro' : P[18] < 0.7 ? 'barrel' : P[18] < 0.85 ? 'organ' : 'pads';
    const ribs = lod ? 5 : 5 + Math.floor(P[12] * 4.99), star = lod ? 0 : 0.1 + 0.12 * P[13], col = g.leaf;
    const flowers = P[22] > 0.55 && !lod;
    const column = (a, h, r) => {
      const b = add(a, [0, 0, h]);
      prism(G, a, b, r, r * 0.93, ribs, col, M_CACTUS, { star });
      prism(G, b, add(b, [0, 0, r * 0.7]), r * 0.93, 0, ribs, sh(col, 1.06), M_CACTUS, { star });
      if (flowers) for (let k = 0; k < 3; k++) blob(G, add(b, add(disc(R, r * 0.6), [0, 0, r * 0.65])), r * 0.25, r * 0.25, r * 0.2, g.acc, M_PETAL);
    };
    if (style === 'saguaro') {
      const r = H * (0.08 + 0.04 * P[17]);
      column([0, 0, -0.05], H * 0.85, r);
      const arms = lod ? Math.min(2, Math.floor(P[11] * 3.99)) : Math.floor(P[11] * 3.99);
      for (let i = 0; i < arms; i++) {
        const az = i * TAU / arms + R(), z = H * (0.25 + 0.35 * R()), out = r + H * (0.1 + 0.1 * P[14]);
        const e = [Math.cos(az) * out, Math.sin(az) * out, z + r * 0.4];
        prism(G, [Math.cos(az) * r * 0.5, Math.sin(az) * r * 0.5, z], e, r * 0.62, r * 0.6, ribs, col, M_CACTUS, { star });
        column(add(e, [0, 0, -r * 0.3]), H * (0.18 + 0.25 * R()), r * 0.6);
      }
    } else if (style === 'barrel') column([0, 0, -0.05], H * 0.5, H * (0.22 + 0.1 * P[17]));
    else if (style === 'organ') {
      for (let i = 0, n = lod ? 3 : 3 + Math.floor(P[11] * 4); i < n; i++) column(add(disc(R, H * 0.16), [0, 0, -0.05]), H * (0.5 + 0.5 * R()), H * (0.06 + 0.03 * P[17]));
    } else {
      let budget = lod ? 3 : 9;
      const pad = (c, az, s, lvl) => {
        if (budget-- <= 0) return;
        blob(G, c, s * 0.7, s * 0.16, s, sh(col, 0.92 + 0.16 * R()), M_CACTUS, { az, jit: 0.15 });
        if (flowers && lvl > 0 && R() < 0.5) blob(G, add(c, [0, 0, s * 0.95]), s * 0.15, s * 0.15, s * 0.12, g.acc, M_PETAL);
        if (lvl >= 2) return;
        for (let k = 0, n = 1 + (R() * 2 | 0); k < n; k++) {
          const side = (R() - 0.5) * 1.2, a2 = az + (R() - 0.5) * 1.6;
          pad(add(c, [Math.cos(az) * side * s * 0.6, Math.sin(az) * side * s * 0.6, s * 1.5]), a2, s * 0.8, lvl + 1);
        }
      };
      pad([0, 0, H * 0.3], R() * TAU, H * 0.3, 0);
    }
  },
  crystal(G, g) { crystals(G, g, true); },
  smallcrystal(G, g) { crystals(G, g, false); },
  grass(G, g) {
    const P = g.p, H = g.h, R = G.R, n = 5 + Math.floor(P[12] * 6), lean = 0.15 + 0.5 * P[13], w = 0.022 + 0.025 * P[19];
    G.flatUp = true;
    for (let i = 0; i < n; i++) {
      const b = disc(R, 0.24), az = Math.atan2(b[1], b[0]) + (R() - 0.5) * 1.2, h = H * (0.55 + 0.45 * R());
      blade(G, b, [Math.cos(az), Math.sin(az), 0], h, lean, w, sh(g.leaf, 0.85 + 0.3 * R()), M_BLADE);
      if (P[22] > 0.7 && R() < 0.5) blob(G, add(b, [Math.cos(az) * h * lean, Math.sin(az) * h * lean, h]), 0.025, 0.025, 0.04, g.acc, M_PETAL);
    }
  },
  flower(G, g) {
    const P = g.p, H = g.h, R = G.R, heads = 1 + Math.floor(P[11] * 2.99), np = 4 + Math.floor(P[12] * 4.99);
    const pl = H * (0.22 + 0.2 * P[19]), cup = 0.1 + 1.0 * P[13], mid = P[14] > 0.5 ? [236, 206, 72] : sh(g.acc, 0.45);
    G.flatUp = true;
    for (let i = 0; i < heads; i++) {
      const b = i ? disc(R, 0.16) : [0, 0, 0], h = H * (0.65 + 0.35 * R()), az = R() * TAU, out = [Math.cos(az), Math.sin(az), 0];
      blade(G, b, out, h, 0.12, 0.014, g.leaf, M_BLADE);
      blade(G, add(b, [0, 0, h * 0.15]), [-out[1], out[0], 0], h * 0.35, 0.9, 0.03, sh(g.leaf, 0.9), M_BLADE);
      const top = add(b, [out[0] * h * 0.12, out[1] * h * 0.12, h]), col = sh(g.acc, 0.9 + 0.2 * R());
      for (let k = 0; k < np; k++) {
        const a = k * TAU / np + R() * 0.2, o = [Math.cos(a), Math.sin(a), 0], side = [-o[1] * pl * 0.32, o[0] * pl * 0.32, 0];
        const tip = add(top, [o[0] * pl * Math.cos(cup), o[1] * pl * Math.cos(cup), pl * Math.sin(cup)]), m = add(top, mul(sub(tip, top), 0.45));
        G.quad(top, add(m, mul(side, -1)), tip, add(m, side), col, M_PETAL);
      }
      blob(G, add(top, [0, 0, 0.01]), pl * 0.3, pl * 0.3, pl * 0.22, mid, M_PETAL);
    }
  },
  bush(G, g) {
    const P = g.p, H = g.h, R = G.R;
    if (P[18] < 0.55) {
      for (let i = 0, n = 2 + Math.floor(P[12] * 2.99); i < n; i++) {
        const s = H * (0.35 + 0.2 * R()), c = add(disc(R, H * 0.35), [0, 0, s * 0.7]);
        blob(G, c, s, s, s * 0.8, [g.leaf, sh(g.leaf, 1.12), sh(g.leaf, 0.88)][i % 3], M_LEAF, { shade: 1 });
        if (P[22] > 0.6) for (let k = 0; k < 3; k++) blob(G, add(c, add(disc(R, s * 0.7), [0, 0, s * 0.5])), 0.03, 0.03, 0.03, g.acc, M_PETAL);
      }
    } else tree(G, g, { levels: 2, nBr: 3, ang: 0.7, lenR: 0.6, trunkF: 0.05, trunkR: 0.025, crown: 'ball', leafR: H * 0.22, trop: 0.3, twist: 1.5, fruit: fruitOf(P), lean: 0, sides: 3, small: true });
  },
  fern(G, g) {
    const P = g.p, H = g.h, R = G.R, n = 5 + Math.floor(P[12] * 4.99), Lf = H * (1.0 + 0.4 * P[19]), rise = 0.6 + 0.5 * P[13];
    G.flatUp = true;
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n + R() * 0.4, out = [Math.cos(a), Math.sin(a), 0], pts = [];
      for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push([out[0] * Lf * t * 0.85, out[1] * Lf * t * 0.85, H * rise * 1.6 * t * (1 - t * 0.8)]); }
      strip(G, pts, [-out[1], out[0], 0], (t) => Lf * (0.03 + 0.11 * Math.sin(Math.PI * Math.min(1, t * 1.05))), i & 1 ? sh(g.leaf, 0.88) : g.leaf, M_BLADE);
    }
  },
  lichen(G, g) {
    const P = g.p, H = g.h, R = G.R, col = P[18] > 0.5 ? mix(g.acc, [150, 150, 140], 0.45) : g.leaf;
    for (let i = 0, n = 2 + Math.floor(P[12] * 3.99); i < n; i++) {
      const s = H * (1.5 + 1.5 * R());
      blob(G, disc(R, 0.28), s, s, H * 0.8, sh(col, 0.88 + 0.24 * R()), M_LEAF, { jit: 0.4, oct: true });
    }
  },
  shrub(G, g) {
    const P = g.p, H = g.h, R = G.R;
    for (let i = 0, n = 4 + Math.floor(P[12] * 5.99); i < n; i++) {
      const d = tilt(UP, 0.25 + 0.75 * R() * (0.4 + 0.6 * P[13]), R() * TAU), tip = mul(d, H * (0.7 + 0.5 * R()));
      prism(G, [0, 0, -0.02], tip, 0.014, 0.006, 3, g.bark, M_BARK);
      if (P[19] > 0.4) blob(G, tip, 0.04, 0.04, 0.035, g.leaf, M_LEAF);
    }
  },
  succulent(G, g) {
    const P = g.p, H = g.h, R = G.R, n = 5 + Math.floor(P[12] * 7.99), t0 = 0.3 + 0.6 * P[13];
    for (let k = 0; k < n; k++) {
      const ring = k / n, a = k * 2.4 + R() * 0.2, len = H * (1.0 + 0.4 * P[19]) * (1 - ring * 0.45);
      const d = tilt(UP, t0 * (1.2 - ring * 0.8), a);
      prism(G, [0, 0, 0], mul(d, len), H * 0.22 * (1 - ring * 0.3), 0, 4, sh(g.leaf, 0.85 + 0.3 * ring), M_CACTUS, { rot: a, bot: true });
    }
    if (P[22] > 0.7) { const t = [0, 0, H * 2.4]; prism(G, [0, 0, 0], t, 0.012, 0.008, 3, g.leaf, M_STEM); blob(G, t, 0.05, 0.05, 0.05, g.acc, M_PETAL); }
  },
};

function coralTree(G, g, levels) {
  const P = g.p, H = g.h;
  tree(G, g, {
    levels, nBr: 2 + Math.floor(P[12] * 1.99), ang: 0.35 + 0.4 * P[13], lenR: 0.65 + 0.2 * P[14], trunkF: 0.05 + 0.1 * P[16],
    trunkR: H * (0.045 + 0.03 * P[17]), crown: P[19] > 0.75 ? 'crystal' : 'tips', leafR: H * (0.1 + 0.05 * P[19]),
    trop: 0.4 + 0.4 * P[20] + gtrop(g), twist: 1.2, fruit: 0, lean: 0.1 * P[23], sides: 5, flat: P[18] > 0.6, barkCol: g.leaf, barkMat: M_CORAL, small: !g.big,
  });
}

function mushroom(G, g, big) {
  const P = g.p, H = g.h, R = G.R, lod = G.lod;
  const count = lod ? 1 : big ? 1 + (P[11] > 0.65) + (P[11] > 0.88) : 1 + Math.floor(P[11] * 3.99);
  const style = pick(['dome', 'flat', 'cone', 'funnel', 'layers', 'puff'], P[18]);
  const stemCol = mix(g.bark, [232, 224, 206], 0.75), gill = mix(g.acc, [240, 232, 214], 0.6);
  for (let m = 0; m < count; m++) {
    const s = m ? 0.4 + 0.4 * R() : 1, hg = H * s, base = m ? mul(disc(R, H * (big ? 0.35 : 1.4)), 1) : [0, 0, 0];
    const az = R() * TAU, lean = 0.25 * P[23] + (m ? 0.2 : 0), d = norm([Math.cos(az) * lean, Math.sin(az) * lean, 1]);
    const top = add(base, mul(d, hg * 0.85)), capR = hg * (0.3 + 0.3 * P[19]), stemR = hg * (big ? 0.06 + 0.06 * P[17] : 0.09 + 0.06 * P[17]);
    const sides = lod || !big ? 6 : 8;
    if (style !== 'puff') prism(G, add(base, [0, 0, -0.03]), top, stemR, stemR * 0.8, lod || !big ? 4 : 6, stemCol, M_STEM);
    switch (style) {
      case 'dome': blob(G, top, capR, capR, capR * 0.55, g.acc, M_CAP, { jit: 0.12 }); if (!lod) prism(G, add(top, [0, 0, -capR * 0.12]), top, capR * 0.85, capR * 0.85, sides, gill, M_STEM, { bot: true }); break;
      case 'flat': prism(G, top, add(top, [0, 0, capR * 0.25]), capR, capR * 0.85, sides, g.acc, M_CAP, { cap: true, bot: true, botCol: gill }); break;
      case 'cone': prism(G, add(top, [0, 0, -capR * 0.1]), add(top, [0, 0, capR * 1.3]), capR * 0.85, 0, sides, g.acc, M_CAP, { bot: true, botCol: gill }); break;
      case 'funnel': prism(G, top, add(top, [0, 0, capR * 0.6]), capR * 0.25, capR, sides, g.acc, M_CAP, { cap: true, capCol: gill }); break;
      case 'layers': for (let k = 0; k < 3; k++) { const c = add(top, [0, 0, -k * capR * 0.45]), r = capR * (0.55 + k * 0.3); prism(G, c, add(c, [0, 0, capR * 0.14]), r, r * 0.9, sides, sh(g.acc, 1 - k * 0.08), M_CAP, { cap: true, bot: true, botCol: gill }); } break;
      default: blob(G, add(base, [0, 0, capR * 0.9]), capR * 1.1, capR * 1.1, capR, g.acc, M_CAP, { jit: 0.15 });
    }
  }
}

function reeds(G, g, big) {
  const P = g.p, H = g.h, R = G.R, lod = G.lod;
  const n = big ? (lod ? 4 : 5 + Math.floor(P[12] * 4.99)) : 3 + Math.floor(P[12] * 4.99), spread = big ? H * 0.12 : H * 0.15;
  const nodes = big ? 3 + Math.floor(P[11] * 1.99) : 1, col = big ? g.leaf : sh(g.leaf, 0.95);
  for (let i = 0; i < n; i++) {
    const b = add(disc(R, spread), [0, 0, -0.03]), h = H * (0.6 + 0.4 * R()), out = norm([b[0] + 1e-6, b[1], 0]);
    const d = norm([out[0] * (0.05 + 0.12 * P[23]), out[1] * (0.05 + 0.12 * P[23]), 1]), r = big ? H * (0.018 + 0.014 * P[17]) : 0.012;
    let pos = b;
    for (let k = 0; k < nodes; k++) {
      const nx = add(pos, mul(d, h / nodes));
      prism(G, pos, nx, r, r * 0.95, lod ? 3 : 4, col, M_STEM);
      if (big && !lod && k) prism(G, add(pos, mul(d, -0.03)), add(pos, mul(d, 0.03)), r * 1.4, r * 1.4, 4, sh(col, 0.8), M_STEM);
      pos = nx;
    }
    if (big && !lod) for (let k = 0; k < 2; k++) {
      const a = R() * TAU, o = [Math.cos(a), Math.sin(a), 0], at = add(pos, mul(d, -h * 0.15 * k)), tip = add(at, [o[0] * H * 0.24, o[1] * H * 0.24, -H * 0.06]);
      G.flatUp = true;
      strip(G, [at, mul(add(at, tip), 0.5), tip], [-o[1], o[0], 0], (t) => H * 0.022 * Math.sin(Math.PI * Math.min(1, 0.15 + t)), sh(g.leaf, 1.1), M_LEAF);
      G.flatUp = false;
    }
    if (!big && P[22] > 0.4) prism(G, add(pos, mul(d, -h * 0.25)), add(pos, mul(d, -h * 0.06)), r * 3, r * 3, 5, mix(g.bark, g.acc, 0.2), M_STEM, { cap: true });
  }
}

function crystals(G, g, big) {
  const P = g.p, H = g.h, R = G.R, lod = G.lod;
  const n = big ? (lod ? 3 : 3 + Math.floor(P[12] * 4.99)) : 1 + Math.floor(P[12] * 2.99), sides = lod ? 4 : 4 + Math.floor(P[17] * 2.99);
  const spread = 0.12 + 0.5 * P[13];
  for (let i = 0; i < n; i++) {
    const az = R() * TAU, a = i ? spread * (0.5 + 0.6 * R()) : spread * 0.2, len = H * (i ? 0.3 + 0.5 * R() : 1), r = len * (0.1 + 0.08 * P[19]);
    const base = i ? [Math.cos(az) * r * 1.3, Math.sin(az) * r * 1.3, -0.05] : [0, 0, -0.05];
    const d = [Math.cos(az) * Math.sin(a), Math.sin(az) * Math.sin(a), Math.cos(a)], mid = add(base, mul(d, len * 0.78)), col = sh(g.leaf, 0.85 + 0.3 * R()), rot = R() * TAU;
    prism(G, base, mid, r, r, sides, col, M_CRYSTAL, { rot });
    prism(G, mid, add(base, mul(d, len)), r, 0, sides, sh(col, 1.12), M_CRYSTAL, { rot });
  }
}

// ================= Каміння =================
const STONE = {
  boulder(G, g) {
    const R = G.R, s = 0.22 + 0.16 * R(), col = g.leaf;
    blob(G, [0, 0, s * 0.35], s, s * (0.7 + 0.3 * R()), s * (0.55 + 0.3 * g.p[4]), col, M_ROCK, { shade: 1, jit: 0.25 + 0.3 * g.p[4] });
    if (R() < 0.5) blob(G, [s * 0.9, s * 0.3, s * 0.12], s * 0.45, s * 0.4, s * 0.3, sh(col, 0.92), M_ROCK, { shade: 1 });
  },
  slabs(G, g) {
    const R = G.R;
    let z = -0.02;
    for (let i = 0, n = 2 + (R() * 3 | 0); i < n; i++) {
      const w = 0.34 * (1 - i * 0.15), h = 0.08 + 0.07 * R(), o = disc(R, 0.06);
      prism(G, [o[0], o[1], z], [o[0], o[1], z + h], w, w * 0.94, 4, sh(g.leaf, 0.88 + 0.2 * R()), M_CLIFF, { rot: R() * TAU, cap: true, capCol: sh(g.leaf, 1.05) });
      z += h;
    }
  },
  spire(G, g) {
    const R = G.R, h = 0.8 + 1.4 * R(), r = 0.14 + 0.08 * R(), rot = R() * TAU, top = [(R() - 0.5) * 0.15, (R() - 0.5) * 0.15, h * 0.75];
    prism(G, [0, 0, -0.05], top, r, r * 0.6, 5, g.leaf, M_CLIFF, { rot });
    prism(G, top, add(top, [0, 0, h * 0.25]), r * 0.6, 0, 5, sh(g.leaf, 1.05), M_CLIFF, { rot });
  },
  cairn(G, g) {
    const R = G.R;
    let z = 0, s = 0.2;
    for (let i = 0, n = 3 + (R() * 3 | 0); i < n; i++) { blob(G, [(R() - 0.5) * 0.06, (R() - 0.5) * 0.06, z + s * 0.5], s, s * 0.9, s * 0.5, sh(g.leaf, 0.85 + 0.3 * R()), M_ROCK, { shade: 1, jit: 0.2 }); z += s * 0.85; s *= 0.78; }
  },
  geode(G, g) {
    const R = G.R, s = 0.26 + 0.1 * R();
    blob(G, [0, 0, s * 0.3], s, s * 0.85, s * 0.6, g.leaf, M_ROCK, { shade: 1 });
    for (let i = 0, n = 3 + (R() * 3 | 0); i < n; i++) {
      const d = tilt(UP, 0.2 + 0.6 * R(), R() * TAU), b = add([0, 0, s * 0.45], mul(d, s * 0.3)), len = 0.15 + 0.2 * R();
      prism(G, b, add(b, mul(d, len)), len * 0.18, 0, 5, sh(g.acc, 0.9 + 0.25 * R()), M_CRYSTAL);
    }
  },
  log(G, g) {
    const R = G.R, az = R() * TAU, len = 0.75 + 0.15 * R(), r = 0.1 + 0.06 * R();
    const a = [-Math.cos(az) * len / 2, -Math.sin(az) * len / 2, r * 0.85], b = [Math.cos(az) * len / 2, Math.sin(az) * len / 2, r * 0.85];
    prism(G, a, b, r, r * 0.95, 6, g.bark, M_BARK, { cap: true, bot: true, capCol: sh(g.bark, 1.5), botCol: sh(g.bark, 1.5), rot: R() });
  },
};

// ================= Шаблони й розміщення =================
const cache = new Map();
// Шаблон виду g (варіант будови variant, lod 1 — спрощений для далечі); для каміння — стиль style
export function template(g, variant, lod, style) {
  const key = `${g.key}:${style || ''}:${variant}:${lod}`;
  let T = cache.get(key);
  if (T) return T;
  const G = new Geo(rng((g.id ^ Math.imul(variant + 1, 0x9e3779b9) ^ (lod ? 0x51ed : 0)) >>> 0), lod);
  if (style) STONE[style](G, g); else FORM[g.form](G, g);
  T = G.finish();
  if (cache.size > 4000) cache.clear();
  cache.set(key, T);
  return T;
}

// Шаблон T у меш M (gen/mesh.js Mesh) у точці (x, y, z): поворот rot навколо вертикалі, нахил tl, масштаб s,
// множники кольору cj [r, g, b]
export function place(M, T, x, y, z, rot, s, tl, cj) {
  const c = Math.cos(rot), sn = Math.sin(rot), ct = Math.cos(tl), st = Math.sin(tl), P = T.p, N = T.n, C = T.c, base = M.n;
  for (let i = 0, j = 0; i < T.verts; i++, j += 3) {
    const px = P[j], y1 = P[j + 1] * ct - P[j + 2] * st, z1 = P[j + 1] * st + P[j + 2] * ct;
    M.p.push(x + (px * c - y1 * sn) * s, y + (px * sn + y1 * c) * s, z + z1 * s);
    const nx = N[j], ny = N[j + 1] * ct - N[j + 2] * st, nz = N[j + 1] * st + N[j + 2] * ct;
    M.nr.push(nx * c - ny * sn | 0, nx * sn + ny * c | 0, nz | 0);
    M.c.push(Math.min(255, C[j] * cj[0] | 0), Math.min(255, C[j + 1] * cj[1] | 0), Math.min(255, C[j + 2] * cj[2] | 0));
    M.mt.push(T.m[i]);
    M.i.push(base + i);
  }
  M.n += T.verts;
}
