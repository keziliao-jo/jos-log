import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, applyPending, sync } from '../web/js/queue.js';
import { ApiError, NetworkError } from '../web/js/api.js';

function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    raw: m,
  };
}

const entry = (id, extra = {}) => ({
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
const add = (opId, e) => ({ opId, type: 'add', entry: e });
const upd = (opId, patch) => ({ opId, type: 'update', entry: patch });
const rem = (opId, id) => ({ opId, type: 'remove', id });

// ---- persistence and storage robustness ----

test('ops persist across createQueue instances on the same storage', () => {
  const s = memStorage();
  createQueue(s).enqueue(add('o1', entry('a')));
  createQueue(s).enqueue(add('o2', entry('b')));
  const ops = createQueue(s).all();
  assert.deepEqual(ops.map((o) => o.opId), ['o1', 'o2']);
  assert.equal(ops[0].entry.id, 'a');
});

test('default key is jos_queue and a custom key is honoured', () => {
  const s = memStorage();
  createQueue(s).enqueue(add('o1', entry('a')));
  assert.ok(s.raw.has('jos_queue'));
  createQueue(s, 'other').enqueue(add('o2', entry('b')));
  assert.deepEqual(createQueue(s, 'other').all().map((o) => o.opId), ['o2']);
  assert.deepEqual(createQueue(s).all().map((o) => o.opId), ['o1']);
});

test('empty storage gives an empty queue', () => {
  assert.deepEqual(createQueue(memStorage()).all(), []);
});

test('corrupted JSON makes all() return [] and a later enqueue overwrites it', () => {
  const s = memStorage({ jos_queue: '{not json' });
  const q = createQueue(s);
  assert.deepEqual(q.all(), []);
  q.enqueue(add('o1', entry('a')));
  assert.deepEqual(q.all().map((o) => o.opId), ['o1']);
  assert.ok(Array.isArray(JSON.parse(s.raw.get('jos_queue'))));
});

test('valid JSON that is not an array is treated as empty', () => {
  for (const raw of ['{"a":1}', '"str"', '42', 'null', 'true']) {
    const q = createQueue(memStorage({ jos_queue: raw }));
    assert.deepEqual(q.all(), [], raw);
    q.enqueue(add('o1', entry('a')));
    assert.deepEqual(q.all().map((o) => o.opId), ['o1'], raw);
  }
});

test('malformed items inside the array are ignored, good ones kept', () => {
  const good = add('o1', entry('a'));
  const raw = JSON.stringify([null, 5, 'x', { type: 'add' }, { opId: 'z', type: 'bogus' }, good]);
  const q = createQueue(memStorage({ jos_queue: raw }));
  assert.deepEqual(q.all(), [good]);
});

test('remove(opId) deletes only that op, unknown opId is a no-op', () => {
  const s = memStorage();
  const q = createQueue(s);
  q.enqueue(add('o1', entry('a')));
  q.enqueue(add('o2', entry('b')));
  q.remove('nope');
  assert.equal(q.all().length, 2);
  q.remove('o1');
  assert.deepEqual(q.all().map((o) => o.opId), ['o2']);
});

test('remove() on corrupted storage does not throw', () => {
  const q = createQueue(memStorage({ jos_queue: '][' }));
  q.remove('o1');
  assert.deepEqual(q.all(), []);
});

test('enqueue throws when setItem throws, and the previous content is unchanged', () => {
  const s = memStorage();
  const q = createQueue(s);
  q.enqueue(add('o1', entry('a')));
  const before = JSON.stringify(q.all());
  s.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.throws(() => q.enqueue(add('o2', entry('b'))), /Quota/);
  assert.equal(JSON.stringify(q.all()), before);
  assert.throws(() => q.remove('o1'), /Quota/);
  assert.equal(JSON.stringify(q.all()), before);
});

test('all() returns copies: mutating them does not change the stored queue', () => {
  const q = createQueue(memStorage());
  q.enqueue(add('o1', entry('a')));
  const ops = q.all();
  ops[0].entry.what_i_did = 'tampered';
  ops.push(add('x', entry('x')));
  assert.equal(q.all().length, 1);
  assert.equal(q.all()[0].entry.what_i_did, 'did a');
});

test('enqueue does not mutate the op passed in', () => {
  const q = createQueue(memStorage());
  const a = add('o1', entry('a'));
  const frozen = JSON.stringify(a);
  q.enqueue(a);
  q.enqueue(upd('o2', { id: 'a', what_i_did: 'edited', updated_at: '2026-11-17T02:00:00.000Z' }));
  assert.equal(JSON.stringify(a), frozen);
});

// ---- coalescing ----

test('update for an id with a pending add merges into that add', () => {
  const q = createQueue(memStorage());
  q.enqueue(add('o1', entry('a')));
  q.enqueue(add('o2', entry('b')));
  q.enqueue(upd('o3', { id: 'a', what_i_did: 'edited', updated_at: '2026-11-17T02:00:00.000Z' }));
  const ops = q.all();
  assert.equal(ops.length, 2);
  assert.equal(ops[0].opId, 'o1');
  assert.equal(ops[0].type, 'add');
  assert.equal(ops[0].entry.what_i_did, 'edited');
  assert.equal(ops[0].entry.updated_at, '2026-11-17T02:00:00.000Z');
  assert.equal(ops[0].entry.created_at, '2026-11-17T01:00:00.000Z');
  assert.equal(ops[0].entry.date, '2026-11-17');
});

test('remove for a pending add leaves no ops for that id', () => {
  const q = createQueue(memStorage());
  q.enqueue(add('o1', entry('a')));
  q.enqueue(add('o2', entry('b')));
  q.enqueue(rem('o3', 'a'));
  assert.deepEqual(q.all().map((o) => o.opId), ['o2']);
  q.enqueue(rem('o4', 'b'));
  assert.deepEqual(q.all(), []);
});

test('two updates for one id become one: later fields win, latest updated_at, earliest opId', () => {
  const q = createQueue(memStorage());
  q.enqueue(upd('o1', { id: 'a', what_i_did: 'one', impact: 'i1', updated_at: '2026-11-17T02:00:00.000Z' }));
  q.enqueue(upd('o2', { id: 'a', what_i_did: 'two', feedback: 'f2', updated_at: '2026-11-17T03:00:00.000Z' }));
  const ops = q.all();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].opId, 'o1');
  assert.equal(ops[0].type, 'update');
  assert.deepEqual(ops[0].entry, {
    id: 'a',
    what_i_did: 'two',
    impact: 'i1',
    feedback: 'f2',
    updated_at: '2026-11-17T03:00:00.000Z',
  });
});

