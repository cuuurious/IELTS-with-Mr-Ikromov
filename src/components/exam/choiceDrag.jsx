import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/*
 * DRAG ENGINE for matching questions (2026-10-06).
 *
 * Replaces native HTML5 drag-and-drop, which caused most of Mock #1's
 * complaints:
 *   - while a native drag is held, the mouse wheel does not scroll, so
 *     gaps below the fold (Listening Q15, Q28–30; Reading Q23–26) could
 *     never be reached;
 *   - a dropped option could not be dragged back out or moved.
 *
 * This version uses Pointer Events, which leave the wheel alone, and
 * works the way the real computer-delivered test (Inspera) does:
 *   - drop an option on an empty gap → it fills the gap and leaves the bank;
 *   - drop on a filled gap → it replaces it; the old option returns to
 *     the bank in its original place;
 *   - drag a filled gap onto another gap → the answer moves;
 *   - drag a filled gap back to the bank → the gap is cleared.
 * Near the top/bottom edge of a scrolling pane, the pane scrolls by itself.
 * Escape cancels a drag. A plain click still works as before (the
 * caller's own onClick), so tapping on a phone keeps working too.
 *
 * Markup contract:
 *   data-drop="q:<questionId>"  — a gap
 *   data-drop="bank"            — any option bank (drop here = clear)
 * The provider only reports {choice, from, target}; the exam decides
 * what that means (see handleChoiceDrop in MockExams.jsx).
 */

const DragContext = createContext(null)

const START_DISTANCE = 5 // px before a press becomes a drag
const EDGE = 56 // px from a pane edge where auto-scroll starts
const MAX_SPEED = 18 // px per frame

function scrollableAncestor(el) {
  let node = el
  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node)
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node
    }
    node = node.parentElement
  }
  return null
}

