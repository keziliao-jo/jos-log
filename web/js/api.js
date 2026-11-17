// Client for the Apps Script API. Every call is a POST with a text/plain body
// (a "simple" request, so browsers skip the CORS preflight that Apps Script cannot answer).

export class ApiError extends Error {
  constructor(code, message) {
    super(message || `api error: ${code}`);
    this.name = 'ApiError';
    this.code = code;
  }
}

export class NetworkError extends Error {
  constructor(message, cause) {
    super(message || 'network error');
    this.name = 'NetworkError';
    if (cause !== undefined) this.cause = cause;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bad = (why) => new ApiError('bad_response', `bad response: ${why}`);

export function createApi({ url, token, fetchFn, timeoutMs = 20000 }) {
  const doFetch = fetchFn || ((...args) => globalThis.fetch(...args));

  async function call(action, extra, validate) {
    let res;
    let text;
    // A stalled request must not hang the sync loop forever: abort it and report a NetworkError.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token, ...extra }),
        signal: ctrl.signal,
      });
      text = await res.text();
    } catch (err) {
      throw new NetworkError(err && err.message, err);
    } finally {
      clearTimeout(timer);
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      throw bad(res.ok ? 'not JSON' : `HTTP ${res.status}`);
    }
    if (!isObj(body) || typeof body.ok !== 'boolean') throw bad('unexpected shape');

    if (body.ok === false) {
      if (typeof body.error !== 'string' || body.error === '') throw bad('missing error code');
      throw new ApiError(body.error);
    }
    if (!res.ok) throw bad(`HTTP ${res.status}`);
    if (!validate(body)) throw bad('unexpected shape');
    return body;
  }

  const hasEntry = (b) => isObj(b.entry);

  return {
    async list() {
      const b = await call('list', {}, (r) => Array.isArray(r.entries));
      return b.entries;
    },
    async add(entry) {
      return (await call('add', { entry }, hasEntry)).entry;
    },
    // A stale update (the server kept its newer version) resolves with the stored entry plus
    // `stale: true`, so the caller can tell it apart from an applied one.
    async update(entry) {
      const b = await call('update', { entry }, hasEntry);
      return b.stale === true ? { ...b.entry, stale: true } : b.entry;
    },
    async remove(id) {
      await call('remove', { id }, () => true);
    },
  };
}
