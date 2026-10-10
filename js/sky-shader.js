// js/sky-shader.js — небо гри: функція ecoSky(d) у GLSL і WGSL для engine/graphics/sky.js (skyboxPS PlayCanvas і запікання
// розсіяного світла). d — одиничний напрям у світі гри (z угору); результат — лінійний колір (кольори неба в законах —
// екранні, тож ^2,2). З ECO_BAKE (запікання): без дисків і ореолів сонць, місяців, зір, сяйва, спалаху; нижче обрію —
// колір обрію × 0,3 (земля відбиває менше за небо); × eco_bakeK (калібрування сили розсіяного, js/scene.js).
// Уніформи — через dev.scope (js/scene.js): uZen, uHor, uMain, uDusk (rgb, сила), uSun[3] (напрям, кутовий радіус),
// uSunCol[3] (колір, яскравість), uMoon[3], uMoonCol[3] (rgb, 0), uNSun, uNMoon, uDay, uStars (яскравість, відтінок),
// uCel (обертання зоряного неба), uRing (r0, r1, непрозорість, смуг), uRingCol, uPole, uCloud (хмарність, зсув x, y,
// темність), uCloudCol, uFlash, uAur (напрям на полюс x, y, сила, час), uAurCol, eco_bakeK.
// Тіло — небо старого рендера (js/gl.js SKY_FS) рядок у рядок. GLSL: уніформи — по одній на рядок

