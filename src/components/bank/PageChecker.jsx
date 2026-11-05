import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { withHelper } from '../homework/HtmlTask'

/*
 * PAGE CHECKER (2026-11-05). Opens each Reading / Listening practice page
 * out of sight, presses its own Submit and waits for the score the site
 * saves. Pages that never send a score (or can't be opened) are listed so
 * Mr Ikromov fixes them before a student meets them. Three at a time.
 */

const AUTO = `<script>(function(){window.confirm=function(){return true};window.alert=function(){};window.prompt=function(){return ''};
function vis(b){return b&&b.offsetParent!==null&&!b.disabled}
function go(){var b=document.getElementById('deliver-button');if(!vis(b))b=document.getElementById('submit');if(!vis(b))b=[].slice.call(document.querySelectorAll('button')).find(function(x){return vis(x)&&/^\\s*(submit|finish|check( my)? answers|end test)/i.test(x.textContent)});if(b)b.click();else if(typeof window.askSubmit==='function')window.askSubmit();
setTimeout(function(){var y=document.getElementById('yes');if(!vis(y))y=[].slice.call(document.querySelectorAll('button')).find(function(x){return vis(x)&&x!==b&&/^\\s*(yes|submit|confirm|finish)/i.test(x.textContent)});if(y)y.click()},400)}
document.addEventListener('DOMContentLoaded',function(){setTimeout(go,900)})})();</script>`

const WAIT_MS = 7000
const AT_ONCE = 3

