import { useEffect, useRef } from 'react'

/*
 * Full-screen frame for an interactive practice page (2026-11-05).
 * Teachers said the page looked small inside the site and that "Back"
 * did nothing. Now:
 *   - the page fills the whole screen under one slim bar (back, title,
 *     score, and the main button);
 *   - the phone / browser Back button works: it first closes the page's
 *     own Workshop or pop-up window, and a second Back leaves the page.
 * The page itself keeps its real-test look; on phones the helper in
 * HtmlTask.jsx switches it to Passage / Questions tabs.
 */
export default function PageFrame({ title, kicker, html, error, onClose, score, status, action, badge = null }) {
  const frameRef = useRef(null)
  const overlayOpen = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Listen for the page telling us its Workshop / pop-up is open.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== frameRef.current?.contentWindow) return
      if (e.data && e.data.type === 'ielts-overlay') overlayOpen.current = Boolean(e.data.open)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Back button: one history step for this page.
  useEffect(() => {
    const marker = { ieltsPage: Date.now() }
    try {
      window.history.pushState(marker, '')
    } catch {
      /* ignore */
    }
    let leaving = false
    const mountedAt = Date.now()
    const onPop = () => {
      if (leaving) return
      if (overlayOpen.current) {
        frameRef.current?.contentWindow?.postMessage({ type: 'ielts-close-overlay' }, '*')
        overlayOpen.current = false
        try {
          window.history.pushState(marker, '')
        } catch {
          /* ignore */
        }
        return
      }
      leaving = true
      // onClose may say no (e.g. an essay not handed in): stay on the page.
      if (closeRef.current?.() === false) {
        leaving = false
        try {
          window.history.pushState(marker, '')
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener('popstate', onPop)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('popstate', onPop)
      document.body.style.overflow = prevOverflow
      // Closed with the on-screen button: take our history step back off.
      // (Not on React's quick test re-mount in development.)
      if (!leaving && Date.now() - mountedAt > 500 && window.history.state && window.history.state.ieltsPage === marker.ieltsPage) {
        leaving = true
        window.history.back()
      }
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink">
      <div className="registan-band flex shrink-0 items-center gap-2 px-2 py-2 text-white sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={() => onClose?.()}
          className="focus-ring flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] bg-white/15 px-3 text-sm font-extrabold text-white transition hover:bg-white/25"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="hidden sm:inline">Back</span>
        </button>
        <div className="min-w-0 flex-1">
          {kicker && <p className="hidden truncate text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/70 sm:block">{kicker}</p>}
          <p className="truncate text-[14px] font-extrabold text-white sm:text-[15px]">{title}</p>
        </div>
        {status && <p className="hidden max-w-[320px] truncate text-xs font-bold text-white/80 lg:block">{status}</p>}
        <span className={`grid h-10 min-w-[56px] shrink-0 place-items-center rounded-[12px] px-2.5 font-brand text-[15px] font-semibold ${score || badge ? 'bg-white text-[#13807c]' : 'bg-white/15 text-white/70'}`}>
          {badge || (score ? `${score.score}/${score.max}` : '—')}
        </span>
        {action}
      </div>
      {error && <p className="shrink-0 bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}
      <div className="min-h-0 flex-1 bg-white">
        {html ? (
          <iframe
            ref={frameRef}
            title={title || 'Practice page'}
            srcDoc={html}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className="block h-full w-full"
          />
        ) : (
          !error && <p className="p-6 text-sm font-semibold text-mist">Opening…</p>
        )}
      </div>
    </div>
  )
}
