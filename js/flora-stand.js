// flora-stand.js — стенд «види рослин» (index.html?flora[&seed=…&d=…&n=…&far&small]): галерея видів, що трапляються
// в одному всесвіті (області навколо центру карти), кожен — на клаптику землі свого біому, з підписом.
// Перевірка «чи дивує»: види мають бути різні за будовою, а не перефарбовані. far — спрощені (для далечі), small — малі.
import { createApp, pc } from './engine/graphics/app.js';
import { createMaterials } from './engine/graphics/materials.js';
import { createLights } from './engine/graphics/lights.js';
import { floatMesh } from './engine/graphics/meshes.js';
import { lawsOf } from './universe.js';
import { hashStr } from './rng.js';
import { tile, T_LUSH, T_DRY, T_DESERT } from './gen/chunk.js';
import { BIOMES } from './gen/biomes.js';
import { regionAt, speciesOf, groundTint, FORMS } from './gen/flora.js';
import { template, place } from './gen/plants.js';
import { Mesh } from './gen/mesh.js';
import { texturesOf, TEX } from './textures.js';
import { LAYERS, MAT_TABLE, M_LUSH, M_DRY, M_DESERT, M_SNOW, M_ROCK, M_SAND } from './gen/materials.js';
import { createCamera, basis } from './camera.js';
import { S } from './iso.js';
import { REF_Z, MIN_LIGHT, pcIntensity } from './sky.js';

