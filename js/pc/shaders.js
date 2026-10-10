// js/pc/shaders.js — шматки шейдерів PlayCanvas для прототипу ?pc. Свої — лише де PlayCanvas не має свого: альбедо з
// масиву текстур (шар — матеріал у четвертому байті кольору вершини), шов із плитками далечі, наше небо.
// Уніформи — по одній на рядок (WebglShaderProcessorGLSL збирає рядки VS і FS; однакові зливаються)
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
