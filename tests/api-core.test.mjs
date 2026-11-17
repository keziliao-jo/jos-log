import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadGs } from './helpers/load-gs.mjs';

const { handle, HEADERS, authPrecheck } = loadGs();

const TOKEN = 'secret';
const NOW = '2026-11-17T10:00:00.000Z';
const EARLIER = '2026-11-17T09:00:00.000Z';
const LATER = '2026-11-17T11:00:00.000Z';

function makeStore(rows = []) {
  const calls = { append: 0, replaceAt: 0 };
  return {
    rows,
    calls,
    readAll: () => rows.map((r) => ({ ...r })),
    append(row) {
      calls.append++;
      rows.push({ ...row });
    },
    replaceAt(i, row) {
      calls.replaceAt++;
      rows[i] = { ...row };
    },
  };
}

function makeCtx(store, over = {}) {
  let n = 0;
  return { token: TOKEN, store, now: () => NOW, uuid: () => `uuid-${++n}`, ...over };
}

function row(over = {}) {
  return {
    id: 'a1',
    date: '2026-11-17',
    project: 'P',
    what_i_did: 'did a thing',
    impact: 'big',
    stakeholders: 'X',
    feedback: 'ok',
    created_at: EARLIER,
    updated_at: EARLIER,
    deleted: '',
    ...over,
  };
}

const req = (action, extra = {}) => ({ action, token: TOKEN, ...extra });

test('HEADERS are the ten fields in order', () => {
  assert.deepEqual(HEADERS, [
    'id', 'date', 'project', 'what_i_did', 'impact', 'stakeholders',
    'feedback', 'created_at', 'updated_at', 'deleted',
  ]);
});

test('wrong or missing token is auth error and store untouched', () => {
  for (const token of ['nope', undefined, '']) {
    const store = makeStore([row()]);
    const r = handle({ action: 'add', token, entry: { date: '2026-11-17', what_i_did: 'x' } }, makeCtx(store));
    assert.deepEqual(r, { ok: false, error: 'auth' });
    assert.equal(store.calls.append + store.calls.replaceAt, 0);
    assert.equal(store.rows.length, 1);
  }
  const store = makeStore([row()]);
  assert.deepEqual(handle(req('list'), makeCtx(store, { token: '' })), { ok: false, error: 'auth' });
  assert.deepEqual(handle(null, makeCtx(store)), { ok: false, error: 'auth' });
});

test('unknown action is invalid', () => {
  assert.deepEqual(handle(req('explode'), makeCtx(makeStore())), { ok: false, error: 'invalid' });
});

test('add appends a row with all fields as strings', () => {
  const store = makeStore();
  const r = handle(
    req('add', { entry: { id: 'e1', date: '2026-11-17', project: 'P', what_i_did: 'wrote tests', impact: 'i', stakeholders: 's', feedback: 'f' } }),
    makeCtx(store),
  );
  assert.equal(r.ok, true);
  assert.equal(store.rows.length, 1);
  const stored = store.rows[0];
  assert.deepEqual(Object.keys(stored), HEADERS);
  for (const k of HEADERS) assert.equal(typeof stored[k], 'string', k);
  assert.equal(stored.id, 'e1');
  assert.equal(stored.what_i_did, 'wrote tests');
  assert.equal(stored.created_at, NOW);
  assert.equal(stored.updated_at, NOW);
  assert.equal(stored.deleted, '');
  assert.deepEqual(r.entry, stored);
});

test('add generates an id via ctx.uuid when none given and keeps client timestamps', () => {
  const store = makeStore();
  const r = handle(
    req('add', { entry: { date: '2026-11-17', what_i_did: 'x', created_at: EARLIER, updated_at: EARLIER } }),
    makeCtx(store),
  );
  assert.equal(r.entry.id, 'uuid-1');
  assert.equal(r.entry.created_at, EARLIER);
  assert.equal(r.entry.updated_at, EARLIER);
});

