// js/pc/render.js — прототип ?pc: той самий API, що в js/render.js, але кадр малює PlayCanvas 2.23.2 — на WebGL2 або WebGPU
// (?gpu=webgpu; пристрій — createGraphicsDevice + AppBase, як в офіційних прикладах). Регіони секцій —
// арени щільних вершин (один pc.Mesh на арену) і сітки регіону з командами multi-draw: камера — свої (видимі діапазони),
// тіні сонця — спільні (кидачі блоками, лише попереду й ближче за дальність тіней — cullShadow). Світло, тіні (каскади,
// PCF / PCSS), туман, гама й тональна компресія — PlayCanvas; своє — альбедо з масиву текстур, шов далечі, небо
// (js/pc/shaders.js, GLSL і WGSL). Не малює: тіла, опади, гойдання від вітру, розчинення біля ока, «вікно», LOD, кривизну
// планети, світіння лави, підсвічування фігури під час заряджання.
import * as pc from 'https://cdn.jsdelivr.net/npm/playcanvas@2.23.2/build/playcanvas.mjs';
import { DECL_PS, DIFFUSE_PS, SKY_VS, SKY_FS, DECL_WGSL, DIFFUSE_WGSL, SKY_VS_WGSL, SKY_FS_WGSL } from './shaders.js';
import { createAlloc } from '../arena.js';
import { CS } from '../gen/chunk.js';
import { SEA, MAX_AMP } from '../universe.js';
import { LEVEL, S } from '../iso.js';
import { figureParts } from '../gen/mesh.js';
import { poseMatrices } from '../anim.js';
import { invert } from '../mat.js';
import { skyState, applyWeather } from '../sky.js';
import { ISO, VIEW_R, FAR_R, SEAM, viewProj, isoRadius, basis, aabbInView, aabbInside, colDist } from '../camera.js';
import { regionOf, RS, RW, RH, PO, PQ } from '../gen/pack.js';
import { ck } from '../world.js';
import { texturesOf, TEX } from '../textures.js';
import { LAYERS } from '../gen/materials.js';

const ZR_ISO = [0, (SEA + MAX_AMP) * LEVEL + 6]; // згори радіус — по рельєфу з деревами
const KEEP_FAR = 1500;                         // плиток далечі в GPU
const ARENA0 = 32768, ARENA_MAX = 4194304;     // ємність арени регіону (вершин): початкова, найбільша
const UP_BYTES = 4 << 20, UP_ITEMS = 64;       // завантажень у GPU за кадр: байтів, мешів
const BODY_R = 200;
export { BODY_R };
export const budgetFor = (viewR) => Math.min(1.5e9, Math.max(256e6, Math.ceil(Math.PI * (viewR / 16 + 1) ** 2) * 2.2 * 110e3));
const NEAR = 44;                               // ближче (від цілі до центру чанка) — повні рослини; далі — спрощені
const rkey = (rx, ry, rz) => ((rx + 0x20000) * 0x40000 + (ry + 0x20000)) * 256 + (rz + 128);
// Списки діапазонів на кадр (як у js/render.js, без «вікна»): 1 — тверде, 2 — тверде на шві далечі, 3 — рідина, 4 — рідина
// на шві, 5 — рослини зблизька, 6 + j — далекі рослини й каміння секцій (пара до списку j)
const L_PLAIN = 1, L_RING = 2, L_LIQ = 3, L_LIQR = 4, L_FL = 5, L_OBJ = 6, NL = 9;
const S16 = 65535 / PQ;                        // u16 нормовано (0…1) → одиниці
// Сітки камери в регіоні: арена, матеріал, список кадру
const MK = {
  solid: { arena: 'op', mat: 'solid', list: L_PLAIN }, solidR: { arena: 'op', mat: 'solidR', list: L_RING },
  obj: { arena: 'op', mat: 'obj', list: L_OBJ + L_PLAIN }, objR: { arena: 'op', mat: 'objR', list: L_OBJ + L_RING },
  liq: { arena: 'liq', mat: 'liq', list: L_LIQ }, liqR: { arena: 'liq', mat: 'liqR', list: L_LIQR },
  fl: { arena: 'fl', mat: 'fl', list: L_FL },
};
// Кидачі тіней — окремі сітки в шарі «Тіні» (його бачить світло, не камера), по блоку BS×BS стовпців регіону: кожна зі своєю
// AABB, тож PlayCanvas сам відсікає кидачів для кожного каскаду (стовпець уздовж світла навколо частини піраміди камери,
// ShadowRendererDirectional.cull). Види: 0 — тверде разом з далекими рослинами й камінням секції (в арені вони поруч —
// один діапазон замість двох; матеріал без відсікання граней), 2 — рослини зблизька
const BS = 2, NB = RS / BS, SK = [['obj', 'op'], null, ['fl', 'fl']];
// Тіні — лише ближче SHADOW_D (глибина від камери вздовж погляду, як shadowDistance PlayCanvas; далі — без тіней). Шейдерпаки
// Minecraft (OptiFine / Iris, «Shadow Distance») — так само: типово ~128 блоків, кидачі далі не малюються
const SHADOW_D = 128;
// Тіні сонця — як в офіційних прикладах PlayCanvas (engine/examples graphics/shadow-cascades і shadow-soft): 4 каскади
// в одній карті 2048, розподіл 0,5, змішування 0,1, PCF3; зміщення 0,3 / 0,2; м'які — PCSS 16 / 16 семплів, penumbraFalloff 4;
// усі каскади щокадру (типово в прикладі й рушії). penumbraSize у PCSS напрямленого — частка глибини каскаду: 0,03 з
// прикладу (сцена 1000 одиниць) у нас розмиває, 0,01 — м'яка без сходинок.
// stagger (не типово) — дальні каскади рідше, як перемикач у прикладі: 1-й щокадру, 2-й раз на 5 кадрів, 3-й — на 10,
// 4-й — на 15; 'spread' — ті самі періоди з рознесеними фазами, true — фази з прикладу
const CASC = { castShadows: true, numCascades: 4, shadowResolution: 2048, cascadeDistribution: 0.5, cascadeBlend: 0.1, shadowBias: 0.3, normalOffsetBias: 0.2 };
const SHADOW = {                               // ?dev eco.shadows(назва | {властивості світла, stagger, casters})
  off: { castShadows: false },
  pcf3: { ...CASC, shadowType: pc.SHADOW_PCF3_32F, stagger: false, shadowDistance: SHADOW_D, casters: true },
  pcss: { ...CASC, shadowType: pc.SHADOW_PCSS_32F, shadowSamples: 16, shadowBlockerSamples: 16, penumbraSize: 0.01, penumbraFalloff: 4, stagger: false, shadowDistance: SHADOW_D, casters: true },
  // дешевші варіанти: PCF5 — ширше розмиття PCF (м'якший край без контактного твердіння), PCSS на 8 / 8 семплах
  pcf5: { ...CASC, shadowType: pc.SHADOW_PCF5_32F, stagger: false, shadowDistance: SHADOW_D, casters: true },
  pcss8: { ...CASC, shadowType: pc.SHADOW_PCSS_32F, shadowSamples: 8, shadowBlockerSamples: 8, penumbraSize: 0.01, penumbraFalloff: 4, stagger: false, shadowDistance: SHADOW_D, casters: true },
};

