import { Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { withHelper } from '../homework/HtmlTask'
import PageFrame from '../homework/PageFrame'
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

  return createPortal(
    <PageFrame
      title={page.title}
      kicker={`Preview · ${page.collection}${page.question_type ? ` · ${qtypeLabel(page.question_type)}` : ''}`}
      html={html}
      error={error}
      onClose={onClose}
      score={score ? { score: score.score, max: score.max } : null}
      badge={!score && page.skill === 'writing' && texts ? '✓' : null}
      status={
        score
          ? 'Score check ✓ — this is what the site saves for a student.'
          : page.skill === 'writing'
            ? texts
              ? 'Writing check ✓ — the typed answer is saved with the homework.'
              : 'Type a few words: the site saves the text with the homework.'
            : 'Score check: answer a little and press the page’s own Submit.'
      }
    />,
    document.body
  )
}
