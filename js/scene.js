// scene.js — сцена гри на рушії PlayCanvas (js/engine/graphics): регіони секцій (щільні вершини в аренах, multi-draw;
// далекі — звільняються), рослини зблизька, плитки далечі, фігура гравця, тіла екземплярами, опади частинками, небо з
// розсіяним світлом, світла сонць і місяців з тінями, туман, «вікно» крізь те, що закриває гравця, розчинення рослин біля
// ока. Облік (що в якому діапазоні, які видимі) — тут; об'єкти PlayCanvas — у рушії. API для main.js, stream.js,
// debug.js. Камера — camera.js гри (третя особа чи ізометрія)
import { createApp, pc } from './engine/graphics/app.js';
import { createMaterials } from './engine/graphics/materials.js';
import { createRegions } from './engine/graphics/regions.js';
import { createSky } from './engine/graphics/sky.js';
import { createLights, SHADOW_D } from './engine/graphics/lights.js';
import { floatMesh } from './engine/graphics/meshes.js';
import { createInstances } from './engine/graphics/instances.js';
import { createParticleVolume, setShelter } from './engine/graphics/particles.js';
import { createSpriteAtlas } from './engine/graphics/sprites.js';
import { SPR } from './gen/sprites.js';
import { SKY_GLSL, SKY_WGSL } from './sky-shader.js';
import { LEVEL, S } from './iso.js';
import { CS } from './gen/chunk.js';
import { SEA, MAX_AMP, L_LAVA } from './universe.js';
import { liquidVis } from './collision.js';
import { figureParts } from './gen/mesh.js';
import { poseMatrices, viewArms } from './anim.js';
import { skyState, applyWeather, lightsOf, pcIntensity } from './sky.js';
import { ISO, FIRST, CAM_R, fovOf, VIEW_R, FAR_R, SEAM, viewProj, isoRadius, project, basis, aabbInView, aabbInside, LOD_R, LOD_CAP, LOD_ON, lodOf, keepLod, colDist, FLORA_NEAR, FLORA_FADE, FLORA_THIN } from './camera.js';
import { regionOf, RS, RW, RH, PO, PQ } from './gen/pack.js';
import { ck } from './world.js';
import { texturesOf, TEX } from './textures.js';
import { LAYERS, MAT_TABLE } from './gen/materials.js';

const ZR_ISO = [0, (SEA + MAX_AMP) * LEVEL + 6]; // згори радіус — по рельєфу з деревами
const KEEP_FAR = 1500;                         // плиток далечі в GPU
const ARENA0 = 32768, ARENA_MAX = 4194304;     // ємність арени регіону (вершин): початкова, найбільша
const UP_BYTES = 4 << 20, UP_ITEMS = 64;       // завантажень у GPU за кадр: байтів, мешів
const BODY_R = 200;                            // тіла ближче — малюються (main.js)
export { BODY_R };
// Бюджет пам'яті GPU за замовчуванням — від дальності (секцій у колі × 2,2 непорожніх × ~110 КБ)
export const budgetFor = (viewR) => Math.min(1.5e9, Math.max(256e6, Math.ceil(Math.PI * (viewR / 16 + 1) ** 2) * 2.2 * 110e3));
// Опади за типом: коробка (півширина, висота), падіння (од/с), довжина риски, розмір, частка частинок, колір, текстура
const PART = {
  rain: { box: [13, 11], fall: 15, len: 0.6, size: 0.018, dens: 1, col: [0.8, 0.85, 0.94, 0.5], tex: 'streak' },
  acid: { box: [13, 11], fall: 13, len: 0.55, size: 0.02, dens: 1, col: [0.62, 0.95, 0.32, 0.55], tex: 'streak' },
  snow: { box: [15, 11], fall: 1.6, len: 0, size: 0.03, dens: 0.8, col: [1, 1, 1, 0.85], tex: 'dot' },
  dust: { box: [16, 7], fall: 0.25, len: 0, size: 0.045, dens: 1, col: [0.8, 0.7, 0.5, 0.5], tex: 'dot' },
};
const PARTICLES = 6000;
const rkey = (rx, ry, rz) => ((rx + 0x20000) * 0x40000 + (ry + 0x20000)) * 256 + (rz + 128);
// Списки діапазонів на кадр: 0 — тверде біля «вікна», 1 — тверде, 2 — тверде на шві далечі (0–2 — з відсіканням задніх
// граней), 3 — рідина, 4 — рідина на шві, 5 — рослини зблизька, 6–8 — далекі рослини й каміння секцій (пара до 0–2, без
// відсікання: листя видно з обох боків), 9 — далекі рослини секцій у смузі переходу (проступають, де зникають повні),
// 10 — малі рослини зблизька спрайтами
const L_CUT = 0, L_PLAIN = 1, L_RING = 2, L_LIQ = 3, L_LIQR = 4, L_FL = 5, L_OBJ = 6, L_OBJF = 9, L_GR = 10, NL = 11;
const FALLBACK = [[1, 2], [0, 2], [1, 0]];     // рівень деталізації, коли потрібного ще немає: спершу тонший
// Сітки камери регіону: вид → арена, матеріал, список кадру
const KINDS = {
  solidC: ['op', 'solidC', L_CUT], solid: ['op', 'solid', L_PLAIN], solidR: ['op', 'solidR', L_RING],
  objC: ['op', 'objC', L_OBJ + L_CUT], obj: ['op', 'obj', L_OBJ + L_PLAIN], objR: ['op', 'objR', L_OBJ + L_RING], objF: ['op', 'objF', L_OBJF],
  liq: ['liq', 'liq', L_LIQ], liqR: ['liq', 'liqR', L_LIQR], fl: ['fl', 'fl', L_FL], gr: ['fl', 'gr', L_GR],
};
// Кидачі тіней — по блоку BS×BS стовпців регіону (regions.js): 0 — тверде з далекими рослинами й камінням секції (в арені
// поруч — один діапазон; матеріал без відсікання граней), 1 — малі рослини спрайтами, 2 — рослини зблизька
const BS = 2, NB = RS / BS;

