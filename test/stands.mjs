// test/stands.mjs — стенди без помилок консолі (headless Chrome через CDP, не в npm test): ?strip — детермінізм
// («усі 12 відбитків збігаються з еталоном · математика (stdlib) — до біта»), ?laws, ?flora, ?light; ?move — test/shots.mjs.
// Сервер — python3 serve.py. node test/stands.mjs [--port=8123] [--sw] > stands.log 2>&1; код виходу 1 — збій
import { tmpdir } from 'node:os';
import { launch, wait } from './cdp.mjs';

const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const PORT = +arg('port', 8123);
const SW = process.argv.includes('--sw') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];   // GPU зайнятий
// стенд → вираз готовності (сторінка показала результат)
const STANDS = {
  strip: "document.body.innerText.includes('Детермінізм:')",
  laws: "document.body.innerText.includes('Небо з оптики')",
  flora: "document.body.innerText.includes('Види: зерно')",
  light: "(document.getElementById('st')?.textContent || '').includes('к/с')",
};
const P = await launch({ port: 9346, dir: `${tmpdir()}/echoverse-stands`, extra: SW });
let bad = 0;
for (const [name, ready] of Object.entries(STANDS)) {
  const e0 = P.errs.length;
  await P.send('Page.navigate', { url: `http://localhost:${PORT}/?${name}` });
  let ok = true, note = '';
  try { await P.waitFor(ready, 180000); } catch { ok = false; note = 'не дочекались'; }
  await wait(2000);                                         // помилки після показу (кадри ?light, воркери)
  if (ok && name === 'strip') { note = await P.ev("(document.body.innerText.match(/Детермінізм:[^\\n]*/) || [''])[0]"); ok = /усі 12 відбитків збігаються.*до біта/.test(note); }
  const errs = P.errs.slice(e0);
  if (!ok || errs.length) bad++;
  console.log(`${name}: ${ok && !errs.length ? 'OK' : 'ЗБІЙ'}${note ? ' · ' + note : ''} · помилок ${errs.length}`);
  for (const e of errs.slice(0, 5)) console.log('  ' + e);
}
process.exit(bad ? 1 : 0);                                  // браузер закриває cdp.mjs (process.on('exit'))
