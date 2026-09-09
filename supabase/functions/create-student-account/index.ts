import { createClient } from 'npm:@supabase/supabase-js@2'

/*
 * --------------------------------------------------------------
 * WHY THIS FUNCTION EXISTS
 * --------------------------------------------------------------
 *
 * Registration used to happen as two separate steps run from the
 * browser: supabase.auth.signUp() created the login first, then a
 * second request inserted the matching `profiles` row. Nothing tied
 * those two steps together — if the phone lost signal, the tab was
 * closed, or the app got backgrounded in the gap between them, the
 * auth account was left behind with no profile ever created for it.
 *
 * Because a student's login "email" is generated automatically from
 * their username (there usually is no real email address involved
 * at all), that stray, half-finished account permanently blocks the
 * username: Supabase Auth already has it, so trying to register
 * again with the same username fails with "already registered" —
 * even though, from the student's side, nothing ever finished and
 * they never typed any email themselves.
 *
 * This function does the whole sign-up as ONE server-side step, and
 * it self-heals exactly that situation: if the derived email is
 * already taken but has no matching `profiles` row, that proves it's
 * a stray from a sign-up that never finished — so it deletes the
 * stray account first and creates the real one in its place,
 * automatically, the next time that student tries. No manual
 * clean-up in the dashboard is needed, and because account creation
 * and the profile insert now happen inside this single request
 * instead of two separate browser round-trips, this can't leave a
 * half-finished account behind again.
 *
 * Bonus: this uses the admin API to create the account directly
 * (instead of the public signUp() call browsers normally use), so
 * Supabase never sends its own "confirm your email" message for
 * these accounts — meaning student sign-ups can't contribute to the
 * bounce-rate warning even if "Confirm email" is ever switched back
 * on by accident.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
}

// Kept identical to src/lib/supabaseClient.js's usernameToEmail() —
// this function can't import browser code, so the same tiny rule is
// duplicated here on purpose.
const SYNTHETIC_EMAIL_DOMAIN = 'users.ielts-mrikromov.app'

function usernameToEmail(username) {
  return `${username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')}@${SYNTHETIC_EMAIL_DOMAIN}`
}

// Kept identical to src/lib/targetBands.js.
const MIN_TARGET_BAND = 7
const MAX_TARGET_BAND = 9
const DEFAULT_TARGET_BAND = 7.5

function isValidTargetBand(value) {
  const n = Number(value)

  if (!Number.isFinite(n)) return false
  if (n < MIN_TARGET_BAND || n > MAX_TARGET_BAND) return false

  return Number.isInteger(n * 2)
}

// The JS admin SDK doesn't expose "get user by email" directly, but
// GoTrue's own admin endpoint supports a `filter` query param that
// substring-matches against email — this is what lets us find a
// stray account instead of guessing its id.
async function findAuthUserByEmail(
  supabaseUrl,
  serviceRoleKey,
  email
) {
  const res = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(
      email
    )}`,
    {
      headers: {
        apiKey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  )

  if (!res.ok) return null

  const body = await res.json().catch(() => null)
  const users = body?.users || []

  return (
    users.find(
      (u) =>
        (u.email || '').toLowerCase() === email.toLowerCase()
    ) || null
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')

    const serviceRoleKey = Deno.env.get(
      'SUPABASE_SERVICE_ROLE_KEY'
    )

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'Supabase server environment variables are missing'
      )
    }

    // Server-side admin client. NEVER expose this key to React/browser
    // code — this function is the only place it's used.
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const {
      username,
      password,
      fullName,
      contactEmail,
      targetBand,
      groupIds,
    } = await req.json()

    if (!username || !password || !fullName) {
      return jsonResponse(
        {
          error:
            'Username, password and full name are required.',
        },
        400
      )
    }

    const normalizedUsername = String(username)
      .trim()
      .toLowerCase()

    if (!normalizedUsername) {
      return jsonResponse(
        { error: 'Please enter a username.' },
        400
      )
    }

    // Same up-front check the old client code did: a clear, specific
    // error instead of letting it fail lower down with a raw
    // database message.
    const {
      data: existingUsername,
      error: usernameCheckError,
    } = await admin
      .from('profiles')
      .select('id')
      .eq('username', normalizedUsername)
      .maybeSingle()

    if (usernameCheckError) throw usernameCheckError

    if (existingUsername) {
      return jsonResponse(
        {
          error:
            'That username is already taken. Please choose a different one.',
        },
        400
      )
    }

    // If a real contact email was given, make sure it isn't already
    // attached to another student's profile — this is what stops the
    // same Gmail address from being used to register more than one
    // account. Kept here (server-side, with the admin client) rather
    // than as a separate client-side check, so it can't be skipped by
    // a slow network or bypassed by calling this function directly.
    if (contactEmail?.trim()) {
      const normalizedContactEmail = contactEmail
        .trim()
        .toLowerCase()

      const {
        data: existingEmail,
        error: emailCheckError,
      } = await admin
        .from('profiles')
        .select('id, username, full_name')
        .ilike('contact_email', normalizedContactEmail)
        .maybeSingle()

      if (emailCheckError) throw emailCheckError

      if (existingEmail) {
        return jsonResponse(
          {
            error:
              'An account with this email address already exists. Please log in instead or use a different email address.',
          },
          400
        )
      }
    }

    const email =
      contactEmail?.trim().toLowerCase() ||
      usernameToEmail(username)

    const createAccount = () =>
      admin.auth.admin.createUser({
        email,
        password,
        // Always mark confirmed via the admin API — this is a
        // separate, one-time server action, not the public sign-up
        // flow, so it never triggers Supabase's own confirmation
        // email regardless of the dashboard's "Confirm email" toggle.
        email_confirm: true,
      })

    let result = await createAccount()

    if (result.error) {
      const msg = (
        result.error.message || ''
      ).toLowerCase()

      const looksLikeDuplicate =
        msg.includes('already') ||
        msg.includes('registered') ||
        result.error.status === 422

      if (!looksLikeDuplicate) throw result.error

      const strayUser = await findAuthUserByEmail(
        supabaseUrl,
        serviceRoleKey,
        email
      )

      if (!strayUser) throw result.error

      // Only ever remove an account that genuinely has no profile —
      // this is exactly what proves it's a stray from a sign-up that
      // never finished, never a real, completed account someone is
      // actually using.
      const {
        data: strayProfile,
        error: strayProfileError,
      } = await admin
        .from('profiles')
        .select('id')
        .eq('id', strayUser.id)
        .maybeSingle()

      if (strayProfileError) throw strayProfileError

      if (strayProfile) {
        return jsonResponse(
          {
            error: contactEmail?.trim()
              ? 'That email address is already registered.'
              : 'That username is already taken. Please choose a different one.',
          },
          400
        )
      }

      const { error: deleteStrayError } =
        await admin.auth.admin.deleteUser(strayUser.id)

      if (deleteStrayError) throw deleteStrayError

      result = await createAccount()

      if (result.error) throw result.error
    }

    const userId = result.data.user.id

    const { error: profileError } = await admin
      .from('profiles')
      .insert({
        id: userId,
        full_name: fullName,
        username: normalizedUsername,
        role: 'student',
        status: 'pending',
        contact_email: contactEmail?.trim() || null,
        target_band: isValidTargetBand(targetBand)
          ? Number(targetBand)
          : DEFAULT_TARGET_BAND,
      })

    if (profileError) {
      // Nothing here depends on a later step or a live browser
      // session — clean up immediately, in this same request.
      await admin.auth.admin
        .deleteUser(userId)
        .catch((cleanupError) => {
          console.error(
            'Could not roll back after a failed profile insert:',
            cleanupError
          )
        })

      throw profileError
    }

    if (Array.isArray(groupIds) && groupIds.length) {
      const rows = groupIds.map((group_id) => ({
        group_id,
        student_id: userId,
      }))

      const { error: gmError } = await admin
        .from('group_members')
        .insert(rows)

      if (gmError) throw gmError
    }

    return jsonResponse({ userId, email })
  } catch (error) {
    console.error(
      'create-student-account error:',
      error
    )

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unexpected server error',
      },
      500
    )
  }
})