export default function PageChecker({ pages, onClose, onPreview }) {
  const list = useMemo(() => (pages || []).filter((p) => /^\/practice\/(reading|listening)/.test(p.url || '')), [pages])
  const collections = useMemo(() => [...new Set(list.map((p) => p.collection).filter(Boolean))].sort(), [list])
  const [collection, setCollection] = useState('')
  const [results, setResults] = useState({}) // url -> { ok, score, max, error }
  const [running, setRunning] = useState(false)
  const [slots, setSlots] = useState([]) // [{ id, page, html }]
  const stopRef = useRef(false)
  const waiters = useRef({}) // slot id -> resolve

  const chosen = collection ? list.filter((p) => p.collection === collection) : list

  useEffect(() => {
    const onMessage = (e) => {
      const d = e.data
      if (!d || d.type !== 'ielts-workshop-score') return
      const frame = [...document.querySelectorAll('iframe[data-checker]')].find((f) => f.contentWindow === e.source)
      const id = frame?.dataset.checker
      if (id && waiters.current[id]) waiters.current[id]({ ok: Number(d.max) > 0, score: Number(d.score), max: Number(d.max) })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const checkOne = (slotId, page) =>
    new Promise((resolve) => {
      let finished = false
      const end = (r) => {
        if (finished) return
        finished = true
        delete waiters.current[slotId]
        resolve(r)
      }
      waiters.current[slotId] = end
      fetch(page.url)
        .then((r) => {
          if (!r.ok) throw new Error(`file missing (${r.status})`)
          return r.text()
        })
        .then((text) => {
          const html = withHelper(text).replace(/<head[^>]*>/i, (m) => `${m}${AUTO}`)
          setSlots((s) => s.map((x) => (x.id === slotId ? { ...x, page, html, key: Date.now() } : x)))
          setTimeout(() => end({ ok: false, error: 'no score after Submit' }), WAIT_MS)
        })
        .catch((e) => end({ ok: false, error: e.message }))
    })

  const run = async () => {
    stopRef.current = false
    setRunning(true)
    setResults({})
    const queue = [...chosen]
    const ids = Array.from({ length: Math.min(AT_ONCE, queue.length) }, (_, i) => `s${i}`)
    setSlots(ids.map((id) => ({ id, page: null, html: '' })))
    await Promise.all(
      ids.map(async (id) => {
        while (queue.length && !stopRef.current) {
          const page = queue.shift()
          const r = await checkOne(id, page)
          setResults((m) => ({ ...m, [page.url]: r }))
        }
      })
    )
    setSlots([])
    setRunning(false)
  }

  const done = Object.keys(results).length
  const bad = chosen.filter((p) => results[p.url] && !results[p.url].ok)
  const zeroMax = chosen.filter((p) => results[p.url]?.ok && results[p.url].max < 3)

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-ink/70 sm:items-center sm:p-4" onClick={running ? undefined : onClose}>
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-t-[24px] bg-panel p-4 sm:rounded-[24px] sm:p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Check pages">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-brand text-[20px] font-semibold text-paper">Check pages</p>
            <p className="text-[13px] font-semibold text-mist">Each page is opened out of sight and its own Submit is pressed. A page that sends no score would give students no mark.</p>
          </div>
          <button type="button" onClick={onClose} disabled={running} className="focus-ring h-10 rounded-[12px] bg-panel-2 px-3 text-sm font-extrabold text-paper disabled:opacity-50">Close</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={collection} onChange={(e) => setCollection(e.target.value)} disabled={running} className="focus-ring h-10 min-w-0 flex-1 rounded-[12px] border border-line bg-panel-2 px-2 text-[14px] font-bold text-paper sm:max-w-sm" aria-label="Book">
            <option value="">All Reading and Listening pages ({list.length})</option>
            {collections.map((c) => (
              <option key={c} value={c}>{c} ({list.filter((p) => p.collection === c).length})</option>
            ))}
          </select>
          {running ? (
            <button type="button" onClick={() => (stopRef.current = true)} className="focus-ring h-10 rounded-[12px] bg-urgent-tint px-4 text-[13px] font-extrabold text-coral">Stop</button>
          ) : (
            <button type="button" onClick={run} disabled={!chosen.length} className="focus-ring h-10 rounded-[12px] bg-saffron px-4 text-[13px] font-extrabold text-[#17213a] disabled:opacity-50">
              Check {chosen.length} page{chosen.length === 1 ? '' : 's'}
            </button>
          )}
          <span className="text-[12px] font-bold text-mist">about {Math.max(1, Math.round((chosen.length * 3) / AT_ONCE / 60))} min</span>
        </div>
        {(running || done > 0) && (
          <div className="flex flex-col gap-1.5">
            <div className="h-2 overflow-hidden rounded bg-panel-2">
              <div className="h-full rounded bg-brass transition-all" style={{ width: `${chosen.length ? (100 * done) / chosen.length : 0}%` }} />
            </div>
            <p className="text-[13px] font-bold text-paper">
              {done} of {chosen.length} checked · <span className="text-reading">{done - bad.length} fine</span>
              {bad.length ? <span className="text-coral"> · {bad.length} with a problem</span> : ''}
            </p>
          </div>
        )}
        {bad.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {bad.map((p) => (
              <li key={p.url} className="flex min-w-0 items-center gap-2 rounded-[12px] bg-urgent-tint/50 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-extrabold text-paper">{p.title}</span>
                  <span className="block truncate text-[12px] font-semibold text-coral">{results[p.url].error} · {p.collection}</span>
                </span>
                {onPreview && (
                  <button type="button" onClick={() => onPreview(p)} disabled={running} className="focus-ring h-8 shrink-0 rounded-[10px] bg-panel px-2.5 text-[12px] font-extrabold text-brass disabled:opacity-50">Open</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {zeroMax.length > 0 && (
          <p className="text-[12px] font-bold text-amber">
            Check these too — the score is out of fewer than 3: {zeroMax.map((p) => p.title).join(', ')}
          </p>
        )}
        {!running && done > 0 && !bad.length && <p className="rounded-[14px] bg-reading-tint px-4 py-3 text-sm font-extrabold text-reading">Every page sends its score ✓</p>}
        {/* The pages being checked, out of sight */}
        <div aria-hidden="true" className="pointer-events-none fixed left-[-4000px] top-0 h-[700px] w-[1100px] overflow-hidden opacity-0">
          {slots.map((s) =>
            s.html ? <iframe key={`${s.id}-${s.key}`} data-checker={s.id} title="check" srcDoc={s.html} sandbox="allow-scripts allow-forms allow-modals" className="h-[700px] w-[1100px]" /> : null
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
