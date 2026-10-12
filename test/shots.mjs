// test/shots.mjs — знімки сцен гри й стенда ?light, помилки консолі; headless Chrome через CDP (не в npm test).
// Сервер: python3 serve.py (порт 8123). node test/shots.mjs [--combos=webgl2:pcf3:16,…] [--scenes=plain,mount,…] [--mscenes=mcrouch,…|none] [--out=ТЕКА]
import { spawn } from 'node:child_process'; import { mkdirSync, rmSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os';
const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const port = 9337;
const OUT = arg('out', `${tmpdir()}/echoverse-shots`); mkdirSync(OUT, { recursive: true });
// поєднання налаштувань (графіка : тіні : дальність): кожне має запуститися без помилок
const COMBOS = arg('combos', 'webgl2:pcf3:16,webgl2:pcss:16,webgl2:off:16,webgpu:pcf3:16').split(',').map((s) => s.split(':'));
// сцена: [всесвіт, x, y, фаза доби ('best' — найбільше світил), особливе]. Порядок важливий: сцени того самого всесвіту
// й місця — підряд без телепорту; печера — остання з них (переносить гравця під землю), далі — стрибок в інший всесвіт
// особливе: rain — дощ, iso — згори, first — перша особа, grass / grass3 — трава впритул (перша / третя особа), coll — каркас зіткнень (?dev showColl), cave — печера (перша особа:
// firstcave)
const ALL = { plain: [1, -52, -45, 0.4], night: [1, -52, -45, 0.0], rain: [1, -52, -45, 0.4, 'rain'], iso: [1, -52, -45, 0.4, 'iso'],
  first: [1, -52, -45, 0.4, 'first'], under: [1, -52, -45, 0.4, 'under'], slope: [33281, -61, -2, 0.4, 'slope'], trunk: [-60813, -478, -107, 0.4, 'trunk'], coll: [1, -52, -45, 0.4, 'coll'], grass: [1, -52, -45, 0.4, 'grass'], grass3: [1, -52, -45, 0.4, 'grass3'], cave: [1, -52, -45, 0.4, 'cave'], firstcave: [1, -52, -45, 0.4, 'firstcave'], fgrass: [-60813, -478, -107, 0.4, 'grass'], mount: [33281, -61, -2, 0.4], forest: [-60813, -478, -107, 0.4], suns3: [784, -52, -45, 'best'] };
const SCENES = arg('scenes', Object.keys(ALL).join(',')).split(',').filter((k) => ALL[k]);   // --scenes=none — лише стенд
// Стенд руху ?move (gen/stand.js): сцена — дії через ?dev (eco.spot — місце, eco.key — клавіші, eco.look — камера)
const K = (c, d = true) => `eco.key('${c}', ${d});`;
const MOVE = {
  mcrouch: ["eco.setCam('third'); eco.spot('start');", K('ControlLeft'), 600, 'eco.look(-0.9, 0.25, 4);', 600, 'shot', K('ControlLeft', false)],
  mcrawl: ["eco.setCam('third'); eco.spot('A3');", K('ControlLeft') + K('KeyW'), 2500, K('KeyW', false) + 'eco.g.me.x = 20.3;', 300, 'eco.look(Math.PI + 0.5, 0.15, 3);', 700, 'shot'],
  mcrawl1: ["eco.setCam('first'); eco.g.me.x = 17;", 300, 'eco.look(0, 0.1);', 500, 'shot', "eco.setCam('third');" + K('ControlLeft', false)],
  mclimb: ["eco.setCam('third'); eco.spot('B2');", K('KeyW'), 300, K('Space'), 120, K('Space', false), 1200, K('KeyW', false) + 'eco.look(-0.9, 0, 5);', 600, 'shot'],
  mladder: ["eco.setCam('third'); eco.spot('B5');", K('KeyW'), 1200, K('KeyW', false) + 'eco.look(-1.0, 0, 5);', 600, 'shot'],
  mslide: ["eco.setCam('third'); eco.spot('C6'); eco.look(Math.PI - 1.0, 0.25, 6);", 600, 'eco.g.me.x = 58.5; eco.g.me.z = 9; eco.g.me.vz = 0;', 500, 'shot'],
  mdive: ["eco.setCam('third'); eco.spot('D');", 800, K('ControlLeft'), 1200, K('ControlLeft', false) + "eco.setCam('first'); eco.look(0, 0.1);", 400, 'shot'],
  maimb: ["eco.setCam('first'); eco.spot('A1'); eco.look(0, 0.6);", 800, 'shot'],
  maimo: ["eco.setCam('first'); eco.spot('E'); eco.g.me.x = 76.2; eco.g.me.y = 32.2;", 400, 'eco.look(Math.atan2(30.5 - 32.2, 78.5 - 76.2), 0.1);', 1200, 'shot'],
  maimbody: ["eco.setCam('third'); eco.spot('bodies'); eco.look(0, 0.45, 5);", 1000, 'shot'],
  mcarry: ["eco.setCam('third'); eco.spot('bodies'); eco.look(0, 0.45, 5);", 800, K('KeyF'), 50, K('KeyF', false), 800, 'eco.look(-1.4, 0.3, 4);', 800, 'shot', K('KeyF'), 50, K('KeyF', false)],
  miso: ["eco.setCam('iso'); eco.spot('E'); eco.look(120 * Math.PI / 180);", 800, 'mouse', 600, 'shot', "eco.setCam('third');"],
};
const MSCENES = arg('mscenes', Object.keys(MOVE).join(',')).split(',').filter((k) => MOVE[k]);
// Закони фізики світу (п. 4): [глибина, умова на закони (eco.findLaw; null — поточний всесвіт), фаза доби, куди дивитись
// ('sun' — на головне сонце, 'comp' — на компаньйон, 'sky' — угору, 'land' — уздовж землі, 'bolt' — на блискавку),
// підготовка (JS у сторінці після стрибка; повертає false — сцену пропущено)]
const LAW = {
  redstar: [0, 'L => L.star.T < 3300 && !L.sky.lock && !L.air.vacuum && L.air.pressure > 0.5 && L.air.pressure < 3', 0.42, 'sun'],
  bluestar: [0, 'L => L.star.T > 8500 && !L.air.vacuum && L.air.pressure > 0.5', 0.42, 'sun'],
  dust: [0, 'L => L.air.hazeKind === 3 && L.air.tauA > 0.3 && !L.sky.lock', 'dusk', 'sun'],
  thick: [0, 'L => L.air.pressure > 4 && !L.sky.lock', 0.45, 'sky'],
  sulfur: [2, 'L => L.air.comp.SO2 > 0 && !L.sky.lock', 0.45, 'sky'],
  thin: [0, 'L => L.air.pressure < 0.2 && !L.air.vacuum && !L.sky.lock', 0.45, 'sky'],
  vacuum: [2, 'L => L.air.vacuum && !L.sky.lock', 0.45, 'sky'],
  companion: [0, 'L => L.comp && L.comp.f > 0.04 && !L.sky.lock', 'comp', 'comp', "eco.weather('clear')"],
  eclipse: [0, 'L => L.sky.moons.length > 0 && !L.sky.lock && !L.air.vacuum', null, 'sun', 'eco.eclipse(0.7) !== null'],
  aurora: [0, 'L => L.mag.k > 0.6 && L.planet.lat > 62 && L.planet.lat < 75 && !L.air.vacuum && !L.sky.lock', 0.0, 'aur', "eco.weather('clear')"],
  starstorm: [0, 'L => L.star.cls === 0 && L.mag.k > 0.3 && L.planet.lat > 35 && L.planet.lat < 50 && !L.air.vacuum && !L.sky.lock', 0.0, 'aur', "eco.weather('clear') && eco.starStorm(1) > 0"],
  storm: [0, null, 0.5, 'bolt', "eco.weather('rain') && !!eco.lightning()"],
  meteors: [0, null, 0.0, 'sky', "eco.weather('clear') && meteor()"],
  winter: [0, 'L => L.planet.obliq > 30 && L.planet.lat > 45 && !L.planet.lock && L.air.pressure > 0.5', 0.5, 'land', 'eco.setYear(0.75)'],
  summer: [0, null, 0.5, 'land', 'eco.setYear(0.25)'],
  polar: [0, 'L => L.planet.lat > 72 && !L.planet.lock && L.air.pressure > 0.5', 0.5, 'land'],
  reverse: [10, 'L => !!L.anom.rev && L.anom.freq > 0.3 && L.anom.rev.k0 < -0.3 && !L.air.vacuum', 0.45, 'land', "!!eco.findAnom('rev')"],
  tanom: [8, 'L => !!L.tanom && !L.air.vacuum', 0.45, 'land', "!!eco.findAnom('time')"],
};
const LSCENES = arg('lscenes', Object.keys(LAW).join(',')).split(',').filter((k) => LAW[k]);
const flags = ['--headless=new', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--window-size=2560,1440'];
rmSync(`${OUT}/profile`, { recursive: true, force: true });
const ch = spawn('google-chrome', [`--remote-debugging-port=${port}`, ...flags, `--user-data-dir=${OUT}/profile`, 'about:blank'], { stdio: 'ignore', detached: true });
// google-chrome — скрипт-обгортка: ch.kill() вбив би лише її, а браузер лишився б на порту (наступний запуск підключився б
// до нього — зі старими модулями в HTTP-кеші й чужим навантаженням GPU). Тому — уся група процесів
const quit = () => { try { process.kill(-ch.pid, 'SIGTERM'); } catch { /* уже завершився */ } };
// за будь-якого виходу (і з винятком) — закрити браузер: інакше він лишається рендерити гру з сервера 8123 і їсть GPU
// (12.10.2026: після невдалого старту висів, 36 % GPU — у користувача падали к/с і висла сторінка гри)
process.on('exit', quit);
process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(2000);
const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl), pend = new Map(), errs = []; let id = 0;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push('ВИНЯТОК ' + String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning') && errs.length < 60) errs.push(m.params.type + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400));
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) errs.push('EVAL ' + String(r.exceptionDetails.exception?.description).slice(0, 300)); return r.result?.value; };
const waitFor = async (expr, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return; await wait(100); } throw new Error('не дочекались: ' + expr); };
const idle = async () => { for (;;) { if ((await ev('eco.stats().pending')) === 0) return; await wait(50); } };
const shot = async (name) => writeFileSync(`${OUT}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const menu = (open) => ev(`(() => { const m = document.getElementById('menu'); m.hidden = !${open}; m.style.visibility = ${open} ? 'hidden' : ''; return 1; })()`);
let last = null;                                  // попередня сцена: те саме місце — без телепорту (приземлення вже знайшло ґрунт)
const jumpTo = async (n, x, y) => {
  if (last && last[0] === n && last[1] === x && last[2] === y) { await idle(); return; }
  last = [n, x, y];
  await ev(`(() => { const g = eco.g; g.me.x = ${x}; g.me.y = ${y}; g.cam[0] = ${x}; g.cam[1] = ${y}; return 1; })()`);
  await idle(); await wait(500);
  if ((await ev('eco.g.n')) !== n) { await ev(`eco.g.dev.start([0, ${n}], 'jumpNext'); 1`); while ((await ev('eco.g.n')) !== n) await wait(10); }
  while ((await ev('eco.visMissing()')) !== 0) await wait(20);
  await idle();
};
const R = [];
for (const [gpu, sh, view] of COMBOS) {
  last = null;                                    // кожне поєднання — новий світ
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:8123/?dev' }); await wait(1500);
  await ev(`localStorage.setItem('echoverse-gpu', '${gpu}'); localStorage.setItem('echoverse-shadows', '${sh}'); localStorage.setItem('echoverse-view', '${view}'); localStorage.setItem('echoverse-camera', 'third'); 1`);
  await send('Page.reload'); await waitFor('!!window.eco');
  // меню з'являється раніше, ніж сцена готова (WebGPU — асинхронно): натискаємо, доки світ не створиться
  for (let i = 0; i < 60 && !(await ev('!!(window.eco && eco.g)')); i++) { await ev(`document.getElementById('seed').value = '1hsb1wu'; document.getElementById('create').click(); 1`); await wait(1000); }
  await waitFor('!!(eco.g && eco.g.me.placed)'); await idle();
  for (const sc of SCENES) {
    const [n, x, y, ph, sp] = ALL[sc];
    const mode = sp === 'iso' ? 'iso' : ['first', 'firstcave', 'under', 'grass'].includes(sp) ? 'first' : 'third', cave = sp === 'cave' || sp === 'firstcave';
    await ev(`eco.setCam('${mode}'); eco.showColl(${sp === 'coll'}); eco.weather(${sp === 'rain' ? "'rain'" : 'null'}); 1`);
    await jumpTo(n, x, y);
    if (cave && last[3] !== 'cave') {             // печерні секції підвантажуються не одразу — кілька спроб
      let ok = null;
      for (let i = 0; i < 20 && !ok; i++) { ok = await ev('eco.findCave()'); if (!ok) await wait(250); }
      if (!ok) { R.push({ gpu, sh, view, sc, skip: 'печеру не знайдено' }); continue; }
    }
    if (cave) { last[3] = 'cave'; await idle(); while ((await ev('eco.visMissing()')) !== 0) await wait(20); }
    if (sp === 'under') {                         // водойма ≥ 3 одиниць: око на 1,5 під поверхнею, погляд трохи вгору (політ — не тоне)
      const w = await ev('eco.findLiquid(12)');
      if (!w) { R.push({ gpu, sh, view, sc, skip: 'водойми не знайдено' }); continue; }
      await ev(`(() => { const me = eco.g.me; me.x = ${w[0]}; me.y = ${w[1]}; me.z = ${w[2]} - 1.5 - 0.92; me.fly = true; me.vz = 0; eco.look(0.6, -0.35); return 1; })()`);
      last = null; await idle(); await wait(500);
    }
    if (sp === 'slope') {                         // третя особа, камера — з боку, де земля вища (схил за спиною)
      await ev(`(() => { const g = eco.g, me = g.me; let best = 0, bh = -1e9; for (let a = 0; a < 6.28; a += 0.2) { const h = g.world.topAt(g.d, g.n, Math.floor(me.x + Math.cos(a) * 3), Math.floor(me.y + Math.sin(a) * 3)); if (h !== null && h > bh) { bh = h; best = a; } } eco.look(best + Math.PI, 0.25); return best; })()`);
      await wait(800);
    }
    if (sp === 'trunk') {                         // третя особа: найближчий стовбур — за спиною, гравець за 1,2 від нього
      const ok = await ev(`(() => { const g = eco.g, me = g.me; let o = null, bd = 1e9; for (let dy = -20; dy <= 20; dy++) for (let dx = -20; dx <= 20; dx++) { const q = g.world.obst(g.d, g.n, Math.floor(me.x) + dx, Math.floor(me.y) + dy); if (q && typeof q === 'object' && q.r > 0.12 && q.z1 - q.z0 > 2) { const d = Math.hypot(dx, dy); if (d < bd) { bd = d; o = q; } } } if (!o) return false; const a = 0.7; me.x = o.cx + Math.cos(a) * (o.r + 1.4); me.y = o.cy + Math.sin(a) * (o.r + 1.4); me.z = o.z0 + 0.5; me.vz = 0; eco.look(a, 0.15); return true; })()`);
      if (!ok) { R.push({ gpu, sh, view, sc, skip: 'стовбура не знайдено' }); continue; }
      last = null; await idle(); await wait(1200);
    }
    if (sp === 'grass') { await ev('eco.look(0.8, 0.5); 1'); await wait(800); }            // впритул до трави: униз ~30°
    if (sp === 'grass3') { await ev('eco.look(0.8, 0.3, 2.5); 1'); await wait(800); }      // третя особа, найближче
    await ev(ph === 'best' ? 'eco.bestPhase()' : `eco.setPhase(${ph})`);
    await menu(true); await wait(1500);
    if (gpu !== 'webgpu') await shot(`${gpu}-${sh}-${view}-${sc}`);   // WebGPU у headless знімає чорне — лише помилки
    await menu(false);
    R.push({ gpu, sh, view, sc, device: await ev('eco.stats().device') });
  }
  // закони фізики світу: стрибок у всесвіт за умовою, фаза доби, погляд; заміри кадру й GPU
  for (const sc of LSCENES) {
    const [d, pred, ph, look, prep] = LAW[sc];
    await ev(`eco.weather(null); eco.starStorm(null); eco.setCam('third'); 1`);
    if (pred) {
      const n = await ev(`eco.findLaw(${pred}, { d: ${d}, from: 100, count: 60000 })`);
      if (n === null) { R.push({ gpu, sh, view, sc, skip: 'всесвіту не знайдено' }); continue; }
      await waitFor(`eco.g.d === ${d} && eco.g.n === ${n} && !eco.g.dev.charge && eco.g.me.placed`, 60000);
      last = null;
    }
    if (ph === 'comp') await ev(`(async () => { const S = await import('./js/sky.js'), g = eco.g, L = g.world.laws(g.d, g.n), day = L.sky.dayMin * 60 / L.phys.time;
      for (let c = g.clock; c < g.clock + day * 40; c += day / 200) { const s = S.skyState(L, c), m = s.moons.find((o) => o.comp); if (m && m.dir[2] > 0.35 && s.day < 0.3) { g.clock = c; return true; } } return false; })()`);
    else if (ph === 'dusk') await ev(`(async () => { const S = await import('./js/sky.js'), g = eco.g, L = g.world.laws(g.d, g.n), day = L.sky.dayMin * 60 / L.phys.time;
      for (let c = g.clock; c < g.clock + day * 2; c += day / 2000) { const a = S.skyState(L, c).suns[0].dir[2], b = S.skyState(L, c + day / 2000).suns[0].dir[2]; if (a > 0.05 && a < 0.09 && b < a) { g.clock = c; return true; } } return false; })()`);
    else if (ph !== null) await ev(`eco.setPhase(${ph})`);
    if (prep && !(await ev(`(async () => { const meteor = async () => { const W = await import('./js/weather.js'), g = eco.g, L = g.world.laws(g.d, g.n); for (let c = g.clock; c < g.clock + 3600 * 6; c += 0.5) if (W.meteorsAt(L, c, 1).length) { g.clock = c; return true; } return false; }; return ${prep}; })()`))) { R.push({ gpu, sh, view, sc, skip: 'не підготувалось' }); continue; }
    if (prep && prep.includes('findAnom')) { await wait(3000); await ev('eco.g.me.fly = false; 1'); for (let i = 0; i < 300 && !(await ev('eco.g.me.ground || eco.g.me.hover')); i++) await wait(50); await wait(500); }
    await idle(); for (let i = 0; i < 300 && (await ev('eco.visMissing()')) !== 0; i++) await wait(50);
    // небо — з висоти 60 м над місцем (пагорби й дерева не закривають), гравець висить у польоті
    if (look !== 'land' && look !== 'bolt') { await ev('(() => { const me = eco.g.me; me.fly = true; me.z += 60; me.vz = 0; me.vis = me.pv = me.z; eco.g.cam[2] = me.z; return 1; })()'); last = null; await wait(800); }
    if (look === 'land') await ev('eco.look(0.8, 0.2, 9); 1');
    else if (look === 'sky') await ev('eco.look(0.8, -0.9, 9); 1');
    else await ev(`(async () => { const S = await import('./js/sky.js'), g = eco.g, L = g.world.laws(g.d, g.n), s = S.skyState(L, g.clock);
      const v = ${look === 'bolt' ? '[g.boltForce.x - g.cam[0], g.boltForce.y - g.cam[1], 60]' : look === 'comp' ? 's.moons.find((o) => o.comp).dir' : look === 'aur' ? '[s.aurora.dir[0], s.aurora.dir[1], 0.45]' : 's.suns[0].dir'}, l = Math.hypot(...v);
      eco.look(Math.atan2(v[1], v[0]), -Math.min(1.2, Math.asin(v[2] / l)), 9); return 1; })()`);
    if (look !== 'bolt') await wait(2500);
    if (sc === 'meteors') await ev(`(async () => { const W = await import('./js/weather.js'), g = eco.g, L = g.world.laws(g.d, g.n); for (let c = g.clock; c < g.clock + 3600 * 6; c += 0.25) { const m = W.meteorsAt(L, c, 1); if (m.length) { const a = m[0].a; g.clock = c + 0.25; eco.look(Math.atan2(a[1], a[0]), -Math.min(1.2, Math.asin(a[2])), 9); return true; } } return false; })()`);
    await menu(true); await wait(look === 'bolt' ? 300 : 1500);
    if (gpu !== 'webgpu') await shot(`${gpu}-${sh}-${view}-${sc}`);
    const st = await ev('eco.stats()');
    await menu(false); await ev('eco.weather(null); eco.starStorm(null); 1');
    R.push({ gpu, sh, view, sc, device: `${st.device} · ${await ev("document.getElementById('env').textContent")} · ${await ev("document.getElementById('coords').textContent")}` });
  }
  // стенд руху ?move: ті самі налаштування, свої сцени; ціль — без меню (з відкритим меню цілі немає)
  if (!MSCENES.length) continue;
  await send('Page.navigate', { url: 'http://localhost:8123/?move&dev' }); await waitFor('!!(window.eco && eco.g && eco.g.me.placed)'); await idle();
  await menu(false); await ev("document.getElementById('help').hidden = true; 1");
  for (const sc of MSCENES) {
    for (const a of MOVE[sc]) {
      if (typeof a === 'number') await wait(a);
      else if (a === 'shot') { if (gpu !== 'webgpu') await shot(`${gpu}-${sh}-${view}-${sc}`); R.push({ gpu, sh, view, sc, device: await ev('eco.stats().device') + ' · ' + JSON.stringify(await ev('eco.pose()')) + ' · ціль ' + JSON.stringify(await ev('(() => { const a = eco.aim(); return a && [a.kind, a.mass ?? a.b ?? a.form]; })()')) }); }
      else if (a === 'mouse') await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1280 + 260, y: 720 + 60 });
      else { await ev(`(() => { ${a} return 1; })()`); if (a.includes('eco.spot')) await idle(); }
    }
  }
}
// стенд ?light (сам ставить window.eco = { ready: true } після першого кадру)
await send('Page.navigate', { url: 'http://localhost:8123/?light&dev' }); await waitFor('!!(window.eco && eco.ready)'); await wait(2000);
await shot('light');
writeFileSync(`${OUT}/results.json`, JSON.stringify({ R, errs }, null, 1));
for (const r of R) console.log([r.gpu, r.sh, r.view, r.sc, r.skip || `пристрій ${r.device}`].join(' '));
console.log(`помилок: ${errs.length}`); for (const e of errs) console.log(e);
quit(); process.exit(errs.length ? 1 : 0);
