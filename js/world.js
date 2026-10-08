// world.js — світ у грі: зерно, закони всесвітів, чанки з генератора і запити до блоків (рух, приземлення після
// стрибка, камера, F3). Геометрію чанка віддає рендеру через onMesh.
import { lawsOf, physOf } from './universe.js';
import { CS, ci, bi, H, solidB, blocks, genColumn, surfaceK, B_AIR, B_STONE } from './gen/chunk.js';
import { LEVEL } from './iso.js';
import { createGen } from './gen/client.js';
import { standable } from './player.js';

export const ckey = (d, n, cx, cy) => `${d}:${n}:${cx}:${cy}`;
const KEEP = 600;                  // скільки чанків даних тримати в пам'яті (~33 КБ кожен)

export function createWorld(seed, onMesh) {
  const lawsMap = new Map(), chunks = new Map();
  let genMs = 0, genN = 0;
  const gen = createGen(seed, (key, c, m, ms) => {
    // основи предметів, що заважають ходити: блок, на якому стоять (−1 — немає)
    c.objk = new Int16Array(CS * CS).fill(-1);
    for (const o of c.obj) if (blocks(o.k)) c.objk[o.y * CS + o.x] = o.z;
    c.used = performance.now();
    chunks.set(key, c);
    genMs += ms; genN++;
    onMesh(key, c, m);
    if (chunks.size > KEEP) {
      const old = [...chunks].sort((a, b) => a[1].used - b[1].used).slice(0, chunks.size - KEEP * 0.9);
      for (const [k] of old) chunks.delete(k);
    }
  });

  const chunkOf = (d, n, x, y) => chunks.get(ckey(d, n, Math.floor(x / CS), Math.floor(y / CS)));

  const W = {
    seed, gen,
    laws(d, n) {
      const k = `${d}:${n}`;
      let L = lawsMap.get(k);
      if (!L) { if (lawsMap.size > 256) lawsMap.clear(); L = lawsOf(seed, d, n); lawsMap.set(k, L); }
      return L;
    },
    chunk(d, n, cx, cy) {
      const c = chunks.get(ckey(d, n, cx, cy));
      if (c) c.used = performance.now();
      return c;
    },
    has: (key) => chunks.has(key),
    // Вид блоку (цілі x, y, k); −1 — чанк ще не згенеровано. Нижче світу — камінь, вище — повітря
    block(d, n, x, y, k) {
      if (k < 0) return B_STONE;
      if (k >= H) return B_AIR;
      const C = chunkOf(d, n, x, y);
      return C ? C.b[bi(x - C.cx * CS, y - C.cy * CS, k)] : -1;
    },
    // Блок, на якому стоїть предмет, що заважає ходити, у клітинці (x, y); −1 — немає
    objk(d, n, x, y) {
      const C = chunkOf(d, n, x, y);
      return C ? C.objk[(y - C.cy * CS) * CS + x - C.cx * CS] : -1;
    },
    // Поверхня клітинки (для F3): {h, t, v, bm} або null
    column(d, n, x, y) {
      const C = chunkOf(d, n, x, y);
      if (!C) return null;
      const i = ci(x - C.cx * CS, y - C.cy * CS);
      return { h: C.h[i], t: C.t[i], v: C.v[i], bm: C.bm[i] };
    },
    // «Щуп» для фізики гравця у всесвіті (d, n) — див. player.js
    probe(d, n) {
      return { liquid: W.laws(d, n).liquid, block: (x, y, k) => W.block(d, n, x, y, k), obj: (x, y) => W.objk(d, n, x, y) };
    },
    want(d, n, cx, cy, pri) { gen.want(ckey(d, n, cx, cy), d, n, cx, cy, pri); },
    stats: () => ({ chunks: chunks.size, genMs: genN ? genMs / genN : 0, pending: gen.pending }),
    stop() { gen.stop(); },
  };
  return W;
}

// Місце появи в новому світі: найближча до (0, 0) клітинка стартового всесвіту (0, 0), де на відкритій поверхні
// можна стояти і з якої можна зійти. Детерміноване (спіраль від центру), тож те саме зерно — те саме місце.
// Повертає [x, y, z] (z — ноги) або null
export function findSpawn(seed, d = 0, n = 0, maxR = 200) {
  const L = lawsOf(seed, d, n), ph = physOf(L), cols = new Map();
  const col = (x, y) => { const k = `${x},${y}`; let c = cols.get(k); if (!c) { c = genColumn(L, x, y); cols.set(k, c); } return c; };
  const P = {
    liquid: L.liquid,
    block: (x, y, k) => k < 0 ? B_STONE : k >= H ? B_AIR : col(x, y).B[k],
    obj: (x, y) => { const c = col(x, y); return blocks(c.c.o) ? surfaceK(c.B, 0, c.c.h + 7) + 1 : -1; },
  };
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx += (dy === -r || dy === r || dx === r) ? 1 : 2 * r) {
      const c = col(dx, dy), k = surfaceK(c.B, 0, c.c.h + 7);
      if (k < 0 || !solidB(c.B[k])) continue;
      const z = (k + 1) * LEVEL, x = dx + 0.5, y = dy + 0.5;
      if (!standable(P, x, y, z)) continue;
      let exits = 0;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let s = -ph.down; s <= ph.up; s++) if (standable(P, x + ax, y + ay, z + s * LEVEL)) { exits++; break; }
      }
      if (exits >= 2) return [x, y, z];
    }
  }
  return null;
}
