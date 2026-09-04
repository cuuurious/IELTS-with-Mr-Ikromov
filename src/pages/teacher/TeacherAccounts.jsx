import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import ConfirmModal from '../../components/ConfirmModal'

// Admin-only tab (see TeacherDashboard.jsx — only rendered when
// profile.is_admin is true). Lets Jasur Ikromov's account see every
// OTHER teacher account on the site and permanently delete one, which
// no ordinary teacher account can do. Registration itself no longer
// offers a teacher option at all (see Register.jsx) — this is for
// cleaning up any teacher account that already exists, such as one
// created before that change, or directly in Supabase.
export default function TeacherAccounts({ currentTeacherId }) {
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [confirmDialog, setConfirmDialog] = useState(null)

  const loadTeachers = async () => {
    setLoading(true)
    setError('')

    const { data, error: fetchError } = await supabase
      .from('profiles')
      .select(
        'id, full_name, username, contact_email, status, is_admin, created_at'
      )
      .eq('role', 'teacher')
      .order('created_at', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setTeachers(data || [])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadTeachers()
  }, [])

  const otherTeachers = teachers.filter(
    (t) => t.id !== currentTeacherId
  )

  /*
   * Permanently deletes another teacher's account. The edge function
   * itself re-checks that the caller is the admin and that this
   * teacher doesn't still own any groups, word lists, or homeworks —
   * this confirm dialog is just the first line of defense.
   */
  const deleteTeacherAccount = (teacher) => {
    setConfirmDialog({
      title: `Delete ${teacher.full_name || teacher.username}'s account permanently?`,
      message: `This PERMANENTLY deletes this teacher's account. This cannot be undone. (If they still own any groups, word lists, or homeworks, this will be refused until those are deleted or reassigned first.)`,
      confirmLabel: 'Delete Account',
      cancelLabel: 'Cancel',
      tone: 'coral',
      requireTypedText: 'DELETE',
      onConfirm: () => doDeleteTeacherAccount(teacher),
    })
  }

  const doDeleteTeacherAccount = async (teacher) => {
    setBusyAction(`delete-${teacher.id}`)
    setError('')

    try {
      const { data, error: fnError } =
        await supabase.functions.invoke(
          'delete-teacher',
          {
            body: { teacherId: teacher.id },
          }
        )

      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)

      setTeachers((prev) =>
        prev.filter((t) => t.id !== teacher.id)
      )
    } catch (err) {
      setError(
        `Couldn't delete this account: ${err.message}`
      )
    } finally {
      setBusyAction('')
    }
  }

  if (loading) {
    return (
      <p className="text-mist">
        Loading teacher accounts…
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5">

      <div>
        <h2 className="font-display text-xl text-paper">
          Teacher accounts
        </h2>

        <p className="text-mist text-sm mt-1">
          Only your account can see this tab. Jasur Ikromov is the only
          teacher this site is meant to have — use this to remove any
          other teacher account.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-coral bg-panel-2 px-4 py-3 text-sm text-coral">
          {error}
        </div>
      )}

      {otherTeachers.length === 0 ? (
        <div className="ticket rounded-lg p-4">
          <p className="text-mist text-sm">
            There are no other teacher accounts right now.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {otherTeachers.map((teacher) => (
            <div
              key={teacher.id}
              className="ticket rounded-lg p-4 flex items-center justify-between gap-3 flex-wrap"
            >
              <div>
                <div className="text-paper font-medium">
                  {teacher.full_name || teacher.username}
                </div>

                <div className="text-mist text-xs mt-0.5 font-mono">
                  @{teacher.username}
                  {teacher.contact_email
                    ? ` · ${teacher.contact_email}`
                    : ''}
                  {' · '}
                  {teacher.status}
                </div>
              </div>

              <button
                type="button"
                disabled={busyAction === `delete-${teacher.id}`}
                onClick={() => deleteTeacherAccount(teacher)}
                className="focus-ring px-3 py-2 rounded-md text-sm bg-panel-2 text-coral hover:bg-coral hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busyAction === `delete-${teacher.id}`
                  ? 'Deleting…'
                  : 'Delete account'}
              </button>
            </div>
          ))}
        </div>
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

    </div>
  )
}
