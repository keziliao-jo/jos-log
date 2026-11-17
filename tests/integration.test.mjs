import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, NetworkError } from '../web/js/api.js';
import { createStore } from '../web/js/store.js';
import { createQueue } from '../web/js/queue.js';
import { startFakeApi } from '../tools/fake-api.mjs';

let fake;
before(async () => {
  fake = await startFakeApi({ port: 0, token: 'dev' });
});
after(async () => {
  await fake.close();
});

const entry = (over = {}) => ({
  id: 'e1',
  date: '2026-11-17',
  project: 'P',
  what_i_did: 'did a thing',
  impact: 'small',
  stakeholders: '',
  feedback: '',
  created_at: '2026-11-17T10:00:00.000Z',
  updated_at: '2026-11-17T10:00:00.000Z',
  ...over,
});

test('add, list, update, remove through the fake server', async () => {
  const api = createApi({ url: fake.url, token: 'dev' });
  assert.deepEqual(await api.list(), []);

  const added = await api.add(entry());
  assert.equal(added.id, 'e1');

  let list = await api.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].impact, 'small');

  const updated = await api.update({ id: 'e1', updated_at: '2026-11-17T11:00:00.000Z', impact: 'big' });
  assert.equal(updated.impact, 'big');
  list = await api.list();
  assert.equal(list[0].impact, 'big');

  await api.remove('e1');
  assert.deepEqual(await api.list(), []);
});

test('adding the same entry twice yields one entry', async () => {
  const api = createApi({ url: fake.url, token: 'dev' });
  await api.add(entry({ id: 'dup' }));
  await api.add(entry({ id: 'dup' }));
  const list = (await api.list()).filter((e) => e.id === 'dup');
  assert.equal(list.length, 1);
});

test('wrong token yields ApiError auth; update of a missing id yields not_found', async () => {
  const bad = createApi({ url: fake.url, token: 'nope' });
  await assert.rejects(bad.list(), (e) => e instanceof ApiError && e.code === 'auth');
  const api = createApi({ url: fake.url, token: 'dev' });
  await assert.rejects(api.update({ id: 'missing', impact: 'x' }), (e) => e.code === 'not_found');
});

test('server sends CORS headers and answers OPTIONS', async () => {
  const pre = await fetch(fake.url, { method: 'OPTIONS' });
  assert.ok(pre.status === 204 || pre.status === 200);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  const post = await fetch(fake.url, { method: 'POST', body: '{"action":"list","token":"dev"}' });
  assert.equal(post.headers.get('access-control-allow-origin'), '*');
});

// ---- store against the real fake server ----

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) };
}

// Real fetch, but the first time an `add` response would come back it throws instead:
// the server stored the entry, the client never learns it.
function lossyFetch() {
  let lost = false;
  return async (url, init) => {
    const res = await fetch(url, init);
    if (!lost && JSON.parse(init.body).action === 'add') {
      lost = true;
      await res.text();
      throw new NetworkError('connection dropped');
    }
    return res;
  };
}

function realStore(token, fetchFn) {
  const storage = memStorage();
  const api = createApi({ url: fake.url, token, fetchFn });
  const store = createStore({ api, queue: createQueue(storage), storage }); // real uuids: the fake server persists across tests
  return { store, api };
}

test('lost add response then two refreshes leaves exactly one entry on the server', async () => {
  const { store, api } = realStore('dev', lossyFetch());
  const before = (await api.list()).length;
  const e = store.add({ what_i_did: 'lost response' });
  await store.refresh(); // joins the run that lost the add response; its rerun pass retries the add
  await store.refresh();
  assert.equal(store.getState().status, 'synced');
  assert.equal(store.getState().pending, 0);
  const rows = (await api.list()).filter((r) => r.id === e.id);
  assert.equal(rows.length, 1);
  assert.equal((await api.list()).length, before + 1);
});

test('add, lost response, remove, refresh: the server entry ends up deleted', async () => {
  const { store, api } = realStore('dev', lossyFetch());
  const e = store.add({ what_i_did: 'to be removed' });
  await store.refresh();
  assert.ok((await api.list()).some((r) => r.id === e.id)); // the lost add did land
  store.remove(e.id);
  await store.refresh();
  assert.ok(!(await api.list()).some((r) => r.id === e.id));
  assert.equal(store.getState().pending, 0);
});

test('add offline, edit, reconnect: server has the edited values and one row', async () => {
  let down = true;
  const fetchFn = async (url, init) => {
    if (down) throw new TypeError('offline');
    return fetch(url, init);
  };
  const { store, api } = realStore('dev', fetchFn);
  const e = store.add({ what_i_did: 'draft', project: 'Q' });
  await store.refresh();
  store.update(e.id, { what_i_did: 'final', impact: 'done' });
  await store.refresh(); // the run update() started, still offline
  down = false;
  await store.refresh();
  const rows = (await api.list()).filter((r) => r.id === e.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].what_i_did, 'final');
  assert.equal(rows[0].impact, 'done');
  assert.equal(rows[0].project, 'Q');
});

