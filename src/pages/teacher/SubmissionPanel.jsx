import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import AiFeedbackCard from '../../components/AiFeedbackCard'
import { countWords } from '../../lib/writingMock'

const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.5

export default function SubmissionPanel({
  studentName,
  homeworkTitle,
  submission,
  onClose,
}) {
  const [reEvaluating, setReEvaluating] = useState(false)

  /*
   * ============================================================
   * SCREENSHOT ZOOM VIEWER
   *
   * Clicking a submitted screenshot used to just open the raw image
   * in a new browser tab — no zoom, no controls, nothing. This is an
   * in-app viewer instead: a proper toolbar (not floating buttons on
   * top of the image itself, which can blend into whatever the
   * screenshot happens to show underneath — a dark browser window,
   * for instance) plus click/drag-to-pan once zoomed in.
   * ============================================================
   */

  const [previewIndex, setPreviewIndex] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef(null)

  const screenshotUrls = submission?.screenshot_urls || []
  const previewOpen = previewIndex !== null && screenshotUrls.length > 0

  const openPreview = (index) => {
    setPreviewIndex(index)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const closePreview = () => {
    setPreviewIndex(null)
  }

  const goToPreview = (index) => {
    const total = screenshotUrls.length
    setPreviewIndex(((index % total) + total) % total)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const zoomIn = () =>
    setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))

  const zoomOut = () =>
    setZoom((z) => {
      const next = Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))
      if (next === ZOOM_MIN) setPan({ x: 0, y: 0 })
      return next
    })

  const resetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleImageMouseDown = (e) => {
    if (zoom <= 1) return
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pan.x,
      originY: pan.y,
    }
    setIsDragging(true)
  }

  const handleImageMouseMove = (e) => {
    if (!dragRef.current) return
    setPan({
      x: dragRef.current.originX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.originY + (e.clientY - dragRef.current.startY),
    })
  }

  const stopDragging = () => {
    dragRef.current = null
    setIsDragging(false)
  }

  // Keyboard support only while the viewer is actually open — Escape
  // closes it, arrow keys page through the other screenshots so a
  // teacher can flip through a whole submission without reaching for
  // the mouse each time.
  useEffect(() => {
    if (!previewOpen) return

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        closePreview()
      } else if (e.key === 'ArrowLeft' && screenshotUrls.length > 1) {
        goToPreview(previewIndex - 1)
      } else if (e.key === 'ArrowRight' && screenshotUrls.length > 1) {
        goToPreview(previewIndex + 1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen, previewIndex])

  const reEvaluate = async () => {
    if (!submission?.id || reEvaluating) return

    setReEvaluating(true)

    try {
      const { error } = await supabase.functions.invoke('ai-grading', {
        body: { action: 'evaluate', submissionId: submission.id },
      })

      if (error) throw error
      // The result lands via realtime a few seconds later — see
      // GroupWorkspace.jsx's submissions subscription.
    } catch (err) {
      console.error('Re-run AI evaluation failed:', err)
    } finally {
      setReEvaluating(false)
    }
  }

  const modal = (
    <div
      className="fixed inset-0 z-[99999] flex h-screen w-screen items-center justify-center bg-black/60 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${studentName} submission`}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl"
      >
        {/* HEADER */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-5 sm:px-7">
          <div className="min-w-0">
            <div className="font-display text-xl font-semibold tracking-tight text-paper sm:text-2xl">
              {studentName}
            </div>

            <div className="mt-1 truncate text-sm text-mist">
              {homeworkTitle}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-lg leading-none text-mist transition hover:border-accent/40 hover:text-paper"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-7">
          <div className="space-y-6">

            {!submission && (
              <div className="rounded-2xl border border-line bg-panel-2 px-5 py-8 text-center">
                <div className="font-display text-lg font-semibold text-paper">
                  Nothing submitted yet
                </div>

                <p className="mt-2 text-sm text-mist">
                  This student has not submitted anything for this homework.
                </p>
              </div>
            )}

            {/* SCREENSHOTS */}
            {submission?.screenshot_urls?.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />

                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                    Screenshots
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {submission.screenshot_urls.map((url, i) => (
                    <button
                      key={url || i}
                      type="button"
                      onClick={() => openPreview(i)}
                      className="focus-ring group overflow-hidden rounded-2xl border border-line bg-panel-2 text-left transition hover:border-accent/40"
                    >
                      <img
                        src={url}
                        alt={`Screenshot ${i + 1}`}
                        className="aspect-square h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                      />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* UPLOADED FILES */}
            {submission?.submission_files?.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />

                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                    Uploaded files
                  </div>
                </div>

                <div className="grid gap-2">
                  {submission.submission_files.map((file, i) => (
                    <a
                      key={file?.url || i}
                      href={file?.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-2xl border border-line bg-panel-2 px-4 py-3 text-sm text-paper transition hover:border-accent/40 hover:bg-accent/5"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-base">
                        📎
                      </span>

                      <span className="min-w-0 truncate">
                        {file?.name || 'Uploaded file'}
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* WRITING MOCK TEST */}
            {submission?.mock_essay && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />

                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                    Writing mock test
                  </div>
                </div>

                <div className="flex flex-col gap-3 rounded-2xl border border-line bg-panel-2 p-4">

                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-mist">
                    {submission.mock_essay.time_limit_minutes && (
                      <span>{submission.mock_essay.time_limit_minutes} min limit</span>
                    )}

                    {submission.mock_essay.started_at && (
                      <span>started {new Date(submission.mock_essay.started_at).toLocaleString()}</span>
                    )}

                    {submission.mock_essay.auto_submitted && (
                      <span className="text-amber">auto-submitted — time ran out</span>
                    )}
                  </div>

                  {/* Teacher-only integrity context — never shown to
                      or used to block the student, just useful signal
                      alongside the essay itself. */}
                  {submission.mock_essay.tab_switch_count > 0 && (
                    <div className="rounded-xl border border-coral/30 bg-coral/5 px-3 py-2 text-xs text-coral">
                      Left this tab/window {submission.mock_essay.tab_switch_count} time
                      {submission.mock_essay.tab_switch_count === 1 ? '' : 's'} during the test.
                    </div>
                  )}

                  {submission.mock_essay.task1_text && (
                    <div className="rounded-xl border border-line bg-panel px-4 py-3">
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-mist">
                        Task 1 · {countWords(submission.mock_essay.task1_text)} words
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-paper-dim">
                        {submission.mock_essay.task1_text}
                      </p>
                    </div>
                  )}

                  {submission.mock_essay.task2_text && (
                    <div className="rounded-xl border border-line bg-panel px-4 py-3">
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-mist">
                        Task 2 · {countWords(submission.mock_essay.task2_text)} words
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-paper-dim">
                        {submission.mock_essay.task2_text}
                      </p>
                    </div>
                  )}

                </div>
              </section>
            )}

            {/* SPEAKING */}
            {[
              'audio_part1_url',
              'audio_part2_url',
              'audio_part3_url',
            ].map((key, i) =>
              submission?.[key] ? (
                <section key={key}>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />

                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                      Speaking — Part {i + 1}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-line bg-panel-2 p-4">
                    <audio
                      controls
                      src={submission[key]}
                      className="w-full"
                    />
                  </div>
                </section>
              ) : null
            )}

            {/* AI EVALUATION */}
            {submission && (
              <AiFeedbackCard
                submission={submission}
                onReEvaluate={reEvaluate}
                reEvaluating={reEvaluating}
              />
            )}

            {/* COMMENT */}
            {submission?.comment && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />

                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                    Student's comment
                  </div>
                </div>

                <div className="rounded-2xl border border-line bg-panel-2 px-4 py-4">
                  <p className="whitespace-pre-wrap text-sm leading-6 text-paper-dim">
                    {submission.comment}
                  </p>
                </div>
              </section>
            )}

            {/* SUBMITTED TIME */}
            {submission?.submitted_at && (
              <div className="border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-mist">
                Submitted{' '}
                {new Date(
                  submission.submitted_at
                ).toLocaleString()}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* SCREENSHOT ZOOM VIEWER */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-[100000] flex flex-col bg-black/90"
          onClick={closePreview}
        >
          {/* Toolbar — a solid, opaque bar rather than buttons
              floating directly on the image, so it always reads
              clearly no matter what the screenshot itself shows
              underneath (including another dark window). */}
          <div
            className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3 sm:px-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-mono text-xs text-mist">
              {screenshotUrls.length > 1
                ? `Screenshot ${previewIndex + 1} of ${screenshotUrls.length}`
                : 'Screenshot'}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={zoomOut}
                disabled={zoom <= ZOOM_MIN}
                title="Zoom out"
                aria-label="Zoom out"
                className="focus-ring flex h-8 w-8 items-center justify-center rounded-full border border-line bg-panel-2 text-mist transition hover:border-accent/40 hover:text-paper disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.35-4.35" />
                  <path d="M8 11h6" />
                </svg>
              </button>

              <button
                type="button"
                onClick={resetZoom}
                disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                className="focus-ring rounded-full border border-line bg-panel-2 px-3 py-1.5 font-mono text-xs text-mist transition hover:border-accent/40 hover:text-paper disabled:opacity-40"
              >
                {Math.round(zoom * 100)}% · Reset
              </button>

              <button
                type="button"
                onClick={zoomIn}
                disabled={zoom >= ZOOM_MAX}
                title="Zoom in"
                aria-label="Zoom in"
                className="focus-ring flex h-8 w-8 items-center justify-center rounded-full border border-line bg-panel-2 text-mist transition hover:border-accent/40 hover:text-paper disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.35-4.35" />
                  <path d="M11 8v6" />
                  <path d="M8 11h6" />
                </svg>
              </button>

              <div className="mx-1 h-6 w-px bg-line" />

              <button
                type="button"
                onClick={closePreview}
                title="Close"
                aria-label="Close"
                className="focus-ring flex h-8 w-8 items-center justify-center rounded-full border border-line bg-panel-2 text-mist transition hover:border-coral/50 hover:text-coral"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* IMAGE */}
          <div
            className="relative flex flex-1 items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={screenshotUrls[previewIndex]}
              alt={`Screenshot ${previewIndex + 1}`}
              draggable={false}
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onMouseUp={stopDragging}
              onMouseLeave={stopDragging}
              onClick={() => zoom === 1 && zoomIn()}
              onDoubleClick={() => (zoom > 1 ? resetZoom() : zoomIn())}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: isDragging ? 'none' : 'transform 120ms ease',
                cursor:
                  zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
              }}
              className="max-h-full max-w-full select-none object-contain"
            />

            {screenshotUrls.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    goToPreview(previewIndex - 1)
                  }}
                  title="Previous screenshot"
                  aria-label="Previous screenshot"
                  className="focus-ring absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-panel/90 text-paper shadow-lg transition hover:border-accent/40"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    goToPreview(previewIndex + 1)
                  }}
                  title="Next screenshot"
                  aria-label="Next screenshot"
                  className="focus-ring absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-panel/90 text-paper shadow-lg transition hover:border-accent/40"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )

  return createPortal(modal, document.body)
}