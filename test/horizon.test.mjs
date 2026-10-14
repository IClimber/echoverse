// Справжній обрій з ока (js/env/horizon.js, 14.10.2026): з висоти h над поверхнею — нижче горизонталі на atan √(2h/R)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lawsOf } from '../js/laws/universe.js';
import { hashStr } from '../js/laws/rng.js';
import { createHorizon, HZ_N } from '../js/env/horizon.js';

const L = lawsOf(hashStr('test'), 0, 1), R = L.phys.planetR, FAR = 1400;
const dip = (h) => { const t2 = 2 * h / R; return Math.sqrt(t2 / (1 + t2)); };

test('обрій: без кривизни й під поверхнею — горизонталь', () => {
  assert.deepEqual([...createHorizon()(L, 0, 0, 500, 0, FAR)], new Array(HZ_N).fill(0));
  assert.deepEqual([...createHorizon()(L, 0, 0, -5000, R, FAR)], new Array(HZ_N).fill(0));
});

test('обрій: вище — нижче, на великій висоті — √(2h/R) над поверхнею', () => {
  const hz = createHorizon(), lo = [...hz(L, 0, 0, 300, R, FAR)], hi = [...hz(L, 0, 0, 3000, R, FAR)];
  for (let i = 0; i < HZ_N; i++) assert.ok(hi[i] > lo[i] && lo[i] > 0, `напрям ${i}: ${lo[i]} → ${hi[i]}`);
  // поверхня рівнини біля старту — у межах 0…60 м: кут обрію з 3000 м — між √(2·2940/R) і √(2·3000/R)
  for (let i = 0; i < HZ_N; i++) assert.ok(hi[i] >= dip(2940) && hi[i] <= dip(3000), `напрям ${i}: ${hi[i]} поза ${dip(2940)}…${dip(3000)}`);
});

test('обрій: поверхню перераховує лише після зсуву (той самий результат на місці)', () => {
  const hz = createHorizon(), a = [...hz(L, 10, 20, 400, R, FAR)];
  hz(L, 10, 20, 400, R, FAR);                         // друга мить: D уже з першої
  assert.deepEqual([...hz(L, 10, 20, 400, R, FAR)], [...hz(L, 15, 25, 400, R, FAR)]);
  assert.equal(a.length, HZ_N);
});
