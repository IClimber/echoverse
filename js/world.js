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
  let genMs = 0, genN = 0, objR = 0.5;      // objR — найбільша півширина перешкоди серед завантажених
  const gen = createGen(seed, (key, c, m, ms) => {
    // перешкоди-предмети за клітинкою (світові координати; меш порахував розмір — o.r, o.top)
    c.obst = new Array(CS * CS).fill(null);
    for (const o of c.obj) if (o.r > 0) {
      const z0 = o.z * LEVEL;
      c.obst[o.y * CS + o.x] = { cx: c.cx * CS + o.cx, cy: c.cy * CS + o.cy, z0, z1: z0 + o.top, r: o.r };
      if (o.r > objR) objR = o.r;
    }
    c.used = performance.now();
    const was = chunks.get(key);
    if (was) was.dead = true;
    chunks.set(key, c);
    genMs += ms; genN++;
    onMesh(key, c, m);
    if (chunks.size > KEEP) {
      const old = [...chunks].sort((a, b) => a[1].used - b[1].used).slice(0, chunks.size - KEEP * 0.9);
      for (const [k, o] of old) { o.dead = true; chunks.delete(k); }
    }
  });

  // Чанк клітинки; останній знайдений пам'ятаємо (фізика питає сусідні клітинки підряд — без складання рядків-ключів)
  let lastC = null;
  const chunkOf = (d, n, x, y) => {
    const cx = Math.floor(x / CS), cy = Math.floor(y / CS);
    if (lastC && lastC.cx === cx && lastC.cy === cy && lastC.d === d && lastC.n === n && !lastC.dead) return lastC;
    const key = ckey(d, n, cx, cy), C = chunks.get(key);
    if (C) lastC = C;
    return C;
  };

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
    // Перешкода-предмет, що росте в клітинці (x, y): {cx, cy, z0, z1, r} або null
    obst(d, n, x, y) {
      const C = chunkOf(d, n, x, y);
      return C ? C.obst[(y - C.cy * CS) * CS + x - C.cx * CS] : null;
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
      return { liquid: W.laws(d, n).liquid, block: (x, y, k) => W.block(d, n, x, y, k), obj: (x, y) => W.obst(d, n, x, y), get objR() { return objR; } };
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
    obj: (x, y) => { const c = col(x, y); if (!blocks(c.c.o)) return null; const z0 = (surfaceK(c.B, 0, c.c.h + 7) + 1) * LEVEL; return { cx: x + 0.5, cy: y + 0.5, z0, z1: z0 + 2, r: 0.4 }; },
    objR: 0.5,
  };
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx += (dy === -r || dy === r || dx === r) ? 1 : 2 * r) {
      const c = col(dx, dy), k = surfaceK(c.B, 0, c.c.h + 7);
      if (k < 0 || !solidB(c.B[k])) continue;
      const z = (k + 1) * LEVEL, x = dx + 0.5, y = dy + 0.5;
      if (!standable(P, x, y, z)) continue;
      let exits = 0;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let s = -16; s <= ph.up; s++) if (standable(P, x + ax, y + ay, z + s * LEVEL)) { exits++; break; }
      }
      if (exits >= 2) return [x, y, z];
    }
  }
  return null;
}
