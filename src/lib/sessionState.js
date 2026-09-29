import { useEffect, useState } from 'react'

/*
 * Remember which screen someone is on across a page refresh (2026-09-29).
 * Jasur: after a refresh, both he and students were dropped back on the
 * homework & groups screen, even from inside the Mock Center or an exam —
 * "it has to stay in the window that we are in rn".
 *
 * sessionStorage, not localStorage: it survives a refresh of the same tab,
 * but a brand-new tab/window starts clean. Keys always include the user's
 * id so one account's screen never leaks into another's on a shared
 * computer. Every read/write is wrapped — private browsing or blocked
 * storage just falls back to the old behaviour (default screen).
 */
export function readSession(key, fallback) {
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeSession(key, value) {
  try {
    if (value === undefined || value === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable — nothing to remember, nothing breaks
  }
}

// useState that is restored from, and saved to, sessionStorage.
export function useSessionState(key, fallback) {
  const [value, setValue] = useState(() => readSession(key, fallback))
  useEffect(() => {
    writeSession(key, value)
  }, [key, value])
  return [value, setValue]
}
