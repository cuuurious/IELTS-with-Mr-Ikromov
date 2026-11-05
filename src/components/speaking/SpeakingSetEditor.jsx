import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { blankContent, buildSteps, checkContent, fetchVoice, linesOf, parseScript, tidyContent } from '../../lib/speaking'

/*
 * New / edit a speaking set (2026-11-05). One set = one full test:
 * Part 1 topics with questions, the Part 2 cue card and rounding-off
 * question, and the Part 3 discussion. Paste the examiner script from a
 * question bank (PDF or Word) and press "Fill in" — or type it. Model
 * answers are optional; students see them after the test.
 * Saving makes four Practice Bank pages (full test, Part 1, 2 and 3).
 */

const field = 'focus-ring w-full rounded-[12px] border border-line bg-panel px-3 py-2 text-[14px] text-paper placeholder:text-mist/70'

const phrasesToText = (list) => (list || []).map(([p, m]) => (m ? `${p} — ${m}` : p)).join('\n')
const textToPhrases = (t) =>
  String(t || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [p, ...rest] = l.split(/\s+[—–-]\s+|\s*:\s+/)
      return [p.trim(), rest.join(' — ').trim()]
    })

function ModelFields({ model, onChange }) {
  const [open, setOpen] = useState(Boolean(model?.answer))
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="focus-ring self-start text-[12px] font-extrabold text-brass">
        + Model answer (optional)
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-[12px] bg-panel-2/60 p-2.5">
      <textarea value={model?.answer || ''} onChange={(e) => onChange({ ...(model || {}), answer: e.target.value })} rows={3} placeholder="Band 8 model answer" className={field} />
      <textarea value={phrasesToText(model?.phrases)} onChange={(e) => onChange({ ...(model || {}), phrases: textToPhrases(e.target.value) })} rows={2} placeholder="Key phrases, one per line: take in the views — look at and enjoy the scenery" className={`${field} text-[13px]`} />
    </div>
  )
}

function QuestionList({ list, onChange, placeholder }) {
  const set = (i, q) => onChange(list.map((x, j) => (j === i ? q : x)))
  return (
    <ol className="flex flex-col gap-2">
      {list.map((q, i) => (
        <li key={i} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="w-6 shrink-0 text-right text-[12px] font-extrabold text-mist">{i + 1}</span>
            <input value={q.q} onChange={(e) => set(i, { ...q, q: e.target.value })} placeholder={placeholder} className={field} />
            <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove question" className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-mist hover:bg-urgent-tint hover:text-coral">×</button>
          </div>
          <div className="pl-8">
            <ModelFields model={q.model} onChange={(m) => set(i, { ...q, model: m })} />
          </div>
        </li>
      ))}
      <li>
        <button type="button" onClick={() => onChange([...list, { q: '' }])} className="focus-ring ml-8 text-[13px] font-extrabold text-brass">+ Question</button>
      </li>
    </ol>
  )
}

