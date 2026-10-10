// js/engine/graphics/sky.js — небо й розсіяне світло з нього, як офіційний скрипт ProceduralSky
// (engine/scripts/sky/procedural-sky.mjs; graphics/physical-rendering/environment-lighting.md):
// - видиме небо — глобальна підміна шматка skyboxPS: нескінченний купол PlayCanvas малює функцію неба гри;
// - розсіяне світло — небо, запечене в рівнопроміжну RGBM-текстуру (drawQuadWithShader), далі EnvLighting:
//   generateLightingSource → generateAtlas → scene.envAtlas (присвоєно один раз; далі той самий об'єкт).
// Функція неба — від гри: { glsl, wgsl } з vec3 ecoSky(vec3 d) / fn ecoSky(d: vec3f) -> vec3f, d — напрям у світі гри
// (z угору), результат лінійний; з ECO_BAKE — варіант для запікання. Уніформи неба гра ставить через dev.scope
const N_GLSL = (glsl) => `
#define LIT_SKYBOX_INTENSITY
#include "envProcPS"
#include "gammaPS"
#include "tonemappingPS"
#ifdef PREPASS_PASS
  varying float vLinearDepth;
  #include "floatAsUintPS"
#endif
varying vec3 vViewDir;
${glsl}
void main(void) {
  #ifdef PREPASS_PASS
    gl_FragColor = float2vec4(vLinearDepth);
  #else
    vec3 w = normalize(vViewDir);                       // напрям у світі PlayCanvas (y — угору)
    gl_FragColor = vec4(gammaCorrectOutput(toneMap(processEnvironment(ecoSky(vec3(w.x, w.z, w.y))))), 1.0);
  #endif
}
`;
const N_WGSL = (wgsl) => `
#define LIT_SKYBOX_INTENSITY
#include "envProcPS"
#include "gammaPS"
#include "tonemappingPS"
#ifdef PREPASS_PASS
  varying vLinearDepth: f32;
  #include "floatAsUintPS"
#endif
varying vViewDir: vec3f;
${wgsl}
@fragment
fn fragmentMain(input: FragmentInput) -> FragmentOutput {
  var output: FragmentOutput;
  #ifdef PREPASS_PASS
    output.color = float2vec4(input.vLinearDepth);
  #else
    let w = normalize(input.vViewDir);
    output.color = vec4f(gammaCorrectOutput(toneMap(processEnvironment(ecoSky(vec3f(w.x, w.z, w.y))))), 1.0);
  #endif
  return output;
}
`;
// Рівнопроміжна RGBM-ціль (вершинний і кодування — зі скрипта). Напрям s — у просторі атласу (x дзеркальний, як
// вибирає PlayCanvas: «sky-space») → світ PlayCanvas w = (−s.x, s.y, s.z) → гра (w.x, w.z, w.y). V: на WebGL2 —
// 1 − v, на WebGPU — v (цілі рендеру WebGPU перевернуті; коментар скрипта)
const EQ_VS_GLSL = `
attribute vec2 vertex_position;
varying vec2 vUv0;
void main(void) {
  gl_Position = vec4(vertex_position, 0.5, 1.0);
  vUv0 = vertex_position.xy * 0.5 + 0.5;
}
`;
const EQ_VS_WGSL = `
attribute vertex_position: vec2f;
varying vUv0: vec2f;
@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4f(input.vertex_position, 0.5, 1.0);
  output.vUv0 = input.vertex_position.xy * 0.5 + 0.5;
  return output;
}
`;
const EQ_FS_GLSL = (glsl) => `
#define ECO_BAKE
varying vec2 vUv0;
${glsl}
vec4 encodeSkyRGBM(vec3 color) {
  vec3 c = pow(color, vec3(0.5)) * (1.0 / 8.0);
  float a = clamp(max(max(c.r, c.g), max(c.b, 1.0 / 255.0)), 0.0, 1.0);
  a = ceil(a * 255.0) / 255.0;
  return vec4(c / a, a);
}
void main(void) {
  vec2 sph = (vec2(vUv0.x, 1.0 - vUv0.y) * 2.0 - 1.0) * vec2(3.141592653589793, 1.5707963267948966);
  vec3 s = vec3(cos(sph.y) * sin(sph.x), sin(sph.y), cos(sph.y) * cos(sph.x));
  vec3 w = vec3(-s.x, s.y, s.z);
  gl_FragColor = encodeSkyRGBM(ecoSky(vec3(w.x, w.z, w.y)));
}
`;
const EQ_FS_WGSL = (wgsl) => `
#define ECO_BAKE
varying vUv0: vec2f;
${wgsl}
fn encodeSkyRGBM(color: vec3f) -> vec4f {
  let c = pow(color, vec3f(0.5)) * (1.0 / 8.0);
  var a = clamp(max(max(c.r, c.g), max(c.b, 1.0 / 255.0)), 0.0, 1.0);
  a = ceil(a * 255.0) / 255.0;
  return vec4f(c / a, a);
}
@fragment
fn fragmentMain(input: FragmentInput) -> FragmentOutput {
  var output: FragmentOutput;
  let sph = (vec2f(input.vUv0.x, input.vUv0.y) * 2.0 - 1.0) * vec2f(3.141592653589793, 1.5707963267948966);
  let s = vec3f(cos(sph.y) * sin(sph.x), sin(sph.y), cos(sph.y) * cos(sph.x));
  let w = vec3f(-s.x, s.y, s.z);
  output.color = encodeSkyRGBM(ecoSky(vec3f(w.x, w.z, w.y)));
  return output;
}
`;