export const SKY_GLSL = `
uniform vec3 uZen;
uniform vec3 uHor;
uniform vec3 uMain;
uniform vec4 uDusk;
uniform vec4 uSun[3];
uniform vec4 uSunCol[3];
uniform vec4 uMoon[3];
uniform vec4 uMoonCol[3];
uniform int uNSun;
uniform int uNMoon;
uniform float uDay;
uniform vec2 uStars;
uniform mat3 uCel;
uniform vec4 uRing;
uniform vec3 uRingCol;
uniform vec3 uPole;
uniform vec4 uCloud;
uniform vec3 uCloudCol;
uniform float uFlash;
uniform vec4 uAur;
uniform vec3 uAurCol;
uniform float eco_bakeK;
float ecoHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float ecoNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = ecoHash(vec3(i, 1.0)), b = ecoHash(vec3(i + vec2(1, 0), 1.0)), c = ecoHash(vec3(i + vec2(0, 1), 1.0)), d = ecoHash(vec3(i + vec2(1, 1), 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float ecoFbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * ecoNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
vec3 ecoSky(vec3 d) {
  float up = d.z, above = smoothstep(-0.02, 0.01, up);
  vec3 c = up < 0.0 ? uHor * (1.0 + up * 0.35) : mix(uHor, uZen, smoothstep(0.0, 0.55, up));
  float g = max(dot(d, uMain), 0.0);
  c += uDusk.rgb * uDusk.a * (pow(g, 5.0) * 0.6 + pow(g, 40.0) * 0.4) * smoothstep(-0.25, 0.05, up);
#ifndef ECO_BAKE
  if (uStars.x > 0.01 && up > -0.05) {
    vec3 q = d * uCel, aq = abs(q);
    vec2 uv; float f;
    if (aq.x >= aq.y && aq.x >= aq.z) { uv = q.yz / aq.x; f = sign(q.x); }
    else if (aq.y >= aq.z) { uv = q.xz / aq.y; f = 2.0 + sign(q.y); }
    else { uv = q.xy / aq.z; f = 4.0 + sign(q.z); }
    uv *= 90.0;
    vec2 cell = floor(uv);
    if (ecoHash(vec3(cell, f)) > 1.0 - 0.07 * uStars.x) {
      vec2 ctr = cell + 0.25 + 0.5 * vec2(ecoHash(vec3(cell, f + 7.0)), ecoHash(vec3(cell, f + 13.0)));
      float br = smoothstep(0.34, 0.0, length(uv - ctr)) * (0.35 + 0.65 * ecoHash(vec3(cell, f + 3.0)));
      vec3 sc = mix(vec3(1.0), 0.55 + 0.45 * cos(6.2831 * (uStars.y + ecoHash(vec3(cell, f + 5.0)) * 0.3 + vec3(0.0, 0.33, 0.67))), 0.5);
      c += sc * br * uStars.x * smoothstep(-0.05, 0.12, up);
    }
  }
#endif
  if (uRing.z > 0.0) {
    float dp = dot(d, uPole);
    if (abs(dp) > 1e-4) {
      float t = -uPole.z / dp;
      if (t > 0.0) {
        float r = length(vec3(0.0, 0.0, 1.0) + t * d);
        if (r > uRing.x && r < uRing.y) {
          float u = (r - uRing.x) / (uRing.y - uRing.x);
          float band = 0.5 + 0.5 * sin(u * uRing.w * 6.2831 + 1.3) * (0.6 + 0.4 * sin(u * uRing.w * 2.3));
          float al = uRing.z * band * smoothstep(0.0, 0.06, u) * smoothstep(1.0, 0.94, u) * smoothstep(-0.03, 0.04, up);
          c = mix(c, uRingCol * (0.3 + 0.7 * uDay) + uDusk.rgb * uDusk.a * 0.2, al);
        }
      }
    }
  }
#ifndef ECO_BAKE
  for (int i = 0; i < 3; i++) {
    if (i >= uNMoon) break;
    float cs = dot(d, uMoon[i].xyz), s = uMoon[i].w;
    if (cs > cos(s)) {
      vec3 v = (d - uMoon[i].xyz * cs) / sin(s);
      float l2 = dot(v, v);
      vec3 n = normalize(v - uMoon[i].xyz * sqrt(max(0.0, 1.0 - l2)));
      float lit = smoothstep(-0.05, 0.15, dot(n, uMain));
      c = mix(c, uMoonCol[i].rgb * (0.14 + 0.86 * lit), smoothstep(1.0, 0.9, l2) * above * (1.0 - 0.45 * uDay));
    }
  }
  if (uAur.z > 0.01 && up > 0.0) {
    vec2 h = normalize(d.xy + 1e-5);
    float face = smoothstep(-0.2, 0.7, dot(h, uAur.xy)), ang = atan(h.y, h.x);
    float band = smoothstep(0.05, 0.2, up) * (1.0 - smoothstep(0.35, 0.75, up));
    float wave = ecoFbm(vec2(ang * 3.0 + uAur.w * 0.02, up * 1.5 + uAur.w * 0.01));
    float rays = 0.55 + 0.45 * sin(ang * 70.0 + ecoFbm(vec2(ang * 9.0, uAur.w * 0.05)) * 12.0);
    float a = face * band * smoothstep(0.42, 0.75, wave) * rays * uAur.z;
    c += mix(uAurCol, uAurCol.bgr, smoothstep(0.2, 0.6, up)) * a * 0.9;
  }
#endif
  float cover = 0.0;
  if (uCloud.x > 0.01 && up > 0.0) {
    vec2 uv = d.xy / (up + 0.08) * 0.9 + uCloud.yz;
    float f = ecoFbm(uv);
    cover = smoothstep(1.02 - uCloud.x * 0.75, 1.25 - uCloud.x * 0.7, f + 0.25) * smoothstep(0.0, 0.12, up);
  }
#ifndef ECO_BAKE
  for (int i = 0; i < 3; i++) {
    if (i >= uNSun) break;
    float cs = dot(d, uSun[i].xyz), s = uSun[i].w, th2 = max(0.0, 2.0 * (1.0 - cs));
    float disk = smoothstep(s * s * 1.1, s * s * 0.85, th2);
    vec3 sc = uSunCol[i].rgb;
    float hide = 1.0 - cover * 0.85;
    c = mix(c, min(vec3(1.0), sc * 1.3 + 0.15), disk * above * hide);
    c += sc * uSunCol[i].a * (exp(-th2 / (s * s * 9.0)) * 0.45 * hide + exp(-th2 / (s * s * 90.0)) * 0.12) * above;
  }
#endif
  if (cover > 0.0) {
    float sh = 1.0 - uCloud.w * smoothstep(0.3, 1.0, cover);
    c = mix(c, uCloudCol * sh + uDusk.rgb * uDusk.a * 0.25, cover * 0.92);
  }
#ifdef ECO_BAKE
  if (up < 0.0) c = uHor * 0.3;
  return pow(max(c, vec3(0.0)), vec3(2.2)) * eco_bakeK;
#else
  c += vec3(0.85, 0.88, 1.0) * uFlash * (0.5 + 0.5 * cover);
  return pow(max(c, vec3(0.0)), vec3(2.2));
#endif
}
`;

