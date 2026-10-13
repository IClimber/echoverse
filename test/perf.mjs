// test/perf.mjs — заміри к/с, CPU і GPU версій гри почергово (A/B), у режимах «графіка × дальність × тіні» (не в npm test).
// Версії — сервери на портах (python3 serve.py ПОРТ у своїй теці). Прогін — для кожної версії по черзі (ABAB…, порядок
// у парі міняється): новий світ, сцени, для кожної дальності (32 → 16 → 8: коло вже завантажене) і тіней — вибірка.
// Типи вибірок: заморожений кадр (eco.freeze — лише рендер), рух (fly — політ 48 м/с, spin — поворот 34°/с).
//   node test/perf.mjs --api=webgpu|webgl2 [--visible] --ports=8125,8124 [--scenes=plain,forest,…]
//     [--views=32,16,8] [--shadows=off,pcf3,pcss] [--runs=3] [--ms=2500] [--prof=1] [--out=файл.json]
//   node test/perf.mjs --compare=файл.json [--ref=8125]   — порівняння за критерієм (README у коментарі нижче)
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { launch, wait, SCENES, openGame, placeScene, settled } from './cdp.mjs';

const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : process.argv.includes(`--${k}`) ? true : d; };

// ---- статистика вибірки ----
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const quant = (a, q) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * q))] : NaN; };
function summarize(F) {
  // F: [інтервал, такт PlayCanvas, рендер PlayCanvas, оновлення гри, малювання гри, GPU, викликів]; перші 3 кадри — геть
  F = F.slice(3);
  const dt = F.map((f) => f[0]), gpu = F.map((f) => f[5]).filter((v) => v > 0);
  return {
    n: F.length, fps: 1000 / mean(dt), dtMed: quant(dt, 0.5), p99: quant(dt, 0.99), max: Math.max(...dt),
    tick: mean(F.map((f) => f[1])), pcr: mean(F.map((f) => f[2])), upd: mean(F.map((f) => f[3])), drw: mean(F.map((f) => f[4])),
    gpu: gpu.length ? mean(gpu) : null, gpuP99: gpu.length ? quant(gpu, 0.99) : null, draws: mean(F.map((f) => f[6])),
  };
}

