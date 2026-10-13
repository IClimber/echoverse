// js/engine/graphics/app.js — застосунок PlayCanvas (як в офіційних прикладах: createGraphicsDevice + AppOptions + AppBase,
// напр. engine/examples/camera/multi.example.mjs): графічний пристрій (WebGL2 / WebGPU), шари, камера, світ із віссю z
// угору й плаваючим початком, кадр, заміри. Модулів гри не імпортує
import * as pc from 'playcanvas';            // import map у index.html (версія — там і в docs/playcanvas/fetch.sh)
export { pc };

const HIST = 600;                            // кільце GPU кожного кадру

// device: 'webgpu' — WebGPU, а без нього — WebGL2 (createGraphicsDevice сам відкочується); інакше WebGL2
export async function createApp(canvas, { device = 'webgl2', maxPixelRatio = 2, far = 2000 } = {}) {
  const deviceTypes = device === 'webgpu' ? [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2] : [pc.DEVICETYPE_WEBGL2];
  const dev = await pc.createGraphicsDevice(canvas, { deviceTypes, antialias: true, alpha: false, powerPreference: 'high-performance' });
  dev.maxPixelRatio = Math.min(maxPixelRatio, devicePixelRatio || 1);
  const ao = new pc.AppOptions();
  ao.graphicsDevice = dev;
  ao.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem, pc.ParticleSystemComponentSystem, pc.ScriptComponentSystem];
  ao.resourceHandlers = [pc.TextureHandler, pc.ScriptHandler];
  const app = new pc.AppBase(canvas);
  app.init(ao);
  app.setCanvasFillMode(pc.FILLMODE_NONE); app.setCanvasResolution(pc.RESOLUTION_AUTO);
  if (dev.gpuProfiler) dev.gpuProfiler.enabled = true;
  const setProfiler = (on) => { if (dev.gpuProfiler) dev.gpuProfiler.enabled = !!on; return !!(dev.gpuProfiler && dev.gpuProfiler.enabled); };
  // мова шейдерів: матеріали отримують шматки лише цієї мови (як у прикладі shaders/trees)
  const lang = dev.isWebGPU ? pc.SHADERLANGUAGE_WGSL : pc.SHADERLANGUAGE_GLSL;

  // Шари: типові World, Skybox, Immediate, UI (+ Depth), «Тіні» — кидачі тіней (бачать світла, не камера) і «Руки»
  const L = app.scene.layers;
  const world = L.getLayerByName('World'), sky = L.getLayerByName('Skybox');
  world.opaqueSortMode = pc.SORTMODE_FRONT2BACK;
  const shadow = new pc.Layer({ name: 'Тіні' });
  L.push(shadow);
  // «Руки» (перша особа): після прозорого World, до Immediate й UI, з очищенням глибини — не входять у стіни
  // (як шар гізмо, extras/gizmo/gizmo.js createLayer; manual graphics/cameras/multiple-cameras.md — «first-person weapon rendering»)
  const immediate = L.getLayerByName('Immediate');
  const arms = new pc.Layer({ name: 'Руки', clearDepthBuffer: true, opaqueSortMode: pc.SORTMODE_NONE, transparentSortMode: pc.SORTMODE_NONE });
  L.insert(arms, L.layerList.indexOf(immediate));
  const layers = { world, sky, shadow, arms, immediate, ui: L.getLayerByName('UI') };

  // Камера: тональна компресія й гама — PlayCanvas (кольори лінійні; правило покажчика manual/llms/…/engine/llms.txt)
  const camE = new pc.Entity('камера');
  camE.addComponent('camera', {
    fov: 55, nearClip: 0.1, farClip: far, gammaCorrection: pc.GAMMA_SRGB, toneMapping: pc.TONEMAP_NEUTRAL, clearColor: new pc.Color(0, 0, 0),
    layers: L.layerList.filter((l) => l !== shadow).map((l) => l.id),
  });
  app.root.addChild(camE);

  // Світ: наші (x, y, z; z — угору) → PlayCanvas (x − Ox, z, y − Oy). root — поворот −90° навколо X і масштаб (1, −1, 1)
  // (від'ємний визначник PlayCanvas сам враховує у відсіканні граней); O — плаваючий початок, кратний 1024: позиції вузлів
  // рахуються в JS (float64) уже відносно O, тож у float32 GPU — малі числа
  const root = new pc.GraphNode('світ');
  root.setLocalEulerAngles(-90, 0, 0); root.setLocalScale(1, -1, 1);
  app.root.addChild(root);
  const O = [0, 0];
  const ev = new pc.EventHandler();
  const setOrigin = (t) => {
    if (Math.abs(t[0] - O[0]) <= 2048 && Math.abs(t[1] - O[1]) <= 2048) return false;
    O[0] = Math.round(t[0] / 1024) * 1024; O[1] = Math.round(t[1] / 1024) * 1024;
    ev.fire('origin', O);
    return true;
  };
  const toPC = (x, y, z, out = new pc.Vec3()) => out.set(x - O[0], z, y - O[1]);
  const dirToPC = (v, out = new pc.Vec3()) => out.set(v[0], v[2], v[1]);
  // матриця моделі в наших координатах → світова PlayCanvas: ROOT × translate(−O) × m (ROOT міняє рядки y і z)
  const matToPC = (m, out = new Float32Array(16), o = 0) => {
    for (let c = 0; c < 4; c++) {
      const tx = c === 3 ? O[0] : 0, ty = c === 3 ? O[1] : 0, w = m[c * 4 + 3];
      out[o + c * 4] = m[c * 4] - tx * w; out[o + c * 4 + 1] = m[c * 4 + 2]; out[o + c * 4 + 2] = m[c * 4 + 1] - ty * w; out[o + c * 4 + 3] = w;
    }
    return out;
  };

  // Заміри минулого кадру (згладжені): GPU (профайлер PlayCanvas), по проходах, CPU рендера, виклики
  const R = { gpuMs: null, gpuPass: {}, cpuRenderMs: 0, draws: 0, gpuHist: new Float32Array(HIST), gpuHistI: 0, upd: 0, drw: 0, sampler: null, grab: null };
  const measure = () => {
    R.draws = app.stats.drawCallCount;
    const gt = app.stats.gpuFrameTime;
    if (gt !== undefined && gt > 0) { R.gpuMs = R.gpuMs === null ? gt : R.gpuMs * 0.9 + gt * 0.1; R.gpuHist[R.gpuHistI++ % HIST] = gt; }
    const pt = dev.gpuProfiler && dev.gpuProfiler.passTimings;
    if (pt) for (const [k, v] of pt) R.gpuPass[k] = R.gpuPass[k] === undefined ? v : R.gpuPass[k] * 0.9 + v * 0.1;
    R.cpuRenderMs = 0.9 * R.cpuRenderMs + 0.1 * (app.stats.cpuRenderTime || 0);
  };

  // Кадр: гра малює з події 'update' PlayCanvas (рендер іде одразу після неї); _time — мітка rAF цього такту (2.23.2)
  let next = null;
  app.on('update', () => { measure(); const f = next; next = null; if (f) f(app._time); });
  // Заміри покадрово (?dev, test/perf.mjs): інтервал між кадрами (мітки rAF), CPU такту PlayCanvas (від frameupdate до
  // frameend: гра + рендер), CPU рендера PlayCanvas, CPU гри (оновлення, малювання — main.js), GPU кадру (профайлер; з
  // запізненням на кілька кадрів), викликів
  let tickT = 0, prevT = 0;
  app.on('frameupdate', () => { tickT = performance.now(); });
  app.on('frameend', () => {
    const S = R.sampler, t = app._time;
    if (S && prevT) S.push(t - prevT, performance.now() - tickT, app.stats.cpuRenderTime || 0, R.upd, R.drw, app.stats.gpuFrameTime ?? -1, app.stats.drawCallCount);
    prevT = t;
    if (R.grab) { const f = R.grab; R.grab = null; f(); }
  });
  app.start();

  // Нестача пам'яті GPU — подія 'oom' (why): браузер не каже, скільки пам'яті у відеокарти, лише що виділити не вдалося.
  // WebGPU — помилка GPUOutOfMemoryError у 'uncapturederror' пристрою (PlayCanvas лише пише її в журнал налагодження;
  // після відновлення пристрою — знову на новий); WebGL2 — Chrome на нестачу пам'яті втрачає контекст ('devicelost'
  // PlayCanvas, ресурси він відновлює сам)
  const watchOom = () => {
    if (!dev.isWebGPU || !dev.wgpu) return;
    dev.wgpu.addEventListener('uncapturederror', (e) => { if (typeof GPUOutOfMemoryError !== 'undefined' && e.error instanceof GPUOutOfMemoryError) ev.fire('oom', 'out-of-memory: ' + e.error.message); });
  };
  watchOom();
  dev.on('devicerestored', watchOom);
  dev.on('devicelost', () => ev.fire('oom', 'devicelost'));

  const floatRT = !!dev.textureFloatRenderable, floatFilter = !!dev.textureFloatFilterable;
  return {
    pc, dev, app, scene: app.scene, lang, layers, camE, cam: camE.camera, root, O, R,
    on: (name, f) => ev.on(name, f), fire: (name, ...a) => ev.fire(name, ...a),
    setOrigin, toPC, dirToPC, matToPC,
    onFrame(f) { next = f; }, setProfiler,
    get width() { return canvas.clientWidth || innerWidth; }, get height() { return canvas.clientHeight || innerHeight; },
    info: {
      device: dev.isWebGPU ? 'webgpu' : 'webgl2', webgpu: 'gpu' in navigator,
      multiDraw: dev.isWebGPU ? 'drawIndirect' : !!dev.extMultiDraw, floatRT, floatFilter, pcss: floatRT && floatFilter,
    },
  };
}
