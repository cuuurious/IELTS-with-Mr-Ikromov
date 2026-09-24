import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import GroupChat from './GroupChat'

/*
 * ================================================================
 * GROUP CHATS — shared Telegram-style inbox for both teacher and
 * student, replacing the old "row of pills + whichever group loaded
 * first opens automatically" switcher (TeacherGroupChats.jsx, and a
 * near-identical inline block in StudentDashboard.jsx).
 * ================================================================
 * Jasur's complaint (2026-09-24, said once before and repeated):
 * the group switcher "is too basic and robotic," it "automatically
 * opens one of the groupchats" the moment you land on the tab, and
 * its buttons don't look like real controls. He wants it to look and
 * behave like Telegram's own chat list — rows you tap to enter, with
 * a long-press/right-click preview — same as PrivateChats.jsx already
 * does for 1:1 chats. This is that same pattern, applied to groups.
 *
 * Deliberately does NOT touch `activeGroup`/`GroupPicker` as used
 * elsewhere (Homework tab, Leaderboard tab, TeacherGroupChats.jsx's
 * old export) — those are simple "filter by group" pill rows for a
 * different, valid purpose and were never part of this complaint.
 * This component owns its own selection state instead of reusing that
 * one, exactly like PrivateChats.jsx's `selectedId` is independent of
 * every other tab's own state.
 */

// Same convention as PrivateChats.jsx's previewText(): turn a raw
// message `content` (plain text, or a JSON blob for photos/videos/
// voice notes/files) into a short one-line preview.
function previewText(content) {
  if (!content) return ''

  try {
    const parsed = JSON.parse(content)

    if (parsed?.type && parsed?.url) {
      if (parsed.type === 'image') return '📷 Photo'
      if (parsed.type === 'video') return '🎥 Video'
      if (parsed.type === 'video_note') return '📹 Video message'
      if (parsed.type === 'audio') return '🎤 Voice message'
      if (parsed.type === 'file') {
        return `📎 ${parsed.name || 'File'}`
      }
    }
  } catch {
    // Plain text message — fall through.
  }

  return content
}