test('updates for different ids stay separate and ordered', () => {
  const q = createQueue(memStorage());
  q.enqueue(upd('o1', { id: 'a', impact: 'x', updated_at: 't1' }));
  q.enqueue(upd('o2', { id: 'b', impact: 'y', updated_at: 't2' }));
  assert.deepEqual(q.all().map((o) => o.opId), ['o1', 'o2']);
});

test('update then remove for one id becomes a single remove in the update position', () => {
  const q = createQueue(memStorage());
  q.enqueue(add('o0', entry('z')));
  q.enqueue(upd('o1', { id: 'a', impact: 'x', updated_at: 't1' }));
  q.enqueue(add('o2', entry('b')));
  q.enqueue(rem('o3', 'a'));
  const ops = q.all();
  assert.deepEqual(ops.map((o) => [o.opId, o.type]), [
    ['o0', 'add'],
    ['o3', 'remove'],
    ['o2', 'add'],
  ]);
  assert.equal(ops[1].id, 'a');
  assert.equal(ops[1].entry, undefined);
});

test('update for an id with a pending remove is ignored', () => {
  const q = createQueue(memStorage());
  q.enqueue(rem('o1', 'a'));
  q.enqueue(upd('o2', { id: 'a', impact: 'x', updated_at: 't' }));
  assert.deepEqual(q.all(), [rem('o1', 'a')]);
});

