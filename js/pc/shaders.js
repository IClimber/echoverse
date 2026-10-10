// js/pc/shaders.js — шматки шейдерів PlayCanvas для прототипу ?pc, у двох мовах: GLSL (WebGL2) і WGSL (WebGPU) — так радить
// PlayCanvas (без WGSL рушій на WebGPU транспілював би GLSL). Свої — лише де PlayCanvas не має свого: альбедо з масиву
// текстур (шар — матеріал у четвертому байті кольору вершини), шов із плитками далечі, наше небо.
// GLSL: уніформи — по одній на рядок (WebglShaderProcessorGLSL збирає рядки VS і FS; однакові зливаються)
import { SKY_FS as SKY_GL } from '../gl.js';

export const DECL_PS = `
uniform sampler2DArray uTexArr;
uniform vec3 eco_target;
uniform float eco_seam;
uniform float eco_time;
`;
// Альбедо: колір вершини (уже лінійний — vertexColorGamma) × текстура шару «матеріал» (128 = ×1). Координати — проєкція
// світової позиції на площину грані (у PlayCanvas y — угору: наші x, y, z = x, z, y); кожна клітинка — зі своїм поворотом
// і віддзеркаленням. ECO_RING_IN / ECO_RING_OUT — шов далечі: лише ближче / далі за eco_seam від цілі камери
export const DIFFUSE_PS = `
void getAlbedo() {
  #ifdef ECO_RING_IN
    if (length(vPositionW.xz - eco_target.xz) > eco_seam) discard;
  #endif
  #ifdef ECO_RING_OUT
    if (length(vPositionW.xz - eco_target.xz) < eco_seam) discard;
  #endif
  float eco_m = floor(vVertexColor.a * 255.0 + 0.5);
  vec3 an = abs(vNormalW), tp = vPositionW;
  vec2 uv = an.y >= max(an.x, an.z) ? tp.xz : (an.x >= an.z ? vec2(tp.z, -tp.y) : vec2(tp.x, -tp.y));
  uv += eco_m == 1.0 ? eco_time * vec2(0.05, 0.03) : eco_m == 19.0 ? eco_time * vec2(0.008, 0.005) : vec2(0.0);
  vec2 g1 = dFdx(uv), g2 = dFdy(uv), cell = floor(uv), f = uv - cell - 0.5;
  if (eco_m != 1.0 && eco_m != 19.0 && eco_m != 16.0) {
    float h = fract(sin(dot(vec3(cell, eco_m), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    bool dir = eco_m == 3.0 || eco_m == 6.0 || eco_m == 10.0 || eco_m == 11.0 || eco_m == 13.0;
    int k = dir ? (h < 0.5 ? 0 : 2) : int(h * 4.0);
    mat2 Rm = k == 0 ? mat2(1.0, 0.0, 0.0, 1.0) : k == 1 ? mat2(0.0, 1.0, -1.0, 0.0) : k == 2 ? mat2(-1.0, 0.0, 0.0, -1.0) : mat2(0.0, -1.0, 1.0, 0.0);
    if (!dir && fract(h * 7.31) > 0.5) Rm = Rm * mat2(-1.0, 0.0, 0.0, 1.0);
    f = Rm * f; g1 = Rm * g1; g2 = Rm * g2;
  }
  dAlbedo = vVertexColor.rgb * textureGrad(uTexArr, vec3(f + 0.5, eco_m), g1, g2).rgb * 2.0;
}
`;
// Небо js/gl.js як ShaderMaterial: трикутник на весь екран на глибині 1 (шар Skybox — після твердого, лише фон)
export const SKY_VS = `
attribute vec3 aPosition;
varying vec2 vN;
void main(void) {
  vN = aPosition.xy;
  gl_Position = vec4(aPosition.xy, 1.0, 1.0);
}
`;
export const SKY_FS = SKY_GL
  .replace('#version 300 es\n', '')
  .replace(/\/\/.*$/gm, '')
  .replace(/^uniform (\w+) ([^;]+);/gm, (s, t, names) => names.split(',').map((v) => `uniform ${t} ${v.trim()};`).join('\n'))
  .replace('in vec2 vN;', 'varying vec2 vN;')
  .replace('out vec4 o;', '')
  .replace('o = vec4(c, 1.0);', 'gl_FragColor = vec4(c, 1.0);');

