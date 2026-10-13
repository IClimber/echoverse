// js/light-stand.js — стенд ?light: світло й тіні рушія (js/engine/graphics) окремо від гри й генератора. Світ із блоків
// задано вручну (земля, тонка стіна, кімната з дахом і дверима, пагорб із тунелем, ширяючий острів, стовпи); меш — той
// самий, що в грі (chunkMesh, AO у вершинах), далі — регіони, небо з розсіяним світлом, сонце, точкові джерела й
// прожектори з тінями, тіла екземплярами. Камера — офіційний скрипт CameraControls (приклад camera/multi).
// Що має бути видно: світло з одного боку тонкої стіни не проходить на інший; у кімнаті під дахом темно, крім дверей і
// джерела; тунель темний (мінімум 3 %), світло — лише біля його джерела; острів кидає тінь; кути темніші (AO); тіні від
// усіх джерел і тіл
import { createApp, pc } from './engine/graphics/app.js';
import { createMaterials } from './engine/graphics/materials.js';
import { createRegions } from './engine/graphics/regions.js';
import { createSky } from './engine/graphics/sky.js';
import { createLights } from './engine/graphics/lights.js';
import { floatMesh } from './engine/graphics/meshes.js';
import { createInstances } from './engine/graphics/instances.js';
import { CameraControls } from 'playcanvas/scripts/esm/camera-controls.mjs';
import { SKY_GLSL, SKY_WGSL } from './sky-shader.js';
import { lawsOf } from './universe.js';
import { hashStr } from './rng.js';
import { CS, FR, SEC, B_GRASS, B_SOIL, B_STONE, B_ROCK } from './gen/chunk.js';
import { chunkMesh, Mesh } from './gen/mesh.js';
import { packMesh, frameOf, PO, PQ, RW, RH } from './gen/pack.js';
import { texturesOf, TEX } from './textures.js';
import { LAYERS, MAT_TABLE } from './gen/materials.js';

const MIN_LIGHT = 0.03 ** 2.2;                 // мінімум яскравості (лінійний), як у грі
const NX = 4, NY = 4, NZ = 3;                  // стовпців і секцій світу стенду (64 × 64 клітинки × 48 блоків)

// Блок (x, y, k) світу стенду
function block(x, y, k) {
  if (x < 0 || y < 0 || x >= NX * CS || y >= NY * CS || k < 0) return k < 0 ? B_STONE : 0;
  if (k < 7) return B_SOIL;
  if (k === 7) return B_GRASS;
  if (x === 40 && y >= 20 && y <= 44 && k <= 23) return B_STONE;                         // тонка стіна
  if (x >= 10 && x <= 20 && y >= 10 && y <= 20) {                                         // кімната
    if (k === 16) return B_STONE;                                                          // дах
    const wall = x === 10 || x === 20 || y === 10 || y === 20;
    const door = x === 10 && y >= 14 && y <= 16 && k <= 11;
    if (wall && k < 16 && !door) return B_STONE;
  }
  if (x >= 50 && x <= 62 && y >= 50 && y <= 62 && k <= 31) return y >= 55 && y <= 57 && k <= 11 ? 0 : B_ROCK;   // пагорб із тунелем
  if (x >= 25 && x <= 32 && y >= 40 && y <= 47 && k >= 36 && k <= 39) return B_ROCK;     // ширяючий острів
  for (const [px, py] of [[30, 25], [34, 25], [30, 30], [26, 33]]) if (x === px && y === py && k <= 20) return B_STONE;   // стовпи
  return 0;
}
// верх укриття клітинки (блоки, як shelterTop у грі): найвищий твердий блок біля поверхні + 1 (острови — ні)
function topOf(x, y) { for (let k = 34; k >= 0; k--) if (block(x, y, k)) return k + 1; return 0; }

// Секція (cx, cy, cz) у форматі chunkMesh: блоки з рамкою, верх укриття, без рослин
function section(cx, cy, cz) {
  const NW = CS + 2 * FR, NK = SEC, b = new Uint8Array(NW * NW * (NK + 2 * FR)), top = new Int16Array(NW * NW), sky = new Int16Array(NW * NW);
  for (let y = -FR; y < CS + FR; y++) for (let x = -FR; x < CS + FR; x++) {
    const X = cx * CS + x, Y = cy * CS + y, c = (y + FR) * NW + x + FR;
    top[c] = topOf(X, Y); sky[c] = top[c] - 1;
    for (let k = -FR; k < NK + FR; k++) b[c * (NK + 2 * FR) + k + FR] = block(X, Y, cz * SEC + k);
  }
  return { cx, cy, b, h: top, bm: new Uint8Array(NW * NW), v: new Uint8Array(NW * NW), top, sky, k0: cz * SEC, nk: NK, obj: [], sp: [] };
}

