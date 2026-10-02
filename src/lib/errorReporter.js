import { supabase } from './supabaseClient'

/*
 * ERROR REPORTER (2026-10-02)
 *
 * Until now, when something broke on a student's phone the only way
 * Jasur found out was a student messaging "the site doesn't work". Now
 * every unexpected JavaScript error is saved to the `client_errors`
 * table (migration_69) and shows up in the teacher dashboard → Errors.
 *
 * Kept quiet on purpose:
 *   • the same error is sent once per page load, max 15 per page load;
 *   • harmless browser noise (ResizeObserver, extensions, "Script error",
 *     dropped connections) is ignored;
 *   • reporting can never throw or break the page itself.
 */

const MAX_PER_PAGE = 15
const seen = new Set()
let sent = 0
let currentUser = { id: null, role: null }
let installed = false

const IGNORE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Failed to fetch/i,
  /Load failed/i,
  /NetworkError/i,
  /network connection was lost/i,
  /AbortError/i,
  /The operation was aborted/i,
  /Non-Error promise rejection captured/i,
]

export function setErrorUser(profile) {
  currentUser = { id: profile?.id || null, role: profile?.role || null }
}

function clip(value, max) {
  const text = String(value ?? '')
  return text.length > max ? text.slice(0, max) : text
}

export function reportError(error, extra = '') {
  try {
    const message = clip(
      (error && (error.message || error.reason?.message)) || (typeof error === 'string' ? error : String(error)),
      1000
    )
    const stack = clip(error?.stack || error?.reason?.stack || extra || '', 4000)
    if (!message) return
    if (IGNORE.some((re) => re.test(message))) return
    if (/chrome-extension:|moz-extension:|safari-extension:/i.test(stack)) return

    const key = `${message}|${stack.split('\n')[1] || ''}`
    if (seen.has(key) || sent >= MAX_PER_PAGE) return
    seen.add(key)
    sent += 1

    supabase
      .from('client_errors')
      .insert({
        user_id: currentUser.id,
        role: currentUser.role,
        message,
        stack,
        url: clip(window.location.pathname + window.location.search, 500),
        user_agent: clip(navigator.userAgent, 400),
      })
      .then(() => {}, () => {})
  } catch {
    // never let the reporter itself cause trouble
  }
}

export function installErrorReporter() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    // Resource load errors (an <img> 404) have no `error` object — skip.
    if (!event.error && !event.message) return
    reportError(event.error || event.message, `${event.filename || ''}:${event.lineno || ''}:${event.colno || ''}`)
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    reportError(reason instanceof Error ? reason : { message: reason?.message || String(reason), stack: reason?.stack })
  })
}
