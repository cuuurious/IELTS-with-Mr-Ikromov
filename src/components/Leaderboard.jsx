import { useEffect, useState } from 'react'
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

  useEffect(() => {
    if (!groupId) return

    setRows(null)
    setError('')
    setSelectedStudent(null)
    setDailyProgress([])

    const loadLeaderboard = async () => {
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
      } else {
        setRows(data || [])
      }
    }

    loadLeaderboard()
  }, [groupId])

  const loadDailyProgress = async (student) => {
    if (!student?.student_id || !groupId) {
      return
    }

    setLoadingDaily(true)
    setDailyError('')
    setDailyProgress([])

    try {
      let query = supabase
        .from('submissions')
        .select(`
          id,
          homework_id,
          status,
          submitted_at,
          group_id,
          homeworks (
            id,
            title,
            created_at,
            due_date
          )
        `)
        .eq(
          'student_id',
          student.student_id
        )

      /*
       * In a normal group leaderboard,
       * only show submissions from that group.
       *
       * In All Students mode, show submissions
       * from all groups.
       */
      if (groupId !== 'all') {
        query = query.eq(
          'group_id',
          groupId
        )
      }

      const {
        data,
        error,
      } = await query.order(
        'submitted_at',
        {
          ascending: false,
        }
      )

      if (error) throw error

      const submissions = data || []
      const grouped = {}

      submissions.forEach((submission) => {
        if (!submission.submitted_at) {
          return
        }

        const date = new Date(
          submission.submitted_at
        )

        if (
          Number.isNaN(
            date.getTime()
          )
        ) {
          return
        }

        const dateKey =
          `${date.getFullYear()}-${String(
            date.getMonth() + 1
          ).padStart(2, '0')}-${String(
            date.getDate()
          ).padStart(2, '0')}`

        if (!grouped[dateKey]) {
          grouped[dateKey] = {
            date: dateKey,
            tasks: [],
          }
        }

        grouped[dateKey].tasks.push({
          id: submission.id,
          title:
            submission.homeworks?.title ||
            'Homework',
          status:
            submission.status ||
            'pending',
          submittedAt:
            submission.submitted_at,
        })
      })

      const days = Object.values(
        grouped
      ).sort((a, b) =>
        b.date.localeCompare(a.date)
      )

      setDailyProgress(days)
    } catch (err) {
      console.error(
        'Daily progress error:',
        err
      )

      setDailyError(
        err.message
      )

      setDailyProgress([])
    } finally {
      setLoadingDaily(false)
    }
  }

  const selectStudent = (student) => {
    setSelectedStudent(student)
    loadDailyProgress(student)
  }

  /*
   * CHAT WITH STUDENT
   */
  const handleChat = (student) => {
    if (!student?.student_id) {
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
   * OPEN MANAGE GROUPS
   */
  const openManageGroups = async (
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
      } = await supabase
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
        error: membershipError,
      } = await supabase
        .from('group_members')
        .select('group_id')
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
        (memberships || []).map(
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

  /*
   * ADD / REMOVE GROUP MEMBERSHIP
   */
  const toggleGroupMembership = async (
    group,
    isMember
  ) => {
    if (!manageStudent) {
      return
    }

    setSavingGroup(group.id)
    setGroupError('')

    try {
      if (isMember) {
        const { error } =
          await supabase
            .from('group_members')
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
                id !== group.id
            )
        )
      } else {
        const { error } =
          await supabase
            .from('group_members')
            .insert({
              group_id: group.id,
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

      /*
       * Refresh the currently visible leaderboard.
       */
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
        error,
      } = await supabase.rpc(
        rpcName,
        params
      )

      if (!error) {
        setRows(data || [])
      }
    } catch (err) {
      console.error(err)
      setGroupError(
        err.message
      )
    } finally {
      setSavingGroup('')
    }
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

      {selectedStudent && (
        <div className="ticket rounded-lg border-brass p-5">

          <div className="flex items-start justify-between gap-4">

            <div className="flex items-center gap-3 min-w-0">

              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-brass text-onbrass flex items-center justify-center font-display font-bold text-lg">
                {(selectedStudent.full_name || '?')
                  .charAt(0)
                  .toUpperCase()}
              </div>

              <div className="min-w-0">

                <h3 className="font-display text-xl truncate">
                  {selectedStudent.full_name}
                </h3>

                <p className="text-mist text-xs font-mono mt-1">
                  @{selectedStudent.username || 'student'}
                </p>

              </div>

            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedStudent(null)
                setDailyProgress([])
              }}
              className="focus-ring text-mist hover:text-paper text-xl"
              aria-label="Close student profile"
            >
              ×
            </button>

          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">

            <div className="bg-panel-2 border border-line rounded-lg p-3">
              <div className="text-xs text-mist font-mono">
                Progress
              </div>

              <div className="text-xl font-display text-brass mt-1">
                {selectedStudent.percentage}%
              </div>
            </div>

            <div className="bg-panel-2 border border-line rounded-lg p-3">
              <div className="text-xs text-mist font-mono">
                Completed
              </div>

              <div className="text-xl font-display mt-1">
                {selectedStudent.completed}
              </div>
            </div>

            <div className="bg-panel-2 border border-line rounded-lg p-3">
              <div className="text-xs text-mist font-mono">
                Total tasks
              </div>

              <div className="text-xl font-display mt-1">
                {selectedStudent.total}
              </div>
            </div>

            <div className="bg-panel-2 border border-line rounded-lg p-3">
              <div className="text-xs text-mist font-mono">
                Streak
              </div>

              <div className="text-xl font-display mt-1">
                🔥 {selectedStudent.streak || 0}
              </div>
            </div>

          </div>

          <div className="mt-5">

            <div className="flex justify-between text-xs font-mono mb-2">

              <span className="text-mist">
                Overall progress
              </span>

              <span className="text-brass">
                {selectedStudent.percentage}%
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
                      ) || 0
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
              💬 Chat with student
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
              👥 Manage groups
            </button>

          </div>

          <div className="mt-5 border-t border-line pt-4">

            <div>

              <h4 className="font-medium">
                Daily progress
              </h4>

              <p className="text-xs text-mist mt-1">
                Homework submitted by this student, grouped by day.
              </p>

            </div>

            {loadingDaily && (
              <div className="mt-3 bg-panel-2 border border-line rounded-lg p-4">

                <p className="text-sm text-mist">
                  Loading daily progress…
                </p>

              </div>
            )}

            {dailyError && (
              <div className="mt-3 bg-panel-2 border border-coral rounded-lg p-4">

                <p className="text-sm text-coral">
                  Couldn't load daily progress: {dailyError}
                </p>

              </div>
            )}

            {!loadingDaily &&
              !dailyError &&
              dailyProgress.length === 0 && (
                <div className="mt-3 bg-panel-2 border border-line rounded-lg p-4">

                  <p className="text-sm text-mist">
                    No submitted homework yet.
                  </p>

                </div>
              )}

            {!loadingDaily &&
              !dailyError &&
              dailyProgress.length > 0 && (
                <div className="mt-3 flex flex-col gap-3">

                  {dailyProgress.map(
                    (day) => {

                      const date =
                        new Date(
                          `${day.date}T00:00:00`
                        )

                      const formattedDate =
                        date.toLocaleDateString(
                          [],
                          {
                            weekday:
                              'long',
                            month:
                              'short',
                            day:
                              'numeric',
                            year:
                              'numeric',
                          }
                        )

                      return (
                        <div
                          key={
                            day.date
                          }
                          className="bg-panel-2 border border-line rounded-lg p-4"
                        >

                          <div className="flex items-center justify-between gap-3 mb-3">

                            <div className="font-medium">
                              {formattedDate}
                            </div>

                            <div className="text-xs font-mono text-brass">
                              {
                                day
                                  .tasks
                                  .length
                              }{' '}
                              task
                              {day.tasks
                                .length ===
                              1
                                ? ''
                                : 's'}
                            </div>

                          </div>

                          <div className="flex flex-col gap-2">

                            {day.tasks.map(
                              (task) => (
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

                                    <div className="text-xs text-mist font-mono mt-0.5">
                                      Submitted{' '}
                                      {new Date(
                                        task.submittedAt
                                      ).toLocaleTimeString(
                                        [],
                                        {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        }
                                      )}
                                    </div>

                                  </div>

                                  <span
                                    className={`text-xs font-mono ${
                                      task.status ===
                                      'done'
                                        ? 'text-brass'
                                        : 'text-mist'
                                    }`}
                                  >
                                    {task.status ===
                                    'done'
                                      ? 'DONE'
                                      : 'SUBMITTED'}
                                  </span>

                                </div>
                              )
                            )}

                          </div>

                        </div>
                      )
                    }
                  )}

                </div>
              )}

          </div>

        </div>
      )}

      {rows.map((r, i) => {

        const rank = i + 1

        return (
          <button
            type="button"
            key={r.student_id}
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
                @{r.username || 'student'}
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
                        ) || 0
                      )
                    )}%`,
                  }}
                />

              </div>

              <div className="text-mist text-xs font-mono mt-1 flex gap-3">

                <span>
                  {r.completed}/{r.total}{' '}
                  tasks
                </span>

                {r.streak > 0 && (
                  <span>
                    🔥 {r.streak} day
                    {r.streak === 1
                      ? ''
                      : 's'} in a row
                  </span>
                )}

              </div>

            </div>

            <div className="text-mist text-lg">
              ›
            </div>

          </button>
        )
      })}

      {manageStudent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onMouseDown={(e) => {
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
                  {manageStudent.full_name}
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
                  {groupError}
                </div>
              )}

              {loadingGroups ? (
                <div className="py-8 text-center text-mist">
                  Loading groups…
                </div>
              ) : groups.length === 0 ? (
                <div className="py-8 text-center">

                  <p className="text-mist">
                    No groups exist yet.
                  </p>

                  <p className="text-xs text-mist mt-1">
                    Create a group first from
                    Groups & homework.
                  </p>

                </div>
              ) : (
                <div className="flex flex-col gap-2">

                  {groups.map(
                    (group) => {

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

                  Removing a student from a
                  group does{' '}

                  <strong className="text-paper">
                    not
                  </strong>{' '}

                  delete their account. It only
                  removes their membership from
                  that group.

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