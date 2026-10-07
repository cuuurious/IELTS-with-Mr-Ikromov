import { useEffect, useState } from 'react'
import Icon from './Icon'

/*
 * PASTED / DROPPED FILE WAITING TO BE SENT (2026-10-07).
 *
 * Pasting a screenshot (Ctrl+V) or dropping a file on a chat used to
 * send it straight away. Now it waits here, above the message box, with
 * a preview — it's only sent when Send is pressed (or Enter), and the ×
 * removes it.
 */
export default function PendingAttachment({ file, onRemove, disabled = false }) {
  const [preview, setPreview] = useState('')
  const isImage = Boolean(file?.type?.startsWith('image/'))

  useEffect(() => {
    if (!file || !isImage) {
      setPreview('')
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file, isImage])

  if (!file) return null

  const sizeKb = file.size / 1024
  const size = sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(sizeKb))} KB`

  return (
    <div className="mb-2 flex items-center gap-3 rounded-[18px] border border-line bg-panel-2 p-2 pr-3">
      {preview ? (
        <img src={preview} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-panel text-paper-dim">
          <Icon name="paperclip" className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-paper">{isImage ? 'Photo' : file.name || 'File'}</p>
        <p className="text-xs text-mist">{size} · press Send to share it</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-paper-dim hover:bg-panel hover:text-urgent disabled:opacity-40"
        aria-label="Remove attachment"
        title="Remove"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  )
}
