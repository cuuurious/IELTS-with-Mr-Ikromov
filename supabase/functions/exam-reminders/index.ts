// supabase/functions/exam-reminders/index.ts
//
// The "notify 5 minutes before" speaking-exam reminder from the
// original scoping doc — sends both a web push and a Telegram message
// (whichever the student/examiner has set up) to BOTH sides of a
// mock_speaking_slots booking shortly before it starts. Meant to be
// called every few minutes by a scheduler, not by the browser — see
// .github/workflows/exam-reminders.yml for the GitHub Actions cron job
// that triggers it, same pattern as daily-reminders.
//
// Window, not an exact 5-minute match: a cron firing every 5 minutes
// can't guarantee landing on the exact minute a slot needs its
// reminder, so this looks for scheduled slots starting between 3 and 8
// minutes from now (not yet notified) — wide enough that a 5-minute
// cron cadence never skips one, narrow enough it never fires twice
// thanks to the notified_5min flag (already added in migration_29,
// never wired up until now).

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import webpush from 'npm:web-push@3.6.7'

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

async function sendPushToUser(supabaseAdmin, userId, title, body, link) {
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  const payload = JSON.stringify({ title, body, link: link || '/app' })

  await Promise.all(
    (subs || []).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          console.error('exam-reminders push failed:', err?.statusCode, err?.message)
        }
      }
    })
  )
}

async function sendTelegramToUser(supabaseAdmin, botToken, userId, text) {
  if (!botToken) return

  const { data: link } = await supabaseAdmin
    .from('telegram_links')
    .select('telegram_chat_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!link?.telegram_chat_id) return

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: link.telegram_chat_id, text }),
    })
  } catch (err) {
    console.error('exam-reminders telegram send failed:', err)
  }
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
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'
  const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN')

  if (!supabaseUrl || !serviceKey || !vapidPublicKey || !vapidPrivateKey) {
    return new Response(
      JSON.stringify({ error: 'Push notification environment variables are not configured.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const now = new Date()
    const windowStart = new Date(now.getTime() + 3 * 60 * 1000)
    const windowEnd = new Date(now.getTime() + 8 * 60 * 1000)

    const { data: slots, error: slotsError } = await supabase
      .from('mock_speaking_slots')
      .select('*')
      .eq('status', 'scheduled')
      .eq('notified_5min', false)
      .gte('scheduled_at', windowStart.toISOString())
      .lte('scheduled_at', windowEnd.toISOString())

    if (slotsError) throw slotsError

    let notified = 0

    for (const slot of slots || []) {
      const { data: student } = await supabase
        .from('profiles')
        .select('full_name, username')
        .eq('id', slot.student_id)
        .maybeSingle()

      const { data: examiner } = await supabase
        .from('profiles')
        .select('full_name, username')
        .eq('id', slot.examiner_id)
        .maybeSingle()

      const studentName = student?.full_name || student?.username || 'Your student'
      const examinerName = examiner?.full_name || examiner?.username || 'Your examiner'
      const timeLabel = new Date(slot.scheduled_at).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })

      const linkLine = slot.meeting_link ? ` Join here: ${slot.meeting_link}` : ''

      const studentBody = `Your speaking exam with ${examinerName} starts at ${timeLabel} — about 5 minutes from now.${linkLine}`
      const examinerBody = `Your speaking exam with ${studentName} starts at ${timeLabel} — about 5 minutes from now.${linkLine}`

      await Promise.all([
        sendPushToUser(supabase, slot.student_id, 'Speaking exam starting soon', studentBody, '/app'),
        sendPushToUser(supabase, slot.examiner_id, 'Speaking exam starting soon', examinerBody, '/app'),
        sendTelegramToUser(supabase, telegramBotToken, slot.student_id, studentBody),
        sendTelegramToUser(supabase, telegramBotToken, slot.examiner_id, examinerBody),
        supabase.from('notifications').insert([
          {
            user_id: slot.student_id,
            type: 'speaking_reminder',
            title: 'Speaking exam starting soon',
            body: studentBody,
            link: '/app',
          },
          {
            user_id: slot.examiner_id,
            type: 'speaking_reminder',
            title: 'Speaking exam starting soon',
            body: examinerBody,
            link: '/app',
          },
        ]),
      ])

      await supabase.from('mock_speaking_slots').update({ notified_5min: true }).eq('id', slot.id)

      notified += 1
    }

    return new Response(JSON.stringify({ ok: true, slotsNotified: notified }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('exam-reminders failed:', error)
    return new Response(
      JSON.stringify({ ok: false, error: error?.message || 'exam-reminders failed.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
