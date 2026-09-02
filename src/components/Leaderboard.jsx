import { useEffect, useState } from 'react'
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

  /*
   * ============================================================
   * SHARED "WHAT DID THIS STUDENT ACTUALLY COMPLETE" LOGIC
   * ============================================================
   *
   * This is the ONE place that decides, from a student's raw
   * homeworks/submissions/completions rows, which homeworks
   * count as completed, which day each belongs to, and whether
   * a completion happened after its deadline.
   *
   * It used to be duplicated (once for the main leaderboard
   * list, sourced from a Supabase RPC that isn't visible here,
   * and once for the "Homework history" popup, computed in the
   * browser) — the two never had to agree, which is why the
   * list and the popup could show different numbers for the
   * exact same student. Every place in this file that needs
   * completed/total/percentage/streak/day-by-day history now
   * calls this same function so they can't drift apart again.
   * ============================================================
   */

  const computeDailyProgress = (
    homeworks,
    submissions,
    completions
  ) => {
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

    const homeworkById = new Map(
      (homeworks || []).map((homework) => [
        homework.id,
        homework,
      ])
    )

    const completionByHomework = new Map()

    ;(completions || []).forEach((completion) => {
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

    let completedCount = 0
    let earliestCompletionTime = null

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

      const late = Boolean(
        completed &&
          completedAt &&
          homework.due_date &&
          new Date(completedAt).getTime() >
            new Date(homework.due_date).getTime()
      )

      const dateKey = getDateKey(
        completedAt ||
          homework.due_date ||
          homework.created_at
      )

      const day = ensureDay(dateKey)

      if (day) {
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
          late,
          submittedAt: completedAt,
          dueDate: homework.due_date || null,
          historicallyCompleted: Boolean(
            historicalCompletion
          ),
          currentlySubmitted,
        })
      }

      if (completed) {
        completedCount += 1

        if (completedAt) {
          const time = new Date(completedAt).getTime()

          if (
            !earliestCompletionTime ||
            time < earliestCompletionTime
          ) {
            earliestCompletionTime = time
          }
        }
      }
    })

    Object.values(grouped).forEach((day) => {
      day.tasks.sort((a, b) =>
        a.title.localeCompare(b.title)
      )
    })

    const days = Object.values(grouped)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((day) => ({
        ...day,
        percentage:
          day.total > 0
            ? Math.round(
                (day.completed / day.total) * 100
              )
            : 0,
      }))

    const total = (homeworks || []).length

    const percentage =
      total > 0
        ? Math.round((completedCount / total) * 100)
        : 0

    return {
      days,
      completed: completedCount,
      total,
      percentage,
      earliestCompletionTime,
    }
  }

  const loadLeaderboard = async () => {
    if (!groupId) return

    setError('')

    try {
      /*
       * ========================================================
       * 1. ROSTER
       * ========================================================
       * For "all students" we also need each student's own
       * group memberships, so that when we total up their
       * homeworks below we only count homeworks from groups
       * they're actually in — not every homework that exists
       * for every group in the school.
       * ========================================================
       */

      let studentRows = []
      const groupIdsByStudent = new Map()

      if (groupId === 'all') {
        const { data: profilesData, error: profilesError } =
          await supabase
            .from('profiles')
            .select(
              'id, full_name, username, contact_email, status'
            )
            .eq('role', 'student')

        if (profilesError) throw profilesError

        studentRows = (profilesData || []).map((p) => ({
          student_id: p.id,
          full_name: p.full_name,
          username: p.username,
          contact_email: p.contact_email,
          status: p.status,
        }))

        const { data: memberRows, error: memberError } =
          await supabase
            .from('group_members')
            .select('student_id, group_id')

        if (memberError) throw memberError

        ;(memberRows || []).forEach((row) => {
          if (!groupIdsByStudent.has(row.student_id)) {
            groupIdsByStudent.set(
              row.student_id,
              new Set()
            )
          }

          groupIdsByStudent
            .get(row.student_id)
            .add(row.group_id)
        })
      } else {
        const { data: memberRows, error: memberError } =
          await supabase
            .from('group_members')
            .select(
              'student_id, profiles(id, full_name, username, contact_email, status)'
            )
            .eq('group_id', groupId)

        if (memberError) throw memberError

        studentRows = (memberRows || [])
          .filter((m) => m.profiles)
          .map((m) => ({
            student_id: m.student_id,
            full_name: m.profiles.full_name,
            username: m.profiles.username,
            contact_email: m.profiles.contact_email,
            status: m.profiles.status,
          }))
      }

      /*
       * ========================================================
       * 2. HOMEWORKS IN SCOPE
       * ========================================================
       */

      let homeworkQuery = supabase
        .from('homeworks')
        .select('id, title, due_date, created_at, group_id')

      if (groupId !== 'all') {
        homeworkQuery = homeworkQuery.eq(
          'group_id',
          groupId
        )
      }

      const { data: homeworks, error: homeworksError } =
        await homeworkQuery

      if (homeworksError) throw homeworksError

      const homeworkIds = (homeworks || []).map(
        (homework) => homework.id
      )

      /*
       * ========================================================
       * 3. SUBMISSIONS + COMPLETIONS FOR EVERYONE, ONE SHOT
       * ========================================================
       */

      let submissions = []
      let completions = []

      if (homeworkIds.length) {
        const { data: subData, error: subError } =
          await supabase
            .from('submissions')
            .select(
              'student_id, homework_id, status, submitted_at'
            )
            .in('homework_id', homeworkIds)

        if (subError) throw subError
        submissions = subData || []

        const { data: compData, error: compError } =
          await supabase
            .from('homework_completions')
            .select(
              'student_id, homework_id, completed_at'
            )
            .in('homework_id', homeworkIds)

        if (compError) throw compError
        completions = compData || []
      }

      const submissionsByStudent = new Map()

      submissions.forEach((submission) => {
        if (
          !submissionsByStudent.has(submission.student_id)
        ) {
          submissionsByStudent.set(
            submission.student_id,
            []
          )
        }

        submissionsByStudent
          .get(submission.student_id)
          .push(submission)
      })

      const completionsByStudent = new Map()

      completions.forEach((completion) => {
        if (
          !completionsByStudent.has(completion.student_id)
        ) {
          completionsByStudent.set(
            completion.student_id,
            []
          )
        }

        completionsByStudent
          .get(completion.student_id)
          .push(completion)
      })

      /*
       * ========================================================
       * 4. COMPUTE EVERY STUDENT'S STATS
       * ========================================================
       * Same computeDailyProgress() function the profile popup
       * uses below, so the list and the popup can never disagree
       * again.
       * ========================================================
       */

      const computedRows = studentRows.map((student) => {
        const relevantHomeworks =
          groupId === 'all'
            ? (homeworks || []).filter((homework) =>
                groupIdsByStudent
                  .get(student.student_id)
                  ?.has(homework.group_id)
              )
            : homeworks || []

        const {
          days,
          completed,
          total,
          percentage,
          earliestCompletionTime,
        } = computeDailyProgress(
          relevantHomeworks,
          submissionsByStudent.get(
            student.student_id
          ) || [],
          completionsByStudent.get(
            student.student_id
          ) || []
        )

        return {
          ...student,
          completed,
          total,
          percentage,
          streak: calculateStreak(days),
          _earliestCompletionTime: earliestCompletionTime,
        }
      })

      const sortedRows = [...computedRows].sort((a, b) => {
        if (a.completed !== b.completed) {
          return b.completed - a.completed
        }

        if (a.percentage !== b.percentage) {
          return b.percentage - a.percentage
        }

        const timeA =
          a._earliestCompletionTime ??
          Number.MAX_SAFE_INTEGER

        const timeB =
          b._earliestCompletionTime ??
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
    } catch (err) {
      console.error('Leaderboard error:', err)
      setError(
        err?.message || 'Failed to load the leaderboard.'
      )
    }
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

      const { data: allHomeworks, error: homeworkError } =
        await homeworkQuery.order('created_at', {
          ascending: false,
        })

      if (homeworkError) throw homeworkError

      let homeworks = allHomeworks || []

      /*
       * For "all students", only count homeworks from groups
       * this specific student actually belongs to — not every
       * homework that exists across every group.
       */
      if (groupId === 'all') {
        const {
          data: memberRows,
          error: memberError,
        } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('student_id', student.student_id)

        if (memberError) throw memberError

        const studentGroupIds = new Set(
          (memberRows || []).map((row) => row.group_id)
        )

        homeworks = homeworks.filter((homework) =>
          studentGroupIds.has(homework.group_id)
        )
      }

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

      const {
        days,
        completed,
        total,
        percentage,
      } = computeDailyProgress(
        homeworks,
        submissions || [],
        historicalCompletions || []
      )

      const streak = calculateStreak(days)

      setDailyProgress(days)

      /*
       * Keep the Rank/Progress/Completed summary box in sync
       * with the "Homework history" list right below it — both
       * now come from the exact same calculation.
       */
      setSelectedStudent((previous) =>
        previous
          ? {
              ...previous,
              completed,
              total,
              percentage,
            }
          : previous
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
                      🔥 {selectedStudent.streak ?? 0}
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
                                      !task.completed
                                        ? 'border-coral/50 bg-coral/10 text-coral'
                                        : task.late
                                        ? 'border-amber/50 bg-amber/10 text-amber'
                                        : 'border-sage/50 bg-sage/10 text-sage'
                                    }`}
                                  >
                                    {!task.completed
                                      ? 'NOT DONE'
                                      : task.late
                                      ? 'LATE'
                                      : 'DONE'}
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
