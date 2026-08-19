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

  /*
   * ----------------------------------------------------
   * LOAD LEADERBOARD
   * ----------------------------------------------------
   */

  const loadLeaderboard = async () => {
    if (!groupId) return

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

    const { data, error } =
      await supabase.rpc(
        rpcName,
        params
      )

    if (error) {
      console.error(
        'Leaderboard error:',
        error
      )

      setError(error.message)
      return
    }

    setRows(data || [])
  }

  useEffect(() => {
    if (!groupId) return

    setRows(null)
    setError('')
    setSelectedStudent(null)
    setDailyProgress([])

    loadLeaderboard()
  }, [groupId])

  /*
   * ----------------------------------------------------
   * DATE HELPERS
   * ----------------------------------------------------
   */

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

    const date = new Date(
      `${key}T00:00:00`
    )

    return Number.isNaN(date.getTime())
      ? null
      : date
  }

  const formatDate = (key) => {
    const date = dateFromKey(key)

    if (!date) return key

    return date.toLocaleDateString(
      [],
      {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }
    )
  }

  /*
   * ----------------------------------------------------
   * CALCULATE STREAK FROM REAL SUBMISSION HISTORY
   * ----------------------------------------------------
   *
   * We do NOT trust the RPC streak here.
   *
   * A day counts when the student submitted at least
   * one homework task on that day.
   *
   * Today counts if there is a submission today.
   * Otherwise the streak starts from yesterday.
   */

  const calculateStreak = (days) => {
    if (!days?.length) {
      return 0
    }

    const completedDates = new Set(
      days
        .filter(
          (day) =>
            day.completed > 0
        )
        .map(
          (day) => day.date
        )
    )

    if (!completedDates.size) {
      return 0
    }

    const today = new Date()

    today.setHours(
      0,
      0,
      0,
      0
    )

    const todayKey =
      getDateKey(today)

    const yesterday =
      new Date(today)

    yesterday.setDate(
      yesterday.getDate() - 1
    )

    const yesterdayKey =
      getDateKey(yesterday)

    /*
     * If neither today nor yesterday has work,
     * the active streak is zero.
     */
    let currentDate

    if (
      completedDates.has(
        todayKey
      )
    ) {
      currentDate = today
    } else if (
      completedDates.has(
        yesterdayKey
      )
    ) {
      currentDate = yesterday
    } else {
      return 0
    }

    let streak = 0

    while (true) {
      const key =
        getDateKey(
          currentDate
        )

      if (
        !completedDates.has(key)
      ) {
        break
      }

      streak += 1

      currentDate =
        new Date(
          currentDate
        )

      currentDate.setDate(
        currentDate.getDate() - 1
      )
    }

    return streak
  }

  /*
   * ----------------------------------------------------
   * LOAD COMPLETE DAILY HISTORY
   * ----------------------------------------------------
   *
   * IMPORTANT:
   * We load BOTH:
   *
   * 1. homeworks assigned to the group
   * 2. student's submissions
   *
   * This means previous days remain visible even when
   * the student submitted nothing on that day.
   */

  const loadDailyProgress = async (
    student
  ) => {
    if (
      !student?.student_id ||
      !groupId
    ) {
      return
    }

    setLoadingDaily(true)
    setDailyError('')
    setDailyProgress([])

    try {
      /*
       * ------------------------------------------------
       * LOAD HOMEWORKS
       * ------------------------------------------------
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
       * ------------------------------------------------
       * LOAD STUDENT SUBMISSIONS
       * ------------------------------------------------
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

      const submissionByHomework =
        new Map()

      ;(submissions || []).forEach(
        (submission) => {
          /*
           * Keep the latest submission
           * for each homework.
           */
          const existing =
            submissionByHomework.get(
              submission.homework_id
            )

          if (
            !existing ||
            new Date(
              submission.submitted_at ||
                0
            ) >
              new Date(
                existing.submitted_at ||
                  0
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
       * ------------------------------------------------
       * GROUP HOMEWORK BY ASSIGNMENT DATE
       * ------------------------------------------------
       *
       * We use created_at as the homework day.
       *
       * If due_date exists, it is displayed as extra
       * information but does not move the homework
       * into another day.
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
            }
          }

          const submission =
            submissionByHomework.get(
              homework.id
            )

          const submitted =
            Boolean(
              submission?.submitted_at
            )

          const status =
            submission?.status ||
            'not_submitted'

          const completed =
            submitted ||
            status === 'done' ||
            status === 'submitted'

          if (completed) {
            grouped[dateKey].completed +=
              1
          }

          grouped[dateKey].total += 1

          grouped[dateKey].tasks.push({
            id: homework.id,
            title:
              homework.title ||
              'Homework',
            status,
            completed,
            submittedAt:
              submission?.submitted_at ||
              null,
            dueDate:
              homework.due_date ||
              null,
          })
        }
      )

      /*
       * Sort tasks inside every day.
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

      const days =
        Object.values(
          grouped
        ).sort((a, b) =>
          b.date.localeCompare(
            a.date
          )
        )

      /*
       * Calculate streak from the ACTUAL history.
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

      /*
       * Return calculated streak so the selected
       * student can display the real value.
       */
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

  /*
   * ----------------------------------------------------
   * SELECT STUDENT
   * ----------------------------------------------------
   */

  const selectStudent = async (
    student
  ) => {
    /*
     * Keep the rank permanently attached to
     * the selected student.
     */
    const index =
      (rows || []).findIndex(
        (row) =>
          row.student_id ===
          student.student_id
      )

    const selectedWithRank = {
      ...student,
      rank:
        index >= 0
          ? index + 1
          : null,
    }

    setSelectedStudent(
      selectedWithRank
    )

    const streak =
      await loadDailyProgress(
        selectedWithRank
      )

    /*
     * Update the selected profile with the
     * freshly calculated streak.
     */
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

  /*
   * ----------------------------------------------------
   * CHAT WITH STUDENT
   * ----------------------------------------------------
   */

  const handleChat = (
    student
  ) => {
    if (
      !student?.student_id
    ) {
      console.error(
        'No student ID available:',
        student
      )

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

  /*
   * ----------------------------------------------------
   * OPEN MANAGE GROUPS
   * ----------------------------------------------------
   */

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

  /*
   * ----------------------------------------------------
   * ADD / REMOVE GROUP MEMBERSHIP
   * ----------------------------------------------------
   */

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

  /*
   * ----------------------------------------------------
   * DERIVED VALUES
   * ----------------------------------------------------
   */

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

  /*
   * ----------------------------------------------------
   * EARLY STATES
   * ----------------------------------------------------
   */

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
        Loading…
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

  /*
   * ----------------------------------------------------
   * MAIN UI
   * ----------------------------------------------------
   */

  return (
    <div className="flex flex-col gap-3">

      {/* ---------------------------------------------
          LEADERBOARD
         --------------------------------------------- */}

      {rows.map(
        (r, i) => {
          const rank =
            i + 1

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
                      🔥{' '}
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
                ›
              </div>

            </button>
          )
        }
      )}

      {/* ---------------------------------------------
          STUDENT DETAIL MODAL
          
          IMPORTANT:
          It is fixed instead of being inserted above
          the leaderboard. Therefore:
          - no page jump
          - rank numbers stay visible
          - clicking a student does not move the list
         --------------------------------------------- */}

      {selectedStudent && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (
              e.target ===
              e.currentTarget
            ) {
              setSelectedStudent(
                null
              )
              setDailyProgress(
                []
              )
              setDailyError('')
            }
          }}
        >

          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-panel border border-line rounded-xl shadow-2xl">

            {/* HEADER */}

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
                onClick={() => {
                  setSelectedStudent(
                    null
                  )
                  setDailyProgress(
                    []
                  )
                  setDailyError(
                    ''
                  )
                }}
                className="focus-ring flex-shrink-0 text-mist hover:text-paper text-xl"
                aria-label="Close student profile"
              >
                ×
              </button>

            </div>

            <div className="p-5">

              {/* STATS */}

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
                    🔥{' '}
                    {selectedStreak}
                  </div>

                </div>

              </div>

              {/* OVERALL PROGRESS */}

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

              {/* ACTIONS */}

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
                  💬 Chat with
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
                  👥 Manage
                  groups
                </button>

              </div>

              {/* DAILY HISTORY */}

              <div className="mt-6 border-t border-line pt-5">

                <div>

                  <h4 className="font-medium text-lg">
                    Homework history
                  </h4>

                  <p className="text-xs text-mist mt-1">
                    Previous days are shown even when the
                    student did not submit anything.
                  </p>

                </div>

                {loadingDaily && (
                  <div className="mt-3 bg-panel-2 border border-line rounded-lg p-4">

                    <p className="text-sm text-mist">
                      Loading homework
                      history…
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

                            {/* DAY HEADER */}

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

                            {/* DAILY PROGRESS BAR */}

                            <div className="h-1.5 bg-panel rounded-full overflow-hidden mb-3">

                              <div
                                className="h-full bg-brass rounded-full"
                                style={{
                                  width: `${day.percentage}%`,
                                }}
                              />

                            </div>

                            {/* HOMEWORK TASKS */}

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

                                      {task.submittedAt && (
                                        <div className="text-xs text-mist font-mono mt-0.5">
                                          Submitted{' '}
                                          {new Date(
                                            task.submittedAt
                                          ).toLocaleTimeString(
                                            [],
                                            {
                                              hour: '2-digit',
                                              minute:
                                                '2-digit',
                                            }
                                          )}
                                        </div>
                                      )}

                                      {!task.submittedAt && (
                                        <div className="text-xs text-mist font-mono mt-0.5">
                                          No submission
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

      {/* ---------------------------------------------
          MANAGE GROUPS MODAL
         --------------------------------------------- */}

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
                ×
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
                  Loading groups…
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
                              ? '✓'
                              : '○'}
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
                              ? 'Saving…'
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