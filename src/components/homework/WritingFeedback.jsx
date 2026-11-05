import { useState } from 'react'
import { BandRing } from './TaskShell'
import { TeacherBandNote } from './TeacherBand'

/*
 * AI feedback on a Writing Task 1 / Task 2 page (2026-11-05). Shown to
 * the student right after handing in, and to the teacher in the
 * gradebook. results = the attempt's results ({ texts, check, ai }).
 */

const bandTone = (b) => (b == null ? 'text-mist' : b >= 7 ? 'text-reading' : b >= 5.5 ? 'text-listening' : 'text-coral')

export default function WritingFeedback({ results, teacher = false }) {
  const [tab, setTab] = useState('fix')
  const ai = results?.ai || null
  const essay = results?.texts?.[0]?.text || ''

  if (!ai) return results?.teacher && !teacher ? <TeacherBandNote teacher={results.teacher} /> : null
  if (ai.status === 'processing') {
    return (
      <section className="flex items-center gap-3 rounded-[20px] border border-line bg-panel p-5">
        <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-[3px] border-writing border-t-transparent" aria-hidden="true" />
        <p className="text-sm font-bold text-paper">Marking the {ai.task === 'task1' ? 'report' : 'essay'}… this takes about a minute.</p>
      </section>
    )
  }
  if (ai.status === 'error') {
    return <section className="rounded-[20px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">Marking did not finish: {ai.error}</section>
  }
  if (ai.status !== 'done') return results?.teacher && !teacher ? <TeacherBandNote teacher={results.teacher} /> : null

  const tabs = [
    ...(ai.corrections?.length ? [['fix', 'Fix these']] : []),
    ...(ai.better_version ? [['better', 'Band 8 version']] : []),
    ['mine', teacher ? 'The essay' : 'Your essay'],
    ...(ai.exercises?.length ? [['practice', 'Practice']] : []),
    ...(ai.useful_collocations?.length || ai.grammar_structures?.length ? [['language', 'Language']] : []),
  ]
  const current = tabs.some(([k]) => k === tab) ? tab : tabs[0][0]

  return (
    <div className="flex flex-col gap-4">
      {!teacher && <TeacherBandNote teacher={results?.teacher} />}
      <section className="flex flex-col gap-4 rounded-[20px] border border-line bg-panel p-4 sm:p-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <BandRing value={ai.overall_band != null ? Number(ai.overall_band).toFixed(1) : null} label="AI band" tone="#9a5b12" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="font-brand text-[19px] font-semibold text-paper">{teacher ? 'AI estimate' : `Your ${ai.task === 'task1' ? 'Task 1' : 'Task 2'} band`}</p>
            {ai.summary && <p className="text-[14px] leading-relaxed text-paper-dim">{ai.summary}</p>}
            <p className="text-[12px] font-semibold text-mist">
              {ai.words ? `${ai.words} words · ` : ''}An estimate from the AI. {teacher ? '' : 'Mr Ikromov reads your essay too.'}
            </p>
          </div>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {(ai.criteria || []).map((c) => (
            <li key={c.name} className="flex flex-col gap-1 rounded-[16px] bg-panel-2/70 p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[13px] font-extrabold text-paper">{c.name}</span>
                <span className={`font-brand text-[18px] font-semibold ${bandTone(c.band)}`}>{Number(c.band).toFixed(1)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-panel">
                <div className="h-full rounded bg-writing" style={{ width: `${Math.max(0, Math.min(100, (Number(c.band) / 9) * 100))}%` }} />
              </div>
              <p className="text-[13px] leading-relaxed text-paper-dim">{c.comment}</p>
            </li>
          ))}
        </ul>
        {(ai.strengths?.length > 0 || ai.improvements?.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {ai.strengths?.length > 0 && (
              <div className="rounded-[16px] bg-reading-tint/60 p-3">
                <p className="mb-1 text-[12px] font-extrabold uppercase tracking-wide text-reading">What went well</p>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-paper">{ai.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
            {ai.improvements?.length > 0 && (
              <div className="rounded-[16px] bg-urgent-tint/60 p-3">
                <p className="mb-1 text-[12px] font-extrabold uppercase tracking-wide text-coral">Work on</p>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-paper">{ai.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={current === k}
            onClick={() => setTab(k)}
            className={`focus-ring h-10 shrink-0 rounded-[12px] px-4 text-[13px] font-extrabold transition ${current === k ? 'bg-writing text-white' : 'bg-panel text-paper-dim hover:text-paper'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {current === 'fix' && (
        <ul className="flex flex-col gap-2.5">
          {ai.corrections.map((c, i) => (
            <li key={i} className="flex flex-col gap-1.5 rounded-[18px] border border-line bg-panel p-4">
              <p className="text-[14px] text-mist line-through decoration-coral/60">{c.original}</p>
              <p className="text-[15px] font-extrabold leading-snug text-paper">{c.better}</p>
              {c.why && <p className="text-[12px] font-bold text-writing">{c.why}</p>}
            </li>
          ))}
          {!teacher && <li className="px-1 text-[12px] font-semibold text-mist">Copy each better sentence into your notebook, then use the same pattern in your next essay.</li>}
        </ul>
      )}

      {current === 'better' && (
        <section className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4 sm:p-6">
          <p className="text-[12px] font-extrabold uppercase tracking-wide text-writing">{teacher ? 'The student’s ideas at Band 8' : 'Your ideas at Band 8'}</p>
          {ai.better_version.split(/\n\s*\n/).map((p, i) => (
            <p key={i} className="text-[15px] leading-7 text-paper">{p}</p>
          ))}
        </section>
      )}

      {current === 'mine' && (
        <section className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4 sm:p-6">
          {results?.check?.tot > 0 && (
            <p className="text-[12px] font-bold text-paper-dim">Page self-check: <b className="text-paper">{results.check.got}/{results.check.tot}</b> features of the sample answer</p>
          )}
          {essay.split(/\n\s*\n|\n/).filter((p) => p.trim()).map((p, i) => (
            <p key={i} className="text-[15px] leading-7 text-paper">{p}</p>
          ))}
        </section>
      )}

      {current === 'practice' && (
        <ul className="flex flex-col gap-3">
          {ai.exercises.map((ex, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
              <p className="font-brand text-[16px] font-semibold text-paper">{ex.title}</p>
              <p className="text-[13px] font-semibold text-paper-dim">{ex.instructions}</p>
              <ol className="flex flex-col gap-1.5">
                {(ex.items || []).map((it, j) => (
                  <li key={j} className="rounded-[12px] bg-panel-2/70 px-3 py-2 text-[14px] font-bold text-paper">{j + 1}. {it}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}

      {current === 'language' && (
        <ul className="flex flex-col gap-2">
          {[...(ai.useful_collocations || []), ...(ai.grammar_structures || [])].map((t, i) => (
            <li key={i} className="rounded-[16px] border border-line bg-panel px-4 py-3 text-[13px]">
              <p className="font-extrabold text-paper">{t.tip}</p>
              <p className="italic text-paper-dim">{t.example}</p>
              <p className="text-mist">{t.why}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
