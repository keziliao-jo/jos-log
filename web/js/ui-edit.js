// Entry editor: a modal over the frame, reused by Log (Today list), Week and All.
//   openEditor(ctx, entry) -> void
// A list that opens the editor should put data-entry-id on the row, so focus can return to the
// redrawn row after a save.
// Saves with store.update (changed fields only), deletes with store.remove after a confirm click.

import { h } from './dom.js';
import { isSubmitEvent } from './keys.js';
import { recentProjects, MAX_FIELD } from './model.js';

const FIELDS = ['date', 'project', 'what_i_did', 'impact', 'stakeholders', 'feedback'];
const CONFIRM_MS = 6000;

// Attributes shared by every date input and every text field (the store enforces the same rules).
export const DATE_ATTRS = { min: '2000-01-01', max: '2099-12-31' };
export const TEXT_ATTRS = { maxlength: String(MAX_FIELD) };

// A store.add / store.update error as the message a form shows; the form keeps what was typed.
export function saveErrorText(err) {
  const m = err && err.message;
  if (m === 'what_i_did required') return 'What I did 不可空白';
  if (m === 'invalid date') return '日期不正確（2000–2099）';
  if (m === 'too long') return `內容太長（上限 ${MAX_FIELD} 字）`;
  return '無法儲存到本機';
}

// The patch for store.update: fields whose trimmed value differs from the entry's.
// A blank date is never sent (the store keeps the old date anyway).
export function changedFields(entry, values) {
  const patch = {};
  for (const k of FIELDS) {
    const next = String(values[k] ?? '').trim();
    const prev = String(entry[k] ?? '').trim();
    if (k === 'date' && next === '') continue;
    if (next !== prev) patch[k] = next;
  }
  return patch;
}

let current = null; // { close } of the open editor; only one at a time

export function isEditorOpen() {
  return current !== null;
}

export function closeEditor() {
  if (current) current.close();
}

export function openEditor(ctx, entry) {
  if (current) current.close();

  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openerId = opener && opener.dataset ? opener.dataset.entryId : undefined; // the list may redraw its rows on save
  const frame = document.querySelector('.frame');
  const uid = `ed-${entry.id}`;

  const dateIn = h('input', { class: 'in', id: `${uid}-date`, type: 'date', ...DATE_ATTRS });
  dateIn.value = entry.date || '';

  const listId = `${uid}-projects`;
  const projIn = h('input', {
    class: 'in',
    id: `${uid}-project`,
    type: 'text',
    list: listId,
    autocomplete: 'off',
    placeholder: '未歸屬',
    ...TEXT_ATTRS,
  });
  projIn.value = entry.project || '';
  const datalist = h('datalist', { id: listId });
  for (const name of recentProjects(ctx.store.getState().entries, ctx.today())) {
    datalist.append(h('option', { value: name }));
  }

  const area = (key, rows) => {
    const t = h('textarea', { class: 'in', id: `${uid}-${key}`, rows: String(rows), ...TEXT_ATTRS });
    t.value = entry[key] || '';
    return t;
  };
  const whatIn = area('what_i_did', 3);
  const impactIn = area('impact', 2);
  const whoIn = area('stakeholders', 2);
  const fbIn = area('feedback', 2);

  const field = (label, input, hint) =>
    h(
      'div',
      { class: 'f' },
      h('label', { class: 'lbl', for: input.id }, label, hint ? h('i', { text: hint }) : null),
      input,
    );

  const msg = h('p', { class: 'msg', role: 'alert' });
  const saveBtn = h('button', { class: 'btn primary', type: 'button', text: '儲存' });
  const cancelBtn = h('button', { class: 'btn', type: 'button', text: '取消' });
  const delBtn = h('button', { class: 'btn block', type: 'button', text: '刪除' });

  const titleId = `${uid}-title`;
  const dialog = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('div', { class: 'sec', id: titleId, text: 'Edit entry' }),
    field('Date', dateIn),
    field('Project', projIn),
    datalist,
    field('What I did', whatIn, '必填'),
    field('Impact', impactIn, '可晚點補'),
    field('Stakeholders', whoIn),
    field('Feedback', fbIn),
    msg,
    h('div', { class: 'btns' }, saveBtn, cancelBtn),
    h('div', { class: 'modal-del' }, delBtn),
  );
  const backdrop = h('div', { class: 'modal-bg' }, dialog);

  let confirmTimer = null;
  let busy = false;
  let closed = false;

  function resetDelete() {
    clearTimeout(confirmTimer);
    confirmTimer = null;
    delBtn.textContent = '刪除';
    delBtn.classList.remove('confirm');
  }

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(confirmTimer);
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    if (frame) frame.inert = false;
    if (current && current.close === close) current = null;
    let back = opener && opener.isConnected ? opener : null;
    if (!back && openerId) back = document.querySelector(`[data-entry-id="${CSS.escape(openerId)}"]`);
    if (back) back.focus();
  }

  function fail(text) {
    msg.textContent = text;
  }

  function save() {
    if (busy) return;
    const what = whatIn.value.trim();
    if (!what) {
      fail('What I did 不可空白');
      whatIn.focus();
      return;
    }
    const patch = changedFields(entry, {
      date: dateIn.value,
      project: projIn.value,
      what_i_did: whatIn.value,
      impact: impactIn.value,
      stakeholders: whoIn.value,
      feedback: fbIn.value,
    });
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    busy = true;
    saveBtn.disabled = true;
    try {
      ctx.store.update(entry.id, patch);
    } catch (err) {
      console.error(err);
      fail(saveErrorText(err));
      busy = false;
      saveBtn.disabled = false;
      return;
    }
    close();
  }

  function remove() {
    if (busy) return;
    if (!confirmTimer) {
      delBtn.textContent = '確定刪除？';
      delBtn.classList.add('confirm');
      confirmTimer = setTimeout(resetDelete, CONFIRM_MS);
      return;
    }
    busy = true;
    try {
      ctx.store.remove(entry.id);
    } catch (err) {
      console.error(err);
      fail('無法儲存到本機');
      busy = false;
      resetDelete();
      return;
    }
    close();
  }

  function onKey(ev) {
    if (ev.key === 'Escape') {
      if (ev.isComposing || ev.keyCode === 229) return; // Escape cancels the IME candidate, not the editor
      ev.preventDefault();
      close();
      return;
    }
    if (isSubmitEvent(ev)) {
      ev.preventDefault();
      save();
      return;
    }
    if (ev.key === 'Tab') {
      // keep focus inside the dialog
      const items = [...dialog.querySelectorAll('input, textarea, button')].filter((el) => !el.disabled);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        ev.preventDefault();
        (ev.shiftKey ? last : first).focus();
      } else if (ev.shiftKey && (active === first || active === dialog)) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && active === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  }

  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', close);
  delBtn.addEventListener('click', remove);
  for (const el of [dateIn, projIn, whatIn, impactIn, whoIn, fbIn]) {
    el.addEventListener('input', () => {
      msg.textContent = '';
    });
  }
  document.addEventListener('keydown', onKey, true);

  document.body.append(backdrop);
  if (frame) frame.inert = true;
  current = { close };
  dialog.focus();
}
