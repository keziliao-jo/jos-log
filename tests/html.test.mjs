import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const head = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, ''); // noscript fallback is allowed to block
const tags = (src, name) => src.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3]) : null;
};
const isExternal = (href) => /^(https?:)?\/\//i.test(href || '');

test('index.html: external stylesheets load without blocking first paint', () => {
  const external = tags(head, 'link').filter((t) => attr(t, 'rel') === 'stylesheet' && isExternal(attr(t, 'href')));
  assert.ok(external.length > 0, 'expected the IBM Plex Mono stylesheet');
  for (const t of external) {
    assert.equal(attr(t, 'media'), 'print', `external stylesheet must start as media="print": ${t}`);
    assert.match(attr(t, 'onload') || '', /this\.media\s*=\s*'all'/, `missing onload media swap: ${t}`);
  }
});

test('index.html: a noscript fallback loads the same external stylesheet', () => {
  const external = tags(head, 'link')
    .filter((t) => attr(t, 'rel') === 'stylesheet' && isExternal(attr(t, 'href')))
    .map((t) => attr(t, 'href'));
  const noscript = (html.match(/<noscript>([\s\S]*?)<\/noscript>/gi) || []).join('');
  for (const href of external) assert.ok(noscript.includes(`href="${href}"`), `no noscript fallback for ${href}`);
});

test('index.html: Google Fonts request uses display=swap and keeps preconnect', () => {
  const fonts = tags(head, 'link').map((t) => attr(t, 'href') || '').filter((h) => h.includes('fonts.googleapis.com/css'));
  assert.ok(fonts.length > 0);
  for (const h of fonts) assert.match(h, /[?&]display=swap\b/);
  const pre = tags(html, 'link').filter((t) => attr(t, 'rel') === 'preconnect').map((t) => attr(t, 'href'));
  assert.ok(pre.includes('https://fonts.googleapis.com'));
  assert.ok(pre.includes('https://fonts.gstatic.com'));
});

test('index.html: viewport and theme-color meta are present', () => {
  const metas = tags(html, 'meta');
  const viewport = metas.find((t) => attr(t, 'name') === 'viewport');
  assert.ok(viewport, 'missing viewport meta');
  assert.match(attr(viewport, 'content'), /width=device-width/);
  assert.match(attr(viewport, 'content'), /viewport-fit=cover/);
  const theme = metas.find((t) => attr(t, 'name') === 'theme-color');
  assert.ok(theme, 'missing theme-color meta');
  assert.equal(attr(theme, 'content'), '#f6efe3');
});

test('index.html: the rel="icon" link has no type (app.js swaps in an SVG data URI)', () => {
  const icon = tags(html, 'link').find((t) => attr(t, 'rel') === 'icon');
  assert.ok(icon);
  assert.equal(attr(icon, 'type'), null);
});
