import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSubmitKey } from '../web/js/keys.js';

const ev = (o) => ({ key: 'Enter', ctrlKey: false, metaKey: false, isComposing: false, ...o });

test('isSubmitKey: Ctrl+Enter or Cmd+Enter submits', () => {
  assert.equal(isSubmitKey(ev({ ctrlKey: true })), true);
  assert.equal(isSubmitKey(ev({ metaKey: true })), true);
  assert.equal(isSubmitKey(ev({ ctrlKey: true, metaKey: true })), true);
});

test('isSubmitKey: plain Enter never submits (it inserts a newline)', () => {
  assert.equal(isSubmitKey(ev({})), false);
});

test('isSubmitKey: Enter while an IME is composing never submits', () => {
  assert.equal(isSubmitKey(ev({ ctrlKey: true, isComposing: true })), false);
  assert.equal(isSubmitKey(ev({ metaKey: true, isComposing: true })), false);
  assert.equal(isSubmitKey(ev({ isComposing: true })), false);
});

test('isSubmitKey: other keys never submit', () => {
  assert.equal(isSubmitKey(ev({ key: 'a', ctrlKey: true })), false);
  assert.equal(isSubmitKey(ev({ key: ' ', metaKey: true })), false);
  assert.equal(isSubmitKey(ev({ key: 'Escape', ctrlKey: true })), false);
  assert.equal(isSubmitKey(ev({ key: 'enter', ctrlKey: true })), false);
});

import { isSubmitEvent } from '../web/js/keys.js';

test('isSubmitEvent treats keyCode 229 (Safari composition) as composing', () => {
  assert.equal(isSubmitEvent({ key: 'Enter', ctrlKey: true, metaKey: false, isComposing: false, keyCode: 13 }), true);
  assert.equal(isSubmitEvent({ key: 'Enter', ctrlKey: true, metaKey: false, isComposing: false, keyCode: 229 }), false);
  assert.equal(isSubmitEvent({ key: 'Enter', ctrlKey: false, metaKey: true, isComposing: true, keyCode: 13 }), false);
  assert.equal(isSubmitEvent({ key: 'Enter', ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13 }), false);
});
