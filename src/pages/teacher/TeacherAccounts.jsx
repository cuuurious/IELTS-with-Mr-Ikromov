import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import ConfirmModal from '../../components/ConfirmModal'

// Admin-only tab (see TeacherDashboard.jsx — only rendered when
// profile.is_admin is true). Lets Jasur Ikromov's account see every
// OTHER staff account on the site — teachers, and now Speaking/
// Writing examiners too — create new ones, and permanently delete
// one. No ordinary staff account can do any of this.
//
// Widened 2026-09-24 from "teacher accounts only" to "staff accounts"
// (teacher + speaking_examiner + writing_examiner) now that examiner
// roles exist. There was previously no in-app way to create a staff
// account at all — Register.jsx only ever creates students, and the
// one existing teacher account was created by hand in Supabase. The
// "+ Add staff account" form below is the first UI path for any of
// this, going through the new create-staff-account Edge Function
// (admin-gated server-side, independent of this screen being hidden
// in the UI).

const ROLE_META = {
  teacher: { label: 'Teacher', accent: 'brass' },
  speaking_examiner: { label: 'Speaking examiner', accent: 'cyan' },
  writing_examiner: { label: 'Writing examiner', accent: 'lavender' },
}

const ROLE_BADGE_CLASSES = {
  brass: 'border-brass/40 bg-brass/10 text-brass',
  cyan: 'border-cyan/40 bg-cyan/10 text-cyan',
  lavender: 'border-lavender/40 bg-lavender/10 text-lavender',
}

function randomPassword() {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/[+/=]/g, '')
    .slice(0, 10)
}

