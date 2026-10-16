import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

/*
 * ESSAY ANNOTATOR (2026-10-16) — Jasur: "I want writing examiner to be
 * able to comment on specific parts, for example by highlighting".
 *
 * Shows an essay with every comment highlighted in its category colour
 * and numbered. When `editable`, selecting words opens a small box to
 * pick a category and write the comment.
 *
 * A comment is anchored by character offsets in the essay text (the
 * text never changes once handed in). Offsets are measured with a DOM
 * Range over the essay box, so the numbers next to highlights are drawn
 * with CSS ::after content — they never become part of the text.
 */

export const COMMENT_CATEGORIES = [
  { key: 'grammar', label: 'Grammar', mark: 'bg-urgent-tint', chip: 'bg-urgent-tint text-urgent', dot: 'bg-urgent' },
  { key: 'vocabulary', label: 'Vocabulary', mark: 'bg-vocab-tint', chip: 'bg-vocab-tint text-vocab', dot: 'bg-vocab' },
  { key: 'spelling', label: 'Spelling', mark: 'bg-speaking-tint', chip: 'bg-speaking-tint text-speaking', dot: 'bg-speaking' },
  { key: 'coherence', label: 'Linking & flow', mark: 'bg-listening-tint', chip: 'bg-listening-tint text-listening', dot: 'bg-listening' },
  { key: 'task', label: 'Task response', mark: 'bg-writing-tint', chip: 'bg-writing-tint text-writing', dot: 'bg-writing' },
  { key: 'good', label: 'Well done', mark: 'bg-reading-tint', chip: 'bg-reading-tint text-reading', dot: 'bg-reading' },
  { key: 'other', label: 'Note', mark: 'bg-line', chip: 'bg-panel-2 text-paper', dot: 'bg-mist' },
]

export const categoryOf = (key) => COMMENT_CATEGORIES.find((c) => c.key === key) || COMMENT_CATEGORIES[COMMENT_CATEGORIES.length - 1]

// Comments in reading order, numbered 1, 2, 3… within one task.
export function numberComments(comments) {
  const sorted = [...comments].sort((a, b) => a.start_offset - b.start_offset || a.end_offset - b.end_offset)
  return sorted.map((c, i) => ({ ...c, n: i + 1 }))
}

function textOffset(container, node, offset) {
  const range = document.createRange()
  range.setStart(container, 0)
  range.setEnd(node, offset)
  return range.toString().length
}

