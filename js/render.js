// render.js — кадр: регіони секцій (щільні вершини в спільних аренах, multi-draw; далекі — звільняються), фігура гравця, небо, світло й туман
// всесвіту, «вікно» крізь те, що закриває гравця (вище за його коліна: сходинку на 1 рівень не вирізаємо).
// Камера — camera.js (ізометрія чи третя особа); координати в шейдері — відносно цілі камери (target).
import { createGL } from './gl.js';
import { LEVEL, S } from './iso.js';
import { CS, SEC } from './gen/chunk.js';
import { WORLD_H, SEA, MAX_AMP } from './universe.js';
import { figureParts, Mesh } from './gen/mesh.js';
import { poseMatrices } from './anim.js';
import { chain, translate, scale, invert } from './mat.js';
import { skyState, applyWeather } from './sky.js';
import { ISO, VIEW_R, FAR_R, SEAM, viewProj, isoRadius, project, basis, aabbInView, aabbInside } from './camera.js';
import { regionOf, RS, RW, RH } from './gen/pack.js';
import { ck } from './world.js';
import { texturesOf, TEX } from './textures.js';
import { LAYERS } from './gen/materials.js';

const ZR_ISO = [0, (SEA + MAX_AMP) * LEVEL + 6]; // згори радіус — по рельєфу з деревами (інакше чанків набагато більше)
const KEEP_FAR = 1500;                         // плиток далечі в GPU
const ARENA0 = 32768, ARENA_MAX = 4194304;     // ємність арени регіону (вершин): початкова, найбільша
const UP_BYTES = 4 << 20, UP_ITEMS = 64;       // завантажень у GPU за кадр: байтів, мешів
const BODY_R = 200;                            // тіла ближче — малюються (main.js)
export { BODY_R };
// Бюджет пам'яті GPU за замовчуванням — від дальності (секцій у колі × 2,2 непорожніх × ~110 КБ)
export const budgetFor = (viewR) => Math.min(1.5e9, Math.max(256e6, Math.ceil(Math.PI * (viewR / 16 + 1) ** 2) * 2.2 * 110e3));
// Частинки за типом опадів: шейдерний тип, коробка (півширина, висота), падіння (од/с), довжина риски, розмір,
// частка частинок, колір
const PART = {
  rain: { kind: 0, box: [13, 11], fall: 15, len: 0.6, size: 0.018, dens: 1, col: [0.8, 0.85, 0.94, 0.5] },
  acid: { kind: 0, box: [13, 11], fall: 13, len: 0.55, size: 0.02, dens: 1, col: [0.62, 0.95, 0.32, 0.55] },
  snow: { kind: 1, box: [15, 11], fall: 1.6, len: 0, size: 0.03, dens: 0.8, col: [1, 1, 1, 0.85] },
  dust: { kind: 2, box: [16, 7], fall: 0.25, len: 0, size: 0.045, dens: 1, col: [0.8, 0.7, 0.5, 0.5] },
};
const NEAR = 44;                               // ближче (від цілі до центру чанка) — повні рослини, трава й квіти; далі — спрощені
const REF_Z = 0.77;                            // при сонці на цій висоті верхня грань — рівно колір палітри
const rkey = (rx, ry, rz) => ((rx + 0x20000) * 0x40000 + (ry + 0x20000)) * 256 + (rz + 128);
const m1024 = (v) => ((v % 1024) + 1024) % 1024;
// Списки діапазонів на кадр: 0 — тверде біля «вікна», 1 — тверде, 2 — тверде на шві далечі, 3 — рідина, 4 — рідина на шві, 5 — рослини зблизька
const L_CUT = 0, L_PLAIN = 1, L_RING = 2, L_LIQ = 3, L_LIQR = 4, L_FL = 5, NL = 6;

