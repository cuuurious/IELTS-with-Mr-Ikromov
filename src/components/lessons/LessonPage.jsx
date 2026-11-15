import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { uploadMaterial } from '../../lib/materials'
import { slidesHref } from '../../lib/courses'
import MaterialPicker from '../MaterialPicker'

/*
 * LESSON PAGES (2026-11-15, migration_128).
 * Each lesson of a course plan has a page that starts empty. The teacher
 * fills it himself:
 *   - drag files from the computer onto the page (pictures show, other
 *     files become cards; they are saved to the Materials Library too),
 *   - paste (Ctrl+V) text, links or screenshots,
 *   - "+ Heading", "+ Text", "+ Tip box", "+ Video link",
 *   - "+ From Library" for files already in the Materials Library.
 * Blocks move by dragging the handle (or ↑ ↓ on a phone). It saves by
 * itself. The page is shown on the board in class and students of the
 * group open it later from "My course".
 *
 * A page is a list of blocks kept in plan_lessons.page:
 *   { id, type: 'heading' | 'text' | 'note' | 'image' | 'file' | 'video',
 *     text?, url?, name?, mime_type?, material_id? }
 */

const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const URL_RE = /^https?:\/\/\S+$/i
const IMG_RE = /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i

export function youtubeId(url = '') {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i.exec(url)
  return m ? m[1] : null
}

const isImage = (b) => b.type === 'image' || /^image\//.test(b.mime_type || '') || IMG_RE.test(b.url || '')

// A pasted / dropped link becomes the right kind of block.
function blockFromUrl(url) {
  if (youtubeId(url) || /vimeo\.com\/\d+/i.test(url)) return { id: uid(), type: 'video', url }
  if (IMG_RE.test(url)) return { id: uid(), type: 'image', url, name: '' }
  return { id: uid(), type: 'file', url, name: url.replace(/^https?:\/\//, '').slice(0, 80) }
}

// Pasted text: a lone link becomes a link block, everything else one text block.
function blocksFromText(text) {
  const t = (text || '').replace(/\r\n?/g, '\n').trim()
  if (!t) return []
  if (URL_RE.test(t)) return [blockFromUrl(t)]
  return [{ id: uid(), type: 'text', text: t }]
}

export const pageHasContent = (page) => Array.isArray(page) && page.length > 0

/* ------------------------------------------------------------------ */
/* Showing a page (board, students, preview)                          */
/* ------------------------------------------------------------------ */

// **bold** inside a line, safely (no HTML).
function Inline({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|https?:\/\/[^\s]+)/g)
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (/^https?:\/\//.test(p))
      return (
        <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-brass underline">
          {p}
        </a>
      )
    return <Fragment key={i}>{p}</Fragment>
  })
}

// Paragraphs, "- " / "• " / "1. " lists, kept as the teacher typed them.
function RichText({ text }) {
  const chunks = String(text || '').split(/\n{2,}/)
  return chunks.map((chunk, ci) => {
    const lines = chunk.split('\n')
    const bullet = lines.every((l) => /^\s*([-•*]|\d+[.)])\s+/.test(l))
    if (bullet && lines.length) {
      const numbered = /^\s*\d/.test(lines[0])
      const L = numbered ? 'ol' : 'ul'
      return (
        <L key={ci} className={`my-2 flex flex-col gap-1 pl-6 ${numbered ? 'list-decimal' : 'list-disc'}`}>
          {lines.map((l, li) => (
            <li key={li}>
              <Inline text={l.replace(/^\s*([-•*]|\d+[.)])\s+/, '')} />
            </li>
          ))}
        </L>
      )
    }
    return (
      <p key={ci} className="my-2 whitespace-pre-wrap">
        <Inline text={chunk} />
      </p>
    )
  })
}

