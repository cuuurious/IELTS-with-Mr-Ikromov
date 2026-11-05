import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'

/*
 * MY GRAMMAR MISTAKES (2026-11-05, migration_108). Every correction the
 * AI makes in the student's writing and speaking becomes a card. The quiz
 * shows the student's own sentence next to the better one: "Which is
 * right?" A right answer moves the card on (tomorrow, 3 days, a week…),
 * a wrong one brings it back today.
 */

const shuffle = (a) => {
  const x = [...a]
  for (let i = x.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[x[i], x[j]] = [x[j], x[i]]
  }
  return x
}

export function useGrammarCards(studentId) {
  const [cards, setCards] = useState(null)
  const load = async () => {
    const { data, error } = await supabase
      .from('grammar_cards')
      .select('id, kind, original, better, why, box, due_at')
      .eq('user_id', studentId)
      .order('due_at', { ascending: true })
      .limit(300)
    setCards(error ? false : data || [])
  }
  useEffect(() => {
    if (studentId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId])
  const due = (cards || []).filter((c) => new Date(c.due_at) <= new Date())
  return { cards, due, reload: load }
}

export function GrammarCard({ studentId, className = '' }) {
  const { cards, due, reload } = useGrammarCards(studentId)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onOpen = (e) => e.detail === 'grammar' && setOpen(true)
    window.addEventListener('ielts:open', onOpen)
    return () => window.removeEventListener('ielts:open', onOpen)
  }, [])
  if (!cards || !cards.length) return null
  const learned = cards.filter((c) => c.box >= 3).length
  return (
    <>
      <section className={`flex items-center gap-3 rounded-[20px] border border-line bg-panel p-3 sm:gap-4 sm:p-4 ${className}`}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-writing-tint text-writing" aria-hidden="true">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19h4L19 8l-4-4L4 15z" />
            <path d="M13 6l4 4M4 22h16" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-writing">My grammar mistakes</p>
          <p className="truncate text-[15px] font-extrabold text-paper">{due.length ? `${due.length} to review today` : 'All reviewed ✓'}</p>
          <p className="truncate text-[12px] font-bold text-mist">{cards.length} from your writing and speaking · {learned} learned</p>
        </div>
        {due.length > 0 && (
          <button type="button" onClick={() => setOpen(true)} className="focus-ring h-10 shrink-0 rounded-[12px] bg-panel-2 px-3.5 text-[13px] font-extrabold text-paper hover:brightness-95">
            Review
          </button>
        )}
      </section>
      {open && createPortal(<GrammarQuiz cards={due.slice(0, 10)} onClose={() => { setOpen(false); reload() }} />, document.body)}
    </>
  )
}

function GrammarQuiz({ cards, onClose }) {
  const items = useMemo(() => cards.map((c) => ({ ...c, options: shuffle([c.original, c.better]) })), [cards])
  const [i, setI] = useState(0)
  const [pick, setPick] = useState(null)
  const [score, setScore] = useState(0)
  const done = i >= items.length
  const c = items[i]

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const choose = (o) => {
    if (pick) return
    setPick(o)
    const right = o === c.better
    if (right) setScore((s) => s + 1)
    supabase.rpc('review_grammar_card', { p_id: c.id, p_right: right }).then(() => {})
  }
  const next = () => {
    setPick(null)
    setI((x) => x + 1)
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/70 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-t-[24px] bg-panel p-4 sm:rounded-[24px] sm:p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Grammar review">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 font-brand text-[19px] font-semibold text-paper">My grammar mistakes</p>
          {!done && <span className="rounded-[10px] bg-panel-2 px-2.5 py-1 text-[12px] font-extrabold text-paper-dim">{i + 1}/{items.length}</span>}
          <button type="button" onClick={onClose} className="focus-ring h-10 rounded-[12px] bg-panel-2 px-3 text-sm font-extrabold text-paper">Close</button>
        </div>
        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="font-brand text-[26px] font-semibold text-paper">{score}/{items.length}</p>
            <p className="text-[14px] font-bold text-paper-dim">{score === items.length ? 'Perfect — these mistakes are fading away.' : 'The ones you missed come back tomorrow.'}</p>
            <button type="button" onClick={onClose} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a]">Done</button>
          </div>
        ) : (
          <>
            <p className="text-[13px] font-semibold text-mist">From your {c.kind === 'speaking' ? 'speaking' : 'writing'}. Which one is right?</p>
            <div className="flex flex-col gap-2">
              {c.options.map((o) => {
                const right = o === c.better
                const tone = !pick ? 'bg-panel-2 text-paper hover:ring-1 hover:ring-brass/50' : right ? 'bg-reading-tint text-reading' : o === pick ? 'bg-urgent-tint text-coral line-through' : 'bg-panel-2 text-mist'
                return (
                  <button key={o} type="button" onClick={() => choose(o)} disabled={Boolean(pick)} className={`focus-ring rounded-[14px] px-4 py-3 text-left text-[15px] font-bold leading-snug transition ${tone}`}>
                    {pick && right ? '✓ ' : ''}{o}
                  </button>
                )
              })}
            </div>
            {pick && (
              <>
                {c.why && <p className="rounded-[14px] bg-writing-tint/60 px-4 py-3 text-[14px] font-semibold text-paper">{c.why}</p>}
                <button type="button" onClick={next} className="focus-ring h-11 rounded-[14px] bg-saffron text-sm font-extrabold text-[#17213a]">{i < items.length - 1 ? 'Next' : 'Finish'}</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
