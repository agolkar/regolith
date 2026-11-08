// Event bus. Every emitted event is also kept in a short log that the
// automated tests read through window.__GAME__.events.
export function createEvents(clock) {
  const listeners = new Map();
  const log = [];
  const counts = {};
  return {
    log,
    counts,
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, data) {
      counts[name] = (counts[name] || 0) + 1;
      log.push({ t: clock ? Math.round(clock() * 100) / 100 : 0, name, data: summarize(data) });
      if (log.length > 400) log.splice(0, log.length - 400);
      const set = listeners.get(name);
      if (set) for (const fn of [...set]) {
        try { fn(data); } catch (e) { console.error(`[events] listener for "${name}" failed:`, e); }
      }
    },
  };
}

function summarize(d) {
  if (d == null || typeof d !== 'object') return d;
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

// Persistent key/value storage (best scores, settings). Never throws.
export function createSave(prefix = 'game') {
  const key = (k) => `${prefix}:${k}`;
  return {
    get(k, fallback = null) {
      try {
        const v = localStorage.getItem(key(k));
        return v == null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(k, value) {
      try { localStorage.setItem(key(k), JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };
}
