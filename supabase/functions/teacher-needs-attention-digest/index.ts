// supabase/functions/teacher-needs-attention-digest/index.ts
//
// "Teacher 'needs attention' digest via Telegram" — one of the ~15
// convenience suggestions from the 2026-09-26 brainstorm, folded into
// "build everything you suggested." TeacherMockCenter.jsx's Student
// Progress tab already has a "Needs attention" callout (built earlier
// the same day, flagging any student who's either never attempted a
// mock, or whose estimated overall band sits a full band or more below
// their target) — but that only shows up if a teacher happens to open
// the app and look. This sends the same list to every teacher over
// Telegram on a schedule, the same "meet them where they already are"
// approach access-code delivery already uses.
//
// Deliberately RECOMPUTES the needs-attention list here in Deno rather
// than calling into the browser code — TeacherMockCenter.jsx's own
// studentBandSummary/needsAttention useMemos aren't reachable from an
// Edge Function, so this duplicates their exact logic (same threshold,
// same band-estimate/rounding functions from src/lib/ieltsBands.js,
// copied verbatim below) so the digest always agrees with what the
// in-app panel would show if a teacher looked right now.
//
// Meant to be called on a schedule, not by the browser — see
// .github/workflows/teacher-needs-attention-digest.yml for the GitHub
// Actions cron job that triggers it, same pattern as daily-reminders/
// exam-reminders/run-scheduled-mock-sessions. Runs WEEKLY, not daily —
// unlike a homework deadline, a student's overall standing doesn't swing
// day to day, so a daily ping would just be noise a teacher learns to
// ignore. Skips sending entirely when nobody currently needs attention,
// rather than sending an empty/reassuring message every week — keeps
// this a signal a teacher can trust, not routine noise.
//
// Runs with the service-role key for the same reason every other cron
// function in this project does: it needs TELEGRAM_BOT_TOKEN (never sent
// to the browser) and has to read every teacher's telegram_links row,
// which RLS otherwise restricts to select-by-owner only. Gated on the
// service_role JWT so only the scheduler can ever trigger it.

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

// ---------------------------------------------------------------------
// Copied verbatim from src/lib/ieltsBands.js — see that file's own
// comment for why this approximate percentage-to-band table exists (no
// official IDP conversion table is published). Duplicated rather than
// imported since an Edge Function can't import frontend source files.
// ---------------------------------------------------------------------
const BAND_THRESHOLDS = [
  { minPct: 97.5, band: 9 },
  { minPct: 92.5, band: 8.5 },
  { minPct: 87.5, band: 8 },
  { minPct: 80, band: 7.5 },
  { minPct: 75, band: 7 },
  { minPct: 67.5, band: 6.5 },
  { minPct: 57.5, band: 6 },
  { minPct: 47.5, band: 5.5 },
  { minPct: 37.5, band: 5 },
  { minPct: 32.5, band: 4.5 },
  { minPct: 25, band: 4 },
  { minPct: 20, band: 3.5 },
  { minPct: 15, band: 3 },
  { minPct: 10, band: 2.5 },
  { minPct: 5, band: 2 },
]

function estimateBandFromPercent(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return null
  const n = Number(pct)
  const hit = BAND_THRESHOLDS.find((t) => n >= t.minPct)
  return hit ? hit.band : 1
}

function roundOverallBand(avg) {
  if (avg == null || Number.isNaN(Number(avg))) return null
  return Math.round(Number(avg) * 2) / 2
}

function formatBand(band) {
  return band == null ? '—' : Number(band).toFixed(1)
}

function pct(score, max) {
  if (!max) return 0
  return Math.round((score / max) * 100)
}

