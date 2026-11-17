// Log view (#/log): the daily entry form and today's list.

import { h } from './dom.js';
import { isSubmitEvent } from './keys.js';
import { recentProjects, monthCount, isValidDate, rollDefaultDate } from './model.js';
import { openEditor, closeEditor, isEditorOpen, saveErrorText, DATE_ATTRS, TEXT_ATTRS } from './ui-edit.js';

// Local HH:MM of an ISO timestamp; '' when it is missing or invalid.
export function timeLabel(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ?date=YYYY-MM-DD when it is a valid date (real, 2000-2099), otherwise today.
export function initialDate(query, today) {
  const q = query && typeof query.get === 'function' ? query.get('date') : null;
  return q && isValidDate(q) ? q : today;
}

const pkey = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// The project picked last time, kept while the app stays open (moving between tabs).
let remembered = '';

export function render(container, ctx) {
  const { store } = ctx;
  let alive = true;
  let saving = false;

  // ----- state -----
  let selected = remembered; // project name; '' = 未歸屬
  let newMode = false; // the "+ new" text input is showing
  let chipNames = recentProjects(store.getState().entries, ctx.today());
  if (selected && !chipNames.some((n) => pkey(n) === pkey(selected))) chipNames.push(selected);
  let listSig = '';

  // ----- fields -----
  const dateIn = h('input', { class: 'in', id: 'lg-date', type: 'date', ...DATE_ATTRS });
  let day = ctx.today(); // the today the date default was set for; see rollDay()
  dateIn.value = initialDate(ctx.query, day);

  const chipsEl = h('div', { class: 'chips', role: 'group', 'aria-label': 'Project' });
  const newIn = h('input', {
    class: 'in',
    id: 'lg-newproject',
    type: 'text',
    autocomplete: 'off',
    placeholder: '新專案名稱',
    'aria-label': '新專案名稱',
    hidden: '',
    ...TEXT_ATTRS,
  });
  newIn.style.marginTop = '8px';

  const whatIn = h('textarea', { class: 'in', id: 'lg-what', rows: '2', placeholder: '今天做了什麼', ...TEXT_ATTRS });
  const impactIn = h('textarea', { class: 'in', id: 'lg-impact', rows: '2', placeholder: '例：新人更快上手', ...TEXT_ATTRS });
  const whoIn = h('input', { class: 'in', id: 'lg-who', type: 'text', placeholder: '和誰一起、為誰做', autocomplete: 'off', ...TEXT_ATTRS });
  const fbIn = h('input', { class: 'in', id: 'lg-feedback', type: 'text', placeholder: '收到的回饋', autocomplete: 'off', ...TEXT_ATTRS });

  const extra = h(
    'div',
    { hidden: '' },
    h('div', { class: 'f' }, h('label', { class: 'lbl', for: 'lg-who', text: 'Stakeholders' }), whoIn),
    h('div', { class: 'f' }, h('label', { class: 'lbl', for: 'lg-feedback', text: 'Feedback' }), fbIn),
  );
  const moreBtn = h('button', {
    class: 'more',
    type: 'button',
    'aria-expanded': 'false',
    'aria-controls': 'lg-extra',
    text: '+ Stakeholders · Feedback',
  });
  extra.id = 'lg-extra';
  moreBtn.addEventListener('click', () => {
    const open = extra.hidden;
    extra.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
    if (open) whoIn.focus();
  });

  const msg = h('p', { class: 'msg', role: 'alert' });
  const logBtn = h('button', { class: 'btn primary block', type: 'button', text: 'log it' });

  // ----- project chips -----
  // The buttons are rebuilt only when the set of names changes; a selection change just flips
  // class and aria-pressed in place, so a focused chip keeps keyboard focus.
  let nameSig = null;
  let nameBtns = [];
  let newBtn = null;

  function setOn(btn, on) {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  }

  function pickChip(name) {
    const on = !newMode && pkey(name) === pkey(selected);
    selected = on ? '' : name; // tapping the selected chip again clears it (未歸屬)
    newMode = false;
    newIn.hidden = true;
    remember();
    paintChips();
  }

  function toggleNew() {
    if (newMode) {
      newMode = false;
      newIn.hidden = true;
      newIn.value = '';
      selected = '';
    } else {
      newMode = true;
      newIn.hidden = false;
      selected = newIn.value.trim();
    }
    remember();
    paintChips();
    if (newMode) newIn.focus(); // leaving new mode leaves focus on the + new chip
  }

  function paintChips() {
    const sig = JSON.stringify(chipNames);
    if (sig !== nameSig) {
      nameSig = sig;
      const focusedName = nameBtns.find((b) => b === document.activeElement)?.textContent;
      const hadNewFocus = newBtn !== null && newBtn === document.activeElement;
      nameBtns = chipNames.map((name) => {
        const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', text: name });
        b.addEventListener('click', () => pickChip(name));
        return b;
      });
      newBtn = h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', text: '+ new' });
      newBtn.addEventListener('click', toggleNew);
      chipsEl.replaceChildren(...nameBtns, newBtn);
      if (hadNewFocus) newBtn.focus();
      else if (focusedName !== undefined) nameBtns.find((b) => b.textContent === focusedName)?.focus();
    }
    nameBtns.forEach((b, i) => setOn(b, !newMode && pkey(chipNames[i]) === pkey(selected)));
    setOn(newBtn, newMode);
  }

  function remember() {
    remembered = selected;
  }

  newIn.addEventListener('input', () => {
    selected = newIn.value.trim();
    remember();
    paintChips();
  });

  // New names that entered the recent list (another device, or the entry just saved) join the row
  // at the end, so chips never jump around under the thumb.
  function syncChips() {
    for (const name of recentProjects(store.getState().entries, ctx.today())) {
      if (!chipNames.some((n) => pkey(n) === pkey(name))) chipNames.push(name);
    }
    if (newMode) {
      const hit = chipNames.find((n) => pkey(n) === pkey(selected));
      if (hit && selected) {
        newMode = false;
        newIn.hidden = true;
        newIn.value = '';
        selected = hit;
        remember();
      }
    }
    paintChips();
  }

  // ----- Today -----
  const todaySec = h('div', { class: 'sec' });
  const listEl = h('div');

  function paintToday() {
    const day = ctx.today();
    const rows = store
      .getState()
      .entries.filter((e) => e.date === day)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    const loaded = store.getState().hasLoaded;
    const sig = JSON.stringify([rows, loaded]);
    if (sig === listSig) return;
    listSig = sig;
    todaySec.replaceChildren('Today');
    if (rows.length) todaySec.append(h('span', { class: 'n', text: String(rows.length) }));
    if (rows.length === 0) {
      listEl.replaceChildren(h('p', { class: 'empty', text: loaded ? '今天還沒有紀錄' : '尚未載入資料' }));
      return;
    }
    listEl.replaceChildren(
      ...rows.map((e) => {
        const proj = (e.project || '').trim() || '未歸屬';
        const time = timeLabel(e.created_at);
        const p = h('p', { text: e.what_i_did });
        if (!String(e.impact || '').trim()) p.append(' ', h('span', { class: 'badge', text: 'no impact' }));
        const row = h('button', { class: 'it', type: 'button', 'data-entry-id': e.id }, h('div', { class: 'm', text: time ? `${proj} · ${time}` : proj }), p);
        row.addEventListener('click', () => openEditor(ctx, e));
        return row;
      }),
    );
  }

  // ----- save -----
  function save() {
    if (saving) return;
    const what = whatIn.value.trim();
    if (!what) {
      whatIn.focus();
      return;
    }
    saving = true;
    logBtn.disabled = true;
    try {
      const date = dateIn.value.trim() || ctx.today();
      dateIn.value = date;
      store.add({
        date,
        project: selected,
        what_i_did: what,
        impact: impactIn.value,
        stakeholders: whoIn.value,
        feedback: fbIn.value,
      });
    } catch (err) {
      console.error(err);
      msg.textContent = saveErrorText(err);
      return; // keep everything the user typed
    } finally {
      saving = false;
      logBtn.disabled = false;
    }
    msg.textContent = '';
    whatIn.value = '';
    impactIn.value = '';
    whoIn.value = '';
    fbIn.value = '';
    ctx.toast('已記錄');
    syncChips();
    paintToday();
    whatIn.focus();
  }

  logBtn.addEventListener('click', save);
  const onKey = (ev) => {
    if (!isSubmitEvent(ev)) return;
    ev.preventDefault();
    save();
  };
  for (const el of [dateIn, newIn, whatIn, impactIn, whoIn, fbIn]) el.addEventListener('keydown', onKey);
  for (const el of [dateIn, whatIn, impactIn, whoIn, fbIn, newIn]) el.addEventListener('input', () => (msg.textContent = ''));

  // ----- assemble -----
  const field = (label, id, hint, ...kids) =>
    h('div', { class: 'f' }, h('label', { class: 'lbl', for: id }, label, hint ? h('i', { text: hint }) : null), ...kids);

  container.append(
    field('Date', 'lg-date', '', dateIn),
    h('div', { class: 'f' }, h('span', { class: 'lbl', text: 'Project' }), chipsEl, newIn),
    field('What I did', 'lg-what', '必填', whatIn),
    field('Impact', 'lg-impact', '可晚點補', impactIn),
    moreBtn,
    extra,
    msg,
    logBtn,
    todaySec,
    listEl,
  );

  // ----- store -----
  // The day can change while the app stays open (a phone resumes it the next morning without a
  // reload): move an untouched default date to the new today. Today and the note repaint below.
  function rollDay() {
    const now = ctx.today();
    if (now === day) return;
    dateIn.value = rollDefaultDate(dateIn.value, day, now);
    day = now;
  }

  function paintAll() {
    if (!alive) return;
    rollDay();
    ctx.setNote(`本月 ${monthCount(store.getState().entries, ctx.today())} 筆`);
    syncChips();
    paintToday();
  }
  paintAll();
  const unsub = store.subscribe(paintAll);
  const onVisible = () => {
    if (document.visibilityState === 'visible') paintAll();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', paintAll);

  if (!isEditorOpen()) whatIn.focus();

  return () => {
    alive = false;
    unsub();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', paintAll);
    closeEditor();
    for (const el of [dateIn, newIn, whatIn, impactIn, whoIn, fbIn]) el.removeEventListener('keydown', onKey);
  };
}
