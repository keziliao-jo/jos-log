import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, NetworkError } from '../web/js/api.js';

const URL_ = 'https://example.test/exec';

function respond(body, init = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status: 200, ...init });
}

function recorder(reply) {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    if (typeof reply === 'function') return reply(calls.length);
    return reply.clone();
  };
  return { calls, fetchFn };
}

test('every call is a POST with text/plain and a JSON body carrying action and token', async () => {
  const { calls, fetchFn } = recorder(respond({ ok: true, entries: [] }));
  const api = createApi({ url: URL_, token: 'tok', fetchFn });
  await api.list();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, URL_);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(calls[0].body, { action: 'list', token: 'tok' });
});

test('add sends the entry; update sends the given object unmodified; remove sends the id', async () => {
  const entry = { id: 'a1', what_i_did: 'x' };
  const patch = { id: 'a1', updated_at: 'T', impact: 'big' };
  const { calls, fetchFn } = recorder((n) =>
    n === 3 ? respond({ ok: true }) : respond({ ok: true, entry: n === 1 ? entry : patch }),
  );
  const api = createApi({ url: URL_, token: 'tok', fetchFn });
  assert.deepEqual(await api.add(entry), entry);
  assert.deepEqual(await api.update(patch), patch);
  assert.equal(await api.remove('a1'), undefined);
  assert.deepEqual(calls[0].body, { action: 'add', token: 'tok', entry });
  assert.deepEqual(calls[1].body, { action: 'update', token: 'tok', entry: patch });
  assert.deepEqual(calls[2].body, { action: 'remove', token: 'tok', id: 'a1' });
});

test('list returns entries as the server sent them', async () => {
  const entries = [{ id: 'a', deleted: '' }];
  const { fetchFn } = recorder(respond({ ok: true, entries }));
  const api = createApi({ url: URL_, token: 't', fetchFn });
  assert.deepEqual(await api.list(), entries);
});

for (const code of ['auth', 'invalid', 'not_found', 'server']) {
  test(`{ok:false,error:'${code}'} throws ApiError with that code`, async () => {
    const { fetchFn } = recorder(respond({ ok: false, error: code }));
    const api = createApi({ url: URL_, token: 't', fetchFn });
    await assert.rejects(api.list(), (e) => {
      assert.ok(e instanceof ApiError);
      assert.ok(e instanceof Error);
      assert.equal(e.code, code);
      return true;
    });
  });
}

test('a rejected fetch throws NetworkError', async () => {
  const fetchFn = async () => {
    throw new TypeError('Failed to fetch');
  };
  const api = createApi({ url: URL_, token: 't', fetchFn });
  await assert.rejects(api.add({ id: 'a' }), (e) => {
    assert.ok(e instanceof NetworkError);
    assert.ok(!(e instanceof ApiError));
    return true;
  });
});

test('an HTML body throws ApiError bad_response', async () => {
  const { fetchFn } = recorder(respond('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }));
  const api = createApi({ url: URL_, token: 't', fetchFn });
  await assert.rejects(api.list(), (e) => e instanceof ApiError && e.code === 'bad_response');
});

test('wrong-shape bodies throw ApiError bad_response', async () => {
  const bodies = [
    'null',
    '[]',
    '{"hello":1}',
    '{"ok":true}', // list without entries
    '{"ok":true,"entries":"nope"}',
    '{"ok":false}',
    '{"ok":false,"error":5}',
  ];
  for (const b of bodies) {
    const { fetchFn } = recorder(respond(b));
    const api = createApi({ url: URL_, token: 't', fetchFn });
    await assert.rejects(api.list(), (e) => e instanceof ApiError && e.code === 'bad_response', b);
  }
  const { fetchFn } = recorder(respond({ ok: true }));
  const api = createApi({ url: URL_, token: 't', fetchFn });
  await assert.rejects(api.add({ id: 'a' }), (e) => e.code === 'bad_response');
  await assert.rejects(api.update({ id: 'a' }), (e) => e.code === 'bad_response');
});

test('non-2xx without a valid JSON result is bad_response; with a JSON error it maps to that code', async () => {
  let r = recorder(respond('Bad gateway', { status: 502 }));
  let api = createApi({ url: URL_, token: 't', fetchFn: r.fetchFn });
  await assert.rejects(api.list(), (e) => e instanceof ApiError && e.code === 'bad_response');

  r = recorder(respond({ ok: true, entries: [] }, { status: 500 }));
  api = createApi({ url: URL_, token: 't', fetchFn: r.fetchFn });
  await assert.rejects(api.list(), (e) => e instanceof ApiError && e.code === 'bad_response');

  r = recorder(respond({ ok: false, error: 'server' }, { status: 500 }));
  api = createApi({ url: URL_, token: 't', fetchFn: r.fetchFn });
  await assert.rejects(api.list(), (e) => e instanceof ApiError && e.code === 'server');
});

test('a request that never answers is aborted after timeoutMs and becomes a NetworkError', async () => {
  const fetchFn = (url, opts) =>
    new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  const api = createApi({ url: URL_, token: 't', fetchFn, timeoutMs: 20 });
  const t0 = Date.now();
  await assert.rejects(api.list(), (e) => e instanceof NetworkError && /aborted/.test(e.message));
  assert.ok(Date.now() - t0 < 1000);
});

test('a normal request passes a signal, is not aborted, and clears its timer', async () => {
  let seen;
  const fetchFn = async (url, opts) => {
    seen = opts.signal;
    return respond({ ok: true, entries: [] });
  };
  const api = createApi({ url: URL_, token: 't', fetchFn, timeoutMs: 30 });
  assert.deepEqual(await api.list(), []);
  assert.ok(seen instanceof AbortSignal);
  await new Promise((r) => setTimeout(r, 60)); // longer than timeoutMs: a leaked timer would fire now
  assert.equal(seen.aborted, false);
});

test('update resolves with stale: true when the server says the update was stale (Ruling M)', async () => {
  const stored = { id: 'a1', impact: 'server value', updated_at: 'T9' };
  const { fetchFn } = recorder((n) => (n === 1 ? respond({ ok: true, entry: stored, stale: true }) : respond({ ok: true, entry: stored })));
  const api = createApi({ url: URL_, token: 'tok', fetchFn });
  const r1 = await api.update({ id: 'a1', updated_at: 'T1', impact: 'mine' });
  assert.equal(r1.stale, true);
  assert.equal(r1.impact, 'server value');
  const r2 = await api.update({ id: 'a1', updated_at: 'T1', impact: 'mine' });
  assert.ok(!('stale' in r2));
  assert.deepEqual(r2, stored);
});