test('add rejects empty what_i_did and bad dates', () => {
  const bad = [
    { date: '2026-11-17', what_i_did: '' },
    { date: '2026-11-17', what_i_did: '   ' },
    { date: '2026-11-17' },
    { date: '2026-13-40', what_i_did: 'x' },
    { date: '2026-02-30', what_i_did: 'x' },
    { date: '11/17', what_i_did: 'x' },
    { date: '', what_i_did: 'x' },
    { what_i_did: 'x' },
  ];
  for (const entry of bad) {
    const store = makeStore();
    assert.deepEqual(handle(req('add', { entry }), makeCtx(store)), { ok: false, error: 'invalid' }, JSON.stringify(entry));
    assert.equal(store.rows.length, 0);
  }
  assert.deepEqual(handle(req('add'), makeCtx(makeStore())), { ok: false, error: 'invalid' });
});

test('add with the same id twice leaves one row and returns the stored entry', () => {
  const store = makeStore();
  const ctx = makeCtx(store);
  const first = handle(req('add', { entry: { id: 'dup', date: '2026-11-17', what_i_did: 'first' } }), ctx);
  const second = handle(req('add', { entry: { id: 'dup', date: '2026-11-17', what_i_did: 'second try' } }), ctx);
  assert.equal(store.rows.length, 1);
  assert.equal(second.ok, true);
  assert.equal(second.entry.what_i_did, 'first');
  assert.deepEqual(second.entry, first.entry);
  assert.equal(store.calls.append, 1);
});

test('add stores formula-looking text literally', () => {
  const store = makeStore();
  const ctx = makeCtx(store);
  for (const [i, text] of ['=SUM(A1)', '+1 call', '-2 left', '@mention'].entries()) {
    const r = handle(req('add', { entry: { id: `f${i}`, date: '2026-11-17', what_i_did: text, impact: text } }), ctx);
    assert.equal(r.ok, true);
    assert.equal(store.rows[i].what_i_did, text);
    assert.equal(store.rows[i].impact, text);
  }
});

test('list omits deleted rows and ignores fully blank rows', () => {
  const blank = Object.fromEntries(HEADERS.map((h) => [h, '']));
  const store = makeStore([row({ id: 'a' }), row({ id: 'b', deleted: '1' }), blank, row({ id: 'c' })]);
  const r = handle(req('list'), makeCtx(store));
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries.map((e) => e.id), ['a', 'c']);
  assert.equal(store.calls.replaceAt, 0);
});

test('list stamps rows missing id/created_at/updated_at and writes them back', () => {
  const store = makeStore([
    row({ id: 'keep' }),
    row({ id: '', created_at: '', updated_at: '', what_i_did: 'hand typed' }),
    row({ id: 'half', created_at: EARLIER, updated_at: '' }),
  ]);
  const r = handle(req('list'), makeCtx(store));
  assert.equal(store.calls.replaceAt, 2);
  assert.equal(store.rows[1].id, 'uuid-1');
  assert.equal(store.rows[1].created_at, NOW);
  assert.equal(store.rows[1].updated_at, NOW);
  assert.equal(store.rows[2].created_at, EARLIER);
  assert.equal(store.rows[2].updated_at, NOW);
  assert.deepEqual(r.entries.map((e) => e.id), ['keep', 'uuid-1', 'half']);
  assert.equal(r.entries[1].what_i_did, 'hand typed');
  assert.equal(r.entries[1].updated_at, NOW);
});

test('update changes only editable fields', () => {
  const store = makeStore([row({ id: 'u1' })]);
  const r = handle(
    req('update', {
      entry: {
        id: 'u1', updated_at: EARLIER, date: '2026-11-16', project: 'Q', what_i_did: 'new', impact: 'i2',
        stakeholders: 's2', feedback: 'f2', created_at: '1999-01-01T00:00:00.000Z', deleted: '1',
      },
    }),
    makeCtx(store),
  );
  assert.equal(r.ok, true);
  assert.notEqual(r.stale, true);
  const s = store.rows[0];
  assert.deepEqual(
    { date: s.date, project: s.project, what_i_did: s.what_i_did, impact: s.impact, stakeholders: s.stakeholders, feedback: s.feedback },
    { date: '2026-11-16', project: 'Q', what_i_did: 'new', impact: 'i2', stakeholders: 's2', feedback: 'f2' },
  );
  assert.equal(s.id, 'u1');
  assert.equal(s.created_at, EARLIER);
  assert.equal(s.deleted, '');
  assert.equal(s.updated_at, EARLIER); // min(incoming, now) (Ruling M)
  assert.deepEqual(r.entry, s);
});

