import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Chat, { ChatAvatar, ChatGlyph } from './Chat'
import Icon from './Icon'
import ConfirmModal from './ConfirmModal'
import { useSessionState } from '../lib/sessionState'

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

// Same one-line preview, built from what get_private_chat_list()
// (migration_72) returns — the RPC only sends the kind + a short
// text/file name, never the whole message (2026-10-06).
function previewFromKind(kind, preview) {
  if (kind === 'image') return 'Photo'
  if (kind === 'video') return 'Video'
  if (kind === 'video_note') return 'Video message'
  if (kind === 'audio') return 'Voice message'
  if (kind === 'file') return `${preview || 'File'}`
  return preview || ''
}

// The RPC isn't there until migration_72 is applied — PostgREST
// answers PGRST202 (404). Until then the list keeps using the old
// queries instead of breaking (2026-10-06).
function isMissingRpc(err) {
  if (!err) return false
  return (
    err.code === 'PGRST202' ||
    err.code === '42883' ||
    err.status === 404 ||
    /could not find the function|does not exist/i.test(err.message || '')
  )
}

// Every id of one private conversation, paged (PostgREST returns at
// most 1000 rows per request) — for "Delete for me" on a whole chat.
async function fetchConversationIds(selfId, peerId) {
  const ids = []
  const PAGE = 1000

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('messages')
      .select('id')
      .or(
        `and(sender_id.eq.${selfId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${selfId})`
      )
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) throw error

    ;(data || []).forEach((row) => ids.push(row.id))

    if (!data || data.length < PAGE) break
  }

  return ids
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
  // The open conversation is remembered across a refresh (Jasur,
  // 2026-09-30) — see lib/sessionState.js. A notification tap
  // (initialPeerId) still wins, via the effect below.
  const [selectedId, setSelectedId] = useSessionState(`ielts:${selfId}:privateChat:peerId`, initialPeerId)
  const [selectedName, setSelectedName] = useSessionState(`ielts:${selfId}:privateChat:peerName`, initialPeerName)

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

  // 2026-10-06: the list used to set loading=true (blanking it) and
  // re-download every message ever on each new message / read receipt.
  // Now: one cheap RPC (migration_72), profiles cached, the "Loading…"
  // state only on the very first load, and realtime refreshes debounced.
  const rpcMissingRef = useRef(false)
  const loadedOnceRef = useRef(false)
  const profilesCacheRef = useRef({})
  const loadSeqRef = useRef(0)
  const refreshTimerRef = useRef(null)
  const loadRef = useRef(null)

  // Old path (before migration_72): every message + markers, summarised
  // in the browser. Kept only as a fallback until the RPC exists.
  const loadSummariesLegacy = async () => {
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
            id: m.id,
            label: previewText(m.content),
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

      return { lastByPeer, unreadByPeer, peerReadMap }
  }

  const loadConversations = async () => {
    if (!selfId) return

    const seq = ++loadSeqRef.current

    if (!loadedOnceRef.current) setLoading(true)

    try {
      let summary = null

      if (!rpcMissingRef.current) {
        const { data: rows, error: rpcError } = await supabase.rpc('get_private_chat_list')

        if (rpcError) {
          if (!isMissingRpc(rpcError)) throw rpcError
          rpcMissingRef.current = true
        } else {
          const lastByPeer = new Map()
          const unreadByPeer = new Map()
          const peerReadMap = {}

          ;(rows || []).forEach((r) => {
            if (!r.peer_id) return

            if (r.last_message_id) {
              lastByPeer.set(r.peer_id, {
                id: r.last_message_id,
                label: previewFromKind(r.last_kind, r.last_preview),
                created_at: r.last_created_at,
                sender_id: r.last_sender_id,
              })
            }

            if (r.unread_count) unreadByPeer.set(r.peer_id, r.unread_count)
            if (r.peer_read_at) peerReadMap[r.peer_id] = r.peer_read_at
          })

          summary = { lastByPeer, unreadByPeer, peerReadMap }
        }
      }

      if (!summary) summary = await loadSummariesLegacy()

      const { lastByPeer, unreadByPeer, peerReadMap } = summary

      const peerIds = [...lastByPeer.keys()]

      // A student always has their teacher available to message, even
      // before a first message exists — same as the app has always
      // done. A teacher only ever sees people they've actually
      // messaged (they start new ones from a student's profile).
      if (selfRole !== 'teacher' && teacher?.id && !peerIds.includes(teacher.id)) {
        peerIds.push(teacher.id)
      }

      if (peerIds.length === 0) {
        if (seq === loadSeqRef.current) {
          setConversations([])
          setError('')
        }
        return
      }

      // Profiles rarely change — only fetch people not seen yet.
      const missing = peerIds.filter((id) => !profilesCacheRef.current[id])

      if (missing.length) {
        const { data: fetched, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url, role')
          .in('id', missing)

        if (profilesError) throw profilesError

        ;(fetched || []).forEach((p) => {
          profilesCacheRef.current[p.id] = p
        })
      }

      const profiles = peerIds
        .map((id) => profilesCacheRef.current[id])
        .filter(Boolean)

      // A slower, older refresh must not overwrite a newer one.
      if (seq !== loadSeqRef.current) return

      const merged = profiles.map((p) => ({
        ...p,
        lastMessage: lastByPeer.get(p.id) || null,
        // The open chat marks itself read; a refresh racing that
        // mark must not flash a badge on it (2026-10-06).
        unreadCount: p.id === selectedId ? 0 : unreadByPeer.get(p.id) || 0,
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
      setError('')
    } catch (err) {
      console.error('Failed to load conversations:', err)
      if (seq === loadSeqRef.current) {
        setError(err?.message || 'Could not load your chats.')
      }
    } finally {
      if (seq === loadSeqRef.current) {
        loadedOnceRef.current = true
        setLoading(false)
      }
    }
  }

  loadRef.current = loadConversations

  // Realtime bursts (a message + its read receipt + …) collapse into one
  // quiet refresh ~500 ms later, without blanking the list.
  const scheduleRefresh = () => {
    clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => loadRef.current?.(), 500)
  }

  useEffect(() => () => clearTimeout(refreshTimerRef.current), [])

  useEffect(() => {
    loadConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId, selfRole, teacher?.id])

  // Keep the list live: a brand new conversation, a bump back to the
  // top, or a fresh unread badge should all appear without needing to
  // leave and reopen this tab.
  useEffect(() => {
    if (!selfId) return

    // Filtered server-side to this account's own messages (2026-10-06)
    // — used to receive every message sent by anyone in the school.
    const channel = supabase
      .channel(`private-chats-${selfId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${selfId}`,
        },
        () => scheduleRefresh()
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=eq.${selfId}`,
        },
        () => scheduleRefresh()
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
        () => scheduleRefresh()
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
      if (mode === 'everyone') {
        // One filtered delete instead of `.in('id', <every id>)` — that
        // list made the request URL too long on long chats (2026-10-06).
        const { error: deleteError } = await supabase
          .from('messages')
          .delete()
          .or(
            `and(sender_id.eq.${selfId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${selfId})`
          )

        if (deleteError) throw deleteError
      } else {
        const ids = await fetchConversationIds(selfId, peerId)

        for (let i = 0; i < ids.length; i += 500) {
          const { error: hideError } = await supabase
            .from('message_deletions')
            .upsert(
              ids.slice(i, i + 500).map((id) => ({ message_id: id, user_id: selfId })),
              { onConflict: 'message_id,user_id', ignoreDuplicates: true }
            )

          if (hideError) throw hideError
        }
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

  const roleLabel = (person) => {
    if (person.id === teacher?.id || person.role === 'teacher') return 'Teacher'
    if (person.role === 'writing_examiner') return 'Writing examiner'
    if (person.role === 'speaking_examiner') return 'Speaking examiner'
    return 'Student'
  }

  return (
    // Study room look (2026-10-07): list + conversation as ONE card that
    // fills the screen; on a phone it shows the list OR the open chat.
    <div
      className={`chat-card flex overflow-hidden rounded-[22px] border border-line bg-panel md:h-[calc(100dvh-196px)] md:min-h-[540px] ${
        selectedPerson ? 'h-[calc(100dvh-196px)] min-h-[440px]' : 'min-h-[320px]'
      }`}
    >

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

      <aside
        className={`${
          selectedPerson ? 'hidden md:flex' : 'flex'
        } w-full shrink-0 flex-col border-line md:w-[300px] md:border-r lg:w-[340px]`}
      >

        <div className="shrink-0 px-4 pb-3 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-paper">Chats</h2>
            <span className="text-xs text-mist">
              {search.trim()
                ? `${filteredConversations.length} of ${conversations.length}`
                : `${conversations.length} conversation${
                    conversations.length === 1 ? '' : 's'
                  }`}
            </span>
          </div>

          <div className="relative mt-3">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist">
              <ChatGlyph name="search" className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
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
        </div>

        <div className="[scrollbar-width:thin] min-h-0 flex-1 overflow-y-auto px-2 pb-2">

          {loading && (
            <div className="space-y-1 px-1 pt-1" aria-label="Loading chats">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
                  <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-panel-2" />
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

          {!loading && !error && conversations.length === 0 && (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-listening-tint text-listening">
                <ChatGlyph name="chat" className="h-7 w-7" />
              </span>
              <div className="mt-3 text-sm font-medium text-paper">No conversations yet</div>
              <div className="mt-1 text-xs leading-5 text-mist">
                {selfRole === 'teacher'
                  ? "Start one from a student's profile in the Leaderboard."
                  : 'Your private chats will appear here.'}
              </div>
            </div>
          )}

          {!loading &&
            !error &&
            conversations.length > 0 &&
            filteredConversations.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-mist">
                No chats match “{search.trim()}”.
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

              // The RPC path hands over a ready-made `label`; the old
              // path also sets it (and `content` where it exists).
              const lastText = person.lastMessage
                ? person.lastMessage.label ?? previewText(person.lastMessage.content)
                : ''

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
                  aria-current={active ? 'true' : undefined}
                  className={`focus-ring flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors ${
                    active ? 'bg-brass text-onbrass' : 'hover:bg-panel-2'
                  }`}
                >
                  <ChatAvatar
                    name={label}
                    url={person.avatar_url}
                    seed={person.id}
                    size="h-11 w-11"
                    className={active ? 'ring-2 ring-onbrass/30' : ''}
                  />

                  <div className="min-w-0 flex-1">

                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`truncate text-sm ${
                            unread ? 'font-semibold' : 'font-medium'
                          } ${active ? 'text-onbrass' : 'text-paper'}`}
                        >
                          {label}
                        </span>
                        {isTeacher && selfRole !== 'teacher' && (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${
                              active ? 'bg-onbrass/15 text-onbrass' : 'bg-speaking-tint text-speaking'
                            }`}
                          >
                            Teacher
                          </span>
                        )}
                      </span>

                      {person.lastMessage?.created_at && (
                        <span
                          className={`flex shrink-0 items-center gap-0.5 text-[11px] ${
                            active ? 'text-onbrass/75' : unread ? 'font-medium text-paper' : 'text-mist'
                          }`}
                        >
                          {sentLast && (
                            <span title={seenLast ? 'Seen' : 'Sent'} aria-label={seenLast ? 'Seen' : 'Sent'}>
                              <ChatGlyph name={seenLast ? 'ticks' : 'tick'} className="h-3.5 w-3.5" strokeWidth={2.2} />
                            </span>
                          )}
                          {formatListTime(person.lastMessage.created_at)}
                        </span>
                      )}
                    </div>

                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <div
                        className={`truncate text-[13px] ${
                          active ? 'text-onbrass/75' : unread ? 'text-paper-dim' : 'text-mist'
                        }`}
                      >
                        {person.lastMessage
                          ? <>{sentLast && <span className={active ? 'text-onbrass' : 'text-paper-dim'}>You: </span>}{lastText}</>
                          : isTeacher
                          ? 'Teacher'
                          : person.username
                          ? `@${person.username}`
                          : ''}
                      </div>

                      {unread && (
                        <span
                          className={`flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
                            active ? 'bg-onbrass text-brass' : 'bg-brass text-onbrass'
                          }`}
                        >
                          {person.unreadCount > 99 ? '99+' : person.unreadCount}
                        </span>
                      )}
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

      <section
        className={`${
          selectedPerson ? 'flex' : 'hidden md:flex'
        } min-w-0 flex-1 flex-col`}
      >

        {selectedPerson ? (
          // key (2026-10-06): switching person remounts the chat so a
          // half-typed draft, voice note, reply or edit can never be
          // sent to the newly selected person.
          <Chat
            key={selectedPerson.id}
            selfId={selfId}
            peerId={selectedPerson.id}
            peerName={selectedPerson.full_name || selectedPerson.username || 'User'}
            targetMessageId={initialMessageId}
            onDeleted={handleChatDeleted}
            embedded
            onBack={() => {
              setSelectedId(null)
              setSelectedName(null)
            }}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-panel-2 px-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-listening-tint text-listening">
              <ChatGlyph name="chat" className="h-8 w-8" />
            </span>
            <div className="mt-4 text-base font-semibold text-paper">Pick a conversation</div>
            <p className="mt-1 max-w-xs text-sm leading-6 text-mist">
              {selfRole === 'teacher'
                ? "Choose a chat on the left, or open a student's profile in the Leaderboard to start a new one."
                : 'Choose a chat on the left to start messaging.'}
            </p>
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
            className="fixed z-[100] flex flex-col overflow-hidden rounded-[22px] border border-line bg-panel shadow-[0_24px_60px_-20px_rgba(31,35,64,0.45)]"
            style={{
              top: previewPosition?.top,
              left: previewPosition?.left,
              width: PREVIEW_WIDTH,
              maxHeight: PREVIEW_MAX_HEIGHT,
            }}
            onClick={(e) => e.stopPropagation()}
          >

            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <ChatAvatar
                name={previewPeer.full_name || previewPeer.username}
                url={previewPeer.avatar_url}
                seed={previewPeer.id}
                size="h-9 w-9"
                text="text-xs"
              />

              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-paper">
                  {previewPeer.full_name || previewPeer.username || 'Member'}
                </div>
                <div className="text-[11px] text-mist">
                  {roleLabel(previewPeer)}
                </div>
              </div>
            </div>

            <div className="[scrollbar-width:thin] min-h-[120px] flex-1 space-y-1.5 overflow-y-auto bg-panel-2 px-3 py-3">
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
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-paper hover:bg-panel-2"
              >
                <Icon name="check" className="h-4 w-4 text-mist" />
                {previewPeer.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}
              </button>

              <button
                type="button"
                onClick={() => requestDeleteFromPreview(previewPeer, 'me')}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-urgent hover:bg-urgent-tint"
              >
                <Icon name="trash" className="h-4 w-4" />
                Delete for me
              </button>

              {selfRole === 'teacher' && (
                <button
                  type="button"
                  onClick={() => requestDeleteFromPreview(previewPeer, 'everyone')}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-urgent hover:bg-urgent-tint"
                >
                  <Icon name="trash" className="h-4 w-4" />
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
