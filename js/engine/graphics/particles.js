// js/engine/graphics/particles.js — об'єм частинок навколо точки (опади, пил): компонент particlesystem PlayCanvas
// (graphics/particles.md, приклад graphics/particles-snow) з wrap — частинки прив'язані до світу й загортаються в коробку
// навколо цілі. Укриття: частинки під дахом (карта 64×64 — висота верху стовпця, світ PlayCanvas y) не малюються.
// Шейдер частинок бере лише глобальні шматки (getShaderVariant емітера матеріальних не передає), тож particle_initVS
// (глобальна область) і particle_wrapVS (тіло main, лише з wrap) — типові + наше, для обох мов; particle_stretchVS — обхід помилки
const SH = 64;
const ADD_INIT_GLSL = `
uniform sampler2D eco_shelter;
uniform vec2 eco_shelterO;
`;
const ADD_WRAP_GLSL = `
	{
		ivec2 eco_c = ivec2(floor(particlePos.xz - eco_shelterO));
		if (eco_c.x >= 0 && eco_c.y >= 0 && eco_c.x < ${SH} && eco_c.y < ${SH} && particlePos.y < texelFetch(eco_shelter, eco_c, 0).r) particlePos.y -= 1.0e5;   // під дахом — за дальню площину
	}
`;
const ADD_INIT_WGSL = `
var eco_shelter: texture_2d<uff>;
uniform eco_shelterO: vec2f;
`;
const ADD_WRAP_WGSL = `
	{
		let eco_c: vec2i = vec2i(floor(particlePos.xz - uniform.eco_shelterO));
		if (eco_c.x >= 0 && eco_c.y >= 0 && eco_c.x < ${SH} && eco_c.y < ${SH}) {
			if (particlePos.y < textureLoad(eco_shelter, eco_c, 0).r) { particlePos.y = particlePos.y - 1.0e5; }
		}
	}
`;
let patched = null;
function patch(G) {
  if (patched === G.dev) return;
  const { pc, dev } = G;
  for (const [lang, init, wrap] of [[pc.SHADERLANGUAGE_GLSL, ADD_INIT_GLSL, ADD_WRAP_GLSL], [pc.SHADERLANGUAGE_WGSL, ADD_INIT_WGSL, ADD_WRAP_WGSL]]) {
    const C = pc.ShaderChunks.get(dev, lang);
    C.set('particle_initVS', C.get('particle_initVS') + init);
    C.set('particle_wrapVS', C.get('particle_wrapVS') + wrap);
    // Обхід помилки 2.23.2: з wrap розтяг (stretch) ще раз додає зсув загортання до попередньої позиції
    // (posPrev = загорнута − швидкість·stretch + (загорнута − справжня)) — риска тяглась до справжньої позиції частинки,
    // за десятки одиниць (дощ — кілька довгих ліній через увесь екран замість тисяч коротких рисок). particlePos тут уже
    // загорнута, тож попередня — просто particlePos − moveDir
    C.set('particle_stretchVS', C.get('particle_stretchVS').replace(/\n\s*posPrev (\+= particlePosMoved|= posPrev \+ particlePosMoved);/, ''));
  }
  patched = dev;
}

// Текстура частинки з коду: 'dot' — м'яка крапка, 'streak' — риска (дощ, з stretch)
function spriteTex(G, kind) {
  const { pc, dev } = G, N = 32, d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
    const a = kind === 'streak' ? Math.max(0, 1 - Math.abs(u) * 3) * Math.max(0, 1 - Math.abs(v)) : Math.max(0, 1 - Math.hypot(u, v));
    d.set([255, 255, 255, Math.round(255 * Math.min(1, a * 1.6))], (y * N + x) * 4);
  }
  return new pc.Texture(dev, { width: N, height: N, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, levels: [d] });
}