test('update with a partial patch leaves absent fields unchanged', () => {
  const store = makeStore([row({ id: 'u1' })]);
  const r = handle(req('update', { entry: { id: 'u1', updated_at: EARLIER, impact: 'changed' } }), makeCtx(store));
  assert.equal(r.ok, true);
  assert.equal(store.rows[0].impact, 'changed');
  assert.equal(store.rows[0].what_i_did, 'did a thing');
  assert.equal(store.rows[0].project, 'P');
  assert.equal(store.rows[0].date, '2026-11-17');
});

test('update without updated_at is treated as now and applies', () => {
  const store = makeStore([row({ id: 'u1', updated_at: EARLIER })]);
  const r = handle(req('update', { entry: { id: 'u1', impact: 'x' } }), makeCtx(store));
  assert.equal(r.ok, true);
  assert.notEqual(r.stale, true);
  assert.equal(store.rows[0].impact, 'x');
});

test('stale update writes nothing and returns the stored entry', () => {
  const store = makeStore([row({ id: 'u1', updated_at: LATER })]);
  const r = handle(req('update', { entry: { id: 'u1', updated_at: EARLIER, what_i_did: 'old edit' } }), makeCtx(store));
  assert.equal(r.ok, true);
  assert.equal(r.stale, true);
  assert.equal(r.entry.what_i_did, 'did a thing');
  assert.deepEqual(r.entry, store.rows[0]);
  assert.equal(store.calls.replaceAt, 0);
});

test('update: unknown id is not_found, blank what_i_did / bad date is invalid', () => {
  const store = makeStore([row({ id: 'u1' }), row({ id: 'gone', deleted: '1' })]);
  const ctx = makeCtx(store);
  assert.deepEqual(handle(req('update', { entry: { id: 'nope', what_i_did: 'x' } }), ctx), { ok: false, error: 'not_found' });
  assert.deepEqual(handle(req('update', { entry: { id: 'gone', what_i_did: 'x' } }), ctx), { ok: false, error: 'not_found' });
  assert.deepEqual(handle(req('update', { entry: { id: 'u1', what_i_did: '  ' } }), ctx), { ok: false, error: 'invalid' });
  assert.deepEqual(handle(req('update', { entry: { id: 'u1', date: '2026-13-40' } }), ctx), { ok: false, error: 'invalid' });
  assert.deepEqual(handle(req('update', { entry: { what_i_did: 'x' } }), ctx), { ok: false, error: 'invalid' });
  assert.deepEqual(handle(req('update'), ctx), { ok: false, error: 'invalid' });
  assert.equal(store.calls.replaceAt, 0);
});

test('remove soft-deletes, stamps updated_at, hides the row from list', () => {
  const store = makeStore([row({ id: 'r1' }), row({ id: 'r2' })]);
  const ctx = makeCtx(store);
  const r = handle(req('remove', { id: 'r1' }), ctx);
  assert.deepEqual(r, { ok: true });
  assert.equal(store.rows[0].deleted, '1');
  assert.equal(store.rows[0].updated_at, NOW);
  assert.equal(store.rows[0].what_i_did, 'did a thing');
  assert.deepEqual(handle(req('list'), ctx).entries.map((e) => e.id), ['r2']);
});

test('remove: unknown or already-deleted id is ok and writes nothing; missing id invalid', () => {
  const store = makeStore([row({ id: 'r1', deleted: '1' })]);
  const ctx = makeCtx(store);
  assert.deepEqual(handle(req('remove', { id: 'nope' }), ctx), { ok: true });
  assert.deepEqual(handle(req('remove', { id: 'r1' }), ctx), { ok: true });
  assert.equal(store.calls.replaceAt, 0);
  assert.deepEqual(handle(req('remove'), ctx), { ok: false, error: 'invalid' });
});

test('store exceptions become server error', () => {
  const store = makeStore();
  store.readAll = () => { throw new Error('boom'); };
  assert.deepEqual(handle(req('list'), makeCtx(store)), { ok: false, error: 'server' });
});

