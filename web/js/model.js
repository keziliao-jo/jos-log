// Entry model and pure helpers. Dates are 'YYYY-MM-DD' strings compared as strings.
// "Today" always comes from local date parts, never UTC.

const pad = (n) => String(n).padStart(2, '0');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function todayStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function uuid() {
  return crypto.randomUUID();
}

// The longest text a field may hold (the server rejects anything over 45,000).
export const MAX_FIELD = 40000;

// The one date rule, shared with the server: YYYY-MM-DD, a real calendar date, year 2000-2099.
export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 2000 || y > 2099) return false;
  const t = new Date(Date.UTC(y, m - 1, d)); // safe here: y >= 2000 is never remapped
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// The day changed while a form stayed open: move its date to the new today only when it still
// holds the default it was given (a day the user picked is left alone).
export function rollDefaultDate(value, oldDefault, newToday) {
  return value === oldDefault ? newToday : value;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

export function newEntry(fields, nowIso, id) {
  const f = fields || {};
  const what = str(f.what_i_did);
  if (!what) throw new Error('what_i_did required');
  return {
    id,
    date: str(f.date),
    project: str(f.project),
    what_i_did: what,
    impact: str(f.impact),
    stakeholders: str(f.stakeholders),
    feedback: str(f.feedback),
    created_at: nowIso,
    updated_at: nowIso,
  };
}

// Date arithmetic via UTC date parts of a calendar date (no DST / timezone drift).
function parts(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

function fmtUTC(ms) {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function addDays(dateStr, n) {
  const { y, m, d } = parts(dateStr);
  return fmtUTC(Date.UTC(y, m - 1, d + n));
}

const projKey = (p) => String(p || '').replace(/\s+/g, '').toLowerCase();
const blank = (v) => !String(v || '').trim();

function cmpDateDescThenCreatedDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return 0;
}

export function recentProjects(entries, today, limit = 5, days = 60) {
  const cutoff = addDays(today, -days);
  const best = new Map(); // key -> most recent entry
  for (const e of entries) {
    const name = String(e.project || '').trim();
    if (!name || e.date < cutoff) continue;
    const k = projKey(name);
    const cur = best.get(k);
    if (!cur || cmpDateDescThenCreatedDesc(e, cur) < 0) best.set(k, e);
  }
  return [...best.values()]
    .sort(cmpDateDescThenCreatedDesc)
    .slice(0, limit)
    .map((e) => String(e.project).trim());
}

export function missingImpact(entries, today, days = 28) {
  const cutoff = addDays(today, -days);
  return entries
    .filter((e) => e.date >= cutoff && blank(e.impact))
    .sort(cmpDateDescThenCreatedDesc);
}

export function weekRange(dateStr) {
  const { y, m, d } = parts(dateStr);
  const ms = Date.UTC(y, m - 1, d);
  const dow = (new Date(ms).getUTCDay() + 6) % 7; // Monday = 0
  const startMs = ms - dow * 86400000;
  const thursday = new Date(startMs + 3 * 86400000);
  const jan1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const weekNo = Math.floor((thursday.getTime() - jan1) / 86400000 / 7) + 1;
  return { start: fmtUTC(startMs), end: fmtUTC(startMs + 6 * 86400000), weekNo };
}

export function weekProgress(entries, today) {
  const { start, end } = weekRange(today);
  const week = entries.filter((e) => e.date >= start && e.date <= end);
  return { withImpact: week.filter((e) => !blank(e.impact)).length, total: week.length };
}

export function monthCount(entries, today) {
  const prefix = today.slice(0, 7);
  return entries.filter((e) => String(e.date).slice(0, 7) === prefix).length;
}

export function filterEntries(entries, { project = null, text = '', onlyNoImpact = false } = {}) {
  const pk = project === null || project === undefined ? null : projKey(project);
  const q = String(text || '').trim().toLowerCase();
  return entries.filter((e) => {
    if (pk !== null && projKey(e.project) !== pk) return false;
    if (onlyNoImpact && !blank(e.impact)) return false;
    if (q) {
      const hay = [e.project, e.what_i_did, e.impact, e.stakeholders, e.feedback]
        .map((v) => String(v || '').toLowerCase())
        .join('\n');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function groupByMonth(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = String(e.date).slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  return [...map.keys()]
    .sort()
    .reverse()
    .map((key) => {
      const [y, m] = key.split('-').map(Number);
      return {
        key,
        label: `${MONTHS[m - 1]} ${y}`,
        entries: map.get(key).sort(cmpDateDescThenCreatedDesc),
      };
    });
}

export function toCopyText(entries) {
  return [...entries]
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
      return 0;
    })
    .map((e) => {
      const proj = String(e.project || '').trim() || '未歸屬';
      let line = `${e.date} · ${proj} — ${String(e.what_i_did || '').trim()}`;
      const impact = String(e.impact || '').trim();
      if (impact) line += ` → ${impact}`;
      const who = String(e.stakeholders || '').trim();
      if (who) line += `（${who}）`;
      return line;
    })
    .join('\n');
}
