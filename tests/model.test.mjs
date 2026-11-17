process.env.TZ = 'Asia/Taipei'; // before any Date use: the midnight tests must not depend on the machine's zone
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  todayStr, uuid, newEntry, recentProjects, missingImpact, weekRange,
  weekProgress, monthCount, filterEntries, groupByMonth, toCopyText,
  isValidDate, rollDefaultDate, MAX_FIELD,
} from '../web/js/model.js';

const E = (o) => ({
  id: o.id || 'i', date: '2026-11-17', project: '', what_i_did: 'x', impact: '',
  stakeholders: '', feedback: '', created_at: '2026-11-17T00:00:00.000Z',
  updated_at: '2026-11-17T00:00:00.000Z', ...o,
});

test('todayStr uses local date parts, not UTC', () => {
  assert.equal(todayStr(new Date(2026, 10, 17, 0, 30)), '2026-11-17');
  assert.equal(todayStr(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('uuid returns distinct non-empty strings', () => {
  const a = uuid(), b = uuid();
  assert.equal(typeof a, 'string');
  assert.ok(a.length > 10);
  assert.notEqual(a, b);
});

test('newEntry trims, defaults optional fields, sets ids and timestamps', () => {
  const now = '2026-11-17T02:00:00.000Z';
  const e = newEntry({ what_i_did: '  重做訓練  ', project: ' Q4 ' }, now, 'x1');
  assert.deepEqual(e, {
    id: 'x1', date: '', project: 'Q4', what_i_did: '重做訓練', impact: '',
    stakeholders: '', feedback: '', created_at: now, updated_at: now,
  });
  assert.equal(e.created_at, e.updated_at);
});

test('newEntry keeps a provided date and rejects blank what_i_did', () => {
  const e = newEntry({ what_i_did: 'a', date: '2026-11-01' }, 't', 'id');
  assert.equal(e.date, '2026-11-01');
  assert.throws(() => newEntry({ what_i_did: '   ' }, 't', 'id'), /what_i_did required/);
  assert.throws(() => newEntry({}, 't', 'id'), /what_i_did required/);
});

test('recentProjects dedupes, most recent spelling, ordered, filtered, limited', () => {
  const today = '2026-11-17';
  const entries = [
    E({ date: '2026-11-01', project: 'q4 onboarding' }),
    E({ date: '2026-11-10', project: 'Q4 onboarding ' }),
    E({ date: '2026-11-12', project: 'Alpha' }),
    E({ date: '2026-11-17', project: '' }),
    E({ date: '2026-11-17', project: '   ' }),
    E({ date: '2026-09-17', project: 'Boundary' }), // exactly 61 days old -> excluded
    E({ date: '2026-09-18', project: 'Edge' }),     // exactly 60 days old -> included
  ];
  assert.deepEqual(recentProjects(entries, today), ['Alpha', 'Q4 onboarding', 'Edge']);
  const many = Array.from({ length: 8 }, (_, i) => E({ date: `2026-11-${String(10 + i).padStart(2, '0')}`, project: `P${i}` }));
  assert.deepEqual(recentProjects(many, today), ['P7', 'P6', 'P5', 'P4', 'P3']);
  assert.equal(recentProjects(many, today, 2).length, 2);
});

test('missingImpact: 28-day window inclusive, newest first, blank/whitespace only', () => {
  const today = '2026-11-17';
  const entries = [
    E({ id: 'a', date: '2026-10-20', impact: '' }),      // 28 days -> included
    E({ id: 'b', date: '2026-10-19', impact: '' }),      // 29 days -> excluded
    E({ id: 'c', date: '2026-11-15', impact: '   ' }),
    E({ id: 'd', date: '2026-11-16', impact: 'has it' }),
    E({ id: 'e', date: '2026-11-17', impact: '' }),
  ];
  assert.deepEqual(missingImpact(entries, today).map((e) => e.id), ['e', 'c', 'a']);
});

test('weekRange gives Monday start and ISO week number', () => {
  assert.deepEqual(weekRange('2026-11-17'), { start: '2026-11-16', end: '2026-11-22', weekNo: 47 });
  assert.equal(weekRange('2026-11-22').start, '2026-11-16');
  assert.equal(weekRange('2026-11-16').start, '2026-11-16');
  // year boundaries
  assert.equal(weekRange('2026-01-01').weekNo, 1);
  assert.equal(weekRange('2027-01-01').weekNo, 53);
  assert.equal(weekRange('2026-12-31').end, '2027-01-03');
});

test('weekProgress counts only this week', () => {
  const entries = [
    E({ date: '2026-11-16', impact: 'yes' }),
    E({ date: '2026-11-22', impact: '' }),
    E({ date: '2026-11-18', impact: '  ' }),
    E({ date: '2026-11-15', impact: 'prev week' }),
    E({ date: '2026-11-23', impact: 'next week' }),
  ];
  assert.deepEqual(weekProgress(entries, '2026-11-17'), { withImpact: 1, total: 3 });
});

test('monthCount counts entries in the same month as today', () => {
  const entries = [E({ date: '2026-11-01' }), E({ date: '2026-11-30' }), E({ date: '2026-10-31' }), E({ date: '2025-11-05' })];
  assert.equal(monthCount(entries, '2026-11-17'), 2);
});

test('filterEntries by project, text, and onlyNoImpact', () => {
  const entries = [
    E({ id: '1', project: 'Q4 Onboarding', what_i_did: 'alpha', impact: 'good' }),
    E({ id: '2', project: '', what_i_did: 'beta', impact: '' }),
    E({ id: '3', project: 'other', what_i_did: 'Gamma', impact: '', stakeholders: 'HR', feedback: 'Nice' }),
  ];
  const ids = (f) => filterEntries(entries, f).map((e) => e.id);
  assert.deepEqual(ids({}), ['1', '2', '3']);
  assert.deepEqual(ids({ project: null }), ['1', '2', '3']);
  assert.deepEqual(ids({ project: ' q4onboarding ' }), ['1']);
  assert.deepEqual(ids({ project: 'q4 ONBOARDING' }), ['1']);
  assert.deepEqual(ids({ project: '' }), ['2']);
  assert.deepEqual(ids({ text: 'GAMMA' }), ['3']);
  assert.deepEqual(ids({ text: 'hr' }), ['3']);
  assert.deepEqual(ids({ text: 'nice' }), ['3']);
  assert.deepEqual(ids({ text: 'good' }), ['1']);
  assert.deepEqual(ids({ text: 'onboarding' }), ['1']);
  assert.deepEqual(ids({ onlyNoImpact: true }), ['2', '3']);
  assert.deepEqual(ids({ onlyNoImpact: true, project: 'other' }), ['3']);
  assert.deepEqual(ids({ onlyNoImpact: true, text: 'beta' }), ['2']);
});

test('groupByMonth: newest month first, date desc then created_at desc', () => {
  const entries = [
    E({ id: 'a', date: '2026-10-05', created_at: '2026-10-05T01:00:00.000Z' }),
    E({ id: 'b', date: '2026-11-02', created_at: '2026-11-02T01:00:00.000Z' }),
    E({ id: 'c', date: '2026-11-17', created_at: '2026-11-17T01:00:00.000Z' }),
    E({ id: 'd', date: '2026-11-17', created_at: '2026-11-17T05:00:00.000Z' }),
  ];
  const g = groupByMonth(entries);
  assert.deepEqual(g.map((x) => [x.key, x.label]), [['2026-11', 'Nov 2026'], ['2026-10', 'Oct 2026']]);
  assert.deepEqual(g[0].entries.map((e) => e.id), ['d', 'c', 'b']);
  assert.deepEqual(g[1].entries.map((e) => e.id), ['a']);
});

test('toCopyText formats lines sorted by date ascending', () => {
  const entries = [
    E({ date: '2026-11-17', project: 'Q4 onboarding', what_i_did: '重做新人訓練流程', impact: '新人更快上手', stakeholders: 'HR, Ops' }),
    E({ date: '2026-11-10', project: '', what_i_did: '整理文件', impact: '', stakeholders: '' }),
    E({ date: '2026-11-12', project: 'P', what_i_did: '開會', impact: '', stakeholders: 'Bob' }),
    E({ date: '2026-11-13', project: 'P', what_i_did: '寫程式', impact: '更快', stakeholders: '' }),
  ];
  assert.equal(toCopyText(entries), [
    '2026-11-10 · 未歸屬 — 整理文件',
    '2026-11-12 · P — 開會（Bob）',
    '2026-11-13 · P — 寫程式 → 更快',
    '2026-11-17 · Q4 onboarding — 重做新人訓練流程 → 新人更快上手（HR, Ops）',
  ].join('\n'));
  assert.equal(toCopyText([]), '');
});

test('isValidDate: YYYY-MM-DD, a real calendar date, year 2000-2099', () => {
  for (const ok of ['2000-01-01', '2099-12-31', '2024-02-29', '2026-11-17']) assert.equal(isValidDate(ok), true, ok);
  for (const bad of ['0026-11-17', '1999-12-31', '2100-01-01', '2023-02-29', '2026-13-01', '2026-00-01', '2026-04-31',
    '202611-11-17', '+02026-11-17', '2026-1-5', ' 2026-11-17', '', null, undefined, 20261117]) {
    assert.equal(isValidDate(bad), false, String(bad));
  }
});

test('MAX_FIELD is 40000', () => {
  assert.equal(MAX_FIELD, 40000);
});

test('rollDefaultDate: advances the date field only when it still holds the old default', () => {
  assert.equal(rollDefaultDate('2026-11-17', '2026-11-17', '2026-11-18'), '2026-11-18'); // untouched default
  assert.equal(rollDefaultDate('2026-11-10', '2026-11-17', '2026-11-18'), '2026-11-10'); // user picked a day
  assert.equal(rollDefaultDate('', '2026-11-17', '2026-11-18'), ''); // cleared: save() uses today anyway
  assert.equal(rollDefaultDate('2026-11-17', '2026-11-17', '2026-11-17'), '2026-11-17'); // same day
});