export default function TeacherAccounts({ currentTeacherId }) {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [confirmDialog, setConfirmDialog] = useState(null)

  const [showAddForm, setShowAddForm] = useState(false)
  const [newFullName, setNewFullName] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('speaking_examiner')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createdAccount, setCreatedAccount] = useState(null)

  const loadStaff = async () => {
    setLoading(true)
    setError('')

    const { data, error: fetchError } = await supabase
      .from('profiles')
      .select(
        'id, full_name, username, contact_email, status, is_admin, role, created_at'
      )
      .in('role', ['teacher', 'speaking_examiner', 'writing_examiner'])
      .order('role', { ascending: true })
      .order('created_at', { ascending: true })

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setStaff(data || [])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadStaff()
  }, [])

  const otherStaff = staff.filter((s) => s.id !== currentTeacherId)

  const resetAddForm = () => {
    setNewFullName('')
    setNewUsername('')
    setNewPassword('')
    setNewRole('speaking_examiner')
    setNewContactEmail('')
    setCreateError('')
  }

  const createStaffAccount = async (e) => {
    e.preventDefault()

    setCreating(true)
    setCreateError('')
    setCreatedAccount(null)

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'create-staff-account',
        {
          body: {
            fullName: newFullName.trim(),
            username: newUsername.trim().toLowerCase(),
            password: newPassword,
            role: newRole,
            contactEmail: newContactEmail.trim() || undefined,
          },
        }
      )

      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)

      setCreatedAccount({
        username: data.username,
        password: newPassword,
        role: newRole,
      })

      resetAddForm()
      await loadStaff()
    } catch (err) {
      setCreateError(err.message || 'Could not create this account.')
    } finally {
      setCreating(false)
    }
  }

  /*
   * Permanently deletes another staff account. The edge function
   * itself re-checks the caller is the admin, and re-checks
   * role-specific ownership (groups/wordlists/homeworks for a
   * teacher, scheduled speaking slots for a speaking examiner) —
   * this confirm dialog is just the first line of defense.
   */
  const deleteStaffAccount = (member) => {
    const roleLabel = ROLE_META[member.role]?.label || member.role

    setConfirmDialog({
      title: `Delete ${member.full_name || member.username}'s account permanently?`,
      message: `This PERMANENTLY deletes this ${roleLabel.toLowerCase()} account. This cannot be undone.`,
      confirmLabel: 'Delete Account',
      cancelLabel: 'Cancel',
      tone: 'coral',
      requireTypedText: 'DELETE',
      onConfirm: () => doDeleteStaffAccount(member),
    })
  }

  const doDeleteStaffAccount = async (member) => {
    setBusyAction(`delete-${member.id}`)
    setError('')

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'delete-staff-account',
        { body: { staffId: member.id } }
      )

      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)

      setStaff((prev) => prev.filter((s) => s.id !== member.id))
    } catch (err) {
      setError(`Couldn't delete this account: ${err.message}`)
    } finally {
      setBusyAction('')
    }
  }

  if (loading) {
    return <p className="text-mist">Loading staff accounts…</p>
  }

  return (
    <div className="flex flex-col gap-5">

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-mist text-sm mt-1 max-w-xl">
            Only your account can see this tab. Teachers, Speaking
            examiners, and Writing examiners are all created and
            removed here.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowAddForm((v) => !v)
            setCreatedAccount(null)
          }}
          className="focus-ring shrink-0 rounded-md bg-brass px-4 py-2 text-sm font-medium text-onbrass transition hover:bg-brass-dim active:scale-95"
        >
          {showAddForm ? 'Close' : '+ Add staff account'}
        </button>
      </div>

      {showAddForm && (
        <form
          onSubmit={createStaffAccount}
          className="ticket rounded-lg p-5 flex flex-col gap-3"
        >
          <div className="text-xs uppercase tracking-wide text-mist font-mono">
            New staff account
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-mist">Full name</label>
              <input
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-mist">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
              >
                <option value="speaking_examiner">Speaking examiner</option>
                <option value="writing_examiner">Writing examiner</option>
                <option value="teacher">Teacher</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-mist">Username</label>
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="letters, numbers, dots, underscores"
                className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
                pattern="[A-Za-z0-9_.]{3,32}"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-mist">Password</label>
              <div className="flex gap-2">
                <input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="focus-ring flex-1 bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={() => setNewPassword(randomPassword())}
                  className="focus-ring shrink-0 rounded-md border border-line px-2.5 py-2 text-xs text-mist hover:border-brass hover:text-brass"
                >
                  Generate
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs text-mist">
                Recovery email (optional)
              </label>
              <input
                type="email"
                value={newContactEmail}
                onChange={(e) => setNewContactEmail(e.target.value)}
                placeholder="only needed if they'll use password reset"
                className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          {createError && (
            <div className="rounded-md border border-coral/40 bg-coral/10 px-3 py-2">
              <p className="text-coral text-sm">{createError}</p>
            </div>
          )}

          <button
            disabled={creating}
            className="focus-ring self-start rounded-md bg-brass px-4 py-2 text-sm font-medium text-onbrass disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create account'}
          </button>

          <p className="text-mist text-xs">
            There's no email confirmation step — share the username and
            password with them directly. They can change the password
            themselves in Account Settings once they log in.
          </p>
        </form>
      )}

      {createdAccount && (
        <div className="rounded-lg border border-sage/40 bg-sage/10 px-4 py-3">
          <p className="text-sage text-sm font-medium">
            {ROLE_META[createdAccount.role]?.label} account created —
            share these credentials with them:
          </p>
          <p className="text-paper text-sm font-mono mt-1.5">
            username: {createdAccount.username}
          </p>
          <p className="text-paper text-sm font-mono">
            password: {createdAccount.password}
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-coral bg-panel-2 px-4 py-3 text-sm text-coral">
          {error}
        </div>
      )}

      {otherStaff.length === 0 ? (
        <div className="ticket rounded-lg p-4">
          <p className="text-mist text-sm">
            There are no other staff accounts right now.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {otherStaff.map((member) => {
            const meta = ROLE_META[member.role] || {
              label: member.role,
              accent: 'brass',
            }

            return (
              <div
                key={member.id}
                className="ticket rounded-lg p-4 flex items-center justify-between gap-3 flex-wrap"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-paper font-medium">
                      {member.full_name || member.username}
                    </span>

                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${ROLE_BADGE_CLASSES[meta.accent]}`}
                    >
                      {meta.label}
                    </span>
                  </div>

                  <div className="text-mist text-xs mt-0.5 font-mono">
                    @{member.username}
                    {member.contact_email ? ` · ${member.contact_email}` : ''}
                    {' · '}
                    {member.status}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busyAction === `delete-${member.id}`}
                  onClick={() => deleteStaffAccount(member)}
                  className="focus-ring px-3 py-2 rounded-md text-sm bg-panel-2 text-coral hover:bg-coral hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busyAction === `delete-${member.id}`
                    ? 'Deleting…'
                    : 'Delete account'}
                </button>
              </div>
            )
          })}
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