// ---- final fix wave: C1 and C2 reproduced end to end ----

function realStoreFull(fetchFn, opts = {}) {
  const storage = memStorage();
  const api = createApi({ url: fake.url, token: 'dev', fetchFn });
  const queue = createQueue(storage);
  const store = createStore({ api, queue, storage, ...opts });
  return { store, api, queue, storage };
}

test('C1: two offline edits to one entry (the first attempted and failed) both reach the server', async () => {
  let down = false;
  const fetchFn = async (url, init) => {
    if (down) throw new TypeError('offline');
    return fetch(url, init);
  };
  const { store, api } = realStoreFull(fetchFn);
  const e = store.add({ what_i_did: 'two edits' });
  await store.refresh();
  assert.equal(store.getState().pending, 0);
  down = true;
  store.update(e.id, { impact: 'faster onboarding' });
  await store.refresh(); // op 1 attempted, failed
  store.update(e.id, { stakeholders: 'Ann' }); // cannot merge into the attempted op: op 2
  await store.refresh();
  assert.equal(store.getState().pending, 2);
  await new Promise((r) => setTimeout(r, 5)); // reconnecting happens later: server time > both edit stamps
  down = false;
  await store.refresh();
  const row = (await api.list()).find((r) => r.id === e.id);
  assert.equal(row.impact, 'faster onboarding');
  assert.equal(row.stakeholders, 'Ann');
  const shown = store.getState().entries.find((r) => r.id === e.id);
  assert.equal(shown.stakeholders, 'Ann');
  assert.equal(store.getState().status, 'synced');
  assert.equal(store.getState().pending, 0);
  assert.equal(store.getState().notice, '');
});

test('C1: a genuinely stale update comes back stale through createApi, is not folded, and raises the notice', async () => {
  const api = createApi({ url: fake.url, token: 'dev' });
  const added = await api.add({ id: crypto.randomUUID(), date: '2026-11-17', what_i_did: 'stale target', impact: 'server' });
  const r = await api.update({ id: added.id, updated_at: '2001-01-01T00:00:00.000Z', impact: 'old device' });
  assert.equal(r.stale, true);
  assert.equal(r.impact, 'server');

  // the slow-clock device: its edit is older than the stored version
  let listDown = false;
  const fetchFn = async (url, init) => {
    if (listDown && JSON.parse(init.body).action === 'list') throw new TypeError('offline');
    return fetch(url, init);
  };
  const notices = [];
  const { store } = realStoreFull(fetchFn, { now: () => '2001-01-01T00:00:00.000Z', onNotice: (m) => notices.push(m) });
  await store.refresh();
  listDown = true; // the screen shows the fold result, not a fresh list
  store.update(added.id, { impact: 'slow clock edit' });
  await store.refresh();
  assert.equal(store.getState().entries.find((x) => x.id === added.id).impact, 'server');
  assert.equal(store.getState().pending, 0);
  assert.equal(store.getState().notice, '另一台裝置的修改較新，這次修改未套用');
  assert.deepEqual(notices, ['另一台裝置的修改較新，這次修改未套用']);
  assert.equal((await api.list()).find((x) => x.id === added.id).impact, 'server');
});

test('C2: an entry with a year-0026 date is refused before it is queued (nothing to lose)', async () => {
  const { store, queue, api } = realStoreFull();
  await store.refresh();
  const before = (await api.list()).length;
  assert.throws(() => store.add({ what_i_did: 'typo year', date: '0026-11-17' }), (err) => err.message === 'invalid date');
  assert.equal(queue.all().length, 0);
  assert.equal(store.getState().pending, 0);
  await store.refresh();
  assert.equal((await api.list()).length, before);
});

test('C2: an op the server rejects as invalid ends in jos_rejected and state.rejected, not silence', async () => {
  const notices = [];
  const { store, queue, storage, api } = realStoreFull(undefined, { onNotice: (m) => notices.push(m) });
  // an op that slipped past the client checks (e.g. queued by an older version of the app)
  const id = crypto.randomUUID();
  queue.enqueue({
    opId: 'op_old',
    type: 'add',
    entry: { id, date: '0026-11-17', project: 'P', what_i_did: 'typo year', impact: '', stakeholders: '', feedback: '', created_at: '2026-11-17T01:00:00.000Z', updated_at: '2026-11-17T01:00:00.000Z' },
  });
  await store.refresh();
  assert.equal(store.getState().pending, 0);
  assert.equal(store.getState().rejected, 1);
  const saved = JSON.parse(storage.getItem('jos_rejected'));
  assert.equal(saved[0].op.entry.what_i_did, 'typo year');
  assert.deepEqual(notices, ['1 筆被伺服器拒絕']);
  assert.ok(!(await api.list()).some((r) => r.id === id));
});
