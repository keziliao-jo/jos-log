// The data store every screen talks to. Local-first: a write lands in the offline queue (and so
// on screen) before any network call, and is only ever removed from the queue by a successful
// sync. Browser-safe: no Node imports; `storage` is injected (localStorage-shaped).

import { applyPending, sync } from './queue.js';
import { ApiError, NetworkError } from './api.js';
import { newEntry, todayStr, uuid, isValidDate, MAX_FIELD } from './model.js';

const EDITABLE = ['date', 'project', 'what_i_did', 'impact', 'stakeholders', 'feedback'];
const TEXT_FIELDS = ['project', 'what_i_did', 'impact', 'stakeholders', 'feedback'];
const MAX_PASSES = 5; // sync passes per refresh (edits made mid-sync need a follow-up pass)
const MAX_CYCLES = 3; // sync+list cycles per refresh (edits made mid-list)
const MAX_REJECTED = 50; // rejected ops kept for the user (newest)
export const STALE_NOTICE = '另一台裝置的修改較新，這次修改未套用';

// Validation that runs before anything is queued, so a write the server would reject never
// enters the queue (and so can never be dropped later). Throws Error('invalid date' | 'too long').
function checkFields(fields) {
  if ('date' in fields && !isValidDate(fields.date)) throw new Error('invalid date');
  for (const k of TEXT_FIELDS) {
    if (typeof fields[k] === 'string' && fields[k].length > MAX_FIELD) throw new Error('too long');
  }
}

