/*
 * Skill detection + skill colours for the "Study room" design
 * (2026-10-05). Every homework, result and chart is tagged with one
 * of the four IELTS skills (or vocabulary) and always drawn in that
 * skill's colour, so students learn the colours once and can read
 * any screen at a glance.
 *
 * Homeworks have no "skill" column, so the skill is worked out from
 * what we do know: Writing mocks are Writing, homeworks with speaking
 * recordings are Speaking, and otherwise the title is matched against
 * the usual IELTS words. Anything unrecognised is "general".
 */

export const SKILLS = {
  listening: {
    key: 'listening',
    label: 'Listening',
    text: 'text-listening',
    bg: 'bg-listening',
    tint: 'bg-listening-tint',
  },
  reading: {
    key: 'reading',
    label: 'Reading',
    text: 'text-reading',
    bg: 'bg-reading',
    tint: 'bg-reading-tint',
  },
  writing: {
    key: 'writing',
    label: 'Writing',
    text: 'text-writing',
    bg: 'bg-writing',
    tint: 'bg-writing-tint',
  },
  speaking: {
    key: 'speaking',
    label: 'Speaking',
    text: 'text-speaking',
    bg: 'bg-speaking',
    tint: 'bg-speaking-tint',
  },
  vocab: {
    key: 'vocab',
    label: 'Vocabulary',
    text: 'text-vocab',
    bg: 'bg-vocab',
    tint: 'bg-vocab-tint',
  },
  general: {
    key: 'general',
    label: 'Homework',
    text: 'text-paper',
    bg: 'bg-paper',
    tint: 'bg-panel-2',
  },
}

const PATTERNS = [
  ['listening', /\blisten|\baudio\b|\bpart [1-4]\b.*\blisten/i],
  ['speaking', /\bspeak|\bcue card|\bpart 2\b.*\bdescribe|\brecord/i],
  ['writing', /\bwrit|\btask ?[12]\b|\bessay|\bletter\b|\bgraph\b|\bchart\b|\bdiagram\b/i],
  ['reading', /\bread|\bpassage|\bheadings?\b|\btrue\b.*\bfalse|\btfng\b/i],
  ['vocab', /\bvocab|\bwords?\b|\bword ?list|\bcollocation|\bidiom|\bphrasal/i],
]

export function skillOfHomework(homework) {
  if (!homework) return SKILLS.general
  if (homework.homework_type === 'writing_mock') return SKILLS.writing
  if (homework.enable_speaking) return SKILLS.speaking
  const text = `${homework.title || ''} ${homework.description || ''}`
  for (const [key, re] of PATTERNS) {
    if (re.test(text)) return SKILLS[key]
  }
  return SKILLS.general
}

export function skillOfModule(module) {
  return SKILLS[module] || SKILLS.general
}

/*
 * Where a homework stands for this student. `submission.status` is
 * 'done' once something was sent; 'pending' rows are empty
 * placeholders (e.g. after a teacher reset), so they count as not
 * started.
 */
export function homeworkState(homework, submission, now = new Date()) {
  const sent = submission?.status === 'done'
  const due = homework?.due_date ? new Date(homework.due_date) : null
  const reviewedBand = submission?.examiner_band
  if (sent && reviewedBand != null) return { key: 'marked', label: `Band ${Number(reviewedBand).toFixed(1)}` }
  if (sent && submission?.examiner_reviewed_at) return { key: 'marked', label: 'Marked' }
  if (sent) {
    const late = due && submission?.submitted_at && new Date(submission.submitted_at) > due
    return late ? { key: 'late', label: 'Sent late' } : { key: 'sent', label: 'Sent' }
  }
  if (due && due < now) return { key: 'overdue', label: 'Missed' }
  if (due && isSameDay(due, now)) return { key: 'today', label: 'Due today' }
  return { key: 'todo', label: 'To do' }
}

export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatDue(dateValue, now = new Date()) {
  if (!dateValue) return 'No deadline'
  const d = new Date(dateValue)
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (isSameDay(d, now)) return `Today, ${time}`
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (isSameDay(d, tomorrow)) return `Tomorrow, ${time}`
  const diffDays = (d - now) / 86400000
  if (diffDays > 0 && diffDays < 6) {
    return d.toLocaleDateString('en-GB', { weekday: 'long' })
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/* Pill classes per state, shared by Home and Homework. */
export const STATE_PILL = {
  today: 'bg-urgent-tint text-urgent',
  overdue: 'bg-urgent-tint text-urgent',
  todo: 'bg-panel-2 text-paper',
  sent: 'bg-panel text-paper-dim ring-1 ring-inset ring-line',
  late: 'bg-vocab-tint text-vocab',
  marked: 'bg-brass text-onbrass',
}
