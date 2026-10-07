import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { compressImageIfNeeded } from '../lib/compressImage'
import ProfileModal from './ProfileModal'
import MessageActionMenu from './MessageActionMenu'
import ReactionPicker from './ReactionPicker'
import VoiceBubble from './VoiceBubble'
import VideoNoteBubble from './VideoNoteBubble'
import ConfirmModal from './ConfirmModal'
import { RoundCameraPreview, RecordedClipPreview } from './RoundCameraPreview'
import { FileBubble, DOCUMENT_ACCEPT } from './chatFiles'
import { useFileDrop, DropOverlay } from '../lib/useFileDrop'
import { fetchAll } from '../lib/fetchAll'
import Icon from './Icon'
import { groupColour } from '../lib/groupLook'

// 2026-10-06: a chat now opens with only its latest 100 messages
// ("Load older messages" fetches the next 100), and reactions/pins are
// fetched for the loaded messages only, 100 ids per request — asking
// for every id at once made the request URL too long on long chats.
const PAGE_SIZE = 100

const chunkIds = (ids, size = 100) => {
  const clean = ids.filter((id) => id && !String(id).startsWith('temp-'))
  const out = []
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size))
  return out
}

const CHAT_ACCEPT = `image/*,video/*,audio/*,${DOCUMENT_ACCEPT}`

// Same upload limit as the group chat.
const MAX_FILE_MB = 25

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '👏']

const MENU_WIDTH = 212
const PICKER_WIDTH = 46 * 6 // matches ReactionPicker's ~6 emoji buttons

// "Today" / "Yesterday" / a short date — the little centered pill
// Telegram shows whenever the conversation crosses into a new day.
function formatDateDivider(value) {
  const date = new Date(value)
  const now = new Date()

  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)

  const startOfDate = new Date(date)
  startOfDate.setHours(0, 0, 0, 0)

  const dayDiff = Math.round(
    (startOfToday - startOfDate) / 86400000
  )

  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'

  const sameYear = date.getFullYear() === now.getFullYear()

  return date.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  })
}


/*
 * Study room chat look (2026-10-07) — small presentational helpers shared
 * by the private chat, the chat lists and (via import) TeacherChat.
 * Glyphs the shared Icon set doesn't have yet (search, back, reply,
 * smile, more, ticks, chat bubble, people).
 */
const GLYPHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  back: <path d="M15 18 9 12l6-6" />,
  reply: <path d="M9 15 4 10l5-5M4 10h10a6 6 0 0 1 6 6v3" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8M9.3 9.8h.01M14.7 9.8h.01" />
    </>
  ),
  more: <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" />,
  tick: <path d="m4.5 12.5 4.5 4.5L19.5 6.5" />,
  ticks: <path d="m1.8 12.8 4.3 4.3 9.6-10.1M11.6 15.9l1.2 1.2 9.5-10.1" />,
  chat: <path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L4 20l1.3-4.3a8 8 0 1 1 15.2-4.2Z" />,
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.6a3.2 3.2 0 0 1 0 6.1M17.5 14.2a5.5 5.5 0 0 1 3 4.8" />
    </>
  ),
}

export function ChatGlyph({ name, className = 'h-4 w-4', strokeWidth = 1.9 }) {
  const body = GLYPHS[name]
  if (!body) return null
  return (
    <svg
      viewBox="0 0 24 24"
      className={`inline-block shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {body}
    </svg>
  )
}

// One soft tint per person, picked from their id — the same five skill
// tints groups use, so a face keeps its colour everywhere.
export function chatTint(seed) {
  const str = String(seed || '')
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  return groupColour(hash % 5)
}

export function chatInitials(name) {
  return (
    String(name || '?')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}

export function ChatAvatar({ name, url, seed, size = 'h-10 w-10', text = 'text-sm', className = '' }) {
  if (url) {
    return <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover ${className}`} />
  }
  const tint = chatTint(seed || name)
  return (
    <span
      className={`${size} ${text} ${tint.tint} ${tint.text} flex shrink-0 items-center justify-center rounded-full font-semibold ${className}`}
      aria-hidden="true"
    >
      {chatInitials(name)}
    </span>
  )
}

// Reply / react / more beside a bubble. Two copies are rendered: on a
// computer (hover) they float next to the bubble when the row is hovered
// or focused; on a touch screen they sit under the bubble once the
// bubble has been tapped (the row gets data-actions="on").
export const CHAT_ACTIONS_FLOAT =
  'absolute top-1/2 hidden -translate-y-1/2 items-center opacity-0 pointer-events-none transition-opacity [@media(hover:hover)]:flex group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto'
export const CHAT_ACTIONS_TOUCH =
  'mt-1 hidden items-center gap-1 group-data-[actions=on]/row:flex [@media(hover:hover)]:!hidden'
export const CHAT_ACTION_BUTTON =
  'focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:bg-panel hover:text-paper'
export const CHAT_ACTION_CHIP =
  'focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-panel text-paper-dim'

// Round icon button used in chat headers and the composer.
export const CHAT_ICON_BUTTON =
  'focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-paper-dim transition-colors hover:bg-panel-2 hover:text-paper disabled:opacity-40'

