// Week view (#/week): weekly sweep reminders, this week's Impact progress, and the list of
// entries from the last 28 days that still have no Impact, each with an inline fix.

import { h } from './dom.js';
import { tickSvg } from './icon.js';
import { missingImpact, weekRange, weekProgress } from './model.js';
import { SWEEP_ITEMS, loadSweep, saveSweep } from './sweep.js';
import { openEditor, closeEditor, isEditorOpen, saveErrorText, TEXT_ATTRS } from './ui-edit.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- pure helpers ----------

// 'Nov 13' for '2026-11-13'; anything that is not YYYY-MM-DD is shown as it is.
export function dateLabel(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return String(dateStr || '');
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

// Enter saves the Impact field, except the Enter that confirms an IME candidate (isComposing,
// or keyCode 229 on Safari).
export function isImpactEnter(ev) {
  return ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229;
}

// After row `goneId` left the list: the first remaining row that used to come after it, else null.
export function nextRowId(oldIds, newIds, goneId) {
  const at = oldIds.indexOf(goneId);
  if (at < 0) return null;
  const keep = new Set(newIds);
  for (let i = at + 1; i < oldIds.length; i++) if (keep.has(oldIds[i])) return oldIds[i];
  return null;
}

export function progressPct(withImpact, total) {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((withImpact / total) * 100)));
}

// ---------- view ----------