export async function runLight() {
  const QS = new URLSearchParams(location.search);
  document.body.innerHTML = `<canvas id="c" style="position:fixed;inset:0;width:100%;height:100%"></canvas>
<div id="panel" style="position:fixed;left:8px;top:8px;background:#000a;color:#eee;font:13px system-ui;padding:8px 10px;border-radius:6px;display:grid;gap:6px;min-width:230px">
  <b>?light — світло й тіні рушія</b>
  <label>Доба <input id="day" type="range" min="0" max="1" step="0.005" value="0.36"></label>
  <label>Тіні <select id="sh"><option value="off">без тіней</option><option value="pcf3">PCF3</option><option value="pcss">PCSS</option></select></label>
  <label>Джерел <select id="nl"><option>1</option><option selected>8</option><option>32</option></select></label>
  <label><input id="mv" type="checkbox" checked> рух</label>
  <label><input id="ao" type="checkbox" checked> AO</label>
  <span id="st"></span>
  <small>ЛКМ — обертати, ПКМ / WASD — політ, коліщатко — ближче, F — центр, R — початковий вид</small>
</div>`;
  document.body.style.margin = '0';
  const $ = (id) => document.getElementById(id);
  const G = await createApp($('c'), { device: QS.get('gpu') || 'webgl2', far: 1000 });
  const { app, dev } = G;
  const L = lawsOf(hashStr('light'), 0, 0);

  // Матеріали, текстури, таблиця
  const M = createMaterials(G);
  const solid = M.makeMaterial('solid', { cull: pc.CULLFACE_BACK });
  const obj = M.makeMaterial('obj');
  const box = M.makeMaterial('box', { matcol: true });
  const all = texturesOf(L), lv = [];
  for (let i = 0; i < LAYERS; i++) lv.push(all.subarray(i * TEX * TEX * 4, (i + 1) * TEX * TEX * 4));
  M.setTextureArray(new pc.Texture(dev, { width: TEX, height: TEX, arrayLength: LAYERS, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT, anisotropy: 8, levels: [lv] }));
  M.setMaterialTable(MAT_TABLE);

  // Регіон: секції світу — одна арена, одна сітка камери й один кидач на все
  const FMT = new pc.VertexFormat(dev, [
    { semantic: pc.SEMANTIC_POSITION, components: 4, type: pc.TYPE_UINT16, normalize: true },
    { semantic: pc.SEMANTIC_NORMAL, components: 4, type: pc.TYPE_INT8, normalize: true },
    { semantic: pc.SEMANTIC_COLOR, components: 4, type: pc.TYPE_UINT8, normalize: true },
  ]);
  const RG = createRegions(G, { size: [RW, RW, RH], PO, PQ, format: FMT, kinds: { solid: { arena: 'op', material: solid } }, casters: [{ arena: 'op', material: obj }] });
  const R = RG.create(0, 0, 0), bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const F = [], C = [];
  for (let cz = 0; cz < NZ; cz++) for (let cy = 0; cy < NY; cy++) for (let cx = 0; cx < NX; cx++) {
    const m = chunkMesh(section(cx, cy, cz), L, { near: false, far: false }), [dx, dy, dz] = frameOf(cx, cy, cz);
    const p = packMesh(m.solid, dx, dy, dz);
    if (!p.n) continue;
    const off = RG.put(R, 'op', p.buf, p.n);
    F.push(off); C.push(p.n);
    for (let i = 0; i < 3; i++) { bb[i] = Math.min(bb[i], p.bb[i]); bb[i + 3] = Math.max(bb[i + 3], p.bb[i + 3]); }
  }
  RG.setBounds(R, bb);
  const Fa = Int32Array.from(F), Ca = Int32Array.from(C);
  RG.setCamera(R, 'solid', Fa, Ca, 0, Fa.length);
  RG.setCasters(R, [{ key: 0, kind: 0, F: Fa, C: Ca, nr: Fa.length, bb }], 1);

  // Небо (прості кольори) і розсіяне з нього; сонце — напрямлене світло з тінями
  const sky = createSky(G, { glsl: SKY_GLSL, wgsl: SKY_WGSL });
  const LG = createLights(G, { shadows: QS.get('shadows') || 'pcf3' });
  LG.setDirectionalCount(1);
  const sc = dev.scope, U = (k, v) => sc.resolve(k).setValue(v);
  const Z16 = new Float32Array(16);
  U('uMoon[0]', Z16); U('uMoonCol[0]', Z16); U('uMoon2[0]', Z16); U('uMoonA[0]', Z16); U('uMoonB[0]', Z16); U('uShade', [0, 0, 0]); U('uNMoon', 0); U('uAurG', [0, 6371, 150, 0]); U('uFwd', [1, 0, 0]); U('uMet[0]', Z16); U('uMetB[0]', Z16); U('uNMet', 0); U('uHz[0]', Z16); U('uCloudC', [1e6, 0, 1, 800]);
  U('uCloudMap', new pc.Texture(dev, { width: 1, height: 1, format: pc.PIXELFORMAT_R8, mipmaps: false })); U('uNSun', 1); U('uStars', [0, 0]);
  U('uCel', new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])); U('uRing', [0, 0, 0, 0]); U('uRingCol', [0, 0, 0]); U('uPole', [0, 0, 1]);
  U('uCloud', [0, 0, 0, 0]); U('uCloudCol', [1, 1, 1]); U('uFlash', 0); U('uAur', [0, 1, 0, 0]); U('uAurCol', [0, 0, 0]);

  // Джерела: у тунелі й у кімнаті (нерухомі) і кольорові по колу (частина рухається)
  const fixed = [
    LG.addLight({ type: 'omni', pos: [56, 56, 4.75], color: [1, 0.75, 0.4], intensity: 3, range: 7 }),
    LG.addLight({ type: 'omni', pos: [15, 15, 6], color: [0.6, 0.8, 1], intensity: 3, range: 6 }),
  ];
  let ring = [];
  const HUE = (h) => { const f = (n) => { const k = (n + h * 12) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
  const setRing = (n) => {
    for (const H of ring) H.remove();
    ring = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, spot = i % 3 === 2;
      ring.push(LG.addLight({ type: spot ? 'spot' : 'omni', pos: [32 + 18 * Math.cos(a), 32 + 18 * Math.sin(a), 7], dir: [0, 0, -1], color: HUE(i / n), intensity: 2.5, range: 10, outer: 50, inner: 35, moving: i % 2 === 0 }));
      ring[i].a0 = a;
    }
  };
  setRing(8);
  fixed.forEach((H) => H.set({}));

  // Тіла: коробки екземплярами
  const BM = new Mesh(); BM.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, [200, 180, 150]);
  const inst = createInstances(G, floatMesh(G, BM.finish()), box);
  const NB = 6, mats = new Float32Array(NB * 16), m4 = new Float32Array(16);

  // Камера — CameraControls (приклад camera/multi): точка фокуса — центр сцени, швидкість — від її розміру
  const camE = G.camE;
  camE.camera.farClip = 1000;
  camE.addComponent('script');
  const focus = new pc.Vec3(28, 5, 28), start = new pc.Vec3(-6, 26, -8), size = 40;
  camE.setPosition(start);
  const cc = camE.script.create(CameraControls);
  Object.assign(cc, { focusPoint: focus, moveSpeed: 2 * size, moveFastSpeed: 4 * size, moveSlowSpeed: size });
  addEventListener('keydown', (e) => { if (e.key === 'f') cc.focus(focus, true); if (e.key === 'r') cc.reset(focus, start); });

  $('sh').value = LG.quality;
  $('sh').onchange = () => LG.setQuality($('sh').value);
  $('nl').onchange = () => setRing(+$('nl').value);
  $('ao').onchange = () => { for (const m of M.all.values()) { m.aoIntensity = $('ao').checked ? 1 : 0; m.update(); } };

  // Кадр: сонце з доби, небо й розсіяне, джерела, тіла, кидачі
  const VP = new pc.Mat4(), A = new pc.Mat4(), Mo = new pc.Mat4(), sig = new Float32Array(6);
  const view = { m: new Float32Array(16), eye: [0, 0, 0], ud: [0, 0, 0], t: [32, 32, 4] }, dirs = [];
  let frames = 0, t0 = performance.now(), first = true;
  const frame = (now) => {
    const day = +$('day').value, ph = (day - 0.25) * Math.PI * 2;
    const el = Math.sin(ph), sun = [Math.cos(ph) * 0.8, 0.45, el];
    const sl = Math.hypot(...sun); for (let i = 0; i < 3; i++) sun[i] /= sl;
    const dk = Math.max(0, Math.min(1, sun[2] * 4 + 0.3));
    U('uZen', [0.25 * dk + 0.02, 0.45 * dk + 0.03, 0.85 * dk + 0.08]); U('uHor', [0.7 * dk + 0.06, 0.8 * dk + 0.07, 0.95 * dk + 0.12]);
    U('uMain', sun); U('uDusk', [1, 0.5, 0.2, Math.max(0, 1 - Math.abs(sun[2]) * 5) * 0.6]);
    U('uSun[0]', new Float32Array([...sun, 0.04, 0, 0, 0, 0, 0, 0, 0, 0])); U('uSunCol[0]', new Float32Array([1, 0.95, 0.85, 1, 0, 0, 0, 0, 0, 0, 0, 0]));
    U('uDay', dk); U('eco_bakeK', 0.6);
    sig.set([...sun, dk, 0, 0]);
    sky.maybeBake(sig, first); first = false;
    const up = Math.max(0, Math.min(1, (sun[2] + 0.05) / 0.3));
    LG.setDirectional(0, { dir: sun, color: [1, 0.95, 0.85], intensity: 2.2 * up });
    M.setFrame({ minLight: MIN_LIGHT, time: now / 1000, target: [32, 4, 32 - 0], eye: [camE.getPosition().x, camE.getPosition().y, camE.getPosition().z], fade: [-2, -1], cut2: [0, 0, 0, 0], seam: 1e6, curve: 0, wind: [0, 0, 0, 0] });
    const t = now / 1000, mv = $('mv').checked;
    if (mv) for (const H of ring) if (H.moving) { const a = H.a0 + t * 0.4; H.set({ pos: [32 + 18 * Math.cos(a), 32 + 18 * Math.sin(a), 7 + 2 * Math.sin(t + H.a0)] }); }
    for (let i = 0; i < NB; i++) {
      const z = 6 + (mv ? 2.5 * Math.abs(Math.sin(t * 1.3 + i)) : 1), x = 34 + (i % 3) * 2.5, y = 34 + Math.floor(i / 3) * 2.5;
      m4.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
      G.matToPC(m4, mats, i * 16);
    }
    inst.update(mats, NB);
    // кидачі: матриця камери в наших координатах відносно цілі t (наші → PlayCanvas: (x, z, y) + t − O)
    VP.mul2(camE.camera.projectionMatrix, camE.camera.viewMatrix);
    A.set([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, view.t[0] - G.O[0], view.t[2], view.t[1] - G.O[1], 1]);
    Mo.mul2(VP, A); view.m.set(Mo.data);
    const p = camE.getPosition(), f = camE.forward;
    view.eye[0] = p.x + G.O[0] - view.t[0]; view.eye[1] = p.z + G.O[1] - view.t[1]; view.eye[2] = p.y - view.t[2];
    view.ud[0] = f.x; view.ud[1] = f.z; view.ud[2] = f.y;
    RG.cullCasters([R], view, LG.dirs(dirs), LG.locals());
    frames++;
    if (now - t0 > 500) {
      const i = LG.info();
      $('st').textContent = `${(frames * 1000 / (now - t0)).toFixed(0)} к/с · GPU ${G.R.gpuMs === null ? '—' : G.R.gpuMs.toFixed(2) + ' мс'} · ${G.info.device} · світел ${i.dir} + ${i.local}`;
      frames = 0; t0 = now;
      if (!window.eco) window.eco = { ready: true, G, LG };
    }
    G.onFrame(frame);
  };
  G.onFrame(frame);
  // мітка для test/shots.mjs — після першого кадру
  app.once('postrender', () => { window.eco = { ready: true, G, LG }; });
}