export async function runFlora() {
  const q = new URLSearchParams(location.search);
  const seedText = q.get('seed') || 'test', d = +q.get('d') || 0, n = +q.get('n') || 0, far = q.has('far'), small = q.has('small');
  const L = lawsOf(hashStr(seedText), d, n);
  document.getElementById('menu').hidden = true;
  // Збираємо види: клітинки на грубій ґратці по спіралі від центру, поки не набереться COUNT різних
  const COUNT = 96, seen = new Map(), c = {};
  for (let r = 0; r < 60 && seen.size < COUNT; r++) for (let i = -r; i <= r && seen.size < COUNT; i++) for (const [x, y] of [[i, -r], [i, r], [-r, i], [r, i]]) {
    const X = x * 53, Y = y * 53;
    tile(L, X, Y, c);
    if (!c.bm) continue;
    const S = speciesOf(L, regionAt(L, X, Y), c.bm);
    for (const g of small ? S.small : S.big) if (!seen.has(g.id) && seen.size < COUNT) seen.set(g.id, { g, bm: c.bm, t: c.t });
  }
  const page = +q.get('page') || 0, per = small ? 32 : 24;
  const items = [...seen.values()].slice(page * per, page * per + per), cols = 8, gap = small ? 1.4 : 5.5, gy = small ? 2.2 : 10;
  const M = new Mesh();
  const MAT = { [T_LUSH]: M_LUSH, [T_DRY]: M_DRY, [T_DESERT]: M_DESERT };
  items.forEach((it, i) => {
    const x = (i % cols) * gap, y = Math.floor(i / cols) * gy, h = gap * 0.42;
    const kind = it.t === T_LUSH ? 'lush' : it.t === T_DRY ? 'dry' : it.t === T_DESERT ? 'desert' : null;
    const col = kind ? groundTint(L, kind, it.bm) : it.t === 6 ? L.pal.snow : it.t === 2 ? L.pal.sand : L.pal.rock;
    const mat = MAT[it.t] ?? (it.t === 6 ? M_SNOW : it.t === 2 ? M_SAND : M_ROCK);
    M.quad([x - h, y - h, 0], [x + h, y - h, 0], [x + h, y + h, 0], [x - h, y + h, 0], 0, 0, 1, col, mat);
    place(M, template(it.g, 0, far ? 1 : 0), x, y, 0, 0.6, 1, 0, [1, 1, 1]);
  });
  // Рушій: застосунок, матеріал float-мешу (матеріал у четвертому байті кольору), масив текстур всесвіту (sRGB)
  const canvas = document.getElementById('gl');
  const G = await createApp(canvas, { device: q.get('gpu') || 'webgl2', far: 1000 });
  const MT = createMaterials(G), mat = MT.makeMaterial('flora', { matcol: true });
  const all = texturesOf(L), lv = [];
  for (let i = 0; i < LAYERS; i++) lv.push(all.subarray(i * TEX * TEX * 4, (i + 1) * TEX * TEX * 4));
  MT.setTextureArray(new pc.Texture(G.dev, { width: TEX, height: TEX, arrayLength: LAYERS, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, anisotropy: 8, levels: [lv] }));
  MT.setMaterialTable(MAT_TABLE);
  const cam = createCamera('iso');
  cam.pitch = cam.pitchT = 24 * Math.PI / 180;
  cam.yaw = cam.yawT = Math.PI / 2;                      // ряди галереї — уздовж екрана
  const rows = Math.ceil(items.length / cols), cx = (cols - 1) * gap / 2, cy = (rows - 1) * gy / 2;
  const node = new pc.GraphNode(), mi = new pc.MeshInstance(floatMesh(G, M.finish()), mat, node);
  node.setLocalPosition(-cx, -cy, -2);                   // центр галереї — на початку координат
  G.root.addChild(node); G.layers.world.addMeshInstances([mi]);
  // Світло: одне напрямлене з тінями (напрям і колір — закони всесвіту); розсіяне без неба — scene.ambientLight
  // (lighting/ambient-light). Сили — як у грі (sky.js lightsOf): верх при сонці на REF_Z — рівно колір палітри
  const Lt = L.light, LG = createLights(G, { shadows: q.get('shadows') || 'pcf3' });
  const dir = [0.32 * Math.cos(Lt.az) - 0.55 * Math.sin(Lt.az), 0.32 * Math.sin(Lt.az) + 0.55 * Math.cos(Lt.az), REF_Z];
  const rho = Lt.amb / (Lt.amb + (1 - Lt.amb) * REF_Z), Ed = (1 - rho ** 2.2) / REF_Z;
  LG.setDirectionalCount(1); LG.setShadowDistance(400);
  LG.setDirectional(0, { dir, color: Lt.col.map((x) => x / 255), intensity: pcIntensity(Ed) });
  G.scene.ambientLight = new pc.Color(rho, rho, rho);
  G.cam.clearColor = new pc.Color(...L.pal.sky.map((x) => x / 255));
  MT.setFrame({ minLight: MIN_LIGHT ** 2.2, time: 0, target: [0, 0, 0], eye: [0, 0, 0], fade: [-2, -1], cut2: [0, 0, 0, 0], seam: 1e6, curve: 0, wind: [0, 0, 0, 0] });
  // Камера: орто згори-збоку (базис camera.js гри: r — праворуч, up — угору, u — до ока)
  const b = basis(cam), V = new pc.Vec3(), Q = new pc.Quat(), M4 = new pc.Mat4();
  G.camE.setPosition(G.toPC(b.u[0] * 300, b.u[1] * 300, b.u[2] * 300, V));
  M4.data.set([b.r[0], b.r[2], b.r[1], 0, b.up[0], b.up[2], b.up[1], 0, b.u[0], b.u[2], b.u[1], 0, 0, 0, 0, 1]);
  G.camE.setRotation(Q.setFromMat4(M4));
  Object.assign(G.cam, { projection: pc.PROJECTION_ORTHOGRAPHIC, nearClip: 1, farClip: 700 });
  const labels = document.createElement('div');
  Object.assign(labels.style, { position: 'absolute', inset: 0, pointerEvents: 'none', font: '11px system-ui', color: '#111' });
  document.body.append(labels);
  const head = document.createElement('div');
  Object.assign(head.style, { position: 'absolute', left: '12px', top: '8px', font: '600 15px system-ui', color: '#111', background: '#fffc', padding: '4px 8px', borderRadius: '6px' });
  head.textContent = `Види: зерно «${seedText}», глибина ${d}, всесвіт ${n} · ${small ? 'малі' : 'великі'}, сторінка ${page + 1} з ${Math.ceil(seen.size / per)} (усього ${seen.size})${far ? ' (спрощені)' : ''} · гравітація ${L.grav.toFixed(2)} g`;
  document.body.append(head);
  // Кадр: масштаб під вікно й підписи (worldToScreen камери PlayCanvas) — лише при зміні розміру
  let W = 0, H = 0;
  const P = new pc.Vec3(), Sc = new pc.Vec3();
  function frame() {
    G.onFrame(frame);
    if (W === G.width && H === G.height) return;
    W = G.width; H = G.height;
    cam.zoom = Math.min(W / (cols * gap), H / ((rows + 0.6) * gy * 0.45)) / S;
    G.cam.orthoHeight = H / (2 * S * cam.zoom);
    labels.textContent = '';
    items.forEach((it, i) => {
      G.cam.worldToScreen(G.toPC((i % cols) * gap - cx, Math.floor(i / cols) * gy - cy + gap * 0.3, -2, P), Sc);
      const el = document.createElement('div');
      Object.assign(el.style, { position: 'absolute', left: Sc.x + 'px', top: Sc.y + 'px', transform: 'translate(-50%, 2px)', background: '#fffb', padding: '0 4px', borderRadius: '4px', whiteSpace: 'nowrap' });
      el.textContent = `${FORMS[it.g.form].name} · ${BIOMES[it.bm].name}`;
      labels.append(el);
    });
    if (!window.eco) window.eco = { ready: true, G };
  }
  G.onFrame(frame);
}
