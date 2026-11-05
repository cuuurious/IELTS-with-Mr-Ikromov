import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { writingContext } from '../../lib/writingAi'

/*
 * Full writing mocks from the Practice Bank (2026-11-05). Pick a Task 1
 * (by type: change charts, maps, processes…) and a Task 2 (by essay type)
 * — or let the site pair them at random — and the mock's prompts and
 * Task 1 graphic are filled in. Tasks the group already had as a mock
 * are skipped when picking at random.
 */

const T1_SETS = ['Change charts', 'Comparative graphs', 'Mixed graphs', 'Maps', 'Processes']
const T2_SETS = ['Agree or disagree', 'Discuss both views', 'Positive or negative', 'Advantages & disadvantages', 'Problems & solutions', 'Two-part questions']

const setOf = (p) => String(p.collection || '').split(' · ')[1] || ''
// "T12: Car ownership in one European country, 1975–2005 (Line graph)" → "Car ownership in one European country, 1975–2005"
const t1Title = (p) => String(p.title || '').replace(/^T\d+:\s*/, '').replace(/\s*\([^)]*\)\s*$/, '')

function dataUrlToFile(url, name) {
  const [head, b64] = url.split(',')
  const type = /data:([^;]+)/.exec(head)?.[1] || 'image/jpeg'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type })
}

const pageCache = {}
async function contextOf(page) {
  if (!pageCache[page.url]) {
    pageCache[page.url] = fetch(page.url)
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => writingContext(html, page.url))
  }
  return pageCache[page.url]
}

export function task1Prompt(ctx) {
  return `${ctx.question}${ctx.taskType ? ` (${ctx.taskType.toLowerCase()})` : ''}\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\nWrite at least 150 words.`
}
export function task2Prompt(ctx) {
  return `${ctx.question}\n\nGive reasons for your answer and include any relevant examples from your own knowledge or experience.\n\nWrite at least 250 words.`
}