// ---- порівняння ----
// Критерій (план 13.10.2026): одиниця — режим (графіка × дальність × тіні). Δ режиму — середнє по сценах різниць к/с B − A
// в парах прогонів; SE — з розкиду Δ між парами. «Гірше» — Δ ≤ −1 к/с і ≤ −2 SE (підтверджується свіжою вибіркою —
// повторний запуск лише цих режимів) або будь-яка сцена −3 % і ≤ −3 SE; «краще» — Δ ≥ +1 к/с і ≥ 2 SE
function compare(file, ref) {
  const D = JSON.parse(readFileSync(file, 'utf8')), R = D.results.filter((r) => !r.skip);
  const vers = [...new Set(R.map((r) => r.port))];
  const A = ref ? +ref : vers[0], B = vers.find((v) => v !== A);
  const modes = new Map();
  for (const r of R) { const k = `${D.api}·${r.view}·${r.sh}`; if (!modes.has(k)) modes.set(k, []); modes.get(k).push(r); }
  const out = [];
  for (const [k, rs] of modes) {
    const scenes = [...new Set(rs.map((r) => r.scene))], runs = [...new Set(rs.map((r) => r.run))];
    const pairD = [], sceneRows = [];
    for (const run of runs) {
      const ds = [];
      for (const sc of scenes) {
        const a = rs.find((r) => r.run === run && r.scene === sc && r.port === A), b = rs.find((r) => r.run === run && r.scene === sc && r.port === B);
        if (a && b) ds.push(b.s.fps - a.s.fps);
      }
      if (ds.length) pairD.push(mean(ds));
    }
    for (const sc of scenes) {
      const a = rs.filter((r) => r.scene === sc && r.port === A).map((r) => r.s), b = rs.filter((r) => r.scene === sc && r.port === B).map((r) => r.s);
      if (!a.length || !b.length) continue;
      const d = runs.map((run) => { const x = rs.find((r) => r.run === run && r.scene === sc && r.port === A), y = rs.find((r) => r.run === run && r.scene === sc && r.port === B); return x && y ? y.s.fps - x.s.fps : null; }).filter((v) => v !== null);
      const se = d.length > 1 ? Math.sqrt(d.reduce((s, v) => s + (v - mean(d)) ** 2, 0) / (d.length - 1) / d.length) : Infinity;
      const fa = mean(a.map((s) => s.fps)), fb = mean(b.map((s) => s.fps));
      sceneRows.push({ scene: sc, A: fa, B: fb, d: mean(d), se, pct: (fb - fa) / fa * 100, gpuA: mean(a.map((s) => s.gpu ?? NaN)), gpuB: mean(b.map((s) => s.gpu ?? NaN)), p99A: mean(a.map((s) => s.p99)), p99B: mean(b.map((s) => s.p99)), cpuA: mean(a.map((s) => s.tick)), cpuB: mean(b.map((s) => s.tick)), worse: (fb - fa) / fa * 100 <= -3 && mean(d) <= -3 * se });
    }
    const dm = mean(pairD), se = pairD.length > 1 ? Math.sqrt(pairD.reduce((s, v) => s + (v - dm) ** 2, 0) / (pairD.length - 1) / pairD.length) : Infinity;
    const verdict = (dm <= -1 && dm <= -2 * se) || sceneRows.some((s) => s.worse) ? 'ГІРШЕ' : dm >= 1 && dm >= 2 * se ? 'краще' : '—';
    out.push({ mode: k, d: dm, se, verdict, scenes: sceneRows });
  }
  for (const o of out) {
    console.log(`${o.mode.padEnd(18)} Δ ${o.d.toFixed(1).padStart(6)} к/с ± ${o.se.toFixed(1)}  ${o.verdict}`);
    for (const s of o.scenes) console.log(`   ${s.scene.padEnd(8)} ${s.A.toFixed(1).padStart(6)} → ${s.B.toFixed(1).padStart(6)} (${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(1)} %, ±${s.se.toFixed(1)})  GPU ${s.gpuA.toFixed(2)} → ${s.gpuB.toFixed(2)}  такт ${s.cpuA.toFixed(2)} → ${s.cpuB.toFixed(2)}  p99 ${s.p99A.toFixed(1)} → ${s.p99B.toFixed(1)}${s.worse ? '  ГІРШЕ' : ''}`);
  }
  const worse = out.filter((o) => o.verdict === 'ГІРШЕ').map((o) => o.mode), better = out.filter((o) => o.verdict === 'краще').map((o) => o.mode);
  console.log(`\nкраще: ${better.join(', ') || '—'}\nгірше: ${worse.join(', ') || '—'}`);
  return { out, worse, better };
}

if (arg('compare')) { compare(arg('compare'), arg('ref')); process.exit(0); }

