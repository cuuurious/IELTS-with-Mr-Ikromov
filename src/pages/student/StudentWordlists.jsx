import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import WordlistPlayer from './WordlistPlayer'
import WordReview, { REVIEW_SESSION_SIZE } from './WordReview'

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

  return (
    <div className="rounded-xl border border-brass/40 bg-panel-2 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-brass">Daily review</p>
          <p className="mt-1 font-display text-lg">
            {due > 0 ? `${sessionSize} word${sessionSize === 1 ? '' : 's'} to review today` : 'All caught up for today'}
          </p>
          <p className="mt-0.5 text-xs text-mist">
            {streak > 0
              ? `🔥 ${streak}-day streak${doneToday ? '' : ' — practise today to keep it'}`
              : 'Practise every day to build a streak.'}
            {due > REVIEW_SESSION_SIZE ? ` · ${due} due in total` : ''}
          </p>
        </div>
        {due > 0 && (
          <button
            type="button"
            onClick={onStart}
            className="focus-ring rounded-full bg-brass hover:bg-brass-dim px-5 py-2 text-sm font-semibold text-onbrass"
          >
            Start review
          </button>
        )}
      </div>
    </div>
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
  const [playing, setPlaying] = useState(null)
  const [reviewing, setReviewing] = useState(false)
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

        <div className="border border-line bg-panel-2 rounded-lg px-5 py-8">
          <p className="text-mist text-sm">
            Loading your vocabulary practice…
          </p>
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

        <div>
          <p className="text-mist text-sm">
            Vocabulary practice assigned by your teacher will
            appear here.
          </p>
        </div>

        <div className="border border-line bg-panel-2 rounded-lg px-5 py-8">
          <p className="text-mist text-sm">
            You're not in a group yet.
          </p>
        </div>

      </div>
    )
  }

  if (lists.length === 0) {
    return (
      <div className="flex flex-col gap-5">

        <div>
          <p className="text-mist text-sm">
            Your teacher hasn't posted a vocabulary list yet.
          </p>
        </div>

        <div className="border border-line bg-panel-2 rounded-lg px-5 py-8">
          <p className="text-mist text-sm">
            New vocabulary practice will appear here when it is
            assigned to your group.
          </p>
        </div>

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

      {/* HEADER */}

      <div>

        <p className="text-mist text-sm max-w-xl leading-relaxed">
          Build your IELTS vocabulary one item at a time.
          Complete a list, review your result, and practise again
          whenever your teacher resets it.
        </p>

      </div>

      <DailyReviewCard
        studentId={studentId}
        wordlistIds={lists.map((l) => l.id)}
        refreshKey={reviewRefresh}
        onStart={() => setReviewing(true)}
      />

      {/* LISTS */}

      <div className="flex flex-col gap-3">

        {lists.map((list) => {
          const attempt =
            myAttempts[list.id]

          const count =
            list.wordlist_items?.[0]
              ?.count ?? 0

          const isFresh =
            Boolean(
              list.completion_reset_at
            ) && !attempt

          return (
            <button
              key={list.id}
              type="button"
              onClick={() =>
                setPlaying(list)
              }
              className="
                focus-ring
                group
                w-full
                text-left
                border border-line
                bg-panel-2
                rounded-lg
                px-4 sm:px-5
                py-4
                transition-all
                hover:border-brass/50
              "
            >

              <div className="flex items-center gap-4">

                {/* ICON */}

                <div
                  className="
                    shrink-0
                    w-10 h-10
                    rounded-md
                    border border-line
                    bg-panel
                    flex items-center justify-center
                    text-brass
                    group-hover:border-brass/50
                    transition-colors
                  "
                >
                  <Icon
                    name="book"
                    size={19}
                  />
                </div>

                {/* MAIN CONTENT */}

                <div className="min-w-0 flex-1">

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">

                    <span className="text-[10px] uppercase tracking-[0.16em] font-mono text-brass">
                      Vocabulary
                    </span>

                    {isFresh && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] font-mono text-sage">
                        <Icon
                          name="refresh"
                          size={11}
                        />
                        Fresh practice
                      </span>
                    )}

                  </div>

                  <div className="font-display text-lg sm:text-xl text-paper mt-1 truncate">
                    {list.title}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mist font-mono mt-1.5">

                    <span>
                      {count}{' '}
                      {count === 1
                        ? 'item'
                        : 'items'}
                    </span>

                    <span className="text-line">
                      В·
                    </span>

                    <span>
                      {count > 0
                        ? 'IELTS vocabulary practice'
                        : 'No items'}
                    </span>

                  </div>

                </div>

                {/* STATUS */}

                <div className="shrink-0 flex items-center gap-3">

                  {attempt ? (
                    <div className="text-right">

                      <div className="font-mono text-lg text-brass leading-none">
                        {attempt.percentage}%
                      </div>

                      <div className="text-[9px] uppercase tracking-[0.12em] text-mist mt-1">
                        completed
                      </div>

                    </div>
                  ) : (
                    <div className="hidden sm:block text-right">

                      <div className="text-sm text-paper">
                        {isFresh
                          ? 'Start again'
                          : 'Start practice'}
                      </div>

                      <div className="text-[10px] text-mist font-mono mt-1">
                        {count}{' '}
                        {count === 1
                          ? 'item'
                          : 'items'}
                      </div>

                    </div>
                  )}

                  <span
                    className="
                      w-9 h-9
                      rounded-full
                      border border-line
                      flex items-center justify-center
                      text-mist
                      group-hover:border-brass/60
                      group-hover:text-brass
                      transition-colors
                    "
                  >
                    <Icon
                      name="arrow"
                      size={17}
                    />
                  </span>

                </div>

              </div>

              {/* COMPLETED PROGRESS */}

              {attempt && (
                <div className="mt-4">

                  <div className="h-1 bg-panel rounded-full overflow-hidden">

                    <div
                      className="h-full bg-brass rounded-full transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            0,
                            Number(
                              attempt.percentage
                            ) || 0
                          )
                        )}%`,
                      }}
                    />

                  </div>

                  <div className="flex items-center justify-between mt-2 text-[10px] font-mono text-mist">

                    <span>
                      Latest result
                    </span>

                    <span>
                      {attempt.score != null &&
                      attempt.total != null
                        ? `${attempt.score}/${attempt.total}`
                        : `${attempt.percentage}%`}
                    </span>

                  </div>

                </div>
              )}

            </button>
          )
        })}

      </div>

    </div>
  )
}