import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Missing Supabase env vars. Copy .env.example to .env and fill in your project URL + anon key.'
  )
}

/*
 * On phones (Samsung in particular) a tab can get reloaded or killed by
 * the OS's memory/battery management at literally any moment — including
 * right in the middle of a small write, like flipping a homework
 * submission's status to "done". When that happens mid-request, the
 * browser normally cancels the fetch outright, so the write never
 * reaches the server: the student sees their files were uploaded fine,
 * taps Submit, the app reloads, and the submission is still stuck on
 * "not yet" because that one request never landed.
 *
 * `fetch`'s `keepalive` option exists for exactly this situation — "let
 * this request finish even though the page is going away" (it's the
 * same mechanism behind navigator.sendBeacon). It's not free: browsers
 * cap keepalive request bodies at ~64KB and can silently refuse larger
 * ones, so it must NOT be turned on for big uploads (homework photos,
 * grading PDFs, etc.) — only for the small JSON writes that make up
 * almost everything else the app sends (submission updates, chat
 * messages, completion records...). This wrapper turns it on only when
 * the request body is present and comfortably under that cap, so large
 * uploads are silently unaffected and keep behaving exactly as before.
 */
const KEEPALIVE_MAX_BODY_BYTES = 60000

function reliableFetch(input, init = {}) {
  try {
    const body = init?.body
    const bodySize =
      typeof body === 'string'
        ? body.length
        : body?.byteLength || body?.size || 0

    if (
      !init.keepalive &&
      bodySize > 0 &&
      bodySize < KEEPALIVE_MAX_BODY_BYTES
    ) {
      return fetch(input, { ...init, keepalive: true })
    }
  } catch {
    // If we can't tell the body size for any reason, fall through to a
    // completely normal fetch below rather than risk breaking the request.
  }

  return fetch(input, init)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: reliableFetch },
})

// We authenticate with Supabase's email/password auth, but students and the
// teacher only ever type a "username". This turns a username into a stable,
// fake-but-valid email address for the auth layer.
export const usernameToEmail = (username) =>
  `${username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '')}@users.ielts-mrikromov.app`
