import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import PostHomeworkForm from './PostHomeworkForm'
import SubmissionPanel from './SubmissionPanel'
import EditHomeworkModal from './EditHomeworkModal'
import StampBadge, { getSubmissionStatus } from '../../components/StampBadge'
import { notifyGroup } from '../../lib/notify'

export default function GroupWorkspace({ teacherId }) {
  const [groups, setGroups] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const [roster, setRoster] = useState([])
  const [homeworks, setHomeworks] = useState([])
  const [submissions, setSubmissions] = useState({})
  const [viewing, setViewing] = useState(null)
  const [editingHomework, setEditingHomework] = useState(null)
  const [busyAction, setBusyAction] = useState('')

  const [studentSearch, setStudentSearch] = useState('')

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
      alert(`Couldn't create group: ${error.message}`)
    }
  }

  const startRename = (g) => {
    setRenamingId(g.id)
    setRenameValue(g.name)
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
        prev.map((g) => (g.id === id ? data : g))
      )
    } else {
      alert(`Couldn't rename group: ${error.message}`)
    }

    setRenamingId(null)
  }

  const loadGroupData = async () => {
    if (!activeGroup) return

    const { data: members } = await supabase
      .from('group_members')
      .select(
        'student_id, profiles!inner(id, full_name, username, status, contact_email)'
      )
      .eq('group_id', activeGroup)
      .eq('profiles.status', 'approved')

    setRoster(
      (members || [])
        .map((m) => m.profiles)
        .filter(Boolean)
    )

    const { data: hw } = await supabase
      .from('homeworks')
      .select('*')
      .eq('group_id', activeGroup)
      .order('created_at', { ascending: false })

    setHomeworks(hw || [])

    const { data: subs } = await supabase
      .from('submissions')
      .select('*')
      .eq('group_id', activeGroup)

    const map = {}

    ;(subs || []).forEach((s) => {
      map[`${s.homework_id}_${s.student_id}`] = s
    })

    setSubmissions(map)
  }

  useEffect(() => {
    loadGroupData()
    setStudentSearch('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup])

  /*
   * Remove student ONLY from current group.
   */
  const removeStudent = async (student) => {
    if (
      !window.confirm(
        `Remove ${student.full_name} from this group? Their account, submissions, chat history, and other groups will NOT be deleted.`
      )
    ) {
      return
    }

    setBusyAction(`remove-${student.id}`)

    try {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', activeGroup)
        .eq('student_id', student.id)

      if (error) throw error

      setRoster((prev) =>
        prev.filter((s) => s.id !== student.id)
      )

      setSubmissions((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(
            ([key]) => !key.endsWith(`_${student.id}`)
          )
        )
      )
    } catch (err) {
      alert(
        `Couldn't remove student from this group: ${err.message}`
      )
    } finally {
      setBusyAction('')
    }
  }

  /*
   * Convert a public Supabase Storage URL into the actual
   * Storage object path.
   */
  const storagePathFromPublicUrl = (url, bucket) => {
    if (!url) return null

    const marker = `/storage/v1/object/public/${bucket}/`
    const index = url.indexOf(marker)

    return index >= 0
      ? decodeURIComponent(url.slice(index + marker.length))
      : null
  }

  /*
   * Completely delete homework.
   *
   * This removes:
   * - all student submission files
   * - screenshots
   * - audio
   * - submitted files
   * - homework attachment
   * - homework database row
   */
  const deleteHomework = async (hw) => {
    if (
      !window.confirm(
        `Delete "${hw.title}" completely? This permanently removes the homework, all student submissions, recordings, comments, and uploaded files. This cannot be undone.`
      )
    ) {
      return
    }

    setBusyAction(`delete-${hw.id}`)

    try {
      const { data: subs, error: subsError } = await supabase
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
            .map((f) => f?.url)
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
        const { error: storageError } = await supabase
          .storage
          .from('submissions')
          .remove(uniqueSubmissionPaths)

        if (storageError) throw storageError
      }

      const homeworkPath = storagePathFromPublicUrl(
        hw.attachment_url,
        'homework-files'
      )

      if (homeworkPath) {
        const { error: homeworkStorageError } =
          await supabase
            .storage
            .from('homework-files')
            .remove([homeworkPath])

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
        prev.filter((h) => h.id !== hw.id)
      )

      setSubmissions((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(
            ([key]) => !key.startsWith(`${hw.id}_`)
          )
        )
      )
    } catch (err) {
      console.error('Homework deletion failed:', err)

      alert(
        `Couldn't delete this homework: ${
          err?.message || 'Unknown error'
        }`
      )
    } finally {
      setBusyAction('')
    }
  }

  /*
   * RESET HOMEWORK
   */
  const clearHomeworkContent = async (hw) => {
    if (
      !window.confirm(
        `Reset "${hw.title}" for every student?\n\nAll uploaded screenshots, recordings and files for this homework will be permanently deleted. Students will see "Not yet" and can submit again.`
      )
    ) {
      return
    }

    setBusyAction(`clear-${hw.id}`)

    try {
      const { data: subs, error: subsError } = await supabase
        .from('submissions')
        .select(
          'id, screenshot_urls, submission_files, audio_part1_url, audio_part2_url, audio_part3_url'
        )
        .eq('homework_id', hw.id)

      if (subsError) throw subsError

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
          await supabase
            .storage
            .from('submissions')
            .remove(uniqueSubmissionPaths)

        if (storageError) {
          throw storageError
        }
      }

      const { error: updateError } = await supabase
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

      alert(
        `Couldn't reset this homework: ${
          err?.message || 'Unknown error'
        }`
      )
    } finally {
      setBusyAction('')
    }
  }

  /*
   * Filter current group roster.
   */
  const filteredRoster = useMemo(() => {
    const query = studentSearch.trim().toLowerCase()

    if (!query) {
      return roster
    }

    return roster.filter((student) => {
      return [
        student.full_name,
        student.username,
        student.contact_email,
      ]
        .filter(Boolean)
        .some((value) =>
          value.toLowerCase().includes(query)
        )
    })
  }, [roster, studentSearch])

  const activeGroupObj = groups.find(
    (g) => g.id === activeGroup
  )

  return (
    <div className="space-y-8">

      {!activeGroup && (
        <section className="surface-raised rounded-3xl overflow-hidden">
          <div className="px-6 py-10 sm:px-10 sm:py-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-brass/30 bg-brass/10 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brass" />
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-brass">
                Examiner desk
              </span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight mt-5">
              Groups & homework
            </h1>
            <p className="mt-3 max-w-2xl text-sm sm:text-base text-mist leading-6">
              Manage your groups, post assignments, and review your students' progress.
            </p>
          </div>
        </section>
      )}

      {activeGroup && (
        <>
          <section className="surface-raised rounded-3xl overflow-hidden">
            <div className="px-6 py-8 sm:px-10 sm:py-10">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-brass/30 bg-brass/10 px-3 py-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-brass" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-brass">
                      Examiner desk
                    </span>
                  </div>
                  <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight mt-5">
                    {activeGroupObj?.name || 'Group'}
                  </h1>
                  <p className="mt-3 text-sm sm:text-base text-mist leading-6 max-w-2xl">
                    Manage assignments and monitor your students' submissions.
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-mist font-mono">
                      Students
                    </div>
                    <div className="font-display text-2xl text-paper mt-1">
                      {roster.length}
                    </div>
                  </div>
                  <div className="h-14 min-w-14 rounded-2xl border border-brass/30 bg-brass/10 px-3 flex flex-col items-center justify-center">
                    <span className="text-[9px] uppercase tracking-widest text-mist font-mono">
                      Tasks
                    </span>
                    <span className="font-display text-lg leading-none text-brass mt-0.5">
                      {homeworks.length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-6">

            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono mb-2">
                  Your groups
                </div>

                <div className="flex flex-wrap gap-2">
                  {groups.map((g) =>
                    renamingId === g.id ? (
                      <input
                        key={g.id}
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => saveRename(g.id)}
                        onKeyDown={(e) => e.key === 'Enter' && saveRename(g.id)}
                        className="focus-ring h-10 bg-panel-2 border border-brass rounded-xl px-3 text-sm"
                      />
                    ) : (
                      <div
                        key={g.id}
                        className={`group flex items-center rounded-xl border transition-colors ${
                          activeGroup === g.id
                            ? 'border-brass bg-brass text-onbrass'
                            : 'border-line bg-panel text-mist hover:border-brass/40 hover:text-paper'
                        }`}
                      >
                        <button
                          onClick={() => setActiveGroup(g.id)}
                          className="focus-ring px-4 py-2 text-sm font-medium"
                        >
                          {g.name}
                        </button>
                        <button
                          onClick={() => startRename(g)}
                          className={`focus-ring pr-3 text-xs opacity-60 hover:opacity-100 ${
                            activeGroup === g.id
                              ? 'text-onbrass'
                              : 'text-mist hover:text-brass'
                          }`}
                          title="Rename group"
                          aria-label="Rename group"
                        >
                          ✎
                        </button>
                      </div>
                    )
                  )}

                  <form onSubmit={createGroup} className="flex items-center">
                    <input
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="New group name"
                      className="focus-ring h-10 w-40 sm:w-48 bg-panel-2 border border-line rounded-l-xl px-3 text-sm"
                    />
                    <button
                      disabled={creating}
                      className="focus-ring h-10 px-4 rounded-r-xl border border-brass bg-brass text-onbrass text-sm font-medium hover:bg-brass-dim transition-colors disabled:opacity-50"
                    >
                      {creating ? 'Adding…' : 'Add'}
                    </button>
                  </form>
                </div>
              </div>

              <div className="shrink-0">
                <PostHomeworkForm
                  groupId={activeGroup}
                  teacherId={teacherId}
                  onPosted={(hw) => {
                    setHomeworks((prev) => [hw, ...prev])
                    notifyGroup({
                      groupId: activeGroup,
                      type: 'homework_new',
                      title: 'New homework posted',
                      body: hw.title,
                    })
                  }}
                />
              </div>
            </div>

            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-brass" />
                  Assignments
                </div>
                <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">
                  Student progress
                </h2>
              </div>

              <div className="hidden sm:block rounded-full border border-line bg-panel px-4 py-2 text-xs text-mist font-mono">
                {homeworks.length} assignment{homeworks.length === 1 ? '' : 's'}
              </div>
            </div>

            {roster.length > 0 && (
              <div className="surface rounded-2xl p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="Search students in this group..."
                    className="focus-ring w-full bg-panel-2 border border-line rounded-xl px-4 py-3 text-sm"
                  />

                  <div className="flex items-center justify-between sm:justify-end gap-3">
                    <span className="text-xs text-mist font-mono">
                      {studentSearch.trim()
                        ? `${filteredRoster.length} of ${roster.length}`
                        : `${roster.length} student${roster.length === 1 ? '' : 's'}`}
                    </span>

                    {studentSearch && (
                      <button
                        type="button"
                        onClick={() => setStudentSearch('')}
                        className="focus-ring text-xs text-brass hover:text-brass-dim"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {roster.length === 0 && (
              <div className="surface-raised rounded-2xl px-6 py-10 text-center">
                <div className="font-display text-2xl text-paper">
                  No students yet
                </div>
                <p className="text-mist text-sm leading-6 mt-2 max-w-md mx-auto">
                  Once you approve students under the Approvals tab, they will appear in this group.
                </p>
              </div>
            )}

            {roster.length > 0 && filteredRoster.length === 0 && (
              <div className="surface rounded-2xl px-6 py-10 text-center">
                <div className="font-display text-xl text-paper">
                  No students found
                </div>
                <p className="text-mist text-sm mt-2">
                  Try a different name, username, or email.
                </p>
              </div>
            )}

            {homeworks.length === 0 && roster.length > 0 && (
              <div className="surface-raised rounded-2xl px-6 py-10 text-center">
                <div className="font-display text-2xl text-paper">
                  No homework posted yet
                </div>
                <p className="text-mist text-sm mt-2">
                  Use the button above to post the first assignment.
                </p>
              </div>
            )}

            {homeworks.length > 0 && filteredRoster.length > 0 && (
              <div className="surface-raised rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-separate border-spacing-0">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="sticky left-0 z-10 bg-panel px-4 py-4 text-left min-w-[220px]">
                          <span className="text-[10px] uppercase tracking-[0.16em] text-mist font-mono">
                            Student
                          </span>
                        </th>

                        {homeworks.map((hw) => (
                          <th
                            key={hw.id}
                            className="px-4 py-4 text-center min-w-[150px]"
                          >
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-mist max-w-[105px]">
                                {hw.title}
                              </span>

                              <button
                                onClick={() => setEditingHomework(hw)}
                                className="focus-ring text-mist hover:text-brass"
                                title="Edit homework"
                                aria-label="Edit homework"
                              >
                                ✎
                              </button>

                              <button
                                onClick={() => clearHomeworkContent(hw)}
                                disabled={busyAction === `clear-${hw.id}`}
                                className="focus-ring text-mist hover:text-brass disabled:opacity-40"
                                title="Reset submissions"
                                aria-label="Reset submissions"
                              >
                                ↻
                              </button>

                              <button
                                onClick={() => deleteHomework(hw)}
                                disabled={busyAction === `delete-${hw.id}`}
                                className="focus-ring text-mist hover:text-coral disabled:opacity-40"
                                title="Delete homework completely"
                                aria-label="Delete homework completely"
                              >
                                🗑
                              </button>
                            </div>

                            {hw.due_date && (
                              <div className="text-[10px] font-normal mt-1 text-mist">
                                due {new Date(hw.due_date).toLocaleDateString()}
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
                          className="border-t border-line/70 hover:bg-[color-mix(in_srgb,var(--color-panel-2)_55%,transparent)] transition-colors"
                        >
                          <td className="sticky left-0 z-10 bg-panel px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="avatar h-10 w-10 text-sm">
                                {student.full_name?.charAt(0)?.toUpperCase() || '?'}
                              </div>

                              <div className="min-w-0">
                                <div className="font-medium text-paper truncate max-w-[170px]">
                                  {student.full_name}
                                </div>
                                <div className="text-xs text-mist font-mono mt-0.5 truncate max-w-[170px]">
                                  @{student.username}
                                </div>
                              </div>

                              <button
                                onClick={() => removeStudent(student)}
                                disabled={busyAction === `remove-${student.id}`}
                                className="focus-ring ml-auto text-mist hover:text-coral text-xs disabled:opacity-40"
                                title="Remove student from this group"
                                aria-label="Remove student from this group"
                              >
                                ✕
                              </button>
                            </div>
                          </td>

                          {homeworks.map((hw) => {
                            const sub = submissions[`${hw.id}_${student.id}`]

                            return (
                              <td
                                key={hw.id}
                                className="px-4 py-4 text-center"
                              >
                                <button
                                  className="focus-ring inline-flex"
                                  onClick={() =>
                                    setViewing({
                                      studentName: student.full_name,
                                      homeworkTitle: hw.title,
                                      submission: sub,
                                    })
                                  }
                                >
                                  <StampBadge
                                    status={getSubmissionStatus(
                                      sub,
                                      hw.due_date
                                    )}
                                  />
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

      {viewing && (
        <SubmissionPanel
          {...viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {editingHomework && (
        <EditHomeworkModal
          homework={editingHomework}
          onClose={() => setEditingHomework(null)}
          onSaved={(updated) => {
            setHomeworks((prev) =>
              prev.map((h) =>
                h.id === updated.id ? updated : h
              )
            )

            notifyGroup({
              groupId: activeGroup,
              type: 'homework_updated',
              title: 'Homework updated',
              body: `"${updated.title}" was changed by your teacher.`,
            })
          }}
        />
      )}
    </div>
  )
}
