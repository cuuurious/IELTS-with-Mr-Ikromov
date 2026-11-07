/*
 * Some phones (privacy modes, blocked site data, some in-app browsers)
 * throw "Access is denied" the moment the site touches localStorage or
 * sessionStorage, and the whole page breaks (2026-11-07, Errors page).
 * Then a small in-memory store stands in, so the site still works —
 * it just forgets things like the chosen tab after a reload.
 * Imported first in main.jsx.
 */
function works(name) {
  try {
    const s = window[name]
    s.getItem('__ielts_probe')
    return true
  } catch {
    return false
  }
}

function memoryStore() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => void m.set(String(k), String(v)),
    removeItem: (k) => void m.delete(String(k)),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
}

for (const name of ['localStorage', 'sessionStorage']) {
  if (!works(name)) {
    try {
      Object.defineProperty(window, name, { configurable: true, value: memoryStore() })
    } catch {
      /* nothing more we can do */
    }
  }
}
