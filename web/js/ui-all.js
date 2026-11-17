// All view (#/all): every entry by month, filtered by project / text / "no impact only",
// with Copy as text for the current filter.

import { h } from './dom.js';
import { tickSvg } from './icon.js';
import { filterEntries, groupByMonth, toCopyText, recentProjects } from './model.js';
import { dateLabel, nextRowId } from './ui-week.js';
import { openEditor, closeEditor, isEditorOpen } from './ui-edit.js';

export { dateLabel };

const TOP_PROJECTS = 5;
const PROJECT_WINDOW_DAYS = 3650; // older projects stay reachable from All
const NONE_LABEL = '未歸屬';

// ---------- pure helpers ----------

const projKey = (p) => String(p || '').replace(/\s+/g, '').toLowerCase();
const text = (v) => String(v || '').trim();

// Project selection: null = All, '' = 未歸屬, otherwise a name compared by key
// (case and spaces ignored, like model.filterEntries).
export function sameProject(a, b) {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an && bn;
  return projKey(a) === projKey(b);
}

function newestFirst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return 0;
}

// The project chips of the All page, without the 更多 toggle (the view appends it).
//   chips: [{ label, project }]  project: null (All) | '' (未歸屬) | name
//   hasMore: whether 更多 would reveal anything
// Collapsed: All + the five most recent projects; expanded: every distinct project (newest
// first) + 未歸屬 when some entry has no project. A selected project that is not shown is
// added after the others, so the current choice is always visible.
export function projectChoices(entries, today, { selected = null, expanded = false } = {}) {
  const top = recentProjects(entries, today, TOP_PROJECTS, PROJECT_WINDOW_DAYS);
  const names = new Map(); // key -> name of the newest entry, newest first
  let hasBlank = false;
  for (const e of [...entries].sort(newestFirst)) {
    const name = text(e.project);
    if (!name) {
      hasBlank = true;
      continue;
    }
    const k = projKey(name);
    if (!names.has(k)) names.set(k, name);
  }
  const topKeys = new Set(top.map(projKey));
  const rest = [...names.entries()].filter(([k]) => !topKeys.has(k)).map(([, n]) => n);

  const chips = [{ label: 'All', project: null }, ...top.map((n) => ({ label: n, project: n }))];
  if (expanded) {
    for (const n of rest) chips.push({ label: n, project: n });
    if (hasBlank) chips.push({ label: NONE_LABEL, project: '' });
  }
  if (selected !== null && selected !== undefined && !chips.some((c) => sameProject(c.project, selected))) {
    const name = names.get(projKey(selected)) || text(selected); // the real spelling when it exists
    chips.push({ label: name || NONE_LABEL, project: name });
  }
  return { chips, hasMore: rest.length > 0 || hasBlank };
}

// The muted line under an entry: Project · Impact · Stakeholders, empty parts left out.
export function metaLine(e) {
  return [text(e.project) || NONE_LABEL, text(e.impact), text(e.stakeholders)].filter(Boolean).join(' · ');
}

// Entry ids in the order the rows are displayed (the groupByMonth output), the single source of
// row order for rendering and for the focus hand-off.
export function displayOrder(groups) {
  return groups.flatMap((g) => g.entries.map((e) => e.id));
}

export function copyLabel(n) {
  return n > 0 ? `Copy as text（目前篩選 ${n} 筆）` : '沒有可複製的紀錄';
}

// hasLoaded false: nothing has come from the server or the cache yet, so "no entries" is unknown.
export function emptyText(totalEntries, hasLoaded = true) {
  if (totalEntries > 0) return '沒有符合的紀錄';
  return hasLoaded ? '還沒有任何紀錄' : '尚未載入資料';
}

function execCopy(str, doc) {
  const prev = doc.activeElement;
  const ta = doc.createElement('textarea');
  ta.value = str;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0', fontSize: '16px' });
  doc.body.append(ta);
  let ok = false;
  try {
    ta.select();
    ta.setSelectionRange(0, str.length);
    ok = doc.execCommand('copy') === true;
  } catch (_) {
    ok = false;
  } finally {
    ta.remove();
    if (prev && typeof prev.focus === 'function') prev.focus();
  }
  return ok;
}

