// Builds and downloads a plain .ics calendar file for a booked speaking
// exam slot — no external calendar API or library needed, .ics is just
// a small text format every calendar app (Google, Outlook, Apple)
// already knows how to open. Added 2026-09-25, one of the "next level"
// picks ("Calendar integration for speaking slots — an .ics file/link
// alongside push + Telegram").

function toIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

export function downloadSpeakingSlotIcs(slot, { summary, description } = {}) {
  const start = new Date(slot.scheduled_at)
  const end = new Date(start.getTime() + (Number(slot.duration_minutes) || 15) * 60 * 1000)
  const now = new Date()

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IELTS with Mr Ikromov//Mock Speaking Exam//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:speaking-slot-${slot.id}@ieltswithmrikromov.com`,
    `DTSTAMP:${toIcsDate(now)}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(summary || 'IELTS Speaking Mock Exam')}`,
  ]

  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`)
  if (slot.meeting_link) lines.push(`LOCATION:${escapeIcsText(slot.meeting_link)}`)

  lines.push('END:VEVENT', 'END:VCALENDAR')

  const icsContent = lines.join('\r\n')
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ielts-speaking-exam.ics'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