test('duplicate remove for the same id is not queued twice', () => {
  const q = createQueue(memStorage());
  q.enqueue(rem('o1', 'a'));
  q.enqueue(rem('o2', 'a'));
  assert.deepEqual(q.all(), [rem('o1', 'a')]);
});

test('independent ops keep first-in-first-out order', () => {
  const q = createQueue(memStorage());
  q.enqueue(rem('o1', 'x'));
  q.enqueue(add('o2', entry('a')));
  q.enqueue(upd('o3', { id: 'y', impact: 'i', updated_at: 't' }));
  assert.deepEqual(q.all().map((o) => o.opId), ['o1', 'o2', 'o3']);
});

// ---- applyPending ----

test('applyPending: pending add appears; skipped if the server already has that id', () => {
  const server = [entry('s1')];
  const out = applyPending(server, [add('o1', entry('n1')), add('o2', entry('s1', { what_i_did: 'dupe' }))]);
  assert.deepEqual(out.map((e) => e.id), ['s1', 'n1']);
  assert.equal(out[0].what_i_did, 'did s1');
});

test('applyPending: pending update overlays only the patch fields and updated_at', () => {
  const server = [entry('s1', { deleted: '', impact: 'keep' })];
  const out = applyPending(server, [upd('o1', { id: 's1', what_i_did: 'new', updated_at: 'T9' })]);
  assert.equal(out[0].what_i_did, 'new');
  assert.equal(out[0].updated_at, 'T9');
  assert.equal(out[0].impact, 'keep');
  assert.equal(out[0].date, '2026-11-17');
  assert.equal(out[0].deleted, '');
});

test('applyPending: pending update applies to a pending add too', () => {
  const out = applyPending([], [add('o1', entry('n1')), upd('o2', { id: 'n1', impact: 'big', updated_at: 'T2' })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].impact, 'big');
  assert.equal(out[0].updated_at, 'T2');
});

test('applyPending: pending remove excludes the entry (server or pending add)', () => {
  const out = applyPending([entry('s1'), entry('s2')], [rem('o1', 's1'), add('o2', entry('n1')), rem('o3', 'n1')]);
  assert.deepEqual(out.map((e) => e.id), ['s2']);
});

test('applyPending: update for an id that is not present is ignored', () => {
  const out = applyPending([entry('s1')], [upd('o1', { id: 'ghost', impact: 'x', updated_at: 't' })]);
  assert.deepEqual(out.map((e) => e.id), ['s1']);
});

test('applyPending returns a new array and does not mutate inputs', () => {
  const server = [entry('s1')];
  const ops = [add('o1', entry('n1')), upd('o2', { id: 's1', impact: 'x', updated_at: 'T' }), upd('o3', { id: 'n1', impact: 'y', updated_at: 'T' })];
  const sBefore = JSON.stringify(server);
  const oBefore = JSON.stringify(ops);
  const out = applyPending(server, ops);
  assert.notEqual(out, server);
  assert.equal(JSON.stringify(server), sBefore);
  assert.equal(JSON.stringify(ops), oBefore);
  out[0].impact = 'mutated';
  out[1].impact = 'mutated';
  assert.equal(JSON.stringify(server), sBefore);
  assert.equal(JSON.stringify(ops), oBefore);
});

test('applyPending with no ops returns an equal but new array', () => {
  const server = [entry('s1')];
  const out = applyPending(server, []);
  assert.notEqual(out, server);
  assert.deepEqual(out, server);
});

// ---- sync ----

