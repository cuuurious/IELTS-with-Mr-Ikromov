import { createClient } from 'npm:@supabase/supabase-js@2'

/*
 * --------------------------------------------------------------
 * WHY THIS FUNCTION EXISTS
 * --------------------------------------------------------------
 *
 * Most students register with just a username — there's no real
 * email address behind their account at all. "Forgot password"
 * only ever works by sending a reset link to an email, so for those
 * students there's nothing for it to send to; they have no way to
 * recover their own account.
 *
 * This gives the teacher a direct way around that: set a brand-new
 * password for a student right here, using the admin API, with no
 * email involved anywhere in the process. The teacher then shares
 * the new password with the student themselves (in person, over
 * chat, however is easiest) and the student logs in with it
 * immediately.
 *
 * Only ever usable by a signed-in teacher, and only ever targets a
 * student account — never another teacher's, and never the caller's
 * own account through this path.
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

  const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })

  try {
    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return jsonResponse(
        { error: 'Missing authorization' },
        401
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')

    const serviceRoleKey = Deno.env.get(
      'SUPABASE_SERVICE_ROLE_KEY'
    )

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'Supabase server environment variables are missing'
      )
    }

    /*
     * Client representing the logged-in teacher.
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
      data: { user: teacher },
      error: teacherAuthError,
    } = await userClient.auth.getUser()

    if (teacherAuthError || !teacher) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
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
     * Verify that the caller is actually a teacher.
     */
    const {
      data: teacherProfile,
      error: teacherProfileError,
    } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', teacher.id)
      .maybeSingle()

    if (teacherProfileError) {
      throw teacherProfileError
    }

    if (
      !teacherProfile ||
      teacherProfile.role !== 'teacher'
    ) {
      return jsonResponse(
        {
          error:
            "Only teachers can reset a student's password.",
        },
        403
      )
    }

    const { studentId, newPassword } = await req.json()

    if (!studentId || typeof studentId !== 'string') {
      return jsonResponse(
        { error: 'studentId is required' },
        400
      )
    }

    if (studentId === teacher.id) {
      return jsonResponse(
        {
          error:
            'Use Account Settings to change your own password.',
        },
        400
      )
    }

    if (
      !newPassword ||
      typeof newPassword !== 'string' ||
      newPassword.length < 6
    ) {
      return jsonResponse(
        {
          error:
            'New password must be at least 6 characters.',
        },
        400
      )
    }

    /*
     * Confirm the target is actually a student before touching
     * anything.
     */
    const {
      data: student,
      error: studentError,
    } = await admin
      .from('profiles')
      .select('id, full_name, username, role')
      .eq('id', studentId)
      .maybeSingle()

    if (studentError) {
      throw studentError
    }

    if (!student) {
      return jsonResponse(
        { error: 'Student profile was not found.' },
        404
      )
    }

    if (student.role !== 'student') {
      return jsonResponse(
        {
          error:
            'The selected account is not a student account.',
        },
        400
      )
    }

    const {
      error: updateError,
    } = await admin.auth.admin.updateUserById(
      studentId,
      { password: newPassword }
    )

    if (updateError) {
      throw updateError
    }

    return jsonResponse({
      success: true,
      message: `Password updated for ${student.full_name}.`,
    })
  } catch (error) {
    console.error(
      'reset-student-password error:',
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