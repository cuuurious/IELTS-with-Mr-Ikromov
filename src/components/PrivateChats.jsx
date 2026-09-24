import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Chat from './Chat'
import ConfirmModal from './ConfirmModal'

/*
 * ================================================================
 * PRIVATE CHATS — shared inbox for both teacher and student
 * ================================================================
 * Used to be three separate implementations that had drifted apart:
 * Chats.jsx (unused/orphaned), TeacherChat.jsx (search + preview +
 * timestamp, but only for the teacher), and ~400 lines built directly
 * into StudentDashboard.jsx (no avatars, no preview, no timestamp).
 * That's exactly why features like "delete a chat" or "unread" never
 * made it to the student side along with the teacher side, or vice
 * versa — there was nowhere for them to live once, for both.
 *
 * This is that one place. `selfRole` picks the (small) difference in
 * WHO can appear in the list — a teacher only sees students they've
 * actually messaged; a student always sees their teacher, even before
 * a first message exists — everything else (search, preview,
 * timestamp, unread badge, long-press/right-click preview popover,
 * delete-for-me/delete-for-everyone) is identical for both.
 */

// Turns a message's raw `content` (plain text, or a JSON blob for
// photos/videos/voice notes/files — see Chat.jsx's parseMessage) into
// a short one-line preview, the same way Telegram shows "📷 Photo"
// instead of a raw URL for a conversation's last message.
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

// Short relative-ish timestamp for the conversation list: just the
// time for today, the weekday for the last week, otherwise a short
// date — the same convention Telegram uses so the list stays scannable.
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

