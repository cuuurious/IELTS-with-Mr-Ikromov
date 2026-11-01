import Icon from './Icon'
/*
 * Shows the AI's band score + feedback for one submission — used by
 * both HomeworkCard.jsx (student view) and SubmissionPanel.jsx
 * (teacher view), so the two always render the same result the same
 * way.
 *
 * Renders nothing at all when there's simply no AI result yet (the
 * homework doesn't have AI grading turned on, or nothing has been
 * submitted) — callers don't need to gate on that themselves.
 *
 * Props:
 *   submission     - the submissions row (reads ai_status / ai_result
 *                     / ai_error / ai_evaluated_at off of it).
 *   onReEvaluate   - optional. When given, a "Re-run AI evaluation"
 *                     control is shown (teacher-only use — students
 *                     don't get to re-trigger it).
 *   reEvaluating   - optional bool, disables/labels the button above
 *                     while a re-run is in flight.
 */
export default function AiFeedbackCard({
  submission,
  onReEvaluate,
  reEvaluating = false,
}) {
  const status = submission?.ai_status

  if (!status) return null

  if (status === 'processing') {
    return (
      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            AI evaluation
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-panel-2 px-4 py-4 text-sm text-paper-dim">
          <Icon name="robot" className="h-4 w-4" /> The AI is reading this submission now — this usually takes
          under a minute.
        </div>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-coral" />
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-coral">
            AI evaluation
          </div>
        </div>

        <div className="rounded-2xl border border-coral/40 bg-coral/5 px-4 py-4">
          <p className="text-sm text-coral">
            {submission.ai_error ||
              "The AI couldn't evaluate this submission."}
          </p>

          {onReEvaluate && (
            <button
              type="button"
              onClick={onReEvaluate}
              disabled={reEvaluating}
              className="focus-ring mt-3 text-xs px-3 py-1.5 rounded-md border border-line text-mist hover:text-paper disabled:opacity-50"
            >
              {reEvaluating ? 'Retrying…' : 'Try again'}
            </button>
          )}
        </div>
      </section>
    )
  }

  const result = submission.ai_result

  if (status !== 'done' || !result) return null

  const band = typeof result.overall_band === 'number' ? result.overall_band : null
  const criteria = Array.isArray(result.criteria) ? result.criteria : []
  const strengths = Array.isArray(result.strengths) ? result.strengths : []
  const improvements = Array.isArray(result.improvements) ? result.improvements : []
  const grammar = Array.isArray(result.grammar_structures) ? result.grammar_structures : []
  const collocations = Array.isArray(result.useful_collocations) ? result.useful_collocations : []
  const CRIT_TONES = [
    'bg-listening-tint text-listening',
    'bg-reading-tint text-reading',
    'bg-writing-tint text-writing',
    'bg-speaking-tint text-speaking',
  ]

  return (
    <section className="flex flex-col gap-3">
      {/* Header (redesign 2026-11-02): band ring + summary on the band. */}
      <div className="registan-band relative overflow-hidden rounded-[22px] px-5 py-5 sm:px-6">
        <div className="pointer-events-none absolute -bottom-8 right-10 h-24 w-16 rounded-[999px_999px_0_0] bg-white/10" aria-hidden="true" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.08em] text-white/90">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>
            AI evaluation
          </div>
          {onReEvaluate && (
            <button
              type="button"
              onClick={onReEvaluate}
              disabled={reEvaluating}
              className="focus-ring rounded-lg bg-white/15 px-2.5 py-1 text-xs font-extrabold text-white hover:bg-white/25 disabled:opacity-50"
            >
              {reEvaluating ? 'Re-running…' : 'Re-run'}
            </button>
          )}
        </div>
        <div className="relative mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          {band != null && (
            <div className="relative grid h-24 w-24 shrink-0 place-items-center" aria-label={`Band ${formatBand(band)}`}>
              <svg className="absolute inset-0" viewBox="0 0 96 96" aria-hidden="true">
                <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="9" />
                <circle cx="48" cy="48" r="40" fill="none" stroke="var(--color-saffron)" strokeWidth="9" strokeLinecap="round" strokeDasharray={2 * Math.PI * 40} strokeDashoffset={2 * Math.PI * 40 * (1 - Math.min(1, band / 9))} transform="rotate(-90 48 48)" />
              </svg>
              <div className="text-center text-white">
                <div className="font-brand text-[26px] font-bold leading-none">{formatBand(band)}</div>
                <div className="mt-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white/80">band</div>
              </div>
            </div>
          )}
          {result.summary && <p className="text-[15px] leading-relaxed text-white/95">{result.summary}</p>}
        </div>
      </div>

      {criteria.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {criteria.map((criterion, i) => {
            const tone = CRIT_TONES[i % CRIT_TONES.length]
            const cb = typeof criterion.band === 'number' ? criterion.band : null
            return (
              <div key={`${criterion.name}-${i}`} className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-extrabold text-paper">{criterion.name}</span>
                  {cb != null && (
                    <span className={`shrink-0 rounded-xl px-2.5 py-1 font-brand text-[15px] font-semibold ${tone}`}>{formatBand(cb)}</span>
                  )}
                </div>
                {cb != null && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
                    <div className={`h-full rounded-full ${tone.split(' ')[1].replace('text-', 'bg-')}`} style={{ width: `${Math.min(100, (cb / 9) * 100)}%` }} />
                  </div>
                )}
                {criterion.comment && <p className="text-[13px] leading-6 text-paper-dim">{criterion.comment}</p>}
              </div>
            )
          })}
        </div>
      )}

      {(strengths.length > 0 || improvements.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {strengths.length > 0 && (
            <div className="rounded-[20px] bg-reading-tint p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-extrabold text-reading">
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-reading text-white" aria-hidden="true">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M4 12l5 5L20 6" /></svg>
                </span>
                What's working
              </div>
              <ul className="flex flex-col gap-1.5">
                {strengths.map((item, i) => (
                  <li key={i} className="text-[13px] leading-6 text-paper">{item}</li>
                ))}
              </ul>
            </div>
          )}
          {improvements.length > 0 && (
            <div className="rounded-[20px] bg-[color-mix(in_srgb,var(--color-saffron)_16%,var(--color-panel))] p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-extrabold text-amber">
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-saffron text-[#17213a]" aria-hidden="true">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </span>
                To improve
              </div>
              <ul className="flex flex-col gap-1.5">
                {improvements.map((item, i) => (
                  <li key={i} className="text-[13px] leading-6 text-paper">{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {[
        ['Grammar to practise', grammar, 'bg-listening text-white', 'G'],
        ['Collocations to use', collocations, 'bg-speaking text-white', 'C'],
      ].map(([title, items, chip, letter]) =>
        items.length > 0 ? (
          <div key={title} className="rounded-[20px] border border-line bg-panel p-4">
            <div className="mb-3 text-sm font-extrabold text-paper">{title}</div>
            <div className="flex flex-col gap-2.5">
              {items.map((item, i) => (
                <div key={i} className="flex gap-3">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg font-brand text-xs font-bold ${chip}`} aria-hidden="true">{letter}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-paper">{item.tip}</p>
                    {item.example && (
                      <p className="mt-1 rounded-xl bg-panel-2 px-3 py-2 text-[13px] italic text-paper-dim">“{item.example}”</p>
                    )}
                    {item.why && <p className="mt-1 text-xs text-mist">{item.why}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null
      )}

      {submission.ai_evaluated_at && (
        <div className="px-1 text-xs font-semibold text-mist">
          Evaluated {new Date(submission.ai_evaluated_at).toLocaleString()}
        </div>
      )}
    </section>
  )
}

function formatBand(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—'

  // Bands are normally in .0/.5 steps — round to the nearest half so
  // a slightly-off model response (e.g. 6.3) still reads naturally.
  const rounded = Math.round(value * 2) / 2

  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}
