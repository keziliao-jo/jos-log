import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../web/js/store.js';
import { loadConfig, saveConfig, isConfigured } from '../web/js/config.js';
import { createQueue } from '../web/js/queue.js';
import { ApiError, NetworkError } from '../web/js/api.js';

function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    raw: m,
  };
}

const row = (id, extra = {}) => ({
  id,
  date: '2026-11-17',
  project: '',
  what_i_did: `did ${id}`,
  impact: '',
  stakeholders: '',
  feedback: '',
  created_at: '2026-11-17T01:00:00.000Z',
  updated_at: '2026-11-17T01:00:00.000Z',
  ...extra,
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

// In-memory stand-in for the server. `down` makes every call a NetworkError;
// `loseFirstAdd` stores the first add but throws NetworkError (a lost response).
function memApi({ loseFirstAdd = false } = {}) {
  const rows = new Map();
  const api = {
    down: false,
    loseFirstAdd,
    calls: [],
    rows,
    async list() {
      api.calls.push('list');
      if (api.down) throw new NetworkError('down');
      return [...rows.values()].map((r) => ({ ...r }));
    },
    async add(entry) {
      api.calls.push('add');
      if (api.down) throw new NetworkError('down');
      if (!rows.has(entry.id)) rows.set(entry.id, { ...entry });
      if (api.loseFirstAdd) {
        api.loseFirstAdd = false;
        throw new NetworkError('response lost');
      }
      return rows.get(entry.id);
    },
    async update(patch) {
      api.calls.push('update');
      if (api.down) throw new NetworkError('down');
      if (!rows.has(patch.id)) throw new ApiError('not_found');
      Object.assign(rows.get(patch.id), patch);
      return rows.get(patch.id);
    },
    async remove(id) {
      api.calls.push('remove');
      if (api.down) throw new NetworkError('down');
      if (!rows.has(id)) throw new ApiError('not_found');
      rows.delete(id);
    },
  };
  return api;
}

function makeStore(over = {}) {
  const storage = over.storage || memStorage();
  const api = over.api || memApi();
  const queue = over.queue || createQueue(storage);
  let n = 0;
  let t = 0;
  const store = createStore({
    api,
    queue,
    storage,
    now: () => new Date(Date.UTC(2026, 10, 17, 2, 0, t++)).toISOString(),
    id: () => `id${++n}`,
    ...over.opts,
  });
  return { store, api, queue, storage };
}

// ---- config ----

test('config round-trips and corrupt JSON gives an empty config', () => {
  const s = memStorage();
  assert.deepEqual(loadConfig(s), { url: '', token: '' });
  saveConfig(s, { url: 'https://x/exec', token: 'tok' });
  assert.deepEqual(loadConfig(s), { url: 'https://x/exec', token: 'tok' });
  assert.ok(isConfigured(loadConfig(s)));
  assert.ok(!isConfigured({ url: '', token: 'x' }));
  assert.ok(!isConfigured({ url: 'u', token: ' ' }));
  for (const bad of ['{not json', '[]', '"s"', 'null', '5']) {
    assert.deepEqual(loadConfig(memStorage({ jos_config: bad })), { url: '', token: '' });
  }
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem() {} };
  assert.deepEqual(loadConfig(throwing), { url: '', token: '' });
});

// ---- load / cache ----

test('load() emits cached entries before api.list resolves, and caches the fresh list', async () => {
  const storage = memStorage({ jos_cache: JSON.stringify([row('c1')]) });
  const gate = deferred();
  const api = memApi();
  api.list = () => gate.promise;
  const { store } = makeStore({ storage, api });
  const seen = [];
  store.subscribe((s) => seen.push(s));
  const p = store.load();
  assert.equal(store.getState().hasLoaded, true);
  assert.deepEqual(store.getState().entries.map((e) => e.id), ['c1']);
  assert.equal(store.getState().status, 'syncing');
  assert.ok(seen.length >= 1);
  gate.resolve([row('s1')]);
  await p;
  assert.deepEqual(store.getState().entries.map((e) => e.id), ['s1']);
  assert.equal(store.getState().status, 'synced');
  assert.deepEqual(JSON.parse(storage.getItem('jos_cache')).map((e) => e.id), ['s1']);
});

test('corrupt or non-array cache is ignored by load()', async () => {
  for (const bad of ['{oops', '{"a":1}', 'null', '"x"']) {
    const { store } = makeStore({ storage: memStorage({ jos_cache: bad }) });
    await store.load();
    assert.deepEqual(store.getState().entries, []);
    assert.equal(store.getState().hasLoaded, true);
    assert.equal(store.getState().status, 'synced');
  }
});

test('a getItem that throws on the cache does not break load()', async () => {
  const base = memStorage();
  const storage = {
    getItem: (k) => {
      if (k === 'jos_cache') throw new Error('denied');
      return base.getItem(k);
    },
    setItem: base.setItem,
  };
  const api = memApi();
  api.rows.set('s1', row('s1'));
  const { store } = makeStore({ storage, api, queue: createQueue(base) });
  await store.load();
  assert.deepEqual(store.getState().entries.map((e) => e.id), ['s1']);
});

test('a failing cache setItem does not break refresh', async () => {
  const base = memStorage();
  const storage = {
    getItem: base.getItem,
    setItem: (k, v) => {
      if (k === 'jos_cache') throw new Error('quota');
      base.setItem(k, v);
    },
  };
  const api = memApi();
  api.rows.set('s1', row('s1'));
  const { store } = makeStore({ storage, api, queue: createQueue(base) });
  await store.refresh();
  assert.equal(store.getState().status, 'synced');
  assert.deepEqual(store.getState().entries.map((e) => e.id), ['s1']);
});

test('entries with deleted === "1" are not shown', async () => {
  const api = memApi();
  api.rows.set('a', row('a'));
  api.rows.set('b', row('b', { deleted: '1' }));
  const { store } = makeStore({ api });
  await store.refresh();
  assert.deepEqual(store.getState().entries.map((e) => e.id), ['a']);
});

// ---- add ----

test('add is visible immediately with pending 1 before the API responds; blank throws', async () => {
  const gate = deferred();
  const api = memApi();
  api.add = () => gate.promise;
  const { store, queue } = makeStore({ api });
  const e = store.add({ what_i_did: '  wrote spec  ', date: '' });
  assert.equal(e.what_i_did, 'wrote spec');
  assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(store.getState().entries.map((x) => x.id), [e.id]);
  assert.equal(store.getState().pending, 1);
  assert.equal(store.getState().status, 'syncing');

  assert.throws(() => store.add({ what_i_did: '   ' }));
  assert.throws(() => store.add({}));
  assert.equal(queue.all().length, 1);
  gate.resolve({});
});

test('add keeps an explicit date', () => {
  const { store } = makeStore({ api: memApi() });
  const e = store.add({ what_i_did: 'x', date: '2026-01-02' });
  assert.equal(e.date, '2026-01-02');
});

test('add when the queue storage throws: error propagates and state is unchanged', () => {
  const base = memStorage();
  const storage = {
    getItem: base.getItem,
    setItem: () => {
      throw new Error('QuotaExceeded');
    },
  };
  const { store } = makeStore({ storage });
  const before = store.getState();
  assert.throws(() => store.add({ what_i_did: 'x' }), /QuotaExceeded/);
  assert.equal(store.getState(), before);
  assert.deepEqual(store.getState().entries, []);
  assert.equal(store.getState().pending, 0);
});

test('offline add stays visible (offline, pending 1); a later refresh sends it once', async () => {
  const api = memApi();
  api.down = true;
  const { store } = makeStore({ api });
  const e = store.add({ what_i_did: 'offline work' });
  await store.refresh();
  assert.equal(store.getState().status, 'offline');
  assert.equal(store.getState().pending, 1);
  assert.deepEqual(store.getState().entries.map((x) => x.id), [e.id]);

  api.down = false;
  await store.refresh();
  assert.equal(store.getState().status, 'synced');
  assert.equal(store.getState().pending, 0);
  assert.equal(api.rows.size, 1);
  assert.ok(!api.calls.includes('update'));
  assert.deepEqual(store.getState().entries.map((x) => x.id), [e.id]);
});

// ---- single flight ----

test('two concurrent refresh() calls make one api.add call', async () => {
  const gate = deferred();
  const api = memApi();
  const realAdd = api.add;
  api.add = async (e) => {
    await gate.promise;
    return realAdd(e);
  };
  const { store } = makeStore({ api });
  store.add({ what_i_did: 'x' });
  const p1 = store.refresh();
  const p2 = store.refresh();
  assert.equal(p1, p2);
  gate.resolve();
  await Promise.all([p1, p2]);
  assert.equal(api.calls.filter((c) => c === 'add').length, 1);
  assert.equal(store.getState().status, 'synced');
  assert.equal(store.getState().pending, 0);
});

test('an edit enqueued while a sync is running is sent by a follow-up pass in the same refresh', async () => {
  const gate = deferred();
  const api = memApi();
  const realAdd = api.add;
  api.add = async (e) => {
    await gate.promise;
    return realAdd(e);
  };
  const { store } = makeStore({ api });
  const e = store.add({ what_i_did: 'first' });
  store.update(e.id, { impact: 'late edit' });
  assert.equal(store.getState().pending, 2);
  gate.resolve();
  await store.refresh();
  assert.equal(store.getState().pending, 0);
  assert.equal(store.getState().status, 'synced');
  assert.equal(api.rows.get(e.id).impact, 'late edit');
  assert.equal(api.rows.size, 1);
});

// ---- statuses ----

test('auth error sets status auth and keeps pending ops and entries', async () => {
  const api = memApi();
  api.add = async () => {
    throw new ApiError('auth');
  };
  const { store, queue } = makeStore({ api });
  const e = store.add({ what_i_did: 'keep me' });
  await store.refresh();
  assert.equal(store.getState().status, 'auth');
  assert.equal(store.getState().pending, 1);
  assert.equal(queue.all().length, 1);
  assert.deepEqual(store.getState().entries.map((x) => x.id), [e.id]);
  assert.ok(!api.calls.includes('list'));
});

test('api.list auth error -> auth; NetworkError -> offline keeping cache; other ApiError -> pending', async () => {
  const storage = memStorage({ jos_cache: JSON.stringify([row('c1')]) });
  const api = memApi();
  const { store } = makeStore({ storage, api });
  await store.load(); // list works
  assert.equal(store.getState().status, 'synced');

  api.list = async () => {
    throw new ApiError('auth');
  };
  await store.refresh();
  assert.equal(store.getState().status, 'auth');

  api.list = async () => {
    throw new NetworkError('x');
  };
  await store.refresh();
  assert.equal(store.getState().status, 'offline');

  api.list = async () => {
    throw new ApiError('server');
  };
  await store.refresh();
  assert.equal(store.getState().status, 'pending');

  api.list = async () => {
    throw new TypeError('boom');
  };
  await store.refresh();
  assert.equal(store.getState().status, 'pending');
});

test('failed list keeps the cached server entries (plus pending overlay)', async () => {
  const storage = memStorage({ jos_cache: JSON.stringify([row('c1')]) });
  const api = memApi();
  api.down = true;
  const { store } = makeStore({ storage, api });
  await store.load();
  assert.equal(store.getState().status, 'offline');
  assert.deepEqual(store.getState().entries.map((e) => e.id), ['c1']);
  const e = store.add({ what_i_did: 'x' });
  await store.refresh();
  assert.deepEqual(store.getState().entries.map((x) => x.id).sort(), ['c1', e.id].sort());
});

test('sync error server -> pending and api.list is not called', async () => {
  const api = memApi();
  api.add = async () => {
    throw new ApiError('server');
  };
  const { store } = makeStore({ api });
  store.add({ what_i_did: 'x' });
  await store.refresh();
  assert.equal(store.getState().status, 'pending');
  assert.equal(store.getState().pending, 1);
  assert.ok(!api.calls.includes('list'));
});

test('a rejecting sync leaves status pending and does not throw out of refresh', async () => {
  const storage = memStorage();
  const real = createQueue(storage);
  const queue = {
    all: () => real.all(),
    enqueue: (op) => real.enqueue(op),
    markAttempted: (id) => real.markAttempted(id),
    remove: () => {
      throw new Error('storage failure');
    },
  };
  const { store, api } = makeStore({ storage, queue });
  const e = store.add({ what_i_did: 'x' });
  await store.refresh(); // must not reject
  assert.equal(store.getState().status, 'pending');
  assert.equal(store.getState().pending, 1);
  assert.deepEqual(store.getState().entries.map((x) => x.id), [e.id]);
  assert.ok(!api.calls.includes('list'));
});

test('a queue whose all() throws during refresh does not reject refresh', async () => {
  const storage = memStorage();
  const real = createQueue(storage);
  let boom = false;
  const queue = {
    all: () => {
      if (boom) throw new Error('getItem failed');
      return real.all();
    },
    enqueue: (op) => real.enqueue(op),
    markAttempted: (id) => real.markAttempted(id),
    remove: (id) => real.remove(id),
  };
  const { store } = makeStore({ storage, queue });
  const e = store.add({ what_i_did: 'x' });
  boom = true;
  await store.refresh();
  assert.equal(store.getState().status, 'pending');
  assert.deepEqual(store.getState().entries.map((x) => x.id), [e.id]);
});

// ---- update / remove ----

test('update sets updated_at to now(), trims, and only touches editable fields', async () => {
  const api = memApi();
  api.down = true;
  const { store, queue } = makeStore({ api });
  const e = store.add({ what_i_did: 'x' });
  await store.refresh();
  store.update(e.id, { impact: '  big  ', id: 'hacked', created_at: 'nope', deleted: '1', bogus: 1 });
  const cur = store.getState().entries.find((x) => x.id === e.id);
  assert.equal(cur.impact, 'big');
  assert.equal(cur.id, e.id);
  assert.equal(cur.created_at, e.created_at);
  assert.ok(cur.updated_at > e.updated_at);
  const ops = queue.all();
  const upd = ops.find((o) => o.type === 'update');
  assert.ok(upd.opId.startsWith('op_'));
  assert.deepEqual(Object.keys(upd.entry).sort(), ['id', 'impact', 'updated_at']);
  assert.equal(store.getState().pending, ops.length);
});

test('update rejects blanking what_i_did; unknown id is a no-op', () => {
  const { store, queue } = makeStore({ api: memApi() });
  const e = store.add({ what_i_did: 'x' });
  const n = queue.all().length;
  assert.throws(() => store.update(e.id, { what_i_did: '  ' }));
  assert.equal(queue.all().length, n);
  const before = store.getState();
  store.update('missing', { impact: 'y' });
  store.remove('missing');
  assert.equal(queue.all().length, n);
  assert.equal(store.getState(), before);
});

test('remove hides the entry immediately', async () => {
  const api = memApi();
  api.rows.set('s1', row('s1'));
  const { store } = makeStore({ api });
  await store.refresh();
  assert.equal(store.getState().entries.length, 1);
  store.remove('s1');
  assert.equal(store.getState().entries.length, 0);
  assert.equal(store.getState().pending, 1);
  await store.refresh();
  assert.equal(api.rows.size, 0);
  assert.equal(store.getState().pending, 0);
});

// ---- the never-lose-an-entry sequences ----

test('add offline, then update the same entry, then reconnect: server has the EDITED values, one row', async () => {
  const api = memApi();
  api.down = true;
  const { store } = makeStore({ api });
  const e = store.add({ what_i_did: 'draft', project: 'P' });
  await store.refresh(); // add attempted, offline
  store.update(e.id, { what_i_did: 'final', impact: 'shipped' });
  await store.refresh(); // the run update() started, still offline
  assert.equal(store.getState().status, 'offline');
  api.down = false;
  await store.refresh();
  assert.equal(api.rows.size, 1);
  const r = api.rows.get(e.id);
  assert.equal(r.what_i_did, 'final');
  assert.equal(r.impact, 'shipped');
  assert.equal(r.project, 'P');
  assert.equal(store.getState().pending, 0);
  assert.equal(store.getState().status, 'synced');
  assert.equal(store.getState().entries[0].what_i_did, 'final');
});

test('add, lost response, remove, refresh: the server ends with the entry deleted', async () => {
  const api = memApi({ loseFirstAdd: true });
  const { store } = makeStore({ api });
  const e = store.add({ what_i_did: 'oops' });
  await store.refresh();
  assert.equal(api.rows.size, 1); // the lost response still stored it
  store.remove(e.id);
  await store.refresh();
  assert.equal(api.rows.size, 0);
  assert.deepEqual(store.getState().entries, []);
  assert.equal(store.getState().pending, 0);
  assert.equal(store.getState().status, 'synced');
});

// ---- subscribe ----

test('subscribe is not called immediately, fires per change with a new state object, and unsubscribes', () => {
  const { store } = makeStore({ api: memApi() });
  const seen = [];
  const off = store.subscribe((s) => seen.push(s));
  assert.equal(seen.length, 0);
  const s0 = store.getState();
  store.add({ what_i_did: 'x' });
  assert.ok(seen.length >= 1);
  assert.notEqual(store.getState(), s0);
  off();
  const n = seen.length;
  store.add({ what_i_did: 'y' });
  assert.equal(seen.length, n);
});

test('a throwing subscriber does not break the store', async () => {
  const { store } = makeStore({ api: memApi() });
  const origError = console.error;
  console.error = () => {};
  try {
    store.subscribe(() => {
      throw new Error('ui bug');
    });
    const e = store.add({ what_i_did: 'x' });
    assert.ok(e.id);
    assert.equal(store.getState().pending, 1);
    await store.refresh(); // let the add's own refresh finish while console.error is silenced
  } finally {
    console.error = origError;
  }
});

// ---- view between sync and list (no revert while api.list is in flight) ----

test('after a synced add/update/remove and while api.list is still pending, entries show the new state', async () => {
  const api = memApi();
  api.rows.set('s1', row('s1'));
  api.rows.set('s2', row('s2'));
  const { store } = makeStore({ api });
  await store.refresh();

  const realList = api.list;
  let gate = deferred();
  api.list = async () => {
    await gate.promise;
    return realList();
  };

  const e = store.add({ what_i_did: 'new one' });
  store.update('s1', { impact: 'changed' });
  store.remove('s2');
  // let the sync pass finish and reach api.list
  while (!api.calls.includes('remove')) await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(store.getState().status, 'syncing');
  assert.equal(store.getState().pending, 0); // ops have left the queue, list not yet back
  const byId = new Map(store.getState().entries.map((x) => [x.id, x]));
  assert.ok(byId.has(e.id), 'synced add still shown');
  assert.equal(byId.get('s1').impact, 'changed');
  assert.ok(!byId.has('s2'), 'synced remove stays hidden');
  gate.resolve();
  await store.refresh();
  assert.equal(store.getState().status, 'synced');
});

test('partial sync: A sent, B hits a network error; both stay visible, pending 1, offline, cache has A', async () => {
  const storage = memStorage({ jos_cache: '[]' }); // a loaded (empty) cache: folds may be cached
  const api = memApi();
  const realAdd = api.add;
  api.add = async (entry) => {
    if (entry.what_i_did === 'B') throw new NetworkError('down');
    return realAdd(entry);
  };
  const { store } = makeStore({ storage, api });
  await store.load(); // empty server list: real server data is the base, so folds are cached
  const a = store.add({ what_i_did: 'A' });
  const b = store.add({ what_i_did: 'B' });
  await store.refresh();
  assert.equal(store.getState().status, 'offline');
  assert.equal(store.getState().pending, 1);
  assert.deepEqual(store.getState().entries.map((x) => x.id).sort(), [a.id, b.id].sort());
  const cached = JSON.parse(storage.getItem('jos_cache'));
  assert.deepEqual(cached.map((x) => x.id), [a.id]);
});

// ---- rerun flag ----

test('refresh() called while a run is in flight triggers one more pass after it', async () => {
  const gate = deferred();
  const api = memApi();
  const realAdd = api.add;
  let failFirst = true;
  let addCalls = 0;
  api.add = async (entry) => {
    addCalls++;
    if (failFirst) {
      failFirst = false;
      await gate.promise;
      throw new NetworkError('down');
    }
    return realAdd(entry);
  };
  const { store, queue } = makeStore({ api });
  const e = store.add({ what_i_did: 'x' }); // run 1 starts, add is gated
  const p = store.refresh(); // arrives mid-run: asks for a rerun
  assert.equal(store.getState().status, 'syncing');
  gate.resolve();
  await p;
  assert.equal(addCalls, 2); // second pass ran
  assert.equal(queue.all().length, 0);
  assert.equal(store.getState().status, 'synced');
  assert.ok(api.rows.has(e.id));
});

test('add while a refresh is in flight does not request a rerun pass', async () => {
  const gate = deferred();
  const api = memApi();
  const realList = api.list;
  let listCalls = 0;
  api.list = async () => {
    listCalls++;
    await gate.promise;
    return realList();
  };
  const { store } = makeStore({ api });
  const p = store.refresh(); // empty queue, parked in list
  while (listCalls === 0) await new Promise((r) => setImmediate(r));
  assert.equal(listCalls, 1);
  store.add({ what_i_did: 'during list' }); // kicks the shared run without a rerun flag
  gate.resolve();
  await p;
  // the `late` cycle sends the add and lists once more: exactly 2 lists, not 3
  assert.equal(listCalls, 2);
  assert.equal(api.calls.filter((c) => c === 'add').length, 1);
  assert.equal(store.getState().pending, 0);
  assert.equal(store.getState().status, 'synced');
});

// ---- update date handling ----

test('update with a blank date ignores it: date unchanged and nothing enqueued', () => {
  const { store, queue } = makeStore({ api: memApi() });
  const e = store.add({ what_i_did: 'x', date: '2026-02-03' });
  const n = queue.all().length;
  const before = store.getState();
  store.update(e.id, { date: '' });
  store.update(e.id, { date: '   ' });
  assert.equal(queue.all().length, n);
  assert.equal(store.getState(), before);
  assert.equal(store.getState().entries[0].date, '2026-02-03');
  store.update(e.id, { date: '', impact: 'ok' }); // other fields still go through
  assert.equal(store.getState().entries[0].date, '2026-02-03');
  assert.equal(store.getState().entries[0].impact, 'ok');
});

// ---- the fold only covers ops that were really sent ----

// Offline queue [X, A]; a pass starts with X's send gated; mutate mid-pass; the pass then fails.
async function gatedPass(mutate, { cache = '[]', apiOver } = {}) {
  const storage = memStorage({ jos_cache: cache });
  const api = memApi();
  api.down = true;
  const { store, queue } = makeStore({ storage, api });
  const x = store.add({ what_i_did: 'X' });
  const a = store.add({ what_i_did: 'A' });
  await store.refresh(); // all offline; X is attempted, A untouched
  const gate = deferred();
  api.down = false;
  api.add = async (entry) => {
    api.calls.push('add');
    await gate.promise;
    throw new NetworkError('dropped mid-pass');
  };
  if (apiOver) apiOver(api);
  const p = store.refresh();
  while (!api.calls.includes('add')) await new Promise((r) => setImmediate(r));
  mutate({ store, x, a, queue });
  gate.resolve();
  await p;
  return { store, storage, api, x, a, queue };
}

test('remove of an unsent add mid-pass, then the pass fails: the removed entry stays gone and is not cached', async () => {
  const { store, storage, x, a, queue } = await gatedPass(({ store, a }) => store.remove(a.id));
  assert.deepEqual(queue.all().map((o) => o.entry && o.entry.id), [x.id]); // A's add was cancelled, never sent
  const ids = store.getState().entries.map((e) => e.id);
  assert.ok(ids.includes(x.id));
  assert.ok(!ids.includes(a.id));
  assert.ok(!JSON.parse(storage.getItem('jos_cache')).some((e) => e.id === a.id));
});

test('an update merged into an unsent op mid-pass shows the newer value after a failing pass, cached value is not stale', async () => {
  const { store, storage, a } = await gatedPass(({ store, a }) => store.update(a.id, { what_i_did: 'A newer' }));
  assert.equal(store.getState().entries.find((e) => e.id === a.id).what_i_did, 'A newer');
  const cached = JSON.parse(storage.getItem('jos_cache'));
  assert.ok(!cached.some((e) => e.what_i_did === 'A')); // never the stale pre-edit copy
});

test('an op dropped as invalid is not folded in: after a failed list the entry is not shown as applied', async () => {
  const api = memApi();
  api.rows.set('s1', row('s1', { impact: 'old' }));
  const { store } = makeStore({ storage: memStorage({ jos_cache: JSON.stringify([row('s1', { impact: 'old' })]) }), api });
  await store.load();
  api.update = async () => {
    api.calls.push('update');
    throw new ApiError('invalid');
  };
  api.list = async () => {
    throw new NetworkError('down');
  };
  store.update('s1', { impact: 'rejected value' });
  await store.refresh();
  assert.equal(store.getState().pending, 0); // dropped
  assert.equal(store.getState().entries[0].impact, 'old');
});

test('the fold does not write the cache when nothing was ever loaded', async () => {
  const base = memStorage();
  const writes = [];
  const storage = {
    getItem: (k) => {
      if (k === 'jos_cache') throw new Error('cache unreadable');
      return base.getItem(k);
    },
    setItem: (k, v) => {
      writes.push(k);
      base.setItem(k, v);
    },
  };
  const api = memApi();
  api.list = async () => {
    throw new NetworkError('down');
  };
  const { store } = makeStore({ storage, api, queue: createQueue(base) });
  await store.load(); // cache unreadable: nothing loaded
  const e = store.add({ what_i_did: 'x' });
  await store.refresh(); // add sent, list fails: the fold is on screen but must not be cached
  assert.equal(store.getState().pending, 0);
  assert.deepEqual(store.getState().entries.map((x) => x.id), [e.id]);
  assert.ok(!writes.includes('jos_cache'));
});

// ---- Ruling O / P: dates and lengths are validated before anything is queued ----

test('add and update reject an invalid date with Error("invalid date") before enqueueing', () => {
  const { store, queue } = makeStore({ api: memApi() });
  const e = store.add({ what_i_did: 'ok', date: '2026-11-17' });
  const n = queue.all().length;
  const before = store.getState();
  for (const date of ['0026-11-17', '1999-12-31', '2100-01-01', '2023-02-29', '2026-13-01', '202611-11-17', 'tomorrow']) {
    assert.throws(() => store.add({ what_i_did: 'typo year', date }), (err) => err.message === 'invalid date', date);
    assert.throws(() => store.update(e.id, { date }), (err) => err.message === 'invalid date', date);
  }
  assert.equal(queue.all().length, n);
  assert.equal(store.getState(), before);
  store.add({ what_i_did: 'edge', date: '2000-01-01' });
  store.add({ what_i_did: 'edge', date: '2099-12-31' });
  store.update(e.id, { date: '2024-02-29' });
  assert.equal(store.getState().entries.find((x) => x.id === e.id).date, '2024-02-29');
});

test('add and update reject a field over 40000 characters with Error("too long") before enqueueing', () => {
  const { store, queue } = makeStore({ api: memApi() });
  const e = store.add({ what_i_did: 'ok' });
  const n = queue.all().length;
  const long = 'x'.repeat(40001);
  for (const k of ['what_i_did', 'impact', 'stakeholders', 'feedback', 'project']) {
    assert.throws(() => store.add({ what_i_did: 'w', [k]: long }), (err) => err.message === 'too long', k);
    assert.throws(() => store.update(e.id, { [k]: long }), (err) => err.message === 'too long', k);
  }
  assert.equal(queue.all().length, n);
  store.add({ what_i_did: 'y'.repeat(40000), impact: `  ${'z'.repeat(40000)}  ` }); // trimmed length counts
  assert.equal(queue.all().length, n + 1);
});

// ---- Ruling M: a stale update is reported, not folded ----

function staleApi() {
  const api = memApi();
  api.update = async (patch) => {
    api.calls.push('update');
    return { ...api.rows.get(patch.id), stale: true }; // the server kept its newer version
  };
  return api;
}

test('a stale update is not folded, leaves the queue, and sets the notice (once per pass, via onNotice)', async () => {
  const api = staleApi();
  api.rows.set('s1', row('s1', { impact: 'theirs' }));
  const notices = [];
  const { store } = makeStore({ api, opts: { onNotice: (m) => notices.push(m) } });
  await store.refresh();
  api.list = async () => {
    throw new NetworkError('down'); // so the screen shows the fold result, not a fresh list
  };
  store.update('s1', { impact: 'mine' });
  await store.refresh();
  assert.equal(store.getState().pending, 0);
  assert.equal(store.getState().entries[0].impact, 'theirs');
  assert.equal(store.getState().notice, '另一台裝置的修改較新，這次修改未套用');
  assert.deepEqual(notices, ['另一台裝置的修改較新，這次修改未套用']);
});

test('the notice clears on the next clean refresh, or when dismissed', async () => {
  const api = staleApi();
  api.rows.set('s1', row('s1'));
  const { store } = makeStore({ api });
  await store.refresh();
  store.update('s1', { impact: 'mine' });
  await store.refresh();
  assert.equal(store.getState().notice, '另一台裝置的修改較新，這次修改未套用');
  await store.refresh();
  assert.equal(store.getState().notice, '');

  store.update('s1', { impact: 'again' });
  await store.refresh();
  assert.ok(store.getState().notice);
  store.dismissNotice();
  assert.equal(store.getState().notice, '');
});

// ---- Ruling N: ops the server rejects are kept in jos_rejected and shown ----

function rejectingApi() {
  const api = memApi();
  api.add = async () => {
    api.calls.push('add');
    throw new ApiError('invalid');
  };
  return api;
}

test('an add the server rejects as invalid is recorded in jos_rejected and state.rejected, with a notice', async () => {
  const storage = memStorage();
  const notices = [];
  const { store } = makeStore({ storage, api: rejectingApi(), opts: { onNotice: (m) => notices.push(m) } });
  assert.equal(store.getState().rejected, 0);
  const e = store.add({ what_i_did: 'slipped through' });
  await store.refresh();
  assert.equal(store.getState().pending, 0);
  assert.equal(store.getState().rejected, 1);
  const saved = JSON.parse(storage.getItem('jos_rejected'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].op.type, 'add');
  assert.equal(saved[0].op.entry.id, e.id);
  assert.equal(saved[0].op.entry.what_i_did, 'slipped through');
  assert.match(saved[0].at, /^2026-11-17T/);
  assert.deepEqual(store.getRejected(), saved);
  assert.deepEqual(notices, ['1 筆被伺服器拒絕']);

  // a new store on the same storage (an app restart) still shows it
  const again = makeStore({ storage, api: memApi() }).store;
  assert.equal(again.getState().rejected, 1);
  again.clearRejected();
  assert.equal(again.getState().rejected, 0);
  assert.deepEqual(again.getRejected(), []);
  assert.deepEqual(JSON.parse(storage.getItem('jos_rejected') || '[]'), []);
});

test('jos_rejected keeps the newest 50 and tolerates corrupt JSON', async () => {
  const old = Array.from({ length: 50 }, (_, i) => ({ op: { opId: `old${i}`, type: 'remove', id: `x${i}` }, at: 'T' }));
  const storage = memStorage({ jos_rejected: JSON.stringify(old) });
  const { store } = makeStore({ storage, api: rejectingApi() });
  assert.equal(store.getState().rejected, 50);
  store.add({ what_i_did: 'one more' });
  await store.refresh();
  const saved = JSON.parse(storage.getItem('jos_rejected'));
  assert.equal(saved.length, 50);
  assert.equal(saved[0].op.opId, 'old1');
  assert.equal(saved[49].op.entry.what_i_did, 'one more');

  for (const bad of ['{oops', '{"a":1}', 'null']) {
    const s = memStorage({ jos_rejected: bad });
    const st = makeStore({ storage: s, api: rejectingApi() }).store;
    assert.equal(st.getState().rejected, 0);
    st.add({ what_i_did: 'x' });
    await st.refresh();
    assert.equal(st.getState().rejected, 1);
  }
});

test('a failing jos_rejected write still keeps the rejected op in memory', async () => {
  const base = memStorage();
  const storage = {
    getItem: base.getItem,
    setItem: (k, v) => {
      if (k === 'jos_rejected') throw new Error('quota');
      base.setItem(k, v);
    },
  };
  const { store } = makeStore({ storage, api: rejectingApi(), queue: createQueue(base) });
  store.add({ what_i_did: 'x' });
  await store.refresh();
  assert.equal(store.getState().rejected, 1);
  assert.equal(store.getRejected().length, 1);
});

// ---- hasLoaded means "real data (a list or a readable cache) is on screen" ----

test('hasLoaded stays false until a list succeeds or a cache is read', async () => {
  const api = memApi();
  api.down = true;
  const { store } = makeStore({ api });
  await store.load(); // no cache, offline
  assert.equal(store.getState().hasLoaded, false);
  api.down = false;
  await store.refresh();
  assert.equal(store.getState().hasLoaded, true);

  const s2 = makeStore({ storage: memStorage({ jos_cache: '[]' }), api: Object.assign(memApi(), { down: true }) }).store;
  const p = s2.load();
  assert.equal(s2.getState().hasLoaded, true); // an empty but readable cache counts
  await p;
});
