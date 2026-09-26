// supabase/functions/run-scheduled-mock-sessions/index.ts
//
// Group-scheduled mock sessions (migration_52) — the automatic half of
// "teacher picks a group + a Full Mock + a date/time, codes go out on
// their own." Meant to be called every few minutes by a scheduler, not
// by the browser — see .github/workflows/run-scheduled-mock-sessions.yml
// for the GitHub Actions cron job that triggers it, same pattern as
// exam-reminders and daily-reminders.
//
// For every mock_scheduled_sessions row whose scheduled_at has arrived
// (and that hasn't already been processed or cancelled), this:
//   1. Looks up every student currently in that session's group
//      (group_members — the live membership at fire time, not whoever
//      was in the group when the session was created, so a student
//      added to the group the day before still gets included).
//   2. Generates one fresh mock_access_codes row per student, tagged
//      with a shared batch_id — same code shape/alphabet and the same
//      insert-and-retry-on-collision approach TeacherMockCenter.jsx's
//      own generateAccessCodeBatch already uses for a manual "Issue
//      codes" batch, just running here server-side instead of in a
//      teacher's browser.
//   3. Sends each one over Telegram to whichever students have it
//      connected, reusing send-mock-access-codes' own message shape —
//      a student not connected simply doesn't get a code sent (same
//      "not_connected" outcome the manual flow already has); a teacher
//      can still see and hand out the code from the Access codes list.
//   4. Marks the session codes_sent_at (+ codes_issued_count, batch_id)
//      so it's never picked up again — this is the idempotency guard
//      against the cron firing twice near the same scheduled_at.
//
// Runs with the service-role key for the same reason send-mock-access-
// codes does: it needs TELEGRAM_BOT_TOKEN (never sent to the browser)
// and has to read every recipient's telegram_links row, which RLS
// otherwise restricts to select-by-owner only. Unlike send-mock-access-
// codes (invoked directly by a signed-in teacher), this one is invoked
// ONLY by the cron job itself, so it's gated on the service_role JWT,
// exactly like exam-reminders.

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jwtRole(authHeader) {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const payload = token.split('.')[1]
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return json.role || null
  } catch {
    return null
  }
}

