import { Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { withHelper } from '../homework/HtmlTask'
import TaskShell, { Panel } from '../homework/TaskShell'
import { qtypeLabel } from '../../lib/questionTypes'
import { lazyWithReload } from '../../lib/lazyWithReload'

const SpeakingTask = lazyWithReload(() => import('../speaking/SpeakingTask'))

/*
 * Teacher preview of a Practice Bank page (2026-11-02). Same sealed frame
 * students get, plus a live "score check": press the page's own Submit and
 * this shows the score the site would save — so a page that doesn't
 * report its score is spotted before it is set as homework.
 */
export default function PagePreview({ page, onClose }) {
  // Speaking tests: the real test screen, without handing in.
  if (/^speaking:/.test(page.url || '')) {
    return createPortal(
      <Suspense fallback={<div className="fixed inset-0 z-[70] bg-ink/80" />}>
        <SpeakingTask task={{ id: null, html_url: page.url, title: page.title }} preview onClose={onClose} />
      </Suspense>,
      document.body
    )
  }
  return <HtmlPagePreview page={page} onClose={onClose} />
}

function HtmlPagePreview({ page, onClose }) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState('')
  const [score, setScore] = useState(null)
  const [texts, setTexts] = useState(0)

  useEffect(() => {
    fetch(page.url)
      .then((r) => {
        if (!r.ok) throw new Error('This page could not be opened.')
        return r.text()
      })
      .then((t) => setHtml(withHelper(t)))
      .catch((e) => setError(e.message))
    const onMessage = (e) => {
      const d = e.data
      if (d?.type === 'ielts-workshop-score') setScore(d)
      if (d?.type === 'ielts-workshop-text') setTexts((d.texts || []).length)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [page.url])

  const kind = page.skill === 'listening' || page.skill === 'reading' ? page.skill : 'html'
  return createPortal(
    <TaskShell kind={kind} title={page.title} subtitle={`Preview · ${page.collection}${page.question_type ? ` · ${qtypeLabel(page.question_type)}` : ''}`} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <Panel className="flex flex-wrap items-center gap-3">
          <span className={`grid h-12 min-w-[72px] place-items-center rounded-2xl px-3 font-brand text-[18px] font-semibold ${score ? 'bg-reading-tint text-reading' : 'bg-panel-2 text-mist'}`}>
            {score ? `${score.score}/${score.max}` : '—'}
          </span>
          <p className="min-w-0 flex-1 text-sm font-bold text-paper-dim">
            {score
              ? 'Score check ✓ — this is what the site saves for a student.'
              : page.skill === 'writing'
                ? texts
                  ? 'Writing check ✓ — the typed answer is saved with the homework.'
                  : 'Type a few words in the answer box: the site saves the text with the homework.'
                : 'Score check: answer a little and press the page’s own Submit. The score should appear here.'}
          </p>
        </Panel>
        {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}
        <div className="overflow-hidden rounded-[20px] border border-line bg-white">
          {html ? (
            <iframe title={page.title} srcDoc={html} sandbox="allow-scripts allow-forms allow-modals allow-popups" className="block h-[78vh] w-full" />
          ) : (
            !error && <p className="p-6 text-sm font-semibold text-mist">Opening…</p>
          )}
        </div>
      </div>
    </TaskShell>,
    document.body
  )
}
