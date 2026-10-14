// collision.js — джерело зіткнень гри: трикутники того, що малюється. Земля — той самий chunkMesh(...).solid секції
// 16³ з тих самих блоків (рамка в блок з усіх боків), що будує worker для рендеру; дерева й каміння — 12-кутні призми
// (world.obst: стовбур, брила); тіла — коробки. Рушій (engine/physics/collide.js, character.js) бере трикутники через
// src.gather(коробка, список). P — «щуп» світу (player.js): block, obj, objR, bodies, liquid; необов'язково sec (секція
// з масивом b — швидкий шлях), laws (для chunkMesh; геометрія від законів не залежить), ver (лічильник даних світу).
import { chunkMesh } from './gen/mesh.js';
import { CS, CW, FR, SEC, bv, solidB, B_STONE, B_LIQ } from './gen/chunk.js';
import { lawsOf, LEVEL } from './universe.js';
import { pushTri, prismTris, boxTris, createList, clearList, rayCast } from './engine/physics/collide.js';

const MAX_SECS = 128;                // секцій у кеші (найдавніша — геть)
const NB = CW * CW * (SEC + 2 * FR);
let GEOM_L = null;                   // закони для chunkMesh, коли P їх не має (кольори не потрібні)
const ZERO = new Uint8Array(CW * CW), ZERO16 = new Int16Array(CW * CW);

const all = new WeakMap();
export function colliderOf(P) {
  let c = all.get(P);
  if (!c) all.set(P, (c = createCollider(P)));
  return c;
}
export const stats = { secs: 0, tris: 0, builds: 0, buildMs: 0, maxMs: 0, slow: 0, virt: 0, temp: 0 };

