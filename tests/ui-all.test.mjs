import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectChoices,
  sameProject,
  metaLine,
  dateLabel,
  copyLabel,
  emptyText,
  copyToClipboard,
} from '../web/js/ui-all.js';

const TODAY = '2026-11-17';
let n = 0;
const e = (project, date, extra = {}) => ({
  id: `e${++n}`,
  date,
  project,
  what_i_did: 'did it',
  impact: '',
  stakeholders: '',
  feedback: '',
  created_at: `${date}T10:00:00.${String(n).padStart(3, '0')}Z`,
  updated_at: `${date}T10:00:00.000Z`,
  ...extra,
});
const labels = (r) => r.chips.map((c) => c.label);

// ---------- projectChoices ----------

test('projectChoices: All first, then up to five most recent projects (newest first)', () => {
  const entries = [
    e('P1', '2026-11-10'),
    e('P2', '2026-11-12'),
    e('P3', '2026-11-14'),
    e('P4', '2026-11-15'),
    e('P5', '2026-11-16'),
    e('P6', '2026-11-17'),
    e('P7', '2026-11-01'),
  ];
  const r = projectChoices(entries, TODAY);
  assert.deepEqual(labels(r), ['All', 'P6', 'P5', 'P4', 'P3', 'P2']);
  assert.equal(r.chips[0].project, null);
  assert.equal(r.chips[1].project, 'P6');
  assert.equal(r.hasMore, true);
});

test('projectChoices: older projects are still reachable (large day window)', () => {
  const entries = [e('Old', '2024-03-01'), e('New', '2026-11-16')];
  assert.deepEqual(labels(projectChoices(entries, TODAY)), ['All', 'New', 'Old']);
});

test('projectChoices: case and space variants of one project are one chip, newest spelling', () => {
  const entries = [e('Q4 Onboarding', '2026-11-10'), e('q4onboarding', '2026-11-16'), e(' Q4  onboarding ', '2026-11-12')];
  const r = projectChoices(entries, TODAY);
  assert.deepEqual(labels(r), ['All', 'q4onboarding']);
});

test('projectChoices: expanded reveals every distinct project and 未歸屬 when some entry has none', () => {
  const entries = [
    e('P1', '2026-11-10'),
    e('P2', '2026-11-12'),
    e('P3', '2026-11-14'),
    e('P4', '2026-11-15'),
    e('P5', '2026-11-16'),
    e('P6', '2026-11-17'),
    e('p1', '2026-11-01'),
    e('', '2026-11-02'),
  ];
  const r = projectChoices(entries, TODAY, { expanded: true });
  assert.deepEqual(labels(r), ['All', 'P6', 'P5', 'P4', 'P3', 'P2', 'P1', '未歸屬']);
  assert.equal(r.chips.at(-1).project, '');
  assert.equal(r.hasMore, true);
});

test('projectChoices: 未歸屬 is not offered when every entry has a project, or while collapsed', () => {
  const some = [e('A', '2026-11-10'), e('', '2026-11-11')];
  assert.deepEqual(labels(projectChoices(some, TODAY)), ['All', 'A']);
  assert.deepEqual(labels(projectChoices(some, TODAY, { expanded: true })), ['All', 'A', '未歸屬']);
  const none = [e('A', '2026-11-10')];
  assert.deepEqual(labels(projectChoices(none, TODAY, { expanded: true })), ['All', 'A']);
  assert.equal(projectChoices(none, TODAY).hasMore, false);
});

test('projectChoices: hasMore is true when only 未歸屬 is hidden', () => {
  assert.equal(projectChoices([e('A', '2026-11-10'), e('', '2026-11-11')], TODAY).hasMore, true);
});

test('projectChoices: a selected project outside the top five stays visible while collapsed', () => {
  const entries = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'].map((p, i) => e(p, `2026-11-${String(16 - i).padStart(2, '0')}`));
  const r = projectChoices(entries, TODAY, { selected: 'P7' });
  assert.deepEqual(labels(r), ['All', 'P1', 'P2', 'P3', 'P4', 'P5', 'P7']);
  // matched by key, not spelling
  const r2 = projectChoices(entries, TODAY, { selected: ' p 7 ' });
  assert.deepEqual(labels(r2), ['All', 'P1', 'P2', 'P3', 'P4', 'P5', 'P7']);
});

