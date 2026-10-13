// js/engine/graphics/chunks.js — шматки шейдерів StandardMaterial PlayCanvas (GLSL і WGSL), як у прикладі
// engine/examples/shaders/trees (material.getShaderChunks(мова).add). Типові шматки — engine/src/scene/shader-lib/*/chunks.
// Своє — лише де PlayCanvas не має свого:
// - альбедо з масиву текстур (шар — номер матеріалу у вершині), поворот клітинок, плин; шов далечі (ECO_RING_IN / OUT);
// - таблиця матеріалів eco_mat[32] (x — емісія, y — гойдання вітром, z — поворот клітинок: 0 будь-який, 1 лише 180°,
//   2 без повороту; w — плин текстури);
// - емісія: лава (eco_mat.x) і мінімум світла (eco_minLight) — поверх освітлення PlayCanvas;
// - вітер і кривизна планети — у transformVS (світові координати; тіньовий прохід — той самий шматок, тож тіні теж);
// - розчинення біля ока (ECO_FADE) і «вікно» до гравця (ECO_CUT / ECO_CUTF) — через opacityPS і дизеринг PlayCanvas
//   (opacityDither, transparency.md), лише в прямому проході (FORWARD_PASS, shader-pass.js): тіні лишаються;
// - проріджування малих рослин (ECO_THIN): старші 11 біт номера матеріалу у вершині — мітка 1…2047 (0 — ні); далі від
//   цілі, ніж mix(eco_thin.x, eco_thin.y, мітка / 2047), піксель відкидається в обох проходах (і тінь теж) — до краю кола
//   трава рідшає поштучно, без межі (як відстань відсікання трави з плавним згасанням в ігрових рушіях);
// - перехід між рівнями деталізації дизерингом (як Cross Fade у LOD Group Unity): у смузі eco_xfade (від, до — відстань
//   від цілі по горизонталі) повна версія (ECO_XOUT) зникає, а спрощена (ECO_XIN) проступає — ті самі пікселі за тим самим
//   шумом (interleaved gradient noise), без перекриття й дірок; лише прямий прохід (тінь — від однієї з версій).
// Варіанти: ECO_MATCOL — матеріал у color.a (float-меші), інакше — у pos.w, а AO — у color.a (aoVertexColor).
// AO float-мешів (фігура, руки, тіла — у вершинах його немає): одне число на об'єкт — уніформа eco_ao (MeshInstance.setParameter),
// в екземплярів — instance_line1.w (у матриці там 0; transformInstancingVS — типовий шматок з w = 0); aoPS бере його замість
// кольору вершини (матеріал вмикає AO через aoVertexColor — так PlayCanvas гасить ним лише розсіяне світло)
import { pc } from './app.js';

export const MAT_N = 32;

