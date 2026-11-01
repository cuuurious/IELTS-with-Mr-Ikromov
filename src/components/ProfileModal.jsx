import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  getTargetBandInfo,
  formatTargetBand,
} from '../lib/targetBands'
import TargetBandIcon from './TargetBandIcon'

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

  // Tapping the photo itself opens it full-screen, same as tapping a
  // member's photo in a Telegram profile — separate from the modal
  // itself so closing the photo doesn't also close the profile card
  // underneath it.
  const [viewingPhoto, setViewingPhoto] = useState(false)

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

  // Reset any open full-screen photo whenever the profile being viewed
  // changes (or closes), so it can never carry over onto someone else's.
  useEffect(() => {
    setViewingPhoto(false)
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
        className="w-full max-w-sm overflow-hidden rounded-[24px] bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >

        <div className="registan-band relative h-28 overflow-hidden">
          <div className="absolute -bottom-6 left-6 h-24 w-16 rounded-[999px_999px_0_0] bg-white/10" />
          <div className="absolute -top-4 right-16 h-20 w-14 rounded-[0_0_999px_999px] bg-white/10" />
          <div className="absolute bottom-3 right-6 h-12 w-9 rounded-[999px_999px_0_0] border-[3px] border-b-0 border-saffron/70" aria-hidden="true" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring absolute right-3 top-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20 text-lg text-white transition hover:bg-white/30"
          >
            ×
          </button>
        </div>

        <div className="relative -mt-12 flex flex-col items-center px-5 pb-5 text-center">



          {loading && (
            <div className="h-24 w-24 animate-pulse rounded-full border-4 border-panel bg-panel-2" />
          )}

          {!loading && profile?.avatar_url && (
            <button
              type="button"
              onClick={() => setViewingPhoto(true)}
              className="focus-ring rounded-full"
              title="View photo"
              aria-label="View photo full-screen"
            >
              <img
                src={profile.avatar_url}
                alt={
                  profile.full_name ||
                  profile.username ||
                  'Profile photo'
                }
                className="h-24 w-24 rounded-full border-4 border-panel object-cover shadow-md"
              />
            </button>
          )}

          {!loading && profile && !profile.avatar_url && (
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-panel bg-[color-mix(in_srgb,var(--color-brass)_16%,var(--color-panel))] font-brand text-3xl font-bold text-brass shadow-md">
              {initial}
            </div>
          )}

          {!loading && profile && (
            <>
              <div className="mt-3 font-brand text-xl font-semibold text-paper">
                {profile.full_name ||
                  profile.username ||
                  'Member'}
              </div>

              <div className="mt-0.5 text-[13px] font-semibold text-mist">
                @{profile.username || 'unknown'}
              </div>

              {profile.role === 'teacher' && (
                <span className="mt-2 inline-block rounded-xl bg-saffron px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-[#17213a]">
                  TEACHER
                </span>
              )}
            </>
          )}

        </div>

        <div className="space-y-3 px-5 pb-5">

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
              <div className="rounded-[16px] bg-panel-2 px-4 py-3">
                <div className="mb-1 text-xs font-extrabold uppercase tracking-[0.06em] text-mist">
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
                <div className="rounded-[16px] bg-[color-mix(in_srgb,var(--color-brass)_10%,var(--color-panel))] px-4 py-3">
                  <div className="mb-1 text-xs font-extrabold uppercase tracking-[0.06em] text-mist">
                    Target band
                  </div>

                  <p className="flex items-center gap-1.5 text-[15px] font-extrabold text-brass">
                    <TargetBandIcon value={profile.target_band} className="h-4 w-4" />
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

      {/*
       * Full-screen photo viewer — tapping an avatar in Telegram opens
       * the photo large, on its own dark backdrop, dismissible with a
       * tap anywhere. Rendered on top of the profile card itself
       * (higher z-index), not as a separate portal, so it can't ever
       * be reached while a profile isn't already open.
       */}
      {viewingPhoto && profile?.avatar_url && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6"
          onClick={(e) => {
            e.stopPropagation()
            setViewingPhoto(false)
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setViewingPhoto(false)
            }}
            aria-label="Close photo"
            className="focus-ring absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            ×
          </button>

          <img
            src={profile.avatar_url}
            alt={
              profile.full_name ||
              profile.username ||
              'Profile photo'
            }
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  )
}
