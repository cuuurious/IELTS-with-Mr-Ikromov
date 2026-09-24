import { createClient } from 'npm:@supabase/supabase-js@2'

/*
 * Generalizes delete-teacher to cover all three staff roles (teacher,
 * speaking_examiner, writing_examiner) behind one admin-only action.
 * delete-teacher is left deployed and untouched for now (nothing
 * currently calls it after TeacherAccounts.jsx switches over to
 * this), rather than deleted, in case anything else still references
 * it.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const STAFF_ROLES = ['teacher', 'speaking_examiner', 'writing_examiner']

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

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: callerProfile, error: callerProfileError } = await admin
      .from('profiles')
      .select('id, role, status, is_admin')
      .eq('id', caller.id)
      .maybeSingle()

    if (callerProfileError) throw callerProfileError

    if (!callerProfile || callerProfile.role !== 'teacher' || !callerProfile.is_admin) {
      return jsonResponse(
        { error: 'Only the site admin account can delete staff accounts.' },
        403
      )
    }

    const body = await req.json()
    const staffId = body?.staffId

    if (!staffId || typeof staffId !== 'string') {
      return jsonResponse({ error: 'staffId is required' }, 400)
    }

    if (staffId === caller.id) {
      return jsonResponse(
        { error: 'You cannot delete your own account from this action.' },
        400
      )
    }

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, full_name, username, role, is_admin')
      .eq('id', staffId)
      .maybeSingle()

    if (targetError) throw targetError

    if (!target) {
      return jsonResponse({ error: 'Account was not found.' }, 404)
    }

    if (!STAFF_ROLES.includes(target.role)) {
      return jsonResponse(
        { error: 'The selected account is not a staff account.' },
        400
      )
    }

    if (target.is_admin) {
      return jsonResponse(
        { error: 'The admin account cannot be deleted from here.' },
        400
      )
    }

    /*
     * ------------------------------------------------------------
     * ROLE-SPECIFIC "STILL OWNS DATA" CHECKS, before doing anything
     * destructive. Same reasoning as delete-teacher: rather than
     * guessing at a cascade/reassignment behavior, refuse and say
     * exactly what to move or clear first.
     * ------------------------------------------------------------
     */
    if (target.role === 'teacher') {
      const [
        { count: groupCount, error: groupCountError },
        { count: wordlistCount, error: wordlistCountError },
        { count: homeworkCount, error: homeworkCountError },
      ] = await Promise.all([
        admin.from('groups').select('id', { count: 'exact', head: true }).eq('created_by', staffId),
        admin.from('wordlists').select('id', { count: 'exact', head: true }).eq('created_by', staffId),
        admin.from('homeworks').select('id', { count: 'exact', head: true }).eq('created_by', staffId),
      ])

      if (groupCountError) throw groupCountError
      if (wordlistCountError) throw wordlistCountError
      if (homeworkCountError) throw homeworkCountError

      const ownedThings = []

      if (groupCount) ownedThings.push(`${groupCount} group${groupCount === 1 ? '' : 's'}`)
      if (wordlistCount) ownedThings.push(`${wordlistCount} word list${wordlistCount === 1 ? '' : 's'}`)
      if (homeworkCount) ownedThings.push(`${homeworkCount} homework${homeworkCount === 1 ? '' : 's'}`)

      if (ownedThings.length > 0) {
        return jsonResponse(
          {
            error: `This teacher still owns ${ownedThings.join(', ')}. Delete or reassign those first, then try again.`,
          },
          400
        )
      }
    }

    if (target.role === 'speaking_examiner') {
      const { count: slotCount, error: slotCountError } = await admin
        .from('mock_speaking_slots')
        .select('id', { count: 'exact', head: true })
        .eq('examiner_id', staffId)
        .eq('status', 'scheduled')

      if (slotCountError) throw slotCountError

      if (slotCount) {
        return jsonResponse(
          {
            error: `This examiner still has ${slotCount} scheduled speaking slot${slotCount === 1 ? '' : 's'}. Cancel or reassign those first, then try again.`,
          },
          400
        )
      }
    }

    // writing_examiner has no blocking check — submissions.examiner_reviewed_by
    // is nullable and clears automatically on delete (see migration_30.sql).

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(staffId)

    if (deleteAuthError) throw deleteAuthError

    return jsonResponse({
      success: true,
      message: `"${target.full_name}"'s account was permanently deleted.`,
      staffId,
    })
  } catch (error) {
    console.error('delete-staff-account error:', error)

    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unexpected server error' },
      500
    )
  }
})
