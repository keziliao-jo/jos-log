import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeLabel, initialDate } from '../web/js/ui-log.js';
import { changedFields, saveErrorText } from '../web/js/ui-edit.js';

test('timeLabel shows the local HH:MM of an ISO timestamp', () => {
  assert.equal(timeLabel(new Date(2026, 10, 17, 10, 42, 5).toISOString()), '10:42');
  assert.equal(timeLabel(new Date(2026, 10, 17, 0, 5).toISOString()), '00:05');
  assert.equal(timeLabel(new Date(2026, 10, 17, 23, 59).toISOString()), '23:59');
});

test('timeLabel is empty for a missing or invalid timestamp', () => {
  assert.equal(timeLabel(''), '');
  assert.equal(timeLabel(undefined), '');
  assert.equal(timeLabel('not a date'), '');
});

test('initialDate uses ?date= only when it is a real YYYY-MM-DD date', () => {
  const q = (s) => new URLSearchParams(s);
  assert.equal(initialDate(q('date=2026-11-16'), '2026-11-17'), '2026-11-16');
  assert.equal(initialDate(q(''), '2026-11-17'), '2026-11-17');
  assert.equal(initialDate(q('date=2026-13-01'), '2026-11-17'), '2026-11-17');
  assert.equal(initialDate(q('date=2026-02-30'), '2026-11-17'), '2026-11-17');
  assert.equal(initialDate(q('date=yesterday'), '2026-11-17'), '2026-11-17');
  assert.equal(initialDate(q('date=2026-1-5'), '2026-11-17'), '2026-11-17');
  assert.equal(initialDate(undefined, '2026-11-17'), '2026-11-17');
  assert.equal(initialDate(q('date=0026-11-16'), '2026-11-17'), '2026-11-17');
  assert.equal(initialDate(q('date=2100-01-01'), '2026-11-17'), '2026-11-17');
});

const entry = {
  id: 'a',
  date: '2026-11-17',
  project: 'Alpha',
  what_i_did: 'did it',
  impact: '',
  stakeholders: '',
  feedback: '',
};

test('changedFields returns only the fields that differ, trimmed', () => {
  const v = { date: '2026-11-17', project: 'Alpha ', what_i_did: ' did it', impact: ' faster ', stakeholders: '', feedback: '' };
  assert.deepEqual(changedFields(entry, v), { impact: 'faster' });
});

test('changedFields is empty when nothing changed', () => {
  assert.deepEqual(changedFields(entry, { ...entry }), {});
});

test('changedFields can clear a field and ignores a blank date', () => {
  assert.deepEqual(changedFields(entry, { ...entry, project: '', date: '' }), { project: '' });
  assert.deepEqual(changedFields(entry, { ...entry, date: '2026-11-16' }), { date: '2026-11-16' });
});

test('saveErrorText: each store error becomes the message the form shows (the typed text stays)', () => {
  assert.equal(saveErrorText(new Error('invalid date')), '日期不正確（2000–2099）');
  assert.equal(saveErrorText(new Error('too long')), '內容太長（上限 40000 字）');
  assert.equal(saveErrorText(new Error('what_i_did required')), 'What I did 不可空白');
  assert.equal(saveErrorText(new Error('QuotaExceeded')), '無法儲存到本機');
  assert.equal(saveErrorText(undefined), '無法儲存到本機');
});
