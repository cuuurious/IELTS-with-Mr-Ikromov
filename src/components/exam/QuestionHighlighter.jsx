import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/*
 * Highlighting anywhere in the questions (2026-10-06). Students after
 * Mock #1: "couldn't highlight words in questions". The real test lets
 * you highlight any text, questions included; our highlighter only
 * covered the Reading passage.
 *
 * Uses the CSS Custom Highlight API: highlights are Range objects drawn
 * by the browser (::highlight(exam-hl) in index.css), so React's DOM is
 * never touched — the inputs and drop gaps inside the questions keep
 * working. Select text → "Highlight"; click highlighted text → "Remove".
 * Browsers without the API simply don't get the tool.
 *
 * In memory only for this sitting, like the passage highlights.
 */

const HL_NAME = 'exam-hl'
const supported = typeof window !== 'undefined' && typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'

function registry() {
  if (!supported) return null
  let hl = CSS.highlights.get(HL_NAME)
  if (!hl) {
    hl = new Highlight()
    CSS.highlights.set(HL_NAME, hl)
  }
  return hl
}

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  }
  return null
}

const isEditable = (node) => {
  const el = node?.nodeType === 1 ? node : node?.parentElement
  return Boolean(el?.closest?.('input, textarea, select, [contenteditable="true"], button, [data-drop]'))
}

export default function QuestionHighlighter({ children, className = '' }) {
  const ref = useRef(null)
  const [menu, setMenu] = useState(null) // {x, y, mode: 'add'|'remove', range}

  useEffect(() => {
    if (!menu) return
    const close = (e) => {
      if (e.target.closest?.('[data-hl-menu]')) return
      setMenu(null)
    }
    const onKey = (e) => e.key === 'Escape' && setMenu(null)
    const onScroll = () => setMenu(null)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [menu])

  // Drop this pane's highlights when it unmounts (end of the test).
  useEffect(
    () => () => {
      const hl = registry()
      const root = ref.current
      if (!hl || !root) return
      for (const r of [...hl]) if (root.contains(r.commonAncestorContainer)) hl.delete(r)
    },
    []
  )

  if (!supported) return <div className={className}>{children}</div>

  const onMouseUp = (e) => {
    if (e.button !== 0) return
    const root = ref.current
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      const range = sel.getRangeAt(0)
      if (!root.contains(range.commonAncestorContainer)) return
      if (isEditable(range.startContainer) || isEditable(range.endContainer)) return
      if (!range.toString().trim()) return
      const rect = range.getBoundingClientRect()
      setMenu({ x: rect.left + rect.width / 2, y: rect.top, mode: 'add', range: range.cloneRange() })
      return
    }
    // Plain click: on a highlight?
    const hl = registry()
    const caret = caretAt(e.clientX, e.clientY)
    if (!hl || !caret || isEditable(caret.node)) return
    for (const r of hl) {
      if (!root.contains(r.commonAncestorContainer)) continue
      try {
        if (r.isPointInRange(caret.node, caret.offset) && !r.collapsed) {
          setMenu({ x: e.clientX, y: e.clientY - 6, mode: 'remove', range: r })
          return
        }
      } catch {
        // node from another document/detached — ignore
      }
    }
  }

  const act = () => {
    const hl = registry()
    if (!hl || !menu) return
    if (menu.mode === 'add') {
      hl.add(menu.range)
      window.getSelection()?.removeAllRanges()
    } else {
      hl.delete(menu.range)
    }
    setMenu(null)
  }

  const clearAll = () => {
    const hl = registry()
    const root = ref.current
    if (!hl || !root) return
    for (const r of [...hl]) if (root.contains(r.commonAncestorContainer)) hl.delete(r)
    setMenu(null)
  }

  return (
    <div ref={ref} className={className} onMouseUp={onMouseUp}>
      {children}
      {menu &&
        createPortal(
          <div
            data-hl-menu=""
            className="fixed z-[10002] flex -translate-x-1/2 -translate-y-full gap-1 rounded-lg bg-[#1f2340] p-1 text-[13px] text-white shadow-lg"
            style={{ left: menu.x, top: menu.y - 6 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button type="button" onClick={act} className="rounded-md px-2.5 py-1 text-white hover:bg-white/15">
              {menu.mode === 'add' ? 'Highlight' : 'Remove highlight'}
            </button>
            {menu.mode === 'remove' && (
              <button type="button" onClick={clearAll} className="rounded-md px-2.5 py-1 text-white hover:bg-white/15">
                Clear all
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
