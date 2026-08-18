import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function TeacherStudents() {
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

  const [selectedStudent, setSelectedStudent] =
    useState(null)

  const [busyAction, setBusyAction] = useState('')

  const loadData = async () => {
    setLoading(true)
    setError('')

    const [
      studentsResult,
      groupsResult,
      membershipsResult,
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'id, full_name, username, contact_email, role, status, created_at'
        )
        .eq('role', 'student')
        .order('full_name', {
          ascending: true,
        }),

      supabase
        .from('groups')
        .select('id, name')
        .order('name', {
          ascending: true,
        }),

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
      setMemberships(
        membershipsResult.data || []
      )
    }

    setLoading(false)
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

      map[membership.student_id].push(
        membership.group_id
      )
    })

    return map
  }, [memberships])

  const groupById = useMemo(() => {
    return Object.fromEntries(
      groups.map((group) => [
        group.id,
        group,
      ])
    )
  }, [groups])

  const getStudentGroups = (studentId) => {
    return (
      membershipsByStudent[studentId] || []
    )
      .map(
        (groupId) =>
          groupById[groupId]
      )
      .filter(Boolean)
  }

  const studentsWithoutGroup = useMemo(() => {
    return students.filter(
      (student) =>
        !(
          membershipsByStudent[
            student.id
          ]?.length
        )
    )
  }, [
    students,
    membershipsByStudent,
  ])

  const filteredStudents = useMemo(() => {
    let result =
      view === 'without-group'
        ? studentsWithoutGroup
        : students

    const query =
      search.trim().toLowerCase()

    if (query) {
      result = result.filter(
        (student) => {
          const groupsForStudent =
            getStudentGroups(
              student.id
            )

          const groupNames =
            groupsForStudent
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
              value
                .toLowerCase()
                .includes(query)
            )
        }
      )
    }

    if (view === 'all') {
      if (
        statusFilter !== 'all'
      ) {
        result = result.filter(
          (student) =>
            student.status ===
            statusFilter
        )
      }

      if (
        groupFilter !== 'all'
      ) {
        result = result.filter(
          (student) => {
            const studentGroupIds =
              membershipsByStudent[
                student.id
              ] || []

            if (
              groupFilter ===
              'none'
            ) {
              return (
                studentGroupIds.length ===
                0
              )
            }

            return studentGroupIds.includes(
              groupFilter
            )
          }
        )
      }
    }

    result = [...result]

    result.sort((a, b) => {
      if (
        sortBy === 'name-desc'
      ) {
        return b.full_name.localeCompare(
          a.full_name
        )
      }

      if (
        sortBy === 'newest'
      ) {
        return (
          new Date(b.created_at) -
          new Date(a.created_at)
        )
      }

      if (
        sortBy === 'oldest'
      ) {
        return (
          new Date(a.created_at) -
          new Date(b.created_at)
        )
      }

      return a.full_name.localeCompare(
        b.full_name
      )
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

  const addToGroup = async (
    student,
    groupId
  ) => {
    if (!groupId) return

    const exists =
      memberships.some(
        (membership) =>
          membership.student_id ===
            student.id &&
          membership.group_id ===
            groupId
      )

    if (exists) return

    setBusyAction(
      `add-${student.id}-${groupId}`
    )

    const { data, error } =
      await supabase
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
      setMemberships((prev) => [
        ...prev,
        data,
      ])
    }

    setBusyAction('')
  }

  const removeFromGroup = async (
    student,
    group
  ) => {
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

    const { error } =
      await supabase
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
              membership.student_id ===
                student.id &&
              membership.group_id ===
                group.id
            )
        )
      )
    }

    setBusyAction('')
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
          <h2 className="font-display text-xl">
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
          onClick={() =>
            setView('all')
          }
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
          onChange={(e) =>
            setSearch(e.target.value)
          }
          placeholder="Search by name, username, email, or group…"
          className="focus-ring w-full bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
        />

        {view === 'all' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">

            <select
              value={groupFilter}
              onChange={(e) =>
                setGroupFilter(
                  e.target.value
                )
              }
              className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
            >
              <option value="all">
                All groups
              </option>

              <option value="none">
                No group
              </option>

              {groups.map(
                (group) => (
                  <option
                    key={group.id}
                    value={group.id}
                  >
                    {group.name}
                  </option>
                )
              )}
            </select>

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(
                  e.target.value
                )
              }
              className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
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
                setSortBy(
                  e.target.value
                )
              }
              className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
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

          {filteredStudents.map(
            (student) => {
              const studentGroups =
                getStudentGroups(
                  student.id
                )

              return (
                <div
                  key={student.id}
                  className="ticket rounded-lg p-4"
                >

                  <div className="flex items-start justify-between gap-4 flex-wrap">

                    <div className="min-w-0">

                      <div className="font-display text-lg">
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

                    <span
                      className={`text-xs px-2 py-1 rounded-md ${
                        student.status ===
                        'approved'
                          ? 'bg-sage text-onbrass'
                          : student.status ===
                            'pending'
                          ? 'border border-brass text-brass'
                          : 'border border-coral text-coral'
                      }`}
                    >
                      {student.status}
                    </span>

                  </div>

                  <div className="mt-4">

                    <div className="text-xs uppercase tracking-wide text-mist font-mono mb-2">
                      Groups
                    </div>

                    {studentGroups.length ===
                    0 ? (
                      <span className="text-mist text-sm">
                        No group
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-2">

                        {studentGroups.map(
                          (group) => (
                            <div
                              key={group.id}
                              className="flex items-center gap-1 bg-panel-2 border border-line rounded-md px-2 py-1 text-sm"
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
                                className="focus-ring text-mist hover:text-coral disabled:opacity-40"
                                title="Remove from group"
                              >
                                ×
                              </button>
                            </div>
                          )
                        )}

                      </div>
                    )}

                  </div>

                  <div className="mt-4 flex items-center gap-2 flex-wrap">

                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const groupId =
                          e.target.value

                        if (groupId) {
                          addToGroup(
                            student,
                            groupId
                          )
                        }

                        e.target.value = ''
                      }}
                      disabled={
                        student.status !==
                        'approved'
                      }
                      className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm disabled:opacity-40"
                    >
                      <option value="">
                        Add to group…
                      </option>

                      {groups
                        .filter(
                          (group) =>
                            !studentGroups.some(
                              (g) =>
                                g.id ===
                                group.id
                            )
                        )
                        .map(
                          (group) => (
                            <option
                              key={
                                group.id
                              }
                              value={
                                group.id
                              }
                            >
                              {group.name}
                            </option>
                          )
                        )}
                    </select>

                    <button
                      type="button"
                      onClick={() =>
                        setSelectedStudent(
                          student
                        )
                      }
                      className="focus-ring px-3 py-2 rounded-md border border-line text-sm text-mist hover:text-paper"
                    >
                      View details
                    </button>

                  </div>

                </div>
              )
            }
          )}

        </div>
      )}

      {selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">

          <div className="w-full max-w-lg ticket rounded-lg p-5">

            <div className="flex items-start justify-between gap-4">

              <div>
                <h3 className="font-display text-xl">
                  {selectedStudent.full_name}
                </h3>

                <p className="text-mist text-sm font-mono">
                  @{selectedStudent.username}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedStudent(null)
                }
                className="focus-ring text-mist hover:text-paper text-xl"
                aria-label="Close"
              >
                ×
              </button>

            </div>

            <div className="mt-5 flex flex-col gap-3 text-sm">

              <div>
                <span className="text-mist">
                  Email:{' '}
                </span>
                {selectedStudent.contact_email ||
                  'Not provided'}
              </div>

              <div>
                <span className="text-mist">
                  Status:{' '}
                </span>
                {selectedStudent.status}
              </div>

              <div>
                <span className="text-mist">
                  Groups:{' '}
                </span>

                {getStudentGroups(
                  selectedStudent.id
                )
                  .map((g) => g.name)
                  .join(', ') ||
                  'No group'}
              </div>

            </div>

            <div className="mt-5 flex justify-end">

              <button
                type="button"
                onClick={() =>
                  setSelectedStudent(null)
                }
                className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass text-sm"
              >
                Close
              </button>

            </div>

          </div>

        </div>
      )}

    </div>
  )
}