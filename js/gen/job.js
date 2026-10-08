// gen/job.js — одна робота генератора (у worker чи в головному потоці): зведення стовпця чи секція з мешем.
// Стовпець (клітинки, «небо», ґратка шуму, предмети з положеннями) рахується раз і живе в кеші: секції стовпця беруть
// його звідти. Зведення стовпця — поверхня, укриття від опадів, межі секцій із поверхнею, предмети.
import { genCol, genSection, CW, SEC, T_WATER, T_ICE, T_BED, O_FLOAT } from './chunk.js';
import { chunkMesh, floraMesh, objPose } from './mesh.js';
import { packMesh, concat, frameOf, RS } from './pack.js';
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
    // скелі — над поверхнею; водойма — до рівня рідини (глибоке море: інакше секцію з поверхнею не підвантажували)
    hi = Math.max(hi, (basin && c.t !== T_BED ? Math.max(c.h, SEA) : c.h + (c.fb || 0)) + 8);
  }
  for (const o of col.obj) hi = Math.max(hi, o.z + 1);
  return {
    d: col.d, n: col.n, cx: col.cx, cy: col.cy, h: col.h.slice(), t: col.t.slice(), v: col.v.slice(), bm: col.bm.slice(), top,
    czLo: Math.floor(lo / SEC), czHi: Math.floor(hi / SEC), isl: L.islands > 0.02 ? ISL_CZ : [], obj: col.obj, sp: col.sp,
  };
}

// Робота q = {type: 'col' | 'sec' | 'flora' | 'far' (плитка далечі tx, ty з кроком s), d, n, cx, cy, cz}:
// {data, mesh?, bufs — що можна передати без копіювання}. Меші секцій і рослин — щільні вершини в кадрі регіону (pack.js):
// секція — op (тверде, за ним ns вершин — nf далеких рослин) і liq (поверхня рідини); рослини зблизька — весь стовпець
// окремо (потрібні лише біля камери), кадр — регіон rz найнижчого предмета
export function runJob(L, q, cache) {
  if (q.type === 'far') {                      // плитка далечі: висотне поле поверхні з кроком q.s
    const f = farMesh(L, q.tx, q.ty, q.s), m = f.mesh;
    return { data: { zmin: f.zmin, zmax: f.zmax }, mesh: { solid: m }, bufs: [m.pos.buffer, m.nor.buffer, m.col.buffer, m.mat.buffer, m.idx.buffer] };
  }
  const col = colFor(L, q, cache);
  if (q.type === 'col') return { data: colSummary(col, L), bufs: [] };
  if (q.type === 'flora') {
    let zmin = Infinity;
    for (const o of col.obj) if (o.k !== O_FLOAT && o.z < zmin) zmin = o.z;
    if (zmin === Infinity) return { data: { rz: 0 }, mesh: { fl: null, n: 0, bb: null }, bufs: [] };
    const rz = Math.floor(Math.floor(zmin / SEC) / RS), [dx, dy] = frameOf(q.cx, q.cy, 0);
    const f = packMesh(floraMesh(col, L, rz * RS * SEC).finish(), dx, dy, 0);
    return { data: { rz }, mesh: { fl: f.n ? f.buf : null, n: f.n, bb: f.bb }, bufs: f.n ? [f.buf] : [] };
  }
  const sec = genSection(L, col, q.cz);
  if (sec.empty) return { data: sec, bufs: [] };
  const m = chunkMesh({ cx: q.cx, cy: q.cy, h: col.h, bm: col.bm, v: col.v, b: sec.b, k0: sec.k0, nk: sec.nk, obj: col.obj, sp: col.sp }, L, { near: false });
  const [dx, dy, dz] = frameOf(q.cx, q.cy, q.cz), s = packMesh(m.solid, dx, dy, dz), f = packMesh(m.far, dx, dy, dz);
  const op = f.n ? concat(s, f) : s, lq = m.liquid ? packMesh(m.liquid, dx, dy, dz) : null;
  const bufs = [sec.b.buffer, op.buf];
  if (lq) bufs.push(lq.buf);
  return {
    data: { b: sec.b, k0: sec.k0, nk: sec.nk },
    mesh: { op: op.buf, ns: s.n, nf: f.n, bb: op.n ? op.bb : null, liq: lq ? lq.buf : null, nl: lq ? lq.n : 0, lbb: lq ? lq.bb : null },
    bufs,
  };
}
