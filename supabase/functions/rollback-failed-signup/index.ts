import { createClient } from 'npm:@supabase/supabase-js@2'

/*
 * --------------------------------------------------------------
 * WHY THIS FUNCTION EXISTS
 * --------------------------------------------------------------
 *
 * Sign-up happens in two steps from the browser: first Supabase Auth
 * creates the login (email + password), then a separate insert adds
 * the matching row to `profiles` (name, role, status, etc). If that
 * second step fails — most commonly because the chosen username is
 * already taken — the first step has already succeeded, leaving a
 * real auth account with no profile behind it. Because the "email"
 * for that account is derived deterministically from the username,
 * that username is now permanently stuck: it can't be used to sign
 * up again ("already registered"), and the stranded account itself
 * can't really be used either (no profile means no role, no status,
 * nothing the app can do with it).
 *
 * This function is the cleanup step: right after a failed profile
 * insert, the browser calls this with the new account's own (still
 * valid) session token, and this function deletes that same auth
 * account — but ONLY if it truly has no profile row yet — freeing
 * the username immediately for another attempt.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: 'Missing authorization',
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const supabaseUrl =
      Deno.env.get('SUPABASE_URL')

    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'Supabase server environment variables are missing'
      )
    }

    /*
     * Client representing whoever just tried to sign up. Their
     * session is only good enough to identify who they are — this
     * function never trusts any id passed in the request body.
     */
    const userClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') || '',
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    )

    const {
      data: { user: caller },
      error: callerAuthError,
    } = await userClient.auth.getUser()

    if (callerAuthError || !caller) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    /*
     * Server-side admin client.
     * NEVER expose this key to React/browser code.
     */
    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    /*
     * Safety check: only ever delete an account that genuinely has
     * no profile row. This means a caller can never use this
     * function to delete a real, completed account of their own —
     * only to clean up their own half-finished sign-up attempt.
     */
    const {
      data: existingProfile,
      error: profileLookupError,
    } = await admin
      .from('profiles')
      .select('id')
      .eq('id', caller.id)
      .maybeSingle()

    if (profileLookupError) {
      throw profileLookupError
    }

    if (existingProfile) {
      return new Response(
        JSON.stringify({
          error:
            'This account already has a profile — refusing to delete it.',
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const {
      error: deleteAuthError,
    } = await admin.auth.admin.deleteUser(
      caller.id
    )

    if (deleteAuthError) {
      throw deleteAuthError
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )
  } catch (error) {
    console.error(
      'rollback-failed-signup error:',
      error
    )

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : 'Unexpected server error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )
  }
})
