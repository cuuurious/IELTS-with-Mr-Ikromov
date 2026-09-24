import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ProfileModal from './ProfileModal'
import MessageActionMenu from './MessageActionMenu'
import ReactionPicker from './ReactionPicker'
import VoiceBubble from './VoiceBubble'
import VideoNoteBubble from './VideoNoteBubble'
import ConfirmModal from './ConfirmModal'

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

export default function Chat({
  selfId,
  peerId,
  peerName,
  targetMessageId = null,
  onDeleted = null,
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

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])

  // Lets the pin realtime handler always see the current message
  // list without having to resubscribe every time a message arrives.
  const messagesRef = useRef([])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

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

    if (parsed.type === 'image') return '📷 Photo'
    if (parsed.type === 'video') return '🎥 Video'
    if (parsed.type === 'video_note') return '📹 Video message'
    if (parsed.type === 'audio') return '🎤 Voice message'
    if (parsed.type === 'file') {
      return `📎 ${parsed.name || 'File'}`
    }

    return parsed.text
  }

  /*
   * ============================================================
   * LOAD
   * ============================================================
   */

  const loadReactions = async (messageRows) => {
    const ids = (messageRows || [])
      .map((m) => m.id)
      .filter(Boolean)

    if (!ids.length) {
      setReactions({})
      return
    }

    const { data, error: reactionsError } = await supabase
      .from('message_reactions')
      .select('*')
      .in('message_id', ids)

    if (reactionsError) {
      console.error(
        'Reaction loading error:',
        reactionsError
      )
      return
    }

    const grouped = {}

    ;(data || []).forEach((reaction) => {
      if (!grouped[reaction.message_id]) {
        grouped[reaction.message_id] = []
      }

      grouped[reaction.message_id].push(reaction)
    })

    setReactions(grouped)
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

  const loadPins = async (messageIds) => {
    const ids =
      messageIds && messageIds.length
        ? messageIds
        : messagesRef.current.map((m) => m.id)

    if (!ids.length) {
      setPins([])
      return
    }

    const { data, error: pinsError } = await supabase
      .from('message_pins')
      .select('*')
      .in('message_id', ids)
      .order('pinned_at', { ascending: false })

    if (pinsError) {
      console.error('Pin loading error:', pinsError)
      return
    }

    setPins(data || [])
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
      const { data, error: loadError } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${selfId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${selfId})`
        )
        .order('created_at', { ascending: true })

      if (!loadError && active) {
        const rows = data || []
        setMessages(rows)
        await loadReactions(rows)
        await loadPins(rows.map((row) => row.id))
        await markRead()
        await loadPeerReadState()
      }

      const { data: deletions, error: deletionsError } =
        await supabase
          .from('message_deletions')
          .select('message_id')
          .eq('user_id', selfId)

      if (!deletionsError && active) {
        setHiddenIds(
          new Set(
            (deletions || []).map((row) => row.message_id)
          )
        )
      }
    }

    load()

    const channel = supabase
      .channel(`chat-${[selfId, peerId].sort().join('-')}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const m = payload.new

          const belongs =
            (m.sender_id === selfId && m.receiver_id === peerId) ||
            (m.sender_id === peerId && m.receiver_id === selfId)

          if (belongs) {
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
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const m = payload.new

          const belongs =
            (m.sender_id === selfId && m.receiver_id === peerId) ||
            (m.sender_id === peerId && m.receiver_id === selfId)

          if (belongs) {
            setMessages((prev) =>
              prev.map((item) =>
                item.id === m.id ? m : item
              )
            )
          }
        }
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

          setReactions((prev) => ({
            ...prev,
            [reaction.message_id]: [
              ...(prev[reaction.message_id] || []),
              reaction,
            ],
          }))
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
          setReactions((prev) => ({
            ...prev,
            [payload.old.message_id]: (
              prev[payload.old.message_id] || []
            ).filter(
              (reaction) => reaction.id !== payload.old.id
            ),
          }))
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
        () => loadPins()
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
        () => loadPins()
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [selfId, peerId])

  useEffect(() => {
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

  const uploadChatFile = async (file, options = {}) => {
    if (!file || !peerId) return

    const { asVideoNote = false } = options

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

      const path =
        `chat/${selfId}/${peerId}/${Date.now()}-${Math.random()
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

      const { error: messageError } = await supabase
        .from('messages')
        .insert(payload)

      if (messageError) {
        throw messageError
      }

      setReplyingTo(null)
    } catch (err) {
      console.error(err)
      setError(err.message || 'Could not send the file.')
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

      const recorder = new MediaRecorder(stream)

      audioChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => {
          track.stop()
        })

        const fallbackType =
          kind === 'video' ? 'video/webm' : 'audio/webm'

        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || fallbackType,
        })

        const file = new File(
          [blob],
          `${
            kind === 'video' ? 'video-note' : 'voice'
          }-${Date.now()}.webm`,
          {
            type: recorder.mimeType || fallbackType,
          }
        )

        await uploadChatFile(file, {
          asVideoNote: kind === 'video',
        })
      }

      mediaRecorderRef.current = recorder

      recorder.start()

      setRecording(true)
      setRecordingKind(kind)
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
    const recorder = mediaRecorderRef.current

    if (!recorder) return

    if (recorder.state !== 'inactive') {
      recorder.stop()
    }

    mediaRecorderRef.current = null
    setRecording(false)
    setRecordingKind(null)
  }

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

  const doDeleteConversation = async (mode) => {
    const ids = messagesRef.current.map((m) => m.id)

    try {
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
  const toggleReaction = async (message, reaction) => {
    const mine = (reactions[message.id] || []).filter(
      (item) => item.user_id === selfId
    )

    const existingSame = mine.find(
      (item) => item.reaction === reaction
    )

    if (mine.length) {
      const { error: reactionError } = await supabase
        .from('message_reactions')
        .delete()
        .in(
          'id',
          mine.map((item) => item.id)
        )

      if (reactionError) {
        setError(reactionError.message)
      }
    }

    // Clicking the reaction you already had just removes it (that's
    // the "take it back" case) — anything else replaces it with the
    // new one.
    if (existingSame) {
      return
    }

    const { error: reactionError } = await supabase
      .from('message_reactions')
      .insert({
        message_id: message.id,
        user_id: selfId,
        reaction,
      })

    if (reactionError) {
      setError(reactionError.message)
    }
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

  const renderMessage = (message, mine) => {
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
            className="max-w-full max-h-72 rounded-lg object-contain"
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
          className="max-w-full max-h-72 rounded-lg"
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
      return (
        <a
          href={parsed.url}
          target="_blank"
          rel="noreferrer"
          className="underline break-all"
        >
          📎 {parsed.name || 'Open file'}
        </a>
      )
    }

    return (
      <div className="whitespace-pre-wrap break-words">
        {parsed.text}
      </div>
    )
  }

  if (!peerId) {
    return (
      <p className="text-mist">
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

  return (
    <div className="flex flex-col h-[28rem] bg-panel border border-line rounded-lg overflow-hidden">

      {/* HEADER — tap the name/photo to view their profile, or use
          Select to pick several messages at once */}

      <div className="flex items-center gap-2 px-4 py-3 border-b border-line">

        <button
          type="button"
          onClick={() => setViewingProfileId(peerId)}
          className="focus-ring flex-1 min-w-0 flex items-center gap-3 text-left hover:opacity-80"
        >
          {peerAvatarUrl ? (
            <img
              src={peerAvatarUrl}
              alt={peerName}
              className="w-9 h-9 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-brass flex items-center justify-center text-sm font-semibold text-onbrass shrink-0">
              {String(peerName || '?').charAt(0).toUpperCase()}
            </div>
          )}

          <span className="font-display text-lg truncate">
            {peerName}
          </span>
        </button>

        <button
          type="button"
          onClick={() =>
            selectMode
              ? cancelSelecting()
              : setSelectMode(true)
          }
          className="focus-ring shrink-0 text-xs px-3 py-1.5 rounded-full border border-line text-mist hover:border-brass hover:text-brass"
        >
          {selectMode ? 'Cancel' : 'Select'}
        </button>

        {/* "Delete chat" — Telegram's delete-for-me/delete-for-everyone
            choice for the WHOLE conversation, not just one message. */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setChatMenuOpen((v) => !v)}
            title="Delete chat"
            aria-label="Delete chat"
            className={`focus-ring flex h-8 w-8 items-center justify-center rounded-full border text-sm transition ${
              chatMenuOpen
                ? 'border-coral/50 bg-coral/10 text-coral'
                : 'border-line text-mist hover:border-coral hover:text-coral'
            }`}
          >
            🗑
          </button>

          {chatMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setChatMenuOpen(false)}
              />

              <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-lg border border-line bg-panel-2 py-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => requestDeleteConversation('me')}
                  className="block w-full px-3 py-2 text-left text-sm text-paper hover:bg-panel"
                >
                  Delete for me
                </button>

                {selfRole === 'teacher' && (
                  <button
                    type="button"
                    onClick={() => requestDeleteConversation('everyone')}
                    className="block w-full px-3 py-2 text-left text-sm text-coral hover:bg-panel"
                  >
                    Delete for everyone
                  </button>
                )}
              </div>
            </>
          )}
        </div>

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
                    icon: '📋',
                    label: 'Copy text',
                    onClick: () => copyMessageText(menuMessage),
                  },
                ]
              : []),
            {
              key: 'pin',
              icon: '📌',
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
                    icon: '✏️',
                    label: 'Edit',
                    onClick: () => startEdit(menuMessage),
                  },
                ]
              : []),
            {
              key: 'select',
              icon: '☑️',
              label: 'Select',
              onClick: () => startSelecting(menuMessage.id),
            },
            ...(canDeleteEveryone(menuMessage)
              ? [
                  {
                    key: 'delete-everyone',
                    icon: '🗑️',
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
              icon: '🗑️',
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

      {/* PINNED MESSAGE */}

      {pins.length > 0 && (() => {
        const activePin = pins[pinIndex] || pins[0]
        const pinnedMessage = messages.find(
          (m) => m.id === activePin?.message_id
        )

        if (!pinnedMessage) return null

        return (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-panel-2/60">

            <button
              type="button"
              onClick={() => jumpToMessage(pinnedMessage.id)}
              className="focus-ring flex-1 min-w-0 flex items-center gap-2 text-left"
            >
              <span className="text-brass shrink-0">📌</span>

              <div className="min-w-0">
                <div className="text-[10px] text-mist">
                  {pins.length > 1
                    ? `Pinned message ${pinIndex + 1} of ${pins.length}`
                    : 'Pinned message'}
                </div>

                <div className="text-xs text-paper truncate">
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
                className="focus-ring text-mist hover:text-brass text-xs px-2 shrink-0"
              >
                Next
              </button>
            )}

            <button
              type="button"
              onClick={() => unpinMessage(pinnedMessage.id)}
              title="Unpin"
              className="focus-ring text-mist hover:text-coral text-sm px-1 shrink-0"
            >
              ×
            </button>

          </div>
        )
      })()}

      {/* MESSAGES */}

      <div className="flex-1 overflow-y-auto px-4 py-3">

        {messages.length === 0 && (
          <p className="text-mist text-sm">
            No messages yet — say hello.
          </p>
        )}

        {messages
          .filter((m) => !hiddenIds.has(m.id))
          .map((m, index, visible) => {
          const mine = m.sender_id === selfId
          const reply = getReply(m)
          const messageCanEdit = canEdit(m)
          const messageCanDeleteEveryone = canDeleteEveryone(m)
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

          const selected = selectedIds.has(m.id)

          return (
            <Fragment key={m.id}>

              {dateChanged && (
                <div className="flex justify-center my-3">
                  <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-panel-2 text-mist border border-line">
                    {formatDateDivider(m.created_at)}
                  </span>
                </div>
              )}

              <div
                id={`private-message-${m.id}`}
                onClick={
                  selectMode
                    ? () => toggleSelected(m.id)
                    : undefined
                }
                className={`flex items-end gap-2 ${
                  selectMode ? 'cursor-pointer' : ''
                } ${
                  !selectMode && mine
                    ? 'justify-end'
                    : 'justify-start'
                } ${
                  index === 0 || dateChanged
                    ? ''
                    : groupedWithPrev
                    ? 'mt-1'
                    : 'mt-3'
                } ${
                  isHighlighted
                    ? 'bg-brass/10 rounded-xl ring-2 ring-brass/60 p-2 -m-2'
                    : ''
                } ${selected ? 'bg-brass/5 rounded-xl' : ''}`}
              >

              {selectMode && (
                <input
                  type="checkbox"
                  checked={selected}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelected(m.id)}
                  className="w-4 h-4 mb-1 shrink-0 accent-brass"
                />
              )}

              <div
                className={`max-w-[75%] flex flex-col ${
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
                  className={`relative select-none px-3 py-2 rounded-lg text-sm ${
                    mine
                      ? 'bg-brass text-onbrass'
                      : 'bg-panel-2 text-paper'
                  }`}
                >

                  {swipeVisual.id === m.id &&
                    swipeVisual.dx !== 0 && (
                      <span
                        className="absolute top-1/2 text-brass text-base pointer-events-none"
                        style={{
                          [swipeVisual.dx > 0
                            ? 'left'
                            : 'right']: -26,
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
                        ↩
                      </span>
                    )}

                  {reply && (
                    <div
                      className={`mb-2 border-l-2 rounded px-2 py-1 text-xs ${
                        mine
                          ? 'border-onbrass/60 bg-black/10'
                          : 'border-brass bg-panel'
                      }`}
                    >
                      <div className="font-medium">
                        Reply to{' '}
                        {reply.sender_id === selfId
                          ? 'yourself'
                          : peerName || 'them'}
                      </div>

                      <div className="truncate opacity-70">
                        {previewFor(reply)}
                      </div>
                    </div>
                  )}

                  {editingId === m.id ? (
                    <div className="flex gap-2">
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
                        className="focus-ring flex-1 rounded-lg px-2 py-1 bg-panel text-paper border border-line"
                      />

                      <button
                        type="button"
                        onClick={() => saveEdit(m)}
                        className="text-xs font-medium shrink-0"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    renderMessage(m, mine)
                  )}

                </div>

                {/* META ROW — timestamp, edited tag, and the
                    "⋯" actions menu, all in one inline row
                    instead of floating over the bubble */}
                <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-mist">

                  <span className="opacity-70">
                    {new Date(
                      m.created_at
                    ).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>

                  {m.edited_at && (
                    <span className="italic opacity-70">
                      edited
                    </span>
                  )}

                  {mine && (
                    <span
                      className={isRead ? 'text-brass' : 'opacity-70'}
                      title={
                        isRead
                          ? `Read ${new Date(
                              peerReadAt
                            ).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`
                          : 'Sent'
                      }
                    >
                      {isRead ? '✓✓' : '✓'}
                    </span>
                  )}

                  {isLastVisible && isRead && (
                    <span className="text-brass opacity-90">
                      Read{' '}
                      {new Date(peerReadAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}

                  {messagePinned && (
                    <span className="text-brass" title="Pinned">
                      📌
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={(e) => openMessageMenu(e, m)}
                    className="px-1 leading-none hover:text-brass"
                    aria-label="Message options"
                  >
                    ⋯
                  </button>

                </div>

                <div className="flex items-center gap-1 mt-0.5">

                  {REACTIONS.map((reaction) => {
                    const count = reactionCount(
                      m.id,
                      reaction
                    )

                    if (!count) return null

                    return (
                      <button
                        key={reaction}
                        type="button"
                        title={reactedByLabel(m.id, reaction)}
                        onClick={() =>
                          toggleReaction(m, reaction)
                        }
                        className={`focus-ring text-xs border rounded-full px-2 py-0.5 ${
                          hasReaction(m.id, reaction)
                            ? 'border-brass text-brass bg-brass/10'
                            : 'border-line text-mist'
                        }`}
                      >
                        {reaction} {count}
                      </button>
                    )
                  })}

                  <button
                    type="button"
                    onClick={(e) => openReactionPicker(e, m)}
                    className="focus-ring text-xs text-mist hover:text-brass px-1"
                    aria-label="Add reaction"
                  >
                    +
                  </button>

                  <button
                    type="button"
                    onClick={() => startReply(m)}
                    className="text-[11px] text-mist hover:text-brass px-1"
                  >
                    Reply
                  </button>

                </div>

              </div>
              </div>
            </Fragment>
          )
        })}

        <div ref={bottomRef} />

      </div>

      {/* ERROR */}

      {error && (
        <div className="px-3 py-2 border-t border-line text-coral text-xs">
          {error}
        </div>
      )}

      {/* REPLY PREVIEW */}

      {replyingTo && (
        <div className="px-3 py-2 border-t border-line bg-panel-2 flex items-center gap-3">

          <div className="w-1 h-8 rounded-full bg-brass" />

          <div className="flex-1 min-w-0">
            <div className="text-xs text-brass font-medium">
              Replying to{' '}
              {replyingTo.sender_id === selfId
                ? 'yourself'
                : peerName || 'them'}
            </div>

            <div className="text-xs text-mist truncate">
              {previewFor(replyingTo)}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="text-mist hover:text-paper text-lg"
          >
            ×
          </button>

        </div>
      )}

      {/* SELECTION BAR — replaces the composer while picking
          messages to bulk-delete */}

      {selectMode && (
        <div className="flex items-center gap-2 p-3 border-t border-line">

          <span className="text-sm text-mist">
            {selectedIds.size} selected
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={cancelSelecting}
              className="focus-ring text-xs px-3 py-1.5 rounded-md border border-line text-mist hover:text-paper"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={bulkDeleteForMe}
              disabled={!selectedIds.size}
              className="focus-ring text-xs px-3 py-1.5 rounded-md border border-coral text-coral disabled:opacity-40"
            >
              Delete for me
            </button>

            {canBulkDeleteEveryone && (
              <button
                type="button"
                onClick={bulkDeleteForEveryone}
                disabled={!selectedIds.size}
                className="focus-ring text-xs px-3 py-1.5 rounded-md bg-coral text-onbrass disabled:opacity-40"
              >
                Delete for everyone
              </button>
            )}
          </div>

        </div>
      )}

      {/* COMPOSER */}

      {!selectMode && (
      <form
        onSubmit={sendText}
        className="flex gap-2 p-3 border-t border-line items-center"
      >

        {/* FILE INPUT */}

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
          onChange={handleFile}
          className="hidden"
        />

        {/* PHOTO / VIDEO / FILE */}

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || recording}
          className="focus-ring w-10 h-10 rounded-md border border-line text-lg disabled:opacity-40"
          title="Photo, video or file"
          aria-label="Photo, video or file"
        >
          📎
        </button>

        {/* VOICE / VIDEO */}

        {!recording ? (
          <>
            <button
              type="button"
              onClick={() => startRecording('audio')}
              disabled={uploading}
              className="focus-ring w-10 h-10 rounded-md border border-line text-lg disabled:opacity-40"
              title="Record voice message"
              aria-label="Record voice message"
            >
              🎤
            </button>

            <button
              type="button"
              onClick={() => startRecording('video')}
              disabled={uploading}
              className="focus-ring w-10 h-10 rounded-md border border-line text-lg disabled:opacity-40"
              title="Record video message"
              aria-label="Record video message"
            >
              📹
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="focus-ring w-10 h-10 rounded-md border border-coral text-coral animate-pulse"
            title="Stop recording"
            aria-label="Stop recording"
          >
            ■
          </button>
        )}

        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            recording
              ? recordingKind === 'video'
                ? 'Recording video message…'
                : 'Recording voice message…'
              : 'Type a message…'
          }
          disabled={recording || uploading}
          className="focus-ring flex-1 bg-panel-2 border border-line rounded-md px-3 py-2 text-sm text-paper placeholder:text-mist disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={
            sending || uploading || recording || !text.trim()
          }
          className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40"
        >
          {uploading ? 'Sending…' : 'Send'}
        </button>

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