function createCollider(P) {
  const secs = new Map();
  let stampN = 0;
  const vb = new Uint8Array(NB);

  // Трикутники секції (cx, cy, cz): з масиву b (рамка FR з усіх боків) — chunkMesh, як у worker
  // Верх ґрунту клітинок стовпця (cx, cy) з рамкою (C.sky, блоки): прямі стіни — лише під стелею (mesh.js). Світ — зі
  // зведення стовпця; без нього (P.sky немає — тести, стенди) — найвищий твердий блок над секцією з P.block (до +64)
  function skyOf(cx, cy, K) {
    if (P.sky) return P.sky(cx, cy);
    const s = new Int16Array(CW * CW);
    for (let y = -FR; y < CS + FR; y++) for (let x = -FR; x < CS + FR; x++) {
      let k = K + SEC + 64;
      while (k > K - FR - 1) { const q = P.block(cx * CS + x, cy * CS + y, k); if (q !== -1 && solidB(q)) break; k--; }
      s[(y + FR) * CW + x + FR] = k;
    }
    return s;
  }
  function fromBlocks(b, k0, nk, cx, cy) {
    const L = P.laws || GEOM_L || (GEOM_L = lawsOf(0, 0, 0));
    const m = chunkMesh({ cx, cy, b, k0, nk, h: ZERO16, bm: ZERO, v: ZERO, lt: null, top: null, sky: skyOf(cx, cy, k0), obj: [], sp: [] }, L, { near: false, far: false }).solid;
    const n = m.count / 3, pos = new Float32Array(n * 9), hint = new Float32Array(n * 3), zr = new Float32Array(n * 2);
    const cnt = new Int32Array(CS * CS + 1);
    const cells = (i, f) => {
      const p = pos, o = i * 9;
      const xa = Math.max(0, Math.min(CS - 1, Math.floor(Math.min(p[o], p[o + 3], p[o + 6])))), xb = Math.max(0, Math.min(CS - 1, Math.floor(Math.max(p[o], p[o + 3], p[o + 6]) - 1e-6)));
      const ya = Math.max(0, Math.min(CS - 1, Math.floor(Math.min(p[o + 1], p[o + 4], p[o + 7])))), yb = Math.max(0, Math.min(CS - 1, Math.floor(Math.max(p[o + 1], p[o + 4], p[o + 7]) - 1e-6)));
      for (let y = ya; y <= Math.max(ya, yb); y++) for (let x = xa; x <= Math.max(xa, xb); x++) f(y * CS + x);
    };
    for (let i = 0; i < n; i++) {
      for (let v = 0; v < 3; v++) {
        const j = m.idx[i * 3 + v];
        pos[i * 9 + v * 3] = m.pos[j * 3]; pos[i * 9 + v * 3 + 1] = m.pos[j * 3 + 1]; pos[i * 9 + v * 3 + 2] = m.pos[j * 3 + 2];
        hint[i * 3] += m.nor[j * 3]; hint[i * 3 + 1] += m.nor[j * 3 + 1]; hint[i * 3 + 2] += m.nor[j * 3 + 2];
      }
      zr[i * 2] = Math.min(pos[i * 9 + 2], pos[i * 9 + 5], pos[i * 9 + 8]); zr[i * 2 + 1] = Math.max(pos[i * 9 + 2], pos[i * 9 + 5], pos[i * 9 + 8]);
      cells(i, (c) => cnt[c + 1]++);
    }
    for (let c = 0; c < CS * CS; c++) cnt[c + 1] += cnt[c];
    const at = cnt.slice(0, CS * CS), list = new Int32Array(cnt[CS * CS]);
    for (let i = 0; i < n; i++) cells(i, (c) => { list[at[c]++] = i; });
    return { n, pos, hint, zr, start: cnt, list, seen: new Uint32Array(n) };
  }

  function build(cx, cy, cz, S) {
    const t0 = performance.now();
    let e;
    if (S && S.b) e = fromBlocks(S.b, S.k0, S.nk, cx, cy);
    else if (S && S.empty) e = { n: 0 };
    else {
      // віртуальна секція з P.block: −1 (не згенеровано) — камінь, як стіна. Для кожної сусідньої секції (рамка), де трапилось
      // −1, — одна така точка: запис дійсний, поки всі вони ще не згенеровані
      let solid = 0;
      const X = cx * CS, Y = cy * CS, K = cz * SEC, unk = [];
      for (let k = -FR; k < SEC + FR; k++) for (let y = -FR; y < CS + FR; y++) for (let x = -FR; x < CS + FR; x++) {
        let b = P.block(X + x, Y + y, K + k);
        if (b === -1) {
          b = B_STONE;
          const r = ((k < 0 ? 0 : k < SEC ? 1 : 2) * 3 + (y < 0 ? 0 : y < CS ? 1 : 2)) * 3 + (x < 0 ? 0 : x < CS ? 1 : 2);
          if (!unk.some((u) => u[0] === r)) unk.push([r, X + x, Y + y, K + k]);
        }
        vb[bv(x, y, k, SEC)] = b;
        if (solidB(b)) solid++;
      }
      e = solid === 0 || solid === NB ? { n: 0 } : fromBlocks(vb.slice(), K, SEC, cx, cy);
      if (unk.length) { e.temp = unk; e.ver = P.ver ? P.ver() : 0; }
    }
    e.src = S || null;
    const ms = performance.now() - t0;
    stats.builds++; stats.buildMs += ms; if (ms > stats.maxMs) stats.maxMs = ms; if (ms > 3) stats.slow++;
    if (!(S && (S.b || S.empty))) stats.virt++; if (e.temp) stats.temp++;
    return e;
  }

  function section(cx, cy, cz) {
    const key = `${cx},${cy},${cz}`, S = P.sec ? P.sec(cx, cy, cz) : undefined;
    let e = secs.get(key);
    if (e && e.temp && e.src === (S || null)) {                  // дані світу змінились — чи догенеровано щось із рамки
      const v = P.ver ? P.ver() : 0;
      if (e.ver !== v) { if (e.temp.some((u) => P.block(u[1], u[2], u[3]) !== -1)) e.src = undefined; else e.ver = v; }
    }
    if (e && e.src !== (S || null)) { stats.tris -= e.n; secs.delete(key); e = null; }
    if (e) { secs.delete(key); secs.set(key, e); return e; }
    e = build(cx, cy, cz, S);
    secs.set(key, e); stats.tris += e.n;
    if (secs.size > MAX_SECS) { const k = secs.keys().next().value; stats.tris -= secs.get(k).n; secs.delete(k); }
    stats.secs = secs.size;
    return e;
  }

  return {
    // Трикутники в коробці (світові координати) — у список рушія L
    gather(x0, y0, z0, x1, y1, z1, L) {
      // вершини Surface Nets виходять за межі своєї секції до пів клітинки (пів блоку) — секції з запасом у клітинку
      const ca = Math.floor((x0 - 1) / CS), cb = Math.floor((x1 + 1) / CS), da = Math.floor((y0 - 1) / CS), db = Math.floor((y1 + 1) / CS);
      const za = Math.floor(Math.floor(z0 / LEVEL - 1) / SEC), zb = Math.floor(Math.floor(z1 / LEVEL + 1) / SEC);
      for (let cz = za; cz <= zb; cz++) for (let cy = da; cy <= db; cy++) for (let cx = ca; cx <= cb; cx++) {
        const e = section(cx, cy, cz);
        if (!e.n) continue;
        const ox = cx * CS, oy = cy * CS, oz = cz * SEC * LEVEL, s = ++stampN;
        const cl = (v) => v < 0 ? 0 : v > CS - 1 ? CS - 1 : v;   // кошик крайньої клітинки тримає й те, що за межею
        const xa = cl(Math.floor(x0 - ox)), xb = cl(Math.floor(x1 - ox)), ya = cl(Math.floor(y0 - oy)), yb = cl(Math.floor(y1 - oy));
        if (x1 < ox - 1 || x0 > ox + CS + 1 || y1 < oy - 1 || y0 > oy + CS + 1) continue;
        const lz0 = z0 - oz, lz1 = z1 - oz, p = e.pos, h = e.hint;
        for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
          const c = y * CS + x;
          for (let j = e.start[c]; j < e.start[c + 1]; j++) {
            const i = e.list[j];
            if (e.seen[i] === s) continue;
            e.seen[i] = s;
            if (e.zr[i * 2] > lz1 || e.zr[i * 2 + 1] < lz0) continue;
            const o = i * 9;
            pushTri(L, p[o] + ox, p[o + 1] + oy, p[o + 2] + oz, p[o + 3] + ox, p[o + 4] + oy, p[o + 5] + oz, p[o + 6] + ox, p[o + 7] + oy, p[o + 8] + oz, null, h[i * 3], h[i * 3 + 1], h[i * 3 + 2]);
          }
        }
      }
      // предмети: стовбур, брила — призма
      const R = P.objR ?? 0.5;
      for (let ty = Math.floor(y0 - R); ty <= Math.floor(y1 + R); ty++) for (let tx = Math.floor(x0 - R); tx <= Math.floor(x1 + R); tx++) {
        const o = P.obj(tx, ty);
        if (!o || typeof o !== 'object' || !(o.r > 0)) continue;
        if (o.cx + o.r < x0 || o.cx - o.r > x1 || o.cy + o.r < y0 || o.cy - o.r > y1 || o.z1 < z0 || o.z0 > z1) continue;
        prismTris(L, o.cx, o.cy, o.z0, o.z1, o.r, 12, o);
      }
      // тіла — коробки
      if (P.bodies) {
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, rr = Math.hypot(x1 - x0, y1 - y0) / 2 + 2;
        for (const b of P.bodies(mx, my, rr)) {
          if (b.held) continue;                                 // у руках — не перешкода (тримає сам гравець)
          if (b.x + b.hx < x0 || b.x - b.hx > x1 || b.y + b.hy < y0 || b.y - b.hy > y1 || b.z + b.hz < z0 || b.z - b.hz > z1) continue;
          boxTris(L, b.x - b.hx, b.y - b.hy, b.z - b.hz, b.x + b.hx, b.y + b.hy, b.z + b.hz, b);
        }
      }
      return L;
    },
    // Блок у точці — тверде чи не згенеровано
    solidAt(x, y, z) { const b = P.block(Math.floor(x), Math.floor(y), Math.floor(z / LEVEL)); return b === -1 || solidB(b); },
  };
}

