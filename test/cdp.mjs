// test/cdp.mjs — Chrome через CDP для замірів і знімків (test/perf.mjs, test/pixels.mjs): запуск (headless чи видимий),
// сторінка, обчислення в ній, сцени гри. Браузер закривається всією групою процесів за будь-якого виходу
import { spawn } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// visible — видиме вікно на екрані (WebGL2 у headless — ANGLE-Vulkan, у 3–8 разів повільніший)
export async function launch({ port = 9340, dir, visible = false, extra = [] }) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const flags = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-webgpu-developer-features',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling',
    // видиме: через XWayland (на Wayland вікно з окремим профілем не відкриває порт CDP — 13.10.2026), без звертання до
    // сховища паролів системи (інакше чекає на нього)
    '--password-store=basic',
    ...(visible ? ['--window-size=1280,720', '--window-position=0,0', '--ozone-platform=x11', '--force-device-scale-factor=1.5']
      : ['--headless=new', '--use-angle=vulkan', '--enable-features=Vulkan', '--window-size=2560,1297', '--force-device-scale-factor=1.5']),
    ...extra, 'about:blank',
  ];
  const ch = spawn('google-chrome', flags, { stdio: 'ignore', detached: true });
  const quit = () => { try { process.kill(-ch.pid, 'SIGTERM'); } catch { /* уже */ } };
  process.on('exit', quit);
  process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
  let list = null;
  for (let i = 0; i < 100 && !list; i++) { await wait(200); try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* ще стартує */ } }
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl), pend = new Map(), errs = [];
  let id = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push('ВИНЯТОК ' + String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning') && errs.length < 60) errs.push(m.params.type + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400));
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, (m) => r(m.result || { error: m.error })); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('EVAL ' + String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 400) + ' ← ' + expression.slice(0, 120));
    return r.result?.value;
  };
  const waitFor = async (expr, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await wait(100); } throw new Error('не дочекались: ' + expr); };
  await send('Runtime.enable'); await send('Page.enable');
  return { send, ev, waitFor, errs, quit, pid: ch.pid };
}

// Сцени: світ (зерно), всесвіт, місце, фаза доби ('best' — найбільше світил), камера, погляд [yaw, pitch, dist], особливе
// (cave — печера поруч, shaft — точні ноги, fly / spin — рух)
export const SCENES = {
  plain: { seed: '1hsb1wu', n: 1, x: -52, y: -45, ph: 0.4, cam: 'third', look: [0.8, 0.35, 7] },
  rain: { seed: '1hsb1wu', n: 1, x: -52, y: -45, ph: 0.4, cam: 'third', look: [0.8, 0.35, 7], weather: 'rain' },
  night: { seed: '1hsb1wu', n: 1, x: -52, y: -45, ph: 0.0, cam: 'third', look: [0.8, 0.35, 7] },
  iso: { seed: '1hsb1wu', n: 1, x: -52, y: -45, ph: 0.4, cam: 'iso' },
  cave: { seed: '1hsb1wu', n: 1, x: -52, y: -45, ph: 0.4, cam: 'third', look: [0.8, 0.35, 4], cave: true },
  forest: { seed: '1hsb1wu', n: -60813, x: -478, y: -107, ph: 0.4, cam: 'third', look: [0.8, 0.35, 7] },
  first: { seed: '1hsb1wu', n: -60813, x: -478, y: -107, ph: 0.4, cam: 'first', look: [0.8, 0.1] },
  under: { seed: '1hsb1wu', n: 1, x: -52, y: -45, ph: 0.4, cam: 'first', under: true },
  mount: { seed: '1hsb1wu', n: 33281, x: -61, y: -2, ph: 0.4, cam: 'third', look: [0.8, 0.35, 7] },
  suns3: { seed: '1hsb1wu', n: 784, x: -52, y: -45, ph: 'best', cam: 'third', look: [0.8, 0.35, 7] },
  grove: { seed: '1hsb1wu', n: 1, x: -913, y: 302, ph: 0.4, cam: 'third', look: [0.8, 0.35, 7] },
  grove1: { seed: '1hsb1wu', n: 1, x: -913, y: 302, ph: 0.4, cam: 'first', look: [2.4, 0.05] },
  shaft: { seed: '1qgt24p', n: -16094, x: -96.24, y: -653.34, z: 8.07, ph: 0.3, cam: 'first', look: [0.8, 0.1] },
  aim: { seed: '1hsb1wu', n: -60813, x: -478, y: -107, ph: 0.4, cam: 'first', aim: true },
  fly: { seed: '1hsb1wu', n: -60813, x: -478, y: -107, ph: 0.4, cam: 'third', look: [0.8, 0.2, 7], move: 'fly' },
  spin: { seed: '1hsb1wu', n: -60813, x: -478, y: -107, ph: 0.4, cam: 'third', look: [0.8, 0.35, 7], move: 'spin' },
};

