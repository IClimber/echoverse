// world.js — світ у грі: зерно, закони всесвітів, стовпці й секції з генератора і запити до блоків (рух, приземлення
// після стрибка, камера, F3). Стовпець (зведення: поверхня, предмети, межі секцій) — на кожні 16×16 клітинок; секція —
// 16×16×16 блоків з рамкою. Геометрію віддає рендеру через onMesh(kind: 'sec' | 'flora' | 'far', d, n, ключ, запит, дані, меш):
// ключ секції — sk, рослин — ck, плитки далечі — рядок. Груба секція (робота lod, рівень q.lod) — теж 'sec', без блоків:
// у світі не зберігається.
import { lawsOf, physOf, KMIN, KMAX } from './universe.js';
import { CS, ci, bv, solidB, blocks, genColumn, B_AIR, B_STONE, O_FLOAT, SEC } from './gen/chunk.js';
import { LEVEL } from './iso.js';
import { createGen } from './gen/client.js';
import { standable, GRAVITY, PLAYER_MASS, PLAYER_AREA } from './player.js';
import { floatPose } from './gen/mesh.js';
import { footprint } from './gen/plants.js';
import { makeBody, configureBodies } from './engine/physics/bodies.js';

// тіла рушія — зі сталими гри (блок, тверде, тяжіння, еталон маси й площі — гравець)
configureBodies({ level: LEVEL, solid: solidB, gravity: GRAVITY, refMass: PLAYER_MASS, refArea: PLAYER_AREA });

// Числові ключі: стовпець (|cx|, |cy| < 2^20 — точно, < 2^42) і секція (cz ∈ −512…511, < 2^52)
export const ck = (cx, cy) => (cx + 0x100000) * 0x200000 + (cy + 0x100000);
export const sk = (cx, cy, cz) => ck(cx, cy) * 1024 + (cz + 512);
// Рядкові ключі робіт генератора й мешів рендера
export const skey = (d, n, cx, cy, cz) => `${d}:${n}:${cx}:${cy}:${cz}`;
// Скільки тримати в пам'яті (секція ~6 КБ) — від дальності (стрімінг: setKeep(keepFor(R)))
export const keepFor = (R) => { const n = Math.ceil(Math.PI * (R / CS + 1) ** 2); return { cols: Math.max(1500, Math.ceil(n * 1.8)), secs: Math.max(5000, n * 6), fars: 1500 }; };

