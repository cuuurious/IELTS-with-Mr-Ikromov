import { useEffect, useRef, useState } from 'react'

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
export default function PageFrame({ title, kicker, html, error, onClose, score, status, action, badge = null, cover = null, onCloseCover = null }) {
  // `cover`: a panel shown over the page (e.g. AI feedback); Back closes it first.
  const frameRef = useRef(null)
  const overlayOpen = useRef(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const coverRef = useRef(null)
  coverRef.current = cover ? onCloseCover : null

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
      if (coverRef.current) {
        coverRef.current()
        try {
          window.history.pushState(marker, '')
        } catch {
          /* ignore */
        }
        return
      }
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

  // Laptops: the browser's own full screen hides the tabs and address bar,
  // like the real computer test (2026-11-05).
  const rootRef = useRef(null)
  const [full, setFull] = useState(false)
  const canFull = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)
  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [])
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else rootRef.current?.requestFullscreen?.().catch(() => {})
  }

  return (
    <div ref={rootRef} className="fixed inset-0 z-[70] flex flex-col bg-ink">
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
        {canFull && (
          <button
            type="button"
            onClick={toggleFull}
            aria-label={full ? 'Leave full screen' : 'Full screen'}
            title={full ? 'Leave full screen (Esc)' : 'Full screen'}
            className="focus-ring hidden h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/15 text-white transition hover:bg-white/25 md:grid"
          >
            <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </svg>
          </button>
        )}
        {action}
      </div>
      {error && <p className="shrink-0 bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}
      {cover && <div className="min-h-0 flex-1 overflow-y-auto bg-ink">{cover}</div>}
      <div className={`min-h-0 flex-1 bg-white ${cover ? 'hidden' : ''}`}>
        {html ? (
          <iframe
            ref={frameRef}
            data-ielts-page="1"
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
