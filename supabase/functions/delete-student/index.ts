import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({
          error: 'Method not allowed',
        }),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const authHeader =
      req.headers.get('Authorization')

    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: 'Missing authorization.',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const supabaseUrl =
      Deno.env.get('SUPABASE_URL')

    const serviceRoleKey =
      Deno.env.get(
        'SUPABASE_SERVICE_ROLE_KEY'
      )

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      return new Response(
        JSON.stringify({
          error:
            'Server configuration is missing.',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey
    )

    const token =
      authHeader.replace(
        'Bearer ',
        ''
      )

    const {
      data: {
        user: teacher,
      },
      error: authError,
    } = await admin.auth.getUser(token)

    if (
      authError ||
      !teacher
    ) {
      return new Response(
        JSON.stringify({
          error:
            'You are not authenticated.',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const {
      data: teacherProfile,
      error: profileError,
    } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', teacher.id)
      .single()

    if (
      profileError ||
      teacherProfile?.role !== 'teacher'
    ) {
      return new Response(
        JSON.stringify({
          error:
            'Only teachers can delete students.',
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const body = await req.json()

    const studentId =
      body?.studentId

    if (!studentId) {
      return new Response(
        JSON.stringify({
          error:
            'studentId is required.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const {
      data: student,
      error: studentError,
    } = await admin
      .from('profiles')
      .select(
        'id, full_name, username, role'
      )
      .eq('id', studentId)
      .single()

    if (
      studentError ||
      !student
    ) {
      return new Response(
        JSON.stringify({
          error:
            'Student account not found.',
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    if (
      student.role !== 'student'
    ) {
      return new Response(
        JSON.stringify({
          error:
            'Only student accounts can be deleted here.',
        }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const {
      error: deleteAuthError,
    } =
      await admin.auth.admin.deleteUser(
        studentId
      )

    if (deleteAuthError) {
      throw deleteAuthError
    }

    await admin
      .from('profiles')
      .delete()
      .eq('id', studentId)

    return new Response(
      JSON.stringify({
        success: true,
        student: {
          id: student.id,
          full_name:
            student.full_name,
          username:
            student.username,
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type':
            'application/json',
        },
      }
    )
  } catch (error) {
    console.error(
      'Delete student error:',
      error
    )

    return new Response(
      JSON.stringify({
        error:
          error?.message ||
          'Failed to delete student.',
      }),
      {
        status: 500,
        headers: {
          'Content-Type':
            'application/json',
        },
      }
    )
  }
})