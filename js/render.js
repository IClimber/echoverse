// render.js — кадр: видимі чанки (меші в GPU, найдавніші звільняються), фігура гравця, небо, світло й туман
// всесвіту, «вікно» крізь те, що закриває гравця (вище за його коліна: сходинку на 1 рівень не вирізаємо).
// Камера — camera.js (ізометрія чи третя особа); координати в шейдері — відносно цілі камери (target).
import { createGL } from './gl.js';
import { LEVEL, S } from './iso.js';
import { CS } from './gen/chunk.js';
import { WORLD_H, SEA, MAX_AMP } from './universe.js';
import { figureParts, Mesh } from './gen/mesh.js';
import { poseMatrices } from './anim.js';
import { chain, translate, scale, invert } from './mat.js';
import { skyState } from './sky.js';
import { ISO, VIEW_R, viewProj, chunksInView, isoRadius, project, basis } from './camera.js';
import { texturesOf, TEX } from './textures.js';
import { LAYERS } from './gen/materials.js';

const MAX_MESH = 700;                          // чанків з мешами в GPU; третя особа бачить далеко
const ZR = [0, WORLD_H * LEVEL + 40];          // висоти світу: від дна до верху островів і крон велетнів (піраміда видимості)
const ZR_ISO = [0, (SEA + MAX_AMP) * LEVEL + 6]; // згори радіус — по рельєфу з деревами (інакше чанків набагато більше)
const NEAR = 44;                               // ближче (від цілі до центру чанка) — повні рослини, трава й квіти; далі — спрощені
const REF_Z = 0.77;                            // при сонці на цій висоті верхня грань — рівно колір палітри

