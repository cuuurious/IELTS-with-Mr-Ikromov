import { useState } from 'react'

/*
 * Reading explanations (English / Uzbek / Russian) and Listening transcripts,
 * shown to a student only inside their released results review
 * (migration_130: the text lives in its own tables and arrives through
 * get_mock_answer_breakdown, which already refuses unreleased attempts).
 */

export function Explanation({ en, uz, ru }) {
  const langs = [
    ['en', 'English', en],
    ['uz', 'Oʻzbekcha', uz],
    ['ru', 'Русский', ru],
  ].filter((l) => l[2])
  const [lang, setLang] = useState(langs[0]?.[0])
  if (!langs.length) return null
  const current = langs.find((l) => l[0] === lang) || langs[0]
  return (
    <div className="mt-2.5 rounded-xl border border-line bg-ink/30 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-mist">Why</span>
        {langs.length > 1 &&
          langs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setLang(key)}
              className={`focus-ring rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                current[0] === key ? 'bg-brass text-onbrass' : 'bg-panel text-paper-dim hover:text-paper'
              }`}
            >
              {label}
            </button>
          ))}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-paper">{current[2]}</p>
    </div>
  )
}

export function Transcript({ lines }) {
  if (!Array.isArray(lines) || !lines.length) return null
  return (
    <details className="rounded-xl border border-line bg-panel px-3 py-2">
      <summary className="cursor-pointer select-none text-xs font-semibold text-brass">Show transcript</summary>
      <div className="mt-2 flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1 text-sm leading-relaxed text-paper">
        {lines.map((l, i) => (
          <p key={i}>
            {l.sp && <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-mist">{l.sp}</span>}
            {l.tx}
          </p>
        ))}
      </div>
    </details>
  )
}
