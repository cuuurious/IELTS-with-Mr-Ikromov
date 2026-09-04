import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import PostHomeworkForm from './PostHomeworkForm'
import SubmissionPanel from './SubmissionPanel'
import EditHomeworkModal from './EditHomeworkModal'
import ConfirmModal from '../../components/ConfirmModal'
import { getSubmissionStatus } from '../../components/StampBadge'
import { notifyGroup } from '../../lib/notify'

export default function GroupWorkspace({ teacherId }) {
  const [groups, setGroups] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)

  // Keeps the latest activeGroup readable from inside async callbacks
  // without them closing over a stale value. Used so a slow-loading
  // fetch for a group the teacher has since clicked away from can't
  // overwrite a faster, newer fetch's results.
  const activeGroupRef = useRef(activeGroup)
  activeGroupRef.current = activeGroup

  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)

  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const [roster, setRoster] = useState([])
  const [homeworks, setHomeworks] = useState([])
  const [submissions, setSubmissions] = useState({})
  const [groupDataLoading, setGroupDataLoading] = useState(false)

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

    if (!activeGroup && data?.length) {
      setActiveGroup(data[0].id)
    }
  }

  useEffect(() => {
    loadGroups()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      setGroups((prev) => [...prev, data])
      setActiveGroup(data.id)
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

      if (activeGroup === group.id) {
        const nextActive = remaining.length
          ? remaining[0].id
          : null

        setActiveGroup(nextActive)

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

  const loadGroupData = async () => {
    // Snapshot which group this call was made for. If the teacher
    // switches groups again before these requests come back (Group A
    // then immediately Group B), Group A's slower response would
    // otherwise land second and silently overwrite Group B's roster —
    // the requestedGroup check below discards it instead.
    const requestedGroup = activeGroup

    if (!requestedGroup) return

    // Was previously three round trips run one after another (each
    // waiting on the last), which is exactly why switching groups
    // felt slow and, worse, left the PREVIOUS group's roster and
    // homework sitting on screen — unchanged and with nothing telling
    // you it was stale — for the entire time all three were loading.
    // Running them together roughly triples the speed, and
    // groupDataLoading (set below, cleared once real data lands) is
    // what tells the table to visibly dim instead of quietly lying.
    setGroupDataLoading(true)

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
      supabase
        .from('submissions')
        .select('*')
        .eq('group_id', requestedGroup),
    ])

    // A newer request has since started (or completed) for a
    // different group — this response is stale, so drop it instead
    // of committing it to state. Leave groupDataLoading alone here:
    // whichever request actually matches the current group is the one
    // that gets to turn loading back off, below.
    if (requestedGroup !== activeGroupRef.current) return

    setRoster(
      (members || [])
        .map((member) => member.profiles)
        .filter(Boolean)
    )

    setHomeworks(hw || [])

    const map = {}

    ;(subs || []).forEach((submission) => {
      map[
        `${submission.homework_id}_${submission.student_id}`
      ] = submission
    })

    setSubmissions(map)
    setGroupDataLoading(false)
  }

  useEffect(() => {
    loadGroupData()
    setStudentSearch('')

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup])

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
    if (!activeGroup) return

    const channel = supabase
      .channel(`teacher-submissions-${activeGroup}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'submissions',
          filter: `group_id=eq.${activeGroup}`,
        },
        (payload) => {
          const submission = payload.new
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
  }, [activeGroup])

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

      if (uniqueSubmissionPaths.length) {
        const { error: storageError } =
          await supabase.storage
            .from('submissions')
            .remove(uniqueSubmissionPaths)

        if (storageError) throw storageError
      }

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

      if (homeworkFilePaths.length) {
        const { error: homeworkStorageError } =
          await supabase.storage
            .from('homework-files')
            .remove(homeworkFilePaths)

        if (homeworkStorageError) {
          throw homeworkStorageError
        }
      }

      const { error } = await supabase
        .from('homeworks')
        .delete()
        .eq('id', hw.id)

      if (error) throw error

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

      if (uniqueSubmissionPaths.length) {
        const { error: storageError } =
          await supabase.storage
            .from('submissions')
            .remove(uniqueSubmissionPaths)

        if (storageError) {
          throw storageError
        }
      }

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
    <div className="space-y-5">

      {/* =====================================================
          EMPTY STATE
      ===================================================== */}

      {!activeGroup && (
        <section className="relative overflow-hidden rounded-[28px] border border-line bg-panel">
          <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
          <div className="absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-cyan-300/10 blur-3xl" />

          <div className="relative px-7 py-12 sm:px-12 sm:py-14">

            <div className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />

              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                Examiner desk
              </span>
            </div>

            <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight text-paper sm:text-5xl">
              Groups & homework
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-mist sm:text-base">
              Manage your groups, post assignments, and review your students' progress.
            </p>

          </div>
        </section>
      )}

      {activeGroup && (
        <>

          {/* =================================================
              HERO
          ================================================= */}

          <section className="relative overflow-hidden rounded-2xl border border-line bg-panel">

            <div className="absolute -right-10 -top-14 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
            <div className="absolute -bottom-14 left-1/3 h-32 w-32 rounded-full bg-cyan-300/10 blur-3xl" />

            <div className="relative px-5 py-4 sm:px-7 sm:py-5">

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

                <div className="flex min-w-0 items-center gap-3">

                  <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1">

                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />

                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                      Examiner desk
                    </span>

                  </div>

                  <h1 className="truncate font-display text-xl font-semibold tracking-tight text-paper sm:text-2xl">
                    {activeGroupObj?.name || 'Group'}
                  </h1>

                </div>

                <div className="flex shrink-0 items-center gap-4">

                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-mist">
                      Students
                    </div>

                    <div className="mt-0.5 font-display text-lg text-paper">
                      {roster.length}
                    </div>
                  </div>

                  <div className="h-10 min-w-12 rounded-xl border border-accent/25 bg-accent/10 px-3 flex flex-col items-center justify-center">

                    <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-mist">
                      Tasks
                    </span>

                    <span className="font-display text-sm leading-none text-accent">
                      {homeworks.length}
                    </span>

                  </div>

                </div>

              </div>

            </div>
          </section>


          {/* =================================================
              GROUP CONTROLS
          ================================================= */}

          <section>

            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
              Your groups
            </div>

            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">

              <div className="flex min-w-0 flex-wrap items-center gap-2">

                {groups.map((group) =>
                  renamingId === group.id ? (
                    <input
                      key={group.id}
                      autoFocus
                      value={renameValue}
                      onChange={(e) =>
                        setRenameValue(e.target.value)
                      }
                      onBlur={() =>
                        saveRename(group.id)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          saveRename(group.id)
                        }

                        if (e.key === 'Escape') {
                          setRenamingId(null)
                        }
                      }}
                      className="focus-ring h-11 w-40 rounded-xl border border-accent bg-panel px-3 text-sm text-paper outline-none"
                    />
                  ) : (
                    <div
                      key={group.id}
                      className={`flex h-11 items-center overflow-hidden rounded-xl border transition-all ${
                        activeGroup === group.id
                          ? 'border-accent bg-accent text-onaccent shadow-lg shadow-accent/15'
                          : 'border-line bg-panel text-mist hover:border-accent/35 hover:text-paper'
                      }`}
                    >

                      <button
                        type="button"
                        onClick={() =>
                          setActiveGroup(group.id)
                        }
                        className="focus-ring h-full px-4 text-sm font-medium"
                      >
                        {group.name}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          startRename(group)
                        }
                        className={`focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-xs transition ${
                          activeGroup === group.id
                            ? 'text-onaccent/70 hover:bg-white/10 hover:text-onaccent'
                            : 'text-mist hover:bg-panel-2 hover:text-accent'
                        }`}
                        title="Rename group"
                        aria-label="Rename group"
                      >
                        ✎
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          deleteGroup(group)
                        }
                        disabled={
                          busyAction ===
                          `delete-group-${group.id}`
                        }
                        className={`focus-ring mr-2 flex h-7 w-7 items-center justify-center rounded-lg transition disabled:opacity-40 ${
                          activeGroup === group.id
                            ? 'text-onaccent/70 hover:bg-white/10 hover:text-onaccent'
                            : 'text-mist hover:bg-coral/10 hover:text-coral'
                        }`}
                        title="Delete group permanently"
                        aria-label="Delete group permanently"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                        </svg>
                      </button>

                    </div>
                  )
                )}

                <form
                  onSubmit={createGroup}
                  className="flex h-11 overflow-hidden rounded-xl border border-line bg-panel"
                >

                  <input
                    value={newGroupName}
                    onChange={(e) =>
                      setNewGroupName(e.target.value)
                    }
                    placeholder="New group name"
                    className="focus-ring w-36 bg-transparent px-3 text-sm text-paper placeholder:text-mist/70 outline-none sm:w-44"
                  />

                  <button
                    type="submit"
                    disabled={creating}
                    className="focus-ring border-l border-accent/20 bg-accent px-5 text-sm font-semibold text-onaccent transition hover:brightness-105 disabled:opacity-50"
                  >
                    {creating ? 'Adding…' : 'Add'}
                  </button>

                </form>

              </div>

              <div className="shrink-0">
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

                      setConfirmDialog({
                        title:
                          result?.reason === 'push'
                            ? 'Push notification failed'
                            : "Students weren't notified",
                        message:
                          result?.reason === 'push'
                            ? `"${hw.title}" was posted and students were notified in-app, but phone/desktop push notifications failed to send.`
                            : `"${hw.title}" was posted, but students could not be notified in-app either — let them know directly if needed.` +
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

          </section>


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

                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                  <span
                    className={`h-1.5 w-1.5 rounded-full bg-accent ${
                      groupDataLoading ? 'animate-pulse' : ''
                    }`}
                  />
                  Assignments
                </div>

                <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-paper sm:text-3xl">
                  Student progress
                </h2>

              </div>

              {groupDataLoading ? (
                <div className="rounded-full border border-line bg-panel px-4 py-2 font-mono text-xs text-mist">
                  Loading this group…
                </div>
              ) : (
                <div className="hidden rounded-full border border-line bg-panel px-4 py-2 font-mono text-xs text-mist sm:block">
                  {homeworks.length} assignment
                  {homeworks.length === 1 ? '' : 's'}
                </div>
              )}

            </div>


            {/* =================================================
                SEARCH
            ================================================= */}

            {roster.length > 0 && (
              <div className="mt-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">

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
                              <div className="progress-due-date">
                                due{' '}
                                {new Date(
                                  hw.due_date
                                ).toLocaleDateString()}
                              </div>
                            )}

                          </th>

                        ))}

                      </tr>

                    </thead>

                    <tbody>

                      {filteredRoster.map((student) => (

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

                                <div className="progress-student-username">
                                  @{student.username}
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
                                ? 'DONE'
                                : status === 'late'
                                  ? 'LATE'
                                  : status === 'overdue'
                                    ? 'INCOMPLETE'
                                    : mockInProgress
                                      ? 'WRITING…'
                                      : 'NOT YET'

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

                      ))}

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
          onSaved={(updated) => {
            setHomeworks((prev) =>
              prev.map((homework) =>
                homework.id === updated.id
                  ? updated
                  : homework
              )
            )

            notifyGroup({
              groupId: activeGroup,
              type: 'homework_updated',
              title: 'Homework updated',
              body: `"${updated.title}" was changed by your teacher.`,
              link: `homework:${updated.id}`,
            }).then((result) => {
              if (result?.ok) return

              setConfirmDialog({
                title:
                  result?.reason === 'push'
                    ? 'Push notification failed'
                    : "Students weren't notified",
                message:
                  result?.reason === 'push'
                    ? `"${updated.title}" was updated and students were notified in-app, but phone/desktop push notifications failed to send.`
                    : `"${updated.title}" was updated, but students could not be notified in-app either — let them know directly if needed.` +
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