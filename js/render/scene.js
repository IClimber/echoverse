// render/scene.js — сцена гри на рушії PlayCanvas (js/engine/graphics): регіони секцій (щільні вершини в аренах, multi-draw;
// далекі — звільняються), рослини зблизька, плитки далечі, фігура гравця, тіла екземплярами, опади частинками, небо з
// розсіяним світлом, світла сонць і місяців з тінями, туман, «вікно» крізь те, що закриває гравця, розчинення рослин біля
// ока. Облік (що в якому діапазоні, які видимі) — тут; об'єкти PlayCanvas — у рушії. API для main.js, stream.js,
// debug.js. Камера — camera.js гри (перша чи третя особа)
import { createApp, pc } from '../engine/graphics/app.js';
import { createMaterials } from '../engine/graphics/materials.js';
import { outlineChunks } from '../engine/graphics/chunks.js';
import { createRegions } from '../engine/graphics/regions.js';
import { createSky } from '../engine/graphics/sky.js';
import { createLights, SHADOW_D } from '../engine/graphics/lights.js';
import { floatMesh } from '../engine/graphics/meshes.js';
import { createInstances } from '../engine/graphics/instances.js';
import { createParticleVolume, setShelter } from '../engine/graphics/particles.js';
import { createBolts } from '../engine/graphics/bolts.js';
import { cloudsAt, meteorsAt, boltSegs } from '../env/weather.js';
import { timeK } from '../env/worldphys.js';
import { SKY_GLSL, SKY_WGSL } from '../env/sky-shader.js';
import { createHorizon } from '../env/horizon.js';
import { CS } from '../gen/chunk.js';
import { L_LAVA, LEVEL } from '../laws/universe.js';
import { liquidVis } from '../player/collision.js';
import { figureParts, lampGlow } from '../gen/mesh.js';
import { LAMP } from '../player/lamp.js';
import { poseMatrices, viewArms } from '../player/anim.js';
import { skyState, applyWeather, CLOUD_H, lightsOf, lightSlots, pcIntensity } from '../env/sky.js';
import { far2, near2 } from '../engine/core/frustum.js';
import { FIRST, CAM_R, FIG_NEAR, fovOf, VIEW_R, FAR_R, SEAM, viewProj, project, basis, aabbInView, aabbInside, LOD_R, LOD_CAP, LOD_ON, lodOf, keepLod, colDist, FLORA_NEAR, FLORA_FADE, FLORA_THIN } from '../player/camera.js';
import { regionOf, RS, RW, RH, PO, PQ } from '../gen/pack.js';
import { ck } from '../world.js';
import { texturesOf, TEX } from './textures.js';
import { LAYERS, MAT_TABLE } from '../gen/materials.js';

const KEEP_FAR = 1500;                         // плиток далечі в GPU
// Ємність арени регіону (вершин): початкова, найбільша — 2²⁴ (16 Б × 2²⁴ = 256 МіБ — гарантована межа буфера WebGPU,
// maxBufferSize); пам'ять — лише в міру потреби (росте ×2). 12.10.2026: 4 194 304 не вистачало арені рослин зблизька
// регіону в густих джунглях (зберігаються до FLORA_NEAR + 96, стовпець — до 96 тис. вершин) — стовпець лишався без рослин
const ARENA0 = 32768, ARENA_MAX = 16777216;
const UP_BYTES = 4 << 20, UP_ITEMS = 64;       // завантажень у GPU за кадр: байтів, мешів
const BODY_R = 200;                            // тіла ближче — малюються (main.js)
export { BODY_R };
// Опади за типом: коробка (півширина, висота), падіння (од/с), довжина риски, розмір, частка частинок, колір, текстура
const PART = {
  rain: { box: [13, 11], fall: 15, len: 0.6, size: 0.018, dens: 1, col: [0.8, 0.85, 0.94, 0.5], tex: 'streak' },
  acid: { box: [13, 11], fall: 13, len: 0.55, size: 0.02, dens: 1, col: [0.62, 0.95, 0.32, 0.55], tex: 'streak' },
  snow: { box: [15, 11], fall: 1.6, len: 0, size: 0.03, dens: 0.8, col: [1, 1, 1, 0.85], tex: 'dot' },
  dust: { box: [16, 7], fall: 0.25, len: 0, size: 0.045, dens: 1, col: [0.8, 0.7, 0.5, 0.5], tex: 'dot' },
};
const PARTICLES = 6000;
const rkey = (rx, ry, rz) => ((rx + 0x20000) * 0x40000 + (ry + 0x20000)) * 256 + (rz + 128);
// Списки діапазонів на кадр: 0 — порожній (тверде біля «вікна» виду згори, прибраного 13.10.2026; індекс лишився — до
// нього додається L_OBJ), 1 — тверде, 2 — тверде на шві далечі (1–2 — з відсіканням задніх граней), 3 — рідина, 4 — рідина на шві, 5 — рослини зблизька, 6–8 — далекі рослини й каміння секцій (пара до 0–2, без
// відсікання: листя видно з обох боків), 9 — далекі рослини секцій у смузі переходу (проступають, де зникають повні),
// 10 — великі рослини зблизька там, де розчинення, «вікно» й перехід нічого не відкидають (матеріал без дизерингу)
const L_CUT = 0, L_PLAIN = 1, L_RING = 2, L_LIQ = 3, L_LIQR = 4, L_FL = 5, L_OBJ = 6, L_OBJF = 9, L_FLB = 10, NL = 11;
const FALLBACK = [[1, 2], [0, 2], [1, 0]];     // рівень деталізації, коли потрібного ще немає: спершу тонший
// Сітки камери регіону: вид → арена, матеріал, список кадру
const KINDS = {
  solid: ['op', 'solid', L_PLAIN], solidR: ['op', 'solidR', L_RING],
  objC: ['op', 'objC', L_OBJ + L_CUT], obj: ['op', 'obj', L_OBJ + L_PLAIN], objR: ['op', 'objR', L_OBJ + L_RING], objF: ['op', 'objF', L_OBJF],
  liq: ['liq', 'liq', L_LIQ], liqR: ['liq', 'liqR', L_LIQR], fl: ['fl', 'fl', L_FL], flB: ['fl', 'obj', L_FLB],
};
// Кидачі тіней — по блоку BS×BS стовпців регіону (regions.js): 0 — тверде з далекими рослинами й камінням секції (в арені
// поруч — один діапазон; матеріал без відсікання граней), 2 — рослини зблизька
const BS = 2, NB = RS / BS;
// Тіні за відстанню (як LOD тіней у рушіях: дальні каскади — грубші кидачі; 13.10.2026, рішення користувача): каскади 0–1
// (тіні до ~33 м) — повна будова рослин зблизька, 2–3 (до 128 м) — тінь дерева від його спрощеної будови, малої рослини —
// від простого тіла (gen/mesh.js shadeProxy). Види кидачів: земля всіх секцій і спрощені рослини стовпців без повних (усі
// каскади), спрощені рослини стовпців з повними (дальні), великі рослини зблизька й покрив (ближні), тіні малих рослин
// (дальні)
const SH_ALL = 255, SH_NEAR = 0b0011, SH_FAR = 0b1100;
const C_GROUND = 0, C_SIMPLE = 1, C_BIG = 2, C_COVER = 3, C_SHADE = 4, NKC = 5;

