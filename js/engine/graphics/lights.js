// js/engine/graphics/lights.js — світла засобами PlayCanvas (graphics/lighting/lights.md, shadows.md, clustered-lighting.md):
// - напрямлені (сонця, місяці) — слоти; тінь (каскадна) кидає лише головне — слот 0, решта без тіней (рішення
//   користувача 11.10.2026: тінь від кількох сонць на око не відрізнити, а коштує по фільтру на піксель за кожне).
//   Напрямлені світла не кластерні: зміна їх кількості
//   перекомпільовує шейдери, тож кількість слотів стала на всесвіт (setDirectionalCount), порожній слот — intensity 0
//   без оновлення тіні; warmUp — прогріти шейдери для 3, 2, 1 слотів (за екраном завантаження);
// - точкові й прожектори — кластерні (шейдери не перекомпільовуються), тіні — в атласі, тип для всіх —
//   scene.lighting.shadowType (лише PCF); нерухомі оновлюють тінь лише при змінах (SHADOWUPDATE_THISFRAME), як радить
//   shadows.md. Налаштування й зміщення — з прикладів graphics/shadow-cascades, shadow-soft, clustered-omni-shadows.
// Кидачі — шари World і «Тіні» (app.js); що з кидачів «Тіней» увімкнено на кадр — regions.cullCasters
export const SHADOW_D = 128;                   // тіні — лише ближче (глибина від камери, shadowDistance PlayCanvas)
// Напрям світла з тінню змінюється кроками, не щокадру. PlayCanvas прив'язує карту тіней до текселів (стабільно при
// русі камери — shadow-renderer-directional.js), але не при повороті світла: сітка текселів повертається навколо початку
// координат і біля точки p зсувається на |p|·кут. Від руху сонця щокадру — на частку текселя, тож краї тіней (тонкі
// стебла, фігура) щоразу перемальовуються інакше й мерехтять навіть на місці (11.10.2026, міра на місці: PCF3
// 0,100 → 0,015, PCSS 0,225 → 0,016 — як без руху сонця). Крок 0,25°: тінь куща зсувається на соті частки одиниці,
// перемальовка — раз на ~0,5 с за доби 16 хв (як оновлення освітлення за lightingThreshold скрипта ProceduralSky)
const SHADOW_STEP = Math.cos(0.25 * Math.PI / 180);
const MAX_DIR = 3;