export default function Chat({
  selfId,
  peerId,
  peerName,
  targetMessageId = null,
  onDeleted = null,
  // Optional (2026-10-07): `embedded` drops the chat's own card so it can
  // sit inside a list + conversation card; `onBack` shows a back arrow in
  // the header on phones (list OR conversation there).
  embedded = false,
  onBack = null,
}) {
  const [messages, setMessages] = useState([])
  const [reactions, setReactions] = useState({})
  const [selfRole, setSelfRole] = useState('student')

  // Just the peer's photo, kept fresh independently of the message
  // list, for the chat header. The full profile (bio, etc.) is
  // fetched by ProfileModal itself, on demand, when it's opened.
  const [peerAvatarUrl, setPeerAvatarUrl] = useState('')
  const [viewingProfileId, setViewingProfileId] = useState(null)

  // How far the PEER has read this conversation — the flip side of
  // markRead() below, which is how far THIS account has read it. This
  // is what lets a message this user sent show a "seen" checkmark and
  // the time it was read, Telegram-style. Null until the peer has ever
  // opened this chat, or after they "mark as unread" it.
  const [peerReadAt, setPeerReadAt] = useState(null)

  // Messages this user has hidden from their own view only — "Delete
  // for me". The row stays in the database for the other person; we
  // just never render it here.
  const [hiddenIds, setHiddenIds] = useState(new Set())

  // Pinned messages, newest pin first — either person in a private
  // chat can pin, same as a real Telegram DM. `pinIndex` is which
  // pinned message the banner is currently showing, for chats with
  // more than one pin.
  const [pins, setPins] = useState([])
  const [pinIndex, setPinIndex] = useState(0)

  // Telegram-style multi-select: pick several messages, then delete
  // them all in one go instead of one at a time.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())

  // The single floating "⋯" menu — which message it's for (null when
  // closed) and where on screen to draw it. Fixed-position and drawn
  // once here rather than once per message, so it can never be
  // clipped by the chat panel around it.
  const [menuMessage, setMenuMessage] = useState(null)
  const [menuPosition, setMenuPosition] = useState(null)

  // Same idea, for the "+" reaction picker — one shared floating
  // popup instead of a native <details> per message, so it can
  // actually be told to close (see ReactionPicker.jsx).
  const [pickerMessage, setPickerMessage] = useState(null)
  const [pickerPosition, setPickerPosition] = useState(null)

  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingKind, setRecordingKind] = useState(null)
  const [recordSeconds, setRecordSeconds] = useState(0)

  // The just-finished recording, held here for review before it's
  // actually sent — Telegram-style "listen back, then send or
  // discard" instead of firing it off the moment you stop recording.
  const [recordedBlob, setRecordedBlob] = useState(null)

  const [error, setError] = useState('')

  const [replyingTo, setReplyingTo] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')

  const [highlightedMessageId, setHighlightedMessageId] =
    useState(null)

  const [confirmDialog, setConfirmDialog] = useState(null)

  // The small "Delete chat" menu opened from the trash icon in the
  // header — separate from menuMessage/menuPosition above, which is
  // for the per-message "⋯" menu instead.
  const [chatMenuOpen, setChatMenuOpen] = useState(false)

  // Which message's reply / react / options buttons are showing on a
  // touch screen (tap a bubble to reveal them; hover does it on desktop).
  const [actionsFor, setActionsFor] = useState(null)

  // Paging (2026-10-06) — see PAGE_SIZE above.
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const scrollBoxRef = useRef(null)
  const keepScrollRef = useRef(null)
  const pinsRef = useRef([])
  pinsRef.current = pins

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const recordStreamRef = useRef(null)
  const recordTimerRef = useRef(null)

  // Lets the pin realtime handler always see the current message
  // list without having to resubscribe every time a message arrives.
  const messagesRef = useRef([])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Stop any in-progress recording's mic/camera and timer if this chat
  // is closed (peer switched, component unmounted) mid-recording,
  // rather than leaving the stream open in the background.
  useEffect(() => {
    return () => {
      clearInterval(recordTimerRef.current)

      recordStreamRef.current
        ?.getTracks()
        .forEach((track) => track.stop())
    }
  }, [])

  /*
   * ============================================================
   * PARSE MESSAGE CONTENT
   * ============================================================
   * A private message's `content` column doubles as either plain
   * text or a JSON blob describing a photo/video/voice note/file
   * (there's no separate media_url column here, unlike group
   * chat). Editing only ever applies to the plain-text case.
   * ============================================================
   */

  const parseMessage = (content) => {
    if (!content) {
      return {
        type: 'text',
        text: '',
      }
    }

    try {
      const parsed = JSON.parse(content)

      if (parsed && parsed.type && parsed.url) {
        return parsed
      }
    } catch {
      // Normal text message.
    }

    return {
      type: 'text',
      text: content,
    }
  }

  const previewFor = (message) => {
    if (!message) return ''

    const parsed = parseMessage(message.content)

    if (parsed.type === 'image') return 'Photo'
    if (parsed.type === 'video') return 'Video'
    if (parsed.type === 'video_note') return 'Video message'
    if (parsed.type === 'audio') return 'Voice message'
    if (parsed.type === 'file') {
      return `${parsed.name || 'File'}`
    }

    return parsed.text
  }

  /*
   * ============================================================
   * LOAD
   * ============================================================
   */

  // Reactions for the given messages only, 100 ids per request.
  // merge=true adds to what's already loaded (older page); otherwise
  // replaces it (first load).
  const loadReactions = async (messageRows, { merge = false } = {}) => {
    const ids = (messageRows || [])
      .map((m) => m.id)
      .filter(Boolean)

    if (!ids.length) {
      if (!merge) setReactions({})
      return
    }

    const grouped = {}

    for (const part of chunkIds(ids)) {
      const { data, error: reactionsError } = await supabase
        .from('message_reactions')
        .select('*')
        .in('message_id', part)

      if (reactionsError) {
        console.error(
          'Reaction loading error:',
          reactionsError
        )
        return
      }

      ;(data || []).forEach((reaction) => {
        if (!grouped[reaction.message_id]) {
          grouped[reaction.message_id] = []
        }

        grouped[reaction.message_id].push(reaction)
      })
    }

    setReactions((prev) => (merge ? { ...prev, ...grouped } : grouped))
  }

  // "Delete for me" markers, for the loaded messages only (the old
  // query read every marker this account ever made, which stops at
  // the 1000-row API cap) — 2026-10-06.
  const loadHidden = async (ids, { merge = false } = {}) => {
    const found = []

    for (const part of chunkIds(ids)) {
      const { data, error: deletionsError } = await supabase
        .from('message_deletions')
        .select('message_id')
        .eq('user_id', selfId)
        .in('message_id', part)

      if (deletionsError) {
        console.error('Deletion markers loading error:', deletionsError)
        return
      }

      ;(data || []).forEach((row) => found.push(row.message_id))
    }

    setHiddenIds((prev) => {
      const next = merge ? new Set(prev) : new Set()
      found.forEach((id) => next.add(id))
      return next
    })
  }

  // Private chat had no equivalent of group chat's "last read" marker
  // until now — this is what lets the conversation list show/clear an
  // unread badge for this peer. Called once whenever this chat is
  // opened, and again on every incoming message while it stays open,
  // so the badge never lingers on a conversation the user is actively
  // looking at.
  const markRead = async () => {
    if (!selfId || !peerId) return

    const { error: readError } = await supabase
      .from('private_chat_reads')
      .upsert(
        {
          user_id: selfId,
          peer_id: peerId,
          last_read_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,peer_id' }
      )

    if (readError) {
      console.error('Failed to mark chat as read:', readError)
    }
  }

  // The read-receipt equivalent for the OTHER direction: how far has
  // the peer read what THIS account sent. Needs migration_26's widened
  // policy on private_chat_reads (select is normally locked to your
  // own rows only) since this reads the peer's row, not this user's.
  const loadPeerReadState = async () => {
    if (!selfId || !peerId) return

    const { data, error: readStateError } = await supabase
      .from('private_chat_reads')
      .select('last_read_at')
      .eq('user_id', peerId)
      .eq('peer_id', selfId)
      .maybeSingle()

    if (readStateError) {
      console.error('Failed to load peer read state:', readStateError)
      return
    }

    setPeerReadAt(data?.last_read_at || null)
  }

  // Pins among the loaded messages, 100 ids per request (2026-10-06).
  const loadPins = async (messageIds) => {
    const ids =
      messageIds && messageIds.length
        ? messageIds
        : messagesRef.current.map((m) => m.id)

    const parts = chunkIds(ids)

    if (!parts.length) {
      setPins([])
      return
    }

    const all = []

    for (const part of parts) {
      const { data, error: pinsError } = await supabase
        .from('message_pins')
        .select('*')
        .in('message_id', part)

      if (pinsError) {
        console.error('Pin loading error:', pinsError)
        return
      }

      all.push(...(data || []))
    }

    all.sort((a, b) => new Date(b.pinned_at) - new Date(a.pinned_at))
    setPins(all)
  }

  const pairFilter = `and(sender_id.eq.${selfId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${selfId})`

  // "Load older messages" — the next 100 before the oldest loaded one,
  // keeping the reader's scroll position (2026-10-06).
  const loadOlder = async () => {
    if (loadingOlder) return

    const oldest = messagesRef.current.find((m) => !m._optimistic)
    if (!oldest) return

    setLoadingOlder(true)

    try {
      const { data, error: olderError } = await supabase
        .from('messages')
        .select('*')
        .or(pairFilter)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)

      if (olderError) throw olderError

      const older = (data || []).slice().reverse()
      setHasOlder((data || []).length === PAGE_SIZE)

      if (!older.length) return

      const box = scrollBoxRef.current
      if (box) {
        keepScrollRef.current = {
          height: box.scrollHeight,
          top: box.scrollTop,
        }
      }

      const known = new Set(messagesRef.current.map((m) => m.id))
      const fresh = older.filter((m) => !known.has(m.id))
      const allIds = [
        ...fresh.map((m) => m.id),
        ...messagesRef.current.map((m) => m.id),
      ]

      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id))
        return [...older.filter((m) => !ids.has(m.id)), ...prev]
      })

      await loadReactions(fresh, { merge: true })
      await loadHidden(fresh.map((m) => m.id), { merge: true })
      await loadPins(allIds)
    } catch (err) {
      console.error('Failed to load older messages:', err)
      setError(err?.message || 'Could not load older messages.')
    } finally {
      setLoadingOlder(false)
    }
  }

  useEffect(() => {
    if (!selfId) return

    let active = true

    supabase
      .from('profiles')
      .select('role')
      .eq('id', selfId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setSelfRole(data?.role || 'student')
      })

    return () => {
      active = false
    }
  }, [selfId])

  useEffect(() => {
    if (!peerId) return

    let active = true

    supabase
      .from('profiles')
      .select('avatar_url')
      .eq('id', peerId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setPeerAvatarUrl(data?.avatar_url || '')
      })

    return () => {
      active = false
    }
  }, [peerId])

  useEffect(() => {
    if (!peerId) return

    let active = true

    const load = async () => {
      // Latest PAGE_SIZE messages only (2026-10-06) — newest first from
      // the server, flipped to oldest-first for display.
      const { data, error: loadError } = await supabase
        .from('messages')
        .select('*')
        .or(pairFilter)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)

      if (loadError) {
        console.error('Failed to load messages:', loadError)
        return
      }

      if (!active) return

      let rows = (data || []).slice().reverse()
      const more = (data || []).length === PAGE_SIZE

      // A notification can point at a message older than the latest
      // page — load from that message up to the page so it can be
      // scrolled to and highlighted.
      if (
        targetMessageId &&
        more &&
        rows.length &&
        !rows.some((r) => String(r.id) === String(targetMessageId))
      ) {
        const { data: target } = await supabase
          .from('messages')
          .select('created_at')
          .eq('id', targetMessageId)
          .maybeSingle()

        if (target?.created_at) {
          const { data: between } = await supabase
            .from('messages')
            .select('*')
            .or(pairFilter)
            .gte('created_at', target.created_at)
            .lt('created_at', rows[0].created_at)
            .order('created_at', { ascending: true })
            .limit(500)

          if (between?.length) rows = [...between, ...rows]
        }
      }

      if (!active) return

      messagesRef.current = rows
      setMessages(rows)
      setHasOlder(more)

      const ids = rows.map((row) => row.id)

      await loadReactions(rows)
      await loadPins(ids)
      await loadHidden(ids)
      await markRead()
      await loadPeerReadState()
    }

    const belongsToPair = (m) =>
      Boolean(m) &&
      ((m.sender_id === selfId && m.receiver_id === peerId) ||
        (m.sender_id === peerId && m.receiver_id === selfId))

    const isLoaded = (messageId) =>
      messagesRef.current.some((m) => m.id === messageId)

    const handleInsert = (payload) => {
      const m = payload.new

      if (!belongsToPair(m)) return

      setMessages((prev) => {
        if (prev.some((item) => item.id === m.id)) {
          return prev
        }

        return [...prev, m]
      })

      // The chat is open right now, so a message that just
      // arrived FROM the other person should never sit there
      // showing as unread back in the conversation list.
      if (m.sender_id === peerId) {
        markRead()
      }
    }

    const handleUpdate = (payload) => {
      const m = payload.new

      if (!belongsToPair(m)) return

      setMessages((prev) =>
        prev.map((item) =>
          item.id === m.id ? m : item
        )
      )
    }

    load()

    const channel = supabase
      .channel(`chat-${[selfId, peerId].sort().join('-')}`)
      // 2026-10-06: filtered on the server to messages this account
      // sent or received (it used to receive every private message in
      // the school); handleInsert/handleUpdate then keep only this pair.
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=eq.${selfId}`,
        },
        handleInsert
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${selfId}`,
        },
        handleInsert
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=eq.${selfId}`,
        },
        handleUpdate
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${selfId}`,
        },
        handleUpdate
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          setMessages((prev) =>
            prev.filter(
              (item) => item.id !== payload.old.id
            )
          )

          setReactions((prev) => {
            const next = { ...prev }
            delete next[payload.old.id]
            return next
          })

          setReplyingTo((current) =>
            current?.id === payload.old.id ? null : current
          )
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_reactions',
        },
        (payload) => {
          const reaction = payload.new

          // Only reactions on messages loaded here (2026-10-06).
          if (!reaction || !isLoaded(reaction.message_id)) return

          setReactions((prev) => {
            const list = prev[reaction.message_id] || []

            if (list.some((item) => item.id === reaction.id)) return prev

            return {
              ...prev,
              // Replaces this person's optimistic placeholder, if any.
              [reaction.message_id]: [
                ...list.filter(
                  (item) =>
                    !(
                      String(item.id).startsWith('temp-') &&
                      item.user_id === reaction.user_id &&
                      item.reaction === reaction.reaction
                    )
                ),
                reaction,
              ],
            }
          })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'message_reactions',
        },
        (payload) => {
          // 2026-10-06: realtime sends only the primary key of a
          // deleted row (no message_id), so remove it by id wherever
          // it is.
          const deletedId = payload.old?.id
          if (!deletedId) return

          setReactions((prev) => {
            let changed = false
            const next = {}

            Object.entries(prev).forEach(([messageId, list]) => {
              const kept = list.filter((reaction) => reaction.id !== deletedId)
              if (kept.length !== list.length) changed = true
              next[messageId] = kept
            })

            return changed ? next : prev
          })
        }
      )
      .on(
        // Keeps "Delete for me" in sync if the same account has this
        // chat open in another tab or device.
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_deletions',
          filter: `user_id=eq.${selfId}`,
        },
        (payload) => {
          setHiddenIds((prev) => {
            const next = new Set(prev)
            next.add(payload.new.message_id)
            return next
          })
        }
      )
      .on(
        // No cheap way to filter this to just this conversation from
        // the payload alone, so just re-check against the messages
        // we already have loaded — same trick group chat uses for
        // its moderation-activity feed.
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_pins',
        },
        (payload) => {
          // Only when it's a pin on a message loaded here (2026-10-06).
          if (isLoaded(payload.new?.message_id)) loadPins()
        }
      )
      .on(
        // The peer just read (or un-read) this conversation — live
        // "Seen" ticks without needing to reopen the chat. Filtered to
        // rows the peer owns; still double-checked against peer_id
        // since the filter alone can't express the full pair.
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'private_chat_reads',
          filter: `user_id=eq.${peerId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            if (payload.old?.peer_id === selfId) {
              setPeerReadAt(null)
            }
            return
          }

          const row = payload.new

          if (row?.peer_id === selfId) {
            setPeerReadAt(row.last_read_at)
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'message_pins',
        },
        (payload) => {
          // message_id is this table's primary key, so it IS sent.
          const messageId = payload.old?.message_id
          if (
            !messageId ||
            pinsRef.current.some((pin) => pin.message_id === messageId)
          ) {
            loadPins()
          }
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [selfId, peerId])

  useEffect(() => {
    // After "Load older messages", stay where the reader was instead
    // of jumping to the bottom (2026-10-06).
    const keep = keepScrollRef.current
    if (keep && scrollBoxRef.current) {
      keepScrollRef.current = null
      const box = scrollBoxRef.current
      box.scrollTop = box.scrollHeight - keep.height + keep.top
      return
    }

    bottomRef.current?.scrollIntoView({
      behavior: 'smooth',
    })
  }, [messages])

  // Always land on the most recently pinned message when the pin
  // list changes, same as opening a Telegram chat with a new pin.
  useEffect(() => {
    setPinIndex(0)
  }, [pins.length])

  /*
   * Notification navigation: jump straight to a specific message
   * and briefly highlight it, same behavior as group chat.
   */
  useEffect(() => {
    if (!targetMessageId || !messages.length) return

    const exists = messages.some(
      (message) =>
        String(message.id) === String(targetMessageId)
    )

    if (!exists) return

    const timer = setTimeout(() => {
      const element = document.getElementById(
        `private-message-${targetMessageId}`
      )

      if (!element) return

      setHighlightedMessageId(targetMessageId)

      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })

      setTimeout(() => {
        setHighlightedMessageId(null)
      }, 3500)
    }, 300)

    return () => clearTimeout(timer)
  }, [targetMessageId, messages])

  // Same jump-and-briefly-highlight behavior as above, but triggered
  // on demand — used by the pinned-message banner.
  const jumpToMessage = (messageId) => {
    const element = document.getElementById(
      `private-message-${messageId}`
    )

    if (!element) return

    setHighlightedMessageId(messageId)

    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })

    setTimeout(() => {
      setHighlightedMessageId(null)
    }, 3500)
  }

  /*
   * ============================================================
   * SEND / UPLOAD
   * ============================================================
   */

  const sendText = async (e) => {
    e.preventDefault()

    const content = text.trim()

    if (!content || !peerId || sending) {
      return
    }

    setSending(true)
    setError('')
    setText('')

    const payload = {
      sender_id: selfId,
      receiver_id: peerId,
      content,
    }

    if (replyingTo?.id) {
      payload.reply_to_id = replyingTo.id
    }

    // Optimistic bubble: the database write itself is fast (well under
    // a second), but this UI otherwise only ever shows a new message
    // once Supabase's realtime broadcast delivers it back — if that
    // broadcast lags (a lot of channels are open across this app now),
    // your own sent message can sit invisible for a long time even
    // though it saved instantly. Showing it immediately, then
    // reconciling with the real row once the insert resolves (or with
    // whichever arrives first, this or the realtime echo), fixes that
    // without needing realtime to be fast at all.
    const tempId = `temp-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`

    setMessages((prev) => [
      ...prev,
      {
        ...payload,
        id: tempId,
        created_at: new Date().toISOString(),
        _optimistic: true,
      },
    ])

    const { data: inserted, error: sendError } = await supabase
      .from('messages')
      .insert(payload)
      .select()
      .single()

    if (sendError) {
      console.error(sendError)
      setError(sendError.message)
      setText(content)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    } else {
      setReplyingTo(null)

      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId)

        // The realtime echo may have already delivered the real row
        // while this insert was in flight — don't add it twice.
        if (withoutTemp.some((m) => m.id === inserted.id)) {
          return withoutTemp
        }

        return [...withoutTemp, inserted]
      })
    }

    setSending(false)
  }

  // Returns true once the message is sent, false on any failure, so a
  // recorded voice/video note is only thrown away after it was really
  // sent (2026-10-06 — a failed upload used to discard the recording).
  const uploadChatFile = async (incomingFile, options = {}) => {
    if (!incomingFile || !peerId) return false

    // Phone photos are 3-10MB; shrink them in the browser first (same
    // helper as homework uploads) — faster sending, faster loading for
    // the other person. Never fails: returns the original on any error.
    const file = incomingFile.type?.startsWith('image/')
      ? await compressImageIfNeeded(incomingFile)
      : incomingFile

    const { asVideoNote = false } = options

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`Maximum file size is ${MAX_FILE_MB}MB.`)
      return false
    }

    setUploading(true)
    setError('')

    try {
      const extension =
        file.name.includes('.')
          ? file.name.split('.').pop()
          : 'bin'

      const safeExtension = extension
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase()

      // The storage policy on this bucket (shared with homework
      // uploads) requires the path's first folder to be the
      // uploader's own id — (storage.foldername(name))[1] = auth.uid()
      // — so `selfId` has to come first, not "chat".
      const path =
        `${selfId}/chat/${peerId}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${safeExtension}`

      const { error: uploadError } = await supabase
        .storage
        .from('submissions')
        .upload(path, file, {
          upsert: false,
          contentType: file.type || 'application/octet-stream',
        })

      if (uploadError) {
        throw uploadError
      }

      const { data } = supabase
        .storage
        .from('submissions')
        .getPublicUrl(path)

      const url = data?.publicUrl

      if (!url) {
        throw new Error('Could not create the file URL.')
      }

      let type = 'file'

      if (file.type.startsWith('image/')) {
        type = 'image'
      } else if (file.type.startsWith('video/')) {
        type = asVideoNote ? 'video_note' : 'video'
      } else if (file.type.startsWith('audio/')) {
        type = 'audio'
      }

      const messageContent = JSON.stringify({
        type,
        url,
        name: file.name,
        mime: file.type,
      })

      const payload = {
        sender_id: selfId,
        receiver_id: peerId,
        content: messageContent,
      }

      if (replyingTo?.id) {
        payload.reply_to_id = replyingTo.id
      }

      // Same fix as sendText's optimistic bubble — this call site was
      // missed the first time around, which is exactly why a voice
      // message still sat invisible waiting on realtime while a typed
      // "hi" no longer does.
      const tempId = `temp-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`

      setMessages((prev) => [
        ...prev,
        {
          ...payload,
          id: tempId,
          created_at: new Date().toISOString(),
          _optimistic: true,
        },
      ])

      const { data: inserted, error: messageError } = await supabase
        .from('messages')
        .insert(payload)
        .select()
        .single()

      if (messageError) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        throw messageError
      }

      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId)

        if (withoutTemp.some((m) => m.id === inserted.id)) {
          return withoutTemp
        }

        return [...withoutTemp, inserted]
      })

      setReplyingTo(null)
      return true
    } catch (err) {
      console.error(err)
      setError(err.message || 'Could not send the file.')
      return false
    } finally {
      setUploading(false)
    }
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]

    e.target.value = ''

    if (!file) return

    await uploadChatFile(file)
  }

  const startRecording = async (kind = 'audio') => {
    if (recording || uploading) return

    setError('')

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          `${
            kind === 'video' ? 'Video' : 'Voice'
          } recording is not supported by this browser.`
        )
      }

      const constraints =
        kind === 'video'
          ? {
              audio: true,
              video: {
                facingMode: 'user',
                width: { ideal: 480 },
                height: { ideal: 480 },
              },
            }
          : { audio: true }

      const stream =
        await navigator.mediaDevices.getUserMedia(
          constraints
        )

      recordStreamRef.current = stream

      const recorder = new MediaRecorder(stream)

      audioChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      // Stopping the recorder no longer sends anything by itself — it
      // just hands the recording to the review step below (the
      // recordedBlob preview bar), same as Telegram: listen back, then
      // explicitly Send or Discard.
      recorder.onstop = () => {
        const fallbackType =
          kind === 'video' ? 'video/webm' : 'audio/webm'

        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || fallbackType,
        })

        setRecordedBlob(blob)

        stream.getTracks().forEach((track) => {
          track.stop()
        })
      }

      mediaRecorderRef.current = recorder

      recorder.start()

      setRecording(true)
      setRecordingKind(kind)
      setRecordSeconds(0)

      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((value) => value + 1)
      }, 1000)
    } catch (err) {
      console.error(err)
      setError(
        err.message ||
          `Could not start ${
            kind === 'video' ? 'video' : 'voice'
          } recording.`
      )
      setRecording(false)
      setRecordingKind(null)
    }
  }

  const stopRecording = () => {
    clearInterval(recordTimerRef.current)

    const recorder = mediaRecorderRef.current

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }

    setRecording(false)
  }

  const discardRecording = () => {
    setRecordedBlob(null)
    setRecordSeconds(0)
    setRecordingKind(null)
  }

  const sendRecording = async () => {
    if (!recordedBlob) return

    const isVideo = recordingKind === 'video'

    const file = new File(
      [recordedBlob],
      `${isVideo ? 'video-note' : 'voice'}-${Date.now()}.webm`,
      {
        type:
          recordedBlob.type ||
          (isVideo ? 'video/webm' : 'audio/webm'),
      }
    )

    const sent = await uploadChatFile(file, { asVideoNote: isVideo })

    // Keep the recording on failure so it can be sent again
    // (the error is already shown above the composer).
    if (!sent) return

    setRecordedBlob(null)
    setRecordSeconds(0)
    setRecordingKind(null)
  }

  const formatRecordSeconds = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(
      2,
      '0'
    )}`

  /*
   * ============================================================
   * REPLY / EDIT / DELETE / REACT
   * ============================================================
   * Editing is a "you can only edit what YOU wrote" action, full
   * stop — that's how Telegram works, and there's no such thing
   * as an admin editing someone else's message there either.
   *
   * Deleting has two levels, also matching Telegram:
   *  - "Delete for everyone" actually removes the row, so it only
   *    goes to the sender, or to the teacher moderating either side
   *    of the conversation.
   *  - "Delete for me" is available to BOTH people on ANY message —
   *    it just hides that message from your own view; the other
   *    person still sees it untouched.
   * ============================================================
   */

  const canDeleteEveryone = (message) =>
    message.sender_id === selfId || selfRole === 'teacher'

  /*
   * ============================================================
   * DELETE WHOLE CONVERSATION (Telegram's "Delete chat" dialog)
   * ============================================================
   * Separate from deleting individual messages above.
   *  - "Delete for me" hides the entire history from just this
   *    account's own view — the same `message_deletions` marker
   *    already used for a single message, just applied to every
   *    message in this conversation at once. The other person's copy
   *    is completely untouched.
   *  - "Delete for everyone" only shows up for the teacher: it's a
   *    real delete, and a student's own delete permission only ever
   *    covers messages THEY sent (see the "everyone" rule above), so
   *    a student "deleting everyone" would just silently leave the
   *    other side's messages behind — worse than not offering it.
   * Both hand off to the parent (the conversation list) via
   * `onDeleted`, since this component is about to have nothing left
   * to show once its own history is gone.
   * ============================================================
   */

  const requestDeleteConversation = (mode) => {
    setChatMenuOpen(false)

    setConfirmDialog({
      title:
        mode === 'everyone'
          ? `Delete this chat with ${peerName} for everyone?`
          : `Delete this chat with ${peerName}?`,
      message:
        mode === 'everyone'
          ? "This permanently deletes the whole conversation for both of you. This can't be undone."
          : "This removes the conversation from your own chat list. It stays exactly as-is for the other person.",
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => doDeleteConversation(mode),
    })
  }

  // 2026-10-06: only the latest page is loaded now, so the whole
  // conversation is addressed on the server instead of by loaded ids.
  const doDeleteConversation = async (mode) => {
    try {
      if (mode === 'everyone') {
        const { error: deleteError } = await supabase
          .from('messages')
          .delete()
          .or(pairFilter)

        if (deleteError) throw deleteError
      } else {
        const { data: rows, error: idsError } = await fetchAll(() =>
          supabase
            .from('messages')
            .select('id')
            .or(pairFilter)
            .order('id')
        )

        if (idsError) throw idsError

        const ids = (rows || []).map((r) => r.id)

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

      onDeleted?.(peerId, mode)
    } catch (err) {
      console.error('Failed to delete conversation:', err)
      setError(err?.message || 'Could not delete this conversation.')
    }
  }

  const canEdit = (message) =>
    message.sender_id === selfId &&
    parseMessage(message.content).type === 'text'

  const startReply = (message) => {
    setReplyingTo(message)

    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const startEdit = (message) => {
    if (!canEdit(message)) return

    setEditingId(message.id)
    setEditingText(message.content || '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingText('')
  }

  const saveEdit = async (message) => {
    const content = editingText.trim()

    if (!content) return

    const { error: editError } = await supabase
      .from('messages')
      .update({
        content,
        edited_at: new Date().toISOString(),
      })
      .eq('id', message.id)

    if (editError) {
      setError(editError.message)
      return
    }

    setEditingId(null)
    setEditingText('')
  }

  const deleteForEveryone = (message) => {
    if (!canDeleteEveryone(message)) return

    setConfirmDialog({
      title: 'Delete this message for everyone?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => doDeleteForEveryone(message),
    })
  }

  const doDeleteForEveryone = async (message) => {
    // Same reasoning as sendText's optimistic bubble: the delete itself
    // is fast, but this view otherwise waits on a realtime DELETE event
    // to actually remove the bubble, which can lag well behind the
    // write completing. Remove it immediately; put it back only if the
    // delete itself turns out to have failed.
    setMessages((prev) => prev.filter((m) => m.id !== message.id))

    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', message.id)

    if (deleteError) {
      setError(deleteError.message)

      setMessages((prev) =>
        prev.some((m) => m.id === message.id)
          ? prev
          : [...prev, message].sort(
              (a, b) => new Date(a.created_at) - new Date(b.created_at)
            )
      )
    }
  }

  const deleteForMe = (message) => {
    setConfirmDialog({
      title: 'Remove this message from your view?',
      message: `Remove this message from your side of the chat? ${
        peerName || 'The other person'
      } will still see it.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => doDeleteForMe(message),
    })
  }

  const doDeleteForMe = async (message) => {
    // Optimistic: hide it immediately, then persist the marker so it
    // stays hidden next time this chat loads.
    setHiddenIds((prev) => {
      const next = new Set(prev)
      next.add(message.id)
      return next
    })

    const { error: hideError } = await supabase
      .from('message_deletions')
      .upsert(
        { message_id: message.id, user_id: selfId },
        { onConflict: 'message_id,user_id', ignoreDuplicates: true }
      )

    if (hideError) {
      console.error(hideError)
      setError(hideError.message)

      // Roll back so the message reappears rather than silently
      // vanishing if the write actually failed.
      setHiddenIds((prev) => {
        const next = new Set(prev)
        next.delete(message.id)
        return next
      })
    }
  }

  /*
   * ============================================================
   * PIN / UNPIN / COPY
   * ============================================================
   * Either person can pin in a private chat — there's no "admin"
   * side of a 1:1 conversation, same as a real Telegram DM.
   * ============================================================
   */

  const isPinned = (messageId) =>
    pins.some((pin) => pin.message_id === messageId)

  const pinMessage = async (message) => {
    const { error: pinError } = await supabase
      .from('message_pins')
      .upsert(
        { message_id: message.id, pinned_by: selfId },
        { onConflict: 'message_id' }
      )

    if (pinError) {
      setError(pinError.message)
    }
  }

  const unpinMessage = async (messageId) => {
    const { error: unpinError } = await supabase
      .from('message_pins')
      .delete()
      .eq('message_id', messageId)

    if (unpinError) {
      setError(unpinError.message)
    }
  }

  const copyMessageText = async (message) => {
    const parsed = parseMessage(message.content)

    if (parsed.type !== 'text' || !parsed.text) return

    try {
      await navigator.clipboard.writeText(parsed.text)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }

  /*
   * ============================================================
   * "⋯" MESSAGE MENU
   * ============================================================
   * One floating menu, positioned from wherever the "⋯" that opened
   * it actually sits on screen — see MessageActionMenu.jsx for why
   * this replaced the old per-message dropdown.
   */

  const openMessageMenu = (e, message) => {
    const rect = e.currentTarget.getBoundingClientRect()

    const left = Math.min(
      rect.left,
      window.innerWidth - MENU_WIDTH - 8
    )

    const top = Math.min(
      rect.bottom + 6,
      window.innerHeight - 260
    )

    setMenuMessage(message)
    setMenuPosition({ top: Math.max(8, top), left: Math.max(8, left) })
  }

  const closeMessageMenu = () => {
    setMenuMessage(null)
    setMenuPosition(null)
  }

  const openReactionPicker = (e, message) => {
    const rect = e.currentTarget.getBoundingClientRect()

    const left = Math.min(
      rect.left,
      window.innerWidth - PICKER_WIDTH - 8
    )

    const top = Math.min(
      rect.top - 54,
      window.innerHeight - 60
    )

    setPickerMessage(message)
    setPickerPosition({
      top: Math.max(8, top),
      left: Math.max(8, left),
    })
  }

  const closeReactionPicker = () => {
    setPickerMessage(null)
    setPickerPosition(null)
  }

  /*
   * ============================================================
   * MULTI-SELECT DELETE
   * ============================================================
   */

  const startSelecting = (messageId) => {
    setSelectMode(true)
    setSelectedIds(new Set([messageId]))
    setError('')
  }

  const toggleSelected = (messageId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)

      if (next.has(messageId)) {
        next.delete(messageId)
      } else {
        next.add(messageId)
      }

      return next
    })
  }

  const cancelSelecting = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  /*
   * ============================================================
   * SWIPE TO REPLY + LONG-PRESS TO SELECT
   * (Telegram-style: drag a bubble sideways to reply to it,
   * long-press on touch — or right-click on desktop — to jump
   * straight into select mode instead of going through the "⋯"
   * menu first.)
   * ============================================================
   */

  const SWIPE_THRESHOLD = 56
  const SWIPE_MAX = 80
  const LONG_PRESS_MS = 450
  const MOVE_CANCEL_PX = 10

  const gestureRef = useRef({
    id: null,
    startX: 0,
    startY: 0,
    dx: 0,
    active: false,
    longPressTimer: null,
    longPressFired: false,
  })

  const [swipeVisual, setSwipeVisual] = useState({
    id: null,
    dx: 0,
  })

  const clearLongPressTimer = () => {
    if (gestureRef.current.longPressTimer) {
      clearTimeout(gestureRef.current.longPressTimer)
      gestureRef.current.longPressTimer = null
    }
  }

  const handleBubblePointerDown = (e, message) => {
    if (selectMode) return
    if (editingId === message.id) return
    if (e.pointerType === 'mouse' && e.button !== 0) return

    // Don't hijack drags/holds that start on a real control inside
    // the bubble (the edit "Save" button, video/audio player
    // controls, etc.) — only the bubble's own background should
    // start a swipe or long-press.
    if (
      e.target.closest(
        'button, input, textarea, video, audio, a'
      )
    ) {
      return
    }

    // Keep receiving pointermove/up even if a fast drag carries the
    // cursor outside this (possibly narrow) bubble — otherwise a
    // quick swipe on a short message can get cut off early.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture isn't available for this pointer — the
      // gesture still works, it's just less forgiving on fast drags.
    }

    gestureRef.current = {
      id: message.id,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      active: true,
      longPressTimer: null,
      longPressFired: false,
    }

    if (e.pointerType !== 'mouse') {
      gestureRef.current.longPressTimer = setTimeout(() => {
        const g = gestureRef.current

        if (g.id === message.id && g.active) {
          g.longPressFired = true
          g.active = false

          if (navigator.vibrate) navigator.vibrate(12)

          startSelecting(message.id)
          setSwipeVisual({ id: null, dx: 0 })
        }
      }, LONG_PRESS_MS)
    }
  }

  const handleBubblePointerMove = (e, message) => {
    const g = gestureRef.current

    if (!g.active || g.id !== message.id) return

    const rawDx = e.clientX - g.startX
    const dy = e.clientY - g.startY

    if (
      g.longPressTimer &&
      (Math.abs(rawDx) > MOVE_CANCEL_PX ||
        Math.abs(dy) > MOVE_CANCEL_PX)
    ) {
      clearLongPressTimer()
    }

    // Only treat this as a horizontal swipe once it's clearly more
    // sideways than vertical, so scrolling the message list still
    // works normally on touch screens.
    if (Math.abs(rawDx) <= Math.abs(dy)) return

    const dx = Math.max(
      -SWIPE_MAX,
      Math.min(SWIPE_MAX, rawDx)
    )
    g.dx = dx
    setSwipeVisual({ id: message.id, dx })
  }

  const endBubbleGesture = (message, commit) => {
    const g = gestureRef.current

    clearLongPressTimer()

    const wasActive = g.id === message.id
    const dx = g.dx
    const longPressFired = g.longPressFired

    gestureRef.current = {
      id: null,
      startX: 0,
      startY: 0,
      dx: 0,
      active: false,
      longPressTimer: null,
      longPressFired: false,
    }

    if (!wasActive || longPressFired) return

    if (commit && Math.abs(dx) >= SWIPE_THRESHOLD) {
      setReplyingTo(message)
      setTimeout(() => inputRef.current?.focus(), 50)
    }

    setSwipeVisual({ id: message.id, dx: 0 })
    setTimeout(() => {
      setSwipeVisual((prev) =>
        prev.id === message.id
          ? { id: null, dx: 0 }
          : prev
      )
    }, 160)
  }

  const handleBubblePointerUp = (e, message) =>
    endBubbleGesture(message, true)

  const handleBubblePointerCancel = (e, message) =>
    endBubbleGesture(message, false)

  const handleBubbleContextMenu = (e, message) => {
    if (selectMode) return
    if (editingId === message.id) return

    // Let a real right-click on a video/audio control (e.g. "Save
    // video as…") through instead of hijacking it.
    if (e.target.closest('video, audio')) return

    e.preventDefault()
    startSelecting(message.id)
  }

  const bulkDeleteForMe = () => {
    const ids = [...selectedIds]

    if (!ids.length) return

    setConfirmDialog({
      title: 'Remove these messages from your view?',
      message: `Remove ${ids.length} message${
        ids.length > 1 ? 's' : ''
      } from your side of the chat? ${
        peerName || 'The other person'
      } will still see ${
        ids.length > 1 ? 'them' : 'it'
      }.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => doBulkDeleteForMe(ids),
    })
  }

  const doBulkDeleteForMe = async (ids) => {
    setHiddenIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })

    const { error: bulkHideError } = await supabase
      .from('message_deletions')
      .upsert(
        ids.map((id) => ({
          message_id: id,
          user_id: selfId,
        })),
        { onConflict: 'message_id,user_id', ignoreDuplicates: true }
      )

    if (bulkHideError) {
      setError(bulkHideError.message)
    }

    cancelSelecting()
  }

  const bulkDeleteForEveryone = () => {
    const ids = [...selectedIds]

    if (!ids.length) return

    setConfirmDialog({
      title: 'Delete these messages for everyone?',
      message: `Delete ${ids.length} message${
        ids.length > 1 ? 's' : ''
      } for everyone?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => doBulkDeleteForEveryone(ids),
    })
  }

  const doBulkDeleteForEveryone = async (ids) => {
    const removed = messagesRef.current.filter((m) => ids.includes(m.id))

    setMessages((prev) => prev.filter((m) => !ids.includes(m.id)))

    const { error: bulkDeleteError } = await supabase
      .from('messages')
      .delete()
      .in('id', ids)

    if (bulkDeleteError) {
      setError(bulkDeleteError.message)

      setMessages((prev) => {
        const merged = [
          ...prev,
          ...removed.filter((m) => !prev.some((p) => p.id === m.id)),
        ]

        return merged.sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at)
        )
      })
    }

    cancelSelecting()
  }

  // Only one reaction per person per message, like Telegram — picking
  // a new emoji swaps out whichever one you already had, rather than
  // stacking up multiple reactions from the same person. mine below
  // covers every reaction this user has on this message, not just a
  // same-emoji match, so a leftover second reaction from before this
  // rule existed also gets cleaned up the next time they react here.
  // 2026-10-06: the change shows immediately (optimistic) and is
  // rolled back if the server refuses it.
  const toggleReaction = async (message, reaction) => {
    const mine = (reactions[message.id] || []).filter(
      (item) => item.user_id === selfId
    )

    const existingSame = mine.find(
      (item) => item.reaction === reaction
    )

    const mineIds = mine.map((item) => item.id)

    const placeholder = existingSame
      ? null
      : {
          id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          message_id: message.id,
          user_id: selfId,
          reaction,
          created_at: new Date().toISOString(),
        }

    setReactions((prev) => ({
      ...prev,
      [message.id]: [
        ...(prev[message.id] || []).filter((item) => !mineIds.includes(item.id)),
        ...(placeholder ? [placeholder] : []),
      ],
    }))

    const restoreMine = () =>
      setReactions((prev) => {
        const list = (prev[message.id] || []).filter(
          (item) => item.id !== placeholder?.id
        )
        const missing = mine.filter((item) => !list.some((r) => r.id === item.id))
        return { ...prev, [message.id]: [...list, ...missing] }
      })

    const serverIds = mineIds.filter((id) => !String(id).startsWith('temp-'))

    if (serverIds.length) {
      const { error: reactionError } = await supabase
        .from('message_reactions')
        .delete()
        .in('id', serverIds)

      if (reactionError) {
        setError(reactionError.message)
        restoreMine()
        return
      }
    }

    // Clicking the reaction you already had just removes it (that's
    // the "take it back" case) — anything else replaces it with the
    // new one.
    if (!placeholder) {
      return
    }

    const { data: inserted, error: reactionError } = await supabase
      .from('message_reactions')
      .insert({
        message_id: message.id,
        user_id: selfId,
        reaction,
      })
      .select()
      .single()

    if (reactionError) {
      setError(reactionError.message)
      setReactions((prev) => ({
        ...prev,
        [message.id]: (prev[message.id] || []).filter(
          (item) => item.id !== placeholder.id
        ),
      }))
      return
    }

    setReactions((prev) => {
      const list = (prev[message.id] || []).filter(
        (item) => item.id !== placeholder.id
      )
      if (!inserted || list.some((item) => item.id === inserted.id)) {
        return { ...prev, [message.id]: list }
      }
      return { ...prev, [message.id]: [...list, inserted] }
    })
  }

  const reactionCount = (messageId, reaction) =>
    (reactions[messageId] || []).filter(
      (item) => item.reaction === reaction
    ).length

  const hasReaction = (messageId, reaction) =>
    (reactions[messageId] || []).some(
      (item) =>
        item.user_id === selfId && item.reaction === reaction
    )

  // Only two people can ever react in a private chat, so this doesn't
  // need a name lookup — just tell "you" apart from the other person.
  const reactedByLabel = (messageId, reaction) =>
    (reactions[messageId] || [])
      .filter((item) => item.reaction === reaction)
      .map((item) =>
        item.user_id === selfId ? 'You' : peerName || 'They'
      )
      .join(', ')

  const getReply = (message) => {
    if (!message.reply_to_id) return null

    return messages.find(
      (item) => item.id === message.reply_to_id
    )
  }

  /*
   * ============================================================
   * RENDER MESSAGE CONTENT
   * ============================================================
   */

  const renderMessage = (message, mine, metaSpacer = null) => {
    const parsed = parseMessage(message.content)

    if (parsed.type === 'video_note') {
      return <VideoNoteBubble src={parsed.url} />
    }

    if (parsed.type === 'image') {
      return (
        <a
          href={parsed.url}
          target="_blank"
          rel="noreferrer"
          className="block"
        >
          <img
            src={parsed.url}
            alt={parsed.name || 'Photo'}
            className="block max-w-full max-h-72 rounded-[14px] object-cover"
          />
        </a>
      )
    }

    if (parsed.type === 'video') {
      return (
        <video
          controls
          preload="metadata"
          src={parsed.url}
          className="block max-w-full max-h-72 rounded-[14px]"
        />
      )
    }

    if (parsed.type === 'audio') {
      return (
        <VoiceBubble
          src={parsed.url}
          tone={mine ? 'mine' : 'theirs'}
        />
      )
    }

    if (parsed.type === 'file') {
      return <FileBubble url={parsed.url} name={parsed.name} mine={mine} />
    }

    return (
      <div className="whitespace-pre-wrap break-words">
        {parsed.text}
        {metaSpacer}
      </div>
    )
  }

  // Paste a screenshot/photo straight into the message box to send it
  // — same as the group chat.
  const handlePaste = async (event) => {
    const items = Array.from(event.clipboardData?.items || [])
    const imageItem = items.find(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    )
    if (!imageItem) return
    const file = imageItem.getAsFile()
    if (!file) return
    event.preventDefault()
    await uploadChatFile(file)
  }

  // Drag a file from the computer onto the conversation to send it —
  // same path as the attach button (2026-10-06).
  const { isDragging, dropProps } = useFileDrop({
    accept: CHAT_ACCEPT,
    multiple: false,
    disabled: !peerId || uploading || recording || Boolean(recordedBlob) || selectMode,
    onFiles: (files) => {
      setError('')
      uploadChatFile(files[0])
    },
    onReject: () => setError("This type of file can't be sent in the chat."),
  })

  if (!peerId) {
    return (
      <p className="text-sm text-mist">
        Select a conversation to start chatting.
      </p>
    )
  }

  const selectedMessages = messages.filter((m) =>
    selectedIds.has(m.id)
  )

  const canBulkDeleteEveryone =
    selectedMessages.length > 0 &&
    selectedMessages.every((m) => canDeleteEveryone(m))

  const timeOf = (value) =>
    new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })

  const renderActions = (m, mine, variant) => {
    const float = variant === 'float'
    const btn = float ? CHAT_ACTION_BUTTON : CHAT_ACTION_CHIP

    return (
      <div
        className={
          float
            ? `${CHAT_ACTIONS_FLOAT} ${mine ? 'right-full pr-1' : 'left-full pl-1'}`
            : CHAT_ACTIONS_TOUCH
        }
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            startReply(m)
          }}
          className={btn}
          aria-label="Reply"
          title="Reply"
        >
          <ChatGlyph name="reply" className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openReactionPicker(e, m)
          }}
          className={btn}
          aria-label="Add reaction"
          title="React"
        >
          <ChatGlyph name="smile" className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openMessageMenu(e, m)
          }}
          className={btn}
          aria-label="Message options"
          title="More"
        >
          <ChatGlyph name="more" className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    // Study room look (2026-10-07): one calm messenger pane — header,
    // a soft message area, bubbles grouped by sender, one composer bar.
    <div
      {...dropProps}
      className={`chat-pane relative flex min-h-0 flex-col overflow-hidden bg-panel ${
        embedded
          ? 'h-full'
          : 'h-[36rem] rounded-[22px] border border-line'
      }`}
    >

      <DropOverlay show={isDragging} label="Drop to send" />

      {/* HEADER — tap the name/photo to view their profile; Select
          picks several messages at once; the bin deletes the chat */}

      <div className="relative z-20 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 sm:px-4">

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className={`${CHAT_ICON_BUTTON} md:hidden`}
            aria-label="Back to chats"
            title="Back to chats"
          >
            <ChatGlyph name="back" className="h-5 w-5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setViewingProfileId(peerId)}
          className={`focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 text-left ${onBack ? 'pl-0 md:pl-1' : 'pl-1'}`}
          title="View profile"
        >
          <ChatAvatar name={peerName} url={peerAvatarUrl} seed={peerId} />

          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-paper">
              {peerName}
            </div>
            <div className="truncate text-xs text-mist">
              Tap to view profile
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setError('')

            if (selectMode) {
              cancelSelecting()
            } else {
              setSelectMode(true)
            }
          }}
          className={
            selectMode
              ? 'focus-ring shrink-0 rounded-full bg-panel-2 px-3.5 py-2 text-xs font-medium text-paper transition-colors hover:bg-line'
              : CHAT_ICON_BUTTON
          }
          aria-label={selectMode ? 'Cancel selecting' : 'Select messages'}
          title={selectMode ? 'Cancel' : 'Select messages'}
        >
          {selectMode ? 'Cancel' : <Icon name="checkCircle" className="h-[18px] w-[18px]" />}
        </button>

        {/* "Delete chat" — Telegram's delete-for-me/delete-for-everyone
            choice for the WHOLE conversation, not just one message.
            Hidden during Select mode: that mode already has its own
            "Delete for me"/"Delete for everyone" pair scoped to just
            the checked messages, in the bar at the bottom — having
            both on screen at once, with identical labels, is exactly
            how a bulk delete of a few messages ends up wiping the
            whole conversation by accident. */}
        {!selectMode && (
        <div className="relative z-10 shrink-0">
          <button
            type="button"
            onClick={() => setChatMenuOpen((v) => !v)}
            title="Delete chat"
            aria-label="Delete chat"
            className={`${CHAT_ICON_BUTTON} ${chatMenuOpen ? 'bg-urgent-tint text-urgent' : 'hover:text-urgent'}`}
          >
            <Icon name="trash" className="h-[18px] w-[18px]" />
          </button>

          {chatMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setChatMenuOpen(false)}
              />

              <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-line bg-panel p-1.5 shadow-[0_16px_40px_-16px_rgba(31,35,64,0.35)]">
                <button
                  type="button"
                  onClick={() => requestDeleteConversation('me')}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-paper hover:bg-panel-2"
                >
                  <Icon name="trash" className="h-4 w-4 text-mist" />
                  Delete for me
                </button>

                {selfRole === 'teacher' && (
                  <button
                    type="button"
                    onClick={() => requestDeleteConversation('everyone')}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-urgent hover:bg-urgent-tint"
                  >
                    <Icon name="trash" className="h-4 w-4" />
                    Delete for everyone
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        )}

      </div>

      <ProfileModal
        userId={viewingProfileId}
        viewerId={selfId}
        viewerRole={selfRole}
        onClose={() => setViewingProfileId(null)}
      />

      {menuMessage && (
        <MessageActionMenu
          position={menuPosition}
          onClose={closeMessageMenu}
          items={[
            ...(parseMessage(menuMessage.content).type === 'text'
              ? [
                  {
                    key: 'copy',
                    icon: <Icon name="clipboard" className="h-4 w-4" />,
                    label: 'Copy text',
                    onClick: () => copyMessageText(menuMessage),
                  },
                ]
              : []),
            {
              key: 'pin',
              icon: <Icon name="pin" className="h-4 w-4" />,
              label: isPinned(menuMessage.id)
                ? 'Unpin'
                : 'Pin message',
              onClick: () =>
                isPinned(menuMessage.id)
                  ? unpinMessage(menuMessage.id)
                  : pinMessage(menuMessage),
            },
            ...(canEdit(menuMessage)
              ? [
                  {
                    key: 'edit',
                    icon: <Icon name="pencil" className="h-4 w-4" />,
                    label: 'Edit',
                    onClick: () => startEdit(menuMessage),
                  },
                ]
              : []),
            {
              key: 'select',
              icon: <Icon name="checkCircle" className="h-4 w-4" />,
              label: 'Select',
              onClick: () => startSelecting(menuMessage.id),
            },
            ...(canDeleteEveryone(menuMessage)
              ? [
                  {
                    key: 'delete-everyone',
                    icon: <Icon name="trash" className="h-4 w-4" />,
                    label: 'Delete for everyone',
                    danger: true,
                    divider: true,
                    onClick: () =>
                      deleteForEveryone(menuMessage),
                  },
                ]
              : []),
            {
              key: 'delete-me',
              icon: <Icon name="trash" className="h-4 w-4" />,
              label: 'Delete for me',
              danger: true,
              divider: !canDeleteEveryone(menuMessage),
              onClick: () => deleteForMe(menuMessage),
            },
          ]}
        />
      )}

      {pickerMessage && (
        <ReactionPicker
          position={pickerPosition}
          reactions={REACTIONS}
          onClose={closeReactionPicker}
          onPick={(reaction) =>
            toggleReaction(pickerMessage, reaction)
          }
        />
      )}

      {/* PINNED MESSAGE — a slim bar under the header */}

      {pins.length > 0 && (() => {
        const activePin = pins[pinIndex] || pins[0]
        const pinnedMessage = messages.find(
          (m) => m.id === activePin?.message_id
        )

        if (!pinnedMessage) return null

        return (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5 sm:px-4">

            <button
              type="button"
              onClick={() => jumpToMessage(pinnedMessage.id)}
              className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-0.5 text-left"
            >
              <span className="h-8 w-[3px] shrink-0 rounded-full bg-brass" aria-hidden="true" />

              <div className="min-w-0">
                <div className="flex items-center gap-1 text-[11px] font-medium text-paper">
                  <Icon name="pin" className="h-3 w-3 text-mist" />
                  {pins.length > 1
                    ? `Pinned message ${pinIndex + 1} of ${pins.length}`
                    : 'Pinned message'}
                </div>

                <div className="truncate text-xs text-paper-dim">
                  {previewFor(pinnedMessage)}
                </div>
              </div>
            </button>

            {pins.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setPinIndex(
                    (index) => (index + 1) % pins.length
                  )
                }
                className="focus-ring shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-paper-dim hover:bg-panel-2"
              >
                Next
              </button>
            )}

            <button
              type="button"
              onClick={() => unpinMessage(pinnedMessage.id)}
              title="Unpin"
              aria-label="Unpin message"
              className="focus-ring inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-mist hover:bg-panel-2 hover:text-paper"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>

          </div>
        )
      })()}

      {/* MESSAGES */}

      <div ref={scrollBoxRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-panel-2 px-3 py-4 [scrollbar-width:thin] sm:px-5">

        {hasOlder && (
          <div className="mb-3 flex justify-center">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="focus-ring rounded-full border border-line bg-panel px-3.5 py-1.5 text-xs font-medium text-paper-dim transition-colors hover:text-paper disabled:opacity-40"
            >
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-listening-tint text-listening">
              <ChatGlyph name="chat" className="h-7 w-7" />
            </span>
            <div>
              <div className="text-sm font-medium text-paper">No messages yet</div>
              <div className="mt-0.5 text-xs text-mist">Say hello to {peerName || 'them'}.</div>
            </div>
          </div>
        )}

        {messages
          .filter((m) => !hiddenIds.has(m.id))
          .map((m, index, visible) => {
          const mine = m.sender_id === selfId
          const reply = getReply(m)
          const messagePinned = isPinned(m.id)
          const isHighlighted =
            String(highlightedMessageId) === String(m.id)

          // "Seen" ticks — only meaningful for a message THIS user
          // sent, comparing when it was sent against how far the peer
          // has read up to (see loadPeerReadState/the realtime handler
          // above). The explicit "Read HH:MM" text only shows on the
          // very last message, same as Telegram Desktop — repeating it
          // on every bubble would just be noise.
          const isRead = Boolean(
            mine &&
              peerReadAt &&
              new Date(m.created_at) <= new Date(peerReadAt)
          )
          const isLastVisible = index === visible.length - 1

          const prev = visible[index - 1]
          const next = visible[index + 1]

          const dateChanged =
            index === 0 ||
            !prev ||
            new Date(prev.created_at).toDateString() !==
              new Date(m.created_at).toDateString()

          const groupedWithPrev = Boolean(
            !dateChanged &&
              prev &&
              prev.sender_id === m.sender_id &&
              new Date(m.created_at) -
                new Date(prev.created_at) <
                5 * 60 * 1000
          )

          // Same rule looking forward — only used for the bubble's
          // corner shape (the last bubble of a run gets the tail corner).
          const groupedWithNext = Boolean(
            next &&
              next.sender_id === m.sender_id &&
              new Date(next.created_at).toDateString() ===
                new Date(m.created_at).toDateString() &&
              new Date(next.created_at) - new Date(m.created_at) <
                5 * 60 * 1000
          )

          const selected = selectedIds.has(m.id)
          const kind = parseMessage(m.content).type
          const isEditing = editingId === m.id
          const isMedia = !isEditing && (kind === 'image' || kind === 'video')
          const isRound = !isEditing && kind === 'video_note'
          const isText = !isEditing && kind === 'text'
          const messageReactions = REACTIONS.filter((reaction) =>
            reactionCount(m.id, reaction)
          )

          const readTitle = isRead
            ? `Read ${timeOf(peerReadAt)}`
            : 'Sent'

          const metaContent = (
            <>
              {messagePinned && (
                <span title="Pinned"><Icon name="pin" className="h-3 w-3" /></span>
              )}
              {m.edited_at && <span className="italic">edited</span>}
              <span>{timeOf(m.created_at)}</span>
              {mine && (
                <span title={readTitle} aria-label={readTitle}>
                  <ChatGlyph name={isRead ? 'ticks' : 'tick'} className="h-3.5 w-3.5" strokeWidth={2.2} />
                </span>
              )}
            </>
          )

          const metaTone = mine ? 'text-onbrass/70' : 'text-mist'

          const corners = mine
            ? `${groupedWithPrev ? 'rounded-tr-md' : ''} ${groupedWithNext ? 'rounded-br-md' : ''}`
            : `${groupedWithPrev ? 'rounded-tl-md' : ''} ${groupedWithNext ? 'rounded-bl-md' : ''}`

          return (
            <Fragment key={m.id}>

              {dateChanged && (
                <div className={`flex justify-center ${index === 0 ? 'mb-3' : 'my-4'}`}>
                  <span className="rounded-full border border-line bg-panel px-3 py-1 text-[11px] font-medium text-paper-dim">
                    {formatDateDivider(m.created_at)}
                  </span>
                </div>
              )}

              <div
                id={`private-message-${m.id}`}
                onClick={
                  selectMode
                    ? () => toggleSelected(m.id)
                    : () => setActionsFor(m.id)
                }
                data-actions={!selectMode && actionsFor === m.id ? 'on' : undefined}
                className={`group/row flex items-end gap-2 ${
                  selectMode ? 'cursor-pointer' : ''
                } ${
                  !selectMode && mine
                    ? 'justify-end'
                    : 'justify-start'
                } ${
                  index === 0 || dateChanged
                    ? ''
                    : groupedWithPrev
                    ? 'mt-0.5'
                    : 'mt-3'
                } ${
                  isHighlighted
                    ? 'bg-brass/10 rounded-2xl ring-2 ring-brass/40 p-2 -m-2'
                    : ''
                } ${selected ? 'bg-brass/5 rounded-2xl' : ''}`}
              >

              {selectMode && (
                <input
                  type="checkbox"
                  checked={selected}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelected(m.id)}
                  className="mb-2 h-[18px] w-[18px] shrink-0 accent-brass"
                  aria-label="Select message"
                />
              )}

              <div
                className={`relative flex min-w-0 max-w-[min(84%,560px)] flex-col ${
                  mine ? 'items-end' : 'items-start'
                } ${
                  selectMode ? 'pointer-events-none' : ''
                }`}
              >
                <div
                  onPointerDown={
                    selectMode
                      ? undefined
                      : (e) => handleBubblePointerDown(e, m)
                  }
                  onPointerMove={
                    selectMode
                      ? undefined
                      : (e) => handleBubblePointerMove(e, m)
                  }
                  onPointerUp={
                    selectMode
                      ? undefined
                      : (e) => handleBubblePointerUp(e, m)
                  }
                  onPointerCancel={
                    selectMode
                      ? undefined
                      : (e) =>
                          handleBubblePointerCancel(e, m)
                  }
                  onContextMenu={(e) =>
                    handleBubbleContextMenu(e, m)
                  }
                  style={{
                    touchAction: 'pan-y',
                    transform:
                      swipeVisual.id === m.id
                        ? `translateX(${swipeVisual.dx}px)`
                        : undefined,
                    transition:
                      swipeVisual.id === m.id &&
                      gestureRef.current.active
                        ? 'none'
                        : 'transform 160ms ease',
                  }}
                  className={`relative max-w-full select-none text-[14.5px] leading-[1.45] ${
                    isRound
                      ? ''
                      : `rounded-[18px] ${corners} ${
                          mine
                            ? 'bg-brass text-onbrass'
                            : 'border border-line bg-panel text-paper'
                        } ${isMedia ? 'p-1' : 'px-3 py-2'}`
                  }`}
                >

                  {swipeVisual.id === m.id &&
                    swipeVisual.dx !== 0 && (
                      <span
                        className="pointer-events-none absolute top-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-panel text-paper shadow-sm"
                        style={{
                          [swipeVisual.dx > 0
                            ? 'left'
                            : 'right']: -34,
                          opacity: Math.min(
                            1,
                            Math.abs(swipeVisual.dx) /
                              SWIPE_THRESHOLD
                          ),
                          transform: `translateY(-50%) scale(${
                            0.6 +
                            0.4 *
                              Math.min(
                                1,
                                Math.abs(swipeVisual.dx) /
                                  SWIPE_THRESHOLD
                              )
                          })`,
                        }}
                      >
                        <ChatGlyph name="reply" className="h-4 w-4" />
                      </span>
                    )}

                  {reply && (
                    <div
                      className={`mb-1.5 rounded-lg border-l-[3px] px-2.5 py-1 text-xs ${
                        isMedia ? 'mx-1.5 mt-1' : ''
                      } ${
                        mine
                          ? 'border-onbrass/60 bg-onbrass/10'
                          : 'border-brass bg-panel-2'
                      }`}
                    >
                      <div className="font-semibold">
                        {reply.sender_id === selfId
                          ? 'You'
                          : peerName || 'Them'}
                      </div>

                      <div className="truncate opacity-75">
                        {previewFor(reply)}
                      </div>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={editingText}
                        onChange={(e) =>
                          setEditingText(e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            saveEdit(m)
                          }

                          if (e.key === 'Escape') {
                            cancelEdit()
                          }
                        }}
                        className="focus-ring min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 py-1 text-paper"
                      />

                      <button
                        type="button"
                        onClick={() => saveEdit(m)}
                        className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    renderMessage(
                      m,
                      mine,
                      isText ? (
                        <span className="invisible ml-2.5 inline-flex items-center gap-1 align-baseline text-[11px] leading-none" aria-hidden="true">
                          {metaContent}
                        </span>
                      ) : null
                    )
                  )}

                  {isText && (
                    <span className={`absolute bottom-1.5 right-3 inline-flex items-center gap-1 text-[11px] leading-none ${metaTone}`}>
                      {metaContent}
                    </span>
                  )}

                  {isMedia && (
                    <span className="pointer-events-none absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[11px] leading-none text-white">
                      {metaContent}
                    </span>
                  )}

                  {!isText && !isMedia && (
                    <div
                      className={`mt-1 flex items-center justify-end gap-1 text-[11px] leading-none ${
                        isRound ? 'w-fit ml-auto rounded-full bg-panel px-2 py-1 text-mist' : metaTone
                      }`}
                    >
                      {metaContent}
                    </div>
                  )}

                </div>

                {/* REACTIONS — small chips under the bubble */}
                {messageReactions.length > 0 && (
                  <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
                    {messageReactions.map((reaction) => {
                      const mineReaction = hasReaction(m.id, reaction)

                      return (
                        <button
                          key={reaction}
                          type="button"
                          title={reactedByLabel(m.id, reaction)}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleReaction(m, reaction)
                          }}
                          className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                            mineReaction
                              ? 'border-brass/40 bg-brass/10 text-paper'
                              : 'border-line bg-panel text-paper-dim hover:text-paper'
                          }`}
                        >
                          <span>{reaction}</span>
                          <span className="font-medium">{reactionCount(m.id, reaction)}</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {isLastVisible && isRead && (
                  <div className="mt-1 px-1 text-[11px] text-mist">
                    Read {timeOf(peerReadAt)}
                  </div>
                )}

                {/* ACTIONS — reply, react, more. Hover shows them beside
                    the bubble on a computer; on a phone, tap the bubble. */}
                {!selectMode && renderActions(m, mine, 'float')}
                {!selectMode && renderActions(m, mine, 'touch')}
              </div>
              </div>
            </Fragment>
          )
        })}

        <div ref={bottomRef} />

      </div>

      {/* ERROR */}

      {error && (
        <div className="shrink-0 border-t border-line bg-urgent-tint px-4 py-2 text-xs text-urgent">
          {error}
        </div>
      )}

      {/* REPLY PREVIEW — slim bar above the composer */}

      {replyingTo && (
        <div className="flex shrink-0 items-center gap-3 border-t border-line bg-panel px-4 py-2">

          <span className="text-mist"><ChatGlyph name="reply" className="h-4 w-4" /></span>

          <span className="h-8 w-[3px] shrink-0 rounded-full bg-brass" aria-hidden="true" />

          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-paper">
              Replying to{' '}
              {replyingTo.sender_id === selfId
                ? 'yourself'
                : peerName || 'them'}
            </div>

            <div className="truncate text-xs text-mist">
              {previewFor(replyingTo)}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-mist hover:bg-panel-2 hover:text-paper"
            aria-label="Cancel reply"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>

        </div>
      )}

      {/* SELECTION BAR — replaces the composer while picking
          messages to bulk-delete */}

      {selectMode && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-panel px-3 py-2.5 sm:px-4">

          <span className="text-sm font-medium text-paper">
            {selectedIds.size} selected
          </span>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelSelecting}
              className="focus-ring rounded-full bg-panel-2 px-3.5 py-2 text-xs font-medium text-paper-dim transition-colors hover:text-paper"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={bulkDeleteForMe}
              disabled={!selectedIds.size}
              className="focus-ring rounded-full bg-urgent-tint px-3.5 py-2 text-xs font-medium text-urgent transition-opacity disabled:opacity-40"
            >
              Delete for me
            </button>

            {canBulkDeleteEveryone && (
              <button
                type="button"
                onClick={bulkDeleteForEveryone}
                disabled={!selectedIds.size}
                className="focus-ring rounded-full bg-urgent px-3.5 py-2 text-xs font-medium text-panel transition-opacity disabled:opacity-40"
              >
                Delete for everyone
              </button>
            )}
          </div>

        </div>
      )}

      {/* RECORDING REVIEW — Telegram-style: listen back to what you just
          recorded, then explicitly Send or Discard, instead of it going
          out the moment you stop recording. */}

      {recordedBlob && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3 py-2.5">

          <RecordedClipPreview
            blob={recordedBlob}
            kind={recordingKind}
          />

          <button
            type="button"
            onClick={discardRecording}
            disabled={uploading}
            className="focus-ring ml-auto shrink-0 rounded-full bg-panel-2 px-3.5 py-2 text-xs font-medium text-paper-dim transition-colors hover:text-urgent disabled:opacity-40"
          >
            Discard
          </button>

          <button
            type="button"
            onClick={sendRecording}
            disabled={uploading}
            className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brass px-4 py-2 text-xs font-medium text-onbrass hover:bg-brass-dim disabled:opacity-40"
          >
            <Icon name="send" className="h-3.5 w-3.5" />
            {uploading ? 'Sending…' : 'Send'}
          </button>

        </div>
      )}

      {/* RECORDING IN PROGRESS */}

      {recording && !recordedBlob && (
        <div className="flex shrink-0 items-center gap-3 border-t border-line bg-urgent-tint px-4 py-2.5 text-sm font-medium text-urgent">

          {recordingKind === 'video' && (
            <RoundCameraPreview stream={recordStreamRef.current} />
          )}

          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-urgent opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-urgent" />
          </span>

          <Icon name={recordingKind === 'video' ? 'video' : 'mic'} className="h-4 w-4" />

          Recording {formatRecordSeconds(recordSeconds)}

          <button
            type="button"
            onClick={stopRecording}
            className="focus-ring ml-auto shrink-0 rounded-full bg-urgent px-3.5 py-1.5 text-xs font-medium text-panel"
          >
            Stop
          </button>

        </div>
      )}

      {/* COMPOSER — one rounded bar */}

      {!selectMode && !recording && !recordedBlob && (
      <form
        onSubmit={sendText}
        onPaste={handlePaste}
        className="shrink-0 border-t border-line bg-panel px-2.5 py-2.5 sm:px-4"
      >

        <input
          ref={fileRef}
          type="file"
          accept={CHAT_ACCEPT}
          onChange={handleFile}
          className="hidden"
        />

        <div className="flex items-center gap-1 rounded-[26px] border border-line bg-panel-2 p-1.5 transition-colors focus-within:border-paper-dim/40">

          {/* PHOTO / VIDEO / FILE */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title="Send photo, video, audio or file"
            aria-label="Send photo, video, audio or file"
            className={`${CHAT_ICON_BUTTON} hover:bg-panel`}
          >
            <Icon name="paperclip" className="h-[18px] w-[18px]" />
          </button>

          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a message…"
            disabled={uploading}
            className="min-w-0 flex-1 !border-0 !bg-transparent px-1.5 py-2 text-[14.5px] !text-paper outline-none placeholder:text-mist disabled:opacity-50"
          />

          {/* VOICE MESSAGE */}
          <button
            type="button"
            onClick={() => startRecording('audio')}
            disabled={uploading}
            title="Record voice message"
            aria-label="Record voice message"
            className={`${CHAT_ICON_BUTTON} hover:bg-panel`}
          >
            <Icon name="mic" className="h-[18px] w-[18px]" />
          </button>

          {/* ROUND VIDEO MESSAGE */}
          <button
            type="button"
            onClick={() => startRecording('video')}
            disabled={uploading}
            title="Record video message"
            aria-label="Record video message"
            className={`${CHAT_ICON_BUTTON} hover:bg-panel`}
          >
            <Icon name="video" className="h-[18px] w-[18px]" />
          </button>

          <button
            type="submit"
            disabled={sending || uploading || !text.trim()}
            className="focus-ring ml-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brass text-onbrass transition-colors hover:bg-brass-dim disabled:opacity-35"
            aria-label={uploading ? 'Sending…' : 'Send message'}
            title={uploading ? 'Sending…' : 'Send'}
          >
            <Icon name="send" className="h-4 w-4" />
          </button>

        </div>

      </form>
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