export function ChoiceDragProvider({ onDrop, children }) {
  const [active, setActive] = useState(null) // {choice, from} while dragging
  const stateRef = useRef(null)
  const ghostRef = useRef(null)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop
  const suppressClickRef = useRef(false)

  const setOver = (el) => {
    const s = stateRef.current
    if (!s) return
    if (s.overEl === el) return
    if (s.overEl) s.overEl.removeAttribute('data-drag-over')
    s.overEl = el
    if (el) el.setAttribute('data-drag-over', '')
  }

  const hitTest = () => {
    const s = stateRef.current
    if (!s) return
    const under = document.elementFromPoint(s.x, s.y)
    const target = under?.closest?.('[data-drop]') || null
    setOver(target)
    s.underEl = under
  }

  const autoScrollLoop = () => {
    const s = stateRef.current
    if (!s || !s.dragging) return
    const pane = s.underEl ? scrollableAncestor(s.underEl) : null
    if (pane) {
      const rect = pane.getBoundingClientRect()
      let dy = 0
      if (s.y < rect.top + EDGE) dy = -Math.ceil(((rect.top + EDGE - s.y) / EDGE) * MAX_SPEED)
      else if (s.y > rect.bottom - EDGE) dy = Math.ceil(((s.y - (rect.bottom - EDGE)) / EDGE) * MAX_SPEED)
      if (dy) {
        pane.scrollTop += dy
        hitTest()
      }
    }
    s.raf = requestAnimationFrame(autoScrollLoop)
  }

  const finish = useCallback((commit) => {
    const s = stateRef.current
    if (!s) return
    window.removeEventListener('pointermove', s.onMove)
    window.removeEventListener('pointerup', s.onUp)
    window.removeEventListener('pointercancel', s.onCancel)
    window.removeEventListener('keydown', s.onKey, true)
    document.removeEventListener('scroll', s.onScroll, true)
    if (s.raf) cancelAnimationFrame(s.raf)
    const target = s.overEl?.getAttribute('data-drop') || null
    setOver(null)
    if (s.dragging) {
      document.documentElement.classList.remove('choice-dragging')
      if (ghostRef.current) ghostRef.current.style.display = 'none'
      setActive(null)
      // The browser fires a click after pointerup on the pressed element;
      // a finished drag must not also count as a click.
      suppressClickRef.current = true
      setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      if (commit && target) onDropRef.current?.({ choice: s.choice, from: s.from, target })
    }
    stateRef.current = null
  }, [])

  useEffect(() => () => finish(false), [finish])

  const begin = useCallback(
    (e, { choice, from = null, label }) => {
      if (e.button !== undefined && e.button !== 0) return
      if (stateRef.current) finish(false)
      // Stops text selection starting under the pointer (mouse/pen only —
      // a touch press must still be able to become a tap).
      if (e.pointerType !== 'touch') e.preventDefault()

      const s = {
        choice,
        from,
        label: label ?? choice,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        dragging: false,
        overEl: null,
        underEl: null,
        raf: 0,
        sourceWidth: e.currentTarget.getBoundingClientRect().width,
      }

      s.onMove = (ev) => {
        s.x = ev.clientX
        s.y = ev.clientY
        if (!s.dragging) {
          if (Math.hypot(s.x - s.startX, s.y - s.startY) < START_DISTANCE) return
          s.dragging = true
          document.documentElement.classList.add('choice-dragging')
          const ghost = ghostRef.current
          if (ghost) {
            ghost.textContent = s.label
            ghost.style.maxWidth = `${Math.min(Math.max(s.sourceWidth, 160), 420)}px`
            ghost.style.display = 'block'
          }
          setActive({ choice: s.choice, from: s.from })
          s.raf = requestAnimationFrame(autoScrollLoop)
        }
        if (ghostRef.current) ghostRef.current.style.transform = `translate(${s.x + 12}px, ${s.y + 10}px)`
        hitTest()
      }
      s.onUp = () => finish(true)
      s.onCancel = () => finish(false)
      s.onKey = (ev) => {
        if (ev.key === 'Escape' && s.dragging) {
          ev.preventDefault()
          ev.stopPropagation()
          finish(false)
        }
      }
      // Wheel-scrolling a pane moves what is under the pointer without a
      // pointermove — re-check the target whenever anything scrolls.
      s.onScroll = () => {
        if (s.dragging) hitTest()
      }

      stateRef.current = s
      window.addEventListener('pointermove', s.onMove)
      window.addEventListener('pointerup', s.onUp)
      window.addEventListener('pointercancel', s.onCancel)
      window.addEventListener('keydown', s.onKey, true)
      document.addEventListener('scroll', s.onScroll, true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finish]
  )

  const value = useMemo(
    () => ({ begin, active, shouldSuppressClick: () => suppressClickRef.current }),
    [begin, active]
  )

  return (
    <DragContext.Provider value={value}>
      {children}
      <div
        ref={ghostRef}
        aria-hidden="true"
        className="choice-drag-ghost"
        style={{ display: 'none' }}
      />
    </DragContext.Provider>
  )
}

/*
 * Props for anything that can be picked up: a bank option (from = null)
 * or a filled gap (from = that question's id). `onClick` still runs for a
 * plain click/tap that never turned into a drag.
 */
export function useChoiceDragSource() {
  const ctx = useContext(DragContext)
  return useCallback(
    ({ choice, from = null, label, onClick }) => {
      if (!ctx) return { onClick }
      return {
        onPointerDown: (e) => ctx.begin(e, { choice, from, label }),
        onClick: (e) => {
          if (ctx.shouldSuppressClick()) {
            e.preventDefault()
            return
          }
          onClick?.(e)
        },
        // Callers add `touch-none` so a finger-drag moves the option
        // instead of scrolling the page.
        'data-dragging': ctx.active && ctx.active.choice === choice && ctx.active.from === from ? '' : undefined,
      }
    },
    [ctx]
  )
}

export function useActiveChoiceDrag() {
  return useContext(DragContext)?.active || null
}
