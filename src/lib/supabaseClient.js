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
 * same mechanism behind navigator.sendBeacon). BUT it has a sharp edge
 * that bit us: Chrome caps ALL of a page's *combined* in-flight
 * keepalive requests at 64KB total — not per request. An earlier
 * version of this turned keepalive on for every small write across the
 * whole app (auth included), and once enough of those piled up, some
 * completely unrelated request — signing in, for instance — started
 * failing outright with "TypeError: Failed to fetch". That's a much
 * worse bug than the one this was trying to fix.
 *
 * So this now only touches the handful of writes that actually need to
 * survive a mid-request reload: finishing a homework submission,
 * recording its completion, and sending a chat message. Everything
 * else — auth, reads, every other write — gets a completely normal
 * fetch, so there's no realistic way to bump into that 64KB cap.
 */
const KEEPALIVE_MAX_BODY_BYTES = 60000

const KEEPALIVE_PATH_PATTERNS = [
  '/rest/v1/submissions',
  '/rest/v1/homework_completions',
  '/rest/v1/messages',
  '/rest/v1/group_messages',
]

function reliableFetch(input, init = {}) {
  try {
    const method = String(init?.method || 'GET').toUpperCase()

    const url =
      typeof input === 'string'
        ? input
        : input?.url || ''

    const isTargetWrite =
      (method === 'POST' || method === 'PATCH') &&
      KEEPALIVE_PATH_PATTERNS.some((path) => url.includes(path))

    const body = init?.body
    const bodySize =
      typeof body === 'string'
        ? body.length
        : body?.byteLength || body?.size || 0

    if (
      isTargetWrite &&
      !init.keepalive &&
      bodySize > 0 &&
      bodySize < KEEPALIVE_MAX_BODY_BYTES
    ) {
      return fetch(input, { ...init, keepalive: true })
    }
  } catch {
    // If anything above goes wrong, fall through to a completely normal
    // fetch below rather than risk breaking the request.
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
