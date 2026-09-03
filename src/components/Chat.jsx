import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '👏']

export default function Chat({
  selfId,
  peerId,
  peerName,
  targetMessageId = null,
}) {
  const [messages, setMessages] = useState([])
  const [reactions, setReactions] = useState({})
  const [selfRole, setSelfRole] = useState('student')

  // Messages this user has hidden from their own view only — "Delete
  // for me". The row stays in the database for the other person; we
  // just never render it here.
  const [hiddenIds, setHiddenIds] = useState(new Set())

  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
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

  const uploadChatFile = async (file) => {
    if (!file || !peerId) return

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
        type = 'video'
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

  const startRecording = async () => {
    if (recording || uploading) return

    setError('')

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Voice recording is not supported by this browser.'
        )
      }

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        })

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

        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })

        const file = new File(
          [blob],
          `voice-${Date.now()}.webm`,
          {
            type: recorder.mimeType || 'audio/webm',
          }
        )

        await uploadChatFile(file)
      }

      mediaRecorderRef.current = recorder

      recorder.start()

      setRecording(true)
    } catch (err) {
      console.error(err)
      setError(
        err.message || 'Could not start voice recording.'
      )
      setRecording(false)
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

  const renderMessage = (message) => {
    const parsed = parseMessage(message.content)

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
        <div className="min-w-[220px]">
          <div className="text-xs font-mono mb-2 opacity-70">
            🎤 Voice message
          </div>

          <audio
            controls
            src={parsed.url}
            className="w-full"
          />
        </div>
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

  return (
    <div className="flex flex-col h-[28rem] bg-panel border border-line rounded-lg overflow-hidden">

      {/* HEADER */}

      <div className="px-4 py-3 border-b border-line font-display text-lg">
        {peerName}
      </div>

      {/* MESSAGES */}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

        {messages.length === 0 && (
          <p className="text-mist text-sm">
            No messages yet — say hello.
          </p>
        )}

        {messages
          .filter((m) => !hiddenIds.has(m.id))
          .map((m) => {
          const mine = m.sender_id === selfId
          const reply = getReply(m)
          const messageCanEdit = canEdit(m)
          const messageCanDeleteEveryone = canDeleteEveryone(m)
          const isHighlighted =
            String(highlightedMessageId) === String(m.id)

          return (
            <div
              key={m.id}
              id={`private-message-${m.id}`}
              className={`flex ${
                mine ? 'justify-end' : 'justify-start'
              } ${
                isHighlighted
                  ? 'bg-brass/10 rounded-xl ring-2 ring-brass/60 p-2 -m-2'
                  : ''
              }`}
            >
              <div
                className={`max-w-[75%] flex flex-col ${
                  mine ? 'items-end' : 'items-start'
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
                    renderMessage(m)
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

                  <details className="relative leading-none">
                    <summary className="list-none cursor-pointer px-1 hover:text-brass">
                      ⋯
                    </summary>

                    <div
                      className={`absolute top-full mt-1 z-30 min-w-[160px] rounded-lg border border-line bg-panel shadow-xl py-1 text-xs ${
                        mine ? 'right-0' : 'left-0'
                      }`}
                    >
                      {messageCanEdit && (
                        <button
                          type="button"
                          onClick={() => startEdit(m)}
                          className="w-full text-left px-3 py-1.5 hover:bg-panel-2 text-paper"
                        >
                          Edit
                        </button>
                      )}

                      {messageCanDeleteEveryone && (
                        <button
                          type="button"
                          onClick={() => deleteForEveryone(m)}
                          className="w-full text-left px-3 py-1.5 hover:bg-panel-2 text-coral"
                        >
                          Delete for everyone
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => deleteForMe(m)}
                        className="w-full text-left px-3 py-1.5 hover:bg-panel-2 text-coral"
                      >
                        Delete for me
                      </button>
                    </div>
                  </details>

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

      {/* COMPOSER */}

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

        {/* VOICE */}

        {!recording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={uploading}
            className="focus-ring w-10 h-10 rounded-md border border-line text-lg disabled:opacity-40"
            title="Record voice message"
            aria-label="Record voice message"
          >
            🎤
          </button>
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
              ? 'Recording voice message…'
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

    </div>
  )
}
