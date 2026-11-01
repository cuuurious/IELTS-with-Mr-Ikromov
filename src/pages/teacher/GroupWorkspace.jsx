import { groupColour } from '../../lib/groupLook'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import PostHomeworkForm from './PostHomeworkForm'
import SubmissionPanel from './SubmissionPanel'
import EditHomeworkModal from './EditHomeworkModal'
import ConfirmModal from '../../components/ConfirmModal'
import { getSubmissionStatus } from '../../components/StampBadge'
import { notifyGroup, notifyUsers } from '../../lib/notify'
import { useSessionState } from '../../lib/sessionState'
import { skillOfHomework, formatDue } from '../../lib/skills'
import { SkillIcon } from '../../components/SkillArt'
import { fetchAll } from '../../lib/fetchAll'
import { estimateBandFromPercent, roundOverallBand, formatBand } from '../../lib/ieltsBands'
import Icon from '../../components/Icon'

export default function GroupWorkspace({ teacherId }) {
  const [groups, setGroups] = useState([])
  // Remembered across a refresh (Jasur, 2026-09-30: "i dont want refresh
  // me to take to this window constantly") — the group you had open and
  // whether you were inside it, see lib/sessionState.js.
  const [activeGroup, setActiveGroup] = useSessionState(`ielts:${teacherId}:groups:activeGroup`, null)

  // Keeps the latest activeGroup readable from inside async callbacks
  // without them closing over a stale value. Used so a slow-loading
  // fetch for a group the teacher has since clicked away from can't
  // overwrite a faster, newer fetch's results.
  const activeGroupRef = useRef(activeGroup)
  activeGroupRef.current = activeGroup

  // Two-screen navigation: 'groups' is the folder-style overview (a
  // grid of group tiles), 'detail' is the full-screen view for one
  // group's roster and homework. Opening a group is a deliberate
  // click into it, and there's an explicit way back — instead of
  // every group's homework table living permanently on the same
  // screen as the group picker.
  const [screen, setScreen] = useSessionState(`ielts:${teacherId}:groups:screen`, 'groups')

  // Lightweight per-group counts (students, assignments) shown on
  // each tile in the overview grid. Loaded once — in bulk, for every
  // group at once — right after the group list loads, specifically
  // so opening the overview never has to run the full roster +
  // homework + submissions fetch (loadGroupData below) for every
  // group just to show a number on a card.
  const [groupCounts, setGroupCounts] = useState({})

  // Whether the "add a group" tile is showing its input yet, or just
  // its "+ New group" prompt.
  const [composingGroup, setComposingGroup] = useState(false)

  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)

  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const [roster, setRoster] = useState([])
  const [homeworks, setHomeworks] = useState([])
  const [submissions, setSubmissions] = useState({})
  const [groupDataLoading, setGroupDataLoading] = useState(false)

  // Whether what's on screen is a group's last known roster/homework/
  // submissions while a fresh copy loads quietly behind it, as opposed
  // to groupDataLoading (there's genuinely nothing to show yet). Lets a
  // group you've already opened this session redisplay instantly on a
  // revisit instead of dimming the table and saying "Loading this
  // group…" every single time — see groupDataCacheRef below.
  const [refreshingGroup, setRefreshingGroup] = useState(false)

  // Last known roster/homeworks/submissions per group, kept current by
  // the mirroring effect further down (it fires after every state
  // change to any of the three, for whichever group is active) —
  // rather than this needing to be updated by hand at every place in
  // this file that already calls setRoster/setHomeworks/setSubmissions
  // (posting homework, editing it, a realtime submission update, and
  // so on).
  const groupDataCacheRef = useRef({})

  const [viewing, setViewing] = useState(null)
  const [editingHomework, setEditingHomework] = useState(null)

  const [busyAction, setBusyAction] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [confirmDialog, setConfirmDialog] = useState(null)

  /* =========================================================
     GROUPS
  ========================================================= */

  const loadGroups = async () => {
    const { data } = await supabase
      .from('groups')
      .select('*')
      .order('created_at')

    setGroups(data || [])
    loadGroupCounts(data || [])

    const stillExists = activeGroup && (data || []).some((g) => g.id === activeGroup)
    if (!stillExists) {
      // Nothing remembered, or the remembered group was deleted since.
      setActiveGroup(data?.length ? data[0].id : null)
      setScreen('groups')
    }
  }

  // One bulk query per table (not one per group) so a teacher with
  // many groups doesn't turn a single page load into a burst of tiny
  // requests — the exact kind of pile-up worth avoiding.
  const loadGroupCounts = async (groupList) => {
    if (!groupList?.length) {
      setGroupCounts({})
      return
    }

    const groupIds = groupList.map((group) => group.id)

    const [{ data: members }, { data: hw }] = await Promise.all([
      supabase
        .from('group_members')
        .select('group_id, student_id, profiles!inner(status)')
        .in('group_id', groupIds)
        .eq('profiles.status', 'approved'),
      supabase
        .from('homeworks')
        .select('id, group_id, title, description, homework_type, enable_speaking, due_date, created_at')
        .in('group_id', groupIds),
    ])

    const counts = {}

    groupIds.forEach((id) => {
      counts[id] = { students: 0, tasks: 0, latest: null, latestDone: 0 }
    })

    ;(members || []).forEach((member) => {
      if (counts[member.group_id]) {
        counts[member.group_id].students += 1
      }
    })

    ;(hw || []).forEach((homework) => {
      const c = counts[homework.group_id]
      if (c) {
        c.tasks += 1
        // Newest homework per group, shown on its tile (2026-10-06).
        if (!c.latest || new Date(homework.created_at) > new Date(c.latest.created_at)) c.latest = homework
      }
    })

    setGroupCounts(counts)

    // Card numbers (redesign 2026-11-02): homework on time over the last
    // 4 weeks, missed this week, open tasks, next deadline, average of
    // each student's latest mock band.
    const now = Date.now()
    const DAY = 86400000
    const studentsOf = {}
    ;(members || []).forEach((m) => {
      ;(studentsOf[m.group_id] ||= new Set()).add(m.student_id)
    })
    const recent = (hw || []).filter((h) => h.due_date && now - new Date(h.due_date).getTime() < 28 * DAY)
    const wanted = [...new Set([...recent.map((h) => h.id), ...Object.values(counts).map((c) => c.latest?.id).filter(Boolean)])]
    const allStudentIds = [...new Set((members || []).map((m) => m.student_id))]
    const [{ data: subs }, { data: mocks }] = await Promise.all([
      wanted.length
        ? fetchAll(() =>
            supabase.from('submissions').select('id, homework_id, student_id, submitted_at, status').in('homework_id', wanted).order('id')
          )
        : Promise.resolve({ data: [] }),
      allStudentIds.length
        ? fetchAll(() =>
            supabase
              .from('mock_attempts')
              .select('id, user_id, score, max_score, band, submitted_at')
              .in('user_id', allStudentIds)
              .not('submitted_at', 'is', null)
              .order('id')
          )
        : Promise.resolve({ data: [] }),
    ])
    const subsBy = {}
    ;(subs || []).forEach((row) => {
      ;(subsBy[row.homework_id] ||= []).push(row)
    })
    const lastMock = {}
    ;(mocks || []).forEach((a) => {
      const prev = lastMock[a.user_id]
      if (!prev || String(a.submitted_at) > String(prev.submitted_at)) lastMock[a.user_id] = a
    })
    const mockBand = (a) => a.band ?? (a.max_score ? estimateBandFromPercent((a.score / a.max_score) * 100) : null)
    setGroupCounts((prev) => {
      const next = { ...prev }
      Object.keys(next).forEach((id) => {
        const c = { ...next[id] }
        const roster = studentsOf[id] || new Set()
        const own = (hw || []).filter((h) => h.group_id === id)
        if (c.latest) c.latestDone = (subsBy[c.latest.id] || []).filter((r) => r.status === 'done' && roster.has(r.student_id)).length
        let due = 0
        let onTime = 0
        let missedWeek = 0
        own.forEach((h) => {
          if (!h.due_date) return
          const dueAt = new Date(h.due_date).getTime()
          if (dueAt > now || now - dueAt > 28 * DAY) return
          const handed = (subsBy[h.id] || []).filter((r) => roster.has(r.student_id))
          due += roster.size
          onTime += handed.filter((r) => new Date(r.submitted_at).getTime() <= dueAt).length
          if (now - dueAt <= 7 * DAY) missedWeek += Math.max(0, roster.size - handed.length)
        })
        const upcoming = own.filter((h) => h.due_date && new Date(h.due_date).getTime() > now).sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
        const bands = [...roster].map((sid) => lastMock[sid]).filter(Boolean).map(mockBand).filter((b) => b != null)
        c.onTimePct = due ? Math.round((onTime / due) * 100) : null
        c.missedWeek = missedWeek
        c.open = upcoming.length
        c.next = upcoming[0] || null
        c.avgBand = bands.length ? roundOverallBand(bands.reduce((x, y) => x + y, 0) / bands.length) : null
        next[id] = c
      })
      return next
    })
  }

  useEffect(() => {
    loadGroups()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openGroup = (groupId) => {
    setActiveGroup(groupId)
    setScreen('detail')
  }

  const backToGroups = () => {
    // The roster/homework counts for the group just visited are
    // already sitting in state from loadGroupData — reuse them to
    // keep that tile's numbers current on the overview instead of
    // re-fetching everything just to show a card.
    if (activeGroup) {
      setGroupCounts((prev) => ({
        ...prev,
        [activeGroup]: (() => {
          const latest = [...homeworks].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null
          const latestDone = latest
            ? roster.filter((st) => submissions[`${latest.id}_${st.id}`]?.status === 'done').length
            : 0
          return { ...prev[activeGroup], students: roster.length, tasks: homeworks.length, latest, latestDone }
        })(),
      }))
    }

    setScreen('groups')
  }

  /*
   * Each group gets a stable, distinct color (cycling through the
   * design system's accent palette by the group's position in the
   * list) so tiles — and the header of the group you've opened — are
   * easy to tell apart at a glance instead of all reading as the same
   * neutral purple block. Mirrors the same approach already used for
   * group chips on the Students page.
   */
  const groupAccentPalette = [
    { bg: 'bg-sage/15', text: 'text-sage', border: 'border-sage/30' },
    { bg: 'bg-coral/15', text: 'text-coral', border: 'border-coral/30' },
    { bg: 'bg-cyan/15', text: 'text-cyan', border: 'border-cyan/30' },
    { bg: 'bg-brass/15', text: 'text-brass', border: 'border-brass/30' },
    { bg: 'bg-lavender/15', text: 'text-lavender', border: 'border-lavender/30' },
  ]

  // The group's own colour (lib/groupLook.js) — same on Home, here and
  // in the Mock Center. groups are loaded in creation order.
  const getGroupAccent = (groupId) => {
    const index = groups.findIndex((group) => group.id === groupId)
    const c = groupColour(index === -1 ? 0 : index)
    return { bg: c.tint, tint: c.tint, text: c.text, border: c.border, bar: c.bar }
  }

  // Groups named like "71", "72", "73"... all share the same first
  // character (7), so showing just charAt(0) made every one of those
  // badges read identically once there were more than a handful of
  // numbered groups. A purely numeric name shows in full instead so
  // each one is distinct again. The title line right below is hidden
  // for these groups (see the two spots that render group.name next
  // to this badge) since it would just repeat this exact text — so
  // the badge stays plain, with nothing else on screen duplicating
  // it. Text names ("EL STARS") keep the single-letter monogram AND
  // their title line, since "E" is an abbreviation, not a copy.
  const getGroupBadge = (name) => {
    const trimmed = (name || '').trim()

    if (!trimmed) return '?'
    if (/^\d+$/.test(trimmed)) return trimmed

    return trimmed.charAt(0).toUpperCase()
  }

  const createGroup = async (e) => {
    e.preventDefault()

    if (!newGroupName.trim()) return

    setCreating(true)

    const { data, error } = await supabase
      .from('groups')
      .insert({
        name: newGroupName.trim(),
        created_by: teacherId,
      })
      .select()
      .single()

    setCreating(false)

    if (!error) {
      setNewGroupName('')
      setComposingGroup(false)
      setGroups((prev) => [...prev, data])
      setGroupCounts((prev) => ({
        ...prev,
        [data.id]: { students: 0, tasks: 0 },
      }))
      openGroup(data.id)
    } else {
      setConfirmDialog({
        title: "Couldn't create group",
        message: error.message,
        tone: 'coral',
        hideCancel: true,
      })
    }
  }

  const startRename = (group) => {
    setRenamingId(group.id)
    setRenameValue(group.name)
  }

  const saveRename = async (id) => {
    const name = renameValue.trim()

    if (!name) {
      setRenamingId(null)
      return
    }

    const { data, error } = await supabase
      .from('groups')
      .update({ name })
      .eq('id', id)
      .select()
      .single()

    if (!error) {
      setGroups((prev) =>
        prev.map((group) =>
          group.id === id ? data : group
        )
      )
    } else {
      setConfirmDialog({
        title: "Couldn't rename group",
        message: error.message,
        tone: 'coral',
        hideCancel: true,
      })
    }

    setRenamingId(null)
  }

  /* =========================================================
     DELETE GROUP
     (permanently deletes the group, every homework in it, the
     whole group chat, and every member's ENTIRE account —
     unrecoverable)
  ========================================================= */

  const deleteGroup = (group) => {
    setConfirmDialog({
      title: `Delete "${group.name}" permanently?`,
      message: `This PERMANENTLY deletes the group "${group.name}" — every student who is a member (their entire account, even other groups they belong to), every homework, submission and file, and the whole group chat. This cannot be undone.`,
      confirmLabel: 'Delete Group',
      cancelLabel: 'Cancel',
      tone: 'coral',
      requireTypedText: 'DELETE',
      onConfirm: () => doDeleteGroup(group),
    })
  }

  const doDeleteGroup = async (group) => {
    setBusyAction(`delete-group-${group.id}`)

    try {
      const { data, error } =
        await supabase.functions.invoke(
          'delete-group',
          {
            body: { groupId: group.id },
          }
        )

      if (error) throw error
      if (data?.error) throw new Error(data.error)

      const remaining = groups.filter(
        (g) => g.id !== group.id
      )

      setGroups(remaining)

      setGroupCounts((prev) => {
        const next = { ...prev }
        delete next[group.id]
        return next
      })

      delete groupDataCacheRef.current[group.id]

      if (activeGroup === group.id) {
        const nextActive = remaining.length
          ? remaining[0].id
          : null

        setActiveGroup(nextActive)
        // Deleting the group you're currently looking at should send
        // you back to the overview rather than silently swapping in
        // a different group's homework underneath you.
        setScreen('groups')

        if (!nextActive) {
          setRoster([])
          setHomeworks([])
          setSubmissions({})
        }
      }

      setConfirmDialog({
        title: 'Group deleted',
        message:
          data?.message ||
          `Group "${group.name}" was deleted.`,
        hideCancel: true,
      })
    } catch (err) {
      setConfirmDialog({
        title: "Couldn't delete this group",
        message: err.message,
        tone: 'coral',
        hideCancel: true,
      })
    } finally {
      setBusyAction('')
    }
  }

  /* =========================================================
     GROUP DATA
  ========================================================= */

  const SUBMISSION_COLUMNS =
    'id, homework_id, student_id, group_id, status, submitted_at, screenshot_urls, submission_files, audio_part1_url, audio_part2_url, audio_part3_url, comment, mock_essay, ai_status, ai_result, ai_error, ai_evaluated_at'

  const loadGroupData = async () => {
    // Snapshot which group this call was made for. If the teacher
    // switches groups again before these requests come back (Group A
    // then immediately Group B), Group A's slower response would
    // otherwise land second and silently overwrite Group B's roster —
    // the requestedGroup check below discards it instead.
    const requestedGroup = activeGroup

    if (!requestedGroup) return
    if (screen !== 'detail') return

    const cached = groupDataCacheRef.current[requestedGroup]

    if (cached) {
      // Already have this group's data from earlier this session —
      // show it right away (no dimmed table, no "Loading this
      // group…") while a fresh copy loads quietly underneath.
      setRoster(cached.roster)
      setHomeworks(cached.homeworks)
      setSubmissions(cached.submissions)
      setGroupDataLoading(false)
      setRefreshingGroup(true)
    } else {
      // Genuinely nothing to show for this group yet. Was previously
      // three round trips run one after another (each waiting on the
      // last), which is exactly why switching groups felt slow and,
      // worse, left the PREVIOUS group's roster and homework sitting
      // on screen — unchanged and with nothing telling you it was
      // stale — for the entire time all three were loading. Running
      // them together roughly triples the speed, and
      // groupDataLoading (cleared once real data lands) is what tells
      // the table to visibly dim instead of quietly lying.
      setGroupDataLoading(true)
    }

    const [
      { data: members },
      { data: hw },
      { data: subs },
    ] = await Promise.all([
      supabase
        .from('group_members')
        .select(
          'student_id, profiles!inner(id, full_name, username, status, contact_email)'
        )
        .eq('group_id', requestedGroup)
        .eq('profiles.status', 'approved'),
      supabase
        .from('homeworks')
        .select('*')
        .eq('group_id', requestedGroup)
        .order('created_at', { ascending: false }),
      // fetchAll + named columns (2026-10-06): a plain select('*') stopped
      // silently at 1000 rows, so big groups lost submissions off the end.
      // These are the columns the progress table and SubmissionPanel /
      // AiFeedbackCard read.
      fetchAll(() =>
        supabase
          .from('submissions')
          .select(SUBMISSION_COLUMNS)
          .eq('group_id', requestedGroup)
          .order('id')
      ),
    ])

    // A newer request has since started (or completed) for a
    // different group — this response is stale, so drop it instead
    // of committing it to state. Leave groupDataLoading alone here:
    // whichever request actually matches the current group is the one
    // that gets to turn loading back off, below.
    if (requestedGroup !== activeGroupRef.current) return

    const nextRoster = (members || [])
      .map((member) => member.profiles)
      .filter(Boolean)

    const nextHomeworks = hw || []

    const map = {}

    ;(subs || []).forEach((submission) => {
      map[
        `${submission.homework_id}_${submission.student_id}`
      ] = submission
    })

    setRoster(nextRoster)
    setHomeworks(nextHomeworks)
    setSubmissions(map)
    setGroupDataLoading(false)
    setRefreshingGroup(false)
  }

  // Keeps groupDataCacheRef current for whichever group is active,
  // automatically, from every place in this file that changes roster/
  // homeworks/submissions — the fetch above, a realtime submission
  // update, posting/editing/deleting homework, removing a student, and
  // so on — without each of those needing to know the cache exists.
  useEffect(() => {
    if (!activeGroup || screen !== 'detail') return

    groupDataCacheRef.current[activeGroup] = {
      roster,
      homeworks,
      submissions,
    }
  }, [activeGroup, screen, roster, homeworks, submissions])

  useEffect(() => {
    loadGroupData()
    setStudentSearch('')

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup, screen])

  /*
   * ============================================================
   * REALTIME: AI GRADING RESULTS
   * ============================================================
   * The ai-grading Edge Function writes ai_status/ai_result onto a
   * submission a little while after it's sent — this is what makes
   * that result (and a "Re-run AI" click) appear here on its own,
   * including inside an already-open submission panel, without
   * needing to close and reopen it.
   */

  useEffect(() => {
    // No point holding a realtime channel open for a group's
    // submissions while the teacher isn't even looking at that
    // group's screen.
    if (!activeGroup || screen !== 'detail') return

    const channel = supabase
      .channel(`teacher-submissions-${activeGroup}`)
      .on(
        'postgres_changes',
        {
          // '*' not just UPDATE (2026-10-06): a student's FIRST hand-in is
          // an INSERT, which never showed up live before.
          event: '*',
          schema: 'public',
          table: 'submissions',
          filter: `group_id=eq.${activeGroup}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const goneId = payload.old?.id
            if (!goneId) return
            setSubmissions((prev) =>
              Object.fromEntries(Object.entries(prev).filter(([, sub]) => sub?.id !== goneId))
            )
            return
          }
          const submission = payload.new
          if (!submission?.homework_id || !submission?.student_id) return
          const key = `${submission.homework_id}_${submission.student_id}`

          setSubmissions((prev) => ({
            ...prev,
            [key]: submission,
          }))

          setViewing((prev) =>
            prev && prev.submission?.id === submission.id
              ? { ...prev, submission }
              : prev
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeGroup, screen])

  /* =========================================================
     REMOVE STUDENT FROM GROUP
  ========================================================= */

  const removeStudent = (student) => {
    setConfirmDialog({
      title: 'Remove student from this group?',
      message: `Remove ${student.full_name} from this group? Their account, submissions, chat history, and other groups will NOT be deleted.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => doRemoveStudent(student),
    })
  }

  const doRemoveStudent = async (student) => {
    setBusyAction(`remove-${student.id}`)

    try {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', activeGroup)
        .eq('student_id', student.id)

      if (error) throw error

      setRoster((prev) =>
        prev.filter(
          (studentItem) =>
            studentItem.id !== student.id
        )
      )

      setSubmissions((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(
            ([key]) =>
              !key.endsWith(`_${student.id}`)
          )
        )
      )
    } catch (err) {
      setConfirmDialog({
        title: "Couldn't remove student",
        message: `Couldn't remove student from this group: ${err.message}`,
        tone: 'coral',
        hideCancel: true,
      })
    } finally {
      setBusyAction('')
    }
  }

  /*
   * Permanently deleting a student's whole account now lives on the
   * Students page (View details → Delete this account) instead of
   * here — this group roster only handles removing a student from
   * THIS group.
   */

  /* =========================================================
     STORAGE
  ========================================================= */

  const storagePathFromPublicUrl = (url, bucket) => {
    if (!url) return null

    const marker =
      `/storage/v1/object/public/${bucket}/`

    const index = url.indexOf(marker)

    return index >= 0
      ? decodeURIComponent(
          url.slice(index + marker.length)
        )
      : null
  }

  /* =========================================================
     DELETE HOMEWORK
  ========================================================= */

  const deleteHomework = (hw) => {
    setConfirmDialog({
      title: `Delete "${hw.title}" completely?`,
      message: 'This permanently removes the homework, all student submissions, recordings, comments, and uploaded files. This cannot be undone.',
      confirmLabel: 'Delete Homework',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => doDeleteHomework(hw),
    })
  }

  const doDeleteHomework = async (hw) => {
    setBusyAction(`delete-${hw.id}`)

    try {
      const { data: subs, error: subsError } =
        await supabase
          .from('submissions')
          .select(
            'screenshot_urls, submission_files, audio_part1_url, audio_part2_url, audio_part3_url'
          )
          .eq('homework_id', hw.id)

      if (subsError) throw subsError

      const submissionPaths = []

      for (const sub of subs || []) {
        for (const url of [
          ...(sub.screenshot_urls || []),
          ...(sub.submission_files || [])
            .map((file) => file?.url)
            .filter(Boolean),
          sub.audio_part1_url,
          sub.audio_part2_url,
          sub.audio_part3_url,
        ]) {
          const path = storagePathFromPublicUrl(
            url,
            'submissions'
          )

          if (path) submissionPaths.push(path)
        }
      }

      const uniqueSubmissionPaths = [
        ...new Set(submissionPaths),
      ]

      const homeworkFilePaths = [
        storagePathFromPublicUrl(
          hw.attachment_url,
          'homework-files'
        ),
        storagePathFromPublicUrl(
          hw.mock_task1_image_url,
          'homework-files'
        ),
      ].filter(Boolean)

      // DB row FIRST, files after (2026-10-06 review): the files used to
      // be removed first, so a failed delete left a homework whose
      // submissions pointed at files that no longer existed. Now a failed
      // delete changes nothing, and a failed file cleanup only leaves
      // orphaned files behind (logged), never broken rows.
      const { error } = await supabase
        .from('homeworks')
        .delete()
        .eq('id', hw.id)

      if (error) throw error

      if (uniqueSubmissionPaths.length) {
        const { error: storageError } =
          await supabase.storage
            .from('submissions')
            .remove(uniqueSubmissionPaths)

        if (storageError) console.error('Homework deleted, but some submission files could not be removed:', storageError)
      }

      if (homeworkFilePaths.length) {
        const { error: homeworkStorageError } =
          await supabase.storage
            .from('homework-files')
            .remove(homeworkFilePaths)

        if (homeworkStorageError) {
          console.error('Homework deleted, but its attachment could not be removed:', homeworkStorageError)
        }
      }

      setHomeworks((prev) =>
        prev.filter(
          (homework) =>
            homework.id !== hw.id
        )
      )

      setSubmissions((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(
            ([key]) =>
              !key.startsWith(`${hw.id}_`)
          )
        )
      )
    } catch (err) {
      console.error(
        'Homework deletion failed:',
        err
      )

      setConfirmDialog({
        title: "Couldn't delete this homework",
        message: err?.message || 'Unknown error',
        tone: 'coral',
        hideCancel: true,
      })
    } finally {
      setBusyAction('')
    }
  }

  /* =========================================================
     RESET HOMEWORK
  ========================================================= */

  /*
   * REMIND (2026-10-02) — one tap nudges only the students who haven't
   * completed this homework yet: in-app bell, phone push and Telegram
   * (for students who connected the bot). Replaces chasing people in
   * the Telegram group.
   */
  const remindHomework = (hw) => {
    const notDone = roster.filter(
      (student) => submissions[`${hw.id}_${student.id}`]?.status !== 'done'
    )

    if (!notDone.length) {
      setConfirmDialog({
        title: 'Everyone has done it',
        message: `All students in this group have completed "${hw.title}".`,
        confirmLabel: 'OK',
        tone: 'brass',
        onConfirm: () => {},
      })
      return
    }

    const overdue = hw.due_date && new Date(hw.due_date) < new Date()

    setConfirmDialog({
      title: `Remind ${notDone.length} student${notDone.length === 1 ? '' : 's'}?`,
      message:
        `They haven't completed "${hw.title}" yet:\n` +
        notDone
          .slice(0, 12)
          .map((s) => `• ${s.full_name || s.username}`)
          .join('\n') +
        (notDone.length > 12 ? `\n…and ${notDone.length - 12} more` : ''),
      confirmLabel: 'Send reminder',
      cancelLabel: 'Cancel',
      tone: 'brass',
      onConfirm: async () => {
        setBusyAction(`remind-${hw.id}`)
        const result = await notifyUsers({
          userIds: notDone.map((s) => s.id),
          type: 'homework_reminder',
          title: overdue ? 'Homework overdue' : 'Homework reminder',
          body: overdue
            ? `"${hw.title}" was due — please complete it as soon as possible.`
            : `Don't forget "${hw.title}"${hw.due_date ? ` — due ${new Date(hw.due_date).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.`,
          link: `homework:${hw.id}`,
        })
        setBusyAction('')
        if (!result.ok && result.reason === 'all') {
          setConfirmDialog({
            title: "Reminder wasn't sent",
            message: result.detail || 'Unknown error',
            tone: 'coral',
            confirmLabel: 'OK',
            onConfirm: () => {},
          })
        }
      },
    })
  }

  const clearHomeworkContent = (hw) => {
    setConfirmDialog({
      title: `Reset "${hw.title}" for every student?`,
      message: 'All uploaded screenshots, recordings and files for this homework will be permanently deleted. Students will see "Not yet" and can submit again.',
      confirmLabel: 'Reset Homework',
      cancelLabel: 'Cancel',
      tone: 'brass',
      onConfirm: () => doClearHomeworkContent(hw),
    })
  }

  const doClearHomeworkContent = async (hw) => {
    setBusyAction(`clear-${hw.id}`)

    try {
      const { data: subs, error: subsError } =
        await supabase
          .from('submissions')
          .select(
            'id, student_id, status, submitted_at, screenshot_urls, submission_files, audio_part1_url, audio_part2_url, audio_part3_url'
          )
          .eq('homework_id', hw.id)

      if (subsError) throw subsError

      /*
       * ===================================================
       * PRESERVE COMPLETION HISTORY BEFORE WIPING
       * ===================================================
       *
       * Resetting a homework should let the student redo it,
       * but it must NOT erase the fact that they already
       * completed it once — that record is what the
       * leaderboard and streaks rely on.
       *
       * Every submission that was already "done" gets a
       * homework_completions row (if it doesn't already have
       * one) BEFORE we clear the submission back to pending.
       * ===================================================
       */

      const alreadyDone = (subs || []).filter(
        (sub) =>
          sub.student_id &&
          (sub.status === 'done' || sub.submitted_at)
      )

      if (alreadyDone.length) {
        const {
          data: existingCompletions,
          error: existingCompletionsError,
        } = await supabase
          .from('homework_completions')
          .select('student_id')
          .eq('homework_id', hw.id)

        if (existingCompletionsError) {
          throw existingCompletionsError
        }

        const alreadyRecorded = new Set(
          (existingCompletions || []).map(
            (completion) => completion.student_id
          )
        )

        const missingCompletions = alreadyDone
          .filter(
            (sub) => !alreadyRecorded.has(sub.student_id)
          )
          .map((sub) => ({
            student_id: sub.student_id,
            homework_id: hw.id,
            completed_at:
              sub.submitted_at || new Date().toISOString(),
          }))

        if (missingCompletions.length) {
          const { error: backfillError } = await supabase
            .from('homework_completions')
            .insert(missingCompletions)

          if (backfillError) throw backfillError
        }
      }

      const submissionPaths = []

      for (const sub of subs || []) {
        const urls = [
          ...(sub.screenshot_urls || []),
          ...(sub.submission_files || [])
            .map((file) => file?.url)
            .filter(Boolean),
          sub.audio_part1_url,
          sub.audio_part2_url,
          sub.audio_part3_url,
        ].filter(Boolean)

        for (const url of urls) {
          const path = storagePathFromPublicUrl(
            url,
            'submissions'
          )

          if (path) {
            submissionPaths.push(path)
          }
        }
      }

      const uniqueSubmissionPaths = [
        ...new Set(submissionPaths),
      ]

      // DB reset FIRST, files after (2026-10-06 review) — see
      // doDeleteHomework. A failed reset no longer leaves submissions
      // pointing at files that were already deleted.
      const { error: updateError } =
        await supabase
          .from('submissions')
          .update({
            screenshot_urls: [],
            submission_files: [],
            audio_part1_url: null,
            audio_part2_url: null,
            audio_part3_url: null,
            comment: null,
            status: 'pending',
            submitted_at: null,
            // Writing Mock Test attempts are keyed off started_at —
            // without wiping this too, "Reset" would leave the old
            // clock in place and the student's next click would just
            // resume (and instantly auto-submit) an already-expired,
            // already-graded attempt instead of starting a fresh one.
            mock_essay: null,
          })
          .eq('homework_id', hw.id)

      if (updateError) {
        throw updateError
      }

      if (uniqueSubmissionPaths.length) {
        const { error: storageError } =
          await supabase.storage
            .from('submissions')
            .remove(uniqueSubmissionPaths)

        if (storageError) {
          console.error('Homework reset, but some files could not be removed:', storageError)
        }
      }

      await loadGroupData()
    } catch (err) {
      console.error(
        'Homework reset failed:',
        err
      )

      setConfirmDialog({
        title: "Couldn't reset this homework",
        message: err?.message || 'Unknown error',
        tone: 'coral',
        hideCancel: true,
      })
    } finally {
      setBusyAction('')
    }
  }

  /* =========================================================
     SEARCH
  ========================================================= */

  const filteredRoster = useMemo(() => {
    const query = studentSearch
      .trim()
      .toLowerCase()

    if (!query) return roster

    return roster.filter((student) =>
      [
        student.full_name,
        student.username,
        student.contact_email,
      ]
        .filter(Boolean)
        .some((value) =>
          value.toLowerCase().includes(query)
        )
    )
  }, [roster, studentSearch])

  const activeGroupObj = groups.find(
    (group) => group.id === activeGroup
  )

  /* =========================================================
     UI
  ========================================================= */

  return (
    <div className="space-y-6">

      {/* =====================================================
          GROUPS OVERVIEW — a folder-style grid of every group.
          Opening one is a deliberate click into a full-screen
          detail view (below), not a permanent panel that lives
          next to the group picker.
      ===================================================== */}

      {screen === 'groups' && (
        <div className="space-y-6">


          {groups.length === 0 ? (

            <div className="rounded-[20px] border-2 border-dashed border-line px-6 py-16 text-center">

              <div className="font-display text-2xl text-paper">
                No groups yet
              </div>

              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-mist">
                Create a group to start posting homework and tracking who's done it.
              </p>

              <form
                onSubmit={createGroup}
                className="mx-auto mt-6 flex h-12 max-w-sm overflow-hidden rounded-xl border border-line bg-panel"
              >
                <input
                  value={newGroupName}
                  onChange={(e) =>
                    setNewGroupName(e.target.value)
                  }
                  placeholder="Group name"
                  className="focus-ring w-full bg-transparent px-4 text-sm text-paper placeholder:text-mist/70 outline-none"
                />

                <button
                  type="submit"
                  disabled={creating}
                  className="focus-ring shrink-0 border-l border-accent/20 bg-accent px-5 text-sm font-semibold text-onaccent transition hover:brightness-105 disabled:opacity-50"
                >
                  {creating ? 'Adding…' : 'Create'}
                </button>
              </form>

            </div>

          ) : (

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">

              {groups.map((group) => {
                const accent = getGroupAccent(group.id)
                const counts = groupCounts[group.id] || { students: 0, tasks: 0 }
                const isRenaming = renamingId === group.id

                return (
                  <div
                    key={group.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => !isRenaming && openGroup(group.id)}
                    onKeyDown={(e) => {
                      if (isRenaming) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openGroup(group.id)
                      }
                    }}
                    className="focus-ring group relative flex cursor-pointer flex-col overflow-hidden rounded-[20px] border border-line bg-panel p-5 pt-6 text-left transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-16px_rgba(23,33,58,0.35)]"
                  >
                    {/* Redesign 2026-11-01: group colour as a stripe on top
                        and in the big name, like the cards on Home. */}
                    <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1.5 ${accent.bar}`} />

                    <div className="relative flex items-start justify-between gap-3 pr-[84px]">

                      <div className="min-w-0">
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => saveRename(group.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveRename(group.id)
                              if (e.key === 'Escape') setRenamingId(null)
                            }}
                            className="focus-ring w-full rounded-lg border border-accent bg-panel-2 px-2.5 py-1.5 font-brand text-xl text-paper outline-none"
                          />
                        ) : (
                          <div
                            className={`truncate font-brand font-semibold leading-none ${accent.text} ${
                              /^\d+$/.test((group.name || '').trim()) ? 'text-[40px]' : 'text-[26px] leading-tight'
                            }`}
                          >
                            {(group.name || '').trim() || 'Group'}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-[13px] text-mist">
                          <span>
                            <strong className="font-semibold text-paper">{counts.students}</strong>{' '}
                            {counts.students === 1 ? 'student' : 'students'}
                          </span>
                          <span className="h-1 w-1 rounded-full bg-line" />
                          <span>
                            <strong className="font-semibold text-paper">{counts.tasks}</strong>{' '}
                            {counts.tasks === 1 ? 'assignment' : 'assignments'}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            startRename(group)
                          }}
                          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-xs text-mist opacity-0 transition hover:bg-panel-2 hover:text-accent group-hover:opacity-100 focus-visible:opacity-100"
                          title="Rename group"
                          aria-label="Rename group"
                        >
                          <Icon name="pencil" className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteGroup(group)
                          }}
                          disabled={
                            busyAction === `delete-group-${group.id}`
                          }
                          className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-mist opacity-0 transition hover:bg-coral/10 hover:text-coral group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
                          title="Delete group permanently"
                          aria-label="Delete group permanently"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18" />
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                          </svg>
                        </button>

                      </div>

                    </div>

                    {/* Ring, three numbers, next deadline (redesign 2026-11-02). */}
                    <div className="pointer-events-none absolute right-5 top-6" aria-hidden="true">
                      {(() => {
                        const pct = counts.onTimePct
                        const r = 30
                        const circ = 2 * Math.PI * r
                        return (
                          <svg width="76" height="76" viewBox="0 0 76 76" className={accent.text}>
                            <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="8" />
                            {pct != null && (
                              <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} transform="rotate(-90 38 38)" />
                            )}
                            <text x="38" y="43" textAnchor="middle" className="fill-paper font-brand text-[15px] font-semibold">{pct == null ? '—' : `${pct}%`}</text>
                          </svg>
                        )
                      })()}
                    </div>
                    <span className="sr-only">{counts.onTimePct == null ? 'No homework due yet' : `${counts.onTimePct}% of homework handed in on time`}</span>

                    <div className="relative mt-4 grid grid-cols-3 gap-2">
                      <div className={`rounded-[14px] px-3 py-2.5 ${accent.tint}`}>
                        <div className={`font-brand text-[18px] font-semibold ${accent.text}`}>{formatBand(counts.avgBand)}</div>
                        <div className="text-[12px] font-bold text-paper-dim">avg mock</div>
                      </div>
                      <div className={`rounded-[14px] px-3 py-2.5 ${accent.tint}`}>
                        <div className={`font-brand text-[18px] font-semibold ${counts.missedWeek >= 4 ? 'text-coral' : accent.text}`}>{counts.missedWeek ?? 0}</div>
                        <div className="text-[12px] font-bold text-paper-dim">missed this week</div>
                      </div>
                      <div className={`rounded-[14px] px-3 py-2.5 ${accent.tint}`}>
                        <div className={`font-brand text-[18px] font-semibold ${accent.text}`}>{counts.open ?? 0}</div>
                        <div className="text-[12px] font-bold text-paper-dim">tasks open</div>
                      </div>
                    </div>

                    <div className="relative mt-4 flex flex-col gap-1.5 text-sm">
                      <div className="flex justify-between gap-3">
                        <span className="font-bold text-mist">Next deadline</span>
                        <span className="min-w-0 truncate text-right font-extrabold text-paper">
                          {counts.next ? `${counts.next.title} · ${formatDue(counts.next.due_date)}` : 'Nothing due'}
                        </span>
                      </div>
                      {counts.latest && (
                        <div className="flex justify-between gap-3">
                          <span className="font-bold text-mist">Latest handed in</span>
                          <span className="font-extrabold tabular-nums text-paper">{counts.latestDone}/{counts.students}</span>
                        </div>
                      )}
                    </div>

                    <div className={`relative mt-auto pt-4`}>
                      <span className={`flex h-11 items-center justify-center gap-1.5 rounded-[14px] text-sm font-extrabold text-white ${accent.bar}`}>
                        Open group
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="transition group-hover:translate-x-0.5">
                          <path d="M5 12h14" />
                          <path d="M12 5l7 7-7 7" />
                        </svg>
                      </span>
                    </div>

                  </div>
                )
              })}

              {/* New-group tile — same footprint as a real group card */}
              <form
                onSubmit={createGroup}
                className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[20px] border-2 border-dashed border-line p-6 text-center transition hover:border-accent/40"
              >

                {composingGroup ? (
                  <>
                    <input
                      autoFocus
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setComposingGroup(false)
                          setNewGroupName('')
                        }
                      }}
                      onBlur={() => {
                        if (!newGroupName.trim()) setComposingGroup(false)
                      }}
                      placeholder="Group name"
                      className="focus-ring w-full max-w-[14rem] rounded-lg border border-line bg-panel-2 px-3 py-2 text-center text-sm text-paper placeholder:text-mist/70 outline-none"
                    />

                    <button
                      type="submit"
                      disabled={creating || !newGroupName.trim()}
                      className="focus-ring rounded-xl bg-accent px-4 py-1.5 text-sm font-semibold text-onaccent transition hover:brightness-105 disabled:opacity-50"
                    >
                      {creating ? 'Adding…' : 'Create group'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setComposingGroup(true)}
                    className="focus-ring flex flex-col items-center gap-2 text-mist transition hover:text-accent"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-line text-xl">
                      +
                    </span>
                    <span className="text-sm font-medium">New group</span>
                  </button>
                )}

              </form>

            </div>

          )}

        </div>
      )}

      {/* =====================================================
          GROUP DETAIL — full-screen view for one group, opened
          by clicking its tile above.
      ===================================================== */}

      {screen === 'detail' && activeGroupObj && (
        <>

          <button
            type="button"
            onClick={backToGroups}
            className="focus-ring group inline-flex items-center gap-2 rounded-[12px] border border-line bg-panel py-1.5 pl-1.5 pr-4 text-sm font-semibold text-paper-dim transition hover:border-accent/40 hover:text-accent"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-xl bg-panel-2 text-mist transition group-hover:bg-accent/15 group-hover:text-accent">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </span>
            All groups
          </button>

          {/* =================================================
              HERO
          ================================================= */}

          {(() => {
            const accent = getGroupAccent(activeGroup)

            return (
              <section className="relative overflow-hidden rounded-[20px] border border-line bg-panel px-5 pb-4 pt-5 sm:px-7 sm:pb-5 sm:pt-6">
                <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1.5 ${accent.bar}`} />

                <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

                  <div className="flex min-w-0 items-center gap-3.5">

                    {/^\d+$/.test((activeGroupObj?.name || '').trim()) && (
                      <div className={`shrink-0 font-brand text-[44px] font-semibold leading-none ${accent.text}`}>
                        {activeGroupObj.name.trim()}
                      </div>
                    )}

                    <div className="min-w-0">

                      {renamingId === activeGroup ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => saveRename(activeGroup)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(activeGroup)
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          className="focus-ring rounded-lg border border-accent bg-panel-2 px-2.5 py-1 font-display text-xl text-paper outline-none sm:text-2xl"
                        />
                      ) : /^\d+$/.test((activeGroupObj?.name || '').trim()) ? (
                        // Same numeric name is already shown in full
                        // in the badge to the left — kept as a real
                        // (if visually hidden) heading rather than
                        // dropped outright, so the page still has a
                        // proper title for screen readers.
                        <h1 className="sr-only">
                          {activeGroupObj?.name || 'Group'}
                        </h1>
                      ) : (
                        <h1 className={`truncate font-brand text-[26px] font-semibold tracking-tight sm:text-[30px] ${accent.text}`}>
                          {activeGroupObj?.name || 'Group'}
                        </h1>
                      )}

                      <div className="mt-1 flex items-center gap-2.5 text-sm text-mist">
                        <span>{roster.length} {roster.length === 1 ? 'student' : 'students'}</span>
                        <span className="h-1 w-1 rounded-full bg-line" />
                        <span>{homeworks.length} {homeworks.length === 1 ? 'assignment' : 'assignments'}</span>
                      </div>

                    </div>

                  </div>

                  <div className="flex shrink-0 items-center gap-2">

                    <button
                      type="button"
                      onClick={() => startRename(activeGroupObj)}
                      className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-mist transition hover:bg-panel-2 hover:text-accent"
                      title="Rename group"
                      aria-label="Rename group"
                    >
                      <Icon name="pencil" className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteGroup(activeGroupObj)}
                      disabled={busyAction === `delete-group-${activeGroup}`}
                      className="focus-ring flex h-9 w-9 items-center justify-center rounded-lg text-mist transition hover:bg-coral/10 hover:text-coral disabled:opacity-40"
                      title="Delete group permanently"
                      aria-label="Delete group permanently"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                      </svg>
                    </button>

                    <div className="ml-1">
                      <PostHomeworkForm
                        groupId={activeGroup}
                        teacherId={teacherId}
                        onPosted={(hw) => {
                          setHomeworks((prev) => [
                            hw,
                            ...prev,
                          ])

                          notifyGroup({
    			groupId: activeGroup,
    			type: 'homework_new',
    			title: 'New homework posted',
    			body: hw.title,
    			link: `homework:${hw.id}`,
  		    }).then((result) => {
                            if (result?.ok) return

                            // A push-only failure means students already
                            // got the in-app notification (the part that
                            // actually matters) — the phone/desktop push is
                            // a secondary channel on top of that, and isn't
                            // worth interrupting the teacher for every
                            // single time it doesn't go through. Only a
                            // full failure (nobody told anything) surfaces
                            // a popup.
                            if (result?.reason === 'push') {
                              console.warn(
                                `Push notification failed for "${hw.title}":`,
                                result?.detail
                              )
                              return
                            }

                            setConfirmDialog({
                              title: "Students weren't notified",
                              message:
                                `"${hw.title}" was posted, but students could not be notified in-app either — let them know directly if needed.` +
                                (result?.detail
                                  ? `\n\nDetails: ${result.detail}`
                                  : ''),
                              tone: 'coral',
                              hideCancel: true,
                            })
                          })
                        }}
                      />
                    </div>

                  </div>

                </div>

              </section>
            )
          })()}

          {/* =================================================
              THIS WEEK (redesign 2026-11-02): four numbers, this
              week's homework with hand-in bars, and who needs a word.
          ================================================= */}
          {!groupDataLoading && roster.length > 0 && (() => {
            const accent = getGroupAccent(activeGroup)
            const now = Date.now()
            const DAY = 86400000
            const subOf = (hw, st) => submissions[`${hw.id}_${st.id}`]
            const pastDue = homeworks
              .filter((h) => h.due_date && new Date(h.due_date).getTime() <= now)
              .sort((a, b) => new Date(b.due_date) - new Date(a.due_date))
            const month = pastDue.filter((h) => now - new Date(h.due_date).getTime() <= 28 * DAY)
            let slots = 0
            let onTime = 0
            month.forEach((h) =>
              roster.forEach((st) => {
                slots += 1
                if (getSubmissionStatus(subOf(h, st), h.due_date) === 'done') onTime += 1
              })
            )
            const missedWeek = pastDue
              .filter((h) => now - new Date(h.due_date).getTime() <= 7 * DAY)
              .reduce((n, h) => n + roster.filter((st) => getSubmissionStatus(subOf(h, st), h.due_date) === 'overdue').length, 0)
            const lastFour = pastDue.slice(0, 4)
            const needWord = roster
              .map((st) => {
                const states = lastFour.map((h) => getSubmissionStatus(subOf(h, st), h.due_date))
                let streak = 0
                for (const x of states) {
                  if (x === 'overdue') streak += 1
                  else break
                }
                const missed = states.filter((x) => x === 'overdue').length
                const late = states.filter((x) => x === 'late').length
                const reason = streak >= 2 ? `${streak} missed in a row` : missed >= 2 ? `${missed} of last 4 missed` : late >= 2 ? `Late ${late} times` : null
                return reason ? { st, reason, weight: streak * 10 + missed * 3 + late } : null
              })
              .filter(Boolean)
              .sort((a, b) => b.weight - a.weight)
            const week = homeworks
              .filter((h) => h.due_date && Math.abs(new Date(h.due_date).getTime() - now) <= 7 * DAY)
              .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
            const open = homeworks.filter((h) => h.due_date && new Date(h.due_date).getTime() > now).length
            const pct = slots ? Math.round((onTime / slots) * 100) : null
            return (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className="rounded-[20px] border border-line bg-panel px-5 py-4">
                    <div className={`font-brand text-[28px] font-semibold leading-none ${accent.text}`}>{pct == null ? '—' : `${pct}%`}</div>
                    <div className="mt-1.5 text-[13px] font-bold text-mist">homework on time (4 weeks)</div>
                  </div>
                  <div className="rounded-[20px] border border-line bg-panel px-5 py-4">
                    <div className={`font-brand text-[28px] font-semibold leading-none ${missedWeek ? 'text-coral' : 'text-paper'}`}>{missedWeek}</div>
                    <div className="mt-1.5 text-[13px] font-bold text-mist">missed this week</div>
                  </div>
                  <div className="rounded-[20px] border border-line bg-panel px-5 py-4">
                    <div className={`font-brand text-[28px] font-semibold leading-none ${needWord.length ? 'text-coral' : 'text-paper'}`}>{needWord.length}</div>
                    <div className="mt-1.5 text-[13px] font-bold text-mist">students need a word</div>
                  </div>
                  <div className="rounded-[20px] border border-line bg-panel px-5 py-4">
                    <div className="font-brand text-[28px] font-semibold leading-none text-brass">{open}</div>
                    <div className="mt-1.5 text-[13px] font-bold text-mist">tasks still open</div>
                  </div>
                </div>

                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
                  <section className="rounded-[20px] border border-line bg-panel px-5 py-4 sm:px-6">
                    <h2 className="font-brand text-[18px] font-semibold text-paper">Homework this week</h2>
                    {week.length === 0 ? (
                      <p className="py-4 text-sm text-mist">Nothing due in the last or next 7 days.</p>
                    ) : (
                      <ul className="mt-1">
                        {week.map((h) => {
                          const skill = skillOfHomework(h)
                          const handed = roster.filter((st) => subOf(h, st)?.status === 'done').length
                          const past = new Date(h.due_date).getTime() <= now
                          const missing = roster.length - handed
                          return (
                            <li key={h.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-line py-3 first:border-t-0 sm:grid-cols-[auto_minmax(0,1fr)_170px_auto]">
                              <span className={`grid h-9 w-9 place-items-center rounded-xl ${skill.tint} ${skill.key === 'general' ? 'text-paper' : skill.text}`}>
                                <SkillIcon skill={skill.key} className="h-4 w-4" />
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-[15px] font-extrabold text-paper">{h.title}</div>
                                <div className="text-[13px] font-semibold text-mist">{past ? 'Closed' : 'Due'} {formatDue(h.due_date)}</div>
                              </div>
                              <div className="col-span-2 sm:col-span-1">
                                <div className="h-2 overflow-hidden rounded-md bg-panel-2">
                                  <div className={`h-full rounded-md ${accent.bar}`} style={{ width: `${roster.length ? (handed / roster.length) * 100 : 0}%` }} />
                                </div>
                                <div className="mt-1 text-xs font-bold text-mist">{handed} of {roster.length} handed in</div>
                              </div>
                              <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
                                <span
                                  className={`rounded-lg px-2 py-1 text-xs font-extrabold ${
                                    past ? (missing ? 'bg-urgent-tint text-coral' : 'bg-reading-tint text-reading') : 'bg-panel-2 text-paper-dim'
                                  }`}
                                >
                                  {past ? (missing ? `${missing} missed` : 'All in') : `${missing} to go`}
                                </span>
                                {missing > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => remindHomework(h)}
                                    disabled={busyAction === `remind-${h.id}`}
                                    className="focus-ring h-9 rounded-xl border border-line px-3 text-xs font-extrabold text-brass transition hover:bg-panel-2 disabled:opacity-50"
                                    title="Send a reminder to everyone who hasn't handed it in"
                                  >
                                    {busyAction === `remind-${h.id}` ? 'Sending…' : 'Remind'}
                                  </button>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </section>

                  <section className="overflow-hidden rounded-[20px] border border-line bg-panel">
                    <div className={`px-5 py-4 ${accent.tint}`}>
                      <h2 className={`font-brand text-[18px] font-semibold ${accent.text}`}>Needs a word</h2>
                      <p className="text-[13px] font-semibold text-paper-dim">From the last 4 homeworks.</p>
                    </div>
                    <ul className="flex flex-col gap-2.5 px-5 py-4 text-sm">
                      {needWord.length === 0 ? (
                        <li className="text-mist">Everyone is keeping up.</li>
                      ) : (
                        needWord.slice(0, 6).map(({ st, reason }) => (
                          <li key={st.id} className="flex justify-between gap-3 font-bold">
                            <span className="min-w-0 truncate text-paper">{st.full_name || st.username}</span>
                            <span className={`shrink-0 ${reason.startsWith('Late') ? 'text-amber' : 'text-coral'}`}>{reason}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                </div>
              </>
            )
          })()}

          {/* =================================================
              STUDENT PROGRESS TITLE
          ================================================= */}

          <section
            className={
              groupDataLoading
                ? 'pointer-events-none opacity-40 transition-opacity'
                : 'transition-opacity'
            }
          >

            <div className="flex items-end justify-between gap-4">

              <div>

                <h2 className="mt-2 flex items-center gap-2 font-brand text-[20px] font-semibold text-brass">
                  Student progress
                  {(groupDataLoading || refreshingGroup) && <span className="h-1.5 w-1.5 animate-pulse rounded-xl bg-brass" />}
                </h2>

              </div>

              {groupDataLoading ? (
                <div className="rounded-[12px] border border-line bg-panel px-3.5 py-1.5 text-[13px] text-mist">
                  Loading this group…
                </div>
              ) : (
                <div className="hidden rounded-[12px] border border-line bg-panel px-3.5 py-1.5 text-[13px] text-mist sm:block">
                  {refreshingGroup
                    ? 'Refreshing…'
                    : `${homeworks.length} assignment${
                        homeworks.length === 1 ? '' : 's'
                      }`}
                </div>
              )}

            </div>


            {/* =================================================
                SEARCH
            ================================================= */}

            {roster.length > 0 && (
              <div className="mt-3">

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">

                  <div className="relative min-w-0 flex-1">

                    <input
                      value={studentSearch}
                      onChange={(e) =>
                        setStudentSearch(e.target.value)
                      }
                      placeholder="Search students in this group..."
                      className="focus-ring h-12 w-full rounded-xl border border-line bg-panel-2 px-4 text-sm text-paper placeholder:text-mist/70 outline-none transition focus:border-accent/50"
                    />

                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-3 px-1 sm:justify-end">

                    <span className="font-mono text-xs text-mist">
                      {studentSearch.trim()
                        ? `${filteredRoster.length} of ${roster.length}`
                        : `${roster.length} student${
                            roster.length === 1
                              ? ''
                              : 's'
                          }`}
                    </span>

                    {studentSearch && (
                      <button
                        type="button"
                        onClick={() =>
                          setStudentSearch('')
                        }
                        className="focus-ring text-xs font-medium text-accent hover:underline"
                      >
                        Clear
                      </button>
                    )}

                  </div>

                </div>

              </div>
            )}


            {/* =================================================
                EMPTY STATES
            ================================================= */}

            {roster.length === 0 && (
              <div className="mt-6 rounded-2xl border border-line bg-panel px-6 py-12 text-center">

                <div className="font-display text-2xl text-paper">
                  No students yet
                </div>

                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-mist">
                  Once you approve students under the Approvals tab, they will appear in this group.
                </p>

              </div>
            )}

            {roster.length > 0 &&
              filteredRoster.length === 0 && (
                <div className="mt-6 rounded-2xl border border-line bg-panel px-6 py-12 text-center">

                  <div className="font-display text-xl text-paper">
                    No students found
                  </div>

                  <p className="mt-2 text-sm text-mist">
                    Try a different name, username, or email.
                  </p>

                </div>
              )}

            {homeworks.length === 0 &&
              roster.length > 0 && (
                <div className="mt-6 rounded-2xl border border-line bg-panel px-6 py-12 text-center">

                  <div className="font-display text-2xl text-paper">
                    No homework posted yet
                  </div>

                  <p className="mt-2 text-sm text-mist">
                    Use the button above to post the first assignment.
                  </p>

                </div>
              )}


            {/* =================================================
                PROGRESS TABLE
            ================================================= */}

            {homeworks.length > 0 && filteredRoster.length > 0 && (
              <div className="mt-4 progress-table-shell">

                <div className="progress-table-scroll">

                  <table className="progress-table">

                    <colgroup>
                      <col className="progress-student-col" />

                      {homeworks.map((hw) => (
                        <col
                          key={hw.id}
                          className="progress-homework-col"
                        />
                      ))}
                    </colgroup>

                    <thead>

                      <tr>

                        <th className="progress-student-header">
                          <span>
                            Student
                          </span>
                        </th>

                        {homeworks.map((hw) => (

                          <th
                            key={hw.id}
                            className="progress-homework-header"
                          >

                            <div className="progress-homework-heading">

                              <span
                                className="progress-homework-title"
                                title={hw.title}
                              >
                                {hw.title}
                              </span>

                              <div className="progress-homework-actions">

                                <button
                                  type="button"
                                  onClick={() => remindHomework(hw)}
                                  disabled={busyAction === `remind-${hw.id}`}
                                  className="progress-action"
                                  title="Remind students who haven't done it"
                                  aria-label="Remind students who haven't done it"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                                  </svg>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingHomework(hw)
                                  }
                                  className="progress-action"
                                  title="Edit homework"
                                  aria-label="Edit homework"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                  </svg>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    clearHomeworkContent(hw)
                                  }
                                  disabled={
                                    busyAction ===
                                    `clear-${hw.id}`
                                  }
                                  className="progress-action"
                                  title="Reset submissions"
                                  aria-label="Reset submissions"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                                    <path d="M21 3v5h-5" />
                                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                                    <path d="M3 21v-5h5" />
                                  </svg>
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    deleteHomework(hw)
                                  }
                                  disabled={
                                    busyAction ===
                                    `delete-${hw.id}`
                                  }
                                  className="progress-action progress-action-danger"
                                  title="Delete homework completely"
                                  aria-label="Delete homework completely"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 6h18" />
                                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                    <path d="M10 11v6" />
                                    <path d="M14 11v6" />
                                  </svg>
                                </button>

                              </div>

                            </div>

                            {hw.due_date && (
                              <div
                                className={`progress-due-date ${
                                  new Date(hw.due_date) < new Date()
                                    ? 'progress-due-date-overdue'
                                    : ''
                                }`}
                              >
                                due{' '}
                                {new Date(
                                  hw.due_date
                                ).toLocaleDateString()}
                              </div>
                            )}

                            {/* Hand-in count for this column (2026-10-06). */}
                            {roster.length > 0 && (() => {
                              const handed = roster.filter((st) => {
                                const st2 = getSubmissionStatus(submissions[`${hw.id}_${st.id}`], hw.due_date)
                                return st2 === 'done' || st2 === 'late'
                              }).length
                              const skillKey = skillOfHomework(hw)?.key || 'general'
                              return (
                                <div className={`progress-handin progress-handin-${skillKey}`} title={`${handed} of ${roster.length} handed in`}>
                                  <span className="progress-handin-bar">
                                    <span style={{ width: `${(handed / roster.length) * 100}%` }} />
                                  </span>
                                  <span className="progress-handin-count">
                                    {handed}/{roster.length}
                                  </span>
                                </div>
                              )
                            })()}

                          </th>

                        ))}

                      </tr>

                    </thead>

                    <tbody>

                      {filteredRoster.map((student) => {

                        // Same statuses the row's own cells compute
                        // below, just tallied once so the teacher can
                        // scan this one badge instead of reading every
                        // cell in the row. "late" still counts as
                        // completed — the work came in, just after the
                        // deadline — matching the amber "LATE" pill
                        // rather than treating it like nothing happened.
                        const completedCount = homeworks.filter(
                          (hw) => {
                            const sub =
                              submissions[
                                `${hw.id}_${student.id}`
                              ]

                            const status = getSubmissionStatus(
                              sub,
                              hw.due_date
                            )

                            return (
                              status === 'done' ||
                              status === 'late'
                            )
                          }
                        ).length

                        const allComplete =
                          homeworks.length > 0 &&
                          completedCount === homeworks.length

                        return (

                        <tr
                          key={student.id}
                          className="progress-student-row"
                        >

                          <td className="progress-student-cell">

                            <div className="progress-student">

                              <div className="progress-avatar">
                                {student.full_name
                                  ?.charAt(0)
                                  ?.toUpperCase() || '?'}
                              </div>

                              <div className="progress-student-info">

                                <div className="progress-student-name">
                                  {student.full_name}
                                </div>

                                <div className="progress-student-meta">

                                  <div className="progress-student-username">
                                    @{student.username}
                                  </div>

                                  {homeworks.length > 0 && (
                                    <span
                                      className={`progress-student-summary ${
                                        allComplete
                                          ? 'progress-student-summary-complete'
                                          : ''
                                      }`}
                                      title={`${completedCount} of ${homeworks.length} assignments completed`}
                                    >
                                      {completedCount}/{homeworks.length}
                                    </span>
                                  )}

                                </div>

                              </div>

                              <button
                                type="button"
                                onClick={() =>
                                  removeStudent(student)
                                }
                                disabled={
                                  busyAction ===
                                  `remove-${student.id}`
                                }
                                className="progress-remove"
                                title="Remove student from this group"
                                aria-label="Remove student from this group"
                              >
                                ×
                              </button>

                            </div>

                          </td>

                          {homeworks.map((hw) => {

                            const sub =
                              submissions[
                                `${hw.id}_${student.id}`
                              ]

                            const status =
                              getSubmissionStatus(
                                sub,
                                hw.due_date
                              )

                            // status is 'done' | 'late' | 'pending' | 'overdue'.
                            // Collapsing this to a plain isDone boolean
                            // used to show every not-yet-due homework as
                            // "INCOMPLETE" the instant it was posted —
                            // it should only read that way once the
                            // deadline has actually passed with nothing
                            // submitted. "late" (submitted, but after the
                            // deadline) must be checked before falling
                            // through to "NOT YET" — otherwise a late
                            // submission looks identical to no submission
                            // at all on the teacher's side.
                            //
                            // A Writing Mock Test in the 'pending' bucket
                            // could either mean "hasn't opened it yet" or
                            // "has an attempt running right now" — those
                            // read very differently to a teacher glancing
                            // at this table, so the started-but-not-yet-
                            // submitted case gets its own label. Reuses
                            // the existing pending styling rather than a
                            // new color, since it's informational, not a
                            // new status.
                            const mockInProgress =
                              hw.homework_type === 'writing_mock' &&
                              Boolean(sub?.mock_essay?.started_at) &&
                              status === 'pending'

                            const statusLabel =
                              status === 'done'
                                ? 'Done'
                                : status === 'late'
                                  ? 'Late'
                                  : status === 'overdue'
                                    ? 'Missed'
                                    : mockInProgress
                                      ? 'Writing…'
                                      : 'Not yet'

                            const statusClassName =
                              status === 'done'
                                ? 'progress-status progress-status-done'
                                : status === 'late'
                                  ? 'progress-status progress-status-late'
                                  : status === 'overdue'
                                    ? 'progress-status progress-status-incomplete'
                                    : 'progress-status progress-status-pending'

                            return (

                              <td
                                key={hw.id}
                                className="progress-status-cell"
                              >

                                <button
                                  type="button"
                                  className="progress-status-button"
                                  onClick={() =>
                                    setViewing({
                                      studentName:
                                        student.full_name,
                                      homeworkTitle:
                                        hw.title,
                                      submission: sub,
                                    })
                                  }
                                  aria-label={`${hw.title} — ${statusLabel}`}
                                >

                                  <span
                                    className={statusClassName}
                                  >
                                    {statusLabel}
                                  </span>

                                </button>

                              </td>

                            )
                          })}

                        </tr>

                        )
                      })}

                    </tbody>

                  </table>

                </div>

              </div>
            )}

          </section>

        </>
      )}

      {/* =======================================================
          SUBMISSION PANEL
      ======================================================= */}

      {viewing && (
        <SubmissionPanel
          {...viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {/* =======================================================
          EDIT HOMEWORK
      ======================================================= */}

      {editingHomework && (
        <EditHomeworkModal
          homework={editingHomework}
          onClose={() =>
            setEditingHomework(null)
          }
          onSaved={(updated, options = {}) => {
            setHomeworks((prev) =>
              prev.map((homework) =>
                homework.id === updated.id
                  ? updated
                  : homework
              )
            )

            // Only when the teacher ticked "Notify students about this
            // change" in the edit window (2026-10-02).
            if (!options.notify) return

            notifyGroup({
              groupId: activeGroup,
              type: 'homework_updated',
              title: 'Homework updated',
              body: `"${updated.title}" was changed by your teacher.`,
              link: `homework:${updated.id}`,
            }).then((result) => {
              if (result?.ok) return

              // Same reasoning as the "new homework" notify above —
              // a push-only failure still leaves students notified
              // in-app, so it's logged rather than interrupting the
              // teacher every time.
              if (result?.reason === 'push') {
                console.warn(
                  `Push notification failed for "${updated.title}":`,
                  result?.detail
                )
                return
              }

              setConfirmDialog({
                title: "Students weren't notified",
                message:
                  `"${updated.title}" was updated, but students could not be notified in-app either — let them know directly if needed.` +
                  (result?.detail
                    ? `\n\nDetails: ${result.detail}`
                    : ''),
                tone: 'coral',
                hideCancel: true,
              })
            })
          }}
        />
      )}

      {/* =======================================================
          CONFIRM DIALOG
      ======================================================= */}

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

    </div>
  )
}