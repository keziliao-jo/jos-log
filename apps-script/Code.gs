// jo's log API. Plain Apps Script JS (no modules). The core `handle` is pure so
// it also runs under node:vm in tests; the Google adapter is at the bottom.

var HEADERS = [
  'id', 'date', 'project', 'what_i_did', 'impact', 'stakeholders',
  'feedback', 'created_at', 'updated_at', 'deleted'
];
var EDITABLE = ['date', 'project', 'what_i_did', 'impact', 'stakeholders', 'feedback'];
var SHEET_NAME = 'Log';
var MAX_FIELD = 45000; // below the Sheets 50,000-character cell limit; the app caps input at 40,000

var DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function asString_(v) {
  return typeof v === 'string' ? v : '';
}

// YYYY-MM-DD, a real calendar date, year 2000-2099 (the same rule as the app's isValidDate).
// No Date.UTC: it maps years 0-99 to 1900-1999.
function isRealDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var y = Number(s.slice(0, 4));
  var m = Number(s.slice(5, 7));
  var d = Number(s.slice(8, 10));
  if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1) return false;
  var leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  var max = m === 2 && leap ? 29 : DAYS_IN_MONTH[m - 1];
  return d <= max;
}

// A client timestamp in toISOString() form; anything else is treated as the server's now.
function isIsoTime_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)) return false;
  var t = new Date(s);
  return !isNaN(t.getTime()) && t.toISOString() === s;
}

// Ruling M: keep the client's stamp (so queued edits keep their order) but never later than now.
function clampTime_(s, now) {
  if (!isIsoTime_(s)) return now;
  return s < now ? s : now;
}

function tooLong_(e) {
  for (var i = 0; i < HEADERS.length; i++) {
    var v = e[HEADERS[i]];
    if (typeof v === 'string' && v.length > MAX_FIELD) return true;
  }
  return false;
}

function isBlank_(s) {
  return asString_(s).trim() === '';
}

function isBlankRow_(row) {
  for (var i = 0; i < HEADERS.length; i++) {
    if (asString_(row[HEADERS[i]]) !== '') return false;
  }
  return true;
}

function copyRow_(row) {
  var out = {};
  for (var i = 0; i < HEADERS.length; i++) out[HEADERS[i]] = asString_(row[HEADERS[i]]);
  return out;
}

function tokenOk_(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given === '' || expected === '' || given.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Reads all rows (index i is sheet row i + 2). Stamps rows that lack
// id/created_at/updated_at, or repeat an earlier row's id, and writes them back. Blank rows are kept (so
// indexes stay aligned) but flagged.
function loadRows_(ctx) {
  var raw = ctx.store.readAll();
  var rows = [];
  var seen = {};
  for (var i = 0; i < raw.length; i++) {
    var row = copyRow_(raw[i]);
    if (!isBlankRow_(row)) {
      var changed = false;
      // a row copied by hand repeats an id: the later copy gets its own, so it can be edited and deleted
      if (row.id === '' || Object.prototype.hasOwnProperty.call(seen, row.id)) { row.id = ctx.uuid(); changed = true; }
      seen[row.id] = true;
      if (row.created_at === '') { row.created_at = ctx.now(); changed = true; }
      if (row.updated_at === '') { row.updated_at = ctx.now(); changed = true; }
      if (changed) ctx.store.replaceAt(i, row);
    }
    rows.push(row);
  }
  return rows;
}

function findIndex_(rows, id) {
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id !== '' && rows[i].id === id) return i;
  }
  return -1;
}

function doList_(ctx) {
  var rows = loadRows_(ctx);
  var entries = [];
  for (var i = 0; i < rows.length; i++) {
    if (isBlankRow_(rows[i]) || rows[i].deleted === '1') continue;
    entries.push(rows[i]);
  }
  return { ok: true, entries: entries };
}

function doAdd_(req, ctx) {
  var e = req.entry;
  if (!e || typeof e !== 'object') return { ok: false, error: 'invalid' };
  if (isBlank_(e.what_i_did) || !isRealDate_(e.date) || tooLong_(e)) return { ok: false, error: 'invalid' };
  var rows = loadRows_(ctx);
  var id = asString_(e.id) !== '' ? e.id : ctx.uuid();
  var existing = findIndex_(rows, id);
  if (existing >= 0) return { ok: true, entry: rows[existing] }; // idempotent retry
  var now = ctx.now();
  var row = {
    id: id,
    date: e.date,
    project: asString_(e.project),
    what_i_did: e.what_i_did,
    impact: asString_(e.impact),
    stakeholders: asString_(e.stakeholders),
    feedback: asString_(e.feedback),
    created_at: clampTime_(e.created_at, now),
    updated_at: clampTime_(e.updated_at, now),
    deleted: ''
  };
  ctx.store.append(row);
  return { ok: true, entry: row };
}

