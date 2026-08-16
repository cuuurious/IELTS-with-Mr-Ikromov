export default function SubmissionPanel({ studentName, homeworkTitle, submission, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="ticket rounded-lg p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="font-display text-xl">{studentName}</div>
            <div className="text-mist text-sm">{homeworkTitle}</div>
          </div>
          <button onClick={onClose} className="focus-ring text-mist hover:text-paper text-xl leading-none">
            ×
          </button>
        </div>

        {!submission && <p className="text-mist">Nothing submitted yet.</p>}

        {submission?.screenshot_urls?.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-mist font-mono mb-2">
              Screenshots
            </div>
            <div className="flex flex-wrap gap-2">
              {submission.screenshot_urls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer">
                  <img
                    src={url}
                    alt={`screenshot ${i + 1}`}
                    className="w-24 h-24 object-cover rounded-md border border-line"
                  />
                </a>
              ))}
            </div>
          </div>
        )}

        {submission?.submission_files?.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-mist font-mono mb-2">Uploaded files</div>
            <div className="grid gap-2">{submission.submission_files.map((file) => (
              <a key={file.url} href={file.url} target="_blank" rel="noreferrer" className="text-sm text-brass hover:underline bg-panel-2 border border-line rounded-md px-3 py-2 truncate">📎 {file.name}</a>
            ))}</div>
          </div>
        )}

        {['audio_part1_url', 'audio_part2_url', 'audio_part3_url'].map((key, i) =>
          submission?.[key] ? (
            <div key={key}>
              <div className="text-xs uppercase tracking-wide text-mist font-mono mb-1">
                Speaking — Part {i + 1}
              </div>
              <audio controls src={submission[key]} className="w-full" />
            </div>
          ) : null
        )}

        {submission?.comment && (
          <div>
            <div className="text-xs uppercase tracking-wide text-mist font-mono mb-1">
              Student's comment
            </div>
            <p className="text-sm text-paper-dim whitespace-pre-wrap bg-panel-2 border border-line rounded-md p-3">
              {submission.comment}
            </p>
          </div>
        )}

        {submission?.submitted_at && (
          <div className="text-mist text-xs font-mono">
            Submitted {new Date(submission.submitted_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}
