import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { getTargetBandInfo, formatTargetBand } from '../../lib/targetBands'
import TargetBandIcon from '../../components/TargetBandIcon'
import ConfirmModal from '../../components/ConfirmModal'
import ResetStudentPasswordModal from '../../components/ResetStudentPasswordModal'

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
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [resetPasswordStudent, setResetPasswordStudent] =
    useState(null)

  // Bulk selection — scoped to whatever the current search/filters are
  // showing. Cleared whenever those change (below) so a teacher can
  // never end up with students selected that they can no longer see,
  // which would make "12 selected" on screen a mystery.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkGroupChoice, setBulkGroupChoice] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  // Whether the very first load has finished. `loading` gets flipped
  // back to true on every subsequent background refresh too (a
  // realtime event on ANY student's profile, group, or membership —
  // see the subscription below) — without this, that turned every one
  // of those refreshes into the whole page (table, search, filters,
  // everything) blanking out to a bare "Loading students…" line and
  // popping back a moment later. With ~230 students and any change to
  // any one of them (a new signup, an edited bio, a group move)
  // qualifying, that flash could happen constantly. Only the true
  // first load should show that full-page state now; a background
  // refresh instead shows a small, quiet "Updating…" next to the
  // count (below) and otherwise leaves whatever's on screen alone.
  const hasLoadedOnceRef = useRef(false)

  // Bursts of realtime events (bulk-approving students, a big group
  // move) used to each trigger their own full loadData() call — a
  // pile of redundant, overlapping requests instead of one. This
  // collapses any events arriving within 500ms of each other into a
  // single refresh once things settle.
  const reloadTimeoutRef = useRef(null)

  const scheduleReload = () => {
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current)
    }

    reloadTimeoutRef.current = setTimeout(() => {
      reloadTimeoutRef.current = null
      loadData()
    }, 500)
  }

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
      hasLoadedOnceRef.current = true
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
        () => scheduleReload()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_members',
        },
        () => scheduleReload()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'groups',
        },
        () => scheduleReload()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)

      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    setSelectedIds(new Set())
    setBulkGroupChoice('')
  }, [search, groupFilter, statusFilter, sortBy, view])

  const toggleSelected = (studentId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)

      if (next.has(studentId)) {
        next.delete(studentId)
      } else {
        next.add(studentId)
      }

      return next
    })
  }

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

      setConfirmDialog({
        title: "Couldn't add student",
        message: `Couldn't add student to the group: ${error.message}`,
        tone: 'coral',
        hideCancel: true,
      })
    } else if (data) {
      setMemberships((prev) => [...prev, data])
    }

    setBusyAction('')
  }

  const removeFromGroup = (student, group) => {
    setConfirmDialog({
      title: `Remove ${student.full_name} from "${group.name}"?`,
      message: 'Their account will NOT be deleted.',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => doRemoveFromGroup(student, group),
    })
  }

  const doRemoveFromGroup = async (student, group) => {
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

      setConfirmDialog({
        title: "Couldn't remove student",
        message: `Couldn't remove student from the group: ${error.message}`,
        tone: 'coral',
        hideCancel: true,
      })
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
  const deleteStudentAccount = (student) => {
    setConfirmDialog({
      title: `Delete ${student.full_name}'s account permanently?`,
      message: `This PERMANENTLY deletes ${student.full_name}'s entire account — every group, homework submission, recording, and chat message, everywhere, forever. This cannot be undone.`,
      confirmLabel: 'Delete Account',
      cancelLabel: 'Cancel',
      tone: 'coral',
      requireTypedText: 'DELETE',
      onConfirm: () => doDeleteStudentAccount(student),
    })
  }

  const doDeleteStudentAccount = async (student) => {
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
      setConfirmDialog({
        title: "Couldn't delete this account",
        message: err.message,
        tone: 'coral',
        hideCancel: true,
      })
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

  /* =========================================================
     BULK ACTIONS
     Scoped to selectedIds, which is always a subset of whatever
     search/filters currently have on screen.
  ========================================================= */

  const selectedStudentsList = useMemo(
    () => students.filter((student) => selectedIds.has(student.id)),
    [students, selectedIds]
  )

  const selectedNotApprovedCount = useMemo(
    () =>
      selectedStudentsList.filter(
        (student) => student.status !== 'approved'
      ).length,
    [selectedStudentsList]
  )

  const bulkApprove = () => {
    const ids = selectedStudentsList
      .filter((student) => student.status !== 'approved')
      .map((student) => student.id)

    if (!ids.length) return

    setConfirmDialog({
      title: `Approve ${ids.length} student${ids.length === 1 ? '' : 's'}?`,
      message: `${ids.length === 1 ? 'This student' : 'These students'} will be able to sign in and see their homework.`,
      confirmLabel: 'Approve',
      cancelLabel: 'Cancel',
      onConfirm: () => doBulkApprove(ids),
    })
  }

  const doBulkApprove = async (ids) => {
    setBulkBusy(true)

    const { data, error } = await supabase
      .from('profiles')
      .update({ status: 'approved' })
      .in('id', ids)
      .select(
        'id, full_name, username, contact_email, role, status, created_at, target_band, bio, avatar_url'
      )

    if (error) {
      console.error('Bulk approve failed:', error)

      setConfirmDialog({
        title: "Couldn't approve these students",
        message: error.message,
        tone: 'coral',
        hideCancel: true,
      })
    } else {
      const updatedById = Object.fromEntries(
        (data || []).map((student) => [student.id, student])
      )

      setStudents((prev) =>
        prev.map((student) => updatedById[student.id] || student)
      )

      setSelectedIds(new Set())
    }

    setBulkBusy(false)
  }

  const bulkAddToGroup = () => {
    if (!bulkGroupChoice) return

    const targetGroup = groups.find(
      (group) => group.id === bulkGroupChoice
    )

    if (!targetGroup) return

    const alreadyIn = new Set(
      selectedStudentsList
        .filter((student) =>
          (membershipsByStudent[student.id] || []).includes(
            bulkGroupChoice
          )
        )
        .map((student) => student.id)
    )

    const toAdd = selectedStudentsList.filter(
      (student) => !alreadyIn.has(student.id)
    )

    if (!toAdd.length) {
      setConfirmDialog({
        title: 'Nothing to add',
        message: `Every selected student is already in "${targetGroup.name}".`,
        hideCancel: true,
      })
      return
    }

    setConfirmDialog({
      title: `Add ${toAdd.length} student${toAdd.length === 1 ? '' : 's'} to "${targetGroup.name}"?`,
      message: alreadyIn.size
        ? `${alreadyIn.size} of your selected students ${alreadyIn.size === 1 ? 'is' : 'are'} already in this group and will be skipped.`
        : undefined,
      confirmLabel: 'Add',
      cancelLabel: 'Cancel',
      onConfirm: () => doBulkAddToGroup(toAdd, targetGroup),
    })
  }

  const doBulkAddToGroup = async (studentsToAdd, group) => {
    setBulkBusy(true)

    const { data, error } = await supabase
      .from('group_members')
      .insert(
        studentsToAdd.map((student) => ({
          student_id: student.id,
          group_id: group.id,
        }))
      )
      .select()

    if (error) {
      console.error('Bulk add to group failed:', error)

      setConfirmDialog({
        title: "Couldn't add these students",
        message: `Couldn't add students to "${group.name}": ${error.message}`,
        tone: 'coral',
        hideCancel: true,
      })
    } else {
      setMemberships((prev) => [...prev, ...(data || [])])
      setSelectedIds(new Set())
      setBulkGroupChoice('')
    }

    setBulkBusy(false)
  }

  if (loading && !hasLoadedOnceRef.current) {
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

        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-mist text-xs font-mono">
              Updating…
            </span>
          )}

          <div className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-panel px-3.5 text-sm font-mono text-mist shadow-[0_6px_16px_-10px_rgba(0,0,0,0.5)]">
            <span className="h-1.5 w-1.5 rounded-full bg-sage" />
            <strong className="font-semibold text-paper">{students.length}</strong>
            total
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">

        <button
          type="button"
          onClick={() => setView('all')}
          className={`focus-ring px-3.5 py-2 rounded-full text-sm font-medium transition ${
            view === 'all'
              ? 'bg-brass text-onbrass shadow-[0_8px_18px_-8px_rgba(117,101,223,0.55)]'
              : 'border border-line bg-panel text-mist hover:text-paper'
          }`}
        >
          All Students ({students.length})
        </button>

        <button
          type="button"
          onClick={() =>
            setView('without-group')
          }
          className={`focus-ring px-3.5 py-2 rounded-full text-sm font-medium transition ${
            view === 'without-group'
              ? 'bg-brass text-onbrass shadow-[0_8px_18px_-8px_rgba(117,101,223,0.55)]'
              : 'border border-line bg-panel text-mist hover:text-paper'
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

          <label className="focus-ring flex items-center gap-2 text-mist text-xs font-mono cursor-pointer">
            <input
              type="checkbox"
              checked={
                filteredStudents.length > 0 &&
                filteredStudents.every((student) =>
                  selectedIds.has(student.id)
                )
              }
              onChange={() => {
                const allVisibleSelected =
                  filteredStudents.length > 0 &&
                  filteredStudents.every((student) =>
                    selectedIds.has(student.id)
                  )

                setSelectedIds(
                  allVisibleSelected
                    ? new Set()
                    : new Set(
                        filteredStudents.map(
                          (student) => student.id
                        )
                      )
                )
              }}
              className="h-3.5 w-3.5 accent-brass"
            />
            Showing {filteredStudents.length}{' '}
            student
            {filteredStudents.length === 1
              ? ''
              : 's'}
          </label>

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

      {/* =====================================================
          BULK ACTION BAR — only appears once something's selected
      ===================================================== */}

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brass/30 bg-brass/10 px-4 py-3">

          <span className="text-sm font-semibold text-paper">
            {selectedIds.size} selected
          </span>

          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="focus-ring text-xs text-mist hover:text-paper hover:underline"
          >
            Clear
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-2">

            <button
              type="button"
              onClick={bulkApprove}
              disabled={bulkBusy || selectedNotApprovedCount === 0}
              className="focus-ring rounded-full bg-sage px-4 py-1.5 text-sm font-semibold text-onbrass transition hover:brightness-105 disabled:opacity-40"
            >
              {selectedNotApprovedCount > 0
                ? `Approve ${selectedNotApprovedCount}`
                : 'Approve'}
            </button>

            <div className="flex overflow-hidden rounded-full border border-line bg-panel">
              <select
                value={bulkGroupChoice}
                onChange={(e) => setBulkGroupChoice(e.target.value)}
                className="focus-ring bg-transparent px-3 py-1.5 text-sm text-paper"
              >
                <option value="">Add to group…</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={bulkAddToGroup}
                disabled={bulkBusy || !bulkGroupChoice}
                className="focus-ring border-l border-line px-4 text-sm font-semibold text-brass transition hover:bg-brass/10 disabled:opacity-40"
              >
                Add
              </button>
            </div>

          </div>

        </div>
      )}

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
        <div className="flex flex-col gap-2">

          {filteredStudents.map((student) => {
            const studentGroups =
              getStudentGroups(student.id)

            const isSelected = selectedIds.has(student.id)

            return (
              <div
                key={student.id}
                className={`ticket rounded-xl px-3.5 py-3 transition ${
                  isSelected
                    ? 'ring-2 ring-brass/50'
                    : ''
                }`}
              >

                <div className="flex flex-wrap items-center gap-3">

                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() =>
                      toggleSelected(student.id)
                    }
                    aria-label={`Select ${student.full_name}`}
                    className="h-4 w-4 shrink-0 accent-brass"
                  />

                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-panel-2 font-display text-sm font-semibold text-paper shadow-[0_4px_10px_-4px_rgba(0,0,0,0.35)]">
                    {student.avatar_url ? (
                      <img
                        src={student.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      String(
                        student.full_name ||
                          student.username ||
                          '?'
                      )
                        .charAt(0)
                        .toUpperCase()
                    )}
                  </div>

                  <div className="min-w-0 flex-1">

                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate font-display text-[15px] text-paper">
                        {student.full_name}
                      </span>

                      <span className="shrink-0 text-mist text-xs font-mono">
                        @{student.username}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5">

                      {studentGroups.length === 0 ? (
                        <span className="text-mist text-xs">
                          No group
                        </span>
                      ) : (
                        studentGroups.map((group) => {
                          const chip = getGroupChipStyle(group.id)

                          return (
                            <span
                              key={group.id}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${chip.border} ${chip.bg} ${chip.text}`}
                            >
                              {group.name}

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
                            </span>
                          )
                        })
                      )}

                    </div>

                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">

                    {student.target_band != null && (
                      <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-brass/40 bg-brass/10 text-brass">
                        <TargetBandIcon value={student.target_band} className="h-3.5 w-3.5" />
                        <span>
                          {formatTargetBand(student.target_band)}
                        </span>
                      </span>
                    )}

                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
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

                  <div className="flex shrink-0 items-center gap-1.5">

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
                      title="Add to group"
                      className="focus-ring bg-panel-2 border border-line rounded-full px-2.5 py-1.5 text-xs text-paper disabled:opacity-40"
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
                      className="focus-ring px-2.5 py-1.5 rounded-full border border-line text-xs text-mist transition hover:border-brass/40 hover:text-brass"
                    >
                      Details
                    </button>

                  </div>

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
                      <TargetBandIcon value={selectedStudent.target_band} className="h-4 w-4" />
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

                  <button
                    type="button"
                    onClick={() =>
                      setResetPasswordStudent(
                        selectedStudent
                      )
                    }
                    className="focus-ring rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-mist transition hover:border-brass hover:text-brass"
                  >
                    🔑 Reset password
                  </button>

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

      <ConfirmModal
        open={Boolean(confirmDialog)}
        {...confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const run = confirmDialog?.onConfirm
          setConfirmDialog(null)
          run?.()
        }}
      />

      <ResetStudentPasswordModal
        student={resetPasswordStudent}
        onClose={() => setResetPasswordStudent(null)}
      />

    </div>
  )
}