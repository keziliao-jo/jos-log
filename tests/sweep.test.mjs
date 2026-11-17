import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SWEEP_ITEMS, loadSweep, saveSweep } from '../web/js/sweep.js';

function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    raw: m,
  };
}

const FOUR_FALSE = [false, false, false, false];

test('SWEEP_ITEMS lists the four reminders in order', () => {
  assert.deepEqual(SWEEP_ITEMS, ['Emails', 'Calendar', 'Meeting notes', 'To-do list']);
});

test('loadSweep defaults to four false when nothing is saved', () => {
  assert.deepEqual(loadSweep(memStorage(), '2026-11-16'), FOUR_FALSE);
});

test('saveSweep then loadSweep round-trips under jos_sweep_<weekStart>', () => {
  const s = memStorage();
  saveSweep(s, '2026-11-16', [true, false, true, false]);
  assert.deepEqual(loadSweep(s, '2026-11-16'), [true, false, true, false]);
  assert.ok(s.raw.has('jos_sweep_2026-11-16'));
});

test('a different weekStart is independent, so a new Monday starts clean', () => {
  const s = memStorage();
  saveSweep(s, '2026-11-16', [true, true, true, true]);
  assert.deepEqual(loadSweep(s, '2026-11-23'), FOUR_FALSE);
  assert.deepEqual(loadSweep(s, '2026-11-16'), [true, true, true, true]);
});

test('corrupt JSON gives four false', () => {
  assert.deepEqual(loadSweep(memStorage({ 'jos_sweep_2026-11-16': '{not json' }), '2026-11-16'), FOUR_FALSE);
});

test('wrong shape gives four false (wrong length, non-array, non-boolean)', () => {
  const at = (v) => loadSweep(memStorage({ 'jos_sweep_2026-11-16': v }), '2026-11-16');
  assert.deepEqual(at('[true,true]'), FOUR_FALSE);
  assert.deepEqual(at('[true,true,true,true,true]'), FOUR_FALSE);
  assert.deepEqual(at('{"0":true}'), FOUR_FALSE);
  assert.deepEqual(at('null'), FOUR_FALSE);
  assert.deepEqual(at('[1,"yes",true,false]'), FOUR_FALSE);
});

test('loadSweep returns a fresh array every call', () => {
  const s = memStorage();
  const a = loadSweep(s, '2026-11-16');
  a[0] = true;
  assert.deepEqual(loadSweep(s, '2026-11-16'), FOUR_FALSE);
});

test('storage that throws on get or set never throws out of these functions', () => {
  const boom = () => {
    throw new Error('blocked');
  };
  const bad = { getItem: boom, setItem: boom };
  assert.deepEqual(loadSweep(bad, '2026-11-16'), FOUR_FALSE);
  assert.doesNotThrow(() => saveSweep(bad, '2026-11-16', [true, true, true, true]));
});

test('saveSweep ignores a wrong-length list instead of storing it', () => {
  const s = memStorage();
  saveSweep(s, '2026-11-16', [true]);
  assert.equal(s.raw.size, 0);
});
