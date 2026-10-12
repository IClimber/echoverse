// gen/job.js — одна робота генератора (у worker чи в головному потоці): зведення стовпця чи секція з мешем.
// Стовпець (клітинки, «небо», ґратка шуму, предмети з положеннями) рахується раз і живе в кеші: секції стовпця беруть
// його звідти. Зведення стовпця — поверхня, укриття від опадів, межі секцій із поверхнею, предмети.
import { genCol, genSection, genCoarse, shelterTop, CS, ci, SEC, T_WATER, T_ICE, T_BED, O_FLOAT } from './chunk.js';
import { chunkMesh, floraMesh, farFlora, objPose, objMesh } from './mesh.js';
import { packMesh, concat, frameOf, RS } from './pack.js';
import { farMesh, FT } from './far.js';
import { standCol, standSection, standFar } from './stand.js';
import { L_DRY, SEA } from '../universe.js';
import { LEVEL } from '../iso.js';

const ISL_CZ = [2, 3, 4, 5];                  // секції смуги ширяючих островів (блоки 44…84)

function colFor(L, q, cache) {
  const ck = `${q.stand ? 's' : ''}${q.d}:${q.n}:${q.cx}:${q.cy}`;
  let col = cache.get(ck);
  if (!col) {
    col = q.stand ? standCol(L, q.cx, q.cy) : genCol(L, q.cx, q.cy);
    for (const o of col.obj) objPose(col, L, o);
    cache.set(ck, col);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  return col;
}

// Зведення стовпця: поверхня (h, t, v, bm), верх укриття від опадів кожної клітинки (top, блоки), діапазон секцій з
// поверхнею й предметами (czLo…czHi) і секції островів (isl), предмети з положеннями й види
export function colSummary(col, L) {
  const top = shelterTop(col, L).slice();
  let lo = Infinity, hi = -Infinity;
  for (let y = -1; y <= CS; y++) for (let x = -1; x <= CS; x++) {   // свої клітинки й рамка в 1 клітинку (діапазон секцій — як до рамки 2)
    const i = ci(x, y), c = col.cells[i], basin = c.t === T_WATER || c.t === T_ICE || c.t === T_BED, sky = col.sky[i];
    lo = Math.min(lo, (basin ? c.bed : Math.min(sky, c.h)) - 10);
    // скелі — над поверхнею; водойма — до рівня рідини (глибоке море: інакше секцію з поверхнею не підвантажували)
    hi = Math.max(hi, (basin && c.t !== T_BED ? Math.max(c.h, SEA) : c.h + (c.fb || 0)) + 8);
  }
  for (const o of col.obj) hi = Math.max(hi, o.z + 1);
  return {
    d: col.d, n: col.n, cx: col.cx, cy: col.cy, h: col.h.slice(), t: col.t.slice(), v: col.v.slice(), bm: col.bm.slice(), top, sky: col.sky.slice(),
    czLo: Math.floor(lo / SEC), czHi: Math.floor(hi / SEC), isl: L.islands > 0.02 ? ISL_CZ : [], obj: col.obj, sp: col.sp,
  };
}

// Робота q = {type: 'col' | 'sec' | 'lod' (груба секція рівня lod) | 'flora' | 'far' (плитка далечі tx, ty з кроком s) |
// 'obj' (предмет i стовпця повністю — обрис цілі), d, n, cx, cy, cz, stand — стенд руху (gen/stand.js)}:
// {data, mesh?, bufs — що можна передати без копіювання}. Меші секцій і рослин — щільні вершини в кадрі регіону (pack.js):
// секція — op (тверде, за ним ns вершин — nf далеких рослин) і liq (поверхня рідини); рослини зблизька — весь стовпець
// окремо (потрібні лише біля камери), кадр — регіон rz найнижчого предмета. Груба секція (lod) — op: тверде (ns), далекі
// рослини (nf), обрізи (nc, шов між рівнями); блоків не віддає
export function runJob(L, q, cache) {
  if (q.type === 'far') {                      // плитка далечі: висотне поле поверхні з кроком q.s
    const f = q.stand ? standFar(L, q.tx, q.ty, FT) : farMesh(L, q.tx, q.ty, q.s), m = f.mesh;
    return { data: { zmin: f.zmin, zmax: f.zmax }, mesh: { solid: m }, bufs: [m.pos.buffer, m.nor.buffer, m.col.buffer, m.mat.buffer, m.idx.buffer] };
  }
  const col = colFor(L, q, cache);
  if (q.type === 'col') return { data: colSummary(col, L), bufs: [] };
  if (q.type === 'obj') {                      // один предмет повністю (обрис цілі): q.i — номер у col.obj
    const o = col.obj[q.i];
    if (!o) return { data: null, mesh: null, bufs: [] };
    const m = objMesh(col, L, o);
    return { data: null, mesh: m, bufs: [m.pos.buffer, m.nor.buffer, m.col.buffer, m.mat.buffer, m.idx.buffer] };
  }
  if (q.type === 'flora') {
    let zmin = Infinity;
    for (const o of col.obj) if (o.k !== O_FLOAT && o.z < zmin) zmin = o.z;
    if (zmin === Infinity) return { data: { rz: 0 }, mesh: { fl: null, n: 0, bb: null }, bufs: [] };
    const rz = Math.floor(Math.floor(zmin / SEC) / RS), [dx, dy] = frameOf(q.cx, q.cy, 0);
    shelterTop(col, L);
    const F = floraMesh(col, L, rz * RS * SEC), f = packMesh(F.finish(), dx, dy, 0);
    // nb — вершин великих рослин на початку (за ними покрив; вершина щільного меша — індекс); ob — по великому предмету:
    // перша вершина, вершин, коробка в кадрі регіону (як bb)
    const ob = new Float32Array(F.objs);
    for (let i = 0; i < ob.length; i += 8) { ob[i + 2] += dx; ob[i + 3] += dy; ob[i + 5] += dx; ob[i + 6] += dy; }
    return { data: { rz }, mesh: { fl: f.n ? f.buf : null, n: f.n, nb: F.nb, ob, bb: f.bb }, bufs: f.n ? [f.buf, ob.buffer] : [] };
  }
  if (q.type === 'lod') {                      // груба секція (рівень q.lod: крок 2 чи 4 блоки) — лише меш, без блоків
    const s = q.lod === 2 ? 4 : 2, G = genCoarse(L, col, q.cz, s), [dx, dy, dz] = frameOf(q.cx, q.cy, q.cz);
    const m = G.empty ? null : chunkMesh({ cx: q.cx, cy: q.cy, step: s, b: G.b, h: G.h, bm: G.bm, v: G.v, lt: G.lt, k0: G.k0, nk: G.n, obj: [], sp: [] }, L, { near: false, far: false });
    shelterTop(col, L);
    const fm = farFlora(col, L, q.cz * SEC, -(s - 1) / 2 * LEVEL);
    const S = packMesh(m && m.solid, dx, dy, dz), F = packMesh(fm.n ? fm.finish() : null, dx, dy, dz), Cp = packMesh(m && m.caps, dx, dy, dz);
    const op = concat(concat(S, F), Cp), lq = m && m.liquid ? packMesh(m.liquid, dx, dy, dz) : null;
    return {
      data: null,
      mesh: { op: op.buf, ns: S.n, nf: F.n, nc: Cp.n, bb: op.n ? op.bb : null, liq: lq ? lq.buf : null, nl: lq ? lq.n : 0, lbb: lq ? lq.bb : null },
      bufs: lq ? [op.buf, lq.buf] : [op.buf],
    };
  }
  const sec = q.stand ? standSection(col, q.cz) : genSection(L, col, q.cz);
  if (sec.empty) return { data: sec, bufs: [] };
  const m = chunkMesh({ cx: q.cx, cy: q.cy, h: col.h, bm: col.bm, v: col.v, top: shelterTop(col, L), sky: col.sky, b: sec.b, k0: sec.k0, nk: sec.nk, obj: col.obj, sp: col.sp }, L, { near: false });
  const [dx, dy, dz] = frameOf(q.cx, q.cy, q.cz), s = packMesh(m.solid, dx, dy, dz), f = packMesh(m.far, dx, dy, dz);
  const op = f.n ? concat(s, f) : s, lq = m.liquid ? packMesh(m.liquid, dx, dy, dz) : null;
  const bufs = [sec.b.buffer, op.buf];
  if (lq) bufs.push(lq.buf);
  return {
    data: { b: sec.b, k0: sec.k0, nk: sec.nk },
    mesh: { op: op.buf, ns: s.n, nf: f.n, nc: 0, bb: op.n ? op.bb : null, liq: lq ? lq.buf : null, nl: lq ? lq.n : 0, lbb: lq ? lq.bb : null },
    bufs,
  };
}
