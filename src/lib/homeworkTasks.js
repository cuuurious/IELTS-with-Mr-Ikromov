import { supabase } from './supabaseClient'

/*
 * Homework done inside the site (migrations 84 + 85, 2026-11-02).
 * A homework can carry tasks: a Reading or Listening test from the
 * homework bank, a word list, one of Mr Ikromov's HTML workshops, or a
 * shadowing clip. Every try is a homework_attempts row; the first one
 * counts for the leaderboard, retakes are kept too.
 */

export const TASK_KINDS = {
  reading: { label: 'Reading test', short: 'Reading', skill: 'reading', tint: 'bg-reading-tint', text: 'text-reading', solid: 'bg-reading' },
  listening: { label: 'Listening test', short: 'Listening', skill: 'listening', tint: 'bg-listening-tint', text: 'text-listening', solid: 'bg-listening' },
  wordlist: { label: 'Word list', short: 'Words', skill: 'vocab', tint: 'bg-vocab-tint', text: 'text-vocab', solid: 'bg-vocab' },
  html: { label: 'Practice page', short: 'Page', skill: 'general', tint: 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))]', text: 'text-brass', solid: 'bg-brass' },
  shadowing: { label: 'Shadowing', short: 'Shadowing', skill: 'speaking', tint: 'bg-speaking-tint', text: 'text-speaking', solid: 'bg-speaking' },
  // Not a task kind of its own: an html task whose url is "speaking:…".
  speaking: { label: 'Speaking test', short: 'Speaking', skill: 'speaking', tint: 'bg-speaking-tint', text: 'text-speaking', solid: 'bg-speaking' },
}

// The look of a task: speaking tests are html tasks with a speaking: url.
export function taskMeta(task) {
  if (task?.kind === 'html' && /^speaking:/.test(task.html_url || '')) return TASK_KINDS.speaking
  return TASK_KINDS[task?.kind] || TASK_KINDS.reading
}

export const TASK_SELECT = 'id, position, kind, exam_id, wordlist_id, html_url, title, shadowing_clip_id'

export function taskTitle(task) {
  return task.title || TASK_KINDS[task.kind]?.label || 'Task'
}

export function percentOf(attempt) {
  // Speaking tests have an AI band and no score.
  if (attempt && attempt.score == null && attempt.band != null) return Math.round((Number(attempt.band) / 9) * 100)
  if (!attempt || attempt.score == null || !attempt.max_score) return null
  return Math.round((attempt.score / attempt.max_score) * 100)
}

// "30/40 · Band 7.0", "8/10", "Done"
export function gradeLabel(attempt) {
  if (!attempt?.submitted_at) return null
  if (attempt.score == null && attempt.band != null) return `Band ${Number(attempt.band).toFixed(1)}`
  if (attempt.score == null || !attempt.max_score) return 'Done'
  const base = `${attempt.score}/${attempt.max_score}`
  return attempt.band != null ? `${base} · Band ${Number(attempt.band).toFixed(1)}` : base
}

// Colour for a percentage — same scale everywhere (gradebook, cards).
export function gradeTone(pct) {
  if (pct == null) return { bg: 'bg-panel-2', text: 'text-mist' }
  if (pct >= 80) return { bg: 'bg-reading-tint', text: 'text-reading' }
  if (pct >= 60) return { bg: 'bg-listening-tint', text: 'text-listening' }
  if (pct >= 40) return { bg: 'bg-[color-mix(in_srgb,var(--color-saffron)_18%,var(--color-panel))]', text: 'text-amber' }
  return { bg: 'bg-urgent-tint', text: 'text-coral' }
}

// First attempt, best attempt and the number of tries for one task.
export function summariseAttempts(attempts) {
  const done = (attempts || []).filter((a) => a.submitted_at).sort((a, b) => a.attempt_no - b.attempt_no)
  const first = done[0] || null
  const best = done.reduce((b, a) => {
    const p = percentOf(a) ?? (a.submitted_at ? 100 : -1)
    const bp = b ? percentOf(b) ?? 100 : -1
    return p > bp ? a : b
  }, null)
  return { first, best, tries: done.length, open: (attempts || []).find((a) => !a.submitted_at) || null }
}

// Save the task list of a homework: delete removed ones, add new ones,
// keep the order. `tasks` items: { id?, kind, exam_id, wordlist_id, html_url, title, shadowing_clip_id }.
export async function saveHomeworkTasks(homeworkId, tasks, previous = []) {
  const keepIds = new Set(tasks.filter((t) => t.id).map((t) => t.id))
  const removed = previous.filter((t) => t.id && !keepIds.has(t.id)).map((t) => t.id)
  if (removed.length) {
    const { error } = await supabase.from('homework_tasks').delete().in('id', removed)
    if (error) throw error
  }
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i]
    const row = {
      homework_id: homeworkId,
      position: i,
      kind: t.kind,
      exam_id: t.exam_id || null,
      wordlist_id: t.wordlist_id || null,
      html_url: t.html_url || null,
      title: t.title || null,
      shadowing_clip_id: t.shadowing_clip_id || null,
    }
    const { error } = t.id
      ? await supabase.from('homework_tasks').update({ position: i, title: row.title }).eq('id', t.id)
      : await supabase.from('homework_tasks').insert(row)
    if (error) throw error
  }
}

// Minutes the real-exam mode gives (same rule as the database).
export function examMinutes(exam, sectionCount) {
  return (exam?.module === 'listening' ? 10 : 20) * Math.max(1, sectionCount || 1)
}

// Tashkent calendar day as YYYY-MM-DD (the Daily Marathon's "today").
export function tashkentDay(date = new Date()) {
  return new Date(date.getTime() + 5 * 3600_000).toISOString().slice(0, 10)
}

// Monday of the week (Tashkent) as YYYY-MM-DD.
export function weekStart(date = new Date(), offsetWeeks = 0) {
  const t = new Date(date.getTime() + 5 * 3600_000)
  const day = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - day + offsetWeeks * 7)
  return t.toISOString().slice(0, 10)
}

// Small seeded random — the same marathon questions for everyone today.
export function seededShuffle(list, seedText) {
  let h = 2166136261
  for (let i = 0; i < seedText.length; i += 1) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619) >>> 0
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0
    const j = h % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
