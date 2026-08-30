import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import WordlistPlayer from './WordlistPlayer'

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
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!studentId) return

    setLoading(true)

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
       * completion_reset_at is important here.
       * It tells us when the teacher last reset this list.
       * -----------------------------------------------------
       */

      const {
        data: wordlists,
        error: wordlistError,
      } = await supabase
        .from('wordlists')
        .select(
          `
            *,
            wordlist_items(count),
            wordlist_groups!inner(group_id)
          `
        )
        .in(
          'wordlist_groups.group_id',
          groupIds
        )
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

      setLists([])
      setMyAttempts({})
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

  if (playing) {
    return (
      <WordlistPlayer
        wordlist={playing}
        studentId={studentId}
        onExit={() => {
          setPlaying(null)
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

        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-brass font-mono mb-2">
            Vocabulary studio
          </div>

          <h1 className="font-display text-2xl sm:text-3xl text-paper">
            Word lists
          </h1>
        </div>

        <div className="border border-line bg-panel-2 rounded-lg px-5 py-8">
          <p className="text-mist text-sm">
            Loading your vocabulary practiceвЂ¦
          </p>
        </div>

      </div>
    )
  }

  if (myGroups.length === 0) {
    return (
      <div className="flex flex-col gap-5">

        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-brass font-mono mb-2">
            Vocabulary studio
          </div>

          <h1 className="font-display text-2xl sm:text-3xl text-paper">
            Word lists
          </h1>

          <p className="text-mist text-sm mt-2">
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
          <div className="text-[11px] uppercase tracking-[0.2em] text-brass font-mono mb-2">
            Vocabulary studio
          </div>

          <h1 className="font-display text-2xl sm:text-3xl text-paper">
            Word lists
          </h1>

          <p className="text-mist text-sm mt-2">
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

        <div className="text-[11px] uppercase tracking-[0.2em] text-brass font-mono mb-2">
          Vocabulary studio
        </div>

        <h1 className="font-display text-2xl sm:text-3xl text-paper">
          Word lists
        </h1>

        <p className="text-mist text-sm mt-2 max-w-xl leading-relaxed">
          Build your IELTS vocabulary one item at a time.
          Complete a list, review your result, and practise again
          whenever your teacher resets it.
        </p>

      </div>

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