import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import ProfileModal from './ProfileModal'
import ConfirmModal from './ConfirmModal'
import { compressImageIfNeeded } from '../lib/compressImage'

/*
 * ================================================================
 * GROUP SETTINGS — Telegram-style group info screen
 * ================================================================
 * Opened from GroupChat.jsx by tapping the group's name/photo in the
 * chat header. Shows/edits the group's photo + description, lists
 * every member with their role (Owner / Admin / Member — see
 * migration_23.sql's group_admins table), and gives a teacher/owner
 * the controls to promote or remove people, plus a student their own
 * "mute this group" and "leave group" actions.
 *
 * Promotion is real plumbing, not a mockup — but with exactly one
 * teacher account in the system today, the "add admin" list has no
 * one else to show yet. That's expected, not a bug: it's ready for
 * the moment a second staff account exists.
 */
export default function GroupSettingsModal({
  group,
  selfId,
  selfRole,
  onClose,
  onUpdated,
  onLeft,
}) {
  const isStaff = selfRole === 'teacher'

  const [name, setName] = useState(group?.name || '')
  const [description, setDescription] = useState(group?.description || '')
  const [photoUrl, setPhotoUrl] = useState(group?.photo_url || '')

  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [detailsDirty, setDetailsDirty] = useState(false)

  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')

  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [membersError, setMembersError] = useState('')

  const [availableTeachers, setAvailableTeachers] = useState([])
  const [addAdminOpen, setAddAdminOpen] = useState(false)
  const [addingAdminId, setAddingAdminId] = useState(null)

  const [busyMemberId, setBusyMemberId] = useState(null)
  const [selfMuted, setSelfMuted] = useState(false)
  const [mutingBusy, setMutingBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const [viewingProfileId, setViewingProfileId] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)

  const loadMembers = async () => {
    if (!group?.id) return

    setLoadingMembers(true)
    setMembersError('')

    const [membersRes, adminsRes] = await Promise.all([
      supabase
        .from('group_members')
        .select('*')
        .eq('group_id', group.id),
      supabase
        .from('group_admins')
        .select('*')
        .eq('group_id', group.id),
    ])

    if (membersRes.error) {
      setMembersError(membersRes.error.message)
      setLoadingMembers(false)
      return
    }

    if (adminsRes.error) {
      setMembersError(adminsRes.error.message)
      setLoadingMembers(false)
      return
    }

    const memberRows = membersRes.data || []
    const adminRows = adminsRes.data || []

    const ownMembership = memberRows.find(
      (row) => row.student_id === selfId
    )
    setSelfMuted(Boolean(ownMembership?.muted))

    const profileIds = [
      ...new Set([
        ...memberRows.map((row) => row.student_id),
        ...adminRows.map((row) => row.user_id),
      ]),
    ]

    let profileMap = {}

    if (profileIds.length) {
      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, role')
        .in('id', profileIds)

      if (profileError) {
        setMembersError(profileError.message)
        setLoadingMembers(false)
        return
      }

      ;(profileRows || []).forEach((profile) => {
        profileMap[profile.id] = profile
      })
    }

    const adminByUserId = {}
    adminRows.forEach((row) => {
      adminByUserId[row.user_id] = row.role
    })

    // Owner/Admin rows first (from group_admins — always staff), then
    // every regular member (from group_members — always students).
    // A person only ever appears once even if, in principle, both
    // tables had a row for them.
    const staffEntries = adminRows.map((row) => ({
      key: `staff-${row.user_id}`,
      id: row.user_id,
      role: row.role,
      profile: profileMap[row.user_id],
    }))

    const memberEntries = memberRows
      .filter((row) => !adminByUserId[row.student_id])
      .map((row) => ({
        key: `member-${row.student_id}`,
        id: row.student_id,
        role: 'member',
        muted: row.muted,
        profile: profileMap[row.student_id],
      }))

    const roleOrder = { owner: 0, admin: 1, member: 2 }

    const merged = [...staffEntries, ...memberEntries].sort((a, b) => {
      if (roleOrder[a.role] !== roleOrder[b.role]) {
        return roleOrder[a.role] - roleOrder[b.role]
      }

      const nameA = a.profile?.full_name || a.profile?.username || ''
      const nameB = b.profile?.full_name || b.profile?.username || ''

      return nameA.localeCompare(nameB)
    })

    setMembers(merged)
    setLoadingMembers(false)
  }

  const loadAvailableTeachers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, username')
      .eq('role', 'teacher')

    if (error) {
      console.error('Failed to load teacher accounts:', error)
      return
    }

    const existingStaffIds = new Set(
      members
        .filter((m) => m.role === 'owner' || m.role === 'admin')
        .map((m) => m.id)
    )

    setAvailableTeachers(
      (data || []).filter((t) => !existingStaffIds.has(t.id))
    )
  }

  useEffect(() => {
    loadMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id])

  useEffect(() => {
    setName(group?.name || '')
    setDescription(group?.description || '')
    setPhotoUrl(group?.photo_url || '')
    setDetailsDirty(false)
  }, [group?.id])

  const saveDetails = async () => {
    if (!isStaff) return

    setSavingDetails(true)
    setDetailsError('')

    const { error } = await supabase
      .from('groups')
      .update({
        name: name.trim() || group.name,
        description: description.trim() || null,
      })
      .eq('id', group.id)

    if (error) {
      setDetailsError(error.message)
      setSavingDetails(false)
      return
    }

    setDetailsDirty(false)
    setSavingDetails(false)

    onUpdated?.({
      name: name.trim() || group.name,
      description: description.trim() || null,
    })
  }

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''

    if (!file || !isStaff) return

    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setPhotoError('Images must be 5MB or smaller.')
      return
    }

    setPhotoUploading(true)
    setPhotoError('')

    try {
      // Same shrink-before-upload step used for personal avatars — a
      // full-res phone photo used as a group photo would otherwise be
      // fetched at full size by every member's member list and chat
      // header, every time.
      const compressedFile = await compressImageIfNeeded(file)

      const extension = compressedFile.name.includes('.')
        ? compressedFile.name.split('.').pop()
        : 'jpg'

      const safeExtension =
        extension.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg'

      // Timestamped filename (not a fixed "photo.ext") so a browser/CDN
      // never keeps showing the old photo right after a change.
      const path = `${group.id}/photo-${Date.now()}.${safeExtension}`

      const { error: uploadError } = await supabase.storage
        .from('group-photos')
        .upload(path, compressedFile, {
          upsert: false,
          contentType: compressedFile.type,
        })

      if (uploadError) throw uploadError

      const { data } = supabase.storage
        .from('group-photos')
        .getPublicUrl(path)

      const url = data?.publicUrl
      if (!url) throw new Error('Could not create the photo URL.')

      const { error: groupError } = await supabase
        .from('groups')
        .update({ photo_url: url })
        .eq('id', group.id)

      if (groupError) throw groupError

      setPhotoUrl(url)
      onUpdated?.({ photo_url: url })
    } catch (err) {
      console.error('Group photo upload failed:', err)
      setPhotoError(err?.message || 'Could not update the group photo.')
    } finally {
      setPhotoUploading(false)
    }
  }

  const promoteToAdmin = async (userId) => {
    setAddingAdminId(userId)

    const { error } = await supabase.from('group_admins').insert({
      group_id: group.id,
      user_id: userId,
      role: 'admin',
      granted_by: selfId,
    })

    setAddingAdminId(null)

    if (error) {
      setMembersError(error.message)
      return
    }

    setAddAdminOpen(false)
    await loadMembers()
  }

  const removeAdmin = (member) => {
    setConfirmDialog({
      title: `Remove ${member.profile?.full_name || 'this admin'} as Admin?`,
      message:
        "They'll go back to having no special role in this group. This doesn't remove their teacher account.",
      confirmLabel: 'Remove admin',
      tone: 'coral',
      onConfirm: async () => {
        setBusyMemberId(member.id)

        const { error } = await supabase
          .from('group_admins')
          .delete()
          .eq('group_id', group.id)
          .eq('user_id', member.id)
          .eq('role', 'admin')

        setBusyMemberId(null)

        if (error) {
          setMembersError(error.message)
          return
        }

        await loadMembers()
      },
    })
  }

  const removeMember = (member) => {
    setConfirmDialog({
      title: `Remove ${member.profile?.full_name || 'this student'} from the group?`,
      message:
        'They will lose access to this group\'s homework and chat. This can be undone by adding them back later.',
      confirmLabel: 'Remove from group',
      tone: 'coral',
      onConfirm: async () => {
        setBusyMemberId(member.id)

        const { error } = await supabase
          .from('group_members')
          .delete()
          .eq('group_id', group.id)
          .eq('student_id', member.id)

        setBusyMemberId(null)

        if (error) {
          setMembersError(error.message)
          return
        }

        await loadMembers()
      },
    })
  }

  const toggleMute = async () => {
    setMutingBusy(true)

    const nextMuted = !selfMuted

    const { error } = await supabase
      .from('group_members')
      .update({ muted: nextMuted })
      .eq('group_id', group.id)
      .eq('student_id', selfId)

    setMutingBusy(false)

    if (error) {
      setMembersError(error.message)
      return
    }

    setSelfMuted(nextMuted)
  }

  const leaveGroup = () => {
    setConfirmDialog({
      title: 'Leave this group?',
      message:
        "You'll stop seeing this group's homework, chat, and announcements. A teacher can add you back later.",
      confirmLabel: 'Leave group',
      tone: 'coral',
      onConfirm: async () => {
        setLeaving(true)

        const { error } = await supabase
          .from('group_members')
          .delete()
          .eq('group_id', group.id)
          .eq('student_id', selfId)

        setLeaving(false)

        if (error) {
          setMembersError(error.message)
          return
        }

        onLeft?.()
      },
    })
  }

  const groupInitial = String(name || group?.name || 'G')
    .trim()
    .charAt(0)
    .toUpperCase() || 'G'

  const roleLabel = {
    owner: 'Owner',
    admin: 'Admin',
    member: null,
  }

  const roleBadgeClass = {
    owner: 'border-brass/40 bg-brass/15 text-brass',
    admin: 'border-cyan/40 bg-cyan/15 text-cyan',
  }

  const modal = (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="surface my-4 w-full max-w-lg rounded-2xl border border-line shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >

        <ProfileModal
          userId={viewingProfileId}
          viewerId={selfId}
          viewerRole={selfRole}
          onClose={() => setViewingProfileId(null)}
        />

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

        {/* HEADER */}

        <div className="flex items-start justify-between gap-4 border-b border-line p-5 sm:p-6">
          <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
            Group info
          </div>

          <button
            type="button"
            onClick={onClose}
            className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-mist transition hover:text-paper hover:border-brass"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-6 p-5 sm:p-6">

          {/* PHOTO + NAME */}

          <div className="flex items-center gap-4">

            <label
              className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-brass/30 bg-brass/15 font-display text-xl font-semibold text-brass ${
                isStaff ? 'cursor-pointer' : ''
              }`}
              title={isStaff ? 'Change group photo' : undefined}
            >
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={name || 'Group photo'}
                  className="h-full w-full object-cover"
                />
              ) : (
                groupInitial
              )}

              {isStaff && (
                <>
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 text-transparent transition hover:bg-black/40 hover:text-white">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>

                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={photoUploading}
                    onChange={handlePhotoChange}
                  />
                </>
              )}
            </label>

            <div className="min-w-0 flex-1">
              {isStaff ? (
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setDetailsDirty(true)
                  }}
                  placeholder="Group name"
                  className="focus-ring w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-display text-lg text-paper outline-none"
                />
              ) : (
                <div className="font-display text-lg text-paper truncate">
                  {name || 'Group'}
                </div>
              )}

              {photoUploading && (
                <div className="mt-1 text-xs text-mist">Uploading photo…</div>
              )}

              {photoError && (
                <div className="mt-1 text-xs text-coral">{photoError}</div>
              )}
            </div>

          </div>

          {/* DESCRIPTION */}

          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-mist font-mono mb-1.5">
              Description
            </div>

            {isStaff ? (
              <textarea
                rows={2}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  setDetailsDirty(true)
                }}
                placeholder="What this group is for — visible to everyone in it."
                className="focus-ring w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper outline-none"
              />
            ) : (
              <p className="text-sm text-paper-dim">
                {description || 'No description yet.'}
              </p>
            )}

            {isStaff && (
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={saveDetails}
                  disabled={!detailsDirty || savingDetails}
                  className="btn-secondary text-xs disabled:opacity-40"
                >
                  {savingDetails ? 'Saving…' : 'Save changes'}
                </button>

                {detailsError && (
                  <span className="text-xs text-coral">{detailsError}</span>
                )}
              </div>
            )}
          </div>

          {/* MEMBERS */}

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-mist font-mono">
                Members{members.length ? ` · ${members.length}` : ''}
              </div>

              {isStaff && (
                <button
                  type="button"
                  onClick={() => {
                    setAddAdminOpen((v) => !v)
                    if (!addAdminOpen) loadAvailableTeachers()
                  }}
                  className="text-xs font-medium text-brass hover:text-brass-dim"
                >
                  {addAdminOpen ? 'Close' : '+ Add admin'}
                </button>
              )}
            </div>

            {addAdminOpen && (
              <div className="mb-3 rounded-lg border border-line bg-panel-2 p-3">
                {availableTeachers.length === 0 ? (
                  <p className="text-xs text-mist">
                    No other staff accounts yet — once you create one
                    (Staff Accounts, coming soon), it'll show up here to
                    promote as Admin of this group.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {availableTeachers.map((teacher) => (
                      <button
                        key={teacher.id}
                        type="button"
                        onClick={() => promoteToAdmin(teacher.id)}
                        disabled={addingAdminId === teacher.id}
                        className="focus-ring flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-paper hover:bg-panel disabled:opacity-50"
                      >
                        <span>{teacher.full_name || teacher.username}</span>
                        <span className="text-xs text-brass">
                          {addingAdminId === teacher.id ? 'Adding…' : 'Make Admin'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {membersError && (
              <p className="mb-2 text-xs text-coral">{membersError}</p>
            )}

            {loadingMembers ? (
              <p className="text-sm text-mist">Loading members…</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-mist">No members yet.</p>
            ) : (
              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {members.map((member) => {
                  const label = member.profile?.full_name || member.profile?.username || 'Member'
                  const initial = label.charAt(0).toUpperCase()
                  const badge = roleLabel[member.role]

                  return (
                    <div
                      key={member.key}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-panel-2"
                    >
                      <button
                        type="button"
                        onClick={() => setViewingProfileId(member.id)}
                        className="focus-ring flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        {member.profile?.avatar_url ? (
                          <img
                            src={member.profile.avatar_url}
                            alt={label}
                            className="h-9 w-9 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brass/15 text-sm font-semibold text-brass">
                            {initial}
                          </div>
                        )}

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-paper">
                            {label}
                            {member.id === selfId && ' (you)'}
                          </span>
                          <span className="block truncate text-xs text-mist">
                            @{member.profile?.username || 'unknown'}
                          </span>
                        </span>
                      </button>

                      {badge && (
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${roleBadgeClass[member.role]}`}>
                          {badge}
                        </span>
                      )}

                      {isStaff && member.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => removeAdmin(member)}
                          disabled={busyMemberId === member.id}
                          className="shrink-0 text-xs text-mist hover:text-coral disabled:opacity-40"
                        >
                          Remove admin
                        </button>
                      )}

                      {isStaff && member.role === 'member' && (
                        <button
                          type="button"
                          onClick={() => removeMember(member)}
                          disabled={busyMemberId === member.id}
                          className="shrink-0 text-xs text-mist hover:text-coral disabled:opacity-40"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* STUDENT-ONLY: MUTE + LEAVE */}

          {!isStaff && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">

              <button
                type="button"
                onClick={toggleMute}
                disabled={mutingBusy}
                className="focus-ring flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm text-paper transition hover:border-brass/40 disabled:opacity-50"
              >
                <span>Mute notifications for this group</span>
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                    selfMuted ? 'bg-brass' : 'bg-line'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                      selfMuted ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
              </button>

              <button
                type="button"
                onClick={leaveGroup}
                disabled={leaving}
                className="focus-ring rounded-lg border border-coral/40 bg-coral/5 px-3 py-2.5 text-left text-sm font-medium text-coral transition hover:bg-coral/10 disabled:opacity-50"
              >
                {leaving ? 'Leaving…' : 'Leave group'}
              </button>

            </div>
          )}

        </div>

      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