function doUpdate_(req, ctx) {
  var e = req.entry;
  if (!e || typeof e !== 'object' || asString_(e.id) === '') return { ok: false, error: 'invalid' };
  var rows = loadRows_(ctx);
  var idx = findIndex_(rows, e.id);
  if (idx < 0 || rows[idx].deleted === '1') return { ok: false, error: 'not_found' };
  if (typeof e.what_i_did === 'string' && isBlank_(e.what_i_did)) return { ok: false, error: 'invalid' };
  if (typeof e.date === 'string' && !isRealDate_(e.date)) return { ok: false, error: 'invalid' };
  if (tooLong_(e)) return { ok: false, error: 'invalid' };
  var stored = rows[idx];
  var incoming = clampTime_(e.updated_at, ctx.now());
  if (incoming < stored.updated_at) return { ok: true, entry: stored, stale: true };
  var next = copyRow_(stored);
  for (var i = 0; i < EDITABLE.length; i++) {
    var k = EDITABLE[i];
    if (typeof e[k] === 'string') next[k] = e[k];
  }
  next.updated_at = incoming;
  ctx.store.replaceAt(idx, next);
  return { ok: true, entry: next };
}

function doRemove_(req, ctx) {
  var id = asString_(req.id);
  if (id === '' && req.entry && typeof req.entry === 'object') id = asString_(req.entry.id);
  if (id === '') return { ok: false, error: 'invalid' };
  var rows = loadRows_(ctx);
  var idx = findIndex_(rows, id);
  if (idx < 0 || rows[idx].deleted === '1') return { ok: true };
  var next = copyRow_(rows[idx]);
  next.deleted = '1';
  next.updated_at = ctx.now();
  ctx.store.replaceAt(idx, next);
  return { ok: true };
}

// Cheap pre-check for the adapter: returns an auth error or null. doPost runs it
// before taking the lock or touching the Sheet, so unauthenticated callers can
// neither mutate the Sheet nor hold the lock. handle() re-checks (defence in depth).
function authPrecheck(req, expectedToken) {
  if (!req || typeof req !== 'object' || !tokenOk_(req.token, expectedToken)) {
    return { ok: false, error: 'auth' };
  }
  return null;
}

function handle(req, ctx) {
  try {
    if (!req || typeof req !== 'object' || !tokenOk_(req.token, ctx.token)) return { ok: false, error: 'auth' };
    switch (req.action) {
      case 'list': return doList_(ctx);
      case 'add': return doAdd_(req, ctx);
      case 'update': return doUpdate_(req, ctx);
      case 'remove': return doRemove_(req, ctx);
      default: return { ok: false, error: 'invalid' };
    }
  } catch (err) {
    return { ok: false, error: 'server' };
  }
}

// ---------------------------------------------------------------------------
// Apps Script adapter (not unit-tested; verified manually against a real Sheet)
// ---------------------------------------------------------------------------

function sheetStore() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  var n = HEADERS.length;
  // Plain text on every column so text starting with = + - @ is never parsed as a formula.
  sh.getRange(1, 1, sh.getMaxRows(), n).setNumberFormat('@');
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, n).setValues([HEADERS]);
  var tz = ss.getSpreadsheetTimeZone();

  function cell(header, v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
      return header === 'date'
        ? Utilities.formatDate(v, tz, 'yyyy-MM-dd')
        : v.toISOString();
    }
    return String(v);
  }
  function toValues(row) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(asString_(row[HEADERS[i]]));
    return out;
  }

  return {
    readAll: function () {
      var last = sh.getLastRow();
      if (last < 2) return [];
      var values = sh.getRange(2, 1, last - 1, n).getValues();
      var rows = [];
      for (var r = 0; r < values.length; r++) {
        var row = {};
        for (var c = 0; c < n; c++) row[HEADERS[c]] = cell(HEADERS[c], values[r][c]);
        rows.push(row);
      }
      return rows;
    },
    append: function (row) {
      var target = Math.max(sh.getLastRow(), 1) + 1;
      if (target > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
      var range = sh.getRange(target, 1, 1, n);
      range.setNumberFormat('@');
      range.setValues([toValues(row)]);
    },
    replaceAt: function (index, row) {
      var range = sh.getRange(index + 2, 1, 1, n);
      range.setNumberFormat('@');
      range.setValues([toValues(row)]);
    }
  };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return jsonOut_({ ok: true, status: 'jos-log' });
}

function doPost(e) {
  var lock = null;
  try {
    var req;
    try {
      req = JSON.parse(e && e.postData ? e.postData.contents : '');
    } catch (parseErr) {
      return jsonOut_({ ok: false, error: 'invalid' });
    }
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN') || '';
    var denied = authPrecheck(req, token);
    if (denied) return jsonOut_(denied);
    lock = LockService.getScriptLock();
    lock.waitLock(10000);
    var ctx = {
      token: token,
      store: sheetStore(),
      now: function () { return new Date().toISOString(); },
      uuid: function () { return Utilities.getUuid(); }
    };
    return jsonOut_(handle(req, ctx));
  } catch (err) {
    return jsonOut_({ ok: false, error: 'server' });
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (ignore) {}
    }
  }
}

if (typeof module !== 'undefined') module.exports = { handle, HEADERS, authPrecheck };