// G — застосунок (app.js); shadows — 'pcf3' | 'pcss'
export function createLights(G, { shadows = 'pcf3' } = {}) {
  const { pc, app, scene, layers, O } = G;
  const pcss = () => q === 'pcss' && G.info.pcss;
  let q = shadows;
  scene.clusteredLightingEnabled = true;
  const L = scene.lighting;
  L.shadowsEnabled = true; L.cookiesEnabled = false; L.areaLightsEnabled = false;
  L.shadowAtlasResolution = 2048;
  const LAY = [layers.world.id, layers.shadow.id];

  // Поворот світла: +Y — до джерела (напрямлене світить уздовж −Y сутності; код _updateSunLight скрипта ProceduralSky)
  const X = new pc.Vec3(), Z = new pc.Vec3(), S = new pc.Vec3(), M4 = new pc.Mat4(), Q = new pc.Quat();
  const orient = (e, src) => {
    const ref = Math.abs(src.y) > 0.99 ? pc.Vec3.RIGHT : pc.Vec3.UP;
    X.cross(src, ref).normalize(); Z.cross(X, src).normalize();
    M4.set([X.x, X.y, X.z, 0, src.x, src.y, src.z, 0, Z.x, Z.y, Z.z, 0, 0, 0, 0, 1]);
    e.setRotation(Q.setFromMat4(M4));
  };

  // ---- напрямлені: слоти ----
  // Каскади (приклад shadow-cascades): розподіл 0,5, змішування 0,1; зміщення 0,3 / 0,2. Головне — 4 каскади 2048;
  // решта — без тіней. PCSS (приклад shadow-soft): 16 / 16 семплів. Півтінь (shadowSoft.js, PCSSDirectional): ширина
  // пошуку блокерів = penumbraSize · глибина камери тіні (для PCSS — спільна AABB кидачів усіх каскадів, у нас ~300 од.,
  // на низькому сонці — більше), півтінь біля контакту ≈ penumbraFalloff · penumbraSize · відстань до блокера. Тож
  // falloff 16 і size 0,0025 дають ту саму м'якість біля контакту, що 4 і 0,01, а пошук — учетверо вужчий: менше
  // промахів кешу текстур (11.10.2026: тайга опівдні 24,5 → 15,2 мс GPU, ліс 14,4 → 10,1)
  const typeOf = () => pcss() ? { shadowType: pc.SHADOW_PCSS_32F, shadowSamples: 16, shadowBlockerSamples: 16, penumbraSize: 0.0025, penumbraFalloff: 16 } : { shadowType: pc.SHADOW_PCF3_32F };
  const slots = [];
  let shD = SHADOW_D, nDir = 0;
  const makeSlot = (i) => {
    const e = new pc.Entity(`світло ${i}`);
    e.addComponent('light', i ? { type: 'directional', intensity: 0, castShadows: false, layers: LAY } : {
      type: 'directional', intensity: 0, castShadows: true, shadowDistance: shD, layers: LAY,
      cascadeDistribution: 0.5, cascadeBlend: 0.1, shadowBias: 0.3, normalOffsetBias: 0.2,
      numCascades: 4, shadowResolution: 2048, shadowUpdateMode: pc.SHADOWUPDATE_NONE, ...typeOf(),
    });
    app.root.addChild(e);
    return { e, l: e.light, on: false, dir: [0, 0, 1] };
  };
  function setDirectionalCount(k) {
    k = Math.max(1, Math.min(MAX_DIR, k | 0));
    while (slots.length < k) slots.push(makeSlot(slots.length));
    while (slots.length > k) { const s = slots.pop(); s.e.destroy(); }
    nDir = k;
  }
  // i — слот; dir — до світила (наші координати), color — у гамі (0…1), intensity — як у LightComponent
  const V = new pc.Vec3(), C = new pc.Color();
  function setDirectional(i, o) {
    const s = slots[i];
    if (!s) return;
    const on = !!o && o.intensity > 0;
    if (on) {
      const d = o.dir, k = s.dir;
      if (!s.l.castShadows || !s.on || (d[0] * k[0] + d[1] * k[1] + d[2] * k[2]) / Math.hypot(d[0], d[1], d[2]) / Math.hypot(k[0], k[1], k[2]) < SHADOW_STEP) {
        k[0] = d[0]; k[1] = d[1]; k[2] = d[2];
        orient(s.e, G.dirToPC(d, V).normalize());
      }
      s.l.color = C.set(o.color[0], o.color[1], o.color[2]);
      s.l.intensity = o.intensity;
    } else s.l.intensity = 0;
    if (on !== s.on) { if (s.l.castShadows) s.l.shadowUpdateMode = on ? pc.SHADOWUPDATE_REALTIME : pc.SHADOWUPDATE_NONE; s.on = on; }
  }
  function setShadowDistance(d) { shD = d; if (slots[0]) slots[0].l.shadowDistance = d; }
  // Прогрів: кадр із 3, 2, 1 слотом (кожна кількість — свій набір шейдерів), далі — як було, cb()
  function warmUp(cb) {
    const keep = nDir || 1, seq = [3, 2, 1];
    const step = () => {
      if (!seq.length) { setDirectionalCount(keep); if (cb) cb(); return; }
      setDirectionalCount(seq.shift());
      for (const s of slots) { s.l.intensity = 0.001; if (s.l.castShadows) s.l.shadowUpdateMode = pc.SHADOWUPDATE_THISFRAME; s.on = false; }
      app.once('postrender', step);
    };
    step();
  }

  // ---- точкові й прожектори (кластерні) ----
  const locals = new Set();
  const P = new pc.Vec3();
  // { type: 'omni' | 'spot', pos, dir (spot, куди світить), color, intensity, range, inner, outer, castShadows, moving }
  function addLight(o) {
    const e = new pc.Entity('джерело');
    e.addComponent('light', {
      type: o.type || 'omni', color: new pc.Color(...(o.color || [1, 1, 1])), intensity: o.intensity ?? 1, range: o.range ?? 8,
      innerConeAngle: o.inner ?? 30, outerConeAngle: o.outer ?? 45, castShadows: o.castShadows !== false,
      shadowBias: 0.2, normalOffsetBias: 0.2,                       // приклад clustered-omni-shadows
      shadowUpdateMode: o.moving ? pc.SHADOWUPDATE_REALTIME : pc.SHADOWUPDATE_THISFRAME, layers: o.layers || LAY,
    });
    app.root.addChild(e);
    const H = { e, pos: [...o.pos], dir: o.dir ? [...o.dir] : [0, 0, -1], range: o.range ?? 8, moving: !!o.moving };
    const place = () => {
      e.setPosition(G.toPC(H.pos[0], H.pos[1], H.pos[2], P));
      if (e.light.type === 'spot') orient(e, G.dirToPC([-H.dir[0], -H.dir[1], -H.dir[2]], V).normalize());   // прожектор світить уздовж −Y
    };
    const redo = () => { if (!H.moving && e.light.castShadows) e.light.shadowUpdateMode = pc.SHADOWUPDATE_THISFRAME; };
    H.place = place; H.redo = redo;
    H.set = (p) => {
      if (p.pos) { H.pos = [...p.pos]; redo(); }
      if (p.dir) { H.dir = [...p.dir]; redo(); }
      if (p.color) e.light.color = new pc.Color(...p.color);
      if (p.intensity !== undefined) e.light.intensity = p.intensity;
      if (p.range !== undefined) { e.light.range = H.range = p.range; redo(); }
      if (p.moving !== undefined) { H.moving = !!p.moving; e.light.shadowUpdateMode = H.moving ? pc.SHADOWUPDATE_REALTIME : pc.SHADOWUPDATE_THISFRAME; }
      if (p.enabled !== undefined) e.enabled = !!p.enabled;
      place();
    };
    H.remove = () => { locals.delete(H); e.destroy(); };
    place();
    locals.add(H);
    return H;
  }
  G.on('origin', () => { for (const H of locals) H.place(); });
  // кидачі змінились у коробці (наші координати) — нерухомим джерелам поруч оновити тінь
  G.on('casters', (b) => {
    for (const H of locals) {
      if (H.moving) continue;
      const [x, y, z] = H.pos, r = H.range;
      if (Math.hypot(Math.max(b[0] - x, 0, x - b[3]), Math.max(b[1] - y, 0, y - b[4]), Math.max(b[2] - z, 0, z - b[5])) <= r) H.redo();
    }
  });

  // Якість: тип тіней напрямлених і кластерів (PCSS — лише напрямлені; кластерні — PCF5, найм'якший доступний)
  function setQuality(s) {
    q = s;
    const t = typeOf();
    if (slots[0]) Object.assign(slots[0].l, t);
    L.shadowType = pcss() ? pc.SHADOW_PCF5_32F : pc.SHADOW_PCF3_32F;
  }
  setQuality(q);
  setDirectionalCount(1);

  const LOC = [];
  return {
    setDirectionalCount, setDirectional, setShadowDistance, warmUp, addLight, setQuality,
    get quality() { return pcss() ? 'pcss' : 'pcf3'; },
    get slots() { return slots; },
    // напрямлені з тінями на кадр: [{dir — до світила, shD}] (для regions.cullCasters)
    dirs(out = []) {
      out.length = 0;
      for (const s of slots) if (s.on && s.l.castShadows) { s.sh ??= { dir: s.dir, shD: 0 }; s.sh.shD = s.l.shadowDistance; out.push(s.sh); }
      return out;
    },
    // увімкнені точкові джерела й прожектори з тінями: [{pos, range}] (наші координати)
    locals() {
      LOC.length = 0;
      for (const H of locals) if (H.e.enabled && H.e.light.castShadows && H.e.light.intensity > 0) LOC.push(H);
      return LOC;
    },
    info() {
      let dir = 0, shadowed = 0;
      for (const s of slots) if (s.on) { dir++; if (s.l.castShadows) shadowed++; }
      let local = 0;
      for (const H of locals) if (H.e.enabled) { local++; if (H.e.light.castShadows) shadowed++; }
      return { dir, local, shadowed };
    },
  };
}
