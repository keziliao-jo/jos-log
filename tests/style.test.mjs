import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
const code = css.replace(/\/\*[\s\S]*?\*\//g, ''); // comments may mention the banned words

test('style.css: no dashed lines', () => {
  assert.doesNotMatch(code, /dashed/i);
  assert.doesNotMatch(code, /dotted/i);
});

test('style.css: no gradients', () => {
  assert.doesNotMatch(code, /gradient/i);
});

test('style.css: every border-radius is zero', () => {
  const values = [...code.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/gi)].map((m) => m[1].trim());
  assert.ok(values.length > 0, 'expected an explicit border-radius: 0 reset');
  for (const v of values) assert.match(v, /^0(px)?(\s+0(px)?)*(\s*!important)?$/, `non-zero radius: ${v}`);
});

test('style.css: hard shadows only (no blur)', () => {
  for (const [, v] of code.matchAll(/(?:box-shadow|--shadow-[a-z]+)\s*:\s*([^;}]+)/gi)) {
    if (v.trim() === 'none') continue;
    // offset-x offset-y [blur] color: a third length other than 0 is a blur
    const lengths = v.match(/-?\d+(\.\d+)?px|\b0\b/g) || [];
    assert.ok(lengths.length <= 3, `unexpected shadow: ${v}`);
    if (lengths.length === 3) assert.match(lengths[2], /^0(px)?$/, `blurred shadow: ${v}`);
  }
});

test('style.css: Global Constraints colors are defined on :root', () => {
  const root = (code.match(/:root\s*{([^}]*)}/) || [])[1] || '';
  for (const hex of ['#f6efe3', '#fffaf0', '#3a2a1f', '#6f5d4d', '#9a8878', '#2f6b66', '#d9663f']) {
    assert.match(root, new RegExp(`--[a-z-]+\\s*:\\s*${hex}\\b`, 'i'), `missing ${hex}`);
  }
});

test('style.css: frame is a centered single column of at most 480px', () => {
  assert.match(code, /\.frame\s*{[^}]*max-width\s*:\s*480px/);
});

test('style.css: defines the shared component classes', () => {
  for (const sel of ['.frame', '.panel', '.in', '.chip', '.chip.on', '.btn', '.btn.primary', '.badge', '.sec', '.it', '.toast']) {
    const re = new RegExp(sel.replace(/\./g, '\\.') + '\\s*[{,]');
    assert.match(code, re, `missing ${sel}`);
  }
});
