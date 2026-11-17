import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImpactEnter, nextRowId, progressPct } from '../web/js/ui-week.js';

const ev = (o) => ({ key: 'Enter', isComposing: false, keyCode: 13, ...o });

test('isImpactEnter: a plain Enter saves', () => {
  assert.equal(isImpactEnter(ev({})), true);
});

test('isImpactEnter: Enter that confirms an IME candidate never saves', () => {
  assert.equal(isImpactEnter(ev({ isComposing: true })), false);
  assert.equal(isImpactEnter(ev({ keyCode: 229 })), false); // Safari
});

test('isImpactEnter: other keys never save', () => {
  assert.equal(isImpactEnter(ev({ key: 'a', keyCode: 65 })), false);
  assert.equal(isImpactEnter(ev({ key: 'Tab', keyCode: 9 })), false);
});

test('nextRowId: the first remaining row after the removed one, else null', () => {
  assert.equal(nextRowId(['a', 'b', 'c'], ['a', 'c'], 'b'), 'c');
  assert.equal(nextRowId(['a', 'b', 'c'], ['a', 'b'], 'c'), null);
  assert.equal(nextRowId(['a', 'b', 'c'], ['b', 'c'], 'a'), 'b');
  assert.equal(nextRowId(['a'], [], 'a'), null);
});

test('nextRowId: skips rows that vanished together with the removed one', () => {
  assert.equal(nextRowId(['a', 'b', 'c', 'd'], ['a', 'd'], 'b'), 'd');
  assert.equal(nextRowId(['a', 'b', 'c'], ['a'], 'b'), null);
});

test('nextRowId: an unknown removed id gives null', () => {
  assert.equal(nextRowId(['a', 'b'], ['a', 'b'], 'zzz'), null);
});

test('progressPct rounds to a whole percent and never leaves 0..100', () => {
  assert.equal(progressPct(7, 12), 58);
  assert.equal(progressPct(0, 5), 0);
  assert.equal(progressPct(5, 5), 100);
  assert.equal(progressPct(1, 0), 0);
  assert.equal(progressPct(9, 5), 100);
});

import { dateLabel } from '../web/js/ui-week.js';

test('dateLabel shows month and day, and leaves odd input alone', () => {
  assert.equal(dateLabel('2026-11-13'), 'Nov 13');
  assert.equal(dateLabel('2026-01-02'), 'Jan 2');
  assert.equal(dateLabel('2026-12-31'), 'Dec 31');
  assert.equal(dateLabel('tomorrow'), 'tomorrow');
  assert.equal(dateLabel(''), '');
  assert.equal(dateLabel(undefined), '');
});
