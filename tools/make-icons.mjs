// Renders the PWA / home-screen icons from the J pixel art in web/js/icon.js.
// Usage: node tools/make-icons.mjs   (writes web/icons/*.png; only node:zlib, no dependencies)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jPixels } from '../web/js/icon.js';

const GRID = 18;
const BG = [0xf6, 0xef, 0xe3]; // #f6efe3, the app background

// ---- minimal PNG encoder (8-bit RGB, no interlace) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height); // each row starts with filter byte 0
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- icon rendering ----
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Cream square with the 18x18 icon centred, nearest-neighbour scaled by the largest whole factor
// that keeps it within maxFill of the canvas width. Cells the icon leaves empty show the cream.
export function renderIcon(size, maxFill) {
  const scale = Math.max(1, Math.floor((size * maxFill) / GRID));
  const span = GRID * scale;
  const off = Math.floor((size - span) / 2);
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) rgb.set(BG, i * 3);
  for (const p of jPixels()) {
    const c = hex(p.fill);
    for (let dy = 0; dy < scale; dy++) {
      const row = ((off + p.y * scale + dy) * size + off + p.x * scale) * 3;
      for (let dx = 0; dx < scale; dx++) rgb.set(c, row + dx * 3);
    }
  }
  return encodePng(size, size, rgb);
}

const OUT = fileURLToPath(new URL('../web/icons/', import.meta.url));
const TARGETS = [
  ['icon-192.png', 192, 0.72],
  ['icon-512.png', 512, 0.72],
  ['apple-touch-icon.png', 180, 0.72],
  ['icon-maskable-512.png', 512, 0.62], // extra margin: Android masks crop the outer edge
];

mkdirSync(OUT, { recursive: true });
for (const [name, size, fill] of TARGETS) {
  const png = renderIcon(size, fill);
  writeFileSync(OUT + name, png);
  console.log(`${name}: ${size}x${size}, ${png.length} bytes`);
}
