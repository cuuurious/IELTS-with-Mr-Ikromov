import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ProfileModal from './ProfileModal'
import MessageActionMenu from './MessageActionMenu'
import ReactionPicker from './ReactionPicker'
import VoiceBubble from './VoiceBubble'
import VideoNoteBubble from './VideoNoteBubble'

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

// Distinct, deterministic name/avatar color per sender — same idea as
// Telegram's per-member colors in a group, so members are easy to
// tell apart at a glance. The teacher gets their own fixed brass
// color (handled separately) rather than picking one from here.
const MEMBER_ACCENTS = [
  { name: 'text-sage', avatarBg: 'bg-sage' },
  { name: 'text-cyan', avatarBg: 'bg-cyan' },
  { name: 'text-lavender', avatarBg: 'bg-lavender' },
  { name: 'text-amber', avatarBg: 'bg-amber' },
  { name: 'text-coral', avatarBg: 'bg-coral' },
]

const accentForSender = (sender) => {
  if (sender?.role === 'teacher') {
    return { name: 'text-brass', avatarBg: 'bg-brass' }
  }

  const id = sender?.id || ''

  let hash = 0

  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % MEMBER_ACCENTS.length
  }

  return MEMBER_ACCENTS[Math.abs(hash) % MEMBER_ACCENTS.length]
}

