import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'

export default function Leaderboard({
  groupId,
  highlightStudentId,
  onOpenChat,
}) {
  const { profile } = useAuth()
  const isTeacher = profile?.role === 'teacher'

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
    if (Number.isNaN(date.getTime())) return null

    return `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`
  }

  const dateFromKey = (key) => {
    if (!key) return null
    const date = new Date(`${key}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
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

  const calculateStreak = (days, now = new Date()) => {
    if (!days?.length) return 0

    const activeDates = new Set(
      days
        .filter((day) => Number(day.completed) > 0)
        .map((day) => day.date)
    )

    if (!activeDates.size) return 0

    const currentTime = new Date(now)

    const today = new Date(currentTime)
    today.setHours(0, 0, 0, 0)

    const todayKey = getDateKey(today)

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayKey = getDateKey(yesterday)

    const todayDay = days.find((day) => day.date === todayKey)

    const deadlinePassed = todayDay?.latestDueDate
      ? new Date(todayDay.latestDueDate) <= currentTime
      : false

    let currentDate = null

    if (activeDates.has(todayKey)) {
      currentDate = today
    } else if (activeDates.has(yesterdayKey) && !deadlinePassed) {
      currentDate = yesterday
    } else {
      return 0
    }

    let streak = 0

    while (true) {
      const key = getDateKey(currentDate)
      if (!activeDates.has(key)) break

      streak += 1

      const previous = new Date(currentDate)
      previous.setDate(previous.getDate() - 1)
      currentDate = previous
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
        : { p_group_id: groupId }

    const { data, error: rpcError } = await supabase.rpc(
      rpcName,
      params
    )

    if (rpcError) {
      console.error('Leaderboard error:', rpcError)
      setError(rpcError.message)
      return
    }

    const initialRows = data || []

    let completionQuery = supabase
      .from('homework_completions')
      .select('student_id, homework_id, completed_at')

    if (groupId !== 'all') {
      const { data: groupHomework } = await supabase
        .from('homeworks')
        .select('id')
        .eq('group_id', groupId)

      const homeworkIds = (groupHomework || []).map(
        (homework) => homework.id
      )

      if (homeworkIds.length === 0) {
        completionQuery = null
      } else {
        completionQuery = completionQuery.in(
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
        completions = completionData || []
      }
    }

    const completionTimes = new Map()

    completions.forEach((completion) => {
      if (!completion.student_id || !completion.completed_at) {
        return
      }

      const time = new Date(completion.completed_at).getTime()
      const previous = completionTimes.get(completion.student_id)

      if (!previous || time < previous) {
        completionTimes.set(completion.student_id, time)
      }
    })

    const sortedRows = [...initialRows].sort((a, b) => {
      const completedA = Number(a.completed) || 0
      const completedB = Number(b.completed) || 0

      if (completedA !== completedB) {
        return completedB - completedA
      }

      const percentageA = Number(a.percentage) || 0
      const percentageB = Number(b.percentage) || 0

      if (percentageA !== percentageB) {
        return percentageB - percentageA
      }

      const timeA =
        completionTimes.get(a.student_id) ??
        Number.MAX_SAFE_INTEGER

      const timeB =
        completionTimes.get(b.student_id) ??
        Number.MAX_SAFE_INTEGER

      if (timeA !== timeB) {
        return timeA - timeB
      }

      return String(a.full_name || '').localeCompare(
        String(b.full_name || '')
      )
    })

    setRows(
      sortedRows.map((row, index) => ({
        ...row,
        rank: index + 1,
      }))
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

  const loadDailyProgress = async (student) => {
    if (!student?.student_id || !groupId) return null

    setLoadingDaily(true)
    setDailyError('')
    setDailyProgress([])

    try {
      let homeworkQuery = supabase
        .from('homeworks')
        .select(`
          id,
          title,
          created_at,
          due_date,
          group_id
        `)

      if (groupId !== 'all') {
        homeworkQuery = homeworkQuery.eq('group_id', groupId)
      }

      const { data: homeworks, error: homeworkError } =
        await homeworkQuery.order('created_at', {
          ascending: false,
        })

      if (homeworkError) throw homeworkError

      let submissionQuery = supabase
        .from('submissions')
        .select(`
          id,
          homework_id,
          status,
          submitted_at,
          group_id
        `)
        .eq('student_id', student.student_id)

      if (groupId !== 'all') {
        submissionQuery = submissionQuery.eq(
          'group_id',
          groupId
        )
      }

      const { data: submissions, error: submissionError } =
        await submissionQuery.order('submitted_at', {
          ascending: false,
        })

      if (submissionError) throw submissionError

      const {
        data: historicalCompletions,
        error: completionError,
      } = await supabase
        .from('homework_completions')
        .select(`
          homework_id,
          completed_at,
          group_id
        `)
        .eq('student_id', student.student_id)

      if (completionError) throw completionError

      const homeworkById = new Map(
        (homeworks || []).map((homework) => [
          homework.id,
          homework,
        ])
      )

      const submissionByHomework = new Map()

      ;(submissions || []).forEach((submission) => {
        const existing = submissionByHomework.get(
          submission.homework_id
        )

        if (
          !existing ||
          new Date(submission.submitted_at || 0) >
            new Date(existing.submitted_at || 0)
        ) {
          submissionByHomework.set(
            submission.homework_id,
            submission
          )
        }
      })

      const completionByHomework = new Map()

      ;(historicalCompletions || []).forEach((completion) => {
        if (!homeworkById.has(completion.homework_id)) return

        const existing = completionByHomework.get(
          completion.homework_id
        )

        if (
          !existing ||
          new Date(completion.completed_at) <
            new Date(existing.completed_at)
        ) {
          completionByHomework.set(
            completion.homework_id,
            completion
          )
        }
      })

      const grouped = {}

      const ensureDay = (dateKey) => {
        if (!dateKey) return null

        if (!grouped[dateKey]) {
          grouped[dateKey] = {
            date: dateKey,
            tasks: [],
            completed: 0,
            total: 0,
            latestDueDate: null,
          }
        }

        return grouped[dateKey]
      }

      ;(homeworks || []).forEach((homework) => {
        const submission = submissionByHomework.get(
          homework.id
        )

        const historicalCompletion =
          completionByHomework.get(homework.id)

        const currentlySubmitted = Boolean(
          submission?.submitted_at ||
            submission?.status === 'done' ||
            submission?.status === 'submitted'
        )

        const completed = Boolean(
          historicalCompletion || currentlySubmitted
        )

        const completedAt =
          historicalCompletion?.completed_at ||
          submission?.submitted_at ||
          null

        const dateKey = getDateKey(
          completedAt ||
            homework.due_date ||
            homework.created_at
        )

        const day = ensureDay(dateKey)

        if (!day) return

        if (homework.due_date) {
          if (
            !day.latestDueDate ||
            new Date(homework.due_date) >
              new Date(day.latestDueDate)
          ) {
            day.latestDueDate = homework.due_date
          }
        }

        day.total += 1

        if (completed) {
          day.completed += 1
        }

        day.tasks.push({
          id: homework.id,
          title: homework.title || 'Homework',
          status: submission?.status || 'not_submitted',
          completed,
          submittedAt: completedAt,
          dueDate: homework.due_date || null,
          historicallyCompleted: Boolean(
            historicalCompletion
          ),
          currentlySubmitted,
        })
      })

      Object.values(grouped).forEach((day) => {
        day.tasks.sort((a, b) =>
          a.title.localeCompare(b.title)
        )
      })

      const days = Object.values(grouped).sort((a, b) =>
        b.date.localeCompare(a.date)
      )

      const streak = calculateStreak(days)

      setDailyProgress(
        days.map((day) => ({
          ...day,
          percentage:
            day.total > 0
              ? Math.round(
                  (day.completed / day.total) * 100
                )
              : 0,
        }))
      )

      return streak
    } catch (err) {
      console.error('Daily progress error:', err)

      setDailyError(
        err?.message ||
          'Failed to load daily progress.'
      )

      setDailyProgress([])
      return null
    } finally {
      setLoadingDaily(false)
    }
  }

  const selectStudent = async (student) => {
    setSelectedStudent({
      ...student,
      streak: 0,
    })

    const streak = await loadDailyProgress(student)

    if (streak !== null) {
      setSelectedStudent((previous) =>
        previous
          ? {
              ...previous,
              streak,
            }
          : previous
      )
    }
  }

  const handleChat = (student) => {
    if (!student?.student_id) return

    if (typeof onOpenChat === 'function') {
      onOpenChat(student)
      return
    }

    window.dispatchEvent(
      new CustomEvent('notification-navigate', {
        detail: {
          link: `private-chat:${student.student_id}`,
        },
      })
    )
  }

  const openManageGroups = async (student) => {
    if (!isTeacher || !student?.student_id) return

    setManageStudent(student)
    setGroups([])
    setMemberGroupIds([])
    setGroupError('')
    setLoadingGroups(true)

    try {
      const { data: allGroups, error: groupsError } =
        await supabase
          .from('groups')
          .select('id, name, created_at')
          .order('created_at', {
            ascending: true,
          })

      if (groupsError) throw groupsError

      const { data: memberships, error: membershipError } =
        await supabase
          .from('group_members')
          .select('group_id')
          .eq('student_id', student.student_id)

      if (membershipError) throw membershipError

      setGroups(allGroups || [])
      setMemberGroupIds(
        (memberships || []).map(
          (membership) => membership.group_id
        )
      )
    } catch (err) {
      console.error('Manage groups error:', err)
      setGroupError(
        err?.message || 'Failed to load groups.'
      )
    } finally {
      setLoadingGroups(false)
    }
  }

  const closeManageGroups = () => {
    setManageStudent(null)
    setGroups([])
    setMemberGroupIds([])
    setGroupError('')
    setSavingGroup('')
  }

  const toggleGroupMembership = async (
    group,
    isMember
  ) => {
    if (!manageStudent) return

    setSavingGroup(group.id)
    setGroupError('')

    try {
      if (isMember) {
        const { error: deleteError } = await supabase
          .from('group_members')
          .delete()
          .eq('group_id', group.id)
          .eq('student_id', manageStudent.student_id)

        if (deleteError) throw deleteError

        setMemberGroupIds((previous) =>
          previous.filter((id) => id !== group.id)
        )
      } else {
        const { error: insertError } = await supabase
          .from('group_members')
          .insert({
            group_id: group.id,
            student_id: manageStudent.student_id,
          })

        if (insertError && insertError.code !== '23505') {
          throw insertError
        }

        setMemberGroupIds((previous) =>
          previous.includes(group.id)
            ? previous
            : [...previous, group.id]
        )
      }

      await loadLeaderboard()
    } catch (err) {
      console.error('Group membership error:', err)
      setGroupError(
        err?.message ||
          'Failed to update group membership.'
      )
    } finally {
      setSavingGroup('')
    }
  }

  const selectedStreak = useMemo(
    () => calculateStreak(dailyProgress),
    [dailyProgress]
  )

  const closeStudentProfile = () => {
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
        Loading...
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

  const rankStyle = (rank) => {
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
      {rows.map((student) => (
        <button
          key={student.student_id}
          type="button"
          onClick={() => selectStudent(student)}
          className={`ticket w-full rounded-lg p-3 flex items-center gap-3 text-left transition-colors hover:border-brass ${
            student.student_id === highlightStudentId
              ? 'border-brass'
              : ''
          }`}
        >
          <div
            className={`flex-shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center font-display font-bold text-sm ${rankStyle(
              student.rank
            )}`}
          >
            {student.rank}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-paper truncate">
                {student.full_name}
              </span>

              <span className="font-mono text-sm text-brass">
                {student.percentage}%
              </span>
            </div>

            <div className="text-xs text-mist font-mono mt-0.5">
              @{student.username || 'student'}
            </div>

            <div className="h-1.5 bg-panel-2 rounded-full overflow-hidden mt-1.5">
              <div
                className="h-full bg-brass rounded-full transition-all"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      Number(student.percentage) || 0
                    )
                  )}%`,
                }}
              />
            </div>

            <div className="text-mist text-xs font-mono mt-1 flex gap-3">
              <span>
                {student.completed}/{student.total} tasks
              </span>

              {student.streak > 0 && (
                <span>
                  🔥 {student.streak}{' '}
                  {student.streak === 1 ? 'day' : 'days'} in a row
                </span>
              )}
            </div>
          </div>

          <div className="text-mist text-lg flex-shrink-0">
            ›
          </div>
        </button>
      ))}

      {selectedStudent &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeStudentProfile()
              }
            }}
          >
            <div
              className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-panel text-paper shadow-2xl"
              onMouseDown={(event) =>
                event.stopPropagation()
              }
            >
              <div className="flex-shrink-0 border-b border-line bg-panel px-5 py-4 sm:px-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border-2 font-display font-bold ${rankStyle(
                          selectedStudent.rank
                        )}`}
                      >
                        {selectedStudent.rank}
                      </div>

                      <div className="min-w-0">
                        <h2 className="truncate font-display text-xl font-semibold text-paper sm:text-2xl">
                          {selectedStudent.full_name}
                        </h2>

                        <p className="mt-0.5 truncate text-sm font-mono text-mist">
                          @{selectedStudent.username || 'student'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={closeStudentProfile}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-mist transition hover:border-brass hover:text-brass"
                    aria-label="Close student profile"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-line bg-panel-2 p-3">
                    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-mist">
                      Rank
                    </div>
                    <div className="mt-1 text-xl font-display text-brass">
                      #{selectedStudent.rank}
                    </div>
                  </div>

                  <div className="rounded-xl border border-line bg-panel-2 p-3">
                    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-mist">
                      Progress
                    </div>
                    <div className="mt-1 text-xl font-display text-brass">
                      {selectedStudent.percentage}%
                    </div>
                  </div>

                  <div className="rounded-xl border border-line bg-panel-2 p-3">
                    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-mist">
                      Completed
                    </div>
                    <div className="mt-1 text-xl font-display text-paper">
                      {selectedStudent.completed}
                    </div>
                  </div>

                  <div className="rounded-xl border border-line bg-panel-2 p-3">
                    <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-mist">
                      Streak
                    </div>
                    <div className="mt-1 text-xl font-display text-brass">
                      🔥 {selectedStudent.streak ?? selectedStreak}
                    </div>
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs font-mono">
                    <span className="text-mist">
                      Overall progress
                    </span>
                    <span className="text-brass">
                      {selectedStudent.percentage}%
                    </span>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                    <div
                      className="h-full rounded-full bg-brass transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            0,
                            Number(
                              selectedStudent.percentage
                            ) || 0
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {selectedStudent.contact_email && (
                    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper">
                      <span className="text-mist">
                        Email:{' '}
                      </span>
                      {selectedStudent.contact_email}
                    </div>
                  )}

                  <div className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper">
                    <span className="text-mist">
                      Status:{' '}
                    </span>
                    {selectedStudent.status || 'approved'}
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {typeof onOpenChat === 'function' && (
                    <button
                      type="button"
                      onClick={() =>
                        handleChat(selectedStudent)
                      }
                      className="rounded-xl border border-brass bg-brass/10 px-4 py-2 text-sm font-semibold text-brass transition hover:bg-brass/20"
                    >
                      Chat with student
                    </button>
                  )}

                  {isTeacher && (
                    <button
                      type="button"
                      onClick={() =>
                        openManageGroups(selectedStudent)
                      }
                      className="rounded-xl border border-line bg-panel-2 px-4 py-2 text-sm font-medium text-paper transition hover:border-brass hover:text-brass"
                    >
                      Manage groups
                    </button>
                  )}
                </div>

                <div className="mt-8 border-t border-line pt-6">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h3 className="font-display text-xl font-semibold text-paper">
                        Homework history
                      </h3>
                      <p className="mt-1 text-sm text-mist">
                        Daily completion and submission history
                      </p>
                    </div>

                    {loadingDaily && (
                      <span className="text-xs font-mono text-mist">
                        Loading...
                      </span>
                    )}
                  </div>

                  {dailyError && (
                    <div className="mt-4 rounded-xl border border-coral/40 bg-coral/10 p-4">
                      <p className="text-sm text-coral">
                        Couldn't load homework history:{' '}
                        {dailyError}
                      </p>
                    </div>
                  )}

                  {!loadingDaily &&
                    !dailyError &&
                    dailyProgress.length === 0 && (
                      <div className="mt-4 rounded-xl border border-line bg-panel-2 p-5">
                        <p className="text-sm text-mist">
                          No homework history yet.
                        </p>
                      </div>
                    )}

                  {!loadingDaily &&
                    !dailyError &&
                    dailyProgress.length > 0 && (
                      <div className="mt-4 flex flex-col gap-4">
                        {dailyProgress.map((day) => (
                          <div
                            key={day.date}
                            className="rounded-xl border border-line bg-panel-2 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium text-paper">
                                  {formatDate(day.date)}
                                </div>

                                <div className="mt-1 text-xs font-mono text-mist">
                                  {day.completed}/{day.total}{' '}
                                  completed
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="text-sm font-mono text-brass">
                                  {day.percentage}%
                                </div>
                                <div className="text-xs text-mist">
                                  daily progress
                                </div>
                              </div>
                            </div>

                            <div className="mb-3 mt-3 h-1.5 overflow-hidden rounded-full bg-panel">
                              <div
                                className="h-full rounded-full bg-brass"
                                style={{
                                  width: `${day.percentage}%`,
                                }}
                              />
                            </div>

                            <div className="flex flex-col">
                              {day.tasks.map((task) => (
                                <div
                                  key={task.id}
                                  className="flex items-start justify-between gap-4 border-t border-line py-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-paper">
                                      {task.title}
                                    </div>

                                    {task.submittedAt ? (
                                      <div className="mt-1 text-xs font-mono text-mist">
                                        {task.historicallyCompleted &&
                                        !task.currentlySubmitted
                                          ? 'Historically completed '
                                          : 'Submitted '}
                                        {new Date(
                                          task.submittedAt
                                        ).toLocaleString([], {
                                          month: 'short',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </div>
                                    ) : (
                                      <div className="mt-1 text-xs font-mono text-mist">
                                        No submission
                                      </div>
                                    )}

                                    {task.dueDate && (
                                      <div className="mt-1 text-xs font-mono text-mist">
                                        Deadline:{' '}
                                        {new Date(
                                          task.dueDate
                                        ).toLocaleString([], {
                                          month: 'short',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </div>
                                    )}
                                  </div>

                                  <span
                                    className={`flex-shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-mono font-semibold ${
                                      task.completed
                                        ? 'border-sage/50 bg-sage/10 text-sage'
                                        : 'border-coral/50 bg-coral/10 text-coral'
                                    }`}
                                  >
                                    {task.completed
                                      ? 'DONE'
                                      : 'NOT DONE'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-line bg-panel px-5 py-4 sm:px-7">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeStudentProfile}
                    className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-onaccent transition hover:brightness-105"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {isTeacher &&
        manageStudent &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeManageGroups()
              }
            }}
          >
            <div
              className="w-full max-w-lg max-h-[85vh] overflow-hidden rounded-2xl border border-line bg-panel text-paper shadow-2xl"
              onMouseDown={(event) =>
                event.stopPropagation()
              }
            >
              <div className="flex items-start justify-between gap-4 border-b border-line bg-panel px-5 py-4">
                <div className="min-w-0">
                  <h3 className="truncate font-display text-xl font-semibold text-paper">
                    Manage groups
                  </h3>
                  <p className="mt-1 truncate text-sm text-mist">
                    {manageStudent.full_name}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeManageGroups}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-mist transition hover:border-brass hover:text-brass"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="max-h-[calc(85vh-80px)] overflow-y-auto p-5">
                {groupError && (
                  <div className="mb-4 rounded-xl border border-coral/40 bg-coral/10 p-3 text-sm text-coral">
                    {groupError}
                  </div>
                )}

                {loadingGroups ? (
                  <div className="py-10 text-center text-sm text-mist">
                    Loading groups...
                  </div>
                ) : groups.length === 0 ? (
                  <div className="rounded-xl border border-line bg-panel-2 p-6 text-center">
                    <p className="text-sm text-mist">
                      No groups exist yet.
                    </p>
                    <p className="mt-1 text-xs text-mist">
                      Create a group first from Groups & homework.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {groups.map((group) => {
                      const isMember =
                        memberGroupIds.includes(group.id)

                      const saving =
                        savingGroup === group.id

                      return (
                        <div
                          key={group.id}
                          className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                            isMember
                              ? 'border-brass/50 bg-brass/10'
                              : 'border-line bg-panel-2'
                          }`}
                        >
                          <div
                            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                              isMember
                                ? 'bg-brass text-onbrass'
                                : 'border border-line bg-panel text-mist'
                            }`}
                          >
                            {isMember ? '✓' : '—'}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-paper">
                              {group.name}
                            </div>

                            <div className="mt-0.5 text-xs text-mist">
                              {isMember
                                ? 'Student is a member'
                                : 'Student is not a member'}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              toggleGroupMembership(
                                group,
                                isMember
                              )
                            }
                            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
                              isMember
                                ? 'border border-coral text-coral hover:bg-coral/10'
                                : 'border border-brass text-brass hover:bg-brass hover:text-onbrass'
                            }`}
                          >
                            {saving
                              ? 'Saving...'
                              : isMember
                              ? 'Remove'
                              : 'Add'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-xs leading-5 text-mist">
                    Removing a student from a group does{' '}
                    <strong className="text-paper">
                      not
                    </strong>{' '}
                    delete their account. It only removes their
                    membership from that group.
                  </p>
                </div>

                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={closeManageGroups}
                    className="rounded-xl border border-line bg-panel-2 px-4 py-2 text-sm font-medium text-paper transition hover:border-brass hover:text-brass"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