function fakeApi(handler) {
  const calls = [];
  const call = (type) => async (arg) => {
    calls.push([type, arg]);
    return handler ? handler(type, arg, calls.length) : undefined;
  };
  return { calls, add: call('add'), update: call('update'), remove: call('remove') };
}

// sync result without `done`, `stale` and `droppedOps` (asserting the invariants sent === done.length
// and dropped === droppedOps.length); those arrays have their own tests.
function core(res) {
  assert.ok(Array.isArray(res.done));
  assert.equal(res.done.length, res.sent);
  assert.ok(Array.isArray(res.stale));
  assert.ok(Array.isArray(res.droppedOps));
  assert.equal(res.droppedOps.length, res.dropped);
  const { done, stale, droppedOps, ...rest } = res;
  return rest;
}

function queueWith(...ops) {
  const q = createQueue(memStorage());
  for (const o of ops) q.enqueue(o);
  return q;
}

test('sync sends ops in order with the right api call and removes each on success', async () => {
  const a = entry('a');
  const patch = { id: 'b', impact: 'x', updated_at: 'T' };
  const q = queueWith(add('o1', a), upd('o2', patch), rem('o3', 'c'));
  const api = fakeApi();
  const res = await sync(q, api);
  assert.deepEqual(api.calls, [
    ['add', a],
    ['update', patch],
    ['remove', 'c'],
  ]);
  assert.deepEqual(core(res), { sent: 3, dropped: 0, remaining: 0 });
  assert.deepEqual(q.all(), []);
});

test('sync on an empty queue is a no-op success', async () => {
  const api = fakeApi();
  assert.deepEqual(core(await sync(createQueue(memStorage()), api)), { sent: 0, dropped: 0, remaining: 0 });
  assert.equal(api.calls.length, 0);
});

test('sync: auth stops at the first op, keeps everything, returns error auth', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')));
  const api = fakeApi(() => {
    throw new ApiError('auth');
  });
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 0, dropped: 0, remaining: 2, error: 'auth' });
  assert.equal(api.calls.length, 1);
  assert.deepEqual(q.all().map((o) => o.opId), ['o1', 'o2']);
});

test('sync: NetworkError stops with error network and keeps the failing and later ops', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')), add('o3', entry('c')));
  const api = fakeApi((t, arg, n) => {
    if (n === 2) throw new NetworkError('offline');
  });
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 1, dropped: 0, remaining: 2, error: 'network' });
  assert.deepEqual(q.all().map((o) => o.opId), ['o2', 'o3']);
  assert.equal(api.calls.length, 2);
});

test('sync: server and bad_response stop with error server', async () => {
  for (const code of ['server', 'bad_response']) {
    const q = queueWith(add('o1', entry('a')), add('o2', entry('b')));
    const api = fakeApi(() => {
      throw new ApiError(code);
    });
    const res = await sync(q, api);
    assert.deepEqual(core(res), { sent: 0, dropped: 0, remaining: 2, error: 'server' }, code);
    assert.equal(q.all().length, 2);
  }
});

test('sync: unknown ApiError code and non-Api errors are treated like server (kept, stop)', async () => {
  for (const err of [new ApiError('weird'), new TypeError('boom'), 'string thrown', null]) {
    const q = queueWith(add('o1', entry('a')), add('o2', entry('b')));
    const api = fakeApi(() => {
      throw err;
    });
    const res = await sync(q, api);
    assert.deepEqual(core(res), { sent: 0, dropped: 0, remaining: 2, error: 'server' });
    assert.equal(api.calls.length, 1);
  }
});

test('sync: not_found on update and remove counts as sent', async () => {
  const q = queueWith(upd('o1', { id: 'a', impact: 'x', updated_at: 'T' }), rem('o2', 'b'), add('o3', entry('c')));
  const api = fakeApi((t) => {
    if (t !== 'add') throw new ApiError('not_found');
  });
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 3, dropped: 0, remaining: 0 });
  assert.deepEqual(q.all(), []);
});

