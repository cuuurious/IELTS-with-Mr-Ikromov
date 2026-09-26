import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Leaderboard({
  groupId,
  highlightStudentId,
  onOpenChat,
}) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [dailyProgress, setDailyProgress] = useState([])
  const [loadingDaily, setLoadingDaily] = useState(false)
  const [dailyError, setDailyError] = useState('')
  const [manageStudent, setManageStudent] = useState(null)
  const [groups, setGroups] = useState([])
  const [memberGroupIds, setMemberGroupIds] = useState([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [savingGroup, setSavingGroup] = useState('')
  const [groupError, setGroupError] = useState('')

  const getDateKey = (value) => {
    if (!value) return null

    const date = new Date(value)

    if (Number.isNaN(date.getTime())) {
      return null
    }

    return `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`
  }

  const dateFromKey = (key) => {
    if (!key) return null

    const date = new Date(`${key}T00:00:00`)

    return Number.isNaN(date.getTime())
      ? null
      : date
  }

  const formatDate = (key) => {
    const date = dateFromKey(key)

    if (!date) return key

    return date.toLocaleDateString([], {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  /*
   * A student's historical completion is taken from
   * homework_completions, NOT from the current submissions row.
   *
   * This means resetting homework does not erase history.
   */
  const calculateStreak = (days, now = new Date()) => {
    if (!days?.length) {
      return 0
    }

    const completedDates = new Set(
      days
        .filter((day) => day.completed >= day.total && day.total > 0)
        .map((day) => day.date)
    )

    if (!completedDates.size) {
      return 0
    }

    const today = new Date(now)
    today.setHours(0, 0, 0, 0)

    const todayKey = getDateKey(today)

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const yesterdayKey = getDateKey(yesterday)

    const todayDay = days.find(
      (day) => day.date === todayKey
    )

    /*
     * If today has homework and it is still within the deadline,
     * today's unfinished work must NOT break yesterday's streak.
     */
    let todayDeadlinePassed = true

    if (todayDay?.latestDueDate) {
      todayDeadlinePassed =
        new Date(todayDay.latestDueDate) <= now
    } else if (todayDay) {
      /*
       * No deadline means we do not automatically punish the
       * student merely because they have not submitted yet.
       */
      todayDeadlinePassed = false
    }

    let currentDate

    if (completedDates.has(todayKey)) {
      currentDate = today
    } else if (
      completedDates.has(yesterdayKey) &&
      !todayDeadlinePassed
    ) {
      currentDate = yesterday
    } else if (
      completedDates.has(yesterdayKey) &&
      todayDeadlinePassed
    ) {
      /*
       * Today's deadline has passed without today's completion.
       * Therefore the streak cannot continue from yesterday.
       */
      return 0
    } else {
      return 0
    }

    let streak = 0

    while (true) {
      const key = getDateKey(currentDate)

      if (!completedDates.has(key)) {
        break
      }

      streak += 1

      const previousDate = new Date(currentDate)
      previousDate.setDate(
        previousDate.getDate() - 1
      )

      currentDate = previousDate
    }

    return streak
  }

  const loadLeaderboard = async () => {
    if (!groupId) return

    setError('')

    const rpcName =
      groupId === 'all'
        ? 'all_students_leaderboard'
        : 'group_leaderboard'

    const params =
      groupId === 'all'
        ? {}
        : {
            p_group_id: groupId,
          }

    const {
      data,
      error: rpcError,
    } = await supabase.rpc(
      rpcName,
      params
    )

    if (rpcError) {
      console.error(
        'Leaderboard error:',
        rpcError
      )

      setError(rpcError.message)
      return
    }

    const initialRows = data || []

    /*
     * Get permanent completion timestamps so students with equal
     * progress are ranked by completion timing instead of surname.
     */
    let completionQuery = supabase
      .from('homework_completions')
      .select(
        'student_id, homework_id, completed_at'
      )

    if (groupId !== 'all') {
      const {
        data: groupHomework,
      } = await supabase
        .from('homeworks')
        .select('id')
        .eq(
          'group_id',
          groupId
        )

      const homeworkIds =
        (groupHomework || []).map(
          (homework) => homework.id
        )

      if (homeworkIds.length === 0) {
        completionQuery = null
      } else {
        completionQuery =
          completionQuery.in(
            'homework_id',
            homeworkIds
          )
      }
    }

    let completions = []

    if (completionQuery) {
      const {
        data: completionData,
        error: completionError,
      } = await completionQuery

      if (!completionError) {
        completions =
          completionData || []
      }
    }

    const completionTimes = new Map()

    completions.forEach(
      (completion) => {
        if (
          !completion.student_id ||
          !completion.completed_at
        ) {
          return
        }

        const time = new Date(
          completion.completed_at
        ).getTime()

        const previous =
          completionTimes.get(
            completion.student_id
          )

        if (
          !previous ||
          time < previous
        ) {
          completionTimes.set(
            completion.student_id,
            time
          )
        }
      }
    )

    const sortedRows =
      [...initialRows].sort(
        (a, b) => {
          const completedA =
            Number(a.completed) || 0

          const completedB =
            Number(b.completed) || 0

          if (
            completedA !==
            completedB
          ) {
            return completedB - completedA
          }

          const percentageA =
            Number(a.percentage) || 0

          const percentageB =
            Number(b.percentage) || 0

          if (
            percentageA !==
            percentageB
          ) {
            return percentageB - percentageA
          }

          const timeA =
            completionTimes.get(
              a.student_id
            ) ??
            Number.MAX_SAFE_INTEGER

          const timeB =
            completionTimes.get(
              b.student_id
            ) ??
            Number.MAX_SAFE_INTEGER

          if (
            timeA !==
            timeB
          ) {
            return timeA - timeB
          }

          return String(
            a.full_name || ''
          ).localeCompare(
            String(
              b.full_name || ''
            )
          )
        }
      )

    setRows(
      sortedRows.map(
        (row, index) => ({
          ...row,
          rank: index + 1,
        })
      )
    )
  }

  useEffect(() => {
    if (!groupId) return

    setRows(null)
    setError('')
    setSelectedStudent(null)
    setDailyProgress([])
    setDailyError('')

    loadLeaderboard()
  }, [groupId])

  /*
   * COMPLETE STUDENT HISTORY
   */
  const loadDailyProgress = async (
    student
  ) => {
    if (
      !student?.student_id ||
      !groupId
    ) {
      return null
    }

    setLoadingDaily(true)
    setDailyError('')
    setDailyProgress([])

    try {
      /*
       * --------------------------------------------------------
       * HOMEWORKS
       * --------------------------------------------------------
       */

      let homeworkQuery =
        supabase
          .from('homeworks')
          .select(`
            id,
            title,
            created_at,
            due_date,
            group_id
          `)

      if (groupId !== 'all') {
        homeworkQuery =
          homeworkQuery.eq(
            'group_id',
            groupId
          )
      }

      const {
        data: homeworks,
        error: homeworkError,
      } =
        await homeworkQuery.order(
          'created_at',
          {
            ascending: false,
          }
        )

      if (homeworkError) {
        throw homeworkError
      }

      /*
       * --------------------------------------------------------
       * CURRENT SUBMISSIONS
       * --------------------------------------------------------
       */

      let submissionQuery =
        supabase
          .from('submissions')
          .select(`
            id,
            homework_id,
            status,
            submitted_at,
            group_id
          `)
          .eq(
            'student_id',
            student.student_id
          )

      if (groupId !== 'all') {
        submissionQuery =
          submissionQuery.eq(
            'group_id',
            groupId
          )
      }

      const {
        data: submissions,
        error: submissionError,
      } =
        await submissionQuery.order(
          'submitted_at',
          {
            ascending: false,
          }
        )

      if (submissionError) {
        throw submissionError
      }

      /*
       * --------------------------------------------------------
       * PERMANENT COMPLETION HISTORY
       * --------------------------------------------------------
       *
       * This survives "Clear content" / homework reset.
       */

      const {
        data: historicalCompletions,
        error:
          completionHistoryError,
      } =
        await supabase
          .from('homework_completions')
          .select(`
            homework_id,
            completed_at,
            group_id
          `)
          .eq(
            'student_id',
            student.student_id
          )

      if (completionHistoryError) {
        throw completionHistoryError
      }

      /*
       * --------------------------------------------------------
       * INDEX CURRENT SUBMISSIONS
       * --------------------------------------------------------
       */

      const submissionByHomework =
        new Map()

      ;(submissions || []).forEach(
        (submission) => {
          const existing =
            submissionByHomework.get(
              submission.homework_id
            )

          if (
            !existing ||
            new Date(
              submission.submitted_at || 0
            ) >
              new Date(
                existing.submitted_at || 0
              )
          ) {
            submissionByHomework.set(
              submission.homework_id,
              submission
            )
          }
        }
      )

      /*
       * --------------------------------------------------------
       * INDEX PERMANENT COMPLETIONS
       * --------------------------------------------------------
       */

      const completionByHomework =
        new Map()

      ;(
        historicalCompletions || []
      ).forEach(
        (completion) => {
          const existing =
            completionByHomework.get(
              completion.homework_id
            )

          if (
            !existing ||
            new Date(
              completion.completed_at
            ) <
              new Date(
                existing.completed_at
              )
          ) {
            completionByHomework.set(
              completion.homework_id,
              completion
            )
          }
        }
      )

      /*
       * --------------------------------------------------------
       * BUILD DAILY HISTORY
       * --------------------------------------------------------
       */

      const grouped = {}

      ;(homeworks || []).forEach(
        (homework) => {
          const dateKey =
            getDateKey(
              homework.created_at
            )

          if (!dateKey) {
            return
          }

          if (!grouped[dateKey]) {
            grouped[dateKey] = {
              date: dateKey,
              tasks: [],
              completed: 0,
              total: 0,
              latestDueDate: null,
            }
          }

          if (
            homework.due_date
          ) {
            const existingDue =
              grouped[
                dateKey
              ].latestDueDate

            if (
              !existingDue ||
              new Date(
                homework.due_date
              ) >
                new Date(
                  existingDue
                )
            ) {
              grouped[
                dateKey
              ].latestDueDate =
                homework.due_date
            }
          }

          const submission =
            submissionByHomework.get(
              homework.id
            )

          const historicalCompletion =
            completionByHomework.get(
              homework.id
            )

          const currentlySubmitted =
            Boolean(
              submission?.submitted_at
            )

          const currentStatus =
            submission?.status ||
            'not_submitted'

          /*
           * HISTORICAL COMPLETION IS THE IMPORTANT PART.
           *
           * If the student submitted this homework before the
           * teacher reset it, homework_completions still exists.
           *
           * Therefore this remains DONE.
           */

          const completed =
            Boolean(
              historicalCompletion
            ) ||
            currentlySubmitted ||
            currentStatus === 'done' ||
            currentStatus === 'submitted'

          if (completed) {
            grouped[
              dateKey
            ].completed += 1
          }

          grouped[
            dateKey
          ].total += 1

          grouped[
            dateKey
          ].tasks.push({
            id: homework.id,
            title:
              homework.title ||
              'Homework',

            status:
              currentStatus,

            completed,

            submittedAt:
              submission?.submitted_at ||
              historicalCompletion?.completed_at ||
              null,

            dueDate:
              homework.due_date ||
              null,

            historicallyCompleted:
              Boolean(
                historicalCompletion
              ),

            currentlySubmitted:
              currentlySubmitted,
          })
        }
      )

      /*
       * Sort tasks.
       */

      Object.values(
        grouped
      ).forEach((day) => {
        day.tasks.sort(
          (a, b) =>
            a.title.localeCompare(
              b.title
            )
        )
      })

      /*
       * Newest day first.
       */

      const days =
        Object.values(
          grouped
        ).sort((a, b) =>
          b.date.localeCompare(
            a.date
          )
        )

      /*
       * Calculate streak using historical completions.
       */

      const streak =
        calculateStreak(days)

      setDailyProgress(
        days.map((day) => ({
          ...day,
          percentage:
            day.total > 0
              ? Math.round(
                  (day.completed /
                    day.total) *
                    100
                )
              : 0,
        }))
      )

      return streak
    } catch (err) {
      console.error(
        'Daily progress error:',
        err
      )

      setDailyError(
        err.message ||
          'Failed to load daily progress.'
      )

      setDailyProgress([])

      return null
    } finally {
      setLoadingDaily(false)
    }
  }

  const selectStudent = async (
    student
  ) => {
    setSelectedStudent({
      ...student,
    })

    const streak =
      await loadDailyProgress(
        student
      )

    if (
      streak !== null
    ) {
      setSelectedStudent(
        (previous) =>
          previous
            ? {
                ...previous,
                streak,
              }
            : previous
      )
    }
  }

  const handleChat = (
    student
  ) => {
    if (
      !student?.student_id
    ) {
      return
    }

    if (
      typeof onOpenChat ===
      'function'
    ) {
      onOpenChat(student)
      return
    }

    window.dispatchEvent(
      new CustomEvent(
        'notification-navigate',
        {
          detail: {
            link: `private-chat:${student.student_id}`,
          },
        }
      )
    )
  }

  const openManageGroups =
    async (
      student
    ) => {
      setManageStudent(student)
      setGroups([])
      setMemberGroupIds([])
      setGroupError('')
      setLoadingGroups(true)

      try {
        const {
          data: allGroups,
          error: groupsError,
        } =
          await supabase
            .from('groups')
            .select(
              'id, name, created_at'
            )
            .order(
              'created_at',
              {
                ascending: true,
              }
            )

        if (groupsError) {
          throw groupsError
        }

        const {
          data: memberships,
          error:
            membershipError,
        } =
          await supabase
            .from(
              'group_members'
            )
            .select(
              'group_id'
            )
            .eq(
              'student_id',
              student.student_id
            )

        if (membershipError) {
          throw membershipError
        }

        setGroups(
          allGroups || []
        )

        setMemberGroupIds(
          (
            memberships || []
          ).map(
            (membership) =>
              membership.group_id
          )
        )
      } catch (err) {
        console.error(err)
        setGroupError(
          err.message
        )
      } finally {
        setLoadingGroups(
          false
        )
      }
    }

  const closeManageGroups =
    () => {
      setManageStudent(null)
      setGroups([])
      setMemberGroupIds([])
      setGroupError('')
      setSavingGroup('')
    }

  const toggleGroupMembership =
    async (
      group,
      isMember
    ) => {
      if (
        !manageStudent
      ) {
        return
      }

      setSavingGroup(
        group.id
      )

      setGroupError('')

      try {
        if (isMember) {
          const {
            error,
          } =
            await supabase
              .from(
                'group_members'
              )
              .delete()
              .eq(
                'group_id',
                group.id
              )
              .eq(
                'student_id',
                manageStudent.student_id
              )

          if (error) {
            throw error
          }

          setMemberGroupIds(
            (prev) =>
              prev.filter(
                (id) =>
                  id !==
                  group.id
              )
          )
        } else {
          const {
            error,
          } =
            await supabase
              .from(
                'group_members'
              )
              .insert({
                group_id:
                  group.id,
                student_id:
                  manageStudent.student_id,
              })

          if (error) {
            if (
              error.code ===
              '23505'
            ) {
              setMemberGroupIds(
                (prev) =>
                  prev.includes(
                    group.id
                  )
                    ? prev
                    : [
                        ...prev,
                        group.id,
                      ]
              )
            } else {
              throw error
            }
          } else {
            setMemberGroupIds(
              (prev) =>
                prev.includes(
                  group.id
                )
                  ? prev
                  : [
                      ...prev,
                      group.id,
                    ]
            )
          }
        }

        await loadLeaderboard()
      } catch (err) {
        console.error(err)
        setGroupError(
          err.message
        )
      } finally {
        setSavingGroup('')
      }
    }

  const selectedStreak =
    useMemo(() => {
      if (
        !dailyProgress.length
      ) {
        return 0
      }

      return calculateStreak(
        dailyProgress
      )
    }, [
      dailyProgress,
    ])

  const closeStudentProfile =
    () => {
      setSelectedStudent(null)
      setDailyProgress([])
      setDailyError('')
    }

  if (error) {
    return (
      <p className="text-coral text-sm">
        {error}
      </p>
    )
  }

  if (rows === null) {
    return (
      <p className="text-mist text-sm">
        LoadingвЂ¦
      </p>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="text-mist text-sm">
        No students here yet.
      </p>
    )
  }

  const rankStyle =
    (rank) => {
      if (rank === 1) {
        return 'bg-brass text-onbrass border-brass'
      }

      if (rank === 2) {
        return 'bg-panel-2 text-paper border-mist'
      }

      if (rank === 3) {
        return 'bg-panel-2 text-paper border-brass-dim'
      }

      return 'bg-panel-2 text-mist border-line'
    }

  return (
    <div className="flex flex-col gap-3">

      {rows.map(
        (r) => {
          const rank =
            r.rank

          return (
            <button
              type="button"
              key={
                r.student_id
              }
              onClick={() =>
                selectStudent(r)
              }
              className={`ticket rounded-lg p-3 flex items-center gap-3 text-left w-full transition-colors hover:border-brass ${
                r.student_id ===
                highlightStudentId
                  ? 'border-brass'
                  : ''
              }`}
            >
              <div
                className={`flex-shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center font-display font-bold text-sm ${rankStyle(
                  rank
                )}`}
              >
                {rank}
              </div>

              <div className="flex-1 min-w-0">

                <div className="flex items-center justify-between gap-2">

                  <span className="font-medium truncate">
                    {r.full_name}
                  </span>

                  <span className="font-mono text-sm text-brass">
                    {r.percentage}%
                  </span>

                </div>

                <div className="text-xs text-mist font-mono mt-0.5">
                  @{r.username ||
                    'student'}
                </div>

                <div className="h-1.5 bg-panel-2 rounded-full overflow-hidden mt-1.5">

                  <div
                    className="h-full bg-brass rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          Number(
                            r.percentage
                          ) ||
                            0
                        )
                      )}%`,
                    }}
                  />

                </div>

                <div className="text-mist text-xs font-mono mt-1 flex gap-3">

                  <span>
                    {r.completed}/
                    {r.total}{' '}
                    tasks
                  </span>

                  {r.streak >
                    0 && (
                    <span>
                      рџ”Ґ{' '}
                      {r.streak}{' '}
                      day
                      {r.streak ===
                      1
                        ? ''
                        : 's'}{' '}
                      in a row
                    </span>
                  )}

                </div>

              </div>

              <div className="text-mist text-lg">
                вЂє
              </div>

            </button>
          )
        }
      )}

      {selectedStudent && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (
              e.target ===
              e.currentTarget
            ) {
              closeStudentProfile()
            }
          }}
        >

          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-panel border border-line rounded-xl shadow-2xl">

            <div className="sticky top-0 z-10 bg-panel border-b border-line px-5 py-4 flex items-start justify-between gap-4">

              <div className="flex items-center gap-3 min-w-0">

                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-brass text-onbrass flex items-center justify-center font-display font-bold text-lg">
                  {(
                    selectedStudent.full_name ||
                    '?'
                  )
                    .charAt(0)
                    .toUpperCase()}
                </div>

                <div className="min-w-0">

                  <div className="flex items-center gap-2 flex-wrap">

                    <span
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-display font-bold text-sm ${rankStyle(
                        selectedStudent.rank
                      )}`}
                    >
                      {
                        selectedStudent.rank
                      }
                    </span>

                    <h3 className="font-display text-xl truncate">
                      {
                        selectedStudent.full_name
                      }
                    </h3>

                  </div>

                  <p className="text-mist text-xs font-mono mt-1">
                    @
                    {selectedStudent.username ||
                      'student'}
                  </p>

                </div>

              </div>

              <button
                type="button"
                onClick={
                  closeStudentProfile
                }
                className="focus-ring flex-shrink-0 text-mist hover:text-paper text-xl"
                aria-label="Close student profile"
              >
                Г—
              </button>

            </div>

            <div className="p-5">

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">

                <div className="bg-panel-2 border border-line rounded-lg p-3">
                  <div className="text-xs text-mist font-mono">
                    Rank
                  </div>

                  <div className="text-xl font-display text-brass mt-1">
                    #
                    {
                      selectedStudent.rank
                    }
                  </div>
                </div>

                <div className="bg-panel-2 border border-line rounded-lg p-3">
                  <div className="text-xs text-mist font-mono">
                    Progress
                  </div>

                  <div className="text-xl font-display text-brass mt-1">
                    {
                      selectedStudent.percentage
                    }
                    %
                  </div>
                </div>

                <div className="bg-panel-2 border border-line rounded-lg p-3">
                  <div className="text-xs text-mist font-mono">
                    Completed
                  </div>

                  <div className="text-xl font-display mt-1">
                    {
                      selectedStudent.completed
                    }
                  </div>
                </div>

                <div className="bg-panel-2 border border-line rounded-lg p-3">
                  <div className="text-xs text-mist font-mono">
                    Streak
                  </div>

                  <div className="text-xl font-display mt-1">
                    рџ”Ґ{' '}
                    {selectedStreak}
                  </div>
                </div>

              </div>

              <div className="mt-5">

                <div className="flex justify-between text-xs font-mono mb-2">

                  <span className="text-mist">
                    Overall progress
                  </span>

                  <span className="text-brass">
                    {
                      selectedStudent.percentage
                    }
                    %
                  </span>

                </div>

                <div className="h-2 bg-panel-2 rounded-full overflow-hidden">

                  <div
                    className="h-full bg-brass rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          Number(
                            selectedStudent.percentage
                          ) ||
                            0
                        )
                      )}%`,
                    }}
                  />

                </div>

              </div>

              <div className="flex flex-wrap gap-2 mt-5">

                <button
                  type="button"
                  onClick={() =>
                    handleChat(
                      selectedStudent
                    )
                  }
                  className="focus-ring px-4 py-2 rounded-md border border-line text-sm text-paper hover:border-brass hover:text-brass"
                >
                  &#128172; Chat with
                  student
                </button>

                <button
                  type="button"
                  onClick={() =>
                    openManageGroups(
                      selectedStudent
                    )
                  }
                  className="focus-ring px-4 py-2 rounded-md border border-line text-sm text-paper hover:border-brass hover:text-brass"
                >
                  рџ‘Ґ Manage
                  groups
                </button>

              </div>

              <div className="mt-6 border-t border-line pt-5">

                <div>

                  <h4 className="font-medium text-lg">
                    Homework history
                  </h4>

                  <p className="text-xs text-mist mt-1">
                    Every assigned homework day is shown,
                    including days when the student did not
                    submit anything.
                  </p>

                </div>

                {loadingDaily && (
                  <div className="mt-3 bg-panel-2 border border-line rounded-lg p-4">
                    <p className="text-sm text-mist">
                      Loading homework
                      historyвЂ¦
                    </p>
                  </div>
                )}

                {dailyError && (
                  <div className="mt-3 bg-panel-2 border border-coral rounded-lg p-4">
                    <p className="text-sm text-coral">
                      Couldn't load
                      homework
                      history:{' '}
                      {
                        dailyError
                      }
                    </p>
                  </div>
                )}

                {!loadingDaily &&
                  !dailyError &&
                  dailyProgress.length ===
                    0 && (
                    <div className="mt-3 bg-panel-2 border border-line rounded-lg p-4">
                      <p className="text-sm text-mist">
                        No homework
                        history yet.
                      </p>
                    </div>
                  )}

                {!loadingDaily &&
                  !dailyError &&
                  dailyProgress.length >
                    0 && (
                    <div className="mt-3 flex flex-col gap-3">

                      {dailyProgress.map(
                        (
                          day
                        ) => (
                          <div
                            key={
                              day.date
                            }
                            className="bg-panel-2 border border-line rounded-lg p-4"
                          >

                            <div className="flex items-start justify-between gap-3 mb-3">

                              <div>

                                <div className="font-medium">
                                  {formatDate(
                                    day.date
                                  )}
                                </div>

                                <div className="text-xs text-mist font-mono mt-1">
                                  {
                                    day.completed
                                  }
                                  /
                                  {
                                    day.total
                                  }{' '}
                                  completed
                                </div>

                              </div>

                              <div className="text-right">

                                <div className="text-sm font-mono text-brass">
                                  {
                                    day.percentage
                                  }
                                  %
                                </div>

                                <div className="text-xs text-mist">
                                  daily
                                  progress
                                </div>

                              </div>

                            </div>

                            <div className="h-1.5 bg-panel rounded-full overflow-hidden mb-3">

                              <div
                                className="h-full bg-brass rounded-full"
                                style={{
                                  width: `${day.percentage}%`,
                                }}
                              />

                            </div>

                            <div className="flex flex-col gap-2">

                              {day.tasks.map(
                                (
                                  task
                                ) => (
                                  <div
                                    key={
                                      task.id
                                    }
                                    className="flex items-center justify-between gap-3 border-t border-line pt-2"
                                  >

                                    <div className="min-w-0">

                                      <div className="text-sm truncate">
                                        {
                                          task.title
                                        }
                                      </div>

                                      {task.submittedAt ? (
                                        <div className="text-xs text-mist font-mono mt-0.5">
                                          {task.historicallyCompleted &&
                                          !task.currentlySubmitted
                                            ? 'Historically completed '
                                            : 'Submitted '}
                                          {new Date(
                                            task.submittedAt
                                          ).toLocaleString(
                                            [],
                                            {
                                              month:
                                                'short',
                                              day:
                                                'numeric',
                                              hour:
                                                '2-digit',
                                              minute:
                                                '2-digit',
                                            }
                                          )}
                                        </div>
                                      ) : (
                                        <div className="text-xs text-mist font-mono mt-0.5">
                                          No submission
                                        </div>
                                      )}

                                      {task.dueDate && (
                                        <div className="text-xs text-mist font-mono mt-0.5">
                                          Deadline:{' '}
                                          {new Date(
                                            task.dueDate
                                          ).toLocaleString(
                                            [],
                                            {
                                              month:
                                                'short',
                                              day:
                                                'numeric',
                                              hour:
                                                '2-digit',
                                              minute:
                                                '2-digit',
                                            }
                                          )}
                                        </div>
                                      )}

                                    </div>

                                    <span
                                      className={`flex-shrink-0 text-xs font-mono ${
                                        task.completed
                                          ? 'text-brass'
                                          : 'text-coral'
                                      }`}
                                    >
                                      {task.completed
                                        ? 'DONE'
                                        : 'NOT DONE'}
                                    </span>

                                  </div>
                                )
                              )}

                            </div>

                          </div>
                        )
                      )}

                    </div>
                  )}

              </div>

            </div>

          </div>

        </div>
      )}

      {manageStudent && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60"
          onMouseDown={(
            e
          ) => {
            if (
              e.target ===
              e.currentTarget
            ) {
              closeManageGroups()
            }
          }}
        >

          <div className="w-full max-w-lg bg-panel border border-line rounded-xl shadow-2xl overflow-hidden">

            <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-4">

              <div>

                <h3 className="font-display text-xl">
                  Manage groups
                </h3>

                <p className="text-sm text-mist mt-1">
                  {
                    manageStudent.full_name
                  }
                </p>

              </div>

              <button
                type="button"
                onClick={
                  closeManageGroups
                }
                className="focus-ring text-mist hover:text-paper text-xl"
                aria-label="Close"
              >
                Г—
              </button>

            </div>

            <div className="p-5">

              {groupError && (
                <div className="mb-4 rounded-lg border border-coral/40 bg-coral/10 p-3 text-sm text-coral">
                  {
                    groupError
                  }
                </div>
              )}

              {loadingGroups ? (
                <div className="py-8 text-center text-mist">
                  Loading groupsвЂ¦
                </div>
              ) : groups.length ===
                0 ? (
                <div className="py-8 text-center">

                  <p className="text-mist">
                    No groups exist
                    yet.
                  </p>

                  <p className="text-xs text-mist mt-1">
                    Create a group
                    first from Groups
                    & homework.
                  </p>

                </div>
              ) : (
                <div className="flex flex-col gap-2">

                  {groups.map(
                    (
                      group
                    ) => {
                      const isMember =
                        memberGroupIds.includes(
                          group.id
                        )

                      const saving =
                        savingGroup ===
                        group.id

                      return (
                        <div
                          key={
                            group.id
                          }
                          className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                            isMember
                              ? 'border-brass bg-brass/5'
                              : 'border-line bg-panel-2'
                          }`}
                        >

                          <div
                            className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                              isMember
                                ? 'bg-brass text-onbrass'
                                : 'bg-panel border border-line text-mist'
                            }`}
                          >
                            {isMember
                              ? 'вњ“'
                              : 'в—‹'}
                          </div>

                          <div className="flex-1 min-w-0">

                            <div className="font-medium truncate">
                              {
                                group.name
                              }
                            </div>

                            <div className="text-xs text-mist mt-0.5">
                              {isMember
                                ? 'Student is a member'
                                : 'Student is not a member'}
                            </div>

                          </div>

                          <button
                            type="button"
                            disabled={
                              saving
                            }
                            onClick={() =>
                              toggleGroupMembership(
                                group,
                                isMember
                              )
                            }
                            className={`focus-ring px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40 ${
                              isMember
                                ? 'border border-coral text-coral hover:bg-coral/10'
                                : 'border border-brass text-brass hover:bg-brass hover:text-onbrass'
                            }`}
                          >
                            {saving
                              ? 'SavingвЂ¦'
                              : isMember
                              ? 'Remove'
                              : 'Add'}
                          </button>

                        </div>
                      )
                    }
                  )}

                </div>
              )}

              <div className="mt-5 pt-4 border-t border-line">

                <p className="text-xs text-mist">
                  Removing a
                  student from a
                  group does{' '}
                  <strong className="text-paper">
                    not
                  </strong>{' '}
                  delete their
                  account. It only
                  removes their
                  membership from that
                  group.
                </p>

              </div>

            </div>

            <div className="px-5 py-3 border-t border-line flex justify-end">

              <button
                type="button"
                onClick={
                  closeManageGroups
                }
                className="focus-ring px-4 py-2 rounded-md border border-line text-sm text-paper hover:border-brass hover:text-brass"
              >
                Done
              </button>

            </div>

          </div>

        </div>
      )}

    </div>
  )
}



