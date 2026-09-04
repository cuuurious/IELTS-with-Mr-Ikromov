import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// A small styled stand-in for window.confirm() / window.prompt() —
// matches the app's own dark "ticket" look (rounded-3xl panel,
// brass/coral buttons) instead of the browser's plain native dialog.
// Used throughout the app wherever we used to call window.confirm()
// or window.prompt().
//
// Usage: a component keeps `const [confirmDialog, setConfirmDialog] =
// useState(null)`, sets it to `{ title, message?, points?,
// confirmLabel?, cancelLabel?, tone?, requireTypedText?, onConfirm }`
// to open it, and renders:
//   <ConfirmModal
//     open={Boolean(confirmDialog)}
//     {...confirmDialog}
//     onCancel={() => setConfirmDialog(null)}
//     onConfirm={() => { const run = confirmDialog?.onConfirm; setConfirmDialog(null); run?.() }}
//   />
//
// Pass `requireTypedText: 'DELETE'` for the rare, most-destructive
// actions that used to go through window.prompt("Type DELETE to
// confirm.") — this renders a text input and keeps Confirm disabled
// until the typed value matches exactly, same safeguard as before.
//
// Pass `hideCancel: true` for a plain heads-up notice that used to go
// through window.alert() — there's nothing to cancel, just one button
// to dismiss it. onConfirm and onCancel can point at the same "close"
// handler in that case.
export default function ConfirmModal({
  open,
  title,
  message,
  points,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'brass',
  requireTypedText,
  hideCancel = false,
  onConfirm,
  onCancel,
}) {
  const resolvedConfirmLabel =
    confirmLabel || (hideCancel ? 'OK' : 'Confirm')

  const [typedText, setTypedText] = useState('')

  // Reset the typed confirmation text every time the dialog opens, so
  // a previous "DELETE" doesn't silently carry over and pre-arm a
  // completely different destructive action opened right after it.
  useEffect(() => {
    if (open) setTypedText('')
  }, [open])

  if (!open) return null

  const confirmDisabled =
    Boolean(requireTypedText) && typedText !== requireTypedText

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

          {requireTypedText && (
            <div className="mt-3">
              <label className="block text-xs uppercase tracking-wide text-mist font-mono">
                Type {requireTypedText} to confirm
              </label>

              <input
                autoFocus
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !confirmDisabled) {
                    onConfirm()
                  }
                }}
                placeholder={requireTypedText}
                className="focus-ring mt-1.5 w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-paper outline-none transition focus:border-coral/60"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          {!hideCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="focus-ring rounded-md border border-line px-4 py-2 text-mist transition-colors hover:border-brass hover:text-brass"
            >
              {cancelLabel}
            </button>
          )}

          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            autoFocus={!requireTypedText}
            className={`focus-ring rounded-md px-4 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              tone === 'coral'
                ? 'bg-coral text-paper hover:brightness-110'
                : 'bg-brass text-onbrass hover:bg-brass-dim'
            }`}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
