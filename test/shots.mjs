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
const flags = ['--headless=new', '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--window-size=2560,1440'];
rmSync(`${OUT}/profile`, { recursive: true, force: true });
const ch = spawn('google-chrome', [`--remote-debugging-port=${port}`, ...flags, `--user-data-dir=${OUT}/profile`, 'about:blank'], { stdio: 'ignore', detached: true });
// google-chrome — скрипт-обгортка: ch.kill() вбив би лише її, а браузер лишився б на порту (наступний запуск підключився б
// до нього — зі старими модулями в HTTP-кеші й чужим навантаженням GPU). Тому — уся група процесів
const quit = () => { try { process.kill(-ch.pid, 'SIGTERM'); } catch { /* уже завершився */ } };
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
  await ev(`document.getElementById('seed').value = '1hsb1wu'; document.getElementById('create').click(); 1`);
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
