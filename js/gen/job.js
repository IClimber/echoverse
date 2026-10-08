// gen/job.js — одна робота генератора (у worker чи в головному потоці): зведення стовпця чи секція з мешем.
// Стовпець (клітинки, «небо», ґратка шуму, предмети з положеннями) рахується раз і живе в кеші: секції стовпця беруть
// його звідти. Зведення стовпця — поверхня, укриття від опадів, межі секцій із поверхнею, предмети.
import { genCol, genSection, CW, SEC, T_WATER, T_ICE, T_BED } from './chunk.js';
import { chunkMesh, objPose } from './mesh.js';
import { farMesh } from './far.js';
import { L_DRY, SEA } from '../universe.js';

const ISL_CZ = [2, 3, 4, 5];                  // секції смуги ширяючих островів (блоки 44…84)

function colFor(L, q, cache) {
  const ck = `${q.d}:${q.n}:${q.cx}:${q.cy}`;
  let col = cache.get(ck);
  if (!col) {
    col = genCol(L, q.cx, q.cy);
    for (const o of col.obj) objPose(col, L, o);
    cache.set(ck, col);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  return col;
}

// Зведення стовпця: поверхня (h, t, v, bm), верх укриття від опадів кожної клітинки (top, блоки), діапазон секцій з
// поверхнею й предметами (czLo…czHi) і секції островів (isl), предмети з положеннями й види
export function colSummary(col, L) {
  const top = new Int16Array(CW * CW), pit = L.liquid.kind !== L_DRY;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < CW * CW; i++) {
    const c = col.cells[i], basin = c.t === T_WATER || c.t === T_ICE || c.t === T_BED, sky = col.sky[i];
    top[i] = basin ? Math.max(c.bed, c.t === T_BED ? 0 : SEA) : sky < SEA - 1 && pit ? SEA : sky + 1;
    lo = Math.min(lo, (basin ? c.bed : Math.min(sky, c.h)) - 10);
    hi = Math.max(hi, c.h + 8);
  }
  for (const o of col.obj) hi = Math.max(hi, o.z + 1);
  return {
    d: col.d, n: col.n, cx: col.cx, cy: col.cy, h: col.h.slice(), t: col.t.slice(), v: col.v.slice(), bm: col.bm.slice(), top,
    czLo: Math.floor(lo / SEC), czHi: Math.floor(hi / SEC), isl: L.islands > 0.02 ? ISL_CZ : [], obj: col.obj, sp: col.sp,
  };
}

// Робота q = {type: 'col' | 'sec' | 'far' (плитка далечі tx, ty з кроком s), d, n, cx, cy, cz}: {data, mesh?, bufs — що можна передати без копіювання}
export function runJob(L, q, cache) {
  if (q.type === 'far') {                      // плитка далечі: висотне поле поверхні з кроком q.s
    const f = farMesh(L, q.tx, q.ty, q.s), m = f.mesh;
    return { data: { zmin: f.zmin, zmax: f.zmax }, mesh: { solid: m }, bufs: [m.pos.buffer, m.nor.buffer, m.col.buffer, m.mat.buffer, m.idx.buffer] };
  }
  const col = colFor(L, q, cache);
  if (q.type === 'col') return { data: colSummary(col, L), bufs: [] };
  const sec = genSection(L, col, q.cz);
  if (sec.empty) return { data: sec, bufs: [] };
  const m = chunkMesh({ cx: q.cx, cy: q.cy, h: col.h, bm: col.bm, v: col.v, b: sec.b, k0: sec.k0, nk: sec.nk, obj: col.obj, sp: col.sp }, L);
  const bufs = [sec.b.buffer];
  for (const x of [m.solid, m.liquid, m.flora, m.far]) if (x) bufs.push(x.pos.buffer, x.nor.buffer, x.col.buffer, x.mat.buffer, x.idx.buffer);
  return { data: { b: sec.b, k0: sec.k0, nk: sec.nk }, mesh: m, bufs };
}
