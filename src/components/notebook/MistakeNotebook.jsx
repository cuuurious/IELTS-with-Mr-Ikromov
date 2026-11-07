import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPage } from '../../lib/fetchPage'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { cleanQs, withHelper } from '../homework/HtmlTask'
import PageFrame from '../homework/PageFrame'
import { qtypeLabel } from '../../lib/questionTypes'

/*
 * MISTAKE NOTEBOOK (2026-11-05, migration_107). Every Reading / Listening
 * question a student got wrong on a practice page (homework or the Books
 * page) waits here. "Fix" reopens the page with the old mistakes circled
 * in red; only those questions count, and each one answered right leaves
 * the notebook.
 */

export function useNotebook(studentId) {
  const [pages, setPages] = useState(null)
  const load = async () => {
    const { data, error } = await supabase
      .from('mistake_pages')
      .select('url, title, skill, question_type, wrong, fixed, updated_at')
      .eq('user_id', studentId)
      .order('updated_at', { ascending: false })
    // Before migration_107 there is no notebook: show nothing.
    setPages(error ? false : data || [])
  }
  useEffect(() => {
    if (studentId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId])
  return [pages, load]
}

export function NotebookCard({ studentId, className = '' }) {
  const [pages, reload] = useNotebook(studentId)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onOpen = (e) => e.detail === 'notebook' && setOpen(true)
    window.addEventListener('ielts:open', onOpen)
    return () => window.removeEventListener('ielts:open', onOpen)
  }, [])
  if (!pages) return null
  const todo = pages.filter((p) => p.wrong?.length)
  const count = todo.reduce((n, p) => n + p.wrong.length, 0)
  const fixed = pages.reduce((n, p) => n + (p.fixed || 0), 0)
  if (!count && !fixed) return null
  return (
    <>
      <section className={`flex items-center gap-3 rounded-[20px] border border-line bg-panel p-3 sm:gap-4 sm:p-4 ${className}`}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-urgent-tint text-coral" aria-hidden="true">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
            <path d="M5 17a3 3 0 0 1 3-3h11M9.5 7.5l4 4m0-4-4 4" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-coral">Mistake notebook</p>
          <p className="truncate text-[15px] font-extrabold text-paper">{count ? `${count} question${count === 1 ? '' : 's'} to fix` : 'Nothing to fix ✓'}</p>
          <p className="truncate text-[12px] font-bold text-mist">
            {todo.length ? `on ${todo.length} page${todo.length === 1 ? '' : 's'}` : 'Great work'}
            {fixed ? ` · ${fixed} fixed so far` : ''}
          </p>
        </div>
        {count > 0 && (
          <button type="button" onClick={() => setOpen(true)} className="focus-ring h-10 shrink-0 rounded-[12px] bg-panel-2 px-3.5 text-[13px] font-extrabold text-paper hover:brightness-95">
            Fix them
          </button>
        )}
      </section>
      {open && createPortal(<NotebookList pages={todo} studentId={studentId} onClose={() => { setOpen(false); reload() }} />, document.body)}
    </>
  )
}

function NotebookList({ pages, studentId, onClose }) {
  const [list, setList] = useState(pages)
  const [play, setPlay] = useState(null)
  const bySkill = useMemo(() => {
    const m = {}
    list.filter((p) => p.wrong?.length).forEach((p) => (m[p.skill || 'reading'] = [...(m[p.skill || 'reading'] || []), p]))
    return Object.entries(m)
  }, [list])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !play && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [play, onClose])

  if (play) {
    return (
      <NotebookPlayer
        page={play}
        studentId={studentId}
        onClose={(left) => {
          setList((l) => l.map((p) => (p.url === play.url ? { ...p, wrong: left ?? p.wrong } : p)))
          setPlay(null)
        }}
      />
    )
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-t-[24px] bg-panel p-4 sm:rounded-[24px] sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-brand text-[20px] font-semibold text-paper">Mistake notebook</p>
            <p className="text-[13px] font-semibold text-mist">Open a page: your old mistakes are circled in red. Answer them again and press Submit — only those questions count.</p>
          </div>
          <button type="button" onClick={onClose} className="focus-ring h-10 rounded-[12px] bg-panel-2 px-3 text-sm font-extrabold text-paper">Close</button>
        </div>
        {!bySkill.length && <p className="rounded-[16px] bg-reading-tint px-4 py-6 text-center text-sm font-extrabold text-reading">Every mistake fixed ✓</p>}
        {bySkill.map(([skill, ps]) => (
          <div key={skill} className="flex flex-col gap-2">
            <h3 className={`text-[12px] font-extrabold uppercase tracking-[0.12em] ${skill === 'listening' ? 'text-listening' : 'text-reading'}`}>{skill === 'listening' ? 'Listening' : 'Reading'}</h3>
            <ul className="grid grid-cols-1 gap-2">
              {ps.map((p) => (
                <li key={p.url} className="min-w-0">
                  <button type="button" onClick={() => setPlay(p)} className="focus-ring flex w-full min-w-0 items-center gap-3 rounded-[16px] bg-panel-2/70 px-3 py-2.5 text-left hover:brightness-95">
                    <span className="grid h-10 min-w-[44px] shrink-0 place-items-center rounded-[12px] bg-urgent-tint px-2 font-brand text-[16px] font-semibold text-coral">{p.wrong.length}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-extrabold text-paper">{p.title || 'Practice page'}</span>
                      <span className="block truncate text-[12px] font-semibold text-mist">
                        {p.question_type ? `${qtypeLabel(p.question_type)} · ` : ''}Questions {p.wrong.join(', ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] font-extrabold text-brass">Fix ›</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function NotebookPlayer({ page, onClose }) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { fixed, of, left }
  const marks = useRef(page.wrong || [])
  const savedKey = useRef('')

  useEffect(() => {
    let cancelled = false
    fetchPage(page.url)
      .then((t) => !cancelled && setHtml(withHelper(t)))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [page.url])

  useEffect(() => {
    const onMessage = async (e) => {
      const d = e.data
      if (!d) return
      if (d.type === 'ielts-ready') {
        try {
          e.source?.postMessage({ type: 'ielts-mark-questions', nums: marks.current }, '*')
        } catch {
          /* ignore */
        }
        return
      }
      if (d.type !== 'ielts-workshop-score') return
      const qs = cleanQs(d.qs).filter((q) => marks.current.includes(q.n))
      if (!qs.length) return
      const key = JSON.stringify(qs)
      if (savedKey.current === key) return
      savedKey.current = key
      const fixed = qs.filter((q) => q.ok).length
      const { data, error: err } = await supabase.rpc('mistake_retest', { p_url: page.url, p_qs: qs })
      if (err) {
        savedKey.current = ''
        setError(err.message)
        return
      }
      setResult({ fixed, of: marks.current.length, left: Array.isArray(data) ? data : null })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [page.url])

  const of = marks.current.length
  return (
    <PageFrame
      title={page.title || 'Practice page'}
      kicker="Mistake notebook"
      html={html}
      error={error}
      onClose={() => onClose(result?.left ?? null)}
      score={result ? { score: result.fixed, max: of } : null}
      status={
        result
          ? result.left && result.left.length
            ? `${result.fixed} of ${of} fixed. Still to fix: ${result.left.join(', ')}.`
            : `All ${of} fixed ✓ — this page leaves your notebook.`
          : `Fix questions ${marks.current.join(', ')} (circled in red), then press Submit.`
      }
    />
  )
}
