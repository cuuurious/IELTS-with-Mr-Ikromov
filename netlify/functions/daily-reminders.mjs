// netlify/functions/daily-reminders.mjs
//
// Runs once a day (see `config.schedule` below, UTC time). Uses the
// Supabase SERVICE ROLE key (server-side only, never exposed to the
// browser) to write notification rows for every approved student:
//  - one motivational nudge to stay consistent
//  - a "deadline soon" nudge for any homework due in the next 24h that
//    the student hasn't completed yet

import { createClient } from '@supabase/supabase-js'
import { sendPushToUsers } from './_pushHelper.mjs'

const MOTIVATIONAL_MESSAGES = [
  "Did you do something useful for your English today? Even 10 minutes of practice adds up.",
  "Your IELTS exam is getting closer every day — a little practice today keeps you ready.",
  "Consistency beats intensity. Open one homework task today, even a small one.",
  "Future you will thank you for practicing today. Keep the streak alive!",
  "Speaking practice counts too — try recording just one part today.",
  "Small daily effort is how band scores actually improve. Don't skip today.",
]

export default async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return new Response('Missing env vars', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: students, error: studentsError } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'student')
    .eq('status', 'approved')

  if (studentsError) {
    return new Response(`Failed to load students: ${studentsError.message}`, { status: 500 })
  }

  const message = MOTIVATIONAL_MESSAGES[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)]

  const dailyRows = (students || []).map((s) => ({
    user_id: s.id,
    type: 'daily_reminder',
    title: 'Stay consistent',
    body: message,
  }))
  if (dailyRows.length) {
    await supabase.from('notifications').insert(dailyRows)
    try {
      await sendPushToUsers({
        supabaseAdmin: supabase,
        userIds: dailyRows.map((r) => r.user_id),
        title: 'Stay consistent',
        body: message,
      })
    } catch (err) {
      console.error('daily push failed', err)
    }
  }

  // Deadline-soon reminders: homeworks due within the next 24h.
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const { data: dueSoon } = await supabase
    .from('homeworks')
    .select('id, title, group_id, due_date')
    .gte('due_date', now.toISOString())
    .lte('due_date', in24h.toISOString())

  for (const hw of dueSoon || []) {
    const { data: members } = await supabase
      .from('group_members')
      .select('student_id')
      .eq('group_id', hw.group_id)

    const { data: doneSubs } = await supabase
      .from('submissions')
      .select('student_id')
      .eq('homework_id', hw.id)
      .eq('status', 'done')
    const doneIds = new Set((doneSubs || []).map((s) => s.student_id))

    const rows = (members || [])
      .filter((m) => !doneIds.has(m.student_id))
      .map((m) => ({
        user_id: m.student_id,
        type: 'deadline_soon',
        title: 'Deadline approaching',
        body: `"${hw.title}" is due within 24 hours — don't forget to submit it.`,
        link: '/app',
      }))
    if (rows.length) {
      await supabase.from('notifications').insert(rows)
      try {
        await sendPushToUsers({
          supabaseAdmin: supabase,
          userIds: rows.map((r) => r.user_id),
          title: 'Deadline approaching',
          body: rows[0].body,
          link: '/app',
        })
      } catch (err) {
        console.error('deadline push failed', err)
      }
    }
  }

  return new Response('ok', { status: 200 })
}

export const config = {
  // 6:00 AM UTC every day — adjust to suit your students' timezone.
  schedule: '0 6 * * *',
}