// A full band or more under target flags "needs attention" — same
// threshold as TeacherMockCenter.jsx's own BAND_GAP_ATTENTION.
const BAND_GAP_ATTENTION = 1

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
    const [
      { data: students, error: studentsError },
      { data: attemptRows, error: attemptsError },
      { data: examRows, error: examsError },
      { data: writingRows, error: writingError },
      { data: speakingRows, error: speakingError },
    ] = await Promise.all([
      admin.from('profiles').select('id, full_name, username, target_band').eq('role', 'student').eq('status', 'approved'),
      admin.from('mock_attempts').select('user_id, exam_id, score, max_score'),
      admin.from('mock_exams').select('id, module'),
      admin.from('writing_mock_attempts').select('student_id, examiner_band'),
      admin.from('mock_speaking_slots').select('student_id, status, examiner_band'),
    ])

    if (studentsError) throw studentsError
    if (attemptsError) throw attemptsError
    if (examsError) throw examsError
    if (writingError) throw writingError
    if (speakingError) throw speakingError

    const moduleByExamId = {}
    ;(examRows || []).forEach((e) => {
      moduleByExamId[e.id] = e.module
    })

    // Same shape as TeacherMockCenter.jsx's own `rows`/`studentBandSummary`
    // useMemos — one entry per student, average % per skill converted to
    // an estimated band, Writing/Speaking averaged from real examiner
    // bands, an overall band from whichever of the four the student has.
    const needsAttention = (students || [])
      .map((student) => {
        const own = (attemptRows || []).filter((a) => a.user_id === student.id)
        const readingPcts = own.filter((a) => moduleByExamId[a.exam_id] === 'reading').map((a) => pct(a.score, a.max_score))
        const listeningPcts = own.filter((a) => moduleByExamId[a.exam_id] === 'listening').map((a) => pct(a.score, a.max_score))
        const readingBand = readingPcts.length
          ? estimateBandFromPercent(readingPcts.reduce((s, v) => s + v, 0) / readingPcts.length)
          : null
        const listeningBand = listeningPcts.length
          ? estimateBandFromPercent(listeningPcts.reduce((s, v) => s + v, 0) / listeningPcts.length)
          : null

        const ownWriting = (writingRows || []).filter((r) => r.student_id === student.id)
        const writingBands = ownWriting.filter((r) => r.examiner_band != null).map((r) => Number(r.examiner_band))
        const writingBand = writingBands.length
          ? roundOverallBand(writingBands.reduce((s, v) => s + v, 0) / writingBands.length)
          : null

        const ownSpeaking = (speakingRows || []).filter((s) => s.student_id === student.id)
        const speakingBands = ownSpeaking
          .filter((s) => s.status === 'completed' && s.examiner_band != null)
          .map((s) => Number(s.examiner_band))
        const speakingBand = speakingBands.length
          ? roundOverallBand(speakingBands.reduce((s, v) => s + v, 0) / speakingBands.length)
          : null

        const available = [readingBand, listeningBand, writingBand, speakingBand].filter((b) => b != null)
        const overallBand = available.length
          ? roundOverallBand(available.reduce((s, v) => s + v, 0) / available.length)
          : null

        const hasAnyActivity =
          readingPcts.length > 0 || listeningPcts.length > 0 || ownWriting.length > 0 || ownSpeaking.length > 0

        return { student, overallBand, hasAnyActivity }
      })
      .filter((s) => {
        if (!s.hasAnyActivity) return true
        if (s.overallBand != null && s.student.target_band != null) {
          return s.overallBand <= s.student.target_band - BAND_GAP_ATTENTION
        }
        return false
      })
      .map((s) => ({
        student: s.student,
        neverAttempted: !s.hasAnyActivity,
        reason: !s.hasAnyActivity
          ? 'Never attempted a mock'
          : `Estimated ${formatBand(s.overallBand)} vs target ${formatBand(s.student.target_band)}`,
        gap:
          s.overallBand != null && s.student.target_band != null
            ? s.student.target_band - s.overallBand
            : Infinity,
      }))
      .sort((a, b) => {
        if (a.neverAttempted !== b.neverAttempted) return a.neverAttempted ? -1 : 1
        return b.gap - a.gap
      })

    if (needsAttention.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, needsAttentionCount: 0, teachersNotified: 0, note: 'Nobody needs attention right now — nothing sent.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: teachers, error: teachersError } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'teacher')
      .eq('status', 'approved')

    if (teachersError) throw teachersError

    const teacherIds = (teachers || []).map((t) => t.id)

    if (teacherIds.length === 0 || !telegramBotToken) {
      return new Response(
        JSON.stringify({
          ok: true,
          needsAttentionCount: needsAttention.length,
          teachersNotified: 0,
          note: !telegramBotToken ? 'TELEGRAM_BOT_TOKEN not configured.' : 'No approved teachers found.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: linkRows, error: linksError } = await admin
      .from('telegram_links')
      .select('user_id, telegram_chat_id')
      .in('user_id', teacherIds)

    if (linksError) throw linksError

    const CAP = 20
    const lines = needsAttention
      .slice(0, CAP)
      .map((n) => `• ${n.student.full_name || n.student.username || 'A student'} — ${n.reason}`)
    const extra = needsAttention.length > CAP ? `\n…and ${needsAttention.length - CAP} more.` : ''

    const text =
      `📋 Needs attention — ${needsAttention.length} student${needsAttention.length === 1 ? '' : 's'}\n\n` +
      lines.join('\n') +
      extra +
      `\n\nOpen Teacher Mock Center → Student Progress for full detail.`

    let teachersNotified = 0
    for (const link of linkRows || []) {
      try {
        await sendTelegramMessage(telegramBotToken, link.telegram_chat_id, text)
        teachersNotified += 1
      } catch (err) {
        console.error('teacher-needs-attention-digest: telegram send failed for teacher', link.user_id, err)
      }
    }

    return new Response(
      JSON.stringify({ ok: true, needsAttentionCount: needsAttention.length, teachersNotified }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('teacher-needs-attention-digest failed:', error)
    return new Response(
      JSON.stringify({ ok: false, error: error?.message || 'teacher-needs-attention-digest failed.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
