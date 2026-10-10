// gl.js — WebGL2 без бібліотек: шейдер пласких граней у варіантах (колір вершини, напрямлене світло, туман), арени
// щільних вершин регіонів (спільний буфер, multi-draw), окремі меші (VAO) для фігури, тіней, плиток далечі, тіл;
// матриця камери (camera.js: ізометрія чи третя особа). Буфер глибини сам вирішує, що попереду. Позиції — локальні;
// зсув від цілі камери (кут регіону, матриця моделі) рахується у float64 на CPU (далеко від початку float32 тремтів би).
import { createAlloc } from './engine/graphics/arena.js';

// Шейдер граней — один текст, варіанти через #define (кеш програм у createGL):
// INST — екземпляри (тіла: шаблон з поворотом, нахилом, масштабом з атрибутів 4–5).
// PACKED — щільна вершина регіону (pack.js: позиція u16 у 1/128 від кута регіону, uOrigin — кут відносно цілі),
// інакше — float-позиції з матрицею моделі (фігура, тінь, плитки далечі, тіла). RING — малювати лише між uRing.x і
// uRing.y від цілі по горизонталі (шов далечі); FADE — розчинення біля ока (рослини в третій особі); CUT / CUTF — «вікно»
// до гравця (CUTF — ширше, для рослин). Без визначень — жодного discard. Спільне на кадр — UBO Frame (один запис у begin)
const FRAME = `layout(std140) uniform Frame {
  mat4 uView;       // камера: відносно цілі → clip
  vec4 uLight;      // напрям світла; w — розсіяне
  vec4 uLightCol;   // колір світла; w — кривизна планети (далечінь опускається на d² · w, 1 / 2R)
  vec4 uFogCol;     // колір туману; w — місцевий час
  vec4 uFog;        // туман від x до y; розчинення рослин: ближче за z до ока — зникли, від z до w — дизеринг (w = 0 — вимкнено)
  vec4 uFR;         // туман згори: осі екрана (відстань — на екрані); у третій особі — нулі (відстань по горизонталі)
  vec4 uFU;
  vec4 uWind;       // вітер: x, y — напрям і сила гойдання листя й трави, z — час
  vec4 uEye;        // око (відносно цілі)
  vec4 uCut;        // «вікно» до гравця: x, y — px, z — радіус px (0 — вимкнено), w — висота відсікання
  vec4 uCutF;       // те саме ширше (рослини)
  vec4 uMisc;       // x — глибина гравця (як gl_FragCoord.z)
};`;
const VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec3 aCol;
layout(location = 3) in float aMat;  // матеріал — шар текстури
#ifdef INST
layout(location = 4) in vec4 iPos;   // (INST) екземпляр: основа відносно цілі, поворот навколо z
layout(location = 5) in vec2 iTS;    // нахил (навколо x), масштаб
#endif
${FRAME}
uniform mat4 uModel;      // (не PACKED) локальні координати → світ відносно цілі (зсув, повороти, рівномірний масштаб)
uniform vec3 uOrigin;     // (PACKED) кут регіону відносно цілі
uniform vec3 uCell;       // (PACKED) кут регіону за модулем 1024 — світові клітинки текстур
uniform vec3 uTint;
out vec3 vCol, vW;
out float vFog;
out vec2 vUV;
flat out float vMat;
void main() {
#ifdef PACKED
  vec3 lp = aPos * (1.0 / 128.0) - vec3(192.0, 192.0, 64.0), tp = lp + uCell;
#else
  vec3 lp = aPos, tp = aPos;
#endif
  // Текстурні координати — проєкція позиції на площину грані (1 одиниця = одна текстура; угору — угору)
  vec3 an = abs(aNor);
  vUV = an.z >= max(an.x, an.y) ? tp.xy : (an.x >= an.y ? vec2(tp.y, -tp.z) : vec2(tp.x, -tp.z));
  vMat = aMat;
  if (aMat == 12.0 || aMat == 20.0 || aMat == 21.0)        // листя, пелюстки, трава гойдаються від вітру
    lp.xy += uWind.xy * (0.55 + 0.45 * sin(uWind.z * 1.9 + tp.x * 0.9 + tp.y * 1.3 + tp.z * 0.7));
#if defined(PACKED)
  vec3 p = lp + uOrigin, n = normalize(aNor);
#elif defined(INST)
  float c = cos(iPos.w), s = sin(iPos.w), ct = cos(iTS.x), st = sin(iTS.x);
  mat3 Rm = mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0) * mat3(1.0, 0.0, 0.0, 0.0, ct, st, 0.0, -st, ct);   // rotZ · rotX (mat.js)
  vec3 p = iPos.xyz + Rm * (lp * iTS.y), n = normalize(Rm * aNor);
