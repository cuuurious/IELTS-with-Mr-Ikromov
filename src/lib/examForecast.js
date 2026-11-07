/*
 * EXAM COUNTDOWN + BAND FORECAST (2026-11-07).
 * One place for the band estimate (used by the countdown bar on every
 * student page and by the forecast card on Home) and for the words the
 * countdown says. The estimate is kept for 5 minutes so moving between
 * pages doesn't ask the database again.
 */
import { supabase } from './supabaseClient'
import { bandFromPct, overallBand } from './bands'

export const FORECAST_SKILLS = [
  ['listening', 'Listening', 'text-listening'],
  ['reading', 'Reading', 'text-reading'],
  ['writing', 'Writing', 'text-writing'],
  ['speaking', 'Speaking', 'text-speaking'],
]

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const half = (x) => (x == null ? null : Math.round(x * 2) / 2)

const cache = new Map() // studentId → { at, promise }
const KEEP_MS = 5 * 60 * 1000

export function forgetForecast() {
  cache.clear()
}

async function fetchEstimate(studentId) {
  const since = new Date(Date.now() - 45 * 86400000).toISOString()
  const [att, book, mocks, notebook] = await Promise.all([
    supabase
      .from('homework_attempts')
      .select('score, max_score, band, submitted_at, homework_tasks(skill, question_type, html_url)')
      .eq('user_id', studentId)
      .not('submitted_at', 'is', null)
      .gte('submitted_at', since)
      .order('submitted_at', { ascending: false })
      .limit(150),
    supabase.from('book_practice').select('score, max_score, created_at, materials(skill)').eq('user_id', studentId).gte('created_at', since).limit(150),
    supabase.from('speaking_mocks').select('band').eq('user_id', studentId).eq('status', 'done').not('band', 'is', null).limit(5),
    supabase.from('mistake_pages').select('question_type, wrong').eq('user_id', studentId),
  ])
  const pct = { reading: [], listening: [] }
  const bands = { writing: [], speaking: [] }
  ;(att.data || []).forEach((a) => {
    const t = a.homework_tasks || {}
    const kind = /^speaking/.test(t.question_type || '') || /^speaking:/.test(t.html_url || '') ? 'speaking' : /^writing/.test(t.question_type || '') || /\/writing\//.test(t.html_url || '') ? 'writing' : t.skill
    if ((kind === 'writing' || kind === 'speaking') && a.band != null) bands[kind].push(Number(a.band))
    else if ((kind === 'reading' || kind === 'listening') && a.max_score > 0) pct[kind].push((100 * a.score) / a.max_score)
  })
  ;(book.data || []).forEach((b) => {
    const k = b.materials?.skill
    if ((k === 'reading' || k === 'listening') && b.max_score > 0) pct[k].push((100 * b.score) / b.max_score)
  })
  ;(mocks.data || []).forEach((m) => bands.speaking.push(Number(m.band)))
  const est = {
    listening: pct.listening.length >= 2 ? bandFromPct(avg(pct.listening.slice(0, 12))) : null,
    reading: pct.reading.length >= 2 ? bandFromPct(avg(pct.reading.slice(0, 12))) : null,
    writing: bands.writing.length ? half(avg(bands.writing.slice(0, 5))) : null,
    speaking: bands.speaking.length ? half(avg(bands.speaking.slice(0, 5))) : null,
  }
  const byType = {}
  ;(notebook.data || []).forEach((r) => r.question_type && (byType[r.question_type] = (byType[r.question_type] || 0) + (r.wrong?.length || 0)))
  const weakType = Object.entries(byType).sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0) || null
  const lowest = FORECAST_SKILLS.map(([k, l]) => [k, l, est[k]]).filter(([, , b]) => b != null).sort((a, b) => a[2] - b[2])[0] || null
  const missing = FORECAST_SKILLS.filter(([k]) => est[k] == null).map(([k, l]) => [k, l])
  return { est, overall: overallBand(Object.values(est)), weakType, lowest, missing }
}

export function loadBandEstimate(studentId, { force = false } = {}) {
  if (!studentId) return Promise.resolve(null)
  const hit = cache.get(studentId)
  if (!force && hit && Date.now() - hit.at < KEEP_MS) return hit.promise
  const promise = fetchEstimate(studentId).catch(() => {
    cache.delete(studentId)
    return null
  })
  cache.set(studentId, { at: Date.now(), promise })
  return promise
}