test('add on a soft-deleted id does not resurrect or write', () => {
  const store = makeStore([row({ id: 'dead', deleted: '1', what_i_did: 'old text' })]);
  const r = handle(req('add', { entry: { id: 'dead', date: '2026-11-17', what_i_did: 'new text' } }), makeCtx(store));
  assert.equal(r.ok, true);
  assert.equal(r.entry.what_i_did, 'old text');
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].deleted, '1');
  assert.equal(store.calls.append + store.calls.replaceAt, 0);
  assert.deepEqual(handle(req('list'), makeCtx(store)).entries, []);
});

test('update with updated_at equal to stored applies (not stale)', () => {
  const store = makeStore([row({ id: 'u1', updated_at: EARLIER })]);
  const r = handle(req('update', { entry: { id: 'u1', updated_at: EARLIER, impact: 'same-stamp' } }), makeCtx(store));
  assert.equal(r.ok, true);
  assert.notEqual(r.stale, true);
  assert.equal(store.rows[0].impact, 'same-stamp');
  assert.equal(store.rows[0].updated_at, EARLIER);
  assert.equal(store.calls.replaceAt, 1);
});

test('authPrecheck passes only a matching token (used by doPost before lock/sheet)', () => {
  assert.equal(authPrecheck({ action: 'list', token: TOKEN }, TOKEN), null);
  const denied = { ok: false, error: 'auth' };
  assert.deepEqual(authPrecheck({ action: 'list', token: 'nope' }, TOKEN), denied);
  assert.deepEqual(authPrecheck({ action: 'list' }, TOKEN), denied);
  assert.deepEqual(authPrecheck({ action: 'list', token: '' }, ''), denied);
  assert.deepEqual(authPrecheck({ action: 'list', token: TOKEN }, ''), denied);
  assert.deepEqual(authPrecheck(null, TOKEN), denied);
  assert.deepEqual(authPrecheck('str', TOKEN), denied);
});

// ---- Ruling M: client timestamps are kept but never later than the server clock ----

const FUTURE = '2027-01-01T00:00:00.000Z';

test('update stamps updated_at = min(incoming, now): a later queued edit is not judged stale', () => {
  // C1: two edits made offline, T1 < T2 < server now; both must apply
  const store = makeStore([row({ id: 'u1', updated_at: '2026-11-17T08:00:00.000Z', impact: '', stakeholders: '' })]);
  const ctx = makeCtx(store);
  const T1 = '2026-11-17T09:00:00.000Z';
  const T2 = '2026-11-17T09:30:00.000Z';
  const r1 = handle(req('update', { entry: { id: 'u1', updated_at: T1, impact: 'faster' } }), ctx);
  assert.notEqual(r1.stale, true);
  assert.equal(store.rows[0].updated_at, T1);
  const r2 = handle(req('update', { entry: { id: 'u1', updated_at: T2, stakeholders: 'Ann' } }), ctx);
  assert.notEqual(r2.stale, true);
  assert.equal(store.rows[0].impact, 'faster');
  assert.equal(store.rows[0].stakeholders, 'Ann');
  assert.equal(store.rows[0].updated_at, T2);
});

test('a future updated_at is clamped to now on update and on add', () => {
  const store = makeStore([row({ id: 'u1', updated_at: EARLIER })]);
  const ctx = makeCtx(store);
  handle(req('update', { entry: { id: 'u1', updated_at: FUTURE, impact: 'x' } }), ctx);
  assert.equal(store.rows[0].updated_at, NOW);
  // a later normal edit (stamped before the future value) still applies
  const r = handle(req('update', { entry: { id: 'u1', updated_at: LATER, impact: 'y' } }), ctx);
  assert.notEqual(r.stale, true);
  assert.equal(store.rows[0].impact, 'y');

  const a = handle(req('add', { entry: { id: 'f1', date: '2026-11-17', what_i_did: 'x', created_at: FUTURE, updated_at: FUTURE } }), ctx);
  assert.equal(a.entry.created_at, NOW);
  assert.equal(a.entry.updated_at, NOW);
});