// settings: { gpu: 'webgl2' | 'webgpu', shadows: 'off' | 'pcf3' | 'pcss' }
export async function createScene(canvas, settings = {}) {
  const G = await createApp(canvas, { device: settings.gpu || 'webgl2', far: FAR_R * 1.6 });
  const { app, dev, scene } = G, camE = G.camE, cam = G.cam;

  // ---- матеріали (engine/graphics/materials.js) ----
  const M = createMaterials(G), mats = {};
  const mk = (name, o) => (mats[name] = M.makeMaterial(name, o));
  const BACK = pc.CULLFACE_BACK;
  mk('solid', { cull: BACK, defines: ['ECO_CURVE'] }); mk('solidR', { cull: BACK, defines: ['ECO_CURVE', 'ECO_RING_IN'] }); mk('solidC', { cull: BACK, defines: ['ECO_CURVE', 'ECO_CUT'] });
  mk('obj', { defines: ['ECO_CURVE', 'ECO_WIND'] }); mk('objR', { defines: ['ECO_CURVE', 'ECO_WIND', 'ECO_RING_IN'] }); mk('objC', { defines: ['ECO_CURVE', 'ECO_WIND', 'ECO_CUT'] });
  mk('liq', { defines: ['ECO_CURVE'], blend: { opacity: 0.75 } }); mk('liqR', { defines: ['ECO_CURVE', 'ECO_RING_IN'], blend: { opacity: 0.75 } });
  mk('objF', { defines: ['ECO_CURVE', 'ECO_WIND', 'ECO_XIN'] });
  mk('fl', { defines: ['ECO_CURVE', 'ECO_WIND', 'ECO_FADE', 'ECO_CUTF', 'ECO_THIN', 'ECO_XOUT'] });
  mk('gr', { defines: ['ECO_CURVE', 'ECO_WIND', 'ECO_SPRITE', 'ECO_FADE', 'ECO_CUTF', 'ECO_THIN', 'ECO_XOUT'] });
  // атлас спрайтів малих рослин (engine/graphics/sprites.js); шар — у вершинах трави (putFlora)
  const SA = createSpriteAtlas(G, { size: SPR, onTexture: (t) => M.setSpriteArray(t) });
  mk('far', { cull: BACK, matcol: true, defines: ['ECO_CURVE', 'ECO_RING_OUT'] });
  mk('fig', { matcol: true });
  mk('body', { matcol: true, defines: ['ECO_CURVE'] });
  M.setMaterialTable(MAT_TABLE);
  const CULLED = ['solid', 'solidR', 'solidC', 'far'];

  // ---- регіони (engine/graphics/regions.js) ----
  const FMT = new pc.VertexFormat(dev, [
    { semantic: pc.SEMANTIC_POSITION, components: 4, type: pc.TYPE_UINT16, normalize: true },
    { semantic: pc.SEMANTIC_NORMAL, components: 4, type: pc.TYPE_INT8, normalize: true },
    { semantic: pc.SEMANTIC_COLOR, components: 4, type: pc.TYPE_UINT8, normalize: true },
  ]);
  if (FMT.size !== 16 || FMT.elements[1].offset !== 8 || FMT.elements[2].offset !== 12) throw new Error('розкладка вершини PlayCanvas ≠ gen/pack.js');
  const kinds = {};
  for (const k in KINDS) kinds[k] = { arena: KINDS[k][0], material: mats[KINDS[k][1]] };
  const stats = { draws: 0, tris: 0, shTris: 0, shDraws: 0, up: 0, upBytes: 0, gpuBytes: 0, arenaBytes: 0, arenaUsed: 0, over: false };
  const RG = createRegions(G, { size: [RW, RW, RH], PO, PQ, format: FMT, kinds, casters: [{ arena: 'op', material: mats.obj }, { arena: 'fl', material: mats.gr }, { arena: 'fl', material: mats.fl }], arena0: ARENA0, arenaMax: ARENA_MAX, stats });

  // ---- небо, світла, частинки ----
  // розсіяне з неба перепікається, коли сонце зсунулось на 2° (доба 6–40 хв × плин часу — до ~2°/с; розсіяне плавне)
  const sky = createSky(G, { glsl: SKY_GLSL, wgsl: SKY_WGSL, lightingThreshold: 2 });
  const LG = createLights(G, { shadows: settings.shadows || 'pcf3' });
  const vols = {};
  const volume = (type) => {
    let v = vols[type];
    if (!v) {
      const Q = PART[type];
      v = vols[type] = createParticleVolume(G, { numParticles: Math.round(PARTICLES * Q.dens), lifetime: 4, size: Q.size, stretch: Q.len ? Q.len / Q.fall : 0, color: Q.col, texture: Q.tex, boxXZ: Q.box[0], boxY: Q.box[1] / 2 });
    }
    return v;
  };

  // ---- фігура: один меш на всі частини, вершини — на CPU за матрицями пози; руки першої особи — так само ----
  const figP = figureParts([226, 92, 70]);
  const posedMesh = (names) => {
    const parts = [];
    let nv = 0, ni = 0;
    for (const p of names) { parts.push([p, nv, figP[p]]); nv += figP[p].pos.length / 3; ni += figP[p].count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Uint8Array(nv * 4), idx = new Uint32Array(ni);
    { let ii = 0; for (const [, v0, m] of parts) { const n = m.pos.length / 3; for (let i = 0; i < n; i++) col.set([m.col[i * 3], m.col[i * 3 + 1], m.col[i * 3 + 2], m.mat[i]], (v0 + i) * 4); for (let i = 0; i < m.count; i++) idx[ii++] = m.idx[i] + v0; } }
    const mesh = new pc.Mesh(dev);
    mesh.setPositions(pos); mesh.setNormals(nor); mesh.setColors32(col); mesh.setIndices(idx); mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    const pose = (P) => {
      for (const [p, v0, m] of parts) {
        const Mx = P[p], n = m.pos.length / 3;
        for (let i = 0; i < n; i++) {
          const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2], o = (v0 + i) * 3;
          pos[o] = Mx[0] * x + Mx[4] * y + Mx[8] * z + Mx[12]; pos[o + 1] = Mx[1] * x + Mx[5] * y + Mx[9] * z + Mx[13]; pos[o + 2] = Mx[2] * x + Mx[6] * y + Mx[10] * z + Mx[14];
          const a = m.nor[i * 3], b = m.nor[i * 3 + 1], c = m.nor[i * 3 + 2];
          const nx = Mx[0] * a + Mx[4] * b + Mx[8] * c, ny = Mx[1] * a + Mx[5] * b + Mx[9] * c, nz = Mx[2] * a + Mx[6] * b + Mx[10] * c, l = Math.hypot(nx, ny, nz) || 1;
          nor[o] = nx / l; nor[o + 1] = ny / l; nor[o + 2] = nz / l;
        }
      }
      // update(…, true) — PlayCanvas перераховує AABB з позицій (Mesh.update): поза змінює межі, інакше камера відсікає
      // фігуру за AABB першого кадру (тінь лишалась, фігури не було)
      mesh.setPositions(pos); mesh.setNormals(nor); mesh.update(pc.PRIMITIVE_TRIANGLES, true);
    };
    return { mesh, pose };
  };
  const fig = posedMesh(Object.keys(figP)), arms = posedMesh(['armL', 'armR']);
  const figNode = new pc.GraphNode('фігура'); G.root.addChild(figNode);
  // фігура: видима — у World (без тіні), тінь — завжди окремим екземпляром у шарі «Тіні» (камера його не бачить): у першій
  // особі й з камерою впритул фігури не видно, а тінь лишається
  const figMI = new pc.MeshInstance(fig.mesh, mats.fig, figNode), figSh = new pc.MeshInstance(fig.mesh, mats.fig, figNode);
  figMI.castShadow = false; figMI.visible = false; figSh.castShadow = true; figSh.visible = false;
  G.layers.world.addMeshInstances([figMI]); G.layers.shadow.addMeshInstances([figSh]);
  const armsMI = new pc.MeshInstance(arms.mesh, mats.fig, figNode);
  armsMI.castShadow = false; armsMI.visible = false;
  G.layers.arms.addMeshInstances([armsMI]);

  // ---- тіла: шаблон → меш і група екземплярів ----
  const tmpl = new Map();
  const group = (T) => {
    let g = tmpl.get(T);
    if (!g) {
      if (tmpl.size > 400) { for (const v of tmpl.values()) { v.inst.destroy(); v.mesh.destroy(); stats.gpuBytes -= v.bytes; } tmpl.clear(); }
      const idx = T.verts > 65535 ? new Uint32Array(T.verts) : new Uint16Array(T.verts);
      for (let i = 0; i < T.verts; i++) idx[i] = i;
      const mesh = floatMesh(G, { pos: T.p, nor: T.n, col: T.c, mat: T.m, idx });
      g = { mesh, inst: createInstances(G, mesh, mats.body), n: 0, buf: new Float32Array(16 * 16), bytes: T.verts * 32 };
      stats.gpuBytes += g.bytes;
      tmpl.set(T, g);
    }
    return g;
  };
  const m16 = new Float32Array(16);

  // ---- сховище регіонів ----
  // Всесвіти: 'd:n' → {regions: Map(rkey → Gr), slots: Map(sk → Gr), flora: Map(ck → Gr | null), added, drawn}.
  // Регіон Gr = {rx, ry, rz, R (регіон рушія), secs: Map(sk → E), fls: Map(ck → fslot), bb, seg, shDirty}; секція
  // E = {cx, cy, cz, L: [slot рівня 0, 1, 2 | null], n}; slot = {off, ns, nf, nc, loff, nl, bb, lbb}
  const unis = new Map(), fars = new Map();
  let frame = 0, texFor = null, tex = null;
  let budget = budgetFor(VIEW_R), over = false;
  const upQ = [], pend = new Set(), nL = [0, 0, 0], trim = [];
  let upHead = 0;
  const pkey = (kind, d, n, k) => `${kind}${d}:${n}:${k}`;
  let lastU = null;
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
    let Gr = U.regions.get(k);
    if (!Gr) {
      Gr = { rx, ry, rz, k, R: RG.create(rx, ry, rz), secs: new Map(), fls: new Map(), bb: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], seg: new Int32Array(NL * 2), shDirty: true, drawn: 0 };
      if (U !== shownU) RG.hide(Gr.R);
      U.regions.set(k, Gr);
    }
    return Gr;
  };
  const grow = (bb, b) => { if (b) for (let i = 0; i < 3; i++) { if (b[i] < bb[i]) bb[i] = b[i]; if (b[i + 3] > bb[i + 3]) bb[i + 3] = b[i + 3]; } };
  const dropRegion = (U, Gr) => {
    RG.drop(Gr.R);
    for (const [k, E] of Gr.secs) { U.slots.delete(k); for (let l = 0; l < 3; l++) if (E.L[l]) nL[l]--; }
    for (const [k, f] of Gr.fls) { U.flora.delete(k); for (const l of f.layers) SA.release(l); }
    U.regions.delete(Gr.k);
  };
  const emptyCheck = (U, Gr) => { if (!Gr.secs.size && !Gr.fls.size) dropRegion(U, Gr); };
  const removeSlot = (U, k, lod) => {
    const Gr = U.slots.get(k), E = Gr && Gr.secs.get(k), sl = E && E.L[lod];
    if (!sl) return;
    if (sl.off >= 0) RG.free(Gr.R, 'op', sl.off, sl.ns + sl.nf + sl.nc);
    if (sl.loff >= 0) RG.free(Gr.R, 'liq', sl.loff, sl.nl);
    E.L[lod] = null; E.n--; nL[lod]--;
    Gr.shDirty = true;
    if (!E.n) { Gr.secs.delete(k); U.slots.delete(k); emptyCheck(U, Gr); }
  };
  // далекі рослини стовпця можуть лежати в інших rz — брудні всі регіони стовпця регіонів
  const dirtyCol = (U, rx, ry) => { for (const Gr of U.regions.values()) if (Gr.rx === rx && Gr.ry === ry) Gr.shDirty = true; };
  const removeFlora = (U, k) => {
    const Gr = U.flora.get(k);
    U.flora.delete(k);
    if (!Gr) return;
    const f = Gr.fls.get(k);
    if (f.off >= 0) RG.free(Gr.R, 'fl', f.off, f.n);
    if (f.goff >= 0) RG.free(Gr.R, 'fl', f.goff, f.ng);
    for (const l of f.layers) SA.release(l);
    Gr.fls.delete(k);
    dirtyCol(U, Gr.rx, Gr.ry);
    emptyCheck(U, Gr);
  };
  const dropUni = (U) => { for (const Gr of [...U.regions.values()]) dropRegion(U, Gr); unis.delete(`${U.d}:${U.n}`); U.dead = true; };

  // Секція рівня q.lod в арени свого регіону (заміна — старі діапазони звільнити); повна без меша — порожня
  function putSection(d, n, k, q, mesh) {
    const U = uni(d, n, true), lod = q.lod || 0;
    removeSlot(U, k, lod);
    if (!mesh) return;
    const [rx, ry, rz] = regionOf(q.cx, q.cy, q.cz), Gr = region(U, rx, ry, rz);
    let E = Gr.secs.get(k);
    if (!E) { E = { cx: q.cx, cy: q.cy, cz: q.cz, L: [null, null, null], n: 0 }; Gr.secs.set(k, E); U.slots.set(k, Gr); }
    const nc = mesh.nc || 0, sl = { off: -1, ns: mesh.ns, nf: mesh.nf, nc, loff: -1, nl: mesh.nl, bb: mesh.bb, lbb: mesh.lbb };
    if (mesh.ns + mesh.nf + nc) sl.off = RG.put(Gr.R, 'op', mesh.op, mesh.ns + mesh.nf + nc);
    if (mesh.nl) sl.loff = RG.put(Gr.R, 'liq', mesh.liq, mesh.nl);
    if (sl.off < 0) sl.ns = sl.nf = sl.nc = 0;
    if (sl.loff < 0) sl.nl = 0;
    grow(Gr.bb, mesh.bb); grow(Gr.bb, mesh.lbb); RG.setBounds(Gr.R, Gr.bb);
    E.L[lod] = sl; E.n++; nL[lod]++;
    Gr.shDirty = true;
    U.added = frame; U.at = performance.now();
  }
  // Рослини зблизька стовпця (великі й каміння — fl, малі спрайтами — gr); порожні — позначка null (є, малювати нічого).
  // Спрайти стовпця — в атлас; у вершинах трави номер спрайта стовпця (байт z нормалі) → шар атласу
  function putFlora(d, n, k, q, data, mesh) {
    const U = uni(d, n, true);
    removeFlora(U, k);
    if (!mesh.n && !mesh.ng) { U.flora.set(k, null); return; }
    const [rx, ry] = regionOf(q.cx, q.cy, 0), Gr = region(U, rx, ry, data.rz);
    const off = mesh.n ? RG.put(Gr.R, 'fl', mesh.fl, mesh.n) : -1, layers = data.sprites.map((sp) => SA.acquire(sp.key, sp.data));
    let goff = -1;
    if (mesh.ng) {
      const i8 = new Int8Array(mesh.gr);
      for (let j = 0; j < mesh.ng; j++) { const l = layers[i8[j * 16 + 10] + 127]; i8[j * 16 + 10] = (l < 0 ? 0 : l) - 127; }
      goff = RG.put(Gr.R, 'fl', mesh.gr, mesh.ng);
    }
    Gr.fls.set(k, { cx: q.cx, cy: q.cy, off, n: off < 0 ? 0 : mesh.n, goff, ng: goff < 0 ? 0 : mesh.ng, layers, bb: mesh.bb });
    grow(Gr.bb, mesh.bb); RG.setBounds(Gr.R, Gr.bb);
    U.flora.set(k, Gr);
    dirtyCol(U, rx, ry);
    U.added = frame; U.at = performance.now();
  }

  // ---- пам'ять: звільнення, бюджет, стиснення арен (раз на 60 кадрів) ----
  const horiz = (Gr, t) => {
    const ox = Gr.rx * RW - t[0], oy = Gr.ry * RW - t[1];
    return Math.hypot(ox > 0 ? ox : ox + RW < 0 ? -(ox + RW) : 0, oy > 0 ? oy : oy + RW < 0 ? -(oy + RW) : 0);
  };
  const used = () => {
    let b = 0;
    for (const U of unis.values()) for (const Gr of U.regions.values()) for (const k in Gr.R.ar) b += Gr.R.ar[k].a.used * 16;
    stats.arenaUsed = b;
    return b + stats.gpuBytes;
  };
  // Арена зайнята менш ніж на чверть — у менший буфер (той самий меш), живі діапазони підряд
  const compact = (Gr) => {
    for (const kind of ['op', 'liq', 'fl']) {
      const A = Gr.R.ar[kind];
      if (!A || A.a.cap <= 65536 || A.a.used >= A.a.cap / 4) continue;
      let cap2 = 65536;
      while (cap2 < A.a.used * 1.5) cap2 *= 2;
      const live = [];
      if (kind === 'op') { for (const E of Gr.secs.values()) for (const sl of E.L) if (sl && sl.off >= 0) live.push([sl, 'off', sl.ns + sl.nf + sl.nc]); }
      else if (kind === 'liq') { for (const E of Gr.secs.values()) for (const sl of E.L) if (sl && sl.loff >= 0) live.push([sl, 'loff', sl.nl]); }
      else for (const f of Gr.fls.values()) { if (f.off >= 0) live.push([f, 'off', f.n]); if (f.goff >= 0) live.push([f, 'goff', f.ng]); }
      A.repack(cap2, live);
      Gr.shDirty = true;
    }
  };
  function maintain(U, t, rad, laws) {
    if (U) {
      for (const Gr of [...U.regions.values()]) if (horiz(Gr, t) > rad + 256) dropRegion(U, Gr);
      for (const [k2, Gr] of U.flora) if (Gr) { const f = Gr.fls.get(k2); if (colDist(f.cx, f.cy, t) > FLORA_NEAR + 96) removeFlora(U, k2); }
    }
    for (const V of [...unis.values()]) if (V !== U && !(V.d === laws.d && Math.abs(V.n - laws.n) <= 1) && frame - Math.max(V.drawn, V.added) > 600) dropUni(V);
    let b = used();
    if (b > budget) {
      const now = performance.now();
      for (const V of [...unis.values()].filter((V) => V !== U && now - V.at > 2000).sort((a, c) => a.at - c.at)) { if (b <= budget) break; dropUni(V); b = used(); }
      if (b > budget && U) for (const Gr of [...U.regions.values()].filter((Gr) => frame - (Gr.drawn || 0) >= 240).sort((a, c) => horiz(c, t) - horiz(a, t))) {
        if (b <= budget) break;
        dropRegion(U, Gr); b = used();
      }
    }
    over = stats.over = b > budget;
    for (const V of unis.values()) for (const Gr of V.regions.values()) compact(Gr);
  }

  // ---- кадр: діапазони за списками, без виділень ----
  const LF = Array.from({ length: NL }, () => new Int32Array(4096)), LC = Array.from({ length: NL }, () => new Int32Array(4096)), LN = new Int32Array(NL);
  const pushR = (j, segStart, off, n) => {
    const i = LN[j];
    if (i > segStart && LF[j][i - 1] + LC[j][i - 1] === off) { LC[j][i - 1] += n; return; }
    if (i >= LF[j].length) { const f = new Int32Array(i * 2), c = new Int32Array(i * 2); f.set(LF[j]); c.set(LC[j]); LF[j] = f; LC[j] = c; }
    LF[j][i] = off; LC[j][i] = n; LN[j] = i + 1;
  };
  const visRegs = [];
  // найдальша від цілі точка стовпця (ax, ay — кут стовпця від цілі)
  const colFar = (ax, ay) => Math.hypot(Math.max(Math.abs(ax), Math.abs(ax + CS)), Math.max(Math.abs(ay), Math.abs(ay + CS)));
  // Секція біля «вікна» (на екрані — у колі навколо гравця, ближче за нього) — матеріал з вирізом
  const cutHit = (m, cut, x0, y0, z0, x1, y1, z1) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity, dz = Infinity;
    for (let k = 0; k < 8; k++) {
      const p = project(m, [k & 1 ? x1 : x0, k & 2 ? y1 : y0, k & 4 ? z1 : z0], G.width, G.height);
      if (!p) return true;
      if (p[0] < a) a = p[0]; if (p[0] > c) c = p[0]; if (p[1] < b) b = p[1]; if (p[1] > d) d = p[1]; if (p[2] < dz) dz = p[2];
    }
    if (dz >= cut.depth) return false;
    const qx = Math.max(a, Math.min(cut.x, c)), qy = Math.max(b, Math.min(cut.y, d));
    return Math.hypot(qx - cut.x, qy - cut.y) < cut.r;
  };

  // Кидачі регіону: діапазони за блоками й видами (злиття сусідніх) і межі блоків (клітинки від кута регіону)
  const NS = NB * NB * 3, SF = Array.from({ length: NS }, () => new Int32Array(256)), SC = Array.from({ length: NS }, () => new Int32Array(256)), SN = new Int32Array(NS);
  const SB = new Float64Array(NB * NB * 6), blocks = Array.from({ length: NS }, () => ({ key: 0, kind: 0, F: null, C: null, nr: 0, bb: new Float64Array(6) }));
  const pushS = (i, off, n) => {
    const k = SN[i];
    if (k && SF[i][k - 1] + SC[i][k - 1] === off) { SC[i][k - 1] += n; return; }
    if (k >= SF[i].length) { const f = new Int32Array(k * 2), c = new Int32Array(k * 2); f.set(SF[i]); c.set(SC[i]); SF[i] = f; SC[i] = c; }
    SF[i][k] = off; SC[i][k] = n; SN[i] = k + 1;
  };
  const growB = (b, bb) => { const o = b * 6; for (let i = 0; i < 3; i++) { if (bb[i] < SB[o + i]) SB[o + i] = bb[i]; if (bb[i + 3] > SB[o + i + 3]) SB[o + i + 3] = bb[i + 3]; } };
  const blockOf = (Gr, cx, cy) => Math.floor((cx - Gr.rx * RS) / BS) + Math.floor((cy - Gr.ry * RS) / BS) * NB;
  function buildCasters(U, Gr, t) {
    SN.fill(0);
    for (let b = 0; b < NB * NB; b++) SB.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], b * 6);
    for (const E of Gr.secs.values()) {
      const sl = E.L[0];
      if (!sl || sl.off < 0 || !sl.bb) continue;
      const b = blockOf(Gr, E.cx, E.cy);
      const nf = colDist(E.cx, E.cy, t) < FLORA_NEAR && U.flora.has(ck(E.cx, E.cy)) ? 0 : sl.nf;   // тінь у смузі переходу — від повних
      if (sl.ns + nf) pushS(b * 3, sl.off, sl.ns + nf);
      if (sl.ns || nf) growB(b, sl.bb);
    }
    for (const f of Gr.fls.values()) {
      if ((!f.n && !f.ng) || colDist(f.cx, f.cy, t) >= FLORA_NEAR) continue;
      const b = blockOf(Gr, f.cx, f.cy);
      if (f.n) pushS(b * 3 + 2, f.off, f.n);
      if (f.ng) pushS(b * 3 + 1, f.goff, f.ng);
      growB(b, f.bb);
    }
    let n = 0;
    for (let b = 0; b < NB * NB; b++) for (const j of [0, 1, 2]) {
      const i = b * 3 + j;
      if (!SN[i]) continue;
      const B = blocks[n++];
      B.key = i; B.kind = j; B.F = SF[i]; B.C = SC[i]; B.nr = SN[i]; B.bb.set(SB.subarray(b * 6, b * 6 + 6));
    }
    RG.setCasters(Gr.R, blocks, n);
    Gr.shDirty = false;
  }

  // ---- плитки далечі ----
  const farEntry = (mesh) => {
    const Mf = floatMesh(G, mesh), node = new pc.GraphNode(), mi = new pc.MeshInstance(Mf, mats.far, node);
    mi.castShadow = false; mi.visible = false;
    G.root.addChild(node); G.layers.world.addMeshInstances([mi]);
    const bytes = mesh.pos.length * 4 + mesh.pos.length * 4 + mesh.pos.length / 3 * 4 + mesh.idx.byteLength;
    stats.gpuBytes += bytes;
    return { mi, node, bytes };
  };
  const dropFar = (e) => { G.layers.world.removeMeshInstances([e.mi]); e.mi.destroy(); G.root.removeChild(e.node); stats.gpuBytes -= e.bytes; };
  let farShown = [];

  // ---- небо: уніформи (sky-shader.js) через dev.scope ----
  const sc = dev.scope, U = (k) => sc.resolve(k);
  const SU = Object.fromEntries(['uZen', 'uHor', 'uMain', 'uDusk', 'uSun[0]', 'uSunCol[0]', 'uMoon[0]', 'uMoonCol[0]', 'uNSun', 'uNMoon', 'uDay', 'uStars', 'uCel', 'uRing', 'uRingCol', 'uPole', 'uCloud', 'uCloudCol', 'uFlash', 'uAur', 'uAurCol', 'eco_bakeK'].map((k) => [k, U(k)]));
  const sun4 = new Float32Array(12), sunC = new Float32Array(12), moon4 = new Float32Array(12), moonC = new Float32Array(12), cel = new Float32Array(9);
  const c3 = (v) => [v[0] / 255, v[1] / 255, v[2] / 255];
  function setSky(st, bakeK) {
    SU.uZen.setValue(c3(st.zenith)); SU.uHor.setValue(c3(st.horizon)); SU.uMain.setValue([...st.suns[0].dir]);
    SU.uDusk.setValue([...c3(st.duskCol), st.dusk]);
    sun4.fill(0); sunC.fill(0); moon4.fill(0); moonC.fill(0);
    st.suns.forEach((s, i) => { sun4.set([...s.dir, s.size], i * 4); sunC.set([...c3(s.col), s.bright], i * 4); });
    st.moons.forEach((m, i) => { moon4.set([...m.dir, m.size], i * 4); moonC.set(c3(m.col), i * 4); });
    SU['uSun[0]'].setValue(sun4); SU['uSunCol[0]'].setValue(sunC); SU['uMoon[0]'].setValue(moon4); SU['uMoonCol[0]'].setValue(moonC);
    SU.uNSun.setValue(st.suns.length); SU.uNMoon.setValue(st.moons.length);
    SU.uDay.setValue(st.day); SU.uStars.setValue([st.stars, st.starHue]);
    cel.set(st.cel); SU.uCel.setValue(cel);
    const rg = st.rings;
    SU.uRing.setValue([rg ? rg.r0 : 0, rg ? rg.r0 + rg.w : 0, rg ? rg.alpha : 0, rg ? rg.bands : 0]);
    SU.uRingCol.setValue(rg ? c3(rg.col) : [0, 0, 0]); SU.uPole.setValue([...st.pole]);
    const cl = st.cloud || { k: 0, off: [0, 0], dark: 0, col: [255, 255, 255] };
    SU.uCloud.setValue([cl.k, cl.off[0], cl.off[1], cl.dark]); SU.uCloudCol.setValue(c3(cl.col)); SU.uFlash.setValue(st.flash || 0);
    const au = st.aurora || { dir: [0, 1], k: 0, t: 0, col: [0, 0, 0] };
    SU.uAur.setValue([au.dir[0], au.dir[1], au.k, au.t % 10000]); SU.uAurCol.setValue(c3(au.col));
    SU.eco_bakeK.setValue(bakeK);
  }
  const lin = (c) => (c / 255) ** 2.2, lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const sig = new Float32Array(12);

  let cullOn = true, shownU = null, lastCol = '', lastRad = 0, lawsKey = null;
  const M4 = new pc.Mat4(), Q = new pc.Quat(), V3 = new pc.Vec3(), engRegs = [];
  let linesPC = new Float32Array(0);
  const underBg = new pc.Color(), BLACK = new pc.Color(0, 0, 0);
  const dirsBuf = [], cutF = new Float32Array(4), cut2 = new Float32Array(4), cut3 = new Float32Array(2), eyePC = new Float32Array(3), tgtPC = new Float32Array(3), wind4 = new Float32Array(4), fade2 = new Float32Array(2), thin2 = new Float32Array(2), xfade2 = new Float32Array(2);
  const viewC = { m: null, eye: null, ud: null, t: null };
  let next = null;
  G.onFrame(function loop(ts) { const f = next; next = null; if (f) f(ts); G.onFrame(loop); });

  const R = {
    get gpuMs() { return G.R.gpuMs; }, get gpuPass() { return G.R.gpuPass; }, get cpuRenderMs() { return G.R.cpuRenderMs; },
    get gpuHist() { return G.R.gpuHist; }, get gpuHistI() { return G.R.gpuHistI; }, set gpuHistI(v) { G.R.gpuHistI = v; },
    stats,
    get width() { return G.width; }, get height() { return G.height; },
    get cullOn() { return cullOn; },
    setCull(on) { cullOn = !!on; for (const k of CULLED) { mats[k].cull = cullOn ? pc.CULLFACE_BACK : pc.CULLFACE_NONE; mats[k].update(); } },
    get info() { return { ...G.info, shadows: LG.quality, lights: LG.info() }; },
    app,
  };

  return {
    R, G, LG,
    raf(f) { next = f; },
    resize() {},                                   // розмір полотна PlayCanvas відстежує сам
    setShadows(q) { LG.setQuality(q); return LG.quality; },
    // Прогрів шейдерів (кількість напрямлених світел 3, 2, 1; поточний тип тіней) — за екраном завантаження
    warmUp(cb) { LG.warmUp(() => { lawsKey = null; if (cb) cb(); }); },
    setShelter(buf, x0, y0) { setShelter(G, buf, x0, y0); },
    addSection(d, n, k, q, mesh) { pend.add(pkey('s' + (q.lod || 0), d, n, k)); upQ.push(['s', d, n, k, q, null, mesh]); },
    addFlora(d, n, k, q, data, mesh) { pend.add(pkey('f', d, n, k)); upQ.push(['f', d, n, k, q, data, mesh]); },
    pump(bytes = UP_BYTES) {
      let b = 0, i = 0;
      while (upHead < upQ.length && b < bytes && i < UP_ITEMS) {
        const [kind, d, n, k, q, data, mesh] = upQ[upHead];
        upQ[upHead++] = null;
        pend.delete(pkey(kind === 's' ? 's' + (q.lod || 0) : kind, d, n, k));
        if (kind === 's') { putSection(d, n, k, q, mesh); b += mesh ? (mesh.ns + mesh.nf + (mesh.nc || 0) + mesh.nl) * 16 : 0; }
        else { putFlora(d, n, k, q, data, mesh); b += (mesh.n + (mesh.ng || 0)) * 16; }
        i++;
      }
      if (upHead === upQ.length) { upQ.length = 0; upHead = 0; } else if (upHead > 4096) { upQ.splice(0, upHead); upHead = 0; }
      SA.flush();
    },
    setBudget(bytes) { budget = bytes; },
    get overBudget() { return over; },
    addFar(key, data, mesh) {
      const e = fars.get(key);
      if (e) dropFar(e);
      fars.set(key, { ...farEntry(mesh.solid), used: frame });
      if (fars.size > KEEP_FAR) {
        const old = [...fars].sort((a, b) => a[1].used - b[1].used).slice(0, fars.size - KEEP_FAR * 0.9);
        for (const [k2, e2] of old) { dropFar(e2); fars.delete(k2); }
        farShown = farShown.filter((f) => fars.has(f.key) && fars.get(f.key) === f.e);
      }
    },
    hasSection(d, n, k, lod = 0, queued = true) {
      const Un = uni(d, n), Gr = Un && Un.slots.get(k), E = Gr && Gr.secs.get(k);
      return (!!E && !!E.L[lod]) || (queued && pend.has(pkey('s' + lod, d, n, k)));
    },
    hasFlora(d, n, k) { const Un = uni(d, n); return (!!Un && Un.flora.has(k)) || pend.has(pkey('f', d, n, k)); },
    hasFar: (key) => fars.has(key),
    clear() {
      upQ.length = 0; upHead = 0; pend.clear();
      for (const Un of [...unis.values()]) dropUni(Un);
      for (const e of fars.values()) dropFar(e);
      fars.clear(); farShown = [];
      shownU = null;
    },
    get meshCount() { return nL[0] + nL[1] + nL[2]; },
    get lodCounts() { return nL; },

    // Камера на цей кадр: матриця, радіус видимого, туман. dist — відстань до ока в третій особі
    view(camera, target, dist) {
      const v = viewProj(camera, G.width, G.height, dist), iso = camera.mode === ISO;
      const rad = iso ? isoRadius(camera, G.width, G.height, ZR_ISO, target[2]) : VIEW_R;
      return { ...v, rad, fog: iso ? null : [0.3 * FAR_R, 0.97 * FAR_R] };
    },

    // st: {camera, target, view, laws, clock, weather ({W, loc}), rain ({x0, y0}), far, bodies, skyOpen(x, y, z) — AO неба тіл,
    // me {x, y, z, yaw, swim, anim, ao — AO неба фігури}}.
    // Повертає стан неба (sky.js) — для HUD
    draw(st) {
      frame++;
      // числа минулого кадру: виклики, тіні (кидачі й трикутники, що пішли в каскади)
      stats.up = stats.upBytes; stats.upBytes = 0; stats.draws = G.R.draws;
      let shTris = 0, shDraws = 0;
      for (const s of LG.slots) if (s.on && s.l.castShadows) for (let c = 0; c < s.l.numCascades; c++) {
        const rd = s.l.light.getRenderData(cam.camera, c);
        for (const m of rd.visibleCasters) { shDraws++; shTris += (m.shV ?? m.mesh.primitive[0].count) / 3; }
      }
      stats.shTris = shTris; stats.shDraws = shDraws;

      const { target: t, view, laws } = st, sk = skyState(laws, st.clock || 0), wt = st.weather;
      if (wt) applyWeather(sk, laws, wt.W, st.clock || 0);
      const vk = sk.visK ?? 1, iso = st.camera.mode === ISO, first = st.camera.mode === FIRST, lodOn = LOD_ON && !iso;
      const me = st.me, m = view.m, b = basis(st.camera);
      const tk = `${laws.d}:${laws.n}:${laws.ds}`;
      // новий всесвіт: текстури (sRGB — правило PlayCanvas «Color textures must be sRGB»), прозорість рідини, слоти
      // напрямлених світел (сонць + місяців, не більше 3), розсіяне — запекти одразу
      const fresh = lawsKey !== tk;
      if (texFor !== tk) {
        texFor = tk;
        const all = texturesOf(laws), Ls = [];
        for (let i = 0; i < LAYERS; i++) Ls.push(all.subarray(i * TEX * TEX * 4, (i + 1) * TEX * TEX * 4));
        const t2 = new pc.Texture(dev, { width: TEX, height: TEX, arrayLength: LAYERS, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, anisotropy: 8, levels: [Ls] });
        M.setTextureArray(t2);
        if (tex) tex.destroy();
        tex = t2;
        M.setBlend(mats.liq, laws.liquid.alpha); M.setBlend(mats.liqR, laws.liquid.alpha);
      }
      const slots = Math.max(1, Math.min(3, laws.sky.suns.length + laws.sky.moons.length));
      if (fresh) { lawsKey = tk; LG.setDirectionalCount(slots); }
      const lt = (st.clock || 0) * (laws.phys ? laws.phys.time : 1) % 3000;

      // плаваючий початок (регіони, світла, плитки — на подію 'origin')
      if (G.setOrigin(t)) for (const f of farShown) f.e.node.setLocalPosition(f.x0 - G.O[0], f.y0 - G.O[1], 0);
      // камера: око й осі (basis: r — праворуч, up — угору, u — до ока) у PlayCanvas (x, z, y)
      const e = view.eye;
      camE.setPosition(G.toPC(t[0] + e[0], t[1] + e[1], t[2] + e[2], V3));
      M4.data.set([b.r[0], b.r[2], b.r[1], 0, b.up[0], b.up[2], b.up[1], 0, b.u[0], b.u[2], b.u[1], 0, 0, 0, 0, 1]);
      camE.setRotation(Q.setFromMat4(M4));
      if (iso) {
        if (cam.projection !== pc.PROJECTION_ORTHOGRAPHIC) cam.projection = pc.PROJECTION_ORTHOGRAPHIC;
        cam.orthoHeight = G.height / (2 * S * st.camera.zoom); cam.nearClip = 1; cam.farClip = 800;
      } else {
        if (cam.projection !== pc.PROJECTION_PERSPECTIVE) cam.projection = pc.PROJECTION_PERSPECTIVE;
        // ближня площина: кут її прямокутника (fov — по вертикалі) ближче до ока, ніж поверхня (CAM_R − 0,01, camera.js), —
        // інакше в тісноті площина зрізає стіну й у кадрі видно, що за нею; на дуже широкому екрані — ближче
        const th = Math.tan(fovOf(st.camera) / 2), kc = Math.sqrt(1 + th * th * (1 + (G.width / G.height) ** 2));
        cam.fov = fovOf(st.camera) / Math.PI * 180; cam.nearClip = Math.min(first ? 0.05 : 0.1, 0.9 * (CAM_R - 0.01) / kc); cam.farClip = FAR_R * 1.6;
      }

      // Світло: сонця й місяці — напрямлені (лінійні сили з законів, lightsOf); розсіяне — з неба (envAtlas), каліброване
      // так, щоб верх при сонці на REF_Z дав колір палітри; мінімум — емісією
      const Lt = lightsOf(sk, slots);
      for (let i = 0; i < slots; i++) {
        const l = Lt.dirs[i];
        LG.setDirectional(i, l ? { dir: l.dir, color: l.col, intensity: pcIntensity(l.k) } : null);
      }
      LG.setShadowDistance(iso ? 400 + view.rad : SHADOW_D);
      const bakeK = Lt.amb / Math.max(1e-4, 0.6 * lum(sk.zenith) + 0.4 * lum(sk.horizon));
      setSky(sk, bakeK);
      const cl = sk.cloud ? sk.cloud.k : 0, d0 = sk.suns[0].dir;
      sig.set([d0[0], d0[1], d0[2], ...c3(sk.zenith), ...c3(sk.horizon), sk.dusk, cl, Math.log2(bakeK + 1e-6) / 10]);
      sky.maybeBake(sig, fresh);
      // Туман (лінійний, PlayCanvas; колір — екранний, рушій сам переводить). Згори — без туману: глибина від ока ~400
      // однакова для всього, а лінійний туман PlayCanvas — за глибиною
      const F = scene.fog, under = st.under;
      if (under) {
        // око під рідиною: туман від ока до видимості рідини, колір — між поверхнею й глибиною рідини при денному світлі
        // (лава світиться сама); неба не видно — фон того самого кольору
        const lk = under.kind === L_LAVA ? 1 : 0.3 + 0.7 * Math.min(1, sk.lightK[1]), c = laws.pal.liquid, c2 = laws.pal.liquidDeep;
        F.type = pc.FOG_LINEAR; F.start = 0; F.end = liquidVis(under.alpha);
        F.color.set((c[0] + c2[0]) / 510 * lk, (c[1] + c2[1]) / 510 * lk, (c[2] + c2[2]) / 510 * lk);
        underBg.set(F.color.r, F.color.g, F.color.b, 1); cam.clearColor = underBg;
      } else if (view.fog) { F.type = pc.FOG_LINEAR; F.start = view.fog[0] * vk; F.end = view.fog[1] * vk; F.color.set(sk.fog[0] / 255, sk.fog[1] / 255, sk.fog[2] / 255); }
      else F.type = pc.FOG_NONE;
      if (G.layers.sky.enabled !== !under) { G.layers.sky.enabled = !under; if (!under) cam.clearColor = BLACK; }

      // Уніформи кадру: вітер, кривизна, ціль, шов, час, мінімум світла, око, розчинення, «вікно»
      const wk = wt ? Math.min(0.012, 0.09 / (Math.hypot(wt.W.wind[0], wt.W.wind[1]) + 1e-6)) : 0;
      wind4[0] = wt ? wt.W.wind[0] * wk : 0; wind4[1] = wt ? wt.W.wind[1] * wk : 0; wind4[2] = lt;
      tgtPC[0] = t[0] - G.O[0]; tgtPC[1] = t[2]; tgtPC[2] = t[1] - G.O[1];
      eyePC[0] = tgtPC[0] + e[0]; eyePC[1] = tgtPC[1] + e[2]; eyePC[2] = tgtPC[2] + e[1];
      const camD = Math.hypot(...e);
      thin2[0] = FLORA_THIN * (FLORA_NEAR - FLORA_FADE); thin2[1] = FLORA_NEAR - FLORA_FADE;   // трава й квіти рідшають до смуги переходу
      xfade2[0] = FLORA_NEAR - FLORA_FADE; xfade2[1] = FLORA_NEAR;
      // розчинення рослин біля ока й «вікно» крізь те, що закриває гравця, — лише в третій особі (згори — лише «вікно»)
      if (iso || first) { fade2[0] = -2; fade2[1] = -1; } else { fade2[0] = Math.min(1, camD * 0.3); fade2[1] = Math.max(2.5, camD * 0.65); }
      let cut = null;
      cut2[3] = 0;
      if (me && !first) {
        const pcx = me.x - G.O[0], pcy = me.z + 0.45, pcz = me.y - G.O[1];
        const d = Math.hypot(pcx - eyePC[0], pcy - eyePC[1], pcz - eyePC[2]) || 1;
        cutF[0] = pcx; cutF[1] = pcy; cutF[2] = pcz;
        if (iso) { cutF[3] = 0.7 * 1.35; cut3[0] = 0.7 * 1.6; cut2[0] = -b.u[0]; cut2[1] = -b.u[2]; cut2[2] = -b.u[1]; cut2[3] = 2; }
        else { cutF[3] = Math.cos(Math.atan(0.7 * 0.75 / d)); cut3[0] = Math.cos(Math.atan(0.7 * 2.4 / d)); cut2[3] = 1; }
        cut3[1] = me.z + 0.6;
        // секції для матеріалу з вирізом — за колом на екрані навколо гравця (вибір; виріз — у шейдері)
        const pt = [me.x - t[0], me.y - t[1], me.z + 0.45 - t[2]], p = project(m, pt, G.width, G.height);
        const q = p && project(m, [pt[0] + b.r[0] * 0.7, pt[1] + b.r[1] * 0.7, pt[2]], G.width, G.height);
        if (p && q) cut = { x: p[0], y: p[1], r: Math.hypot(q[0] - p[0], q[1] - p[1]) * (iso ? 1.6 : 2.4), depth: p[2] };
      }
      M.setFrame({ wind: wind4, curve: laws.phys ? 0.5 / laws.phys.planetR : 0, target: tgtPC, seam: SEAM, time: lt, minLight: Lt.min, eye: eyePC, fade: fade2, cut: cutF, cut2, cut3, thin: thin2, xfade: xfade2 });

      // Видимі регіони й діапазони в них
      const farOn = !!(st.far && st.far.length), rad = view.rad, Un = uni(laws.d, laws.n);
      LN.fill(0); visRegs.length = 0;
      if (Un !== shownU) {
        if (shownU && !shownU.dead) for (const Gr of shownU.regions.values()) RG.hide(Gr.R);
        if (Un) for (const Gr of Un.regions.values()) Gr.shDirty = true;
        shownU = Un;
      }
      const colK = `${Math.floor(t[0] / CS)},${Math.floor(t[1] / CS)}`;
      if (Un && (colK !== lastCol || rad !== lastRad)) { lastCol = colK; lastRad = rad; for (const Gr of Un.regions.values()) if (horiz(Gr, t) < FLORA_NEAR + 2 * CS) Gr.shDirty = true; }
      let tris = 0;
      if (Un) {
        Un.drawn = frame; Un.at = performance.now();
        for (const Gr of Un.regions.values()) {
          const ox = Gr.rx * RW - t[0], oy = Gr.ry * RW - t[1], oz = Gr.rz * RH - t[2];
          const nx = ox > 0 ? ox : ox + RW < 0 ? -(ox + RW) : 0, ny = oy > 0 ? oy : oy + RW < 0 ? -(oy + RW) : 0;
          Gr.vis = false;
          if (Math.hypot(nx, ny) > rad + 4) continue;
          const bb = Gr.bb;
          if (!(bb[0] <= bb[3]) || !aabbInView(m, ox + bb[0], oy + bb[1], oz + bb[2], ox + bb[3], oy + bb[4], oz + bb[5])) continue;
          Gr.inside = aabbInside(m, ox + bb[0], oy + bb[1], oz + bb[2], ox + bb[3], oy + bb[4], oz + bb[5]);
          Gr.dist = Math.hypot(nx, ny); Gr.ox = ox; Gr.oy = oy; Gr.oz = oz;
          visRegs.push(Gr); Gr.drawn = frame; Gr.vis = true;
        }
        visRegs.sort((a, c) => a.dist - c.dist);
        for (const Gr of visRegs) {
          const { ox, oy, oz, inside } = Gr, seg = Gr.seg;
          for (let j = 0; j < NL; j++) seg[j * 2] = LN[j];
          for (const [k, E] of Gr.secs) {
            const ax = E.cx * CS - t[0], ay = E.cy * CS - t[1], dn = colDist(E.cx, E.cy, t);
            if (dn > rad || (farOn && dn > SEAM)) continue;
            const want = lodOn ? lodOf(dn) : 0;
            let lod = want, sl = E.L[want];
            if (!sl) for (const l of FALLBACK[want]) if (E.L[l]) { lod = l; sl = E.L[l]; break; }
            if (!sl) continue;
            if (E.n > 1 && lod === want) for (let l = 0; l < 3; l++) if (l !== want && E.L[l] && !keepLod(dn, l)) trim.push(k, l);
            const ring = farOn && Math.hypot(Math.max(-ax, ax + CS), Math.max(-ay, ay + CS)) > SEAM;
            if (sl.off >= 0 && sl.bb) {
              const c = sl.bb;
              if (inside || aabbInView(m, ox + c[0], oy + c[1], oz + c[2], ox + c[3], oy + c[4], oz + c[5])) {
                // є повні рослини: стовпець увесь до смуги переходу — спрощених не малюємо, у смузі — проступають (objF)
                const fx = lod === 0 && dn < FLORA_NEAR && Un.flora.has(ck(E.cx, E.cy));
                const nf = fx && colFar(ax, ay) < FLORA_NEAR - FLORA_FADE ? 0 : sl.nf;
                const nc = lod > 0 && (lod !== want || dn < LOD_R[lod - 1] + LOD_CAP) ? sl.nc : 0;
                let j = ring ? L_RING : L_PLAIN;
                if (!ring && cut && (iso || dn <= camD + 8) && cutHit(m, cut, ox + c[0], oy + c[1], oz + c[2], ox + c[3], oy + c[4], oz + c[5])) j = L_CUT;
                if (sl.ns) pushR(j, seg[j * 2], sl.off, sl.ns);
                if (nc) pushR(j, seg[j * 2], sl.off + sl.ns + sl.nf, nc);
                if (nf) { const jo = fx ? L_OBJF : L_OBJ + j; pushR(jo, seg[jo * 2], sl.off + sl.ns, nf); }
              }
            }
            if (sl.loff >= 0 && sl.lbb) {
              const c = sl.lbb;
              if (inside || aabbInView(m, ox + c[0], oy + c[1], oz + c[2], ox + c[3], oy + c[4], oz + c[5])) pushR(ring ? L_LIQR : L_LIQ, seg[(ring ? L_LIQR : L_LIQ) * 2], sl.loff, sl.nl);
            }
          }
          for (const f of Gr.fls.values()) {
            if (!f.n && !f.ng) continue;
            if (colDist(f.cx, f.cy, t) >= FLORA_NEAR) continue;
            const c = f.bb;
            if (inside || aabbInView(m, ox + c[0], oy + c[1], oz + c[2], ox + c[3], oy + c[4], oz + c[5])) {
              if (f.n) pushR(L_FL, seg[L_FL * 2], f.off, f.n);
              if (f.ng) pushR(L_GR, seg[L_GR * 2], f.goff, f.ng);
            }
          }
          for (let j = 0; j < NL; j++) seg[j * 2 + 1] = LN[j];
        }
        // сітки регіонів: команди камери — видимі діапазони; кидачі — блоками (перебудова при змінах)
        for (const Gr of Un.regions.values()) {
          if (Gr.shDirty) buildCasters(Un, Gr, t);
          for (const k in KINDS) {
            const j = KINDS[k][2], a = Gr.vis ? Gr.seg[j * 2] : 0, z = Gr.vis ? Gr.seg[j * 2 + 1] : 0;
            tris += RG.setCamera(Gr.R, k, LF[j], LC[j], a, z) / 3;
          }
        }
      }
      // кидачі на кадр — лише ті, чия тінь може впасти в поле зору (regions.cullCasters)
      viewC.m = m; viewC.eye = e; viewC.ud = b.u; viewC.t = t;
      engRegs.length = 0;
      if (Un) for (const Gr of Un.regions.values()) engRegs.push(Gr.R);
      RG.cullCasters(engRegs, viewC, LG.dirs(dirsBuf), LG.locals());

      // Далечінь: плитки поверхні — лише за швом
      for (const s of farShown) s.e.mi.visible = false;
      farShown.length = 0;
      if (farOn) for (const f of st.far) {
        const fe = fars.get(f.key);
        if (!fe) continue;
        fe.used = frame; fe.node.setLocalPosition(f.x0 - G.O[0], f.y0 - G.O[1], 0); fe.mi.visible = true;
        farShown.push({ key: f.key, e: fe, x0: f.x0, y0: f.y0 });
        tris += fe.mi.mesh.primitive[0].count / 3;
      }
      // рівні, які вже не потрібні (є потрібний, за гістерезисом), — звільнити
      if (Un) for (let i = 0; i < trim.length; i += 2) removeSlot(Un, trim[i], trim[i + 1]);
      trim.length = 0;
      if (frame % 60 === 0) maintain(Un, t, rad, laws);

      // Тіла (ширяюче каміння): групи екземплярів за шаблоном; низ коробки — основа шаблону
      for (const g of tmpl.values()) g.n = 0;
      if (st.bodies) for (const bo of st.bodies) {
        const r = Math.max(bo.hx, bo.hy, bo.hz) * 2, x = (bo.ix ?? bo.x) - t[0], y = (bo.iy ?? bo.y) - t[1], z = (bo.iz ?? bo.z) - t[2];
        if (!aabbInView(m, x - r, y - r, z - r, x + r, y + r, z + r)) continue;
        const g = group(bo.T);
        if (g.buf.length < (g.n + 1) * 16) { const a = new Float32Array(g.buf.length * 2); a.set(g.buf); g.buf = a; }
        // rotZ(yaw) · rotX(tilt) · масштаб, як у старому шейдері екземплярів
        const c = Math.cos(bo.yaw), s = Math.sin(bo.yaw), ct = Math.cos(bo.tilt), stl = Math.sin(bo.tilt), k = bo.s;
        m16.set([c * k, s * k, 0, 0, -s * ct * k, c * ct * k, stl * k, 0, s * stl * k, -c * stl * k, ct * k, 0, bo.ix ?? bo.x, bo.iy ?? bo.y, (bo.iz ?? bo.z) - bo.hz, 1]);
        G.matToPC(m16, g.buf, g.n * 16);
        g.buf[g.n * 16 + 3] = st.skyOpen ? st.skyOpen(bo.ix ?? bo.x, bo.iy ?? bo.y, bo.iz ?? bo.z) : 1;   // AO неба тіла (у матриці там 0; chunks.js)
        g.n++;
      }
      for (const g of tmpl.values()) { g.inst.update(g.buf, g.n); tris += g.n * g.mesh.primitive[0].count / 3; }

      // Фігура (у першій особі й з камерою впритул — лише тінь, інакше око в голові); пристрій не світиться (рішення 10.10.2026).
      // Руки першої особи — у шарі «Руки» (поверх світу, глибина очищена)
      if (me) fig.pose(poseMatrices(me.anim, me.x - G.O[0], me.y - G.O[1], me.z, me.yaw));
      // AO неба фігури й рук — одне число (у float-мешах AO вершин немає): у печері й під навісом розсіяне світло неба гасне,
      // як на землі поруч
      if (me) { const ao = me.ao ?? 1; figMI.setParameter('eco_ao', ao); armsMI.setParameter('eco_ao', ao); }
      figSh.visible = !!me;
      figMI.visible = !!me && !first && (view.ortho || camD > 0.7);
      armsMI.visible = !!me && first;
      if (armsMI.visible) arms.pose(viewArms(me.anim, me, b, [t[0] + e[0] - G.O[0], t[1] + e[1] - G.O[1], t[2] + e[2]], G.width / G.height, fovOf(st.camera)));

      // ?dev: каркас зіткнень (відрізки в координатах світу, без перевірки глибини — видно й крізь поверхню)
      if (st.lines && st.lines.pos.length) {
        const P = st.lines.pos, out = linesPC.length >= P.length ? linesPC : (linesPC = new Float32Array(P.length * 2));
        for (let i = 0; i < P.length; i += 3) { out[i] = P[i] - G.O[0]; out[i + 1] = P[i + 2]; out[i + 2] = P[i + 1] - G.O[1]; }
        G.app.drawLineArrays(out.subarray(0, P.length), st.lines.col, false, G.layers.immediate);
      }

      // Опади й пил: частинки PlayCanvas, лише поточний тип; під дахом — не падають (карта укриттів)
      const loc = wt && wt.loc, want = loc && loc.type && st.rain && !st.under && PART[loc.type] ? loc.type : null;
      // вмикати лише при зміні: вимкнення знімає сітку частинок із шарів, увімкнення — додає назад
      for (const k in vols) if (vols[k].enabled !== (k === want)) vols[k].enabled = k === want;
      if (want) {
        const Qp = PART[want], v = volume(want), lk = 0.3 + 0.7 * Math.min(1, sk.lightK[1]);
        v.setPosition([t[0], t[1], t[2] + Qp.box[1] * 0.15]);
        const dr = loc.type === 'dust' ? 1 : 0.6;
        v.setVelocity(wt.W.wind[0] * dr, wt.W.wind[1] * dr, -Qp.fall);
        v.setColor(loc.type === 'dust' ? [...laws.pal.desert.map((c) => c / 255 * (0.35 + 0.65 * Math.min(1, sk.lightK[1]))), 0.55] : [Qp.col[0] * lk, Qp.col[1] * lk, Qp.col[2] * lk, Qp.col[3]]);
        v.setIntensity(Math.min(1, loc.k));
      }
      stats.tris = tris;
      return sk;
    },
  };
}
