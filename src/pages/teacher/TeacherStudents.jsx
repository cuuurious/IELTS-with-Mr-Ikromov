import { groupColour, groupDisplayName } from '../../lib/groupLook'
import { daysToExam, formatExamDate } from '../../lib/examForecast'
import { estimateBandFromPercent, formatBand } from '../../lib/ieltsBands'
import { fetchAll } from '../../lib/fetchAll'
import { useEffect, useMemo, useRef, useState } from 'react'
import PhotoViewer from '../../components/PhotoViewer'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { getTargetBandInfo, formatTargetBand } from '../../lib/targetBands'
import TargetBandIcon from '../../components/TargetBandIcon'
import ConfirmModal from '../../components/ConfirmModal'
import ParentReportLink from '../../components/ParentReportLink'
import SharedLogins from '../../components/teacher/SharedLogins'
import ResetStudentPasswordModal from '../../components/ResetStudentPasswordModal'
import { useSessionState } from '../../lib/sessionState'

// Exam countdown for the teacher (2026-11-07).
function examText(st) {
  const when = formatExamDate(st.exam_date)
  if (st.exam_result != null && st.exam_result_for === st.exam_date) return `${when} · got ${Number(st.exam_result).toFixed(1)}`
  const d = daysToExam(st.exam_date)
  return d > 0 ? `${when} · ${d} day${d === 1 ? '' : 's'} left` : d === 0 ? `${when} · today` : `${when} · result not entered`
}
function examChip(st) {
  if (!st.exam_date) return null
  const d = daysToExam(st.exam_date)
  const done = st.exam_result != null && st.exam_result_for === st.exam_date
  if (done) return <span className="mt-1 inline-flex rounded-[10px] bg-panel-2 px-2 py-0.5 text-[12px] font-extrabold text-sage">Exam done · {Number(st.exam_result).toFixed(1)}</span>
  if (d < 0) return null
  return (
    <span className={`mt-1 inline-flex rounded-[10px] px-2 py-0.5 text-[12px] font-extrabold ${d <= 14 ? 'bg-urgent-tint text-urgent' : 'bg-panel-2 text-paper'}`}>
      {d === 0 ? 'Exam today' : `Exam in ${d} day${d === 1 ? '' : 's'}`}
    </span>
  )
}

