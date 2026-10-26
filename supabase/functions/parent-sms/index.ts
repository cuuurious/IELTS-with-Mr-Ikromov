// supabase/functions/parent-sms/index.ts
//
// SMS to parents when a student misses homework (2026-10-19).
//
// Ways to call it:
//   { mode: 'run' }      — the automatic job: pg_cron calls it every day
//                          at 9:00 Tashkent with the x-cron-secret header
//                          (see migration_82_parent_sms.sql). It only
//                          sends on the weekdays the teacher picked
//                          (parent_sms_settings.send_days) and to:
//                            audience 'missed' — parents whose child
//                              didn't hand in homework due since the
//                              last sending day;
//                            audience 'all' — every parent whose
//                              student has automatic SMS switched on.
//                          One SMS per parent per day.
//   { mode: 'preview', day: 'tomorrow' | 'today' }
//                        — a teacher (signed in) sees who WOULD get the
//                          automatic SMS, with the exact text. Sends nothing.
//   { mode: 'compose', studentIds: [...] }
//                        — "Send now": the exact text each chosen parent
//                          would get. Sends nothing.
//   { mode: 'send', studentIds: [...] }
//                        — "Send now": sends it. {homework} / {count}
//                          are the homework that student hasn't handed in
//                          with a deadline in the last 14 days; {date} is
//                          today. The per-student "automatic SMS" switch
//                          is only for the automatic job: a teacher who
//                          ticks a student here means it.
//   { mode: 'test', phone: '998901234567' }
//                        — a teacher sends the current text, filled in
//                          with sample details, to one number.
//
// "Missed" uses the same rule as the rest of the site (Teacher Home,
// leaderboard, parent report): no handed-in submission and no
// homework_completions row. A student who joined the group after the
// deadline is not counted. Groups or students switched off are skipped,
// and so is anyone without a parent phone number.
//
// The SMS goes through Eskiz.uz. Secrets (Supabase → Edge Functions →
// Secrets): ESKIZ_EMAIL, ESKIZ_PASSWORD, and optionally ESKIZ_FROM (the
// approved sender name; Eskiz's default is 4546).
//
// Deploy with:  npx supabase functions deploy parent-sms --no-verify-jwt
// (the cron call has no user token). Every call is still checked here:
// either the cron secret from the vault, or a signed-in teacher (the
// is_teacher() call goes through Supabase, which verifies the token).
//
// parent_sms_log has a unique index on (student_id, for_date), so a
// parent never gets two SMS for the same day even if the job runs twice.

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Tashkent is UTC+5 all year (no summer time).
const TASHKENT_OFFSET_MS = 5 * 3600 * 1000
const DAY = 24 * 3600 * 1000

// UTC instants for the start and end of a Tashkent calendar day.
// shift 0 = today, -1 = yesterday.
function tashkentDay(shift: number, now = new Date()) {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MS)
  const midnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  const start = new Date(midnightLocal - TASHKENT_OFFSET_MS + shift * DAY)
  const end = new Date(start.getTime() + DAY)
  const date = new Date(midnightLocal + shift * DAY).toISOString().slice(0, 10) // YYYY-MM-DD
  return { start, end, date }
}

// ISO weekday (1 = Monday … 7 = Sunday) of a YYYY-MM-DD date.
function isoWeekday(date: string) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]

// Same as groupDisplayName in src/lib/groupLook.js: "71" → "Group 71".
function groupDisplayName(name: string) {
  const t = (name || '').trim()
  if (!t) return 'Group'
  return /^\d+$/.test(t) ? `Group ${t}` : t
}

function formatDate(isoDate: string) {
  const [y, m, d] = isoDate.split('-')
  return `${d}.${m}.${y}`
}

