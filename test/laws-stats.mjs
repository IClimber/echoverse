// Розподіл законів (п. 4 roadmap): node test/laws-stats.mjs [--d=0] [--N=20000] [--seed=текст] [--from=101]
// Частки рівнів кожного закону (незвичне й вище, крайнє й вище, легендарне), класи всесвітів, квантилі величин.
import { lawsOf } from '../js/universe.js';
import { hashStr } from '../js/rng.js';

const arg = (k, v) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : v; };
const d = +arg('d', 0), N = +arg('N', 20000), seed = hashStr(arg('seed', 'stats')), from = +arg('from', 101);

const lv = {}, cls = [0, 0, 0, 0], any = [0, 0, 0, 0], vals = {};
const put = (k, v) => (vals[k] ||= []).push(v);
for (let i = 0; i < N; i++) {
  const n = (i & 1 ? -1 : 1) * (from + (i >> 1) * 7), L = lawsOf(seed, d, n);
  cls[L.strange.cls]++;
  let mx = 0;
  for (const [k, t] of Object.entries(L.tiers)) { (lv[k] ||= [0, 0, 0, 0])[t]++; if (t > mx) mx = t; }
  any[mx]++;
  put('g', L.grav); put('T °C', L.clim.Tpatch - 273.15); put('P атм', L.air.pressure); put('доба хв', L.sky.dayMin);
  put('T зорі', L.star.T); put('R пл', L.planet.R); put('B', L.mag.B); put('вітер м/с', L.air.wind); put('рад', L.air.rad);
  put('сонць', L.star.n); put('місяців', L.sky.moons.length); put('компаньйон f', L.comp ? L.comp.f : 0);
  put('повітря', L.air.gas);
}
const pc = (v) => (100 * v / N).toFixed(2).padStart(6) + ' %';
console.log(`глибина ${d}, всесвітів ${N}`);
console.log('класи (звичайні, незвичні, дивні, дуже дивні):', cls.map(pc).join(' '));
console.log('найвищий рівень (0…3):', any.map(pc).join(' '), '· хоч один крайній', pc(any[2] + any[3]), '· легендарний', pc(any[3]));
console.log('\nзакон                       незвичне+   крайнє+  легендарне');
for (const [k, a] of Object.entries(lv).sort((x, y) => y[1][1] + y[1][2] + y[1][3] - x[1][1] - x[1][2] - x[1][3]))
  console.log(k.padEnd(26), pc(a[1] + a[2] + a[3]), pc(a[2] + a[3]), pc(a[3]));
console.log('\nвеличина         p0.1     p1      p5     p25     p50     p75     p95     p99   p99.9');
const qs = [0.001, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 0.999];
for (const [k, a] of Object.entries(vals)) {
  a.sort((x, y) => x - y);
  console.log(k.padEnd(14), qs.map((q) => { const v = a[Math.min(a.length - 1, Math.floor(q * a.length))]; return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Math.abs(v) < 1 ? 3 : 2)).padStart(7); }).join(' '));
}