test('a timestamp that is not a valid ISO string is treated as now', () => {
  for (const bad of ['yesterday', '2026-11-17', '2026-13-01T00:00:00.000Z', 'zzzz', 42]) {
    const store = makeStore([row({ id: 'u1', updated_at: EARLIER })]);
    const ctx = makeCtx(store);
    const r = handle(req('update', { entry: { id: 'u1', updated_at: bad, impact: 'x' } }), ctx);
    assert.notEqual(r.stale, true, String(bad));
    assert.equal(store.rows[0].updated_at, NOW, String(bad));
    const a = handle(req('add', { entry: { id: 'n1', date: '2026-11-17', what_i_did: 'x', created_at: bad, updated_at: bad } }), ctx);
    assert.equal(a.entry.created_at, NOW, String(bad));
    assert.equal(a.entry.updated_at, NOW, String(bad));
  }
});

// ---- Ruling O: one date rule (YYYY-MM-DD, real date, 2000-2099) ----

test('dates: accepted and rejected on add and update', () => {
  const good = ['2000-01-01', '2099-12-31', '2024-02-29', '2026-11-17'];
  const bad = ['0026-11-17', '0099-01-01', '1999-12-31', '2100-01-01', '2023-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '202611-11-17', '+02026-11-17', '20261-11-17'];
  for (const date of good) {
    const store = makeStore([row({ id: 'u1' })]);
    const ctx = makeCtx(store);
    assert.equal(handle(req('add', { entry: { id: 'g', date, what_i_did: 'x' } }), ctx).ok, true, date);
    assert.equal(handle(req('update', { entry: { id: 'u1', date } }), ctx).ok, true, date);
  }
  for (const date of bad) {
    const store = makeStore([row({ id: 'u1' })]);
    const ctx = makeCtx(store);
    assert.deepEqual(handle(req('add', { entry: { id: 'b', date, what_i_did: 'x' } }), ctx), { ok: false, error: 'invalid' }, date);
    assert.deepEqual(handle(req('update', { entry: { id: 'u1', date } }), ctx), { ok: false, error: 'invalid' }, date);
    assert.equal(store.calls.append + store.calls.replaceAt, 0, date);
  }
});

test('rows with an out-of-range date still list, and other fields can be updated', () => {
  const store = makeStore([row({ id: 'old', date: '1999-05-05' })]);
  const ctx = makeCtx(store);
  assert.deepEqual(handle(req('list'), ctx).entries.map((e) => e.date), ['1999-05-05']);
  assert.equal(handle(req('update', { entry: { id: 'old', impact: 'later' } }), ctx).ok, true);
  assert.equal(store.rows[0].impact, 'later');
});

// ---- Ruling P: a field longer than 45,000 characters is invalid (never a server error loop) ----

test('fields over 45000 characters are invalid on add and update; 45000 is accepted', () => {
  const long = 'x'.repeat(45001);
  const ok = 'y'.repeat(45000);
  for (const k of ['what_i_did', 'impact', 'stakeholders', 'feedback', 'project']) {
    const store = makeStore([row({ id: 'u1' })]);
    const ctx = makeCtx(store);
    const e = { id: 'n', date: '2026-11-17', what_i_did: 'x', [k]: long };
    assert.deepEqual(handle(req('add', { entry: e }), ctx), { ok: false, error: 'invalid' }, k);
    assert.deepEqual(handle(req('update', { entry: { id: 'u1', [k]: long } }), ctx), { ok: false, error: 'invalid' }, k);
    assert.equal(store.calls.append + store.calls.replaceAt, 0);
    assert.equal(handle(req('add', { entry: { ...e, [k]: ok } }), ctx).ok, true, k);
  }
});

// ---- I1: rows copied by hand share an id ----

test('a later row with an already-seen id gets a fresh id written back; both list; removing the copy hits only it', () => {
  const store = makeStore([row({ id: 'same', what_i_did: 'original' }), row({ id: 'same', what_i_did: 'copy' })]);
  const ctx = makeCtx(store);
  const r = handle(req('list'), ctx);
  assert.deepEqual(r.entries.map((e) => e.id), ['same', 'uuid-1']);
  assert.equal(store.rows[1].id, 'uuid-1');
  assert.equal(store.rows[0].id, 'same');
  assert.equal(store.calls.replaceAt, 1);
  assert.deepEqual(handle(req('remove', { id: 'uuid-1' }), ctx), { ok: true });
  assert.equal(store.rows[0].deleted, '');
  assert.equal(store.rows[1].deleted, '1');
  assert.deepEqual(handle(req('list'), ctx).entries.map((e) => e.what_i_did), ['original']);
});
