import { useEffect, useState } from 'react'

/*
 * DOWNLOAD / COPY buttons for homework files (2026-10-07).
 *
 * Download: the browser ignores <a download> for files on another site
 * (Supabase storage), so the file is fetched and saved under its real
 * name. If that fails (old phone, blocked request), Supabase's own
 * "?download=<name>" link is used, which makes storage send it as a
 * download.
 *
 * Copy (pictures only): puts the picture on the clipboard so the student
 * can paste it into Telegram, Word, notes… Clipboards only take PNG, so
 * the picture is redrawn as PNG first. Browsers that can't copy images
 * (some phones) get a short "long-press the picture" hint instead.
 */

export function downloadHref(url, name) {
  if (!url) return url
  try {
    const u = new URL(url, window.location.href)
    if (/\/storage\/v1\/object\//.test(u.pathname)) {
      u.searchParams.set('download', name || '')
      return u.href
    }
  } catch {
    /* keep the plain link */
  }
  return url
}

export async function downloadFile(url, name) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = name || 'file'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
  } catch {
    window.location.href = downloadHref(url, name)
  }
}

async function toPngBlob(blob) {
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'))
}

export function canCopyImages() {
  return typeof window !== 'undefined' && !!navigator.clipboard?.write && typeof window.ClipboardItem === 'function'
}

export async function copyImage(url) {
  // Passing a promise keeps Safari happy (the copy must start inside the tap).
  const item = new window.ClipboardItem({
    'image/png': fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then(toPngBlob),
  })
  await navigator.clipboard.write([item])
}

const btn =
  'focus-ring inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-paper transition-colors hover:bg-panel-2 disabled:opacity-50'

export default function FileActions({ url, name, isImage = false, className = '' }) {
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [noteOk, setNoteOk] = useState(true)

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(''), 2600)
    return () => clearTimeout(t)
  }, [note])

  if (!url) return null

  const onDownload = async () => {
    setBusy('download')
    await downloadFile(url, name)
    setBusy('')
  }

  const onCopy = async () => {
    setBusy('copy')
    try {
      await copyImage(url)
      setNoteOk(true)
      setNote('Picture copied — paste it anywhere')
    } catch {
      setNoteOk(false)
      setNote('Your browser can’t copy pictures — press and hold the picture, then “Copy”')
    }
    setBusy('')
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button type="button" onClick={onDownload} disabled={busy === 'download'} className={btn}>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12m0 0-5-5m5 5 5-5M4 21h16" />
        </svg>
        {busy === 'download' ? 'Downloading…' : 'Download'}
      </button>
      {isImage && canCopyImages() && (
        <button type="button" onClick={onCopy} disabled={busy === 'copy'} className={btn}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </svg>
          {busy === 'copy' ? 'Copying…' : 'Copy picture'}
        </button>
      )}
      {note && (
        <span role="status" className={`text-xs font-medium ${noteOk ? 'text-reading' : 'text-mist'}`}>
          {note}
        </span>
      )}
    </div>
  )
}
