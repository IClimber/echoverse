// js/engine/graphics/materials.js — матеріали: StandardMaterial PlayCanvas (світло, тіні, туман, AO, гама — його) з нашими
// шматками (chunks.js), таблиця матеріалів і спільні уніформи кадру. AO — з кольору вершини (aoVertexColor,
// graphics/lighting/ambient-occlusion.md: множить розсіяне світло); розчинення й «вікно» — дизеринг непрозорості
// (opacityDither, graphics/transparency.md), у тінях — без них; проріджування малих рослин — в обох проходах
import { pc } from './app.js';
import { chunksFor, MAT_N } from './chunks.js';

// G — застосунок (app.js)
export function createMaterials(G) {
  const { dev, lang } = G, sc = dev.scope;
  const all = new Map();
  let texArr = null;

  // opts: cull (типово NONE), defines ['ECO_…'], blend (прозорість: { opacity }), matcol — матеріал у color.a (AO — число на об'єкт: eco_ao);
  function makeMaterial(name, { cull = pc.CULLFACE_NONE, defines = [], blend = null, matcol = false } = {}) {
    const m = new pc.StandardMaterial();
    m.name = name;
    m.diffuseVertexColor = true; m.vertexColorGamma = true;
    m.specular = new pc.Color(0, 0, 0); m.useMetalness = false;
    // AO гасить лише розсіяне світло (occludeDiffuse PlayCanvas): у землі — з color.a; у float-мешів — число на об'єкт
    // (eco_ao, екземпляри — instance_line1.w; chunks.js): aoVertexColor лише вмикає AO, aoPS — свій
    m.aoVertexColor = true; m.aoVertexColorChannel = 'a'; m.aoIntensity = 1;
    if (matcol) {
      m.setDefine('ECO_MATCOL', true); m.setParameter('eco_ao', 1);
      // свій transformInstancingVS: атрибути екземпляра PlayCanvas прив'язує сам лише для типового (lit-shader.js) —
      // ті самі семантики, що в нього (як setAttribute у прикладі instancing-custom)
      m.setAttribute('instance_line1', pc.SEMANTIC_ATTR11); m.setAttribute('instance_line2', pc.SEMANTIC_ATTR12);
      m.setAttribute('instance_line3', pc.SEMANTIC_ATTR14); m.setAttribute('instance_line4', pc.SEMANTIC_ATTR15);
    }
    m.cull = cull;
    const thin = defines.includes('ECO_THIN'), dither = thin || defines.some((d) => d === 'ECO_FADE' || d === 'ECO_CUT' || d === 'ECO_CUTF' || d === 'ECO_XIN' || d === 'ECO_XOUT');
    // у тіньовому проході — лише проріджування (розчинення й «вікно» — FORWARD_PASS): трава за межею не кидає тіні
    if (dither) { m.opacityDither = pc.DITHER_BAYER8; m.opacityShadowDither = thin ? pc.DITHER_BAYER8 : pc.DITHER_NONE; }
    for (const d of defines) m.setDefine(d, true);
    m.getShaderChunks(lang).add(chunksFor(dev, lang, { opacity: dither, matcol }));
    m.shaderChunksVersion = '2.23';
    if (blend) setBlend(m, blend.opacity);
    if (texArr) m.setParameter('uTexArr', texArr);
    m.update();
    all.set(name, m);
    return m;
  }
  // напівпрозорість (рідина): < 1 — змішування без запису глибини, 1 — непрозоре (лава)
  function setBlend(m, a) {
    m.opacity = a;
    if (a < 1) { m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; } else { m.blendType = pc.BLEND_NONE; m.depthWrite = true; }
    m.update();
  }

  // Таблиця матеріалів (vec4 на номер, див. chunks.js) і уніформи кадру — через dev.scope, без виділень
  const U = (n) => sc.resolve(n);
  const uMat = U('eco_mat[0]'), table = new Float32Array(MAT_N * 4);
  const uWind = U('eco_wind'), uCurve = U('eco_curve'), uTarget = U('eco_target'), uSeam = U('eco_seam'), uTime = U('eco_time');
  const uMin = U('eco_minLight'), uEye = U('eco_eye'), uFade = U('eco_fade'), uCut = U('eco_cut'), uCut2 = U('eco_cut2'), uCut3 = U('eco_cut3'), uThin = U('eco_thin'), uXf = U('eco_xfade');
  const f2 = new Float32Array(2), f3 = new Float32Array(3), f3e = new Float32Array(3), f4w = new Float32Array(4), c1 = new Float32Array(4), c2 = new Float32Array(4), c3 = new Float32Array(2), f2t = new Float32Array(2), f2x = new Float32Array(2);
  const set = (u, a, v) => { if (v) { a.set(v); u.setValue(a); } };
  const frame = { table };

  return {
    makeMaterial, setBlend,
    get: (name) => all.get(name),
    all,
    // t: Float32Array(MAT_N · 4) чи [[номер, x, y, z, w], …]
    setMaterialTable(t) {
      if (t instanceof Float32Array) table.set(t);
      else { table.fill(0); for (const [i, ...v] of t) table.set(v, i * 4); }
      uMat.setValue(table);
    },
    setTextureArray(tex) {
      texArr = tex;
      for (const m of all.values()) { m.setParameter('uTexArr', tex); }
    },
    // Уніформи кадру (PlayCanvas, світові координати): wind [x, z, час, 0], curve, target, seam, time, minLight, eye,
    // fade [від, до], cut, cut2, cut3, thin [від, до], xfade [від, до] — див. chunks.js. Не передане — лишається як було
    setFrame(o) {
      uMat.setValue(table);
      set(uWind, f4w, o.wind); if (o.curve !== undefined) uCurve.setValue(o.curve);
      set(uTarget, f3, o.target); if (o.seam !== undefined) uSeam.setValue(o.seam);
      if (o.time !== undefined) uTime.setValue(o.time); if (o.minLight !== undefined) uMin.setValue(o.minLight);
      set(uEye, f3e, o.eye); set(uFade, f2, o.fade);
      set(uCut, c1, o.cut); set(uCut2, c2, o.cut2); set(uCut3, c3, o.cut3); set(uThin, f2t, o.thin); set(uXf, f2x, o.xfade);
    },
    frame,
  };
}
