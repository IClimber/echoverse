// main.js — запуск: меню світів, ігровий цикл (рух, стрибки, камера, підвантаження чанків), HUD, автозбереження.
// ?strip — замість гри стенд «смуга всесвітів» (js/stands/strip.js), ?flora — галерея видів рослин (js/stands/flora.js),
// ?light — світло й тіні рушія (js/stands/light.js), ?move — стенд руху (js/gen/stand.js: полігон замість світу, без
// збереження; &g= — гравітація, &fr= — тертя, &rain — дощ).
import { createScene, BODY_R } from './render/scene.js';
import { loadSettings, saveSetting } from './settings.js';
import { createWorld, findSpawn, keepFor } from './world.js';
import { colliderOf, underLiquid } from './player/collision.js';
import { createList } from './engine/physics/collide.js';
import { createDevice, landing, landingChunks, CHARGE } from './player/device.js';
import { step, standableB, settle, placeAt, hits, SHAPE, windShelter, SPRINT, GRAVITY, FOOT, BODY, PLAYER_MASS, HIT_IMPULSE } from './player/player.js';
import { stepBody, windMoves, push, collideBodies } from './engine/physics/bodies.js';
import { initInput, moveAxis, turnAxis, sprintHeld, crouchHeld, vertAxis, takeActions, takeWheel, takeDrag, clearInput, lockPointer, unlockPointer, locked, devKey } from './player/input.js';
import { listWorlds, putWorld, deleteWorld, serialize, deserialize, newId } from './save.js';
import { hashStr } from './laws/rng.js';
import { GEN, SEA, physOf, gravityAt, LEVEL } from './laws/universe.js';
import { physAt3, timeK } from './env/worldphys.js';
import { tempAt, tempParts, snowy, radNow, airAt } from './env/climate.js';
import { CS, SEC, B_LIQ, B_MAGMA, solidB, T_WATER, T_ICE, T_SAND, T_LUSH, T_DRY, T_DESERT, T_SNOW, T_ROCK, T_BED } from './gen/chunk.js';
import { clamp01 } from './laws/num.js';
import { groundTint } from './gen/flora.js';
import { debugText } from './debug.js';
import { fx, fmtN, atm } from './fmt.js';
import { animate, VIEW_KEYS } from './player/anim.js';
import { clockStr, skyState, lightsOf, lightSlots, stormAt, setStormOverride } from './env/sky.js';
import { weatherAt, localWeather, areaClimate, reliefAt, windHeightK, lightningNear } from './env/weather.js';
import { createCamera, rotate, wheel, smooth, moveBasis, camHead, camCollide, camDist, facing, setYaw, basis, pitchOf, setViewChunks, setLod, setFloraNear, THIRD, FIRST, NEXT, LIMITS, EYE, EYE_OF, HEAD_OF, VIEW_R, FIG_NEAR } from './player/camera.js';
import { createStreamer, visibleMissing } from './stream.js';
import { aimRay, REACH } from './player/aim.js';
import { lampPose, segHit } from './player/lamp.js';
import { canLift, weightOf, throwBody, holdBody, LIFT_W } from './player/carry.js';
import { STAND_SPOTS, standBodies, standBlock } from './gen/stand.js';
import { makeBody } from './engine/physics/bodies.js';
import { createTicker } from './engine/core/ticker.js';
import { createOcclusion } from './render/occlusion.js';

const $ = (id) => document.getElementById(id);
const SAVE_MS = 10000;                     // автозбереження
const PHYS_DT = 1 / 120, AI_DT = 1 / 30;      // такти: фізика (гравець, тіла); світ, моби й NPC
const AI_BUDGET = 2;                          // мс на такт світу: що не встигло — на наступному
const LIGHT_MS = 1;                           // мс на такт світу для світла неба (поширення між секціями, перебудови)

const QS = new URLSearchParams(location.search);
if (QS.has('strip')) import('./stands/strip.js').then((m) => m.runStrip());
else if (QS.has('flora')) import('./stands/flora.js').then((m) => m.runFlora());
else if (QS.has('light')) import('./stands/light.js').then((m) => m.runLight()).catch((e) => showErr('Стенд ?light: ' + e.message));
else if (QS.has('laws')) import('./stands/laws.js').then((m) => m.runLaws()).catch((e) => showErr('Стенд ?laws: ' + e.message));
else createScene($('gl'), loadSettings(QS)).then(boot).catch(fail);
const RESUME_KEY = 'echoverse-resume';       // світ, у який повернутися після перезавантаження (зміна графіки)

function fail(e) {
  showErr('Графіка не запустилась — гра не працюватиме. ' + e.message);
  $('create').disabled = true;
}

