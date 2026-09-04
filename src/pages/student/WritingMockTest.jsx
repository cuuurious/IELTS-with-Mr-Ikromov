import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DEFAULT_TIME_LIMITS,
  MIN_WORDS,
  TASK_MODE_LABELS,
  countWords,
  secondsRemaining,
  formatClock,
} from '../../lib/writingMock'
import ConfirmModal from '../../components/ConfirmModal'

const FULL_TASK_ORDER = ['task1', 'task2']
const AUTOSAVE_MS = 5000

// The full-screen, timed writing environment itself. Everything about
// PERSISTING the essay (autosave / final submit) is delegated back up
// to HomeworkCard via onAutosave/onSubmit — this component only owns
// the clock, the paste-blocking textarea(s), the word counts, and the
// quiet tab/fullscreen integrity log. HomeworkCard already has all the
// submission-upsert / completion-record / AI-evaluation machinery, so
// this deliberately doesn't duplicate any of that.
export default function WritingMockTest({
  homework,
  submission,
  onAutosave,
  onSubmit,
  onClose,
}) {
  // The Task 1 chart image is deliberately shown small and inline
  // (that's the whole point of it living here instead of a separate
  // tab) — but small enough to read a prompt paragraph next to it is
  // often too small to actually read the chart's numbers. This lets a
  // click blow it up in place, without ever leaving this window.
  const [imageLightboxOpen, setImageLightboxOpen] = useState(false)

  const mockEssay = submission?.mock_essay || {}

  const timeLimitMinutes =
    mockEssay.time_limit_minutes ||
    homework.mock_time_limit_minutes ||
    DEFAULT_TIME_LIMITS[homework.mock_task_mode] ||
    40

  const tasks = useMemo(() => {
    if (homework.mock_task_mode === 'full') return FULL_TASK_ORDER
    return [homework.mock_task_mode]
  }, [homework.mock_task_mode])

  const [activeTask, setActiveTask] = useState(tasks[0])

  const [texts, setTexts] = useState({
    task1: mockEssay.task1_text || '',
    task2: mockEssay.task2_text || '',
  })

  const [remaining, setRemaining] = useState(() =>
    secondsRemaining(mockEssay.started_at, timeLimitMinutes)
  )

  const [submitting, setSubmitting] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)

  // Latest values, readable from inside the interval/listeners set up
  // once below without them closing over stale state.
  const textsRef = useRef(texts)
  textsRef.current = texts

  const tabSwitchCountRef = useRef(mockEssay.tab_switch_count || 0)
  const submittedRef = useRef(false)
  const submittingRef = useRef(false)
  const startedAtRef = useRef(mockEssay.started_at)

  /* ============================================================
     SUBMIT (manual button, or automatic when time runs out — same
     path either way, so both always save the same shape of data).
  ============================================================ */

  const finishTest = async ({ auto = false } = {}) => {
    if (submittedRef.current || submittingRef.current) return

    submittingRef.current = true
    setSubmitting(true)

    try {
      await onSubmit({
        task1_text: textsRef.current.task1,
        task2_text: textsRef.current.task2,
        tab_switch_count: tabSwitchCountRef.current,
        auto_submitted: auto,
      })

      submittedRef.current = true
    } catch (err) {
      // Leave submittedRef false so a retry (the next timer tick, if
      // time is already up, or another click of Submit Now) can try
      // again instead of getting silently stuck.
      console.error('Mock test submit failed:', err)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  /* ============================================================
     COUNTDOWN — also the thing that triggers auto-submit, so a
     failed auto-submit (a network hiccup right as time expired)
     naturally retries on the very next tick instead of getting
     stuck forever once `remaining` stops changing.
  ============================================================ */

  useEffect(() => {
    const tick = () => {
      const left = secondsRemaining(startedAtRef.current, timeLimitMinutes)
      setRemaining(left)

      if (left <= 0 && !submittedRef.current && !submittingRef.current) {
        finishTest({ auto: true })
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLimitMinutes])

  /* ============================================================
     AUTOSAVE — every few seconds while the window is open, so the
     teacher's already-open review panel (it subscribes to realtime
     updates) sees near-live progress, and a crash/reload loses at
     most a few seconds of typing.
  ============================================================ */

  useEffect(() => {
    const id = setInterval(() => {
      if (submittedRef.current) return

      onAutosave({
        task1_text: textsRef.current.task1,
        task2_text: textsRef.current.task2,
        tab_switch_count: tabSwitchCountRef.current,
      })

      setLastSavedAt(new Date())
    }, AUTOSAVE_MS)

    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ============================================================
     "ARE YOU SURE?" WARNING ON CLOSE/REFRESH
  ============================================================ */

  useEffect(() => {
    const handler = (e) => {
      if (submittedRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  /* ============================================================
     QUIET INTEGRITY LOG — leaving this tab/window during the test.
     Never shown to or blocked for the student here; saved for the
     teacher to see alongside the submission afterwards as context,
     not as proof of anything.

     Deliberately NOT using the real Fullscreen API for this. It was
     tried, but most browsers force-exit fullscreen the instant a
     student switches tabs — which made the writing window visually
     look like it had closed (the browser's own address bar/tabs
     reappearing), even though the app itself hadn't changed anything
     and no work was lost. Window focus + tab visibility give the same
     signal without that side effect, so the window never appears to
     close on its own — it only ever closes via Minimize or Submit.

     Both listeners feed one shared "away" flag rather than each
     counting independently, so a single tab-switch (which usually
     fires both a blur AND a visibility change together) is logged
     once, not twice.
  ============================================================ */

  useEffect(() => {
    let away = false

    const markAway = () => {
      if (!away && !submittedRef.current) {
        away = true
        tabSwitchCountRef.current += 1
      }
    }

    const markBack = () => {
      away = false
    }

    const onVisibility = () => {
      if (document.hidden) markAway()
      else markBack()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', markAway)
    window.addEventListener('focus', markBack)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', markAway)
      window.removeEventListener('focus', markBack)
    }
  }, [])

  /* ============================================================
     MANUAL SUBMIT — warns about a short answer, and about the
     irreversibility, before actually finishing the test.
  ============================================================ */

  const handleManualSubmit = () => {
    const short = tasks.filter(
      (t) => MIN_WORDS[t] && countWords(texts[t]) < MIN_WORDS[t]
    )

    if (short.length) {
      setConfirmDialog({
        title: 'Short on words',
        points: short.map(
          (t) =>
            `${TASK_MODE_LABELS[t]}: ${countWords(texts[t])} words (IELTS recommends at least ${MIN_WORDS[t]})`
        ),
        message: 'You can still submit as-is, or go back and keep writing.',
        confirmLabel: 'Submit anyway',
        cancelLabel: 'Keep writing',
        tone: 'coral',
        onConfirm: () => finishTest({ auto: false }),
      })
      return
    }

    setConfirmDialog({
      title: 'Submit your mock test?',
      message: "You won't be able to make further changes after this.",
      confirmLabel: 'Submit Now',
      cancelLabel: 'Keep writing',
      onConfirm: () => finishTest({ auto: false }),
    })
  }

  const handleMinimize = () => {
    setConfirmDialog({
      title: 'Hide the writing window?',
      message:
        'The timer keeps running in the background. Reopen it anytime with "Resume Mock Test" on the homework — it opens straight back up, no need to confirm again.',
      confirmLabel: 'Minimize',
      cancelLabel: 'Stay here',
      onConfirm: () => {
        onAutosave({
          task1_text: textsRef.current.task1,
          task2_text: textsRef.current.task2,
          tab_switch_count: tabSwitchCountRef.current,
        })

        onClose()
      },
    })
  }

  const blockPaste = (e) => {
    e.preventDefault()
  }

  const timeUp = remaining <= 0

  const modal = (
    <div className="fixed inset-0 z-[99999] flex flex-col bg-panel">

      {/* HEADER */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="font-display text-lg text-paper truncate">
            {homework.title}
          </div>

          <span className="shrink-0 text-xs font-mono text-mist">
            {TASK_MODE_LABELS[homework.mock_task_mode] || 'Writing mock'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div
            className={`font-mono text-lg tabular-nums px-3 py-1 rounded-md border ${
              remaining <= 60
                ? 'border-coral text-coral animate-pulse'
                : remaining <= 300
                ? 'border-amber text-amber'
                : 'border-line text-paper'
            }`}
          >
            {formatClock(remaining)}
          </div>

          <button
            type="button"
            onClick={handleMinimize}
            disabled={submitting}
            className="focus-ring text-xs text-mist hover:text-paper disabled:opacity-40"
          >
            Minimize
          </button>
        </div>
      </div>

      {/* TASK TABS — full mode only */}
      {tasks.length > 1 && (
        <div className="shrink-0 flex gap-2 border-b border-line bg-panel-2 px-4 py-2 sm:px-6">
          {tasks.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTask(t)}
              className={`focus-ring px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTask === t
                  ? 'bg-brass text-onbrass'
                  : 'text-mist hover:text-paper'
              }`}
            >
              {TASK_MODE_LABELS[t]} · {countWords(texts[t])} words
            </button>
          ))}
        </div>
      )}

      {/* BODY */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex h-full max-w-4xl flex-col gap-4">
          {tasks.map((t) => {
            if (t !== activeTask) return null

            const prompt =
              t === 'task1' ? homework.mock_task1_prompt : homework.mock_task2_prompt

            const image = t === 'task1' ? homework.mock_task1_image_url : null

            const words = countWords(texts[t])
            const min = MIN_WORDS[t]
            const under = min && words < min

            return (
              <div key={t} className="flex min-h-0 flex-1 flex-col gap-3">
                {(prompt || image) && (
                  <div className="shrink-0 rounded-lg border border-line bg-panel-2 p-4">
                    {prompt && (
                      <p className="text-sm text-paper-dim whitespace-pre-wrap">
                        {prompt}
                      </p>
                    )}

                    {image && (
                      <button
                        type="button"
                        onClick={() => setImageLightboxOpen(true)}
                        className="focus-ring mt-3 block cursor-zoom-in"
                        title="Click to enlarge"
                      >
                        <img
                          src={image}
                          alt={`${TASK_MODE_LABELS[t]} chart`}
                          className="max-h-72 w-auto rounded-md border border-line object-contain"
                        />
                      </button>
                    )}
                  </div>
                )}

                {image && imageLightboxOpen && createPortal(
                  <div
                    className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80 p-6"
                    onClick={() => setImageLightboxOpen(false)}
                  >
                    <img
                      src={image}
                      alt={`${TASK_MODE_LABELS[t]} chart, enlarged`}
                      className="max-h-full max-w-full rounded-lg border border-line object-contain"
                    />

                    <button
                      type="button"
                      onClick={() => setImageLightboxOpen(false)}
                      className="focus-ring absolute top-5 right-5 w-10 h-10 rounded-full bg-panel border border-line text-paper flex items-center justify-center hover:border-brass hover:text-brass transition"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>,
                  document.body
                )}

                <textarea
                  value={texts[t]}
                  onChange={(e) =>
                    setTexts((prev) => ({ ...prev, [t]: e.target.value }))
                  }
                  onPaste={blockPaste}
                  onDrop={blockPaste}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={submitting || timeUp}
                  placeholder={`Write your ${TASK_MODE_LABELS[t]} answer here…`}
                  className="focus-ring flex-1 min-h-[280px] resize-none bg-panel-2 border border-line rounded-lg px-4 py-3 text-sm leading-6 text-paper"
                  spellCheck={false}
                />

                <div className="shrink-0 flex items-center justify-between text-xs">
                  <span className={under ? 'text-coral font-medium' : 'text-mist'}>
                    {words} word{words === 1 ? '' : 's'}
                    {min ? ` · minimum ${min}` : ''}
                  </span>

                  {lastSavedAt && (
                    <span className="text-mist font-mono">
                      saved {lastSavedAt.toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* FOOTER */}
      <div className="shrink-0 flex items-center justify-between gap-3 border-t border-line bg-panel px-4 py-3 sm:px-6">
        <p className="text-xs text-mist">
          Pasting is disabled — type your answer directly. Your work is saved automatically.
        </p>

        <button
          type="button"
          onClick={handleManualSubmit}
          disabled={submitting}
          className="focus-ring px-5 py-2.5 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40"
        >
          {submitting ? 'Submitting…' : 'Submit Now'}
        </button>
      </div>

      {timeUp && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
          <div className="rounded-2xl border border-line bg-panel px-8 py-6 text-center">
            <div className="font-display text-xl text-paper">Time's up</div>

            <p className="mt-2 text-sm text-mist">
              {submitting || submittingRef.current
                ? 'Submitting your answer…'
                : 'Your answer is being submitted.'}
            </p>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmDialog)}
        {...confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const run = confirmDialog?.onConfirm
          setConfirmDialog(null)
          run?.()
        }}
      />
    </div>
  )

  return createPortal(modal, document.body)
}
