import { createPortal } from 'react-dom'

export default function SubmissionPanel({
  studentName,
  homeworkTitle,
  submission,
  onClose,
}) {
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
                    <a
                      key={url || i}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden rounded-2xl border border-line bg-panel-2 transition hover:border-accent/40"
                    >
                      <img
                        src={url}
                        alt={`Screenshot ${i + 1}`}
                        className="aspect-square h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                      />
                    </a>
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
    </div>
  )

  return createPortal(modal, document.body)
}