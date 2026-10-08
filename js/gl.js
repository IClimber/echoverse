// gl.js — WebGL2 без бібліотек: один шейдер для пласких граней (колір вершини, напрямлене світло, туман),
// меші (VAO), матриця камери (camera.js: ізометрія чи третя особа). Буфер глибини сам вирішує, що попереду.
// Позиції в меші — локальні; матриця моделі несе зсув від камери, порахований у float64 на CPU
// (далеко від початку float32 тремтів би), і повороти частин фігури.

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNor;
layout(location = 2) in vec3 aCol;
layout(location = 3) in float aMat;  // матеріал — шар текстури
uniform mat4 uModel;      // локальні координати меша → світ відносно камери (зсув, повороти, рівномірний масштаб)
uniform mat4 uView;       // камера: відносно цілі → clip
uniform vec3 uLight, uLightCol, uTint;
uniform float uAmb;
uniform vec3 uFR, uFU;       // туман згори: осі екрана (відстань — на екрані); у третій особі — нулі (відстань по горизонталі)
out vec3 vCol, vW;
out float vFog;
out vec2 vUV;
flat out float vMat;
void main() {
  // Текстурні координати — проєкція локальної позиції на площину грані (1 одиниця = одна текстура; угору — угору)
  vec3 an = abs(aNor);
  vUV = an.z >= max(an.x, an.y) ? aPos.xy : (an.x >= an.y ? vec2(aPos.y, -aPos.z) : vec2(aPos.x, -aPos.z));
  vMat = aMat;
  vec3 p = (uModel * vec4(aPos, 1.0)).xyz;
  vec3 n = normalize(mat3(uModel) * aNor);
  gl_Position = uView * vec4(p, 1.0);
  vCol = aCol * (uAmb + (1.0 - uAmb) * max(dot(n, uLight), 0.0)) * uLightCol * uTint;
  vW = p;
  vFog = dot(uFR, uFR) > 0.0 ? length(vec2(dot(p, uFR), dot(p, uFU))) : length(p.xy);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vCol, vW;
in float vFog;
in vec2 vUV;
flat in float vMat;
uniform highp sampler2DArray uTex;
uniform float uTime;
uniform vec3 uFogCol;
uniform vec2 uFog;        // туман: від r0 до r1 (світові одиниці від камери по горизонталі)
uniform vec4 uCut;        // «вікно» до гравця: x, y — px екрана, z — радіус px (0 — вимкнено), w — висота відсікання
uniform float uCutD;      // глибина гравця (як gl_FragCoord.z): ближче за неї й вище за коліна — вирізаємо
uniform float uAlpha;     // прозорість (лише тінь; решта — 1)
uniform vec3 uEye;        // око (відносно цілі) — для розчинення рослин біля камери
uniform vec2 uFade;       // рослини: ближче за x до ока — зникли, від x до y — розчиняються (дизеринг); y = 0 — вимкнено
out vec4 o;
// Поріг упорядкованого дизерингу 4×4 (0…1)
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)), i = x + y * 4;
  int b[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(b[i]) + 0.5) / 16.0;
}
void main() {
  if (uFade.y > 0.0) { float t = (distance(vW, uEye) - uFade.x) / (uFade.y - uFade.x); if (t < bayer(gl_FragCoord.xy)) discard; }
  if (uCut.z > 0.0 && gl_FragCoord.z < uCutD && vW.z > uCut.w && distance(gl_FragCoord.xy, uCut.xy) < uCut.z
      && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;
  vec2 uv = vUV + (vMat == 1.0 ? uTime * vec2(0.05, 0.03) : vMat == 19.0 ? uTime * vec2(0.008, 0.005) : vec2(0.0));   // вода пливе, лава — повільно
  vec3 c = vCol * texture(uTex, vec3(uv, vMat)).rgb * 2.0;               // текстура — множник кольору (0,5 = ×1)
  o = vec4(mix(c, uFogCol, smoothstep(uFog.x, uFog.y, vFog)), uAlpha);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 недоступний');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const U = {};
  for (const k of ['uModel', 'uView', 'uLight', 'uLightCol', 'uTint', 'uAmb', 'uFogCol', 'uFog', 'uCut', 'uCutD', 'uAlpha', 'uTex', 'uTime', 'uFR', 'uFU', 'uEye', 'uFade']) U[k] = gl.getUniformLocation(prog, k);
  gl.useProgram(prog);
  gl.enable(gl.DEPTH_TEST);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1f(U.uAlpha, 1);
  const shift = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // Текстури: масив шарів (по шару на матеріал); поки немає — один нейтральний шар
  const tex = gl.createTexture(), aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  gl.uniform1i(U.uTex, 0);
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

  const R = {
    gl,
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
      return { vao, bufs, count: m.count, type: m.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    },
    free(mesh) {
      gl.deleteVertexArray(mesh.vao);
      for (const b of mesh.bufs) gl.deleteBuffer(b);
    },
    // Кадр: небо, світло, туман, камера (view — матриця з camera.viewProj); cut — «вікно» до гравця або null
    begin({ sky, light, amb, lightCol, fog, fogAxes = null, view, cut, time = 0 }) {
      gl.uniform1f(U.uTime, time);
      const [fr, fu] = fogAxes || [[0, 0, 0], [0, 0, 0]];
      gl.uniform3f(U.uFR, fr[0], fr[1], fr[2]); gl.uniform3f(U.uFU, fu[0], fu[1], fu[2]);
      gl.clearColor(sky[0] / 255, sky[1] / 255, sky[2] / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(U.uView, false, view);
      gl.uniform3f(U.uLight, light[0], light[1], light[2]);
      gl.uniform3f(U.uLightCol, lightCol[0], lightCol[1], lightCol[2]);
      gl.uniform1f(U.uAmb, amb);
      gl.uniform3f(U.uFogCol, sky[0] / 255, sky[1] / 255, sky[2] / 255);
      gl.uniform2f(U.uFog, fog[0], fog[1]);
      R.setCut(cut);
    },
    // Розчинення біля ока (рослини в третій особі): fade — [зникли, видно] у світових одиницях або null
    setFade(fade, eye) {
      if (fade) { gl.uniform2f(U.uFade, fade[0], fade[1]); gl.uniform3f(U.uEye, eye[0], eye[1], eye[2]); }
      else gl.uniform2f(U.uFade, 0, 0);
    },
    setCut(cut) {
      if (cut) { gl.uniform4f(U.uCut, cut.x * dpr, (H - cut.y) * dpr, cut.r * dpr, cut.z); gl.uniform1f(U.uCutD, cut.depth); }
      else gl.uniform4f(U.uCut, 0, 0, 0, 0);
    },
    // Напівпрозоре між beginAlpha / endAlpha (без запису глибини): поверхні рідин
    beginAlpha(alpha) { gl.enable(gl.BLEND); gl.depthMask(false); gl.uniform1f(U.uAlpha, alpha); },
    endAlpha() { gl.uniform1f(U.uAlpha, 1); gl.disable(gl.BLEND); gl.depthMask(true); },
    // Напівпрозорий меш поверх (без запису глибини): тінь
    drawAlpha(mesh, model, alpha) {
      gl.enable(gl.BLEND); gl.depthMask(false);
      gl.uniform1f(U.uAlpha, alpha);
      R.draw(mesh, model);
      gl.uniform1f(U.uAlpha, 1);
      gl.disable(gl.BLEND); gl.depthMask(true);
    },
    // model — матриця 4×4 (mat.js)
    draw(mesh, model, tint = null) {
      gl.uniformMatrix4fv(U.uModel, false, model);
      if (tint) gl.uniform3f(U.uTint, tint[0], tint[1], tint[2]); else gl.uniform3f(U.uTint, 1, 1, 1);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
    },
    // Лише зсув (чанки): без виділення пам'яті щокадру
    drawAt(mesh, ox, oy, oz) { shift[12] = ox; shift[13] = oy; shift[14] = oz; R.draw(mesh, shift); },
  };
  R.resize();
  return R;
}
