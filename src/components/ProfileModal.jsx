import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  getTargetBandInfo,
  formatTargetBand,
} from '../lib/targetBands'

/*
 * A read-only "tap someone's name to see their profile" popup, used
 * by both Chat.jsx and GroupChat.jsx — same idea as tapping a member
 * in a Telegram chat. It only needs a user id; it fetches the rest
 * itself, so either chat can open it without first having loaded
 * every field it needs.
 *
 * Props:
 *   userId     - whose profile to show. Pass null/undefined to keep
 *                the modal closed (nothing renders).
 *   viewerId   - the id of the person looking, so we know if this is
 *                their own profile.
 *   viewerRole - 'teacher' or 'student'. A student's target band is
 *                only shown to the student themselves or to a
 *                teacher — not to other students.
 *   onClose    - called when the modal should close.
 */
export default function ProfileModal({
  userId,
  viewerId,
  viewerRole,
  onClose,
}) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!userId) return

    let active = true

    setLoading(true)
    setError('')
    setProfile(null)

    supabase
      .from('profiles')
      .select(
        'id, full_name, username, role, bio, avatar_url, target_band'
      )
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (!active) return

        if (loadError) {
          setError(loadError.message)
        } else {
          setProfile(data)
        }

        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [userId])

  if (!userId) return null

  const isSelf = viewerId && viewerId === userId

  const canSeeTargetBand =
    profile?.role === 'student' &&
    profile?.target_band != null &&
    (isSelf || viewerRole === 'teacher')

  const targetInfo = canSeeTargetBand
    ? getTargetBandInfo(profile.target_band)
    : null

  const initial = String(
    profile?.full_name || profile?.username || '?'
  )
    .charAt(0)
    .toUpperCase()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-panel border border-line rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >

        <div className="relative px-5 pt-7 pb-5 bg-panel-2/60 border-b border-line flex flex-col items-center text-center">

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring absolute top-3 right-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-mist transition hover:border-brass hover:text-brass"
          >
            ×
          </button>

          {loading && (
            <div className="w-20 h-20 rounded-full bg-panel animate-pulse" />
          )}

          {!loading && profile?.avatar_url && (
            <img
              src={profile.avatar_url}
              alt={
                profile.full_name ||
                profile.username ||
                'Profile photo'
              }
              className="w-20 h-20 rounded-full object-cover border border-line"
            />
          )}

          {!loading && profile && !profile.avatar_url && (
            <div className="w-20 h-20 rounded-full bg-brass flex items-center justify-center text-2xl font-semibold text-onbrass">
              {initial}
            </div>
          )}

          {!loading && profile && (
            <>
              <div className="mt-3 font-display text-lg text-paper">
                {profile.full_name ||
                  profile.username ||
                  'Member'}
              </div>

              <div className="text-xs text-mist">
                @{profile.username || 'unknown'}
              </div>

              {profile.role === 'teacher' && (
                <span className="mt-2 inline-block rounded-full border border-brass/40 px-2 py-0.5 text-[11px] text-brass">
                  TEACHER
                </span>
              )}
            </>
          )}

        </div>

        <div className="px-5 py-4 space-y-4">

          {loading && (
            <p className="text-sm text-mist">
              Loading profile…
            </p>
          )}

          {!loading && error && (
            <p className="text-sm text-coral">{error}</p>
          )}

          {!loading && !error && !profile && (
            <p className="text-sm text-mist">
              This profile isn't available.
            </p>
          )}

          {!loading && !error && profile && (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-mist font-mono mb-1">
                  Bio
                </div>

                {profile.bio ? (
                  <p className="text-sm text-paper whitespace-pre-wrap">
                    {profile.bio}
                  </p>
                ) : (
                  <p className="text-sm text-mist italic">
                    {isSelf
                      ? "You haven't added a bio yet — you can from Account Settings."
                      : 'No bio yet.'}
                  </p>
                )}
              </div>

              {targetInfo && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-mist font-mono mb-1">
                    Target band
                  </div>

                  <p className="text-sm text-brass">
                    {targetInfo.emoji}{' '}
                    {formatTargetBand(profile.target_band)}
                    {' — '}
                    {targetInfo.label}
                  </p>
                </div>
              )}
            </>
          )}

        </div>

      </div>
    </div>
  )
}
