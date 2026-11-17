// Settings view (#/settings): connection setup, sync status, clearing local data.
// Also the first-run screen: when no URL/token is saved, the shell shows only this view.

import { createApi, ApiError, NetworkError } from './api.js';
import { saveConfig, isConfigured } from './config.js';
import { h } from './dom.js';
import { copyToClipboard } from './ui-all.js';

const PRIVACY = '避免在 Impact、Stakeholders、Feedback 寫入機密數字或客戶名稱。';
const LOCAL_KEYS = ['jos_cache', 'jos_queue', 'jos_rejected'];
const TEXT_FIELDS = ['date', 'project', 'what_i_did', 'impact', 'stakeholders', 'feedback'];
const LABEL_MAX = 60; // characters of what_i_did (or the first text field) shown per rejected op
const SWEEP_PREFIX = 'jos_sweep_';

// Store state -> the short sync text shown in the header and here.
export function statusText({ status, pending }) {
  const n = Number(pending) || 0;
  switch (status) {
    case 'syncing':
      return '同步中';
    case 'pending':
      return n > 0 ? `${n} 筆待同步` : '待同步';
    case 'offline':
      return n > 0 ? `離線 · ${n} 筆待同步` : '離線';
    case 'auth':
      return 'token 錯誤';
    default:
      return '已同步';
  }
}

// The header line: the sync text, plus how many ops the server refused.
export function headerText(s) {
  const n = Number(s && s.rejected) || 0;
  return n > 0 ? `${statusText(s)} · ${n} 筆被拒絕` : statusText(s);
}