export default function MockBankPicker({ groupId, mode, onTask1, onTask2 }) {
  const [pages, setPages] = useState(null)
  const [used, setUsed] = useState('') // all earlier mock prompts of the group, lower-case
  const [t1Set, setT1Set] = useState('')
  const [t2Set, setT2Set] = useState('')
  const [t1Id, setT1Id] = useState('')
  const [t2Id, setT2Id] = useState('')
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState(null) // { t1, t2 } titles
  const [error, setError] = useState('')

  const wantT1 = mode === 'task1' || mode === 'full'
  const wantT2 = mode === 'task2' || mode === 'full'

  useEffect(() => {
    let cancelled = false
    supabase
      .from('materials')
      .select('id, title, url, collection, position, question_type')
      .eq('skill', 'writing')
      .order('position')
      .then(({ data }) => !cancelled && setPages(data || []))
    if (groupId) {
      supabase
        .from('homeworks')
        .select('mock_task1_prompt, mock_task2_prompt')
        .eq('group_id', groupId)
        .eq('homework_type', 'writing_mock')
        .then(({ data }) => !cancelled && setUsed((data || []).map((h) => `${h.mock_task1_prompt || ''}\n${h.mock_task2_prompt || ''}`).join('\n').toLowerCase()))
    }
    return () => {
      cancelled = true
    }
  }, [groupId])

  const t1Pages = useMemo(() => (pages || []).filter((p) => p.question_type === 'writing_task1' && (!t1Set || setOf(p) === t1Set)), [pages, t1Set])
  const t2Pages = useMemo(() => (pages || []).filter((p) => p.question_type === 'writing_task2' && (!t2Set || setOf(p) === t2Set)), [pages, t2Set])
  const t1Used = (p) => used.includes(t1Title(p).toLowerCase())

  if (pages === null) return null
  if (!pages.some((p) => p.question_type === 'writing_task1' || p.question_type === 'writing_task2')) return null

  const shuffle = (list) => [...list].sort(() => Math.random() - 0.5)

  const fill = async () => {
    setBusy(true)
    setError('')
    try {
      const out = {}
      if (wantT1) {
        let page = t1Pages.find((p) => p.id === t1Id)
        if (!page) page = shuffle(t1Pages).find((p) => !t1Used(p)) || shuffle(t1Pages)[0]
        if (!page) throw new Error('No Task 1 of that type.')
        const ctx = await contextOf(page)
        if (!ctx.question) throw new Error('Could not read that Task 1 page.')
        onTask1({ prompt: task1Prompt(ctx), file: ctx.image ? dataUrlToFile(ctx.image, `task1-${page.position || 'bank'}.${/png/.test(ctx.image.slice(0, 30)) ? 'png' : 'jpg'}`) : null, page })
        out.t1 = page.title
      }
      if (wantT2) {
        let page = t2Pages.find((p) => p.id === t2Id)
        let ctx = page ? await contextOf(page) : null
        if (!page) {
          // A random one the group hasn't had as a mock (checks up to 8).
          for (const cand of shuffle(t2Pages).slice(0, 8)) {
            const c = await contextOf(cand)
            if (c.question && !used.includes(c.question.toLowerCase().slice(0, 80))) {
              page = cand
              ctx = c
              break
            }
          }
          if (!page && t2Pages.length) {
            page = shuffle(t2Pages)[0]
            ctx = await contextOf(page)
          }
        }
        if (!page) throw new Error('No Task 2 of that type.')
        if (!ctx?.question) throw new Error('Could not read that Task 2 page.')
        onTask2({ prompt: task2Prompt(ctx), page })
        out.t2 = page.title
      }
      setPicked(out)
    } catch (e) {
      setError(e.message || 'Could not fill it in.')
    } finally {
      setBusy(false)
    }
  }

  const select = 'focus-ring h-9 min-w-0 rounded-[12px] border border-line bg-panel px-2 text-[13px] font-bold text-paper'

  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] border border-writing/30 bg-writing-tint/50 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-[13px] font-extrabold text-writing">From the Practice Bank</p>
        <p className="text-[12px] font-semibold text-mist">Pick the tasks, or leave “Any new one” and the site pairs them for you.</p>
      </div>
      {wantT1 && (
        <div className="grid gap-2 sm:grid-cols-[110px_1fr_1.4fr] sm:items-center">
          <span className="text-[12px] font-extrabold text-paper-dim">Task 1</span>
          <select value={t1Set} onChange={(e) => { setT1Set(e.target.value); setT1Id('') }} className={select} aria-label="Task 1 type">
            <option value="">Any type</option>
            {T1_SETS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={t1Id} onChange={(e) => setT1Id(e.target.value)} className={select} aria-label="Task 1">
            <option value="">Any new one ({t1Pages.filter((p) => !t1Used(p)).length} new)</option>
            {t1Pages.map((p) => <option key={p.id} value={p.id}>{t1Used(p) ? '✓ ' : ''}{p.title}</option>)}
          </select>
        </div>
      )}
      {wantT2 && (
        <div className="grid gap-2 sm:grid-cols-[110px_1fr_1.4fr] sm:items-center">
          <span className="text-[12px] font-extrabold text-paper-dim">Task 2</span>
          <select value={t2Set} onChange={(e) => { setT2Set(e.target.value); setT2Id('') }} className={select} aria-label="Task 2 type">
            <option value="">Any type</option>
            {T2_SETS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={t2Id} onChange={(e) => setT2Id(e.target.value)} className={select} aria-label="Task 2">
            <option value="">Any new one</option>
            {t2Pages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={fill} disabled={busy} className="focus-ring h-9 rounded-[12px] bg-writing px-4 text-[13px] font-extrabold text-white hover:brightness-110 disabled:opacity-60">
          {busy ? 'Filling in…' : picked ? 'Pick again' : mode === 'full' ? 'Make the full mock' : 'Fill in'}
        </button>
        {picked && (
          <span className="min-w-0 flex-1 text-[12px] font-bold text-paper-dim">
            {[picked.t1 && `Task 1: ${picked.t1}`, picked.t2 && `Task 2: ${picked.t2}`].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      {error && <p className="text-[12px] font-bold text-coral">{error}</p>}
      <p className="text-[11px] font-semibold text-mist">✓ = this group already had it as a mock.</p>
    </div>
  )
}
