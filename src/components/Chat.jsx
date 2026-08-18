import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Chat({ selfId, peerId, peerName }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')

  const bottomRef = useRef(null)
  const fileRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])

  useEffect(() => {
    if (!peerId) return

    let active = true

    const load = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${selfId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${selfId})`
        )
        .order('created_at', { ascending: true })

      if (!error && active) {
        setMessages(data || [])
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

  const parseMessage = (content) => {
    if (!content) {
      return {
        type: 'text',
        text: '',
      }
    }

    try {
      const parsed = JSON.parse(content)

      if (
        parsed &&
        parsed.type &&
        parsed.url
      ) {
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

  const sendText = async (e) => {
    e.preventDefault()

    const content = text.trim()

    if (!content || !peerId || sending) {
      return
    }

    setSending(true)
    setError('')
    setText('')

    const { error: sendError } = await supabase
      .from('messages')
      .insert({
        sender_id: selfId,
        receiver_id: peerId,
        content,
      })

    if (sendError) {
      console.error(sendError)
      setError(sendError.message)
      setText(content)
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

      const { error: messageError } = await supabase
        .from('messages')
        .insert({
          sender_id: selfId,
          receiver_id: peerId,
          content: messageContent,
        })

      if (messageError) {
        throw messageError
      }
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

      const recorder =
        new MediaRecorder(stream)

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

        const blob = new Blob(
          audioChunksRef.current,
          {
            type:
              recorder.mimeType ||
              'audio/webm',
          }
        )

        const file = new File(
          [blob],
          `voice-${Date.now()}.webm`,
          {
            type:
              recorder.mimeType ||
              'audio/webm',
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
        err.message ||
          'Could not start voice recording.'
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

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">

        {messages.length === 0 && (
          <p className="text-mist text-sm">
            No messages yet — say hello.
          </p>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
              m.sender_id === selfId
                ? 'ml-auto bg-brass text-onbrass'
                : 'mr-auto bg-panel-2 text-paper'
            }`}
          >

            {renderMessage(m)}

            <div className="text-[10px] opacity-60 font-mono mt-1">
              {new Date(
                m.created_at
              ).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>

          </div>
        ))}

        <div ref={bottomRef} />

      </div>

      {/* ERROR */}

      {error && (
        <div className="px-3 py-2 border-t border-line text-coral text-xs">
          {error}
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
            sending ||
            uploading ||
            recording ||
            !text.trim()
          }
          className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40"
        >
          {uploading ? 'Sending…' : 'Send'}
        </button>

      </form>

    </div>
  )
}