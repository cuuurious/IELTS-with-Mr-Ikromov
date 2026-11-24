import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { workshopWords } from '../../lib/workshopGate'
import { fetchRuMap, ruKey } from '../../lib/russian'
import { reportError } from '../../lib/errorReporter'
import { supabase } from '../../lib/supabaseClient'

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
/*
 * AUTOSAVE (2026-11-09). Phones often reload a page left in the
 * background (another app, another tab), and the student's answers were
 * gone. The page (HELPER in HtmlTask.jsx) sends its answers here; they are
 * kept on this device for this student for 3 days and handed back when the
 * same page opens again. Handing in clears them (forgetAutosave).
 */
const AUTOSAVE_DAYS = 14
function pageHash(html) {
  let h = 5381
  const s = String(html || '')
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${s.length.toString(36)}-${(h >>> 0).toString(36)}`
}
const autosaveKey = (userId, html) => `ielts-autosave:${userId || 'guest'}:${pageHash(html)}`
export function forgetAutosave(userId, html) {
  try {
    localStorage.removeItem(autosaveKey(userId, html))
  } catch {
    /* ignore */
  }
}

/*
 * Server copy of the autosave (2026-11-24, migration 145): the same answers are
 * also saved in homework_drafts, so a break, a closed tab, cleared browser data
 * or another phone no longer loses them. Best-effort: the device copy still works
 * when the connection is down.
 */
export async function deleteDraft(taskId) {
  if (!taskId) return
  try {
    await supabase.from('homework_drafts').delete().eq('task_id', taskId)
  } catch {
    /* ignore */
  }
}
const fetchDraft = (taskId) =>
  Promise.race([
    supabase
      .from('homework_drafts')
      .select('data, updated_at')
      .eq('task_id', taskId)
      .maybeSingle()
      .then(({ data }) => (data ? { at: Date.parse(data.updated_at) || 0, data: data.data } : null), () => null),
    new Promise((res) => setTimeout(() => res(null), 3000)),
  ])

export default function PageFrame({ title, kicker, html, error, onClose, score, status, action, badge = null, cover = null, onCloseCover = null, mic = false, draftId = null }) {
  // `cover`: a panel shown over the page (e.g. AI feedback); Back closes it first.
  const frameRef = useRef(null)
  const { profile } = useAuth()
  const userRef = useRef(null)
  userRef.current = profile?.id || null

  // Russian for the Workshop word cards (2026-11-07): looked up once,
  // sent to the page when it is ready (and again if it reloads).
  const ruRef = useRef(null)
  useEffect(() => {
    ruRef.current = null
    const words = workshopWords(html || '')
    if (!words.length) return undefined
    let on = true
    fetchRuMap(words.map((w) => ({ word: w.word, df: w.definition, uz: w.uzbek_translation }))).then((got) => {
      if (!on) return
      const map = {}
      for (const w of words) {
        const ru = got[ruKey(w.word)]
        if (ru && w.uzbek_translation) map[w.uzbek_translation.trim()] = ru
      }
      if (!Object.keys(map).length) return
      ruRef.current = map
      frameRef.current?.contentWindow?.postMessage({ type: 'ielts-ru', map }, '*')
    })
    return () => {
      on = false
    }
  }, [html])
  const draftRef = useRef(draftId)
  draftRef.current = draftId
  const draftTimer = useRef(0)
  const draftData = useRef('')
  const htmlRef = useRef(html)
  htmlRef.current = html
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
      if (e.data && e.data.type === 'ielts-ready' && ruRef.current) e.source.postMessage({ type: 'ielts-ru', map: ruRef.current }, '*')
      // Audio that would not start or load (HELPER's audio safety net).
      if (e.data && e.data.type === 'ielts-audio-problem') {
        const d = e.data
        reportError({ message: `Listening audio (${String(d.kind).slice(0, 10)}): ${String(d.name).slice(0, 40)} ${String(d.msg).slice(0, 160)}`.trim(), stack: `audio file: ${String(d.src || '').slice(0, 80)}` }, '', { always: true })
      }
      // Autosave: hand the saved answers back (or "nothing saved") when the
      // page is ready; keep new ones as the student works.
      // (Writing Lab pages keep their own progress, so they are left out.)
      if (e.data && (e.data.type === 'ielts-ready' || e.data.type === 'ielts-autosave') && !String(htmlRef.current || '').includes('ielts-lab-load')) {
        const key = autosaveKey(userRef.current, htmlRef.current)
        if (e.data.type === 'ielts-ready') {
          let data = ''
          let at = 0
          try {
            const saved = JSON.parse(localStorage.getItem(key) || 'null')
            if (saved && Date.now() - saved.at < AUTOSAVE_DAYS * 864e5) {
              data = saved.data
              at = saved.at
            } else if (saved) localStorage.removeItem(key)
          } catch {
            /* ignore */
          }
          const target = e.source
          const send = (d) => target.postMessage({ type: 'ielts-autosave-state', data: d }, '*')
          if (draftRef.current) {
            // The newer of the device copy and the server copy wins.
            fetchDraft(draftRef.current).then((remote) => {
              send(remote && remote.at > at && remote.data ? remote.data : data)
            })
          } else send(data)
        } else {
          try {
            const data = typeof e.data.data === 'string' ? e.data.data : ''
            if (!data) localStorage.removeItem(key)
            else if (data.length < 400000) localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
          } catch {
            /* storage full or blocked */
          }
          // Also keep a copy on the server (at most one save every 5 seconds).
          if (draftRef.current && typeof e.data.data === 'string' && e.data.data && e.data.data.length < 400000) {
            draftData.current = e.data.data
            if (!draftTimer.current) {
              draftTimer.current = window.setTimeout(() => {
                draftTimer.current = 0
                if (!draftRef.current || !draftData.current) return
                supabase
                  .from('homework_drafts')
                  .upsert({ task_id: draftRef.current, data: draftData.current, updated_at: new Date().toISOString() }, { onConflict: 'student_id,task_id' })
                  .then(() => {}, () => {})
              }, 5000)
            }
          }
        }
      }
      // Writing Lab pages (2026-11-07): the sealed page can't keep its own
      // progress, so the site keeps it for this student on this device.
      const d = e.data
      if (d && (d.type === 'ielts-lab-load' || d.type === 'ielts-lab-save') && /^[a-z0-9-]{1,40}$/.test(String(d.id || ''))) {
        const key = `ielts-lab:${userRef.current || 'guest'}:${d.id}`
        if (d.type === 'ielts-lab-save') {
          try {
            if (typeof d.data === 'string' && d.data.length < 500000) localStorage.setItem(key, d.data)
          } catch {
            /* storage full or blocked */
          }
        } else {
          let data = null
          try {
            data = localStorage.getItem(key)
          } catch {
            /* ignore */
          }
          const attr = document.documentElement.getAttribute('data-theme')
          const dark = attr === 'dark' || (attr !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
          e.source.postMessage({ type: 'ielts-lab-state', id: d.id, data, theme: dark ? 'dark' : 'light' }, '*')
        }
      }
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
            sandbox={mic ? 'allow-scripts allow-forms allow-modals allow-popups allow-same-origin' : 'allow-scripts allow-forms allow-modals allow-popups'}
            allow={mic ? 'microphone; autoplay; fullscreen' : undefined}
            className="block h-full w-full"
          />
        ) : (
          !error && <p className="p-6 text-sm font-semibold text-mist">Opening…</p>
        )}
      </div>
    </div>
  )
}