test('sync: not_found on add is not special (kept, stops as server)', async () => {
  const q = queueWith(add('o1', entry('a')));
  const api = fakeApi(() => {
    throw new ApiError('not_found');
  });
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 0, dropped: 0, remaining: 1, error: 'server' });
});

test('sync: invalid removes the op, increments dropped and continues', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')), add('o3', entry('c')));
  const api = fakeApi((t, arg) => {
    if (arg.id === 'b') throw new ApiError('invalid');
  });
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 2, dropped: 1, remaining: 0 });
  assert.deepEqual(q.all(), []);
});

test('sync: error after some successes reports sent and what remains', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')), add('o3', entry('c')));
  const api = fakeApi((t, arg) => {
    if (arg.id === 'b') throw new ApiError('auth');
  });
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 1, dropped: 0, remaining: 2, error: 'auth' });
  assert.deepEqual(q.all().map((o) => o.opId), ['o2', 'o3']);
});

test('sync: a retry after a failure resumes where it stopped', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')));
  let fail = true;
  const api = fakeApi((t, arg) => {
    if (fail && arg.id === 'b') throw new NetworkError('offline');
  });
  assert.equal((await sync(q, api)).error, 'network');
  fail = false;
  assert.deepEqual(core(await sync(q, api)), { sent: 1, dropped: 0, remaining: 0 });
});

test('sync iterates a snapshot: ops enqueued during the run are left for the next run', async () => {
  const q = queueWith(add('o1', entry('a')));
  const api = fakeApi((t, arg) => {
    if (arg.id === 'a') q.enqueue(add('o2', entry('late')));
  });
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 1, dropped: 0, remaining: 1 });
  assert.deepEqual(q.all().map((o) => o.opId), ['o2']);
});

test('sync: concurrent calls on one queue share a single run (no double send)', async () => {
  const q = queueWith(add('o1', entry('a')));
  let release;
  const gate = new Promise((r) => (release = r));
  const api = fakeApi(async () => {
    await gate;
  });
  const p1 = sync(q, api);
  const p2 = sync(q, api);
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(api.calls.length, 1);
  assert.deepEqual(core(r1), { sent: 1, dropped: 0, remaining: 0 });
  assert.deepEqual(r2, r1);
  // a later call starts a fresh run
  q.enqueue(add('o2', entry('b')));
  assert.equal((await sync(q, api)).sent, 1);
  assert.equal(api.calls.length, 2);
});

test('sync: storage failure while removing a sent op propagates (rejects) rather than hiding it', async () => {
  const s = memStorage();
  const q = createQueue(s);
  q.enqueue(add('o1', entry('a')));
  s.setItem = () => {
    throw new Error('Quota');
  };
  await assert.rejects(sync(q, fakeApi()), /Quota/);
});

test('sync: delete of an in-flight update keeps the remove queued (not lost)', async () => {
  const q = queueWith(upd('o1', { id: 'a', impact: 'x', updated_at: 'T1' }));
  const api = fakeApi((t) => {
    if (t === 'update') q.enqueue(rem('o2', 'a'));
  });
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 1, dropped: 0, remaining: 1 });
  assert.deepEqual(q.all(), [rem('o2', 'a')]);
});

// ---- attempted ops are immutable (Ruling G) ----

test('markAttempted persists across instances; unknown opId is a no-op; legacy ops are not attempted', () => {
  const s = memStorage();
  createQueue(s).enqueue(add('o1', entry('a')));
  assert.equal(createQueue(s).all()[0].attempted, undefined);
  createQueue(s).markAttempted('o1');
  assert.equal(createQueue(s).all()[0].attempted, true);
  const before = s.raw.get('jos_queue');
  createQueue(s).markAttempted('nope');
  assert.equal(s.raw.get('jos_queue'), before);
  // an op written by older code (no attempted field) still merges like a fresh one
  const legacy = memStorage({ jos_queue: JSON.stringify([add('L', entry('z'))]) });
  const q = createQueue(legacy);
  q.enqueue(upd('u', { id: 'z', impact: 'x', updated_at: 'T' }));
  assert.equal(q.all().length, 1);
  assert.equal(q.all()[0].entry.impact, 'x');
});

