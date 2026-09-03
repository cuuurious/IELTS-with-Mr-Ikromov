import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const MAX_FILE_MB = 25

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '👏']

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

  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const [selfRole, setSelfRole] = useState('student')
  const [showActions, setShowActions] = useState(false)

  const [replyingTo, setReplyingTo] = useState(null)

  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')

  const [recording, setRecording] = useState(false)
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
      .select('id, full_name, username, role')
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

      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [groupId, selfRole])

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

  const startRecording = async () => {
    setError('')

    try {
      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        throw new Error(
          'Voice recording is not supported by this browser.'
        )
      }

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        })

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
              'audio/webm',
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

    const file = new File(
      [recordedBlob],
      'voice-message.webm',
      {
        type:
          recordedBlob.type ||
          'audio/webm',
      }
    )

    await uploadFile(file, 'audio')

    setRecordedBlob(null)
    setRecordSeconds(0)
  }

  const deleteMessage = async (message) => {
    const allowed =
      message.sender_id === selfId ||
      selfRole === 'teacher'

    if (!allowed) return

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

  const toggleReaction = async (
    message,
    reaction
  ) => {
    const existing =
      (reactions[message.id] || []).find(
        (item) =>
          item.user_id === selfId &&
          item.reaction === reaction
      )

    if (existing) {
      const { error } =
        await supabase
          .from('group_message_reactions')
          .delete()
          .eq('id', existing.id)

      if (error) {
        setError(error.message)
      }

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

  return (
    <div className="group-chat-shell flex flex-col h-[36rem] bg-panel border border-line rounded-2xl overflow-hidden shadow-lg">

      <div className="px-4 py-3 border-b border-line bg-panel-2/70 flex items-center justify-between">

        <div>
          <div className="font-display text-lg">
            {groupName || 'Group chat'}
          </div>

          <div className="text-xs text-mist">
            Shared conversation · messages can be removed for everyone
          </div>
        </div>

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

      <div className="flex-1 min-h-0 flex">

        <div className="flex-1 min-w-0 overflow-y-auto px-4 py-4 space-y-3">

          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-mist text-sm">
              No messages yet — say hello to the group.
            </div>
          )}

          {messages.map((message) => {
            const mine =
              message.sender_id === selfId

            const sender =
              profiles[message.sender_id]

            const reply =
              getReply(message)

            // Deleting is sender-or-teacher (moderation); editing is
            // sender-only — a teacher should never be able to rewrite
            // a student's words, only remove them.
            const canDelete =
              mine ||
              selfRole === 'teacher'

            const canEdit =
              mine && Boolean(message.content)

            const messageReactions =
              reactions[message.id] || []

            const isHighlighted =
              String(highlightedMessageId) ===
              String(message.id)

            return (
              <div
                key={message.id}
                id={`group-message-${message.id}`}
                className={`flex ${
                  mine
                    ? 'justify-end'
                    : 'justify-start'
                } ${
                  isHighlighted
                    ? 'bg-brass/10 rounded-xl ring-2 ring-brass/60 p-2 -m-2'
                    : ''
                }`}
              >

                <div
                  className={`group max-w-[82%] ${
                    mine
                      ? 'items-end'
                      : 'items-start'
                  } flex flex-col`}
                >

                  <div className="px-1 mb-1 flex items-center gap-2 text-[11px]">

                    <span
                      className={`font-semibold ${
                        sender?.role === 'teacher'
                          ? 'text-brass'
                          : 'text-paper-dim'
                      }`}
                    >
                      {sender?.full_name ||
                        sender?.username ||
                        'Member'}
                    </span>

                    {sender?.role ===
                      'teacher' && (
                      <span className="rounded-full border border-brass/40 px-1.5 text-brass">
                        TEACHER
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

                    {(canEdit || canDelete) && (
                      <details className="relative leading-none ml-auto">
                        <summary className="list-none cursor-pointer px-1 text-mist hover:text-brass">
                          ⋯
                        </summary>

                        <div
                          className={`absolute top-full mt-1 z-30 min-w-[110px] rounded-lg border border-line bg-panel shadow-xl py-1 text-xs ${
                            mine ? 'right-0' : 'left-0'
                          }`}
                        >
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() =>
                                startEdit(message)
                              }
                              className="w-full text-left px-3 py-1.5 hover:bg-panel-2 text-paper"
                            >
                              Edit
                            </button>
                          )}

                          {canDelete && (
                            <button
                              type="button"
                              onClick={() =>
                                deleteMessage(message)
                              }
                              className="w-full text-left px-3 py-1.5 hover:bg-panel-2 text-coral"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </details>
                    )}

                  </div>

                  <div
                    className={`relative rounded-2xl px-3 py-2.5 shadow-sm ${
                      mine
                        ? 'bg-brass text-onbrass rounded-tr-md'
                        : 'bg-panel-2 text-paper rounded-tl-md border border-line'
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
                      'audio' && (
                      <audio
                        src={message.media_url}
                        controls
                        className="max-w-full"
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

                    <details className="relative">

                      <summary className="list-none cursor-pointer text-xs text-mist hover:text-brass px-1">
                        +
                      </summary>

                      <div className="absolute bottom-5 left-0 z-30 bg-panel border border-line rounded-lg shadow-xl p-1 flex gap-1">

                        {REACTIONS.map(
                          (reaction) => (
                            <button
                              key={reaction}
                              type="button"
                              onClick={() =>
                                toggleReaction(
                                  message,
                                  reaction
                                )
                              }
                              className="w-8 h-8 rounded-md hover:bg-panel-2"
                            >
                              {reaction}
                            </button>
                          )
                        )}

                      </div>

                    </details>

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

          <audio
            controls
            src={URL.createObjectURL(
              recordedBlob
            )}
            className="flex-1"
          />

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

          Recording{' '}
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

      {!recording &&
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
            onClick={
              startRecording
            }
            disabled={uploading}
            title="Record voice message"
            className="focus-ring w-10 h-10 rounded-lg border border-line text-mist hover:text-brass hover:border-brass disabled:opacity-40"
          >
            🎤
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