// ---------------- GLSL ----------------
const DECL_VS = `
uniform vec4 eco_wind;
uniform vec4 eco_tanom;
uniform vec2 eco_tanomO;
uniform sampler2D eco_tanomMap;
uniform float eco_curve;
uniform vec3 eco_target;
uniform vec4 eco_mat[${MAT_N}];
uniform vec2 eco_thin;
varying float vEcoMat;
varying float vEcoThin;
#ifdef ECO_MATCOL
uniform float eco_ao;
varying float vEcoAo;
#endif
`;
const MAIN_END_VS = `
#ifdef ECO_MATCOL
  #ifdef VERTEX_COLOR
    vEcoMat = floor(vertex_color.a * 255.0 + 0.5);
  #else
    vEcoMat = 0.0;
  #endif
  vEcoThin = 1.0e6;
  #ifdef INSTANCING
    vEcoAo = instance_line1.w;
  #else
    vEcoAo = eco_ao;
  #endif
#else
  float eco_raw = floor(vertex_position.w * 65535.0 + 0.5), eco_key = floor(eco_raw / 32.0);
  vEcoMat = eco_raw - eco_key * 32.0;
  vEcoThin = eco_key > 0.5 ? mix(eco_thin.x, eco_thin.y, eco_key / 2047.0) : 1.0e6;
#endif
`;
const TRANSFORM_ADD = `
	#ifdef ECO_WIND
		float eco_wm = mod(floor(vertex_position.w * 65535.0 + 0.5), 32.0);
		if (eco_mat[int(eco_wm)].y > 0.5) {
			float eco_ph = posW.x * 0.9 + posW.z * 1.3 + posW.y * 0.7, eco_s = sin(eco_wind.z * 1.9 + eco_ph);
			if (eco_tanom.z > 0.5) {   // часові аномалії: суміш трьох часів (t, t·k_п, t·k_ш) з вагами плям
				vec2 eco_tw = textureLod(eco_tanomMap, (posW.xz - eco_tanomO) / eco_tanom.w, 0.0).rg;
				eco_s = eco_s * (1.0 - eco_tw.r - eco_tw.g) + eco_tw.r * sin(eco_wind.z * eco_tanom.x * 1.9 + eco_ph) + eco_tw.g * sin(eco_wind.z * eco_tanom.y * 1.9 + eco_ph);
			}
			posW.xz += eco_wind.xy * (0.55 + 0.45 * eco_s);
		}
	#endif
	#ifdef ECO_CURVE
		vec2 eco_dc = posW.xz - eco_target.xz;
		posW.y -= dot(eco_dc, eco_dc) * eco_curve;
	#endif
`;
const DECL_PS = `
uniform sampler2DArray uTexArr;
uniform vec4 eco_tanom;
uniform vec2 eco_tanomO;
uniform sampler2D eco_tanomMap;
uniform vec3 eco_target;
uniform float eco_seam;
uniform float eco_time;
uniform float eco_minLight;
uniform vec4 eco_mat[${MAT_N}];
uniform vec3 eco_eye;
uniform vec2 eco_fade;
uniform vec4 eco_cut;
uniform vec4 eco_cut2;
uniform vec2 eco_cut3;
uniform vec2 eco_xfade;
varying float vEcoMat;
varying float vEcoThin;
#ifdef ECO_MATCOL
varying float vEcoAo;
#endif
vec3 eco_col;
`;
// Альбедо: колір вершини (лінійний — vertexColorGamma) × текстура шару «матеріал» (sRGB — вибірка лінійна; 128 = ×1:
// (128/255)^2,2 × 4,595 = 1). Координати — проєкція світової позиції на площину грані (PlayCanvas y — угору); кожна
// клітинка — зі своїм поворотом і віддзеркаленням (за хешем клітинки й матеріалу), градієнти — до повороту (textureGrad)
const DIFFUSE_PS = `
void getAlbedo() {
  #ifdef ECO_RING_IN
    if (length(vPositionW.xz - eco_target.xz) > eco_seam) discard;
  #endif
  #ifdef ECO_RING_OUT
    if (length(vPositionW.xz - eco_target.xz) < eco_seam) discard;
  #endif
  float eco_m = floor(vEcoMat + 0.5);   // стала на трикутнику, але інтерполяція дає 18,9999 замість 19 — int() взяв би сусідній матеріал (мерехтіння)
  vec4 eco_p = eco_mat[int(min(eco_m, ${MAT_N - 1}.0))];
  vec3 an = abs(vNormalW), tp = vPositionW;
  vec2 uv = an.y >= max(an.x, an.z) ? tp.xz : (an.x >= an.z ? vec2(tp.z, -tp.y) : vec2(tp.x, -tp.y));
  uv += eco_time * eco_p.w * vec2(0.05, 0.03);
  vec2 g1 = dFdx(uv), g2 = dFdy(uv), cell = floor(uv), f = uv - cell - 0.5;
  if (eco_p.z < 1.5) {
    float h = fract(sin(dot(vec3(cell, eco_m), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    bool dir = eco_p.z > 0.5;
    int k = dir ? (h < 0.5 ? 0 : 2) : int(h * 4.0);
    mat2 Rm = k == 0 ? mat2(1.0, 0.0, 0.0, 1.0) : k == 1 ? mat2(0.0, 1.0, -1.0, 0.0) : k == 2 ? mat2(-1.0, 0.0, 0.0, -1.0) : mat2(0.0, -1.0, 1.0, 0.0);
    if (!dir && fract(h * 7.31) > 0.5) Rm = Rm * mat2(-1.0, 0.0, 0.0, 1.0);
    f = Rm * f; g1 = Rm * g1; g2 = Rm * g2;
  }
  eco_col = vVertexColor.rgb * textureGrad(uTexArr, vec3(f + 0.5, eco_m), g1, g2).rgb * 4.595;
  if (eco_tanom.z > 0.5 && eco_p.w > 0.0 && eco_p.z > 1.5) {   // плин у плямі часової аномалії: друга вибірка в часі t·k
    vec2 eco_tw = textureLod(eco_tanomMap, (vPositionW.xz - eco_tanomO) / eco_tanom.w, 0.0).rg;
    float eco_w = eco_tw.r + eco_tw.g;
    if (eco_w > 0.002) {
      vec2 uv2 = uv + eco_time * ((eco_tw.r > eco_tw.g ? eco_tanom.x : eco_tanom.y) - 1.0) * eco_p.w * vec2(0.05, 0.03);
      eco_col = mix(eco_col, vVertexColor.rgb * textureGrad(uTexArr, vec3(fract(uv2), eco_m), g1, g2).rgb * 4.595, eco_w);
    }
  }
  dAlbedo = eco_col * (1.0 - eco_p.x);
}
`;
const EMISSIVE_PS = `
void getEmission() {
  float eco_e = eco_mat[int(min(floor(vEcoMat + 0.5), ${MAT_N - 1}.0))].x;
  dEmission = eco_col * max(eco_e, eco_minLight);
}
`;
// Розчинення й «вікно». Дизеринг PlayCanvas (opacityDitherPS) відкидає піксель, коли alpha < шум^2,2 (шум рівномірний),
// тож лишається частка alpha^(1/2,2): частка t — alpha = t^2,2 (половина пікселів — 0,5^2,2 = 0,2176).
// eco_fade — від, до (відстань від ока); вимкнено — (−2, −1). eco_cut: xyz — точка гравця, w — cos півкута конуса від ока;
// eco_cut2: w — 0 вимкнено, 1 увімкнено (xyz не використовується; був напрям погляду виду згори, прибраного 13.10.2026);
// eco_cut3: x — як eco_cut.w для рослин (ширше), y — висота колін (PlayCanvas y)
const OPACITY_PS = `
uniform float material_alphaDitherScale;
void getOpacity() {
  dAlpha = 1.0;
  #ifdef ECO_THIN
    if (length(vPositionW.xz - eco_target.xz) > vEcoThin) dAlpha = 0.0;
  #endif
  #ifdef FORWARD_PASS
  #if defined(ECO_XIN) || defined(ECO_XOUT)
    float eco_xf = clamp((length(vPositionW.xz - eco_target.xz) - eco_xfade.x) / (eco_xfade.y - eco_xfade.x), 0.0, 1.0);
    float eco_xn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    #ifdef ECO_XOUT
      if (eco_xf > eco_xn) dAlpha = 0.0;
    #else
      if (eco_xf <= eco_xn) dAlpha = 0.0;
    #endif
  #endif
  float eco_d = distance(vPositionW, eco_eye);
  #ifdef ECO_FADE
    dAlpha *= pow(clamp((eco_d - eco_fade.x) / (eco_fade.y - eco_fade.x), 0.0, 1.0), 2.2);
  #endif
  #if defined(ECO_CUT) || defined(ECO_CUTF)
    if (eco_cut2.w > 0.5 && vPositionW.y > eco_cut3.y && eco_d < distance(eco_cut.xyz, eco_eye)) {
      #ifdef ECO_CUTF
        float eco_k = eco_cut3.x;
      #else
        float eco_k = eco_cut.w;
      #endif
      if (dot(normalize(vPositionW - eco_eye), normalize(eco_cut.xyz - eco_eye)) > eco_k) dAlpha = min(dAlpha, 0.2176);
    }
  #endif
  #endif
}
`;
const AO_PS = `
void getAO() {
  dAo = vEcoAo;
}
`;
const INSTANCING_VS = `
attribute vec4 instance_line1;
attribute vec4 instance_line2;
attribute vec4 instance_line3;
attribute vec4 instance_line4;

mat4 getModelMatrix() {
    return matrix_model * mat4(vec4(instance_line1.xyz, 0.0), instance_line2, instance_line3, instance_line4);
}
`;

