import { isSameDay } from '../../lib/skills'
import { formatBand } from '../../lib/ieltsBands'

/*
 * Shared presentational pieces for the two examiner Home tabs
 * (WritingExaminerHome.jsx / SpeakingExaminerHome.jsx), 2026-10-07.
 * Same "Study room" language as TeacherHome.jsx: rounded-[22px] panels,
 * skill colours (writing = warm orange, speaking = lavender), sentence-
 * case labels, no uppercase mono eyebrows. Nothing here loads or edits
 * data — every number is worked out from rows the dashboard already has.
 */

export const DAY = 86400000

export function Card({ className = '', children, ...rest }) {
  return (
    <section className={`rounded-[22px] border border-line bg-panel ${className}`} {...rest}>
      {children}
    </section>
  )
}

export function Arrow({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function Avatar({ person, size = 'h-9 w-9', tone = 'bg-panel-2 text-paper-dim', className = '' }) {
  const name = person?.full_name || person?.username || '?'
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return person?.avatar_url ? (
    <img src={person.avatar_url} alt="" className={`${size} shrink-0 rounded-full object-cover ${className}`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${tone} ${className}`}>
      {initials}
    </span>
  )
}

export function greeting(now) {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function todayLabel(now) {
  return now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function timeAgo(value, now) {
  const mins = Math.max(0, Math.round((now - new Date(value)) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

// "2 days", "5 h", "20 min" — how long something has been waiting.
export function ageLabel(value, now) {
  const mins = Math.max(0, Math.round((now - new Date(value)) / 60000))
  if (mins < 60) return `${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day' : `${days} days`
}

export function startOfWeek(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - dow)
  return d
}

export function startOfMonth(now) {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

export function average(nums) {
  const clean = nums.filter((n) => n != null && !Number.isNaN(Number(n))).map(Number)
  if (!clean.length) return null
  return clean.reduce((s, n) => s + n, 0) / clean.length
}

// One decimal for averages ("6.3"), never the half-band rounding — an
// average of bands given is a statistic, not a band.
export function formatAvg(n) {
  return n == null ? '–' : n.toFixed(1)
}

/* Small empty state: icon tile + one line. */
export function EmptyNote({ icon, tone = 'bg-panel-2 text-mist', children, className = '' }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl bg-panel-2/60 px-4 py-4 ${className}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <p className="text-sm text-paper-dim">{children}</p>
    </div>
  )
}

/* Last-7-days bars (oldest first, today highlighted). */
export function DayBars({ days, now, strong, tint, label, className = 'h-[132px]' }) {
  const max = Math.max(1, ...days.map((d) => d.count))
  return (
    <div className={`flex items-stretch gap-2 ${className}`} role="img" aria-label={`${label}: ${days.map((d) => d.count).join(', ')}`}>
      {days.map((d) => (
        <div key={d.date.toISOString()} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex w-full flex-1 flex-col justify-end">
            <span className="mb-1 text-center text-[11px] font-medium tabular-nums text-mist">{d.count || ''}</span>
            <div
              className={`w-full rounded-t-lg ${isSameDay(d.date, now) ? strong : tint}`}
              style={{ height: `${Math.max(4, (d.count / max) * 82)}%` }}
            />
          </div>
          <span className={`text-[11px] ${isSameDay(d.date, now) ? 'font-semibold text-paper' : 'text-mist'}`}>
            {d.date.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function lastSevenDays(now, dates) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now)
    d.setDate(now.getDate() - (6 - i))
    return { date: d, count: dates.filter((v) => v && isSameDay(new Date(v), d)).length }
  })
}

/* Distribution of overall bands given, bucketed 4 (and below) … 9. */
export function BandDistribution({ bands, strong }) {
  const buckets = [4, 5, 6, 7, 8, 9].map((b) => ({
    band: b,
    count: bands.filter((v) => {
      const n = Math.floor(Number(v))
      return b === 4 ? n <= 4 : n === b
    }).length,
  }))
  const max = Math.max(1, ...buckets.map((b) => b.count))
  return (
    <div className="flex flex-col gap-1.5" role="img" aria-label={`Bands given: ${buckets.map((b) => `${b.band}: ${b.count}`).join(', ')}`}>
      {buckets.map((b) => (
        <div key={b.band} className="grid grid-cols-[40px_minmax(0,1fr)_28px] items-center gap-2.5 text-[13px]">
          <span className="text-mist tabular-nums">{b.band === 4 ? '≤ 4' : `${b.band}–${b.band}.5`.replace('9–9.5', '9')}</span>
          <span className="h-2.5 rounded-full bg-panel-2">
            {b.count > 0 && (
              <span className={`block h-full rounded-full ${strong}`} style={{ width: `${Math.max(6, (b.count / max) * 100)}%` }} />
            )}
          </span>
          <span className="text-right font-medium tabular-nums">{b.count}</span>
        </div>
      ))}
    </div>
  )
}

/* Four criteria averages as small tiles. */
export function CriteriaTiles({ items, tint, text }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {items.map((c) => (
        <div key={c.key} className={`flex flex-col gap-1 rounded-2xl px-3.5 py-3 ${tint}`}>
          <span className={`text-[13px] font-semibold ${text}`}>{c.short}</span>
          <span className="text-[22px] font-semibold leading-none tabular-nums">{formatAvg(c.avg)}</span>
          <span className="truncate text-[12px] text-paper-dim" title={c.label}>{c.label}</span>
        </div>
      ))}
    </div>
  )
}

/* A stat block: big number + label. */
export function Stat({ value, label, tone = 'text-paper' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={`text-[28px] font-semibold leading-none tabular-nums ${tone}`}>{value}</span>
      <span className="text-[13px] text-mist">{label}</span>
    </div>
  )
}

export function BandChip({ band, className = '' }) {
  return (
    <span className={`inline-flex h-7 items-center rounded-lg bg-reading-tint px-2.5 text-[13px] font-semibold tabular-nums text-reading ${className}`}>
      Band {formatBand(band)}
    </span>
  )
}

/* Marking reference card: the four criteria with a one-line descriptor. */
export function CriteriaGuide({ title, items, tint, text, footer }) {
  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        <span className="text-[13px] text-mist">Each criterion counts for a quarter of the band</span>
      </div>
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((c) => (
          <li key={c.key} className="flex gap-3 rounded-2xl bg-panel-2/70 p-3.5">
            <span className={`flex h-9 min-w-9 items-center justify-center rounded-xl px-1.5 text-[13px] font-semibold ${tint} ${text}`}>
              {c.short}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{c.label}</span>
              <span className="text-[13px] leading-snug text-paper-dim">{c.hint}</span>
            </span>
          </li>
        ))}
      </ul>
      {footer}
    </Card>
  )
}
