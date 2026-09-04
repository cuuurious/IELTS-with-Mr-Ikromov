import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { getTargetBandInfo, formatTargetBand } from '../../lib/targetBands'

export default function TeacherStudents({ onStartChat }) {
  const [students, setStudents] = useState([])
  const [groups, setGroups] = useState([])
  const [memberships, setMemberships] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('approved')
  const [sortBy, setSortBy] = useState('name-asc')

  const [view, setView] = useState('all')
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [busyAction, setBusyAction] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError('')

    /*
     * This whole function used to have no try/catch around it — if
     * any of the three requests below rejected outright (a network
     * hiccup, an expired session, anything that throws instead of
     * returning { error }), the code would jump straight out of
     * this function and setLoading(false) at the very end would
     * never run, leaving the page stuck on "Loading students…"
     * forever with no way to tell what went wrong. Wrapping it in
     * try/catch/finally means loading always clears and a real
     * error message shows up instead of an infinite spinner.
     */
    try {
      const [
        studentsResult,
        groupsResult,
        membershipsResult,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select(
            'id, full_name, username, contact_email, role, status, created_at, target_band, bio, avatar_url'
          )
          .eq('role', 'student')
          .order('full_name', { ascending: true }),

        supabase
          .from('groups')
          .select('id, name')
          .order('name', { ascending: true }),

        supabase
          .from('group_members')
          .select('group_id, student_id'),
      ])

      if (studentsResult.error) {
        console.error(
          'Failed to load students:',
          studentsResult.error
        )
        setError(studentsResult.error.message)
        setStudents([])
      } else {
        setStudents(studentsResult.data || [])
      }

      if (groupsResult.error) {
        console.error(
          'Failed to load groups:',
          groupsResult.error
        )
        setError(groupsResult.error.message)
        setGroups([])
      } else {
        setGroups(groupsResult.data || [])
      }

      if (membershipsResult.error) {
        console.error(
          'Failed to load memberships:',
          membershipsResult.error
        )
        setError(membershipsResult.error.message)
        setMemberships([])
      } else {
        setMemberships(membershipsResult.data || [])
      }
    } catch (err) {
      console.error(
        'Failed to load students page:',
        err
      )
      setError(
        err?.message ||
          'Something went wrong loading students. Please refresh the page.'
      )
      setStudents([])
      setGroups([])
      setMemberships([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()

    const channel = supabase
      .channel('teacher-students')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
        },
        () => loadData()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_members',
        },
        () => loadData()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'groups',
        },
        () => loadData()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const membershipsByStudent = useMemo(() => {
    const map = {}

    memberships.forEach((membership) => {
      if (!map[membership.student_id]) {
        map[membership.student_id] = []
      }

      map[membership.student_id].push(membership.group_id)
    })

    return map
  }, [memberships])

  const groupById = useMemo(() => {
    return Object.fromEntries(
      groups.map((group) => [group.id, group])
    )
  }, [groups])

  const getStudentGroups = (studentId) => {
    return (membershipsByStudent[studentId] || [])
      .map((groupId) => groupById[groupId])
      .filter(Boolean)
  }

  /*
   * Give each group a stable, distinct color (cycling through the
   * design system's accent palette by the group's position in the
   * groups list) so group chips are easy to tell apart at a glance
   * instead of all rendering as the same neutral gray pill.
   */
  const groupChipPalette = [
    { border: 'border-sage/40', bg: 'bg-sage/10', text: 'text-sage' },
    { border: 'border-coral/40', bg: 'bg-coral/10', text: 'text-coral' },
    { border: 'border-cyan/40', bg: 'bg-cyan/10', text: 'text-cyan' },
    { border: 'border-brass/40', bg: 'bg-brass/10', text: 'text-brass' },
    { border: 'border-lavender/40', bg: 'bg-lavender/10', text: 'text-lavender' },
  ]

  const getGroupChipStyle = (groupId) => {
    const index = groups.findIndex((g) => g.id === groupId)
    const safeIndex = index === -1 ? 0 : index
    return groupChipPalette[safeIndex % groupChipPalette.length]
  }

  const studentsWithoutGroup = useMemo(() => {
    return students.filter(
      (student) =>
        !(membershipsByStudent[student.id]?.length)
    )
  }, [students, membershipsByStudent])

  const filteredStudents = useMemo(() => {
    let result =
      view === 'without-group'
        ? studentsWithoutGroup
        : students

    const query = search.trim().toLowerCase()

    if (query) {
      result = result.filter((student) => {
        const groupsForStudent =
          getStudentGroups(student.id)

        const groupNames = groupsForStudent
          .map((g) => g.name)
          .join(' ')

        return [
          student.full_name,
          student.username,
          student.contact_email,
          groupNames,
        ]
          .filter(Boolean)
          .some((value) =>
            value.toLowerCase().includes(query)
          )
      })
    }

    if (view === 'all') {
      if (statusFilter !== 'all') {
        result = result.filter(
          (student) =>
            student.status === statusFilter
        )
      }

      if (groupFilter !== 'all') {
        result = result.filter((student) => {
          const studentGroupIds =
            membershipsByStudent[student.id] || []

          if (groupFilter === 'none') {
            return studentGroupIds.length === 0
          }

          return studentGroupIds.includes(groupFilter)
        })
      }
    }

    result = [...result]

    result.sort((a, b) => {
      // full_name can be null/empty for a student who just registered
      // and hasn't set a name yet — localeCompare throws on undefined,
      // which used to blank out the whole list. Fall back to '' so a
      // nameless student just sorts to one end instead of crashing.
      if (sortBy === 'name-desc') {
        return (b.full_name || '').localeCompare(a.full_name || '')
      }

      if (sortBy === 'newest') {
        return (
          new Date(b.created_at) -
          new Date(a.created_at)
        )
      }

      if (sortBy === 'oldest') {
        return (
          new Date(a.created_at) -
          new Date(b.created_at)
        )
      }

      return (a.full_name || '').localeCompare(b.full_name || '')
    })

    return result
  }, [
    students,
    studentsWithoutGroup,
    search,
    groupFilter,
    statusFilter,
    sortBy,
    view,
    membershipsByStudent,
    groupById,
  ])

  const addToGroup = async (student, groupId) => {
    if (!groupId) return

    const exists = memberships.some(
      (membership) =>
        membership.student_id === student.id &&
        membership.group_id === groupId
    )

    if (exists) return

    setBusyAction(
      `add-${student.id}-${groupId}`
    )

    const { data, error } = await supabase
      .from('group_members')
      .insert({
        student_id: student.id,
        group_id: groupId,
      })
      .select()
      .single()

    if (error) {
      console.error(
        'Failed to add student:',
        error
      )

      alert(
        `Couldn't add student to the group: ${error.message}`
      )
    } else if (data) {
      setMemberships((prev) => [...prev, data])
    }

    setBusyAction('')
  }

  const removeFromGroup = async (student, group) => {
    if (
      !window.confirm(
        `Remove ${student.full_name} from "${group.name}"?\n\nTheir account will NOT be deleted.`
      )
    ) {
      return
    }

    setBusyAction(
      `remove-${student.id}-${group.id}`
    )

    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('student_id', student.id)
      .eq('group_id', group.id)

    if (error) {
      console.error(
        'Failed to remove student:',
        error
      )

      alert(
        `Couldn't remove student from the group: ${error.message}`
      )
    } else {
      setMemberships((prev) =>
        prev.filter(
          (membership) =>
            !(
              membership.student_id === student.id &&
              membership.group_id === group.id
            )
        )
      )
    }

    setBusyAction('')
  }

  /*
   * Permanently deletes a student's whole account — every group,
   * homework submission, recording, and chat message, everywhere,
   * forever. Unrecoverable.
   */
  const deleteStudentAccount = async (student) => {
    const confirmation = window.prompt(
      `This PERMANENTLY deletes ${student.full_name}'s entire account — every group, homework submission, recording, and chat message, everywhere, forever. This cannot be undone.\n\nType DELETE to confirm.`
    )

    if (confirmation !== 'DELETE') {
      return
    }

    setBusyAction(`delete-${student.id}`)

    try {
      const { data, error } =
        await supabase.functions.invoke(
          'delete-student',
          {
            body: { studentId: student.id },
          }
        )

      if (error) throw error
      if (data?.error) throw new Error(data.error)

      setStudents((prev) =>
        prev.filter(
          (studentItem) =>
            studentItem.id !== student.id
        )
      )

      setMemberships((prev) =>
        prev.filter(
          (membership) =>
            membership.student_id !== student.id
        )
      )

      if (selectedStudent?.id === student.id) {
        setSelectedStudent(null)
      }
    } catch (err) {
      alert(
        `Couldn't delete this account: ${err.message}`
      )
    } finally {
      setBusyAction('')
    }
  }

  const clearFilters = () => {
    setSearch('')
    setGroupFilter('all')
    setStatusFilter('approved')
    setSortBy('name-asc')
  }

  if (loading) {
    return (
      <p className="text-mist">
        Loading students…
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5">

      {error && (
        <div className="rounded-lg border border-coral bg-panel-2 px-4 py-3 text-sm text-coral">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl text-paper">
            Students
          </h2>

          <p className="text-mist text-sm mt-1">
            Manage student accounts and
            group memberships.
          </p>
        </div>

        <div className="text-mist text-sm font-mono">
          {students.length} total
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">

        <button
          type="button"
          onClick={() => setView('all')}
          className={`focus-ring px-3 py-2 rounded-md text-sm ${
            view === 'all'
              ? 'bg-brass text-onbrass'
              : 'bg-panel-2 text-mist hover:text-paper'
          }`}
        >
          All Students ({students.length})
        </button>

        <button
          type="button"
          onClick={() =>
            setView('without-group')
          }
          className={`focus-ring px-3 py-2 rounded-md text-sm ${
            view === 'without-group'
              ? 'bg-brass text-onbrass'
              : 'bg-panel-2 text-mist hover:text-paper'
          }`}
        >
          Without a group (
          {studentsWithoutGroup.length}
          )
        </button>

      </div>

      <div className="ticket rounded-lg p-4 flex flex-col gap-3">

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, username, email, or group…"
          className="focus-ring w-full bg-panel-2 border border-line rounded-md px-3 py-2 text-sm text-paper placeholder:text-mist"
        />

        {view === 'all' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">

            <select
              value={groupFilter}
              onChange={(e) =>
                setGroupFilter(e.target.value)
              }
              className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm text-paper"
            >
              <option value="all">
                All groups
              </option>

              <option value="none">
                No group
              </option>

              {groups.map((group) => (
                <option
                  key={group.id}
                  value={group.id}
                >
                  {group.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value)
              }
              className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm text-paper"
            >
              <option value="approved">
                Approved
              </option>

              <option value="pending">
                Pending
              </option>

              <option value="rejected">
                Rejected
              </option>

              <option value="all">
                All statuses
              </option>
            </select>

            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value)
              }
              className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm text-paper"
            >
              <option value="name-asc">
                Name A–Z
              </option>

              <option value="name-desc">
                Name Z–A
              </option>

              <option value="newest">
                Newest first
              </option>

              <option value="oldest">
                Oldest first
              </option>
            </select>

          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">

          <span className="text-mist text-xs font-mono">
            Showing {filteredStudents.length}{' '}
            student
            {filteredStudents.length === 1
              ? ''
              : 's'}
          </span>

          {(search ||
            groupFilter !== 'all' ||
            statusFilter !== 'approved' ||
            sortBy !== 'name-asc') && (
            <button
              type="button"
              onClick={clearFilters}
              className="focus-ring text-xs text-brass hover:underline"
            >
              Clear filters
            </button>
          )}

        </div>

      </div>

      {filteredStudents.length === 0 ? (
        <div className="ticket rounded-lg p-6 text-center">

          <p className="text-mist">
            No students match the current
            search and filters.
          </p>

          <button
            type="button"
            onClick={clearFilters}
            className="focus-ring mt-3 text-sm text-brass hover:underline"
          >
            Clear filters
          </button>

        </div>
      ) : (
        <div className="flex flex-col gap-3">

          {filteredStudents.map((student) => {
            const studentGroups =
              getStudentGroups(student.id)

            return (
              <div
                key={student.id}
                className="ticket rounded-lg p-4"
              >

                <div className="flex items-start justify-between gap-4 flex-wrap">

                  <div className="min-w-0">

                    <div className="font-display text-lg text-paper">
                      {student.full_name}
                    </div>

                    <div className="text-mist text-sm font-mono">
                      @{student.username}
                    </div>

                    {student.contact_email && (
                      <div className="text-mist text-xs mt-1">
                        {student.contact_email}
                      </div>
                    )}

                  </div>

                  <div className="flex items-center gap-2 flex-wrap justify-end">

                    {student.target_band != null && (
                      <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-brass/40 bg-brass/10 text-brass">
                        <span>
                          {getTargetBandInfo(student.target_band).emoji}
                        </span>
                        <span>
                          Target {formatTargetBand(student.target_band)}
                        </span>
                      </span>
                    )}

                    <span
                      className={`text-xs px-2 py-1 rounded-md ${
                        student.status === 'approved'
                          ? 'bg-sage text-onbrass'
                          : student.status === 'pending'
                          ? 'border border-brass text-brass'
                          : 'border border-coral text-coral'
                      }`}
                    >
                      {student.status}
                    </span>

                  </div>

                </div>

                <div className="mt-4">

                  <div className="text-xs uppercase tracking-wide text-mist font-mono mb-2">
                    Groups
                  </div>

                  {studentGroups.length === 0 ? (
                    <span className="text-mist text-sm">
                      No group
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-2">

                      {studentGroups.map((group) => {
                        const chip = getGroupChipStyle(group.id)

                        return (
                          <div
                            key={group.id}
                            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-sm font-medium ${chip.border} ${chip.bg} ${chip.text}`}
                          >
                            <span>
                              {group.name}
                            </span>

                            <button
                              type="button"
                              disabled={
                                busyAction ===
                                `remove-${student.id}-${group.id}`
                              }
                              onClick={() =>
                                removeFromGroup(
                                  student,
                                  group
                                )
                              }
                              className="focus-ring opacity-60 hover:opacity-100 disabled:opacity-30"
                              title="Remove from group"
                            >
                              ×
                            </button>
                          </div>
                        )
                      })}

                    </div>
                  )}

                </div>

                <div className="mt-4 flex items-center gap-2 flex-wrap">

                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const groupId = e.target.value

                      if (groupId) {
                        addToGroup(
                          student,
                          groupId
                        )
                      }

                      e.target.value = ''
                    }}
                    disabled={
                      student.status !== 'approved'
                    }
                    className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm text-paper disabled:opacity-40"
                  >
                    <option value="">
                      Add to group…
                    </option>

                    {groups
                      .filter(
                        (group) =>
                          !studentGroups.some(
                            (g) =>
                              g.id === group.id
                          )
                      )
                      .map((group) => (
                        <option
                          key={group.id}
                          value={group.id}
                        >
                          {group.name}
                        </option>
                      ))}
                  </select>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedStudent(student)
                    }
                    className="focus-ring px-3 py-2 rounded-md border border-line text-sm text-mist hover:text-paper"
                  >
                    View details
                  </button>

                </div>

              </div>
            )
          })}

        </div>
      )}

      {selectedStudent &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedStudent(null)
              }
            }}
          >
            <div className="absolute inset-0 bg-black/35 backdrop-blur-[1px]" />

            <div
              className="relative z-10 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-line bg-panel text-paper shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >

              <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">

                <div className="flex items-start gap-3 min-w-0">

                  {selectedStudent.avatar_url ? (
                    <img
                      src={selectedStudent.avatar_url}
                      alt={selectedStudent.full_name || 'Student photo'}
                      className="w-12 h-12 rounded-full object-cover border border-line shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-brass flex items-center justify-center text-lg font-semibold text-onbrass shrink-0">
                      {String(
                        selectedStudent.full_name ||
                          selectedStudent.username ||
                          '?'
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <h3 className="font-display text-xl font-semibold text-paper truncate">
                      {selectedStudent.full_name}
                    </h3>

                    <p className="mt-1 text-sm font-mono text-mist truncate">
                      @{selectedStudent.username || 'student'}
                    </p>
                  </div>

                </div>

                <button
                  type="button"
                  onClick={() =>
                    setSelectedStudent(null)
                  }
                  className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-mist transition hover:border-brass hover:text-brass"
                  aria-label="Close"
                >
                  ×
                </button>

              </div>

              <div className="space-y-4 p-6 text-sm">

                <div>
                  <span className="text-mist">
                    Bio
                  </span>

                  {selectedStudent.bio ? (
                    <p className="mt-1 text-paper whitespace-pre-wrap">
                      {selectedStudent.bio}
                    </p>
                  ) : (
                    <p className="mt-1 text-mist italic">
                      No bio yet.
                    </p>
                  )}
                </div>

                <div>
                  <span className="text-mist">
                    Email
                  </span>

                  <div className="mt-1 text-paper break-all">
                    {selectedStudent.contact_email ||
                      'Not provided'}
                  </div>
                </div>

                <div>
                  <span className="text-mist">
                    Status
                  </span>

                  <div className="mt-1 text-paper">
                    {selectedStudent.status}
                  </div>
                </div>

                {selectedStudent.target_band != null && (
                  <div>
                    <span className="text-mist">
                      Target band
                    </span>

                    <div className="mt-1 flex items-center gap-1.5 text-brass font-medium">
                      <span>
                        {
                          getTargetBandInfo(
                            selectedStudent.target_band
                          ).emoji
                        }
                      </span>
                      <span>
                        {formatTargetBand(
                          selectedStudent.target_band
                        )}{' '}
                        —{' '}
                        {
                          getTargetBandInfo(
                            selectedStudent.target_band
                          ).label
                        }
                      </span>
                    </div>
                  </div>
                )}

                <div>
                  <span className="text-mist">
                    Groups
                  </span>

                  <div className="mt-2 flex flex-wrap gap-2">

                    {getStudentGroups(
                      selectedStudent.id
                    ).length > 0 ? (
                      getStudentGroups(
                        selectedStudent.id
                      ).map((group) => {
                        const chip = getGroupChipStyle(group.id)

                        return (
                          <span
                            key={group.id}
                            className={`rounded-full border px-3 py-1 text-xs font-medium ${chip.border} ${chip.bg} ${chip.text}`}
                          >
                            {group.name}
                          </span>
                        )
                      })
                    ) : (
                      <span className="text-mist">
                        No group
                      </span>
                    )}

                  </div>
                </div>

              </div>

              <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">

                <button
                  type="button"
                  disabled={
                    busyAction ===
                    `delete-${selectedStudent.id}`
                  }
                  onClick={() =>
                    deleteStudentAccount(
                      selectedStudent
                    )
                  }
                  className="focus-ring rounded-xl border border-coral/40 px-4 py-2.5 text-sm font-semibold text-coral transition hover:bg-coral/10 disabled:opacity-50"
                >
                  {busyAction ===
                  `delete-${selectedStudent.id}`
                    ? 'Deleting…'
                    : 'Delete this account'}
                </button>

                <div className="flex items-center gap-2">

                  {onStartChat && (
                    <button
                      type="button"
                      onClick={() => {
                        onStartChat(selectedStudent)
                        setSelectedStudent(null)
                      }}
                      className="focus-ring rounded-xl border border-brass px-4 py-2.5 text-sm font-semibold text-brass transition hover:bg-brass/10"
                    >
                      💬 Chat with student
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedStudent(null)
                    }
                    className="focus-ring rounded-xl bg-brass px-5 py-2.5 text-sm font-semibold text-onbrass transition hover:brightness-105"
                  >
                    Close
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