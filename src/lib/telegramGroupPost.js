import { supabase } from './supabaseClient'

/*
 * HOMEWORK → TELEGRAM GROUP helpers (2026-10-08, migration_79).
 * The bot posts homework into the group's linked Telegram chat under a
 * "Assalomu aleykum. Lesson 4. October 8." header. See
 * supabase/functions/telegram-group-post.
 *
 * Everything here degrades quietly before migration_79 is run: the
 * lesson fields and the Telegram switch simply don't show.
 */

const isMissingColumn = (err) => err && (err.code === '42703' || /column .* does not exist|schema cache/i.test(err.message || ''))

export function todayIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Suggest the lesson for a new homework: same lesson if the last
// homework of this group was set today, otherwise the next number.
export async function loadLessonDefaults(groupId) {
  const { data, error } = await supabase
    .from('homeworks')
    .select('lesson_number, lesson_date, created_at')
    .eq('group_id', groupId)
    .not('lesson_number', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return { supported: !isMissingColumn(error), lessonNumber: '', lessonDate: todayIso() }
  const last = data?.[0]
  const today = todayIso()
  if (!last) return { supported: true, lessonNumber: '', lessonDate: today }
  const sameDay = last.lesson_date === today
  return { supported: true, lessonNumber: sameDay ? last.lesson_number : (last.lesson_number || 0) + 1, lessonDate: today }
}

export async function loadTelegramLink(groupId) {
  const { data, error } = await supabase
    .from('groups')
    .select('telegram_chat_id, telegram_chat_title')
    .eq('id', groupId)
    .maybeSingle()
  if (error) return { supported: false, linked: false, title: null }
  return { supported: true, linked: Boolean(data?.telegram_chat_id), title: data?.telegram_chat_title || null }
}

export function lessonHeaderPreview(n, d) {
  const parts = ['Assalomu aleykum.']
  if (n) parts.push(`Lesson ${n}.`)
  if (d) {
    const [y, m, day] = String(d).split('-').map(Number)
    if (y && m && day) parts.push(`${new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`)
  }
  return parts.join(' ')
}

// Fire-and-forget: the function answers at once and uploads the files in
// the background. Returns its answer (or an error) for whoever wants it.
export async function postHomeworkToTelegram(homeworkId, action = 'post') {
  try {
    const { data, error } = await supabase.functions.invoke('telegram-group-post', {
      body: { action, homework_id: homeworkId },
    })
    if (error) throw error
    return data
  } catch (err) {
    console.error('Could not post homework to Telegram:', err)
    return { ok: false, error: err?.message || 'failed' }
  }
}