export default function EssayAnnotator({
  text,
  comments = [], // already numbered (numberComments)
  editable = false,
  activeId = null,
  onActivate,
  onAdd, // async ({ start, end, quote, category, comment }) => void
  className = '',
}) {
  const boxRef = useRef(null)
  const [draft, setDraft] = useState(null) // { start, end, quote, rect }
  const [category, setCategory] = useState('grammar')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const value = text || ''

  // Split the essay into runs that share the same set of comments.
  const segments = useMemo(() => {
    // While a new comment is being written, its words stay highlighted.
    const all = draft
      ? [...comments, { id: '__draft', n: null, start_offset: draft.start, end_offset: draft.end, category }]
      : comments
    const cuts = new Set([0, value.length])
    all.forEach((c) => {
      cuts.add(Math.max(0, Math.min(value.length, c.start_offset)))
      cuts.add(Math.max(0, Math.min(value.length, c.end_offset)))
    })
    const points = [...cuts].sort((a, b) => a - b)
    const out = []
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      if (b <= a) continue
      const covering = all.filter((c) => c.start_offset <= a && c.end_offset >= b)
      const endingHere = all.filter((c) => c.end_offset === b && c.n != null).map((c) => c.n)
      out.push({ a, b, covering, endingHere })
    }
    return out
  }, [value, comments, draft, category])

  // Bring the active highlight into view when it is picked from the list.
  useEffect(() => {
    if (!activeId || !boxRef.current) return
    const el = boxRef.current.querySelector(`[data-first-of="${activeId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeId])

  const readSelection = () => {
    if (!editable || !boxRef.current) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    const box = boxRef.current
    if (!box.contains(range.startContainer) || !box.contains(range.endContainer)) return
    let start = textOffset(box, range.startContainer, range.startOffset)
    let end = textOffset(box, range.endContainer, range.endOffset)
    if (end < start) [start, end] = [end, start]
    // Drop spaces and line breaks at either edge of the selection.
    while (start < end && /\s/.test(value[start])) start++
    while (end > start && /\s/.test(value[end - 1])) end--
    if (end <= start) return
    const rect = range.getBoundingClientRect()
    setDraft({ start, end, quote: value.slice(start, end), rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width } })
    setNote('')
    setError('')
  }

  const closeDraft = () => {
    setDraft(null)
    setError('')
    window.getSelection()?.removeAllRanges()
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError('')
    try {
      await onAdd({ start: draft.start, end: draft.end, quote: draft.quote, category, comment: note.trim() })
      closeDraft()
    } catch (err) {
      setError(err?.message || 'Could not save this comment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={className}>
      <div
        ref={boxRef}
        onMouseUp={readSelection}
        onTouchEnd={() => setTimeout(readSelection, 0)}
        className={`whitespace-pre-wrap break-words text-[15px] leading-[1.9] text-paper ${editable ? 'cursor-text selection:bg-brass/25' : ''}`}
      >
        {value
          ? segments.map((s) => {
              const piece = value.slice(s.a, s.b)
              if (!s.covering.length) return <span key={s.a}>{piece}</span>
              // The shortest comment covering this run decides the colour.
              const top = [...s.covering].sort((x, y) => x.end_offset - x.start_offset - (y.end_offset - y.start_offset))[0]
              const cat = categoryOf(top.category)
              const isActive = s.covering.some((c) => c.id === activeId || c.id === '__draft')
              const first = s.covering.find((c) => c.start_offset === s.a)
              return (
                <mark
                  key={s.a}
                  data-first-of={first ? first.id : undefined}
                  data-n={s.endingHere.length ? s.endingHere.join(',') : undefined}
                  onClick={(e) => {
                    if (window.getSelection()?.toString()) return
                    e.stopPropagation()
                    onActivate?.(top.id)
                  }}
                  className={`cursor-pointer rounded-[3px] px-[1px] text-paper underline decoration-2 underline-offset-4 ${cat.mark} ${
                    isActive ? 'outline outline-2 outline-offset-1 outline-paper/70' : ''
                  } ${
                    s.endingHere.length
                      ? 'after:ml-0.5 after:inline-block after:rounded-full after:bg-paper after:px-1 after:align-super after:text-[10px] after:font-semibold after:leading-[1.35] after:text-panel after:content-[attr(data-n)] after:no-underline'
                      : ''
                  }`}
                  style={{ textDecorationColor: 'color-mix(in srgb, currentColor 35%, transparent)' }}
                >
                  {piece}
                </mark>
              )
            })
          : <span className="text-mist">No answer written.</span>}
      </div>

      {draft && (
        <CommentComposer
          draft={draft}
          category={category}
          onCategory={setCategory}
          note={note}
          onNote={setNote}
          saving={saving}
          error={error}
          onSave={save}
          onCancel={closeDraft}
        />
      )}
    </div>
  )
}

function CommentComposer({ draft, category, onCategory, note, onNote, saving, error, onSave, onCancel }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ top: draft.rect.bottom + 10, left: draft.rect.left })

  // Keep the box on screen: under the selection if there is room, else above.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = Math.min(Math.max(12, draft.rect.left + draft.rect.width / 2 - w / 2), vw - w - 12)
    let top = draft.rect.bottom + 10
    if (top + h > vh - 12) top = Math.max(12, draft.rect.top - h - 10)
    setPos({ top, left })
  }, [draft])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Add a comment"
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[10000] flex w-[min(360px,calc(100vw-24px))] flex-col gap-3 rounded-2xl border border-line bg-panel p-4 shadow-[0_18px_48px_-12px_rgba(20,22,45,0.45)]"
      onMouseUp={(e) => e.stopPropagation()}
    >
      <p className="line-clamp-2 text-[13px] italic text-paper-dim">“{draft.quote}”</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
        {COMMENT_CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={category === c.key}
            onClick={() => onCategory(c.key)}
            className={`focus-ring rounded-full px-2.5 py-1 text-[12px] font-semibold transition ${c.chip} ${
              category === c.key ? 'ring-2 ring-paper/70' : 'opacity-70 hover:opacity-100'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <textarea
        autoFocus
        rows={3}
        value={note}
        onChange={(e) => onNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave()
        }}
        placeholder="Your comment, e.g. “an increase” — article needed"
        className="focus-ring w-full resize-none rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
      />
      {error && <p className="text-[13px] text-urgent">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="focus-ring rounded-full px-3 py-1.5 text-sm text-mist hover:text-paper">
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="focus-ring rounded-full bg-brass px-4 py-1.5 text-sm font-semibold text-onbrass hover:bg-brass-dim disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Add comment'}
        </button>
      </div>
    </div>
  )
}