export default function GroupChat({
  groupId,
  selfId,
  groupName,
  initialMessageId = null,
}) {
  const [messages, setMessages] = useState([])
  const [profiles, setProfiles] = useState({})
  const [reactions, setReactions] = useState({})
  const [actions, setActions] = useState([])

  // Messages this member has hidden from their own view only —
  // "Delete for me". The row stays for everyone else in the group.
  const [hiddenIds, setHiddenIds] = useState(new Set())

  // Pinned messages, newest pin first — the teacher pins/unpins
  // (same moderation role they already have), everyone in the group
  // sees the banner. `pinIndex` is which pin the banner shows when
  // there's more than one.
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
  const [error, setError] = useState('')

  const [selfRole, setSelfRole] = useState('student')
  const [viewingProfileId, setViewingProfileId] = useState(null)
  const [showActions, setShowActions] = useState(false)

  const [replyingTo, setReplyingTo] = useState(null)

  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')

  const [recording, setRecording] = useState(false)
  const [recordingKind, setRecordingKind] = useState('audio')
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState(null)

  const [highlightedMessageId, setHighlightedMessageId] = useState(null)

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const loadProfiles = async (ids) => {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))]

    if (!uniqueIds.length) return

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, username, role, avatar_url')
      .in('id', uniqueIds)

    if (error) {
      console.error(error)
      return
    }

    const map = {}

    ;(data || []).forEach((profile) => {
      map[profile.id] = profile
    })

    setProfiles((prev) => ({
      ...prev,
      ...map,
    }))
  }

  const loadReactions = async (messageRows) => {
    const ids = (messageRows || [])
      .map((m) => m.id)
      .filter(Boolean)

    if (!ids.length) {
      setReactions({})
      return
    }

    const { data, error } = await supabase
      .from('group_message_reactions')
      .select('*')
      .in('message_id', ids)

    if (error) {
      console.error('Reaction loading error:', error)
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

    await loadProfiles(
      (data || []).map((reaction) => reaction.user_id)
    )
  }

  const loadMessages = async () => {
    if (!groupId) return

    const { data, error } = await supabase
      .from('group_messages')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', {
        ascending: true,
      })

    if (error) {
      setError(error.message)
      return
    }

    const rows = data || []

    setMessages(rows)

    await loadProfiles(
      rows.map((message) => message.sender_id)
    )

    await loadReactions(rows)
  }

  const loadHiddenForMe = async () => {
    if (!selfId) return

    const { data, error } = await supabase
      .from('group_message_deletions')
      .select('message_id')
      .eq('user_id', selfId)

    if (error) {
      console.error(error)
      return
    }

    setHiddenIds(
      new Set((data || []).map((row) => row.message_id))
    )
  }

  const loadPins = async () => {
    if (!groupId) return

    const { data, error } = await supabase
      .from('group_message_pins')
      .select('*')
      .eq('group_id', groupId)
      .order('pinned_at', { ascending: false })

    if (error) {
      console.error(error)
      return
    }

    setPins(data || [])
  }

  const loadActions = async () => {
    if (selfRole !== 'teacher') return

    const { data, error } = await supabase
      .from('group_message_actions')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', {
        ascending: false,
      })
      .limit(50)

    if (error) {
      console.error(error)
      return
    }

    const rows = data || []

    setActions(rows)

    await loadProfiles([
      ...rows.map((a) => a.actor_id),
      ...rows.map((a) => a.target_sender_id),
    ])
  }

  useEffect(() => {
    if (!groupId || !selfId) return

    let active = true

    const initialise = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', selfId)
        .maybeSingle()

      if (active) {
        setSelfRole(data?.role || 'student')
      }

      await loadMessages()
      await loadHiddenForMe()
      await loadPins()
    }

    initialise()

    return () => {
      active = false
    }
  }, [groupId, selfId])

  useEffect(() => {
    if (!groupId) return

    const channel = supabase
      .channel(`group-chat-${groupId}`)

      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        },
        async (payload) => {
          const message = payload.new

          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) {
              return prev
            }

            return [...prev, message]
          })

          await loadProfiles([message.sender_id])
        }
      )

      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === payload.new.id
                ? payload.new
                : message
            )
          )
        }
      )

      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'group_messages',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.filter(
              (message) => message.id !== payload.old.id
            )
          )

          setReactions((prev) => {
            const next = { ...prev }
            delete next[payload.old.id]
            return next
          })

          setReplyingTo((current) =>
            current?.id === payload.old.id
              ? null
              : current
          )
        }
      )

      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_message_reactions',
        },
        async (payload) => {
          const reaction = payload.new

          setReactions((prev) => ({
            ...prev,
            [reaction.message_id]: [
              ...(prev[reaction.message_id] || []),
              reaction,
            ],
          }))

          await loadProfiles([reaction.user_id])
        }
      )

      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'group_message_reactions',
        },
        (payload) => {
          setReactions((prev) => ({
            ...prev,
            [payload.old.message_id]: (
              prev[payload.old.message_id] || []
            ).filter(
              (reaction) =>
                reaction.id !== payload.old.id
            ),
          }))
        }
      )

      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_message_actions',
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          loadActions()
        }
      )

      .on(
        // Keeps "Delete for me" in sync if this member has the group
        // open in another tab or device.
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_message_deletions',
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
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_message_pins',
          filter: `group_id=eq.${groupId}`,
        },
        () => loadPins()
      )

      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'group_message_pins',
          filter: `group_id=eq.${groupId}`,
        },
        () => loadPins()
      )

      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [groupId, selfRole, selfId])

  useEffect(() => {
    if (selfRole === 'teacher') {
      loadActions()
    }
  }, [groupId, selfRole])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: 'smooth',
    })
  }, [messages])

  // Always land on the most recently pinned message when the pin
  // list changes, same as opening a Telegram group with a new pin.
  useEffect(() => {
    setPinIndex(0)
  }, [pins.length])

  /*
   * Notification navigation:
   * if a notification opens this chat with a message id,
   * scroll directly to that message and highlight it.
   */
  useEffect(() => {
    if (!initialMessageId || !messages.length) return

    const exists = messages.some(
      (message) =>
        String(message.id) === String(initialMessageId)
    )

    if (!exists) return

    const timer = setTimeout(() => {
      const element = document.getElementById(
        `group-message-${initialMessageId}`
      )

      if (!element) return

      setHighlightedMessageId(initialMessageId)

      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })

      setTimeout(() => {
        setHighlightedMessageId(null)
      }, 3500)
    }, 300)

    return () => clearTimeout(timer)
  }, [initialMessageId, messages])

  // Same jump-and-briefly-highlight behavior as above, but triggered
  // on demand — used by the pinned-message banner.
  const jumpToMessage = (messageId) => {
    const element = document.getElementById(
      `group-message-${messageId}`
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

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current)

      streamRef.current
        ?.getTracks()
        .forEach((track) => track.stop())
    }
  }, [])

  const insertMessage = async ({
    content = null,
    mediaUrl = null,
    mediaType = null,
    replyToId = null,
  }) => {
    const payload = {
      group_id: groupId,
      sender_id: selfId,
      content,
      media_url: mediaUrl,
      media_type: mediaType,
    }

    if (replyToId) {
      payload.reply_to_id = replyToId
    }

    const { error } = await supabase
      .from('group_messages')
      .insert(payload)

    if (error) throw error
  }

  const send = async (e) => {
    e.preventDefault()

    const content = text.trim()

    if (!content || !groupId || !selfId) {
      return
    }

    setSending(true)
    setError('')

    try {
      await insertMessage({
        content,
        replyToId: replyingTo?.id || null,
      })

      setText('')
      setReplyingTo(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const uploadFile = async (file, mediaType) => {
    if (!file) return

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(
        `Maximum file size is ${MAX_FILE_MB}MB.`
      )
      return
    }

    setUploading(true)
    setError('')

    try {
      const extension =
        file.name?.split('.').pop() || 'webm'

      const path =
        `${groupId}/${selfId}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${extension}`

      const { error: uploadError } =
        await supabase.storage
          .from('group-chat')
          .upload(path, file, {
            upsert: false,
            contentType: file.type || undefined,
          })

      if (uploadError) {
        throw uploadError
      }

      const { data } =
        supabase.storage
          .from('group-chat')
          .getPublicUrl(path)

      if (!data?.publicUrl) {
        throw new Error(
          'Could not create the public file URL.'
        )
      }

      await insertMessage({
        mediaUrl: data.publicUrl,
        mediaType,
        replyToId: replyingTo?.id || null,
      })

      setReplyingTo(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]

    e.target.value = ''

    if (!file) return

    let mediaType = null

    if (file.type.startsWith('image/')) {
      mediaType = 'image'
    } else if (file.type.startsWith('video/')) {
      mediaType = 'video'
    } else if (
      file.type.startsWith('audio/') ||
      /\.(mp3|wav|m4a|ogg|webm)$/i.test(
        file.name
      )
    ) {
      mediaType = 'audio'
    }

    if (!mediaType) {
      setError(
        'Only photos, videos and audio files are supported.'
      )
      return
    }

    await uploadFile(file, mediaType)
  }

  const startRecording = async (kind = 'audio') => {
    setError('')

    try {
      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
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

      streamRef.current = stream

      const recorder =
        new MediaRecorder(stream)

      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(
          chunksRef.current,
          {
            type:
              recorder.mimeType ||
              (kind === 'video'
                ? 'video/webm'
                : 'audio/webm'),
          }
        )

        setRecordedBlob(blob)

        stream
          .getTracks()
          .forEach((track) => track.stop())
      }

      mediaRecorderRef.current = recorder

      recorder.start()

      setRecording(true)
      setRecordingKind(kind)
      setRecordSeconds(0)

      timerRef.current =
        setInterval(() => {
          setRecordSeconds(
            (value) => value + 1
          )
        }, 1000)
    } catch (err) {
      setError(err.message)
    }
  }

  const stopRecording = () => {
    clearInterval(timerRef.current)

    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !==
        'inactive'
    ) {
      mediaRecorderRef.current.stop()
    }

    setRecording(false)
  }

  const discardRecording = () => {
    setRecordedBlob(null)
    setRecordSeconds(0)
  }

  const sendRecording = async () => {
    if (!recordedBlob) return

    const isVideo = recordingKind === 'video'

    const file = new File(
      [recordedBlob],
      `${isVideo ? 'video-note' : 'voice-message'}.webm`,
      {
        type:
          recordedBlob.type ||
          (isVideo ? 'video/webm' : 'audio/webm'),
      }
    )

    await uploadFile(file, isVideo ? 'video_note' : 'audio')

    setRecordedBlob(null)
    setRecordSeconds(0)
  }

  // "Delete for everyone" actually removes the row — only the sender,
  // or the teacher moderating the group, can do that.
  const canDeleteEveryone = (message) =>
    message.sender_id === selfId || selfRole === 'teacher'

  const deleteForEveryone = async (message) => {
    if (!canDeleteEveryone(message)) return

    if (
      !window.confirm(
        'Delete this message for everyone?'
      )
    ) {
      return
    }

    const { error } = await supabase
      .from('group_messages')
      .delete()
      .eq('id', message.id)

    if (error) {
      setError(error.message)
    }
  }

  // "Delete for me" is available to every member on any message — it
  // only hides it from this member's own view; everyone else still
  // sees it, same as Telegram.
  const deleteForMe = async (message) => {
    if (
      !window.confirm(
        'Remove this message from your view of the chat? Other members will still see it.'
      )
    ) {
      return
    }

    setHiddenIds((prev) => {
      const next = new Set(prev)
      next.add(message.id)
      return next
    })

    const { error } = await supabase
      .from('group_message_deletions')
      .upsert(
        { message_id: message.id, user_id: selfId },
        { onConflict: 'message_id,user_id', ignoreDuplicates: true }
      )

    if (error) {
      console.error(error)
      setError(error.message)

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
   * Pinning is a teacher-only moderation action, same as it is in a
   * real Telegram group (only admins pin there too) — everyone in
   * the group can see the pinned banner and jump to it, but only the
   * teacher can add or remove a pin.
   * ============================================================
   */

  const isPinned = (messageId) =>
    pins.some((pin) => pin.message_id === messageId)

  const pinMessage = async (message) => {
    if (selfRole !== 'teacher') return

    const { error } = await supabase
      .from('group_message_pins')
      .upsert(
        {
          message_id: message.id,
          group_id: groupId,
          pinned_by: selfId,
        },
        { onConflict: 'message_id' }
      )

    if (error) {
      setError(error.message)
    }
  }

  const unpinMessage = async (messageId) => {
    if (selfRole !== 'teacher') return

    const { error } = await supabase
      .from('group_message_pins')
      .delete()
      .eq('message_id', messageId)

    if (error) {
      setError(error.message)
    }
  }

  const copyMessageText = async (message) => {
    if (!message.content) return

    try {
      await navigator.clipboard.writeText(message.content)
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

  const bulkDeleteForMe = async () => {
    const ids = [...selectedIds]

    if (!ids.length) return

    if (
      !window.confirm(
        `Remove ${ids.length} message${
          ids.length > 1 ? 's' : ''
        } from your view of the chat? Other members will still see ${
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

    const { error } = await supabase
      .from('group_message_deletions')
      .upsert(
        ids.map((id) => ({
          message_id: id,
          user_id: selfId,
        })),
        { onConflict: 'message_id,user_id', ignoreDuplicates: true }
      )

    if (error) {
      setError(error.message)
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

    const { error } = await supabase
      .from('group_messages')
      .delete()
      .in('id', ids)

    if (error) {
      setError(error.message)
    }

    cancelSelecting()
  }

  const startEdit = (message) => {
    // Only the sender can edit their own message — a teacher can
    // remove a student's message for moderation, but never rewrite
    // it, same as real Telegram.
    if (message.sender_id !== selfId) {
      return
    }

    if (!message.content) return

    setEditingId(message.id)
    setEditingText(message.content)
  }

  const saveEdit = async (message) => {
    const content = editingText.trim()

    if (!content) return

    const { error } = await supabase
      .from('group_messages')
      .update({ content })
      .eq('id', message.id)

    if (error) {
      setError(error.message)
      return
    }

    setEditingId(null)
    setEditingText('')
  }

  // Only one reaction per person per message, like Telegram — picking
  // a new emoji swaps out whichever one they already had rather than
  // stacking a second reaction alongside it. Deleting every reaction
  // this user has on the message (not just a same-emoji match) also
  // cleans up any leftover double-reaction from before this rule
  // existed the next time they react here.
  const toggleReaction = async (
    message,
    reaction
  ) => {
    const mine =
      (reactions[message.id] || []).filter(
        (item) => item.user_id === selfId
      )

    const existingSame = mine.find(
      (item) => item.reaction === reaction
    )

    if (mine.length) {
      const { error } =
        await supabase
          .from('group_message_reactions')
          .delete()
          .in(
            'id',
            mine.map((item) => item.id)
          )

      if (error) {
        setError(error.message)
      }
    }

    // Clicking the reaction they already had just removes it (the
    // "take it back" case) — anything else replaces it.
    if (existingSame) {
      return
    }

    const { error } =
      await supabase
        .from('group_message_reactions')
        .insert({
          message_id: message.id,
          user_id: selfId,
          reaction,
        })

    if (error) {
      setError(error.message)
    }
  }

  const reactionCount = (
    messageId,
    reaction
  ) =>
    (reactions[messageId] || []).filter(
      (item) =>
        item.reaction === reaction
    ).length

  const hasReaction = (
    messageId,
    reaction
  ) =>
    (reactions[messageId] || []).some(
      (item) =>
        item.user_id === selfId &&
        item.reaction === reaction
    )

  // Group chat can have many reactors, so — unlike the private chat's
  // "You" vs "them" — this needs the actual names, pulled from the
  // same profiles map already used to label who sent each message.
  const reactedByLabel = (messageId, reaction) =>
    (reactions[messageId] || [])
      .filter((item) => item.reaction === reaction)
      .map((item) =>
        item.user_id === selfId
          ? 'You'
          : profiles[item.user_id]?.full_name ||
            profiles[item.user_id]?.username ||
            'Someone'
      )
      .join(', ')

  const getReply = (message) => {
    if (!message.reply_to_id) {
      return null
    }

    return messages.find(
      (item) =>
        item.id === message.reply_to_id
    )
  }

  const formatSeconds = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(
      seconds % 60
    ).padStart(2, '0')}`

  const handlePaste = async (event) => {
    const items = Array.from(
      event.clipboardData?.items || []
    )

    const imageItem = items.find(
      (item) =>
        item.kind === 'file' &&
        item.type.startsWith('image/')
    )

    if (!imageItem) return

    const file =
      imageItem.getAsFile()

    if (!file) return

    event.preventDefault()

    await uploadFile(file, 'image')
  }

  if (!groupId) {
    return (
      <p className="text-mist">
        Select a group to open the chat.
      </p>
    )
  }

  const selectedMessages = messages.filter((message) =>
    selectedIds.has(message.id)
  )

  const canBulkDeleteEveryone =
    selectedMessages.length > 0 &&
    selectedMessages.every((message) =>
      canDeleteEveryone(message)
    )

  return (
    <div className="group-chat-shell flex flex-col h-[36rem] bg-panel border border-line rounded-2xl overflow-hidden shadow-lg">

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
            ...(Boolean(menuMessage.content)
              ? [
                  {
                    key: 'copy',
                    icon: '📋',
                    label: 'Copy text',
                    onClick: () => copyMessageText(menuMessage),
                  },
                ]
              : []),
            ...(selfRole === 'teacher'
              ? [
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
                ]
              : []),
            ...(menuMessage.sender_id === selfId &&
            Boolean(menuMessage.content)
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

      <div className="px-4 py-3 border-b border-line bg-panel-2/70 flex items-center justify-between">

        <div>
          <div className="font-display text-lg">
            {groupName || 'Group chat'}
          </div>

          <div className="text-xs text-mist">
            Shared conversation · messages can be removed for everyone
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">

          <button
            type="button"
            onClick={() =>
              selectMode
                ? cancelSelecting()
                : setSelectMode(true)
            }
            className="focus-ring text-xs px-3 py-1.5 rounded-full border border-line text-mist hover:border-brass hover:text-brass"
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>

          {selfRole === 'teacher' && (
            <button
              type="button"
              onClick={() =>
                setShowActions(
                  (value) => !value
                )
              }
              className="focus-ring text-xs px-3 py-1.5 rounded-full border border-line text-mist hover:border-brass hover:text-brass"
            >
              {showActions
                ? 'Hide activity'
                : 'Recent activity'}
            </button>
          )}

        </div>

      </div>

      {/* PINNED MESSAGE */}

      {pins.length > 0 && (() => {
        const activePin = pins[pinIndex] || pins[0]
        const pinnedMessage = messages.find(
          (m) => m.id === activePin?.message_id
        )

        if (!pinnedMessage) return null

        const pinnedSender = profiles[pinnedMessage.sender_id]

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
                  {' · '}
                  {pinnedSender?.full_name ||
                    pinnedSender?.username ||
                    'Member'}
                </div>

                <div className="text-xs text-paper truncate">
                  {pinnedMessage.content ||
                    (pinnedMessage.media_type
                      ? 'Media message'
                      : '')}
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

            {selfRole === 'teacher' && (
              <button
                type="button"
                onClick={() => unpinMessage(pinnedMessage.id)}
                title="Unpin"
                className="focus-ring text-mist hover:text-coral text-sm px-1 shrink-0"
              >
                ×
              </button>
            )}

          </div>
        )
      })()}

      <div className="flex-1 min-h-0 flex">

        <div className="flex-1 min-w-0 overflow-y-auto px-4 py-4">

          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-mist text-sm">
              No messages yet — say hello to the group.
            </div>
          )}

          {messages
            .filter((message) => !hiddenIds.has(message.id))
            .map((message, index, visible) => {
            const mine =
              message.sender_id === selfId

            const sender =
              profiles[message.sender_id]

            const accent = accentForSender(sender)

            const reply =
              getReply(message)

            // Deleting for everyone is sender-or-teacher
            // (moderation); editing is sender-only — a teacher
            // should never be able to rewrite a student's words,
            // only remove them. Deleting for me (hiding it from
            // just this member's own view) is available on every
            // message, for everyone.
            const messageCanDeleteEveryone =
              canDeleteEveryone(message)

            const canEdit =
              mine && Boolean(message.content)

            const messagePinned = isPinned(message.id)

            const messageReactions =
              reactions[message.id] || []

            const isHighlighted =
              String(highlightedMessageId) ===
              String(message.id)

            const prev = visible[index - 1]

            const dateChanged =
              index === 0 ||
              !prev ||
              new Date(prev.created_at).toDateString() !==
                new Date(message.created_at).toDateString()

            const groupedWithPrev = Boolean(
              !dateChanged &&
                prev &&
                prev.sender_id === message.sender_id &&
                new Date(message.created_at) -
                  new Date(prev.created_at) <
                  5 * 60 * 1000
            )

            const initial = String(
              sender?.full_name ||
                sender?.username ||
                '?'
            )
              .charAt(0)
              .toUpperCase()

            const selected = selectedIds.has(message.id)

            return (
              <Fragment key={message.id}>

                {dateChanged && (
                  <div className="flex justify-center my-3">
                    <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-panel-2 text-mist border border-line">
                      {formatDateDivider(message.created_at)}
                    </span>
                  </div>
                )}

                <div
                  id={`group-message-${message.id}`}
                  onClick={
                    selectMode
                      ? () => toggleSelected(message.id)
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
                    onChange={() =>
                      toggleSelected(message.id)
                    }
                    className="w-4 h-4 mb-1 shrink-0 accent-brass"
                  />
                )}

                {!mine && (
                  <div
                    className={`w-7 shrink-0 ${
                      selectMode
                        ? 'pointer-events-none'
                        : ''
                    }`}
                  >
                    {!groupedWithPrev && (
                      <button
                        type="button"
                        onClick={() =>
                          setViewingProfileId(
                            message.sender_id
                          )
                        }
                        className="focus-ring block"
                      >
                        {sender?.avatar_url ? (
                          <img
                            src={sender.avatar_url}
                            alt={
                              sender?.full_name ||
                              sender?.username ||
                              'Member'
                            }
                            className="w-7 h-7 rounded-full object-cover"
                          />
                        ) : (
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-onbrass ${accent.avatarBg}`}
                          >
                            {initial}
                          </div>
                        )}
                      </button>
                    )}
                  </div>
                )}

                <div
                  className={`group max-w-[82%] ${
                    mine
                      ? 'items-end'
                      : 'items-start'
                  } flex flex-col ${
                    selectMode ? 'pointer-events-none' : ''
                  }`}
                >

                  {!groupedWithPrev && (
                    <div className="px-1 mb-0.5 flex items-center gap-2 text-[11px]">

                      <button
                        type="button"
                        onClick={() =>
                          setViewingProfileId(
                            message.sender_id
                          )
                        }
                        className={`focus-ring font-semibold hover:underline ${accent.name}`}
                      >
                        {sender?.full_name ||
                          sender?.username ||
                          'Member'}
                      </button>

                      {sender?.role ===
                        'teacher' && (
                        <span className="rounded-full border border-brass/40 px-1.5 text-brass">
                          TEACHER
                        </span>
                      )}

                    </div>
                  )}

                  <div className="px-1 mb-1 flex items-center gap-2 text-[11px]">

                    {messagePinned && (
                      <span
                        className="text-brass"
                        title="Pinned"
                      >
                        📌
                      </span>
                    )}

                    <span className="text-mist">
                      {new Date(
                        message.created_at
                      ).toLocaleTimeString(
                        [],
                        {
                          hour:
                            '2-digit',
                          minute:
                            '2-digit',
                        }
                      )}
                    </span>

                    <button
                      type="button"
                      onClick={(e) => openMessageMenu(e, message)}
                      className="ml-auto px-1 leading-none text-mist hover:text-brass"
                      aria-label="Message options"
                    >
                      ⋯
                    </button>

                  </div>

                  <div
                    onPointerDown={
                      selectMode
                        ? undefined
                        : (e) =>
                            handleBubblePointerDown(
                              e,
                              message
                            )
                    }
                    onPointerMove={
                      selectMode
                        ? undefined
                        : (e) =>
                            handleBubblePointerMove(
                              e,
                              message
                            )
                    }
                    onPointerUp={
                      selectMode
                        ? undefined
                        : (e) =>
                            handleBubblePointerUp(
                              e,
                              message
                            )
                    }
                    onPointerCancel={
                      selectMode
                        ? undefined
                        : (e) =>
                            handleBubblePointerCancel(
                              e,
                              message
                            )
                    }
                    onContextMenu={(e) =>
                      handleBubbleContextMenu(e, message)
                    }
                    style={{
                      touchAction: 'pan-y',
                      transform:
                        swipeVisual.id === message.id
                          ? `translateX(${swipeVisual.dx}px)`
                          : undefined,
                      transition:
                        swipeVisual.id === message.id &&
                        gestureRef.current.active
                          ? 'none'
                          : 'transform 160ms ease',
                    }}
                    className={`relative rounded-2xl px-3 py-2.5 shadow-sm select-none ${
                      mine
                        ? 'bg-brass text-onbrass rounded-tr-md'
                        : 'bg-panel-2 text-paper rounded-tl-md border border-line'
                    }`}
                  >

                    {swipeVisual.id === message.id &&
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
                          {profiles[
  reply.sender_id
]?.full_name ||
  profiles[
    reply.sender_id
  ]?.username ||
  'Member'}
                        </div>

                        <div className="truncate opacity-70">
                          {reply.content ||
                            'Media message'}
                        </div>
                      </div>
                    )}

                    {message.media_type ===
                      'image' && (
                      <img
                        src={message.media_url}
                        alt="Shared photo"
                        className="rounded-xl max-h-72 max-w-full object-contain"
                      />
                    )}

                    {message.media_type ===
                      'video' && (
                      <video
                        src={message.media_url}
                        controls
                        className="rounded-xl max-h-72 max-w-full"
                      />
                    )}

                    {message.media_type ===
                      'video_note' && (
                      <VideoNoteBubble src={message.media_url} />
                    )}

                    {message.media_type ===
                      'audio' && (
                      <VoiceBubble
                        src={message.media_url}
                        tone={mine ? 'mine' : 'theirs'}
                      />
                    )}

                    {editingId ===
                    message.id ? (
                      <div className="flex gap-2 mt-1">

                        <input
                          autoFocus
                          value={editingText}
                          onChange={(e) =>
                            setEditingText(
                              e.target.value
                            )
                          }
                          onKeyDown={(e) => {
                            if (
                              e.key ===
                              'Enter'
                            ) {
                              saveEdit(message)
                            }

                            if (
                              e.key ===
                              'Escape'
                            ) {
                              setEditingId(
                                null
                              )
                            }
                          }}
                          className="focus-ring flex-1 rounded-lg px-2 py-1 bg-panel text-paper border border-line"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            saveEdit(message)
                          }
                          className="text-xs font-medium"
                        >
                          Save
                        </button>

                      </div>
                    ) : (
                      message.content && (
                        <div
                          className={
                            message.media_type
                              ? 'mt-2 whitespace-pre-wrap'
                              : 'whitespace-pre-wrap'
                          }
                        >
                          {message.content}
                        </div>
                      )
                    )}

                  </div>

                  <div className="flex items-center gap-1 mt-1">

                    {REACTIONS.map(
                      (reaction) => {
                        const count =
                          reactionCount(
                            message.id,
                            reaction
                          )

                        if (!count) {
                          return null
                        }

                        return (
                          <button
                            key={reaction}
                            type="button"
                            title={reactedByLabel(
                              message.id,
                              reaction
                            )}
                            onClick={() =>
                              toggleReaction(
                                message,
                                reaction
                              )
                            }
                            className={`focus-ring text-xs border rounded-full px-2 py-0.5 ${
                              hasReaction(
                                message.id,
                                reaction
                              )
                                ? 'border-brass text-brass bg-brass/10'
                                : 'border-line text-mist'
                            }`}
                          >
                            {reaction}{' '}
                            {count}
                          </button>
                        )
                      }
                    )}

                    <button
                      type="button"
                      onClick={(e) =>
                        openReactionPicker(e, message)
                      }
                      className="focus-ring text-xs text-mist hover:text-brass px-1"
                      aria-label="Add reaction"
                    >
                      +
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setReplyingTo(
                          message
                        )

                        setTimeout(
                          () =>
                            inputRef.current?.focus(),
                          50
                        )
                      }}
                      className="text-[11px] text-mist hover:text-brass px-1"
                    >
                      Reply
                    </button>

                  </div>

                  {messageReactions.length >
                    0 && (
                    <span className="hidden">
                      {messageReactions.length}
                    </span>
                  )}

                </div>

                </div>
              </Fragment>
            )
          })}

          <div ref={bottomRef} />

        </div>

        {showActions &&
          selfRole === 'teacher' && (
          <aside className="w-72 border-l border-line bg-panel-2/60 overflow-y-auto p-3 hidden lg:block">

            <div className="text-xs uppercase tracking-wide text-mist font-mono mb-3">
              Recent message actions
            </div>

            {actions.length === 0 && (
              <p className="text-xs text-mist">
                No edits or deletions yet.
              </p>
            )}

            <div className="space-y-2">

              {actions.map((action) => (
                <div
                  key={action.id}
                  className="rounded-lg border border-line bg-panel p-3 text-xs"
                >

                  <div className="flex justify-between gap-2">

                    <span
                      className={
                        action.action ===
                        'deleted'
                          ? 'text-coral'
                          : 'text-brass'
                      }
                    >
                      {action.action}
                    </span>

                    <span className="text-mist">
                      {new Date(
                        action.created_at
                      ).toLocaleString()}
                    </span>

                  </div>

                  <div className="mt-1 text-paper-dim">
                    {profiles[
                      action.actor_id
                    ]?.full_name ||
                      'Teacher'}{' '}
                    {action.action}{' '}
                    a message from{' '}
                    {profiles[
                      action.target_sender_id
                    ]?.full_name ||
                      'student'}.
                  </div>

                  {action.new_content && (
                    <div className="mt-2 text-mist truncate">
                      {action.new_content}
                    </div>
                  )}

                </div>
              ))}

            </div>

          </aside>
        )}

      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-coral border-t border-line">
          {error}
        </div>
      )}

      {replyingTo && (
        <div className="px-3 py-2 border-t border-line bg-panel-2 flex items-center gap-3">

          <div className="w-1 h-8 rounded-full bg-brass" />

          <div className="flex-1 min-w-0">

          <div className="text-xs text-brass font-medium">
  Replying to{' '}
  {profiles[replyingTo.sender_id]?.full_name ||
    profiles[replyingTo.sender_id]?.username ||
    'Member'}
</div>

            <div className="text-xs text-mist truncate">
              {replyingTo.content ||
                'Media message'}
            </div>

          </div>

          <button
            type="button"
            onClick={() =>
              setReplyingTo(null)
            }
            className="text-mist hover:text-paper text-lg"
          >
            ×
          </button>

        </div>
      )}

      {recordedBlob && (
        <div className="px-3 py-2 border-t border-line flex items-center gap-2">

          {recordingKind === 'video' ? (
            <video
              controls
              src={URL.createObjectURL(recordedBlob)}
              className="h-24 rounded-lg"
            />
          ) : (
            <audio
              controls
              src={URL.createObjectURL(
                recordedBlob
              )}
              className="flex-1"
            />
          )}

          <button
            type="button"
            onClick={
              discardRecording
            }
            className="text-xs border border-line rounded-md px-2 py-1"
          >
            Discard
          </button>

          <button
            type="button"
            onClick={
              sendRecording
            }
            disabled={uploading}
            className="text-xs bg-brass text-onbrass rounded-md px-3 py-1"
          >
            {uploading
              ? 'Sending...'
              : 'Send'}
          </button>

        </div>
      )}

      {recording && (
        <div className="px-3 py-2 border-t border-line flex items-center gap-3 text-sm text-coral">

          <span className="w-2 h-2 rounded-full bg-coral animate-pulse" />

          {recordingKind === 'video' ? '📹' : '🎤'} Recording{' '}
          {formatSeconds(
            recordSeconds
          )}

          <button
            type="button"
            onClick={
              stopRecording
            }
            className="ml-auto text-xs border border-coral rounded-md px-3 py-1"
          >
            Stop
          </button>

        </div>
      )}

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

      {!selectMode &&
        !recording &&
        !recordedBlob && (
        <form
          onSubmit={send}
          onPaste={handlePaste}
          className="p-3 border-t border-line flex items-center gap-2"
        >

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*,.mp3,.wav,.m4a,.ogg"
            onChange={handleFile}
            className="hidden"
          />

          <button
            type="button"
            onClick={() =>
              fileInputRef.current?.click()
            }
            disabled={uploading}
            title="Send photo, video or audio"
            className="focus-ring w-10 h-10 rounded-lg border border-line text-mist hover:text-brass hover:border-brass disabled:opacity-40"
          >
            📎
          </button>

          <button
            type="button"
            onClick={() => startRecording('audio')}
            disabled={uploading}
            title="Record voice message"
            className="focus-ring w-10 h-10 rounded-lg border border-line text-mist hover:text-brass hover:border-brass disabled:opacity-40"
          >
            🎤
          </button>

          <button
            type="button"
            onClick={() => startRecording('video')}
            disabled={uploading}
            title="Record video message"
            className="focus-ring w-10 h-10 rounded-lg border border-line text-mist hover:text-brass hover:border-brass disabled:opacity-40"
          >
            📹
          </button>

          <input
            ref={inputRef}
            value={text}
            onChange={(e) =>
              setText(e.target.value)
            }
            placeholder="Write a message..."
            className="focus-ring flex-1 min-w-0 bg-panel-2 border border-line rounded-lg px-3 py-2.5 text-sm text-paper placeholder:text-mist"
          />

          <button
            type="submit"
            disabled={
              sending ||
              uploading ||
              !text.trim()
            }
            className="focus-ring px-4 py-2.5 rounded-lg bg-brass text-onbrass font-medium disabled:opacity-40"
          >
            Send
          </button>

        </form>
      )}

    </div>
  )
}