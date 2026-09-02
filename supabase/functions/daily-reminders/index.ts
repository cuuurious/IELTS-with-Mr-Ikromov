// supabase/functions/daily-reminders/index.ts
//
// Ported from the old netlify/functions/daily-reminders.mjs (+
// _pushHelper.mjs) when the project moved off Netlify. Writes
// notification rows — and sends real device pushes — for every
// approved student:
//
//   - one motivational nudge to stay consistent
//   - a "deadline soon" nudge for any homework due in the next 24h
//     that the student hasn't completed yet
//
// This function is meant to be called once a day by a scheduler, not
// by the browser. See .github/workflows/daily-reminders.yml for the
// GitHub Actions cron job that triggers it.

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import webpush from 'npm:web-push@3.6.7'

const MOTIVATIONAL_MESSAGES = [
  "Did you do something useful for your English today? Even 10 minutes of practice adds up.",
  "Your IELTS exam is getting closer every day — a little practice today keeps you ready.",
  "Consistency beats intensity. Open one homework task today, even a small one.",
  "Future you will thank you for practicing today. Keep the streak alive!",
  "Speaking practice counts too — try recording just one part today.",
  "Small daily effort is how band scores actually improve. Don't skip today.",
]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/*
 * Reads the "role" claim out of a Supabase JWT without verifying its
 * signature (Supabase's platform-level JWT verification already did
 * that before this function ran). Used only to distinguish a
 * service_role caller (the scheduler) from a normal logged-in user.
 */
function jwtRole(authHeader) {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const payload = token.split('.')[1]
    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    )
    return json.role || null
  } catch {
    return null
  }
}

/*
 * Sends a push notification to every subscription belonging to each
 * user in `userIds`. Cleans up subscriptions that have expired or
 * been revoked (404/410 responses) — same behavior as
 * supabase/functions/send-push/index.ts.
 */
async function sendPushToUsers(supabaseAdmin, userIds, title, body, link) {
  if (!userIds.length) return

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  const payload = JSON.stringify({ title, body, link: link || '/app' })

  await Promise.all(
    (subs || []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        )
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabaseAdmin
            .from('push_subscriptions')
            .delete()
            .eq('id', sub.id)
        } else {
          console.error(
            'daily-reminders push failed:',
            err?.statusCode,
            err?.message
          )
        }
      }
    })
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    })
  }

  /*
   * This function must only ever be triggered by the scheduler (using
   * the service role key), never by a logged-in student or teacher in
   * the browser. A normal user's token has role "authenticated"; only
   * the service role key itself decodes to role "service_role".
   */
  const authHeader = req.headers.get('Authorization') || ''

  if (jwtRole(authHeader) !== 'service_role') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject =
    Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'

  if (!supabaseUrl || !serviceKey || !vapidPublicKey || !vapidPrivateKey) {
    return new Response(
      JSON.stringify({
        error: 'Push notification environment variables are not configured.',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    /*
     * ------------------------------------------------------------
     * 1. Motivational nudge for every approved student
     * ------------------------------------------------------------
     */
    const { data: students, error: studentsError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'student')
      .eq('status', 'approved')

    if (studentsError) throw studentsError

    const message =
      MOTIVATIONAL_MESSAGES[
        Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)
      ]

    const dailyRows = (students || []).map((student) => ({
      user_id: student.id,
      type: 'daily_reminder',
      title: 'Stay consistent',
      body: message,
    }))

    if (dailyRows.length) {
      const { error: insertError } = await supabase
        .from('notifications')
        .insert(dailyRows)

      if (insertError) throw insertError

      await sendPushToUsers(
        supabase,
        dailyRows.map((row) => row.user_id),
        'Stay consistent',
        message,
        '/app'
      )
    }

    /*
     * ------------------------------------------------------------
     * 2. Deadline-soon nudge: homework due within the next 24h that
     *    a student hasn't completed yet. Links straight to the
     *    homework (see StudentDashboard.jsx's "homework:<id>"
     *    notification handling), unlike the old Netlify version
     *    which only ever linked to "/app".
     * ------------------------------------------------------------
     */
    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    const { data: dueSoon, error: dueSoonError } = await supabase
      .from('homeworks')
      .select('id, title, group_id, due_date')
      .gte('due_date', now.toISOString())
      .lte('due_date', in24h.toISOString())

    if (dueSoonError) throw dueSoonError

    let deadlineNotified = 0

    for (const homework of dueSoon || []) {
      const { data: members } = await supabase
        .from('group_members')
        .select('student_id')
        .eq('group_id', homework.group_id)

      const { data: doneSubmissions } = await supabase
        .from('submissions')
        .select('student_id')
        .eq('homework_id', homework.id)
        .eq('status', 'done')

      const doneIds = new Set(
        (doneSubmissions || []).map((submission) => submission.student_id)
      )

      const link = `homework:${homework.id}`

      const rows = (members || [])
        .filter((member) => !doneIds.has(member.student_id))
        .map((member) => ({
          user_id: member.student_id,
          type: 'deadline_soon',
          title: 'Deadline approaching',
          body: `"${homework.title}" is due within 24 hours — don't forget to submit it.`,
          link,
        }))

      if (!rows.length) continue

      const { error: insertError } = await supabase
        .from('notifications')
        .insert(rows)

      if (insertError) {
        console.error(
          'Failed to insert deadline_soon notifications:',
          insertError
        )
        continue
      }

      await sendPushToUsers(
        supabase,
        rows.map((row) => row.user_id),
        'Deadline approaching',
        rows[0].body,
        link
      )

      deadlineNotified += rows.length
    }

    return new Response(
      JSON.stringify({
        ok: true,
        studentsNudged: dailyRows.length,
        homeworksDueSoon: (dueSoon || []).length,
        deadlineNotified,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('daily-reminders failed:', error)

    return new Response(
      JSON.stringify({
        ok: false,
        error: error?.message || 'daily-reminders failed.',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