// settings: { gpu: 'webgl2' | 'webgpu', shadows: 'off' | 'pcf3' | 'pcss' }
export async function createScene(canvas, settings = {}) {
  const G = await createApp(canvas, { device: settings.gpu || 'webgl2', far: FAR_R * 1.6 });
  const { app, dev, scene } = G, camE = G.camE, cam = G.cam;

  // ---- матеріали (engine/graphics/materials.js) ----
  const M = createMaterials(G), mats = {};
  const mk = (name, o) => (mats[name] = M.makeMaterial(name, o));
  const BACK = pc.CULLFACE_BACK;
  mk('solid', { cull: BACK, defines: ['ECO_CURVE'] }); mk('solidR', { cull: BACK, defines: ['ECO_CURVE', 'ECO_RING_IN'] });
  mk('obj', { defines: ['ECO_CURVE', 'ECO_WIND'] }); mk('objR', { defines: ['ECO_CURVE', 'ECO_WIND', 'ECO_RING_IN'] }); mk('objC', { defines: ['ECO_CURVE', 'ECO_WIND', 'ECO_CUT'] });
  mk('liq', { defines: ['ECO_CURVE'], blend: { opacity: 0.75 } }); mk('liqR', { defines: ['ECO_CURVE', 'ECO_RING_IN'], blend: { opacity: 0.75 } });
  mk('objF', { defines: ['ECO_CURVE', 'ECO_WIND', 'ECO_XIN'] });
  mk('fl', { defines: ['ECO_CURVE', 'ECO_WIND', 'ECO_FADE', 'ECO_CUTF', 'ECO_THIN', 'ECO_XOUT'] });
  mk('far', { cull: BACK, matcol: true, defines: ['ECO_CURVE', 'ECO_RING_OUT'] });
  mk('fig', { matcol: true });
  mk('body', { matcol: true, defines: ['ECO_CURVE'] });
  M.setMaterialTable(MAT_TABLE);
  const CULLED = ['solid', 'solidR', 'far'];

  // ---- регіони (engine/graphics/regions.js) ----
  const FMT = new pc.VertexFormat(dev, [
    { semantic: pc.SEMANTIC_POSITION, components: 4, type: pc.TYPE_UINT16, normalize: true },
    { semantic: pc.SEMANTIC_NORMAL, components: 4, type: pc.TYPE_INT8, normalize: true },
    { semantic: pc.SEMANTIC_COLOR, components: 4, type: pc.TYPE_UINT8, normalize: true },
  ]);
  if (FMT.size !== 16 || FMT.elements[1].offset !== 8 || FMT.elements[2].offset !== 12) throw new Error('розкладка вершини PlayCanvas ≠ gen/pack.js');
  const kinds = {};
  for (const k in KINDS) kinds[k] = { arena: KINDS[k][0], material: mats[KINDS[k][1]] };
  const stats = { draws: 0, tris: 0, shTris: 0, shDraws: 0, up: 0, upBytes: 0, gpuBytes: 0, arenaBytes: 0, arenaUsed: 0, full: 0 };
  // види кидачів (CASTERS): матеріал і каскади (shLod — ?dev: false — усе в усі каскади, як до тіней за відстанню)
  // (layer 'far' — шар «Тіні дальні»: лише напрямлені світла; локальні — ліхтарик — беруть повні рослини, не спрощені)
  const CASTERS = [
    { arena: 'op', material: mats.obj, cascades: SH_ALL }, { arena: 'op', material: mats.obj, cascades: SH_FAR, layer: 'far' },
    { arena: 'fl', material: mats.fl, cascades: SH_NEAR }, { arena: 'fl', material: mats.fl, cascades: SH_NEAR },
    { arena: 'fl', material: mats.fl, cascades: SH_FAR, layer: 'far' },
  ];
  const RG = createRegions(G, { size: [RW, RW, RH], PO, PQ, format: FMT, kinds, casters: CASTERS, arena0: ARENA0, arenaMax: ARENA_MAX, stats });

  // ---- небо, світла, частинки ----
  // розсіяне з неба перепікається, коли сонце зсунулось на 2° (доба 6–40 хв × плин часу — до ~2°/с; розсіяне плавне)
  const sky = createSky(G, { glsl: SKY_GLSL, wgsl: SKY_WGSL, lightingThreshold: 2 });
  // локальних світел у грі поруч щонайбільше кілька (ліхтарик гравця, світло блискавки): 8 на клітинку замість 255 —
  // з ліхтариком кадр 4,7 → 4,0 мс (шахта «1qgt24p», WebGPU, 13.10.2026), без локальних — без змін
  const LG = createLights(G, { shadows: settings.shadows || 'pcf3', perCell: 8 });
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
  const posedMesh = (names, src = figP) => {
    const parts = [];
    let nv = 0, ni = 0;
    for (const p of names) { parts.push([p, nv, src[p]]); nv += src[p].pos.length / 3; ni += src[p].count; }
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
  G.layers.world.addMeshInstances([figMI]); G.layers.player.addMeshInstances([figSh]);   // «Тінь гравця»: не для свого ліхтарика
  const armsMI = new pc.MeshInstance(arms.mesh, mats.fig, figNode);
  armsMI.castShadow = false; armsMI.visible = false;
  G.layers.arms.addMeshInstances([armsMI]);
  // Скло налобного ліхтарика, що світиться (увімкнений, фігуру видно): окремий меш з емісією — як видиме джерело в
  // прикладі PlayCanvas clustered-spot-shadows («render component with a small cone», material.emissive); поза — голова
  const glow = posedMesh(['glow'], { glow: lampGlow() }), glowMat = new pc.StandardMaterial();
  glowMat.diffuse = new pc.Color(0, 0, 0); glowMat.emissive = new pc.Color(1, 1, 1); glowMat.emissiveIntensity = 2;
  glowMat.useLighting = false; glowMat.useSkybox = false; glowMat.update();
  const glowMI = new pc.MeshInstance(glow.mesh, glowMat, figNode);
  glowMI.castShadow = false; glowMI.visible = false;
  G.layers.world.addMeshInstances([glowMI]);
  // Ліхтарик гравця (js/player/lamp.js): прожектор — створюється при першому вмиканні; шари — World, «Тіні», «Руки» (без «Тіні
  // гравця»: своя фігура не затуляє свій ліхтарик, і без «Тіней дальніх»: тут повні рослини)
  let lampL = null;

  // ---- обрис цілі (п. 3 roadmap): тіло, рослина, камінь — OutlineRenderer PlayCanvas (extras/renderers/outline-renderer.js,
  // приклад graphics/outlines-colored): шар «Обрис» у композиції, але не в камері (обриси малює лише внутрішня камера);
  // окремий екземпляр меша цілі; камера обрису вимкнена, поки цілі немає (інакше рендер і розмиття — щокадру). Блок —
  // каркас коробки (Immediate)
  const outLayer = new pc.Layer({ name: 'Обрис' });
  app.scene.layers.push(outLayer);
  const outline = new pc.OutlineRenderer(app, outLayer);
  outline.outlineCameraEntity.enabled = false;
  const outE = new pc.Entity('обрис');
  outE.addComponent('render', { layers: [], castShadows: false, receiveShadows: false });
  G.root.addChild(outE);
  const OUT_COL = new pc.Color(0.95, 0.95, 0.85);
  // проста StandardMaterial: прохід обрису бере з матеріалу лише непрозорість (наші шматки в ньому не компілюються)
  // з вершинними шматками вітру й кривизни (chunks.js outlineChunks) — обрис гойдається разом з рослиною
  const outMat = new pc.StandardMaterial(); outMat.cull = pc.CULLFACE_NONE;
  outMat.getShaderChunks(G.lang).add(outlineChunks(dev, G.lang)); outMat.shaderChunksVersion = '2.23';
  outMat.setDefine('ECO_WIND', true); outMat.setDefine('ECO_CURVE', true); outMat.update();
  const wire = new pc.WireRenderer(app);            // каркас блоку-цілі (extras/renderers/wire-renderer.js)
  wire.color = new pc.Color(0.05, 0.05, 0.05, 0.7); wire.layer = G.layers.world; wire.depthTest = true;   // World: шар «Руки» очищає глибину до Immediate — каркас лягав би поверх фігури
  const objMeshes = new Map();                      // повна будова предметів-цілей: key → pc.Mesh (кілька останніх)
  let outKey = null;
  const bMin = new pc.Vec3(), bMax = new pc.Vec3();
  const setOutline = (key, mesh) => {
    if (outKey === key) return;
    outline.removeAllEntities();
    outKey = key;
    if (mesh) {
      outE.render.meshInstances = [new pc.MeshInstance(mesh, outMat, outE)];
      outline.addEntity(outE, OUT_COL);
    }
    outline.outlineCameraEntity.enabled = !!mesh;
  };

  // ---- тіла: шаблон → меш і група екземплярів ----
  const tmpl = new Map();
  const group = (T) => {
    let g = tmpl.get(T);
    if (!g) {
      // кеш переповнено — меші всіх шаблонів знищуються: обрис цілі скинути (інакше лишився б на знищеному меші — ключ той самий)
      if (tmpl.size > 400) { setOutline(null, null); for (const v of tmpl.values()) { v.inst.destroy(); v.mesh.destroy(); stats.gpuBytes -= v.bytes; } tmpl.clear(); }
      const idx = T.verts > 65535 ? new Uint32Array(T.verts) : new Uint16Array(T.verts);
      for (let i = 0; i < T.verts; i++) idx[i] = i;
      const mesh = floatMesh(G, { pos: T.p, nor: T.n, col: T.c, mat: T.m, idx });
      g = { mesh, inst: createInstances(G, mesh, mats.body), n: 0, d: 0, buf: new Float32Array(16 * 16), bytes: T.verts * 32 };
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
    for (const k of Gr.fls.keys()) U.flora.delete(k);
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
  // Рослини зблизька стовпця; порожні — позначка null (є, малювати нічого)
  function putFlora(d, n, k, q, data, mesh) {
    const U = uni(d, n, true);
    removeFlora(U, k);
    if (!mesh.n) { U.flora.set(k, null); return; }
    const [rx, ry] = regionOf(q.cx, q.cy, 0), Gr = region(U, rx, ry, data.rz);
    const off = RG.put(Gr.R, 'fl', mesh.fl, mesh.n);
    // не вмістились (нестача пам'яті) — fail: стовпець малює спрощені рослини замість повних (без дірки в лісі).
    // n — вершин, що малюються (великі nb, за ними покрив), за ними np — тіні малих рослин (лише кидачі дальніх каскадів)
    const np = off < 0 ? 0 : mesh.np || 0;
    Gr.fls.set(k, { cx: q.cx, cy: q.cy, off, n: off < 0 ? 0 : mesh.n - np, nb: off < 0 ? 0 : mesh.nb, np, ob: mesh.ob, bb: mesh.bb, fail: off < 0 });
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
      else for (const f of Gr.fls.values()) if (f.off >= 0) live.push([f, 'off', f.n]);
      A.repack(cap2, live);
      Gr.shDirty = true;
    }
  };
  // Вивантаження: поточний всесвіт — регіони далі кола (+256) і рослини зблизька за межею; сусідні (n ± 1) — усе, крім
  // регіонів біля гравця (там коло приземлення — стрибок без чекання; до 12.10.2026 сусід, з якого пішли, тримав усе своє
  // коло — пам'ять після стрибка 1,6 → 2,4 ГБ), а всесвіт, куди заряджаємось (to), — як поточний; решта — за 600 кадрів
  function maintain(U, t, rad, laws, to) {
    const trimU = (V, r) => {
      for (const Gr of [...V.regions.values()]) if (horiz(Gr, t) > r) dropRegion(V, Gr);
      for (const [k2, Gr] of V.flora) if (Gr) { const f = Gr.fls.get(k2); if (colDist(f.cx, f.cy, t) > FLORA_NEAR + 96) removeFlora(V, k2); }
    };
    if (U) trimU(U, rad + 256);
    for (const V of [...unis.values()]) {
      if (V === U) continue;
      if (to && V.d === to[0] && V.n === to[1]) trimU(V, rad + 256);
      else if (V.d === laws.d && Math.abs(V.n - laws.n) <= 1) trimU(V, CS);
      else if (frame - Math.max(V.drawn, V.added) > 600) dropUni(V);
    }
    used();
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
  // у стовпця є повні рослини зблизька в GPU (null — порожні: малювати нічого); не вмістились — ні (малюються спрощені)
  const nearFlora = (U, k) => { const Gr = U.flora.get(k); return Gr === null || (Gr !== undefined && !Gr.fls.get(k).fail); };
  // найдальша від цілі точка стовпця (ax, ay — кут стовпця від цілі)
  const colFar = (ax, ay) => Math.hypot(Math.max(Math.abs(ax), Math.abs(ax + CS)), Math.max(Math.abs(ay), Math.abs(ay + CS)));
  // Секція біля «вікна» (на екрані — у колі навколо гравця, ближче за нього) — матеріал з вирізом
  const cutHit = (m, cut, x0, y0, z0, x1, y1, z1, cv) => {
    if (cv > 0) { z0 -= cv * far2(x0, y0, x1, y1); z1 -= cv * near2(x0, y0, x1, y1); }
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

  // Рослини зблизька без дизерингу (ліс, 12.10.2026): шейдер, що може відкинути піксель, вимикає ранню перевірку глибини —
  // кожен шар крон затінюється повністю. Матеріал fl відкидає лише в смузі переходу, біля ока (розчинення), у конусі
  // «вікна» вище колін і траву (проріджування); великі рослини (дерева, каміння), чия коробка (із запасом на вітер і
  // кривизну) не зачіпає жодної з цих зон, малюються матеріалом obj (той самий, лише без дизерингу) — пікселі ті самі.
  // Спершу — увесь стовпець, інакше — кожен предмет (коробки з роботи flora). fz: ex…ez — око, far — початок смуги
  // переходу, drop — найбільше опускання кривизною, fade — до якої відстані розчинення (0 — вимкнено), cut — «вікно»
  // (px…pz — гравець, dP — до нього від ока, ang — півкут конуса), knee — коліна
  const fz = { ex: 0, ey: 0, ez: 0, far: 0, drop: 0, fade: 0, cut: false, px: 0, py: 0, pz: 0, dP: 0, ang: 0, knee: 0 };
  const FZ_M = 0.5;
  let flSplit = true, shLod = true;
  // Рухоме кидає тінь у каскад, що оновлюється не щокадру, — оновити його в цьому кадрі (lights.js cascades): фігура
  // (рухається завжди — хоч дихання) і тіла, що зрушили з минулого кадру. Каскади — за глибиною вздовж погляду основи, верху
  // й кінця тіні (верх, зсунутий від світла до висоти основи − 2 м, не далі 64 м). e — око відносно t, u — до ока
  const bodyAt = new WeakMap();
  function dynCascades(st, t, e, u) {
    const nc = LG.cascadeCount, sl = LG.slices, d = LG.slots[0] && LG.slots[0].dir;
    if (nc < 2 || !d) return 0;
    const dl = Math.hypot(d[0], d[1], d[2]), lx = d[0] / dl, ly = d[1] / dl, lz = d[2] / dl;
    const dep = (x, y, z) => -(u[0] * (x - e[0]) + u[1] * (y - e[1]) + u[2] * (z - e[2]));
    let mk = 0;
    const add = (x, y, z0, z1, r) => {
      const k = lz > 0.03 ? Math.min(64, (z1 - z0 + 2) / lz) : 64;
      const a = dep(x, y, z0), b = dep(x, y, z1), c = dep(x - lx * k, y - ly * k, z1 - lz * k);
      const lo = Math.min(a, b, c) - r, hi = Math.max(a, b, c) + r;
      for (let i = 1; i < nc; i++) if (hi >= sl[i * 2] && lo <= sl[i * 2 + 1]) mk |= 1 << i;
    };
    const me = st.me;
    if (me) add(me.x - t[0], me.y - t[1], me.z - t[2], me.z - t[2] + 1.1, 0.6);
    if (st.bodies) for (const bo of st.bodies) {
      const x = bo.ix ?? bo.x, y = bo.iy ?? bo.y, z = bo.iz ?? bo.z, p = bodyAt.get(bo);
      if (p && Math.abs(p[0] - x) + Math.abs(p[1] - y) + Math.abs(p[2] - z) < 0.005) continue;
      if (p) { p[0] = x; p[1] = y; p[2] = z; } else bodyAt.set(bo, [x, y, z]);
      const r = Math.max(bo.hx, bo.hy, bo.hz) * 2;
      add(x - t[0], y - t[1], z - t[2] - r, z - t[2] + r, r);
    }
    return mk;
  }
  const bigSafe = (x0, y0, z0, x1, y1, z1) => {
    x0 -= FZ_M; y0 -= FZ_M; x1 += FZ_M; y1 += FZ_M; z1 += FZ_M; z0 -= FZ_M + fz.drop;
    if (Math.hypot(Math.max(-x0, x1), Math.max(-y0, y1)) >= fz.far) return false;            // смуга переходу
    const dx = Math.max(x0 - fz.ex, 0, fz.ex - x1), dy = Math.max(y0 - fz.ey, 0, fz.ey - y1), dz = Math.max(z0 - fz.ez, 0, fz.ez - z1);
    const dmin = Math.hypot(dx, dy, dz);
    if (fz.fade && dmin < fz.fade) return false;                                                // розчинення біля ока
    if (!fz.cut || z1 <= fz.knee || dmin >= fz.dP) return true;                                  // «вікно»: вище колін, ближче гравця
    // вирізає лише ближче за гравця: коробка ∩ куб навколо ока з півстороною dP, далі — куля навколо неї проти конуса
    x0 = Math.max(x0, fz.ex - fz.dP); y0 = Math.max(y0, fz.ey - fz.dP); z0 = Math.max(z0, fz.ez - fz.dP, fz.knee);
    x1 = Math.min(x1, fz.ex + fz.dP); y1 = Math.min(y1, fz.ey + fz.dP); z1 = Math.min(z1, fz.ez + fz.dP);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, rb = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2;
    const vx = cx - fz.ex, vy = cy - fz.ey, vz = cz - fz.ez, lv = Math.hypot(vx, vy, vz);
    if (lv <= rb) return false;
    const qx = fz.px - fz.ex, qy = fz.py - fz.ey, qz = fz.pz - fz.ez;
    const cosA = Math.max(-1, Math.min(1, (vx * qx + vy * qy + vz * qz) / (lv * fz.dP)));
    return Math.acos(cosA) - Math.asin(rb / lv) > fz.ang;
  };

  // Кидачі регіону: діапазони за блоками й видами (злиття сусідніх) і межі блоків (клітинки від кута регіону). Види — CASTERS
  const NS = NB * NB * NKC, SF = Array.from({ length: NS }, () => new Int32Array(256)), SC = Array.from({ length: NS }, () => new Int32Array(256)), SN = new Int32Array(NS);
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
      const b = blockOf(Gr, E.cx, E.cy) * NKC;
      // є повні рослини — тінь у ближніх каскадах від них (і в смузі переходу), у дальніх — від спрощених
      const full = colDist(E.cx, E.cy, t) < FLORA_NEAR && nearFlora(U, ck(E.cx, E.cy)), nf = full ? 0 : sl.nf;
      if (sl.ns + nf) pushS(b + C_GROUND, sl.off, sl.ns + nf);
      if (full && sl.nf && shLod) pushS(b + C_SIMPLE, sl.off + sl.ns, sl.nf);
      if (sl.ns || sl.nf) growB(b / NKC, sl.bb);
    }
    for (const f of Gr.fls.values()) {
      if (f.off < 0 || !f.n || colDist(f.cx, f.cy, t) >= FLORA_NEAR) continue;
      const b = blockOf(Gr, f.cx, f.cy) * NKC;
      if (!shLod) pushS(b + C_BIG, f.off, f.n);              // як до тіней за відстанню: усе повне в усі каскади
      else {
        if (f.nb) pushS(b + C_BIG, f.off, f.nb);
        if (f.n > f.nb) pushS(b + C_COVER, f.off + f.nb, f.n - f.nb);
        if (f.np) pushS(b + C_SHADE, f.off + f.n, f.np);
      }
      growB(b / NKC, f.bb);
    }
    let n = 0;
    for (let b = 0; b < NB * NB; b++) for (let j = 0; j < NKC; j++) {
      const i = b * NKC + j;
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
    mi.cull = false;                                // видимість — наша перевірка з кривизною (AABB меша — без неї)
    G.root.addChild(node); G.layers.world.addMeshInstances([mi]);
    const bytes = mesh.pos.length * 4 + mesh.pos.length * 4 + mesh.pos.length / 3 * 4 + mesh.idx.byteLength;
    stats.gpuBytes += bytes;
    // коробка плитки (відносно її кута x0, y0; z — світу): відсікання закритого
    const P = mesh.pos, bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { const v = P[i + a]; if (v < bb[a]) bb[a] = v; if (v > bb[a + 3]) bb[a + 3] = v; }
    return { mi, node, bytes, bb };
  };
  const dropFar = (e) => { G.layers.world.removeMeshInstances([e.mi]); e.mi.destroy(); G.root.removeChild(e.node); stats.gpuBytes -= e.bytes; };
  let farShown = [];

  // ---- небо: уніформи (sky-shader.js) через dev.scope ----
  const sc = dev.scope, U = (k) => sc.resolve(k);
  const wrapN = (v) => ((v % 256) + 256) % 256;      // період шуму неба (sky-shader.js): зсув хмар — без великих чисел
  const SU = Object.fromEntries(['uZen', 'uHor', 'uDuskDir', 'uDusk', 'uSun[0]', 'uSunCol[0]', 'uSunSp[0]', 'uSunSh[0]', 'uMoon[0]', 'uMoonCol[0]', 'uMoon2[0]', 'uMoonA[0]', 'uMoonB[0]', 'uNSun', 'uNMoon', 'uDay', 'uStars', 'uCel', 'uRing', 'uRingCol', 'uPole', 'uCloud', 'uCloudCol', 'uFlash', 'uAur', 'uAurCol', 'uAurG', 'uFwd', 'uCloudC', 'uCloudMap', 'uMet[0]', 'uMetB[0]', 'uNMet', 'eco_bakeK', 'uHz[0]'].map((k) => [k, U(k)]));
  const hzOf = createHorizon();                      // справжній обрій з ока (js/env/horizon.js)
  const sun4 = new Float32Array(12), sunC = new Float32Array(12), sunSp = new Float32Array(12), sunSh = new Float32Array(12), moon4 = new Float32Array(16), moonC = new Float32Array(16), moon2 = new Float32Array(16), moonA = new Float32Array(16), moonB = new Float32Array(16), cel = new Float32Array(9);
  const c3 = (v) => [v[0] / 255, v[1] / 255, v[2] / 255];
  function setSky(st, bakeK) {
    SU.uZen.setValue(c3(st.zenith)); SU.uHor.setValue(c3(st.horizon)); SU.uDuskDir.setValue([...st.duskDir]);
    SU.uDusk.setValue([...c3(st.duskCol), st.dusk]);
    sun4.fill(0); sunC.fill(0); sunSp.fill(0); sunSh.fill(0); moon4.fill(0); moonC.fill(0); moon2.fill(0); moonA.fill(0); moonB.fill(0);
    // сонця й тіла — від дальшого до ближчого (сонця — а. о., тіла — радіуси планети; тіла завжди ближче за сонця): ближче
    // закриває дальше (шейдер малює по черзі, непрозорими); диск і ореол сонця — колір його прямого світла (lit); тіла
    // освітлює світло зорі поза нашим повітрям (sp, справжній кутовий радіус — півтінь) і заломлене в тіні планети (shade)
    [...st.suns].sort((a, b) => (b.dist ?? 0) - (a.dist ?? 0)).forEach((s, i) => {
      sun4.set([...s.dir, s.size], i * 4); sunC.set([...c3(s.lit || s.col), s.bright], i * 4);
      sunSp.set([...(s.sp || [0, 0, 0]), s.ang || 0], i * 4); sunSh.set([...(s.shade || [0, 0, 0]), 0], i * 4);
    });
    [...st.moons].sort((a, b) => b.D - a.D).forEach((m, i) => {
      if (i > 3) return;
      moon4.set([...m.dir, m.size], i * 4); moonC.set([...c3(m.col), m.comp || 0], i * 4);
      const Dm = 1 / Math.sin(m.size);   // тінь планети (sky-shader.js): відстань до тіла й радіус планети — у радіусах тіла
      moon2.set([...c3(m.col2 || m.col), Dm * Math.sin(m.shadow || 0)], i * 4);
      moonA.set([...(m.fa || st.pole), m.sizeK || 0], i * 4); moonB.set([...(m.fb || [1, 0, 0]), Dm], i * 4);
    });
    SU['uSun[0]'].setValue(sun4); SU['uSunCol[0]'].setValue(sunC); SU['uSunSp[0]'].setValue(sunSp); SU['uSunSh[0]'].setValue(sunSh); SU['uMoon[0]'].setValue(moon4); SU['uMoonCol[0]'].setValue(moonC); SU['uMoon2[0]'].setValue(moon2);
    SU['uMoonA[0]'].setValue(moonA); SU['uMoonB[0]'].setValue(moonB);
    SU.uNSun.setValue(st.suns.length); SU.uNMoon.setValue(Math.min(4, st.moons.length));
    SU.uDay.setValue(st.day); SU.uStars.setValue([st.stars, st.starHue]);
    cel.set(st.cel); SU.uCel.setValue(cel);
    const rg = st.rings;
    SU.uRing.setValue([rg ? rg.r0 : 0, rg ? rg.r0 + rg.w : 0, rg ? rg.alpha : 0, rg ? rg.bands : 0]);
    SU.uRingCol.setValue(rg ? c3(rg.col) : [0, 0, 0]); SU.uPole.setValue([...st.pole]);
    const cl = st.cloud || { k: 0, off: [0, 0], dark: 0, col: [255, 255, 255] };
    SU.uCloud.setValue([cl.k, wrapN(cl.off[0]), wrapN(cl.off[1]), cl.dark]); SU.uCloudCol.setValue(c3(cl.col)); SU.uFlash.setValue(st.flash || 0);
    const au = st.aurora || { pole: [0, 1], k: 0, t: 0, col: [0, 0, 0], dist: 0, R: 6371, width: 150 };
    SU.uAur.setValue([au.pole[0], au.pole[1], au.k, au.t % 25600]); SU.uAurCol.setValue(c3(au.col));   // час: ×0,01 / 0,02 / 0,05 / 0,1 — кратні періоду шуму 256
    SU.uAurG.setValue([au.dist, au.R, au.width, 0]);
    SU.eco_bakeK.setValue(bakeK);
  }
  // Карта часових аномалій (М10): ваги (повільна, швидка) 64×64 на 256 м навколо цілі, кут — на ґратці 4 м (зсув не
  // міняє вибірки); перерахунок після зсуву > 16 м чи нового всесвіту; без аномалій — вимкнено (eco_tanom.z = 0)
  const TMN = M.TANOM_N, TMS = 256, TMC = TMS / TMN, tmBuf = new Uint8Array(TMN * TMN * 2), ta4 = new Float32Array([1, 1, 0, TMS]), taO = new Float32Array(2);
  let tmAt = { L: null, x0: 0, y0: 0 };
  function tanomMap(L, x, y) {
    const A = L.tanom;
    ta4[2] = A ? 1 : 0;
    if (!A) return;
    const x0 = Math.floor((x - TMS / 2) / TMC) * TMC, y0 = Math.floor((y - TMS / 2) / TMC) * TMC;
    if (L !== tmAt.L || Math.abs(x0 - tmAt.x0) > 16 || Math.abs(y0 - tmAt.y0) > 16) {
      for (let j = 0; j < TMN; j++) for (let i = 0; i < TMN; i++) {
        const o = (j * TMN + i) * 2;
        if (i === 0 || j === 0 || i === TMN - 1 || j === TMN - 1) { tmBuf[o] = tmBuf[o + 1] = 0; continue; }
        const T = timeK(L, x0 + (i + 0.5) * TMC, y0 + (j + 0.5) * TMC);
        tmBuf[o] = Math.round(255 * T.ws); tmBuf[o + 1] = Math.round(255 * T.wf);
      }
      M.setTanomMap(tmBuf); tmAt = { L, x0, y0 };
    }
    ta4[0] = A.ks; ta4[1] = A.kf;
    taO[0] = tmAt.x0 - G.O[0]; taO[1] = tmAt.y0 - G.O[1];
  }
  // Карта хмар неба (М8): хмарність погоди 64×64 клітинки навколо камери до обрію — клітинка q ∈ (−1, 1)² — точка шару
  // хмар p = q·A / (1 − |q|) (шейдер: q = p / (|p| + A)); біля зеніту клітинка ~190 м, на 6 км ~0,8 км, далі ширшає
  // (до 12.10.2026 — квадрат ±6 км, за ним — хмарність у точці гравця: хмари обривались прямою лінією на 7,6° над
  // обрієм). Оновлюється частинами (2 рядки за кадр) не частіше разу на секунду чи після зсуву > 200 м; новий всесвіт —
  // одразу вся
  const CM = 64, CMA = 3000, CMH = CLOUD_H, cmBuf = new Uint8Array(CM * CM), cmP = new Float32Array(CM * CM * 2);
  for (let j = 0; j < CM; j++) for (let i = 0; i < CM; i++) {
    const qx = (i + 0.5) / CM * 2 - 1, qy = (j + 0.5) / CM * 2 - 1, q = Math.hypot(qx, qy), k = CMA / (1 - Math.min(q, 0.995));
    cmP[(j * CM + i) * 2] = qx * k; cmP[(j * CM + i) * 2 + 1] = qy * k;
  }
  const cmTex = new pc.Texture(dev, { width: CM, height: CM, format: pc.PIXELFORMAT_R8, mipmaps: false, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
  SU.uCloudMap.setValue(cmTex);
  let cmJob = null, cmRow = CM, cmAt = { L: null, x: 0, y: 0, t: -1e9 };
  function cloudMap(L, clock, x, y, now) {
    if (cmRow >= CM && (L !== cmAt.L || now - cmAt.t > 1000 || Math.hypot(x - cmAt.x, y - cmAt.y) > 200)) { cmJob = { L, clock, x, y, t: now }; cmRow = 0; }
    if (cmRow < CM) {
      const J = cmJob, last = J.L !== cmAt.L ? CM : Math.min(CM, cmRow + 2);
      for (; cmRow < last; cmRow++) for (let i = 0; i < CM; i++)
        cmBuf[cmRow * CM + i] = Math.round(255 * cloudsAt(J.L, J.clock, J.x + cmP[(cmRow * CM + i) * 2], J.y + cmP[(cmRow * CM + i) * 2 + 1]));
      if (cmRow >= CM) { const a = cmTex.lock(); a.set(cmBuf); cmTex.unlock(); cmAt = J; }
    }
    SU.uCloudC.setValue([x - cmAt.x, y - cmAt.y, CMA, CMH]);
  }
  // Метеори (до 4) і розряд блискавки з його світлом (точкове без тіні)
  const met4 = new Float32Array(16), metB = new Float32Array(16), bolts = createBolts(G);
  let boltLight = null;
  function meteors(L, clock, night) {
    const M = meteorsAt(L, clock, night);
    met4.fill(0); metB.fill(0);
    M.forEach((m, i) => { met4.set([...m.a, m.t], i * 4); metB.set([...m.b, m.k], i * 4); });
    SU['uMet[0]'].setValue(met4); SU['uMetB[0]'].setValue(metB); SU.uNMet.setValue(M.length);
  }
  function bolt(B, clock, eye) {
    if (!B) { bolts.hide(); if (boltLight) boltLight.set({ enabled: false }); return; }
    const k = Math.max(0, 1 - (clock - B.t0) / 0.25) * B.k;
    bolts.show(boltSegs(B), eye, k);
    if (!boltLight) boltLight = LG.addLight({ type: 'omni', pos: [B.x, B.y, B.z + 60], color: [0.8, 0.86, 1], intensity: 0, range: 500, castShadows: false, moving: true });
    boltLight.set({ pos: [B.x, B.y, B.z + 60], intensity: 6 * k, enabled: true });
  }
  const lin = (c) => (c / 255) ** 2.2, lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const sig = new Float32Array(12);

  let forceBake = false;                         // ?dev: розсіяне — запекти в наступному кадрі (знімки на годиннику, що стоїть)
  let cullOn = true, shownU = null, lastCol = '', lastRad = 0, lawsKey = null;
  const M4 = new pc.Mat4(), Q = new pc.Quat(), V3 = new pc.Vec3(), engRegs = [];
  let linesPC = new Float32Array(0);
  const underBg = new pc.Color(), BLACK = new pc.Color(0, 0, 0);
  const dirsBuf = [], cutF = new Float32Array(4), cut2 = new Float32Array(4), cut3 = new Float32Array(2), eyePC = new Float32Array(3), tgtPC = new Float32Array(3), wind4 = new Float32Array(4), fade2 = new Float32Array(2), thin2 = new Float32Array(2), xfade2 = new Float32Array(2);
  const viewC = { m: null, eye: null, ud: null, t: null, c: 0 };
  let next = null;
  G.onFrame(function loop(ts) { const f = next; next = null; if (f) f(ts); G.onFrame(loop); });

  const R = {
    get gpuMs() { return G.R.gpuMs; }, get gpuPass() { return G.R.gpuPass; }, get cpuRenderMs() { return G.R.cpuRenderMs; },
    get gpuHist() { return G.R.gpuHist; }, get gpuHistI() { return G.R.gpuHistI; }, set gpuHistI(v) { G.R.gpuHistI = v; },
    stats,
    get width() { return G.width; }, get height() { return G.height; },
    get cullOn() { return cullOn; },
    // Великі рослини зблизька без дизерингу (bigSafe): false — усе матеріалом fl (порівняння)
    setFlSplit(on) { flSplit = !!on; },
    // Тіні (порівняння): tight — кидач лише в каскади, куди його тінь може впасти; lod — тіні за відстанню (дальні каскади —
    // спрощені дерева й прості тіла малих рослин); sched — дальні каскади не щокадру. Без аргументів — поточні
    shadowOpt({ tight, lod, sched } = {}) {
      if (tight !== undefined) RG.tight = tight;
      if (lod !== undefined && !!lod !== shLod) {
        shLod = !!lod; CASTERS[C_BIG].cascades = shLod ? SH_NEAR : SH_ALL;
        for (const Un of unis.values()) for (const Gr of Un.regions.values()) Gr.shDirty = true;
      }
      if (sched !== undefined) LG.schedule = sched;
      return { tight: RG.tight, lod: shLod, sched: LG.schedule };
    },
    setCull(on) { cullOn = !!on; for (const k of CULLED) { mats[k].cull = cullOn ? pc.CULLFACE_BACK : pc.CULLFACE_NONE; mats[k].update(); } },
    get info() { return { ...G.info, shadows: LG.quality, lights: LG.info() }; },
    app,
  };

  return {
    R, G, LG,
    raf(f) { next = f; },
    rebake() { forceBake = true; },
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
        else { putFlora(d, n, k, q, data, mesh); b += mesh.n * 16; }
        i++;
      }
      if (upHead === upQ.length) { upQ.length = 0; upHead = 0; } else if (upHead > 4096) { upQ.splice(0, upHead); upHead = 0; }
    },
    // ?dev: усе з черги — в арени, потім секції й рослини зблизька кожного всесвіту — заново в порядку ключів, перемішаних
    // зерном seed, плитки далечі — у шар у тому самому порядку: порядок малювання не залежить від того, у якому порядку
    // прийшли роботи генератора (попіксельні порівняння версій, test/pixels.mjs). Рослини, що не вмістились, — як порожні
    canon(seed = 0) {
      while (upHead < upQ.length) this.pump(1 << 30);
      const mix = (k) => {
        if (typeof k === 'string') { let h = 2166136261; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619); k = h >>> 0; }
        let x = (k % 4294967296) ^ Math.imul(Math.floor(k / 4294967296) | 0, 0x9e3779b1) ^ Math.imul(seed + 1, 0x85ebca6b);
        x = Math.imul(x ^ (x >>> 16), 0x7feb352d); x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
        return (x ^ (x >>> 16)) >>> 0;
      };
      const byKey = (a, b) => mix(a[0]) - mix(b[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      for (const Un of [...unis.values()]) {
        const secs = [], fls = [], empty = [];
        for (const Gr of Un.regions.values()) {
          const op = Gr.R.ar.op, lq = Gr.R.ar.liq, fa = Gr.R.ar.fl;
          for (const [k, E] of Gr.secs) for (let lod = 0; lod < 3; lod++) {
            const sl = E.L[lod];
            if (!sl) continue;
            const mesh = { ns: sl.ns, nf: sl.nf, nc: sl.nc, nl: sl.nl, bb: sl.bb, lbb: sl.lbb, op: null, liq: null };
            if (sl.off >= 0) mesh.op = op.u8.slice(sl.off * 16, (sl.off + sl.ns + sl.nf + sl.nc) * 16); else mesh.ns = mesh.nf = mesh.nc = 0;
            if (sl.loff >= 0) mesh.liq = lq.u8.slice(sl.loff * 16, (sl.loff + sl.nl) * 16); else mesh.nl = 0;
            secs.push([k, { cx: E.cx, cy: E.cy, cz: E.cz, lod }, mesh]);
          }
          for (const [k, f] of Gr.fls) {
            const n = f.off < 0 ? 0 : f.n + f.np;
            fls.push([k, { cx: f.cx, cy: f.cy }, { rz: Gr.rz }, { n, nb: f.nb, np: f.np, ob: f.ob, bb: f.bb, fl: n ? fa.u8.slice(f.off * 16, (f.off + n) * 16) : null }]);
          }
        }
        for (const [k, Gr] of Un.flora) if (Gr === null) empty.push(k);
        const { d, n } = Un;
        dropUni(Un);
        secs.sort(byKey); fls.sort(byKey);
        for (const [k, q, mesh] of secs) putSection(d, n, k, q, mesh);
        for (const [k, q, data, mesh] of fls) putFlora(d, n, k, q, data, mesh);
        const U2 = uni(d, n, true);
        for (const k of empty) U2.flora.set(k, null);
      }
      const fs = [...fars].sort(byKey);
      fars.clear();
      for (const [k, e] of fs) { G.layers.world.removeMeshInstances([e.mi]); G.layers.world.addMeshInstances([e.mi]); fars.set(k, e); }
      return { secs: [...unis.values()].reduce((a, V) => a + V.slots.size, 0), far: fars.size };
    },
    // Нестача пам'яті GPU (подія 'oom' застосунку): звільнити все, крім всесвіту на екрані
    releaseOthers() { for (const V of [...unis.values()]) if (V !== shownU) dropUni(V); },
    onOutOfMemory(f) { G.on('oom', f); },
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
    // Повна будова предмета-цілі (робота 'obj'): для обрису
    addObj(key, mesh) {
      if (!mesh || !mesh.pos.length) return;
      // кеш тримає своє посилання: MeshInstance.destroy() (заміна обрису) знищує меш, на який більше ніхто не посилається
      if (objMeshes.size >= 8) { const [k0, m0] = objMeshes.entries().next().value; if (k0 !== outKey) { m0.decRefCount(); if (m0.refCount < 1) m0.destroy(); objMeshes.delete(k0); } }
      const m = floatMesh(G, mesh, { matW: true });
      m.incRefCount();
      objMeshes.set(key, m);
    },
    hasObj: (key) => objMeshes.has(key),
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
      return { ...viewProj(camera, G.width, G.height, dist), rad: VIEW_R, fog: [0.3 * FAR_R, 0.97 * FAR_R] };
    },

    // st: {camera, target, view, laws, clock, weather ({W, loc}), rain ({x0, y0}), far, bodies, skyLight(x, y, z) — AO неба тіл (світло неба),
    // lamp — ліхтарик {pos, dir, shadow} чи null (js/player/lamp.js),
    // me {x, y, z, yaw, swim, anim, ao — AO неба фігури}}.
    // Повертає стан неба (sky.js) — для HUD
    draw(st) {
      frame++;
      // числа минулого кадру: виклики, тіні (кидачі й трикутники, що пішли в каскади)
      stats.up = stats.upBytes; stats.upBytes = 0; stats.draws = G.R.draws;
      let shTris = 0, shDraws = 0, shSub = 0;
      stats.camSub = stats.sub || 0; stats.sub = 0;
      for (const s of LG.slots) if (s.on && s.l.castShadows) for (let c = 0; c < s.l.numCascades; c++) {
        if (s === LG.slots[0] && !(LG.lastCascades >> c & 1)) continue;     // каскад не оновлювався
        const rd = s.l.light.getRenderData(cam.camera, c);
        for (const m of rd.visibleCasters) { shDraws++; shSub += m.shN || 1; shTris += (m.shV ?? m.mesh.primitive[0].count) / 3; }
      }
      stats.shTris = shTris; stats.shDraws = shDraws; stats.shSub = shSub;
      // тінь ліхтарика (прожектор: дані рендеру спільні для камер — null, shadow-renderer-local.js)
      let lTris = 0, lDraws = 0;
      if (lampL && lampL.e.enabled && lampL.e.light.castShadows && LG.quality !== 'off') {
        for (const m of lampL.e.light.light.getRenderData(null, 0).visibleCasters) { lDraws++; lTris += (m.shV ?? m.mesh.primitive[0].count) / 3; }
      }
      stats.lampTris = lTris; stats.lampDraws = lDraws;

      const { target: t, view, laws } = st, sk = skyState(laws, st.clock || 0), wt = st.weather;
      const curve = laws.phys ? 0.5 / laws.phys.planetR : 0;   // кривизна (шейдер опускає світ на curve·d², d — від цілі)
      if (wt) applyWeather(sk, laws, wt.W);
      const vk = sk.visK ?? 1, first = st.camera.mode === FIRST, lodOn = LOD_ON;
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
      const slots = lightSlots(laws);
      if (fresh) { lawsKey = tk; LG.setDirectionalCount(slots); LG.invalidate(); }
      const lt = (st.clock || 0) * (laws.phys ? laws.phys.time : 1);   // фази вітру й плину загортає materials.js setFrame

      // плаваючий початок (регіони, світла, плитки — на подію 'origin')
      if (G.setOrigin(t)) for (const f of farShown) f.e.node.setLocalPosition(f.x0 - G.O[0], f.y0 - G.O[1], 0);
      // камера: око й осі (basis: r — праворуч, up — угору, u — до ока) у PlayCanvas (x, z, y)
      const e = view.eye;
      camE.setPosition(G.toPC(t[0] + e[0], t[1] + e[1], t[2] + e[2], V3));
      M4.data.set([b.r[0], b.r[2], b.r[1], 0, b.up[0], b.up[2], b.up[1], 0, b.u[0], b.u[2], b.u[1], 0, 0, 0, 0, 1]);
      camE.setRotation(Q.setFromMat4(M4));
      // ближня площина: кут її прямокутника (fov — по вертикалі) ближче до ока, ніж поверхня (CAM_R − 0,01, camera.js), —
      // інакше в тісноті площина зрізає стіну й у кадрі видно, що за нею; на дуже широкому екрані — ближче
      const th = Math.tan(fovOf(st.camera) / 2), kc = Math.sqrt(1 + th * th * (1 + (G.width / G.height) ** 2));
      cam.fov = fovOf(st.camera) / Math.PI * 180; cam.nearClip = Math.min(first ? 0.05 : 0.1, 0.9 * (CAM_R - 0.01) / kc); cam.farClip = FAR_R * 1.6;

      // Світло: сонця й місяці — напрямлені (лінійні сили з законів, lightsOf); розсіяне — з неба (envAtlas), каліброване
      // так, щоб верх при сонці на REF_Z дав колір палітри; мінімум — емісією
      const Lt = lightsOf(sk, slots);
      for (let i = 0; i < slots; i++) {
        const l = Lt.dirs[i];
        LG.setDirectional(i, l ? { dir: l.dir, color: l.col, intensity: pcIntensity(l.k) } : null);
      }
      LG.setShadowDistance(SHADOW_D);
      LG.prepare();                                   // зрізи каскадів кадру (кидачі, розклад оновлення)
      // ліхтарик: до відбору кидачів (його куля вмикає кидачів у цьому кадрі); тінь — лише в третій особі (st.lamp.shadow)
      const lp = st.lamp;
      if (lp) {
        if (!lampL) lampL = LG.addLight({ type: 'spot', pos: lp.pos, dir: lp.dir, color: LAMP.color, intensity: LAMP.intensity, range: LAMP.range, inner: LAMP.inner, outer: LAMP.outer, castShadows: false, moving: true, bias: LAMP.bias, normalBias: LAMP.normalBias, layers: [G.layers.world.id, G.layers.shadow.id, G.layers.arms.id] });
        lampL.set({ pos: lp.pos, dir: lp.dir, castShadows: lp.shadow && LG.quality !== 'off', enabled: true });
      } else if (lampL && lampL.e.enabled) lampL.set({ enabled: false });
      // небо в запіканні — не темніше 0,02 (sky-shader.js): без повітря вночі воно чорне, а розсіяне — з lightsOf
      const fl = (c) => c.map((v) => Math.max(v, 0.02 * 255));
      const bakeK = Lt.amb / Math.max(1e-4, 0.6 * lum(fl(sk.zenith)) + 0.4 * lum(fl(sk.horizon)));
      setSky(sk, bakeK);
      SU.uFwd.setValue([-b.u[0], -b.u[1], -b.u[2]]);   // погляд камери: диски світил — у площині кадру (sky-shader.js)
      SU['uHz[0]'].setValue(hzOf(laws, t[0] + e[0], t[1] + e[1], t[2] + e[2], curve > 0 ? laws.phys.planetR : 0, FAR_R));
      cloudMap(laws, st.clock || 0, t[0] + view.eye[0], t[1] + view.eye[1], performance.now());
      meteors(laws, st.clock || 0, 1 - sk.day);
      bolt(st.bolt, st.clock || 0, [t[0] + view.eye[0], t[1] + view.eye[1], t[2] + view.eye[2]]);
      const cl = sk.cloud ? sk.cloud.k : 0, d0 = sk.duskDir;
      sig.set([d0[0], d0[1], d0[2], ...c3(sk.zenith), ...c3(sk.horizon), sk.dusk, cl, Math.log2(bakeK + 1e-6) / 10]);
      sky.maybeBake(sig, fresh || forceBake); forceBake = false;
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
      wind4[0] = wt ? wt.W.wind[0] * wk : 0; wind4[1] = wt ? wt.W.wind[1] * wk : 0;
      tgtPC[0] = t[0] - G.O[0]; tgtPC[1] = t[2]; tgtPC[2] = t[1] - G.O[1];
      eyePC[0] = tgtPC[0] + e[0]; eyePC[1] = tgtPC[1] + e[2]; eyePC[2] = tgtPC[2] + e[1];
      const camD = Math.hypot(...e);
      thin2[0] = FLORA_THIN * (FLORA_NEAR - FLORA_FADE); thin2[1] = FLORA_NEAR - FLORA_FADE;   // трава й квіти рідшають до смуги переходу
      xfade2[0] = FLORA_NEAR - FLORA_FADE; xfade2[1] = FLORA_NEAR;
      // розчинення рослин біля ока й «вікно» крізь те, що закриває гравця, — лише в третій особі
      if (first) { fade2[0] = -2; fade2[1] = -1; } else { fade2[0] = Math.min(1, camD * 0.3); fade2[1] = Math.max(2.5, camD * 0.65); }
      let cut = null;
      cut2[3] = 0;
      if (me && !first) {
        const pcx = me.x - G.O[0], pcy = me.z + 0.45, pcz = me.y - G.O[1];
        const d = Math.hypot(pcx - eyePC[0], pcy - eyePC[1], pcz - eyePC[2]) || 1;
        cutF[0] = pcx; cutF[1] = pcy; cutF[2] = pcz;
        cutF[3] = Math.cos(Math.atan(0.7 * 0.75 / d)); cut3[0] = Math.cos(Math.atan(0.7 * 2.4 / d)); cut2[3] = 1;
        cut3[1] = me.z + 0.6;
        // секції для матеріалу з вирізом — за колом на екрані навколо гравця (вибір; виріз — у шейдері)
        const pt = [me.x - t[0], me.y - t[1], me.z + 0.45 - t[2]], p = project(m, pt, G.width, G.height);
        const q = p && project(m, [pt[0] + b.r[0] * 0.7, pt[1] + b.r[1] * 0.7, pt[2]], G.width, G.height);
        if (p && q) cut = { x: p[0], y: p[1], r: Math.hypot(q[0] - p[0], q[1] - p[1]) * 2.4, depth: p[2] };
      }
      // зони, де fl відкидає пікселі (bigSafe): усе — відносно цілі, у наших осях
      fz.ex = e[0]; fz.ey = e[1]; fz.ez = e[2]; fz.far = xfade2[0] - FZ_M;
      fz.drop = curve * FLORA_NEAR * FLORA_NEAR;
      fz.fade = fade2[1] > 0 ? fade2[1] + FZ_M : 0;
      fz.cut = cut2[3] > 0.5;
      if (fz.cut) {
        fz.px = me.x - t[0]; fz.py = me.y - t[1]; fz.pz = me.z + 0.45 - t[2];
        fz.dP = Math.hypot(fz.px - fz.ex, fz.py - fz.ey, fz.pz - fz.ez) || 1;
        fz.knee = cut3[1] - t[2] - FZ_M;
        fz.ang = Math.acos(cut3[0]) + 0.02;
      }
      tanomMap(laws, t[0], t[1]);
      M.setFrame({ tanom: ta4, tanomO: taO, wind: wind4, curve, target: tgtPC, seam: SEAM, time: lt, minLight: Lt.min, eye: eyePC, fade: fade2, cut: cutF, cut2, cut3, thin: thin2, xfade: xfade2 });

      // Видимі регіони й діапазони в них
      const farOn = !!(st.far && st.far.length), rad = view.rad, Un = uni(laws.d, laws.n);
      // відсікання закритого (js/render/occlusion.js): регіони, секції, рідина, рослини й плитки далечі, закриті заслонами з
      // секцій, що малюються, — не малюємо; тіні — як були (тінь закритого може впасти на видиме)
      const occ = st.occ, occOn = !!occ && occ.begin([t[0] + e[0], t[1] + e[1], t[2] + e[2]], laws.d, laws.n, m, t, curve, G.width / G.height);
      const seen = (ox, oy, oz, c) => !occOn || occ.box(t[0] + ox + c[0], t[1] + oy + c[1], t[2] + oz + c[2], t[0] + ox + c[3], t[1] + oy + c[4], t[2] + oz + c[5]);
      // коробка c (від кута ox, oy, oz відносно цілі) у полі зору й не закрита; перевірка відсікання закритого — і піраміда
      // видимості (з тими самими кутами), тож окремої не треба
      const vis = (inside, ox, oy, oz, c) => occOn ? seen(ox, oy, oz, c) : inside || aabbInView(m, ox + c[0], oy + c[1], oz + c[2], ox + c[3], oy + c[4], oz + c[5], curve);
      LN.fill(0); visRegs.length = 0;
      if (Un !== shownU) {
        if (shownU && !shownU.dead) for (const Gr of shownU.regions.values()) RG.hide(Gr.R);
        if (Un) for (const Gr of Un.regions.values()) Gr.shDirty = true;
        shownU = Un;
      }
      const colK = `${Math.floor(t[0] / CS)},${Math.floor(t[1] / CS)}`;
      if (Un && (colK !== lastCol || rad !== lastRad)) { lastCol = colK; lastRad = rad; for (const Gr of Un.regions.values()) if (horiz(Gr, t) < FLORA_NEAR + 2 * CS) Gr.shDirty = true; }
      let tris = 0, flTris = 0, flbTris = 0;
      if (Un) {
        Un.drawn = frame; Un.at = performance.now();
        for (const Gr of Un.regions.values()) {
          const ox = Gr.rx * RW - t[0], oy = Gr.ry * RW - t[1], oz = Gr.rz * RH - t[2];
          const nx = ox > 0 ? ox : ox + RW < 0 ? -(ox + RW) : 0, ny = oy > 0 ? oy : oy + RW < 0 ? -(oy + RW) : 0;
          Gr.vis = false;
          if (Math.hypot(nx, ny) > rad + 4) continue;
          const bb = Gr.bb;
          if (!(bb[0] <= bb[3]) || !aabbInView(m, ox + bb[0], oy + bb[1], oz + bb[2], ox + bb[3], oy + bb[4], oz + bb[5], curve)) continue;
          Gr.inside = aabbInside(m, ox + bb[0], oy + bb[1], oz + bb[2], ox + bb[3], oy + bb[4], oz + bb[5], curve);
          Gr.dist = Math.hypot(nx, ny); Gr.ox = ox; Gr.oy = oy; Gr.oz = oz;
          visRegs.push(Gr);
        }
        visRegs.sort((a, c) => a.dist - c.dist);
        // заслони — із секцій, чий меш у відеокарті й малюється на цій відстані (повна секція, до шва далечі)
        if (occOn) {
          const ex = e[0], ey = e[1], oR2 = occ.params.radius ** 2;
          for (const Gr of visRegs) {
            // регіон далі радіуса заслонів від ока — пропустити цілим
            const rx = Gr.ox - ex, ry = Gr.oy - ey, hx = rx > 0 ? rx : rx + RW < 0 ? -(rx + RW) : 0, hy = ry > 0 ? ry : ry + RW < 0 ? -(ry + RW) : 0;
            if (hx * hx + hy * hy > oR2) continue;
            for (const E of Gr.secs.values()) {
              const sl = E.L[0];
              if (!sl || sl.off < 0 || !sl.ns) continue;
              const sx = E.cx * CS - t[0] - ex, sy = E.cy * CS - t[1] - ey, qx = sx > 0 ? sx : sx + CS < 0 ? -(sx + CS) : 0, qy = sy > 0 ? sy : sy + CS < 0 ? -(sy + CS) : 0;
              if (qx * qx + qy * qy > oR2) continue;
              const dn = colDist(E.cx, E.cy, t);
              if (dn > rad || (farOn && dn > SEAM)) continue;
              occ.add(E.cx, E.cy, E.cz);
            }
          }
          occ.end();
          let w = 0;
          for (const Gr of visRegs) if (seen(Gr.ox, Gr.oy, Gr.oz, Gr.bb)) visRegs[w++] = Gr;
          visRegs.length = w;
        }
        for (const Gr of visRegs) { Gr.drawn = frame; Gr.vis = true; }
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
              if (vis(inside, ox, oy, oz, c)) {
                // є повні рослини: стовпець увесь до смуги переходу — спрощених не малюємо, у смузі — проступають (objF)
                const fx = lod === 0 && dn < FLORA_NEAR && nearFlora(Un, ck(E.cx, E.cy));
                const nf = fx && colFar(ax, ay) < FLORA_NEAR - FLORA_FADE ? 0 : sl.nf;
                const nc = lod > 0 && (lod !== want || dn < LOD_R[lod - 1] + LOD_CAP) ? sl.nc : 0;
                // «вікно» — лише в рослинах (камера з землею зіштовхується — лінія до гравця вільна, а вікно в землі лише
                // прорізало б стіни біля камери в тісній печері)
                const j = ring ? L_RING : L_PLAIN;
                const jc = !ring && cut && dn <= camD + 8 && cutHit(m, cut, ox + c[0], oy + c[1], oz + c[2], ox + c[3], oy + c[4], oz + c[5], curve) ? L_CUT : j;
                if (sl.ns) pushR(j, seg[j * 2], sl.off, sl.ns);
                if (nc) pushR(j, seg[j * 2], sl.off + sl.ns + sl.nf, nc);
                if (nf) { const jo = fx ? L_OBJF : L_OBJ + jc; pushR(jo, seg[jo * 2], sl.off + sl.ns, nf); }
              }
            }
            if (sl.loff >= 0 && sl.lbb) {
              const c = sl.lbb;
              if (vis(inside, ox, oy, oz, c)) pushR(ring ? L_LIQR : L_LIQ, seg[(ring ? L_LIQR : L_LIQ) * 2], sl.loff, sl.nl);
            }
          }
          for (const f of Gr.fls.values()) {
            if (f.off < 0 || !f.n) continue;
            if (colDist(f.cx, f.cy, t) >= FLORA_NEAR) continue;
            const c = f.bb;
            if (!vis(inside, ox, oy, oz, c)) continue;
            if (!flSplit || !f.nb) { pushR(L_FL, seg[L_FL * 2], f.off, f.n); continue; }
            // великі: увесь стовпець поза зонами — одним діапазоном, інакше — кожен предмет за своєю коробкою
            if (bigSafe(ox + c[0], oy + c[1], oz + c[2], ox + c[3], oy + c[4], oz + c[5])) pushR(L_FLB, seg[L_FLB * 2], f.off, f.nb);
            else {
              const ob = f.ob;
              for (let i = 0; i < ob.length; i += 8) {
                const j = bigSafe(ox + ob[i + 2], oy + ob[i + 3], oz + ob[i + 4], ox + ob[i + 5], oy + ob[i + 6], oz + ob[i + 7]) ? L_FLB : L_FL;
                pushR(j, seg[j * 2], f.off + ob[i], ob[i + 1]);
              }
            }
            if (f.n > f.nb) pushR(L_FL, seg[L_FL * 2], f.off + f.nb, f.n - f.nb);
          }
          for (let j = 0; j < NL; j++) seg[j * 2 + 1] = LN[j];
        }
        // сітки регіонів: команди камери — видимі діапазони; кидачі — блоками (перебудова при змінах)
        for (const Gr of Un.regions.values()) {
          if (Gr.shDirty) buildCasters(Un, Gr, t);
          for (const k in KINDS) {
            const j = KINDS[k][2], a = Gr.vis ? Gr.seg[j * 2] : 0, z = Gr.vis ? Gr.seg[j * 2 + 1] : 0;
            const n3 = RG.setCamera(Gr.R, k, LF[j], LC[j], a, z) / 3;
            tris += n3;
            if (j === L_FLB) flbTris += n3; else if (j === L_FL) flTris += n3;
          }
        }
      }
      // кидачі на кадр — лише ті, чия тінь може впасти в поле зору (regions.cullCasters)
      viewC.m = m; viewC.eye = e; viewC.ud = b.u; viewC.t = t; viewC.c = curve;
      engRegs.length = 0;
      if (Un) for (const Gr of Un.regions.values()) engRegs.push(Gr.R);
      LG.cascades(frame, dynCascades(st, t, e, b.u));
      RG.cullCasters(engRegs, viewC, LG.dirs(dirsBuf), LG.locals());

      // Далечінь: плитки поверхні — лише за швом
      for (const s of farShown) s.e.mi.visible = false;
      farShown.length = 0;
      if (farOn) for (const f of st.far) {
        const fe = fars.get(f.key);
        if (!fe) continue;
        fe.used = frame;
        if (occOn ? !occ.box(f.x0 + fe.bb[0], f.y0 + fe.bb[1], fe.bb[2], f.x0 + fe.bb[3], f.y0 + fe.bb[4], fe.bb[5])
          : !aabbInView(m, f.x0 - t[0] + fe.bb[0], f.y0 - t[1] + fe.bb[1], fe.bb[2] - t[2], f.x0 - t[0] + fe.bb[3], f.y0 - t[1] + fe.bb[4], fe.bb[5] - t[2], curve)) continue;
        fe.node.setLocalPosition(f.x0 - G.O[0], f.y0 - G.O[1], 0); fe.mi.visible = true;
        farShown.push({ key: f.key, e: fe, x0: f.x0, y0: f.y0 });
        tris += fe.mi.mesh.primitive[0].count / 3;
      }
      if (occOn) occ.finish();
      // рівні, які вже не потрібні (є потрібний, за гістерезисом), — звільнити
      if (Un) for (let i = 0; i < trim.length; i += 2) removeSlot(Un, trim[i], trim[i + 1]);
      trim.length = 0;
      if (frame % 60 === 0) maintain(Un, t, rad, laws, st.charge);

      // Тіла (ширяюче каміння): групи екземплярів за шаблоном; низ коробки — основа шаблону
      for (const g of tmpl.values()) { g.n = 0; g.d = 0; }
      if (st.bodies) for (const bo of st.bodies) {
        const r = Math.max(bo.hx, bo.hy, bo.hz) * 2, x = (bo.ix ?? bo.x) - t[0], y = (bo.iy ?? bo.y) - t[1], z = (bo.iz ?? bo.z) - t[2];
        if (!aabbInView(m, x - r, y - r, z - r, x + r, y + r, z + r, curve)) continue;
        const g = group(bo.T);
        const d = Math.hypot(x, y) + r;
        if (d > g.d) g.d = d;
        if (g.buf.length < (g.n + 1) * 16) { const a = new Float32Array(g.buf.length * 2); a.set(g.buf); g.buf = a; }
        // rotZ(yaw) · rotX(tilt) · масштаб, як у старому шейдері екземплярів
        const c = Math.cos(bo.yaw), s = Math.sin(bo.yaw), ct = Math.cos(bo.tilt), stl = Math.sin(bo.tilt), k = bo.s;
        m16.set([c * k, s * k, 0, 0, -s * ct * k, c * ct * k, stl * k, 0, s * stl * k, -c * stl * k, ct * k, 0, bo.ix ?? bo.x, bo.iy ?? bo.y, (bo.iz ?? bo.z) - bo.hz, 1]);
        G.matToPC(m16, g.buf, g.n * 16);
        g.buf[g.n * 16 + 3] = st.skyLight ? st.skyLight(bo.ix ?? bo.x, bo.iy ?? bo.y, bo.iz ?? bo.z) : 1;   // AO неба тіла (у матриці там 0; chunks.js)
        g.n++;
      }
      for (const g of tmpl.values()) { g.inst.update(g.buf, g.n, curve * g.d * g.d); tris += g.n * g.mesh.primitive[0].count / 3; }

      // Фігура (у першій особі й з камерою впритул — лише тінь, інакше око в голові); пристрій не світиться (рішення 10.10.2026).
      // Руки першої особи — у шарі «Руки» (поверх світу, глибина очищена)
      const FP = me ? poseMatrices(me.anim, me.x - G.O[0], me.y - G.O[1], me.z, me.yaw) : null;
      if (me) fig.pose(FP);
      // AO неба фігури й рук — одне число (у float-мешах AO вершин немає): у печері й під навісом розсіяне світло неба гасне,
      // як на землі поруч
      if (me) { const ao = me.ao ?? 1; figMI.setParameter('eco_ao', ao); armsMI.setParameter('eco_ao', ao); }
      figSh.visible = !!me;
      figMI.visible = !!me && !first && camD > FIG_NEAR;
      armsMI.visible = !!me && first;
      glowMI.visible = !!lp && figMI.visible;
      if (glowMI.visible) glow.pose({ glow: FP.head });
      if (armsMI.visible) arms.pose(viewArms(me.anim, me, b, [t[0] + e[0] - G.O[0], t[1] + e[1] - G.O[1], t[2] + e[2]], G.width / G.height, fovOf(st.camera)));

      // Ціль: обрис тіла чи предмета, каркас блоку (1 × 1 × LEVEL, трохи ширше, крізь поверхню не видно)
      const aim = st.aim;
      if (aim && aim.kind === 'body' && aim.body.T) {
        const bo = aim.body, gm = group(bo.T);
        setOutline(bo, gm.mesh);
        // вузол під root — локальні координати наші (відносно O): rotZ(yaw) · rotX(tilt) · масштаб, як в екземплярах тіл
        const c = Math.cos(bo.yaw), sn = Math.sin(bo.yaw), ct = Math.cos(bo.tilt), stl = Math.sin(bo.tilt);
        M4.set([c, sn, 0, 0, -sn * ct, c * ct, stl, 0, sn * stl, -c * stl, ct, 0, 0, 0, 0, 1]);
        Q.setFromMat4(M4);
        outE.setLocalPosition((bo.ix ?? bo.x) - G.O[0], (bo.iy ?? bo.y) - G.O[1], (bo.iz ?? bo.z) - bo.hz); outE.setLocalRotation(Q); outE.setLocalScale(bo.s, bo.s, bo.s);
      } else if (aim && aim.kind === 'obj' && objMeshes.has(aim.key)) {
        setOutline(aim.key, objMeshes.get(aim.key));
        outE.setLocalPosition(aim.obj.C.cx * CS - G.O[0], aim.obj.C.cy * CS - G.O[1], 0); outE.setLocalRotation(pc.Quat.IDENTITY); outE.setLocalScale(1, 1, 1);
      } else setOutline(null, null);
      if (outKey !== null) outline.frameUpdate(G.camE, G.layers.immediate, false);
      if (aim && aim.kind === 'block') {
        const e4 = 0.004, x0 = aim.x - e4, y0 = aim.y - e4, z0 = aim.k * LEVEL - e4, x1 = aim.x + 1 + e4, y1 = aim.y + 1 + e4, z1 = (aim.k + 1) * LEVEL + e4;
        bMin.set(x0 - G.O[0], z0, y0 - G.O[1]); bMax.set(x1 - G.O[0], z1, y1 - G.O[1]);
        wire.boxMinMax(bMin, bMax);
      }

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
        const tk = timeK(laws, t[0], t[1]).k;                    // у плямі часової аномалії — повільніше чи швидше
        v.setVelocity(wt.W.wind[0] * dr * tk, wt.W.wind[1] * dr * tk, -Qp.fall * tk);
        v.setColor(loc.type === 'dust' ? [...laws.pal.desert.map((c) => c / 255 * (0.35 + 0.65 * Math.min(1, sk.lightK[1]))), 0.55] : [Qp.col[0] * lk, Qp.col[1] * lk, Qp.col[2] * lk, Qp.col[3]]);
        v.setIntensity(Math.min(1, loc.k));
      }
      stats.tris = tris; stats.flTris = flTris; stats.flbTris = flbTris;
      return sk;
    },
  };
}
