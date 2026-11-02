import { SkillIcon } from '../SkillArt'
import { TASK_KINDS } from '../../lib/homeworkTasks'

/*
 * Full-screen page a homework task opens in (2026-11-02): the blue band
 * at the top with the task's skill tile and name, a close button, and
 * the task underneath. Tests themselves use the real-exam screen.
 */
export default function TaskShell({ kind, title, subtitle, onClose, children, wide = false }) {
  const meta = TASK_KINDS[kind] || TASK_KINDS.reading
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-ink">
      <div className="registan-band relative overflow-hidden px-4 pb-16 pt-5 text-white sm:px-8">
        <div className={`mx-auto flex items-center gap-3 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15" aria-hidden="true">
            <SkillIcon skill={meta.skill} className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">{meta.label}</p>
            <h1 className="truncate font-brand text-[20px] font-semibold text-white sm:text-[24px]">{title}</h1>
            {subtitle && <p className="truncate text-[13px] font-semibold text-white/80">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-white/15 text-white transition hover:bg-white/25"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
      <div className={`relative mx-auto -mt-10 px-4 pb-16 sm:px-8 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>{children}</div>
    </div>
  )
}

export function Panel({ className = '', children }) {
  return <div className={`rounded-[20px] border border-line bg-panel p-5 sm:p-6 ${className}`}>{children}</div>
}

export function BandRing({ value, max = 9, label = 'band', tone = '#2456b0', size = 112 }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, Number(value) / max))
  const r = size / 2 - 9
  const c = 2 * Math.PI * r
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="9" className="text-panel-2" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="absolute text-center leading-none">
        <div className="font-brand text-[28px] font-semibold text-paper">{value ?? '—'}</div>
        <div className="mt-1 text-[11px] font-extrabold uppercase tracking-wide text-mist">{label}</div>
      </div>
    </div>
  )
}