function formatListTime(value) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)

  const startOfDate = new Date(date)
  startOfDate.setHours(0, 0, 0, 0)

  const dayDiff = Math.round(
    (startOfToday - startOfDate) / 86400000
  )

  if (dayDiff === 0) {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (dayDiff > 0 && dayDiff < 7) {
    return date.toLocaleDateString([], { weekday: 'short' })
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

// Same rotation used on Groups & homework, Students, Word lists and
// Leaderboards — keyed by a group's position in the same
// created_at-ordered list every one of those pages fetches, so a
// given group carries the same color everywhere in the app.
const GROUP_ACCENT_PALETTE = [
  { bg: 'bg-sage/15', text: 'text-sage', border: 'border-sage/40', dot: 'bg-sage' },
  { bg: 'bg-coral/15', text: 'text-coral', border: 'border-coral/40', dot: 'bg-coral' },
  { bg: 'bg-cyan/15', text: 'text-cyan', border: 'border-cyan/40', dot: 'bg-cyan' },
  { bg: 'bg-brass/15', text: 'text-brass', border: 'border-brass/40', dot: 'bg-brass' },
  { bg: 'bg-lavender/15', text: 'text-lavender', border: 'border-lavender/40', dot: 'bg-lavender' },
]

const PREVIEW_WIDTH = 300
const PREVIEW_MAX_HEIGHT = 380
const LONG_PRESS_MS = 450
const MOVE_CANCEL_PX = 10

export default function GroupChats({
  selfId,
  selfRole,
  initialGroupId = null,
  initialGroupName = null,
  initialMessageId = null,
}) {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  // Independent of any other tab's group filter — see file header.
  const [activeGroupId, setActiveGroupId] = useState(initialGroupId)
  const [activeGroupName, setActiveGroupName] = useState(initialGroupName)

  const [previewGroup, setPreviewGroup] = useState(null)
  const [previewPosition, setPreviewPosition] = useState(null)
  const [previewMessages, setPreviewMessages] = useState([])
  const [previewLoading, setPreviewLoading] = useState(false)

  const rowGestureRef = useRef({ timer: null, startX: 0, startY: 0, fired: false })

  const loadGroups = async () => {
    if (!selfId) return

    setLoading(true)
    setError('')

    try {
      let rows = []

      if (selfRole === 'teacher') {
        const { data, error: groupsError } = await supabase
          .from('groups')
          .select('*')
          .order('created_at')

        if (groupsError) throw groupsError
        rows = data || []
      } else {
        const { data, error: groupsError } = await supabase
          .from('group_members')
          .select('groups(id, name, photo_url, description, created_at)')
          .eq('student_id', selfId)

        if (groupsError) throw groupsError

        rows = (data || [])
          .map((row) => row.groups)
          .filter(Boolean)
          .sort(
            (a, b) =>
              new Date(a.created_at || 0) - new Date(b.created_at || 0)
          )
      }

      if (rows.length === 0) {
        setGroups([])
        return
      }

      const groupIds = rows.map((g) => g.id)

      const { data: messages, error: messagesError } = await supabase
        .from('group_messages')
        .select('id, group_id, sender_id, content, created_at')
        .in('group_id', groupIds)
        .order('created_at', { ascending: false })

      if (messagesError) throw messagesError

      const { data: deletions, error: deletionsError } = await supabase
        .from('group_message_deletions')
        .select('message_id')
        .eq('user_id', selfId)

      if (deletionsError) throw deletionsError

      const hiddenIds = new Set((deletions || []).map((d) => d.message_id))
      const visible = (messages || []).filter((m) => !hiddenIds.has(m.id))

      // Messages come back newest-first, so the first time we see a
      // given group here is automatically its most recent message.
      const lastByGroup = new Map()

      visible.forEach((m) => {
        if (!lastByGroup.has(m.group_id)) {
          lastByGroup.set(m.group_id, m)
        }
      })

      const merged = rows.map((group, index) => ({
        ...group,
        accent: GROUP_ACCENT_PALETTE[index % GROUP_ACCENT_PALETTE.length],
        lastMessage: lastByGroup.get(group.id) || null,
      }))

      merged.sort((a, b) => {
        const timeA = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0
        const timeB = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0
        return timeB - timeA
      })

      setGroups(merged)
    } catch (err) {
      console.error('Failed to load group chats:', err)
      setError(err?.message || 'Could not load your group chats.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId, selfRole])

  // Keep the list live: a new message anywhere should bump that
  // group to the top and update its preview without leaving the tab.
  useEffect(() => {
    if (!selfId) return

    const channel = supabase
      .channel(`group-chats-list-${selfId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_messages' },
        () => loadGroups()
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'group_messages' },
        () => loadGroups()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId])

  // A notification tap opens straight into that group instead of
  // showing the list first.
  useEffect(() => {
    if (!initialGroupId) return

    setActiveGroupId(initialGroupId)
    setActiveGroupName(initialGroupName || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGroupId, initialMessageId])

  const search_ = search.trim().toLowerCase()

  const filteredGroups = useMemo(() => {
    if (!search_) return groups
    return groups.filter((g) => (g.name || '').toLowerCase().includes(search_))
  }, [groups, search_])

  const activeGroupData = useMemo(() => {
    if (!activeGroupId) return null

    return (
      groups.find((g) => g.id === activeGroupId) || {
        id: activeGroupId,
        name: activeGroupName,
      }
    )
  }, [groups, activeGroupId, activeGroupName])

  const openGroup = (group) => {
    setActiveGroupId(group.id)
    setActiveGroupName(group.name || null)
  }

  const clearRowLongPress = () => {
    if (rowGestureRef.current.timer) {
      clearTimeout(rowGestureRef.current.timer)
      rowGestureRef.current.timer = null
    }
  }

  const openPreviewAt = async (rect, group) => {
    const left = Math.min(rect.left, window.innerWidth - PREVIEW_WIDTH - 8)
    const top = Math.min(rect.bottom + 6, window.innerHeight - PREVIEW_MAX_HEIGHT - 8)

    setPreviewPosition({ top: Math.max(8, top), left: Math.max(8, left) })
    setPreviewGroup(group)
    setPreviewLoading(true)
    setPreviewMessages([])

    const { data, error: previewError } = await supabase
      .from('group_messages')
      .select('id, sender_id, content, created_at')
      .eq('group_id', group.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (!previewError) {
      const { data: deletions } = await supabase
        .from('group_message_deletions')
        .select('message_id')
        .eq('user_id', selfId)

      const hidden = new Set((deletions || []).map((d) => d.message_id))

      setPreviewMessages(
        (data || []).filter((m) => !hidden.has(m.id)).reverse()
      )
    }

    setPreviewLoading(false)
  }

  const handleRowPointerDown = (e, group) => {
    // Press-and-hold works the same for mouse, pen, and touch — see
    // the same fix applied to PrivateChats.jsx (a mouse click-and-hold
    // used to just fall straight through to a normal click).
    if (e.pointerType === 'mouse' && e.button !== 0) return

    const rect = e.currentTarget.getBoundingClientRect()

    rowGestureRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      fired: false,
      timer: setTimeout(() => {
        rowGestureRef.current.fired = true
        if (navigator.vibrate) navigator.vibrate(12)
        openPreviewAt(rect, group)
      }, LONG_PRESS_MS),
    }
  }

  const handleRowPointerMove = (e) => {
    const g = rowGestureRef.current
    if (!g.timer) return

    if (
      Math.abs(e.clientX - g.startX) > MOVE_CANCEL_PX ||
      Math.abs(e.clientY - g.startY) > MOVE_CANCEL_PX
    ) {
      clearRowLongPress()
    }
  }

  const handleRowClick = (group) => {
    if (rowGestureRef.current.fired) {
      rowGestureRef.current.fired = false
      return
    }

    openGroup(group)
  }

  const handleRowContextMenu = (e, group) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    openPreviewAt(rect, group)
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 min-h-[28rem]">

      {/* ============================================================
          GROUP LIST
          ============================================================ */}

      <aside className="w-full md:w-72 shrink-0 bg-panel border border-line rounded-lg overflow-hidden flex flex-col">

        <div className="px-4 py-3 border-b border-line">
          <div className="text-xs text-mist">
            Chat with each class as a group.
          </div>
        </div>

        {groups.length > 3 && (
          <div className="px-3 pt-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search groups..."
              className="focus-ring w-full bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto max-h-[28rem]">

          {loading && (
            <div className="px-4 py-5 text-sm text-mist">Loading groups…</div>
          )}

          {!loading && error && (
            <div className="px-4 py-4 text-sm text-coral">{error}</div>
          )}

          {!loading && !error && groups.length === 0 && (
            <div className="px-4 py-6 text-sm text-mist text-center">
              {selfRole === 'teacher'
                ? 'Create a group first.'
                : "You're not in a group yet."}
            </div>
          )}

          {!loading &&
            !error &&
            groups.length > 0 &&
            filteredGroups.length === 0 && (
              <div className="px-4 py-5 text-sm text-mist">
                No groups match your search.
              </div>
            )}

          {!loading &&
            filteredGroups.map((group) => {
              const active = activeGroupId === group.id
              const accent = group.accent

              return (
                <button
                  type="button"
                  key={group.id}
                  onPointerDown={(e) => handleRowPointerDown(e, group)}
                  onPointerMove={handleRowPointerMove}
                  onPointerUp={clearRowLongPress}
                  onPointerCancel={clearRowLongPress}
                  onPointerLeave={clearRowLongPress}
                  onContextMenu={(e) => handleRowContextMenu(e, group)}
                  onClick={() => handleRowClick(group)}
                  className={`w-full text-left px-4 py-3 border-b border-line transition-colors ${
                    active ? 'bg-panel-2' : 'hover:bg-panel-2'
                  }`}
                >
                  <div className="flex items-center gap-3">

                    {group.photo_url ? (
                      <img
                        src={group.photo_url}
                        alt={group.name}
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${accent.bg} ${accent.text}`}
                      >
                        {String(group.name || '?').charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-display text-sm text-paper">
                          {group.name}
                        </span>

                        {group.lastMessage && (
                          <span className="shrink-0 text-[11px] text-mist">
                            {formatListTime(group.lastMessage.created_at)}
                          </span>
                        )}
                      </div>

                      <div className="truncate text-xs text-mist mt-0.5">
                        {group.lastMessage
                          ? previewText(group.lastMessage.content)
                          : group.description || 'No messages yet'}
                      </div>
                    </div>

                  </div>
                </button>
              )
            })}

        </div>

      </aside>

      {/* ============================================================
          ACTIVE GROUP CHAT
          ============================================================ */}

      <section className="flex-1 min-w-0">

        {activeGroupData ? (
          <GroupChat
            key={`${activeGroupData.id}-${initialMessageId || 'normal'}`}
            groupId={activeGroupData.id}
            selfId={selfId}
            groupName={activeGroupData.name}
            initialMessageId={
              activeGroupData.id === initialGroupId ? initialMessageId : null
            }
          />
        ) : (
          <div className="h-[28rem] bg-panel border border-line rounded-lg flex items-center justify-center text-mist text-center px-6">
            Select a group to start chatting.
          </div>
        )}

      </section>

      {/* ============================================================
          LONG-PRESS / RIGHT-CLICK PREVIEW POPOVER
          ============================================================ */}

      {previewGroup && (
        <>
          <div
            className="fixed inset-0 z-[90]"
            onClick={() => setPreviewGroup(null)}
          />

          <div
            className="fixed z-[100] flex flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
            style={{
              top: previewPosition?.top,
              left: previewPosition?.left,
              width: PREVIEW_WIDTH,
              maxHeight: PREVIEW_MAX_HEIGHT,
            }}
          >

            <div className="flex items-center gap-3 border-b border-line bg-panel-2/60 px-4 py-3">
              {previewGroup.photo_url ? (
                <img
                  src={previewGroup.photo_url}
                  alt={previewGroup.name}
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brass text-sm font-semibold text-onbrass">
                  {String(previewGroup.name || '?').charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0">
                <div className="truncate font-display text-sm text-paper">
                  {previewGroup.name || 'Group'}
                </div>
                <div className="text-[11px] text-mist">Group chat</div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[120px]">
              {previewLoading && (
                <p className="text-xs text-mist">Loading…</p>
              )}

              {!previewLoading && previewMessages.length === 0 && (
                <p className="text-xs text-mist">No messages yet.</p>
              )}

              {!previewLoading &&
                previewMessages.map((m) => {
                  const mine = m.sender_id === selfId

                  return (
                    <div
                      key={m.id}
                      className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-1.5 text-xs ${
                          mine
                            ? 'bg-brass text-onbrass'
                            : 'border border-line bg-panel-2 text-paper'
                        }`}
                      >
                        {previewText(m.content) || 'Media message'}
                      </div>
                    </div>
                  )
                })}
            </div>

            <div className="border-t border-line p-1.5">
              <button
                type="button"
                onClick={() => {
                  openGroup(previewGroup)
                  setPreviewGroup(null)
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-paper hover:bg-panel-2"
              >
                Open chat
              </button>
            </div>

          </div>
        </>
      )}

    </div>
  )
}