// Fills {student} {homework} {count} {date} {group} in the teacher's text.
// date is YYYY-MM-DD, or a "from–to" pair when the window spans days.
export function renderTemplate(
  template: string,
  v: { student: string; homework: string[]; date: string; group: string }
) {
  const dateText = v.date.includes('/') ? v.date.split('/').map(formatDate).join('–') : formatDate(v.date)
  return template
    .replaceAll('{student}', v.student)
    .replaceAll('{homework}', v.homework.join(', '))
    .replaceAll('{count}', String(v.homework.length))
    .replaceAll('{date}', dateText)
    .replaceAll('{group}', v.group)
    .trim()
}

export function normalisePhone(raw: string) {
  let digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 9) digits = '998' + digits
  return /^998\d{9}$/.test(digits) ? digits : null
}

// --- Eskiz ---------------------------------------------------------------
const ESKIZ = 'https://notify.eskiz.uz/api'

async function eskizToken() {
  const email = Deno.env.get('ESKIZ_EMAIL')
  const password = Deno.env.get('ESKIZ_PASSWORD')
  if (!email || !password) throw new Error('ESKIZ_EMAIL / ESKIZ_PASSWORD are not set in the Edge Function secrets.')
  const form = new FormData()
  form.append('email', email)
  form.append('password', password)
  const res = await fetch(`${ESKIZ}/auth/login`, { method: 'POST', body: form })
  const body = await res.json().catch(() => ({}))
  const token = body?.data?.token
  if (!res.ok || !token) throw new Error(`Eskiz login failed: ${body?.message || res.status}`)
  return token as string
}

