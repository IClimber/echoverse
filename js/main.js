// main.js — запуск: меню світів, ігровий цикл (рух, стрибки, камера, підвантаження чанків), HUD, автозбереження.
// ?strip — замість гри стенд «смуга всесвітів» (js/strip.js), ?flora — галерея видів рослин (js/flora-stand.js),
// ?light — світло й тіні рушія (js/light-stand.js).
import { createRenderer, BODY_R, budgetFor } from './render.js';
import { createWorld, findSpawn, keepFor } from './world.js';
import { createDevice, landing, landingChunks, CHARGE } from './device.js';
import { step, support, windShelter, SPRINT, GRAVITY, FOOT, PLAYER_MASS, HIT_IMPULSE } from './player.js';
import { stepBody, windMoves, push, rayBody, collideBodies } from './engine/physics/bodies.js';
import { initInput, moveAxis, turnAxis, sprintHeld, vertAxis, takeActions, takeWheel, takeDrag, clearInput, lockPointer, unlockPointer, locked } from './input.js';
import { listWorlds, putWorld, deleteWorld, serialize, deserialize, newId } from './save.js';
import { hashStr } from './rng.js';
import { GEN, SEA, physOf, physAt } from './universe.js';
import { CS, SEC, solidB, B_LIQ, B_MAGMA } from './gen/chunk.js';
import { LEVEL } from './iso.js';
import { debugText, fmtN } from './debug.js';
import { animate } from './anim.js';
import { clockStr } from './sky.js';
import { weatherAt, localWeather, areaClimate } from './weather.js';
import { createCamera, rotate, wheel, smooth, moveBasis, clipDist, camDist, facing, setYaw, basis, setViewChunks, setLod, ISO, THIRD, HEAD, VIEW_R } from './camera.js';
import { createStreamer, visibleMissing } from './stream.js';
import { createTicker } from './engine/core/ticker.js';

const $ = (id) => document.getElementById(id);
const SAVE_MS = 10000;                     // автозбереження
const CAM_KEY = 'echoverse-camera';         // вибраний вигляд (на браузер)
const VIEW_KEY = 'echoverse-view';          // дальність, чанків (на браузер)
const PHYS_DT = 1 / 120, AI_DT = 1 / 30;      // такти: фізика (гравець, тіла); світ, моби й NPC
const AI_BUDGET = 2;                          // мс на такт світу: що не встигло — на наступному

const QS = new URLSearchParams(location.search);
if (QS.has('strip')) import('./strip.js').then((m) => m.runStrip());
else if (QS.has('flora')) import('./flora-stand.js').then((m) => m.runFlora());
else if (QS.has('light')) import('./light-stand.js').then((m) => m.runLight()).catch((e) => showErr('Стенд ?light: ' + e.message));
else if (QS.has('pc')) import('./pc/render.js').then((m) => m.createRenderer($('gl'), { gpu: QS.get('gpu') })).then((r) => boot(() => r)).catch((e) => showErr('PlayCanvas не завантажився: ' + e.message));   // ?gpu=webgpu (типово — WebGL2: на еталонній машині швидший)
else boot(createRenderer);

