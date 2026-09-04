import { createPortal } from 'react-dom'

// A small styled stand-in for window.confirm() — matches the app's
// own dark "ticket" look (rounded-3xl panel, brass/coral buttons)
// instead of the browser's plain native dialog. Used by the Writing
// Mock Test flow (start / submit / minimize) wherever we used to call
// window.confirm().
//
// Usage: a component keeps `const [confirmDialog, setConfirmDialog] =
// useState(null)`, sets it to `{ title, message?, points?,
// confirmLabel?, cancelLabel?, tone?, onConfirm }` to open it, and
// renders:
//   <ConfirmModal
//     open={Boolean(confirmDialog)}
//     {...confirmDialog}
//     onCancel={() => setConfirmDialog(null)}
//     onConfirm={() => { const run = confirmDialog?.onConfirm; setConfirmDialog(null); run?.() }}
//   />
export default function ConfirmModal({
  open,
  title,
  message,
  points,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'brass',
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  const modal = (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-line bg-panel p-6 shadow-2xl"
      >
        <div>
          <div className="font-display text-lg text-paper">{title}</div>

          {message && (
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-paper-dim">
              {message}
            </p>
          )}

          {points?.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">
              {points.map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-paper-dim">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brass" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="focus-ring rounded-md border border-line px-4 py-2 text-mist transition-colors hover:border-brass hover:text-brass"
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`focus-ring rounded-md px-4 py-2 font-medium transition-colors ${
              tone === 'coral'
                ? 'bg-coral text-paper hover:brightness-110'
                : 'bg-brass text-onbrass hover:bg-brass-dim'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