#else
  vec3 p = (uModel * vec4(lp, 1.0)).xyz, n = normalize(mat3(uModel) * aNor);
#endif
  p.z -= dot(p.xy, p.xy) * uLightCol.w;
  gl_Position = uView * vec4(p, 1.0);
  float amb = uLight.w;
  vCol = aMat == 19.0 ? aCol * uTint : aCol * (amb + (1.0 - amb) * max(dot(n, uLight.xyz), 0.0)) * uLightCol.rgb * uTint;   // лава світиться сама
  vW = p;
  vFog = dot(uFR.xyz, uFR.xyz) > 0.0 ? length(vec2(dot(p, uFR.xyz), dot(p, uFU.xyz))) : length(p.xy);
}`;

const FS = `
precision highp float;
in vec3 vCol, vW;
in float vFog;
in vec2 vUV;
flat in float vMat;
${FRAME}
uniform highp sampler2DArray uTex;
uniform float uAlpha;     // прозорість (рідини, тінь; решта — 1)
uniform vec2 uRing;       // (RING) шов далечі: малюємо лише від x до y
out vec4 o;
#ifdef FADE
// Поріг упорядкованого дизерингу 4×4 (0…1)
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)), i = x + y * 4;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.0;
}
#endif
void main() {
#ifdef RING
  { float r = length(vW.xy); if (r < uRing.x || r > uRing.y) discard; }
#endif
#ifdef FADE
  if (uFog.w > 0.0) { float t = (distance(vW, uEye.xyz) - uFog.z) / (uFog.w - uFog.z); if (t < bayer(gl_FragCoord.xy)) discard; }
#endif
#if defined(CUT) || defined(CUTF)
#ifdef CUT
  vec4 cut = uCut;
#else
  vec4 cut = uCutF;
#endif
  if (cut.z > 0.0 && gl_FragCoord.z < uMisc.x && vW.z > cut.w && distance(gl_FragCoord.xy, cut.xy) < cut.z
      && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;
#endif
  float time = uFogCol.w;
  vec2 uv = vUV + (vMat == 1.0 ? time * vec2(0.05, 0.03) : vMat == 19.0 ? time * vec2(0.008, 0.005) : vec2(0.0));   // вода пливе, лава — повільно
  // Кожна клітинка текстури — зі своїм поворотом і віддзеркаленням (за хешем клітинки й матеріалу), щоб однакові
  // текстури не складалися в помітну сітку. Вода, лава (спільний плин) і край дерну — без повороту; візерунки з
  // напрямом (брижі піску, пласти скель, кора) — лише на 180°. Градієнти — до повороту (textureGrad): без швів мип-мап
  vec2 g1 = dFdx(uv), g2 = dFdy(uv), cell = floor(uv), f = uv - cell - 0.5;
  if (vMat != 1.0 && vMat != 19.0 && vMat != 16.0) {
    float h = fract(sin(dot(vec3(cell, vMat), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    bool dir = vMat == 3.0 || vMat == 6.0 || vMat == 10.0 || vMat == 11.0 || vMat == 13.0;
    int k = dir ? (h < 0.5 ? 0 : 2) : int(h * 4.0);
    mat2 R = k == 0 ? mat2(1.0, 0.0, 0.0, 1.0) : k == 1 ? mat2(0.0, 1.0, -1.0, 0.0) : k == 2 ? mat2(-1.0, 0.0, 0.0, -1.0) : mat2(0.0, -1.0, 1.0, 0.0);
    if (!dir && fract(h * 7.31) > 0.5) R = R * mat2(-1.0, 0.0, 0.0, 1.0);
    f = R * f; g1 = R * g1; g2 = R * g2;
  }
  vec3 c = vCol * textureGrad(uTex, vec3(f + 0.5, vMat), g1, g2).rgb * 2.0;   // текстура — множник кольору (0,5 = ×1)
  o = vec4(mix(c, uFogCol.rgb, smoothstep(uFog.x, uFog.y, vFog)), uAlpha);
}`;

// Небо: трикутник на весь екран; напрям погляду — з оберненої матриці камери. Градієнт зеніт — обрій, світіння
// заходу біля головного сонця, диски сонць з ореолом, місяці з фазою (освітлені головним сонцем), зорі (сітка на
// кубі небесної сфери, обертаються з небом), кільця планети (у площині екватора: перетин променя з площиною)
const SKY_VS = `#version 300 es
out vec2 vN;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vN = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
export const SKY_FS = `#version 300 es
precision highp float;
in vec2 vN;
uniform mat4 uInv;
uniform vec3 uZen, uHor, uMain;
uniform vec4 uDusk;          // rgb, сила
uniform vec4 uSun[3], uSunCol[3];   // напрям, кутовий радіус; колір, яскравість
uniform vec4 uMoon[3];       // напрям, кутовий радіус
uniform vec3 uMoonCol[3];
uniform int uNSun, uNMoon;
uniform float uDay;
uniform vec2 uStars;         // яскравість, відтінок
uniform mat3 uCel;
uniform vec4 uRing;          // r0, r1, непрозорість (0 — немає), смуг
uniform vec3 uRingCol, uPole;
uniform vec4 uCloud;         // хмарність 0…1, зсув x, y (вітер), темність
uniform vec3 uCloudCol;
uniform float uFlash;        // спалах блискавки
uniform vec4 uAur;           // сяйво: напрям на магнітний полюс (x, y), сила, час
uniform vec3 uAurCol;
out vec4 o;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1, 0), 1.0)), c = hash(vec3(i + vec2(0, 1), 1.0)), d = hash(vec3(i + vec2(1, 1), 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
void main() {
  vec4 a = uInv * vec4(vN, -1.0, 1.0), b = uInv * vec4(vN, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  float up = d.z, above = smoothstep(-0.02, 0.01, up);
  vec3 c = up < 0.0 ? uHor * (1.0 + up * 0.35) : mix(uHor, uZen, smoothstep(0.0, 0.55, up));
  float g = max(dot(d, uMain), 0.0);
  c += uDusk.rgb * uDusk.a * (pow(g, 5.0) * 0.6 + pow(g, 40.0) * 0.4) * smoothstep(-0.25, 0.05, up);
  if (uStars.x > 0.01 && up > -0.05) {
    vec3 q = d * uCel, aq = abs(q);
    vec2 uv; float f;
    if (aq.x >= aq.y && aq.x >= aq.z) { uv = q.yz / aq.x; f = sign(q.x); }
    else if (aq.y >= aq.z) { uv = q.xz / aq.y; f = 2.0 + sign(q.y); }
    else { uv = q.xy / aq.z; f = 4.0 + sign(q.z); }
    uv *= 90.0;
    vec2 cell = floor(uv);
    if (hash(vec3(cell, f)) > 1.0 - 0.07 * uStars.x) {
      vec2 ctr = cell + 0.25 + 0.5 * vec2(hash(vec3(cell, f + 7.0)), hash(vec3(cell, f + 13.0)));
      float br = smoothstep(0.34, 0.0, length(uv - ctr)) * (0.35 + 0.65 * hash(vec3(cell, f + 3.0)));
      vec3 sc = mix(vec3(1.0), 0.55 + 0.45 * cos(6.2831 * (uStars.y + hash(vec3(cell, f + 5.0)) * 0.3 + vec3(0.0, 0.33, 0.67))), 0.5);
      c += sc * br * uStars.x * smoothstep(-0.05, 0.12, up);
    }
  }
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
  for (int i = 0; i < 3; i++) {
    if (i >= uNMoon) break;
    float cs = dot(d, uMoon[i].xyz), s = uMoon[i].w;
    if (cs > cos(s)) {
      vec3 v = (d - uMoon[i].xyz * cs) / sin(s);
      float l2 = dot(v, v);
      vec3 n = normalize(v - uMoon[i].xyz * sqrt(max(0.0, 1.0 - l2)));
      float lit = smoothstep(-0.05, 0.15, dot(n, uMain));
      c = mix(c, uMoonCol[i] * (0.14 + 0.86 * lit), smoothstep(1.0, 0.9, l2) * above * (1.0 - 0.45 * uDay));
    }
  }
  if (uAur.z > 0.01 && up > 0.0) {                             // полярне сяйво: завіси над обрієм у бік полюса
    vec2 h = normalize(d.xy + 1e-5);
    float face = smoothstep(-0.2, 0.7, dot(h, uAur.xy)), ang = atan(h.y, h.x);
    float band = smoothstep(0.05, 0.2, up) * (1.0 - smoothstep(0.35, 0.75, up));
    float wave = fbm(vec2(ang * 3.0 + uAur.w * 0.02, up * 1.5 + uAur.w * 0.01));
    float rays = 0.55 + 0.45 * sin(ang * 70.0 + fbm(vec2(ang * 9.0, uAur.w * 0.05)) * 12.0);
    float a = face * band * smoothstep(0.42, 0.75, wave) * rays * uAur.z;
    c += mix(uAurCol, uAurCol.bgr, smoothstep(0.2, 0.6, up)) * a * 0.9;
  }
  float cover = 0.0;
  if (uCloud.x > 0.01 && up > 0.0) {                           // хмари: шар над головою, вітер їх зсуває
    vec2 uv = d.xy / (up + 0.08) * 0.9 + uCloud.yz;
    float f = fbm(uv);
    cover = smoothstep(1.02 - uCloud.x * 0.75, 1.25 - uCloud.x * 0.7, f + 0.25) * smoothstep(0.0, 0.12, up);
  }
  for (int i = 0; i < 3; i++) {
    if (i >= uNSun) break;
    float cs = dot(d, uSun[i].xyz), s = uSun[i].w, th2 = max(0.0, 2.0 * (1.0 - cs));
    float disk = smoothstep(s * s * 1.1, s * s * 0.85, th2);
    vec3 sc = uSunCol[i].rgb;
    float hide = 1.0 - cover * 0.85;
    c = mix(c, min(vec3(1.0), sc * 1.3 + 0.15), disk * above * hide);
    c += sc * uSunCol[i].a * (exp(-th2 / (s * s * 9.0)) * 0.45 * hide + exp(-th2 / (s * s * 90.0)) * 0.12) * above;
  }
  if (cover > 0.0) {
    float sh = 1.0 - uCloud.w * smoothstep(0.3, 1.0, cover);
    c = mix(c, uCloudCol * sh + uDusk.rgb * uDusk.a * 0.25, cover * 0.92);
  }
  c += vec3(0.85, 0.88, 1.0) * uFlash * (0.5 + 0.5 * cover);
  o = vec4(c, 1.0);
}`;

// Опади й пил: N частинок, кожна — 2 трикутники з gl_VertexID (буферів немає). Положення — з хешу номера частинки
// в коробці навколо цілі камери, прив'язане до світу (рух гравця не тягне дощ за собою); падають і зносяться вітром.
// Карта укриттів (uMap, 64×64 клітинки: висота верхнього непорожнього блоку відносно цілі) ховає частинки під
// дахом, кронами блоків, у печерах. Дощ — риска вздовж швидкості, сніг і пил — квадратики до камери
const PART_VS = `#version 300 es
uniform mat4 uView;
uniform vec3 uT;             // ціль камери за модулем коробки (x, y) і висота (z, у світі)
uniform vec4 uMove;          // вітер x, y; швидкість падіння; час
uniform vec3 uR, uU;         // осі екрана (праворуч, угору)
uniform vec4 uKind;          // тип (0 — дощ, 1 — сніг, 2 — пил), частка частинок, довжина, розмір
uniform highp sampler2D uMap;
uniform vec2 uMapO;          // кут карти укриттів відносно цілі (клітинки)
uniform vec2 uBox;           // півширина й висота коробки частинок
out float vA;
uint hh(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hf(uint x) { return float(hh(x) & 0xffffffu) / 16777216.0; }
void main() {
  float B = uBox.x, HZ = uBox.y;
  int id = gl_VertexID / 6, cn = gl_VertexID % 6;
  uint u = uint(id) * 4u;
  vA = 0.0;
  gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
  if (hf(u + 3u) > uKind.y) return;
  float t = uMove.w, fall = uMove.z * (0.75 + 0.5 * hf(u + 4u));
  vec2 drift = uMove.xy * t * (uKind.x == 2.0 ? 1.0 : 0.6);
  vec3 p = vec3(mod(hf(u) * 2.0 * B - uT.x + drift.x, 2.0 * B) - B, mod(hf(u + 1u) * 2.0 * B - uT.y + drift.y, 2.0 * B) - B, 0.0);   // летять за вітром
  p.z = mod(hf(u + 2u) * HZ - t * fall - uT.z, HZ) - HZ * (uKind.x == 2.0 ? 0.15 : 0.35);
  if (uKind.x == 1.0) p.xy += 0.3 * vec2(sin(t * 1.3 + hf(u) * 30.0), cos(t * 1.1 + hf(u + 1u) * 30.0));
  if (uKind.x == 2.0) p.z += 0.4 * sin(t * 2.0 + hf(u) * 20.0);
  ivec2 mc = ivec2(floor(p.xy - uMapO));
  if (mc.x >= 0 && mc.y >= 0 && mc.x < 64 && mc.y < 64 && p.z + uT.z < texelFetch(uMap, mc, 0).r) return;
  vec3 a = p, b = p, side;
  if (uKind.x == 0.0) {
    vec3 v = normalize(vec3(uMove.xy, -fall));
    b = p - v * uKind.z; side = uR * uKind.w;
  } else { a = p - uU * uKind.w; b = p + uU * uKind.w; side = uR * uKind.w; }
  vec3 q = (cn == 0 || cn == 3) ? a - side : (cn == 1) ? a + side : (cn == 2 || cn == 4) ? b + side : b - side;
  vA = 1.0;
  gl_Position = uView * vec4(q, 1.0);
}`;
const PART_FS = `#version 300 es
precision mediump float;
in float vA;
uniform vec4 uCol;
out vec4 o;
void main() { if (vA < 0.5) discard; o = uCol; }`;
export const PARTICLES = 6000;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 недоступний');
  // UBO кадру (std140): uView [0–15], далі по vec4 — uLight, uLightCol, uFogCol, uFog, uFR, uFU, uWind, uEye, uCut, uCutF, uMisc
  const ubo = gl.createBuffer(), F = new Float32Array(60);
  gl.bindBuffer(gl.UNIFORM_BUFFER, ubo); gl.bufferData(gl.UNIFORM_BUFFER, F.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
  // Програми граней за набором визначень (див. VS / FS): {p, U — розташування уніформ}
  const progs = new Map();
  const program = (defs) => {
    let P = progs.get(defs);
    if (P) return P;
    const head = '#version 300 es\n' + defs.split(' ').filter(Boolean).map((d) => `#define ${d}\n`).join('');
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, head + VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, head + FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.uniformBlockBinding(p, gl.getUniformBlockIndex(p, 'Frame'), 0);
    const U = {};
    for (const k of ['uModel', 'uOrigin', 'uCell', 'uTint', 'uTex', 'uAlpha', 'uRing']) U[k] = gl.getUniformLocation(p, k);
    gl.useProgram(p);
    gl.uniform3f(U.uTint, 1, 1, 1); gl.uniform1f(U.uAlpha, 1); gl.uniform1i(U.uTex, 0);
    P = { p, U, defs };
    progs.set(defs, P);
    if (cur) gl.useProgram(cur.p);
    return P;
  };
  let cur = null;
  const sky = gl.createProgram();
  gl.attachShader(sky, compile(gl, gl.VERTEX_SHADER, SKY_VS));
  gl.attachShader(sky, compile(gl, gl.FRAGMENT_SHADER, SKY_FS));
  gl.linkProgram(sky);
  if (!gl.getProgramParameter(sky, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(sky));
  const SU = {};
  for (const k of ['uInv', 'uZen', 'uHor', 'uMain', 'uDusk', 'uSun', 'uSunCol', 'uMoon', 'uMoonCol', 'uNSun', 'uNMoon', 'uDay', 'uStars', 'uCel', 'uRing', 'uRingCol', 'uPole', 'uCloud', 'uCloudCol', 'uFlash', 'uAur', 'uAurCol']) SU[k] = gl.getUniformLocation(sky, k);
  const skyVao = gl.createVertexArray();
  const part = gl.createProgram();
  gl.attachShader(part, compile(gl, gl.VERTEX_SHADER, PART_VS));
  gl.attachShader(part, compile(gl, gl.FRAGMENT_SHADER, PART_FS));
  gl.linkProgram(part);
  if (!gl.getProgramParameter(part, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(part));
  const PU = {};
  for (const k of ['uView', 'uT', 'uMove', 'uR', 'uU', 'uKind', 'uMap', 'uMapO', 'uCol', 'uBox']) PU[k] = gl.getUniformLocation(part, k);
  const mapTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, mapTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 64, 64, 0, gl.RED, gl.FLOAT, new Float32Array(64 * 64).fill(-1e4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.activeTexture(gl.TEXTURE0);
  gl.enable(gl.DEPTH_TEST);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const shift = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // Текстури: масив шарів (по шару на матеріал); поки немає — один нейтральний шар
  const tex = gl.createTexture(), aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  let W = 1, H = 1, dpr = 1;
  // Час GPU (EXT_disjoint_timer_query_webgl2): кільце запитів, результат — згладжено; немає розширення — null
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2'), queries = [];
  let qOn = null;
  const multi = gl.getExtension('WEBGL_multi_draw');
  const inst = gl.createBuffer();
  let instCap = 0;
  // Щільна вершина (pack.js, 16 Б, елементи по 4 Б): позиція u16 ×4 (0; четвертий — матеріал, 6), нормаль i8 ×4 (8,
  // нормовано), колір u8 ×3 (12, нормовано); AO (15) старий рендер не читає
  const packedAttrs = (buf) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 16, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 16, 12);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.UNSIGNED_SHORT, false, 16, 6);   // матеріал — pos.w (AO в color.a старий рендер не читає)
  };

  // Відсікання задніх граней (лише тверде землі й плитки далечі — R.cull): лицьові — за годинниковою на екрані, бо базис
  // камери дзеркальний (camera.js: r × up = −u), а грані землі — проти годинникової ззовні (gen/mesh.js)
  gl.frontFace(gl.CW);
  let cullOn = true;                               // ?dev eco.setCull(false) — усе з обох боків (порівняння)

  const R = {
    gl, multi: !!multi,
    stats: { draws: 0, tris: 0, upBytes: 0, up: 0, gpuBytes: 0, arenaBytes: 0, arenaUsed: 0 },
    program,
    // Зробити програму поточною (кеш: без зайвих useProgram)
    use(P) { if (cur !== P) { gl.useProgram(P.p); cur = P; } return P; },
    get cur() { return cur; },
    // Відсікання задніх граней для наступних викликів (on), якщо його не вимкнено для перевірок (setCull)
    cull(on) { if (on && cullOn) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE); },
    setCull(on) { cullOn = !!on; },
    get cullOn() { return cullOn; },
    gpuMs: tq ? 0 : null,
    get width() { return W; }, get height() { return H; }, get dpr() { return dpr; },
    resize() {
      dpr = Math.min(2, devicePixelRatio || 1);
      W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    // Шари текстур size×size, RGBA, підряд (textures.js)
    setTextures(data, size, layers) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    },
    upload(m) {
      const vao = gl.createVertexArray(), bufs = [];
      gl.bindVertexArray(vao);
      const attr = (loc, data, size, type, norm) => {
        const b = gl.createBuffer(); bufs.push(b);
        gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, norm, 0, 0);
      };
      attr(0, m.pos, 3, gl.FLOAT, false);
      attr(1, m.nor, 3, gl.BYTE, true);
      attr(2, m.col, 3, gl.UNSIGNED_BYTE, true);
      attr(3, m.mat, 1, gl.UNSIGNED_BYTE, false);
      const ib = gl.createBuffer(); bufs.push(ib);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      const bytes = m.pos.byteLength + m.nor.byteLength + m.col.byteLength + m.mat.byteLength + m.idx.byteLength;
      R.stats.gpuBytes += bytes; R.stats.upBytes += bytes;
      return { vao, bufs, bytes, count: m.count, type: m.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    },
    free(mesh) {
      gl.deleteVertexArray(mesh.vao);
      for (const b of mesh.bufs) gl.deleteBuffer(b);
      R.stats.gpuBytes -= mesh.bytes || 0;
    },
    // Час GPU: опитати готові запити, почати новий (кінець — R.end())
    timeBegin() {
      if (!tq) return;
      for (let i = queries.length - 1; i >= 0; i--) {
        const q = queries[i];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
        if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) R.gpuMs = R.gpuMs * 0.9 + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 * 0.1;
        gl.deleteQuery(q); queries.splice(i, 1);
      }
      if (queries.length < 4) { qOn = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, qOn); }
    },
    end() { if (qOn) { gl.endQuery(tq.TIME_ELAPSED_EXT); queries.push(qOn); qOn = null; } },
    // Кадр: небо, світло, туман, камера (view — матриця з camera.viewProj); cut / cutF — «вікно» до гравця (рослини —
    // ширше) або null; fade — розчинення рослин біля ока [зникли, видно] або null, eye — око відносно цілі
    begin({ fogCol, light, amb, lightCol, fog, fogAxes = null, view, cut, cutF = null, fade = null, eye = [0, 0, 0], time = 0, sky = null, wind = [0, 0], curve = 0 }) {
      gl.disable(gl.CULL_FACE);                     // кадр починається без відсікання (небо й решта)
      R.stats.up = R.stats.upBytes; R.stats.draws = 0; R.stats.tris = 0; R.stats.upBytes = 0;
      R.timeBegin();
      gl.clearColor(fogCol[0] / 255, fogCol[1] / 255, fogCol[2] / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (sky) R.drawSky(sky);
      const [fr, fu] = fogAxes || [[0, 0, 0], [0, 0, 0]];
      F.set(view, 0);
      F.set([light[0], light[1], light[2], amb, lightCol[0], lightCol[1], lightCol[2], curve, fogCol[0] / 255, fogCol[1] / 255, fogCol[2] / 255, time,
        fog[0], fog[1], fade ? fade[0] : 0, fade ? fade[1] : 0, fr[0], fr[1], fr[2], 0, fu[0], fu[1], fu[2], 0, wind[0], wind[1], time, 0, eye[0], eye[1], eye[2], 0], 16);
      const c4 = (c, o) => { if (c) F.set([c.x * dpr, (H - c.y) * dpr, c.r * dpr, c.z], o); else F.fill(0, o, o + 4); };
      c4(cut, 48); c4(cutF, 52);
      F[56] = cut ? cut.depth : cutF ? cutF.depth : 0;
      gl.bindBuffer(gl.UNIFORM_BUFFER, ubo); gl.bufferSubData(gl.UNIFORM_BUFFER, 0, F);
    },
    // Арена щільних вершин (спільний буфер регіону): {buf, vao, a — алокатор (arena.js), put(off, u8), grow(cap2), drop()}
    arena(cap) {
      const A = { buf: gl.createBuffer(), vao: gl.createVertexArray(), a: createAlloc(cap) };
      const make = (n) => { gl.bindBuffer(gl.ARRAY_BUFFER, A.buf); gl.bufferData(gl.ARRAY_BUFFER, n * 16, gl.STATIC_DRAW); R.stats.arenaBytes += n * 16; };
      gl.bindVertexArray(A.vao); make(cap); packedAttrs(A.buf); gl.bindVertexArray(null);
      A.put = (off, u8) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, A.buf); gl.bufferSubData(gl.ARRAY_BUFFER, off * 16, u8);
        R.stats.upBytes += u8.byteLength;
      };
      // Більша ємність: новий буфер, старий вміст — копією на GPU
      A.grow = (cap2) => {
        const old = A.buf, oc = A.a.cap;
        A.buf = gl.createBuffer(); make(cap2);
        gl.bindBuffer(gl.COPY_READ_BUFFER, old); gl.bindBuffer(gl.COPY_WRITE_BUFFER, A.buf);
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, oc * 16);
        gl.deleteBuffer(old); R.stats.arenaBytes -= oc * 16;
        gl.bindVertexArray(A.vao); packedAttrs(A.buf); gl.bindVertexArray(null);
        A.a.grow(cap2);
      };
      A.drop = () => { gl.deleteBuffer(A.buf); gl.deleteVertexArray(A.vao); R.stats.arenaBytes -= A.a.cap * 16; };
      return A;
    },
    // Стиснення: нова арена на cap2 вершин, живі діапазони (live — [власник, поле зсуву, вершин]) підряд копією на GPU;
    // власникам — нові зсуви. Стара — геть
    repack(A, cap2, live) {
      const B = R.arena(cap2);
      gl.bindBuffer(gl.COPY_READ_BUFFER, A.buf); gl.bindBuffer(gl.COPY_WRITE_BUFFER, B.buf);
      for (const [o, f, n] of live) {
        const off = B.a.alloc(n);
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, o[f] * 16, off * 16, n * 16);
        o[f] = off;
      }
      A.drop();
      return B;
    },
    // Діапазони арени (first[i], count[i] вершин, i — від off, n штук) одним викликом (WEBGL_multi_draw) чи циклом
    drawRanges(A, first, count, off, n) {
      if (!n) return;
      gl.bindVertexArray(A.vao);
      if (multi) { multi.multiDrawArraysWEBGL(gl.TRIANGLES, first, off, count, off, n); R.stats.draws++; }
      else { for (let i = off; i < off + n; i++) gl.drawArrays(gl.TRIANGLES, first[i], count[i]); R.stats.draws += n; }
      for (let i = off; i < off + n; i++) R.stats.tris += count[i] / 3;
    },
    // Екземпляри: дані (Float32Array по 6 на екземпляр: x, y, z відносно цілі, поворот, нахил, масштаб) — один запис на кадр
    instances(data, n) {
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      if (n * 24 > instCap) { instCap = Math.max(n * 24, instCap * 2); gl.bufferData(gl.ARRAY_BUFFER, instCap, gl.DYNAMIC_DRAW); }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 6);
      R.stats.upBytes += n * 24;
    },
    // Меш (з upload) k разів — екземпляри з first (номер у буфері instances)
    drawInstanced(mesh, first, k) {
      gl.bindVertexArray(mesh.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 24, first * 24); gl.vertexAttribDivisor(4, 1);
      gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 24, first * 24 + 16); gl.vertexAttribDivisor(5, 1);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.type, 0, k);
      R.stats.draws++; R.stats.tris += mesh.count / 3 * k;
    },
    // Уніформи поточної програми
    origin(x, y, z, cx, cy, cz) { gl.uniform3f(cur.U.uOrigin, x, y, z); gl.uniform3f(cur.U.uCell, cx, cy, cz); },
    alpha(a) { gl.uniform1f(cur.U.uAlpha, a); },
    ring(r0, r1) { gl.uniform2f(cur.U.uRing, r0, r1); },
    // Небо на весь екран (до всього іншого, без глибини): sky — {inv (обернена матриця камери), st (sky.js skyState)}
    drawSky({ inv, st }) {
      const c = (v) => [v[0] / 255, v[1] / 255, v[2] / 255];
      gl.useProgram(sky);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      gl.uniformMatrix4fv(SU.uInv, false, inv);
      gl.uniform3fv(SU.uZen, c(st.zenith)); gl.uniform3fv(SU.uHor, c(st.horizon)); gl.uniform3fv(SU.uMain, st.suns[0].dir);
      gl.uniform4f(SU.uDusk, ...c(st.duskCol), st.dusk);
      const sun = new Float32Array(12), sunC = new Float32Array(12), moon = new Float32Array(12), moonC = new Float32Array(9);
      st.suns.forEach((s, i) => { sun.set([...s.dir, s.size], i * 4); sunC.set([...c(s.col), s.bright], i * 4); });
      st.moons.forEach((m, i) => { moon.set([...m.dir, m.size], i * 4); moonC.set(c(m.col), i * 3); });
      gl.uniform4fv(SU.uSun, sun); gl.uniform4fv(SU.uSunCol, sunC); gl.uniform4fv(SU.uMoon, moon); gl.uniform3fv(SU.uMoonCol, moonC);
      gl.uniform1i(SU.uNSun, st.suns.length); gl.uniform1i(SU.uNMoon, st.moons.length);
      gl.uniform1f(SU.uDay, st.day); gl.uniform2f(SU.uStars, st.stars, st.starHue);
      gl.uniformMatrix3fv(SU.uCel, false, st.cel);              // рядки → у шейдері d * uCel
      const rg = st.rings;
      gl.uniform4f(SU.uRing, rg ? rg.r0 : 0, rg ? rg.r0 + rg.w : 0, rg ? rg.alpha : 0, rg ? rg.bands : 0);
      gl.uniform3fv(SU.uRingCol, rg ? c(rg.col) : [0, 0, 0]); gl.uniform3fv(SU.uPole, st.pole);
      const cl = st.cloud || { k: 0, off: [0, 0], dark: 0, col: [255, 255, 255] };
      gl.uniform4f(SU.uCloud, cl.k, cl.off[0], cl.off[1], cl.dark); gl.uniform3fv(SU.uCloudCol, c(cl.col)); gl.uniform1f(SU.uFlash, st.flash || 0);
      const au = st.aurora || { dir: [0, 1], k: 0, t: 0, col: [0, 0, 0] };
      gl.uniform4f(SU.uAur, au.dir[0], au.dir[1], au.k, au.t % 10000); gl.uniform3fv(SU.uAurCol, c(au.col));
      gl.bindVertexArray(skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    },
    // Карта укриттів 64×64: висота верхнього непорожнього блоку кожної клітинки (у світі)
    setRainMap(data) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mapTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RED, gl.FLOAT, data);
      gl.activeTexture(gl.TEXTURE0);
    },
    // Частинки: p — {view, box [півширина, висота], t (ціль за модулем 2 × півширина), z, move [wx, wy, fall, time], r, u, kind [тип, частка, довжина, розмір], mapO, col [r, g, b, a]}
    drawParticles(p) {
      gl.useProgram(part);
      gl.uniformMatrix4fv(PU.uView, false, p.view);
      gl.uniform3f(PU.uT, p.t[0], p.t[1], p.z);
      gl.uniform4f(PU.uMove, ...p.move); gl.uniform3fv(PU.uR, p.r); gl.uniform3fv(PU.uU, p.u);
      gl.uniform4f(PU.uKind, ...p.kind); gl.uniform1i(PU.uMap, 1); gl.uniform2f(PU.uMapO, p.mapO[0], p.mapO[1]);
      gl.uniform4f(PU.uCol, ...p.col); gl.uniform2f(PU.uBox, p.box[0], p.box[1]);
      gl.enable(gl.BLEND); gl.depthMask(false);
      gl.bindVertexArray(skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, PARTICLES * 6);
      R.stats.draws++; R.stats.tris += PARTICLES * 2;
      gl.disable(gl.BLEND); gl.depthMask(true);
      if (cur) gl.useProgram(cur.p);
    },
    // Напівпрозоре між beginAlpha / endAlpha (без запису глибини): поверхні рідин
    beginAlpha() { gl.enable(gl.BLEND); gl.depthMask(false); },
    endAlpha() { gl.disable(gl.BLEND); gl.depthMask(true); },
    // Напівпрозорий меш поверх (без запису глибини): тінь
    drawAlpha(mesh, model, alpha) {
      gl.enable(gl.BLEND); gl.depthMask(false);
      gl.uniform1f(cur.U.uAlpha, alpha);
      R.draw(mesh, model);
      gl.uniform1f(cur.U.uAlpha, 1);
      gl.disable(gl.BLEND); gl.depthMask(true);
    },
    // Меш з матрицею моделі (поточна програма — без PACKED); model — матриця 4×4 (mat.js)
    draw(mesh, model, tint = null) {
      gl.uniformMatrix4fv(cur.U.uModel, false, model);
      if (tint) gl.uniform3f(cur.U.uTint, tint[0], tint[1], tint[2]); else gl.uniform3f(cur.U.uTint, 1, 1, 1);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
      R.stats.draws++; R.stats.tris += mesh.count / 3;
    },
    // Лише зсув (чанки): без виділення пам'яті щокадру
    drawAt(mesh, ox, oy, oz) { shift[12] = ox; shift[13] = oy; shift[14] = oz; R.draw(mesh, shift); },
  };
  R.resize();
  return R;
}