// Точка під поверхнею рідини (око під водою)
export function underLiquid(P, x, y, z) {
  const tx = Math.floor(x), ty = Math.floor(y);
  let k = Math.floor(z / LEVEL);
  if (P.block(tx, ty, k) !== B_LIQ) return false;
  while (P.block(tx, ty, k + 1) === B_LIQ) k++;
  return z < (k + 1) * LEVEL - 0.15;
}
// Видимість під рідиною (кінець лінійного туману, одиниць) — від прозорості поверхні liquid.alpha: вода 15,6, кислота 8,8,
// метан 32,7, лава 0,8
export const liquidVis = (alpha) => Math.max(0.8, 40 * (1 - alpha) / Math.max(1e-3, alpha));

// Посилання трикутника — тіло (bodies.js: коробка з hz), а не предмет (призма стовбура чи каменю) і не земля (null)
export const isBody = (r) => !!r && r.hz !== undefined;
// Перша перешкода на відрізку o → o + d·maxT (d — одиничний): видима поверхня, стовбури, каміння, тіла —
// {t, nx, ny, nz, ref} (rayCast рушія) чи null
const RAY = createList(4096);
export function castRay(P, o, d, maxT) {
  const e = [o[0] + d[0] * maxT, o[1] + d[1] * maxT, o[2] + d[2] * maxT];
  clearList(RAY);
  colliderOf(P).gather(Math.min(o[0], e[0]) - 0.1, Math.min(o[1], e[1]) - 0.1, Math.min(o[2], e[2]) - 0.1, Math.max(o[0], e[0]) + 0.1, Math.max(o[1], e[1]) + 0.1, Math.max(o[2], e[2]) + 0.1, RAY);
  return rayCast(RAY, o[0], o[1], o[2], d[0], d[1], d[2], maxT, {});
}
