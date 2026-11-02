import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchAll } from '../../lib/fetchAll'
import WordlistPlayer from './WordlistPlayer'
import WordReview, { REVIEW_SESSION_SIZE } from './WordReview'
import DailyMarathon, { MarathonArt } from './DailyMarathon'
import MyWords from './MyWords'
import EmptyState from '../../components/EmptyState'
import { tashkentDay } from '../../lib/homeworkTasks'

/*
 * Daily Marathon + My words tiles (2026-11-02).
 */
function PracticeTiles({ studentId, refreshKey, onMarathon, onMyWords }) {
  const [state, setState] = useState({ race: undefined, saved: null, due: 0 })
  useEffect(() => {
    if (!studentId) return undefined
    let cancelled = false
    Promise.all([
      supabase.from('marathon_results').select('score, total').eq('user_id', studentId).eq('day', tashkentDay()).maybeSingle(),
      supabase.from('student_words').select('id, due_at').eq('user_id', studentId),
    ]).then(([race, words]) => {
      if (cancelled) return
      const now = Date.now()
      setState({
        race: race.error ? null : race.data || null,
        saved: words.error ? null : (words.data || []).length,
        due: (words.data || []).filter((w) => new Date(w.due_at).getTime() <= now).length,
      })
    })
    return () => {
      cancelled = true
    }
  }, [studentId, refreshKey])

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <button
        type="button"
        onClick={onMarathon}
        className="focus-ring group relative flex min-h-[132px] flex-col justify-between overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#2456b0,#1a9bb5)] p-5 text-left text-white transition hover:-translate-y-0.5"
      >
        <MarathonArt className="pointer-events-none absolute -bottom-6 -right-6 h-32 w-40 opacity-80 transition group-hover:scale-105" />
        <span className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Daily Marathon</span>
        <span className="relative font-brand text-[22px] font-semibold leading-tight">
          {state.race ? `${state.race.score}/${state.race.total} today` : '15 words · one try'}
        </span>
        <span className="relative w-fit rounded-xl bg-saffron px-3 py-1.5 text-[13px] font-extrabold text-[#17213a]">
          {state.race ? "See today's board" : 'Race now'}
        </span>
      </button>
      <button
        type="button"
        onClick={onMyWords}
        className="focus-ring group relative flex min-h-[132px] flex-col justify-between overflow-hidden rounded-[20px] border border-[#F3D27A] bg-vocab-tint p-5 text-left transition hover:-translate-y-0.5"
      >
        <span className="pointer-events-none absolute -bottom-3 -right-2 select-none font-brand text-[84px] font-semibold leading-none text-vocab/15" aria-hidden="true">Aa</span>
        <span className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-vocab">My words</span>
        <span className="relative font-brand text-[22px] font-semibold leading-tight text-paper">
          {state.saved ? `${state.saved} saved word${state.saved === 1 ? '' : 's'}` : 'Words you save'}
        </span>
        <span className="relative w-fit rounded-xl bg-panel px-3 py-1.5 text-[13px] font-extrabold text-vocab">
          {state.due ? `${state.due} to review` : state.saved ? 'Open' : 'Double-click words in tests'}
        </span>
      </button>
    </div>
  )
}

/*
 * "Daily review" card (2026-10-02): how many words are due today in the
 * spaced-repetition boxes (see WordReview.jsx) + the student's practice
 * streak (days in a row with any word quiz or review).
 */