// G — застосунок (app.js); { glsl, wgsl } — функція неба гри
export function createSky(G, { glsl, wgsl }) {
  const { pc, dev, scene } = G;
  pc.ShaderChunks.get(dev, pc.SHADERLANGUAGE_GLSL).set('skyboxPS', N_GLSL(glsl));
  pc.ShaderChunks.get(dev, pc.SHADERLANGUAGE_WGSL).set('skyboxPS', N_WGSL(wgsl));
  const shader = pc.ShaderUtils.createShader(dev, {
    uniqueName: 'EcoSkyEquirect', attributes: { vertex_position: pc.SEMANTIC_POSITION },
    vertexGLSL: EQ_VS_GLSL, fragmentGLSL: EQ_FS_GLSL(glsl), vertexWGSL: EQ_VS_WGSL, fragmentWGSL: EQ_FS_WGSL(wgsl),
  });
  scene.skyboxIntensity = 1; scene.exposure = 1;
  let rt = null, src = null, atlas = null, last = null, lastAt = -1e9, dirty = true;
  dev.on('devicerestored', () => { dirty = true; });

  function bake() {
    if (!rt) {
      const h = 128, colorBuffer = new pc.Texture(dev, {
        name: 'eco-sky-equirect', width: h * 2, height: h, format: pc.PIXELFORMAT_RGBA8, type: pc.TEXTURETYPE_RGBM,
        projection: pc.TEXTUREPROJECTION_EQUIRECT, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
        minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, mipmaps: false,
      });
      rt = new pc.RenderTarget({ name: 'eco-sky-equirect-rt', colorBuffer, depth: false });
    }
    pc.drawQuadWithShader(dev, rt, shader);
    src = pc.EnvLighting.generateLightingSource(rt.colorBuffer, { target: src, size: 64 });
    const first = !atlas;
    atlas = pc.EnvLighting.generateAtlas(src, { target: atlas, size: 256, numReflectionSamples: 256, numAmbientSamples: 512 });
    if (first) scene.envAtlas = atlas;
    dirty = false;
  }

  return {
    bake,
    // Запекти, якщо підпис неба (Float32Array від гри, перші 3 — напрям головного світила) змінився більше ніж на 0,005
    // (напрям — понад 0,5°) і від попереднього минуло ≥ 100 мс; force — одразу (новий всесвіт). Уніформи вже стоять
    maybeBake(sig, force = false) {
      const now = performance.now();
      let ch = dirty || force || !last || last.length !== sig.length;
      if (!ch) {
        const dot = sig[0] * last[0] + sig[1] * last[1] + sig[2] * last[2];
        if (dot < Math.cos(0.5 * Math.PI / 180)) ch = true;
        for (let i = 3; i < sig.length && !ch; i++) if (Math.abs(sig[i] - last[i]) > 0.005) ch = true;
      }
      if (!ch || (!force && !dirty && now - lastAt < 100)) return false;
      bake();
      last = Float32Array.from(sig); lastAt = now;
      return true;
    },
  };
}