export function createRenderer(canvas) {
  const R = createGL(canvas);
  // Всесвіти: 'd:n' → {regions: Map(rkey → G), slots: Map(sk → G), flora: Map(ck → G | null), added, drawn}.
  // Регіон G = {rx, ry, rz, op, liq, fl (арени, ліниво), secs: Map(sk → slot), fls: Map(ck → fslot), bb, seg}
  const unis = new Map(), fars = new Map();     // плитки далечі: ключ → {mesh, used}
  let frame = 0, texFor = null, nSlots = 0;     // для якого всесвіту зараз текстури
  let budget = budgetFor(VIEW_R), over = false;
  // Черга завантажень у GPU (у порядку надходження — генератор віддає ближчі першими): [kind, d, n, k, q, data, mesh];
  // pend — ключі в черзі (щоб стрімінг не замовляв їх удруге)
  const upQ = [], pend = new Set();
  let upHead = 0;
  const pkey = (kind, d, n, k) => `${kind}${d}:${n}:${k}`;
  const P = {
    plain: R.program('PACKED'), cut: R.program('PACKED CUT'), ring: R.program('PACKED RING'), flora: R.program('PACKED FADE CUTF'),
    lPlain: R.program(''), lRing: R.program('RING'), inst: R.program('INST FADE CUTF'),
  };
  const fig = Object.fromEntries(Object.entries(figureParts([226, 92, 70])).map(([k, m]) => [k, R.upload(m)]));
  const shadow = (() => { const M = new Mesh(); M.quad([-0.3, -0.3, 0.02], [0.3, -0.3, 0.02], [0.3, 0.3, 0.02], [-0.3, 0.3, 0.02], 0, 0, 1, [0, 0, 0]); return R.upload(M.finish()); })();

  // шаблони тіл (ширяюче каміння) у GPU: ключ шаблону → меш
  const tmpl = new Map();
  const tmplMesh = (T) => {
    let m = tmpl.get(T);
    if (!m) {
      const idx = T.verts > 65535 ? new Uint32Array(T.verts) : new Uint16Array(T.verts);
      for (let i = 0; i < T.verts; i++) idx[i] = i;
      m = R.upload({ pos: T.p, nor: T.n, col: T.c, mat: T.m, idx, count: T.verts });
      if (tmpl.size > 400) { for (const v of tmpl.values()) R.free(v); tmpl.clear(); }
      tmpl.set(T, m);
    }
    return m;
  };

  // ---- сховище регіонів ----
  let lastU = null;                             // останній знайдений (стрімінг питає підряд — без складання рядків)
  const uni = (d, n, make) => {
    if (lastU && lastU.d === d && lastU.n === n && !lastU.dead) return lastU;
    const k = `${d}:${n}`;
    let U = unis.get(k);
    if (!U && make) { U = { d, n, regions: new Map(), slots: new Map(), flora: new Map(), added: frame, drawn: 0, at: performance.now() }; unis.set(k, U); }
    if (U) lastU = U;
    return U;
  };
  const region = (U, rx, ry, rz) => {
    const k = rkey(rx, ry, rz);
    let G = U.regions.get(k);
    if (!G) {
      G = { rx, ry, rz, k, op: null, liq: null, fl: null, secs: new Map(), fls: new Map(), bb: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], seg: new Int32Array(NL * 2) };
      U.regions.set(k, G);
    }
    return G;
  };
  const grow = (bb, b) => { if (b) for (let i = 0; i < 3; i++) { if (b[i] < bb[i]) bb[i] = b[i]; if (b[i + 3] > bb[i + 3]) bb[i + 3] = b[i + 3]; } };
  // Покласти n вершин у арену регіону kind ('op' | 'liq' | 'fl'): зсув
  const put = (G, kind, buf, n) => {
    let A = G[kind];
    if (!A) { let c = ARENA0; while (c < n) c *= 2; A = G[kind] = R.arena(c); }
    let off = A.a.alloc(n);
    while (off < 0 && A.a.cap < ARENA_MAX) { A.grow(Math.min(ARENA_MAX, A.a.cap * 2)); off = A.a.alloc(n); }
    if (off < 0) return -1;
    A.put(off, new Uint8Array(buf, 0, n * 16));
    return off;
  };
  const dropRegion = (U, G) => {
    for (const A of [G.op, G.liq, G.fl]) if (A) A.drop();
    for (const k of G.secs.keys()) U.slots.delete(k);
    for (const k of G.fls.keys()) U.flora.delete(k);
    nSlots -= G.secs.size;
    U.regions.delete(G.k);
  };
  const emptyCheck = (U, G) => { if (!G.secs.size && !G.fls.size) dropRegion(U, G); };
  const removeSlot = (U, k) => {
    const G = U.slots.get(k);
    if (!G) return;
    const sl = G.secs.get(k);
    if (sl.off >= 0) G.op.a.free(sl.off, sl.ns + sl.nf);
    if (sl.loff >= 0) G.liq.a.free(sl.loff, sl.nl);
    G.secs.delete(k); U.slots.delete(k); nSlots--;
    emptyCheck(U, G);
  };
  const removeFlora = (U, k) => {
    const G = U.flora.get(k);
    U.flora.delete(k);
    if (!G) return;
    const f = G.fls.get(k);
    if (f.off >= 0) G.fl.a.free(f.off, f.n);
    G.fls.delete(k);
    emptyCheck(U, G);
  };
  const dropUni = (U) => { for (const G of [...U.regions.values()]) dropRegion(U, G); unis.delete(`${U.d}:${U.n}`); U.dead = true; };

  // Секція в арени свого регіону (заміна — старі діапазони звільнити); без меша — порожня
  function putSection(d, n, k, q, mesh) {
    const U = uni(d, n, true);
    removeSlot(U, k);
    if (!mesh) return;
    const [rx, ry, rz] = regionOf(q.cx, q.cy, q.cz), G = region(U, rx, ry, rz);
    const sl = { cx: q.cx, cy: q.cy, cz: q.cz, off: -1, ns: mesh.ns, nf: mesh.nf, loff: -1, nl: mesh.nl, bb: mesh.bb, lbb: mesh.lbb };
    if (mesh.ns + mesh.nf) sl.off = put(G, 'op', mesh.op, mesh.ns + mesh.nf);
    if (mesh.nl) sl.loff = put(G, 'liq', mesh.liq, mesh.nl);
    if (sl.off < 0) sl.ns = sl.nf = 0;
    if (sl.loff < 0) sl.nl = 0;
    grow(G.bb, mesh.bb); grow(G.bb, mesh.lbb);
    G.secs.set(k, sl); U.slots.set(k, G); nSlots++;
    U.added = frame; U.at = performance.now();
  }
  // Рослини зблизька стовпця; порожні — позначка null (є, малювати нічого)
  function putFlora(d, n, k, q, data, mesh) {
    const U = uni(d, n, true);
    removeFlora(U, k);
    if (!mesh.n) { U.flora.set(k, null); return; }
    const [rx, ry] = regionOf(q.cx, q.cy, 0), G = region(U, rx, ry, data.rz);
    const off = put(G, 'fl', mesh.fl, mesh.n);
    G.fls.set(k, { cx: q.cx, cy: q.cy, off, n: off < 0 ? 0 : mesh.n, bb: mesh.bb });
    grow(G.bb, mesh.bb);
    U.flora.set(k, G);
    U.added = frame; U.at = performance.now();
  }

  // ---- пам'ять: звільнення, бюджет, стиснення арен (раз на 60 кадрів) ----
  const horiz = (G, t) => {
    const ox = G.rx * RW - t[0], oy = G.ry * RW - t[1];
    return Math.hypot(ox > 0 ? ox : ox + RW < 0 ? -(ox + RW) : 0, oy > 0 ? oy : oy + RW < 0 ? -(oy + RW) : 0);
  };
  const used = () => {
    let b = 0;
    for (const U of unis.values()) for (const G of U.regions.values()) for (const A of [G.op, G.liq, G.fl]) if (A) b += A.a.used * 16;
    R.stats.arenaUsed = b;
    return b + R.stats.gpuBytes;
  };
  // Арена зайнята менш ніж на чверть — у менший буфер, живі діапазони копією на GPU
  const compact = (G) => {
    for (const kind of ['op', 'liq', 'fl']) {
      const A = G[kind];
      if (!A || A.a.cap <= 65536 || A.a.used >= A.a.cap / 4) continue;
      let cap2 = 65536;
      while (cap2 < A.a.used * 1.5) cap2 *= 2;
      const live = [];
      if (kind === 'op') for (const sl of G.secs.values()) { if (sl.off >= 0) live.push([sl, 'off', sl.ns + sl.nf]); }
      else if (kind === 'liq') for (const sl of G.secs.values()) { if (sl.loff >= 0) live.push([sl, 'loff', sl.nl]); }
      else for (const f of G.fls.values()) if (f.off >= 0) live.push([f, 'off', f.n]);
      G[kind] = R.repack(A, cap2, live);
    }
  };
  function maintain(U, t, rad, laws) {
    // поточний всесвіт: регіони далеко за видимим; рослини зблизька, що вже не зблизька
    if (U) {
      for (const G of [...U.regions.values()]) if (horiz(G, t) > rad + 256) dropRegion(U, G);
      for (const [k2, G] of U.flora) if (G) { const f = G.fls.get(k2); if (Math.hypot(f.cx * CS + 8 - t[0], f.cy * CS + 8 - t[1]) > NEAR + 96) removeFlora(U, k2); }
    }
    // інші всесвіти, які давно не малювали й не наповнювали (сусіди ±1 — коло приземлення — лишаються)
    for (const V of [...unis.values()]) if (V !== U && !(V.d === laws.d && Math.abs(V.n - laws.n) <= 1) && frame - Math.max(V.drawn, V.added) > 600) dropUni(V);
    // бюджет: (1) цілі всесвіти, яких не чіпали 2 с, найдавніші першими; (2) регіони поточного, не мальовані ≥ 240 кадрів, найдальші першими
    let b = used();
    if (b > budget) {
      const now = performance.now();
      for (const V of [...unis.values()].filter((V) => V !== U && now - V.at > 2000).sort((a, c) => a.at - c.at)) { if (b <= budget) break; dropUni(V); b = used(); }
      if (b > budget && U) for (const G of [...U.regions.values()].filter((G) => frame - (G.drawn || 0) >= 240).sort((a, c) => horiz(c, t) - horiz(a, t))) {
        if (b <= budget) break;
        dropRegion(U, G); b = used();
      }
    }
    over = R.stats.over = b > budget;
    for (const V of unis.values()) for (const G of V.regions.values()) compact(G);
  }

  // ---- кадр: діапазони за списками, без виділень ----
  const LF = Array.from({ length: NL }, () => new Int32Array(4096)), LC = Array.from({ length: NL }, () => new Int32Array(4096)), LN = new Int32Array(NL);
  const pushR = (j, segStart, off, n) => {
    const i = LN[j];
    if (i > segStart && LF[j][i - 1] + LC[j][i - 1] === off) { LC[j][i - 1] += n; return; }
    if (i >= LF[j].length) { const f = new Int32Array(i * 2), c = new Int32Array(i * 2); f.set(LF[j]); c.set(LC[j]); LF[j] = f; LC[j] = c; }
    LF[j][i] = off; LC[j][i] = n; LN[j] = i + 1;
  };
  const visRegs = [], groups = new Map();
  let instData = new Float32Array(6 * 256);
  const cutHit = (m, cut, x0, y0, z0, x1, y1, z1) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity, dz = Infinity;
    for (let k = 0; k < 8; k++) {
      const p = project(m, [k & 1 ? x1 : x0, k & 2 ? y1 : y0, k & 4 ? z1 : z0], R.width, R.height);
      if (!p) return true;                                   // кут за камерою — вважати влучанням
      if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; if (p[2] < dz) dz = p[2];
    }
    if (dz >= cut.depth) return false;
    const qx = Math.max(a, Math.min(cut.x, c)), qy = Math.max(b, Math.min(cut.y, d));
    return Math.hypot(qx - cut.x, qy - cut.y) < cut.r;
  };

  return {
    R,
    resize: () => R.resize(),
    // Секція (k — sk): меш {op (тверде + nf далеких рослин), ns, nf, bb, liq, nl, lbb} у кадрі регіону; без меша — порожня.
    // Рослини зблизька (k — ck): меш {fl, n, bb}, регіон — (rx, ry) стовпця й data.rz. Обидва — через чергу завантажень
    addSection(d, n, k, q, mesh) { pend.add(pkey('s', d, n, k)); upQ.push(['s', d, n, k, q, null, mesh]); },
    addFlora(d, n, k, q, data, mesh) { pend.add(pkey('f', d, n, k)); upQ.push(['f', d, n, k, q, data, mesh]); },
    // Завантажити з черги до bytes байтів і UP_ITEMS мешів (щокадру)
    pump(bytes = UP_BYTES) {
      let b = 0, i = 0;
      while (upHead < upQ.length && b < bytes && i < UP_ITEMS) {
        const [kind, d, n, k, q, data, mesh] = upQ[upHead];
        upQ[upHead++] = null;
        pend.delete(pkey(kind, d, n, k));
        if (kind === 's') { putSection(d, n, k, q, mesh); b += mesh ? (mesh.ns + mesh.nf + mesh.nl) * 16 : 0; }
        else { putFlora(d, n, k, q, data, mesh); b += mesh.n * 16; }
        i++;
      }
      if (upHead === upQ.length) { upQ.length = 0; upHead = 0; } else if (upHead > 4096) { upQ.splice(0, upHead); upHead = 0; }
    },
    setBudget(bytes) { budget = bytes; },
    get overBudget() { return over; },
    addFar(key, data, mesh) {
      const e = fars.get(key);
      if (e) R.free(e.mesh);
      fars.set(key, { mesh: R.upload(mesh.solid), used: frame });
      if (fars.size > KEEP_FAR) {
        const old = [...fars].sort((a, b) => a[1].used - b[1].used).slice(0, fars.size - KEEP_FAR * 0.9);
        for (const [k2, e2] of old) { R.free(e2.mesh); fars.delete(k2); }
      }
    },
    hasSection(d, n, k) { const U = uni(d, n); return (!!U && U.slots.has(k)) || pend.has(pkey('s', d, n, k)); },
    hasFlora(d, n, k) { const U = uni(d, n); return (!!U && U.flora.has(k)) || pend.has(pkey('f', d, n, k)); },
    hasFar: (key) => fars.has(key),
    clear() {
      upQ.length = 0; upHead = 0; pend.clear();
      for (const U of [...unis.values()]) dropUni(U);
      for (const e of fars.values()) R.free(e.mesh);
      fars.clear();
    },
    get meshCount() { return nSlots; },

    // Камера на цей кадр: матриця, радіус видимого, туман.
    // dist — відстань до ока в третій особі (після зіткнення з рельєфом)
    view(camera, target, dist) {
      const v = viewProj(camera, R.width, R.height, dist), iso = camera.mode === ISO;
      const rad = iso ? isoRadius(camera, R.width, R.height, ZR_ISO, target[2]) : VIEW_R;
      // туман: згори — за відстанню на екрані (кути екрана злегка в тумані, висота не вибілює), у третій особі — по горизонталі
      const b = basis(camera), rs = Math.hypot(R.width, R.height) / 2 / (S * camera.zoom);
      return { ...v, rad, fog: iso ? [0.8 * rs, 1.15 * rs] : [0.3 * FAR_R, 0.97 * FAR_R], fogAxes: iso ? [b.r, b.up] : null };
    },

    // st: {camera, target [x,y,z], view (з view()), laws, clock (с, годинник світу), weather ({W — weather.js weatherAt,
    // loc — localWeather}), rain ({x0, y0} — кут карти укриттів), far (плитки далечі [{key, x0, y0}] — у третій особі;
    // ближче за SEAM їх не видно, далі — не видно секцій), bodies, me {x, y, z, gz, yaw, tint, anim}}.
    // Секції — регіони всесвіту laws (d, n) у радіусі видимого й у піраміді. Повертає стан неба (sky.js) — для HUD
    draw(st) {
      frame++;
      const { target: t, view, laws } = st, sk = skyState(laws, st.clock || 0), wt = st.weather;
      if (wt) applyWeather(sk, laws, wt.W, st.clock || 0);
      const [lx, ly, lz] = sk.light, amb = sk.amb, vk = sk.visK ?? 1;
      const iso = st.camera.mode === ISO;
      const fogR = iso ? [view.fog[0] * Math.sqrt(vk), view.fog[1] * Math.sqrt(vk)] : [view.fog[0] * vk, view.fog[1] * vk];
      const wk = wt ? Math.min(0.012, 0.09 / (Math.hypot(wt.W.wind[0], wt.W.wind[1]) + 1e-6)) : 0;   // гойдання — не більше за ураганне
      const wind = wt ? [wt.W.wind[0] * wk, wt.W.wind[1] * wk] : [0, 0];
      const k = 1 / (amb + (1 - amb) * REF_Z);
      const lightCol = [sk.lightK[0] * k, sk.lightK[1] * k, sk.lightK[2] * k];
      const me = st.me, m = view.m;
      let cut = null, cutFlora = null;
      if (me) {
        const pc = [me.x - t[0], me.y - t[1], me.z + 0.45 - t[2]], p = project(m, pc, R.width, R.height);
        const { r } = basis(st.camera), q = p && project(m, [pc[0] + r[0] * 0.7, pc[1] + r[1] * 0.7, pc[2]], R.width, R.height);
        const kr = iso ? 1.35 : 0.75;   // третя особа: лише силует (дерева поруч не вирізаємо)
        if (p && q) {
          const r = Math.hypot(q[0] - p[0], q[1] - p[1]);
          cut = { x: p[0], y: p[1], r: r * kr, z: me.z + 0.6 - t[2], depth: p[2] };
          cutFlora = { ...cut, r: r * (iso ? 1.6 : 2.4) };   // крізь рослини — ширше вікно
        }
      }
      const tk = `${laws.d}:${laws.n}:${laws.ds}`;
      if (texFor !== tk) { texFor = tk; R.setTextures(texturesOf(laws), TEX, LAYERS); }
      // місцевий час (плин часу всесвіту) — для плину води, гойдання, частинок
      const lt = (st.clock || 0) * (laws.phys ? laws.phys.time : 1) % 3000;
      const camD = Math.hypot(...view.eye);
      // рослини: у третій особі біля камери розчиняються (камера в кроні не сліпне)
      const fade = iso ? null : [Math.min(1, camD * 0.3), Math.max(2.5, camD * 0.65)];
      R.begin({ fogCol: sk.fog, light: [lx, ly, lz], amb, lightCol, fog: fogR, fogAxes: view.fogAxes, view: m, cut, cutF: cutFlora, fade, eye: view.eye, time: lt, sky: { inv: invert(m), st: sk }, wind, curve: laws.phys ? 0.5 / laws.phys.planetR : 0 });

      // Видимі регіони й діапазони в них
      const farOn = !!(st.far && st.far.length), rad = view.rad, U = uni(laws.d, laws.n);
      LN.fill(0); visRegs.length = 0;
      if (U) {
        U.drawn = frame; U.at = performance.now();
        for (const G of U.regions.values()) {
          const ox = G.rx * RW - t[0], oy = G.ry * RW - t[1], oz = G.rz * RH - t[2];
          const nx = ox > 0 ? ox : ox + RW < 0 ? -(ox + RW) : 0, ny = oy > 0 ? oy : oy + RW < 0 ? -(oy + RW) : 0;
          if (Math.hypot(nx, ny) > rad + 4) continue;
          const b = G.bb;
          if (!(b[0] <= b[3]) || !aabbInView(m, ox + b[0], oy + b[1], oz + b[2], ox + b[3], oy + b[4], oz + b[5])) continue;
          const inside = aabbInside(m, ox + b[0], oy + b[1], oz + b[2], ox + b[3], oy + b[4], oz + b[5]);
          G.dist = Math.hypot(nx, ny); G.ox = ox; G.oy = oy; G.oz = oz;
          visRegs.push(G); G.drawn = frame;
          for (let j = 0; j < NL; j++) G.seg[j * 2] = G.seg[j * 2 + 1] = 0;
          G.inside = inside;
        }
        visRegs.sort((a, b) => a.dist - b.dist);
        for (const G of visRegs) {
          const { ox, oy, oz, inside } = G, seg = G.seg;
          for (let j = 0; j < NL; j++) seg[j * 2] = LN[j];
          for (const sl of G.secs.values()) {
            const ax = sl.cx * CS - t[0], ay = sl.cy * CS - t[1];
            const nx = ax > 0 ? ax : ax + CS < 0 ? -(ax + CS) : 0, ny = ay > 0 ? ay : ay + CS < 0 ? -(ay + CS) : 0, dn = Math.hypot(nx, ny);
            if (dn > rad || (farOn && dn > SEAM)) continue;
            const ring = farOn && Math.hypot(Math.max(-ax, ax + CS), Math.max(-ay, ay + CS)) > SEAM;
            if (sl.off >= 0 && sl.bb) {
              const b = sl.bb;
              if (inside || aabbInView(m, ox + b[0], oy + b[1], oz + b[2], ox + b[3], oy + b[4], oz + b[5])) {
                const dc = Math.hypot(ax + CS / 2, ay + CS / 2), fk = ck(sl.cx, sl.cy);
                // далекі рослини — далі за NEAR (чи поки рослин зблизька ще немає)
                const n = sl.ns + (dc >= NEAR || !U.flora.has(fk) ? sl.nf : 0);
                let j = ring ? L_RING : L_PLAIN;
                if (!ring && cut && (iso || dn <= camD + 8) && cutHit(m, cut, ox + b[0], oy + b[1], oz + b[2], ox + b[3], oy + b[4], oz + b[5])) j = L_CUT;
                if (n) pushR(j, seg[j * 2], sl.off, n);
              }
            }
            if (sl.loff >= 0 && sl.lbb) {
              const b = sl.lbb;
              if (inside || aabbInView(m, ox + b[0], oy + b[1], oz + b[2], ox + b[3], oy + b[4], oz + b[5])) pushR(ring ? L_LIQR : L_LIQ, seg[(ring ? L_LIQR : L_LIQ) * 2], sl.loff, sl.nl);
            }
          }
          for (const f of G.fls.values()) {
            if (f.off < 0 || !f.n) continue;
            const dc = Math.hypot(f.cx * CS + CS / 2 - t[0], f.cy * CS + CS / 2 - t[1]);
            if (dc >= NEAR) continue;
            const b = f.bb;
            if (inside || aabbInView(m, ox + b[0], oy + b[1], oz + b[2], ox + b[3], oy + b[4], oz + b[5])) pushR(L_FL, seg[L_FL * 2], f.off, f.n);
          }
          for (let j = 0; j < NL; j++) seg[j * 2 + 1] = LN[j];
        }
      }
      // Діапазони списку j по регіонах програмою P0; arena — яка арена регіону
      const pass = (j, P0, arena) => {
        let any = false;
        for (const G of visRegs) {
          const a = G.seg[j * 2], b = G.seg[j * 2 + 1];
          if (b <= a || !G[arena]) continue;
          if (!any) { R.use(P0); any = true; }
          R.origin(G.ox, G.oy, G.oz, m1024(G.rx * RW), m1024(G.ry * RW), m1024(G.rz * RH));
          R.drawRanges(G[arena], LF[j], LC[j], a, b - a);
        }
      };
      R.use(P.ring); R.ring(0, SEAM);
      pass(L_CUT, P.cut, 'op');
      pass(L_PLAIN, P.plain, 'op');
      pass(L_RING, P.ring, 'op');
      // Далечінь: плитки поверхні — лише за швом (ближче — повні секції)
      if (farOn) {
        R.use(P.lRing); R.ring(SEAM, 1e9);
        for (const f of st.far) { const e = fars.get(f.key); if (e) { e.used = frame; R.drawAt(e.mesh, f.x0 - t[0], f.y0 - t[1], -t[2]); } }
      }
      // Рослини зблизька (розчинення біля ока, ширше «вікно»)
      pass(L_FL, P.flora, 'fl');
      // Тіла (ширяюче каміння): шаблон з поворотом, нахилом і масштабом; низ коробки — основа шаблону
      // — екземплярами: групи за шаблоном, один буфер на кадр, виклик на групу
      if (st.bodies && st.bodies.length) {
        groups.clear();
        let n = 0;
        for (const b of st.bodies) {
          const r = Math.max(b.hx, b.hy, b.hz) * 2, x = b.x - t[0], y = b.y - t[1], z = b.z - t[2];
          if (!aabbInView(m, x - r, y - r, z - r, x + r, y + r, z + r)) continue;
          let g = groups.get(b.T);
          if (!g) groups.set(b.T, (g = []));
          g.push(b); n++;
        }
        if (instData.length < n * 6) instData = new Float32Array(n * 12);
        let i = 0;
        for (const g of groups.values()) for (const b of g) {
          instData[i++] = b.x - t[0]; instData[i++] = b.y - t[1]; instData[i++] = b.z - b.hz - t[2]; instData[i++] = b.yaw; instData[i++] = b.tilt; instData[i++] = b.s;
        }
        if (n) {
          R.instances(instData, n);
          R.use(P.inst);
          let first = 0;
          for (const [T, g] of groups) { R.drawInstanced(tmplMesh(T), first, g.length); first += g.length; }
        }
      }
      // Поверхні рідин — після всього твердого, напівпрозоро (лава — непрозора); не вирізаємо (гравець у воді — під нею)
      R.beginAlpha();
      for (const [j, P0] of [[L_LIQ, P.plain], [L_LIQR, P.ring]]) { R.use(P0); R.alpha(laws.liquid.alpha); pass(j, P0, 'liq'); R.alpha(1); }
      R.endAlpha();
      if (frame % 60 === 0) maintain(U, t, rad, laws);
      // камера впритул (притиснута до стіни за спиною) — фігуру не малюємо, інакше око в голові
      if (me && (view.ortho || Math.hypot(...view.eye) > 0.7)) {
        R.use(P.lPlain);                            // власні грані гравця не вирізаємо
        const ox = me.x - t[0], oy = me.y - t[1], pose = poseMatrices(me.anim, ox, oy, me.z - t[2], me.yaw);
        for (const p in fig) R.draw(fig[p], pose[p], me.tint);
        const up = me.z - me.gz, sz = Math.max(0.45, 1 - up * 0.25);  // тінь: що вище в повітрі, то менша й блідіша; у воді — немає
        if (!me.swim) R.drawAlpha(shadow, chain(translate(ox, oy, me.gz - t[2]), scale(sz, sz, 1)), 0.3 * (0.4 + 0.6 * sk.day) / (1 + up * 0.6));
      }
      // Опади й пил — останніми (напівпрозорі, без запису глибини: рельєф їх закриває)
      const loc = wt && wt.loc;
      if (loc && loc.type && st.rain) {
        const Q = PART[loc.type], b = basis(st.camera), B2 = Q.box[0] * 2, md = (v) => ((v % B2) + B2) % B2;
        const col = loc.type === 'dust' ? [...laws.pal.desert.map((v) => v / 255 * (0.35 + 0.65 * Math.min(1, sk.lightK[1]))), 0.55] : Q.col.map((v, i) => i < 3 ? v * (0.3 + 0.7 * Math.min(1, sk.lightK[1])) : v);
        R.drawParticles({
          view: view.m, box: Q.box, t: [md(t[0]), md(t[1])], z: t[2], move: [wt.W.wind[0], wt.W.wind[1], Q.fall, lt],
          r: b.r, u: b.up, kind: [Q.kind, loc.k * Q.dens, Q.len, Q.size], mapO: [st.rain.x0 - t[0], st.rain.y0 - t[1]], col,
        });
      }
      R.end();
      return sk;
    },
  };
}