export function createWorld(seed, onMesh) {
  const lawsMap = new Map(), fars = new Map();
  // Всесвіти: 'd:n' → {d, n, cols: Map(ck → стовпець), secs: Map(sk → секція), at — коли був поточним}. Давність —
  // мітка used (touch* ставить нову; сортування — лише під час витіснення)
  const unis = new Map();
  let keep = keepFor(256);
  let genMs = 0, genN = 0, objR = 0.5, nCols = 0, nSecs = 0, cur = null, lastU = null;   // objR — найбільша півширина перешкоди серед завантажених
  const colTimes = [];                       // мітки часу готових стовпців за останню секунду (F3: стовпців/с)
  const uni = (d, n, make) => {
    if (lastU && lastU.d === d && lastU.n === n) return lastU;
    let U = unis.get(`${d}:${n}`);
    if (!U && make) { U = { d, n, cols: new Map(), secs: new Map(), at: 0 }; unis.set(`${d}:${n}`, U); }
    if (U) lastU = U;
    return U;
  };
  // Витіснити найдавніше понад keep (до 0,9·keep): спершу всесвіти, що давно не були поточними, потім поточний
  const trim = (kind, total, keep) => {
    if (total <= keep) return total;
    const order = [...unis.values()].filter((U) => U !== cur).sort((a, b) => a.at - b.at);
    if (cur) order.push(cur);
    for (const U of order) {
      const map = U[kind];
      for (const [k, o] of [...map].sort((a, b) => a[1].used - b[1].used)) {
        if (total <= keep * 0.9) break;
        o.dead = true; map.delete(k); total--;
      }
      if (!U.cols.size && !U.secs.size && U !== cur) { unis.delete(`${U.d}:${U.n}`); if (lastU === U) lastU = null; }
      if (total <= keep * 0.9) break;
    }
    return total;
  };
  let stamp = 0;
  const touch = (map, k) => { const o = map.get(k); if (o) o.used = ++stamp; return o; };

  // Стовпець прийшов: перешкоди-предмети за клітинкою (світові координати; розмір — o.r, o.top), тіла (ширяюче каміння)
  function addCol(c) {
    c.obst = new Array(CS * CS).fill(null);
    for (const o of c.obj) if (o.r > 0) {
      const z0 = o.z * LEVEL;
      c.obst[o.y * CS + o.x] = { cx: c.cx * CS + o.cx, cy: c.cy * CS + o.cy, z0, z1: z0 + o.top, r: o.r };
      if (o.r > objR) objR = o.r;
    }
    c.bodies = [];
    const L = W.laws(c.d, c.n), key = ck(c.cx, c.cy);
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
    const U = uni(c.d, c.n, true), was = U.cols.get(key);
    if (was) { was.dead = true; U.cols.delete(key); } else nCols++;
    c.used = ++stamp;
    U.cols.set(key, c);
    nCols = trim('cols', nCols, keep.cols);
  }
  const gen = createGen(seed, (key, q, data, mesh, ms) => {
    genMs += ms; genN++;
    if (q.type === 'col') { colTimes.push(performance.now()); addCol(data); W.dirty = true; return; }
    if (q.type === 'far') {
      fars.delete(key); fars.set(key, data); onMesh('far', q.d, q.n, key, q, data, mesh);
      if (fars.size > keep.fars) for (const k of fars.keys()) { if (fars.size <= keep.fars * 0.9) break; fars.delete(k); }
      return;
    }
    if (q.type === 'flora') { onMesh('flora', q.d, q.n, ck(q.cx, q.cy), q, data, mesh); return; }
    if (q.type === 'lod') { onMesh('sec', q.d, q.n, sk(q.cx, q.cy, q.cz), q, null, mesh); return; }
    const U = uni(q.d, q.n, true), k = sk(q.cx, q.cy, q.cz), was = U.secs.get(k);
    if (was) { was.dead = true; U.secs.delete(k); } else nSecs++;
    data.used = ++stamp;
    U.secs.set(k, data);
    onMesh('sec', q.d, q.n, k, q, data, mesh);
    nSecs = trim('secs', nSecs, keep.secs);
  });

  // Стовпець і секція точки; останні знайдені пам'ятаємо (фізика питає сусідні блоки підряд)
  let lastC = null, lastS = null;
  const colOf = (d, n, x, y) => {
    const cx = Math.floor(x / CS), cy = Math.floor(y / CS);
    if (lastC && lastC.cx === cx && lastC.cy === cy && lastC.d === d && lastC.n === n && !lastC.dead) return lastC;
    const U = uni(d, n), C = U && U.cols.get(ck(cx, cy));
    if (C) lastC = C;
    return C;
  };
  const secOf = (d, n, cx, cy, cz) => {
    if (lastS && lastS.cz === cz && lastS.cx === cx && lastS.cy === cy && lastS.d === d && lastS.n === n && !lastS.s.dead) return lastS.s;
    const U = uni(d, n), S = U && U.secs.get(sk(cx, cy, cz));
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
    col(d, n, cx, cy) { const U = uni(d, n); return U && U.cols.get(ck(cx, cy)); },
    sec(d, n, cx, cy, cz) { const U = uni(d, n); return U && U.secs.get(sk(cx, cy, cz)); },
    hasCol(d, n, cx, cy) { const U = uni(d, n); return !!U && U.cols.has(ck(cx, cy)); },
    hasSec(d, n, cx, cy, cz) { const U = uni(d, n); return !!U && U.secs.has(sk(cx, cy, cz)); },
    // Давність для витіснення (кличе стрімінг для потрібного)
    touchCol(d, n, cx, cy) { const U = uni(d, n); return U && touch(U.cols, ck(cx, cy)); },
    touchSec(d, n, cx, cy, cz) { const U = uni(d, n); return U && touch(U.secs, sk(cx, cy, cz)); },
    setKeep(k) { keep = k; },
    dirty: false,                            // прийшли зведення стовпців (стрімінг перерахує)
    // Поточний всесвіт (витісняється останнім)
    setCurrent(d, n) { cur = uni(d, n, true); cur.at = performance.now(); },
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
      const U = uni(d, n);
      if (!U) return out;
      for (let cy = Math.floor((y - r) / CS); cy <= Math.floor((y + r) / CS); cy++) for (let cx = Math.floor((x - r) / CS); cx <= Math.floor((x + r) / CS); cx++) {
        const C = U.cols.get(ck(cx, cy));
        if (C) for (const b of C.bodies) if (Math.abs(b.x - x) < r + b.hx && Math.abs(b.y - y) < r + b.hy) out.push(b);
      }
      return out;
    },
    // «Щуп» для фізики гравця у всесвіті (d, n) — див. player.js
    probe(d, n) {
      return {
        liquid: W.laws(d, n).liquid, block: (x, y, k) => W.block(d, n, x, y, k), obj: (x, y) => W.obst(d, n, x, y), get objR() { return objR; },
        bodies: (x, y) => W.bodiesNear(d, n, x, y, 2),
      };
    },
    wantCol(d, n, cx, cy, pri) { const key = `c${d}:${n}:${cx}:${cy}`; gen.want(key, { type: 'col', d, n, cx, cy }, pri); return key; },
    // Плитка далечі (крок s): запит (готова — far(key): zmin, zmax; меш — у рендері), ключ
    wantFar(d, n, tx, ty, s, pri) { const key = `f${d}:${n}:${tx}:${ty}:${s}`; gen.want(key, { type: 'far', d, n, tx, ty, s }, pri); return key; },
    far: (key) => { const F = fars.get(key); if (F) { fars.delete(key); fars.set(key, F); } return F; },
    // Рослини зблизька стовпця (меш — у рендері)
    wantFlora(d, n, cx, cy, pri) { const key = `p${d}:${n}:${cx}:${cy}`; gen.want(key, { type: 'flora', d, n, cx, cy }, pri); return key; },
    // Груба секція рівня lod (1, 2) — лише меш для рендера
    wantLod(d, n, cx, cy, cz, lod, pri) { const key = `l${lod}:${d}:${n}:${cx}:${cy}:${cz}`; gen.want(key, { type: 'lod', lod, d, n, cx, cy, cz }, pri); return key; },
    wantSec(d, n, cx, cy, cz, pri) { const key = skey(d, n, cx, cy, cz); gen.want(key, { type: 'sec', d, n, cx, cy, cz }, pri); return key; },
    stats: () => {
      const now = performance.now();
      while (colTimes.length && now - colTimes[0] > 1000) colTimes.shift();
      return { cols: nCols, secs: nSecs, genMs: genN ? genMs / genN : 0, pending: gen.pending, colsPerSec: colTimes.length, workers: gen.stats().workers };
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
