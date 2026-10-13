// gen/pack.js — щільна вершина регіону (16 Б), без індексів: вершина на кожен кут трикутника.
// Позиція — u16 ×4 (x, y, z, матеріал): (локальна від кута регіону + PO) × PQ, четвертий u16 — номер матеріалу (з міткою проріджування, gen/materials.js MAT_BITS); нормаль —
// i8 ×4 (x, y, z, 0); колір — u8 ×4 (r, g, b, AO: 255 — відкрито, 0 — темно). Кожен елемент — по 4 Б (PlayCanvas, WebGPU). Регіон — RS×RS стовпців × RS секцій (128 × 128 клітинок × 64 од.). Діапазон локальних: x, y ∈ [−192, 320),
// z ∈ [−64, 448) — запас на крони й велетнів, що виходять за регіон; точність 1/128. Лише вигляд (Math.round можна).
import { CS, SEC } from './chunk.js';
import { LEVEL } from '../universe.js';

export const VB = 16, PQ = 128, PO = [192, 192, 64], RS = 8, RW = RS * CS, RH = RS * SEC * LEVEL;
export const regionOf = (cx, cy, cz) => [Math.floor(cx / RS), Math.floor(cy / RS), Math.floor(cz / RS)];
// Зсув кута стовпця (секції) від кута його регіону — одиниці
export const frameOf = (cx, cy, cz) => {
  const [rx, ry, rz] = regionOf(cx, cy, cz);
  return [(cx - rx * RS) * CS, (cy - ry * RS) * CS, (cz - rz * RS) * SEC * LEVEL];
};
export const packStats = { overflow: 0 };

const q16 = (v, a) => {
  const q = Math.round((v + PO[a]) * PQ);
  if (q < 0) { packStats.overflow++; return 0; }
  if (q > 65535) { packStats.overflow++; return 65535; }
  return q;
};

// m — {pos, nor, col, mat, idx, count} (Mesh.finish); (dx, dy, dz) — зсув його координат до кута регіону.
// → {buf: ArrayBuffer, n — вершин, bb: [x0, y0, z0, x1, y1, z1] — коробка в локальних регіону}
export function packMesh(m, dx = 0, dy = 0, dz = 0) {
  const n = m ? m.count : 0, buf = new ArrayBuffer(n * VB), u16 = new Uint16Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], D = [dx, dy, dz];
  for (let j = 0; j < n; j++) {
    const v = m.idx[j];
    for (let a = 0; a < 3; a++) {
      const p = m.pos[v * 3 + a] + D[a], q = q16(p, a);
      u16[j * 8 + a] = q;
      const r = q / PQ - PO[a];
      if (r < bb[a]) bb[a] = r;
      if (r > bb[a + 3]) bb[a + 3] = r;
      i8[j * 16 + 8 + a] = m.nor[v * 3 + a];
      u8[j * 16 + 12 + a] = m.col[v * 3 + a];
    }
    u16[j * 8 + 3] = m.mat[v];
    u8[j * 16 + 15] = m.ao ? m.ao[v] : 255;
  }
  return { buf, n, bb };
}

// Два результати packMesh → один (a, потім b)
export function concat(a, b) {
  const buf = new ArrayBuffer((a.n + b.n) * VB), u8 = new Uint8Array(buf);
  u8.set(new Uint8Array(a.buf), 0); u8.set(new Uint8Array(b.buf), a.n * VB);
  const bb = a.bb.map((v, i) => i < 3 ? Math.min(v, b.bb[i]) : Math.max(v, b.bb[i]));
  return { buf, n: a.n + b.n, bb };
}

// Назад у масиви (тести): позиції — локальні регіону
export function unpack(buf) {
  const n = buf.byteLength / VB, u16 = new Uint16Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
  const pos = new Float32Array(n * 3), nor = new Int8Array(n * 3), col = new Uint8Array(n * 3), mat = new Uint8Array(n), ao = new Uint8Array(n), thin = new Uint16Array(n);
  for (let j = 0; j < n; j++) {
    for (let a = 0; a < 3; a++) { pos[j * 3 + a] = u16[j * 8 + a] / PQ - PO[a]; nor[j * 3 + a] = i8[j * 16 + 8 + a]; col[j * 3 + a] = u8[j * 16 + 12 + a]; }
    mat[j] = u16[j * 8 + 3] & 31; thin[j] = u16[j * 8 + 3] >> 5;
    ao[j] = u8[j * 16 + 15];
  }
  return { pos, nor, col, mat, ao, thin, n };
}

// Відбиток меша, що не залежить від порядку трикутників і циклічного повороту вершин: сума (mod 2^32) FNV-1a кожного
// трикутника (48 Б), повернутого так, що першою йде найменша вершина (лексикографічно за 16 байтами).
// Канонічний порядок байтів вершини для відбитка — розкладка до 10.10.2026 (позиція 0–5, нормаль 6–8, колір 10–12,
// матеріал 13 — молодший байт pos.w, AO 14, решта — нулі): MESH_GOLD не залежить від розкладки. CANON[i] — звідки взяти
// канонічний байт i (−1 — нуль)
const CANON = [0, 1, 2, 3, 4, 5, 8, 9, 10, -1, 12, 13, 14, 6, 15, -1];
export function meshHash(buf) {
  const src = new Uint8Array(buf), nv = buf.byteLength / VB, nt = nv / 3, u8 = new Uint8Array(nv * VB);
  for (let j = 0; j < nv; j++) for (let i = 0; i < VB; i++) if (CANON[i] >= 0) u8[j * VB + i] = src[j * VB + CANON[i]];
  const less = (a, b) => { for (let i = 0; i < VB; i++) if (u8[a + i] !== u8[b + i]) return u8[a + i] < u8[b + i]; return false; };
  let sum = 0;
  for (let t = 0; t < nt; t++) {
    const o = t * VB * 3, v = [o, o + VB, o + VB * 2];
    let f = 0;
    if (less(v[1], v[f])) f = 1;
    if (less(v[2], v[f])) f = 2;
    let h = 0x811c9dc5;
    for (let r = 0; r < 3; r++) { const s = v[(f + r) % 3]; for (let i = 0; i < VB; i++) h = Math.imul(h ^ u8[s + i], 16777619); }
    sum = (sum + (h >>> 0)) >>> 0;
  }
  return { n: nt * 3, sum };
}
export const meshDigest = (h) => `${h.n}:${(h.sum >>> 0).toString(16).padStart(8, '0')}`;