async function eskizSend(token: string, phone: string, message: string) {
  const form = new FormData()
  form.append('mobile_phone', phone)
  form.append('message', message)
  form.append('from', Deno.env.get('ESKIZ_FROM') || '4546')
  const res = await fetch(`${ESKIZ}/message/sms/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body?.status === 'error') {
    const why = typeof body?.message === 'string' ? body.message : JSON.stringify(body?.message || body).slice(0, 300)
    return { ok: false, error: why || `HTTP ${res.status}` }
  }
  return { ok: true, id: body?.id ? String(body.id) : null }
}

// --- Who missed what -----------------------------------------------------
async function fetchAll(query: () => any) {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}

// The automatic SMS for the morning of run day (runShift 0 = today,
// 1 = tomorrow). Deadlines counted: from the previous sending day up to
// the day before the run day, so Mon/Wed/Fri covers Fri–Sun on Monday.
async function buildMessages(admin: any, runShift: number) {
  const run = tashkentDay(runShift)
  const { data: settings } = await admin
    .from('parent_sms_settings')
    .select('enabled, template, send_days, audience')
    .eq('id', 1)
    .maybeSingle()
  const days: number[] = settings?.send_days?.length ? settings.send_days : ALL_DAYS
  const audience = settings?.audience === 'all' ? 'all' : 'missed'
  const sendDay = days.includes(isoWeekday(run.date))
  let back = 1
  while (back < 7 && !days.includes(isoWeekday(tashkentDay(runShift - back).date))) back += 1
  const from = tashkentDay(runShift - back)
  const to = tashkentDay(runShift - 1)
  const window = { from: from.date, to: to.date }
  const dateText = from.date === to.date ? to.date : `${from.date}/${to.date}`
  const base = { run, sendDay, settings, audience, days, window }

  const { data: groups, error: gErr } = await admin.from('groups').select('id, name, parent_sms_enabled')
  if (gErr) throw gErr
  const onGroups = (groups || []).filter((g: any) => g.parent_sms_enabled !== false)
  const groupName: Record<string, string> = {}
  for (const g of groups || []) groupName[g.id] = groupDisplayName(g.name)
  if (!onGroups.length) return { ...base, messages: [], skipped: [] }
  const groupIds = onGroups.map((g: any) => g.id)

  const [homeworks, members, phones] = await Promise.all([
    fetchAll(() =>
      admin
        .from('homeworks')
        .select('id, group_id, title, due_date')
        .in('group_id', groupIds)
        .gte('due_date', from.start.toISOString())
        .lt('due_date', to.end.toISOString())
        .order('id')
    ),
    fetchAll(() =>
      admin
        .from('group_members')
        .select('group_id, student_id, created_at, profiles!inner(id, full_name, username, status, role)')
        .in('group_id', groupIds)
        .eq('profiles.status', 'approved')
        .order('id')
    ),
    fetchAll(() => admin.from('parent_phones').select('student_id, phone, sms_enabled').order('student_id')),
  ])
  const hwIds = homeworks.map((h: any) => h.id)
  const [subs, comps] = hwIds.length
    ? await Promise.all([
        fetchAll(() => admin.from('submissions').select('homework_id, student_id').in('homework_id', hwIds).eq('status', 'done').order('id')),
        fetchAll(() => admin.from('homework_completions').select('homework_id, student_id').in('homework_id', hwIds).order('id')),
      ])
    : [[], []]

  const done = new Set([...subs, ...comps].map((x: any) => `${x.homework_id}:${x.student_id}`))
  const phoneOf: Record<string, any> = {}
  for (const p of phones) phoneOf[p.student_id] = p

  // student -> { person, groups, titles, ids }
  const byStudent: Record<string, any> = {}
  for (const m of members) {
    if (m.profiles?.role && m.profiles.role !== 'student') continue
    const row = (byStudent[m.student_id] ||= { person: m.profiles, groups: new Set(), titles: [], ids: [] })
    row.groups.add(groupName[m.group_id] || '')
    for (const hw of homeworks) {
      if (hw.group_id !== m.group_id) continue
      if (m.created_at && new Date(m.created_at) > new Date(hw.due_date)) continue
      if (done.has(`${hw.id}:${m.student_id}`)) continue
      row.titles.push(hw.title)
      row.ids.push(hw.id)
    }
  }

  const messages: any[] = []
  const skipped: any[] = []
  for (const [studentId, r] of Object.entries(byStudent) as any) {
    const missedSome = r.titles.length > 0
    if (audience === 'missed' && !missedSome) continue
    const name = (r.person?.full_name || r.person?.username || '').trim()
    const p = phoneOf[studentId]
    const row = { studentId, student: name, homework: r.titles, homeworkIds: r.ids, group: [...r.groups].join(', ') }
    if (!p || !p.sms_enabled) {
      // Only worth listing when the child actually missed something.
      if (missedSome) skipped.push({ ...row, reason: p ? 'student_off' : 'no_phone' })
      continue
    }
    messages.push({
      ...row,
      phone: p.phone,
      text: renderTemplate(settings?.template || '', { student: name, homework: r.titles, date: dateText, group: row.group }),
    })
  }
  messages.sort((a, b) => a.student.localeCompare(b.student))
  skipped.sort((a, b) => a.student.localeCompare(b.student))
  return { ...base, messages, skipped }
}

// "Send now": texts for the students the teacher ticked.
async function composeManual(admin: any, studentIds: string[]) {
  const ids = [...new Set((studentIds || []).filter((x) => typeof x === 'string'))].slice(0, 500)
  const today = tashkentDay(0)
  const since = new Date(Date.now() - 14 * DAY).toISOString()
  const { data: settings } = await admin.from('parent_sms_settings').select('template').eq('id', 1).maybeSingle()
  if (!ids.length) return { today, settings, messages: [], skipped: [] }

  const [members, phones] = await Promise.all([
    fetchAll(() =>
      admin
        .from('group_members')
        .select('group_id, student_id, created_at, profiles!inner(id, full_name, username), groups!inner(id, name)')
        .in('student_id', ids)
        .order('id')
    ),
    fetchAll(() => admin.from('parent_phones').select('student_id, phone').in('student_id', ids).order('student_id')),
  ])
  const groupIds = [...new Set(members.map((m: any) => m.group_id))]
  const homeworks = groupIds.length
    ? await fetchAll(() =>
        admin
          .from('homeworks')
          .select('id, group_id, title, due_date')
          .in('group_id', groupIds)
          .gte('due_date', since)
          .lt('due_date', new Date().toISOString())
          .order('id')
      )
    : []
  const hwIds = homeworks.map((h: any) => h.id)
  const [subs, comps] = hwIds.length
    ? await Promise.all([
        fetchAll(() => admin.from('submissions').select('homework_id, student_id').in('homework_id', hwIds).in('student_id', ids).eq('status', 'done').order('id')),
        fetchAll(() => admin.from('homework_completions').select('homework_id, student_id').in('homework_id', hwIds).in('student_id', ids).order('id')),
      ])
    : [[], []]
  const done = new Set([...subs, ...comps].map((x: any) => `${x.homework_id}:${x.student_id}`))
  const phoneOf: Record<string, string> = {}
  for (const p of phones) phoneOf[p.student_id] = p.phone

  const byStudent: Record<string, any> = {}
  for (const m of members) {
    const row = (byStudent[m.student_id] ||= { person: m.profiles, groups: new Set(), titles: [], ids: [] })
    row.groups.add(groupDisplayName(m.groups?.name || ''))
    for (const h of homeworks) {
      if (h.group_id !== m.group_id) continue
      if (m.created_at && new Date(m.created_at) > new Date(h.due_date)) continue
      if (done.has(`${h.id}:${m.student_id}`)) continue
      row.titles.push(h.title)
      row.ids.push(h.id)
    }
  }

  const messages: any[] = []
  const skipped: any[] = []
  for (const id of ids) {
    const r = byStudent[id]
    if (!r) continue
    const name = (r.person?.full_name || r.person?.username || '').trim()
    const base = { studentId: id, student: name, homework: r.titles, homeworkIds: r.ids, group: [...r.groups].join(', ') }
    if (!phoneOf[id]) {
      skipped.push({ ...base, reason: 'no_phone' })
      continue
    }
    messages.push({
      ...base,
      phone: phoneOf[id],
      text: renderTemplate(settings?.template || '', { student: name, homework: r.titles, date: today.date, group: base.group }),
    })
  }
  messages.sort((a, b) => a.student.localeCompare(b.student))
  return { today, settings, messages, skipped }
}

// --- Handler -------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const authHeader = req.headers.get('Authorization') || ''
  const body = await req.json().catch(() => ({}))
  const mode = body?.mode || 'run'

  // The daily job proves itself with the secret kept in the vault.
  let isCron = false
  const cronSecret = req.headers.get('x-cron-secret')
  if (cronSecret) {
    const { data } = await admin.rpc('check_parent_sms_secret', { p_secret: cronSecret })
    isCron = data === true
    if (!isCron) return json({ error: 'Wrong secret.' }, 401)
  }

  // Everything else: only a signed-in teacher, and never the daily send.
  if (!isCron) {
    if (!authHeader) return json({ error: 'Sign in first.' }, 401)
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: isTeacher } = await asUser.rpc('is_teacher')
    if (isTeacher !== true) return json({ error: 'Only a teacher can do this.' }, 403)
    if (mode === 'run') return json({ error: 'The daily send only runs from the scheduler.' }, 403)
  }

  try {
    if (mode === 'preview') {
      const r = await buildMessages(admin, body?.day === 'today' ? 0 : 1)
      return json({
        date: r.run.date,
        sendDay: r.sendDay,
        window: r.window,
        audience: r.audience,
        enabled: !!r.settings?.enabled,
        messages: r.sendDay ? r.messages : [],
        skipped: r.sendDay ? r.skipped : [],
      })
    }

    if (mode === 'compose') {
      const r = await composeManual(admin, body?.studentIds)
      return json({ date: r.today.date, messages: r.messages, skipped: r.skipped })
    }

    if (mode === 'send') {
      const r = await composeManual(admin, body?.studentIds)
      if (!r.settings?.template?.trim()) return json({ error: 'Write and save the message text first.' }, 400)
      if (!r.messages.length) return json({ error: 'None of the chosen students has a parent number.' }, 400)
      const token = await eskizToken()
      let sent = 0
      let failed = 0
      const errors: string[] = []
      const sendOne = async (m: any) => {
        const { data: row } = await admin
          .from('parent_sms_log')
          .insert({ student_id: m.studentId, phone: m.phone, message: m.text, homework_ids: m.homeworkIds, for_date: r.today.date, kind: 'manual' })
          .select('id')
          .maybeSingle()
        const res = await eskizSend(token, m.phone, m.text)
        if (row) {
          await admin
            .from('parent_sms_log')
            .update(res.ok ? { status: 'sent', provider_id: res.id } : { status: 'failed', error: res.error })
            .eq('id', row.id)
        }
        if (res.ok) sent += 1
        else {
          failed += 1
          if (errors.length < 3) errors.push(res.error)
        }
      }
      for (let i = 0; i < r.messages.length; i += 5) {
        await Promise.all(r.messages.slice(i, i + 5).map(sendOne))
      }
      return json({ ok: true, sent, failed, errors, noPhone: r.skipped.length })
    }

    if (mode === 'test') {
      const phone = normalisePhone(body?.phone)
      if (!phone) return json({ error: 'Enter a phone number like +998 90 123 45 67.' }, 400)
      const { data: settings } = await admin.from('parent_sms_settings').select('template').eq('id', 1).maybeSingle()
      if (!settings?.template?.trim()) return json({ error: 'Write and save the message text first.' }, 400)
      const today = tashkentDay(-1)
      const text = renderTemplate(settings.template, {
        student: 'Aliyev Vali',
        homework: ['Writing Task 2', 'Reading Passage 1'],
        date: today.date,
        group: 'Group 71',
      })
      const token = await eskizToken()
      const sent = await eskizSend(token, phone, text)
      await admin.from('parent_sms_log').insert({
        student_id: null,
        phone,
        message: text,
        for_date: today.date,
        kind: 'test',
        status: sent.ok ? 'sent' : 'failed',
        provider_id: sent.ok ? sent.id : null,
        error: sent.ok ? null : sent.error,
      })
      return sent.ok ? json({ ok: true, text }) : json({ error: `Eskiz: ${sent.error}`, text }, 502)
    }

    // mode === 'run' (scheduler)
    const r = await buildMessages(admin, 0)
    if (!r.settings?.enabled) return json({ ok: true, note: 'Parent SMS is switched off.', wouldSend: r.messages.length })
    if (!r.sendDay) return json({ ok: true, note: 'Today is not a sending day.' })
    if (!r.settings?.template?.trim()) return json({ ok: true, note: 'No message text saved.' })
    if (!r.messages.length) return json({ ok: true, sent: 0, date: r.run.date })

    const token = await eskizToken()
    let sent = 0
    let failed = 0
    let already = 0
    const sendOne = async (m: any) => {
      // Claim the (student, day) slot first; if it's taken, this parent
      // already got today's SMS.
      const { data: claim, error: claimErr } = await admin
        .from('parent_sms_log')
        .insert({ student_id: m.studentId, phone: m.phone, message: m.text, homework_ids: m.homeworkIds, for_date: r.run.date, kind: 'auto' })
        .select('id')
        .maybeSingle()
      if (claimErr || !claim) {
        already += 1
        return
      }
      const res = await eskizSend(token, m.phone, m.text)
      await admin
        .from('parent_sms_log')
        .update(res.ok ? { status: 'sent', provider_id: res.id } : { status: 'failed', error: res.error })
        .eq('id', claim.id)
      if (res.ok) sent += 1
      else failed += 1
    }
    // Five at a time keeps a big day well inside the function's time limit.
    for (let i = 0; i < r.messages.length; i += 5) {
      await Promise.all(r.messages.slice(i, i + 5).map(sendOne))
    }
    return json({ ok: true, date: r.run.date, sent, failed, already, noPhone: r.skipped.length })
  } catch (err) {
    console.error('parent-sms', err)
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})
