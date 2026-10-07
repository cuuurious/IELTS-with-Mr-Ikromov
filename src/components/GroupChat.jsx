import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { compressImageIfNeeded } from '../lib/compressImage'
import ProfileModal from './ProfileModal'
import MessageActionMenu from './MessageActionMenu'
import ReactionPicker from './ReactionPicker'
import VoiceBubble from './VoiceBubble'
import VideoNoteBubble from './VideoNoteBubble'
import ConfirmModal from './ConfirmModal'
import GroupSettingsModal from './GroupSettingsModal'
import { RoundCameraPreview, RecordedClipPreview } from './RoundCameraPreview'
import { FileBubble, isDocumentFile, DOCUMENT_ACCEPT } from './chatFiles'
import { useFileDrop, DropOverlay } from '../lib/useFileDrop'
import Icon from './Icon'
import PendingAttachment from './PendingAttachment'
import {
  ChatAvatar,
  ChatGlyph,
  chatTint,
  CHAT_ACTIONS_FLOAT,
  CHAT_ACTIONS_TOUCH,
  CHAT_ACTION_BUTTON,
  CHAT_ACTION_CHIP,
  CHAT_ICON_BUTTON,
} from './Chat'
import { groupBadge, groupColour, groupDisplayName } from '../lib/groupLook'

// 2026-10-06: a group chat now opens with only its latest 100 messages
// ("Load older messages" fetches the next 100), and reactions / "delete
// for me" markers are fetched for the loaded messages only, 100 ids per
// request — asking for every id at once made the URL too long.
const PAGE_SIZE = 100

const chunkIds = (ids, size = 100) => {
  const clean = ids.filter((id) => id && !String(id).startsWith('temp-'))
  const out = []
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size))
  return out
}

const GROUP_CHAT_ACCEPT = `image/*,video/*,audio/*,.mp3,.wav,.m4a,.ogg,${DOCUMENT_ACCEPT}`

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

// Distinct, deterministic name colour per sender — same idea as
// Telegram's per-member colours in a group, so members are easy to
// tell apart at a glance. Study room (2026-10-07): picked from the five
// soft skill colours (the same tint the sender's avatar uses); the
// teacher's name stays in the main ink colour with a "Teacher" chip.
const accentForSender = (sender) => {
  if (sender?.role === 'teacher') {
    return { name: 'text-paper', avatarBg: 'bg-brass' }
  }

  const tint = chatTint(sender?.id || '')

  return { name: tint.text, avatarBg: tint.tint }
}

