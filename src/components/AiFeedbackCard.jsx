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

        <div className="rounded-2xl border border-line bg-panel-2 px-4 py-4 text-sm text-mist">
          🤖 The AI is reading this submission now — this usually takes
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

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
            AI evaluation
          </div>
        </div>

        {onReEvaluate && (
          <button
            type="button"
            onClick={onReEvaluate}
            disabled={reEvaluating}
            className="focus-ring text-xs text-mist hover:text-paper disabled:opacity-50"
          >
            {reEvaluating ? 'Re-running…' : 'Re-run'}
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-panel-2 px-5 py-5 flex flex-col gap-4">

        {/* OVERALL BAND */}
        <div className="flex items-center gap-4">
          <div className="shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-2xl bg-brass text-onbrass">
            <span className="font-display text-2xl leading-none">
              {formatBand(result.overall_band)}
            </span>
            <span className="text-[9px] font-mono uppercase tracking-wide opacity-80">
              band
            </span>
          </div>

          {result.summary && (
            <p className="text-sm text-paper-dim leading-6">
              {result.summary}
            </p>
          )}
        </div>

        {/* PER-CRITERION BANDS */}
        {Array.isArray(result.criteria) && result.criteria.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-2">
            {result.criteria.map((criterion, i) => (
              <div
                key={`${criterion.name}-${i}`}
                className="rounded-xl border border-line bg-panel px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-paper">
                    {criterion.name}
                  </span>
                  <span className="text-xs font-mono text-brass shrink-0">
                    {formatBand(criterion.band)}
                  </span>
                </div>

                {criterion.comment && (
                  <p className="mt-1 text-xs text-mist leading-5">
                    {criterion.comment}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* STRENGTHS */}
        {Array.isArray(result.strengths) && result.strengths.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-mist font-mono mb-1.5">
              What's working
            </div>

            <div className="flex flex-col gap-1">
              {result.strengths.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-paper-dim">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-sage shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* IMPROVEMENTS */}
        {Array.isArray(result.improvements) && result.improvements.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-mist font-mono mb-1.5">
              To improve
            </div>

            <div className="flex flex-col gap-1">
              {result.improvements.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-paper-dim">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-amber shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {submission.ai_evaluated_at && (
          <div className="text-[10px] font-mono text-mist">
            Evaluated{' '}
            {new Date(submission.ai_evaluated_at).toLocaleString()}
          </div>
        )}

      </div>
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
