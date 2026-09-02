import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import {
  pushSupported,
  getPushStatus,
  enablePush,
  disablePush,
} from '../lib/push'

export default function AccountSettingsModal({ onClose }) {
  const { profile, refreshProfile, signOut } = useAuth()

  const [pushStatus, setPushStatus] = useState('checking')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMessage, setPwMessage] = useState('')
  const [pwError, setPwError] = useState('')

  const [contactEmail, setContactEmail] = useState(
    profile?.contact_email || ''
  )
  const [contactSaving, setContactSaving] = useState(false)
  const [contactMessage, setContactMessage] = useState('')
  const [contactError, setContactError] = useState('')

  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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

  const changePassword = async (e) => {
    e.preventDefault()

    setPwError('')
    setPwMessage('')

    if (newPassword.length < 6) {
      setPwError(
        'New password must be at least 6 characters.'
      )
      return
    }

    if (newPassword !== confirmPassword) {
      setPwError(
        "New passwords don't match."
      )
      return
    }

    setPwSaving(true)

    try {
      const {
        data: userData,
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !userData?.user) {
        throw new Error(
          'Your session has expired. Please sign in again.'
        )
      }

      const authEmail =
        userData.user.email

      if (!authEmail) {
        throw new Error(
          'No authentication email is associated with this account.'
        )
      }

      const {
        error: reauthError,
      } =
        await supabase.auth.signInWithPassword({
          email: authEmail,
          password: currentPassword,
        })

      if (reauthError) {
        throw new Error(
          'Current password is incorrect.'
        )
      }

      const {
        error: updateError,
      } =
        await supabase.auth.updateUser({
          password: newPassword,
        })

      if (updateError) {
        throw updateError
      }

      setPwMessage(
        'Password updated successfully.'
      )

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      console.error(
        'Password change failed:',
        err
      )

      setPwError(
        err?.message ||
          'Could not update your password.'
      )
    } finally {
      setPwSaving(false)
    }
  }

  const saveContact = async (e) => {
    e.preventDefault()

    setContactSaving(true)
    setContactMessage('')
    setContactError('')

    const cleanEmail =
      contactEmail.trim().toLowerCase()

    try {
      /*
       * Allow the student to remove their recovery email.
       */
      if (!cleanEmail) {
        const {
          error: profileError,
        } = await supabase
          .from('profiles')
          .update({
            contact_email: null,
          })
          .eq('id', profile.id)

        if (profileError) {
          throw profileError
        }

        setContactMessage(
          'Recovery email removed from your profile.'
        )

        await refreshProfile()
        return
      }

      /*
       * Basic email validation.
       */
      const emailPattern =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/

      if (!emailPattern.test(cleanEmail)) {
        throw new Error(
          'Please enter a valid Gmail or other email address.'
        )
      }

      /*
       * Check whether another profile already uses
       * this recovery email.
       *
       * IMPORTANT:
       * We do NOT modify auth.users here.
       * The student's username/password session
       * therefore remains untouched.
       */
      const {
        data: existingProfile,
        error: lookupError,
      } = await supabase
        .from('profiles')
        .select('id, username')
        .ilike('contact_email', cleanEmail)
        .neq('id', profile.id)
        .maybeSingle()

      if (lookupError) {
        throw lookupError
      }

      if (existingProfile) {
        throw new Error(
          `This email is already connected to another account (${existingProfile.username}). Please use a different recovery email.`
        )
      }

      /*
       * Save ONLY to profiles.contact_email.
       */
      const {
        error: profileError,
      } = await supabase
        .from('profiles')
        .update({
          contact_email: cleanEmail,
        })
        .eq('id', profile.id)

      if (profileError) {
        if (
          profileError.code === '23505'
        ) {
          throw new Error(
            'This email is already connected to another account. Please use a different recovery email.'
          )
        }

        throw profileError
      }

      setContactMessage(
        'Recovery email saved successfully.'
      )

      await refreshProfile()
    } catch (err) {
      console.error(
        'Recovery email save failed:',
        err
      )

      setContactError(
        err?.message ||
          'Could not save the recovery email.'
      )
    } finally {
      setContactSaving(false)
    }
  }