let shelterTex = null, shelterDev = null;
// G — застосунок; numParticles, lifetime, size (півширина частинки), stretch (дощ), color [r, g, b, a] (у гамі),
// texture 'dot' | 'streak', boxXZ (півширина коробки), boxY (піввисота)
export function createParticleVolume(G, { numParticles = 4000, lifetime = 4, size = 0.05, stretch = 0, color = [1, 1, 1, 1], texture = 'dot', boxXZ = 24, boxY = 14 } = {}) {
  const { pc, dev } = G;
  patch(G);
  if (shelterDev !== dev) {
    shelterTex = new pc.Texture(dev, { width: SH, height: SH, format: pc.PIXELFORMAT_R32F, mipmaps: false, minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST });
    const a = shelterTex.lock(); a.fill(-1e9); shelterTex.unlock();
    dev.scope.resolve('eco_shelter').setValue(shelterTex);
    dev.scope.resolve('eco_shelterO').setValue([0, 0]);
    shelterDev = dev;
  }
  const e = new pc.Entity('частинки');
  let vel = [0, -1, 0], col = color.slice(), inten = 1;
  const velGraph = (v, s) => new pc.CurveSet([[0, v[0] * s], [0, v[1] * s], [0, v[2] * s]]);
  e.addComponent('particlesystem', {
    numParticles, lifetime, rate: lifetime / numParticles, rate2: lifetime / numParticles, loop: true, autoPlay: true, preWarm: true,
    emitterShape: pc.EMITTERSHAPE_BOX, emitterExtents: new pc.Vec3(boxXZ * 2, boxY * 2, boxXZ * 2),
    wrap: true, wrapBounds: new pc.Vec3(boxXZ * 2, boxY * 2, boxXZ * 2),
    velocityGraph: velGraph(vel, 0.75), velocityGraph2: velGraph(vel, 1.25),
    scaleGraph: new pc.Curve([0, size * 2]), colorGraph: new pc.CurveSet([[0, col[0]], [0, col[1]], [0, col[2]]]), alphaGraph: new pc.Curve([0, col[3]]),
    colorMap: spriteTex(G, texture), lighting: false, blendType: pc.BLEND_NORMAL, depthWrite: false,
    stretch, alignToMotion: stretch > 0, layers: [G.layers.world.id],
  });
  G.app.root.addChild(e);
  const ps = e.particlesystem, P = new pc.Vec3();
  const far = (a, b) => Math.abs(a - b) > 0.1 * Math.max(Math.abs(a), Math.abs(b), 1e-3);
  return {
    entity: e,
    set enabled(v) { e.enabled = !!v; }, get enabled() { return e.enabled; },
    // центр коробки — ціль (наші координати)
    setPosition(t) { e.setPosition(G.toPC(t[0], t[1], t[2], P)); },
    // швидкість (наші координати, од/с); графік перебудовується лише при зміні понад 10 %
    setVelocity(vx, vy, vz) {
      const v = [vx, vz, vy];
      if (!v.some((x, i) => far(x, vel[i]))) return;
      vel = v; ps.velocityGraph = velGraph(v, 0.75); ps.velocityGraph2 = velGraph(v, 1.25);
    },
    // сила (множник прозорості); понад 10 %
    setIntensity(k) {
      if (!far(k, inten)) return;
      inten = k; ps.alphaGraph = new pc.Curve([0, col[3] * k]);
    },
    // колір [r, g, b, a] (у гамі); понад 10 % за будь-якою складовою
    setColor(c) {
      if (!c.some((x, i) => far(x, col[i]))) return;
      col = c.slice(); ps.colorGraph = new pc.CurveSet([[0, c[0]], [0, c[1]], [0, c[2]]]); ps.alphaGraph = new pc.Curve([0, c[3] * inten]);
    },
  };
}

// Карта укриттів (спільна для всіх об'ємів): buf — Float32Array(64·64), висота верху стовпця (наші z) клітинки
// (x0 + i, y0 + j); x0, y0 — наші координати кута
export function setShelter(G, buf, x0, y0) {
  if (!shelterTex) return;
  const a = shelterTex.lock();
  // наш (i — x, j — y) → текстура (u — PlayCanvas x, v — PlayCanvas z = наш y); значення — y PlayCanvas = наш z
  a.set(buf.subarray(0, SH * SH));
  shelterTex.unlock();
  G.dev.scope.resolve('eco_shelterO').setValue([x0 - G.O[0], y0 - G.O[1]]);
}