// Whole days from today (Tashkent) to the exam date ('YYYY-MM-DD').
export function daysToExam(examDate, now = Date.now()) {
  if (!examDate) return null
  const today = new Date(now + 5 * 3600000).toISOString().slice(0, 10)
  return Math.round((Date.parse(`${examDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
}

export function formatExamDate(examDate) {
  if (!examDate) return ''
  return new Date(`${examDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const SKILL_TAB = { listening: 'books', reading: 'books', writing: 'homework', speaking: 'homework' }

/*
 * What the countdown says. Firm on purpose (Jasur: "push harder"), and
 * always ends with one thing to do now.
 *   tone: 'good' | 'close' | 'behind' | 'final' | 'setup' | 'result' | 'day'
 */
export function examAdvice({ days, target, overall, lowest, missing = [] }) {
  const b = (x) => Number(x).toFixed(1)
  const weakest = lowest ? lowest[1] : null
  const weakTab = lowest ? SKILL_TAB[lowest[0]] : 'books'

  if (days == null) {
    return { tone: 'setup', title: 'When is your exam?', line: 'Set the date. A deadline turns “some day” into a plan.', action: { kind: 'date', label: 'Set exam date' } }
  }
  if (days < 0) {
    return { tone: 'result', title: 'How did your exam go?', line: 'Enter your real overall band — it helps Mr Ikromov plan your next step.', action: { kind: 'result', label: 'Enter my result' } }
  }
  if (days === 0) {
    return { tone: 'day', title: 'Exam day', line: 'Eat, arrive early, read every question twice. You have done the work — go and take it.', action: null }
  }
  if (target == null) {
    return { tone: 'setup', title: `${days} day${days === 1 ? '' : 's'} left`, line: 'Set your target band so we can tell you how far you are from it.', action: { kind: 'target', label: 'Set target band' } }
  }
  if (overall == null) {
    const need = missing.length ? missing.map(([, l]) => l).slice(0, 2).join(' and ') : 'Reading and Listening'
    return { tone: 'behind', title: `${days} days left — no forecast yet`, line: `We can't see where you stand. Do ${need} practice this week so the forecast can start.`, action: { kind: 'tab', tab: missing.some(([k]) => k === 'writing' || k === 'speaking') && !missing.some(([k]) => k === 'reading' || k === 'listening') ? 'homework' : 'books', label: 'Start practising' } }
  }

  const gap = Math.round((target - overall) * 2) / 2

  if (days <= 7 && gap > 0) {
    return { tone: 'final', title: `${days} day${days === 1 ? '' : 's'} left · ${b(gap)} to go`, line: 'No new material now. Full timed tests, then go through every mistake in your notebook.', action: { kind: 'tab', tab: 'mock-center', label: 'Take a full test' } }
  }
  if (gap <= 0) {
    return { tone: 'good', title: `On track for ${b(target)}`, line: `Forecast ${b(overall)}. Don't relax — one weak day in the exam costs half a band. Keep ${weakest || 'every skill'} sharp.`, action: { kind: 'tab', tab: weakTab, label: weakest ? `Practise ${weakest}` : 'Practise' } }
  }
  if (gap <= 0.5) {
    return { tone: 'close', title: `Half a band to go`, line: `${days} days is enough if you push now. ${weakest ? `${weakest} is your quickest gain` : 'Your weakest skill is the quickest gain'} — do it today.`, action: { kind: 'tab', tab: weakTab, label: weakest ? `Push ${weakest}` : 'Push now' } }
  }
  if (gap <= 1) {
    return { tone: 'behind', title: `${b(gap)} band${gap === 1 ? '' : 's'} behind your target`, line: `${days} days is enough only if you work every day. Start with ${weakest || 'your weakest skill'} — today, not tomorrow.`, action: { kind: 'tab', tab: weakTab, label: weakest ? `Work on ${weakest}` : 'Start now' } }
  }
  return { tone: 'behind', title: `${b(gap)} bands behind your target`, line: `${days} days left. This needs daily work, not weekend work. ${weakest || 'Your weakest skill'} first — every day until the exam.`, action: { kind: 'tab', tab: weakTab, label: weakest ? `Work on ${weakest}` : 'Start now' } }
}