test('update for a never-attempted add merges into it; remove of it leaves no ops', () => {
  const q = queueWith(add('o1', entry('a')));
  q.enqueue(upd('o2', { id: 'a', what_i_did: 'edited', updated_at: 'T2' }));
  assert.equal(q.all().length, 1);
  assert.equal(q.all()[0].entry.what_i_did, 'edited');
  q.enqueue(rem('o3', 'a'));
  assert.deepEqual(q.all(), []);
});

test('an update after an attempted add is a separate op; the attempted add is untouched', () => {
  const q = queueWith(add('o1', entry('a')));
  q.markAttempted('o1');
  q.enqueue(upd('o2', { id: 'a', what_i_did: 'edited', updated_at: 'T2' }));
  q.enqueue(upd('o3', { id: 'a', impact: 'big', updated_at: 'T3' }));
  const ops = q.all();
  assert.deepEqual(ops.map((o) => [o.opId, o.type, !!o.attempted]), [
    ['o1', 'add', true],
    ['o2', 'update', false],
  ]);
  assert.equal(ops[0].entry.what_i_did, 'did a');
  assert.deepEqual(ops[1].entry, { id: 'a', what_i_did: 'edited', impact: 'big', updated_at: 'T3' });
});

test('remove with an attempted op drops only unsent ops for the id and appends the remove', () => {
  const q = queueWith(add('o1', entry('a')), add('ob', entry('b')));
  q.markAttempted('o1');
  q.enqueue(upd('o2', { id: 'a', impact: 'x', updated_at: 'T2' }));
  q.enqueue(rem('o3', 'a'));
  assert.deepEqual(q.all().map((o) => [o.opId, o.type]), [
    ['o1', 'add'],
    ['ob', 'add'],
    ['o3', 'remove'],
  ]);
});

test('remove of several unsent updates leaves one remove at the first update slot', () => {
  const q = queueWith(upd('o1', { id: 'a', impact: 'x', updated_at: 'T1' }));
  q.markAttempted('o1');
  q.enqueue(upd('o2', { id: 'a', impact: 'y', updated_at: 'T2' }));
  q.enqueue(upd('o4', { id: 'b', impact: 'y', updated_at: 'T2' }));
  q.enqueue(rem('o3', 'a'));
  assert.deepEqual(q.all().map((o) => [o.opId, o.type]), [
    ['o1', 'update'],
    ['o4', 'update'],
    ['o3', 'remove'],
  ]);
});

test('sync: add sent, response lost, user edits, retry sends the add then a separate update', async () => {
  const q = queueWith(add('o1', entry('a')));
  let lost = true;
  const api = fakeApi((t) => {
    if (lost && t === 'add') throw new NetworkError('response lost');
  });
  assert.equal((await sync(q, api)).error, 'network');
  assert.equal(q.all()[0].attempted, true);
  q.enqueue(upd('o2', { id: 'a', what_i_did: 'edited', updated_at: 'T2' }));
  lost = false;
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 2, dropped: 0, remaining: 0 });
  assert.deepEqual(api.calls.map((c) => c[0]), ['add', 'add', 'update']);
  assert.equal(api.calls[1][1].what_i_did, 'did a');
  assert.equal(api.calls[2][1].what_i_did, 'edited');
  assert.deepEqual(q.all(), []);
});