function Section({ title, hint, children }) {
  return (
    <section className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4 sm:p-5">
      <div>
        <p className="font-brand text-[17px] font-semibold text-paper">{title}</p>
        {hint && <p className="text-[12px] font-semibold text-mist">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export default function SpeakingSetEditor({ set = null, nextNumber = 1, onClose, onSaved }) {
  const [number, setNumber] = useState(set?.number ?? nextNumber)
  const [topics, setTopics] = useState(set?.topics || '')
  const [c, setC] = useState(() => {
    const base = set?.content ? JSON.parse(JSON.stringify(set.content)) : blankContent()
    base.part2 = { bullets: [], rounding: { q: '' }, ...(base.part2 || {}) }
    base.part3 = { questions: [], ...(base.part3 || {}) }
    return base
  })
  const [paste, setPaste] = useState('')
  const [pasteOpen, setPasteOpen] = useState(!set)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const autoTopics = useMemo(() => {
    const t = [...(c.part1 || []).map((x) => x.topic), c.part3?.theme ? c.part3.theme.replace(/^\w/, (m) => m.toUpperCase()) : ''].map((x) => (x || '').trim()).filter(Boolean)
    return [...new Set(t)].join(' · ')
  }, [c])

  const fill = () => {
    const parsed = parseScript(paste)
    const p1n = parsed.part1.reduce((n, t) => n + t.questions.length, 0)
    if (!p1n && !parsed.part2.cue && !parsed.part3.questions.length) {
      setNote('Nothing found. Paste the script with the headings “Part 1 · Topic”, “Part 2”, “Part 3”, and questions ending with “?”.')
      return
    }
    setC((old) => ({
      ...old,
      part1: parsed.part1.length ? parsed.part1 : old.part1,
      part2: parsed.part2.cue ? { ...old.part2, ...parsed.part2, rounding: parsed.part2.rounding?.q ? parsed.part2.rounding : old.part2.rounding } : old.part2,
      part3: parsed.part3.questions.length ? { ...old.part3, ...parsed.part3 } : old.part3,
    }))
    setNote(`Filled in: ${p1n} Part 1 questions, ${parsed.part2.cue ? 'the cue card' : 'no cue card'}, ${parsed.part3.questions.length} Part 3 questions. Check them below.`)
    setPasteOpen(false)
  }

  const p2 = c.part2 || {}
  const setP2 = (patch) => setC((o) => ({ ...o, part2: { ...o.part2, ...patch } }))
  const setP3 = (patch) => setC((o) => ({ ...o, part3: { ...o.part3, ...patch } }))
  const setTopic = (i, patch) => setC((o) => ({ ...o, part1: o.part1.map((t, j) => (j === i ? { ...t, ...patch } : t)) }))

  const save = async () => {
    setError('')
    const content = tidyContent(c)
    const problems = checkContent(content)
    if (problems.length) {
      setError(problems.join(' '))
      return
    }
    const n = Number(number)
    if (!Number.isInteger(n) || n < 1 || n > 9999) {
      setError('Give the set a number.')
      return
    }
    setBusy(true)
    const row = { number: n, title: `Set ${n}`, topics: topics.trim() || autoTopics, content, updated_at: new Date().toISOString() }
    const { data: savedRows, error: err } = set?.id
      ? await supabase.from('speaking_sets').update(row).eq('id', set.id).select('id')
      : await supabase.from('speaking_sets').insert(row).select('id')
    setBusy(false)
    if (err) {
      setError(/speaking_sets_number_key|duplicate/i.test(err.message) ? `There is already a Set ${n}. Choose another number.` : /speaking_sets/.test(err.message) ? 'Run migration_101_speaking_tests.sql first.' : err.message)
      return
    }
    // Make the examiner's voice now, so the first student doesn't wait.
    const id = savedRows?.[0]?.id || set?.id
    if (id) fetchVoice(id, linesOf(buildSteps(content, 'full')))
    onSaved?.()
  }

  const remove = async () => {
    if (!set?.id || !window.confirm(`Delete Set ${set.number}? Its four Practice Bank pages go too. Homework already given keeps its recordings, but the test can no longer be opened.`)) return
    setBusy(true)
    const { error: err } = await supabase.from('speaking_sets').delete().eq('id', set.id)
    setBusy(false)
    if (err) return setError(err.message)
    onSaved?.()
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink">
      <div className="registan-band flex shrink-0 items-center gap-3 px-3 py-3 text-white sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Practice Bank · Speaking</p>
          <p className="truncate font-brand text-[19px] font-semibold">{set ? `Edit Set ${set.number}` : 'New speaking set'}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/15 hover:bg-white/25">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 pb-28">
          <Section title="Paste the examiner script" hint="Copy the questions from your question bank (PDF or Word) and paste them here — the headings Part 1 · Topic, Part 2, Part 3 and questions ending with “?”.">
            {pasteOpen ? (
              <>
                <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={8} placeholder={'Part 1 · Hometown\nWhere is your hometown?\nWhat do you like about it?\n\nPart 2\nDescribe a place you like to visit\nYou should say:\n• where it is\n• how often you go there\n• what you do there\nand explain why you like it.\nRounding-off question: Do you go there with friends?\n\nPart 3 · Places\nWhy do people like to travel?'} className={`${field} font-mono text-[13px]`} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={fill} disabled={!paste.trim()} className="focus-ring h-10 rounded-[12px] bg-brass px-4 text-[13px] font-extrabold text-onbrass disabled:opacity-50">Fill in from the text</button>
                  {set && <button type="button" onClick={() => setPasteOpen(false)} className="focus-ring h-10 px-3 text-[13px] font-bold text-mist">Cancel</button>}
                </div>
              </>
            ) : (
              <button type="button" onClick={() => setPasteOpen(true)} className="focus-ring self-start text-[13px] font-extrabold text-brass">Paste a script again</button>
            )}
            {note && <p className="rounded-[12px] bg-reading-tint px-3 py-2 text-[13px] font-bold text-reading">{note}</p>}
          </Section>

          <Section title="The set">
            <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-extrabold text-mist">Set number</span>
                <input type="number" min="1" value={number} onChange={(e) => setNumber(e.target.value)} className={field} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-extrabold text-mist">Topics (shown on the card)</span>
                <input value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={autoTopics || 'Hometown · Weather · Travel'} className={field} />
              </label>
            </div>
          </Section>

          <Section title="Part 1" hint="Two or three familiar topics, 3–5 questions each.">
            {(c.part1 || []).map((t, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-[16px] border border-line p-3">
                <div className="flex items-center gap-2">
                  <input value={t.topic} onChange={(e) => setTopic(i, { topic: e.target.value })} placeholder={`Topic ${i + 1}, e.g. Hometown`} className={`${field} font-extrabold`} />
                  <button type="button" onClick={() => setC((o) => ({ ...o, part1: o.part1.filter((_, j) => j !== i) }))} className="focus-ring h-9 shrink-0 rounded-[10px] px-2 text-[12px] font-extrabold text-mist hover:text-coral">Remove topic</button>
                </div>
                <input value={t.intro || ''} onChange={(e) => setTopic(i, { intro: e.target.value })} placeholder="What the examiner says first (optional), e.g. Let’s talk about your hometown." className={`${field} text-[13px]`} />
                <QuestionList list={t.questions || []} onChange={(qs) => setTopic(i, { questions: qs })} placeholder="Question" />
              </div>
            ))}
            <button type="button" onClick={() => setC((o) => ({ ...o, part1: [...(o.part1 || []), { topic: '', intro: '', questions: [{ q: '' }, { q: '' }, { q: '' }] }] }))} className="focus-ring self-start text-[13px] font-extrabold text-brass">+ Topic</button>
          </Section>

          <Section title="Part 2 · Cue card" hint="One minute to prepare, then up to two minutes.">
            <input value={p2.cue || ''} onChange={(e) => setP2({ cue: e.target.value })} placeholder="Describe a place you like to visit" className={`${field} font-extrabold`} />
            <p className="text-[12px] font-extrabold text-mist">You should say:</p>
            {(p2.bullets?.length ? p2.bullets : ['', '', '']).map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-mist">•</span>
                <input
                  value={b}
                  onChange={(e) => {
                    const list = [...(p2.bullets?.length ? p2.bullets : ['', '', ''])]
                    list[i] = e.target.value
                    setP2({ bullets: list })
                  }}
                  placeholder={['where it is', 'how often you go there', 'what you do there'][i] || 'another point'}
                  className={field}
                />
              </div>
            ))}
            <button type="button" onClick={() => setP2({ bullets: [...(p2.bullets?.length ? p2.bullets : ['', '', '']), ''] })} className="focus-ring self-start text-[12px] font-extrabold text-brass">+ Point</button>
            <input value={p2.explain || ''} onChange={(e) => setP2({ explain: e.target.value })} placeholder="and explain why you like it." className={field} />
            <ModelFields model={p2.model} onChange={(m) => setP2({ model: m })} />
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold text-mist">Rounding-off question</span>
              <input value={p2.rounding?.q || ''} onChange={(e) => setP2({ rounding: { ...(p2.rounding || {}), q: e.target.value } })} placeholder="Do you often go there?" className={field} />
            </label>
          </Section>

          <Section title="Part 3 · Discussion" hint="4–6 deeper questions linked to the cue card.">
            <input value={c.part3?.theme || ''} onChange={(e) => setP3({ theme: e.target.value })} placeholder="Theme, e.g. Tourism" className={`${field} font-extrabold`} />
            <QuestionList list={c.part3?.questions || []} onChange={(qs) => setP3({ questions: qs })} placeholder="Question" />
          </Section>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-panel px-4 py-3 sm:px-6">
        {error && <p className="w-full text-[13px] font-bold text-coral">{error}</p>}
        {set && (
          <button type="button" onClick={remove} disabled={busy} className="focus-ring h-11 rounded-[14px] px-3 text-[13px] font-extrabold text-coral hover:bg-urgent-tint disabled:opacity-50">
            Delete set
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist">Cancel</button>
        <button type="button" onClick={save} disabled={busy} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save set'}
        </button>
      </div>
    </div>,
    document.body
  )
}