test('projectChoices: a selected 未歸屬 stays visible while collapsed', () => {
  const r = projectChoices([e('A', '2026-11-10'), e('', '2026-11-11')], TODAY, { selected: '' });
  assert.deepEqual(labels(r), ['All', 'A', '未歸屬']);
});

test('projectChoices: a selected project nobody uses any more is still shown once', () => {
  const r = projectChoices([e('A', '2026-11-10')], TODAY, { selected: 'Gone' });
  assert.deepEqual(labels(r), ['All', 'A', 'Gone']);
});

test('projectChoices: no entries gives just All and no 更多', () => {
  const r = projectChoices([], TODAY);
  assert.deepEqual(labels(r), ['All']);
  assert.equal(r.hasMore, false);
});

test('projectChoices: entries without a date still contribute a project when expanded', () => {
  const r = projectChoices([e('A', '2026-11-10'), e('NoDate', '')], TODAY, { expanded: true });
  assert.ok(labels(r).includes('NoDate'));
});

test('sameProject: null is All, blank is 未歸屬, names compare by key', () => {
  assert.equal(sameProject(null, null), true);
  assert.equal(sameProject(null, ''), false);
  assert.equal(sameProject('', null), false);
  assert.equal(sameProject('', '  '), true);
  assert.equal(sameProject('Q4 Onboarding', 'q4onboarding'), true);
  assert.equal(sameProject('A', 'B'), false);
});

// ---------- row text ----------

test('metaLine: Project · Impact · Stakeholders', () => {
  assert.equal(metaLine({ project: 'Q4', impact: 'faster', stakeholders: 'HR, Ops' }), 'Q4 · faster · HR, Ops');
});

test('metaLine: omits empty parts; a blank project reads 未歸屬', () => {
  assert.equal(metaLine({ project: 'Q4', impact: '', stakeholders: 'HR' }), 'Q4 · HR');
  assert.equal(metaLine({ project: 'Q4', impact: 'faster', stakeholders: '  ' }), 'Q4 · faster');
  assert.equal(metaLine({ project: '', impact: 'faster', stakeholders: '' }), '未歸屬 · faster');
  assert.equal(metaLine({ project: ' Q4 ', impact: '', stakeholders: '' }), 'Q4');
  assert.equal(metaLine({}), '未歸屬');
});

test('dateLabel: English short month and day', () => {
  assert.equal(dateLabel('2026-11-17'), 'Nov 17');
  assert.equal(dateLabel('2026-01-05'), 'Jan 5');
  assert.equal(dateLabel(''), '');
});

test('copyLabel: count of the current filter, or a disabled-state text when empty', () => {
  assert.equal(copyLabel(12), 'Copy as text（目前篩選 12 筆）');
  assert.equal(copyLabel(1), 'Copy as text（目前篩選 1 筆）');
  assert.equal(copyLabel(0), '沒有可複製的紀錄');
});

test('emptyText: no entries at all differs from nothing matching', () => {
  assert.equal(emptyText(0), '還沒有任何紀錄');
  assert.equal(emptyText(3), '沒有符合的紀錄');
  assert.equal(emptyText(0, false), '尚未載入資料');
  assert.equal(emptyText(0, true), '還沒有任何紀錄');
  assert.equal(emptyText(3, false), '沒有符合的紀錄');
});

// ---------- copyToClipboard ----------

function fakeDoc({ exec = true, active = null } = {}) {
  const log = { appended: [], removed: 0, selected: false, command: null, value: null, focused: false };
  const ta = {
    style: {},
    setAttribute() {},
    select() {
      log.selected = true;
    },
    setSelectionRange() {},
    remove() {
      log.removed++;
    },
  };
  const doc = {
    createElement: () => ta,
    body: { append: (el) => log.appended.push(el) },
    execCommand: (c) => {
      log.command = c;
      log.value = ta.value;
      return exec;
    },
    activeElement: active,
  };
  return { doc, ta, log };
}

