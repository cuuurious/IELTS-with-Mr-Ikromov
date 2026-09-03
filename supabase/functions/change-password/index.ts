import { createClient } from 'npm:@supabase/supabase-js@2'

/*
 * --------------------------------------------------------------
 * WHY THIS FUNCTION EXISTS
 * --------------------------------------------------------------
 *
 * The old "change password" flow checked the current password by
 * calling supabase.auth.signInWithPassword() directly from the
 * browser. That works, but signInWithPassword doesn't just check a
 * password — it actually signs the browser in again, replacing the
 * live session with a brand new one. From the student/teacher's
 * point of view they were just confirming their existing password,
 * not logging in a second time, so this was a confusing, unintended
 * side effect (and briefly meant two sessions existed for the same
 * login).
 *
 * This function checks the current password server-side instead —
 * using its own short-lived, throwaway verification that never
 * touches the browser's session at all — then updates the password
 * directly with the admin API. The browser's existing session is
 * completely untouched throughout.
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

    const anonKey =
      Deno.env.get('SUPABASE_ANON_KEY') || ''

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'Supabase server environment variables are missing'
      )
    }

    /*
     * Client representing whoever is asking to change their
     * password. Only used to identify who they are.
     */
    const userClient = createClient(
      supabaseUrl,
      anonKey,
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

    if (callerAuthError || !caller?.email) {
      return new Response(
        JSON.stringify({
          error: 'Your session has expired. Please sign in again.',
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

    const body = await req.json()

    const currentPassword = body?.currentPassword
    const newPassword = body?.newPassword

    if (
      typeof currentPassword !== 'string' ||
      !currentPassword
    ) {
      return new Response(
        JSON.stringify({
          error: 'Current password is required.',
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

    if (
      typeof newPassword !== 'string' ||
      newPassword.length < 6
    ) {
      return new Response(
        JSON.stringify({
          error:
            'New password must be at least 6 characters.',
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

    /*
     * ------------------------------------------------------------
     * VERIFY THE CURRENT PASSWORD — WITHOUT TOUCHING THE BROWSER
     * ------------------------------------------------------------
     *
     * This calls the same password-grant endpoint signInWithPassword
     * uses, but directly from the server. Its response tokens are
     * discarded immediately — they're never sent back to the browser
     * — so the browser's own session never changes.
     */
    const verifyResponse = await fetch(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          apikey: anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: caller.email,
          password: currentPassword,
        }),
      }
    )

    if (!verifyResponse.ok) {
      return new Response(
        JSON.stringify({
          error: 'Current password is incorrect.',
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

    const {
      error: updateError,
    } = await admin.auth.admin.updateUserById(
      caller.id,
      { password: newPassword }
    )

    if (updateError) {
      throw updateError
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
      'change-password error:',
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
