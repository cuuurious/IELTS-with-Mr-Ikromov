import { useCallback, useRef, useState } from 'react'

/*
 * Drag files from the desktop onto an upload area (2026-10-06,
 * Mavluda: "we should enable uploading via dragging the file from
 * desktop").
 *
 *   const { isDragging, dropProps } = useFileDrop({ onFiles, accept, disabled })
 *   <div {...dropProps} className="relative">
 *     …
 *     <DropOverlay show={isDragging} label="Drop to attach" />
 *   </div>
 *
 * - Reacts ONLY to real files from the computer (dataTransfer type
 *   "Files"), never to text or in-page drags, so it can't interfere with
 *   anything else that drags on the page.
 * - `accept` (optional): same format as an <input accept>, e.g.
 *   "image/*,.pdf". Files that don't match are passed to `onReject`
 *   (if given) instead of `onFiles`.
 * - Dropping a file anywhere ELSE on the page no longer makes the
 *   browser open the file and leave the site (guard installed once).
 */

let guardInstalled = false
function installWindowGuard() {
  if (guardInstalled || typeof window === 'undefined') return
  guardInstalled = true
  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')
  window.addEventListener('dragover', (e) => {
    if (isFileDrag(e)) e.preventDefault()
  })
  window.addEventListener('drop', (e) => {
    if (isFileDrag(e)) e.preventDefault()
  })
}

export function fileMatchesAccept(file, accept) {
  if (!accept) return true
  const name = (file.name || '').toLowerCase()
  const type = (file.type || '').toLowerCase()
  return accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule)
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1))
      return type === rule
    })
}

export function useFileDrop({ onFiles, onReject, accept, disabled = false, multiple = true } = {}) {
  installWindowGuard()
  const [isDragging, setIsDragging] = useState(false)
  const depth = useRef(0)

  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')

  const onDragEnter = useCallback(
    (e) => {
      if (disabled || !hasFiles(e)) return
      e.preventDefault()
      depth.current += 1
      setIsDragging(true)
    },
    [disabled]
  )

  const onDragOver = useCallback(
    (e) => {
      if (disabled || !hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [disabled]
  )

  const onDragLeave = useCallback(
    (e) => {
      if (disabled || !hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setIsDragging(false)
    },
    [disabled]
  )

  const onDrop = useCallback(
    (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      depth.current = 0
      setIsDragging(false)
      if (disabled) return
      let files = Array.from(e.dataTransfer.files || [])
      if (!multiple) files = files.slice(0, 1)
      const ok = files.filter((f) => fileMatchesAccept(f, accept))
      const bad = files.filter((f) => !fileMatchesAccept(f, accept))
      if (bad.length) onReject?.(bad)
      if (ok.length) onFiles?.(ok)
    },
    [accept, disabled, multiple, onFiles, onReject]
  )

  return { isDragging, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}

/* Overlay shown over the drop area while files are dragged over it.
   The parent needs `relative`. */
export function DropOverlay({ show, label = 'Drop files here to upload' }) {
  if (!show) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-brass bg-panel/85 backdrop-blur-[1px]">
      <span className="flex items-center gap-2 rounded-xl bg-brass px-4 py-2 text-sm font-medium text-onbrass">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
        </svg>
        {label}
      </span>
    </div>
  )
}