// ---------------- WGSL: уніформи — uniform.ім'я, текстура — пара ім'я + ім'яSampler, варіації в PS — глобальні ----------------
const DECL_VS_W = `
uniform eco_wind: vec4f;
uniform eco_tanom: vec4f;
uniform eco_tanomO: vec2f;
var eco_tanomMap: texture_2d<f32>;
var eco_tanomMapSampler: sampler;
uniform eco_curve: f32;
uniform eco_target: vec3f;
uniform eco_mat: array<vec4f, ${MAT_N}>;
uniform eco_thin: vec2f;
varying vEcoMat: f32;
varying vEcoThin: f32;
#ifdef ECO_MATCOL
uniform eco_ao: f32;
varying vEcoAo: f32;
#endif
`;
const MAIN_END_VS_W = `
#ifdef ECO_MATCOL
  #ifdef VERTEX_COLOR
    output.vEcoMat = floor(vertex_color.a * 255.0 + 0.5);
  #else
    output.vEcoMat = 0.0;
  #endif
  output.vEcoThin = 1.0e6;
  #ifdef INSTANCING
    output.vEcoAo = instance_line1.w;
  #else
    output.vEcoAo = uniform.eco_ao;
  #endif
#else
  let eco_raw: f32 = floor(vertex_position.w * 65535.0 + 0.5);
  let eco_key: f32 = floor(eco_raw / 32.0);
  output.vEcoMat = eco_raw - eco_key * 32.0;
  output.vEcoThin = select(1.0e6, mix(uniform.eco_thin.x, uniform.eco_thin.y, eco_key / 2047.0), eco_key > 0.5);
#endif
`;
const TRANSFORM_ADD_W = `
	#ifdef ECO_WIND
		let eco_wr: f32 = floor(vertex_position.w * 65535.0 + 0.5);
		let eco_wm: f32 = eco_wr - floor(eco_wr / 32.0) * 32.0;
		if (uniform.eco_mat[i32(eco_wm)].y > 0.5) {
			let eco_ph: f32 = posW.x * 0.9 + posW.z * 1.3 + posW.y * 0.7;
			var eco_s: f32 = sin(uniform.eco_wind.z * 1.9 + eco_ph);
			if (uniform.eco_tanom.z > 0.5) {
				let eco_tw: vec2f = textureSampleLevel(eco_tanomMap, eco_tanomMapSampler, (posW.xz - uniform.eco_tanomO) / uniform.eco_tanom.w, 0.0).rg;
				eco_s = eco_s * (1.0 - eco_tw.r - eco_tw.g) + eco_tw.r * sin(uniform.eco_wind.z * uniform.eco_tanom.x * 1.9 + eco_ph) + eco_tw.g * sin(uniform.eco_wind.z * uniform.eco_tanom.y * 1.9 + eco_ph);
			}
			eco_s = 0.55 + 0.45 * eco_s;
			posW.x = posW.x + uniform.eco_wind.x * eco_s;
			posW.z = posW.z + uniform.eco_wind.y * eco_s;
		}
	#endif
	#ifdef ECO_CURVE
		let eco_dc: vec2f = posW.xz - uniform.eco_target.xz;
		posW.y = posW.y - dot(eco_dc, eco_dc) * uniform.eco_curve;
	#endif
`;
const DECL_PS_W = `
var uTexArr: texture_2d_array<f32>;
var uTexArrSampler: sampler;
uniform eco_tanom: vec4f;
uniform eco_tanomO: vec2f;
var eco_tanomMap: texture_2d<f32>;
var eco_tanomMapSampler: sampler;
uniform eco_target: vec3f;
uniform eco_seam: f32;
uniform eco_time: f32;
uniform eco_minLight: f32;
uniform eco_mat: array<vec4f, ${MAT_N}>;
uniform eco_eye: vec3f;
uniform eco_fade: vec2f;
uniform eco_cut: vec4f;
uniform eco_cut2: vec4f;
uniform eco_cut3: vec2f;
uniform eco_xfade: vec2f;
varying vEcoMat: f32;
varying vEcoThin: f32;
#ifdef ECO_MATCOL
varying vEcoAo: f32;
#endif
var<private> eco_col: vec3f;
`;
// Похідні (dpdx) — лише в рівномірному потоці керування: координати — через select, шов (discard) — у кінці
const DIFFUSE_PS_W = `
fn getAlbedo() {
  let eco_m: f32 = floor(vEcoMat + 0.5);   // див. GLSL: інтерполяція сталої не точна
  let eco_p: vec4f = uniform.eco_mat[i32(min(eco_m, ${MAT_N - 1}.0))];
  let an: vec3f = abs(vNormalW);
  let tp: vec3f = vPositionW;
  var uv: vec2f = select(select(vec2f(tp.x, -tp.y), vec2f(tp.z, -tp.y), an.x >= an.z), tp.xz, an.y >= max(an.x, an.z));
  uv = uv + uniform.eco_time * eco_p.w * vec2f(0.05, 0.03);
  var g1: vec2f = dpdx(uv);
  var g2: vec2f = dpdy(uv);
  let cell: vec2f = floor(uv);
  var f: vec2f = uv - cell - 0.5;
  if (eco_p.z < 1.5) {
    let h: f32 = fract(sin(dot(vec3f(cell, eco_m), vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
    let dir: bool = eco_p.z > 0.5;
    var k: i32 = i32(h * 4.0);
    if (dir) { k = select(2, 0, h < 0.5); }
    var Rm: mat2x2f = mat2x2f(1.0, 0.0, 0.0, 1.0);
    if (k == 1) { Rm = mat2x2f(0.0, 1.0, -1.0, 0.0); } else if (k == 2) { Rm = mat2x2f(-1.0, 0.0, 0.0, -1.0); } else if (k == 3) { Rm = mat2x2f(0.0, -1.0, 1.0, 0.0); }
    if (!dir && fract(h * 7.31) > 0.5) { Rm = Rm * mat2x2f(-1.0, 0.0, 0.0, 1.0); }
    f = Rm * f; g1 = Rm * g1; g2 = Rm * g2;
  }
  eco_col = vVertexColor.rgb * textureSampleGrad(uTexArr, uTexArrSampler, f + 0.5, i32(eco_m), g1, g2).rgb * 4.595;
  if (uniform.eco_tanom.z > 0.5 && eco_p.w > 0.0 && eco_p.z > 1.5) {
    let eco_tw: vec2f = textureSampleLevel(eco_tanomMap, eco_tanomMapSampler, (vPositionW.xz - uniform.eco_tanomO) / uniform.eco_tanom.w, 0.0).rg;
    let eco_w: f32 = eco_tw.r + eco_tw.g;
    if (eco_w > 0.002) {
      let uv2: vec2f = uv + uniform.eco_time * (select(uniform.eco_tanom.y, uniform.eco_tanom.x, eco_tw.r > eco_tw.g) - 1.0) * eco_p.w * vec2f(0.05, 0.03);
      eco_col = mix(eco_col, vVertexColor.rgb * textureSampleGrad(uTexArr, uTexArrSampler, fract(uv2), i32(eco_m), g1, g2).rgb * 4.595, eco_w);
    }
  }
  dAlbedo = eco_col * (1.0 - eco_p.x);
  #ifdef ECO_RING_IN
    if (length(vPositionW.xz - uniform.eco_target.xz) > uniform.eco_seam) { discard; }
  #endif
  #ifdef ECO_RING_OUT
    if (length(vPositionW.xz - uniform.eco_target.xz) < uniform.eco_seam) { discard; }
  #endif
}
`;
const EMISSIVE_PS_W = `
fn getEmission() {
  let eco_e: f32 = uniform.eco_mat[i32(min(floor(vEcoMat + 0.5), ${MAT_N - 1}.0))].x;
  dEmission = eco_col * max(eco_e, uniform.eco_minLight);
}
`;
const OPACITY_PS_W = `
uniform material_alphaDitherScale: f32;
fn getOpacity() {
  dAlpha = 1.0;
  #ifdef ECO_THIN
    if (length(vPositionW.xz - uniform.eco_target.xz) > vEcoThin) { dAlpha = 0.0; }
  #endif
  #ifdef FORWARD_PASS
  #if defined(ECO_XIN) || defined(ECO_XOUT)
    let eco_xf: f32 = clamp((length(vPositionW.xz - uniform.eco_target.xz) - uniform.eco_xfade.x) / (uniform.eco_xfade.y - uniform.eco_xfade.x), 0.0, 1.0);
    let eco_xn: f32 = fract(52.9829189 * fract(dot(pcPosition.xy, vec2f(0.06711056, 0.00583715))));
    #ifdef ECO_XOUT
      if (eco_xf > eco_xn) { dAlpha = 0.0; }
    #else
      if (eco_xf <= eco_xn) { dAlpha = 0.0; }
    #endif
  #endif
  let eco_d: f32 = distance(vPositionW, uniform.eco_eye);
  #ifdef ECO_FADE
    dAlpha = dAlpha * pow(clamp((eco_d - uniform.eco_fade.x) / (uniform.eco_fade.y - uniform.eco_fade.x), 0.0, 1.0), 2.2);
  #endif
  #if defined(ECO_CUT) || defined(ECO_CUTF)
    if (uniform.eco_cut2.w > 0.5 && vPositionW.y > uniform.eco_cut3.y && eco_d < distance(uniform.eco_cut.xyz, uniform.eco_eye)) {
      #ifdef ECO_CUTF
        let eco_k: f32 = uniform.eco_cut3.x;
      #else
        let eco_k: f32 = uniform.eco_cut.w;
      #endif
      if (dot(normalize(vPositionW - uniform.eco_eye), normalize(uniform.eco_cut.xyz - uniform.eco_eye)) > eco_k) { dAlpha = min(dAlpha, 0.2176); }
    }
  #endif
  #endif
}
`;
const AO_PS_W = `
fn getAO() {
  dAo = vEcoAo;
}
`;
const INSTANCING_VS_W = `
attribute instance_line1: vec4f;
attribute instance_line2: vec4f;
attribute instance_line3: vec4f;
attribute instance_line4: vec4f;

fn getModelMatrix() -> mat4x4f {
    return uniform.matrix_model * mat4x4f(vec4f(instance_line1.xyz, 0.0), instance_line2, instance_line3, instance_line4);
}
`;

