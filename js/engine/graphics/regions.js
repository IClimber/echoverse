// js/engine/graphics/regions.js — регіони: вузол сцени з аренами вершин (arena.js) і сітками (MeshInstance) з командами
// multi-draw (graphics/advanced-rendering/multi-draw.md). Сітки камери малюють видимі діапазони (команди камери); кидачі
// тіней — окремі сітки в шарі «Тіні» (його бачать світла, не камера), по блоку стовпців зі своєю AABB (setCustomAabb),
// тож кожен каскад PlayCanvas відсікає кидачів сам (ShadowRendererDirectional.cull), а команди — спільні (setMultiDraw(null)).
// Облік (що в якому діапазоні, які діапазони видимі) — справа гри; тут — лише об'єкти PlayCanvas.
// Координати регіону — наші (z угору), кут регіону (rx·RW, ry·RW, rz·RH); вершини — u16 нормовано: (локальна + PO) / S16
import { createArena } from './arena.js';

// layout: { size: [RW, RW, RH], PO, PQ, format (pc.VertexFormat), kinds: {вид: {arena, material}},
//   casters: [{arena, material} | null] (вид кидача — індекс), arena0, arenaMax, stats }
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
  const box = (b) => {
    const bb = new pc.BoundingBox();
    bb.setMinMax(new pc.Vec3((b[0] + PO[0]) / S16, (b[1] + PO[1]) / S16, (b[2] + PO[2]) / S16), new pc.Vec3((b[3] + PO[0]) / S16, (b[4] + PO[1]) / S16, (b[5] + PO[2]) / S16));
    return bb;
  };

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
    if (off < 0) return -1;
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
        if (m) { layers.shadow.removeMeshInstances([m]); m.destroy(); }
        m = new pc.MeshInstance(R.ar[K.arena].mesh, K.material, R.node);
        m.castShadow = true; m.sh = md(m, null, 16); m.shCap = 16; m.kind = B.kind; m.b = new Float64Array(6);
        layers.shadow.addMeshInstances([m]);
        R.sh.set(B.key, m);
      }
      m.setCustomAabb(box(B.bb));
      m.b.set(B.bb);
      m.shV = fill(m, 'sh', B.F, B.C, 0, B.nr);
      m.visible = false;                              // вмикає cullCasters щокадру
    }
    const b = R.bb;
    if (b[0] <= b[3]) G.fire('casters', [R.rx * RW + b[0], R.ry * RW + b[1], R.rz * RH + b[2], R.rx * RW + b[3], R.ry * RW + b[4], R.rz * RH + b[5]]);
  }

  // Кидачі на кадр (решту PlayCanvas не бачить). Кидач потрібен, якщо справджується хоч одне:
  // - для якогось напрямленого світла його тінь може впасти в зріз піраміди камери до глибини shD світла: коробка,
  //   витягнута вздовж світла, перетинає зріз. Перевірка — площинами зрізу, повернутими від світла (n·L ≤ 0: уздовж світла
  //   ними не вийти), — зріз, «розтягнутий до світла», як у Cyberpunk 2077 (SIGGRAPH 2021, «Shadows Optimizations in
  //   Cyberpunk 2077»); плюс межа відстані від ока (як Shadow Distance у шейдерпаках Minecraft): кидачі далі не малюються;
  // - коробка перетинає сферу (позиція, range) точкового джерела чи прожектора з тінями.
  // Без цього каскад PlayCanvas бере все в нескінченному стовпці вздовж світла.
  // v: { m — матриця камери відносно цілі t, eye — око відносно t, ud — напрям погляду, t }; dirs: [{dir — до світила, shD}];
  // locals: [{pos, range}] (наші координати)
  const shOn = [], PL = new Float64Array(3 * 6 * 4), NP = new Int32Array(3), CAP = new Float64Array(3);
  function cullCasters(regs, v, dirs, locals = []) {
    for (const s of shOn) s.visible = false;
    shOn.length = 0;
    const nd = Math.min(3, dirs.length), { m, eye, ud, t } = v;
    if (!nd && !locals.length) return 0;
    for (let k = 0; k < nd; k++) {
      const L0 = -dirs[k].dir[0], L1 = -dirs[k].dir[1], L2 = -dirs[k].dir[2], shD = dirs[k].shD;
      let np = 0;
      const plane = (a, b, c, d) => {
        if (a * L0 + b * L1 + c * L2 > 1e-6 * Math.hypot(a, b, c)) return;   // до світла — площина не обмежує
        const o = (k * 6 + np) * 4;
        PL[o] = a; PL[o + 1] = b; PL[o + 2] = c; PL[o + 3] = d; np++;
      };
      // площини піраміди камери з m (внутрішні; Gribb — Hartmann): ліва, права, низ, верх, ближня; дальня — на глибині shD
      plane(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]); plane(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
      plane(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]); plane(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
      plane(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
      plane(ud[0], ud[1], ud[2], shD - (ud[0] * eye[0] + ud[1] * eye[1] + ud[2] * eye[2]));
      NP[k] = np; CAP[k] = shD * 1.46 + 16;          // найдальша точка зрізу (кут екрана 16:9, FOV 55°) + запас
    }
    const need = (x0, y0, z0, x1, y1, z1) => {
      for (let k = 0; k < nd; k++) {
        if (Math.hypot(Math.max(x0 - eye[0], 0, eye[0] - x1), Math.max(y0 - eye[1], 0, eye[1] - y1)) > CAP[k]) continue;
        let out = false;
        for (let i = 0; i < NP[k] && !out; i++) {
          const o = (k * 6 + i) * 4, a = PL[o], b = PL[o + 1], c = PL[o + 2];
          if (a * (a >= 0 ? x1 : x0) + b * (b >= 0 ? y1 : y0) + c * (c >= 0 ? z1 : z0) + PL[o + 3] < 0) out = true;
        }
        if (!out) return true;
      }
      for (const l of locals) {
        const px = l.pos[0] - t[0], py = l.pos[1] - t[1], pz = l.pos[2] - t[2];
        if (Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1), Math.max(z0 - pz, 0, pz - z1)) <= l.range) return true;
      }
      return false;
    };
    for (const R of regs) {
      if (!R.sh.size) continue;
      const ox = R.rx * RW - t[0], oy = R.ry * RW - t[1], oz = R.rz * RH - t[2], g = R.bb;
      if (!(g[0] <= g[3]) || !need(ox + g[0], oy + g[1], oz + g[2], ox + g[3], oy + g[4], oz + g[5])) continue;
      for (const s of R.sh.values()) {
        const b = s.b;
        if (!s.shV || !need(ox + b[0], oy + b[1], oz + b[2], ox + b[3], oy + b[4], oz + b[5])) continue;
        s.visible = true; shOn.push(s);
      }
    }
    return shOn.length;
  }

  function drop(R) {
    for (const k in R.mi) { const m = R.mi[k]; layers.world.removeMeshInstances([m]); m.destroy(); }
    for (const m of R.sh.values()) { layers.shadow.removeMeshInstances([m]); m.destroy(); }
    R.mi = {}; R.sh.clear();
    for (const k in R.ar) R.ar[k].drop();
    R.ar = {};
    root.removeChild(R.node);
    all.delete(R);
  }

  return { create, put, free, setBounds, setCamera, hide, setCasters, cullCasters, drop, stats, S16, get count() { return all.size; } };
}