// gpu: 'webgpu' — WebGPU, а без нього — WebGL2 (createGraphicsDevice сам відкочується); інакше WebGL2: на еталонній машині
// на екрані (GTX 1660 Ti, Chrome 155, Linux, полотно 3840×2160) він швидший — гори на дальності 512 з PCF3: 161 проти
// 131 к/с (10.10.2026)
export async function createRenderer(canvas, { gpu } = {}) {
  const deviceTypes = gpu === 'webgpu' ? [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2] : [pc.DEVICETYPE_WEBGL2];
  const dev = await pc.createGraphicsDevice(canvas, { deviceTypes, antialias: true, alpha: false, powerPreference: 'high-performance' });
  dev.maxPixelRatio = Math.min(2, devicePixelRatio || 1);
  const ao = new pc.AppOptions();
  ao.graphicsDevice = dev;
  ao.componentSystems = [pc.CameraComponentSystem, pc.LightComponentSystem];
  ao.resourceHandlers = [];
  const app = new pc.AppBase(canvas);
  app.init(ao);
  app.setCanvasFillMode(pc.FILLMODE_NONE); app.setCanvasResolution(pc.RESOLUTION_AUTO);
  if (dev.gpuProfiler) dev.gpuProfiler.enabled = true;
  const layer = app.scene.layers.getLayerByName('World'), skyLayer = app.scene.layers.getLayerByName('Skybox');
  layer.opaqueSortMode = pc.SORTMODE_FRONT2BACK;
  const shLayer = new pc.Layer({ name: 'Тіні' });
  app.scene.layers.push(shLayer);
  // Наші (x, y, z; z — угору) → PlayCanvas (x − Ox, z, y − Oy): root — поворот −90° навколо X і масштаб (1, −1, 1);
  // O — плаваючий початок (кратний 1024): позиції вузлів рахуються в JS (float64) уже відносно O
  const root = new pc.GraphNode('світ'); root.setLocalEulerAngles(-90, 0, 0); root.setLocalScale(1, -1, 1); app.root.addChild(root);
  const O = [0, 0];
  const camE = new pc.Entity('камера');
  camE.addComponent('camera', { fov: 55, nearClip: 0.1, farClip: FAR_R * 1.6, gammaCorrection: pc.GAMMA_SRGB, toneMapping: pc.TONEMAP_NEUTRAL, clearColor: new pc.Color(0, 0, 0) });
  app.root.addChild(camE);
  const cam = camE.camera;
  const sunE = new pc.Entity('сонце');
  const { stagger: _s, shadowDistance: _d, casters: _c, ...PCSS0 } = SHADOW.pcss;
  sunE.addComponent('light', { type: 'directional', intensity: 1, shadowDistance: SHADOW_D, layers: [layer.id, shLayer.id], ...PCSS0 });
  app.root.addChild(sunE);
  const sun = sunE.light;
  app.scene.fog.type = pc.FOG_LINEAR;
  const FMT = new pc.VertexFormat(dev, [
    { semantic: pc.SEMANTIC_POSITION, components: 4, type: pc.TYPE_UINT16, normalize: true },
    { semantic: pc.SEMANTIC_NORMAL, components: 4, type: pc.TYPE_INT8, normalize: true },
    { semantic: pc.SEMANTIC_COLOR, components: 4, type: pc.TYPE_UINT8, normalize: true },
  ]);
  if (FMT.size !== 16 || FMT.elements[1].offset !== 8 || FMT.elements[2].offset !== 12) throw new Error('розкладка вершини PlayCanvas ≠ gen/pack.js');
  // Команди multi-draw; обхід помилки 2.23.2: у неіндексованого меша перша вершина множиться на розмір індексу (0)
  const md = (m, key, n) => { const c = m.setMultiDraw(key, n); if (c.impl && 'indexSizeBytes' in c.impl) c.impl.indexSizeBytes = 1; return c; };
  // Матеріали: стандартні PlayCanvas (світло, тіні, туман, гама — його), альбедо — наш шматок (масив текстур)
  const mats = {};
  const mkMat = (name, { cull = pc.CULLFACE_NONE, ring = '', blend = false } = {}) => {
    const m = new pc.StandardMaterial();
    m.diffuseVertexColor = true; m.vertexColorGamma = true; m.specular = new pc.Color(0, 0, 0); m.useMetalness = false;
    m.cull = cull;
    if (blend) { m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; }
    if (ring) m.setDefine(ring, true);
    const gl = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL), wg = m.getShaderChunks(pc.SHADERLANGUAGE_WGSL);
    gl.set('litUserDeclarationPS', DECL_PS); gl.set('diffusePS', DIFFUSE_PS);
    wg.set('litUserDeclarationPS', DECL_WGSL); wg.set('diffusePS', DIFFUSE_WGSL);
    m.shaderChunksVersion = '2.23';
    m.update();
    return (mats[name] = m);
  };
  mkMat('solid', { cull: pc.CULLFACE_BACK }); mkMat('solidR', { cull: pc.CULLFACE_BACK, ring: 'ECO_RING_IN' });
  mkMat('obj'); mkMat('objR', { ring: 'ECO_RING_IN' }); mkMat('fl'); mkMat('fig');
  mkMat('liq', { blend: true }); mkMat('liqR', { blend: true, ring: 'ECO_RING_IN' });
  mkMat('far', { cull: pc.CULLFACE_BACK, ring: 'ECO_RING_OUT' });
  const sc = dev.scope, uTarget = sc.resolve('eco_target'), uSeam = sc.resolve('eco_seam'), uTime = sc.resolve('eco_time');
  const tgt = new Float32Array(3);

  let cullOn = true;
  const R = {
    gpuMs: null, gpuPass: {}, cpuRenderMs: 0, gpuHist: new Float32Array(600), gpuHistI: 0,   // GPU кожного кадру (кільце)
    stats: { draws: 0, tris: 0, shTris: 0, up: 0, upBytes: 0, gpuBytes: 0, arenaBytes: 0, arenaUsed: 0, over: false },
    get width() { return canvas.clientWidth || innerWidth; }, get height() { return canvas.clientHeight || innerHeight; },
    setCull(on) {
      cullOn = !!on;
      for (const k of ['solid', 'solidR', 'far']) { mats[k].cull = cullOn ? pc.CULLFACE_BACK : pc.CULLFACE_NONE; mats[k].update(); }
    },
    get cullOn() { return cullOn; },
    setRainMap() {},
    app,                                           // для замірів і знімків (?dev)
    info: { device: dev.deviceType, multiDraw: dev.isWebGPU ? 'drawIndirect' : !!dev.extMultiDraw, floatRT: !!dev.textureFloatRenderable, floatFilter: !!dev.textureFloatFilterable },
  };

  // Кадр гри — з подією 'update' PlayCanvas (рендер іде одразу після неї)
  let next = null;
  app.on('update', () => { const f = next; next = null; if (f) f(app._time); });   // _time — мітка rAF цього такту (2.23.2)
  app.start();

  // ---- арени: одна арена — один pc.Mesh, усі сітки регіону посилаються на нього ----
  function makeArena(cap) {
    const A = { a: createAlloc(cap), mesh: new pc.Mesh(dev) };
    const alloc = (n) => { R.stats.arenaBytes += n * 16; return new pc.VertexBuffer(dev, FMT, n, { usage: pc.BUFFER_DYNAMIC }); };
    const bind = (vb) => {
      A.vb = vb; A.u8 = new Uint8Array(vb.lock()); A.mesh.vertexBuffer = vb;
      A.mesh.primitive[0] = { type: pc.PRIMITIVE_TRIANGLES, base: 0, baseVertex: 0, count: vb.numVertices, indexed: false };
    };
    const done = (old) => { old.destroy(); R.stats.arenaBytes -= old.numVertices * 16; };
    bind(alloc(cap));
    A.vb.unlock();
    A.put = (off, u8) => { A.u8.set(u8, off * 16); A.vb.unlock(off * 16, u8.byteLength); R.stats.upBytes += u8.byteLength; };
    A.grow = (cap2) => { const old = A.vb, u8 = A.u8; bind(alloc(cap2)); A.u8.set(u8); A.vb.unlock(); done(old); A.a.grow(cap2); };
    // стиснення на місці (меш той самий — сітки регіону не чіпаємо): живі діапазони підряд, власникам — нові зсуви
    A.repack = (cap2, live) => {
      const old = A.vb, u8 = A.u8; bind(alloc(cap2)); A.a = createAlloc(cap2);
      for (const [o, f, n] of live) { const off = A.a.alloc(n); A.u8.set(u8.subarray(o[f] * 16, (o[f] + n) * 16), off * 16); o[f] = off; }
      A.vb.unlock(); done(old);
    };
    A.drop = () => { R.stats.arenaBytes -= A.vb.numVertices * 16; if (A.mesh.vertexBuffer) A.mesh.destroy(); };   // меш міг знищити останній MeshInstance
    return A;
  }

  // Всесвіти: 'd:n' → {regions: Map(rkey → G), slots: Map(sk → G), flora: Map(ck → G | null), added, drawn}.
  // Регіон G = {rx, ry, rz, op, liq, fl (арени, ліниво), secs: Map(sk → E), fls: Map(ck → fslot), bb, seg, mi (сітки), node};
  // секція E = {cx, cy, cz, L: [slot рівня 0, …], n}; slot = {off, ns, nf, nc, loff, nl, bb, lbb}
  const unis = new Map(), fars = new Map();     // плитки далечі: ключ → {mi, node, used}
  let frame = 0, texFor = null, tex = null;
  let budget = budgetFor(VIEW_R), over = false;
  const upQ = [], pend = new Set(), nL = [0, 0, 0];
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
  const place = (G) => G.node.setLocalPosition(G.rx * RW - PO[0] - O[0], G.ry * RW - PO[1] - O[1], G.rz * RH - PO[2]);
  // межі мешів регіону — у локальних меша: (r + PO) / S16 (u16 нормовано)
  const syncBB = (G) => {
    const b = G.bb;
    if (!(b[0] <= b[3])) return;
    for (const A of [G.op, G.liq, G.fl]) if (A) {
      const bb = new pc.BoundingBox();
      bb.setMinMax(new pc.Vec3((b[0] + PO[0]) / S16, (b[1] + PO[1]) / S16, (b[2] + PO[2]) / S16), new pc.Vec3((b[3] + PO[0]) / S16, (b[4] + PO[1]) / S16, (b[5] + PO[2]) / S16));
      A.mesh.aabb = bb;
    }
  };
  const region = (U, rx, ry, rz) => {
    const k = rkey(rx, ry, rz);
    let G = U.regions.get(k);
    if (!G) {
      G = { rx, ry, rz, k, op: null, liq: null, fl: null, secs: new Map(), fls: new Map(), bb: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], seg: new Int32Array(NL * 2), mi: {}, sh: new Map(), shDirty: true, node: new pc.GraphNode() };
      G.node.setLocalScale(S16, S16, S16); root.addChild(G.node); place(G);
      U.regions.set(k, G);
    }
    return G;
  };
  const grow = (bb, b) => { if (b) for (let i = 0; i < 3; i++) { if (b[i] < bb[i]) bb[i] = b[i]; if (b[i + 3] > bb[i + 3]) bb[i + 3] = b[i + 3]; } };
  const put = (G, kind, buf, n) => {
    let A = G[kind];
    if (!A) { let c = ARENA0; while (c < n) c *= 2; A = G[kind] = makeArena(c); }
    let off = A.a.alloc(n);
    while (off < 0 && A.a.cap < ARENA_MAX) { A.grow(Math.min(ARENA_MAX, A.a.cap * 2)); off = A.a.alloc(n); }
    if (off < 0) return -1;
    A.put(off, new Uint8Array(buf, 0, n * 16));
    return off;
  };
  const dropRegion = (U, G) => {
    for (const k in G.mi) { const m = G.mi[k]; layer.removeMeshInstances([m]); m.destroy(); }
    for (const m of G.sh.values()) { shLayer.removeMeshInstances([m]); m.destroy(); }
    G.mi = {}; G.sh.clear();
    for (const A of [G.op, G.liq, G.fl]) if (A) A.drop();
    root.removeChild(G.node);
    for (const [k, E] of G.secs) { U.slots.delete(k); for (let l = 0; l < 3; l++) if (E.L[l]) nL[l]--; }
    for (const k of G.fls.keys()) U.flora.delete(k);
    U.regions.delete(G.k);
  };
  const emptyCheck = (U, G) => { if (!G.secs.size && !G.fls.size) dropRegion(U, G); };
  const removeSlot = (U, k, lod) => {
    const G = U.slots.get(k), E = G && G.secs.get(k), sl = E && E.L[lod];
    if (!sl) return;
    if (sl.off >= 0) G.op.a.free(sl.off, sl.ns + sl.nf + sl.nc);
    if (sl.loff >= 0) G.liq.a.free(sl.loff, sl.nl);
    E.L[lod] = null; E.n--; nL[lod]--;
    G.shDirty = true;
    if (!E.n) { G.secs.delete(k); U.slots.delete(k); emptyCheck(U, G); }
  };
  // далекі рослини стовпця можуть лежати в інших rz — брудні всі регіони стовпця регіонів
  const dirtyCol = (U, rx, ry) => { for (const G of U.regions.values()) if (G.rx === rx && G.ry === ry) G.shDirty = true; };
  const removeFlora = (U, k) => {
    const G = U.flora.get(k);
    U.flora.delete(k);
    if (!G) return;
    const f = G.fls.get(k);
    if (f.off >= 0) G.fl.a.free(f.off, f.n);
    G.fls.delete(k);
    dirtyCol(U, G.rx, G.ry);
    emptyCheck(U, G);
  };
  const dropUni = (U) => { for (const G of [...U.regions.values()]) dropRegion(U, G); unis.delete(`${U.d}:${U.n}`); U.dead = true; };

  function putSection(d, n, k, q, mesh) {
    const U = uni(d, n, true), lod = q.lod || 0;
    removeSlot(U, k, lod);
    if (!mesh) return;
    const [rx, ry, rz] = regionOf(q.cx, q.cy, q.cz), G = region(U, rx, ry, rz);
    let E = G.secs.get(k);
    if (!E) { E = { cx: q.cx, cy: q.cy, cz: q.cz, L: [null, null, null], n: 0 }; G.secs.set(k, E); U.slots.set(k, G); }
    const nc = mesh.nc || 0, sl = { off: -1, ns: mesh.ns, nf: mesh.nf, nc, loff: -1, nl: mesh.nl, bb: mesh.bb, lbb: mesh.lbb };
    if (mesh.ns + mesh.nf + nc) sl.off = put(G, 'op', mesh.op, mesh.ns + mesh.nf + nc);
    if (mesh.nl) sl.loff = put(G, 'liq', mesh.liq, mesh.nl);
    if (sl.off < 0) sl.ns = sl.nf = sl.nc = 0;
    if (sl.loff < 0) sl.nl = 0;
    grow(G.bb, mesh.bb); grow(G.bb, mesh.lbb);
    E.L[lod] = sl; E.n++; nL[lod]++;
    G.shDirty = true;
    syncBB(G);
    U.added = frame; U.at = performance.now();
  }
  function putFlora(d, n, k, q, data, mesh) {
    const U = uni(d, n, true);
    removeFlora(U, k);
    if (!mesh.n) { U.flora.set(k, null); return; }
    const [rx, ry] = regionOf(q.cx, q.cy, 0), G = region(U, rx, ry, data.rz);
    const off = put(G, 'fl', mesh.fl, mesh.n);
    G.fls.set(k, { cx: q.cx, cy: q.cy, off, n: off < 0 ? 0 : mesh.n, bb: mesh.bb });
    grow(G.bb, mesh.bb);
    U.flora.set(k, G);
    dirtyCol(U, rx, ry);
    syncBB(G);
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
  const compact = (G) => {
    for (const kind of ['op', 'liq', 'fl']) {
      const A = G[kind];
      if (!A || A.a.cap <= 65536 || A.a.used >= A.a.cap / 4) continue;
      let cap2 = 65536;
      while (cap2 < A.a.used * 1.5) cap2 *= 2;
      const live = [];
      if (kind === 'op') { for (const E of G.secs.values()) for (const sl of E.L) if (sl && sl.off >= 0) live.push([sl, 'off', sl.ns + sl.nf + sl.nc]); }
      else if (kind === 'liq') { for (const E of G.secs.values()) for (const sl of E.L) if (sl && sl.loff >= 0) live.push([sl, 'loff', sl.nl]); }
      else for (const f of G.fls.values()) if (f.off >= 0) live.push([f, 'off', f.n]);
      A.repack(cap2, live);
      G.shDirty = true;
    }
  };
  function maintain(U, t, rad, laws) {
    if (U) {
      for (const G of [...U.regions.values()]) if (horiz(G, t) > rad + 256) dropRegion(U, G);
      for (const [k2, G] of U.flora) if (G) { const f = G.fls.get(k2); if (Math.hypot(f.cx * CS + 8 - t[0], f.cy * CS + 8 - t[1]) > NEAR + 96) removeFlora(U, k2); }
    }
    for (const V of [...unis.values()]) if (V !== U && !(V.d === laws.d && Math.abs(V.n - laws.n) <= 1) && frame - Math.max(V.drawn, V.added) > 600) dropUni(V);
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

  // ---- сітки регіону й команди multi-draw ----
  function makeMI(G, k) {
    const K = MK[k], m = new pc.MeshInstance(G[K.arena].mesh, mats[K.mat], G.node);
    m.castShadow = false; m.visible = false;
    m.cam = md(m, cam, 64); m.camCap = 64;
    layer.addMeshInstances([m]);
    return (G.mi[k] = m);
  }
  // діапазони F/C [a, b) у команди w ('cam' — камери, 'sh' — спільні: тіньові каскади); → вершин
  function fill(m, w, F, C, a, b) {
    const n = b - a;
    if (n > m[w + 'Cap']) { let c = m[w + 'Cap']; while (c < n) c *= 2; m[w + 'Cap'] = c; m[w] = md(m, w === 'cam' ? cam : null, c); }
    let v = 0;
    for (let i = 0; i < n; i++) { m[w].add(i, C[a + i], 1, F[a + i]); v += C[a + i]; }
    m[w].update(n);
    return v;
  }
  // Кидачі регіону: діапазони за блоками й видами (злиття сусідніх) і межі блоків (локальні регіону)
  const NS = NB * NB * 3, SF = Array.from({ length: NS }, () => new Int32Array(256)), SC = Array.from({ length: NS }, () => new Int32Array(256)), SN = new Int32Array(NS);
  const SB = new Float64Array(NB * NB * 6);
  const pushS = (i, off, n) => {
    const k = SN[i];
    if (k && SF[i][k - 1] + SC[i][k - 1] === off) { SC[i][k - 1] += n; return; }
    if (k >= SF[i].length) { const f = new Int32Array(k * 2), c = new Int32Array(k * 2); f.set(SF[i]); c.set(SC[i]); SF[i] = f; SC[i] = c; }
    SF[i][k] = off; SC[i][k] = n; SN[i] = k + 1;
  };
  const growB = (b, bb) => { const o = b * 6; for (let i = 0; i < 3; i++) { if (bb[i] < SB[o + i]) SB[o + i] = bb[i]; if (bb[i + 3] > SB[o + i + 3]) SB[o + i + 3] = bb[i + 3]; } };
  const blockOf = (G, cx, cy) => Math.floor((cx - G.rx * RS) / BS) + Math.floor((cy - G.ry * RS) / BS) * NB;
  function buildShadow(U, G, t) {
    SN.fill(0);
    for (let b = 0; b < NB * NB; b++) SB.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], b * 6);
    for (const E of G.secs.values()) {
      const sl = E.L[0];
      if (!sl || sl.off < 0 || !sl.bb) continue;
      const b = blockOf(G, E.cx, E.cy);
      const dc = Math.hypot(E.cx * CS + CS / 2 - t[0], E.cy * CS + CS / 2 - t[1]);
      const nf = dc < NEAR && U.flora.has(ck(E.cx, E.cy)) ? 0 : sl.nf;   // як у кадрі: зблизька — повні рослини замість спрощених
      if (sl.ns + nf) pushS(b * 3, sl.off, sl.ns + nf);
      if (sl.ns || nf) growB(b, sl.bb);
    }
    for (const f of G.fls.values()) {
      if (f.off < 0 || !f.n || Math.hypot(f.cx * CS + CS / 2 - t[0], f.cy * CS + CS / 2 - t[1]) >= NEAR) continue;
      const b = blockOf(G, f.cx, f.cy);
      pushS(b * 3 + 2, f.off, f.n); growB(b, f.bb);
    }
    for (let b = 0; b < NB * NB; b++) for (let j = 0; j < 3; j++) {
      if (!SK[j]) continue;
      const i = b * 3 + j, key = i, [mk, arena] = SK[j];
      let m = G.sh.get(key);
      if (!SN[i] || !G[arena]) { if (m) { m.visible = false; m.shV = 0; } continue; }
      if (!m) {
        m = new pc.MeshInstance(G[arena].mesh, mats[mk], G.node);
        m.castShadow = true; m.sh = md(m, null, 16); m.shCap = 16; m.kind = j; m.b = new Float64Array(6);
        shLayer.addMeshInstances([m]);
        G.sh.set(key, m);
      }
      const o = b * 6, bb = new pc.BoundingBox();
      bb.setMinMax(new pc.Vec3((SB[o] + PO[0]) / S16, (SB[o + 1] + PO[1]) / S16, (SB[o + 2] + PO[2]) / S16), new pc.Vec3((SB[o + 3] + PO[0]) / S16, (SB[o + 4] + PO[1]) / S16, (SB[o + 5] + PO[2]) / S16));
      m.setCustomAabb(bb);
      m.b.set(SB.subarray(o, o + 6));                 // межі блоку в клітинках від кута регіону — для cullShadow
      m.shV = fill(m, 'sh', SF[i], SC[i], 0, SN[i]);
      m.visible = false;                              // вмикає cullShadow щокадру
    }
    G.shDirty = false;
  }

  // Кидачі тіней на кадр (усе інше PlayCanvas не бачить). Кидач потрібен, лише якщо його тінь може впасти в зріз піраміди
  // камери до глибини shD (там PlayCanvas малює тіні): коробка блоку, витягнута вздовж світла, перетинає зріз. Перевірка —
  // площинами зрізу, повернутими від сонця (n·L ≤ 0: уздовж світла ними не вийти), — зріз, «розтягнутий до світла», як
  // у Cyberpunk 2077 (SIGGRAPH 2021, «Shadows Optimizations in Cyberpunk 2077»). Плюс межа відстані від ока (cap): у
  // шейдерпаках Minecraft кидачі далі за Shadow Distance не малюються — так само й тут (тіні далеких гір не падають).
  // Без цього каскад PlayCanvas бере все в нескінченному стовпці вздовж світла: ~2 млн трикутників у дальньому каскаді
  const shOn = [], PL = new Float64Array(24);
  function cullShadow(U, m, eye, ud, L, t, shD) {
    for (const s of shOn) s.visible = false;
    shOn.length = 0;
    if (!U || !sun.castShadows) return;
    let np = 0;
    const plane = (a, b, c, d) => {
      if (a * L[0] + b * L[1] + c * L[2] > 1e-6 * Math.hypot(a, b, c)) return;   // до сонця — площина не обмежує
      PL[np * 4] = a; PL[np * 4 + 1] = b; PL[np * 4 + 2] = c; PL[np * 4 + 3] = d; np++;
    };
    // площини піраміди камери з m (внутрішні; Gribb — Hartmann): ліва, права, низ, верх, ближня; дальня — на глибині shD
    plane(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]); plane(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
    plane(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]); plane(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
    plane(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
    plane(ud[0], ud[1], ud[2], shD - (ud[0] * eye[0] + ud[1] * eye[1] + ud[2] * eye[2]));
    const cap = shD * 1.46 + 16;                   // найдальша точка зрізу (кут екрана 16:9, FOV 55°) + запас
    const outside = (x0, y0, z0, x1, y1, z1) => {
      if (Math.hypot(Math.max(x0 - eye[0], 0, eye[0] - x1), Math.max(y0 - eye[1], 0, eye[1] - y1)) > cap) return true;
      for (let i = 0; i < np; i++) {
        const a = PL[i * 4], b = PL[i * 4 + 1], c = PL[i * 4 + 2];
        if (a * (a >= 0 ? x1 : x0) + b * (b >= 0 ? y1 : y0) + c * (c >= 0 ? z1 : z0) + PL[i * 4 + 3] < 0) return true;
      }
      return false;
    };
    for (const G of U.regions.values()) {
      if (!G.sh.size) continue;
      const ox = G.rx * RW - t[0], oy = G.ry * RW - t[1], oz = G.rz * RH - t[2], g = G.bb;
      if (!(g[0] <= g[3]) || outside(ox + g[0], oy + g[1], oz + g[2], ox + g[3], oy + g[4], oz + g[5])) continue;
      for (const s of G.sh.values()) {
        const b = s.b;
        if (!s.shV || outside(ox + b[0], oy + b[1], oz + b[2], ox + b[3], oy + b[4], oz + b[5])) continue;
        s.visible = true; shOn.push(s);
      }
    }
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

  // ---- плитки далечі ----
  const farMI = (mesh) => {
    const n = mesh.pos.length / 3, M = new pc.Mesh(dev), nor = new Float32Array(n * 3), col = new Uint8Array(n * 4);
    for (let i = 0; i < n * 3; i++) nor[i] = mesh.nor[i] / 127;
    for (let i = 0; i < n; i++) { col[i * 4] = mesh.col[i * 3]; col[i * 4 + 1] = mesh.col[i * 3 + 1]; col[i * 4 + 2] = mesh.col[i * 3 + 2]; col[i * 4 + 3] = mesh.mat[i]; }
    M.setPositions(mesh.pos); M.setNormals(nor); M.setColors32(col); M.setIndices(mesh.idx); M.update();
    const node = new pc.GraphNode(), mi = new pc.MeshInstance(M, mats.far, node);
    mi.castShadow = false; mi.visible = false;
    root.addChild(node); layer.addMeshInstances([mi]);
    return { mi, node };
  };
  const dropFar = (e) => { layer.removeMeshInstances([e.mi]); e.mi.destroy(); root.removeChild(e.node); };
  let farShown = [];

  // ---- фігура: один меш на всі частини, вершини — на CPU за матрицями пози ----
  const figP = figureParts([226, 92, 70]), figParts = [];
  let figN = 0, figI = 0;
  for (const p in figP) { figParts.push([p, figN, figP[p]]); figN += figP[p].pos.length / 3; figI += figP[p].count; }
  const figPos = new Float32Array(figN * 3), figNor = new Float32Array(figN * 3), figCol = new Uint8Array(figN * 4), figIdx = new Uint32Array(figI);
  { let ii = 0; for (const [, v0, m] of figParts) { const n = m.pos.length / 3; for (let i = 0; i < n; i++) { figCol.set([m.col[i * 3], m.col[i * 3 + 1], m.col[i * 3 + 2], m.mat[i]], (v0 + i) * 4); } for (let i = 0; i < m.count; i++) figIdx[ii++] = m.idx[i] + v0; } }
  const figMesh = new pc.Mesh(dev);
  figMesh.setPositions(figPos); figMesh.setNormals(figNor); figMesh.setColors32(figCol); figMesh.setIndices(figIdx); figMesh.update();
  const figNode = new pc.GraphNode(); root.addChild(figNode);
  const figMI = new pc.MeshInstance(figMesh, mats.fig, figNode);
  figMI.castShadow = true; figMI.visible = false;
  layer.addMeshInstances([figMI]);
  const poseFig = (pose) => {
    for (const [p, v0, m] of figParts) {
      const M = pose[p], n = m.pos.length / 3;
      for (let i = 0; i < n; i++) {
        const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2], o = (v0 + i) * 3;
        figPos[o] = M[0] * x + M[4] * y + M[8] * z + M[12]; figPos[o + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; figPos[o + 2] = M[2] * x + M[6] * y + M[10] * z + M[14];
        const a = m.nor[i * 3], b = m.nor[i * 3 + 1], c = m.nor[i * 3 + 2];
        const nx = M[0] * a + M[4] * b + M[8] * c, ny = M[1] * a + M[5] * b + M[9] * c, nz = M[2] * a + M[6] * b + M[10] * c, l = Math.hypot(nx, ny, nz) || 1;
        figNor[o] = nx / l; figNor[o + 1] = ny / l; figNor[o + 2] = nz / l;
      }
    }
    figMesh.setPositions(figPos); figMesh.setNormals(figNor); figMesh.setColors32(figCol); figMesh.setIndices(figIdx); figMesh.update();
  };

  // ---- небо: ShaderMaterial на весь екран, шар Skybox ----
  const skyMat = new pc.ShaderMaterial({ uniqueName: 'eco-sky', vertexGLSL: SKY_VS, fragmentGLSL: SKY_FS, vertexWGSL: SKY_VS_WGSL, fragmentWGSL: SKY_FS_WGSL, attributes: { aPosition: pc.SEMANTIC_POSITION } });
  skyMat.depthWrite = false; skyMat.cull = pc.CULLFACE_NONE; skyMat.update();
  const skyMesh = new pc.Mesh(dev);
  skyMesh.setPositions([-1, -1, 0, 3, -1, 0, -1, 3, 0]); skyMesh.setIndices([0, 1, 2]); skyMesh.update();
  const skyMI = new pc.MeshInstance(skyMesh, skyMat, new pc.GraphNode());
  skyMI.cull = false;
  skyLayer.addMeshInstances([skyMI]);
  const sun4 = new Float32Array(12), sunC = new Float32Array(12), moon4 = new Float32Array(12), moonC = new Float32Array(9);
  const c3 = (v) => [v[0] / 255, v[1] / 255, v[2] / 255];
  function setSky(inv, st) {
    const P = (k, v) => skyMat.setParameter(k, v);
    P('uInv', inv);
    P('uZen', c3(st.zenith)); P('uHor', c3(st.horizon)); P('uMain', [...st.suns[0].dir]);
    P('uDusk', [...c3(st.duskCol), st.dusk]);
    sun4.fill(0); sunC.fill(0); moon4.fill(0); moonC.fill(0);
    st.suns.forEach((s, i) => { sun4.set([...s.dir, s.size], i * 4); sunC.set([...c3(s.col), s.bright], i * 4); });
    st.moons.forEach((m, i) => { moon4.set([...m.dir, m.size], i * 4); moonC.set(c3(m.col), i * 3); });
    P('uSun[0]', sun4); P('uSunCol[0]', sunC); P('uMoon[0]', moon4); P('uMoonCol[0]', moonC);
    P('uNSun', st.suns.length); P('uNMoon', st.moons.length);
    P('uDay', st.day); P('uStars', [st.stars, st.starHue]);
    P('uCel', new Float32Array(st.cel));
    const rg = st.rings;
    P('uRing', [rg ? rg.r0 : 0, rg ? rg.r0 + rg.w : 0, rg ? rg.alpha : 0, rg ? rg.bands : 0]);
    P('uRingCol', rg ? c3(rg.col) : [0, 0, 0]); P('uPole', [...st.pole]);
    const cl = st.cloud || { k: 0, off: [0, 0], dark: 0, col: [255, 255, 255] };
    P('uCloud', [cl.k, cl.off[0], cl.off[1], cl.dark]); P('uCloudCol', c3(cl.col)); P('uFlash', st.flash || 0);
    const au = st.aurora || { dir: [0, 1], k: 0, t: 0, col: [0, 0, 0] };
    P('uAur', [au.dir[0], au.dir[1], au.k, au.t % 10000]); P('uAurCol', c3(au.col));
  }

  let stagger = false, updMask = 15, shadowD = SHADOW_D;
  const UPD = [pc.SHADOWUPDATE_REALTIME, pc.SHADOWUPDATE_NONE, pc.SHADOWUPDATE_NONE, pc.SHADOWUPDATE_NONE];
  const M4 = new pc.Mat4(), Q = new pc.Quat(), Q2 = new pc.Quat(), V3 = new pc.Vec3();
  let shownU = null, lastCol = '', lastRad = 0;

  return {
    R,
    raf(f) { next = f; },
    // m.casters = false — без кидачів землі й рослин (лише фігура): діагностика вартості карти тіней
    setShadows(m) {
      const o = { ...(typeof m === 'string' ? SHADOW[m] : m) };
      if ('casters' in o) { sun.layers = o.casters ? [layer.id, shLayer.id] : [layer.id]; delete o.casters; }
      if ('shadowDistance' in o) { shadowD = o.shadowDistance; delete o.shadowDistance; }
      if ('stagger' in o) { stagger = o.stagger; delete o.stagger; if (!stagger) sun.shadowUpdateOverrides = null; }
      Object.assign(sun, o);
      return R.info;
    },
    resize() {},                                   // розмір канви PlayCanvas відстежує сам
    addSection(d, n, k, q, mesh) { pend.add(pkey('s' + (q.lod || 0), d, n, k)); upQ.push(['s', d, n, k, q, null, mesh]); },
    addFlora(d, n, k, q, data, mesh) { pend.add(pkey('f', d, n, k)); upQ.push(['f', d, n, k, q, data, mesh]); },
    pump(bytes = UP_BYTES) {
      let b = 0, i = 0;
      while (upHead < upQ.length && b < bytes && i < UP_ITEMS) {
        const [kind, d, n, k, q, data, mesh] = upQ[upHead];
        upQ[upHead++] = null;
        pend.delete(pkey(kind === 's' ? 's' + (q.lod || 0) : kind, d, n, k));
        if (kind === 's') { putSection(d, n, k, q, mesh); b += mesh ? (mesh.ns + mesh.nf + (mesh.nc || 0) + mesh.nl) * 16 : 0; }
        else { putFlora(d, n, k, q, data, mesh); b += mesh.n * 16; }
        i++;
      }
      if (upHead === upQ.length) { upQ.length = 0; upHead = 0; } else if (upHead > 4096) { upQ.splice(0, upHead); upHead = 0; }
    },
    setBudget(bytes) { budget = bytes; },
    get overBudget() { return over; },
    addFar(key, data, mesh) {
      const e = fars.get(key);
      if (e) dropFar(e);
      fars.set(key, { ...farMI(mesh.solid), used: frame });
      if (fars.size > KEEP_FAR) {
        const old = [...fars].sort((a, b) => a[1].used - b[1].used).slice(0, fars.size - KEEP_FAR * 0.9);
        for (const [k2, e2] of old) { dropFar(e2); fars.delete(k2); }
        farShown = farShown.filter((f) => fars.has(f.key) && fars.get(f.key) === f.e);
      }
    },
    hasSection(d, n, k, lod = 0, queued = true) {
      const U = uni(d, n), G = U && U.slots.get(k), E = G && G.secs.get(k);
      return (!!E && !!E.L[lod]) || (queued && pend.has(pkey('s' + lod, d, n, k)));
    },
    hasFlora(d, n, k) { const U = uni(d, n); return (!!U && U.flora.has(k)) || pend.has(pkey('f', d, n, k)); },
    hasFar: (key) => fars.has(key),
    clear() {
      upQ.length = 0; upHead = 0; pend.clear();
      for (const U of [...unis.values()]) dropUni(U);
      for (const e of fars.values()) dropFar(e);
      fars.clear(); farShown = [];
      shownU = null;
    },
    get meshCount() { return nL[0] + nL[1] + nL[2]; },
    get lodCounts() { return nL; },

    view(camera, target, dist) {
      const v = viewProj(camera, R.width, R.height, dist), iso = camera.mode === ISO;
      const rad = iso ? isoRadius(camera, R.width, R.height, ZR_ISO, target[2]) : VIEW_R;
      const rs = Math.hypot(R.width, R.height) / 2 / (S * camera.zoom);
      return { ...v, rad, fog: iso ? [0.8 * rs, 1.15 * rs] : [0.3 * FAR_R, 0.97 * FAR_R], fogAxes: null };
    },

    draw(st) {
      frame++;
      // числа минулого кадру
      R.stats.up = R.stats.upBytes; R.stats.upBytes = 0; R.stats.draws = app.stats.drawCallCount;
      const gt = app.stats.gpuFrameTime;
      if (gt !== undefined && gt > 0) { R.gpuMs = R.gpuMs === null ? gt : R.gpuMs * 0.9 + gt * 0.1; R.gpuHist[R.gpuHistI++ % 600] = gt; }
      const pt = dev.gpuProfiler && dev.gpuProfiler.passTimings;
      if (pt) for (const [k, v] of pt) R.gpuPass[k] = R.gpuPass[k] === undefined ? v : R.gpuPass[k] * 0.9 + v * 0.1;
      R.cpuRenderMs = 0.9 * R.cpuRenderMs + 0.1 * (app.stats.cpuRenderTime || 0);
      // тіні минулого кадру: кидачі й трикутники, що реально пішли в каскади
      let shTris = 0, shDraws = 0, shRanges = 0;
      R.stats.shCasc = [0, 0, 0, 0]; R.stats.shKind = [0, 0, 0, 0];
      if (sun.enabled && sun.castShadows) for (let c = 0; c < sun.numCascades; c++) {
        if (!(updMask & 1 << c)) continue;                // каскад минулого кадру не оновлювався
        const rd = sun.light.getRenderData(cam.camera, c);
        for (const m of rd.visibleCasters) {
          const tr = (m.shV ?? m.mesh.primitive[0].count) / 3;
          shDraws++; shTris += tr; shRanges += m.sh ? m.sh.count : 1;
          R.stats.shCasc[c] += tr; R.stats.shKind[m.kind ?? 3] += tr;
        }
      }
      R.stats.shTris = shTris; R.stats.shDraws = shDraws; R.stats.shRanges = shRanges;

      const { target: t, view, laws } = st, sk = skyState(laws, st.clock || 0), wt = st.weather;
      if (wt) applyWeather(sk, laws, wt.W, st.clock || 0);
      const [lx, ly, lz] = sk.light, amb = sk.amb, vk = sk.visK ?? 1;
      const iso = st.camera.mode === ISO;
      const fogR = iso ? [view.fog[0] * Math.sqrt(vk), view.fog[1] * Math.sqrt(vk)] : [view.fog[0] * vk, view.fog[1] * vk];
      const me = st.me, m = view.m;
      const tk = `${laws.d}:${laws.n}:${laws.ds}`;
      if (texFor !== tk) {
        texFor = tk;
        const all = texturesOf(laws), L = [];
        for (let i = 0; i < LAYERS; i++) L.push(all.subarray(i * TEX * TEX * 4, (i + 1) * TEX * TEX * 4));
        const t2 = new pc.Texture(dev, { width: TEX, height: TEX, arrayLength: LAYERS, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, anisotropy: 8, levels: [L] });
        for (const k in mats) mats[k].setParameter('uTexArr', t2);
        if (tex) tex.destroy();
        tex = t2;
        const a = laws.liquid.alpha;
        for (const k of ['liq', 'liqR']) {
          const M = mats[k];
          M.opacity = a;
          if (a < 1) { M.blendType = pc.BLEND_NORMAL; M.depthWrite = false; } else { M.blendType = pc.BLEND_NONE; M.depthWrite = true; }
          M.update();
        }
      }
      const lt = (st.clock || 0) * (laws.phys ? laws.phys.time : 1) % 3000;

      // плаваючий початок
      if (Math.abs(t[0] - O[0]) > 2048 || Math.abs(t[1] - O[1]) > 2048) {
        O[0] = Math.round(t[0] / 1024) * 1024; O[1] = Math.round(t[1] / 1024) * 1024;
        for (const V of unis.values()) for (const G of V.regions.values()) place(G);
      }
      // камера: око й осі (basis: r — праворуч, up — угору, u — до ока) у PlayCanvas (x, z, y)
      const b = basis(st.camera), e = view.eye;
      camE.setPosition(t[0] + e[0] - O[0], t[2] + e[2], t[1] + e[1] - O[1]);
      M4.data.set([b.r[0], b.r[2], b.r[1], 0, b.up[0], b.up[2], b.up[1], 0, b.u[0], b.u[2], b.u[1], 0, 0, 0, 0, 1]);
      camE.setRotation(Q.setFromMat4(M4));
      if (iso) {
        if (cam.projection !== pc.PROJECTION_ORTHOGRAPHIC) cam.projection = pc.PROJECTION_ORTHOGRAPHIC;
        cam.orthoHeight = R.height / (2 * S * st.camera.zoom); cam.nearClip = 1; cam.farClip = 800;
      } else {
        if (cam.projection !== pc.PROJECTION_PERSPECTIVE) cam.projection = pc.PROJECTION_PERSPECTIVE;
        cam.fov = 55; cam.nearClip = 0.1; cam.farClip = FAR_R * 1.6;
      }
      // світло й туман — PlayCanvas
      sunE.setRotation(Q2.setFromDirections(pc.Vec3.UP, V3.set(lx, lz, ly).normalize()));
      sun.color = new pc.Color(sk.lightK[0], sk.lightK[1], sk.lightK[2]);
      app.scene.ambientLight.set(sk.lightK[0] * amb, sk.lightK[1] * amb, sk.lightK[2] * amb);
      sun.shadowDistance = iso ? 400 + view.rad : shadowD;
      if (stagger) {
        const o2 = stagger === 'spread' ? 2 : 0, o3 = stagger === 'spread' ? 4 : 0;
        UPD[1] = frame % 5 ? pc.SHADOWUPDATE_NONE : pc.SHADOWUPDATE_THISFRAME;
        UPD[2] = frame % 10 !== o2 ? pc.SHADOWUPDATE_NONE : pc.SHADOWUPDATE_THISFRAME;
        UPD[3] = frame % 15 !== o3 ? pc.SHADOWUPDATE_NONE : pc.SHADOWUPDATE_THISFRAME;
        sun.shadowUpdateOverrides = UPD;
        updMask = 1 | (UPD[1] !== pc.SHADOWUPDATE_NONE) << 1 | (UPD[2] !== pc.SHADOWUPDATE_NONE) << 2 | (UPD[3] !== pc.SHADOWUPDATE_NONE) << 3;
      } else updMask = 15;
      const F = app.scene.fog;
      F.start = fogR[0]; F.end = fogR[1]; F.color.set(sk.fog[0] / 255, sk.fog[1] / 255, sk.fog[2] / 255);
      tgt[0] = t[0] - O[0]; tgt[1] = t[2]; tgt[2] = t[1] - O[1];
      uTarget.setValue(tgt); uSeam.setValue(SEAM); uTime.setValue(lt);
      setSky(new Float32Array(invert(m)), sk);

      // Видимі регіони й діапазони в них
      const farOn = !!(st.far && st.far.length), rad = view.rad, U = uni(laws.d, laws.n);
      LN.fill(0); visRegs.length = 0;
      if (U !== shownU) {
        if (shownU) for (const G of shownU.regions.values()) { for (const k in G.mi) G.mi[k].visible = false; for (const m of G.sh.values()) m.visible = false; }
        if (U) for (const G of U.regions.values()) G.shDirty = true;
        shownU = U;
      }
      const colK = `${Math.floor(t[0] / CS)},${Math.floor(t[1] / CS)}`;
      // ціль у іншому стовпці — рослини зблизька й спрощені міняються лише біля неї
      if (U && (colK !== lastCol || rad !== lastRad)) { lastCol = colK; lastRad = rad; for (const G of U.regions.values()) if (horiz(G, t) < NEAR + 2 * CS) G.shDirty = true; }
      let tris = 0, camRanges = 0;
      if (U) {
        U.drawn = frame; U.at = performance.now();
        for (const G of U.regions.values()) {
          const ox = G.rx * RW - t[0], oy = G.ry * RW - t[1], oz = G.rz * RH - t[2];
          const nx = ox > 0 ? ox : ox + RW < 0 ? -(ox + RW) : 0, ny = oy > 0 ? oy : oy + RW < 0 ? -(oy + RW) : 0;
          if (Math.hypot(nx, ny) > rad + 4) continue;
          const bb = G.bb;
          if (!(bb[0] <= bb[3]) || !aabbInView(m, ox + bb[0], oy + bb[1], oz + bb[2], ox + bb[3], oy + bb[4], oz + bb[5])) continue;
          G.inside = aabbInside(m, ox + bb[0], oy + bb[1], oz + bb[2], ox + bb[3], oy + bb[4], oz + bb[5]);
          G.dist = Math.hypot(nx, ny); G.ox = ox; G.oy = oy; G.oz = oz;
          visRegs.push(G); G.drawn = frame;
        }
        visRegs.sort((a, c) => a.dist - c.dist);
        for (const G of visRegs) {
          const { ox, oy, oz, inside } = G, seg = G.seg;
          for (let j = 0; j < NL; j++) seg[j * 2] = LN[j];
          for (const E of G.secs.values()) {
            const ax = E.cx * CS - t[0], ay = E.cy * CS - t[1], dn = colDist(E.cx, E.cy, t);
            if (dn > rad || (farOn && dn > SEAM)) continue;
            const sl = E.L[0];
            if (!sl) continue;
            const ring = farOn && Math.hypot(Math.max(-ax, ax + CS), Math.max(-ay, ay + CS)) > SEAM;
            if (sl.off >= 0 && sl.bb) {
              const c = sl.bb;
              if (inside || aabbInView(m, ox + c[0], oy + c[1], oz + c[2], ox + c[3], oy + c[4], oz + c[5])) {
                const dc = Math.hypot(ax + CS / 2, ay + CS / 2), fk = ck(E.cx, E.cy);
                const nf = dc < NEAR && U.flora.has(fk) ? 0 : sl.nf;
                const j = ring ? L_RING : L_PLAIN;
                if (sl.ns) pushR(j, seg[j * 2], sl.off, sl.ns);
                if (nf) pushR(L_OBJ + j, seg[(L_OBJ + j) * 2], sl.off + sl.ns, nf);
              }
            }
            if (sl.loff >= 0 && sl.lbb) {
              const c = sl.lbb;
              if (inside || aabbInView(m, ox + c[0], oy + c[1], oz + c[2], ox + c[3], oy + c[4], oz + c[5])) pushR(ring ? L_LIQR : L_LIQ, seg[(ring ? L_LIQR : L_LIQ) * 2], sl.loff, sl.nl);
            }
          }
          for (const f of G.fls.values()) {
            if (f.off < 0 || !f.n) continue;
            const dc = Math.hypot(f.cx * CS + CS / 2 - t[0], f.cy * CS + CS / 2 - t[1]);
            if (dc >= NEAR) continue;
            const c = f.bb;
            if (inside || aabbInView(m, ox + c[0], oy + c[1], oz + c[2], ox + c[3], oy + c[4], oz + c[5])) pushR(L_FL, seg[L_FL * 2], f.off, f.n);
          }
          for (let j = 0; j < NL; j++) seg[j * 2 + 1] = LN[j];
        }
        // сітки регіонів: команди камери — видимі діапазони; кидачі — тіньові (buildShadow)
        for (const G of U.regions.values()) {
          if (G.shDirty) buildShadow(U, G, t);
          const on = G.drawn === frame;
          for (const k in MK) {
            const K = MK[k], a = on ? G.seg[K.list * 2] : 0, z = on ? G.seg[K.list * 2 + 1] : 0;
            let mi = G.mi[k];
            if (!mi) { if (z <= a || !G[K.arena]) continue; mi = makeMI(G, k); }
            const v = fill(mi, 'cam', LF[K.list], LC[K.list], a, z);
            camRanges += z - a;
            tris += v / 3;
            mi.visible = v > 0;
          }
        }
      }
      cullShadow(U, m, view.eye, b.u, [-lx, -ly, -lz], t, sun.shadowDistance);
      // Далечінь: плитки поверхні — лише за швом
      for (const s of farShown) s.e.mi.visible = false;
      farShown.length = 0;
      if (farOn) for (const f of st.far) {
        const fe = fars.get(f.key);
        if (!fe) continue;
        fe.used = frame; fe.node.setLocalPosition(f.x0 - O[0], f.y0 - O[1], 0); fe.mi.visible = true;
        farShown.push({ key: f.key, e: fe });
        tris += fe.mi.mesh.primitive[0].count / 3;
      }
      // фігура (камера впритул — не малюємо)
      if (me && (view.ortho || Math.hypot(...view.eye) > 0.7)) {
        poseFig(poseMatrices(me.anim, me.x - O[0], me.y - O[1], me.z, me.yaw));
        figMI.visible = true;
      } else figMI.visible = false;
      if (frame % 60 === 0) maintain(U, t, rad, laws);
      R.stats.tris = tris; R.stats.camRanges = camRanges;
      return sk;
    },
  };
}