export function render(container, ctx) {
  const { store } = ctx;
  const ac = new AbortController();
  const on = (el, type, fn) => el.addEventListener(type, fn, { signal: ac.signal });
  let alive = true;

  let weekStart = '';
  let checks = SWEEP_ITEMS.map(() => false);

  // ----- sweep checklist -----
  const sweepTitle = h('div', { class: 'sec', text: 'Weekly sweep · 15 min' });
  const boxes = SWEEP_ITEMS.map((label, i) => {
    const input = h('input', { class: 'chk-in', type: 'checkbox' });
    const bx = h('span', { class: 'bx', 'aria-hidden': 'true' });
    bx.innerHTML = tickSvg(); // static markup from icon.js, no user text
    const row = h('label', { class: 'chk' }, input, bx, h('span', { class: 'sans', text: label }));
    on(input, 'change', () => {
      checks[i] = input.checked;
      bx.classList.toggle('on', input.checked);
      saveSweep(ctx.storage, weekStart, checks);
    });
    return { row, input, bx };
  });
  const sweepList = h('div', { role: 'group', 'aria-label': 'Weekly sweep' }, ...boxes.map((b) => b.row));

  function paintChecks() {
    boxes.forEach((b, i) => {
      b.input.checked = checks[i];
      b.bx.classList.toggle('on', checks[i]);
    });
  }

  // ----- progress -----
  const barFill = h('div');
  const bar = h(
    'div',
    { class: 'bar', role: 'progressbar', 'aria-label': '本週有 Impact 的比例', 'aria-valuemin': '0', 'aria-valuemax': '100' },
    barFill,
  );
  const progText = h('span');
  const prog = h('div', { class: 'prog wk-prog' }, bar, progText);

  // ----- missing impact -----
  const badge = h('span', { class: 'badge' });
  const missingHead = h('div', { class: 'sec', tabindex: '-1' }, 'Missing impact ', badge);
  const listEl = h('div');
  const emptyEl = h('p', { class: 'empty', text: '沒有待補的紀錄' });
  const moreLink = h('a', { class: 'btn block wk-more', text: '記漏了？新增本週紀錄' });

  const rows = new Map(); // entry id -> { el, meta, what, input, btn, open }
  const drafts = new Map(); // entry id -> text typed but not saved; survives a rebuild of that row
  let byId = new Map();
  let order = []; // ids in display order, as last painted
  let savingId = null; // the row whose save is in progress (it may lose focus when it disappears)
  let openedId = null; // the row whose text last opened the editor

  function focusRowInput(id) {
    const r = id ? rows.get(id) : null;
    if (r) r.input.focus();
    else missingHead.focus();
  }

  function saveRow(id) {
    const r = rows.get(id);
    if (!r) return;
    const impact = r.input.value.trim();
    if (!impact) {
      r.input.focus(); // blank does nothing
      return;
    }
    savingId = id;
    try {
      store.update(id, { impact }); // notifies synchronously; the row disappears in paintMissing
    } catch (err) {
      console.error(err);
      ctx.toast(saveErrorText(err)); // the typed text stays in the row
      return;
    } finally {
      savingId = null;
    }
    drafts.delete(id);
    ctx.toast('已補上 Impact');
  }

  function makeRow(e) {
    const id = e.id;
    const meta = h('div', { class: 'm' });
    const what = h('p');
    const open = h('button', { class: 'it-open', type: 'button' }, meta, what);
    const input = h('input', {
      class: 'in need',
      type: 'text',
      autocomplete: 'off',
      placeholder: '這件事帶來什麼改變？',
      ...TEXT_ATTRS,
    });
    input.value = drafts.get(id) || '';
    const btn = h('button', { class: 'btn', type: 'button', text: '儲存' });
    const el = h('div', { class: 'it', 'data-entry-id': id }, open, h('div', { class: 'imp' }, input, btn));
    on(open, 'click', () => {
      const cur = byId.get(id);
      if (!cur) return;
      openedId = id;
      openEditor(ctx, cur);
    });
    on(btn, 'click', () => saveRow(id));
    on(input, 'input', () => drafts.set(id, input.value));
    on(input, 'keydown', (ev) => {
      if (!isImpactEnter(ev)) return;
      ev.preventDefault();
      saveRow(id);
    });
    return { el, meta, what, input, btn, open };
  }

  function patchRow(r, e) {
    const proj = String(e.project || '').trim() || '未歸屬';
    const metaText = `${dateLabel(e.date)} · ${proj}`;
    const whatText = String(e.what_i_did || '');
    if (r.meta.textContent !== metaText) r.meta.textContent = metaText;
    if (r.what.textContent !== whatText) r.what.textContent = whatText;
    r.input.setAttribute('aria-label', `Impact · ${whatText}`);
  }

  // Reconcile the list with the store without rebuilding rows that stay: a row keeps its input
  // node (typed text, focus, caret) across notifications, and only added, removed or reordered
  // rows are touched in the DOM.
  function paintMissing() {
    const list = missingImpact(store.getState().entries, ctx.today());
    byId = new Map(store.getState().entries.map((e) => [e.id, e]));
    const newIds = list.map((e) => e.id);
    const keep = new Set(newIds);
    const active = document.activeElement;

    let focusLost = null;
    let editorLost = null; // saved from the editor: it returns focus to a row that is now gone
    for (const [id, r] of rows) {
      if (keep.has(id)) continue;
      if (id === savingId || (active && r.el.contains(active))) focusLost = id;
      else if (id === openedId && isEditorOpen()) editorLost = id;
      r.el.remove();
      rows.delete(id);
    }
    const handoff = focusLost ? nextRowId(order, newIds, focusLost) : null;
    const editorHandoff = editorLost ? nextRowId(order, newIds, editorLost) : null;

    // a moved row can drop focus in some browsers; remember the caret to put it back
    const focusedInput = active instanceof HTMLInputElement && listEl.contains(active) ? active : null;
    const sel = focusedInput ? [focusedInput.selectionStart, focusedInput.selectionEnd] : null;

    list.forEach((e, i) => {
      let r = rows.get(e.id);
      if (!r) {
        r = makeRow(e);
        rows.set(e.id, r);
      }
      patchRow(r, e);
      if (listEl.children[i] !== r.el) listEl.insertBefore(r.el, listEl.children[i] || null);
    });
    order = newIds;

    if (focusedInput && focusedInput.isConnected && document.activeElement !== focusedInput) {
      focusedInput.focus();
      try {
        focusedInput.setSelectionRange(sel[0], sel[1]);
      } catch (_) {
        // not a text input
      }
    }
    if (focusLost) focusRowInput(handoff);
    if (editorLost) {
      // the editor closes right after its save returns; if focus then falls to the page, hand it on
      setTimeout(() => {
        if (!alive || isEditorOpen()) return;
        const a = document.activeElement;
        if (!a || a === document.body) focusRowInput(editorHandoff);
      }, 0);
    }

    badge.textContent = String(list.length);
    badge.hidden = list.length === 0;
    emptyEl.hidden = list.length > 0;
  }

  function paintProgress() {
    const { withImpact, total } = weekProgress(store.getState().entries, ctx.today());
    if (total === 0) {
      bar.hidden = true;
      progText.textContent = '本週還沒有紀錄';
      return;
    }
    const pct = progressPct(withImpact, total);
    bar.hidden = false;
    barFill.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuetext', `${withImpact} / ${total}`);
    progText.textContent = `${withImpact} / ${total} 筆有 Impact`;
  }

  // The week can roll over while the page stays open (the app repaints on return to the tab).
  function paintWeek() {
    const range = weekRange(ctx.today());
    if (range.start !== weekStart) {
      weekStart = range.start;
      checks = loadSweep(ctx.storage, weekStart);
      paintChecks();
      moreLink.setAttribute('href', `#/log?date=${weekStart}`);
    }
    ctx.setNote(`Week ${range.weekNo}`);
  }

  function paintAll() {
    if (!alive) return;
    paintWeek();
    paintProgress();
    paintMissing();
  }

  container.append(sweepTitle, sweepList, prog, missingHead, listEl, emptyEl, moreLink);
  paintAll();
  const unsub = store.subscribe(paintAll);
  // a phone resumes a hidden app without reloading it: repaint with the new today (week, list)
  on(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible') paintAll();
  });
  on(window, 'pageshow', paintAll);

  return () => {
    alive = false;
    unsub();
    ac.abort();
    closeEditor();
  };
}
