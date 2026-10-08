// flora-stand.js — стенд «види рослин» (index.html?flora[&seed=…&d=…&n=…&far&small]): галерея видів, що трапляються
// в одному всесвіті (області навколо центру карти), кожен — на клаптику землі свого біому, з підписом.
// Перевірка «чи дивує»: види мають бути різні за будовою, а не перефарбовані. far — спрощені (для далечі), small — малі.
import { createGL } from './gl.js';
import { lawsOf } from './universe.js';
import { hashStr } from './rng.js';
import { tile, T_LUSH, T_DRY, T_DESERT } from './gen/chunk.js';
import { BIOMES } from './gen/biomes.js';
import { regionAt, speciesOf, groundTint, FORMS } from './gen/flora.js';
import { template, place } from './gen/plants.js';
import { Mesh } from './gen/mesh.js';
import { texturesOf, TEX } from './textures.js';
import { LAYERS, M_LUSH, M_DRY, M_DESERT, M_SNOW, M_ROCK, M_SAND } from './gen/materials.js';
import { createCamera, viewProj, project } from './camera.js';

export function runFlora() {
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
  const R = createGL(document.getElementById('gl'));
  R.setTextures(texturesOf(L), TEX, LAYERS);
  const mesh = R.upload(M.finish());
  const cam = createCamera('iso');
  cam.pitch = cam.pitchT = 24 * Math.PI / 180;
  cam.yaw = cam.yawT = Math.PI / 2;                      // ряди галереї — уздовж екрана
  const rows = Math.ceil(items.length / cols), cx = (cols - 1) * gap / 2, cy = (rows - 1) * gy / 2;
  const labels = document.createElement('div');
  Object.assign(labels.style, { position: 'absolute', inset: 0, pointerEvents: 'none', font: '11px system-ui', color: '#111' });
  document.body.append(labels);
  const head = document.createElement('div');
  Object.assign(head.style, { position: 'absolute', left: '12px', top: '8px', font: '600 15px system-ui', color: '#111', background: '#fffc', padding: '4px 8px', borderRadius: '6px' });
  head.textContent = `Види: зерно «${seedText}», глибина ${d}, всесвіт ${n} · ${small ? 'малі' : 'великі'}, сторінка ${page + 1} з ${Math.ceil(seen.size / per)} (усього ${seen.size})${far ? ' (спрощені)' : ''} · гравітація ${L.grav.toFixed(2)} g`;
  document.body.append(head);
  function frame() {
    R.resize();
    cam.zoom = Math.min(R.width / (cols * gap), R.height / ((rows + 0.6) * gy * 0.45)) / 45.25;
    const v = viewProj(cam, R.width, R.height), Lt = L.light;
    const lx = 0.32 * Math.cos(Lt.az) - 0.55 * Math.sin(Lt.az), ly = 0.32 * Math.sin(Lt.az) + 0.55 * Math.cos(Lt.az), lz = 0.77, k = 1 / (Lt.amb + (1 - Lt.amb) * lz);
    R.begin({ sky: L.pal.sky, light: [lx, ly, lz], amb: Lt.amb, lightCol: Lt.col.map((x) => x / 255 * k), fog: [1e6, 2e6], view: v.m, cut: null, time: 0 });
    R.drawAt(mesh, -cx, -cy, -2);
    labels.textContent = '';
    items.forEach((it, i) => {
      const p = project(v.m, [(i % cols) * gap - cx, Math.floor(i / cols) * gy - cy + gap * 0.3, -2], R.width, R.height);
      if (!p) return;
      const el = document.createElement('div');
      Object.assign(el.style, { position: 'absolute', left: p[0] + 'px', top: p[1] + 'px', transform: 'translate(-50%, 2px)', background: '#fffb', padding: '0 4px', borderRadius: '4px', whiteSpace: 'nowrap' });
      el.textContent = `${FORMS[it.g.form].name} · ${BIOMES[it.bm].name}`;
      labels.append(el);
    });
  }
  frame();
  addEventListener('resize', frame);
}
