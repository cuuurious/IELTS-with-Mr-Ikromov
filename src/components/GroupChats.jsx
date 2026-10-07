import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import GroupChat from './GroupChat'
import { ChatGlyph } from './Chat'
import Icon from './Icon'
import { groupBadge, groupColour, groupDisplayName } from '../lib/groupLook'
import { useSessionState } from '../lib/sessionState'

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
      if (parsed.type === 'image') return 'Photo'
      if (parsed.type === 'video') return 'Video'
      if (parsed.type === 'video_note') return 'Video message'
      if (parsed.type === 'audio') return 'Voice message'
      if (parsed.type === 'file') {
        return `${parsed.name || 'File'}`
      }
    }
  } catch {
    // Plain text message — fall through.
  }

  return content
}

// Group messages keep media in media_type/media_url columns (not JSON
// in `content` like private chats), so a photo/voice/round video/file
// with no caption used to show as an empty preview line.
function groupMessagePreview(message) {
  if (!message) return ''
  if (message.content) return previewText(message.content)
  switch (message.media_type) {
    case 'image': return 'Photo'
    case 'video': return 'Video'
    case 'video_note': return 'Video message'
    case 'audio': return 'Voice message'
    case 'file': return `${message.media_name || 'File'}`
    default: return ''
  }
}

// Newest conversation first (groups with no messages last).
function byLastMessage(a, b) {
  const timeA = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0
  const timeB = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0
  return timeB - timeA
}

