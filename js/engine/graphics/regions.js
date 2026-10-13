// js/engine/graphics/regions.js — регіони: вузол сцени з аренами вершин (arena.js) і сітками (MeshInstance) з командами
// multi-draw (graphics/advanced-rendering/multi-draw.md). Сітки камери малюють видимі діапазони (команди камери); кидачі
// тіней — окремі сітки в шарі «Тіні» (його бачать світла, не камера), по блоку стовпців зі своєю AABB (setCustomAabb),
// тож кожен каскад PlayCanvas відсікає кидачів сам (ShadowRendererDirectional.cull), а команди — спільні (setMultiDraw(null)).
// Облік (що в якому діапазоні, які діапазони видимі) — справа гри; тут — лише об'єкти PlayCanvas.
// Координати регіону — наші (z угору), кут регіону (rx·RW, ry·RW, rz·RH); вершини — u16 нормовано: (локальна + PO) / S16
import { createArena } from './arena.js';
import { far2, near2, casterVolume, boxOut } from '../core/frustum.js';

// layout: { size: [RW, RW, RH], PO, PQ, format (pc.VertexFormat), kinds: {вид: {arena, material}},
//   casters: [{arena, material, cascades — біти каскадів напрямленого світла, у які кидач цього виду малюється (типово
//   усі), layer — 'far': шар «Тіні дальні» (лише напрямлені світла), інакше «Тіні»} | null] (вид кидача — індекс),
//   arena0, arenaMax, stats }
export function createRegions(G, layout) {
  const { pc, root, layers, O } = G, camC = G.cam;
  const { size: [RW, , RH], PO, format, kinds, casters } = layout;
  const S16 = 65535 / layout.PQ, A0 = layout.arena0 || 32768, AMAX = layout.arenaMax || 4194304;
  const stats = layout.stats || { arenaBytes: 0, upBytes: 0 };
  const all = new Set();
  // Команди multi-draw; обхід помилки 2.23.2: у неіндексованого меша перша вершина множиться на розмір індексу (0)
  const md = (m, cam, n) => { const c = m.setMultiDraw(cam, n); if (c.impl && 'indexSizeBytes' in c.impl) c.impl.indexSizeBytes = 1; return c; };
  const place = (R) => R.node.setLocalPosition(R.rx * RW - PO[0] - O[0], R.ry * RW - PO[1] - O[1], R.rz * RH - PO[2]);
  G.on('origin', () => { for (const R of all) place(R); });
  const lo3 = new pc.Vec3(), hi3 = new pc.Vec3();
  const box = (b, bb = new pc.BoundingBox()) => {
    bb.setMinMax(lo3.set((b[0] + PO[0]) / S16, (b[1] + PO[1]) / S16, (b[2] + PO[2]) / S16), hi3.set((b[3] + PO[0]) / S16, (b[4] + PO[1]) / S16, (b[5] + PO[2]) / S16));
    return bb;
  };
  const bbTmp = new pc.BoundingBox();                // setCustomAabb копіює

  function create(rx, ry, rz) {
    const R = { rx, ry, rz, node: new pc.GraphNode(), ar: {}, mi: {}, sh: new Map(), bb: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
    R.node.setLocalScale(S16, S16, S16); root.addChild(R.node); place(R);
    all.add(R);
    return R;
  }
  // вершини (ArrayBuffer чи Uint8Array) у арену name: зсув або −1 (арена найбільша й повна)
  function put(R, name, buf, n) {
    let A = R.ar[name];
    if (!A) { let c = A0; while (c < n) c *= 2; A = R.ar[name] = createArena(G, format, c, stats); if (R.bb[0] <= R.bb[3]) A.mesh.aabb = box(R.bb); }
    let off = A.a.alloc(n);
    while (off < 0 && A.a.cap < AMAX) { A.grow(Math.min(AMAX, A.a.cap * 2)); off = A.a.alloc(n); }
    if (off < 0) { stats.full = (stats.full || 0) + 1; return -1; }
    A.put(off, buf instanceof Uint8Array ? buf.subarray(0, n * format.size) : new Uint8Array(buf, 0, n * format.size));
    return off;
  }
  const free = (R, name, off, n) => { if (off >= 0 && R.ar[name]) R.ar[name].a.free(off, n); };
  // межі регіону (клітинки від кута) — AABB мешів арен (відсікання камери PlayCanvas)
  function setBounds(R, b) {
    for (let i = 0; i < 6; i++) R.bb[i] = b[i];
    if (!(b[0] <= b[3])) return;
    for (const k in R.ar) R.ar[k].mesh.aabb = box(b);
  }
  // діапазони F/C [a, b) у команди w ('cam' — камери, 'sh' — спільні); → вершин
  function fill(m, w, F, C, a, b) {
    const n = b - a;
    if (n > m[w + 'Cap']) { let c = m[w + 'Cap']; while (c < n) c *= 2; m[w + 'Cap'] = c; m[w] = md(m, w === 'cam' ? camC : null, c); }
    let v = 0;
    if (w === 'cam') stats.sub = (stats.sub || 0) + n;   // піддрави multi-draw камери (заміри)
    for (let i = 0; i < n; i++) { m[w].add(i, C[a + i], 1, F[a + i]); v += C[a + i]; }
    m[w].update(n);
    return v;
  }
  // Сітка камери виду kind: діапазони F/C [a, b); → вершин (0 — сітка схована)
  function setCamera(R, kind, F, C, a, b) {
    let m = R.mi[kind];
    if (!m) {
      const K = kinds[kind];
      if (b <= a || !R.ar[K.arena]) return 0;
      m = R.mi[kind] = new pc.MeshInstance(R.ar[K.arena].mesh, K.material, R.node);
      m.castShadow = false; m.visible = false;
      m.cull = false;                                 // видимі діапазони відсікає гра (з кривизною, якої AABB меша не знає)
      m.cam = md(m, camC, 64); m.camCap = 64;
      layers.world.addMeshInstances([m]);
    }
    const v = b > a ? fill(m, 'cam', F, C, a, b) : 0;
    m.visible = v > 0;
    return v;
  }
  const hide = (R) => { for (const k in R.mi) R.mi[k].visible = false; for (const m of R.sh.values()) m.visible = false; };

  // Кидачі регіону: blocks[0…n) = {key, kind, F, C, nr (діапазонів), bb (6, клітинки від кута)}; решта кидачів — сховані.
  // Подія 'casters' (межі регіону, наші координати) — для нерухомих точкових джерел (оновити тінь)
  function setCasters(R, blocks, n) {
    for (const m of R.sh.values()) { m.shV = 0; m.visible = false; }
    for (let i = 0; i < n; i++) {
      const B = blocks[i], K = casters[B.kind];
      if (!K || !R.ar[K.arena] || !B.nr) continue;
      let m = R.sh.get(B.key);
      if (!m || m.mesh !== R.ar[K.arena].mesh) {
        if (m) { m.lay.removeMeshInstances([m]); m.destroy(); }
        m = new pc.MeshInstance(R.ar[K.arena].mesh, K.material, R.node);
        m.castShadow = true; m.sh = md(m, null, 16); m.shCap = 16; m.kind = B.kind; m.b = new Float64Array(6);
        m.lay = K.layer === 'far' && layers.shadowFar ? layers.shadowFar : layers.shadow;   // 'far' — лише напрямлені (app.js)
        m.lay.addMeshInstances([m]);
        R.sh.set(B.key, m);
      }
      m.setCustomAabb(box(B.bb)); m.lo = m.hi = 0;
      m.b.set(B.bb);
      m.shV = fill(m, 'sh', B.F, B.C, 0, B.nr); m.shN = B.nr;
      m.visible = false;                              // вмикає cullCasters щокадру
    }
    const b = R.bb;
    if (b[0] <= b[3]) G.fire('casters', [R.rx * RW + b[0], R.ry * RW + b[1], R.rz * RH + b[2], R.rx * RW + b[3], R.ry * RW + b[4], R.rz * RH + b[5]]);
  }

  // Кидачі на кадр (решту PlayCanvas не бачить) і їх каскади. Кидач потрібен каскаду c напрямленого світла, якщо його тінь
  // може впасти в зріз c піраміди камери (глибина від ока [s0, s1], lights.js prepare): коробка перетинає зріз,
  // «витягнутий до світла» (core/frustum.js casterVolume: грані зрізу від світла й площини через ребра силуету, як у
  // Unreal), зсунутий назовні на запас mg[c] (фільтр тіні й допуск кадрів, коли каскад не оновлюється). 13.10.2026: без
  // площин силуету об'єм у бік граней до світла не обмежений — сонце на 33° за спиною майже паралельне нижній грані
  // піраміди (35° униз), і чверть градуса руху сонця перемикала 57 ↔ 118 кидачів (6,8 ↔ 11,1 млн трикутників тіней):
  // ішло все під і за камерою до межі відстані. Плюс межа відстані від ока (як Shadow Distance у шейдерпаках Minecraft).
  // Каскади кидача — маска PlayCanvas shadowCascadeMask (ShadowRendererDirectional.cull пропускає кидача в каскаді без
  // біта) ∩ каскади його виду (casters[вид].cascades). Без цього каскад PlayCanvas бере все в нескінченному вздовж світла
  // стовпці завширшки з кулю свого зрізу (12.10.2026: у каскад 0–16 м ішов і ліс за 100 м). Світло без зрізів (nc 0) —
  // один зріз від ближньої площини камери до shD, усі каскади. Ще кидач потрібен, якщо коробка перетинає сферу (позиція,
  // range) точкового джерела чи прожектора з тінями.
  // v: { m — матриця камери відносно цілі t, eye — око відносно t, ud — до ока (одиничний), t, c — кривизна (вершинний
  // шейдер опускає точку на c·d², d — від цілі по горизонталі: коробки кидачів опускаємо так само, і AABB кидача, за якою
  // каскад PlayCanvas відсікає його сам) }; dirs: [{dir — до світила, shD, nc, sl — [s0, s1] на каскад, mg — запас на
  // каскад}]; locals: [{pos, range}] (наші координати)
  const MPL = 12;                                  // площин на зріз (casterVolume — до 11)
  const shOn = [], PL = new Float64Array(3 * 4 * MPL * 4), NP = new Int32Array(3 * 4), NCK = new Int32Array(3), ALL = new Uint8Array(3), CAP = new Float64Array(3), LD = new Float64Array(3), bbT = new Float64Array(6);
  let tight = true;
  function cullCasters(regs, v, dirs, locals = []) {
    for (const s of shOn) s.visible = false;
    shOn.length = 0;
    const nd = Math.min(3, dirs.length), { m, eye, ud, t } = v, cv = v.c || 0;
    if (!nd && !locals.length) return 0;
    for (let k = 0; k < nd; k++) {
      const D = dirs[k], L0 = -D.dir[0], L1 = -D.dir[1], L2 = -D.dir[2], sliced = D.nc > 0, nc = sliced ? Math.min(4, D.nc) : 1;
      NCK[k] = nc; ALL[k] = sliced ? 0 : 1;
      LD[0] = L0; LD[1] = L1; LD[2] = L2;
      // ?dev tight = false — як до 13.10.2026 (порівняння): без площин силуету
      for (let c = 0; c < nc; c++) NP[k * 4 + c] = casterVolume(m, eye, ud, sliced ? D.sl[c * 2] : null, sliced ? D.sl[c * 2 + 1] : D.shD, LD, sliced ? D.mg[c] : 0, tight, PL, (k * 4 + c) * MPL * 4);
      CAP[k] = D.shD * 1.46 + 16;                    // найдальша точка зрізу (кут екрана 16:9, FOV 55°) + запас
    }
    // біти каскадів, у які тінь коробки (відносно t) може впасти (маска PlayCanvas — спільна для світел)
    const casc = (x0, y0, z0, x1, y1, z1) => {
      let mk = 0;
      for (let k = 0; k < nd; k++) {
        if (Math.hypot(Math.max(x0 - eye[0], 0, eye[0] - x1), Math.max(y0 - eye[1], 0, eye[1] - y1)) > CAP[k]) continue;
        for (let c = 0; c < NCK[k]; c++) if (!boxOut(PL, (k * 4 + c) * MPL * 4, NP[k * 4 + c], x0, y0, z0, x1, y1, z1)) mk |= ALL[k] ? 255 : 1 << c;
      }
      return tight || !mk ? mk : 255;
    };
    const lit = (x0, y0, z0, x1, y1, z1) => {
      for (const l of locals) {
        const px = l.pos[0] - t[0], py = l.pos[1] - t[1], pz = l.pos[2] - t[2];
        if (Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1), Math.max(z0 - pz, 0, pz - z1)) <= l.range) return true;
      }
      return false;
    };
    for (const R of regs) {
      if (!R.sh.size) continue;
      const ox = R.rx * RW - t[0], oy = R.ry * RW - t[1], oz = R.rz * RH - t[2], g = R.bb;
      if (!(g[0] <= g[3])) continue;
      let lo = 0, hi = 0;
      if (cv > 0) { lo = cv * far2(ox + g[0], oy + g[1], ox + g[3], oy + g[4]); hi = cv * near2(ox + g[0], oy + g[1], ox + g[3], oy + g[4]); }
      const rx0 = ox + g[0], ry0 = oy + g[1], rz0 = oz + g[2] - lo, rx1 = ox + g[3], ry1 = oy + g[4], rz1 = oz + g[5] - hi;
      if (!casc(rx0, ry0, rz0, rx1, ry1, rz1) && !(locals.length && lit(rx0, ry0, rz0, rx1, ry1, rz1))) continue;
      for (const s of R.sh.values()) {
        const b = s.b;
        if (!s.shV) continue;
        if (cv > 0) { lo = cv * far2(ox + b[0], oy + b[1], ox + b[3], oy + b[4]); hi = cv * near2(ox + b[0], oy + b[1], ox + b[3], oy + b[4]); }
        const x0 = ox + b[0], y0 = oy + b[1], z0 = oz + b[2] - lo, x1 = ox + b[3], y1 = oy + b[4], z1 = oz + b[5] - hi;
        const K = casters[s.kind], mk = casc(x0, y0, z0, x1, y1, z1) & (K && K.cascades !== undefined ? K.cascades : 255);
        if (!mk && !(locals.length && lit(x0, y0, z0, x1, y1, z1))) continue;
        if (lo !== s.lo || hi !== s.hi) { s.lo = lo; s.hi = hi; bbT[0] = b[0]; bbT[1] = b[1]; bbT[2] = b[2] - lo; bbT[3] = b[3]; bbT[4] = b[4]; bbT[5] = b[5] - hi; s.setCustomAabb(box(bbT, bbTmp)); }
        s.shadowCascadeMask = mk;
        s.visible = true; shOn.push(s);
      }
    }
    return shOn.length;
  }

  function drop(R) {
    for (const k in R.mi) { const m = R.mi[k]; layers.world.removeMeshInstances([m]); m.destroy(); }
    for (const m of R.sh.values()) { m.lay.removeMeshInstances([m]); m.destroy(); }
    R.mi = {}; R.sh.clear();
    for (const k in R.ar) R.ar[k].drop();
    R.ar = {};
    root.removeChild(R.node);
    all.delete(R);
  }

  return {
    create, put, free, setBounds, setCamera, hide, setCasters, cullCasters, drop, stats, S16, get count() { return all.size; },
    // ?dev: false — як до 13.10.2026 (порівняння): без площин силуету, кидач — у всі каскади, якщо його тінь може впасти
    // хоч в один зріз
    get tight() { return tight; }, set tight(v) { tight = !!v; },
  };
}