test('sync: add sent, response lost, user deletes, retry sends the add then a remove', async () => {
  const q = queueWith(add('o1', entry('a')));
  let lost = true;
  const api = fakeApi((t) => {
    if (lost && t === 'add') throw new NetworkError('response lost');
  });
  await sync(q, api);
  q.enqueue(rem('o2', 'a'));
  lost = false;
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 2, dropped: 0, remaining: 0 });
  assert.deepEqual(api.calls.map((c) => [c[0], c[0] === 'remove' ? c[1] : c[1].id]), [
    ['add', 'a'],
    ['add', 'a'],
    ['remove', 'a'],
  ]);
  assert.deepEqual(q.all(), []);
});

test('sync: edit enqueued while an add is in flight becomes a separate update, no merge', async () => {
  const q = queueWith(add('o1', entry('a')));
  const api = fakeApi((t) => {
    if (t === 'add') q.enqueue(upd('o2', { id: 'a', what_i_did: 'edited', updated_at: 'T2' }));
  });
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 1, dropped: 0, remaining: 1 });
  assert.equal(api.calls[0][1].what_i_did, 'did a');
  assert.deepEqual(q.all().map((o) => [o.opId, o.type]), [['o2', 'update']]);
  await sync(q, api);
  assert.deepEqual(api.calls.map((c) => c[0]), ['add', 'update']);
  assert.equal(api.calls[1][1].what_i_did, 'edited');
  assert.deepEqual(q.all(), []);
});

test('sync: delete enqueued while an add is in flight is sent after it (no resurrection)', async () => {
  const q = queueWith(add('o1', entry('a')));
  const api = fakeApi((t) => {
    if (t === 'add') q.enqueue(rem('o2', 'a'));
  });
  assert.equal((await sync(q, api)).remaining, 1);
  await sync(q, api);
  assert.deepEqual(api.calls.map((c) => c[0]), ['add', 'remove']);
});

test('sync: a never-attempted add dropped by a remove during the run is never sent', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')));
  const api = fakeApi((t, arg) => {
    if (arg.id === 'a') q.enqueue(rem('o3', 'b'));
  });
  const res = await sync(q, api);
  assert.deepEqual(core(res), { sent: 1, dropped: 0, remaining: 0 });
  assert.deepEqual(api.calls.map((c) => c[1].id), ['a']);
});

test('sync: a never-attempted op edited during the run is sent with its latest content', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')));
  const api = fakeApi((t, arg) => {
    if (arg.id === 'a') q.enqueue(upd('o3', { id: 'b', what_i_did: 'fresh', updated_at: 'T2' }));
  });
  await sync(q, api);
  assert.equal(api.calls[1][1].what_i_did, 'fresh');
  assert.deepEqual(q.all(), []);
});

test('sync marks an op attempted before sending it', async () => {
  const q = queueWith(add('o1', entry('a')));
  let seen;
  const api = fakeApi(() => {
    seen = q.all()[0].attempted;
  });
  await sync(q, api);
  assert.equal(seen, true);
});

// ---- done: the ops whose send actually completed ----

test('sync done: every successfully sent op, in order, as sent', async () => {
  const a = entry('a');
  const patch = { id: 'b', impact: 'x', updated_at: 'T' };
  const q = queueWith(add('o1', a), upd('o2', patch), rem('o3', 'c'));
  const res = await sync(q, fakeApi());
  assert.deepEqual(res.done.map((o) => o.opId), ['o1', 'o2', 'o3']);
  assert.deepEqual(res.done[0].entry, a);
  assert.deepEqual(res.done[1].entry, patch);
  assert.equal(res.done[2].id, 'c');
});

test('sync done: a partial run ending in an error lists only the ops that were sent', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')), add('o3', entry('c')));
  const api = fakeApi((t, arg) => {
    if (arg.id === 'b') throw new NetworkError('offline');
  });
  const res = await sync(q, api);
  assert.equal(res.error, 'network');
  assert.deepEqual(res.done.map((o) => o.opId), ['o1']);
  assert.equal(res.sent, 1);
});

