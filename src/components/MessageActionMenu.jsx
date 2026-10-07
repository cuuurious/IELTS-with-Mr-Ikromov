import { useEffect, useRef } from 'react'

/*
 * A real Telegram-style message menu: a small floating card that pops
 * up wherever there's room near the "⋯" you tapped, with an icon next
 * to each action. Used by both Chat.jsx and GroupChat.jsx.
 *
 * Unlike a plain dropdown nested inside the message list, this is
 * positioned relative to the whole screen (not the chat panel it was
 * opened from), so it can never get clipped or hidden behind the
 * conversation list next to it — which is what was happening before.
 *
 * Props:
 *   position - { top, left } in screen pixels, or null to stay closed.
 *               The caller works out where that is (see openMenuAt in
 *               Chat.jsx / GroupChat.jsx).
 *   items    - array of { key, label, icon, onClick, danger, divider }.
 *              `divider: true` draws a thin separator above that item,
 *              same as Telegram grouping destructive actions apart
 *              from the rest. `danger: true` colors the row red.
 *   onClose  - called when the menu should close (an action was
 *              picked, the user clicked elsewhere, scrolled, resized,
 *              or pressed Escape).
 */
export default function MessageActionMenu({
  position,
  items,
  onClose,
}) {
  const menuRef = useRef(null)

  useEffect(() => {
    if (!position) return

    const handlePointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }

    // Closing on scroll (rather than trying to re-track the anchor)
    // keeps this simple and avoids the menu drifting away from the
    // "⋯" it was opened from.
    const handleScroll = () => onClose()

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [position, onClose])

  if (!position || !items?.length) return null

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: 212,
      }}
      className="z-[200] overflow-hidden rounded-2xl border border-line bg-panel p-1.5 text-[13.5px] shadow-[0_18px_44px_-18px_rgba(31,35,64,0.4)] wp-pop"
    >
      {items.map((item, index) => (
        <div key={item.key || index}>
          {item.divider && (
            <div className="mx-2 my-1 border-t border-line" />
          )}

          <button
            type="button"
            onClick={() => {
              onClose()
              item.onClick?.()
            }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
              item.danger
                ? 'text-urgent hover:bg-urgent-tint'
                : 'text-paper hover:bg-panel-2'
            }`}
          >
            <span
              className={`flex w-4 shrink-0 items-center justify-center leading-none ${
                item.danger ? '' : 'text-mist'
              }`}
            >
              {item.icon}
            </span>

            <span className="flex-1 truncate">
              {item.label}
            </span>
          </button>
        </div>
      ))}
    </div>
  )
}
