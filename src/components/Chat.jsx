import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ProfileModal from './ProfileModal'
import MessageActionMenu from './MessageActionMenu'
import VoiceBubble from './VoiceBubble'
import VideoNoteBubble from './VideoNoteBubble'

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '👏']

const MENU_WIDTH = 212

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
}) {
  const [messages, setMessages] = useState([])
  const [reactions, setReactions] = useState({})
  const [selfRole, setSelfRole] = useState('student')

  // Just the peer's photo, kept fresh independently of the message
  // list, for the chat header. The full profile (bio, etc.) is
  // fetched by ProfileModal itself, on demand, when it's opened.
  const [peerAvatarUrl, setPeerAvatarUrl] = useState('')
  const [viewingProfileId, setViewingProfileId] = useState(null)

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

    const { error: sendError } = await supabase
      .from('messages')
      .insert(payload)

    if (sendError) {
      console.error(sendError)
      setError(sendError.message)
      setText(content)
    } else {
      setReplyingTo(null)
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

  const deleteForEveryone = async (message) => {
    if (!canDeleteEveryone(message)) return

    if (
      !window.confirm(
        'Delete this message for everyone?'
      )
    ) {
      return
    }

    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', message.id)

    if (deleteError) {
      setError(deleteError.message)
    }
  }

  const deleteForMe = async (message) => {
    if (
      !window.confirm(
        `Remove this message from your side of the chat? ${
          peerName || 'The other person'
        } will still see it.`
      )
    ) {
      return
    }

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

  const bulkDeleteForMe = async () => {
    const ids = [...selectedIds]

    if (!ids.length) return

    if (
      !window.confirm(
        `Remove ${ids.length} message${
          ids.length > 1 ? 's' : ''
        } from your side of the chat? ${
          peerName || 'The other person'
        } will still see ${
          ids.length > 1 ? 'them' : 'it'
        }.`
      )
    ) {
      return
    }

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

  const bulkDeleteForEveryone = async () => {
    const ids = [...selectedIds]

    if (!ids.length) return

    if (
      !window.confirm(
        `Delete ${ids.length} message${
          ids.length > 1 ? 's' : ''
        } for everyone?`
      )
    ) {
      return
    }

    const { error: bulkDeleteError } = await supabase
      .from('messages')
      .delete()
      .in('id', ids)

    if (bulkDeleteError) {
      setError(bulkDeleteError.message)
    }

    cancelSelecting()
  }

  const toggleReaction = async (message, reaction) => {
    const existing = (reactions[message.id] || []).find(
      (item) =>
        item.user_id === selfId && item.reaction === reaction
    )

    if (existing) {
      const { error: reactionError } = await supabase
        .from('message_reactions')
        .delete()
        .eq('id', existing.id)

      if (reactionError) {
        setError(reactionError.message)
      }

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
                  className={`px-3 py-2 rounded-lg text-sm ${
                    mine
                      ? 'bg-brass text-onbrass'
                      : 'bg-panel-2 text-paper'
                  }`}
                >

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

                  <details className="relative">
                    <summary className="list-none cursor-pointer text-xs text-mist hover:text-brass px-1">
                      +
                    </summary>

                    <div className="absolute bottom-5 left-0 z-30 bg-panel border border-line rounded-lg shadow-xl p-1 flex gap-1">
                      {REACTIONS.map((reaction) => (
                        <button
                          key={reaction}
                          type="button"
                          onClick={() =>
                            toggleReaction(m, reaction)
                          }
                          className="w-8 h-8 rounded-md hover:bg-panel-2"
                        >
                          {reaction}
                        </button>
                      ))}
                    </div>
                  </details>

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

    </div>
  )
}