test('sync done: an op dropped as invalid is excluded', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')), add('o3', entry('c')));
  const api = fakeApi((t, arg) => {
    if (arg.id === 'b') throw new ApiError('invalid');
  });
  const res = await sync(q, api);
  assert.equal(res.dropped, 1);
  assert.deepEqual(res.done.map((o) => o.opId), ['o1', 'o3']);
  assert.equal(res.sent, 2);
});

test('sync done: not_found on update/remove counts as sent and is included', async () => {
  const q = queueWith(upd('o1', { id: 'x', impact: 'y', updated_at: 'T' }), rem('o2', 'z'));
  const res = await sync(q, fakeApi(() => {
    throw new ApiError('not_found');
  }));
  assert.deepEqual(res.done.map((o) => o.opId), ['o1', 'o2']);
  assert.equal(res.sent, 2);
});

test('sync done: an op removed from the queue during the run (skipped) is excluded; an edited op appears as sent', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')), add('o3', entry('c')));
  const api = fakeApi((t, arg) => {
    if (arg.id === 'a') {
      q.enqueue(rem('o4', 'b')); // cancels the unsent add of b
      q.enqueue(upd('o5', { id: 'c', what_i_did: 'fresh', updated_at: 'T2' })); // merged into o3
    }
  });
  const res = await sync(q, api);
  assert.deepEqual(res.done.map((o) => o.opId), ['o1', 'o3']);
  assert.equal(res.done[1].entry.what_i_did, 'fresh'); // the content actually sent
  assert.equal(res.sent, 2);
});

// ---- stale updates and dropped ops are reported, never silent (Rulings M, N) ----

test('sync: a stale update leaves the queue, is not in done, is reported in stale', async () => {
  const patch = { id: 'b', impact: 'mine', updated_at: 'T1' };
  const q = queueWith(add('o1', entry('a')), upd('o2', patch), add('o3', entry('c')));
  const api = fakeApi((t) => (t === 'update' ? { id: 'b', impact: 'theirs', stale: true } : undefined));
  const res = await sync(q, api);
  assert.deepEqual(res.done.map((o) => o.opId), ['o1', 'o3']);
  assert.deepEqual(res.stale.map((o) => o.opId), ['o2']);
  assert.deepEqual(res.stale[0].entry, patch);
  assert.equal(res.sent, 2);
  assert.equal(res.remaining, 0);
  assert.deepEqual(q.all(), []);
});

test('sync: an op dropped as invalid is returned in full in droppedOps, and onDropped sees it before it leaves the queue', async () => {
  const b = entry('b', { date: '0026-11-17' });
  const q = queueWith(add('o1', entry('a')), add('o2', b), add('o3', entry('c')));
  const api = fakeApi((t, arg) => {
    if (arg.id === 'b') throw new ApiError('invalid');
  });
  const seen = [];
  const res = await sync(q, api, {
    onDropped: (op) => seen.push([op.opId, q.all().some((o) => o.opId === op.opId)]),
  });
  assert.equal(res.dropped, 1);
  assert.equal(res.droppedOps.length, 1);
  assert.equal(res.droppedOps[0].opId, 'o2');
  assert.deepEqual(res.droppedOps[0].entry, b);
  assert.deepEqual(seen, [['o2', true]]); // still queued when the hook ran
  assert.deepEqual(q.all(), []);
});

test('sync: a throwing onDropped does not keep the op or break the run', async () => {
  const q = queueWith(add('o1', entry('a')), add('o2', entry('b')));
  const api = fakeApi((t, arg) => {
    if (arg.id === 'a') throw new ApiError('invalid');
  });
  const origError = console.error;
  console.error = () => {};
  let res;
  try {
    res = await sync(q, api, { onDropped: () => { throw new Error('storage full'); } });
  } finally {
    console.error = origError;
  }
  assert.deepEqual(core(res), { sent: 1, dropped: 1, remaining: 0 });
  assert.equal(res.droppedOps[0].opId, 'o1');
});
