import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusText, failureText, clearLocal, headerText, rejectedLabel, rejectedCopyText } from '../web/js/ui-settings.js';
import { ApiError, NetworkError } from '../web/js/api.js';

test('statusText maps store status to the header text', () => {
  assert.equal(statusText({ status: 'synced', pending: 0 }), '已同步');
  assert.equal(statusText({ status: 'syncing', pending: 2 }), '同步中');
  assert.equal(statusText({ status: 'pending', pending: 3 }), '3 筆待同步');
  assert.equal(statusText({ status: 'pending', pending: 0 }), '待同步');
  assert.equal(statusText({ status: 'offline', pending: 0 }), '離線');
  assert.equal(statusText({ status: 'offline', pending: 2 }), '離線 · 2 筆待同步');
  assert.equal(statusText({ status: 'auth', pending: 1 }), 'token 錯誤');
});

test('failureText explains a failed connection test in plain Chinese', () => {
  assert.equal(failureText(new ApiError('auth')), 'token 錯誤');
  assert.equal(failureText(new NetworkError('boom')), '無法連線');
  assert.equal(failureText(new ApiError('bad_response')), '回應格式錯誤');
  assert.equal(failureText(new ApiError('server')), '伺服器錯誤');
  assert.equal(failureText(new Error('weird')), '回應格式錯誤');
});

test('clearLocal removes cache, queue and sweep keys but keeps the config', () => {
  const m = new Map([
    ['jos_config', '{"url":"u","token":"t"}'],
    ['jos_cache', '[]'],
    ['jos_queue', '[]'],
    ['jos_rejected', '[]'],
    ['jos_sweep_2026-11-16', '[true,false,false,false]'],
    ['jos_sweep_2026-11-09', '[true,true,true,true]'],
    ['other_app', 'x'],
  ]);
  const storage = {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
  };
  clearLocal(storage);
  assert.deepEqual([...m.keys()].sort(), ['jos_config', 'other_app']);
});

test('headerText appends the rejected count when there is one', () => {
  assert.equal(headerText({ status: 'synced', pending: 0, rejected: 0 }), '已同步');
  assert.equal(headerText({ status: 'synced', pending: 0 }), '已同步');
  assert.equal(headerText({ status: 'synced', pending: 0, rejected: 2 }), '已同步 · 2 筆被拒絕');
  assert.equal(headerText({ status: 'offline', pending: 1, rejected: 1 }), '離線 · 1 筆待同步 · 1 筆被拒絕');
});

test('rejectedLabel: date · project · what, truncated; works for partial update patches', () => {
  const add = { opId: 'o', type: 'add', entry: { id: 'a', date: '0026-11-17', project: '', what_i_did: 'typo year', impact: '' } };
  assert.equal(rejectedLabel(add), '0026-11-17 · 未歸屬 · typo year');
  const long = { ...add, entry: { ...add.entry, project: 'P', what_i_did: 'x'.repeat(200) } };
  const label = rejectedLabel(long);
  assert.ok(label.startsWith('0026-11-17 · P · xxx'));
  assert.ok(label.endsWith('…'));
  assert.ok(label.length < 100);
  const patch = { opId: 'o', type: 'update', entry: { id: 'a', updated_at: 'T', impact: 'only impact' } };
  assert.equal(rejectedLabel(patch), 'only impact');
  assert.equal(rejectedLabel({ opId: 'o', type: 'remove', id: 'a' }), '');
});

test('rejectedCopyText: JSON of the text fields present in the op entry', () => {
  const op = { opId: 'o', type: 'add', entry: { id: 'a', date: '0026-11-17', project: 'P', what_i_did: 'w', impact: '', stakeholders: 's', feedback: 'f', created_at: 'T', updated_at: 'T' } };
  assert.deepEqual(JSON.parse(rejectedCopyText(op)), { date: '0026-11-17', project: 'P', what_i_did: 'w', impact: '', stakeholders: 's', feedback: 'f' });
  const patch = { opId: 'o', type: 'update', entry: { id: 'a', updated_at: 'T', impact: 'i' } };
  assert.deepEqual(JSON.parse(rejectedCopyText(patch)), { impact: 'i' });
});