test('copyToClipboard: uses the Clipboard API when it works', async () => {
  let got = null;
  const { doc, log } = fakeDoc();
  const ok = await copyToClipboard('hello', { clipboard: { writeText: async (t) => (got = t) }, document: doc });
  assert.equal(ok, true);
  assert.equal(got, 'hello');
  assert.equal(log.command, null);
});

test('copyToClipboard: falls back to a textarea when the Clipboard API is missing', async () => {
  const { doc, log } = fakeDoc();
  const ok = await copyToClipboard('line1\nline2', { clipboard: undefined, document: doc });
  assert.equal(ok, true);
  assert.equal(log.command, 'copy');
  assert.equal(log.value, 'line1\nline2');
  assert.equal(log.appended.length, 1);
  assert.equal(log.removed, 1);
});

test('copyToClipboard: falls back when the Clipboard API rejects', async () => {
  const { doc, log } = fakeDoc();
  const ok = await copyToClipboard('x', {
    clipboard: { writeText: async () => Promise.reject(new Error('denied')) },
    document: doc,
  });
  assert.equal(ok, true);
  assert.equal(log.command, 'copy');
});

test('copyToClipboard: falls back when writeText throws synchronously', async () => {
  const { doc, log } = fakeDoc();
  const ok = await copyToClipboard('x', {
    clipboard: {
      writeText: () => {
        throw new Error('nope');
      },
    },
    document: doc,
  });
  assert.equal(ok, true);
  assert.equal(log.command, 'copy');
});

test('copyToClipboard: false when both paths fail, and the textarea is still removed', async () => {
  const { doc, log } = fakeDoc({ exec: false });
  const ok = await copyToClipboard('x', { clipboard: undefined, document: doc });
  assert.equal(ok, false);
  assert.equal(log.removed, 1);
});

test('copyToClipboard: false when execCommand throws', async () => {
  const { doc, log } = fakeDoc();
  doc.execCommand = () => {
    throw new Error('no');
  };
  const ok = await copyToClipboard('x', { clipboard: undefined, document: doc });
  assert.equal(ok, false);
  assert.equal(log.removed, 1);
});

// ---------- displayOrder (focus hand-off follows the displayed order) ----------

import { groupByMonth } from '../web/js/model.js';
import { displayOrder } from '../web/js/ui-all.js';
import { nextRowId } from '../web/js/ui-week.js';

// store order is oldest first, across two months
const OLD = [
  { ...e('P', '2026-10-05'), id: 'oct5' },
  { ...e('P', '2026-10-20'), id: 'oct20' },
  { ...e('P', '2026-11-03'), id: 'nov3' },
  { ...e('P', '2026-11-16'), id: 'nov16' },
];

test('displayOrder: ids in the order the rows are displayed (months and dates newest first)', () => {
  assert.deepEqual(displayOrder(groupByMonth(OLD)), ['nov16', 'nov3', 'oct20', 'oct5']);
});

test('displayOrder equals the ids of the rendered rows, group by group', () => {
  const groups = groupByMonth(OLD);
  assert.deepEqual(displayOrder(groups), groups.flatMap((g) => g.entries.map((x) => x.id)));
  assert.deepEqual(displayOrder([]), []);
});

test('hand-off: deleting a middle displayed row picks the row displayed after it', () => {
  const before = displayOrder(groupByMonth(OLD));
  const after = displayOrder(groupByMonth(OLD.filter((x) => x.id !== 'nov3')));
  assert.equal(nextRowId(before, after, 'nov3'), 'oct20');
});

test('hand-off: deleting the last displayed row gives null (fall back to the search input)', () => {
  const before = displayOrder(groupByMonth(OLD));
  const after = displayOrder(groupByMonth(OLD.filter((x) => x.id !== 'oct5')));
  assert.equal(nextRowId(before, after, 'oct5'), null);
});

test('hand-off: store order would have been wrong (oldest-first order picks a newer row)', () => {
  const storeBefore = OLD.map((x) => x.id);
  const storeAfter = OLD.filter((x) => x.id !== 'oct5').map((x) => x.id);
  assert.equal(nextRowId(storeBefore, storeAfter, 'oct5'), 'oct20'); // the bug this guards against
});