export default function PrivateChats({
  selfId,
  selfRole,
  teacher = null,
  initialPeerId = null,
  initialPeerName = null,
  initialMessageId = null,
}) {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(initialPeerId)
  const [selectedName, setSelectedName] = useState(initialPeerName)

  const [confirmDialog, setConfirmDialog] = useState(null)

  // Long-press (touch) / right-click (desktop) on a row opens a
  // Telegram-style floating preview instead of the full chat — see
  // the screenshot Jasur sent: name/status header, a scrollable
  // look at recent messages, then quick actions at the bottom.
  const [previewPeer, setPreviewPeer] = useState(null)
  const [previewPosition, setPreviewPosition] = useState(null)
  const [previewMessages, setPreviewMessages] = useState([])
  const [previewLoading, setPreviewLoading] = useState(false)

  const rowGestureRef = useRef({ timer: null, startX: 0, startY: 0, fired: false })
  const hasAutoSelectedRef = useRef(false)

  const loadConversations = async () => {
    if (!selfId) return

    setLoading(true)
    setError('')

    try {
      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('id, sender_id, receiver_id, content, created_at')
        .or(`sender_id.eq.${selfId},receiver_id.eq.${selfId}`)
        .order('created_at', { ascending: false })

      if (messagesError) throw messagesError

      // This account's own "delete for me" markers — a message hidden
      // this way should never surface in a preview or count toward an
      // unread badge, same as it already doesn't inside Chat.jsx.
      const { data: deletions, error: deletionsError } = await supabase
        .from('message_deletions')
        .select('message_id')
        .eq('user_id', selfId)

      if (deletionsError) throw deletionsError

      const hiddenIds = new Set((deletions || []).map((d) => d.message_id))
      const visible = (messages || []).filter((m) => !hiddenIds.has(m.id))

      // Messages come back newest-first, so the first time we see a
      // given peer here is automatically their most recent message.
      const lastByPeer = new Map()

      visible.forEach((m) => {
        const peerId = m.sender_id === selfId ? m.receiver_id : m.sender_id
        if (!peerId || peerId === selfId) return

        if (!lastByPeer.has(peerId)) {
          lastByPeer.set(peerId, {
            content: m.content,
            created_at: m.created_at,
            sender_id: m.sender_id,
          })
        }
      })

      const { data: readRows, error: readsError } = await supabase
        .from('private_chat_reads')
        .select('peer_id, last_read_at')
        .eq('user_id', selfId)

      if (readsError) throw readsError

      const readMap = {}
      ;(readRows || []).forEach((r) => {
        readMap[r.peer_id] = r.last_read_at
      })

      // The other direction: how far each peer has read what THIS
      // account sent them — what puts a "seen" double-check next to a
      // conversation's timestamp. Needs migration_26's widened select
      // policy (private_chat_reads is normally locked to your own rows).
      const { data: peerReadRows, error: peerReadsError } = await supabase
        .from('private_chat_reads')
        .select('user_id, last_read_at')
        .eq('peer_id', selfId)

      if (peerReadsError) throw peerReadsError

      const peerReadMap = {}
      ;(peerReadRows || []).forEach((r) => {
        peerReadMap[r.user_id] = r.last_read_at
      })

      const unreadByPeer = new Map()

      visible.forEach((m) => {
        if (m.sender_id === selfId) return // only incoming messages count

        const lastRead = readMap[m.sender_id]

        if (!lastRead || new Date(m.created_at) > new Date(lastRead)) {
          unreadByPeer.set(m.sender_id, (unreadByPeer.get(m.sender_id) || 0) + 1)
        }
      })

      const peerIds = [...lastByPeer.keys()]

      // A student always has their teacher available to message, even
      // before a first message exists — same as the app has always
      // done. A teacher only ever sees people they've actually
      // messaged (they start new ones from a student's profile).
      if (selfRole !== 'teacher' && teacher?.id && !peerIds.includes(teacher.id)) {
        peerIds.push(teacher.id)
      }

      if (peerIds.length === 0) {
        setConversations([])
        return
      }

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, role')
        .in('id', peerIds)

      if (profilesError) throw profilesError

      const merged = (profiles || []).map((p) => ({
        ...p,
        lastMessage: lastByPeer.get(p.id) || null,
        unreadCount: unreadByPeer.get(p.id) || 0,
        peerReadAt: peerReadMap[p.id] || null,
      }))

      merged.sort((a, b) => {
        // Students always see their teacher pinned first, exactly like
        // before — everyone else sorts by most-recent message.
        if (selfRole !== 'teacher') {
          if (a.id === teacher?.id) return -1
          if (b.id === teacher?.id) return 1
        }

        const timeA = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0
        const timeB = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0

        return timeB - timeA
      })

      setConversations(merged)
    } catch (err) {
      console.error('Failed to load conversations:', err)
      setError(err?.message || 'Could not load your chats.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId, selfRole, teacher?.id])

  // Keep the list live: a brand new conversation, a bump back to the
  // top, or a fresh unread badge should all appear without needing to
  // leave and reopen this tab.
  useEffect(() => {
    if (!selfId) return

    const channel = supabase
      .channel(`private-chats-${selfId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new

          if (m.sender_id === selfId || m.receiver_id === selfId) {
            loadConversations()
          }
        }
      )
      .on(
        // Someone just read (or un-read) a conversation with this
        // account — refreshes the "seen" tick next to the timestamp
        // without waiting for the next message to arrive.
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'private_chat_reads',
          filter: `peer_id=eq.${selfId}`,
        },
        () => loadConversations()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId])

  // A notification tap, or "Chat with student" from the Leaderboard,
  // always selects the requested person — even if this is the very
  // first message between them and they don't appear in `conversations`
  // yet (handled by `selectedPerson` falling back to a synthetic entry
  // below).
  useEffect(() => {
    if (initialPeerId) {
      setSelectedId(initialPeerId)
      setSelectedName(initialPeerName || null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPeerId, initialMessageId])

  // First load only: a student lands on their teacher by default
  // (same as always); a teacher starts with nothing selected and
  // picks a conversation, same as TeacherChat.jsx always did.
  useEffect(() => {
    if (hasAutoSelectedRef.current) return
    if (selectedId || loading) return
    if (selfRole === 'teacher') return
    if (!teacher?.id) return

    hasAutoSelectedRef.current = true
    setSelectedId(teacher.id)
    setSelectedName(teacher.full_name || teacher.username || 'Teacher')
  }, [selectedId, loading, selfRole, teacher])

  const search_ = search.trim().toLowerCase()

  const filteredConversations = useMemo(() => {
    if (!search_) return conversations

    return conversations.filter((c) =>
      [c.full_name, c.username]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(search_))
    )
  }, [conversations, search_])

  const selectedPerson = useMemo(() => {
    if (!selectedId) return null

    return (
      conversations.find((c) => c.id === selectedId) || {
        id: selectedId,
        full_name: selectedName,
      }
    )
  }, [conversations, selectedId, selectedName])

  const selectConversation = (person) => {
    setSelectedId(person.id)
    setSelectedName(person.full_name || person.username || null)

    // Optimistic: clear the badge right away rather than waiting on
    // Chat.jsx's own mark-as-read round trip to finish.
    setConversations((prev) =>
      prev.map((c) => (c.id === person.id ? { ...c, unreadCount: 0 } : c))
    )
  }

  /*
   * ============================================================
   * DELETE CONVERSATION (for me / for everyone)
   * ============================================================
   * Shared by both the header trash icon inside Chat.jsx (via
   * onDeleted below) and the long-press/right-click preview popover's
   * own quick actions.
   * ============================================================
   */

  const handleChatDeleted = () => {
    setSelectedId(null)
    setSelectedName(null)
    setPreviewPeer(null)
    loadConversations()
  }

  const requestDeleteFromPreview = (person, mode) => {
    setPreviewPeer(null)

    setConfirmDialog({
      title:
        mode === 'everyone'
          ? `Delete this chat with ${person.full_name || 'this person'} for everyone?`
          : `Delete this chat with ${person.full_name || 'this person'}?`,
      message:
        mode === 'everyone'
          ? "This permanently deletes the whole conversation for both of you. This can't be undone."
          : "This removes the conversation from your own chat list. It stays exactly as-is for the other person.",
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => runDeleteConversation(person.id, mode),
    })
  }

  const runDeleteConversation = async (peerId, mode) => {
    try {
      const { data: rows, error: fetchError } = await supabase
        .from('messages')
        .select('id')
        .or(
          `and(sender_id.eq.${selfId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${selfId})`
        )

      if (fetchError) throw fetchError

      const ids = (rows || []).map((r) => r.id)

      if (mode === 'everyone') {
        if (ids.length) {
          const { error: deleteError } = await supabase
            .from('messages')
            .delete()
            .in('id', ids)

          if (deleteError) throw deleteError
        }
      } else if (ids.length) {
        const { error: hideError } = await supabase
          .from('message_deletions')
          .upsert(
            ids.map((id) => ({ message_id: id, user_id: selfId })),
            { onConflict: 'message_id,user_id', ignoreDuplicates: true }
          )

        if (hideError) throw hideError
      }

      if (selectedId === peerId) {
        setSelectedId(null)
        setSelectedName(null)
      }

      await loadConversations()
    } catch (err) {
      console.error('Failed to delete conversation:', err)
      setError(err?.message || 'Could not delete this conversation.')
    }
  }

  /*
   * ============================================================
   * LONG-PRESS / RIGHT-CLICK PREVIEW POPOVER
   * ============================================================
   */

  const clearRowLongPress = () => {
    if (rowGestureRef.current.timer) {
      clearTimeout(rowGestureRef.current.timer)
      rowGestureRef.current.timer = null
    }
  }

  const openPreviewAt = async (rect, person) => {
    const left = Math.min(rect.left, window.innerWidth - PREVIEW_WIDTH - 8)
    const top = Math.min(rect.bottom + 6, window.innerHeight - PREVIEW_MAX_HEIGHT - 8)

    setPreviewPosition({ top: Math.max(8, top), left: Math.max(8, left) })
    setPreviewPeer(person)
    setPreviewLoading(true)
    setPreviewMessages([])

    const { data, error: previewError } = await supabase
      .from('messages')
      .select('id, sender_id, content, created_at')
      .or(
        `and(sender_id.eq.${selfId},receiver_id.eq.${person.id}),and(sender_id.eq.${person.id},receiver_id.eq.${selfId})`
      )
      .order('created_at', { ascending: false })
      .limit(20)

    if (!previewError) {
      const { data: deletions } = await supabase
        .from('message_deletions')
        .select('message_id')
        .eq('user_id', selfId)

      const hidden = new Set((deletions || []).map((d) => d.message_id))

      setPreviewMessages(
        (data || []).filter((m) => !hidden.has(m.id)).reverse()
      )
    }

    setPreviewLoading(false)
  }

  const handleRowPointerDown = (e, person) => {
    // Used to bail out entirely for mouse input, on the assumption
    // desktop users would always right-click instead. In practice
    // Jasur (and presumably students) instinctively press-and-hold
    // with the mouse the same way they would on a touchscreen,
    // expecting the same preview — and got a normal click-through
    // into the full chat instead, every time. Press-and-hold now
    // works the same way for mouse, pen, and touch; right-click
    // (handleRowContextMenu) still works too, unchanged.
    if (e.pointerType === 'mouse' && e.button !== 0) return

    const rect = e.currentTarget.getBoundingClientRect()

    rowGestureRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      fired: false,
      timer: setTimeout(() => {
        rowGestureRef.current.fired = true
        if (navigator.vibrate) navigator.vibrate(12)
        openPreviewAt(rect, person)
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

  const handleRowClick = (person) => {
    if (rowGestureRef.current.fired) {
      rowGestureRef.current.fired = false
      return
    }

    selectConversation(person)
  }

  const handleRowContextMenu = (e, person) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    openPreviewAt(rect, person)
  }

  const markPreviewRead = async (unread) => {
    if (!previewPeer) return

    if (unread) {
      // "Mark as unread" — Telegram doesn't really recompute exactly
      // what you have/haven't seen either, it just puts the badge back.
      // Clearing our own marker does the same thing here: the peer's
      // most recent message(s) count as unread again next load.
      await supabase
        .from('private_chat_reads')
        .delete()
        .eq('user_id', selfId)
        .eq('peer_id', previewPeer.id)
    } else {
      await supabase.from('private_chat_reads').upsert(
        {
          user_id: selfId,
          peer_id: previewPeer.id,
          last_read_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,peer_id' }
      )
    }

    setPreviewPeer(null)
    await loadConversations()
  }

  return (
    <div className="flex flex-col md:flex-row gap-4 min-h-[28rem]">

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

      {/* ============================================================
          CONVERSATION LIST
          ============================================================ */}

      <aside className="w-full md:w-72 shrink-0 bg-panel border border-line rounded-lg overflow-hidden flex flex-col">

        <div className="px-4 py-3 border-b border-line">
          <div className="font-display text-lg text-paper">Chats</div>
          <div className="text-xs text-mist mt-1">
            {selfRole === 'teacher'
              ? 'Your conversations with students'
              : 'Your teacher and private conversations'}
          </div>
        </div>

        <div className="px-3 pt-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your chats..."
            className="focus-ring w-full bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-mist text-xs font-mono">
            {search.trim()
              ? `${filteredConversations.length} of ${conversations.length}`
              : `${conversations.length} conversation${
                  conversations.length === 1 ? '' : 's'
                }`}
          </span>

          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="focus-ring text-xs text-brass hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto max-h-[28rem]">

          {loading && (
            <div className="px-4 py-5 text-sm text-mist">Loading chats…</div>
          )}

          {!loading && error && (
            <div className="px-4 py-4 text-sm text-coral">{error}</div>
          )}

          {!loading && !error && conversations.length === 0 && (
            <div className="px-4 py-6 text-sm text-mist text-center">
              No conversations yet.
              {selfRole === 'teacher' && (
                <div className="mt-1 text-xs">
                  Start one from a student's profile in the Leaderboard.
                </div>
              )}
            </div>
          )}

          {!loading &&
            !error &&
            conversations.length > 0 &&
            filteredConversations.length === 0 && (
              <div className="px-4 py-5 text-sm text-mist">
                No chats match your search.
              </div>
            )}

          {!loading &&
            filteredConversations.map((person) => {
              const active = selectedId === person.id
              const isTeacher = person.id === teacher?.id
              const label = person.full_name || person.username || 'Unknown user'
              const unread = person.unreadCount > 0

              // "Seen" tick — only meaningful when the last message in
              // this conversation is one this account sent.
              const sentLast = person.lastMessage?.sender_id === selfId
              const seenLast = Boolean(
                sentLast &&
                  person.peerReadAt &&
                  new Date(person.lastMessage.created_at) <=
                    new Date(person.peerReadAt)
              )

              return (
                <button
                  type="button"
                  key={person.id}
                  onPointerDown={(e) => handleRowPointerDown(e, person)}
                  onPointerMove={handleRowPointerMove}
                  onPointerUp={clearRowLongPress}
                  onPointerCancel={clearRowLongPress}
                  onPointerLeave={clearRowLongPress}
                  onContextMenu={(e) => handleRowContextMenu(e, person)}
                  onClick={() => handleRowClick(person)}
                  className={`w-full text-left px-4 py-3 border-b border-line transition-colors ${
                    active ? 'bg-panel-2' : 'hover:bg-panel-2'
                  }`}
                >
                  <div className="flex items-center gap-3">

                    {person.avatar_url ? (
                      <img
                        src={person.avatar_url}
                        alt={label}
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full border border-line bg-ink flex items-center justify-center text-sm font-medium text-brass shrink-0">
                        {label.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">

                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm truncate ${
                            unread ? 'font-semibold text-paper' : 'font-medium text-paper'
                          }`}
                        >
                          {label}
                        </span>

                        {person.lastMessage?.created_at && (
                          <span
                            className={`flex items-center gap-1 text-[10px] font-mono shrink-0 ${
                              unread ? 'text-brass' : 'text-mist'
                            }`}
                          >
                            {sentLast && (
                              <span
                                className={seenLast ? 'text-brass' : 'opacity-70'}
                                title={seenLast ? 'Seen' : 'Sent'}
                              >
                                {seenLast ? '✓✓' : '✓'}
                              </span>
                            )}
                            {formatListTime(person.lastMessage.created_at)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <div
                          className={`text-xs truncate ${
                            unread ? 'text-paper-dim' : 'text-mist'
                          }`}
                        >
                          {person.lastMessage
                            ? previewText(person.lastMessage.content)
                            : isTeacher
                            ? 'Teacher'
                            : person.username
                            ? `@${person.username}`
                            : ''}
                        </div>

                        {unread && (
                          <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-brass px-1.5 text-[10px] font-semibold text-onbrass">
                            {person.unreadCount > 99 ? '99+' : person.unreadCount}
                          </span>
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
          ACTIVE CHAT
          ============================================================ */}

      <section className="flex-1 min-w-0">

        {selectedPerson ? (
          <Chat
            selfId={selfId}
            peerId={selectedPerson.id}
            peerName={selectedPerson.full_name || selectedPerson.username || 'User'}
            targetMessageId={initialMessageId}
            onDeleted={handleChatDeleted}
          />
        ) : (
          <div className="h-[28rem] bg-panel border border-line rounded-lg flex items-center justify-center text-mist text-center px-6">
            {selfRole === 'teacher'
              ? "Select a conversation, or open a student's profile from the Leaderboard to start a new one."
              : 'Select a conversation to start chatting.'}
          </div>
        )}

      </section>

      {/* ============================================================
          LONG-PRESS / RIGHT-CLICK PREVIEW POPOVER
          ============================================================ */}

      {previewPeer && (
        <>
          <div
            className="fixed inset-0 z-[90]"
            onClick={() => setPreviewPeer(null)}
          />

          <div
            className="fixed z-[100] flex flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
            style={{
              top: previewPosition?.top,
              left: previewPosition?.left,
              width: PREVIEW_WIDTH,
              maxHeight: PREVIEW_MAX_HEIGHT,
            }}
            onClick={(e) => e.stopPropagation()}
          >

            <div className="flex items-center gap-3 border-b border-line bg-panel-2/60 px-4 py-3">
              {previewPeer.avatar_url ? (
                <img
                  src={previewPeer.avatar_url}
                  alt={previewPeer.full_name}
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brass text-sm font-semibold text-onbrass">
                  {String(previewPeer.full_name || '?').charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0">
                <div className="truncate font-display text-sm text-paper">
                  {previewPeer.full_name || previewPeer.username || 'Member'}
                </div>
                <div className="text-[11px] text-mist">
                  {previewPeer.id === teacher?.id ? 'Teacher' : 'Student'}
                </div>
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
                        className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-xs ${
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
                onClick={() => markPreviewRead(previewPeer.unreadCount === 0)}
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-paper hover:bg-panel-2"
              >
                {previewPeer.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}
              </button>

              <button
                type="button"
                onClick={() => requestDeleteFromPreview(previewPeer, 'me')}
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-coral hover:bg-panel-2"
              >
                Delete for me
              </button>

              {selfRole === 'teacher' && (
                <button
                  type="button"
                  onClick={() => requestDeleteFromPreview(previewPeer, 'everyone')}
                  className="block w-full rounded-md px-3 py-2 text-left text-sm text-coral hover:bg-panel-2"
                >
                  Delete for everyone
                </button>
              )}
            </div>

          </div>
        </>
      )}

    </div>
  )
}
