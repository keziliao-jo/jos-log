import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jIconSvg, jPixels, tickSvg } from '../web/js/icon.js';

const INK = '#3a2a1f';
const TEAL = '#2f6b66';
const CREAM = '#fffaf0';

test('jIconSvg: 18x18 viewBox, crisp edges, 526 rects (244 shadow + 244 tile + 38 J)', () => {
  const svg = jIconSvg(2);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox="0 0 18 18"'));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  assert.ok(svg.includes('width="36"') && svg.includes('height="36"'));
  assert.equal((svg.match(/<rect/g) || []).length, 526);
});

test('jPixels: draw order shadow, tile (ink border + teal), cream J', () => {
  const px = jPixels();
  assert.equal(px.length, 526);
  const shadow = px.slice(0, 244);
  const tile = px.slice(244, 488);
  const j = px.slice(488);
  assert.ok(shadow.every((p) => p.fill === INK && p.x >= 2 && p.y >= 2));
  assert.ok(tile.every((p) => (p.fill === INK || p.fill === TEAL) && p.x < 16 && p.y < 16));
  assert.ok(j.every((p) => p.fill === CREAM));
  assert.equal(j.length, 38);
  // stair-step corners: the 3 corner cells of each corner are cut
  const at = (x, y) => tile.find((p) => p.x === x && p.y === y);
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [15, 15], [14, 15], [15, 14], [15, 0], [0, 15]]) {
    assert.equal(at(x, y), undefined, `corner cell ${x},${y} must be cut`);
  }
  assert.equal(at(1, 1).fill, INK); // stair edge is border
  assert.equal(at(2, 0).fill, INK); // top edge is border
  assert.equal(at(5, 5).fill, TEAL); // interior is teal
  // J is centered at offset (3, 3): top-left stem cell at (7, 3), bottom row starts at (5, 12)
  assert.ok(j.some((p) => p.x === 7 && p.y === 3));
  assert.ok(j.some((p) => p.x === 5 && p.y === 12));
  assert.ok(j.every((p) => p.x >= 3 && p.x < 12 && p.y >= 3 && p.y < 13));
});

test('tickSvg: 7x6 pixel check in currentColor', () => {
  const svg = tickSvg();
  assert.ok(svg.includes('viewBox="0 0 7 6"'));
  assert.ok(svg.includes('currentColor'));
  assert.equal((svg.match(/<rect/g) || []).length, 14); // 1+2+3+4+3+1 cells
});
