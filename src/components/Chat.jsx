import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Simple 1:1 chat between the current user and `peerId`.
export default function Chat({ selfId, peerId, peerName }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

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
      if (!error && active) setMessages(data || [])
    }
    load()

    const channel = supabase
      .channel(`chat-${[selfId, peerId].sort().join('-')}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const m = payload.new
          const belongs =
            (m.sender_id === selfId && m.receiver_id === peerId) ||
            (m.sender_id === peerId && m.receiver_id === selfId)
          if (belongs) setMessages((prev) => [...prev, m])
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [selfId, peerId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (e) => {
    e.preventDefault()
    const content = text.trim()
    if (!content || !peerId) return
    setSending(true)
    setText('')
    const { error } = await supabase
      .from('messages')
      .insert({ sender_id: selfId, receiver_id: peerId, content })
    if (error) console.error(error)
    setSending(false)
  }

  if (!peerId) {
    return <p className="text-mist">Select a conversation to start chatting.</p>
  }

  return (
    <div className="flex flex-col h-[28rem] bg-panel border border-line rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-line font-display text-lg">{peerName}</div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-mist text-sm">No messages yet — say hello.</p>
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
            {m.content}
            <div className="text-[10px] opacity-60 font-mono mt-1">
              {new Date(m.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="flex gap-2 p-3 border-t border-line">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          className="focus-ring flex-1 bg-panel-2 border border-line rounded-md px-3 py-2 text-sm text-paper placeholder:text-mist"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  )
}
