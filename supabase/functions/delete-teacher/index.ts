import { createClient } from 'npm:@supabase/supabase-js@2'

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
     * Client representing the logged-in caller.
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
      data: {
        user: caller,
      },
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
     * Verify the caller is a teacher AND specifically flagged as the
     * site admin. Being a teacher is not enough here — this is the one
     * action that is deliberately restricted to Jasur Ikromov's account
     * only, so every other teacher account must be refused even though
     * it can do everything else a teacher can do.
     */
    const {
      data: callerProfile,
      error: callerProfileError,
    } = await admin
      .from('profiles')
      .select('id, role, status, is_admin')
      .eq('id', caller.id)
      .maybeSingle()

    if (callerProfileError) {
      throw callerProfileError
    }

    if (
      !callerProfile ||
      callerProfile.role !== 'teacher' ||
      !callerProfile.is_admin
    ) {
      return new Response(
        JSON.stringify({
          error: 'Only the site admin account can delete teacher accounts.',
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const body = await req.json()
    const teacherId = body?.teacherId

    if (
      !teacherId ||
      typeof teacherId !== 'string'
    ) {
      return new Response(
        JSON.stringify({
          error: 'teacherId is required',
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

    if (teacherId === caller.id) {
      return new Response(
        JSON.stringify({
          error: 'You cannot delete your own account from this action.',
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
     * Confirm the target is actually a (non-admin) teacher before doing
     * anything destructive.
     */
    const {
      data: targetTeacher,
      error: targetTeacherError,
    } = await admin
      .from('profiles')
      .select(
        'id, full_name, username, role, is_admin'
      )
      .eq('id', teacherId)
      .maybeSingle()

    if (targetTeacherError) {
      throw targetTeacherError
    }

    if (!targetTeacher) {
      return new Response(
        JSON.stringify({
          error: 'Teacher profile was not found.',
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    if (targetTeacher.role !== 'teacher') {
      return new Response(
        JSON.stringify({
          error: 'The selected account is not a teacher account.',
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

    if (targetTeacher.is_admin) {
      return new Response(
        JSON.stringify({
          error: 'The admin account cannot be deleted from here.',
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
     * REFUSE TO DELETE A TEACHER THAT STILL OWNS DATA
     * ------------------------------------------------------------
     *
     * Groups, word lists, and homeworks all record who created them
     * (created_by). Unlike a student account (whose submissions simply
     * belong to them and disappear with them), a group or homework
     * created by this teacher may still be in active use by students
     * who have nothing to do with this cleanup. Rather than guessing
     * at a cascade/reassignment behavior, this refuses the deletion and
     * tells the admin exactly what to move or delete first, using the
     * app's existing "delete group" / edit tools.
     */
    const [
      { count: groupCount, error: groupCountError },
      { count: wordlistCount, error: wordlistCountError },
      { count: homeworkCount, error: homeworkCountError },
    ] = await Promise.all([
      admin
        .from('groups')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', teacherId),
      admin
        .from('wordlists')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', teacherId),
      admin
        .from('homeworks')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', teacherId),
    ])

    if (groupCountError) throw groupCountError
    if (wordlistCountError) throw wordlistCountError
    if (homeworkCountError) throw homeworkCountError

    const ownedThings: string[] = []

    if (groupCount) {
      ownedThings.push(
        `${groupCount} group${groupCount === 1 ? '' : 's'}`
      )
    }

    if (wordlistCount) {
      ownedThings.push(
        `${wordlistCount} word list${wordlistCount === 1 ? '' : 's'}`
      )
    }

    if (homeworkCount) {
      ownedThings.push(
        `${homeworkCount} homework${homeworkCount === 1 ? '' : 's'}`
      )
    }

    if (ownedThings.length > 0) {
      return new Response(
        JSON.stringify({
          error: `This teacher still owns ${ownedThings.join(', ')}. Delete or reassign those first, then try again.`,
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
     * DELETE AUTH ACCOUNT
     * ------------------------------------------------------------
     *
     * Deleting auth.users causes the teacher's profile row to follow
     * the database's ON DELETE CASCADE relationship, the same as
     * delete-student.
     */
    const {
      error: deleteAuthError,
    } = await admin.auth.admin.deleteUser(
      teacherId
    )

    if (deleteAuthError) {
      throw deleteAuthError
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Teacher account "${targetTeacher.full_name}" was permanently deleted.`,
        teacherId,
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
      'delete-teacher error:',
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
