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
    <div className="teacher-workspace flex flex-col lg:flex-row gap-5 lg:gap-6">

      <aside className="teacher-groups-panel w-full lg:w-56 flex-shrink-0 flex flex-col gap-3 surface-raised p-4">

        <div className="text-xs uppercase tracking-[0.18em] text-mist font-mono">
          Your groups
        </div>

        <div className="flex flex-col gap-2">

          {groups.map((g) =>
            renamingId === g.id ? (
              <input
                key={g.id}
                autoFocus
                value={renameValue}
                onChange={(e) =>
                  setRenameValue(e.target.value)
                }
                onBlur={() => saveRename(g.id)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && saveRename(g.id)
                }
                className="focus-ring bg-panel-2 border border-brass rounded-lg px-3 py-2 text-sm"
              />
            ) : (
              <div
                key={g.id}
                className={`group flex items-center gap-1 rounded-lg text-sm transition-colors ${
                  activeGroup === g.id
                    ? 'bg-brass text-onbrass font-medium shadow-sm'
                    : 'bg-panel-2 text-mist hover:text-paper hover:border-line'
                }`}
              >

                <button
                  onClick={() => setActiveGroup(g.id)}
                  className="focus-ring flex-1 text-left px-3 py-2.5 truncate"
                >
                  {g.name}
                </button>

                <button
                  onClick={() => startRename(g)}
                  className="focus-ring pr-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Rename group"
                  aria-label="Rename group"
                >
                  ✎
                </button>

              </div>
            )
          )}

        </div>

        <form
          onSubmit={createGroup}
          className="flex flex-col gap-2 mt-2 pt-3 border-t border-line"
        >
          <input
            value={newGroupName}
            onChange={(e) =>
              setNewGroupName(e.target.value)
            }
            placeholder="New group name"
            className="focus-ring w-full min-w-0 bg-panel-2 border border-line rounded-lg px-3 py-2 text-sm"
          />

          <button
            disabled={creating}
            className="focus-ring px-3 py-2 rounded-lg border border-brass text-brass text-sm hover:bg-brass hover:text-onbrass transition-colors"
          >
            {creating ? 'Creating…' : 'Add group'}
          </button>
        </form>

      </aside>

      <section className="teacher-workspace-main flex-1 flex flex-col gap-5 min-w-0">

        {!activeGroup && (
          <div className="surface-raised p-8 text-center">
            <p className="text-mist">
              Create your first group to get started.
            </p>
          </div>
        )}

        {activeGroup && (
          <>

            <div className="teacher-section-header flex items-center justify-between flex-wrap gap-4 surface-raised px-5 py-4 sm:px-6 sm:py-5">

              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-mist font-mono mb-1">
                  Current group
                </div>

                <h2 className="font-display text-2xl sm:text-3xl">
                  {activeGroupObj?.name}
                </h2>
              </div>

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
                  })
                }}
              />

            </div>

            {roster.length === 0 && (
              <div className="surface px-5 py-5">
                <p className="text-mist text-sm leading-6">
                  No approved students in this group yet.
                  Once you approve someone under the
                  Approvals tab, they'll show up here.
                </p>
              </div>
            )}

            {roster.length > 0 && (
              <div className="surface-raised p-4 flex flex-col gap-3">

                <input
                  value={studentSearch}
                  onChange={(e) =>
                    setStudentSearch(e.target.value)
                  }
                  placeholder="Search students in this group..."
                  className="focus-ring w-full bg-panel-2 border border-line rounded-lg px-3 py-2.5 text-sm"
                />

                <div className="flex items-center justify-between gap-2 flex-wrap">

                  <span className="text-mist text-xs font-mono">
                    {studentSearch.trim()
                      ? `Showing ${filteredRoster.length} of ${roster.length} students`
                      : `${roster.length} student${
                          roster.length === 1 ? '' : 's'
                        }`}
                  </span>

                  {studentSearch && (
                    <button
                      type="button"
                      onClick={() => setStudentSearch('')}
                      className="focus-ring text-xs text-brass hover:underline"
                    >
                      Clear search
                    </button>
                  )}

                </div>

              </div>
            )}

            {roster.length > 0 &&
              filteredRoster.length === 0 && (
                <div className="surface px-5 py-5">
                  <p className="text-mist text-sm">
                    No students match your search.
                  </p>
                </div>
              )}

            {homeworks.length === 0 &&
              roster.length > 0 && (
                <div className="surface px-5 py-5">
                  <p className="text-mist text-sm">
                    No homework posted yet.
                  </p>
                </div>
              )}

            {homeworks.length > 0 &&
              filteredRoster.length > 0 && (

                <div className="teacher-homework-table surface-raised overflow-x-auto p-2 sm:p-3">

                  <table className="w-full text-sm border-separate border-spacing-y-2">

                    <thead>

                      <tr className="text-left text-mist text-xs uppercase tracking-[0.12em] font-mono">

                        <th className="pr-4 pb-2 pl-2">
                          Student
                        </th>

                        {homeworks.map((hw) => (

                          <th
                            key={hw.id}
                            className="px-2 pb-2 text-center min-w-[120px]"
                          >

                            <div className="flex items-center justify-center gap-1">

                              <span>
                                {hw.title}
                              </span>

                              <button
                                onClick={() =>
                                  setEditingHomework(hw)
                                }
                                className="focus-ring text-mist hover:text-brass normal-case"
                                title="Edit deadline / settings"
                                aria-label="Edit homework"
                              >
                                ✎
                              </button>

                              <button
                                onClick={() =>
                                  clearHomeworkContent(hw)
                                }
                                disabled={
                                  busyAction ===
                                  `clear-${hw.id}`
                                }
                                className="focus-ring text-mist hover:text-brass normal-case disabled:opacity-40"
                                title="Reset student submissions and delete uploaded files"
                                aria-label="Reset student submissions and delete uploaded files"
                              >
                                ↻
                              </button>

                              <button
                                onClick={() =>
                                  deleteHomework(hw)
                                }
                                disabled={
                                  busyAction ===
                                  `delete-${hw.id}`
                                }
                                className="focus-ring text-mist hover:text-coral normal-case disabled:opacity-40"
                                title="Delete homework completely"
                                aria-label="Delete homework completely"
                              >
                                🗑
                              </button>

                            </div>

                            {hw.due_date && (
                              <div className="text-[10px] font-normal normal-case mt-1 text-mist">
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
                          className="bg-panel-2 transition-colors hover:bg-[color-mix(in_srgb,var(--color-panel-2)_88%,var(--color-brass))]"
                        >

                          <td className="px-3 py-3 rounded-l-lg font-medium whitespace-nowrap">

                            <div className="flex items-center gap-2">

                              <div>

                                {student.full_name}

                                <div className="text-mist text-xs font-mono mt-0.5">
                                  @{student.username}
                                </div>

                              </div>

                              <button
                                onClick={() =>
                                  removeStudent(student)
                                }
                                disabled={
                                  busyAction ===
                                  `remove-${student.id}`
                                }
                                className="focus-ring text-mist hover:text-coral text-xs disabled:opacity-40"
                                title="Remove student from this group"
                                aria-label="Remove student from this group"
                              >
                                ✕
                              </button>

                            </div>

                          </td>

                          {homeworks.map((hw) => {

                            const sub =
                              submissions[
                                `${hw.id}_${student.id}`
                              ]

                            return (
                              <td
                                key={hw.id}
                                className="px-2 py-3 text-center"
                              >

                                <button
                                  className="focus-ring"
                                  onClick={() =>
                                    setViewing({
                                      studentName:
                                        student.full_name,
                                      homeworkTitle:
                                        hw.title,
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
              )}

          </>
        )}

      </section>

      {viewing && (
        <SubmissionPanel
          {...viewing}
          onClose={() => setViewing(null)}
        />
      )}

      {editingHomework && (
        <EditHomeworkModal
          homework={editingHomework}
          onClose={() =>
            setEditingHomework(null)
          }
          onSaved={(updated) => {

            setHomeworks((prev) =>
              prev.map((h) =>
                h.id === updated.id
                  ? updated
                  : h
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