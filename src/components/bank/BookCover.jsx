import { useState } from 'react'
import { difficultyOf, peekPage, shortTitle } from '../../lib/pageBank'
import { qtypeLabel } from '../../lib/questionTypes'

/*
 * Shared look for the Practice Bank and the page picker (2026-11-05):
 * book-cover cards for each set, and one page row with its marks
 * (given to the group, easy / medium / hard) and a quick peek at the
 * passage's first lines.
 */

// Fixed deep shades (the theme's skill colours turn pastel in dark mode).
export const COVER = {
  reading: { shades: ['#13807c', '#0e6a73', '#1b7f62', '#176a8a'] },
  listening: { shades: ['#1f4e8c', '#2a5fa8', '#1d6a9a', '#38428f'] },
  writing: { shades: ['#9a5b12', '#b8641a', '#8a4d1f', '#a8702a'] },
}
export const skillShade = (skill, i = 0) => {
  const c = COVER[skill] || COVER.reading
  return c.shades[i % c.shades.length]
}

const CODES = {
  tfng: 'T / F / NG',
  ynng: 'Y / N / NG',
  matching_headings: 'Headings',
  note_completion: 'Notes',
  mcq_multi: 'Choose 2–3',
  mcq_single: 'A  B  C  D',
  flow_chart: 'Flow-chart',
  matching_features: 'Features',
  sentence_completion: 'Sentences',
  matching_sentence_endings: 'Endings',
  short_answer: 'Short answers',
  summary_completion: 'Summary',
  table_completion: 'Table',
  matching_info: 'Which para?',
}

// Big short name on a cover: "Part 2", "T / F / NG", "Summary + list".
export function coverCode(name, types) {
  const part = /Part\s*(\d)/i.exec(name)
  if (part) return `Part ${part[1]}`
  if (/word list/i.test(name)) return 'Summary + list'
  const list = [...(types || [])]
  if (list.length === 1 && CODES[list[0]]) return CODES[list[0]]
  const tail = name.split(' · ').pop()
  return tail.length > 14 ? tail.split(/\s+/).map((w) => w[0]).join('').slice(0, 4).toUpperCase() : tail
}

// "Thematic Reading · Note Completion" → { book, short }; listening parts
// get "Questions 11–20" underneath.
export function splitSet(name) {
  const cut = name.indexOf(' · ')
  const book = cut > 0 ? name.slice(0, cut) : ''
  const short = cut > 0 ? name.slice(cut + 3) : name
  const part = /Part\s*(\d)/i.exec(name)
  return { book, short, subtitle: part ? `Questions ${(part[1] - 1) * 10 + 1}–${part[1] * 10}` : short }
}

export function BookCoverCard({ name, types, count, skill, index, onClick, unit, footer, compact = false }) {
  const { subtitle } = splitSet(name)
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex flex-col overflow-hidden rounded-[20px] border border-line bg-panel text-left transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <span className={`relative flex items-end overflow-hidden px-4 ${compact ? 'h-[64px] pb-2.5' : 'h-[92px] pb-3'}`} style={{ backgroundColor: skillShade(skill, index) }}>
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-2 bg-black/15" />
        <span aria-hidden="true" className={`absolute -right-3 font-brand font-semibold leading-none text-white/10 ${compact ? '-top-3 text-[60px]' : '-top-5 text-[84px]'}`}>{count}</span>
        <span className={`relative font-brand font-semibold leading-none text-white ${compact ? 'text-[18px]' : 'text-[22px]'}`}>{coverCode(name, types)}</span>
      </span>
      <span className={`flex flex-1 flex-col gap-1.5 ${compact ? 'px-3.5 py-3' : 'p-4'}`}>
        <span className={`font-extrabold leading-snug text-paper ${compact ? 'text-[13px]' : 'text-[15px]'}`}>{subtitle}</span>
        <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-bold text-mist">
          <span>
            {count} {unit || (skill === 'listening' ? 'tests' : 'pages')}
          </span>
          {footer}
        </span>
      </span>
    </button>
  )
}

/*
 * One page in a list. `checked`/`onToggle` for picking; `given` is a list
 * of { key, label, cls } badges; `stat` the page's { tries, avg }.
 */
export function PageRow({ page, checked, onToggle, given = [], stat, showType = false, actions = null, onReport = null }) {
  const [peek, setPeek] = useState(null) // null | 'loading' | { title, sub, text }
  const diff = difficultyOf(stat)
  const togglePeek = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (peek) return setPeek(null)
    setPeek('loading')
    setPeek((await peekPage(page.url)) || { title: '', sub: '', text: 'Could not open this page.' })
  }
  return (
    <li className={`rounded-[14px] ${checked ? 'bg-brass/10 ring-1 ring-brass/50' : 'bg-panel'}`}>
      <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
        {onToggle && <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 shrink-0 accent-brass" aria-label={`Select ${page.title}`} />}
        <span className="w-8 shrink-0 text-[13px] font-extrabold text-mist">{page.position ?? ''}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-extrabold text-paper">{shortTitle(page.title)}</span>
          {showType && page.question_type && <span className="block truncate text-[11px] font-bold text-mist">{qtypeLabel(page.question_type)} · {splitSet(page.collection || '').book}</span>}
          {!showType && page.topic && <span className="block truncate text-[11px] font-bold text-mist">{page.topic}</span>}
        </span>
        {stat?.favs > 0 && (
          <span className="shrink-0 text-[11px] font-extrabold text-amber" title={`${stat.favs} student${stat.favs === 1 ? '' : 's'} starred it`}>
            ★ {stat.favs}
          </span>
        )}
        {diff && (
          <span className={`shrink-0 rounded-lg px-1.5 py-0.5 text-[11px] font-extrabold ${diff.cls}`} title={`${stat.tries} first tries · average ${stat.avg}%`}>
            {diff.label}
          </span>
        )}
        {given.length > 0 && (
          <span className="flex shrink-0 gap-1">
            {given.slice(0, 4).map((g) => (
              <span key={g.key} className={`grid h-6 min-w-6 place-items-center rounded-lg px-1 text-[11px] font-extrabold ${g.cls}`} title={g.title}>
                {g.label}
              </span>
            ))}
          </span>
        )}
        <button
          type="button"
          onClick={togglePeek}
          aria-expanded={Boolean(peek)}
          className="focus-ring shrink-0 rounded-[10px] px-2 py-1 text-[12px] font-extrabold text-mist hover:bg-panel-2 hover:text-paper"
          title="See the first lines"
        >
          {peek ? 'Hide' : 'Peek'}
        </button>
        {onReport && stat?.tries > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onReport(page)
            }}
            className="focus-ring shrink-0 rounded-[10px] px-2 py-1 text-[12px] font-extrabold text-paper-dim hover:bg-panel-2 hover:text-paper"
            title={`${stat.tries} first tries`}
          >
            Report
          </button>
        )}
        {actions}
      </label>
      {peek && (
        <div className="border-t border-line px-4 py-3 text-[13px] leading-relaxed text-paper-dim">
          {peek === 'loading' ? (
            'Opening…'
          ) : (
            <>
              {peek.title && <p className="font-extrabold text-paper">{peek.title}</p>}
              {peek.sub && <p className="text-xs italic text-mist">{peek.sub}</p>}
              <p className="mt-1">{peek.text}{peek.text?.length >= 260 ? '…' : ''}</p>
            </>
          )}
        </div>
      )}
    </li>
  )
}