const deleteAccount = async () => {
  setDeleteError('')
  setDeleting(true)

  try {
    const { error } = await supabase.rpc(
      'delete_my_account'
    )

    if (error) {
      throw error
    }

    await signOut()

    onClose()

    window.location.href = '/login'

  } catch (err) {
    console.error(
      'Account deletion failed:',
      err
    )

    setDeleteError(
      err?.message ||
      'Failed to delete account.'
    )

    setDeleting(false)
  }
}
  
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="ticket rounded-lg max-w-md w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/*
          The .ticket class (index.css) sets `overflow: hidden` for its
          decorative side-notches, which was silently fighting with
          `overflow-y-auto` on this same element and clipping anything
          past ~85% of the screen height — including the whole "Delete
          my account" section. Scrolling now happens on this inner
          wrapper instead, so .ticket's overflow:hidden only ever clips
          the notches like it's meant to.
        */}
        <div className="p-6 overflow-y-auto min-h-0 flex flex-col gap-6">
        <div className="flex items-start justify-between">
          <h2 className="font-display text-xl">
            Account settings
          </h2>

          <button
            onClick={onClose}
            className="focus-ring text-mist hover:text-paper text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* CHANGE PASSWORD */}
        <form
          onSubmit={changePassword}
          className="flex flex-col gap-3"
        >
          <div className="text-xs uppercase tracking-wide text-mist font-mono">
            Change password
          </div>

          <input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) =>
              setCurrentPassword(e.target.value)
            }
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
            required
          />

          <input
            type="password"
            placeholder="New password (min. 6 characters)"
            value={newPassword}
            onChange={(e) =>
              setNewPassword(e.target.value)
            }
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
            minLength={6}
            required
          />

          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) =>
              setConfirmPassword(e.target.value)
            }
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
            required
          />

          {pwError && (
            <p className="text-coral text-sm">
              {pwError}
            </p>
          )}

          {pwMessage && (
            <p className="text-sage text-sm">
              {pwMessage}
            </p>
          )}

          <button
            disabled={pwSaving}
            className="focus-ring bg-brass text-onbrass font-medium rounded-md py-2 text-sm disabled:opacity-50"
          >
            {pwSaving
              ? 'Updating…'
              : 'Update password'}
          </button>
        </form>

        {/* PUSH NOTIFICATIONS */}
        <div className="flex flex-col gap-3 pt-4 border-t border-line">
          <div className="text-xs uppercase tracking-wide text-mist font-mono">
            Push notifications
          </div>

          <p className="text-mist text-xs -mt-2">
            Get notified on your phone or computer for
            new homework, deadlines, and daily reminders —
            even when this site isn't open.
          </p>

          {pushStatus === 'unsupported' && (
            <p className="text-mist text-sm">
              Not supported on this browser/device.
            </p>
          )}

          {pushStatus === 'denied' && (
            <p className="text-coral text-sm">
              Blocked in your browser settings. Allow
              notifications for this site to turn it on.
            </p>
          )}

          {(
            pushStatus === 'subscribed' ||
            pushStatus === 'not-subscribed'
          ) && (
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

          {pushError && (
            <p className="text-coral text-sm">
              {pushError}
            </p>
          )}
        </div>

        {/* RECOVERY EMAIL */}
        <form
          onSubmit={saveContact}
          className="flex flex-col gap-3 pt-4 border-t border-line"
        >
          <div className="text-xs uppercase tracking-wide text-mist font-mono">
            Recovery email
          </div>

          <p className="text-mist text-xs -mt-2">
            Add your real email address so password
            reset links can be sent to you.
          </p>

          <input
            type="email"
            placeholder="you@gmail.com"
            value={contactEmail}
            onChange={(e) =>
              setContactEmail(e.target.value)
            }
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
          />

          {contactMessage && (
            <div className="rounded-md border border-sage/40 bg-sage/10 px-3 py-2">
              <p className="text-sage text-sm">
                {contactMessage}
              </p>
            </div>
          )}

          {contactError && (
            <div className="rounded-md border border-coral/40 bg-coral/10 px-3 py-2">
              <p className="text-coral text-sm">
                {contactError}
              </p>
            </div>
          )}

          <button
            disabled={contactSaving}
            className="focus-ring border border-line rounded-md py-2 text-sm hover:border-brass hover:text-brass transition-colors disabled:opacity-50"
          >
            {contactSaving
              ? 'Saving…'
              : 'Save recovery email'}
          </button>
        </form>

        {/* DANGER ZONE */}
        {/*
          Self-delete is student-only. The database only auto-cleans up
          things a STUDENT owns (submissions, memberships, messages…) —
          groups and homeworks a teacher created point back at their
          profile without cascading, so a teacher deleting themselves
          here would either fail outright or leave the app in a broken
          state. Teachers remove a student's account from that
          student's row in the group roster instead.
        */}
        {profile?.role !== 'teacher' && (
        <div className="flex flex-col gap-3 pt-4 border-t border-line">
          <div className="text-xs uppercase tracking-wide text-coral font-mono">
            Danger zone
          </div>

          {!showDeleteConfirm ? (
            <button
              type="button"
              onClick={() =>
                setShowDeleteConfirm(true)
              }
              className="focus-ring text-left text-sm text-coral border border-coral rounded-md py-2 px-3 hover:bg-coral hover:text-paper transition-colors"
            >
              Delete my account
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-mist text-xs">
                This permanently deletes your account,
                homework, recordings, and chat history.
                This can't be undone. Type{' '}
                <span className="font-mono text-paper">
                  DELETE
                </span>{' '}
                to confirm.
              </p>

              <input
                value={deleteConfirmText}
                onChange={(e) =>
                  setDeleteConfirmText(
                    e.target.value
                  )
                }
                className="focus-ring bg-panel-2 border border-coral rounded-md px-3 py-2 text-sm"
                placeholder="Type DELETE"
              />

              {deleteError && (
                <p className="text-coral text-sm">
                  {deleteError}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={deleteAccount}
                  disabled={
                    deleteConfirmText !== 'DELETE' ||
                    deleting
                  }
                  className="focus-ring flex-1 bg-coral text-paper rounded-md py-2 text-sm font-medium disabled:opacity-40"
                >
                  {deleting
                    ? 'Deleting…'
                    : 'Permanently delete my account'}
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
        )}
        </div>
      </div>
    </div>
  )
}