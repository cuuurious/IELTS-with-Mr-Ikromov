import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import ConfirmModal from '../../components/ConfirmModal'
import EmptyState from '../../components/EmptyState'

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

      if (fnError) {
        // The function's own reason ("That username is already taken",
        // "An account with this email address already exists") lives in
        // the response body, not in fnError.message, which is only
        // "Edge Function returned a non-2xx status code" (2026-10-15).
        let reason = ''
        try {
          const body = await fnError.context?.json?.()
          reason = body?.error || ''
        } catch {
          // body wasn't JSON — fall back to the generic message
        }
        throw new Error(reason || fnError.message)
      }
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

      {(() => {
        const TILES = [
          { role: 'teacher', label: 'teachers', cls: 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] text-brass' },
          { role: 'speaking_examiner', label: 'speaking examiners', cls: 'bg-speaking-tint text-speaking' },
          { role: 'writing_examiner', label: 'writing examiners', cls: 'bg-writing-tint text-writing' },
        ]
        return (
          <div className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
            {TILES.map((t) => (
              <div key={t.role} className={`rounded-[20px] px-5 py-4 ${t.cls}`}>
                <div className="font-brand text-[30px] font-semibold leading-none">{otherStaff.filter((m) => m.role === t.role).length}</div>
                <div className="mt-1.5 text-[13px] font-extrabold text-paper-dim">{t.label}</div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                setShowAddForm((v) => !v)
                setCreatedAccount(null)
              }}
              className="focus-ring flex min-h-[64px] items-center justify-center gap-2 rounded-[20px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] transition hover:brightness-105"
            >
              {showAddForm ? 'Close' : '+ Add staff'}
            </button>
          </div>
        )
      })()}

      {showAddForm && (
        <form
          onSubmit={createStaffAccount}
          className="flex flex-col gap-4 rounded-[20px] border border-line bg-panel p-5 sm:p-6"
        >
          <h2 className="font-brand text-[18px] font-semibold text-paper">New staff account</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-extrabold text-paper">Full name</label>
              <input
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                className="focus-ring h-11 rounded-[14px] border border-line bg-panel-2 px-3.5 text-sm font-semibold text-paper"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-extrabold text-paper">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="focus-ring h-11 rounded-[14px] border border-line bg-panel-2 px-3.5 text-sm font-semibold text-paper"
              >
                <option value="speaking_examiner">Speaking examiner</option>
                <option value="writing_examiner">Writing examiner</option>
                <option value="teacher">Teacher</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-extrabold text-paper">Username</label>
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="letters, numbers, dots, underscores"
                className="focus-ring h-11 rounded-[14px] border border-line bg-panel-2 px-3.5 text-sm font-semibold text-paper"
                pattern="[A-Za-z0-9_.]{3,32}"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-extrabold text-paper">Password</label>
              <div className="flex gap-2">
                <input
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="focus-ring h-11 flex-1 rounded-[14px] border border-line bg-panel-2 px-3.5 text-sm font-semibold text-paper"
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={() => setNewPassword(randomPassword())}
                  className="focus-ring h-11 shrink-0 rounded-[14px] border border-line px-3.5 text-xs font-extrabold text-brass hover:bg-panel-2"
                >
                  Generate
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-[13px] font-extrabold text-paper">
                Recovery email (optional)
              </label>
              <input
                type="email"
                value={newContactEmail}
                onChange={(e) => setNewContactEmail(e.target.value)}
                placeholder="only needed if they'll use password reset"
                className="focus-ring h-11 rounded-[14px] border border-line bg-panel-2 px-3.5 text-sm font-semibold text-paper"
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
            className="focus-ring h-11 self-start rounded-[14px] bg-brass px-5 text-sm font-extrabold text-onbrass disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create account'}
          </button>

          <p className="text-[13px] text-mist">Share the username and password with them. They can change it later.</p>
        </form>
      )}

      {createdAccount && (
        <div className="rounded-[20px] bg-reading-tint px-5 py-4">
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
        <EmptyState icon="people" title="No other staff yet" text="Add a teacher or an examiner with the button above." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {otherStaff.map((member) => {
            const meta = ROLE_META[member.role] || { label: member.role, accent: 'brass' }
            const tone =
              member.role === 'speaking_examiner'
                ? { tint: 'bg-speaking-tint text-speaking', bar: 'bg-speaking' }
                : member.role === 'writing_examiner'
                  ? { tint: 'bg-writing-tint text-writing', bar: 'bg-writing' }
                  : { tint: 'bg-[color-mix(in_srgb,var(--color-brass)_14%,var(--color-panel))] text-brass', bar: 'bg-brass' }
            const initials = String(member.full_name || member.username || '?')
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w.charAt(0).toUpperCase())
              .join('')
            return (
              <li key={member.id} className="flex flex-col overflow-hidden rounded-[20px] border border-line bg-panel">
                <div className={`h-1.5 ${tone.bar}`} aria-hidden="true" />
                <div className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex items-center gap-3.5">
                    <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-full font-brand text-lg font-bold ${tone.tint}`}>{initials}</div>
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-[15px] font-extrabold leading-snug text-paper">{member.full_name || member.username}</div>
                      <span className={`mt-1 inline-block rounded-lg px-2 py-0.5 text-xs font-extrabold ${tone.tint}`}>{meta.label}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 text-[13px]">
                    <div className="flex justify-between gap-3"><span className="text-mist">Username</span><span className="truncate font-bold text-paper">@{member.username}</span></div>
                    {member.contact_email && (
                      <div className="flex justify-between gap-3"><span className="text-mist">Email</span><span className="truncate font-bold text-paper">{member.contact_email}</span></div>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busyAction === `delete-${member.id}`}
                    onClick={() => deleteStaffAccount(member)}
                    className="focus-ring mt-auto h-10 rounded-[14px] text-[13px] font-extrabold text-coral transition hover:bg-urgent-tint disabled:opacity-50"
                  >
                    {busyAction === `delete-${member.id}` ? 'Deleting…' : 'Delete account'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
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