// WGSL: smoothstep зі зворотними межами (як GLSL на практиці) — ecoSs
export const SKY_WGSL = `
uniform uZen: vec3f;
uniform uHor: vec3f;
uniform uMain: vec3f;
uniform uDusk: vec4f;
uniform uSun: array<vec4f, 3>;
uniform uSunCol: array<vec4f, 3>;
uniform uMoon: array<vec4f, 3>;
uniform uMoonCol: array<vec4f, 3>;
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
uniform eco_bakeK: f32;
fn ecoHash(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(12.9898, 78.233, 45.164))) * 43758.5453); }
fn ecoNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = ecoHash(vec3f(i, 1.0));
  let b = ecoHash(vec3f(i + vec2f(1.0, 0.0), 1.0));
  let c = ecoHash(vec3f(i + vec2f(0.0, 1.0), 1.0));
  let d = ecoHash(vec3f(i + vec2f(1.0, 1.0), 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn ecoFbm(p0: vec2f) -> f32 {
  var p = p0;
  var v = 0.0;
  var a = 0.5;
  for (var i = 0; i < 5; i++) { v += a * ecoNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
fn ecoSs(e0: f32, e1: f32, x: f32) -> f32 { let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn ecoSky(d: vec3f) -> vec3f {
  let up = d.z;
  let above = ecoSs(-0.02, 0.01, up);
  var c: vec3f = select(mix(uniform.uHor, uniform.uZen, ecoSs(0.0, 0.55, up)), uniform.uHor * (1.0 + up * 0.35), up < 0.0);
  let g = max(dot(d, uniform.uMain), 0.0);
  c += uniform.uDusk.rgb * uniform.uDusk.a * (pow(g, 5.0) * 0.6 + pow(g, 40.0) * 0.4) * ecoSs(-0.25, 0.05, up);
#ifndef ECO_BAKE
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
    if (ecoHash(vec3f(cell, f)) > 1.0 - 0.07 * uniform.uStars.x) {
      let ctr = cell + 0.25 + 0.5 * vec2f(ecoHash(vec3f(cell, f + 7.0)), ecoHash(vec3f(cell, f + 13.0)));
      let br = ecoSs(0.34, 0.0, length(uv - ctr)) * (0.35 + 0.65 * ecoHash(vec3f(cell, f + 3.0)));
      let sc = mix(vec3f(1.0), 0.55 + 0.45 * cos(6.2831 * (uniform.uStars.y + ecoHash(vec3f(cell, f + 5.0)) * 0.3 + vec3f(0.0, 0.33, 0.67))), 0.5);
      c += sc * br * uniform.uStars.x * ecoSs(-0.05, 0.12, up);
    }
  }
#endif
  if (uniform.uRing.z > 0.0) {
    let dp = dot(d, uniform.uPole);
    if (abs(dp) > 1e-4) {
      let t = -uniform.uPole.z / dp;
      if (t > 0.0) {
        let r = length(vec3f(0.0, 0.0, 1.0) + t * d);
        if (r > uniform.uRing.x && r < uniform.uRing.y) {
          let u = (r - uniform.uRing.x) / (uniform.uRing.y - uniform.uRing.x);
          let band = 0.5 + 0.5 * sin(u * uniform.uRing.w * 6.2831 + 1.3) * (0.6 + 0.4 * sin(u * uniform.uRing.w * 2.3));
          let al = uniform.uRing.z * band * ecoSs(0.0, 0.06, u) * ecoSs(1.0, 0.94, u) * ecoSs(-0.03, 0.04, up);
          c = mix(c, uniform.uRingCol * (0.3 + 0.7 * uniform.uDay) + uniform.uDusk.rgb * uniform.uDusk.a * 0.2, al);
        }
      }
    }
  }
#ifndef ECO_BAKE
  for (var i = 0; i < 3; i++) {
    if (i >= uniform.uNMoon) { break; }
    let mo = uniform.uMoon[i];
    let cs = dot(d, mo.xyz);
    let s = mo.w;
    if (cs > cos(s)) {
      let v = (d - mo.xyz * cs) / sin(s);
      let l2 = dot(v, v);
      let n = normalize(v - mo.xyz * sqrt(max(0.0, 1.0 - l2)));
      let lit = ecoSs(-0.05, 0.15, dot(n, uniform.uMain));
      c = mix(c, uniform.uMoonCol[i].rgb * (0.14 + 0.86 * lit), ecoSs(1.0, 0.9, l2) * above * (1.0 - 0.45 * uniform.uDay));
    }
  }
  if (uniform.uAur.z > 0.01 && up > 0.0) {
    let h = normalize(d.xy + 1e-5);
    let face = ecoSs(-0.2, 0.7, dot(h, uniform.uAur.xy));
    let ang = atan2(h.y, h.x);
    let band = ecoSs(0.05, 0.2, up) * (1.0 - ecoSs(0.35, 0.75, up));
    let wave = ecoFbm(vec2f(ang * 3.0 + uniform.uAur.w * 0.02, up * 1.5 + uniform.uAur.w * 0.01));
    let rays = 0.55 + 0.45 * sin(ang * 70.0 + ecoFbm(vec2f(ang * 9.0, uniform.uAur.w * 0.05)) * 12.0);
    let a = face * band * ecoSs(0.42, 0.75, wave) * rays * uniform.uAur.z;
    c += mix(uniform.uAurCol, uniform.uAurCol.bgr, ecoSs(0.2, 0.6, up)) * a * 0.9;
  }
#endif
  var cover = 0.0;
  if (uniform.uCloud.x > 0.01 && up > 0.0) {
    let cuv = d.xy / (up + 0.08) * 0.9 + uniform.uCloud.yz;
    let f = ecoFbm(cuv);
    cover = ecoSs(1.02 - uniform.uCloud.x * 0.75, 1.25 - uniform.uCloud.x * 0.7, f + 0.25) * ecoSs(0.0, 0.12, up);
  }
#ifndef ECO_BAKE
  for (var i = 0; i < 3; i++) {
    if (i >= uniform.uNSun) { break; }
    let su = uniform.uSun[i];
    let cs = dot(d, su.xyz);
    let s = su.w;
    let th2 = max(0.0, 2.0 * (1.0 - cs));
    let disk = ecoSs(s * s * 1.1, s * s * 0.85, th2);
    let sc = uniform.uSunCol[i].rgb;
    let hide = 1.0 - cover * 0.85;
    c = mix(c, min(vec3f(1.0), sc * 1.3 + 0.15), disk * above * hide);
    c += sc * uniform.uSunCol[i].a * (exp(-th2 / (s * s * 9.0)) * 0.45 * hide + exp(-th2 / (s * s * 90.0)) * 0.12) * above;
  }
#endif
  if (cover > 0.0) {
    let sh = 1.0 - uniform.uCloud.w * ecoSs(0.3, 1.0, cover);
    c = mix(c, uniform.uCloudCol * sh + uniform.uDusk.rgb * uniform.uDusk.a * 0.25, cover * 0.92);
  }
#ifdef ECO_BAKE
  if (up < 0.0) { c = uniform.uHor * 0.3; }
  return pow(max(c, vec3f(0.0)), vec3f(2.2)) * uniform.eco_bakeK;
#else
  c += vec3f(0.85, 0.88, 1.0) * uniform.uFlash * (0.5 + 0.5 * cover);
  return pow(max(c, vec3f(0.0)), vec3f(2.2));
#endif
}
`;