function boot(renderer) {
  addEventListener('resize', () => renderer.resize());
  const raf = renderer.raf || ((f) => requestAnimationFrame(f));   // рушій PlayCanvas: кадр гри — з його такту
  initInput();
  // профайлер GPU PlayCanvas (запити часу на кожен прохід) — лише коли його читають: F3 чи ?dev (manual
  // optimization/gpu-profiling.md: «If no tool needs GPU timing anymore, set profiler.enabled = false»)
  const profNeed = () => renderer.G.setProfiler(QS.has('dev') || showDebug);

  let g = null;                              // поточна гра
  let occOff = QS.get('occ') === '0';        // ?occ=0 — без відсікання закритого (порівняння)
  const cfg = loadSettings(QS);              // налаштування гравця (на браузер): графіка, вид, дальність
  const camera = createCamera(cfg.camera);
  const streamer = createStreamer();
  const physT = createTicker(PHYS_DT), aiT = createTicker(AI_DT, 4);
  // Дальність (8–32 чанки): камера, ліміти пам'яті світу, стрімінг. Пам'ять GPU — скільки потребує коло дальності (без
  // бюджету: до 12.10.2026 бюджет вивантажував секції в колі, а стрімінг замовляв їх знову — петля завантаження)
  const setView = (c) => {
    c = setViewChunks(c);
    $('view').value = c;
    $('viewLabel').textContent = `${c} чанків (${c * CS} клітинок)`;
    if (g) g.world.setKeep(keepFor(VIEW_R));
    streamer.force();
    return c;
  };
  setView(cfg.view);
  // Відеокарті забракло пам'яті (WebGPU — out-of-memory, WebGL2 — втрата контексту): звільнити інші всесвіти й зменшити
  // дальність на 4 чанки (запам'ятовується, як вибір у налаштуваннях); не частіше разу на 5 с — одна нестача дає кілька подій
  let oomAt = -1e9;
  const onOom = (why) => {
    // втрата контексту — не лише нестача: Chrome перезапускає процес GPU (щойно запущений браузер — 14.10.2026: свіжий
    // headless Chrome втрачав контекст першої сторінки, і дальність падала 16 → 12 назавжди). Без світу відеопам'яті гра
    // майже не займає — це не нестача; ресурси PlayCanvas відновлює сам
    if (why === 'devicelost' && !g) { console.info('GPU: контекст втрачено до світу — не нестача пам\'яті'); return; }
    const now = performance.now();
    console.warn('GPU: бракує пам\'яті —', why);
    if (now - oomAt < 5000) return;
    oomAt = now;
    renderer.releaseOthers();
    const c = Math.round(VIEW_R / CS);
    if (c > 8) { saveSetting('view', setView(c - 4)); toast(`Відеокарті бракує пам'яті — дальність ${c - 4} чанків`); }
    else toast('Відеокарті бракує пам\'яті');
  };
  renderer.onOutOfMemory(onOom);
  $('view').addEventListener('input', () => saveSetting('view', setView(+$('view').value)));
  let showDebug = false, showHelp = true, toastUntil = 0;
  profNeed();
  const perf = { fps: 60, cpu: 0, upd: 0, drw: 0, frameMs: 0, p99: 0 };
  const frameT = new Float32Array(512);      // інтервали між кадрами (мс), кільце — для середнього й p99 у F3
  let frameI = 0, frameN = 0;
  function frameStats() {
    const n = Math.min(frameN, frameT.length), a = frameT.slice(0, n).sort();
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i];
    perf.frameMs = n ? s / n : 0; perf.p99 = n ? a[Math.min(n - 1, Math.floor(n * 0.99))] : 0; perf.max = n ? a[n - 1] : 0;
  }
  const hudCache = {};
  const setText = (id, s) => { if (hudCache[id] !== s) { hudCache[id] = s; $(id).textContent = s; } };
  if (QS.has('dev')) window.eco = {                // для автоматичних перевірок у браузері
    get g() { return g; }, camera, renderer,
    stats() {
      frameStats();
      const st = g ? g.world.stats() : {}, R = renderer.R;
      return { fps: perf.fps, frameMs: perf.frameMs, p99: perf.p99, frameMax: perf.max, upd: perf.upd, drw: perf.drw, gpuMs: R.gpuMs, draws: R.stats.draws, tris: R.stats.tris, full: R.stats.full, flTris: R.stats.flTris, flbTris: R.stats.flbTris,
        gpuMB: (R.stats.gpuBytes + R.stats.arenaBytes) / 1048576, colsPerSec: st.colsPerSec, pending: st.pending, cols: st.cols, secs: st.secs, meshes: renderer.meshCount, lod: [...renderer.lodCounts], workers: st.workers, streamMs: g ? g.streamMs : 0,
        pcMs: R.cpuRenderMs, gpuPass: R.gpuPass, shTris: R.stats.shTris, shDraws: R.stats.shDraws, lamp: !!(g && g.lamp), lampTris: R.stats.lampTris || 0, lampDraws: R.stats.lampDraws || 0, camSub: R.stats.camSub, shSub: R.stats.shSub, occ: g && g.occ ? { ...g.occ.stats } : null, ...lightStats() };
    },
    // Відсікання закритого: увімкнути / вимкнути (заміри й знімки «з / без»; тримається й після нового світу)
    occ(on, opts) { occOff = !on; if (g) { g.occ.enabled = !!on; if (opts) g.occ.set(opts); } return !occOff; },
    // світло неба блоку в точці (0…30; −1 — невідомо, −2 — опакове) і стан поля світла поточного всесвіту
    lightAt(x, y, z) { return g.world.lightAt(g.d, g.n, Math.floor(x), Math.floor(y), Math.floor(z / LEVEL)); },
    light() { return g.world.lightStats(g.d, g.n); },
    // Годинник на фазу доби ph (0 — північ, 0,5 — полудень) поточного всесвіту; вічний день — ні (false)
    setPhase(ph) { const c = clockFor(ph); if (c === null) return false; g.clock = c; return true; },
    // Фаза 0…0,99 з найбільшою кількістю напрямлених світел (за рівності — найсильніших), ставить її
    bestPhase() {
      const L = g.world.laws(g.d, g.n), k = lightSlots(L);
      let best = 0, bn = -1, bw = -1;
      for (let i = 0; i < 100; i++) {
        const c = clockFor(i / 100);
        if (c === null) break;
        const D = lightsOf(skyState(L, c), k).dirs.filter(Boolean), w = D.reduce((s, l) => s + l.k, 0);
        if (D.length > bn || (D.length === bn && w > bw)) { best = i / 100; bn = D.length; bw = w; }
      }
      window.eco.setPhase(best);
      return { phase: best, lights: bn };
    },
    // Знайти всесвіт за умовою pred(L) (закони) на глибині d від номера from (уперед, до count) і стрибнути туди: номер чи null
    findLaw(pred, { d = g.d, from = g.n + 1, count = 200000 } = {}) {
      for (let i = 0; i < count; i++) {
        const n = from + i;
        if (pred(g.world.laws(d, n))) { g.dev.start([d, n], 'jumpNext'); return n; }
      }
      return null;
    },
    // Найближча пляма аномалії до 3000 м ('grav' — інша сила тяжіння, 'rev' — зворотна, 'time' — часова: повільна чи швидка):
    // гравець — туди, на ґрунт
    findAnom(kind = 'grav') {
      const L = g.world.laws(g.d, g.n), me = g.me;
      for (let r = 0; r <= 3000; r += 16) for (let a = 0; a < 6.283; a += Math.max(0.05, 16 / Math.max(r, 1))) {
        const x = Math.floor(me.x + r * Math.cos(a)) + 0.5, y = Math.floor(me.y + r * Math.sin(a)) + 0.5, q = kind === 'time' ? timeK(L, x, y) : gravityAt(L, x, y);
        if (kind === 'time' ? q.ws > 0.9 || q.wf > 0.9 : kind === 'rev' ? q.rev && q.k < -0.2 : !q.rev && Math.abs(q.k - 1) > 0.4) {
          placeAt(me, x, y, me.z + 200); me.fly = true;
          g.cam = [x, y, me.z]; streamer.force();
          return [x, y, q.k];
        }
      }
      return null;
    },
    // Годинник на фазу року ph (0…1; 0,25 — літо північної півкулі), фаза доби — та сама
    setYear(ph) {
      const L = g.world.laws(g.d, g.n), S = L.sky, Y = S.year, tk = L.phys ? L.phys.time : 1;
      if (!Y || S.lock) return false;
      const day = S.dayMin * 60 / tk, ph0 = clockFor(0.5) ?? 0, year = Y.min * 60 / tk, p = ((ph - Y.off) % 1 + 1) % 1;
      g.clock = Math.round((p * year - ph0) / day) * day + ph0;
      return true;
    },
    // Найближче (до 400 діб уперед) затемнення сонця місяцем чи компаньйоном (частка ≥ min): годинник — на нього
    eclipse(min = 0.6) {
      const L = g.world.laws(g.d, g.n), step = L.sky.dayMin * 60 / (L.phys ? L.phys.time : 1) / 400;
      for (let c = g.clock, end = g.clock + step * 400 * 400; c < end; c += step) {
        const s = skyState(L, c);
        if (s.suns[0].eclipse >= min && s.suns[0].dir[2] > 0.2) { g.clock = c; return s.suns[0].eclipse; }
      }
      return null;
    },
    // Найближча (до 400 діб уперед) мить, коли тінь планети найближче до середини тіла (компаньйон, інакше місяць i) і
    // падає на нього: годинник — на неї; кутова відстань тіні від середини тіла в його радіусах чи null
    moonShadow(i) {
      const L = g.world.laws(g.d, g.n), step = L.sky.dayMin * 60 / (L.phys ? L.phys.time : 1) / 2000;
      const pick = (s) => (i === undefined ? s.moons.find((m) => m.comp) || s.moons[0] : s.moons[i]);
      let best = null, bc = 0;
      for (let c = g.clock, end = g.clock + step * 2000 * 400; c < end; c += step) {
        const s = skyState(L, c), m = pick(s);
        if (!m || m.dir[2] < 0.1) continue;
        // тінь — від найяскравішого за потоком сонця (тіла освітлюють усі сонця, тінь планети — від кожного)
        const M = s.suns.reduce((a, b) => ((b.bright0 ?? b.bright) > (a.bright0 ?? a.bright) ? b : a));
        const a = Math.acos(Math.max(-1, Math.min(1, -(m.dir[0] * M.dir[0] + m.dir[1] * M.dir[1] + m.dir[2] * M.dir[2])))) / m.size;
        if (best === null || a < best) { best = a; bc = c; }
        if (best < 0.02) break;
      }
      if (best === null || best > 1 + pick(skyState(L, bc)).shadow / pick(skyState(L, bc)).size) return null;
      g.clock = bc;
      return best;
    },
    // Погода для замірів: тип опадів ('rain' | 'snow' | 'dust' | 'acid'), сила 1; 'clear' — ясно; null — як є
    weather(type) { wOver = type === undefined ? null : type; return wOver; },
    // Буря зорі сили I (0…1) зараз; null — як за законами
    starStorm(I = 1) { setStormOverride(I); return I; },
    // Удар блискавки поруч (за 150–400 м від камери, у найвищу точку околу) — зараз
    lightning() {
      const L = g.world.laws(g.d, g.n), a = Math.random() * 6.283, r = 150 + 250 * Math.random();
      g.boltForce = { ...forcedBolt(L, g.cam[0] + r * Math.cos(a), g.cam[1] + r * Math.sin(a)), t0: g.clock, k: 1, h: (Math.random() * 2 ** 32) >>> 0 };
      return g.boltForce;
    },
    // Усе про середовище тут (рядок «тут» F3)
    envAt: () => envHere(),
    // Найближча (до 48 клітинок) точка, де можна стати, з укриттям вище голови ≥ 4 одиниць (печера): гравець — туди
    findCave() {
      const P = g.world.probe(g.d, g.n), me = g.me;
      let best = null, bd = Infinity;
      for (let dy = -48; dy <= 48; dy += 2) for (let dx = -48; dx <= 48; dx += 2) {
        const x = Math.floor(me.x) + dx + 0.5, y = Math.floor(me.y) + dy + 0.5, top = g.world.topAt(g.d, g.n, Math.floor(x), Math.floor(y));
        if (top === null) continue;
        for (let z = top - 6; z >= me.z - 30; z -= LEVEL) {
          const d = Math.hypot(dx, dy, z - me.z);
          if (d >= bd) continue;
          if (standableB(P, x, y, z)) { const s = settle(P, x, y, z); if (!hits(P, ...s)) { best = s; bd = d; break; } }   // капсула влазить (хід у 2 блоки — ні)
        }
      }
      if (!best) return null;
      placeAt(me, ...best);
      g.cam = [...best];
      streamer.force();
      return best;
    },
    settings() { return { ...loadSettings(QS), info: renderer.R.info }; },
    toggleCamera() { toggleCam(); return camera.mode; },
    // Найближча (до 64 клітинок) водойма глибиною ≥ minK блоків (типово 3): [x, y, поверхня] або null
    findLiquid(minK = 3) {
      const me = g.me;
      for (let r = 0; r <= 64; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx += (Math.abs(dy) === r ? 1 : 2 * r || 1)) {
        const x = Math.floor(me.x) + dx, y = Math.floor(me.y) + dy, top = g.world.topAt(g.d, g.n, x, y);
        if (top === null) continue;
        let k = Math.floor(top / LEVEL) + 1;
        const k0 = k - 64;
        while (k > k0 && g.world.block(g.d, g.n, x, y, k) === 0) k--;
        if (g.world.block(g.d, g.n, x, y, k) !== B_LIQ) continue;
        let n = 0;
        while (n < minK && g.world.block(g.d, g.n, x, y, k - n) === B_LIQ) n++;
        if (n >= minK) return [x + 0.5, y + 0.5, (k + 1) * LEVEL - 0.15];
      }
      return null;
    },
    // Стенд «на око»: каркас трикутників зіткнень навколо гравця (радіус 4, зелений; тіла й предмети — жовтий) і капсула (блакитна)
    showColl(on = true) { g.showColl = !!on; return g.showColl; },
    // Камера: режим ('first' | 'third') — через V; напрям погляду (азимут від +x, нахил: + — униз), радіани;
    // dist — відстань третьої особи
    setCam(mode) { if (camera.mode !== mode && NEXT[camera.mode] === mode) toggleCam(); return camera.mode; },
    look(yaw, pitch, dist) {
      setYaw(camera, yaw + Math.PI);
      if (dist !== undefined) camera.dist = camera.distT = dist;
      if (pitch !== undefined) { if (camera.mode === FIRST) camera.pitch1 = camera.pitch1T = pitch; else camera.pitch3 = camera.pitch3T = pitch; }
      return [camera.yaw, camera.mode === FIRST ? camera.pitch1 : camera.pitch3];
    },
    // Скинути кільця замірів (інтервали кадрів, час GPU) — заміри з чистого аркуша
    resetFrames() { frameN = 0; frameI = 0; if (renderer.R.gpuHist) renderer.R.gpuHistI = 0; },
    // Тіні — 'off' | 'pcf3' | 'pcss' (як у налаштуваннях) → фактичні
    shadows(m) { return renderer.setShadows(m); },
    // Сцена з рядка F3 «відтворити» (JSON чи об'єкт) — 1 в 1: новий світ з того зерна, та мить (годинник), адреса, позиція
    // й швидкість, політ, поза (присід — затиснутий Ctrl), камера, ліхтарик, погода й годинник ?dev, дальність, тіні.
    // Графічний пристрій, полотно й масштаб тут не змінити — повертає розбіжності {що: [було, треба]}
    async restore(s) {
      const S = typeof s === 'string' ? JSON.parse(s) : s, now = Date.now(), diff = {};
      setView(S.view);
      await startWorld({ id: newId(), name: `Відтворення «${S.seed}»`, seedText: S.seed, seed: hashStr(S.seed), gen: S.gen, created: now, played: now, player: { d: S.d, n: S.n, x: S.x, y: S.y, z: S.z }, history: [], clock: S.clock });
      for (let i = 0; i < 1200 && !g.me.placed; i++) await new Promise((r) => setTimeout(r, 50));
      if (!g.me.placed) throw new Error('restore: гравця не поставлено за 60 с');
      const me = g.me;
      placeAt(me, S.x, S.y, S.z);
      me.fly = !!S.fly; [me.vx, me.vy, me.vz] = S.v || [0, 0, 0];
      g.cam = [me.x, me.y, me.z]; g.clock = S.clock; g.pin = S.pin ?? null; g.lamp = !!S.lamp; wOver = S.weather ?? null;
      const L = g.world.laws(g.d, g.n), H = S.hyst || {};
      if (H.wk) g.wPrev = { ...weatherAt(L, S.clock, S.x, S.y), kind: H.wk[0], since: H.wk[1], L };
      clim = { L, x: Math.floor(S.x), y: Math.floor(S.y), desert: !!H.desert, arid: !!H.arid }; g.snow = !!H.snow;
      if (S.pose === 'crouch') devKey('ControlLeft', true);
      else if (S.pose && S.pose !== 'stand') diff.pose = [me.pose || 'stand', S.pose];
      if (camera.mode !== S.cam) toggleCam();
      setYaw(camera, S.yaw); camera.dist = camera.distT = S.dist;
      if (camera.mode === FIRST) camera.pitch1 = camera.pitch1T = S.pitch; else camera.pitch3 = camera.pitch3T = S.pitch;
      const R = renderer.R.info, c = $('gl');
      if (R && R.shadows !== S.shadows) renderer.setShadows(S.shadows);
      if (S.gen !== GEN) diff.gen = [GEN, S.gen];
      if (R && R.device !== S.gpu) diff.gpu = [R.device, S.gpu];
      if (c.width !== S.px[0] || c.height !== S.px[1]) diff.px = [[c.width, c.height], S.px];
      if (devicePixelRatio !== S.dpr) diff.dpr = [devicePixelRatio, S.dpr];
      return diff;
    },
    // Рівні деталізації далекої землі: false — усе повне (порівняння)
    setLod(on) { setLod(on); streamer.force(); },
    setFloraNear(r) { setFloraNear(r); streamer.force(); },
    // Відсікання задніх граней землі: false — усе з обох боків (порівняння)
    setCull(on) { renderer.R.setCull(on); },
    // Великі рослини зблизька матеріалом без дизерингу там, де він нічого не відкидає: false — усе з дизерингом (порівняння)
    flSplit(on) { renderer.R.setFlSplit(on); return !!on; },
    // Тіні (порівняння): {tight — маски каскадів за зрізами, lod — тіні за відстанню, sched — дальні каскади не щокадру}
    shadowOpt(o) { return renderer.R.shadowOpt(o); },
    // Нестача пам'яті GPU (перевірка реакції): event — подією пристрою WebGPU, як від браузера; інакше — одразу обробник
    gpuOom(event = false) {
      const d = renderer.G.dev;
      if (event && d.isWebGPU) d.wgpu.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror', { error: new GPUOutOfMemoryError('?dev') }));
      else onOom('?dev');
      return Math.round(VIEW_R / CS);
    },
    // Текст F3 у буфер обміну (як Ctrl+Shift+C); повертає текст
    copyDebug() { return copyDebug(); },
    // Зупинити світ (годинник, рух, камера) без меню — знімки одного й того самого кадру
    // at — мітка часу замороженого кадру (анімація фігури — за нею, пози доведено до цілі): однаковий кадр у різних запусках
    freeze(on, at) {
      g.frozen = !!on;
      if (on && at !== undefined) { g.frozenAt = at; for (let i = 0; i < 80; i++) animate(g.me, 0.05, at, 1); }
      return g.frozen;
    },
    // Годинник світу стоїть (погода, вітер, світила — ті самі щокадру): on — на поточному значенні, false — іде далі
    pin(on) { g.pin = on ? g.clock : null; if (on) renderer.rebake(); return g.pin; },
    // Стенд руху: гравець — на місце name (STAND_SPOTS), обличчям за поглядом місця
    spot(name) {
      const sp = STAND_SPOTS[name], me = g.me;
      if (!sp) return null;
      let k = 70;
      while (k > 0 && !(solidB(standBlock(Math.floor(sp[0]), Math.floor(sp[1]), k - 1)) || standBlock(Math.floor(sp[0]), Math.floor(sp[1]), k - 1) === B_LIQ)) k--;
      const s = settle(g.world.probe(g.d, g.n), sp[0], sp[1], k * LEVEL);
      placeAt(me, s[0], s[1], s[2]); me.fly = false; me.yaw = sp[2];
      g.cam = [me.x, me.y, me.z];
      setYaw(camera, sp[2] + Math.PI);
      return s;
    },
    // Клавіша (e.code) натиснута / відпущена — як від клавіатури (дії: F, пробіл, Ctrl…)
    key(code, down = true) { devKey(code, down); return true; },
    // Поза гравця: {pose, climb, stam, slide, dive, carry (маса тіла в руках)}
    pose() { const me = g.me; return { pose: me.pose, climb: me.climb ? { ...me.climb } : null, stam: me.stam, slide: !!me.slide, dive: !!me.dive, carry: g.carry ? g.carry.b.mass : null, h: me.h }; },
    // Ліхтарик (L): увімкнути / вимкнути; без аргументу — стан
    lamp(on) { if (on !== undefined) g.lamp = !!on; return !!g.lamp; },
    // Підсвітка цілі (обрис, каркас): false — не малювати (заміри ціни; ціль і дії лишаються)
    aimFx(on) { g.aimFx = !!on; return g.aimFx; },
    // Ціль: {kind, t, x, y, k, b, mass, key} або null
    aim() { const a = g.aim; return a ? { kind: a.kind, t: a.t, p: a.p, x: a.x, y: a.y, k: a.k, b: a.b, mass: a.body ? a.body.mass : undefined, key: a.key, form: a.obj ? a.obj.o.k : undefined } : null; },
    // Заміри (test/perf.mjs): дальність у чанках (8–32), як у налаштуваннях, але без запису
    setView(c) { return setView(c); },
    // Покадрові заміри ms мілісекунд: [інтервал кадру, CPU такту PlayCanvas, CPU рендера PlayCanvas, CPU оновлення гри,
    // CPU малювання гри, GPU кадру (−1 — профайлер вимкнено), викликів]
    sample(ms) {
      const A = [], R = renderer.G.R;
      R.sampler = { push: (...v) => A.push(v) };
      return new Promise((r) => setTimeout(() => { R.sampler = null; r(A); }, ms));
    },
    // Профайлер GPU PlayCanvas: увімкнути / вимкнути → стан
    gpuProf(on) { return renderer.G.setProfiler(on); },
    // Поворот камери з постійною швидкістю rad/с (0 — стоп)
    spin(rate) { g.spin = rate || 0; return g.spin; },
    // Кадр полотна (PNG, data URL) одразу після рендера наступного кадру (той самий такт: буфер ще цілий)
    grab(type = 'image/png') { return new Promise((r) => { renderer.G.R.grab = () => r($('gl').toDataURL(type)); }); },
    // Порядок малювання незалежний від порядку робіт генератора (scene.js canon) — попіксельні порівняння
    canon(seed = 0) { return renderer.canon(seed); },
    // Видимого ще бракує (стовпців без зведення й секцій не в GPU) — заміри часу після стрибка
    visMissing() { return g && g.view ? visibleMissing(g, camera, renderer) : -1; },
  };

  // Годинник, за якого фаза доби поточного всесвіту — ph (sky.js dayPhase); вічний день — null
  function clockFor(ph) {
    const L = g.world.laws(g.d, g.n), S = L.sky;
    if (S.lock) return null;
    const p = ((ph - S.off) % 1 + 1) % 1;
    return p * S.dayMin * 60 / (L.phys ? L.phys.time : 1);
  }
  function lightStats() {
    const i = renderer.R.info, gh = renderer.R.gpuHist;
    let p99 = null;
    if (gh) { const a = Array.from(gh).filter((v) => v > 0).sort((x, y) => x - y); if (a.length) p99 = a[Math.min(a.length - 1, Math.floor(a.length * 0.99))]; }
    return { dirLights: i && i.lights ? i.lights.dir : null, locals: i && i.lights ? i.lights.local : null, gpuP99: p99, device: i ? i.device : 'webgl2-old', shadowsQ: i ? i.shadows : null };
  }
  let wOver = null;                                // ?dev: перевизначена погода
  // V: перша особа ↔ третя (нахил переноситься)
  function toggleCam() {
    const was = camera.mode;
    camera.mode = NEXT[was];
    if (was === FIRST) camera.pitch3 = camera.pitch3T = Math.min(LIMITS.third.pitch[1], Math.max(LIMITS.third.pitch[0], camera.pitch1));
    else camera.pitch1 = camera.pitch1T = Math.min(LIMITS.first.pitch[1], Math.max(LIMITS.first.pitch[0], camera.pitch3));
    saveSetting('camera', camera.mode);
    toast({ first: 'Камера: перша особа', third: 'Камера: третя особа' }[camera.mode]);
  }

  // ================= Меню =================
  function showMenu() { unlockPointer(); $('menu').hidden = false; $('settings').hidden = true; $('menu').firstElementChild.hidden = false; $('resume').hidden = !g; renderWorlds(); }

  // ---- Налаштування: графіка (після перезавантаження), тіні й дальність (одразу) ----
  const info = renderer.R.info || null;
  const showCard = (set) => { $('settings').hidden = !set; $('menu').firstElementChild.hidden = set; };
  $('openSettings').onclick = () => showCard(true);
  $('back').onclick = () => showCard(false);
  // Перемикач «Назва ‹ значення ›»: стрілки й клацання по значенню — по колу; недоступні значення пропускаються
  function selector(el, opts, cur, pick) {
    const [prev, next] = el.querySelectorAll('.arr'), val = el.querySelector('.val'), ok = opts.filter((o) => !o.off);
    let i = Math.max(0, ok.findIndex((o) => o.v === cur));
    const show = () => { val.textContent = ok[i].t; prev.disabled = next.disabled = ok.length < 2; };
    const go = (d) => { i = (i + d + ok.length) % ok.length; show(); pick(ok[i].v); };
    prev.onclick = () => go(-1); next.onclick = () => go(1); val.onclick = () => go(1);
    show();
    return ok[i].v;
  }
  // Графіка: navigator.gpu браузер дає лише в захищеному контексті (localhost, 127.0.0.1, https); http://0.0.0.0:8123 —
  // посилання, яке друкує python3 -m http.server, — не захищений: WebGPU там немає, хоч браузер його й підтримує
  if (!navigator.gpu) {
    const n = $('gpuNote'), here = `${location.protocol}//${location.host}`;
    if (isSecureContext) n.textContent = 'WebGPU недоступний: браузер не надав його на цій сторінці';
    else {
      const to = `http://localhost:${location.port || 80}${location.pathname}${location.search}`;
      n.innerHTML = `WebGPU браузер дає лише на захищених адресах (localhost, 127.0.0.1, https), а сторінку відкрито з ${here}. ` +
        `Відкрийте <a href="${to}">${to.replace(/\/$/, '')}</a>. Світи зберігаються окремо для кожної адреси — перенести: експорт тут, імпорт там`;
    }
    n.hidden = false;
  }
  const gpuNow = selector($('optGpu'), [{ v: 'webgl2', t: 'WebGL2' }, { v: 'webgpu', t: 'WebGPU', off: !navigator.gpu }], cfg.gpu, (v) => {
    saveSetting('gpu', v); $('reload').hidden = !info || v === info.device;
  });
  $('reload').hidden = !info || gpuNow === info.device;
  // Тіні: одразу (перекомпіляція й прогрів — поки відкрите меню)
  const shNote = (v) => {
    $('shNote').textContent = v === 'off' ? 'Найшвидше; сонце світить і крізь стіни — у печерах світло'
      : v === 'pcf3' ? 'PCF3 — чіткі краї, швидше'
      : info && !info.pcss ? 'Відеокарта не підтримує м\'які тіні — будуть чіткі' : 'PCSS — м\'які краї, повільніше';
  };
  shNote(selector($('optSh'), [{ v: 'off', t: 'Без тіней' }, { v: 'pcf3', t: 'Чіткі' }, { v: 'pcss', t: 'М\'які' }], cfg.shadows, (v) => {
    saveSetting('shadows', v); shNote(v);
    renderer.setShadows(v); renderer.warmUp();
  }));
  $('reload').onclick = async () => {
    if (g) { await putWorld(snapshot()); try { sessionStorage.setItem(RESUME_KEY, g.rec.id); } catch { /* недоступне */ } }
    location.reload();
  };
  if (info && cfg.gpu === 'webgpu' && info.device !== 'webgpu') setTimeout(() => toast('WebGPU недоступний — WebGL2'), 0);
  // після перезавантаження через зміну графіки — одразу в той самий світ і місце
  (async () => {
    let id = null;
    try { id = sessionStorage.getItem(RESUME_KEY); sessionStorage.removeItem(RESUME_KEY); } catch { /* недоступне */ }
    if (!id) return;
    const rec = (await listWorlds()).find((w) => w.id === id);
    if (rec) startWorld(rec);
  })();
  // Третя особа: клацання по світу захоплює мишу; браузер відпустив (Esc) — меню, як і на Esc без захоплення
  $('gl').addEventListener('mousedown', (e) => { if (e.button === 0 && g && g.me.placed && $('menu').hidden) lockPointer($('gl')); });
  let unlockQuiet = false, unlockedAt = 0;
  document.addEventListener('pointerlockchange', () => {
    if (!locked() && !unlockQuiet && g && $('menu').hidden) { save(); showMenu(); unlockedAt = performance.now(); }
    unlockQuiet = false;
    $('mouseHint').hidden = !(g && !locked());
  });
  // Повний екран гри (F11 чи кнопка в меню): requestFullscreen + Keyboard Lock — тоді Chrome віддає грі й Ctrl+W,
  // Ctrl+Shift+W (присідання з W не закриває вкладку). Без нього Ctrl+W закриває вкладку; у Firefox Keyboard Lock немає.
  // Esc із Keyboard Lock приходить у гру (меню), затиснутий Esc — вихід з повного екрана (Chrome)
  function toggleFull() {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    const el = document.documentElement;
    if (!el.requestFullscreen) { toast('Браузер не дає повного екрана'); return; }
    el.requestFullscreen({ navigationUI: 'hide' }).then(() => navigator.keyboard?.lock?.().catch(() => {}))
      .catch(() => toast('Повний екран не ввімкнувся'));
  }
  const fullBtn = () => { $('full').textContent = document.fullscreenElement ? 'Вийти з повного екрана' : 'На весь екран'; };
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) navigator.keyboard?.unlock?.(); fullBtn(); });
  $('full').onclick = toggleFull;
  let ctrlWarned = false;                          // Ctrl поза повним екраном: раз за сесію — про Ctrl+W
  // Ctrl+W поза повним екраном сторінці не приходить (браузер одразу закриває вкладку), а Ctrl — це присідання: присів і
  // пішов уперед — вкладку закрито. Тож поки в грі затиснуто Ctrl — браузер перепитує (beforeunload; так само перепитає
  // й на Ctrl+R, Ctrl+Shift+R). Світ і без того зберігається (pagehide)
  addEventListener('beforeunload', (e) => { if (g && crouchHeld() && !document.fullscreenElement) { e.preventDefault(); e.returnValue = ''; } });
  function hideMenu() { $('menu').hidden = true; clearInput(); document.activeElement?.blur(); }   // інакше Enter у грі тиснув би кнопку меню
  const btn = (text, fn, cls) => { const b = document.createElement('button'); b.textContent = text; b.onclick = fn; if (cls) b.className = cls; return b; };

  async function renderWorlds() {
    const list = await listWorlds(), box = $('worlds');
    box.textContent = '';
    if (!list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Збережених світів ще немає.'; box.append(e); return; }
    for (const w of list) {
      const el = document.createElement('div'), info = document.createElement('div'), nm = document.createElement('div'), meta = document.createElement('div');
      el.className = 'world'; info.className = 'info'; nm.className = 'name'; meta.className = 'meta';
      nm.textContent = w.name;
      meta.textContent = `зерно «${w.seedText}» · глибина ${w.player.d}, всесвіт ${fmtN(w.player.n)} · ${new Date(w.played).toLocaleString('uk-UA')}`;
      info.append(nm, meta);
      const del = btn('✕', async () => {
        if (!confirm(`Видалити світ «${w.name}»? Це не можна скасувати.`)) return;
        if (g && g.rec.id === w.id) await quitGame(false);
        await deleteWorld(w.id);
        showMenu();
      });
      del.title = 'Видалити';
      const exp = btn('Файл', () => exportWorld(w));
      exp.title = 'Зберегти у файл';
      el.append(info, btn(g && g.rec.id === w.id ? 'Продовжити' : 'Грати', () => startWorld(w), 'main'), exp, del);
      box.append(el);
    }
  }
  $('resume').onclick = hideMenu;
  $('create').onclick = () => {
    const text = $('seed').value.trim() || randomSeed(), now = Date.now();
    $('seed').value = '';
    startWorld({ id: newId(), name: `Світ «${text}»`, seedText: text, seed: hashStr(text), gen: GEN, created: now, played: now, player: null, history: [] });
  };
  $('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('create').click(); });
  $('import').onclick = () => $('file').click();
  $('file').onchange = async () => {
    const f = $('file').files[0];
    $('file').value = '';
    if (!f) return;
    try {
      const { world } = deserialize(await f.text());
      world.id = newId(); world.played = Date.now();         // імпорт — завжди окремий світ, наявний не перезаписуємо
      await putWorld(world);
      showErr('');
      renderWorlds();
    } catch (e) { showErr('Не вдалося імпортувати: ' + e.message); }
  };

  function exportWorld(w) {
    const rec = g && g.rec.id === w.id ? snapshot() : w;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([serialize(rec)], { type: 'application/json' }));
    a.download = `echoverse-${rec.seedText.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'world'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ================= Гра =================
  async function startWorld(rec) {
    physT.reset(); aiT.reset();
    if (g && g.rec.id === rec.id) { hideMenu(); return; }
    if (g) await quitGame(true);
    if (!rec.player) {
      const sp = findSpawn(rec.seed) || [0.5, 0.5];
      rec.player = { d: 0, n: 0, x: sp[0], y: sp[1], z: sp[2] };
    }
    const p = rec.player;
    renderer.clear();
    g = {
      rec, world: createWorld(rec.seed, (kind, d, n, k, q, data, m) => {
        if (kind === 'sec') renderer.addSection(d, n, k, q, m);
        else if (kind === 'flora') renderer.addFlora(d, n, k, q, data, m);
        else if (kind === 'obj') renderer.addObj(k, m);
        else renderer.addFar(k, data, m);
      }, { stand: !!rec.stand }), dev: createDevice(rec.history),
      d: p.d, n: p.n, me: { x: p.x, y: p.y, z: p.z, vz: 0, air: false, ground: true, yaw: Math.PI * 0.75, moving: false, placed: false },
      cam: [p.x, p.y, p.z || 0], lastSave: performance.now(), view: null, clock: rec.clock || 0,
      stamp: 0, ai: [], aiAt: 0,                 // крок фізики (інтерполяція тіл); системи світу (моби, NPC) — (dt, g)
      lamp: false,                               // ліхтарик (L; js/player/lamp.js) — не зберігається, як і політ
      envHere: () => envHere(),                  // середовище тут (F3)
    };
    g.occ = createOcclusion(g.world);               // відсікання закритого (заслони з блоків, js/render/occlusion.js)
    if (occOff) g.occ.enabled = false;
    // сутності: зона симуляції 5×5 чанків навколо гравця (поточний всесвіт; інші сплять і дорахуються при поверненні)
    g.ai.push((dt, G) => G.world.ents(G.d, G.n).update(Math.floor(G.me.x / CS), Math.floor(G.me.y / CS), G.clock * 1000));
    // світло неба: поширення між секціями й перебудова мешів, чиє світло зросло (js/world.js lightTick)
    const lightHooks = { hasSection: (d, n, k) => renderer.hasSection(d, n, k), hasFlora: (d, n, k) => renderer.hasFlora(d, n, k), get target() { return g && g.cam; } };
    g.ai.push((dt, G) => G.world.lightTick(LIGHT_MS, lightHooks));
    g.world.setCurrent(g.d, g.n);
    g.world.setKeep(keepFor(VIEW_R));
    if (rec.stand) {
      // стенд руху: закони з адреси (гравітація, тертя, дощ), тіла біля зони E
      const L = g.world.laws(0, 0);
      if (QS.has('g')) L.grav = Math.max(0.02, +QS.get('g') || 1);
      if (QS.has('fr')) L.phys = { ...L.phys, friction: Math.max(0.01, Math.min(1, +QS.get('fr') || 1)) };
      L.anom = { ...L.anom, freq: 0 };
      if (QS.has('rain')) wOver = 'rain';
      for (const b of standBodies(L)) g.world.ents(0, 0).add(makeBody(b));
      g.me.yaw = 0;
    }
    streamer.force();
    setYaw(camera, g.me.yaw + Math.PI);
    if (!rec.stand) putWorld(snapshot());
    hideMenu();
    $('hud').hidden = false; $('loading').hidden = false; $('debug').hidden = !showDebug;
    renderer.warmUp();          // шейдери для 3, 2, 1 напрямленого світла — за екраном завантаження
    if (rec.gen !== GEN) toast('Світ створено іншою версією генератора: незмінені місця можуть виглядати інакше');
  }
  async function quitGame(save) {
    if (!g) return;
    if (save && !g.rec.stand) await putWorld(snapshot());
    g.world.stop(); g = null;
    $('mouseHint').hidden = true;
    renderer.clear();
    $('hud').hidden = true; $('debug').hidden = true; $('loading').hidden = true;
  }
  function snapshot() {
    const r = g.rec;
    r.player = { d: g.d, n: g.n, x: g.me.x, y: g.me.y, z: g.me.z };
    r.history = g.dev.history.slice();
    r.clock = g.clock;
    r.played = Date.now();
    return r;
  }
  const save = () => { if (g && !g.rec.stand) putWorld(snapshot()); };
  addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  // Усі чанки кола приземлення (d, n) навколо (x, y) згенеровано?
  // Стовпці кола приземлення й секції біля висоти ніг (z) у (d, n) згенеровано?
  const ready = (d, n, x, y, z) => {
    const czMe = Math.floor(Math.floor((z ?? 0) / LEVEL) / SEC);
    return landingChunks(x, y, CS).every(([cx, cy]) => {
      const C = g.world.col(d, n, cx, cy);
      if (!C) return false;
      // ті самі секції, що замовляє stream (поверхня й біля ніг); між ними — невідомо, landing вважає це стіною
      const has = (cz) => g.world.hasSec(d, n, cx, cy, cz);
      for (let cz = C.czLo; cz <= C.czHi; cz++) if (!has(cz)) return false;
      for (let cz = czMe - 1; cz <= czMe + 1; cz++) if (!has(cz)) return false;
      return true;
    });
  };

  // Поставити гравця у всесвіті (d, n) біля ніг (x, y, z): там, де стоїть, найближче місце, де можна стояти, або
  // вільне місце в тому самому стовпці (z невідомий — від поверхні клітинки). [x, y, z]; undefined — чанки ще генеруються
  function placeIn(d, n, x, y, z) {
    if (!ready(d, n, x, y, z)) return undefined;
    const P = g.world.probe(d, n), ph = physOf(g.world.laws(d, n));
    if (z === undefined) { const c = g.world.column(d, n, Math.floor(x), Math.floor(y)); z = (c ? c.h : 8) * LEVEL; }
    return landing(P, x, y, z, ph);
  }
  const OVER_NAMES = { clear: 'ясно', rain: 'дощ', snow: 'сніг', acid: 'кислотний дощ', dust: 'пилова буря' };
  const STAR_CLS = ['червоний карлик (M)', 'помаранчева зоря (K)', 'жовта зоря (G)', 'жовто-біла зоря (F)', 'біла зоря (A)', 'блакитна зоря (B)'];
  const liqStr = (lq) => lq.name + (lq.danger ? ` (${lq.danger})` : '');
  const addrStr = (d, n) => d === g.d ? `всесвіт ${fmtN(n)}` : `глибина ${d}, всесвіт ${fmtN(n)}`;

  // Зайшов у небезпечну рідину — сказати, що це й чим небезпечна (заходити можна: здоров'я ще немає)
  let wasWet = false, wasHot = false;
  function warnLiquid() {
    const lq = g.world.laws(g.d, g.n).liquid, wet = !!g.me.wet, me = g.me;
    if (wet && !wasWet && lq.danger) toast(`${lq.name[0].toUpperCase() + lq.name.slice(1)}: ${lq.danger} — небезпечно`);
    wasWet = wet;
    const hot = me.ground && me.floorB === B_MAGMA;
    if (hot && !wasHot) toast('Під ногами розпечена лава — небезпечно');
    wasHot = hot;
  }

  // Стрибок пристроєм: вдається завжди (там, де ніде стати, — вільне місце: пливеш чи падаєш)
  function tryJump() {
    const [d, n] = g.dev.charge.to, at = placeIn(d, n, g.me.x, g.me.y, g.me.z);
    if (at === undefined) return;                               // ще генерується — стрибок трохи зачекає
    const P = g.world.laws(g.d, g.n), was = P.grav, L = g.world.laws(d, n), depth = d !== g.d;
    drop();                                                     // тіло лишається у своєму всесвіті
    g.dev.done([g.d, g.n]);
    g.prev = [g.d, g.n];
    g.d = d; g.n = n; g.world.setCurrent(d, n); placeAt(g.me, at[0], at[1], at[2]); g.me.fly = false;
    const msg = [];
    if (depth) msg.push(`глибина ${d}`);
    if (Math.abs(L.grav - was) >= 0.12) msg.push(`гравітація ${fx(L.grav, 2)} g — ${L.grav < was ? 'легше' : 'важче'}`);
    const lq = L.liquid;
    if (lq.kind !== P.liquid.kind || lq.danger !== P.liquid.danger) msg.push(`у водоймах — ${liqStr(lq)}`);
    if (!L.air.breath && (P.air.breath || L.air.gas !== P.air.gas)) msg.push(`повітря ${L.air.gasName}`);
    if (L.phys.friction < 1 && P.phys.friction === 1) msg.push('ковзкий ґрунт');
    if (L.phys.bounce > 0 && !P.phys.bounce) msg.push('пружний ґрунт');
    const dT = L.clim.Tpatch - P.clim.Tpatch;
    if (Math.abs(dT) >= 15) msg.push(`${dT > 0 ? 'тепліше' : 'холодніше'}: ${Math.round(L.clim.Tpatch - 273.15)} °C`);
    const pr = (L.air.pressure + 1e-4) / (P.air.pressure + 1e-4);
    if (L.air.vacuum && !P.air.vacuum) msg.push('повітря майже немає');
    else if (!L.air.vacuum && (pr > 1.6 || pr < 1 / 1.6)) msg.push(`тиск ${atm(L.air.pressure)} атм`);
    if (L.star.cls !== P.star.cls || L.star.n !== P.star.n) msg.push(STAR_CLS[L.star.cls] + (L.star.n > 1 ? ` (зір ${L.star.n})` : ''));
    if (L.comp && !P.comp) msg.push(L.planet.held === 'comp' ? 'на небі стоїть планета-компаньйон' : 'на небі — планета-компаньйон');
    const H = L.planet.held;
    if (H !== P.planet.held) { if (H === 'sun') msg.push('вічний день'); else if (H === 'moon') msg.push('місяць стоїть на небі'); else if (H === 'res') msg.push('доба — 2 роки (резонанс 3:2)'); }
    if (L.tanom && !P.tanom) msg.push('часові аномалії');
    if (L.anom.rev && !P.anom.rev) msg.push('зворотна гравітація');
    if (Math.abs(L.phys.time / P.phys.time - 1) > 0.3) msg.push(`час тече ${L.phys.time > P.phys.time ? 'швидше' : 'повільніше'} (×${fx(L.phys.time)})`);
    if (msg.length) toast(msg.join(' · ').replace(/^./, (c) => c.toUpperCase()));
    $('flash').classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => $('flash').classList.remove('on')));
  }
  // Випадкова адреса (для перевірок): номер — у межах ±100 000, з глибиною — 0…12
  const rnd = (k) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % k; };

  // Вітер біля гравця: погода в його точці (поле, weather.js) × висота й відкритість (середня висота поверхні в колі
  // 48 м — після зсуву > 8 м); hk — множник висоти гравця (тіла — свій)
  function windHere(L) {
    const me = g.me;
    if (!g.zbarAt || g.zbarAt.L !== L || Math.hypot(me.x - g.zbarAt.x, me.y - g.zbarAt.y) > 8) { g.zbar = reliefAt(L, me.x, me.y); g.zbarAt = { L, x: me.x, y: me.y }; }
    const W = g.wPrev = weatherAt(L, g.clock, me.x, me.y, g.wPrev && g.wPrev.L === L ? g.wPrev : null), hk = windHeightK(me.z, g.zbar);
    W.L = L;
    return wOver === 'clear' ? { ...W, wind: [0, 0], windK: 0, hk: 1 } : { ...W, wind: [W.wind[0] * hk, W.wind[1] * hk], windK: W.windK * hk, hk };
  }
  // Висота ґрунту (верх стовпця) — для зворотних плям тяжіння (worldphys.js)
  const groundZ = (x, y) => g.world.topAt(g.d, g.n, Math.floor(x), Math.floor(y));
  // Затишок тіла: windShelter — сотні звертань до блоків, а у вітер рухаються всі легкі тіла біля гравця (~170 у
  // кришталевій пустелі) щокроку 120 Гц — кадр тоне в кроках фізики. Тому з пам'яті, доки тіло не зсунулось на LEE_MOVE,
  // вітер не повернув понад ~2,5° (cos 0,999) і не минуло LEE_STEPS кроків (догенеровані поруч секції)
  const LEE_MOVE = 0.1, LEE_STEPS = 30, leeMemo = new WeakMap();
  function bodyLee(b, P, z, wind) {
    const w = Math.hypot(wind[0], wind[1]);
    if (w < 1e-6) return 1;
    const ux = wind[0] / w, uy = wind[1] / w, m = leeMemo.get(b);
    if (m && m.P === P && g.stamp - m.at < LEE_STEPS && Math.abs(b.x - m.x) < LEE_MOVE && Math.abs(b.y - m.y) < LEE_MOVE && Math.abs(z - m.z) < LEE_MOVE
      && ux * m.ux + uy * m.uy > 0.999) return m.lee;
    const lee = windShelter(P, b.x, b.y, z, wind);
    leeMemo.set(b, { P, at: g.stamp, x: b.x, y: b.y, z, ux, uy, lee });
    return lee;
  }
  // Тіла біля гравця (ширяюче каміння): крок фізики; гравець, що стоїть на тілі, тисне його вагою й їде разом з ним;
  // тіло, у яке йде гравець, штовхається (легке — відкотиться, важке — ні)
  function simBodies(dt, L, W) {
    const me = g.me, reg = g.world.ents(g.d, g.n), ob = me.ground ? me.onBody : null;
    let near = reg.awake();
    const ox = ob && ob.x, oy = ob && ob.y;
    if (ob) { ob.vz -= PLAYER_MASS * GRAVITY * (g.ph ? g.ph.g : L.grav) * dt / ob.mass; ob.sleep = false; ob.calm = 0; }
    if (me.moving && !me.fly) for (const b of g.world.bodiesNear(g.d, g.n, me.x, me.y, 1.5)) {
      if (b === ob || b.held || Math.abs(me.x - b.x) > b.hx + FOOT + 0.08 || Math.abs(me.y - b.y) > b.hy + FOOT + 0.08 || me.z > b.z + b.hz || me.z + (me.h || BODY) < b.z - b.hz) continue;
      const dx = b.x - me.x, dy = b.y - me.y, l = Math.hypot(dx, dy) || 1, mv = Math.hypot(me.vx || 0, me.vy || 0);
      if (mv > 0.1 && (dx * me.vx + dy * me.vy) > 0) { push(b, [dx / l * PLAYER_MASS * 5 * dt, dy / l * PLAYER_MASS * 5 * dt, 0]); b.dirty = true; }
    }
    const P = g.world.probe(g.d, g.n);
    holdCarry();
    if (g.carry && !near.includes(g.carry.b)) near = [...near, g.carry.b];
    for (const b of near) { b.px = b.x; b.py = b.y; b.pz = b.z; b.ps = g.stamp; }   // стан до кроку — інтерполяція кадру
    for (const b of near) {
      const ph = physAt3(L, b.x, b.y, b.z - b.hz, g.clock, groundZ), env = { g: ph.g, g0: ph.g0, vT: ph.vT0, tilt: ph.tilt, rev: ph.rev, bounce: L.phys.bounce, friction: L.phys.friction, wind: W.wind };
      if (b.sleep && !windMoves(b, env)) continue;                // спить і вітер не зрушить — не рахуємо
      const lee = bodyLee(b, P, b.z - b.hz, W.wind) * windHeightK(b.z - b.hz, g.zbar ?? b.z) / (W.hk || 1);
      env.wind = [W.wind[0] * lee, W.wind[1] * lee];
      stepBody(b, dt * timeK(L, b.x, b.y).k, P, env);           // часова аномалія: тіло живе у своєму часі
    }
    collideBodies(near, P, { bounce: L.phys.bounce, friction: L.phys.friction });   // між собою (сплячі — перешкоди)
    // зрушене далі за 0,1 від місця появи — змінене (переживе вивантаження); інший чанк — інший власник
    for (let i = near.length - 1; i >= 0; i--) {
      const b = near[i];
      if (b.ps !== g.stamp || (b.x === b.px && b.y === b.py && b.z === b.pz)) continue;
      if (!b.dirty && Math.hypot(b.x - b.x0, b.y - b.y0, b.z - b.z0) > 0.1) b.dirty = true;
      reg.moved(b);
    }
    if (ob) { me.x += ob.x - ox; me.y += ob.y - oy; me.z = ob.z + ob.hz; }
  }
  function drop() { if (g.carry) { g.carry.b.held = false; g.carry.b.dirty = true; g.carry = null; } }
  // Удар (ЛКМ): з тілом у руках — кинути; ціль-тіло — поштовх; блоки й рослини не чіпає (зміни світу — п. 6)
  function hit(now) {
    const me = g.me;
    me.hitAt = now;
    if (g.carry) {
      const b = g.carry.b;
      g.carry = null;
      throwBody(b, lookDir());
      me.throwAt = now;
      return;
    }
    const a = g.aim;
    if (!a || a.kind !== 'body') return;
    const d = lookDir();
    push(a.body, [d[0] * HIT_IMPULSE, d[1] * HIT_IMPULSE, (d[2] + 0.25) * HIT_IMPULSE]);
    a.body.dirty = true;
    if (HIT_IMPULSE / a.body.mass < 0.3) toast('Камінь заважкий — ледь зрушив');
  }
  // Взяти / покласти (F)
  function take(now) {
    const me = g.me;
    if (g.carry) { drop(); me.takeAt = now; return; }
    const a = g.aim;
    if (!a) return;
    if (a.kind !== 'body') { toast('Поки що взяти можна лише камінь'); return; }
    const b = a.body, q = canLift(b, g.ph ? g.ph.g : 1);
    if (me.climb || me.pose === 'crawl' || me.pose === 'swim' || me.dive) { toast('Звідси не взяти'); return; }
    if (!q.ok) { toast(`Заважко: ${Math.round(b.mass)} кг (тут можна до ${Math.round(q.max)} кг)`); return; }
    b.held = true; b.sleep = false; b.dirty = true;
    if (b.ax !== undefined) b.ax = null;
    g.carry = { b, k: q.w / LIFT_W };
    me.takeAt = now;
  }
  // Використати (ПКМ): ціль є, дії поки немає (двері, скрині — з будуванням)
  function use(now) {
    const a = g.aim;
    if (a === undefined) return;
    g.me.useAt = now;
    toast('Нічого використати');
  }
  // Тіло в руках: точка тримання перед грудьми, швидкість тіла — до неї; випадає, коли лягаєш, лізеш, пірнаєш чи далеко
  function holdCarry() {
    const c = g.carry, me = g.me;
    if (!c) return;
    const gg = g.ph ? g.ph.g : 1;
    c.k = weightOf(c.b, gg) / LIFT_W;
    if (me.climb || me.pose === 'crawl' || me.pose === 'swim' || me.dive || c.k > 1 + 1e-9 || gg <= 0 || !holdBody(c.b, me, lookDir(), camera.mode === FIRST)) drop();
  }
  // Ціль під поглядом (з ока гравця, як у Minecraft); обрис предмета —
  // повна будова з генератора (робота 'obj')
  function updateAim() {
    const me = g.me;
    g.aim = null;
    if (!me.placed || !$('menu').hidden) return;
    const P = g.world.probe(g.d, g.n), objAt = (x, y) => g.world.objAt(g.d, g.n, x, y);
    let a = aimRay(P, objAt, [me.ix ?? me.x, me.iy ?? me.y, (me.iv ?? me.z) + (g.eyeH ?? EYE)], lookDir(), REACH);
    if (a && a.kind === 'body' && g.carry && a.body === g.carry.b) a = null;
    if (a && a.kind === 'obj') {
      const C = a.obj.C;
      a.key = `o${g.d}:${g.n}:${C.cx}:${C.cy}:${a.obj.i}`;
      if (!renderer.hasObj(a.key)) g.world.wantObj(g.d, g.n, C.cx, C.cy, a.obj.i);
    }
    g.aim = a;
  }
  // Мокра стіна (лазіння): дощ, кислотний дощ чи сніг, і над головою відкрите небо
  function wetWall() {
    const t = g.loc && g.loc.type;
    return (t === 'rain' || t === 'acid' || t === 'snow') && g.world.skyOpen(g.d, g.n, g.me.x, g.me.y, g.me.z + 0.9) > 0.5;
  }
  // Тіло в руках: вага / межа (0…1); погляд камери (дії, пірнання) — куди дивиться камера
  const carryK = () => g.carry ? g.carry.k : 0;
  function lookDir() {
    const u = basis(camera).u;
    return [-u[0], -u[1], -u[2]];
  }
  let spaceAt = 0;                           // коли востаннє натиснули пробіл: двічі поспіль — політ
  function update(dt, now) {
    const menuOpen = !$('menu').hidden;
    let jump = false;
    for (const a of takeActions()) {
      if (a === 'fullscreen') { toggleFull(); continue; }
      if (a === 'crouchPress' && !ctrlWarned && !document.fullscreenElement && !menuOpen) { ctrlWarned = true; toast('Ctrl+W закриває вкладку — повний екран: F11'); }
      if (a === 'menu') {
        if (performance.now() - unlockedAt < 400) continue;            // той самий Esc, що відпустив мишу, — меню вже відкрите
        if (menuOpen) hideMenu(); else { save(); showMenu(); }
      }
      else if (menuOpen || !g.me.placed) continue;
      else if (a === 'debug') { showDebug = !showDebug; $('debug').hidden = !showDebug; profNeed(); }
      else if (a === 'copyDebug') copyDebug();
      else if (a === 'help') { showHelp = !showHelp; $('help').hidden = !showHelp; }
      else if (a === 'jump') {
        if (now - spaceAt < 300) {
          g.me.fly = !g.me.fly; g.me.vz = 0; spaceAt = 0;
          toast(g.me.fly ? 'Політ: пробіл / Ctrl — угору / униз, Shift — швидше, пробіл двічі — вимкнути' : 'Політ вимкнено');
        } else { jump = true; spaceAt = now; }
      }
      else if (a === 'camera') toggleCam();
      else if (a === 'crouchPress') g.crouchLatch = true;
      else if (g.rec.stand && (a === 'jumpPrev' || a === 'jumpNext' || a === 'jumpRandom' || a === 'jumpRandomDepth')) toast('Стенд руху: стрибків немає');
      else if (a === 'jumpPrev' || a === 'jumpNext') { if (g.dev.start([g.d, g.n + (a === 'jumpNext' ? 1 : -1)], a) === 'cancel') toast('Стрибок скасовано'); }
      else if (a === 'hit' || a === 'hitDev') { if (a === 'hitDev' || locked()) hit(now); }   // у третій особі перше клацання — захоплення миші
      else if (a === 'take') take(now);
      else if (a === 'use') use(now);
      else if (a === 'lamp') { g.lamp = !g.lamp; toast(g.lamp ? 'Ліхтарик увімкнено' : 'Ліхтарик вимкнено'); }
      else if (a === 'jumpRandom' || a === 'jumpRandomDepth') {
        const to = [a === 'jumpRandomDepth' ? (g.d + 1 + rnd(12)) % 13 : g.d, rnd(200001) - 100000];
        if (g.dev.start(to, a) === 'cancel') toast('Стрибок скасовано');
      }
    }
    if (!$('menu').hidden || g.frozen) return;                  // меню — пауза (`?dev` freeze — теж)
    g.clock = g.pin != null ? g.pin : g.clock + dt;             // годинник світу (доба кожного всесвіту — своя; ?dev pin — стоїть)
    const w = takeWheel(), [mx, my] = takeDrag(), turn = turnAxis();
    if (w) wheel(camera, w);
    if (mx || my || turn) rotate(camera, mx + turn * dt * 260, my);
    if (g.spin) setYaw(camera, camera.yaw + g.spin * dt);        // ?dev spin — поворот камери з постійною швидкістю (заміри)
    smooth(camera, dt);
    const me = g.me;
    if (!me.placed) {
      const at = placeIn(g.d, g.n, me.x, me.y, me.z);
      if (at !== undefined) {
        placeAt(me, at[0], at[1], at[2]);
        g.cam = [me.x, me.y, me.z]; me.placed = true;
        $('loading').hidden = true;
        $('mouseHint').hidden = locked();
      }
    } else {
      // фізика — фіксованим тактом PHYS_DT (стан до кроку — для інтерполяції кадру); пробіл — «защіпка» до кроку
      const [ix, iy] = moveAxis();
      const sprint = sprintHeld();
      g.jumpLatch = g.jumpLatch || jump;
      for (let s = physT.advance(dt); s > 0; s--) {
        const L = g.world.laws(g.d, g.n), W = windHere(L);   // вітер — сила опору (густина повітря — у vT)
        g.windK = W.windK; g.windHk = W.hk;
        me.px = me.visX ?? me.x; me.py = me.visY ?? me.y; me.pv = me.vis ?? me.z; g.stamp++;
        g.ph = physAt3(L, me.x, me.y, me.z, g.clock, groundZ);
        const probe = g.world.probe(g.d, g.n);
        g.lee = windShelter(probe, me.x, me.y, me.z, W.wind);       // затишок: стіна, дерево чи камінь з навітряного боку, печера
        const t0 = performance.now();
        step(me, ix, iy, g.jumpLatch, PHYS_DT, probe, g.ph, moveBasis(camera), { sprint, vert: vertAxis(), crouch: crouchHeld(), crouchPress: g.crouchLatch, wind: [W.wind[0] * g.lee, W.wind[1] * g.lee], wet: wetWall(), carry: carryK(), look: lookDir() });
        g.stepUs = (g.stepUs || 0) * 0.95 + (performance.now() - t0) * 1000 * 0.05;   // F3: крок гравця, мкс (згладжено)
        g.jumpLatch = false; g.crouchLatch = false;
        me.run = sprint && me.moving && !me.fly;
        if (!me.climb) me.yaw = facing(camera);      // туди, куди дивиться камера (у третій — спиною до неї); S — задкує; на стіні — у стіну
        simBodies(PHYS_DT, L, W);
        warnLiquid();
        if (g.dev.update(PHYS_DT)) tryJump();                       // стрибок — без «шлейфу» (placeAt)
        if (!me.placed) break;
      }
      if (!me.climb) me.yaw = facing(camera);       // і в кадрі без кроку фізики (камера — щокадру)
      // світ, моби й NPC — тактом AI_DT; бюджет такту AI_BUDGET мс: системи, що не встигли, — на наступному
      for (let s = aiT.advance(dt); s > 0; s--) {
        const t0 = performance.now();
        for (let i = 0; i < g.ai.length; i++) {
          const j = (g.aiAt + i) % g.ai.length;
          if (performance.now() - t0 > AI_BUDGET) { g.aiAt = j; break; }
          g.ai[j](AI_DT, g);
        }
      }
    }
    // Інтерполяція між двома останніми кроками фізики (кадр не смикається при частоті, не кратній такту)
    const al = physT.alpha, lerp = (a, b) => a === undefined ? b : a + (b - a) * al;
    me.ix = lerp(me.px, me.visX ?? me.x); me.iy = lerp(me.py, me.visY ?? me.y); me.iv = lerp(me.pv, me.vis ?? me.z);
    // Ціль камери: гравець (у третій особі — його голова); плавно, по висоті — повільніше (стрибок не трусить камеру)
    const k = Math.min(1, dt * 14), kz = Math.min(1, dt * 5);
    const foot = [me.ix ?? me.x, me.iy ?? me.y, me.iv ?? me.z ?? 0];
    // висота ока й голови — за позою (присів, лежить), плавно
    const kp = Math.min(1, dt * 12), pose = me.pose || 'stand';
    g.eyeH = g.eyeH === undefined ? EYE_OF[pose] : g.eyeH + (EYE_OF[pose] - g.eyeH) * kp;
    g.headH = g.headH === undefined ? HEAD_OF[pose] : g.headH + (HEAD_OF[pose] - g.headH) * kp;
    let tz = foot[2], src = null;
    if (camera.mode === THIRD && me.placed) { src = colliderOf(g.world.probe(g.d, g.n)); tz = camHead(src, foot, g.headH); }   // низька стеля — ціль під нею
    g.cam[0] += (foot[0] - g.cam[0]) * k; g.cam[1] += (foot[1] - g.cam[1]) * k;
    g.cam[2] += (tz - g.cam[2]) * kz;
    if (src && tz < foot[2] + g.headH - 1e-6 && tz < g.cam[2]) g.cam[2] = tz;   // під стелю — одразу
    if (camera.mode === FIRST && me.placed) {
      // перша особа: око гравця, без згладжування; під низькою стелею — нижче
      const ez = camHead(colliderOf(g.world.probe(g.d, g.n)), foot, g.eyeH);
      g.cam[0] = foot[0]; g.cam[1] = foot[1]; g.cam[2] = ez; g.eyeZ = ez - foot[2];
      g.camDist = 0;
    } else if (src) {
      // камера — куля: не крізь поверхню, стовбури, каміння й тіла; не перетинає поверхню рідини відносно цілі
      const P = g.world.probe(g.d, g.n), r = camCollide(camera, [foot[0], foot[1], tz], g.cam, src, (x, y, z) => underLiquid(P, x, y, z));
      g.cam[0] = r.target[0]; g.cam[1] = r.target[1]; g.cam[2] = r.target[2];
      g.camDist = camDist(g.camDist, r.dist, dt);
    } else g.camDist = camera.dist;
    const dist = g.camDist;
    g.view = renderer.view(camera, g.cam, dist);
    updateAim();
    // око під рідиною (вид з-під рідини: туман і колір рідини, без неба й опадів)
    g.under = me.placed && underLiquid(g.world.probe(g.d, g.n), g.cam[0] + g.view.eye[0], g.cam[1] + g.view.eye[1], g.cam[2] + g.view.eye[2]);
    g.far = streamer.update(g, camera, renderer, now).far;
    g.visible = streamer.visible; g.streamMs = streamer.ms;
    if (now - g.lastSave > SAVE_MS) { g.lastSave = now; save(); }
  }

  // Карта укриттів від опадів (64×64 навколо гравця): висота верху стовпця; перебудова — коли гравець перейшов
  // у іншу клітинку чи раз на секунду (догенерувались чанки)
  const rainBuf = new Float32Array(64 * 64);
  function rainMap(now) {
    const x0 = Math.floor(g.me.x) - 32, y0 = Math.floor(g.me.y) - 32, r = g.rain;
    if (r && r.x0 === x0 && r.y0 === y0 && r.d === g.d && r.n === g.n && now - r.at < 1000) return r;
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) { const z = g.world.topAt(g.d, g.n, x0 + i, y0 + j); rainBuf[j * 64 + i] = z === null ? -1e4 : z; }
    renderer.setShelter(rainBuf, x0, y0);
    return (g.rain = { x0, y0, d: g.d, n: g.n, at: now });
  }

  // ?dev showColl: відрізки каркаса зіткнень — трикутники в коробці ±4 навколо гравця й кільця куль капсули
  function collLines(me) {
    const L = colliderOf(g.world.probe(g.d, g.n)).gather(me.x - 4, me.y - 4, me.z - 2, me.x + 4, me.y + 4, me.z + 3, createList(4096));
    const pos = [], col = [], c = (r, gg, b) => col.push(r, gg, b, 1, r, gg, b, 1);
    for (let i = 0; i < L.n; i++) {
      const o = i * 12, t = L.t, k = L.ref[i] ? [1, 0.85, 0.2] : [0.2, 1, 0.3];
      for (let e = 0; e < 3; e++) { const a = o + e * 3, b = o + (e + 1) % 3 * 3; pos.push(t[a], t[a + 1], t[a + 2], t[b], t[b + 1], t[b + 2]); c(...k); }
    }
    for (const [, , oz] of SHAPE.pts) for (let j = 0; j < 16; j++) {
      const a0 = j / 16 * Math.PI * 2, a1 = (j + 1) / 16 * Math.PI * 2, R = SHAPE.R, z = me.z + oz;
      pos.push(me.x + R * Math.cos(a0), me.y + R * Math.sin(a0), z, me.x + R * Math.cos(a1), me.y + R * Math.sin(a1), z); c(0.3, 0.8, 1);
      pos.push(me.x + R * Math.cos(a0), me.y, z + R * Math.sin(a0), me.x + R * Math.cos(a1), me.y, z + R * Math.sin(a1)); c(0.3, 0.8, 1);
    }
    return { pos, col };
  }

  // Клімат місця для погоди (пустеля, пил) — за околом з гістерезисом (areaClimate); сніг — за температурою (climate.js)
  let clim = null;
  // Ціль примусової блискавки: найвища точка в радіусі 30 м (як lightningNear)
  function forcedBolt(L, x, y) {
    let hz = -1e9, tx = x, ty = y;
    for (let dy = -30; dy <= 30; dy += 6) for (let dx = -30; dx <= 30; dx += 6) {
      if (dx * dx + dy * dy > 900) continue;
      const h = g.world.topAt(g.d, g.n, Math.floor(x + dx), Math.floor(y + dy));
      if (h !== null && h !== undefined && h > hz) { hz = h; tx = x + dx; ty = y + dy; }
    }
    return { x: Math.floor(tx) + 0.5, y: Math.floor(ty) + 0.5, z: hz > -1e9 ? hz : g.me.z, cx: tx, cy: ty };
  }
  // Середовище тут і зараз (HUD, F3 «тут», ?dev envAt): температура з розкладом, тиск і густина на висоті, тяжіння
  // (приплив, аномалія, зворотна), плин часу плями, вітер (база, тут, пориви й висота, затишок), радіація з бурею зорі
  function envHere() {
    const L = g.world.laws(g.d, g.n), me = g.me, ph = g.ph, W = g.wPrev || weatherAt(L, g.clock, me.x, me.y), I = stormAt(L, g.clock);
    const ai = airAt(L, me.z), tk = timeK(L, me.x, me.y);
    return {
      T: tempParts(L, me.x, me.y, me.z, g.clock, W), P: ai.P, rho: ai.rho,
      g: ph ? ph.g : L.grav, g0: L.grav, tide: ph ? ph.tide : 0, anom: ph ? ph.anom : null, rev: !!(ph && ph.rev), tilt: ph ? ph.tilt : null,
      time: tk.k, wind: { base: L.air.wind, here: g.windK ?? 0, dir: W.wind, hk: g.windHk ?? 1, lee: g.lee ?? 1, push: !!me.windPush },
      rad: radNow(L, I), storm: I,
    };
  }

  // Пилинки у вітер: видно напрям і силу вітру, що зносить гравця. Поріг — той, з якого зносить тут (p.windTh = vT·√тертя:
  // у розрідженому повітрі й при сильному тяжінні вищий): з 0,8 порогу проступають, на 1,1 — повна сила, до 2 —
  // густішають. Опади й пилова буря вітер уже показують — тоді пилинок немає. Колір — ґрунт під ногами.
  // Повертає {k — сила 0…1, col — колір ґрунту (0…255)} або null
  // (степ і пустеля — з відтінком біому, як у далечі far.js; під травою — земля)
  const MOTE_PAL = { [T_WATER]: 'liquid', [T_ICE]: 'ice', [T_SAND]: 'sand', [T_LUSH]: 'soil', [T_DRY]: 'dry', [T_DESERT]: 'desert', [T_SNOW]: 'snow', [T_ROCK]: 'rock', [T_BED]: 'bed' };
  function motesHere(L, W, loc) {
    const th = g.me.windTh;
    if (loc.type || !th || L.air.vacuum) return null;
    const r = Math.hypot(W.wind[0], W.wind[1]) / th, k = clamp01((r - 0.8) / 0.3) * (0.55 + 0.45 * clamp01((r - 1.1) / 0.9));
    if (k <= 0) return null;
    const c = g.world.column(g.d, g.n, Math.floor(g.me.x), Math.floor(g.me.y));
    const t = c ? c.t : T_DESERT;
    return { k, col: c && (t === T_DRY || t === T_DESERT) ? groundTint(L, MOTE_PAL[t], c.bm) : L.pal[MOTE_PAL[t] || 'desert'] };
  }

  function draw(dt, now) {
    const ch = g.dev.charge, me = g.me, L = g.world.laws(g.d, g.n);
    let W = me.placed ? windHere(L) : weatherAt(L, g.clock, me.x, me.y);
    if (wOver === 'clear') W = { ...W, kind: 0, clouds: 0, vis: 1, precip: 0, dust: 0, dim: 0, flash: 0 };
    // блискавка поблизу (до 3 км від камери): спалах неба 1/(1 + (d/800)²), гасне за 0,25 с; розряд і світло — сцена
    if (g.boltForce && (g.clock < g.boltForce.t0 || g.clock > g.boltForce.t0 + 0.25)) g.boltForce = null;
    const bolt = g.boltForce || (wOver === 'clear' ? null : lightningNear(L, g.clock, g.cam[0], g.cam[1]));
    if (bolt) { const d = Math.hypot(bolt.x - g.cam[0], bolt.y - g.cam[1]); W = { ...W, flash: bolt.k * (1 - (g.clock - bolt.t0) / 0.25) / (1 + (d / 800) ** 2) }; }
    g.bolt = bolt;
    if (me.placed) clim = areaClimate(L, me.x, me.y, clim);
    const C = me.placed && clim;
    if (me.placed) { g.temp = tempAt(L, me.x, me.y, me.z, g.clock, W); g.snow = snowy(g.temp, g.snow); }   // сніг чи дощ — за температурою тут
    let loc = localWeather(L, W, !!g.snow, !!C && C.desert, !!C && C.arid);
    if (wOver !== null) loc = { ...loc, type: wOver === 'clear' ? null : wOver || null, k: wOver === 'clear' ? 0 : 1, name: OVER_NAMES[wOver] || loc.name };
    g.loc = loc;                                     // опади тут (мокра стіна — лазіння)
    const motes = me.placed ? motesHere(L, W, loc) : null;
    // голова — туди, куди дивиться камера (на стіні тіло дивиться в стіну)
    me.carry = !!g.carry;
    const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
    me.look = { p: pitchOf(camera), y: wrap(facing(camera) - me.yaw) };
    const anim = animate(me, dt, now, physOf(L).speed * (me.run ? SPRINT * 0.85 : 1));
    if (!g.view) return;
    renderer.pump();
    // тіла: між двома останніми кроками фізики (ті, що цього кроку не рахувались, — де є)
    const bodies = g.world.bodiesNear(g.d, g.n, g.cam[0], g.cam[1], BODY_R), al = physT.alpha;
    for (const b of bodies) {
      const k = b.ps === g.stamp ? al : 1;
      b.ix = b.ps === undefined ? b.x : b.px + (b.x - b.px) * k; b.iy = b.ps === undefined ? b.y : b.py + (b.y - b.py) * k; b.iz = b.ps === undefined ? b.z : b.pz + (b.z - b.pz) * k;
    }
    const lines = g.showColl && me.placed ? collLines(me) : null;
    const ix = me.ix ?? me.x, iy = me.iy ?? me.y, iz = me.iv ?? me.vis ?? me.z;
    // ліхтарик: перша особа — з ока, третя — зі скла на лобі (поза тієї самої фігури, що малюється), уздовж погляду камери;
    // камеру в тісноті підтягнуло до голови (фігури не видно) — з ока, як у першій: скло за 0,27 м перед оком, впритул до стіни
    const lamp = g.lamp && me.placed ? lampPose({
      first: camera.mode === FIRST || Math.hypot(...g.view.eye) <= FIG_NEAR, eye: [g.cam[0] + g.view.eye[0], g.cam[1] + g.view.eye[1], g.cam[2] + g.view.eye[2]], look: lookDir(),
      anim, foot: [ix, iy, iz], yaw: me.yaw, safe: g.cam, hit: (o, d, t) => segHit(g.world.probe(g.d, g.n), o, d, t),
    }) : null;
    g.lampEye = !!lamp && !lamp.shadow;      // F3: світить з ока
    const sk = renderer.draw({
      lines, lamp, under: g.under ? L.liquid : null, skyLight: (x, y, z) => g.world.skyLight(g.d, g.n, x, y, z),
      camera, target: g.cam, view: g.view, laws: L, far: g.far, occ: g.occ, charge: g.dev.charge ? g.dev.charge.to : null, clock: g.clock, bodies, aim: g.aimFx === false ? null : g.aim, weather: { W: loc.W, loc }, bolt: g.bolt, rain: me.placed && (loc.type || motes) ? rainMap(now) : null, motes,
      // вигляд гравця: положення — інтерпольоване, стан — усе, що читають руки першої особи (VIEW_KEYS у anim.js)
      me: me.placed ? { ...Object.fromEntries(VIEW_KEYS.map((k) => [k, me[k]])), x: ix, y: iy, z: iz, anim, ao: g.world.skyLight(g.d, g.n, ix, iy, iz + 0.5) } : null,
    });
    setText('addr', g.rec.stand ? `Стенд руху · g ${fx(L.grav, 2)} g · тертя ${String(+L.phys.friction.toFixed(2)).replace('.', ',')}${wOver === 'rain' ? ' · дощ' : ''}`
      : `Глибина ${g.d} · всесвіт ${fmtN(g.n)} · ${clockStr(sk.phase)}${L.sky.lock ? ' (вічно)' : ''}`);
    // тяжіння тут: база × аномалія плями (зворотна — окремо) − приплив компаньйона; плин часу плями
    const ph = g.ph, gl = ph ? ph.g : L.grav, tk = me.placed ? timeK(L, me.x, me.y).k : 1;
    const an = (ph && ph.tide && Math.abs(ph.tide) > 0.01 ? ` (приплив ${ph.tide > 0 ? '+' : '−'}${Math.round(Math.abs(ph.tide) * 100)} %)` : '')
      + (ph && ph.rev ? ' · зворотна гравітація' : ph && ph.anom ? ` · аномалія ×${fx(ph.anom)}` : '') + (Math.abs(tk - 1) > 0.05 ? ` · час ×${fx(tk)}` : '');
    setText('coords', `x ${Math.floor(me.x)} · y ${Math.floor(me.y)} · висота ${Math.round(me.z - SEA * LEVEL)} м · гравітація ${fx(gl, 2)} g${an}${me.wet ? ` · у рідині: ${liqStr(L.liquid)}${L.liquid.danger ? ' — небезпечно' : ''}` : ''}`);
    const A = L.air;
    const I = stormAt(L, g.clock), rad = radNow(L, I), Pz = A.vacuum ? 0 : airAt(L, me.z).P;
    setText('env', `${loc.name}${g.temp !== undefined ? ` · ${Math.round(g.temp)} °C` : ''}${W.windK > 0.3 ? ` · вітер ${W.windK.toFixed(0)} м/с${g.lee < 0.5 ? ' (затишок)' : g.me.windPush ? ' (зносить)' : ''}` : ''}`
      + `${!A.vacuum && (Pz < 0.85 || Pz > 1.2) ? ` · тиск ${atm(Pz)} атм` : ''}${A.breath ? '' : ` · повітря ${A.gasName}`}`
      + `${rad > 0.3 ? ` · радіація ${rad > 0.65 ? 'висока' : 'помірна'}` : ''}${I > 0.05 ? ' · буря зорі' : ''}`);
    $('charge').hidden = !ch;
    if (ch) {
      setText('chargeTxt', ch.t < CHARGE ? `Стрибок → ${addrStr(ch.to[0], ch.to[1])}` : 'Стабілізація…');
      $('chargeBar').style.width = (ch.t / CHARGE * 100).toFixed(1) + '%';
    }
    if (toastUntil && now > toastUntil) { $('toast').hidden = true; toastUntil = 0; }
    // хрестик — у першій особі; кільце витривалості — поки лізеш по стіні чи вона не повна (згасає за 1 с)
    $('cross').hidden = !(me.placed && camera.mode === FIRST && $('menu').hidden);
    const stam = me.stam ?? 1, showSt = me.placed && ((me.climb && me.climb.kind === 'wall') || stam < 1);
    const op = showSt ? '1' : '0';
    if (hudCache.stamOp !== op) { hudCache.stamOp = op; $('stam').style.opacity = op; }
    if (showSt) { $('stamArc').setAttribute('stroke-dashoffset', (87.96 * (1 - stam)).toFixed(1)); $('stam').classList.toggle('low', stam < 0.25); }
    if (showDebug && now - (hudCache.dbgT || 0) > 250) { hudCache.dbgT = now; frameStats(); showDebugText(debugText(g, perf, renderer.meshCount, camera, renderer.R, renderer.lodCounts, repro())); }
  }

  // F3 «відтворити»: усе, з чого ?dev eco.restore(…) ставить ту саму сцену 1 в 1 (числа — повні)
  function repro() {
    const me = g.me, R = renderer.R.info, c = $('gl');
    return JSON.stringify({ seed: g.rec.seedText, gen: g.rec.gen, d: g.d, n: g.n, x: me.x, y: me.y, z: me.z, v: [me.vx || 0, me.vy || 0, me.vz || 0], fly: !!me.fly,
      pose: me.pose || 'stand', clock: g.clock, pin: g.pin ?? null, weather: wOver, lamp: !!g.lamp, cam: camera.mode, yaw: camera.yaw, pitch: pitchOf(camera), dist: camera.dist,
      gpu: R ? R.device : cfg.gpu, shadows: R ? R.shadows : cfg.shadows, view: Math.round(VIEW_R / CS), px: [c.width, c.height], dpr: devicePixelRatio,
      // стани з гістерезисом (залежать від історії): назва погоди й з якої миті тримається, пустеля / степ околу, сніг
      hyst: { wk: g.wPrev ? [g.wPrev.kind, g.wPrev.since] : null, desert: !!(clim && clim.desert), arid: !!(clim && clim.arid), snow: !!g.snow } });
  }

  // Панель F3: рядок — окремий блок (довгий переноситься з відступом під значення), блоки перевикористовуються
  function showDebugText(s) {
    const el = $('debug'), lines = s.split('\n');
    while (el.children.length < lines.length) el.appendChild(document.createElement('div'));
    while (el.children.length > lines.length) el.lastChild.remove();
    for (let i = 0; i < lines.length; i++) if (el.children[i].textContent !== lines[i]) el.children[i].textContent = lines[i];
  }

  // Ctrl+Shift+C — увесь текст панелі F3 у буфер обміну (той самий, що на екрані, свіжий), щоб ділитися текстом, а не знімком
  function copyDebug() {
    if (!g) return;
    frameStats();
    const s = debugText(g, perf, renderer.meshCount, camera, renderer.R, renderer.lodCounts, repro());
    const ok = () => toast('F3 скопійовано'), fail = () => toast('Не вдалося скопіювати F3');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(ok, fail);
    else fail();
    return s;
  }
  function toast(s) { $('toast').textContent = s; $('toast').hidden = false; toastUntil = performance.now() + 2800; }

  // ================= Цикл =================
  let last = performance.now(), fpsT = last, fpsN = 0;
  // Наступний кадр — у finally: виняток у кадрі (його видно в консолі) не зупиняє цикл гри. До 12.10.2026 виняток рядка
  // «ціль» F3 зупиняв цикл — гра застигала з захопленою мишею, і здавалося, що зависла вкладка
  function frame(now) {
    try { frameBody(now); } finally { raf(frame); }
  }
  function frameBody(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    frameT[frameI] = now - last; frameI = (frameI + 1) % frameT.length; frameN++;
    last = now;
    if (g) {
      const t0 = performance.now();
      update(dt, now);
      const t1 = performance.now();
      if (g) { if (g.frozen) draw(0, g.frozenAt ??= now); else { g.frozenAt = null; draw(dt, now); } }
      const t2 = performance.now();
      perf.upd = perf.upd * 0.95 + (t1 - t0) * 0.05; perf.drw = perf.drw * 0.95 + (t2 - t1) * 0.05;
      renderer.G.R.upd = t1 - t0; renderer.G.R.drw = t2 - t1;      // покадрово — ?dev sample
      perf.cpu = perf.cpu * 0.95 + (t2 - t0) * 0.05;
    }
    fpsN++;
    if (now - fpsT > 500) { perf.fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; }
  }
  raf(frame);
  showMenu();
  if (QS.has('move')) startWorld({ id: 'stand', name: 'Стенд руху', seedText: 'stand', seed: hashStr('stand'), gen: GEN, created: 0, played: 0, player: { d: 0, n: 0, x: STAND_SPOTS.start[0], y: STAND_SPOTS.start[1], z: 4 }, history: [], stand: true });
}

function showErr(s) { $('err').textContent = s; $('err').hidden = !s; }
function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0].toString(36);
}
