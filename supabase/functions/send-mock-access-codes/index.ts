// supabase/functions/send-mock-access-codes/index.ts
//
// Bulk "send these access codes to their students over Telegram" —
// the last step of the teacher's multi-student issue flow
// (TeacherMockCenter.jsx's "Issue access codes" modal, migration_46).
// Jasur, verbatim: "he will choose them and click generate password
// and then teacher sees and checks whether every student he wants to
// take the test is here and he confirms sending them to those
// students via telegrambot."
//
// Runs with the service-role key because it needs TELEGRAM_BOT_TOKEN
// (a secret, never sent to the browser) and has to read every
// recipient's telegram_links row — RLS there is select-by-owner only,
// so a teacher's own session can't see a student's chat id. The
// CALLER still has to be a signed-in teacher, checked the same way
// reset-student-password/index.ts does (there's no service_role-only
// gate here, since this is invoked by a teacher in the browser, not a
// cron job).
//
// Never touches a code's used_at/revoked state — sending a message
// has no bearing on whether the code has been checked in with. It
// only stamps telegram_sent_at once a message actually goes out, so
// the UI can show "sent" vs "not connected, share manually."

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function sendTelegramMessage(botToken, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const body = await res.json()
      detail = body?.description || ''
    } catch {
      // ignore — fall through to the generic message below
    }
    throw new Error(detail || `Telegram API responded ${res.status}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Missing authorization' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase server environment variables are missing')
    }

    // Client representing the logged-in teacher — only used to find out
    // who's calling.
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user: teacher },
      error: teacherAuthError,
    } = await userClient.auth.getUser()

    if (teacherAuthError || !teacher) return jsonResponse({ error: 'Unauthorized' }, 401)

    // Server-side admin client. NEVER expose this key to React/browser code.
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: teacherProfile, error: teacherProfileError } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', teacher.id)
      .maybeSingle()

    if (teacherProfileError) throw teacherProfileError
    if (!teacherProfile || teacherProfile.role !== 'teacher') {
      return jsonResponse({ error: 'Only teachers can send access codes.' }, 403)
    }

    const { codeIds } = await req.json()

    if (!Array.isArray(codeIds) || codeIds.length === 0) {
      return jsonResponse({ error: 'codeIds must be a non-empty array.' }, 400)
    }

    if (!telegramBotToken) {
      return jsonResponse(
        { error: 'Telegram is not configured on the server (TELEGRAM_BOT_TOKEN missing).' },
        500
      )
    }

    const { data: codeRows, error: codesError } = await admin
      .from('mock_access_codes')
      .select('id, code, student_id, full_mock_set_id, revoked, used_at')
      .in('id', codeIds)

    if (codesError) throw codesError

    const studentIds = [...new Set((codeRows || []).map((r) => r.student_id))]
    const setIds = [...new Set((codeRows || []).map((r) => r.full_mock_set_id))]

    const [{ data: studentRows }, { data: setRows }, { data: linkRows }] = await Promise.all([
      admin.from('profiles').select('id, full_name, username').in('id', studentIds),
      admin.from('full_mock_sets').select('id, title').in('id', setIds),
      admin.from('telegram_links').select('user_id, telegram_chat_id').in('user_id', studentIds),
    ])

    const studentById = {}
    ;(studentRows || []).forEach((s) => {
      studentById[s.id] = s
    })
    const setById = {}
    ;(setRows || []).forEach((s) => {
      setById[s.id] = s
    })
    const chatIdByStudent = {}
    ;(linkRows || []).forEach((l) => {
      chatIdByStudent[l.user_id] = l.telegram_chat_id
    })

    const results = []
    const sentIds = []
    const foundIds = new Set()

    for (const row of codeRows || []) {
      foundIds.add(row.id)

      const student = studentById[row.student_id]
      const setTitle = setById[row.full_mock_set_id]?.title || 'your mock'
      const studentName = student?.full_name || student?.username || 'there'

      if (row.revoked) {
        results.push({ codeId: row.id, studentId: row.student_id, sent: false, reason: 'revoked' })
        continue
      }

      if (row.used_at) {
        results.push({ codeId: row.id, studentId: row.student_id, sent: false, reason: 'already_used' })
        continue
      }

      const chatId = chatIdByStudent[row.student_id]
      if (!chatId) {
        results.push({ codeId: row.id, studentId: row.student_id, sent: false, reason: 'not_connected' })
        continue
      }

      const text =
        `Hi ${studentName}!\n\n` +
        `You're signed up for "${setTitle}".\n\n` +
        `Your access code: ${row.code}\n\n` +
        `Open the app -> Take a Test, enter your full name and this code to check in. ` +
        `It works once, so keep it to yourself.`

      try {
        await sendTelegramMessage(telegramBotToken, chatId, text)
        results.push({ codeId: row.id, studentId: row.student_id, sent: true })
        sentIds.push(row.id)
      } catch (err) {
        console.error('send-mock-access-codes: telegram send failed for', row.id, err)
        results.push({
          codeId: row.id,
          studentId: row.student_id,
          sent: false,
          reason: err?.message || 'Telegram send failed.',
        })
      }
    }

    for (const id of codeIds) {
      if (!foundIds.has(id)) {
        results.push({ codeId: id, studentId: null, sent: false, reason: 'not_found' })
      }
    }

    if (sentIds.length > 0) {
      const { error: updateError } = await admin
        .from('mock_access_codes')
        .update({ telegram_sent_at: new Date().toISOString() })
        .in('id', sentIds)

      if (updateError) {
        console.error('send-mock-access-codes: failed to stamp telegram_sent_at:', updateError)
      }
    }

    return jsonResponse({ success: true, results })
  } catch (error) {
    console.error('send-mock-access-codes error:', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected server error' }, 500)
  }
})
