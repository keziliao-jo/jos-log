// App shell: header (icon, brand, sync status), hash router, bottom nav.
//
// View contract: each `ui-<route>.js` exports render(container, ctx) -> cleanup, where
//   ctx = { store, today, navigate, query,          // the core contract
//           toast(msg), setNote(text),              // shell helpers: toast, header right line
//           storage, config, reconfigure(hash?),    // used by Settings
//           volatileStorage }                       // true when localStorage is blocked (memory only)
// Routes: #/log  #/week  #/all  #/settings, each with an optional query (#/log?date=2026-11-16).

import { createApi } from './api.js';
import { createQueue } from './queue.js';
import { createStore } from './store.js';
import { loadConfig, isConfigured } from './config.js';
import { todayStr, missingImpact } from './model.js';
import { jIconSvg } from './icon.js';
import { headerText } from './ui-settings.js';

const ROUTES = ['log', 'week', 'all', 'settings'];
const NAV_ROUTES = ['log', 'week', 'all'];

// localStorage can throw (blocked site data); fall back to memory so the app still opens.
// Settings warns when that happens (volatileStorage): queued entries die with the page.
let volatileStorage = false;
function pickStorage() {
  try {
    const s = window.localStorage;
    const k = 'jos_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch (_) {
    volatileStorage = true;
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => void m.set(k, String(v)),
      removeItem: (k) => void m.delete(k),
      key: (i) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
  }
}

const storage = pickStorage();
const today = () => todayStr(new Date());

const $ = (id) => document.getElementById(id);
const els = {
  icon: $('icon'),
  note: $('note'),
  status: $('status'),
  main: $('main'),
  nav: $('nav'),
  badge: $('week-badge'),
  toast: $('toast'),
};

let config = { url: '', token: '' };
let store = null; // null until a URL and token are saved
let unsubChrome = null;
let cleanup = null;
let seq = 0; // guards against a slow import finishing after a later navigation
let toastTimer = null;

// ---------- data objects ----------

function build() {
  if (unsubChrome) unsubChrome();
  unsubChrome = null;
  config = loadConfig(storage);
  store = null;
  if (isConfigured(config)) {
    const api = createApi({ url: config.url, token: config.token });
    const queue = createQueue(storage);
    store = createStore({ api, queue, storage, onNotice: (msg) => toast(msg, 4000) });
    unsubChrome = store.subscribe(paintChrome);
    store.load().catch((err) => console.error(err));
  }
  paintChrome();
}

// ---------- header + nav ----------

function paintChrome() {
  els.nav.hidden = !store;
  if (!store) {
    els.status.textContent = '';
    els.status.hidden = true;
    els.badge.hidden = true;
    return;
  }
  const s = store.getState();
  els.status.hidden = false;
  els.status.textContent = headerText(s);
  els.status.classList.toggle('alert', s.status === 'auth');
  const n = missingImpact(s.entries, today()).length;
  els.badge.textContent = String(n);
  els.badge.title = `${n} 筆待補 Impact`;
  els.badge.hidden = n === 0;
}

function setNote(text) {
  els.note.textContent = text || '';
}

function toast(msg, ms = 2000) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, ms);
}

// ---------- router ----------

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const i = raw.indexOf('?');
  const name = i < 0 ? raw : raw.slice(0, i);
  const qs = i < 0 ? '' : raw.slice(i + 1);
  return { name, query: new URLSearchParams(qs) };
}

function replaceHash(hash) {
  history.replaceState(null, '', hash);
}

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function reconfigure(hash) {
  build();
  if (hash) navigate(hash);
  else route();
}

function placeholder(text) {
  const p = document.createElement('div');
  p.className = 'panel';
  const t = document.createElement('p');
  t.className = 'muted';
  t.style.margin = '0';
  t.textContent = text;
  p.append(t);
  els.main.append(p);
}

async function route() {
  let { name, query } = parseHash();
  if (!store) {
    if (name !== 'settings') replaceHash('#/settings');
    name = 'settings';
  } else if (!ROUTES.includes(name)) {
    replaceHash('#/log');
    name = 'log';
    query = new URLSearchParams();
  }

  const mine = ++seq;
  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(err);
    }
    cleanup = null;
  }
  els.main.replaceChildren();
  setNote('');
  for (const a of els.nav.querySelectorAll('a[data-route]')) {
    const on = a.dataset.route === name && NAV_ROUTES.includes(name);
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  let mod = null;
  try {
    mod = await import(`./ui-${name}.js`);
  } catch (_) {
    mod = null; // a view not built yet
  }
  if (mine !== seq) return;
  if (!mod || typeof mod.render !== 'function') {
    placeholder('尚未提供');
    return;
  }

  const ctx = { store, today, navigate, query, toast, setNote, storage, config, reconfigure, volatileStorage };
  try {
    const c = mod.render(els.main, ctx);
    cleanup = typeof c === 'function' ? c : null;
  } catch (err) {
    console.error(err);
    els.main.replaceChildren();
    placeholder('畫面載入失敗，請重新整理。');
  }
  window.scrollTo(0, 0);
}

// ---------- boot ----------

function boot() {
  const svg = jIconSvg(2);
  els.icon.innerHTML = svg;
  const fav = document.querySelector('link[rel="icon"]');
  if (fav) fav.href = 'data:image/svg+xml,' + encodeURIComponent(jIconSvg(1));

  build();
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => {
    if (store) store.refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    paintChrome(); // the date may have changed while hidden
    if (store) store.refresh();
  });
  route();
  registerServiceWorker();
}

// Offline app shell. Only over https or localhost (not file:); a failure never affects the app.
function registerServiceWorker() {
  try {
    const host = location.hostname;
    const ok = location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
    if (!('serviceWorker' in navigator) || !ok) return;
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('service worker not registered', err));
  } catch (err) {
    console.warn('service worker not registered', err);
  }
}

boot();
