import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const read = (p) => readFileSync(join(WEB, p), 'utf8');

// Evaluate sw.js in a vm with a stub `self` and read the ASSETS / CACHE constants it defines.
function loadSw() {
  const src = read('sw.js');
  const self = { addEventListener() {}, location: { origin: 'http://localhost' }, skipWaiting() {}, clients: { claim() {} } };
  const ctx = vm.createContext({ self, URL, Response, console });
  vm.runInContext(src + '\n;globalThis.__out = { ASSETS: typeof ASSETS === "undefined" ? undefined : ASSETS, CACHE: typeof CACHE === "undefined" ? undefined : CACHE };', ctx);
  return { src, ...ctx.__out };
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const resolveAsset = (a) => (a === './' ? 'index.html' : a.replace(/^\.\//, ''));

test('sw.js: defines CACHE and an ASSETS array of relative paths', () => {
  const { ASSETS, CACHE } = loadSw();
  assert.match(CACHE, /^jos-log-v\d+$/);
  assert.ok(Array.isArray(ASSETS) && ASSETS.length > 0);
  for (const a of ASSETS) assert.match(a, /^\.\//, `asset must be relative to the SW: ${a}`);
});

test('sw.js: every ASSETS entry exists under web/', () => {
  const { ASSETS } = loadSw();
  for (const a of ASSETS) assert.ok(existsSync(join(WEB, resolveAsset(a))), `missing asset: ${a}`);
});

test('sw.js: every file under web/ (except sw.js) is listed in ASSETS', () => {
  const { ASSETS } = loadSw();
  const listed = new Set(ASSETS.map(resolveAsset));
  assert.ok(ASSETS.includes('./'), 'the app root ./ must be cached');
  for (const f of walk(WEB)) {
    const rel = relative(WEB, f).split(sep).join('/');
    if (rel === 'sw.js' || rel === '.DS_Store') continue;
    assert.ok(listed.has(rel), `not cached offline: ${rel}`);
  }
});

test('manifest: standalone PWA with the expected identity and icons', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, "jo's log");
  assert.equal(m.short_name, "jo's log");
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.equal(m.theme_color, '#f6efe3');
  assert.equal(m.background_color, '#f6efe3');
  assert.equal(m.lang, 'zh-Hant');
  const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose || 'any'}`).sort();
  assert.deepEqual(sizes, ['192x192:any', '512x512:any', '512x512:maskable']);
  for (const i of m.icons) {
    assert.equal(i.type, 'image/png');
    assert.ok(existsSync(join(WEB, i.src)), `icon missing: ${i.src}`);
  }
});

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
test('icons: PNG signature, IHDR size and 8-bit RGB(A)', () => {
  const expected = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180, 'icon-maskable-512.png': 512 };
  for (const [file, size] of Object.entries(expected)) {
    const buf = readFileSync(join(WEB, 'icons', file));
    assert.ok(buf.subarray(0, 8).equals(PNG_SIG), `${file}: bad signature`);
    assert.equal(buf.toString('latin1', 12, 16), 'IHDR');
    assert.equal(buf.readUInt32BE(16), size, `${file}: width`);
    assert.equal(buf.readUInt32BE(20), size, `${file}: height`);
    assert.equal(buf[24], 8, `${file}: bit depth`);
    assert.ok(buf[25] === 2 || buf[25] === 6, `${file}: color type must be RGB or RGBA`);
  }
});

test('index.html: links the manifest and icons with relative hrefs', () => {
  const html = read('index.html');
  assert.match(html, /<link[^>]*rel="manifest"[^>]*href="manifest\.webmanifest"/);
  assert.match(html, /<link[^>]*rel="apple-touch-icon"[^>]*href="icons\/apple-touch-icon\.png"/);
  assert.match(html, /<link[^>]*rel="icon"[^>]*href="icons\/icon-192\.png"/);
  assert.match(html, /<meta[^>]*name="apple-mobile-web-app-capable"[^>]*content="yes"/);
  assert.match(html, /<meta[^>]*name="apple-mobile-web-app-title"[^>]*content="jo's log"/);
  assert.match(html, /<meta[^>]*name="apple-mobile-web-app-status-bar-style"[^>]*content="default"/);
});

test('no root-absolute href/src/start_url in index.html, manifest or sw.js', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/\b(?:href|src)\s*=\s*"([^"]*)"/g)) assert.ok(!m[1].startsWith('/') || m[1].startsWith('//'), `root-absolute URL in index.html: ${m[1]}`);
  for (const m of html.matchAll(/\b(?:href|src)\s*=\s*"(\/\/[^"]*)"/g)) assert.fail(`protocol-relative URL: ${m[1]}`);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const urls = [manifest.start_url, manifest.scope, ...manifest.icons.map((i) => i.src)];
  for (const u of urls) assert.ok(!u.startsWith('/'), `root-absolute manifest URL: ${u}`);
  const { ASSETS, src } = loadSw();
  for (const a of ASSETS) assert.ok(!a.startsWith('/'), `root-absolute SW asset: ${a}`);
  assert.ok(!/(['"`])\/[^/'"`\s]/.test(src), 'sw.js must not contain root-absolute string URLs');
});

test('sw.js: never hard-codes a URL and ignores cross-origin requests', () => {
  const { src } = loadSw();
  assert.ok(!src.includes('script.google.com'));
  assert.ok(!/https?:\/\//i.test(src), 'no absolute URL in sw.js');
  const fetchHandler = src.slice(src.indexOf("addEventListener('fetch'"));
  assert.ok(fetchHandler.length > 0, 'missing fetch handler');
  assert.match(fetchHandler, /url\.origin\s*!==\s*(self\.)?location\.origin/);
  assert.match(fetchHandler, /request\.method\s*!==\s*'GET'/);
  // Both guards come before any respondWith.
  assert.ok(fetchHandler.indexOf('url.origin') < fetchHandler.indexOf('respondWith'));
  assert.ok(fetchHandler.indexOf("request.method") < fetchHandler.indexOf('respondWith'));
});

test('sw.js: install precaches and activate prunes only jos-log- caches', () => {
  const { src } = loadSw();
  assert.match(src, /cache\.addAll\(ASSETS\.map\(/);
  assert.match(src, /new Request\([^)]*\{\s*cache:\s*'reload'\s*\}\)/);
  assert.match(src, /skipWaiting\(\)/);
  assert.match(src, /startsWith\('jos-log-'\)/);
  assert.match(src, /clients\.claim\(\)/);
});

test('app.js: registers sw.js with a relative URL only on https or localhost', () => {
  const src = read('js/app.js');
  assert.match(src, /serviceWorker\.register\('sw\.js'\)/);
  assert.match(src, /'serviceWorker' in navigator/);
  assert.match(src, /location\.protocol === 'https:'/);
  assert.match(src, /localhost/);
});

test('sw.js: revalidation bypasses the HTTP cache, awaits the cache write, and documents when to bump CACHE', () => {
  const { src } = loadSw();
  assert.match(src, /fetch\(request,\s*\{\s*cache:\s*'no-cache'\s*\}\)/);
  // a navigate Request is not safely copied with an init (older engines throw): fetched by URL instead
  assert.match(src, /fetch\(request\.url,\s*\{\s*cache:\s*'no-cache',\s*redirect:\s*'manual'\s*\}\)/);
  assert.match(src, /return cache\.put\(/);
  assert.match(src, /bump CACHE when any module's exports or the queue\/cache storage format change/);
});