// ---- WGSL (WebGPU): ті самі шматки. Уніформи — `uniform.ім'я`, текстура — пара `ім'я` + `ім'яSampler`, варіації — глобальні
export const DECL_WGSL = `
var uTexArr: texture_2d_array<f32>;
var uTexArrSampler: sampler;
uniform eco_target: vec3f;
uniform eco_seam: f32;
uniform eco_time: f32;
`;
// Похідні (dpdx) — лише в рівномірному потоці керування: координати — через select, шов (discard) — у кінці
export const DIFFUSE_WGSL = `
fn getAlbedo() {
  let eco_m: f32 = floor(vVertexColor.a * 255.0 + 0.5);
  let an: vec3f = abs(vNormalW);
  let tp: vec3f = vPositionW;
  var uv: vec2f = select(select(vec2f(tp.x, -tp.y), vec2f(tp.z, -tp.y), an.x >= an.z), tp.xz, an.y >= max(an.x, an.z));
  uv = uv + select(select(vec2f(0.0), uniform.eco_time * vec2f(0.008, 0.005), eco_m == 19.0), uniform.eco_time * vec2f(0.05, 0.03), eco_m == 1.0);
  var g1: vec2f = dpdx(uv);
  var g2: vec2f = dpdy(uv);
  let cell: vec2f = floor(uv);
  var f: vec2f = uv - cell - 0.5;
  if (eco_m != 1.0 && eco_m != 19.0 && eco_m != 16.0) {
    let h: f32 = fract(sin(dot(vec3f(cell, eco_m), vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
    let dir: bool = eco_m == 3.0 || eco_m == 6.0 || eco_m == 10.0 || eco_m == 11.0 || eco_m == 13.0;
    var k: i32 = i32(h * 4.0);
    if (dir) { k = select(2, 0, h < 0.5); }
    var Rm: mat2x2f = mat2x2f(1.0, 0.0, 0.0, 1.0);
    if (k == 1) { Rm = mat2x2f(0.0, 1.0, -1.0, 0.0); } else if (k == 2) { Rm = mat2x2f(-1.0, 0.0, 0.0, -1.0); } else if (k == 3) { Rm = mat2x2f(0.0, -1.0, 1.0, 0.0); }
    if (!dir && fract(h * 7.31) > 0.5) { Rm = Rm * mat2x2f(-1.0, 0.0, 0.0, 1.0); }
    f = Rm * f; g1 = Rm * g1; g2 = Rm * g2;
  }
  dAlbedo = vVertexColor.rgb * textureSampleGrad(uTexArr, uTexArrSampler, f + 0.5, i32(eco_m), g1, g2).rgb * 2.0;
  #ifdef ECO_RING_IN
    if (length(vPositionW.xz - uniform.eco_target.xz) > uniform.eco_seam) { discard; }
  #endif
  #ifdef ECO_RING_OUT
    if (length(vPositionW.xz - uniform.eco_target.xz) < uniform.eco_seam) { discard; }
  #endif
}
`;
export const SKY_VS_WGSL = `
attribute aPosition: vec3f;
varying vN: vec2f;
@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.vN = input.aPosition.xy;
  output.position = vec4f(input.aPosition.xy, 1.0, 1.0);
  return output;
}
`;
// Небо js/gl.js (SKY_FS) рядок у рядок; ss — smoothstep, що працює й із зворотними межами (як GLSL на практиці)
export const SKY_FS_WGSL = `
varying vN: vec2f;
uniform uInv: mat4x4f;
uniform uZen: vec3f;
uniform uHor: vec3f;
uniform uMain: vec3f;
uniform uDusk: vec4f;
uniform uSun: array<vec4f, 3>;
uniform uSunCol: array<vec4f, 3>;
uniform uMoon: array<vec4f, 3>;
uniform uMoonCol: array<vec3f, 3>;
uniform uNSun: i32;
uniform uNMoon: i32;
uniform uDay: f32;
uniform uStars: vec2f;
uniform uCel: mat3x3f;
uniform uRing: vec4f;
uniform uRingCol: vec3f;
uniform uPole: vec3f;
uniform uCloud: vec4f;
uniform uCloudCol: vec3f;
uniform uFlash: f32;
uniform uAur: vec4f;
uniform uAurCol: vec3f;
fn hash3(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(12.9898, 78.233, 45.164))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash3(vec3f(i, 1.0));
  let b = hash3(vec3f(i + vec2f(1.0, 0.0), 1.0));
  let c = hash3(vec3f(i + vec2f(0.0, 1.0), 1.0));
  let d = hash3(vec3f(i + vec2f(1.0, 1.0), 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p0: vec2f) -> f32 {
  var p = p0;
  var v = 0.0;
  var a = 0.5;
  for (var i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
fn ss(e0: f32, e1: f32, x: f32) -> f32 { let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
@fragment
fn fragmentMain(input: FragmentInput) -> FragmentOutput {
  var output: FragmentOutput;
  let a4 = uniform.uInv * vec4f(input.vN, -1.0, 1.0);
  let b4 = uniform.uInv * vec4f(input.vN, 1.0, 1.0);
  let d = normalize(b4.xyz / b4.w - a4.xyz / a4.w);
  let up = d.z;
  let above = ss(-0.02, 0.01, up);
  var c: vec3f = select(mix(uniform.uHor, uniform.uZen, ss(0.0, 0.55, up)), uniform.uHor * (1.0 + up * 0.35), up < 0.0);
  let g = max(dot(d, uniform.uMain), 0.0);
  c += uniform.uDusk.rgb * uniform.uDusk.a * (pow(g, 5.0) * 0.6 + pow(g, 40.0) * 0.4) * ss(-0.25, 0.05, up);
  if (uniform.uStars.x > 0.01 && up > -0.05) {
    let q = d * uniform.uCel;
    let aq = abs(q);
    var uv: vec2f;
    var f: f32;
    if (aq.x >= aq.y && aq.x >= aq.z) { uv = q.yz / aq.x; f = sign(q.x); }
    else if (aq.y >= aq.z) { uv = q.xz / aq.y; f = 2.0 + sign(q.y); }
    else { uv = q.xy / aq.z; f = 4.0 + sign(q.z); }
    uv *= 90.0;
    let cell = floor(uv);
    if (hash3(vec3f(cell, f)) > 1.0 - 0.07 * uniform.uStars.x) {
      let ctr = cell + 0.25 + 0.5 * vec2f(hash3(vec3f(cell, f + 7.0)), hash3(vec3f(cell, f + 13.0)));
      let br = ss(0.34, 0.0, length(uv - ctr)) * (0.35 + 0.65 * hash3(vec3f(cell, f + 3.0)));
      let sc = mix(vec3f(1.0), 0.55 + 0.45 * cos(6.2831 * (uniform.uStars.y + hash3(vec3f(cell, f + 5.0)) * 0.3 + vec3f(0.0, 0.33, 0.67))), 0.5);
      c += sc * br * uniform.uStars.x * ss(-0.05, 0.12, up);
    }
  }
  if (uniform.uRing.z > 0.0) {
    let dp = dot(d, uniform.uPole);
    if (abs(dp) > 1e-4) {
      let t = -uniform.uPole.z / dp;
      if (t > 0.0) {
        let r = length(vec3f(0.0, 0.0, 1.0) + t * d);
        if (r > uniform.uRing.x && r < uniform.uRing.y) {
          let u = (r - uniform.uRing.x) / (uniform.uRing.y - uniform.uRing.x);
          let band = 0.5 + 0.5 * sin(u * uniform.uRing.w * 6.2831 + 1.3) * (0.6 + 0.4 * sin(u * uniform.uRing.w * 2.3));
          let al = uniform.uRing.z * band * ss(0.0, 0.06, u) * ss(1.0, 0.94, u) * ss(-0.03, 0.04, up);
          c = mix(c, uniform.uRingCol * (0.3 + 0.7 * uniform.uDay) + uniform.uDusk.rgb * uniform.uDusk.a * 0.2, al);
        }
      }
    }
  }
  for (var i = 0; i < 3; i++) {
    if (i >= uniform.uNMoon) { break; }
    let mo = uniform.uMoon[i];
    let cs = dot(d, mo.xyz);
    let s = mo.w;
    if (cs > cos(s)) {
      let v = (d - mo.xyz * cs) / sin(s);
      let l2 = dot(v, v);
      let n = normalize(v - mo.xyz * sqrt(max(0.0, 1.0 - l2)));
      let lit = ss(-0.05, 0.15, dot(n, uniform.uMain));
      c = mix(c, uniform.uMoonCol[i] * (0.14 + 0.86 * lit), ss(1.0, 0.9, l2) * above * (1.0 - 0.45 * uniform.uDay));
    }
  }
  if (uniform.uAur.z > 0.01 && up > 0.0) {
    let h = normalize(d.xy + 1e-5);
    let face = ss(-0.2, 0.7, dot(h, uniform.uAur.xy));
    let ang = atan2(h.y, h.x);
    let band = ss(0.05, 0.2, up) * (1.0 - ss(0.35, 0.75, up));
    let wave = fbm(vec2f(ang * 3.0 + uniform.uAur.w * 0.02, up * 1.5 + uniform.uAur.w * 0.01));
    let rays = 0.55 + 0.45 * sin(ang * 70.0 + fbm(vec2f(ang * 9.0, uniform.uAur.w * 0.05)) * 12.0);
    let a = face * band * ss(0.42, 0.75, wave) * rays * uniform.uAur.z;
    c += mix(uniform.uAurCol, uniform.uAurCol.bgr, ss(0.2, 0.6, up)) * a * 0.9;
  }
  var cover = 0.0;
  if (uniform.uCloud.x > 0.01 && up > 0.0) {
    let cuv = d.xy / (up + 0.08) * 0.9 + uniform.uCloud.yz;
    let f = fbm(cuv);
    cover = ss(1.02 - uniform.uCloud.x * 0.75, 1.25 - uniform.uCloud.x * 0.7, f + 0.25) * ss(0.0, 0.12, up);
  }
  for (var i = 0; i < 3; i++) {
    if (i >= uniform.uNSun) { break; }
    let su = uniform.uSun[i];
    let cs = dot(d, su.xyz);
    let s = su.w;
    let th2 = max(0.0, 2.0 * (1.0 - cs));
    let disk = ss(s * s * 1.1, s * s * 0.85, th2);
    let sc = uniform.uSunCol[i].rgb;
    let hide = 1.0 - cover * 0.85;
    c = mix(c, min(vec3f(1.0), sc * 1.3 + 0.15), disk * above * hide);
    c += sc * uniform.uSunCol[i].a * (exp(-th2 / (s * s * 9.0)) * 0.45 * hide + exp(-th2 / (s * s * 90.0)) * 0.12) * above;
  }
  if (cover > 0.0) {
    let sh = 1.0 - uniform.uCloud.w * ss(0.3, 1.0, cover);
    c = mix(c, uniform.uCloudCol * sh + uniform.uDusk.rgb * uniform.uDusk.a * 0.25, cover * 0.92);
  }
  c += vec3f(0.85, 0.88, 1.0) * uniform.uFlash * (0.5 + 0.5 * cover);
  output.color = vec4f(c, 1.0);
  return output;
}
`;