export default function TeacherStudents({ onStartChat }) {
  const [students, setStudents] = useState([])
  const [groups, setGroups] = useState([])
  const [memberships, setMemberships] = useState([])

  const [loading, setLoading] = useState(true)
  // Homework on time and last mock band per student (redesign 2026-11-02).
  const [homeworks, setHomeworks] = useState([])
  const [handIns, setHandIns] = useState([])
  const [mockAttempts, setMockAttempts] = useState([])
  const [showCount, setShowCount] = useState(60)
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1280px)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 1280px)')
    if (!mq) return undefined
    const on = () => setIsWide(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  const [error, setError] = useState('')

  // Filters, and the student whose Details window is open, are
  // remembered across a refresh (Jasur, 2026-09-30) — lib/sessionState.js.
  const [search, setSearch] = useSessionState('ielts:teacher:students:search', '')
  const [groupFilter, setGroupFilter] = useSessionState('ielts:teacher:students:group', 'all')
  const [statusFilter, setStatusFilter] = useSessionState('ielts:teacher:students:status', 'approved')
  const [sortBy, setSortBy] = useSessionState('ielts:teacher:students:sort', 'name-asc')

  const [view, setView] = useSessionState('ielts:teacher:students:view', 'all')
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [viewingPhoto, setViewingPhoto] = useState(false)
  // Never carry an open photo over to the next student's window.
  useEffect(() => setViewingPhoto(false), [selectedStudent?.id])
  const [savedStudentId, setSavedStudentId] = useSessionState('ielts:teacher:students:details', null)
  const detailsRestoredRef = useRef(false)
  useEffect(() => {
    if (detailsRestoredRef.current) setSavedStudentId(selectedStudent?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudent])
  useEffect(() => {
    if (detailsRestoredRef.current || students.length === 0) return
    detailsRestoredRef.current = true
    if (!savedStudentId) return
    const s = students.find((st) => st.id === savedStudentId)
    if (s) setSelectedStudent(s)
    else setSavedStudentId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students])
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

  // { done, total } while a bulk delete is running, else null — each
  // account is a separate destructive request to the delete-student
  // function (storage cleanup + an auth deletion), so 50 of them
  // takes a real, visible stretch of time, and a silent "Deleting…"
  // with no sense of progress reads as hung.
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState(null)

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
            'id, full_name, username, contact_email, role, status, created_at, target_band, exam_date, exam_result, exam_result_for, bio, avatar_url'
          )
          .eq('role', 'student')
          .order('full_name', { ascending: true }),

        supabase
          .from('groups')
          .select('id, name, created_at')
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

  const loadProgress = async () => {
    try {
      const [hw, subs, mocks] = await Promise.all([
        supabase.from('homeworks').select('id, group_id, due_date, created_at').order('created_at'),
        fetchAll(() => supabase.from('submissions').select('homework_id, student_id, submitted_at').order('id')),
        fetchAll(() =>
          supabase
            .from('mock_attempts')
            .select('id, user_id, score, max_score, band, submitted_at')
            .not('submitted_at', 'is', null)
            .order('id')
        ),
      ])
      if (!hw.error) setHomeworks(hw.data || [])
      if (!subs.error) setHandIns(subs.data || [])
      if (!mocks.error) setMockAttempts(mocks.data || [])
    } catch (err) {
      console.error('Failed to load student progress:', err)
    }
  }

  useEffect(() => {
    loadData()
    loadProgress()

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

  // Each group's own colour (lib/groupLook.js), by creation order —
  // the same colour it has on Home, Groups and the Mock Center.
  const getGroupChipStyle = (groupId) => {
    const byCreated = [...groups].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    const c = groupColour(Math.max(0, byCreated.findIndex((g) => g.id === groupId)))
    return { border: 'border-transparent', bg: c.tint, text: c.text }
  }

  const studentsWithoutGroup = useMemo(() => {
    return students.filter(
      (student) =>
        !(membershipsByStudent[student.id]?.length)
    )
  }, [students, membershipsByStudent])

  // Summary counts shown as stat cards above the table — the same
  // "total / approved / pending / without a group" numbers a teacher
  // used to have to infer by scrolling the list, now surfaced at a
  // glance the way a real admin table's header strip does.
  const stats = useMemo(() => {
    let approved = 0
    let pending = 0

    students.forEach((student) => {
      if (student.status === 'approved') approved += 1
      if (student.status === 'pending') pending += 1
    })

    return {
      total: students.length,
      approved,
      pending,
      withoutGroup: studentsWithoutGroup.length,
    }
  }, [students, studentsWithoutGroup])

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

          if (groupFilter === 'any') {
            return studentGroupIds.length > 0
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

  const progressByStudent = useMemo(() => {
    const now = Date.now()
    const handInAt = new Map()
    handIns.forEach((h) => handInAt.set(`${h.homework_id}:${h.student_id}`, h.submitted_at))
    const hwByGroup = {}
    homeworks.forEach((h) => {
      if (!h.due_date || new Date(h.due_date).getTime() > now) return
      ;(hwByGroup[h.group_id] ||= []).push(h)
    })
    const lastMock = {}
    mockAttempts.forEach((a) => {
      const prev = lastMock[a.user_id]
      if (!prev || String(a.submitted_at) > String(prev.submitted_at)) lastMock[a.user_id] = a
    })
    const out = {}
    students.forEach((st) => {
      const joined = st.created_at ? new Date(st.created_at).getTime() : 0
      let due = 0
      let onTime = 0
      let missed = 0
      ;(membershipsByStudent[st.id] || []).forEach((gid) => {
        ;(hwByGroup[gid] || []).forEach((h) => {
          if (new Date(h.created_at).getTime() < joined) return
          due += 1
          const at = handInAt.get(`${h.id}:${st.id}`)
          if (!at) missed += 1
          else if (new Date(at).getTime() <= new Date(h.due_date).getTime()) onTime += 1
        })
      })
      const m = lastMock[st.id]
      const lastBand = m ? m.band ?? (m.max_score ? estimateBandFromPercent((m.score / m.max_score) * 100) : null) : null
      out[st.id] = { due, onTime, missed, pct: due ? Math.round((onTime / due) * 100) : null, lastBand }
    })
    return out
  }, [students, homeworks, handIns, mockAttempts, membershipsByStudent])

  const sortedStudents = useMemo(() => {
    if (sortBy !== 'attention') return filteredStudents
    const score = (st) => {
      const p = progressByStudent[st.id] || {}
      if (st.status === 'pending') return -1
      return (p.missed || 0) * 1000 + (p.due ? 100 - p.pct : 0)
    }
    return [...filteredStudents].sort((a, b) => score(b) - score(a) || (a.full_name || '').localeCompare(b.full_name || ''))
  }, [filteredStudents, sortBy, progressByStudent])

  const visibleStudents = useMemo(() => sortedStudents.slice(0, showCount), [sortedStudents, showCount])

  useEffect(() => {
    setSelectedIds(new Set())
    setBulkGroupChoice('')
    setShowCount(60)
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
        'id, full_name, username, contact_email, role, status, created_at, target_band, exam_date, exam_result, exam_result_for, bio, avatar_url'
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

  /*
   * Permanently deletes every selected student's account in one go —
   * the same irreversible per-account delete as deleteStudentAccount
   * above, just looped over the whole selection so a teacher clearing
   * out ~50 old accounts only has to type "DELETE" once instead of
   * once per student.
   */
  const bulkDelete = () => {
    const targets = selectedStudentsList

    if (!targets.length) return

    setConfirmDialog({
      title: `Permanently delete ${targets.length} student account${targets.length === 1 ? '' : 's'}?`,
      message: `This PERMANENTLY deletes ${targets.length === 1 ? 'this account' : 'these accounts'} — every group, homework submission, recording, and chat message, everywhere, forever. This cannot be undone.`,
      confirmLabel: `Delete ${targets.length} account${targets.length === 1 ? '' : 's'}`,
      cancelLabel: 'Cancel',
      tone: 'coral',
      requireTypedText: 'DELETE',
      onConfirm: () => doBulkDelete(targets),
    })
  }

  const doBulkDelete = async (studentsToDelete) => {
    setBulkBusy(true)
    setBulkDeleteProgress({ done: 0, total: studentsToDelete.length })

    const deletedIds = []
    const failures = []

    // Each deletion is its own destructive Edge Function call (storage
    // cleanup + an auth deletion), so firing all ~50 at once would be
    // a burst of simultaneous destructive requests, and doing them one
    // at a time would be needlessly slow. A small worker pool — same
    // pattern as the concurrency limiter already used server-side for
    // AI word lookups — runs a batch at a time instead.
    const CONCURRENCY = 10
    let nextIndex = 0

    const worker = async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        if (index >= studentsToDelete.length) return

        const student = studentsToDelete[index]

        try {
          const { data, error } = await supabase.functions.invoke(
            'delete-student',
            { body: { studentId: student.id } }
          )

          if (error) throw error
          if (data?.error) throw new Error(data.error)

          deletedIds.push(student.id)
        } catch (err) {
          console.error(
            `Bulk delete failed for ${student.full_name}:`,
            err
          )
          failures.push({ student, message: err.message })
        }

        setBulkDeleteProgress((prev) => ({
          done: (prev?.done || 0) + 1,
          total: studentsToDelete.length,
        }))
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, studentsToDelete.length) },
        worker
      )
    )

    const deletedSet = new Set(deletedIds)

    setStudents((prev) =>
      prev.filter((student) => !deletedSet.has(student.id))
    )

    setMemberships((prev) =>
      prev.filter(
        (membership) => !deletedSet.has(membership.student_id)
      )
    )

    setSelectedIds((prev) => {
      const next = new Set(prev)
      deletedSet.forEach((id) => next.delete(id))
      return next
    })

    if (selectedStudent && deletedSet.has(selectedStudent.id)) {
      setSelectedStudent(null)
    }

    setBulkDeleteProgress(null)
    setBulkBusy(false)

    if (failures.length) {
      setConfirmDialog({
        title:
          deletedIds.length > 0
            ? `Deleted ${deletedIds.length}, but ${failures.length} failed`
            : `Couldn't delete ${failures.length === 1 ? 'this account' : 'these accounts'}`,
        message:
          deletedIds.length > 0
            ? 'These accounts were not deleted:'
            : undefined,
        points: failures.map(
          (f) => `${f.student.full_name}: ${f.message}`
        ),
        tone: 'coral',
        hideCancel: true,
      })
    }
  }

  if (loading && !hasLoadedOnceRef.current) {
    return (
      <p className="text-mist">
        Loading students…
      </p>
    )
  }

  const groupsByCreated = [...groups].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  const memberCount = (groupId) => memberships.filter((m) => m.group_id === groupId).length

  // Which entry of the left rail is active.
  const railKey =
    view === 'without-group'
      ? 'none'
      : statusFilter === 'pending'
        ? 'pending'
        : statusFilter === 'all' && groupFilter === 'all'
          ? 'everyone'
          : groupFilter !== 'all'
          ? groupFilter
          : 'all'
  const pickRail = (key) => {
    if (key === 'none') {
      setView('without-group')
      setGroupFilter('all')
      setStatusFilter('approved')
    } else if (key === 'everyone') {
      setView('all')
      setGroupFilter('all')
      setStatusFilter('all')
    } else if (key === 'pending') {
      setView('all')
      setGroupFilter('all')
      setStatusFilter('pending')
    } else {
      setView('all')
      setStatusFilter('approved')
      setGroupFilter(key)
    }
  }

  const initials = (s) =>
    String(s.full_name || s.username || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('')

  const avatarLook = (studentId) => {
    const first = getStudentGroups(studentId)[0]
    if (!first) return 'bg-panel-2 text-mist'
    const c = groupColour(Math.max(0, groupsByCreated.findIndex((g) => g.id === first.id)))
    return `${c.tint} ${c.text}`
  }

  const renderDetails = (student) => {
    const progress = progressByStudent[student.id] || {}
    const studentGroups = getStudentGroups(student.id)
    const firstGroup = studentGroups[0]
    const stripe = firstGroup
      ? groupColour(Math.max(0, groupsByCreated.findIndex((g) => g.id === firstGroup.id))).bar
      : 'bg-line'
    return (
      <>
        {viewingPhoto && (
          <PhotoViewer
            src={student.avatar_url}
            alt={student.full_name || 'Student photo'}
            onClose={() => setViewingPhoto(false)}
          />
        )}
        <div className={`h-2 ${stripe}`} aria-hidden="true" />
        <div className="flex flex-col gap-5 p-5 text-sm">
          <div className="flex items-start gap-3.5">
            {student.avatar_url ? (
              <button
                type="button"
                onClick={() => setViewingPhoto(true)}
                className="focus-ring shrink-0 cursor-zoom-in rounded-full"
                aria-label="Open photo"
              >
                <img src={student.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />
              </button>
            ) : (
              <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-full font-brand text-lg font-bold ${avatarLook(student.id)}`}>
                {initials(student)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="break-words font-brand text-lg font-semibold leading-snug text-paper">{student.full_name}</h3>
              <p className="truncate text-[13px] text-mist">
                @{student.username || 'student'}
                {student.target_band != null && <> · target {formatTargetBand(student.target_band)}</>}
              </p>
              {examChip(student)}
            </div>
            <button
              type="button"
              onClick={() => setSelectedStudent(null)}
              className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-xl text-mist transition hover:bg-panel-2 hover:text-paper"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[14px] bg-panel-2 px-2 py-2.5 text-center">
              <div className="font-brand text-[17px] font-semibold text-brass">{formatBand(progress.lastBand)}</div>
              <div className="text-[11px] font-extrabold text-mist">last mock</div>
            </div>
            <div className="rounded-[14px] bg-panel-2 px-2 py-2.5 text-center">
              <div className={`font-brand text-[17px] font-semibold ${progress.pct != null && progress.pct < 60 ? 'text-coral' : 'text-reading'}`}>
                {progress.pct == null ? '—' : `${progress.pct}%`}
              </div>
              <div className="text-[11px] font-extrabold text-mist">on time</div>
            </div>
            <div className="rounded-[14px] bg-panel-2 px-2 py-2.5 text-center">
              <div className={`font-brand text-[17px] font-semibold ${progress.missed ? 'text-coral' : 'text-paper'}`}>{progress.missed ?? 0}</div>
              <div className="text-[11px] font-extrabold text-mist">missed</div>
            </div>
          </div>

          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.06em] text-mist">Groups</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {studentGroups.length > 0 ? (
                studentGroups.map((group) => {
                  const chip = getGroupChipStyle(group.id)
                  return (
                    <span key={group.id} className={`rounded-xl px-2.5 py-1 text-xs font-extrabold ${chip.bg} ${chip.text}`}>
                      {groupDisplayName(group.name)}
                    </span>
                  )
                })
              ) : (
                <span className="text-mist">No group</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-xs font-extrabold uppercase tracking-[0.06em] text-mist">Account</div>
            <div className="flex justify-between gap-3">
              <span className="text-mist">Email</span>
              <span className="min-w-0 break-all text-right font-bold text-paper">{student.contact_email || 'Not provided'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-mist">Status</span>
              <span className={`font-extrabold capitalize ${student.status === 'approved' ? 'text-reading' : student.status === 'pending' ? 'text-amber' : 'text-coral'}`}>
                {student.status}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-mist">Joined</span>
              <span className="font-bold text-paper">{student.created_at ? new Date(student.created_at).toLocaleDateString() : '—'}</span>
            </div>
            {student.target_band != null && (
              <div className="flex justify-between gap-3">
                <span className="text-mist">Target</span>
                <span className="inline-flex items-center gap-1.5 font-bold text-brass">
                  <TargetBandIcon value={student.target_band} className="h-4 w-4" />
                  {formatTargetBand(student.target_band)} — {getTargetBandInfo(student.target_band).label}
                </span>
              </div>
            )}
            {student.exam_date && (
              <div className="flex justify-between gap-3">
                <span className="text-mist">IELTS exam</span>
                <span className="font-bold text-paper">{examText(student)}</span>
              </div>
            )}
          </div>

          {student.bio && (
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.06em] text-mist">Bio</div>
              <p className="mt-1 whitespace-pre-wrap text-paper">{student.bio}</p>
            </div>
          )}

          <ParentReportLink studentId={student.id} />

          <div className="grid grid-cols-2 gap-2">
            {onStartChat && (
              <button
                type="button"
                onClick={() => {
                  onStartChat(student)
                  setSelectedStudent(null)
                }}
                className="focus-ring h-11 rounded-[14px] bg-brass text-sm font-extrabold text-onbrass transition hover:brightness-110"
              >
                Chat
              </button>
            )}
            <button
              type="button"
              onClick={() => setResetPasswordStudent(student)}
              className={`focus-ring h-11 rounded-[14px] border border-line bg-panel text-sm font-extrabold text-paper transition hover:bg-panel-2 ${onStartChat ? '' : 'col-span-2'}`}
            >
              Reset password
            </button>
            <button
              type="button"
              disabled={busyAction === `delete-${student.id}`}
              onClick={() => deleteStudentAccount(student)}
              className="focus-ring col-span-2 h-10 rounded-[14px] text-[13px] font-bold text-coral transition hover:bg-coral/10 disabled:opacity-50"
            >
              {busyAction === `delete-${student.id}` ? 'Deleting…' : 'Delete this account'}
            </button>
          </div>
        </div>
      </>
    )
  }

  const railItem = (key, label, count, swatch, tone = '') => {
    const on = railKey === key
    return (
      <button
        key={key}
        type="button"
        onClick={() => pickRail(key)}
        aria-pressed={on}
        className={`focus-ring flex min-h-11 w-full items-center gap-2.5 rounded-[14px] px-3 text-left text-sm transition ${
          on ? 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] font-extrabold text-paper' : `font-bold hover:bg-panel-2 ${tone || 'text-paper'}`
        }`}
      >
        {swatch}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={`text-[13px] tabular-nums ${on ? 'text-brass' : 'text-mist'}`}>{count}</span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-5">

      {error && (
        <div className="rounded-[14px] border border-coral bg-panel-2 px-4 py-3 text-sm text-coral">
          {error}
        </div>
      )}

      {/* Shared logins (2026-11-06, migration_109) */}
      <SharedLogins />

      {/* STAT CARDS */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => pickRail('everyone')}
          className={`focus-ring rounded-[20px] border bg-panel px-5 py-4 text-left transition ${railKey === 'everyone' ? 'border-brass ring-2 ring-brass/25' : 'border-line hover:border-brass/50'}`}
        >
          <div className="font-brand text-[28px] font-semibold leading-none text-brass">{stats.total}</div>
          <div className="mt-1.5 text-[13px] font-bold text-mist">Students in total</div>
        </button>
        <button
          type="button"
          onClick={() => pickRail('any')}
          className={`focus-ring rounded-[20px] border bg-panel px-5 py-4 text-left transition ${railKey === 'any' ? 'border-reading ring-2 ring-reading/25' : 'border-line hover:border-reading/50'}`}
        >
          <div className="font-brand text-[28px] font-semibold leading-none text-reading">{stats.total - stats.withoutGroup}</div>
          <div className="mt-1.5 text-[13px] font-bold text-mist">In a group</div>
        </button>
        <button
          type="button"
          onClick={() => pickRail('none')}
          className={`focus-ring rounded-[20px] border bg-panel px-5 py-4 text-left transition ${railKey === 'none' ? 'border-coral ring-2 ring-coral/25' : 'border-line hover:border-coral/50'}`}
        >
          <div className="font-brand text-[28px] font-semibold leading-none text-coral">{stats.withoutGroup}</div>
          <div className="mt-1.5 text-[13px] font-bold text-mist">No group yet</div>
        </button>
        <button
          type="button"
          onClick={() => pickRail('pending')}
          className={`focus-ring rounded-[20px] border bg-panel px-5 py-4 text-left transition ${railKey === 'pending' ? 'border-amber ring-2 ring-amber/25' : 'border-line hover:border-amber/50'}`}
        >
          <div className="font-brand text-[28px] font-semibold leading-none text-amber">{stats.pending}</div>
          <div className="mt-1.5 text-[13px] font-bold text-mist">Waiting for approval</div>
        </button>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_320px]">

        {/* GROUP RAIL */}
        <nav aria-label="Groups" className="flex flex-col gap-1 rounded-[20px] border border-line bg-panel p-3 lg:sticky lg:top-4">
          <div className="px-2.5 pb-1.5 pt-1 text-xs font-extrabold uppercase tracking-[0.06em] text-mist">Groups</div>
          {railItem('all', 'All students', stats.approved, null)}
          {groupsByCreated.map((group, i) =>
            railItem(
              group.id,
              groupDisplayName(group.name),
              memberCount(group.id),
              <span className={`h-7 w-2.5 shrink-0 rounded-md ${groupColour(i).bar}`} aria-hidden="true" />
            )
          )}
          <div className="mx-1.5 my-1.5 h-px bg-line" aria-hidden="true" />
          {railItem('none', 'No group', stats.withoutGroup, <span className="h-7 w-2.5 shrink-0 rounded-md border-2 border-dashed border-coral" aria-hidden="true" />, 'text-coral')}
          {railItem('pending', 'Waiting approval', stats.pending, <span className="h-7 w-2.5 shrink-0 rounded-md border-2 border-dashed border-amber" aria-hidden="true" />, 'text-amber')}
        </nav>

        <div className="flex min-w-0 flex-col gap-3.5">

          {/* TOOLBAR */}
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex h-[46px] min-w-[220px] flex-1 items-center gap-2.5 rounded-[14px] border border-line bg-panel px-3.5">
              <svg className="h-[18px] w-[18px] shrink-0 text-mist" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <span className="sr-only">Search students</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, username, email or group"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-paper outline-none placeholder:text-mist"
              />
            </label>
            <div role="group" aria-label="Sort" className="flex gap-1 rounded-[14px] bg-panel-2 p-1">
              {[
                ['attention', 'Needs attention'],
                ['name-asc', 'A–Z'],
                ['newest', 'Newest'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortBy(key)}
                  aria-pressed={sortBy === key}
                  className={`focus-ring h-[38px] rounded-[11px] px-3.5 text-[13px] transition ${sortBy === key ? 'bg-panel font-extrabold text-paper shadow-sm' : 'font-bold text-mist hover:text-paper'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === 'all' && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Status"
                className="focus-ring h-[46px] rounded-[14px] border border-line bg-panel px-3 text-sm font-bold text-paper"
              >
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
                <option value="all">All statuses</option>
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-bold text-mist">
              <input
                type="checkbox"
                checked={filteredStudents.length > 0 && filteredStudents.every((s) => selectedIds.has(s.id))}
                onChange={() => {
                  const all = filteredStudents.length > 0 && filteredStudents.every((s) => selectedIds.has(s.id))
                  setSelectedIds(all ? new Set() : new Set(filteredStudents.map((s) => s.id)))
                }}
                className="h-4 w-4 accent-brass"
              />
              Showing {filteredStudents.length} student{filteredStudents.length === 1 ? '' : 's'}
              {loading && <span className="font-semibold">· updating…</span>}
            </label>
            {(search || groupFilter !== 'all' || statusFilter !== 'approved' || view !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  clearFilters()
                  setView('all')
                }}
                className="focus-ring rounded-lg text-[13px] font-extrabold text-brass hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* BULK BAR */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-2.5 rounded-[14px] bg-[#17213a] px-4 py-2.5 text-sm font-bold text-white">
              <span className="mr-auto">{selectedIds.size} selected</span>
              {selectedNotApprovedCount > 0 && (
                <button
                  type="button"
                  onClick={bulkApprove}
                  disabled={bulkBusy}
                  className="focus-ring h-9 rounded-[11px] bg-[#1f8f5c] px-3.5 text-[13px] font-extrabold text-white disabled:opacity-40"
                >
                  Approve {selectedNotApprovedCount}
                </button>
              )}
              <select
                value={bulkGroupChoice}
                onChange={(e) => setBulkGroupChoice(e.target.value)}
                aria-label="Group to add to"
                className="focus-ring h-9 rounded-[11px] border border-white/30 bg-transparent px-2.5 text-[13px] font-bold text-white [&>option]:text-[#17213a]"
              >
                <option value="">Choose a group…</option>
                {groupsByCreated.map((group) => (
                  <option key={group.id} value={group.id}>{groupDisplayName(group.name)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={bulkAddToGroup}
                disabled={bulkBusy || !bulkGroupChoice}
                className="focus-ring h-9 rounded-[11px] bg-saffron px-3.5 text-[13px] font-extrabold text-[#17213a] disabled:opacity-40"
              >
                Add to group
              </button>
              <button
                type="button"
                onClick={bulkDelete}
                disabled={bulkBusy}
                className="focus-ring h-9 rounded-[11px] border border-white/30 px-3.5 text-[13px] font-bold text-white hover:bg-white/10 disabled:opacity-40"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="focus-ring h-9 rounded-[11px] px-2.5 text-[13px] font-bold text-white/80 hover:text-white"
              >
                Clear
              </button>
              {bulkDeleteProgress && (
                <div className="w-full text-xs text-[#f6c56b]">
                  Deleting {bulkDeleteProgress.done}/{bulkDeleteProgress.total}…
                </div>
              )}
            </div>
          )}

          {/* STUDENT LIST */}
          {filteredStudents.length === 0 ? (
            <div className="rounded-[20px] border border-line bg-panel p-8 text-center">
              <p className="text-mist">No students match the current search and filters.</p>
              <button type="button" onClick={clearFilters} className="focus-ring mt-3 rounded-lg text-sm font-extrabold text-brass hover:underline">
                Clear filters
              </button>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {visibleStudents.map((student) => {
                const studentGroups = getStudentGroups(student.id)
                const isSelected = selectedIds.has(student.id)
                const isOpen = selectedStudent?.id === student.id
                const progress = progressByStudent[student.id] || {}
                const pending = student.status === 'pending'
                const noGroup = studentGroups.length === 0 && student.status === 'approved'
                return (
                  <li
                    key={student.id}
                    className={`grid grid-cols-[22px_44px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 rounded-[20px] bg-panel px-4 py-3.5 sm:grid-cols-[22px_44px_minmax(0,1.3fr)_minmax(0,1fr)_78px_120px] ${
                      isOpen ? 'border-2 border-brass' : pending ? 'border border-amber/40 bg-[color-mix(in_srgb,var(--color-saffron)_7%,var(--color-panel))]' : noGroup ? 'border border-dashed border-coral/60' : 'border border-line'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(student.id)}
                      aria-label={`Select ${student.full_name}`}
                      className="h-[18px] w-[18px] accent-brass"
                    />
                    {student.avatar_url ? (
                      <img src={student.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                    ) : (
                      <div className={`grid h-11 w-11 place-items-center rounded-full font-brand text-sm font-bold ${avatarLook(student.id)}`}>
                        {initials(student)}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedStudent(isOpen ? null : student)}
                      className="focus-ring min-w-0 rounded-lg text-left"
                    >
                      <div className="truncate text-[15px] font-extrabold text-paper">{student.full_name || 'No name yet'}</div>
                      <div className="truncate text-[13px] text-mist">
                        @{student.username}
                        {student.created_at && <> · joined {new Date(student.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</>}
                      </div>
                    </button>

                    {pending ? (
                      <div className="col-span-3 flex flex-wrap justify-end gap-2 sm:col-span-3">
                        <button
                          type="button"
                          onClick={() => setSelectedStudent(student)}
                          className="focus-ring h-10 rounded-xl border border-line bg-panel px-3.5 text-[13px] font-extrabold text-paper hover:bg-panel-2"
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          disabled={bulkBusy}
                          onClick={() => doBulkApprove([student.id])}
                          className="focus-ring h-10 rounded-xl bg-brass px-4 text-[13px] font-extrabold text-onbrass disabled:opacity-50"
                        >
                          Approve
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="col-span-3 flex flex-wrap items-center gap-1.5 sm:col-span-1">
                          {studentGroups.map((group) => {
                            const chip = getGroupChipStyle(group.id)
                            return (
                              <span key={group.id} className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-extrabold ${chip.bg} ${chip.text}`}>
                                {groupDisplayName(group.name)}
                                <button
                                  type="button"
                                  disabled={busyAction === `remove-${student.id}-${group.id}`}
                                  onClick={() => removeFromGroup(student, group)}
                                  className="focus-ring -mr-1 rounded px-1 opacity-60 hover:opacity-100 disabled:opacity-30"
                                  aria-label={`Remove from ${groupDisplayName(group.name)}`}
                                >
                                  ×
                                </button>
                              </span>
                            )
                          })}
                          {student.status === 'approved' && (
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) addToGroup(student, e.target.value)
                              }}
                              aria-label={`Add ${student.full_name} to a group`}
                              className={`focus-ring h-8 max-w-[150px] rounded-xl border px-2 text-xs font-extrabold ${
                                studentGroups.length === 0 ? 'border-dashed border-coral bg-panel text-coral' : 'border-line bg-panel text-mist'
                              }`}
                            >
                              <option value="">{studentGroups.length === 0 ? '+ Put in a group' : '+ Group'}</option>
                              {groupsByCreated
                                .filter((group) => !studentGroups.some((g) => g.id === group.id))
                                .map((group) => (
                                  <option key={group.id} value={group.id}>{groupDisplayName(group.name)}</option>
                                ))}
                            </select>
                          )}
                        </div>
                        <div className="hidden text-center sm:block">
                          <div className={`font-brand text-[18px] font-semibold ${progress.lastBand == null ? 'text-mist' : 'text-brass'}`}>
                            {formatBand(progress.lastBand)}
                          </div>
                          <div className="text-[11px] font-bold text-mist">{progress.lastBand == null ? 'no mock yet' : 'last mock'}</div>
                        </div>
                        <div className="col-span-3 sm:col-span-1">
                          {progress.due ? (
                            <>
                              <div className="h-2 overflow-hidden rounded-md bg-panel-2">
                                <div
                                  className={`h-full rounded-md ${progress.pct >= 85 ? 'bg-[#1f8f5c]' : progress.pct >= 60 ? 'bg-saffron' : 'bg-coral'}`}
                                  style={{ width: `${progress.pct}%` }}
                                />
                              </div>
                              <div className={`mt-1 text-xs font-bold ${progress.pct < 60 ? 'text-coral' : 'text-mist'}`}>
                                {progress.pct}% on time{progress.missed ? ` · ${progress.missed} missed` : ''}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs font-bold text-mist">No homework yet</div>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {filteredStudents.length > visibleStudents.length && (
            <button
              type="button"
              onClick={() => setShowCount((n) => n + 60)}
              className="focus-ring mx-auto rounded-lg px-3 py-2 text-[13px] font-extrabold text-brass hover:underline"
            >
              Showing {visibleStudents.length} of {filteredStudents.length} · Show more
            </button>
          )}
        </div>

        {/* DETAILS PANEL (wide screens) */}
        {isWide && (
          <aside aria-label="Student details" className="sticky top-4 overflow-hidden rounded-[20px] border border-line bg-panel">
            {selectedStudent ? (
              renderDetails(selectedStudent)
            ) : (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-full bg-panel-2 text-mist" aria-hidden="true">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
                </div>
                <p className="text-sm font-bold text-paper">Pick a student</p>
                <p className="text-[13px] text-mist">Their bands, homework and account show here.</p>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* DETAILS WINDOW (narrow screens) */}
      {!isWide && selectedStudent &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setSelectedStudent(null)
            }}
          >
            <div className="absolute inset-0 bg-black/35" />
            <div
              className="relative z-10 max-h-[88vh] w-full max-w-md overflow-y-auto rounded-[20px] bg-panel text-paper shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {renderDetails(selectedStudent)}
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