// state: { entries, pending, status, hasLoaded, notice, rejected }
//   hasLoaded  real data (a server list or a readable cache) is behind `entries`
//   notice     '' or STALE_NOTICE until the next clean refresh or dismissNotice()
//   rejected   how many ops the server refused (kept in `rejectedKey` for the user to copy)
// onNotice(msg): optional; told about a stale update or newly rejected ops (the app shows a toast).
export function createStore({
  api,
  queue,
  storage,
  now = () => new Date().toISOString(),
  id = uuid,
  cacheKey = 'jos_cache',
  rejectedKey = 'jos_rejected',
  onNotice = null,
}) {
  let serverEntries = []; // last successful server list, raw
  let rejected = readRejected(); // [{ op, at }], oldest first
  let state = { entries: [], pending: 0, status: 'synced', hasLoaded: false, notice: '', rejected: rejected.length };
  const listeners = new Set();
  let inflight = null;
  let haveServer = false; // serverEntries came from a real list or a readable cache
  let again = false; // a public refresh() arrived while a run was in flight
  let staleSeen = false; // a stale update came back during the current kick (all its reruns)

  // Never throws: a storage failure while reading leaves the displayed state as it was.
  function overlay() {
    try {
      const ops = queue.all();
      return {
        entries: applyPending(serverEntries, ops).filter((e) => e.deleted !== '1'),
        pending: ops.length,
      };
    } catch (_) {
      return null;
    }
  }

  function emit(patch) {
    state = { ...state, ...patch };
    for (const fn of [...listeners]) {
      try {
        fn(state);
      } catch (err) {
        console.error(err); // a UI bug must not break the store
      }
    }
  }

  function recompute(extra = {}) {
    emit({ ...(overlay() || {}), rejected: rejected.length, ...extra });
  }

  function notify(msg) {
    if (typeof onNotice !== 'function') return;
    try {
      onNotice(msg);
    } catch (err) {
      console.error(err);
    }
  }

  // Corrupt or unreadable content reads as none; the next write replaces it.
  function readRejected() {
    try {
      const raw = storage.getItem(rejectedKey);
      if (raw === null || raw === undefined) return [];
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.filter((r) => r && typeof r === 'object' && r.op && typeof r.op === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  // Called by sync just before a rejected op leaves the queue. The in-memory list keeps it for
  // this session even when storage fails.
  function recordRejected(op) {
    rejected = [...rejected, { op: JSON.parse(JSON.stringify(op)), at: now() }].slice(-MAX_REJECTED);
    try {
      storage.setItem(rejectedKey, JSON.stringify(rejected));
    } catch (_) {
      // kept in memory; state.rejected still shows it
    }
  }

  function readCache() {
    try {
      const raw = storage.getItem(cacheKey);
      if (raw === null || raw === undefined) return null;
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : null;
    } catch (_) {
      return null; // missing, corrupt or unreadable: no usable cache
    }
  }

  function writeCache(list) {
    try {
      storage.setItem(cacheKey, JSON.stringify(list));
    } catch (_) {
      // the cache is only a convenience; the queue is what must not fail
    }
  }

  function opIds() {
    try {
      return new Set(queue.all().map((o) => o.opId));
    } catch (_) {
      return new Set();
    }
  }

  // Ops whose send completed are now true on the server: fold them into the best-known server
  // state so the screen does not revert until api.list() lands. Ops cancelled or merged in the
  // queue were never sent, so they are not in `done`. Only cache the fold when real server data
  // (a list or a readable cache) is the base, so a healthy cache is never overwritten by a stub.
  function fold(done) {
    if (!done || done.length === 0) return;
    serverEntries = applyPending(serverEntries, done);
    if (haveServer) writeCache(serverEntries);
  }

  async function run() {
    let status = 'synced';
    try {
      for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
        // 1. drain the queue; re-run while follow-up edits keep arriving and progress is made
        let res;
        for (let pass = 0; pass < MAX_PASSES; pass++) {
          res = await sync(queue, api, { onDropped: recordRejected });
          fold(res.done); // stale and dropped ops are not in done: never shown as applied
          const stale = (res.stale || []).length;
          const dropped = (res.droppedOps || []).length;
          if (stale > 0) staleSeen = true;
          recompute(stale > 0 ? { notice: STALE_NOTICE } : {});
          if (stale > 0) notify(STALE_NOTICE);
          if (dropped > 0) notify(`${dropped} 筆被伺服器拒絕`);
          if (res.error || res.remaining === 0 || res.sent + res.dropped + stale === 0) break;
        }
        if (res.error) {
          status = res.error === 'auth' ? 'auth' : res.error === 'network' ? 'offline' : 'pending';
          break;
        }
        status = res.remaining > 0 ? 'pending' : 'synced';

        // 2. fetch the server list
        const before = opIds();
        let list;
        try {
          list = await api.list();
        } catch (err) {
          if (err instanceof NetworkError) status = 'offline';
          else if (err instanceof ApiError && err.code === 'auth') status = 'auth';
          else status = 'pending';
          break;
        }
        serverEntries = list;
        haveServer = true;
        writeCache(list);
        recompute({ hasLoaded: true });

        // 3. an edit made while the list was in flight is still waiting: go round again
        let late = false;
        for (const opId of opIds()) if (!before.has(opId)) late = true;
        if (!late) break;
        status = 'pending';
      }
    } catch (_) {
      status = 'pending'; // e.g. sync rejected because queue storage failed; ops stay queued
    }
    recompute(status === 'synced' && !staleSeen ? { status, notice: '' } : { status });
  }

  async function runWithReruns() {
    let extra = 0;
    staleSeen = false;
    do {
      if (extra > 0) emit({ status: 'syncing' });
      again = false;
      await run();
      extra++;
    } while (again && extra <= 2);
  }

  // kick(): start a run unless one is in flight; never asks for a rerun (the `late` check in
  // run() already covers edits made mid-run).
  function kick() {
    if (inflight) return inflight;
    emit({ status: 'syncing' });
    const p = runWithReruns().finally(() => {
      if (inflight === p) inflight = null;
    });
    inflight = p;
    return p;
  }

  // Public refresh: callers joining a run in flight want a fresh look afterwards, so ask for a rerun.
  function refresh() {
    if (inflight) again = true;
    return kick();
  }

  async function load() {
    const cached = readCache();
    serverEntries = cached || [];
    if (cached) haveServer = true;
    recompute(cached ? { hasLoaded: true } : {}); // otherwise hasLoaded waits for a list
    await refresh();
  }

  const opId = () => 'op_' + uuid();

  function add(fields) {
    const f = { ...(fields || {}) };
    if (typeof f.date !== 'string' || f.date.trim() === '') f.date = todayStr(new Date());
    const entry = newEntry(f, now(), id()); // throws on a blank what_i_did, before touching the queue
    checkFields(entry);
    queue.enqueue({ opId: opId(), type: 'add', entry }); // a storage failure propagates to the caller
    recompute();
    kick();
    return entry;
  }

  function update(entryId, patch) {
    if (!state.entries.some((e) => e.id === entryId)) return;
    const clean = {};
    for (const k of EDITABLE) {
      if (!patch || !(k in patch)) continue;
      const v = patch[k];
      if (k === 'date' && (v === null || v === undefined || String(v).trim() === '')) continue; // keep the old date
      clean[k] = typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim();
    }
    if ('what_i_did' in clean && clean.what_i_did === '') throw new Error('what_i_did required');
    if (Object.keys(clean).length === 0) return;
    checkFields(clean);
    queue.enqueue({ opId: opId(), type: 'update', entry: { id: entryId, updated_at: now(), ...clean } });
    recompute();
    kick();
  }

  function remove(entryId) {
    if (!state.entries.some((e) => e.id === entryId)) return;
    queue.enqueue({ opId: opId(), type: 'remove', id: entryId });
    recompute();
    kick();
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    load,
    refresh,
    add,
    update,
    remove,
    getRejected: () => JSON.parse(JSON.stringify(rejected)),
    clearRejected() {
      rejected = [];
      try {
        if (typeof storage.removeItem === 'function') storage.removeItem(rejectedKey);
        else storage.setItem(rejectedKey, '[]');
      } catch (_) {
        // the next record overwrites it
      }
      emit({ rejected: 0 });
    },
    dismissNotice() {
      if (state.notice) emit({ notice: '' });
    },
  };
}
