// Weekly sweep checklist: four reminders ticked by hand, stored on this device only, one key per
// week (keyed by the Monday date) so a new Monday starts with everything unticked.

export const SWEEP_ITEMS = ['Emails', 'Calendar', 'Meeting notes', 'To-do list'];

const key = (weekStart) => `jos_sweep_${weekStart}`;
const blank = () => SWEEP_ITEMS.map(() => false);

// Never throws: missing, corrupt, wrong-shape or unreadable data gives four false.
export function loadSweep(storage, weekStart) {
  try {
    const raw = storage.getItem(key(weekStart));
    if (raw === null || raw === undefined) return blank();
    const v = JSON.parse(raw);
    if (!Array.isArray(v) || v.length !== SWEEP_ITEMS.length || !v.every((x) => typeof x === 'boolean')) return blank();
    return v.slice();
  } catch (_) {
    return blank();
  }
}

// Never throws: a blocked or full storage just means the ticks are not remembered.
export function saveSweep(storage, weekStart, checks) {
  try {
    if (!Array.isArray(checks) || checks.length !== SWEEP_ITEMS.length) return;
    storage.setItem(key(weekStart), JSON.stringify(checks.map(Boolean)));
  } catch (_) {
    // reminders only; nothing to recover
  }
}
