// test/shots.mjs — знімки сцен гри й стенда ?light, помилки консолі; headless Chrome через CDP (не в npm test).
// Сервер: python3 serve.py (порт 8123). node test/shots.mjs [--combos=webgl2:pcf3:16,…] [--scenes=plain,mount,…] [--out=ТЕКА]
import { spawn } from 'node:child_process'; import { mkdirSync, rmSync, writeFileSync } from 'node:fs'; import { tmpdir } from 'node:os';
const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const port = 9337;
const OUT = arg('out', `${tmpdir()}/echoverse-shots`); mkdirSync(OUT, { recursive: true });
// поєднання налаштувань (графіка : тіні : дальність): кожне має запуститися без помилок
const COMBOS = arg('combos', 'webgl2:pcf3:16,webgl2:pcss:16,webgl2:off:16,webgpu:pcf3:16').split(',').map((s) => s.split(':'));
// сцена: [всесвіт, x, y, фаза доби ('best' — найбільше світил), особливе]. Порядок важливий: сцени того самого всесвіту
// й місця — підряд без телепорту; печера — остання з них (переносить гравця під землю), далі — стрибок в інший всесвіт
// особливе: rain — дощ, iso — згори, first — перша особа, coll — каркас зіткнень (?dev showColl), cave — печера (перша особа:
// firstcave)
const ALL = { plain: [1, -52, -45, 0.4], night: [1, -52, -45, 0.0], rain: [1, -52, -45, 0.4, 'rain'], iso: [1, -52, -45, 0.4, 'iso'],
  first: [1, -52, -45, 0.4, 'first'], coll: [1, -52, -45, 0.4, 'coll'], cave: [1, -52, -45, 0.4, 'cave'], firstcave: [1, -52, -45, 0.4, 'firstcave'], mount: [33281, -61, -2, 0.4], forest: [-60813, -478, -107, 0.4], suns3: [784, -52, -45, 'best'] };
const SCENES = arg('scenes', Object.keys(ALL).join(',')).split(',');
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
    const mode = sp === 'iso' ? 'iso' : sp === 'first' || sp === 'firstcave' ? 'first' : 'third', cave = sp === 'cave' || sp === 'firstcave';
    await ev(`eco.setCam('${mode}'); eco.showColl(${sp === 'coll'}); eco.weather(${sp === 'rain' ? "'rain'" : 'null'}); 1`);
    await jumpTo(n, x, y);
    if (cave && last[3] !== 'cave' && !(await ev('eco.findCave()'))) { R.push({ gpu, sh, view, sc, skip: 'печеру не знайдено' }); continue; }
    if (cave) { last[3] = 'cave'; await idle(); while ((await ev('eco.visMissing()')) !== 0) await wait(20); }
    await ev(ph === 'best' ? 'eco.bestPhase()' : `eco.setPhase(${ph})`);
    await menu(true); await wait(1500);
    if (gpu !== 'webgpu') await shot(`${gpu}-${sh}-${view}-${sc}`);   // WebGPU у headless знімає чорне — лише помилки
    await menu(false);
    R.push({ gpu, sh, view, sc, device: await ev('eco.stats().device') });
  }
}
// стенд ?light (сам ставить window.eco = { ready: true } після першого кадру)
await send('Page.navigate', { url: 'http://localhost:8123/?light&dev' }); await waitFor('!!(window.eco && eco.ready)'); await wait(2000);
await shot('light');
writeFileSync(`${OUT}/results.json`, JSON.stringify({ R, errs }, null, 1));
for (const r of R) console.log([r.gpu, r.sh, r.view, r.sc, r.skip || `пристрій ${r.device}`].join(' '));
console.log(`помилок: ${errs.length}`); for (const e of errs) console.log(e);
quit(); process.exit(errs.length ? 1 : 0);