// Обрис (OutlineRenderer): у його проході компілюються лише вершинні шматки — вітер (з часовими аномаліями) і кривизна,
// як у рослин, тож обрис гойдається разом з ними; номер матеріалу — у pos.w (як у щільних вершинах)
const OUT_DECL_VS = `
uniform vec4 eco_wind;
uniform vec4 eco_tanom;
uniform vec2 eco_tanomO;
uniform sampler2D eco_tanomMap;
uniform float eco_curve;
uniform vec3 eco_target;
uniform vec4 eco_mat[${MAT_N}];
`;
const OUT_DECL_VS_W = `
uniform eco_wind: vec4f;
uniform eco_tanom: vec4f;
uniform eco_tanomO: vec2f;
var eco_tanomMap: texture_2d<f32>;
var eco_tanomMapSampler: sampler;
uniform eco_curve: f32;
uniform eco_target: vec3f;
uniform eco_mat: array<vec4f, ${MAT_N}>;
`;

// transformVS — типовий шматок рушія з нашим кодом після рядка-якоря (обчислення світової позиції)
const ANCHOR = {
  [pc.SHADERLANGUAGE_GLSL]: 'vec4 posW = modelMatrix * vec4(localPos, 1.0);',
  [pc.SHADERLANGUAGE_WGSL]: 'var posW: vec4f = modelMatrix * vec4f(localPos, 1.0);',
};
const cache = new Map();
const transformOf = (dev, lang) => {
  const base = pc.ShaderChunks.get(dev, lang).get('transformVS'), a = ANCHOR[lang];
  if (!base || !base.includes(a)) throw new Error('transformVS PlayCanvas змінився');
  return base.replace(a, a + (lang === pc.SHADERLANGUAGE_WGSL ? TRANSFORM_ADD_W : TRANSFORM_ADD));
};
// Шматки матеріалу обрису (лише вершинні: вітер ECO_WIND і кривизна ECO_CURVE)
export function outlineChunks(dev, lang) {
  return { litUserDeclarationVS: lang === pc.SHADERLANGUAGE_WGSL ? OUT_DECL_VS_W : OUT_DECL_VS, transformVS: transformOf(dev, lang) };
}
// Шматки для мови lang; opacity — лише для варіантів з дизерингом (розчинення, «вікно»); matcol — float-меші (ECO_MATCOL):
// AO об'єкта
export function chunksFor(dev, lang, { opacity = false, matcol = false } = {}) {
  let C = cache.get(lang);
  if (!C) {
    const W = lang === pc.SHADERLANGUAGE_WGSL;
    C = {
      litUserDeclarationVS: W ? DECL_VS_W : DECL_VS,
      litUserMainEndVS: W ? MAIN_END_VS_W : MAIN_END_VS,
      transformVS: transformOf(dev, lang),
      litUserDeclarationPS: W ? DECL_PS_W : DECL_PS,
      diffusePS: W ? DIFFUSE_PS_W : DIFFUSE_PS,
      emissivePS: W ? EMISSIVE_PS_W : EMISSIVE_PS,
      opacityPS: W ? OPACITY_PS_W : OPACITY_PS,
      matcolAoPS: W ? AO_PS_W : AO_PS,
      matcolInstancingVS: W ? INSTANCING_VS_W : INSTANCING_VS,
    };
    cache.set(lang, C);
  }
  const { opacityPS, matcolAoPS, matcolInstancingVS, ...rest } = C;
  if (opacity) rest.opacityPS = opacityPS;
  if (matcol) { rest.aoPS = matcolAoPS; rest.transformInstancingVS = matcolInstancingVS; }
  return rest;
}
