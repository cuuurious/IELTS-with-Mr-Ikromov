import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase, usernameToEmail } from '../lib/supabaseClient'
import { pushSupported, getPushStatus, enablePush, disablePush } from '../lib/push'

export default function AccountSettingsModal({ onClose }) {
  const { profile, refreshProfile, signOut } = useAuth()
  const [pushStatus, setPushStatus] = useState('checking') // checking | unsupported | denied | subscribed | not-subscribed
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')

  useEffect(() => {
    if (!pushSupported()) {
      setPushStatus('unsupported')
      return
    }
    getPushStatus().then(setPushStatus)
  }, [])

  const togglePush = async () => {
    setPushError('')
    setPushBusy(true)
    try {
      if (pushStatus === 'subscribed') {
        await disablePush()
        setPushStatus('not-subscribed')
      } else {
        await enablePush(profile.id)
        setPushStatus('subscribed')
      }
    } catch (err) {
      setPushError(err.message)
      setPushStatus(await getPushStatus())
    } finally {
      setPushBusy(false)
    }
  }
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMessage, setPwMessage] = useState('')
  const [pwError, setPwError] = useState('')

  const [contactEmail, setContactEmail] = useState(profile?.contact_email || '')
  const [contactSaving, setContactSaving] = useState(false)
  const [contactMessage, setContactMessage] = useState('')

  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const changePassword = async (e) => {
    e.preventDefault()
    setPwError('')
    setPwMessage('')
    if (newPassword.length < 6) {
      setPwError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError("New passwords don't match.")
      return
    }
    setPwSaving(true)
    try {
      // Re-check the current password first, so someone can't change it just
      // by walking up to an unlocked, already-logged-in device.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(profile.username),
        password: currentPassword,
      })
      if (reauthError) throw new Error('Current password is incorrect.')

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError

      setPwMessage('Password updated.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPwError(err.message)
    } finally {
      setPwSaving(false)
    }
  }

  const saveContact = async (e) => {
    e.preventDefault()
    setContactSaving(true)
    setContactMessage('')
    const { error } = await supabase
      .from('profiles')
      .update({ contact_email: contactEmail.trim() || null })
      .eq('id', profile.id)
    setContactSaving(false)
    if (!error) {
      setContactMessage('Saved.')
      refreshProfile()
    }
  }

  const deleteAccount = async () => {
    setDeleteError('')
    setDeleting(true)
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', profile.id)
      if (error) throw error
      await signOut()
      onClose()
    } catch (err) {
      setDeleteError(err.message)
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="ticket rounded-lg p-6 max-w-md w-full max-h-[85vh] overflow-y-auto flex flex-col gap-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-display text-xl">Account settings</h2>
          <button onClick={onClose} className="focus-ring text-mist hover:text-paper text-xl leading-none">
            ×
          </button>
        </div>

        <form onSubmit={changePassword} className="flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-mist font-mono">Change password</div>
          <input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
            required
          />
          <input
            type="password"
            placeholder="New password (min. 6 characters)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
            minLength={6}
            required
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
            required
          />
          {pwError && <p className="text-coral text-sm">{pwError}</p>}
          {pwMessage && <p className="text-sage text-sm">{pwMessage}</p>}
          <button
            disabled={pwSaving}
            className="focus-ring bg-brass text-onbrass font-medium rounded-md py-2 text-sm disabled:opacity-50"
          >
            {pwSaving ? 'Updating…' : 'Update password'}
          </button>
        </form>

        <div className="flex flex-col gap-3 pt-4 border-t border-line">
          <div className="text-xs uppercase tracking-wide text-mist font-mono">
            Push notifications
          </div>
          <p className="text-mist text-xs -mt-2">
            Get notified on your phone or computer for new homework, deadlines, and daily
            reminders — even when this site isn't open.
          </p>
          {pushStatus === 'unsupported' && (
            <p className="text-mist text-sm">Not supported on this browser/device.</p>
          )}
          {pushStatus === 'denied' && (
            <p className="text-coral text-sm">
              Blocked in your browser settings. Allow notifications for this site to turn it on.
            </p>
          )}
          {(pushStatus === 'subscribed' || pushStatus === 'not-subscribed') && (
            <button
              type="button"
              onClick={togglePush}
              disabled={pushBusy}
              className={`focus-ring rounded-md py-2 text-sm font-medium disabled:opacity-50 ${
                pushStatus === 'subscribed'
                  ? 'border border-line hover:border-coral hover:text-coral'
                  : 'bg-brass text-onbrass hover:bg-brass-dim'
              }`}
            >
              {pushBusy
                ? 'Working…'
                : pushStatus === 'subscribed'
                ? 'Turn off push notifications'
                : 'Turn on push notifications'}
            </button>
          )}
          {pushError && <p className="text-coral text-sm">{pushError}</p>}
        </div>

        <form onSubmit={saveContact} className="flex flex-col gap-3 pt-4 border-t border-line">
          <div className="text-xs uppercase tracking-wide text-mist font-mono">
            Recovery email (optional)
          </div>
          <p className="text-mist text-xs -mt-2">
            Your login itself uses just a username, so there's no email tied to it by
            default. Adding one here lets {profile?.role === 'teacher' ? 'you' : 'Mr Ikromov'}{' '}
            verify it's really you if you ever get locked out and need your password reset
            manually.
          </p>
          <input
            type="email"
            placeholder="you@example.com"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
          />
          {contactMessage && <p className="text-sage text-sm">{contactMessage}</p>}
          <button
            disabled={contactSaving}
            className="focus-ring border border-line rounded-md py-2 text-sm hover:border-brass hover:text-brass transition-colors disabled:opacity-50"
          >
            {contactSaving ? 'Saving…' : 'Save'}
          </button>
        </form>

        <div className="flex flex-col gap-3 pt-4 border-t border-line">
          <div className="text-xs uppercase tracking-wide text-coral font-mono">Danger zone</div>
          {!showDeleteConfirm ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="focus-ring text-left text-sm text-coral border border-coral rounded-md py-2 px-3 hover:bg-coral hover:text-paper transition-colors"
            >
              Delete my account
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-mist text-xs">
                This permanently deletes your account, homework, recordings, and chat history.
                This can't be undone. Type <span className="font-mono text-paper">DELETE</span>{' '}
                to confirm.
              </p>
              <input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="focus-ring bg-panel-2 border border-coral rounded-md px-3 py-2 text-sm"
                placeholder="Type DELETE"
              />
              {deleteError && <p className="text-coral text-sm">{deleteError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={deleteAccount}
                  disabled={deleteConfirmText !== 'DELETE' || deleting}
                  className="focus-ring flex-1 bg-coral text-paper rounded-md py-2 text-sm font-medium disabled:opacity-40"
                >
                  {deleting ? 'Deleting…' : 'Permanently delete my account'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setDeleteConfirmText('')
                    setDeleteError('')
                  }}
                  className="focus-ring px-3 rounded-md border border-line text-mist text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
