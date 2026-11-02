import { qtypeLabel } from '../../lib/questionTypes'
import { tashkentDate } from '../../lib/courses'

/*
 * Monthly parent report (2026-11-02, migration_91) — shared pieces for the
 * teacher's "Monthly reports" window and the parent's report page.
 * `r` is the JSON from _month_report(): attendance, homework, scores,
 * coins, marathon_days, mocks, strong, weak, note.
 */

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr']

export function monthLabel(month, lang = 'en') {
  const [y, m] = String(month).split('-').map(Number)
  if (lang === 'uz') return `${UZ_MONTHS[m - 1]} ${y}`
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

// This month and the n-1 before it, as 'YYYY-MM-01' (Tashkent).
export function lastMonths(n = 6) {
  const [y, m] = tashkentDate().split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
  })
}

export function summarise(r) {
  const a = r?.attendance || {}
  const h = r?.homework || {}
  const came = (a.present || 0) + (a.late || 0)
  return {
    came,
    marked: a.marked || 0,
    absent: a.absent || 0,
    excused: a.excused || 0,
    attendancePct: a.marked ? Math.round((100 * came) / a.marked) : null,
    hwDone: h.done || 0,
    hwAssigned: h.assigned || 0,
    hwLate: h.late || 0,
    hwMissed: h.missed || 0,
    hwPct: h.assigned ? Math.round((100 * (h.done || 0)) / h.assigned) : null,
    avgPct: r?.scores?.avg_pct ?? null,
    tasks: r?.scores?.tasks || 0,
    coins: r?.coins || 0,
    marathon: r?.marathon_days || 0,
  }
}

export function pctTone(p) {
  if (p == null) return 'text-mist'
  if (p >= 80) return 'text-sage'
  if (p >= 60) return 'text-brass'
  return 'text-coral'
}

function Tile({ label, value, sub, tone = 'text-paper', tint = 'bg-panel-2/60' }) {
  return (
    <div className={`flex flex-col gap-1 rounded-[16px] px-4 py-3 ${tint}`}>
      <span className="text-[12px] font-extrabold uppercase tracking-[0.1em] text-mist">{label}</span>
      <span className={`font-brand text-[26px] font-semibold leading-none ${tone}`}>{value}</span>
      {sub && <span className="text-[12px] font-bold text-paper-dim">{sub}</span>}
    </div>
  )
}

// The full month card (parent page).
export function MonthReportCard({ r }) {
  const s = summarise(r)
  const mocks = r?.mocks || []
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Tile label="Lessons" value={s.marked ? `${s.came}/${s.marked}` : '—'} sub={!s.marked ? 'not marked yet' : s.came === s.marked ? 'came to every lesson' : [s.absent ? `${s.absent} missed` : null, s.excused ? `${s.excused} excused` : null].filter(Boolean).join(' · ') || `${s.marked - s.came} not attended`} tone={pctTone(s.attendancePct)} />
        <Tile label="Homework" value={s.hwAssigned ? `${s.hwDone}/${s.hwAssigned}` : '—'} sub={s.hwAssigned ? [s.hwLate ? `${s.hwLate} late` : null, s.hwMissed ? `${s.hwMissed} not done` : null].filter(Boolean).join(' · ') || 'all on time' : 'none set'} tone={pctTone(s.hwPct)} />
        <Tile label="Average score" value={s.avgPct != null ? `${s.avgPct}%` : '—'} sub={s.tasks ? `${s.tasks} tasks marked` : 'no tasks yet'} tone={pctTone(s.avgPct)} />
        <Tile label="Coins earned" value={s.coins} sub={s.marathon ? `${s.marathon} days of word practice` : 'for homework on time'} tone="text-amber" />
      </div>
      {mocks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[16px] bg-panel-2/60 px-4 py-3">
          <span className="text-[13px] font-extrabold text-paper-dim">Mock tests:</span>
          {mocks.map((m, i) => (
            <span key={i} className="rounded-xl bg-panel px-2.5 py-1 text-[13px] font-extrabold text-paper">
              {m.module ? m.module[0].toUpperCase() + m.module.slice(1) : 'Mock'} · band {Number(m.band).toFixed(1)}
            </span>
          ))}
        </div>
      )}
      {((r?.strong || []).length > 0 || (r?.weak || []).length > 0) && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-[16px] bg-reading-tint/60 px-4 py-3">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.1em] text-reading">Strong at</p>
            <p className="mt-1 text-sm font-bold text-paper">{(r.strong || []).map((x) => `${qtypeLabel(x.qtype)} (${x.pct}%)`).join(', ') || '—'}</p>
          </div>
          <div className="rounded-[16px] bg-urgent-tint/70 px-4 py-3">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.1em] text-coral">Working on</p>
            <p className="mt-1 text-sm font-bold text-paper">{(r.weak || []).map((x) => `${qtypeLabel(x.qtype)} (${x.pct}%)`).join(', ') || '—'}</p>
          </div>
        </div>
      )}
      {r?.note && (
        <div className="flex gap-3 rounded-[16px] border border-line bg-panel px-4 py-3">
          <img src="/mrikromov.jpg" alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.1em] text-mist">From Mr Ikromov</p>
            <p className="mt-0.5 whitespace-pre-line text-sm font-semibold text-paper">{r.note}</p>
          </div>
        </div>
      )}
    </div>
  )
}
