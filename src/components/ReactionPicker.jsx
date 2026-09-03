import { useEffect, useRef } from 'react'

/*
 * The floating "pick a reaction" bar that opens from a message's "+"
 * button — the same fixed-position/outside-click pattern as
 * MessageActionMenu.jsx, applied to a horizontal emoji row instead of
 * a list of actions.
 *
 * This replaces an earlier version built with a native
 * <details>/<summary> element, which had no way to close itself: it
 * stayed open after you picked an emoji, and clicking anywhere else
 * on the page didn't dismiss it either (that's just how <details>
 * works — only its own <summary> toggles it). Being a real floating,
 * controlled popup instead fixes both: picking an emoji closes it
 * immediately, and so does clicking elsewhere, scrolling, resizing,
 * or pressing Escape.
 *
 * Props:
 *   position   - { top, left } in screen pixels, or null to stay closed.
 *   reactions  - array of emoji strings to offer.
 *   onPick     - called with the chosen emoji.
 *   onClose    - called whenever the picker should close.
 */
export default function ReactionPicker({
  position,
  reactions,
  onPick,
  onClose,
}) {
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!position) return

    const handlePointerDown = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        onClose()
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }

    // Closing on scroll (rather than trying to re-track the anchor)
    // keeps this simple and avoids the picker drifting away from the
    // "+" it was opened from — same call MessageActionMenu makes.
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

  if (!position || !reactions?.length) return null

  return (
    <div
      ref={pickerRef}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
      }}
      className="z-[200] flex gap-1 rounded-2xl border border-line bg-panel p-1.5 shadow-2xl"
    >
      {reactions.map((reaction) => (
        <button
          key={reaction}
          type="button"
          onClick={() => {
            onClose()
            onPick(reaction)
          }}
          className="focus-ring flex h-9 w-9 items-center justify-center rounded-xl text-lg transition hover:bg-panel-2"
        >
          {reaction}
        </button>
      ))}
    </div>
  )
}
