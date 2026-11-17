// The two pixel elements of the design (spec section 7): the J app icon and the 7x6 check.
// jPixels() is the single source for the icon; Task 10 renders the PNG icons from it.

const INK = '#3a2a1f';
const TEAL = '#2f6b66';
const CREAM = '#fffaf0';

const TILE = 16; // tile is 16x16 cells
const GRID = 18; // plus a 2-cell hard shadow to the lower right
const CUT = 2; // stair-step corner depth

const J = [
  '....###..',
  '....###..',
  '....###..',
  '....###..',
  '....###..',
  '....###..',
  '###.###..',
  '###.###..',
  '.#####...',
  '..###....',
];

const TICK = ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'];

function inTile(x, y) {
  if (x < 0 || y < 0 || x >= TILE || y >= TILE) return false;
  return Math.min(x, TILE - 1 - x) + Math.min(y, TILE - 1 - y) >= CUT;
}

// One { x, y, fill } per cell in draw order: shadow, tile (ink border + teal), J.
export function jPixels() {
  const out = [];
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) if (inTile(x, y)) out.push({ x: x + 2, y: y + 2, fill: INK });
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      if (!inTile(x, y)) continue;
      const edge = !inTile(x - 1, y) || !inTile(x + 1, y) || !inTile(x, y - 1) || !inTile(x, y + 1);
      out.push({ x, y, fill: edge ? INK : TEAL });
    }
  const ox = Math.floor((TILE - J[0].length) / 2);
  const oy = Math.floor((TILE - J.length) / 2);
  J.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') out.push({ x: x + ox, y: y + oy, fill: CREAM });
  });
  return out;
}

const rect = (x, y, fill) => `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;

export function jIconSvg(scale = 2) {
  const size = GRID * scale;
  const body = jPixels().map((p) => rect(p.x, p.y, p.fill)).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${size}" height="${size}" ` +
    `shape-rendering="crispEdges" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

// 7x6 pixel check, drawn in currentColor so the container sets its color.
export function tickSvg() {
  let body = '';
  TICK.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') body += rect(x, y, 'currentColor');
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 6" width="14" height="12" ` +
    `shape-rendering="crispEdges" aria-hidden="true" focusable="false">${body}</svg>`
  );
}