function localDay(value) {
  const d = new Date(value)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function DailyReviewCard({ studentId, wordlistIds, onStart, refreshKey }) {
  const [due, setDue] = useState(null)
  const [streak, setStreak] = useState(0)
  const [doneToday, setDoneToday] = useState(false)
  const [activeDays, setActiveDays] = useState(() => new Set())

  useEffect(() => {
    if (!studentId || !wordlistIds.length) return
    let cancelled = false
    const since = new Date(Date.now() - 90 * 86400000).toISOString()
    Promise.all([
      supabase
        .from('word_progress')
        .select('item_id', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .in('wordlist_id', wordlistIds)
        .lte('due_at', new Date().toISOString()),
      supabase.from('wordlist_attempts').select('created_at').eq('student_id', studentId).gte('created_at', since),
      supabase.from('word_review_sessions').select('created_at').eq('student_id', studentId).gte('created_at', since),
    ])
      .then(([dueRes, attemptsRes, reviewsRes]) => {
        if (cancelled) return
        setDue(dueRes.count ?? 0)
        const days = new Set(
          [...(attemptsRes.data || []), ...(reviewsRes.data || [])].map((r) => localDay(r.created_at))
        )
        const today = new Date()
        setDoneToday(days.has(localDay(today)))
        setActiveDays(days)
        // Streak counts back from today (or from yesterday, if today
        // isn't done yet — the streak isn't lost until the day ends).
        let count = 0
        const cursor = new Date(today)
        if (!days.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1)
        while (days.has(localDay(cursor))) {
          count += 1
          cursor.setDate(cursor.getDate() - 1)
        }
        setStreak(count)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, wordlistIds.join(','), refreshKey])

  if (due === null) return null

  const sessionSize = Math.min(due, REVIEW_SESSION_SIZE)
  // The last 7 days, oldest first, for the streak dots.
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return { key: localDay(d), label: d.toLocaleDateString('en-GB', { weekday: 'narrow' }), today: i === 6 }
  })

  return (
    <div className="relative overflow-hidden rounded-[20px] border border-[#F3D27A] bg-vocab-tint px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-5">
        <CardStackArt className="hidden h-24 w-28 shrink-0 sm:block" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-vocab">Daily review</p>
          <p className="mt-1 text-xl font-semibold text-paper">
            {due > 0 ? `${sessionSize} word${sessionSize === 1 ? '' : 's'} ready to review` : 'All caught up for today'}
          </p>
          <p className="mt-1 text-sm text-paper-dim">
            {due > 0
              ? 'A few minutes a day moves words into long-term memory.'
              : 'Words come back here when it is time to see them again.'}
            {due > REVIEW_SESSION_SIZE ? ` ${due} are due in total.` : ''}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5" aria-label={`${streak}-day streak`}>
              {week.map((d) => {
                const on = activeDays.has(d.key)
                return (
                  <span key={d.key} className="flex flex-col items-center gap-0.5">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                        on ? 'bg-vocab text-white' : d.today ? 'border-2 border-dashed border-vocab/50 text-vocab' : 'bg-white/70 text-mist'
                      }`}
                    >
                      {on ? '✓' : d.label}
                    </span>
                  </span>
                )
              })}
            </div>
            <span className="text-xs font-medium text-vocab">
              {streak > 0 ? `${streak}-day streak${doneToday ? '' : ' — practise today to keep it'}` : 'Practise today to start a streak'}
            </span>
          </div>
        </div>
        {due > 0 && (
          <button
            type="button"
            onClick={onStart}
            className="focus-ring rounded-xl bg-brass px-6 py-2.5 text-sm font-semibold text-onbrass transition-transform hover:scale-[1.03] hover:bg-brass-dim active:scale-95"
          >
            Start review
          </button>
        )}
      </div>
    </div>
  )
}

function CardStackArt({ className = '' }) {
  return (
    <svg viewBox="0 0 120 100" className={className} aria-hidden="true">
      <rect x="22" y="18" width="72" height="54" rx="10" fill="#fff" stroke="#F3D27A" strokeWidth="2" transform="rotate(-10 58 45)" />
      <rect x="26" y="20" width="72" height="54" rx="10" fill="#fff" stroke="#F3D27A" strokeWidth="2" transform="rotate(6 62 47)" />
      <rect x="24" y="24" width="72" height="54" rx="10" fill="#fff" stroke="#7F5B00" strokeWidth="2" />
      <rect x="36" y="38" width="38" height="7" rx="3.5" fill="#7F5B00" />
      <rect x="36" y="52" width="48" height="4" rx="2" fill="#F3D27A" />
      <rect x="36" y="61" width="30" height="4" rx="2" fill="#F3D27A" />
      <circle cx="98" cy="22" r="11" fill="#9ACFAA" />
      <path d="m92.5 22 4 4 7-8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }

  if (name === 'arrow') {
    return (
      <svg {...common}>
        <path d="M5 12h13" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    )
  }

  if (name === 'book') {
    return (
      <svg {...common}>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z" />
        <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v17h4.5A2.5 2.5 0 0 1 20 22V5.5Z" />
      </svg>
    )
  }

  if (name === 'refresh') {
    return (
      <svg {...common}>
        <path d="M20 11a8.1 8.1 0 0 0-14.9-4L3 10" />
        <path d="M3 5v5h5" />
        <path d="M4 13a8.1 8.1 0 0 0 14.9 4L21 14" />
        <path d="M21 19v-5h-5" />
      </svg>
    )
  }

  if (name === 'check') {
    return (
      <svg {...common}>
        <path d="m5 12 4 4L19 6" />
      </svg>
    )
  }

  return null
}

export default function StudentWordlists({
  studentId,
}) {
  const [myGroups, setMyGroups] = useState([])
  const [lists, setLists] = useState([])
  const [myAttempts, setMyAttempts] = useState({})
  // Per list: how many words are known (review box 3+) / being learnt.
  const [mastery, setMastery] = useState({})
  const [playing, setPlaying] = useState(null)
  const [reviewing, setReviewing] = useState(false)
  const [racing, setRacing] = useState(false)
  const [myWordsOpen, setMyWordsOpen] = useState(false)
  const [reviewRefresh, setReviewRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  // 2026-10-06: a failed load used to show "no word lists" — now it
  // says it couldn't load and offers Retry.
  const [loadError, setLoadError] = useState('')

  const load = async () => {
    if (!studentId) return

    setLoading(true)
    setLoadError('')

    try {
      /*
       * -----------------------------------------------------
       * STUDENT GROUPS
       * -----------------------------------------------------
       */

      const { data: gm, error: groupError } =
        await supabase
          .from('group_members')
          .select('group_id')
          .eq('student_id', studentId)

      if (groupError) {
        throw groupError
      }

      const groupIds = (gm || []).map(
        (row) => row.group_id
      )

      setMyGroups(groupIds)

      if (!groupIds.length) {
        setLists([])
        setMyAttempts({})
        return
      }

      /*
 * -----------------------------------------------------
 * WORD LISTS
 *
 * Word lists can belong to multiple groups through the
 * wordlist_groups join table.
 *
 * We deliberately load the assignments first and then
 * load the actual word lists. This avoids relying on a
 * nested PostgREST filter which can behave inconsistently
 * with RLS policies.
 * -----------------------------------------------------
 */

const {
  data: assignments,
  error: assignmentsError,
} = await supabase
  .from('wordlist_groups')
  .select('wordlist_id, group_id')
  .in('group_id', groupIds)

if (assignmentsError) {
  throw assignmentsError
}

const wordlistIds = [
  ...new Set(
    (assignments || []).map(
      (row) => row.wordlist_id
    )
  ),
]

if (!wordlistIds.length) {
  setLists([])
  setMyAttempts({})
  return
}

const {
  data: wordlists,
  error: wordlistError,
} = await supabase
  .from('wordlists')
  .select(`
    *,
    wordlist_items(count)
  `)
  .in('id', wordlistIds)
  .order('created_at', {
    ascending: false,
  })


if (wordlistError) {
  throw wordlistError
}

setLists(wordlists || [])

      /*
       * -----------------------------------------------------
       * STUDENT ATTEMPTS
       * -----------------------------------------------------
       *
       * We intentionally load all attempts.
       *
       * For each word list:
       *
       *   attempt.created_at > completion_reset_at
       *
       * means the attempt belongs to the CURRENT practice
       * cycle.
       *
       * Attempts before the reset remain in the database
       * and therefore remain available to teachers as history.
       * -----------------------------------------------------
       */

      const {
        data: attempts,
        error: attemptsError,
      } = await supabase
        .from('wordlist_attempts')
        .select(
          'wordlist_id, percentage, score, total, created_at'
        )
        .eq('student_id', studentId)

      if (attemptsError) {
        throw attemptsError
      }

      const map = {}

      ;(wordlists || []).forEach(
        (list) => {
          const resetAt =
            list.completion_reset_at
              ? new Date(
                  list.completion_reset_at
                ).getTime()
              : null

          const currentAttempts =
            (attempts || []).filter(
              (attempt) => {
                if (
                  attempt.wordlist_id !==
                  list.id
                ) {
                  return false
                }

                if (!resetAt) {
                  return true
                }

                return (
                  new Date(
                    attempt.created_at
                  ).getTime() >
                  resetAt
                )
              }
            )

          if (
            currentAttempts.length
          ) {
            /*
             * If there are multiple attempts
             * after a reset, show the latest.
             */
            const latest =
              currentAttempts.reduce(
                (latest, current) =>
                  new Date(
                    current.created_at
                  ).getTime() >
                  new Date(
                    latest.created_at
                  ).getTime()
                    ? current
                    : latest
              )

            map[list.id] = latest
          }
        }
      )

      setMyAttempts(map)

      // Word mastery per list (spaced-repetition boxes, migration_69).
      try {
        const { data: progress } = await fetchAll(() =>
          supabase
            .from('word_progress')
            .select('item_id, wordlist_id, box')
            .eq('student_id', studentId)
            .in('wordlist_id', wordlistIds)
            .order('item_id')
        )
        const m = {}
        for (const row of progress || []) {
          const entry = (m[row.wordlist_id] ||= { known: 0, learning: 0 })
          if (row.box >= 3) entry.known += 1
          else entry.learning += 1
        }
        setMastery(m)
      } catch {
        setMastery({})
      }
    } catch (error) {
      console.error(
        'Could not load word lists:',
        error
      )

      setLoadError(
        error?.message || 'Could not load your word lists.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId])

  /*
   * -------------------------------------------------------
   * PLAYER
   * -------------------------------------------------------
   */

  if (racing) {
    return (
      <DailyMarathon
        studentId={studentId}
        wordlistIds={lists.map((l) => l.id)}
        onExit={() => {
          setRacing(false)
          setReviewRefresh((n) => n + 1)
        }}
      />
    )
  }

  if (myWordsOpen) {
    return (
      <MyWords
        studentId={studentId}
        onExit={() => {
          setMyWordsOpen(false)
          setReviewRefresh((n) => n + 1)
        }}
      />
    )
  }

  const practiceTiles = (
    <PracticeTiles
      studentId={studentId}
      refreshKey={reviewRefresh}
      onMarathon={() => setRacing(true)}
      onMyWords={() => setMyWordsOpen(true)}
    />
  )

  if (reviewing) {
    return (
      <WordReview
        studentId={studentId}
        wordlistIds={lists.map((l) => l.id)}
        onExit={() => {
          setReviewing(false)
          setReviewRefresh((n) => n + 1)
        }}
      />
    )
  }

  if (playing) {
    return (
      <WordlistPlayer
        wordlist={playing}
        studentId={studentId}
        onExit={() => {
          setPlaying(null)
          setReviewRefresh((n) => n + 1)
          load()
        }}
      />
    )
  }

  /*
   * -------------------------------------------------------
   * EMPTY / LOADING STATES
   * -------------------------------------------------------
   */

  if (loading) {
    return (
      <div className="flex flex-col gap-5">

        <div className="h-[132px] animate-pulse rounded-[20px] bg-panel-2" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-[150px] animate-pulse rounded-[20px] bg-panel-2" />
          <div className="h-[150px] animate-pulse rounded-[20px] bg-panel-2" />
        </div>

      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-5">

        <div className="border border-coral/40 bg-coral/10 rounded-lg px-5 py-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-coral text-sm">
            Couldn't load your word lists. Check your connection and try again.
          </p>

          <button
            type="button"
            onClick={() => load()}
            className="focus-ring px-3 py-1.5 rounded-md border border-coral/50 text-coral text-sm font-medium hover:bg-coral hover:text-paper"
          >
            Retry
          </button>
        </div>

      </div>
    )
  }

  if (myGroups.length === 0) {
    return (
      <div className="flex flex-col gap-5">

        <EmptyState icon="people" title="You're not in a group yet" text="Word lists from your teacher will appear here." />

      </div>
    )
  }

  if (lists.length === 0) {
    return (
      <div className="flex flex-col gap-5">

        {practiceTiles}
        <EmptyState icon="check" title="No word lists yet" text="New lists from your teacher will appear here." />

      </div>
    )
  }

  /*
   * -------------------------------------------------------
   * LIST
   * -------------------------------------------------------
   */

  return (
    <div className="flex flex-col gap-7">

      <DailyReviewCard
        studentId={studentId}
        wordlistIds={lists.map((l) => l.id)}
        refreshKey={reviewRefresh}
        onStart={() => setReviewing(true)}
      />

      {practiceTiles}

      <h2 className="-mb-3 font-brand text-[18px] font-semibold text-paper">Your word lists</h2>

      {/* LISTS — one card per list with word mastery (2026-10-06) */}

      <div className="grid gap-3 sm:grid-cols-2">
        {lists.map((list, i) => {
          const attempt = myAttempts[list.id]
          const count = list.wordlist_items?.[0]?.count ?? 0
          const isFresh = Boolean(list.completion_reset_at) && !attempt
          const m = mastery[list.id] || { known: 0, learning: 0 }
          const known = Math.min(m.known, count)
          const learning = Math.min(m.learning, Math.max(0, count - known))
          const fresh = Math.max(0, count - known - learning)
          const pctKnown = count ? Math.round((known / count) * 100) : 0
          return (
            <button
              key={list.id}
              type="button"
              onClick={() => setPlaying(list)}
              className="wp-pop focus-ring group flex w-full min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-panel p-4 text-left transition-all hover:-translate-y-0.5 hover:border-[#F3D27A] hover:shadow-[0_10px_24px_-14px_rgba(31,35,64,0.35)] sm:p-5"
              style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
            >
              <div className="flex items-start gap-3">
                <div className="relative h-11 w-11 shrink-0">
                  <span className="absolute inset-0 rotate-[-8deg] rounded-xl border border-[#F3D27A] bg-white transition-transform group-hover:rotate-[-14deg]" />
                  <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-vocab-tint text-vocab transition-transform group-hover:rotate-[4deg]">
                    <Icon name="book" size={19} />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-paper sm:text-lg">{list.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-mist">
                    <span>
                      {count} word{count === 1 ? '' : 's'}
                    </span>
                    {isFresh && (
                      <span className="inline-flex items-center gap-1 font-medium text-reading">
                        <Icon name="refresh" size={11} /> Fresh practice
                      </span>
                    )}
                  </p>
                </div>
                {attempt ? (
                  <span className="shrink-0 rounded-xl bg-panel-2 px-2.5 py-1 text-xs font-semibold tabular-nums text-paper" title="Latest test result">
                    {attempt.percentage}%
                  </span>
                ) : (
                  <span className="shrink-0 rounded-xl bg-vocab-tint px-2.5 py-1 text-xs font-semibold text-vocab">New</span>
                )}
              </div>

              {count > 0 && (
                <div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
                    <span className="h-full bg-reading transition-[width] duration-700" style={{ width: `${(known / count) * 100}%` }} />
                    <span className="h-full bg-[#F3D27A] transition-[width] duration-700" style={{ width: `${(learning / count) * 100}%` }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-mist">
                    <span>
                      <b className="font-semibold text-reading">{known}</b> known
                    </span>
                    <span>
                      <b className="font-semibold text-vocab">{learning}</b> learning
                    </span>
                    <span>
                      <b className="font-semibold text-paper-dim">{fresh}</b> new
                    </span>
                    <span className="ml-auto font-medium text-paper">{pctKnown}% mastered</span>
                  </div>
                </div>
              )}

              <span className="flex items-center justify-between text-sm font-medium text-paper">
                {attempt ? 'Practise again' : isFresh ? 'Start again' : 'Start with the cards'}
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-mist transition-colors group-hover:border-brass/60 group-hover:bg-brass group-hover:text-onbrass">
                  <Icon name="arrow" size={16} />
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}