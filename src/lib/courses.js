/*
 * Course plans (migration_88, 2026-11-02): small helpers shared by the
 * teacher's plan editor, the group's course panel and the student's
 * "My course" card.
 */
export const WEEKDAYS = [
  { n: 1, short: 'Mon' },
  { n: 2, short: 'Tue' },
  { n: 3, short: 'Wed' },
  { n: 4, short: 'Thu' },
  { n: 5, short: 'Fri' },
  { n: 6, short: 'Sat' },
  { n: 7, short: 'Sun' },
]

// PDFs open as they are; PowerPoint files open in Microsoft's free viewer.
export function slidesHref(url, name = '') {
  if (!url) return null
  const s = `${name} ${url}`.toLowerCase()
  if (/\.(pptx?|ppsx?|docx?|xlsx?)(\?|$|\s)/.test(s)) return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`
  return url
}

// "Wed 2 Nov, 15:00" in Tashkent time.
export function lessonTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })
}

export function lessonDay(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Tashkent' })
}

export function hhmm(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })
}

// "2026-11-02" for <input type="date"> (Tashkent).
export function tashkentDate(d = new Date()) {
  return new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10)
}

// datetime-local value for an ISO time, in the browser's own zone (the
// homework form works in local time).
export function toLocalInput(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