// ---- заміри ----
const API = arg('api', 'webgpu'), VISIBLE = !!arg('visible'), PORTS = String(arg('ports', '8125,8124')).split(',').map(Number);
const SC = String(arg('scenes', 'plain,forest,mount,cave,first,suns3,shaft,grove,fly,spin')).split(',').filter((k) => SCENES[k]);
const VIEWS = String(arg('views', '32,16,8')).split(',').map(Number), SHS = String(arg('shadows', 'off,pcf3,pcss')).split(',');
const RUNS = +arg('runs', 3), MS = +arg('ms', 2500);
// профайлер GPU: один для всіх версій чи свій для кожного порту (--prof=1,0 — ціна самого профайлера на тій самій версії)
const PROFS = String(arg('prof', '1')).split(','), PROF = (port) => (PROFS[PORTS.indexOf(port)] ?? PROFS[0]) !== '0';
const OUT = arg('out', `${tmpdir()}/echoverse-perf-${API}.json`);
// браузер — новий на кожну версію в кожному прогоні: за годину перезавантажень сторінок один Chrome із WebGPU тримав
// ~22 ГБ пам'яті ядра (драйвер звільняє її лише з процесом), і OOM-killer убив вкладку посеред заміру (13.10.2026)
const launchP = () => launch({ port: 9340 + (VISIBLE ? 1 : 0), dir: `${tmpdir()}/echoverse-perf-profile-${API}`, visible: VISIBLE });
let P = null;
const results = [], t0 = Date.now(), errs = [];
const save = () => writeFileSync(OUT, JSON.stringify({ api: API, ports: PORTS, scenes: SC, views: VIEWS, shadows: SHS, runs: RUNS, ms: MS, results, errs }, null, 0));
const bySeed = SC.reduce((m, k) => { (m[SCENES[k].seed] ||= []).push(k); return m; }, {});
for (let run = 0; run < RUNS; run++) {
  const order = run % 2 ? [...PORTS].reverse() : PORTS;
  for (const port of order) {
    P = await launchP();
    for (const seed in bySeed) {
      const device = await openGame(P, port, { gpu: API, view: VIEWS[0], seed });
      const px = await P.ev("[eco.renderer.G.dev.width, eco.renderer.G.dev.height, devicePixelRatio, (() => { const c = document.createElement('canvas').getContext('webgl2'), e = c && c.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })()]");
      console.log(`${port}: ${device}, полотно ${px[0]}×${px[1]} (DPR ${px[2]}), ${px[3]}`);
      await P.ev(`eco.gpuProf(${PROF(port)})`);
      for (const name of bySeed[seed]) {
        const S = SCENES[name];
        if (!(await placeScene(P, S))) { results.push({ port, run, scene: name, skip: 'місце не знайдено' }); continue; }
        for (const view of VIEWS) {
          await P.ev(`eco.freeze(false); eco.setView(${view})`);
          const ok = await settled(P, 240000);
          if (!S.move) { await wait(600); await P.ev('eco.freeze(true)'); }
          for (const sh of SHS) {
            await P.ev(`eco.shadows('${sh}')`);
            await wait(1500);                                  // прогрів шейдерів, оновлення всіх каскадів
            let F;
            if (S.move) {
              // рух з того самого місця й погляду щоразу
              await placeScene(P, S);
              await P.ev(S.move === 'fly' ? "eco.key('KeyW', true)" : 'eco.spin(34 * Math.PI / 180)');
              await wait(300);
              F = await P.ev(`eco.sample(${MS})`);
              await P.ev("eco.key('KeyW', false); eco.spin(0)");
            } else F = await P.ev(`eco.sample(${MS})`);
            const st = await P.ev('eco.stats()');
            results.push({ port, run, scene: name, view, sh, device, px, settled: ok, s: summarize(F), tris: st.tris, shTris: st.shTris, camSub: st.camSub, shSub: st.shSub, gpuMB: st.gpuMB });
            const s = results[results.length - 1].s;
            console.log(`${((Date.now() - t0) / 60000).toFixed(1).padStart(5)} хв  ${port} #${run} ${name.padEnd(7)} ${String(view).padStart(2)} ${sh.padEnd(4)}  ${s.fps.toFixed(1).padStart(6)} к/с  p99 ${s.p99.toFixed(1)}  GPU ${s.gpu === null ? '—' : s.gpu.toFixed(2)}  такт ${s.tick.toFixed(2)} (рендер ${s.pcr.toFixed(2)}, гра ${(s.upd + s.drw).toFixed(2)})  викл ${s.draws.toFixed(0)}`);
          }
        }
        await P.ev('eco.freeze(false)');
        save();
      }
    }
    errs.push(...P.errs); P.quit(); await wait(2500);
  }
}
save();
console.log(`результати: ${OUT}; помилок у консолі: ${errs.length}`); for (const e of errs.slice(0, 10)) console.log(e);
compare(OUT);
process.exit(0);