// Гра на порту port з налаштуваннями (gpu, shadows, view); новий світ із зерном seed
export async function openGame(P, port, { gpu, shadows = 'pcf3', view = 16, seed }) {
  await P.send('Page.navigate', { url: `http://localhost:${port}/?dev` }); await wait(1200);
  await P.ev(`localStorage.setItem('echoverse-gpu', '${gpu}'); localStorage.setItem('echoverse-shadows', '${shadows}'); localStorage.setItem('echoverse-view', '${view}'); localStorage.setItem('echoverse-camera', 'third'); 1`);
  await P.send('Page.reload'); await P.waitFor('!!window.eco');
  // полотно — як у користувача (CSS 2560 × 1297 при масштабі 150 % = 3840 × 1945 пікселів), хоч вікно менше: GPU малює
  // все полотно, на екрані видно частину (видимий Chrome через XWayland не має масштабу 150 % і розміру екрана 4K)
  await P.ev("(() => { const c = document.getElementById('gl'); c.style.width = '2560px'; c.style.height = '1297px'; return 1; })()");
  for (let i = 0; i < 60 && !(await P.ev('!!(window.eco && eco.g)')); i++) { await P.ev(`document.getElementById('seed').value = '${seed}'; document.getElementById('create').click(); 1`); await wait(1000); }
  await P.waitFor('!!(eco.g && eco.g.me.placed)');
  await idle(P);
  await P.ev("document.getElementById('help').hidden = true; 1");
  return P.ev('eco.stats().device');
}
export async function idle(P, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await P.ev('eco.stats().pending')) === 0) return true; await wait(50); }
  return false;
}
export async function settled(P, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await P.ev('eco.stats().pending')) === 0 && (await P.ev('eco.visMissing()')) === 0) { await wait(300); if ((await P.ev('eco.stats().pending')) === 0) return true; }
    await wait(100);
  }
  return false;
}

// Гравець і камера — у сцену S (світ уже той); повертає false, якщо особливе місце не знайшлось
export async function placeScene(P, S) {
  await P.ev(`eco.freeze(false); eco.spin(0); eco.key('KeyW', false); eco.weather('${S.weather || 'clear'}'); eco.setCam('${S.cam}'); 1`);
  if ((await P.ev('eco.g.n')) !== S.n) {
    await P.ev(`eco.g.dev.start([0, ${S.n}], 'jumpNext'); 1`);
    for (let i = 0; i < 600 && (await P.ev('eco.g.n')) !== S.n; i++) await wait(20);
  }
  await P.ev(`(() => { const g = eco.g, me = g.me; me.fly = false; me.x = ${S.x}; me.y = ${S.y}; ${S.z !== undefined ? `me.z = ${S.z};` : ''} me.vx = me.vy = me.vz = 0; me.visX = me.px = me.x; me.visY = me.py = me.y; me.vis = me.pv = me.z; g.cam = [me.x, me.y, me.z]; return 1; })()`);
  await settled(P); await wait(500);
  if (S.cave) {
    let ok = null;
    for (let i = 0; i < 40 && !ok; i++) { ok = await P.ev('eco.findCave()'); if (!ok) await wait(250); }
    if (!ok) return false;
    await settled(P);
  }
  if (S.under) {
    const w = await P.ev('eco.findLiquid(12)');
    if (!w) return false;
    await P.ev(`(() => { const me = eco.g.me; me.x = ${w[0]}; me.y = ${w[1]}; me.z = ${w[2]} - 1.5 - 0.92; me.fly = true; me.vz = 0; me.visX = me.px = me.x; me.visY = me.py = me.y; me.vis = me.pv = me.z; eco.g.cam = [me.x, me.y, me.z]; return 1; })()`);
    await settled(P);
    await P.ev('eco.look(0.6, -0.35); 1');
  }
  if (S.aim) {                                   // перша особа впритул до стовбура, погляд на нього — обрис цілі
    const a = await P.ev(`(() => { const g = eco.g, me = g.me; let o = null, bd = 1e9; for (let dy = -20; dy <= 20; dy++) for (let dx = -20; dx <= 20; dx++) { const q = g.world.obst(g.d, g.n, Math.floor(me.x) + dx, Math.floor(me.y) + dy); if (q && typeof q === 'object' && q.r > 0.12 && q.z1 - q.z0 > 2) { const d = Math.hypot(dx, dy); if (d < bd) { bd = d; o = q; } } } if (!o) return null; const a = 0.7; me.x = o.cx + Math.cos(a) * (o.r + 1.4); me.y = o.cy + Math.sin(a) * (o.r + 1.4); me.z = o.z0 + 0.5; me.vz = 0; me.visX = me.px = me.x; me.visY = me.py = me.y; me.vis = me.pv = me.z; g.cam = [me.x, me.y, me.z]; return a; })()`);
    if (a === null) return false;
    await settled(P);
    await P.ev(`eco.look(${a} + Math.PI, 0.1); 1`);
    for (let i = 0; i < 50 && !(await P.ev('!!eco.aim() && eco.aim().kind === "obj" && eco.renderer.hasObj(eco.g.aim.key)')); i++) await wait(100);
  }
  if (S.move === 'fly') await P.ev('(() => { const me = eco.g.me; me.fly = true; me.z += 25; me.vz = 0; me.vis = me.pv = me.z; return 1; })()');
  if (S.look) await P.ev(`eco.look(${S.look.join(', ')}); 1`);
  if (S.ph === 'best') await P.ev('eco.bestPhase()'); else await P.ev(`eco.setPhase(${S.ph})`);
  await wait(800);
  return true;
}
