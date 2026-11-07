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
 * 2026-11-07: works on phones (long-press selection) and on browsers
 * without the highlight API (yellow boxes painted under the words).
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
  const [menu, setMenu] = useState(null) // {x, y, mode: 'add'|'remove', range, below}
  // Browsers without the highlight API (iPhones before iOS 17.2, older
  // Android): we keep the ranges ourselves and paint yellow boxes under
  // them (2026-11-07).
  const own = useRef([])
  const [boxes, setBoxes] = useState([])

  const paint = () => {
    if (supported) return
    const root = ref.current
    if (!root) return
    const base = root.getBoundingClientRect()
    const out = []
    own.current = own.current.filter((r) => root.contains(r.startContainer) && root.contains(r.endContainer))
    for (const r of own.current) {
      for (const c of r.getClientRects()) {
        if (c.width < 1 || c.height < 1) continue
        out.push({ left: c.left - base.left + root.scrollLeft, top: c.top - base.top + root.scrollTop, width: c.width, height: c.height })
      }
    }
    setBoxes(out)
  }

  useEffect(() => {
    if (supported) return
    let raf = 0
    const again = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(paint)
    }
    window.addEventListener('resize', again)
    const mo = new MutationObserver(again)
    if (ref.current) mo.observe(ref.current, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', again)
      mo.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Phones select text with a long press, which sends no mouse-up: watch
  // the selection itself (2026-11-07).
  useEffect(() => {
    let t = 0
    const onSel = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        const root = ref.current
        const sel = window.getSelection()
        if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return
        const range = sel.getRangeAt(0)
        if (!root.contains(range.commonAncestorContainer)) return
        if (isEditable(range.startContainer) || isEditable(range.endContainer)) return
        if (!range.toString().trim()) return
        const rect = range.getBoundingClientRect()
        const touch = window.matchMedia?.('(pointer: coarse)').matches
        // On phones the menu goes under the words: the phone's own copy menu sits above.
        setMenu({ x: rect.left + rect.width / 2, y: touch ? rect.bottom : rect.top, below: Boolean(touch), mode: 'add', range: range.cloneRange() })
      }, 350)
    }
    document.addEventListener('selectionchange', onSel)
    return () => {
      clearTimeout(t)
      document.removeEventListener('selectionchange', onSel)
    }
  }, [])

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

  // Repaint our own boxes when anything scrolls inside the pane.
  useEffect(() => {
    if (supported) return
    const onScroll = () => requestAnimationFrame(paint)
    document.addEventListener('scroll', onScroll, true)
    return () => document.removeEventListener('scroll', onScroll, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const allRanges = () => {
    const root = ref.current
    if (!root) return []
    const list = supported ? [...(registry() || [])] : own.current
    return list.filter((r) => root.contains(r.commonAncestorContainer))
  }

  const onClick = (e) => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    // A tap or click on a highlight: offer to remove it.
    const caret = caretAt(e.clientX, e.clientY)
    if (!caret || isEditable(caret.node)) return
    for (const r of allRanges()) {
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
    if (!menu) return
    if (supported) {
      const hl = registry()
      if (!hl) return
      if (menu.mode === 'add') hl.add(menu.range)
      else hl.delete(menu.range)
    } else if (menu.mode === 'add') own.current = [...own.current, menu.range]
    else own.current = own.current.filter((r) => r !== menu.range)
    if (menu.mode === 'add') window.getSelection()?.removeAllRanges()
    setMenu(null)
    paint()
  }

  const clearAll = () => {
    if (supported) {
      const hl = registry()
      for (const r of allRanges()) hl?.delete(r)
    } else own.current = []
    setMenu(null)
    paint()
  }

  return (
    <div ref={ref} className={`relative ${className}`} onClick={onClick}>
      {!supported && boxes.length > 0 && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
          {boxes.map((b, i) => (
            <span key={i} className="absolute rounded-[2px]" style={{ ...b, background: 'rgba(255, 225, 77, 0.6)' }} />
          ))}
        </div>
      )}
      <div className="relative">{children}</div>
      {menu &&
        createPortal(
          <div
            data-hl-menu=""
            className={`fixed z-[10002] flex -translate-x-1/2 gap-1 rounded-lg bg-[#1f2340] p-1 text-[13px] text-white shadow-lg ${menu.below ? 'translate-y-2' : '-translate-y-full'}`}
            style={{ left: menu.x, top: menu.below ? menu.y : menu.y - 6 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button type="button" onClick={act} className="rounded-md px-3 py-1.5 text-white hover:bg-white/15">
              {menu.mode === 'add' ? 'Highlight' : 'Remove highlight'}
            </button>
            {menu.mode === 'remove' && (
              <button type="button" onClick={clearAll} className="rounded-md px-3 py-1.5 text-white hover:bg-white/15">
                Clear all
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