const clip = (s) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX)}…` : s);

// One rejected op for display: date · project · what (truncated). An update patch shows only the
// fields it carried; a remove has no text.
export function rejectedLabel(op) {
  const e = op && op.entry;
  if (!e || typeof e !== 'object') return '';
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  if (op.type === 'add') return [str(e.date), str(e.project) || '未歸屬', clip(str(e.what_i_did))].join(' · ');
  const text = ['what_i_did', 'impact', 'stakeholders', 'feedback'].map((k) => str(e[k])).find(Boolean) || '';
  return [str(e.date), str(e.project), clip(text)].filter(Boolean).join(' · ');
}

// The text fields the op carried, as JSON, so nothing typed is lost even if it cannot be re-sent.
export function rejectedCopyText(op) {
  const e = (op && op.entry) || {};
  const out = {};
  for (const k of TEXT_FIELDS) if (typeof e[k] === 'string') out[k] = e[k];
  return JSON.stringify(out, null, 2);
}

// A failed connection test, explained in plain Chinese.
export function failureText(err) {
  if (err instanceof NetworkError) return '無法連線';
  if (err instanceof ApiError && err.code === 'auth') return 'token 錯誤';
  if (err instanceof ApiError && err.code === 'server') return '伺服器錯誤';
  return '回應格式錯誤';
}

// Removes the cache, the offline queue and the weekly sweep checks; keeps the saved config.
export function clearLocal(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
  for (const k of keys) {
    if (k !== null && (LOCAL_KEYS.includes(k) || k.startsWith(SWEEP_PREFIX))) storage.removeItem(k);
  }
}

const URL_RE = /^https?:\/\/\S+$/i;

export function render(container, ctx) {
  const { store, storage } = ctx;
  const cfg = ctx.config || { url: '', token: '' };
  let alive = true;

  if (ctx.setNote) ctx.setNote('Settings');
  if (ctx.volatileStorage) {
    container.append(h('p', { class: 'msg', role: 'alert', text: '此瀏覽器無法儲存資料，關閉頁面後待同步的紀錄會遺失' }));
  }

  // ----- connection -----
  const urlIn = h('input', {
    class: 'in',
    id: 'cfg-url',
    type: 'url',
    inputmode: 'url',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'https://script.google.com/macros/s/…/exec',
  });
  urlIn.value = cfg.url;
  const tokIn = h('input', {
    class: 'in',
    id: 'cfg-token',
    type: 'password',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: 'Script Properties 裡的 TOKEN',
  });
  tokIn.value = cfg.token;
  const msg = h('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
  const say = (text) => {
    if (alive) msg.textContent = text;
  };

  function readInputs() {
    const next = { url: urlIn.value.trim(), token: tokIn.value.trim() };
    if (!isConfigured(next)) return say('請填入 API URL 與 Token'), null;
    if (!URL_RE.test(next.url)) return say('API URL 需以 https:// 開頭'), null;
    return next;
  }

  const testBtn = h('button', { class: 'btn', type: 'button', text: '測試連線' });
  testBtn.addEventListener('click', async () => {
    const next = readInputs();
    if (!next) return;
    testBtn.disabled = true;
    say('連線中…');
    try {
      const list = await createApi(next).list();
      say(`連線成功，${list.length} 筆`);
    } catch (err) {
      say(failureText(err));
    } finally {
      if (alive) testBtn.disabled = false;
    }
  });

  const form = h(
    'form',
    { novalidate: '' },
    h('div', { class: 'f' }, h('label', { class: 'lbl', for: 'cfg-url', text: 'API URL' }), urlIn),
    h('div', { class: 'f' }, h('label', { class: 'lbl', for: 'cfg-token', text: 'Token' }), tokIn),
    h('div', { class: 'btns' }, testBtn, h('button', { class: 'btn primary', type: 'submit', text: '儲存' })),
    msg,
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const next = readInputs();
    if (!next) return;
    try {
      saveConfig(storage, next);
    } catch (_) {
      say('無法儲存設定');
      return;
    }
    ctx.toast('已儲存');
    ctx.reconfigure('#/log');
  });

  container.append(h('div', { class: 'sec', text: 'Connection' }));
  if (!store) container.append(h('p', { class: 'muted', text: '第一次使用：填入 Apps Script 網址與 token。' }));
  container.append(form);

  // ----- sync + local data (only once configured) -----
  let unsub = null;
  if (store) {
    const statusVal = h('span');
    const pendingVal = h('span');
    const authHint = h('p', { class: 'muted', text: 'token 錯誤：請重新輸入 Token 後儲存。', hidden: '' });
    const serverHint = h('p', { class: 'muted', text: '同步遇到伺服器錯誤，稍後會自動重試；若持續發生，請檢查 Apps Script 部署', hidden: '' });
    const noticeLine = h('p', { class: 'muted', hidden: '' });

    // ops the server refused: shown until cleared, each copyable
    const rejSec = h('div', { class: 'sec', text: '被拒絕的紀錄', hidden: '' });
    const rejList = h('div', { class: 'panel', hidden: '' });
    const rejClear = h('button', { class: 'btn block', type: 'button', text: '清除', hidden: '' });
    rejClear.addEventListener('click', () => store.clearRejected());
    let rejSig = null;
    const paintRejected = () => {
      const list = store.getRejected();
      const sig = JSON.stringify(list);
      if (sig === rejSig) return;
      rejSig = sig;
      const any = list.length > 0;
      rejSec.hidden = !any;
      rejList.hidden = !any;
      rejClear.hidden = !any;
      rejList.replaceChildren(
        ...list
          .slice()
          .reverse() // newest first
          .map(({ op }) => {
            const copyBtn = h('button', { class: 'btn', type: 'button', text: '複製' });
            copyBtn.addEventListener('click', async () => {
              let ok = false;
              try {
                ok = await copyToClipboard(rejectedCopyText(op));
              } catch (err) {
                console.error(err);
              }
              ctx.toast(ok ? '已複製 1 筆' : '複製失敗');
            });
            return h('div', { class: 'rj' }, h('p', { text: rejectedLabel(op) }), copyBtn);
          }),
      );
    };
    const syncBtn = h('button', { class: 'btn block', type: 'button', text: '立即同步' });
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      try {
        await store.refresh();
      } finally {
        if (alive) syncBtn.disabled = false;
      }
    });

    const clearBtn = h('button', { class: 'btn block', type: 'button', text: '清除本機資料' });
    clearBtn.addEventListener('click', () => {
      const n = store.getState().pending;
      const text =
        n > 0
          ? `清除本機資料？還有 ${n} 筆待同步，清除後會遺失。Google Sheet 上的資料不受影響。`
          : '清除本機資料？目前 0 筆待同步。Google Sheet 上的資料不受影響。';
      if (!window.confirm(text)) return;
      try {
        clearLocal(storage);
      } catch (_) {
        ctx.toast('無法清除本機資料');
        return;
      }
      ctx.toast('已清除本機資料');
      ctx.reconfigure();
    });

    const paint = (s) => {
      statusVal.textContent = statusText(s);
      pendingVal.textContent = `${s.pending} 筆`;
      authHint.hidden = s.status !== 'auth';
      serverHint.hidden = s.status !== 'pending';
      noticeLine.textContent = s.notice || '';
      noticeLine.hidden = !s.notice;
      paintRejected();
    };
    paint(store.getState());
    unsub = store.subscribe(paint);

    container.append(
      h('div', { class: 'sec', text: 'Sync' }),
      h(
        'div',
        { class: 'panel' },
        h('div', { class: 'kv' }, h('span', { text: 'Status' }), statusVal),
        h('div', { class: 'kv' }, h('span', { text: 'Pending' }), pendingVal),
      ),
      authHint,
      serverHint,
      noticeLine,
      syncBtn,
      rejSec,
      rejList,
      rejClear,
      h('div', { class: 'sec', text: 'Local data' }),
      h('p', { class: 'muted', text: '清除這台裝置上的快取、待同步紀錄與每週勾選；連線設定會保留。' }),
      clearBtn,
    );
  }

  container.append(h('p', { class: 'muted foot', text: PRIVACY }));

  if (!store) urlIn.focus();

  return () => {
    alive = false;
    if (unsub) unsub();
  };
}