// Copy str; Clipboard API first, then a hidden textarea + execCommand('copy').
// env is injectable for tests. Resolves true on success, false when nothing worked.
export async function copyToClipboard(str, env = {}) {
  const clipboard = 'clipboard' in env ? env.clipboard : globalThis.navigator?.clipboard;
  const doc = 'document' in env ? env.document : globalThis.document;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(str);
      return true;
    } catch (_) {
      // permission denied or not allowed here: fall through
    }
  }
  return doc ? execCopy(str, doc) : false;
}

// ---------- view ----------

export function render(container, ctx) {
  const { store } = ctx;
  const ac = new AbortController();
  const on = (el, type, fn) => el.addEventListener(type, fn, { signal: ac.signal });
  let alive = true;

  // ----- state -----
  let selected = null; // null = All, '' = 未歸屬, else a project name
  let expanded = false;
  let filtered = [];
  let resultsSig = null;
  let order = []; // entry ids in display order, as last painted
  let openedId = null; // the row whose click last opened the editor
  let byId = new Map();
  let copying = false;

  // ----- controls (built once; never replaced) -----
  const searchIn = h('input', {
    class: 'in',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    placeholder: '搜尋 what / impact / stakeholders',
    'aria-label': '搜尋',
  });
  const chipsEl = h('div', { class: 'chips al-chips', role: 'group', 'aria-label': 'Project' });

  const tick = h('span', { class: 'bx', 'aria-hidden': 'true' });
  tick.innerHTML = tickSvg(); // static markup from icon.js, no user text
  const noImpactIn = h('input', { class: 'chk-in', type: 'checkbox' });
  const noImpactRow = h('label', { class: 'chk' }, noImpactIn, tick, h('span', { class: 'sans', text: '只看沒 Impact' }));

  // ----- chips -----
  // Buttons are rebuilt only when the set of chips changes; a selection change flips `on` and
  // aria-pressed in place, so a focused chip keeps keyboard focus. When a rebuild is needed the
  // focused chip is found again by key.
  const keyOf = (project) => (project === null ? 'all' : project === '' ? 'none' : `p:${projKey(project)}`);
  let chipSig = null;
  let chipBtns = []; // { key, project, btn }
  let moreBtn = null;

  function setPressed(btn, isOn) {
    btn.classList.toggle('on', isOn);
    btn.setAttribute('aria-pressed', String(isOn));
  }

  function pick(project) {
    selected = project;
    paintChips();
    paintResults();
  }

  function paintChips() {
    const { chips, hasMore } = projectChoices(store.getState().entries, ctx.today(), { selected, expanded });
    const sig = JSON.stringify([chips.map((c) => [keyOf(c.project), c.label]), hasMore]);
    if (sig !== chipSig) {
      chipSig = sig;
      const active = document.activeElement;
      const focusKey = moreBtn && active === moreBtn ? 'more' : chipBtns.find((c) => c.btn === active)?.key;
      chipBtns = chips.map((c) => {
        const btn = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', text: c.label });
        btn.addEventListener('click', () => pick(c.project));
        return { key: keyOf(c.project), project: c.project, btn };
      });
      moreBtn = hasMore ? h('button', { class: 'chip', type: 'button', 'aria-expanded': String(expanded), text: '更多' }) : null;
      if (moreBtn) {
        moreBtn.addEventListener('click', () => {
          expanded = !expanded;
          paintChips();
        });
      }
      chipsEl.replaceChildren(...chipBtns.map((c) => c.btn), ...(moreBtn ? [moreBtn] : []));
      if (focusKey === 'more' && moreBtn) moreBtn.focus();
      else if (focusKey) chipBtns.find((c) => c.key === focusKey)?.btn.focus();
    }
    for (const c of chipBtns) setPressed(c.btn, sameProject(c.project, selected));
    if (moreBtn) moreBtn.setAttribute('aria-expanded', String(expanded));
  }

  // ----- results -----
  const resultsEl = h('div', { class: 'al-results' });
  const copyBtn = h('button', { class: 'btn block al-copy', type: 'button' });

  function makeRow(e) {
    const p = h('p', { text: e.what_i_did });
    if (!text(e.impact)) p.append(' ', h('span', { class: 'badge', text: 'no impact' }));
    const row = h(
      'button',
      { class: 'it', type: 'button', 'data-entry-id': e.id },
      h(
        'div',
        { class: 'al-row' },
        h('div', { class: 'al-d', text: dateLabel(e.date) }),
        h('div', { class: 'al-c' }, p, h('div', { class: 'al-sub', text: metaLine(e) })),
      ),
    );
    row.addEventListener('click', () => {
      const cur = byId.get(e.id);
      if (!cur) return;
      openedId = e.id;
      openEditor(ctx, cur);
    });
    return row;
  }

  function paintResults() {
    const all = store.getState().entries;
    const loaded = store.getState().hasLoaded;
    byId = new Map(all.map((e) => [e.id, e]));
    filtered = filterEntries(all, { project: selected, text: searchIn.value, onlyNoImpact: noImpactIn.checked });

    // the Copy button always follows the filter, even when the list below is unchanged
    copyBtn.textContent = copyLabel(filtered.length);
    copyBtn.disabled = filtered.length === 0;

    const sig = JSON.stringify([filtered, all.length === 0, loaded]);
    if (sig === resultsSig) return;
    resultsSig = sig;

    const active = document.activeElement;
    const focusedId = active && resultsEl.contains(active) ? active.dataset.entryId : null;
    const groups = groupByMonth(filtered);
    const newIds = displayOrder(groups);
    const goneFocus = focusedId && !newIds.includes(focusedId) ? focusedId : null;
    const goneEditor = openedId && isEditorOpen() && !newIds.includes(openedId) ? openedId : null;
    const handoffFocus = goneFocus ? nextRowId(order, newIds, goneFocus) : null;
    const handoffEditor = goneEditor ? nextRowId(order, newIds, goneEditor) : null;

    if (filtered.length === 0) {
      resultsEl.replaceChildren(h('p', { class: 'empty', text: emptyText(all.length, loaded) }));
    } else {
      resultsEl.replaceChildren(
        ...groups.flatMap((g) => [
          h('div', { class: 'sec' }, g.label, h('span', { class: 'n', text: `${g.entries.length} 筆` })),
          ...g.entries.map(makeRow),
        ]),
      );
    }
    order = newIds;

    const rowFor = (id) => (id ? resultsEl.querySelector(`[data-entry-id="${CSS.escape(id)}"]`) : null);
    if (focusedId) (rowFor(focusedId) || rowFor(handoffFocus) || searchIn).focus();
    if (goneEditor) {
      // the editor closes right after its save returns; if focus then falls to the page, hand it on
      setTimeout(() => {
        if (!alive || isEditorOpen()) return;
        const a = document.activeElement;
        if (!a || a === document.body) (rowFor(handoffEditor) || searchIn).focus();
      }, 0);
    }
  }

  async function copy() {
    if (copying || filtered.length === 0) return;
    const n = filtered.length;
    const str = toCopyText(filtered);
    copying = true;
    let ok = false;
    try {
      ok = await copyToClipboard(str);
    } catch (err) {
      console.error(err);
    } finally {
      copying = false;
    }
    ctx.toast(ok ? `已複製 ${n} 筆` : '複製失敗');
  }

  on(searchIn, 'input', paintResults);
  on(noImpactIn, 'change', () => {
    tick.classList.toggle('on', noImpactIn.checked);
    paintResults();
  });
  on(copyBtn, 'click', copy);

  const foot = h('p', { class: 'foot al-foot' }, h('a', { href: '#/settings', text: 'Settings' }));
  container.append(searchIn, chipsEl, noImpactRow, resultsEl, copyBtn, foot);

  function paintAll() {
    if (!alive) return;
    ctx.setNote(`共 ${store.getState().entries.length} 筆`);
    paintChips();
    paintResults();
  }
  paintAll();
  const unsub = store.subscribe(paintAll);

  return () => {
    alive = false;
    unsub();
    ac.abort();
    closeEditor();
  };
}
