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
      data: {
        user: teacher,
      },
      error: teacherAuthError,
    } = await userClient.auth.getUser()

    if (teacherAuthError || !teacher) {
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
     * Verify that the caller is actually a teacher.
     */
    const {
      data: teacherProfile,
      error: teacherProfileError,
    } = await admin
      .from('profiles')
      .select('id, role, status')
      .eq('id', teacher.id)
      .maybeSingle()

    if (teacherProfileError) {
      throw teacherProfileError
    }

    if (
      !teacherProfile ||
      teacherProfile.role !== 'teacher'
    ) {
      return new Response(
        JSON.stringify({
          error: 'Only teachers can permanently delete student accounts.',
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
    const studentId = body?.studentId

    if (
      !studentId ||
      typeof studentId !== 'string'
    ) {
      return new Response(
        JSON.stringify({
          error: 'studentId is required',
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

    if (studentId === teacher.id) {
      return new Response(
        JSON.stringify({
          error: 'A teacher cannot delete their own account from this action.',
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
     * Confirm the target is a student before doing anything destructive.
     */
    const {
      data: student,
      error: studentError,
    } = await admin
      .from('profiles')
      .select(
        'id, full_name, username, role, contact_email'
      )
      .eq('id', studentId)
      .maybeSingle()

    if (studentError) {
      throw studentError
    }

    if (!student) {
      return new Response(
        JSON.stringify({
          error: 'Student profile was not found.',
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

    if (student.role !== 'student') {
      return new Response(
        JSON.stringify({
          error: 'The selected account is not a student account.',
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
     * COLLECT STUDENT STORAGE FILES
     * ------------------------------------------------------------
     *
     * Current submissions store their uploaded files as URLs.
     * We collect those paths before deleting the database records.
     */

    const {
      data: submissions,
      error: submissionsError,
    } = await admin
      .from('submissions')
      .select(
        'screenshot_urls, submission_files, audio_part1_url, audio_part2_url, audio_part3_url'
      )
      .eq('student_id', studentId)

    if (submissionsError) {
      throw submissionsError
    }

    const submissionPaths: string[] = []

    const addSubmissionPath = (
      url: string | null | undefined
    ) => {
      if (!url) return

      const marker =
        '/storage/v1/object/public/submissions/'

      const index = url.indexOf(marker)

      if (index === -1) return

      const path = decodeURIComponent(
        url.slice(index + marker.length)
      )

      if (path) {
        submissionPaths.push(path)
      }
    }

    for (const submission of submissions || []) {
      for (const url of submission.screenshot_urls || []) {
        addSubmissionPath(url)
      }

      for (
        const file of submission.submission_files || []
      ) {
        if (file?.url) {
          addSubmissionPath(file.url)
        }
      }

      addSubmissionPath(
        submission.audio_part1_url
      )

      addSubmissionPath(
        submission.audio_part2_url
      )

      addSubmissionPath(
        submission.audio_part3_url
      )
    }

    /*
     * Remove duplicate storage paths.
     */
    const uniqueSubmissionPaths = [
      ...new Set(submissionPaths),
    ]

    if (uniqueSubmissionPaths.length > 0) {
      const {
        error: storageError,
      } = await admin.storage
        .from('submissions')
        .remove(
          uniqueSubmissionPaths
        )

      if (storageError) {
        throw storageError
      }
    }

    /*
     * ------------------------------------------------------------
     * DELETE AUTH ACCOUNT
     * ------------------------------------------------------------
     *
     * Deleting auth.users causes the student's profile and
     * dependent records to follow the database's ON DELETE
     * CASCADE relationships.
     *
     * This also runs inside the authenticated Edge Function,
     * so auth.uid() is the teacher rather than NULL.
     */
    const {
      error: deleteAuthError,
    } = await admin.auth.admin.deleteUser(
      studentId
    )

    if (deleteAuthError) {
      throw deleteAuthError
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Student "${student.full_name}" was permanently deleted.`,
        studentId,
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
      'delete-student error:',
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