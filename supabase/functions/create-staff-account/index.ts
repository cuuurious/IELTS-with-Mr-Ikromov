import { createClient } from 'npm:@supabase/supabase-js@2'

/*
 * --------------------------------------------------------------
 * WHY THIS FUNCTION EXISTS
 * --------------------------------------------------------------
 *
 * There has never been an in-app way to create a teacher account —
 * Register.jsx deliberately only ever creates students, and the one
 * existing teacher account (Jasur Ikromov's) was created directly in
 * Supabase. That was fine when there was exactly one teacher and no
 * other staff role. Now that Speaking and Writing examiner accounts
 * need to exist too, doing every one of those by hand in the
 * Supabase dashboard doesn't scale and is easy to get wrong (a typo'd
 * role string, forgetting to set status to 'approved', etc).
 *
 * This is the staff-account equivalent of create-student-account:
 * one atomic, admin-only, server-side step. Unlike student sign-up,
 * there's no "pending approval" step for staff — an admin creating
 * the account IS the approval — so status is set to 'approved'
 * immediately.
 *
 * Deliberately admin-gated (not just "any teacher"), the same as
 * delete-teacher: an examiner account immediately gets visibility
 * into every student's profile plus the ability to message them and
 * (for a writing examiner) read and grade their essays, so creating
 * one is at least as sensitive as deleting a teacher account.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Kept identical to src/lib/supabaseClient.js's usernameToEmail().
const SYNTHETIC_EMAIL_DOMAIN = 'users.ielts-mrikromov.app'

function usernameToEmail(username) {
  return `${username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')}@${SYNTHETIC_EMAIL_DOMAIN}`
}

const ALLOWED_ROLES = ['teacher', 'speaking_examiner', 'writing_examiner']

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase server environment variables are missing')
    }

    // Client representing the logged-in caller — used only to verify
    // who's calling, never for the privileged work below.
    const userClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') || '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const {
      data: { user: caller },
      error: callerAuthError,
    } = await userClient.auth.getUser()

    if (callerAuthError || !caller) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    // Server-side admin client. NEVER expose this key to React/browser code.
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    /*
     * Only the site admin (Jasur Ikromov's account) may create staff
     * accounts — same restriction as delete-teacher, checked
     * server-side so the UI hiding this screen is never the only
     * thing standing in the way.
     */
    const { data: callerProfile, error: callerProfileError } = await admin
      .from('profiles')
      .select('id, role, status, is_admin')
      .eq('id', caller.id)
      .maybeSingle()

    if (callerProfileError) throw callerProfileError

    if (!callerProfile || callerProfile.role !== 'teacher' || !callerProfile.is_admin) {
      return jsonResponse(
        { error: 'Only the site admin account can create staff accounts.' },
        403
      )
    }

    const { fullName, username, password, role, contactEmail } = await req.json()

    if (!username || !password || !fullName || !role) {
      return jsonResponse(
        { error: 'Full name, username, password and role are required.' },
        400
      )
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return jsonResponse(
        {
          error: `Role must be one of: ${ALLOWED_ROLES.join(', ')}.`,
        },
        400
      )
    }

    if (String(password).length < 6) {
      return jsonResponse(
        { error: 'Password must be at least 6 characters.' },
        400
      )
    }

    const normalizedUsername = String(username).trim().toLowerCase()

    if (!normalizedUsername || !/^[a-z0-9_.]{3,32}$/.test(normalizedUsername)) {
      return jsonResponse(
        {
          error:
            'Usernames can only use letters, numbers, dots and underscores (3-32 characters).',
        },
        400
      )
    }

    const { data: existingUsername, error: usernameCheckError } = await admin
      .from('profiles')
      .select('id')
      .eq('username', normalizedUsername)
      .maybeSingle()

    if (usernameCheckError) throw usernameCheckError

    if (existingUsername) {
      return jsonResponse(
        { error: 'That username is already taken. Please choose a different one.' },
        400
      )
    }

    const normalizedContactEmail = contactEmail?.trim().toLowerCase() || null

    if (normalizedContactEmail) {
      const { data: existingEmail, error: emailCheckError } = await admin
        .from('profiles')
        .select('id, username')
        .ilike('contact_email', normalizedContactEmail)
        .maybeSingle()

      if (emailCheckError) throw emailCheckError

      if (existingEmail) {
        return jsonResponse(
          { error: 'An account with this email address already exists.' },
          400
        )
      }
    }

    const email = normalizedContactEmail || usernameToEmail(normalizedUsername)

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      // Admin-created, server-side — never triggers a confirmation
      // email regardless of the project's "Confirm email" setting.
      email_confirm: true,
    })

    if (createError) throw createError

    const userId = created.user.id

    const { error: profileError } = await admin.from('profiles').insert({
      id: userId,
      full_name: fullName,
      username: normalizedUsername,
      role,
      // No pending-approval step for staff — an admin creating the
      // account already IS the approval.
      status: 'approved',
      contact_email: normalizedContactEmail,
      is_admin: false,
    })

    if (profileError) {
      // Nothing here depends on a later step — clean up immediately.
      await admin.auth.admin.deleteUser(userId).catch((cleanupError) => {
        console.error('Could not roll back after a failed profile insert:', cleanupError)
      })

      throw profileError
    }

    return jsonResponse({ userId, email, username: normalizedUsername, role })
  } catch (error) {
    console.error('create-staff-account error:', error)

    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unexpected server error' },
      500
    )
  }
})
