// Offline queue of pending writes, the overlay that shows them before they reach the sheet,
// and the sync loop that drains them. Browser-safe: no Node imports, storage is injected.
//
// Op shapes (opId is assigned by the caller and never invented here):
//   { opId, type: 'add',    entry }   full entry, including id
//   { opId, type: 'update', entry }   PARTIAL patch { id, updated_at, ...changedFields }
//   { opId, type: 'remove', id }
// Any op may also carry `attempted: true`: sync marks it before the first send. An attempted
// op may already have reached the server (a lost response), so it is immutable: later ops
// are never merged into it and it is never dropped implicitly; follow-ups queue after it.

import { ApiError, NetworkError } from './api.js';

const TYPES = ['add', 'update', 'remove'];
const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function targetId(op) {
  return op.type === 'remove' ? op.id : op.entry && op.entry.id;
}

function validOp(op) {
  if (!isObj(op) || typeof op.opId !== 'string' || op.opId === '' || !TYPES.includes(op.type)) return false;
  if (op.type === 'remove') return typeof op.id === 'string' && op.id !== '';
  return isObj(op.entry) && typeof op.entry.id === 'string' && op.entry.id !== '';
}

export function createQueue(storage, key = 'jos_queue') {
  // Corrupted or non-array content reads as an empty queue; the next write replaces it.
  // A getItem that throws is NOT swallowed, so a transient failure cannot lead to
  // overwriting a healthy queue with a near-empty one.
  function read() {
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return [];
    }
    return Array.isArray(parsed) ? parsed.filter(validOp) : [];
  }

  function write(ops) {
    storage.setItem(key, JSON.stringify(ops));
  }

  return {
    all() {
      return clone(read());
    },

    enqueue(op) {
      if (!validOp(op)) throw new TypeError('invalid queue op');
      const incoming = clone(op);
      const id = targetId(incoming);
      let ops = read();
      const mine = ops.filter((o) => targetId(o) === id);

      if (incoming.type === 'add') {
        ops.push(incoming);
      } else if (incoming.type === 'update') {
        if (mine.some((o) => o.type === 'remove')) return; // the entry is going away
        const target = [...mine].reverse().find((o) => !o.attempted);
        if (target) {
          // merge into the latest unsent add/update; it keeps its opId and position
          target.entry = { ...target.entry, ...incoming.entry };
        } else {
          ops.push(incoming);
        }
      } else if (mine.some((o) => o.type === 'remove')) {
        return; // already queued
      } else if (mine.length === 0) {
        ops.push(incoming);
      } else if (mine.some((o) => o.attempted)) {
        // something may already be on the server: keep it, drop the unsent rest, delete after
        ops = ops.filter((o) => targetId(o) !== id || o.attempted);
        ops.push(incoming);
      } else if (mine.some((o) => o.type === 'add')) {
        ops = ops.filter((o) => targetId(o) !== id); // never reached the server: send nothing
      } else {
        // only unsent updates: one remove in the first update's slot
        const first = ops.findIndex((o) => targetId(o) === id);
        ops[first] = incoming;
        ops = ops.filter((o, i) => i === first || targetId(o) !== id);
      }

      write(ops);
    },

    markAttempted(opId) {
      const ops = read();
      const op = ops.find((o) => o.opId === opId);
      if (!op || op.attempted) return;
      op.attempted = true;
      write(ops);
    },

    remove(opId) {
      const ops = read();
      const next = ops.filter((o) => o.opId !== opId);
      if (next.length !== ops.length) write(next);
    },
  };
}

export function applyPending(serverEntries, ops) {
  const out = serverEntries.map((e) => ({ ...e }));
  for (const op of ops) {
    if (op.type === 'add') {
      if (!out.some((e) => e.id === op.entry.id)) out.push({ ...op.entry });
    } else if (op.type === 'update') {
      const e = out.find((x) => x.id === op.entry.id);
      if (e) Object.assign(e, op.entry);
    } else if (op.type === 'remove') {
      const i = out.findIndex((e) => e.id === op.id);
      if (i >= 0) out.splice(i, 1);
    }
  }
  return out;
}

function send(api, op) {
  if (op.type === 'add') return api.add(op.entry);
  if (op.type === 'update') return api.update(op.entry);
  return api.remove(op.id);
}

const running = new WeakMap();

// Result: { sent, dropped, remaining, done, stale, droppedOps, error? }
//   done        ops whose send completed and was applied (sent === done.length)
//   stale       update ops the server answered as stale (left the queue, NOT applied, not in done)
//   droppedOps  ops the server rejected as invalid, in full (dropped === droppedOps.length)
// hooks.onDropped(op) runs for each rejected op just before it leaves the queue, so the caller can
// keep it somewhere durable first; a throwing hook does not keep the op or stop the run.
export function sync(queue, api, hooks = {}) {
  // Two overlapping runs would send the same ops twice; share the one in progress.
  const active = running.get(queue);
  if (active) return active;
  const p = run(queue, api, hooks).finally(() => {
    if (running.get(queue) === p) running.delete(queue);
  });
  running.set(queue, p);
  return p;
}

async function run(queue, api, hooks) {
  let sent = 0;
  let dropped = 0;
  let error;
  const done = []; // ops whose send completed, as sent (not dropped, stale, skipped or unsent)
  const stale = [];
  const droppedOps = [];

  // Walk the opIds present at the start, but always send the latest stored copy of each:
  // an op dropped or edited meanwhile (never attempted, so still mutable) is not sent stale.
  for (const { opId } of queue.all()) {
    const op = queue.all().find((o) => o.opId === opId);
    if (!op) continue;
    queue.markAttempted(opId); // before the send: from here on the op is immutable
    let reply;
    try {
      reply = await send(api, op);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      if (code === 'not_found' && op.type !== 'add') {
        queue.remove(opId);
        sent++;
        done.push(op);
        continue;
      }
      if (code === 'invalid') {
        try {
          if (typeof hooks.onDropped === 'function') hooks.onDropped(op);
        } catch (hookErr) {
          console.error(hookErr); // still reported in droppedOps below
        }
        queue.remove(opId);
        dropped++;
        droppedOps.push(op);
        continue;
      }
      if (code === 'auth') error = 'auth';
      else if (err instanceof NetworkError) error = 'network';
      else error = 'server'; // server, bad_response, unknown codes, anything else
      break;
    }
    queue.remove(opId);
    if (op.type === 'update' && reply && reply.stale === true) {
      stale.push(op); // the server kept a newer version: nothing to fold
      continue;
    }
    sent++;
    done.push(op);
  }

  const result = { sent, dropped, remaining: queue.all().length, done, stale, droppedOps };
  if (error) result.error = error;
  return result;
}