function boot(make) {
  let renderer;
  try { renderer = make($('gl')); }
  catch (e) {
    showErr('Браузер не підтримує WebGL2 — гра не запуститься. ' + e.message);
    $('create').disabled = true;
    return;
  }
  addEventListener('resize', () => renderer.resize());
  const raf = renderer.raf || ((f) => requestAnimationFrame(f));   // ?pc — кадр гри з такту PlayCanvas
  initInput();

  let g = null;                              // поточна гра
  const camera = createCamera(load(CAM_KEY) === ISO ? ISO : THIRD);
  const streamer = createStreamer();
  const physT = createTicker(PHYS_DT), aiT = createTicker(AI_DT, 4);
  // Дальність (8–32 чанки): камера, ліміти пам'яті світу, бюджет GPU, стрімінг
  const setView = (c) => {
    c = setViewChunks(c);
    $('view').value = c;
    $('viewLabel').textContent = `Дальність: ${c} чанків (${c * CS} клітинок)`;
    if (g) g.world.setKeep(keepFor(VIEW_R));
    renderer.setBudget(budgetFor(VIEW_R));
    streamer.force();
    return c;
  };
  setView(+(load(VIEW_KEY) || 16));
  $('view').addEventListener('input', () => store(VIEW_KEY, setView(+$('view').value)));
  let showDebug = false, showHelp = true, toastUntil = 0;
  const perf = { fps: 60, cpu: 0, upd: 0, drw: 0, frameMs: 0, p99: 0 };
  const frameT = new Float32Array(512);      // інтервали між кадрами (мс), кільце — для середнього й p99 у F3
  let frameI = 0, frameN = 0;
  function frameStats() {
    const n = Math.min(frameN, frameT.length), a = frameT.slice(0, n).sort();
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i];
    perf.frameMs = n ? s / n : 0; perf.p99 = n ? a[Math.min(n - 1, Math.floor(n * 0.99))] : 0;
  }
  const hudCache = {};
  const setText = (id, s) => { if (hudCache[id] !== s) { hudCache[id] = s; $(id).textContent = s; } };
  if (QS.has('dev')) window.eco = {                // для автоматичних перевірок у браузері
    get g() { return g; }, camera, renderer,
    stats() {
      frameStats();
      const st = g ? g.world.stats() : {}, R = renderer.R;
      return { fps: perf.fps, frameMs: perf.frameMs, p99: perf.p99, upd: perf.upd, drw: perf.drw, gpuMs: R.gpuMs, draws: R.stats.draws, tris: R.stats.tris,
        gpuMB: (R.stats.gpuBytes + R.stats.arenaBytes) / 1048576, colsPerSec: st.colsPerSec, pending: st.pending, cols: st.cols, secs: st.secs, meshes: renderer.meshCount, lod: [...renderer.lodCounts], workers: st.workers, streamMs: g ? g.streamMs : 0,
        pcMs: R.cpuRenderMs, gpuPass: R.gpuPass, shTris: R.stats.shTris, shDraws: R.stats.shDraws };
    },
    // Скинути кільця замірів (інтервали кадрів, час GPU) — заміри з чистого аркуша
    resetFrames() { frameN = 0; frameI = 0; if (renderer.R.gpuHist) renderer.R.gpuHistI = 0; },
    // ?pc: тіні сонця — 'off' | 'pcss' | 'pcf3' | {властивості світла PlayCanvas}
    shadows(m) { return renderer.setShadows ? renderer.setShadows(m) : null; },
    // Рівні деталізації далекої землі: false — усе повне (порівняння)
    setLod(on) { setLod(on); streamer.force(); },
    // Відсікання задніх граней землі: false — усе з обох боків (порівняння)
    setCull(on) { renderer.R.setCull(on); },
    // Видимого ще бракує (стовпців без зведення й секцій не в GPU) — заміри часу після стрибка
    visMissing() { return g && g.view ? visibleMissing(g, camera, renderer) : -1; },
  };

  // ================= Меню =================
  function showMenu() { unlockPointer(); $('menu').hidden = false; $('resume').hidden = !g; renderWorlds(); }
  // Третя особа: клацання по світу захоплює мишу; браузер відпустив (Esc) — меню, як і на Esc без захоплення
  $('gl').addEventListener('mousedown', (e) => { if (e.button === 0 && g && g.me.placed && camera.mode === THIRD && $('menu').hidden) lockPointer($('gl')); });
  let unlockQuiet = false, unlockedAt = 0;
  document.addEventListener('pointerlockchange', () => {
    if (!locked() && !unlockQuiet && g && $('menu').hidden) { save(); showMenu(); unlockedAt = performance.now(); }
    unlockQuiet = false;
    $('mouseHint').hidden = !(g && camera.mode === THIRD && !locked());
  });
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
        else renderer.addFar(k, data, m);
      }), dev: createDevice(rec.history),
      d: p.d, n: p.n, me: { x: p.x, y: p.y, z: p.z, vz: 0, air: false, ground: true, yaw: Math.PI * 0.75, moving: false, placed: false },
      cam: [p.x, p.y, p.z || 0], lastSave: performance.now(), view: null, clock: rec.clock || 0,
      stamp: 0, ai: [], aiAt: 0,                 // крок фізики (інтерполяція тіл); системи світу (моби, NPC) — (dt, g)
    };
    g.world.setCurrent(g.d, g.n);
    g.world.setKeep(keepFor(VIEW_R));
    streamer.force();
    if (camera.mode === THIRD) setYaw(camera, g.me.yaw + Math.PI);
    putWorld(snapshot());
    hideMenu();
    $('hud').hidden = false; $('loading').hidden = false; $('debug').hidden = !showDebug;
    if (rec.gen !== GEN) toast('Світ створено іншою версією генератора: незмінені місця можуть виглядати інакше');
  }
  async function quitGame(save) {
    if (!g) return;
    if (save) await putWorld(snapshot());
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
  const save = () => { if (g) putWorld(snapshot()); };
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
  const gStr = (L) => L.grav.toFixed(2).replace('.', ',') + ' g';
  const liqStr = (lq) => lq.name + (lq.danger ? ` (${lq.danger})` : '');
  const addrStr = (d, n) => d === g.d ? `всесвіт ${fmtN(n)}` : `глибина ${d}, всесвіт ${fmtN(n)}`;

  // Зайшов у небезпечну рідину — сказати, що це й чим небезпечна (заходити можна: здоров'я ще немає)
  let wasWet = false, wasHot = false;
  function warnLiquid() {
    const lq = g.world.laws(g.d, g.n).liquid, wet = !!g.me.wet, me = g.me;
    if (wet && !wasWet && lq.danger) toast(`${lq.name[0].toUpperCase() + lq.name.slice(1)}: ${lq.danger} — небезпечно`);
    wasWet = wet;
    const hot = me.ground && g.world.block(g.d, g.n, Math.floor(me.x), Math.floor(me.y), Math.floor(me.z / LEVEL + 1e-4) - 1) === B_MAGMA;
    if (hot && !wasHot) toast('Під ногами розпечена лава — небезпечно');
    wasHot = hot;
  }

  // Стрибок пристроєм: вдається завжди (там, де ніде стати, — вільне місце: пливеш чи падаєш)
  function tryJump() {
    const [d, n] = g.dev.charge.to, at = placeIn(d, n, g.me.x, g.me.y, g.me.z);
    if (at === undefined) return;                               // ще генерується — стрибок трохи зачекає
    const P = g.world.laws(g.d, g.n), was = P.grav, L = g.world.laws(d, n), depth = d !== g.d;
    g.dev.done([g.d, g.n]);
    g.prev = [g.d, g.n];
    g.d = d; g.n = n; g.world.setCurrent(d, n); g.me.x = at[0]; g.me.y = at[1]; g.me.z = at[2]; g.me.vz = 0; g.me.vx = 0; g.me.vy = 0; g.me.ground = false; g.me.stepOff = 0; g.me.fly = false;
    const msg = [];
    if (depth) msg.push(`глибина ${d}`);
    if (Math.abs(L.grav - was) >= 0.12) msg.push(`гравітація ${gStr(L)} — ${L.grav < was ? 'легше' : 'важче'}`);
    const lq = L.liquid;
    if (lq.kind !== P.liquid.kind || lq.danger !== P.liquid.danger) msg.push(`у водоймах — ${liqStr(lq)}`);
    if (!L.air.breath && (P.air.breath || L.air.gas !== P.air.gas)) msg.push(`повітря ${L.air.gasName}`);
    if (L.phys.friction < 1 && P.phys.friction === 1) msg.push('ковзкий ґрунт');
    if (L.phys.bounce > 0 && !P.phys.bounce) msg.push('пружний ґрунт');
    if (Math.abs(L.phys.time / P.phys.time - 1) > 0.3) msg.push(`час тече ${L.phys.time > P.phys.time ? 'швидше' : 'повільніше'} (×${L.phys.time.toFixed(1).replace('.', ',')})`);
    if (msg.length) toast(msg.join(' · ').replace(/^./, (c) => c.toUpperCase()));
    $('flash').classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => $('flash').classList.remove('on')));
  }
  // Випадкова адреса (для перевірок): номер — у межах ±100 000, з глибиною — 0…12
  const rnd = (k) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % k; };

  // Тіла біля гравця (ширяюче каміння): крок фізики; гравець, що стоїть на тілі, тисне його вагою й їде разом з ним;
  // тіло, у яке йде гравець, штовхається (легке — відкотиться, важке — ні)
  function simBodies(dt, L, W) {
    const me = g.me, near = g.world.bodiesNear(g.d, g.n, me.x, me.y, 40), ob = me.ground ? me.onBody : null;
    const ox = ob && ob.x, oy = ob && ob.y;
    if (ob) { ob.vz -= PLAYER_MASS * GRAVITY * (g.ph ? g.ph.g : L.grav) * dt / ob.mass; ob.sleep = false; ob.calm = 0; }
    if (me.moving && !me.fly) for (const b of g.world.bodiesNear(g.d, g.n, me.x, me.y, 1.5)) {
      if (b === ob || Math.abs(me.x - b.x) > b.hx + FOOT + 0.08 || Math.abs(me.y - b.y) > b.hy + FOOT + 0.08 || me.z > b.z + b.hz || me.z + 0.98 < b.z - b.hz) continue;
      const dx = b.x - me.x, dy = b.y - me.y, l = Math.hypot(dx, dy) || 1, mv = Math.hypot(me.vx || 0, me.vy || 0);
      if (mv > 0.1 && (dx * me.vx + dy * me.vy) > 0) push(b, [dx / l * PLAYER_MASS * 5 * dt, dy / l * PLAYER_MASS * 5 * dt, 0]);
    }
    const P = g.world.probe(g.d, g.n);
    for (const b of near) { b.px = b.x; b.py = b.y; b.pz = b.z; b.ps = g.stamp; }   // стан до кроку — інтерполяція кадру
    for (const b of near) {
      const ph = physAt(L, b.x, b.y), env = { g: ph.g, vT: ph.vT, bounce: L.phys.bounce, friction: L.phys.friction, wind: W.wind };
      if (b.sleep && !windMoves(b, env)) continue;                // спить і вітер не зрушить — не рахуємо
      const lee = windShelter(P, b.x, b.y, b.z - b.hz, W.wind);
      env.wind = [W.wind[0] * lee, W.wind[1] * lee];
      stepBody(b, dt, P, env);
    }
    collideBodies(near, P, { bounce: L.phys.bounce, friction: L.phys.friction });   // між собою (сплячі — перешкоди)
    if (ob) { me.x += ob.x - ox; me.y += ob.y - oy; me.z = ob.z + ob.hz; }
  }
  // Удар: промінь з грудей уперед (у третій особі — куди дивиться камера, згори — куди обернений гравець)
  function hit(now) {
    const me = g.me;
    me.hitAt = now;
    let d;
    if (camera.mode === THIRD) { const u = basis(camera).u; d = [-u[0], -u[1], -u[2]]; }
    else d = [Math.cos(me.yaw), Math.sin(me.yaw), 0.05];
    const l = Math.hypot(...d); d = d.map((v) => v / l);
    const r = rayBody(g.world.bodiesNear(g.d, g.n, me.x, me.y, 4), me.x, me.y, me.z + 0.65, d, 3);
    if (!r) return;
    push(r.b, [d[0] * HIT_IMPULSE, d[1] * HIT_IMPULSE, (d[2] + 0.25) * HIT_IMPULSE]);
    const dv = HIT_IMPULSE / r.b.mass;
    if (dv < 0.3) toast('Камінь заважкий — ледь зрушив');
  }

  let spaceAt = 0;                           // коли востаннє натиснули пробіл: двічі поспіль — політ
  function update(dt, now) {
    const menuOpen = !$('menu').hidden;
    let jump = false;
    for (const a of takeActions()) {
      if (a === 'menu') {
        if (performance.now() - unlockedAt < 400) continue;            // той самий Esc, що відпустив мишу, — меню вже відкрите
        if (menuOpen) hideMenu(); else { save(); showMenu(); }
      }
      else if (menuOpen || !g.me.placed) continue;
      else if (a === 'debug') { showDebug = !showDebug; $('debug').hidden = !showDebug; }
      else if (a === 'help') { showHelp = !showHelp; $('help').hidden = !showHelp; }
      else if (a === 'jump') {
        if (now - spaceAt < 300) {
          g.me.fly = !g.me.fly; g.me.vz = 0; spaceAt = 0;
          toast(g.me.fly ? 'Політ: пробіл / Shift — угору / униз, пробіл двічі — вимкнути' : 'Політ вимкнено');
        } else { jump = true; spaceAt = now; }
      }
      else if (a === 'camera') {
        camera.mode = camera.mode === ISO ? THIRD : ISO;
        if (camera.mode === THIRD) setYaw(camera, g.me.yaw + Math.PI);        // за спину
        else if (locked()) { unlockQuiet = true; unlockPointer(); }
        store(CAM_KEY, camera.mode);
        toast(camera.mode === ISO ? 'Камера: згори' : 'Камера: третя особа');
        $('mouseHint').hidden = !(camera.mode === THIRD && !locked());
      }
      else if (a === 'jumpPrev' || a === 'jumpNext') { if (g.dev.start([g.d, g.n + (a === 'jumpNext' ? 1 : -1)], a) === 'cancel') toast('Стрибок скасовано'); }
      else if (a === 'hit') { if (camera.mode === ISO || locked()) hit(now); }   // у третій особі перше клацання — захоплення миші
      else if (a === 'jumpRandom' || a === 'jumpRandomDepth') {
        const to = [a === 'jumpRandomDepth' ? (g.d + 1 + rnd(12)) % 13 : g.d, rnd(200001) - 100000];
        if (g.dev.start(to, a) === 'cancel') toast('Стрибок скасовано');
      }
    }
    if (!$('menu').hidden) return;                              // меню — пауза
    g.clock += dt;                                              // годинник світу (доба кожного всесвіту — своя)
    const w = takeWheel(), [mx, my] = takeDrag(), turn = turnAxis();
    if (w) wheel(camera, w);
    if (mx || my || turn) rotate(camera, mx + turn * dt * 260, my);
    smooth(camera, dt);
    const me = g.me;
    if (!me.placed) {
      const at = placeIn(g.d, g.n, me.x, me.y, me.z);
      if (at !== undefined) {
        me.x = at[0]; me.y = at[1]; me.z = at[2];
        me.ground = false; me.stepOff = 0; me.vis = me.z; me.px = me.x; me.py = me.y; me.pv = me.z;
        g.cam = [me.x, me.y, me.z]; me.placed = true;
        $('loading').hidden = true;
        $('mouseHint').hidden = camera.mode !== THIRD || locked();
      }
    } else {
      // фізика — фіксованим тактом PHYS_DT (стан до кроку — для інтерполяції кадру); пробіл — «защіпка» до кроку
      const [ix, iy] = moveAxis();
      const sprint = sprintHeld();
      g.jumpLatch = g.jumpLatch || jump;
      for (let s = physT.advance(dt); s > 0; s--) {
        const L = g.world.laws(g.d, g.n), W = weatherAt(L, g.clock);   // вітер — сила опору (густина повітря — у vT)
        me.px = me.x; me.py = me.y; me.pv = me.vis ?? me.z; g.stamp++;
        g.ph = physAt(L, me.x, me.y);
        const probe = g.world.probe(g.d, g.n);
        g.lee = windShelter(probe, me.x, me.y, me.z, W.wind);       // затишок: стіна, дерево чи камінь з навітряного боку, печера
        step(me, ix, iy, g.jumpLatch, PHYS_DT, probe, g.ph, moveBasis(camera), { sprint, vert: vertAxis(), wind: [W.wind[0] * g.lee, W.wind[1] * g.lee] });
        g.jumpLatch = false;
        me.run = sprint && me.moving && !me.fly;
        if (camera.mode === THIRD) me.yaw = facing(camera);                 // спиною до камери; S — задкує
        simBodies(PHYS_DT, L, W);
        warnLiquid();
        if (g.dev.update(PHYS_DT)) { tryJump(); me.px = me.x; me.py = me.y; me.pv = me.vis ?? me.z; }   // стрибок — без «шлейфу»
        if (!me.placed) break;
      }
      if (camera.mode === THIRD) me.yaw = facing(camera);                   // і в кадрі без кроку фізики (камера — щокадру)
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
    me.ix = lerp(me.px, me.x); me.iy = lerp(me.py, me.y); me.iv = lerp(me.pv, me.vis ?? me.z);
    // Ціль камери: гравець (у третій особі — його голова); плавно, по висоті — повільніше (стрибок не трусить камеру)
    const k = Math.min(1, dt * (camera.mode === ISO ? 8 : 14)), kz = Math.min(1, dt * 5);
    let tz = (me.iv ?? me.z ?? 0) + (camera.mode === THIRD ? HEAD : 0), capped = false;
    const solidAt = (x, y, z) => { const b = g.world.block(g.d, g.n, x, y, Math.floor(z / LEVEL)); return b === B_LIQ || solidB(b); };
    if (camera.mode === THIRD && me.placed) {                 // низька стеля (печера): ціль — під нею, інакше видно крізь блоки
      const fx = Math.floor(me.x), fy = Math.floor(me.y), base = me.iv ?? me.z;
      for (let z = me.z + 0.6; z <= me.z + HEAD + 0.35; z += LEVEL) if (solidAt(fx, fy, z)) { tz = Math.min(tz, Math.floor(z / LEVEL) * LEVEL - me.z + base - 0.28); capped = true; break; }
    }
    g.cam[0] += ((me.ix ?? me.x) - g.cam[0]) * k; g.cam[1] += ((me.iy ?? me.y) - g.cam[1]) * k;
    g.cam[2] += (tz - g.cam[2]) * kz;
    if (capped && tz < g.cam[2]) g.cam[2] = tz;               // під стелю — одразу
    g.camDist = camera.mode === THIRD ? camDist(g.camDist, clipDist(camera, g.cam, solidAt), dt) : camera.dist;
    const dist = g.camDist;
    g.view = renderer.view(camera, g.cam, dist);
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
    renderer.R.setRainMap(rainBuf);
    return (g.rain = { x0, y0, d: g.d, n: g.n, at: now });
  }

  // Клімат місця для погоди (сніг, пустеля, пил) — за околом з гістерезисом (areaClimate)
  let clim = null;

  function draw(dt, now) {
    const ch = g.dev.charge, me = g.me, L = g.world.laws(g.d, g.n);
    const W = weatherAt(L, g.clock);
    if (me.placed) clim = areaClimate(L, me.x, me.y, clim);
    const C = me.placed && clim;
    const loc = localWeather(L, W, !!C && C.cold, !!C && C.desert, !!C && C.arid);
    const a = ch ? ch.t / CHARGE * (0.35 + 0.35 * Math.sin(now / 45)) : 0;
    const under = me.placed ? support(g.world.probe(g.d, g.n), me.x, me.y, me.z + 0.01) : null;
    const anim = animate(me, dt, now, physOf(L).speed * (me.run ? SPRINT * 0.85 : 1));
    if (!g.view) return;
    renderer.pump();
    // тіла: між двома останніми кроками фізики (ті, що цього кроку не рахувались, — де є)
    const bodies = g.world.bodiesNear(g.d, g.n, g.cam[0], g.cam[1], BODY_R), al = physT.alpha;
    for (const b of bodies) {
      const k = b.ps === g.stamp ? al : 1;
      b.ix = b.ps === undefined ? b.x : b.px + (b.x - b.px) * k; b.iy = b.ps === undefined ? b.y : b.py + (b.y - b.py) * k; b.iz = b.ps === undefined ? b.z : b.pz + (b.z - b.pz) * k;
    }
    const sk = renderer.draw({
      camera, target: g.cam, view: g.view, laws: L, far: g.far, clock: g.clock, bodies, weather: { W: loc.W, loc }, rain: me.placed && loc.type ? rainMap(now) : null,
      me: me.placed ? { x: me.ix ?? me.x, y: me.iy ?? me.y, z: me.iv ?? me.vis ?? me.z, gz: under ? under.z : me.z, yaw: me.yaw, swim: me.swim, fly: me.fly, tint: [1 + a * 0.4, 1 + a, 1 + a * 1.3], anim } : null,
    });
    setText('addr', `Глибина ${g.d} · всесвіт ${fmtN(g.n)} · ${clockStr(sk.phase)}${L.sky.lock ? ' (вічно)' : ''}`);
    const an = g.ph && g.ph.anom ? ` · аномалія ×${g.ph.anom.toFixed(1).replace('.', ',')}` : '';
    setText('coords', `x ${Math.floor(me.x)} · y ${Math.floor(me.y)} · висота ${Math.floor(me.z / LEVEL) - SEA} · гравітація ${gStr(L)}${an}${me.wet ? ` · у рідині: ${liqStr(L.liquid)}${L.liquid.danger ? ' — небезпечно' : ''}` : ''}`);
    const A = L.air;
    setText('env', `${loc.name}${W.windK > 0.3 ? ` · вітер ${(W.windK * 1.8).toFixed(0)} м/с${g.lee < 0.5 ? ' (затишок)' : g.me.windPush ? ' (зносить)' : ''}` : ''}${A.breath ? '' : ` · повітря ${A.gasName}`}${A.rad > 0.3 ? ` · радіація ${A.rad > 0.65 ? 'висока' : 'помірна'}` : ''}`);
    $('charge').hidden = !ch;
    if (ch) {
      setText('chargeTxt', ch.t < CHARGE ? `Стрибок → ${addrStr(ch.to[0], ch.to[1])}` : 'Стабілізація…');
      $('chargeBar').style.width = (ch.t / CHARGE * 100).toFixed(1) + '%';
    }
    if (toastUntil && now > toastUntil) { $('toast').hidden = true; toastUntil = 0; }
    if (showDebug && now - (hudCache.dbgT || 0) > 250) { hudCache.dbgT = now; frameStats(); $('debug').textContent = debugText(g, perf, renderer.meshCount, camera, renderer.R, renderer.lodCounts); }
  }

  function toast(s) { $('toast').textContent = s; $('toast').hidden = false; toastUntil = performance.now() + 2800; }

  // ================= Цикл =================
  let last = performance.now(), fpsT = last, fpsN = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    frameT[frameI] = now - last; frameI = (frameI + 1) % frameT.length; frameN++;
    last = now;
    if (g) {
      const t0 = performance.now();
      update(dt, now);
      const t1 = performance.now();
      if (g) draw(dt, now);
      const t2 = performance.now();
      perf.upd = perf.upd * 0.95 + (t1 - t0) * 0.05; perf.drw = perf.drw * 0.95 + (t2 - t1) * 0.05;
      perf.cpu = perf.cpu * 0.95 + (t2 - t0) * 0.05;
    }
    fpsN++;
    if (now - fpsT > 500) { perf.fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; }
    raf(frame);
  }
  raf(frame);
  showMenu();
}

function showErr(s) { $('err').textContent = s; $('err').hidden = !s; }
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
function store(k, v) { try { localStorage.setItem(k, v); } catch { /* приватне вікно: не пам'ятаємо */ } }
function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0].toString(36);
}