export function createRenderer(canvas) {
  const R = createGL(canvas);
  const meshes = new Map();                     // ключ чанка → {mesh (тверде), liq (рідина), flora / far (рослини зблизька / здалеку), used}
  let frame = 0, texFor = null;                 // для якого всесвіту зараз текстури
  const fig = Object.fromEntries(Object.entries(figureParts([226, 92, 70])).map(([k, m]) => [k, R.upload(m)]));
  const shadow = (() => { const M = new Mesh(); M.quad([-0.3, -0.3, 0.02], [0.3, -0.3, 0.02], [0.3, 0.3, 0.02], [-0.3, 0.3, 0.02], 0, 0, 1, [0, 0, 0]); return R.upload(M.finish()); })();

  const free = (e) => { for (const m of [e.mesh, e.liq, e.flora, e.far]) if (m) R.free(m); };
  function evict() {
    if (meshes.size <= MAX_MESH) return;
    const old = [...meshes].sort((a, b) => a[1].used - b[1].used).slice(0, meshes.size - MAX_MESH);
    for (const [k, e] of old) { free(e); meshes.delete(k); }
  }

  return {
    R,
    resize: () => R.resize(),
    add(key, m) {
      const e = meshes.get(key);
      if (e) free(e);
      const up = (x) => x ? R.upload(x) : null;
      meshes.set(key, { mesh: R.upload(m.solid), liq: up(m.liquid), flora: up(m.flora), far: up(m.far), used: frame });
      evict();
    },
    has: (key) => meshes.has(key),
    clear() { for (const e of meshes.values()) free(e); meshes.clear(); },
    get meshCount() { return meshes.size; },

    // Камера на цей кадр: матриця, радіус видимого, туман і чанки в піраміді видимості (ближчі першими).
    // dist — відстань до ока в третій особі (після зіткнення з рельєфом)
    view(camera, target, dist) {
      const v = viewProj(camera, R.width, R.height, dist), iso = camera.mode === ISO;
      const rad = iso ? isoRadius(camera, R.width, R.height, ZR_ISO, target[2]) : VIEW_R;
      // туман: згори — за відстанню на екрані (кути екрана злегка в тумані, висота не вибілює), у третій особі — по горизонталі
      const b = basis(camera), rs = Math.hypot(R.width, R.height) / 2 / (S * camera.zoom);
      return { ...v, rad, fog: iso ? [0.8 * rs, 1.15 * rs] : [0.55 * VIEW_R, 0.95 * VIEW_R], fogAxes: iso ? [b.r, b.up] : null, chunks: chunksInView(v.m, target, rad, ZR) };
    },

    // st: {camera, target [x,y,z], view (з view()), laws, clock (с, годинник світу), keys (видимі чанки [{key, cx, cy}]),
    // me {x, y, z, gz, yaw, tint, anim}}. Повертає стан неба (sky.js) — для HUD
    draw(st) {
      frame++;
      const { target: t, view, laws } = st, sk = skyState(laws, st.clock || 0), [lx, ly, lz] = sk.light, amb = sk.amb;
      const k = 1 / (amb + (1 - amb) * REF_Z);
      const lightCol = [sk.lightK[0] * k, sk.lightK[1] * k, sk.lightK[2] * k];
      const me = st.me;
      let cut = null, cutFlora = null;
      if (me) {
        const pc = [me.x - t[0], me.y - t[1], me.z + 0.45 - t[2]], p = project(view.m, pc, R.width, R.height);
        const { r } = basis(st.camera), q = p && project(view.m, [pc[0] + r[0] * 0.7, pc[1] + r[1] * 0.7, pc[2]], R.width, R.height);
        const kr = st.camera.mode === ISO ? 1.35 : 0.75;   // третя особа: лише силует (дерева поруч не вирізаємо)
        if (p && q) {
          const r = Math.hypot(q[0] - p[0], q[1] - p[1]);
          cut = { x: p[0], y: p[1], r: r * kr, z: me.z + 0.6 - t[2], depth: p[2] };
          cutFlora = { ...cut, r: r * (st.camera.mode === ISO ? 1.6 : 2.4) };   // крізь рослини — ширше вікно
        }
      }
      const tk = `${laws.d}:${laws.n}:${laws.ds}`;
      if (texFor !== tk) { texFor = tk; R.setTextures(texturesOf(laws), TEX, LAYERS); }
      R.begin({ fogCol: sk.fog, light: [lx, ly, lz], amb, lightCol, fog: view.fog, fogAxes: view.fogAxes, view: view.m, cut, time: performance.now() / 1000 % 1000, sky: { inv: invert(view.m), st: sk } });
      for (const v of st.keys) {
        const e = meshes.get(v.key);
        if (!e) continue;
        e.used = frame;
        R.drawAt(e.mesh, v.cx * CS - t[0], v.cy * CS - t[1], -t[2]);
      }
      // Рослини: зблизька — повні, далі — спрощені; у третій особі біля камери розчиняються (камера в кроні не сліпне)
      R.setCut(cutFlora);
      if (st.camera.mode !== ISO) { const d = Math.hypot(...view.eye); R.setFade([Math.min(1, d * 0.3), Math.max(2.5, d * 0.65)], view.eye); }
      for (const v of st.keys) {
        const e = meshes.get(v.key);
        if (!e) continue;
        const ox = v.cx * CS - t[0], oy = v.cy * CS - t[1];
        const fl = (ox + CS / 2) ** 2 + (oy + CS / 2) ** 2 < NEAR * NEAR ? e.flora : e.far;
        if (fl) R.drawAt(fl, ox, oy, -t[2]);
      }
      R.setFade(null);
      // Поверхні рідин — після всього твердого, напівпрозоро (лава — непрозора)
      R.setCut(null);                               // поверхню рідини не вирізаємо (гравець у воді — під нею)
      R.beginAlpha(laws.liquid.alpha);
      for (const v of st.keys) { const e = meshes.get(v.key); if (e && e.liq) R.drawAt(e.liq, v.cx * CS - t[0], v.cy * CS - t[1], -t[2]); }
      R.endAlpha();
      if (me) {
        R.setCut(null);                             // власні грані гравця не вирізаємо
        const ox = me.x - t[0], oy = me.y - t[1], pose = poseMatrices(me.anim, ox, oy, me.z - t[2], me.yaw);
        for (const p in fig) R.draw(fig[p], pose[p], me.tint);
        const up = me.z - me.gz, sz = Math.max(0.45, 1 - up * 0.25);  // тінь: що вище в повітрі, то менша й блідіша; у воді — немає
        if (!me.swim) R.drawAlpha(shadow, chain(translate(ox, oy, me.gz - t[2]), scale(sz, sz, 1)), 0.3 * (0.4 + 0.6 * sk.day) / (1 + up * 0.6));
      }
      return sk;
    },
  };
}
