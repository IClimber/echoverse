// world.js — світ у грі: зерно, закони всесвітів, стовпці й секції з генератора і запити до блоків (рух, приземлення
// після стрибка, камера, F3). Стовпець (зведення: поверхня, предмети, межі секцій) — на кожні 16×16 клітинок; секція —
// 16×16×16 блоків з рамкою. Геометрію секції віддає рендеру через onMesh.
import { lawsOf, physOf, KMIN, KMAX } from './universe.js';
import { CS, ci, bv, solidB, blocks, genColumn, B_AIR, B_STONE, O_FLOAT, SEC } from './gen/chunk.js';
import { LEVEL } from './iso.js';
import { createGen } from './gen/client.js';
import { standable } from './player.js';
import { floatPose } from './gen/mesh.js';
import { footprint } from './gen/plants.js';
import { makeBody } from './bodies.js';

export const ckey = (d, n, cx, cy) => `${d}:${n}:${cx}:${cy}`;
export const skey = (d, n, cx, cy, cz) => `${d}:${n}:${cx}:${cy}:${cz}`;
const KEEP_COLS = 1500, KEEP_SECS = 5000, KEEP_FARS = 1200;   // скільки тримати в пам'яті (секція ~6 КБ)

export function createWorld(seed, onMesh) {
  const lawsMap = new Map(), cols = new Map(), secs = new Map(), fars = new Map();
  let genMs = 0, genN = 0, objR = 0.5;
  const colTimes = [];                       // мітки часу готових стовпців за останню секунду (F3: стовпців/с)      // objR — найбільша півширина перешкоди серед завантажених
  const evict = (map, keep) => {
    if (map.size <= keep) return;
    const old = [...map].sort((a, b) => a[1].used - b[1].used).slice(0, map.size - keep * 0.9);
    for (const [k, o] of old) { o.dead = true; map.delete(k); }
  };

  // Стовпець прийшов: перешкоди-предмети за клітинкою (світові координати; розмір — o.r, o.top), тіла (ширяюче каміння)
  function addCol(key, c) {
    c.obst = new Array(CS * CS).fill(null);
    for (const o of c.obj) if (o.r > 0) {
      const z0 = o.z * LEVEL;
      c.obst[o.y * CS + o.x] = { cx: c.cx * CS + o.cx, cy: c.cy * CS + o.cy, z0, z1: z0 + o.top, r: o.r };
      if (o.r > objR) objR = o.r;
    }
    c.bodies = [];
    const L = W.laws(c.d, c.n);
    for (const o of c.obj) if (o.k === O_FLOAT) {
      const pose = floatPose(L, c.sp[o.s], o, o.x + 0.5, o.y + 0.5, o.z * LEVEL), fp = footprint(pose.T), st = L.stones[(o.st || 1) - 1];
      const h = Math.max(0.08, fp.r * pose.s * 0.75), hz = Math.max(0.06, fp.top * pose.s * 0.5);
      c.bodies.push(makeBody({
        x: c.cx * CS + pose.x, y: c.cy * CS + pose.y, z: pose.z, hx: h, hy: h, hz, dens: 0.8 + 0.6 * ((o.v >> 5 & 7) / 7),
        lift: st ? st.lift : 1.2, hover: pose.z - o.z * LEVEL, T: pose.T, s: pose.s, tilt: pose.tilt, yaw: (o.v >> 8 & 255) / 256 * Math.PI * 2, key,
      }));
    }
    // верх стовпця з предметами й поверхнею (у блоках): вище — повітря, навіть якщо секцію не завантажено
    c.kTop = (c.czHi + 1) * SEC;
    c.used = performance.now();
    const was = cols.get(key);
    if (was) was.dead = true;
    cols.set(key, c);
    evict(cols, KEEP_COLS);
  }
  const gen = createGen(seed, (key, q, data, mesh, ms) => {
    genMs += ms; genN++;
    if (q.type === 'col') { colTimes.push(performance.now()); addCol(ckey(q.d, q.n, q.cx, q.cy), data); return; }
    if (q.type === 'far') { data.used = performance.now(); fars.set(key, data); onMesh(key, data, mesh); evict(fars, KEEP_FARS); return; }
    data.used = performance.now();
    const was = secs.get(key);
    if (was) was.dead = true;
    secs.set(key, data);
    if (mesh) onMesh(key, data, mesh);
    evict(secs, KEEP_SECS);
  });

  // Стовпець і секція точки; останні знайдені пам'ятаємо (фізика питає сусідні блоки підряд — без складання рядків)
  let lastC = null, lastS = null;
  const colOf = (d, n, x, y) => {
    const cx = Math.floor(x / CS), cy = Math.floor(y / CS);
    if (lastC && lastC.cx === cx && lastC.cy === cy && lastC.d === d && lastC.n === n && !lastC.dead) return lastC;
    const C = cols.get(ckey(d, n, cx, cy));
    if (C) lastC = C;
    return C;
  };
  const secOf = (d, n, cx, cy, cz) => {
    if (lastS && lastS.cz === cz && lastS.cx === cx && lastS.cy === cy && lastS.d === d && lastS.n === n && !lastS.s.dead) return lastS.s;
    const S = secs.get(skey(d, n, cx, cy, cz));
    if (S) lastS = { d, n, cx, cy, cz, s: S };
    return S;
  };

  const W = {
    seed, gen,
    laws(d, n) {
      const k = `${d}:${n}`;
      let L = lawsMap.get(k);
      if (!L) { if (lawsMap.size > 256) lawsMap.clear(); L = lawsOf(seed, d, n); lawsMap.set(k, L); }
      return L;
    },
    col(d, n, cx, cy) { const C = cols.get(ckey(d, n, cx, cy)); if (C) C.used = performance.now(); return C; },
    hasCol: (d, n, cx, cy) => cols.has(ckey(d, n, cx, cy)),
    hasSec: (key) => secs.has(key),
    sec: (key) => secs.get(key),
    // Вид блоку (цілі x, y, k); −1 — ще не згенеровано. Нижче світу — камінь, вище — повітря; вище за предмети й поверхню
    // стовпця (поза смугою островів) — повітря, навіть без секції
    block(d, n, x, y, k) {
      if (k < KMIN) return B_STONE;
      if (k > KMAX) return B_AIR;
      const cx = Math.floor(x / CS), cy = Math.floor(y / CS), cz = Math.floor(k / SEC), S = secOf(d, n, cx, cy, cz);
      if (S) return S.empty ? (S.solid ? B_STONE : B_AIR) : S.b[bv(x - cx * CS, y - cy * CS, k - S.k0, S.nk)];
      const C = colOf(d, n, x, y);
      if (C && k >= C.kTop && !C.isl.includes(cz)) return B_AIR;
      return -1;
    },
    // Перешкода-предмет, що росте в клітинці (x, y): {cx, cy, z0, z1, r} або null
    obst(d, n, x, y) {
      const C = colOf(d, n, x, y);
      return C ? C.obst[(y - C.cy * CS) * CS + x - C.cx * CS] : null;
    },
    // Верх укриття від опадів у стовпці (x, y) — одиниці; немає даних — null
    topAt(d, n, x, y) {
      const C = colOf(d, n, x, y);
      return C ? C.top[ci(x - C.cx * CS, y - C.cy * CS)] * LEVEL : null;
    },
    // Поверхня клітинки (для F3): {h, t, v, bm} або null
    column(d, n, x, y) {
      const C = colOf(d, n, x, y);
      if (!C) return null;
      const i = ci(x - C.cx * CS, y - C.cy * CS);
      return { h: C.h[i], t: C.t[i], v: C.v[i], bm: C.bm[i] };
    },
    // Тіла стовпців навколо (x, y) у радіусі r клітинок
    bodiesNear(d, n, x, y, r = 3) {
      const out = [];
      for (let cy = Math.floor((y - r) / CS); cy <= Math.floor((y + r) / CS); cy++) for (let cx = Math.floor((x - r) / CS); cx <= Math.floor((x + r) / CS); cx++) {
        const C = cols.get(ckey(d, n, cx, cy));
        if (C) for (const b of C.bodies) if (Math.abs(b.x - x) < r + b.hx && Math.abs(b.y - y) < r + b.hy) out.push(b);
      }
      return out;
    },
    // Тіла стовпців з ключами keys (видимі) — для малювання
    bodiesIn(keys) {
      const out = [];
      for (const k of keys) { const C = cols.get(k); if (C && C.bodies) for (const b of C.bodies) out.push(b); }
      return out;
    },
    // «Щуп» для фізики гравця у всесвіті (d, n) — див. player.js
    probe(d, n) {
      return {
        liquid: W.laws(d, n).liquid, block: (x, y, k) => W.block(d, n, x, y, k), obj: (x, y) => W.obst(d, n, x, y), get objR() { return objR; },
        bodies: (x, y) => W.bodiesNear(d, n, x, y, 2),
      };
    },
    wantCol(d, n, cx, cy, pri) { gen.want('c' + ckey(d, n, cx, cy), { type: 'col', d, n, cx, cy }, pri); return 'c' + ckey(d, n, cx, cy); },
    // Плитка далечі (крок s): запит (готова — far(key): zmin, zmax; меш — у рендері), ключ
    wantFar(d, n, tx, ty, s, pri) { const key = `f${d}:${n}:${tx}:${ty}:${s}`; gen.want(key, { type: 'far', d, n, tx, ty, s }, pri); return key; },
    far: (key) => { const F = fars.get(key); if (F) F.used = performance.now(); return F; },
    wantSec(d, n, cx, cy, cz, pri) { const key = skey(d, n, cx, cy, cz); gen.want(key, { type: 'sec', d, n, cx, cy, cz }, pri); return key; },
    stats: () => {
      const now = performance.now();
      while (colTimes.length && now - colTimes[0] > 1000) colTimes.shift();
      return { cols: cols.size, secs: secs.size, genMs: genN ? genMs / genN : 0, pending: gen.pending, colsPerSec: colTimes.length, workers: gen.stats().workers };
    },
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
  const surf = (c) => { for (let k = c.c.h + (c.c.fb || 0) + 1; k >= 0; k--) if (c.at(k) !== B_AIR) return k; return -1; };
  const P = {
    liquid: L.liquid,
    block: (x, y, k) => col(x, y).at(k),
    obj: (x, y) => { const c = col(x, y); if (!blocks(c.c.o)) return null; const z0 = (surf(c) + 1) * LEVEL; return { cx: x + 0.5, cy: y + 0.5, z0, z1: z0 + 2, r: 0.4 }; },
    objR: 0.5,
  };
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx += (dy === -r || dy === r || dx === r) ? 1 : 2 * r) {
      const c = col(dx, dy), k = surf(c);
      if (k < 0 || !solidB(c.at(k))) continue;
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