export default function GroupChat({
  groupId,
  selfId,
  groupName,
  initialMessageId = null,
  // Optional (2026-10-07): `embedded` drops the chat's own card so it can
  // sit inside the list + conversation card; `onBack` shows a back arrow
  // on phones; `lookIndex` is the group's position (created_at order)
  // for its badge colour — see lib/groupLook.js.
  embedded = false,
  onBack = null,
  lookIndex = null,
}) {
  const [messages, setMessages] = useState([])
  const [profiles, setProfiles] = useState({})
  const [reactions, setReactions] = useState({})

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
  // Pasted / dropped file waiting for Send (2026-10-07).
  const [pendingFile, setPendingFile] = useState(null)
  useEffect(() => {
    setPendingFile(null)
  }, [groupId])
  const [error, setError] = useState('')

  const [selfRole, setSelfRole] = useState('student')
  const [viewingProfileId, setViewingProfileId] = useState(null)

  // The group's own row (name/photo/description/creator) — tapping
  // the header's avatar or name opens GroupSettingsModal, Telegram's
  // "tap the chat title for group info" pattern. Fetched here rather
  // than required as a prop so any caller of GroupChat automatically
  // gets this for free, same as how selfRole already works below.
  const [groupInfo, setGroupInfo] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [leftGroup, setLeftGroup] = useState(false)

  const [replyingTo, setReplyingTo] = useState(null)

  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')

  const [recording, setRecording] = useState(false)
  const [recordingKind, setRecordingKind] = useState('audio')
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState(null)

  const [highlightedMessageId, setHighlightedMessageId] = useState(null)

  const [confirmDialog, setConfirmDialog] = useState(null)

  // Which message's reply / react / options buttons are showing on a
  // touch screen (tap a bubble to reveal them; hover does it on desktop).
  const [actionsFor, setActionsFor] = useState(null)

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  // Paging + "is this about a loaded message?" checks (2026-10-06).
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const scrollBoxRef = useRef(null)
  const keepScrollRef = useRef(null)
  const messagesRef = useRef([])
  messagesRef.current = messages
  const profilesRef = useRef({})
  profilesRef.current = profiles

  // Only fetches people not loaded yet (2026-10-06 — it used to refetch
  // the sender's profile on every single incoming message).
  const loadProfiles = async (ids) => {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))].filter(
      (id) => !profilesRef.current[id]
    )

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

  // merge=true adds to what's loaded (older page); otherwise replaces.
  const loadReactions = async (messageRows, { merge = false } = {}) => {
    const ids = (messageRows || [])
      .map((m) => m.id)
      .filter(Boolean)

    if (!ids.length) {
      if (!merge) setReactions({})
      return
    }

    const all = []

    for (const part of chunkIds(ids)) {
      const { data, error } = await supabase
        .from('group_message_reactions')
        .select('*')
        .in('message_id', part)

      if (error) {
        console.error('Reaction loading error:', error)
        return
      }

      all.push(...(data || []))
    }

    const grouped = {}

    all.forEach((reaction) => {
      if (!grouped[reaction.message_id]) {
        grouped[reaction.message_id] = []
      }

      grouped[reaction.message_id].push(reaction)
    })

    setReactions((prev) => (merge ? { ...prev, ...grouped } : grouped))

    await loadProfiles(
      all.map((reaction) => reaction.user_id)
    )
  }

  // Latest PAGE_SIZE messages (2026-10-06). If a notification points at
  // an older message, everything from that message onward is loaded so
  // it can be scrolled to.
  const loadMessages = async () => {
    if (!groupId) return []

    const { data, error } = await supabase
      .from('group_messages')
      .select('*')
      .eq('group_id', groupId)
      .order('created_at', {
        ascending: false,
      })
      .limit(PAGE_SIZE)

    if (error) {
      setError(error.message)
      return []
    }

    let rows = (data || []).slice().reverse()
    const more = (data || []).length === PAGE_SIZE

    if (
      initialMessageId &&
      more &&
      rows.length &&
      !rows.some((r) => String(r.id) === String(initialMessageId))
    ) {
      const { data: target } = await supabase
        .from('group_messages')
        .select('created_at')
        .eq('id', initialMessageId)
        .maybeSingle()

      if (target?.created_at) {
        const { data: between } = await supabase
          .from('group_messages')
          .select('*')
          .eq('group_id', groupId)
          .gte('created_at', target.created_at)
          .lt('created_at', rows[0].created_at)
          .order('created_at', { ascending: true })
          .limit(500)

        if (between?.length) rows = [...between, ...rows]
      }
    }

    messagesRef.current = rows
    setMessages(rows)
    setHasOlder(more)

    await loadProfiles(
      rows.map((message) => message.sender_id)
    )

    await loadReactions(rows)

    return rows
  }

  // "Delete for me" markers for the given (loaded) messages only — the
  // old query read every marker ever, which stops at 1000 rows.
  const loadHiddenForMe = async (ids, { merge = false } = {}) => {
    if (!selfId) return

    const found = []

    for (const part of chunkIds(ids || [])) {
      const { data, error } = await supabase
        .from('group_message_deletions')
        .select('message_id')
        .eq('user_id', selfId)
        .in('message_id', part)

      if (error) {
        console.error(error)
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

  const loadOlder = async () => {
    if (loadingOlder || !groupId) return

    const oldest = messagesRef.current.find((m) => !m._optimistic)
    if (!oldest) return

    setLoadingOlder(true)

    try {
      const { data, error } = await supabase
        .from('group_messages')
        .select('*')
        .eq('group_id', groupId)
        .lt('created_at', oldest.created_at)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE)

      if (error) throw error

      const older = (data || []).slice().reverse()
      setHasOlder((data || []).length === PAGE_SIZE)

      if (!older.length) return

      const box = scrollBoxRef.current
      if (box) {
        keepScrollRef.current = { height: box.scrollHeight, top: box.scrollTop }
      }

      const known = new Set(messagesRef.current.map((m) => m.id))
      const fresh = older.filter((m) => !known.has(m.id))

      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id))
        return [...older.filter((m) => !ids.has(m.id)), ...prev]
      })

      await loadProfiles(fresh.map((m) => m.sender_id))
      await loadReactions(fresh, { merge: true })
      await loadHiddenForMe(fresh.map((m) => m.id), { merge: true })
    } catch (err) {
      console.error('Failed to load older messages:', err)
      setError(err?.message || 'Could not load older messages.')
    } finally {
      setLoadingOlder(false)
    }
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

      const { data: groupRow } = await supabase
        .from('groups')
        .select(
          'id, name, photo_url, description, created_by, allow_media, allow_voice_video_notes'
        )
        .eq('id', groupId)
        .maybeSingle()

      if (active && groupRow) {
        setGroupInfo(groupRow)
      }

      const rows = await loadMessages()
      await loadHiddenForMe(rows.map((m) => m.id))
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

          // This table has no group_id to filter on, so ignore
          // reactions on messages not loaded here (2026-10-06).
          if (
            !reaction ||
            !messagesRef.current.some((m) => m.id === reaction.message_id)
          ) {
            return
          }

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
    mediaName = null,
    replyToId = null,
  }) => {
    const payload = {
      group_id: groupId,
      sender_id: selfId,
      content,
      media_url: mediaUrl,
      media_type: mediaType,
    }

    // A shared document keeps its original file name (migration_65).
    if (mediaType === 'file' && mediaName) {
      payload.media_name = mediaName
    }

    if (replyToId) {
      payload.reply_to_id = replyToId
    }

    // Optimistic bubble — shared by every send path (text, photo/video,
    // voice/video note) since they all funnel through here. The insert
    // itself is fast; what isn't guaranteed to be fast is Supabase's
    // realtime broadcast, which is otherwise the ONLY thing that makes
    // a sent message actually show up in this view. Show it right away,
    // reconcile with the real row (or the realtime echo, whichever
    // arrives first) once the insert resolves.
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

    const { data: inserted, error } = await supabase
      .from('group_messages')
      .insert(payload)
      .select()
      .single()

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      throw error
    }

    setMessages((prev) => {
      const withoutTemp = prev.filter((m) => m.id !== tempId)

      if (withoutTemp.some((m) => m.id === inserted.id)) {
        return withoutTemp
      }

      return [...withoutTemp, inserted]
    })
  }

  const send = async (e) => {
    e.preventDefault()

    // A pasted / dropped file goes first, then the typed text (if any).
    if (pendingFile && !uploading) {
      const file = pendingFile
      setPendingFile(null)
      await sendPickedFile(file)
    }

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

  // Returns true once sent, false on failure — so a recorded voice /
  // video note is only discarded after it was really sent (2026-10-06).
  const uploadFile = async (incomingFile, mediaType) => {
    if (!incomingFile) return false

    // Shrink phone photos before upload (see lib/compressImage.js).
    const file = incomingFile.type?.startsWith('image/')
      ? await compressImageIfNeeded(incomingFile)
      : incomingFile

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(
        `Maximum file size is ${MAX_FILE_MB}MB.`
      )
      return false
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
        mediaName: file.name || null,
        replyToId: replyingTo?.id || null,
      })

      setReplyingTo(null)
      return true
    } catch (err) {
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

    await sendPickedFile(file)
  }

  // Shared by the attach button and drag-and-drop (2026-10-06).
  const sendPickedFile = async (file) => {
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
    } else if (isDocumentFile(file)) {
      // PDFs, Word, Excel, PowerPoint, text — same as private chats.
      mediaType = 'file'
    }

    if (!mediaType) {
      setError(
        'This type of file can\'t be sent. Photos, videos, audio, PDF, Word, Excel, PowerPoint and text files are supported.'
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

    const sent = await uploadFile(file, isVideo ? 'video_note' : 'audio')

    // Keep the recording on failure so it can be sent again (the
    // error is shown above the composer).
    if (!sent) return

    setRecordedBlob(null)
    setRecordSeconds(0)
  }

  // "Delete for everyone" actually removes the row — only the sender,
  // or the teacher moderating the group, can do that.
  const canDeleteEveryone = (message) =>
    message.sender_id === selfId || selfRole === 'teacher'

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
    // Same reasoning as insertMessage's optimistic bubble above: don't
    // wait on a realtime DELETE event to remove it from view when the
    // delete itself already succeeded. Put it back only if it didn't.
    setMessages((prev) => prev.filter((m) => m.id !== message.id))

    const { error } = await supabase
      .from('group_messages')
      .delete()
      .eq('id', message.id)

    if (error) {
      setError(error.message)

      setMessages((prev) =>
        prev.some((m) => m.id === message.id)
          ? prev
          : [...prev, message].sort(
              (a, b) => new Date(a.created_at) - new Date(b.created_at)
            )
      )
    }
  }

  // "Delete for me" is available to every member on any message — it
  // only hides it from this member's own view; everyone else still
  // sees it, same as Telegram.
  const deleteForMe = (message) => {
    setConfirmDialog({
      title: 'Remove this message from your view?',
      message: 'Remove this message from your view of the chat? Other members will still see it.',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => doDeleteForMe(message),
    })
  }

  const doDeleteForMe = async (message) => {
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
      } from your view of the chat? Other members will still see ${
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
    const removed = messages.filter((m) => ids.includes(m.id))

    setMessages((prev) => prev.filter((m) => !ids.includes(m.id)))

    const { error } = await supabase
      .from('group_messages')
      .delete()
      .in('id', ids)

    if (error) {
      setError(error.message)

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
  // 2026-10-06: shows immediately (optimistic), rolled back if the
  // server refuses it.
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

    const serverIds = mineIds.filter((id) => !String(id).startsWith('temp-'))

    if (serverIds.length) {
      const { error } =
        await supabase
          .from('group_message_reactions')
          .delete()
          .in('id', serverIds)

      if (error) {
        setError(error.message)
        setReactions((prev) => {
          const list = (prev[message.id] || []).filter(
            (item) => item.id !== placeholder?.id
          )
          const missing = mine.filter((item) => !list.some((r) => r.id === item.id))
          return { ...prev, [message.id]: [...list, ...missing] }
        })
        return
      }
    }

    // Clicking the reaction they already had just removes it (the
    // "take it back" case) — anything else replaces it.
    if (!placeholder) {
      return
    }

    const { data: inserted, error } =
      await supabase
        .from('group_message_reactions')
        .insert({
          message_id: message.id,
          user_id: selfId,
          reaction,
        })
        .select()
        .single()

    setReactions((prev) => {
      const list = (prev[message.id] || []).filter(
        (item) => item.id !== placeholder.id
      )
      if (error || !inserted || list.some((item) => item.id === inserted.id)) {
        return { ...prev, [message.id]: list }
      }
      return { ...prev, [message.id]: [...list, inserted] }
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

  const handlePaste = (event) => {
    const items = Array.from(
      event.clipboardData?.items || []
    )

    const imageItem = items.find(
      (item) =>
        item.kind === 'file' &&
        item.type.startsWith('image/')
    )

    if (!imageItem) return
    if (!canSendMedia) return

    const file =
      imageItem.getAsFile()

    if (!file) return

    event.preventDefault()

    // Waits above the message box until Send is pressed (2026-10-07 —
    // it used to be sent the moment it was pasted).
    setError('')
    setPendingFile(file)
    inputRef.current?.focus()
  }

  // Drag a file from the computer onto the chat to send it — same path
  // as the attach button, and only where that button is shown
  // (2026-10-06).
  const { isDragging, dropProps } = useFileDrop({
    accept: GROUP_CHAT_ACCEPT,
    multiple: false,
    disabled:
      !groupId ||
      leftGroup ||
      uploading ||
      recording ||
      Boolean(recordedBlob) ||
      selectMode ||
      !(selfRole === 'teacher' || groupInfo?.allow_media !== false),
    onFiles: (files) => {
      setError('')
      setPendingFile(files[0])
      inputRef.current?.focus()
    },
    onReject: () =>
      setError(
        'This type of file can\'t be sent. Photos, videos, audio, PDF, Word, Excel, PowerPoint and text files are supported.'
      ),
  })

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

  const groupInitial = String(groupName || 'G')
    .trim()
    .charAt(0)
    .toUpperCase() || 'G'

  // Per-group member permissions (set from Group info -> Manage by an
  // Owner/Admin — see GroupSettingsModal.jsx and migration_25.sql).
  // Staff can always send everything regardless of these — the toggle
  // is about restricting ordinary members, never about limiting staff
  // moderating their own group. `!== false` treats "not loaded yet" /
  // "column not set" the same as "allowed", so nothing breaks for
  // anyone who hasn't run migration_25 yet.
  const canSendMedia =
    selfRole === 'teacher' || groupInfo?.allow_media !== false

  const canSendVoiceVideo =
    selfRole === 'teacher' ||
    groupInfo?.allow_voice_video_notes !== false

  // A student who just left this group (via Group info -> Leave group)
  // no longer has a group_members row, so RLS would start rejecting
  // every query this component makes for it — swap to a plain notice
  // instead of letting the chat area error out trying to keep loading.
  if (leftGroup) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 bg-panel p-6 text-center ${
          embedded ? 'h-full' : 'h-[36rem] rounded-[22px] border border-line'
        }`}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel-2 text-paper-dim">
          <ChatGlyph name="people" className="h-7 w-7" />
        </span>
        <div className="text-base font-semibold text-paper">You've left this group</div>
        <p className="max-w-xs text-sm leading-6 text-mist">
          Switch to another group, or ask a teacher to add you back to this one.
        </p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="focus-ring mt-1 rounded-full bg-brass px-4 py-2 text-sm font-medium text-onbrass hover:bg-brass-dim md:hidden"
          >
            Back to groups
          </button>
        )}
      </div>
    )
  }

  const look = lookIndex == null ? null : groupColour(lookIndex)

  const timeOf = (value) =>
    new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })

  const startReplyTo = (message) => {
    setReplyingTo(message)

    setTimeout(
      () => inputRef.current?.focus(),
      50
    )
  }

  const renderActions = (message, mine, variant) => {
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
            startReplyTo(message)
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
            openReactionPicker(e, message)
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
            openMessageMenu(e, message)
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
    // Study room look (2026-10-07) — same pane as the private chat.
    <div
      {...dropProps}
      className={`group-chat-shell relative flex min-h-0 flex-col overflow-hidden bg-panel ${
        embedded
          ? 'h-full'
          : 'h-[36rem] rounded-[22px] border border-line'
      }`}
    >

      <DropOverlay show={isDragging} label="Drop to send" />

      <ProfileModal
        userId={viewingProfileId}
        viewerId={selfId}
        viewerRole={selfRole}
        onClose={() => setViewingProfileId(null)}
      />

      {settingsOpen && (
        <GroupSettingsModal
          group={groupInfo || { id: groupId, name: groupName }}
          selfId={selfId}
          selfRole={selfRole}
          onClose={() => setSettingsOpen(false)}
          onUpdated={(patch) =>
            setGroupInfo((prev) => ({ ...(prev || { id: groupId }), ...patch }))
          }
          onLeft={() => {
            setSettingsOpen(false)
            setLeftGroup(true)
          }}
        />
      )}

      {menuMessage && (
        <MessageActionMenu
          position={menuPosition}
          onClose={closeMessageMenu}
          items={[
            ...(Boolean(menuMessage.content)
              ? [
                  {
                    key: 'copy',
                    icon: <Icon name="clipboard" className="h-4 w-4" />,
                    label: 'Copy text',
                    onClick: () => copyMessageText(menuMessage),
                  },
                ]
              : []),
            ...(selfRole === 'teacher'
              ? [
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
                ]
              : []),
            ...(menuMessage.sender_id === selfId &&
            Boolean(menuMessage.content)
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

      {/* HEADER — tapping the photo/name opens group info (members,
          roles, description, staff controls), same as Telegram */}

      <div className="relative z-20 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 sm:px-4">

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className={`${CHAT_ICON_BUTTON} md:hidden`}
            aria-label="Back to groups"
            title="Back to groups"
          >
            <ChatGlyph name="back" className="h-5 w-5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={`focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 text-left ${onBack ? 'pl-0 md:pl-1' : 'pl-1'}`}
          title="Group info"
        >

          {groupInfo?.photo_url ? (
            <img
              src={groupInfo.photo_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-[14px] object-cover"
            />
          ) : (
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] text-sm font-semibold ${
                look ? `${look.tint} ${look.text}` : 'bg-panel-2 text-paper'
              }`}
              aria-hidden="true"
            >
              {groupBadge(groupName) === '?' ? groupInitial : groupBadge(groupName)}
            </span>
          )}

          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-paper">
              {groupName ? groupDisplayName(groupName) : 'Group chat'}
            </div>

            <div className="truncate text-xs text-mist">
              {groupInfo?.description || 'Group chat · tap for info and members'}
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

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className={CHAT_ICON_BUTTON}
          aria-label="Group info and members"
          title="Group info"
        >
          <ChatGlyph name="people" className="h-[18px] w-[18px]" />
        </button>

      </div>

      {/* PINNED MESSAGE — a slim bar under the header */}

      {pins.length > 0 && (() => {
        const activePin = pins[pinIndex] || pins[0]
        const pinnedMessage = messages.find(
          (m) => m.id === activePin?.message_id
        )

        if (!pinnedMessage) return null

        const pinnedSender = profiles[pinnedMessage.sender_id]

        return (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5 sm:px-4">

            <button
              type="button"
              onClick={() => jumpToMessage(pinnedMessage.id)}
              className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-0.5 text-left"
            >
              <span className="h-8 w-[3px] shrink-0 rounded-full bg-brass" aria-hidden="true" />

              <div className="min-w-0">
                <div className="flex items-center gap-1 truncate text-[11px] font-medium text-paper">
                  <Icon name="pin" className="h-3 w-3 text-mist" />
                  {pins.length > 1
                    ? `Pinned message ${pinIndex + 1} of ${pins.length}`
                    : 'Pinned message'}
                  <span className="font-normal text-mist">
                    {' · '}
                    {pinnedSender?.full_name ||
                      pinnedSender?.username ||
                      'Member'}
                  </span>
                </div>

                <div className="truncate text-xs text-paper-dim">
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
                className="focus-ring shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-paper-dim hover:bg-panel-2"
              >
                Next
              </button>
            )}

            {selfRole === 'teacher' && (
              <button
                type="button"
                onClick={() => unpinMessage(pinnedMessage.id)}
                title="Unpin"
                aria-label="Unpin message"
                className="focus-ring inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-mist hover:bg-panel-2 hover:text-paper"
              >
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
            )}

          </div>
        )
      })()}

      <div className="flex min-h-0 flex-1">

        <div ref={scrollBoxRef} className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-panel-2 px-3 py-4 [scrollbar-width:thin] sm:px-5">

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
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-reading-tint text-reading">
                <ChatGlyph name="people" className="h-7 w-7" />
              </span>
              <div>
                <div className="text-sm font-medium text-paper">No messages yet</div>
                <div className="mt-0.5 text-xs text-mist">Say hello to the group.</div>
              </div>
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

            const messagePinned = isPinned(message.id)

            const isHighlighted =
              String(highlightedMessageId) ===
              String(message.id)

            const prev = visible[index - 1]
            const next = visible[index + 1]

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

            // Looking forward too — only for the bubble's corner shape.
            const groupedWithNext = Boolean(
              next &&
                next.sender_id === message.sender_id &&
                new Date(next.created_at).toDateString() ===
                  new Date(message.created_at).toDateString() &&
                new Date(next.created_at) - new Date(message.created_at) <
                  5 * 60 * 1000
            )

            const senderName =
              sender?.full_name ||
              sender?.username ||
              'Member'

            const selected = selectedIds.has(message.id)

            const isEditing = editingId === message.id
            const mediaType = message.media_type
            const hasCaption = !isEditing && Boolean(message.content)
            const isVisual = !isEditing && (mediaType === 'image' || mediaType === 'video')
            const isRound = !isEditing && mediaType === 'video_note' && !message.content
            const showName = !mine && !groupedWithPrev

            const messageReactions = REACTIONS.filter((reaction) =>
              reactionCount(message.id, reaction)
            )

            const metaContent = (
              <>
                {messagePinned && (
                  <span title="Pinned"><Icon name="pin" className="h-3 w-3" /></span>
                )}
                {message.edited_at && <span className="italic">edited</span>}
                <span>{timeOf(message.created_at)}</span>
              </>
            )

            const metaTone = mine ? 'text-onbrass/70' : 'text-mist'

            const corners = mine
              ? `${groupedWithPrev ? 'rounded-tr-md' : ''} ${groupedWithNext ? 'rounded-br-md' : ''}`
              : `${groupedWithPrev ? 'rounded-tl-md' : ''} ${groupedWithNext ? 'rounded-bl-md' : ''}`

            return (
              <Fragment key={message.id}>

                {dateChanged && (
                  <div className={`flex justify-center ${index === 0 ? 'mb-3' : 'my-4'}`}>
                    <span className="rounded-full border border-line bg-panel px-3 py-1 text-[11px] font-medium text-paper-dim">
                      {formatDateDivider(message.created_at)}
                    </span>
                  </div>
                )}

                <div
                  id={`group-message-${message.id}`}
                  onClick={
                    selectMode
                      ? () => toggleSelected(message.id)
                      : () => setActionsFor(message.id)
                  }
                  data-actions={!selectMode && actionsFor === message.id ? 'on' : undefined}
                  className={`group/row flex items-start gap-2 ${
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
                    onChange={() =>
                      toggleSelected(message.id)
                    }
                    className="mt-2 h-[18px] w-[18px] shrink-0 accent-brass"
                    aria-label="Select message"
                  />
                )}

                {!mine && (
                  <div
                    className={`w-8 shrink-0 ${
                      selectMode
                        ? 'pointer-events-none'
                        : ''
                    }`}
                  >
                    {!groupedWithPrev && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setViewingProfileId(
                            message.sender_id
                          )
                        }}
                        className="focus-ring block rounded-full"
                        aria-label={`View ${senderName}'s profile`}
                      >
                        <ChatAvatar
                          name={senderName}
                          url={sender?.avatar_url}
                          seed={message.sender_id}
                          size="h-8 w-8"
                          text="text-[11px]"
                        />
                      </button>
                    )}
                  </div>
                )}

                <div
                  className={`relative flex min-w-0 max-w-[min(82%,560px)] flex-col ${
                    mine
                      ? 'items-end'
                      : 'items-start'
                  } ${
                    selectMode ? 'pointer-events-none' : ''
                  }`}
                >

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
                    className={`relative max-w-full select-none text-[14.5px] leading-[1.45] ${
                      isRound
                        ? ''
                        : `rounded-[18px] ${corners} ${
                            mine
                              ? 'bg-brass text-onbrass'
                              : 'border border-line bg-panel text-paper'
                          } ${isVisual ? 'p-1' : 'px-3 py-2'}`
                    }`}
                  >

                    {swipeVisual.id === message.id &&
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

                    {showName && (
                      <div className={`mb-0.5 flex items-center gap-1.5 ${isVisual ? 'px-2 pt-1' : isRound ? 'px-1' : ''}`}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setViewingProfileId(
                              message.sender_id
                            )
                          }}
                          className={`focus-ring truncate rounded text-[13px] font-semibold hover:underline ${accent.name}`}
                        >
                          {senderName}
                        </button>

                        {sender?.role === 'teacher' && (
                          <span className="shrink-0 rounded-full bg-speaking-tint px-1.5 py-px text-[10px] font-medium text-speaking">
                            Teacher
                          </span>
                        )}
                      </div>
                    )}

                    {reply && (
                      <div
                        className={`mb-1.5 rounded-lg border-l-[3px] px-2.5 py-1 text-xs ${
                          isVisual ? 'mx-1 mt-1' : ''
                        } ${
                          mine
                            ? 'border-onbrass/60 bg-onbrass/10'
                            : 'border-brass bg-panel-2'
                        }`}
                      >
                        <div className="font-semibold">
                          {reply.sender_id === selfId
                            ? 'You'
                            : profiles[reply.sender_id]?.full_name ||
                              profiles[reply.sender_id]?.username ||
                              'Member'}
                        </div>

                        <div className="truncate opacity-75">
                          {reply.content ||
                            'Media message'}
                        </div>
                      </div>
                    )}

                    {mediaType ===
                      'image' && (
                      <img
                        src={message.media_url}
                        alt="Shared photo"
                        className={`block max-h-72 max-w-full rounded-[14px] object-cover ${hasCaption ? 'w-full' : ''}`}
                      />
                    )}

                    {mediaType ===
                      'video' && (
                      <video
                        src={message.media_url}
                        controls
                        className="block max-h-72 max-w-full rounded-[14px]"
                      />
                    )}

                    {mediaType ===
                      'video_note' && (
                      <VideoNoteBubble src={message.media_url} />
                    )}

                    {mediaType ===
                      'audio' && (
                      <VoiceBubble
                        src={message.media_url}
                        tone={mine ? 'mine' : 'theirs'}
                      />
                    )}

                    {mediaType ===
                      'file' && (
                      <FileBubble
                        url={message.media_url}
                        name={message.media_name}
                        mine={mine}
                      />
                    )}

                    {isEditing ? (
                      <div className="mt-1 flex items-center gap-2">

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
                          className="focus-ring min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 py-1 text-paper"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            saveEdit(message)
                          }
                          className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold"
                        >
                          Save
                        </button>

                      </div>
                    ) : (
                      message.content && (
                        <div
                          className={`whitespace-pre-wrap break-words ${
                            isVisual
                              ? 'px-2 pb-1 pt-1.5'
                              : mediaType
                              ? 'mt-2'
                              : ''
                          }`}
                        >
                          {message.content}
                          <span className="invisible ml-2.5 inline-flex items-center gap-1 align-baseline text-[11px] leading-none" aria-hidden="true">
                            {metaContent}
                          </span>
                        </div>
                      )
                    )}

                    {hasCaption && (
                      <span className={`absolute bottom-1.5 right-3 inline-flex items-center gap-1 text-[11px] leading-none ${metaTone}`}>
                        {metaContent}
                      </span>
                    )}

                    {!hasCaption && isVisual && (
                      <span className="pointer-events-none absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[11px] leading-none text-white">
                        {metaContent}
                      </span>
                    )}

                    {!hasCaption && !isVisual && (
                      <div
                        className={`mt-1 flex items-center justify-end gap-1 text-[11px] leading-none ${
                          isRound ? 'ml-auto w-fit rounded-full bg-panel px-2 py-1 text-mist' : metaTone
                        }`}
                      >
                        {metaContent}
                      </div>
                    )}

                  </div>

                  {/* REACTIONS — small chips under the bubble */}
                  {messageReactions.length > 0 && (
                    <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}`}>
                      {messageReactions.map((reaction) => (
                        <button
                          key={reaction}
                          type="button"
                          title={reactedByLabel(
                            message.id,
                            reaction
                          )}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleReaction(
                              message,
                              reaction
                            )
                          }}
                          className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                            hasReaction(
                              message.id,
                              reaction
                            )
                              ? 'border-brass/40 bg-brass/10 text-paper'
                              : 'border-line bg-panel text-paper-dim hover:text-paper'
                          }`}
                        >
                          <span>{reaction}</span>
                          <span className="font-medium">
                            {reactionCount(
                              message.id,
                              reaction
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* ACTIONS — reply, react, more. Hover shows them beside
                      the bubble on a computer; on a phone, tap the bubble. */}
                  {!selectMode && renderActions(message, mine, 'float')}
                  {!selectMode && renderActions(message, mine, 'touch')}

                </div>

                </div>
              </Fragment>
            )
          })}

          <div ref={bottomRef} />

        </div>

      </div>

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
              {profiles[replyingTo.sender_id]?.full_name ||
                profiles[replyingTo.sender_id]?.username ||
                'Member'}
            </div>

            <div className="truncate text-xs text-mist">
              {replyingTo.content ||
                'Media message'}
            </div>

          </div>

          <button
            type="button"
            onClick={() =>
              setReplyingTo(null)
            }
            className="focus-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-mist hover:bg-panel-2 hover:text-paper"
            aria-label="Cancel reply"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>

        </div>
      )}

      {recordedBlob && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-3 py-2.5">

          <RecordedClipPreview
            blob={recordedBlob}
            kind={recordingKind}
          />

          <button
            type="button"
            onClick={
              discardRecording
            }
            className="focus-ring ml-auto shrink-0 rounded-full bg-panel-2 px-3.5 py-2 text-xs font-medium text-paper-dim transition-colors hover:text-urgent"
          >
            Discard
          </button>

          <button
            type="button"
            onClick={
              sendRecording
            }
            disabled={uploading}
            className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brass px-4 py-2 text-xs font-medium text-onbrass hover:bg-brass-dim disabled:opacity-40"
          >
            <Icon name="send" className="h-3.5 w-3.5" />
            {uploading
              ? 'Sending...'
              : 'Send'}
          </button>

        </div>
      )}

      {recording && (
        <div className="flex shrink-0 items-center gap-3 border-t border-line bg-urgent-tint px-4 py-2.5 text-sm font-medium text-urgent">

          {recordingKind === 'video' && (
            <RoundCameraPreview stream={streamRef.current} />
          )}

          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-urgent opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-urgent" />
          </span>

          <Icon name={recordingKind === 'video' ? 'video' : 'mic'} className="h-4 w-4" />

          Recording{' '}
          {formatSeconds(
            recordSeconds
          )}

          <button
            type="button"
            onClick={
              stopRecording
            }
            className="focus-ring ml-auto shrink-0 rounded-full bg-urgent px-3.5 py-1.5 text-xs font-medium text-panel"
          >
            Stop
          </button>

        </div>
      )}

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

      {/* COMPOSER — one rounded bar */}

      {!selectMode &&
        !recording &&
        !recordedBlob && (
        <form
          onSubmit={send}
          onPaste={handlePaste}
          className="shrink-0 border-t border-line bg-panel px-2.5 py-2.5 sm:px-4"
        >

          {canSendMedia && (
            <input
              ref={fileInputRef}
              type="file"
              accept={GROUP_CHAT_ACCEPT}
              onChange={handleFile}
              className="hidden"
            />
          )}

          <PendingAttachment file={pendingFile} onRemove={() => setPendingFile(null)} disabled={uploading} />

          <div className={`flex items-center gap-1 rounded-[26px] border border-line bg-panel-2 p-1.5 transition-colors focus-within:border-paper-dim/40 ${canSendMedia ? '' : 'pl-3'}`}>

            {canSendMedia && (
              <button
                type="button"
                onClick={() =>
                  fileInputRef.current?.click()
                }
                disabled={uploading}
                title="Send photo, video, audio or file"
                aria-label="Send photo, video, audio or file"
                className={`${CHAT_ICON_BUTTON} hover:bg-panel`}
              >
                <Icon name="paperclip" className="h-[18px] w-[18px]" />
              </button>
            )}

            <input
              ref={inputRef}
              value={text}
              onChange={(e) =>
                setText(e.target.value)
              }
              placeholder="Write a message…"
              className="min-w-0 flex-1 !border-0 !bg-transparent px-1.5 py-2 text-[14.5px] !text-paper outline-none placeholder:text-mist"
            />

            {canSendVoiceVideo && (
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
            )}

            {canSendVoiceVideo && (
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
            )}

            <button
              type="submit"
              disabled={
                sending ||
                uploading ||
                (!text.trim() && !pendingFile)
              }
              className="focus-ring ml-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brass text-onbrass transition-colors hover:bg-brass-dim disabled:opacity-35"
              aria-label="Send message"
              title="Send"
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
