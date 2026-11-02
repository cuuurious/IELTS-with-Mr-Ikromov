import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchAll } from '../../lib/fetchAll'
import { QuizRunner, buildMixedQuestions } from './wordPractice'
import { seededShuffle, tashkentDay } from '../../lib/homeworkTasks'

/*
 * DAILY MARATHON (2026-11-02) — one short race a day: 15 words from the
 * group's lists (and the student's own saved words), the same words for
 * everyone in the group today. One try a day; today's board shows who
 * got most right, fastest first. Points also go to the weekly season.
 */
export const MARATHON_SIZE = 15

function fmtTime(sec) {
  const m = Math.floor(sec / 60)
  return `${m}:${String(sec % 60).padStart(2, '0')}`
}

function untilMidnightTashkent() {
  const now = Date.now()
  const t = new Date(now + 5 * 3600_000)
  const next = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1) - 5 * 3600_000
  const mins = Math.max(0, Math.round((next - now) / 60000))
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export default function DailyMarathon({ studentId, wordlistIds, onExit }) {
  const day = tashkentDay()
  const [status, setStatus] = useState('loading') // loading | intro | race | saving | done | empty | error
  const [mine, setMine] = useState(null)
  const [board, setBoard] = useState([])
  const [questions, setQuestions] = useState([])
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const startedRef = useRef(0)
  const savedIdsRef = useRef(new Set())

  const loadBoard = async () => {
    const { data } = await supabase.rpc('marathon_board', { p_day: day })
    setBoard(data || [])
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: own, error: ownError } = await supabase
          .from('marathon_results')
          .select('score, total, seconds')
          .eq('user_id', studentId)
          .eq('day', day)
          .maybeSingle()
        if (ownError) throw ownError
        await loadBoard()
        if (cancelled) return
        if (own) {
          setMine(own)
          setStatus('done')
          return
        }
        const [{ data: items }, { data: saved }] = await Promise.all([
          wordlistIds.length
            ? fetchAll(() =>
                supabase
                  .from('wordlist_items')
                  .select('id, wordlist_id, word, definition, uzbek_translation, example_sentence')
                  .in('wordlist_id', wordlistIds)
                  .order('id')
              )
            : Promise.resolve({ data: [] }),
          supabase.from('student_words').select('id, word, definition, uzbek_translation, example_sentence').eq('user_id', studentId),
        ])
        if (cancelled) return
        savedIdsRef.current = new Set((saved || []).map((w) => w.id))
        const pool = [
          ...(items || []),
          ...(saved || []).map((w) => ({ ...w, wordlist_id: 'mine', mine: true })),
        ].filter((w) => w.word && (w.definition || w.uzbek_translation))
        if (pool.length < 4) {
          setStatus('empty')
          return
        }
        const groupKey = [...wordlistIds].sort().join(',')
        const picked = seededShuffle(pool.filter((w) => !w.mine), `${day}|${groupKey}`).slice(0, MARATHON_SIZE)
        const extra = seededShuffle(pool.filter((w) => w.mine), `${day}|${studentId}`).slice(0, Math.max(0, MARATHON_SIZE - picked.length))
        setQuestions(buildMixedQuestions([...picked, ...extra], pool).slice(0, MARATHON_SIZE))
        setStatus('intro')
      } catch (err) {
        if (cancelled) return
        setError(err?.message || 'Could not open the marathon.')
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, day])

  useEffect(() => {
    if (status !== 'race') return undefined
    const id = setInterval(() => setSeconds(Math.round((Date.now() - startedRef.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [status])

  const finish = async (detail) => {
    const secs = Math.round((Date.now() - startedRef.current) / 1000)
    const score = detail.filter((d) => d.isCorrect).length
    const row = { score, total: detail.length || 1, seconds: secs }
    setMine(row)
    setStatus('saving')
    const { error: insErr } = await supabase.from('marathon_results').insert(row)
    if (insErr && insErr.code !== '23505') setError(insErr.message)
    // Words learnt in the race move through the review boxes too.
    const listAnswers = detail.filter((d) => d.itemId && !savedIdsRef.current.has(d.itemId))
    if (listAnswers.length) supabase.rpc('record_word_review', { p_results: listAnswers.map((d) => ({ item_id: d.itemId, correct: d.isCorrect })) }).then(() => {})
    detail
      .filter((d) => savedIdsRef.current.has(d.itemId))
      .forEach((d) => supabase.rpc('review_student_word', { p_word_id: d.itemId, p_correct: d.isCorrect }).then(() => {}))
    await loadBoard()
    setStatus('done')
  }

  const myRank = useMemo(() => board.findIndex((r) => r.user_id === studentId) + 1, [board, studentId])

  const header = (
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={onExit} className="focus-ring text-sm font-bold text-mist hover:text-paper">
        ← Back to word lists
      </button>
      {status === 'race' && <span className="rounded-xl bg-[color-mix(in_srgb,var(--color-saffron)_18%,var(--color-panel))] px-3 py-1 font-brand text-sm font-semibold tabular-nums text-amber">{fmtTime(seconds)}</span>}
    </div>
  )

  return (
    <div className="flex flex-col gap-5">
      {header}

      {status === 'loading' && <p className="text-sm font-semibold text-mist">Getting today’s race ready…</p>}
      {status === 'error' && <p className="rounded-[20px] bg-urgent-tint px-5 py-4 text-sm font-bold text-coral">{error}</p>}
      {status === 'empty' && (
        <p className="rounded-[20px] border border-line bg-panel px-5 py-8 text-center text-sm font-semibold text-mist">
          The marathon starts once your group has a word list.
        </p>
      )}

      {status === 'intro' && (
        <div className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#2456b0,#1a9bb5)] p-6 text-white sm:p-8">
          <MarathonArt className="pointer-events-none absolute -right-4 -top-2 hidden h-40 w-48 opacity-90 sm:block" />
          <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Daily Marathon</p>
          <h2 className="mt-1 max-w-md font-brand text-[26px] font-semibold leading-tight">{questions.length} words. One try. Fastest wins.</h2>
          <p className="mt-2 max-w-md text-sm font-semibold text-white/85">Everyone in your group gets the same words today. Your score joins this week’s season.</p>
          <button
            type="button"
            onClick={() => {
              startedRef.current = Date.now()
              setSeconds(0)
              setStatus('race')
            }}
            className="focus-ring mt-5 h-12 rounded-[14px] bg-saffron px-7 text-[15px] font-extrabold text-[#17213a] hover:brightness-105"
          >
            Start the race
          </button>
        </div>
      )}

      {status === 'race' && (
        <div className="rounded-[20px] border border-line bg-panel p-5">
          <QuizRunner questions={questions} label="Marathon" onFinish={(detail) => finish(detail)} />
        </div>
      )}

      {(status === 'done' || status === 'saving') && mine && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { v: `${mine.score}/${mine.total}`, l: 'right today', c: 'bg-reading-tint text-reading' },
              { v: fmtTime(mine.seconds || 0), l: 'your time', c: 'bg-[color-mix(in_srgb,var(--color-saffron)_18%,var(--color-panel))] text-amber' },
              { v: myRank ? `#${myRank}` : '—', l: `of ${board.length} today`, c: 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] text-brass' },
            ].map((t) => (
              <div key={t.l} className={`rounded-[20px] px-5 py-4 ${t.c}`}>
                <div className="font-brand text-[28px] font-semibold leading-none">{t.v}</div>
                <div className="mt-1.5 text-[13px] font-extrabold text-paper-dim">{t.l}</div>
              </div>
            ))}
          </div>
          <p className="text-sm font-bold text-mist">Next race in {untilMidnightTashkent()}.</p>
        </>
      )}

      {(status === 'done' || status === 'intro') && board.length > 0 && <MarathonBoard rows={board} me={studentId} />}
    </div>
  )
}

export function MarathonBoard({ rows, me }) {
  const medal = ['bg-saffron text-[#17213a]', 'bg-[#c9d3e3] text-[#17213a]', 'bg-[#e0b48a] text-[#3b2410]']
  return (
    <div className="rounded-[20px] border border-line bg-panel p-5">
      <h3 className="mb-3 font-brand text-[18px] font-semibold text-paper">Today’s board</h3>
      <ol className="flex flex-col gap-2">
        {rows.slice(0, 10).map((r, i) => (
          <li key={r.user_id} className={`flex items-center gap-3 rounded-[14px] px-3 py-2 ${r.user_id === me ? 'bg-[color-mix(in_srgb,var(--color-brass)_10%,var(--color-panel))]' : 'bg-panel-2/60'}`}>
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[13px] font-extrabold ${medal[i] || 'bg-panel text-paper-dim'}`}>{i + 1}</span>
            <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-panel text-xs font-bold text-brass">
              {r.avatar_url ? <img src={r.avatar_url} alt="" className="h-full w-full object-cover" /> : (r.full_name || '?').charAt(0)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-paper">{r.user_id === me ? 'You' : r.full_name}</span>
            <span className="text-sm font-extrabold text-reading">{r.score}/{r.total}</span>
            <span className="w-12 text-right text-xs font-bold tabular-nums text-mist">{fmtTime(r.seconds || 0)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function MarathonArt({ className = '' }) {
  return (
    <svg viewBox="0 0 200 160" className={className} aria-hidden="true">
      <rect x="40" y="40" width="120" height="90" rx="18" fill="#ffffff" opacity="0.14" />
      <rect x="62" y="22" width="96" height="70" rx="14" fill="#ffffff" opacity="0.92" />
      <rect x="76" y="38" width="44" height="9" rx="4.5" fill="#2456b0" />
      <rect x="76" y="54" width="64" height="6" rx="3" fill="#bcd0f0" />
      <rect x="76" y="66" width="40" height="6" rx="3" fill="#bcd0f0" />
      <circle cx="150" cy="104" r="24" fill="#e6a33a" />
      <path d="M150 92v13l8 6" stroke="#17213a" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M30 120h34M20 132h40M38 108h22" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}