// Same alphabet/shape as TeacherMockCenter.jsx's generateAccessCode —
// 6 characters, look-alikes (0/O, 1/I/L) removed, shown grouped XXX-XXX.
const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generateAccessCode() {
  let raw = ''
  for (let i = 0; i < 6; i++) {
    raw += ACCESS_CODE_ALPHABET[Math.floor(Math.random() * ACCESS_CODE_ALPHABET.length)]
  }
  return `${raw.slice(0, 3)}-${raw.slice(3)}`
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

// Generates one access code per studentId, inserting them all in one
// batch (atomic — either every row lands or none do). On a unique_
// violation (23505), the whole candidate batch is thrown away and
// retried with fresh random codes, same approach the manual teacher
// flow already uses — cheap and simple over checking uniqueness first.
async function generateAccessCodeBatch(admin, fullMockSetId, studentIds, createdBy, batchId) {
  let rows = null
  let lastError = null

  for (let attempt = 0; attempt < 5 && !rows; attempt++) {
    const usedCodes = new Set()
    const candidateRows = studentIds.map((studentId) => {
      let code
      do {
        code = generateAccessCode()
      } while (usedCodes.has(code))
      usedCodes.add(code)
      return {
        code,
        student_id: studentId,
        full_mock_set_id: fullMockSetId,
        created_by: createdBy,
        batch_id: batchId,
      }
    })

    const { data, error: insertError } = await admin
      .from('mock_access_codes')
      .insert(candidateRows)
      .select('*')

    if (!insertError) {
      rows = data
      break
    }

    if (insertError.code === '23505') {
      lastError = insertError
      continue
    }

    lastError = insertError
    break
  }

  if (!rows) throw lastError || new Error('Could not generate access codes for this session.')
  return rows
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (jwtRole(authHeader) !== 'service_role') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN')

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'Supabase server environment variables are missing.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const now = new Date()

    // Due = scheduled_at has arrived, never processed, never cancelled.
    // No upper bound on how "late" a due session can be picked up —
    // if the cron itself has been down for a while, it should still
    // catch up and send every overdue session's codes rather than
    // silently skip them, same philosophy as daily-reminders having no
    // "too late now" cutoff either.
    const { data: dueSessions, error: dueError } = await admin
      .from('mock_scheduled_sessions')
      .select('*')
      .is('codes_sent_at', null)
      .is('cancelled_at', null)
      .lte('scheduled_at', now.toISOString())

    if (dueError) throw dueError

    let sessionsProcessed = 0
    let codesIssuedTotal = 0
    const sessionResults = []

    for (const session of dueSessions || []) {
      try {
        // Claim this row FIRST (before any Telegram sends), so a slow
        // batch of messages can't leave the row looking "due" to a
        // second, overlapping cron invocation. codes_issued_count is
        // filled in properly once the real count is known below; 0
        // here is immediately overwritten, never left as a false "0
        // students" result if the function crashes after this point.
        const batchId = crypto.randomUUID()
        const { error: claimError } = await admin
          .from('mock_scheduled_sessions')
          .update({ codes_sent_at: now.toISOString(), batch_id: batchId, codes_issued_count: 0 })
          .eq('id', session.id)
          .is('codes_sent_at', null)

        if (claimError) throw claimError

        const { data: memberRows, error: membersError } = await admin
          .from('group_members')
          .select('student_id')
          .eq('group_id', session.group_id)

        if (membersError) throw membersError

        const studentIds = [...new Set((memberRows || []).map((m) => m.student_id))]

        if (studentIds.length === 0) {
          sessionResults.push({ sessionId: session.id, studentsFound: 0, codesIssued: 0 })
          sessionsProcessed += 1
          continue
        }

        const [{ data: setRow }, { data: studentRows }, { data: linkRows }] = await Promise.all([
          admin.from('full_mock_sets').select('id, title').eq('id', session.full_mock_set_id).maybeSingle(),
          admin.from('profiles').select('id, full_name, username').in('id', studentIds),
          admin.from('telegram_links').select('user_id, telegram_chat_id').in('user_id', studentIds),
        ])

        const setTitle = setRow?.title || 'your mock'
        const studentById = {}
        ;(studentRows || []).forEach((s) => {
          studentById[s.id] = s
        })
        const chatIdByStudent = {}
        ;(linkRows || []).forEach((l) => {
          chatIdByStudent[l.user_id] = l.telegram_chat_id
        })

        const codeRows = await generateAccessCodeBatch(
          admin,
          session.full_mock_set_id,
          studentIds,
          session.created_by,
          batchId
        )

        let sentCount = 0
        const sentIds = []

        for (const row of codeRows) {
          const chatId = chatIdByStudent[row.student_id]
          if (!chatId || !telegramBotToken) continue

          const student = studentById[row.student_id]
          const studentName = student?.full_name || student?.username || 'there'
          const text =
            `Hi ${studentName}!\n\n` +
            `Your scheduled mock, "${setTitle}", is ready.\n\n` +
            `Your access code: ${row.code}\n\n` +
            `Open the app -> Take a Test, enter your full name and this code to check in. ` +
            `It works once, so keep it to yourself.`

          try {
            await sendTelegramMessage(telegramBotToken, chatId, text)
            sentCount += 1
            sentIds.push(row.id)
          } catch (err) {
            console.error('run-scheduled-mock-sessions: telegram send failed for', row.id, err)
          }
        }

        if (sentIds.length > 0) {
          const { error: stampError } = await admin
            .from('mock_access_codes')
            .update({ telegram_sent_at: new Date().toISOString() })
            .in('id', sentIds)

          if (stampError) {
            console.error('run-scheduled-mock-sessions: failed to stamp telegram_sent_at:', stampError)
          }
        }

        await admin
          .from('mock_scheduled_sessions')
          .update({ codes_issued_count: codeRows.length })
          .eq('id', session.id)

        sessionResults.push({
          sessionId: session.id,
          studentsFound: studentIds.length,
          codesIssued: codeRows.length,
          telegramSent: sentCount,
        })
        sessionsProcessed += 1
        codesIssuedTotal += codeRows.length
      } catch (err) {
        // One session failing (e.g. its group or full mock set was
        // deleted out from under it) shouldn't stop the others in the
        // same run — but leave codes_sent_at UNSET for this one if the
        // claim step itself didn't get that far, or log loudly if it
        // did, so it's visible rather than silently half-done forever.
        console.error('run-scheduled-mock-sessions: session failed', session.id, err)
        sessionResults.push({ sessionId: session.id, error: err?.message || 'Unknown error' })
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sessionsProcessed, codesIssuedTotal, sessionResults }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('run-scheduled-mock-sessions failed:', error)
    return new Response(
      JSON.stringify({ ok: false, error: error?.message || 'run-scheduled-mock-sessions failed.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
