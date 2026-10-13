// js/engine/graphics/materials.js — матеріали: StandardMaterial PlayCanvas (світло, тіні, туман, AO, гама — його) з нашими
// шматками (chunks.js), таблиця матеріалів і спільні уніформи кадру. AO — з кольору вершини (aoVertexColor,
// graphics/lighting/ambient-occlusion.md: множить розсіяне світло); розчинення й «вікно» — дизеринг непрозорості
// (opacityDither, graphics/transparency.md), у тінях — без них; проріджування малих рослин — в обох проходах
import { pc } from './app.js';
import { chunksFor, MAT_N, WIND_W, FLOW_P } from './chunks.js';

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
  const uWind = U('eco_wind'), uCurve = U('eco_curve'), uTarget = U('eco_target'), uSeam = U('eco_seam'), uFlow = U('eco_flow[0]'), flow = new Float32Array(MAT_N * 4);
  const uMin = U('eco_minLight'), uEye = U('eco_eye'), uFade = U('eco_fade'), uCut = U('eco_cut'), uCut2 = U('eco_cut2'), uCut3 = U('eco_cut3'), uThin = U('eco_thin'), uXf = U('eco_xfade');
  const f2 = new Float32Array(2), f3 = new Float32Array(3), f3e = new Float32Array(3), f4w = new Float32Array(4), c1 = new Float32Array(4), c2 = new Float32Array(4), c3 = new Float32Array(2), f2t = new Float32Array(2), f2x = new Float32Array(2);
  const set = (u, a, v) => { if (v) { a.set(v); u.setValue(a); } };
  // Часові аномалії (chunks.js): tanom [k_п, k_ш, увімкнено, розмір карти] → eco_tanom [фаза вітру t·k_п, t·k_ш, увімкнено,
  // розмір], eco_tanomO — кут карти (PlayCanvas x, z), eco_tanomMap — ваги (w_п, w_ш) навколо камери; поза картою — нулі
  const TM = 64, uTa = U('eco_tanom'), uTaO = U('eco_tanomO'), ta4 = new Float32Array([1, 1, 0, 256]), taO = new Float32Array(2);
  const taU = new Float32Array([0, 0, 0, 256]), ks = [1, 1, 1];
  let time = 0;
  const TAU = 2 * Math.PI, wrap = (x, p) => x - p * Math.floor(x / p);
  const taTex = new pc.Texture(dev, { name: 'eco_tanomMap', width: TM, height: TM, format: pc.PIXELFORMAT_RG8, mipmaps: false, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
  { const a = taTex.lock(); a.fill(0); taTex.unlock(); }
  U('eco_tanomMap').setValue(taTex); uTa.setValue(taU); uTaO.setValue(taO); uFlow.setValue(flow);
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
    // Уніформи кадру (PlayCanvas, світові координати): wind [x, z] (зсув вітром), curve, target, seam, time (с, не
    // загорнутий), minLight, eye, fade [від, до], cut, cut2, cut3, thin [від, до], xfade [від, до], tanom — див. chunks.js.
    // Не передане — лишається як було. Фази вітру й зсуви плину — з time тут, у подвійній точності, кожна загорнута за
    // своїм періодом: у шейдер не йдуть великі числа, а загортання не дає стрибка
    setFrame(o) {
      uMat.setValue(table);
      if (o.wind) { f4w[0] = o.wind[0]; f4w[1] = o.wind[1]; }
      if (o.curve !== undefined) uCurve.setValue(o.curve);
      set(uTarget, f3, o.target); if (o.seam !== undefined) uSeam.setValue(o.seam);
      if (o.time !== undefined) time = o.time; if (o.minLight !== undefined) uMin.setValue(o.minLight);
      set(uEye, f3e, o.eye); set(uFade, f2, o.fade);
      if (o.tanom) ta4.set(o.tanom);
      ks[1] = ta4[0]; ks[2] = ta4[1];
      f4w[2] = wrap(time * WIND_W, TAU); uWind.setValue(f4w);
      taU[0] = wrap(time * ks[1] * WIND_W, TAU); taU[1] = wrap(time * ks[2] * WIND_W, TAU); taU[2] = ta4[2]; taU[3] = ta4[3]; uTa.setValue(taU);
      for (let m = 0; m < MAT_N; m++) { const w = table[m * 4 + 3]; for (let j = 0; j < 3; j++) flow[m * 4 + j] = w ? wrap(time * ks[j] * w, FLOW_P) : 0; }
      uFlow.setValue(flow);
      set(uTaO, taO, o.tanomO);
      set(uCut, c1, o.cut); set(uCut2, c2, o.cut2); set(uCut3, c3, o.cut3); set(uThin, f2t, o.thin); set(uXf, f2x, o.xfade);
    },
    // ваги часових аномалій: Uint8Array(64·64·2) (рядок — z PlayCanvas) чи null (вимкнено)
    TANOM_N: TM,
    setTanomMap(buf) { if (buf) { const a = taTex.lock(); a.set(buf); taTex.unlock(); } },
    frame,
  };
}