function FileCard({ b, big }) {
  const mime = b.mime_type || ''
  if (/^video\//.test(mime)) return <video src={b.url} controls className="w-full rounded-[14px] bg-ink" />
  if (/^audio\//.test(mime) || /\.(mp3|m4a|wav|ogg)(\?|$)/i.test(b.url || ''))
    return (
      <div className="rounded-[14px] border border-line bg-panel-2 p-3">
        <p className="mb-2 truncate text-sm font-extrabold text-paper">{b.name || 'Audio'}</p>
        <audio src={b.url} controls className="w-full" />
      </div>
    )
  const ext = ((b.name || b.url || '').split('?')[0].split('.').pop() || '').slice(0, 4).toUpperCase()
  return (
    <a
      href={slidesHref(b.url, b.name)}
      target="_blank"
      rel="noreferrer"
      className="focus-ring flex items-center gap-3 rounded-[14px] border border-line bg-panel-2 px-3 py-3 hover:border-brass"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] text-[11px] font-extrabold text-brass">
        {ext && ext.length <= 4 && !ext.includes('/') ? ext : 'LINK'}
      </span>
      <span className={`min-w-0 flex-1 truncate font-extrabold text-paper ${big ? 'text-[20px]' : 'text-[15px]'}`}>{b.name || b.url}</span>
      <span className="shrink-0 text-[13px] font-extrabold text-brass">Open</span>
    </a>
  )
}

function VideoBlock({ b }) {
  const yt = youtubeId(b.url)
  const vm = /vimeo\.com\/(\d+)/i.exec(b.url || '')
  const src = yt ? `https://www.youtube-nocookie.com/embed/${yt}` : vm ? `https://player.vimeo.com/video/${vm[1]}` : null
  if (!src) return <FileCard b={{ ...b, name: b.name || b.url }} />
  return (
    <div className="aspect-video w-full overflow-hidden rounded-[14px] bg-ink">
      <iframe src={src} title={b.name || 'Video'} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture" allowFullScreen />
    </div>
  )
}

export function BlockView({ b, big = false }) {
  if (b.type === 'heading')
    return <h2 className={`font-brand font-semibold leading-tight text-paper ${big ? 'text-[34px] sm:text-[44px]' : 'text-[22px] sm:text-[26px]'}`}>{b.text}</h2>
  if (b.type === 'text')
    return (
      <div className={`font-semibold leading-relaxed text-paper ${big ? 'text-[22px] sm:text-[28px]' : 'text-[15px] sm:text-[16px]'}`}>
        <RichText text={b.text} />
      </div>
    )
  if (b.type === 'note')
    return (
      <div className={`rounded-[20px] border-l-4 border-saffron bg-[color-mix(in_srgb,var(--color-saffron)_14%,var(--color-panel))] px-4 py-3 font-semibold leading-relaxed text-paper ${big ? 'text-[22px] sm:text-[28px]' : 'text-[15px]'}`}>
        <RichText text={b.text} />
      </div>
    )
  if (isImage(b))
    return (
      <figure className="flex flex-col items-center gap-1.5">
        <img src={b.url} alt={b.name || ''} loading="lazy" className={`max-w-full rounded-[14px] object-contain ${big ? 'max-h-[78vh]' : 'max-h-[70vh]'}`} />
        {b.type === 'image' && b.name && <figcaption className={`font-semibold text-mist ${big ? 'text-[18px]' : 'text-[13px]'}`}>{b.name}</figcaption>}
      </figure>
    )
  if (b.type === 'video') return <VideoBlock b={b} />
  return <FileCard b={b} big={big} />
}

/** Full-screen view of a page: the board in class, or a student revising. */
export function LessonPageView({ title, subtitle, page, onClose, onEdit }) {
  const [big, setBig] = useState(false)
  const rootRef = useRef(null)
  const blocks = Array.isArray(page) ? page : []

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !document.fullscreenElement && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const fullscreen = () => {
    const el = rootRef.current
    if (document.fullscreenElement) document.exitFullscreen?.()
    else el?.requestFullscreen?.().catch(() => {})
    setBig(true)
  }

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[90] flex flex-col bg-ink" role="dialog" aria-modal="true" aria-label={title || 'Lesson'}>
      <div className="registan-band flex flex-wrap items-center gap-2 px-4 py-3 text-white sm:px-6">
        <div className="min-w-0 flex-1">
          {subtitle && <p className="truncate text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">{subtitle}</p>}
          <p className="truncate font-brand text-[18px] font-semibold sm:text-[22px]">{title || 'Lesson'}</p>
        </div>
        <button type="button" onClick={() => setBig((v) => !v)} className="focus-ring h-10 rounded-[14px] bg-white/15 px-3 text-[13px] font-extrabold text-white hover:bg-white/25">
          {big ? 'Normal text' : 'Bigger text'}
        </button>
        <button type="button" onClick={fullscreen} className="focus-ring hidden h-10 rounded-[14px] bg-white/15 px-3 text-[13px] font-extrabold text-white hover:bg-white/25 sm:block">
          Full screen
        </button>
        {onEdit && (
          <button type="button" onClick={onEdit} className="focus-ring h-10 rounded-[14px] bg-white/15 px-3 text-[13px] font-extrabold text-white hover:bg-white/25">
            Edit
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close" className="focus-ring grid h-10 w-10 place-items-center rounded-[14px] bg-white/15 text-white hover:bg-white/25">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-ink">
        <div className={`mx-auto flex w-full flex-col gap-5 px-4 py-6 sm:px-8 ${big ? 'max-w-6xl' : 'max-w-3xl'}`}>
          {blocks.length ? (
            blocks.map((b) => <BlockView key={b.id} b={b} big={big} />)
          ) : (
            <p className="py-20 text-center text-sm font-semibold text-mist">This lesson page is empty.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Opens a lesson's page by plan + number (students and teacher). */
export function LessonPageLoader({ planId, number, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    supabase.rpc('lesson_page', { p_plan_id: planId, p_number: number }).then(({ data: d, error: e }) => {
      if (cancelled) return
      if (e || !d) setError(e?.message?.includes('lesson_page') ? 'Lesson pages are not switched on yet.' : 'This lesson page is not open yet.')
      else setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [planId, number])
  if (error)
    return createPortal(
      <div className="fixed inset-0 z-[90] grid place-items-center bg-ink/60 p-4" onClick={onClose}>
        <div className="max-w-sm rounded-[20px] bg-panel p-5 text-center" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm font-bold text-paper">{error}</p>
          <button type="button" onClick={onClose} className="focus-ring mt-3 h-10 rounded-[14px] bg-brass px-4 text-sm font-extrabold text-onbrass">OK</button>
        </div>
      </div>,
      document.body
    )
  if (!data)
    return createPortal(
      <div className="fixed inset-0 z-[90] grid place-items-center bg-ink/60">
        <p className="rounded-[14px] bg-panel px-4 py-3 text-sm font-bold text-paper">Opening the lesson…</p>
      </div>,
      document.body
    )
  return <LessonPageView title={data.title || `Lesson ${data.number}`} subtitle={`${data.plan_title} · Lesson ${data.number}`} page={data.page} onClose={onClose} />
}

/* ------------------------------------------------------------------ */
/* Building a page                                                     */
/* ------------------------------------------------------------------ */

const ADD = [
  ['heading', 'Heading'],
  ['text', 'Text'],
  ['note', 'Tip box'],
]

const IconBtn = ({ label, onClick, children, danger = false, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className={`focus-ring grid h-8 w-8 place-items-center rounded-[10px] text-[15px] font-extrabold disabled:opacity-30 ${danger ? 'text-coral hover:bg-urgent-tint' : 'text-paper-dim hover:bg-panel-2 hover:text-paper'}`}
  >
    {children}
  </button>
)

function AutoText({ value, onChange, placeholder, className, autoFocus }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  return <textarea ref={ref} rows={1} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={className} />
}

function BlockEditor({ b, onChange, fresh }) {
  const field = 'focus-ring w-full resize-none rounded-[12px] border border-transparent bg-transparent px-2 py-1.5 text-paper placeholder:text-mist hover:border-line focus:border-brass focus:bg-panel'
  if (b.type === 'heading')
    return <AutoText autoFocus={fresh} value={b.text || ''} onChange={(text) => onChange({ text })} placeholder="Heading" className={`${field} font-brand text-[22px] font-semibold leading-tight`} />
  if (b.type === 'text' || b.type === 'note')
    return (
      <div className={b.type === 'note' ? 'rounded-[16px] border-l-4 border-saffron bg-[color-mix(in_srgb,var(--color-saffron)_14%,var(--color-panel))] p-1' : ''}>
        <AutoText
          autoFocus={fresh}
          value={b.text || ''}
          onChange={(text) => onChange({ text })}
          placeholder={b.type === 'note' ? 'Tip, rule or example to remember…' : 'Write or paste text. Lines starting with “- ” become a list, **words** go bold.'}
          className={`${field} text-[15px] font-semibold leading-relaxed`}
        />
      </div>
    )
  if (b.type === 'video')
    return (
      <div className="flex flex-col gap-2">
        <input value={b.url || ''} onChange={(e) => onChange({ url: e.target.value.trim() })} placeholder="Paste a YouTube or Vimeo link" className="focus-ring h-10 w-full rounded-[12px] border border-line bg-panel px-3 text-sm font-semibold text-paper" />
        {b.url && <VideoBlock b={b} />}
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <BlockView b={isImage(b) ? { ...b, name: '' } : b} />
      <input value={b.name || ''} onChange={(e) => onChange({ name: e.target.value })} placeholder={isImage(b) ? 'Caption (optional)' : 'File name students see'} className="focus-ring h-9 w-full rounded-[12px] border border-transparent bg-transparent px-2 text-[13px] font-semibold text-mist hover:border-line focus:border-brass focus:bg-panel" />
    </div>
  )
}

/**
 * The builder. Props: lesson (plan_lessons row with id, number, title, page),
 * planTitle, onClose, onSaved(page).
 */
export function LessonPageEditor({ lesson, planTitle, onClose, onSaved }) {
  const { profile } = useAuth()
  const [blocks, setBlocks] = useState(() => (Array.isArray(lesson.page) ? lesson.page : []).map((b) => ({ ...b, id: b.id || uid() })))
  const [status, setStatus] = useState('saved') // saved | dirty | saving | error
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(0)
  const [picking, setPicking] = useState(false)
  const [preview, setPreview] = useState(false)
  const [freshId, setFreshId] = useState(null)
  const [dropAt, setDropAt] = useState(null) // index where a drop would land
  const dragId = useRef(null)
  const listRef = useRef(null)
  const fileRef = useRef(null)
  const latest = useRef(blocks)
  const timer = useRef(null)
  const version = useRef(0)

  const save = useCallback(async () => {
    clearTimeout(timer.current)
    const ver = version.current
    setStatus('saving')
    const page = latest.current.filter((b) => (b.type === 'heading' || b.type === 'text' || b.type === 'note' ? (b.text || '').trim() : b.url))
    const { error: e } = await supabase.from('plan_lessons').update({ page }).eq('id', lesson.id)
    if (e) {
      setStatus('error')
      setError(/page/.test(e.message) ? 'Run migration_128 first, then this page can be saved.' : e.message)
      return false
    }
    setError('')
    setStatus(version.current === ver ? 'saved' : 'dirty')
    onSaved?.(page)
    return true
  }, [lesson.id, onSaved])

  // Save by itself a moment after every change.
  const change = (next) => {
    latest.current = next
    version.current += 1
    setBlocks(next)
    setStatus('dirty')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(), 1200)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  const close = async () => {
    if (status === 'dirty' || status === 'saving') await save()
    onClose()
  }

  const insert = (newBlocks, at = null) => {
    if (!newBlocks.length) return
    const list = [...latest.current]
    const i = at == null || at > list.length ? list.length : at
    list.splice(i, 0, ...newBlocks)
    change(list)
    setFreshId(newBlocks[0].id)
    setTimeout(() => listRef.current?.querySelector(`[data-block="${newBlocks[0].id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60)
  }
  const update = (id, patch) => change(latest.current.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  const remove = (id) => change(latest.current.filter((b) => b.id !== id))
  const move = (id, d) => {
    const list = [...latest.current]
    const i = list.findIndex((b) => b.id === id)
    const j = i + d
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    change(list)
  }

  const uploadFiles = async (files, at = null) => {
    const list = [...files].filter(Boolean)
    if (!list.length) return
    setUploading((n) => n + list.length)
    setError('')
    let pos = at
    for (const file of list) {
      try {
        const m = await uploadMaterial(file, { userId: profile?.id })
        const img = /^image\//.test(m.mime_type || file.type || '')
        insert([{ id: uid(), type: img ? 'image' : 'file', url: m.url, name: img ? '' : m.title || m.file_name, mime_type: m.mime_type, material_id: m.id }], pos)
        if (pos != null) pos += 1
      } catch (err) {
        setError(`${file.name}: ${err?.message || 'could not upload'}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  // Paste anywhere on the page. Inside a text box, text pastes normally;
  // pictures (e.g. a screenshot) always become a picture block.
  const onPaste = (e) => {
    const cd = e.clipboardData
    if (!cd) return
    const files = [...(cd.files || [])]
    if (files.length) {
      e.preventDefault()
      uploadFiles(files, indexAfterFocus())
      return
    }
    const tag = e.target?.tagName
    if (tag === 'TEXTAREA' || tag === 'INPUT' || e.target?.isContentEditable) return
    const text = cd.getData('text/plain')
    if (text) {
      e.preventDefault()
      insert(blocksFromText(text))
    }
  }
  const indexAfterFocus = () => {
    const el = document.activeElement?.closest?.('[data-block]')
    if (!el) return null
    const i = latest.current.findIndex((b) => b.id === el.dataset.block)
    return i < 0 ? null : i + 1
  }

  // Where would a drop land? Between the blocks nearest the pointer.
  const dropIndex = (clientY) => {
    const nodes = [...(listRef.current?.querySelectorAll('[data-block]') || [])]
    for (let i = 0; i < nodes.length; i += 1) {
      const r = nodes[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return nodes.length
  }
  const onDragOver = (e) => {
    const types = [...(e.dataTransfer?.types || [])]
    if (!types.some((t) => t === 'Files' || t === 'text/plain' || t === 'text/uri-list' || t === 'application/x-lesson-block')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = dragId.current ? 'move' : 'copy'
    setDropAt(dropIndex(e.clientY))
  }
  const onDrop = (e) => {
    e.preventDefault()
    const at = dropIndex(e.clientY)
    setDropAt(null)
    const dt = e.dataTransfer
    // Moving a block inside the page.
    if (dragId.current) {
      const id = dragId.current
      dragId.current = null
      const list = [...latest.current]
      const from = list.findIndex((b) => b.id === id)
      if (from < 0) return
      const [b] = list.splice(from, 1)
      list.splice(at > from ? at - 1 : at, 0, b)
      change(list)
      return
    }
    if (dt.files?.length) return uploadFiles(dt.files, at)
    const uri = (dt.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#'))
    if (uri) return insert([blockFromUrl(uri.trim())], at)
    const text = dt.getData('text/plain')
    if (text) insert(blocksFromText(text), at)
  }

  const label = status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Not saved yet' : status === 'error' ? 'Not saved' : 'Saved'

  if (preview)
    return <LessonPageView title={lesson.title || `Lesson ${lesson.number}`} subtitle={`${planTitle || 'Course'} · Lesson ${lesson.number}`} page={blocks} onClose={() => setPreview(false)} onEdit={() => setPreview(false)} />

  return createPortal(
    <div className="fixed inset-0 z-[85] flex flex-col bg-ink/60 sm:p-4" role="dialog" aria-modal="true" aria-label="Lesson page">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden bg-panel sm:rounded-[28px]">
        <div className="registan-band flex flex-wrap items-center gap-2 px-4 py-3 text-white sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">{planTitle || 'Course'} · Lesson {lesson.number} · same page for every group</p>
            <p className="truncate font-brand text-[18px] font-semibold">{lesson.title || `Lesson ${lesson.number}`}</p>
          </div>
          <span className={`rounded-xl px-2.5 py-1 text-[12px] font-extrabold ${status === 'error' ? 'bg-coral text-white' : 'bg-white/15 text-white'}`} aria-live="polite">
            {uploading ? `Uploading ${uploading}…` : label}
          </span>
          <button type="button" onClick={() => setPreview(true)} className="focus-ring h-10 rounded-[14px] bg-white/15 px-3 text-[13px] font-extrabold text-white hover:bg-white/25">Preview</button>
          <button type="button" onClick={close} className="focus-ring h-10 rounded-[14px] bg-saffron px-4 text-[13px] font-extrabold text-[#17213a]">Done</button>
        </div>

        {/* Add bar */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel px-3 py-2 sm:px-5">
          {ADD.map(([t, l]) => (
            <button key={t} type="button" onClick={() => insert([{ id: uid(), type: t, text: '' }], indexAfterFocus())} className="focus-ring h-9 rounded-[12px] border border-line px-3 text-[13px] font-extrabold text-paper hover:bg-panel-2">
              + {l}
            </button>
          ))}
          <button type="button" onClick={() => fileRef.current?.click()} className="focus-ring h-9 rounded-[12px] border border-line px-3 text-[13px] font-extrabold text-paper hover:bg-panel-2">
            + Picture / file
          </button>
          <button type="button" onClick={() => insert([{ id: uid(), type: 'video', url: '' }], indexAfterFocus())} className="focus-ring h-9 rounded-[12px] border border-line px-3 text-[13px] font-extrabold text-paper hover:bg-panel-2">
            + Video link
          </button>
          <button type="button" onClick={() => setPicking(true)} className="focus-ring h-9 rounded-[12px] bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] px-3 text-[13px] font-extrabold text-brass">
            + From Library
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              uploadFiles(e.target.files, indexAfterFocus())
              e.target.value = ''
            }}
          />
        </div>

        {error && <p className="mx-4 mt-3 rounded-[14px] bg-urgent-tint px-4 py-2 text-sm font-bold text-coral sm:mx-5">{error}</p>}

        <div
          ref={listRef}
          onPaste={onPaste}
          onDragOver={onDragOver}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setDropAt(null)
          }}
          onDrop={onDrop}
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6"
          tabIndex={-1}
        >
          {blocks.length === 0 ? (
            <div
              className={`flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-[20px] border-2 border-dashed px-6 text-center ${dropAt != null ? 'border-brass bg-[color-mix(in_srgb,var(--color-brass)_8%,var(--color-panel))]' : 'border-line'}`}
            >
              <p className="font-brand text-[20px] font-semibold text-paper">An empty lesson page</p>
              <p className="max-w-md text-[14px] font-semibold text-paper-dim">
                Drag pictures, PDFs, slides or audio here, paste text or a screenshot (Ctrl+V), or use the buttons above. Files you drop are saved to the Materials Library too.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => insert([{ id: uid(), type: 'heading', text: '' }])} className="focus-ring h-10 rounded-[14px] bg-brass px-4 text-[13px] font-extrabold text-onbrass">Start with a heading</button>
                <button type="button" onClick={() => setPicking(true)} className="focus-ring h-10 rounded-[14px] border border-line px-4 text-[13px] font-extrabold text-paper hover:bg-panel-2">Pick from Library</button>
              </div>
            </div>
          ) : (
            <ol className="flex flex-col">
              {blocks.map((b, i) => (
                <li key={b.id} data-block={b.id} className="relative">
                  {dropAt === i && <div className="absolute -top-1 left-0 right-0 h-1 rounded-full bg-brass" aria-hidden="true" />}
                  <div
                    onDragEnd={() => {
                      dragId.current = null
                      setDropAt(null)
                    }}
                    className="group relative flex items-start gap-1 rounded-[16px] py-1.5 pr-1 hover:bg-panel-2/40 focus-within:bg-panel-2/40 sm:pr-2"
                  >
                    <span
                      draggable
                      onDragStart={(e) => {
                        dragId.current = b.id
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('application/x-lesson-block', b.id)
                        const row = e.currentTarget.closest('[data-block]')
                        if (row) e.dataTransfer.setDragImage(row, 20, 20)
                      }}
                      title="Drag to move"
                      aria-hidden="true"
                      className="mt-1.5 hidden h-8 w-6 shrink-0 cursor-grab place-items-center rounded-lg text-mist hover:bg-panel-2 hover:text-paper sm:grid"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <BlockEditor b={b} fresh={freshId === b.id} onChange={(patch) => update(b.id, patch)} />
                    </div>
                    <div className="flex shrink-0 flex-col items-center gap-0.5 sm:absolute sm:-top-3 sm:right-3 sm:z-10 sm:flex-row sm:rounded-[12px] sm:border sm:border-line sm:bg-panel sm:p-0.5 sm:opacity-0 sm:shadow-sm sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <IconBtn label="Move up" disabled={i === 0} onClick={() => move(b.id, -1)}>↑</IconBtn>
                      <IconBtn label="Move down" disabled={i === blocks.length - 1} onClick={() => move(b.id, 1)}>↓</IconBtn>
                      <IconBtn label="Delete block" danger onClick={() => remove(b.id)}>×</IconBtn>
                    </div>
                  </div>
                </li>
              ))}
              <li className="relative">
                {dropAt === blocks.length && <div className="absolute -top-1 left-0 right-0 h-1 rounded-full bg-brass" aria-hidden="true" />}
                <p className="mt-3 rounded-[16px] border-2 border-dashed border-line px-4 py-5 text-center text-[13px] font-semibold text-mist">
                  Drop files here or paste (Ctrl+V) to add more
                </p>
              </li>
            </ol>
          )}
        </div>
      </div>

      <MaterialPicker
        open={picking}
        onClose={() => setPicking(false)}
        alreadyPickedIds={blocks.map((b) => b.material_id).filter(Boolean)}
        onPick={(rows) => {
          const add = (rows || []).map((m) => {
            const img = /^image\//.test(m.mime_type || '') || IMG_RE.test(m.url || '')
            return { id: uid(), type: img ? 'image' : 'file', url: m.url, name: img ? '' : m.title || m.file_name || m.name, mime_type: m.mime_type, material_id: m.id }
          })
          insert(add, indexAfterFocus())
          setPicking(false)
        }}
      />
    </div>,
    document.body
  )
}
