import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadHref } from './FileActions'

/*
 * HTML FILE VIEWER (2026-10-07)
 *
 * Supabase Storage never serves .html files as web pages — it sends
 * them as plain text (a safety rule on their side), so tapping an .html
 * homework / material / chat file showed its source code instead of the
 * page. Many of the teacher's practice tests are single .html files.
 *
 * This host is mounted once (App.jsx). It catches a click on ANY link to
 * an .html/.htm file in our Supabase storage, anywhere in the app, and
 * opens it here instead: the file is downloaded as text and shown in a
 * full-screen frame.
 *
 * Safety: the frame is sandboxed WITHOUT allow-same-origin, so the
 * file's scripts run (quizzes, timers, answer checking work) but can't
 * see the site, the login or anything stored for it. Because a
 * sandboxed page can't use localStorage, a tiny in-memory replacement
 * is put in first so tests that save progress there don't crash.
 */

const HTML_PATH = /\.html?$/i
const STORAGE_PATH = /\/storage\/v1\/object\//

export function isStorageHtmlUrl(href) {
  if (!href) return false
  try {
    const u = new URL(href, window.location.href)
    return HTML_PATH.test(decodeURIComponent(u.pathname)) && STORAGE_PATH.test(u.pathname)
  } catch {
    return false
  }
}

export function openHtmlFile(url, name) {
  window.dispatchEvent(new CustomEvent('open-html-file', { detail: { url, name } }))
}

const STORAGE_SHIM = `<script>(function(){function S(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}['localStorage','sessionStorage'].forEach(function(n){try{Object.defineProperty(window,n,{value:S(),configurable:true})}catch(e){}})})();</script>`

function withShim(html) {
  const text = String(html || '')
  // Right after <head> (or at the very start) so it runs before the page's own scripts.
  if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (m) => `${m}${STORAGE_SHIM}<meta charset="utf-8">`)
  if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (m) => `${m}<head>${STORAGE_SHIM}<meta charset="utf-8"></head>`)
  return `<!doctype html><html><head>${STORAGE_SHIM}<meta charset="utf-8"></head><body>${text}</body></html>`
}

function nameFromUrl(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
    // Storage names look like "1791181630654-e21gel-ielts_reading_iq_scores.html"
    return last.replace(/^\d{10,}-[a-z0-9]{4,8}-/i, '').replace(/[_-]+/g, ' ').replace(/\.html?$/i, '').trim() || 'Page'
  } catch {
    return 'Page'
  }
}

function Viewer({ url, name, onClose }) {
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError('')
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => {
        if (cancelled) return
        setDoc(withShim(new TextDecoder('utf-8').decode(buf)))
      })
      .catch(() => {
        if (!cancelled) setError('Could not open this page. Check the internet connection and try again.')
      })
    return () => {
      cancelled = true
    }
  }, [url])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex flex-col bg-ink" role="dialog" aria-modal="true" aria-label={name}>
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-3 py-2 sm:px-5">
        <button
          type="button"
          onClick={onClose}
          className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-paper hover:bg-panel-2"
          aria-label="Close"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-paper">{name}</p>
        <a
          href={downloadHref(url, /\.html?$/i.test(name) ? name : `${name}.html`)}
          download
          className="focus-ring hidden shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm font-medium text-paper hover:bg-panel-2 sm:inline-flex"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12m0 0-5-5m5 5 5-5M4 21h16" />
          </svg>
          Download
        </a>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {!doc && !error && <p className="p-6 text-sm text-[#5e6378]">Opening…</p>}
        {error && <p className="p-6 text-sm text-[#b23a22]">{error}</p>}
        {doc && (
          <iframe
            title={name}
            srcDoc={doc}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
            className="absolute inset-0 h-full w-full border-0 bg-white"
          />
        )}
      </div>
    </div>,
    document.body
  )
}

export default function HtmlFileViewerHost() {
  const [open, setOpen] = useState(null) // {url, name}

  useEffect(() => {
    const onOpen = (e) => setOpen({ url: e.detail.url, name: e.detail.name || nameFromUrl(e.detail.url) })
    // Any link to an .html file in our storage, anywhere in the app.
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = e.target.closest?.('a[href]')
      if (!a || a.hasAttribute('download')) return
      const href = a.getAttribute('href')
      if (!isStorageHtmlUrl(href)) return
      e.preventDefault()
      setOpen({ url: new URL(href, window.location.href).href, name: a.dataset.fileName || nameFromUrl(href) })
    }
    window.addEventListener('open-html-file', onOpen)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('open-html-file', onOpen)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  if (!open) return null
  return <Viewer url={open.url} name={open.name} onClose={() => setOpen(null)} />
}
