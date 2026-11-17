// Device-local connection settings (Apps Script URL + token). Browser-safe: storage is injected.

const KEY = 'jos_config';
const empty = () => ({ url: '', token: '' });

export function loadConfig(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null || raw === undefined) return empty();
    const p = JSON.parse(raw);
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return empty();
    return {
      url: typeof p.url === 'string' ? p.url : '',
      token: typeof p.token === 'string' ? p.token : '',
    };
  } catch (_) {
    return empty(); // corrupt JSON or unreadable storage: behave as unconfigured
  }
}

export function saveConfig(storage, cfg) {
  const url = typeof cfg.url === 'string' ? cfg.url.trim() : '';
  const token = typeof cfg.token === 'string' ? cfg.token.trim() : '';
  storage.setItem(KEY, JSON.stringify({ url, token })); // a failure propagates so the UI can say so
}

export function isConfigured(cfg) {
  return !!cfg && typeof cfg.url === 'string' && typeof cfg.token === 'string' &&
    cfg.url.trim() !== '' && cfg.token.trim() !== '';
}