// get_group_chat_list() isn't there until migration_72 is applied —
// PostgREST answers PGRST202. Until then the old query is used
// (2026-10-06).
function isMissingRpc(err) {
  if (!err) return false
  return (
    err.code === 'PGRST202' ||
    err.code === '42883' ||
    err.status === 404 ||
    /could not find the function|does not exist/i.test(err.message || '')
  )
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
  // Remembered across a refresh (Jasur, 2026-09-30) — see
  // lib/sessionState.js. A notification tap still wins (effect below).
  const [activeGroupId, setActiveGroupId] = useSessionState(`ielts:${selfId}:groupChat:groupId`, initialGroupId)
  const [activeGroupName, setActiveGroupName] = useSessionState(`ielts:${selfId}:groupChat:groupName`, initialGroupName)

  const [previewGroup, setPreviewGroup] = useState(null)
  const [previewPosition, setPreviewPosition] = useState(null)
  const [previewMessages, setPreviewMessages] = useState([])
  const [previewLoading, setPreviewLoading] = useState(false)

  const rowGestureRef = useRef({ timer: null, startX: 0, startY: 0, fired: false })

  // 2026-10-06: the list used to re-download every group message ever
  // (and blank itself with "Loading…") on each new message or delete
  // anywhere in the school. Now: one cheap RPC (migration_72), the
  // "Loading…" state only on the very first load, new messages applied
  // in place, and any other refresh debounced and silent.
  const rpcMissingRef = useRef(false)
  const loadedOnceRef = useRef(false)
  const loadSeqRef = useRef(0)
  const refreshTimerRef = useRef(null)
  const loadRef = useRef(null)
  const groupIdsRef = useRef(new Set())
  const groupsRef = useRef([])
  groupsRef.current = groups

  // Old path (before migration_72 is applied): every message of every
  // group, newest first, summarised in the browser.
  const loadLastByGroupLegacy = async (groupIds) => {
    const { data: messages, error: messagesError } = await supabase
      .from('group_messages')
      .select('id, group_id, sender_id, content, media_type, media_name, created_at')
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

    return { lastByGroup, unreadByGroup: new Map() }
  }

  const loadLastByGroupRpc = async () => {
    const { data: rpcRows, error: rpcError } = await supabase.rpc('get_group_chat_list')

    if (rpcError) {
      if (!isMissingRpc(rpcError)) throw rpcError
      rpcMissingRef.current = true
      return null
    }

    const lastByGroup = new Map()
    const unreadByGroup = new Map()

    ;(rpcRows || []).forEach((r) => {
      if (!r.group_id) return

      if (r.last_message_id) {
        const isText = !r.last_kind || r.last_kind === 'text'
        lastByGroup.set(r.group_id, {
          id: r.last_message_id,
          group_id: r.group_id,
          sender_id: r.last_sender_id,
          // Same shape groupMessagePreview() reads.
          content: isText ? r.last_preview : null,
          media_type: r.last_media_type || (isText ? null : r.last_kind),
          media_name: r.last_media_name || (isText ? null : r.last_preview),
          created_at: r.last_created_at,
        })
      }

      if (r.unread_count) unreadByGroup.set(r.group_id, r.unread_count)
    })

    return { lastByGroup, unreadByGroup }
  }

  const loadGroups = async () => {
    if (!selfId) return

    const seq = ++loadSeqRef.current

    if (!loadedOnceRef.current) setLoading(true)

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
        if (seq === loadSeqRef.current) {
          groupIdsRef.current = new Set()
          setGroups([])
          setError('')
        }
        return
      }

      const groupIds = rows.map((g) => g.id)

      let summary = null
      if (!rpcMissingRef.current) summary = await loadLastByGroupRpc()
      if (!summary) summary = await loadLastByGroupLegacy(groupIds)

      const { lastByGroup, unreadByGroup } = summary

      // A slower, older refresh must not overwrite a newer one.
      if (seq !== loadSeqRef.current) return

      const merged = rows.map((group, index) => ({
        ...group,
        // Position in the created_at order — the same colour this
        // group has on Home, Groups & homework and the Mock Center.
        lookIndex: index,
        lastMessage: lastByGroup.get(group.id) || null,
        unreadCount: unreadByGroup.get(group.id) || 0,
      }))

      merged.sort(byLastMessage)

      groupIdsRef.current = new Set(groupIds)
      setGroups(merged)
      setError('')
    } catch (err) {
      console.error('Failed to load group chats:', err)
      if (seq === loadSeqRef.current) {
        setError(err?.message || 'Could not load your group chats.')
      }
    } finally {
      if (seq === loadSeqRef.current) {
        loadedOnceRef.current = true
        setLoading(false)
      }
    }
  }

  loadRef.current = loadGroups

  // Bursts of realtime events collapse into one quiet refresh.
  const scheduleRefresh = () => {
    clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => loadRef.current?.(), 600)
  }

  useEffect(() => () => clearTimeout(refreshTimerRef.current), [])

  useEffect(() => {
    loadedOnceRef.current = false
    loadGroups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId, selfRole])

  // Keep the list live: a new message anywhere should bump that
  // group to the top and update its preview without leaving the tab.
  // 2026-10-06: applied in place from the realtime row (no refetch);
  // only a delete of a group's current last message needs a refresh.
  useEffect(() => {
    if (!selfId) return

    const channel = supabase
      .channel(`group-chats-list-${selfId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_messages' },
        (payload) => {
          const m = payload.new
          if (!m?.group_id || !groupIdsRef.current.has(m.group_id)) return

          setGroups((prev) =>
            prev
              .map((g) => {
                if (g.id !== m.group_id) return g
                const prevTime = g.lastMessage ? new Date(g.lastMessage.created_at).getTime() : 0
                if (new Date(m.created_at).getTime() < prevTime) return g
                return {
                  ...g,
                  lastMessage: {
                    id: m.id,
                    group_id: m.group_id,
                    sender_id: m.sender_id,
                    content: m.content,
                    media_type: m.media_type,
                    media_name: m.media_name,
                    created_at: m.created_at,
                  },
                  unreadCount:
                    m.sender_id === selfId ? g.unreadCount || 0 : (g.unreadCount || 0) + 1,
                }
              })
              .sort(byLastMessage)
          )
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'group_messages' },
        (payload) => {
          // Realtime only sends the primary key of a deleted row.
          const deletedId = payload.old?.id
          if (!deletedId) return
          if (groupsRef.current.some((g) => g.lastMessage?.id === deletedId)) {
            scheduleRefresh()
          }
        }
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
      .select('id, sender_id, content, media_type, media_name, created_at')
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

  const badgeFor = (group, size = 'h-11 w-11', text = 'text-sm') => {
    if (group.photo_url) {
      return (
        <img
          src={group.photo_url}
          alt=""
          className={`${size} shrink-0 rounded-[14px] object-cover`}
        />
      )
    }

    const look = groupColour(group.lookIndex ?? 0)

    return (
      <span
        className={`${size} ${text} ${look.tint} ${look.text} flex shrink-0 items-center justify-center rounded-[14px] font-semibold`}
        aria-hidden="true"
      >
        {groupBadge(group.name)}
      </span>
    )
  }

  return (
    // Study room look (2026-10-07): list + conversation as ONE card that
    // fills the screen; on a phone it shows the list OR the open chat.
    <div
      className={`chat-card flex overflow-hidden rounded-[22px] border border-line bg-panel md:h-[calc(100dvh-196px)] md:min-h-[540px] ${
        activeGroupData ? 'h-[calc(100dvh-196px)] min-h-[440px]' : 'min-h-[320px]'
      }`}
    >

      {/* ============================================================
          GROUP LIST
          ============================================================ */}

      <aside
        className={`${
          activeGroupData ? 'hidden md:flex' : 'flex'
        } w-full shrink-0 flex-col border-line md:w-[300px] md:border-r lg:w-[340px]`}
      >

        <div className="shrink-0 px-4 pb-3 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-paper">Group chats</h2>
            {!loading && groups.length > 0 && (
              <span className="text-xs text-mist">
                {groups.length} group{groups.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {groups.length > 3 ? (
            <div className="relative mt-3">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist">
                <ChatGlyph name="search" className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search groups"
                aria-label="Search groups"
                className="focus-ring w-full rounded-full border !border-transparent !bg-panel-2 py-2.5 pl-9 pr-9 text-sm !text-paper placeholder:text-mist focus:!border-line"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="focus-ring absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-mist hover:bg-panel hover:text-paper"
                  aria-label="Clear search"
                  title="Clear"
                >
                  <Icon name="close" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <p className="mt-0.5 text-xs text-mist">Chat with each class as a group.</p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">

          {loading && (
            <div className="space-y-1 px-1 pt-1" aria-label="Loading groups">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
                  <span className="h-11 w-11 shrink-0 animate-pulse rounded-[14px] bg-panel-2" />
                  <span className="flex-1 space-y-2">
                    <span className="block h-3 w-1/2 animate-pulse rounded-full bg-panel-2" />
                    <span className="block h-3 w-3/4 animate-pulse rounded-full bg-panel-2" />
                  </span>
                </div>
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="m-2 rounded-2xl bg-urgent-tint px-4 py-3 text-sm text-urgent">{error}</div>
          )}

          {!loading && !error && groups.length === 0 && (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-reading-tint text-reading">
                <ChatGlyph name="people" className="h-7 w-7" />
              </span>
              <div className="mt-3 text-sm font-medium text-paper">No group chats yet</div>
              <div className="mt-1 text-xs leading-5 text-mist">
                {selfRole === 'teacher'
                  ? 'Create a group first.'
                  : "You're not in a group yet."}
              </div>
            </div>
          )}

          {!loading &&
            !error &&
            groups.length > 0 &&
            filteredGroups.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-mist">
                No groups match “{search.trim()}”.
              </div>
            )}

          {!loading &&
            filteredGroups.map((group) => {
              const active = activeGroupId === group.id
              // No unread badge here on purpose (same as before): nothing
              // marks a group as read yet, so a count would never clear.
              const unread = false
              const sentLast = group.lastMessage?.sender_id === selfId

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
                  aria-current={active ? 'true' : undefined}
                  className={`focus-ring flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors ${
                    active ? 'bg-brass text-onbrass' : 'hover:bg-panel-2'
                  }`}
                >
                  {badgeFor(group)}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-sm ${unread ? 'font-semibold' : 'font-medium'} ${
                          active ? 'text-onbrass' : 'text-paper'
                        }`}
                      >
                        {groupDisplayName(group.name)}
                      </span>

                      {group.lastMessage && (
                        <span
                          className={`shrink-0 text-[11px] ${
                            active ? 'text-onbrass/75' : unread ? 'font-medium text-paper' : 'text-mist'
                          }`}
                        >
                          {formatListTime(group.lastMessage.created_at)}
                        </span>
                      )}
                    </div>

                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <div
                        className={`truncate text-[13px] ${
                          active ? 'text-onbrass/75' : unread ? 'text-paper-dim' : 'text-mist'
                        }`}
                      >
                        {group.lastMessage ? (
                          <>
                            {sentLast && <span className={active ? 'text-onbrass' : 'text-paper-dim'}>You: </span>}
                            {groupMessagePreview(group.lastMessage) || 'Media message'}
                          </>
                        ) : (
                          group.description || 'No messages yet'
                        )}
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

      <section
        className={`${
          activeGroupData ? 'flex' : 'hidden md:flex'
        } min-w-0 flex-1 flex-col`}
      >

        {activeGroupData ? (
          <GroupChat
            key={`${activeGroupData.id}-${initialMessageId || 'normal'}`}
            groupId={activeGroupData.id}
            selfId={selfId}
            groupName={activeGroupData.name}
            initialMessageId={
              activeGroupData.id === initialGroupId ? initialMessageId : null
            }
            embedded
            lookIndex={activeGroupData.lookIndex ?? null}
            onBack={() => {
              setActiveGroupId(null)
              setActiveGroupName(null)
            }}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-panel-2 px-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-reading-tint text-reading">
              <ChatGlyph name="people" className="h-8 w-8" />
            </span>
            <div className="mt-4 text-base font-semibold text-paper">Pick a group</div>
            <p className="mt-1 max-w-xs text-sm leading-6 text-mist">
              Choose a class on the left to read and send messages.
            </p>
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
            className="fixed z-[100] flex flex-col overflow-hidden rounded-[22px] border border-line bg-panel shadow-[0_24px_60px_-20px_rgba(31,35,64,0.45)]"
            style={{
              top: previewPosition?.top,
              left: previewPosition?.left,
              width: PREVIEW_WIDTH,
              maxHeight: PREVIEW_MAX_HEIGHT,
            }}
          >

            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              {badgeFor(previewGroup, 'h-9 w-9', 'text-xs')}

              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-paper">
                  {groupDisplayName(previewGroup.name)}
                </div>
                <div className="text-[11px] text-mist">Group chat</div>
              </div>
            </div>

            <div className="min-h-[120px] flex-1 space-y-1.5 overflow-y-auto bg-panel-2 px-3 py-3 [scrollbar-width:thin]">
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
                        className={`max-w-[85%] rounded-2xl px-2.5 py-1.5 text-xs ${
                          mine
                            ? 'bg-brass text-onbrass'
                            : 'border border-line bg-panel text-paper'
                        }`}
                      >
                        {groupMessagePreview(m) || 'Media message'}
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
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-paper hover:bg-panel-2"
              >
                <ChatGlyph name="chat" className="h-4 w-4 text-mist" />
                Open chat
              </button>
            </div>

          </div>
        </>
      )}

    </div>
  )
}
