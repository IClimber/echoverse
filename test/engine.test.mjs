// Рушій: черга генератора, пул воркерів (прив'язка стовпця), далі — щільні меші, алокатор, такт
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, workerOf } from '../js/gen/queue.js';

const drain = (Q, w) => { const r = []; for (let t; (t = Q.take(w));) r.push(t[0]); return r; };

test('черга: пріоритети й повторний запит', () => {
  const Q = createQueue(2);
  Q.want('a', {}, 5, 0); Q.want('b', {}, 1, 0); Q.want('c', {}, 3, 0);
  assert.deepEqual(drain(Q, 0), ['b', 'c', 'a']);
  assert.equal(Q.take(0), null);
  Q.want('a', {}, 5, 0); Q.want('b', {}, 1, 0); Q.want('c', {}, 3, 0); Q.want('b', {}, 10, 0);
  assert.deepEqual(drain(Q, 0), ['c', 'a', 'b']);
  assert.equal(Q.size, 0);
});

test('черга: вільні роботи — будь-кому, прив\'язані — своєму; keepOnly', () => {
  const Q = createQueue(2);
  Q.want('x', {}, 2, -1); Q.want('y', {}, 1, 1);
  assert.deepEqual(Q.take(0)[0], 'x');
  assert.equal(Q.take(0), null);
  assert.deepEqual(Q.take(1)[0], 'y');
  Q.want('p', {}, 1, 0); Q.want('q', {}, 2, 1); Q.want('r', {}, 3, -1);
  Q.keepOnly(new Set(['q']));
  Q.compact();
  assert.equal(Q.size, 1);
  assert.equal(Q.take(0), null);
  assert.deepEqual(drain(Q, 1), ['q']);
});

test('workerOf: стовпець і його секції — в одного, далечінь — вільна, рівномірно', () => {
  const c = { type: 'col', d: 0, n: 3, cx: -4, cy: 7 }, s = { ...c, type: 'sec', cz: 2 };
  assert.equal(workerOf(c, 6), workerOf(s, 6));
  assert.equal(workerOf({ type: 'far', d: 0, n: 0, tx: 1, ty: 1 }, 6), -1);
  const cnt = new Array(6).fill(0);
  for (let cx = -10; cx < 10; cx++) for (let cy = -10; cy < 10; cy++) cnt[workerOf({ type: 'col', d: 0, n: 0, cx, cy }, 6)]++;
  for (const k of cnt) assert.ok(k >= 40 && k <= 100, `${cnt}`);
});
