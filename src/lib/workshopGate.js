import { useEffect, useState } from 'react'

/*
 * Workshop gate for the thematic Reading pages (2026-11-05).
 * Mr Ikromov: students must finish the page's Workshop (word cards,
 * meaning match, translation match, use the words, paraphrase table,
 * evidence hunt) before the page counts as done and the score is taken.
 *
 * The helper inside the page (HtmlTask HELPER) reports which Workshop
 * tabs show a tick: { type: 'ielts-workshop-progress', total, done }.
 * Ticks are kept in this browser per student and page, so a student who
 * closes the page half-way keeps the parts already finished.
 */

export const needsWorkshop = (url, html) => /\/practice\/reading\//.test(url || '') && /id=["']ws-overlay["']/.test(html || '')

const keyFor = (url, studentId) => `ielts:workshop:${studentId || 'me'}:${url}`

function readSaved(key) {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) || 'null')
    if (v && Array.isArray(v.done)) return { total: Number(v.total) || null, done: v.done.map(String) }
  } catch {
    /* private window */
  }
  return { total: null, done: [] }
}

export function useWorkshopGate(url, studentId, on) {
  const key = keyFor(url, studentId)
  const [prog, setProg] = useState(() => readSaved(key))

  useEffect(() => {
    setProg(readSaved(key))
  }, [key])

  useEffect(() => {
    if (!on) return undefined
    const onMessage = (e) => {
      const d = e.data
      if (!d || d.type !== 'ielts-workshop-progress') return
      setProg((cur) => {
        const done = [...new Set([...cur.done, ...(Array.isArray(d.done) ? d.done.map((x) => String(x).slice(0, 60)) : [])])].slice(0, 12)
        const total = Number(d.total) > 0 ? Number(d.total) : cur.total
        const next = { total, done }
        try {
          window.localStorage.setItem(key, JSON.stringify(next))
        } catch {
          /* private window */
        }
        return next
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [on, key])

  const count = prog.done.length
  const complete = !on || (prog.total > 0 && count >= prog.total)
  const label = !on ? '' : prog.total ? `Workshop ${Math.min(count, prog.total)}/${prog.total}` : count ? `Workshop ${count} done` : 'Workshop not started'
  return { on, complete, count, total: prog.total, label }
}

// Ask the page to open its Workshop.
export function openWorkshop() {
  try {
    document.querySelector('iframe[data-ielts-page]')?.contentWindow?.postMessage({ type: 'ielts-open-workshop' }, '*')
  } catch {
    /* ignore */
  }
}
