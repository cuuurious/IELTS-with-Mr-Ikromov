import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { guessMimeType } from '../lib/mime'

async function notifyGroupChat(groupId, senderId, previewText) {
  try {
    const { data: members } = await supabase.from('group_members').select('student_id, profiles!inner(status)').eq('group_id', groupId).eq('profiles.status', 'approved')
    const { data: teacher } = await supabase.from('profiles').select('id').eq('role', 'teacher').eq('status', 'approved').limit(1).maybeSingle()
    const recipientIds = [...new Set([...(members || []).map((m) => m.student_id), teacher?.id])].filter((id) => id && id !== senderId)
    if (!recipientIds.length) return
    const { data: sender } = await supabase.from('profiles').select('full_name').eq('id', senderId).maybeSingle()
    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData?.session?.access_token
    if (!accessToken) return
    fetch('/.netlify/functions/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ userIds: recipientIds, title: sender?.full_name || 'New group message', body: previewText, link: '/app' }),
    }).catch((err) => console.error('group chat push failed', err))
  } catch (err) { console.error('notifyGroupChat failed', err) }
}

const MAX_FILE_MB = 25

export default function GroupChat({ groupId, selfId, groupName }) {
  const [messages, setMessages] = useState([])
  const [profiles, setProfiles] = useState({})
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [selfRole, setSelfRole] = useState('student')
  const [actions, setActions] = useState([])
  const [showActions, setShowActions] = useState(false)

  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [recordedBlob, setRecordedBlob] = useState(null)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const streamRef = useRef(null)
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)

  const loadMessages = async () => {
    const { data, error } = await supabase.from('group_messages').select('*').eq('group_id', groupId).order('created_at', { ascending: true })
    if (error) return
    setMessages(data || [])
    const ids = [...new Set((data || []).map((m) => m.sender_id))]
    if (ids.length) {
      const { data: people } = await supabase.from('profiles').select('id, full_name, role').in('id', ids)
      const map = {}
      ;(people || []).forEach((p) => (map[p.id] = p))
      setProfiles((prev) => ({ ...prev, ...map }))
    }
  }

  const loadActions = async () => {
    if (selfRole !== 'teacher') return
    const { data } = await supabase.from('group_message_actions').select('*').eq('group_id', groupId).order('created_at', { ascending: false }).limit(50)
    if (!data) return
    const ids = [...new Set(data.flatMap((a) => [a.actor_id, a.target_sender_id]).filter(Boolean))]
    if (ids.length) {
      const { data: people } = await supabase.from('profiles').select('id, full_name, role').in('id', ids)
      const map = {}
      ;(people || []).forEach((p) => (map[p.id] = p))
      setProfiles((prev) => ({ ...prev, ...map }))
    }
    setActions(data)
  }

  useEffect(() => {
    if (!groupId) return
    let active = true
    supabase.from('profiles').select('role').eq('id', selfId).maybeSingle().then(({ data }) => { if (active) setSelfRole(data?.role || 'student') })
    loadMessages()
    return () => { active = false }
  }, [groupId, selfId])

  useEffect(() => {
    if (!groupId) return
    const channel = supabase
      .channel(`group-chat-${groupId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, (payload) => {
        setMessages((prev) => prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, (payload) => {
        setMessages((prev) => prev.map((m) => m.id === payload.new.id ? payload.new : m))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` }, (payload) => {
        setMessages((prev) => prev.filter((m) => m.id !== payload.old.id))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_message_actions', filter: `group_id=eq.${groupId}` }, () => loadActions())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [groupId, selfRole])

  useEffect(() => { if (selfRole === 'teacher') loadActions() }, [groupId, selfRole])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); clearInterval(timerRef.current) }, [])

  useEffect(() => {
    if (!groupId) return
    const onPaste = (e) => {
      const images = Array.from(e.clipboardData?.items || []).filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter(Boolean)
      if (images.length) { e.preventDefault(); uploadAndSend(images[0], 'image', '📷 Pasted photo') }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [groupId, selfId])

  const insertMessage = async ({ content = null, mediaUrl = null, mediaType = null }) => {
    const { error } = await supabase.from('group_messages').insert({ group_id: groupId, sender_id: selfId, content, media_url: mediaUrl, media_type: mediaType })
    if (error) throw error
  }

  const send = async (e) => {
    e.preventDefault()
    const content = text.trim()
    if (!content) return
    setSending(true); setText('')
    try { await insertMessage({ content }); await notifyGroupChat(groupId, selfId, content.length > 120 ? `${content.slice(0, 117)}…` : content) } catch (err) { setUploadError(err.message) } finally { setSending(false) }
  }

  const uploadAndSend = async (file, mediaType, previewLabel) => {
    if (!file) return
    if (file.size > MAX_FILE_MB * 1024 * 1024) return setUploadError(`File is too large (max ${MAX_FILE_MB}MB).`)
    setUploading(true); setUploadError('')
    try {
      const ext = file.name?.split('.').pop() || (mediaType === 'audio' ? 'webm' : 'dat')
      const path = `${selfId}/${groupId}/${Date.now()}-${mediaType}.${ext}`
      const { error: upErr } = await supabase.storage.from('group-chat').upload(path, file, { upsert: true, contentType: guessMimeType(path, file.type) })
      if (upErr) throw upErr
      const url = supabase.storage.from('group-chat').getPublicUrl(path).data.publicUrl
      await insertMessage({ mediaUrl: url, mediaType })
      await notifyGroupChat(groupId, selfId, previewLabel)
    } catch (err) { setUploadError(err.message) } finally { setUploading(false) }
  }

  const handleFilePick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const type = file.type
    const mediaType = type.startsWith('video/') ? 'video' : type.startsWith('image/') ? 'image' : type.startsWith('audio/') || /\.(mp3|wav|m4a|webm)$/i.test(file.name) ? 'audio' : null
    if (!mediaType) return setUploadError('Choose an image, video, MP3, WAV, M4A or other audio file.')
    await uploadAndSend(file, mediaType, mediaType === 'image' ? '📷 Photo' : mediaType === 'video' ? '🎥 Video' : '🎵 Audio')
  }

  const startRecording = async () => {
    setUploadError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data)
      recorder.onstop = () => { setRecordedBlob(new Blob(chunksRef.current, { type: 'audio/webm' })); stream.getTracks().forEach((t) => t.stop()) }
      recorder.start(); mediaRecorderRef.current = recorder; setRecording(true); setRecordSeconds(0)
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000)
    } catch { setUploadError('Microphone access was denied or is unavailable.') }
  }

  const stopRecording = () => { mediaRecorderRef.current?.stop(); setRecording(false); clearInterval(timerRef.current) }
  const discardRecording = () => { setRecordedBlob(null); setRecordSeconds(0) }
  const sendRecording = async () => { if (!recordedBlob) return; await uploadAndSend(new File([recordedBlob], 'voice-message.webm', { type: 'audio/webm' }), 'audio', '🎤 Voice message'); setRecordedBlob(null); setRecordSeconds(0) }

  const deleteMessage = async (message) => {
    if (!window.confirm('Delete this message for everyone?')) return
    const { error } = await supabase.from('group_messages').delete().eq('id', message.id)
    if (error) setUploadError(error.message)
  }

  const startEdit = (message) => { setEditingId(message.id); setEditingText(message.content || '') }
  const saveEdit = async (message) => {
    const content = editingText.trim()
    if (!content) return
    const { error } = await supabase.from('group_messages').update({ content }).eq('id', message.id)
    if (error) setUploadError(error.message)
    else setEditingId(null)
  }

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  if (!groupId) return <p className="text-mist">You're not in a group yet.</p>

  return (
    <div className="group-chat-shell flex flex-col h-[36rem] bg-panel border border-line rounded-2xl overflow-hidden shadow-lg">
      <div className="px-4 py-3 border-b border-line bg-panel-2/70 flex items-center justify-between">
        <div><div className="font-display text-lg">{groupName || 'Group chat'}</div><div className="text-xs text-mist">Shared conversation · messages can be removed for everyone</div></div>
        {selfRole === 'teacher' && <button onClick={() => setShowActions((v) => !v)} className="focus-ring text-xs px-3 py-1.5 rounded-full border border-line text-mist hover:border-brass hover:text-brass">{showActions ? 'Hide activity' : 'Recent activity'}</button>}
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && <div className="h-full flex items-center justify-center text-mist text-sm">No messages yet — say hello to the group.</div>}
          {messages.map((m) => {
            const mine = m.sender_id === selfId
            const sender = profiles[m.sender_id]
            const canManage = mine || selfRole === 'teacher'
            return <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`group max-w-[82%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                <div className="px-1 mb-1 flex items-center gap-2 text-[11px]">
                  <span className={`font-semibold ${sender?.role === 'teacher' ? 'text-brass' : 'text-paper-dim'}`}>{sender?.full_name || 'Member'}</span>
                  {sender?.role === 'teacher' && <span className="rounded-full border border-brass/40 px-1.5 text-brass">TEACHER</span>}
                  <span className="text-mist">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className={`relative rounded-2xl px-3 py-2.5 shadow-sm ${mine ? 'bg-brass text-onbrass rounded-tr-md' : 'bg-panel-2 text-paper rounded-tl-md border border-line'}`}>
                  {m.media_type === 'image' && <img src={m.media_url} alt="Shared photo" className="rounded-xl max-h-72 max-w-full object-contain" />}
                  {m.media_type === 'video' && <video src={m.media_url} controls className="rounded-xl max-h-72 max-w-full" />}
                  {m.media_type === 'audio' && <audio src={m.media_url} controls className="max-w-full" />}
                  {editingId === m.id ? <div className="flex gap-2 mt-1"><input autoFocus value={editingText} onChange={(e) => setEditingText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveEdit(m)} className="focus-ring flex-1 rounded-lg px-2 py-1 bg-panel text-paper border border-line" /><button onClick={() => saveEdit(m)} className="text-xs font-medium">Save</button></div> : m.content && <div className={m.media_type ? 'mt-2 whitespace-pre-wrap' : 'whitespace-pre-wrap'}>{m.content}</div>}
                  {canManage && <div className="absolute -top-3 right-1 hidden group-hover:flex gap-1 bg-panel border border-line rounded-full px-1.5 py-1 shadow-md"><button onClick={() => startEdit(m)} className="text-[10px] text-mist hover:text-brass">Edit</button><button onClick={() => deleteMessage(m)} className="text-[10px] text-mist hover:text-coral">Delete</button></div>}
                </div>
              </div>
            </div>
          })}
          <div ref={bottomRef} />
        </div>

        {showActions && selfRole === 'teacher' && <aside className="w-72 border-l border-line bg-panel-2/60 overflow-y-auto p-3 hidden lg:block">
          <div className="text-xs uppercase tracking-wide text-mist font-mono mb-3">Recent message actions</div>
          {actions.length === 0 && <p className="text-xs text-mist">No edits or deletions yet.</p>}
          <div className="space-y-2">{actions.map((a) => <div key={a.id} className="rounded-lg border border-line bg-panel p-3 text-xs"><div className="flex justify-between gap-2"><span className={a.action === 'deleted' ? 'text-coral' : 'text-brass'}>{a.action}</span><span className="text-mist">{new Date(a.created_at).toLocaleString()}</span></div><div className="mt-1 text-paper-dim">{profiles[a.actor_id]?.full_name || 'Teacher'} {a.action === 'deleted' ? 'deleted' : 'edited'} a message from {profiles[a.target_sender_id]?.full_name || 'student'}.</div>{a.action === 'edited' && a.new_content && <div className="mt-2 text-paper-dim truncate">“{a.new_content}”</div>}</div>)}</div>
        </aside>}
      </div>

      {uploadError && <p className="text-coral text-xs px-4 py-2 border-t border-line">{uploadError}</p>}
      {recordedBlob && <div className="flex items-center gap-2 px-3 py-2 border-t border-line bg-panel-2"><audio src={URL.createObjectURL(recordedBlob)} controls className="flex-1" /><button type="button" onClick={discardRecording} className="focus-ring text-xs px-2 py-1 rounded-md border border-line text-mist">Discard</button><button type="button" onClick={sendRecording} disabled={uploading} className="focus-ring text-xs px-3 py-1 rounded-md bg-brass text-onbrass font-medium">{uploading ? 'Sending…' : 'Send'}</button></div>}
      {recording && <div className="flex items-center gap-2 px-3 py-2 border-t border-line bg-panel-2 text-coral text-sm"><span className="w-2 h-2 rounded-full bg-coral animate-pulse" /> Recording… {fmtTime(recordSeconds)}<button type="button" onClick={stopRecording} className="focus-ring ml-auto text-xs px-3 py-1 rounded-md border border-coral text-coral">Stop</button></div>}
      {!recording && !recordedBlob && <form onSubmit={send} className="flex gap-2 p-3 border-t border-line items-center bg-panel">
        <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.mp3,.wav" onChange={handleFilePick} className="hidden" />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Send photo, video or audio" className="focus-ring w-10 h-10 rounded-xl border border-line text-mist hover:text-brass hover:border-brass flex items-center justify-center disabled:opacity-40">📎</button>
        <button type="button" onClick={startRecording} disabled={uploading} title="Record a voice message" className="focus-ring w-10 h-10 rounded-xl border border-line text-mist hover:text-brass hover:border-brass flex items-center justify-center disabled:opacity-40">🎤</button>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message… paste a picture with Ctrl/Cmd + V" className="focus-ring flex-1 bg-panel-2 border border-line rounded-xl px-3 py-2.5 text-sm text-paper placeholder:text-mist" />
        <button type="submit" disabled={sending || uploading || !text.trim()} className="focus-ring px-4 py-2.5 rounded-xl bg-brass text-onbrass font-medium disabled:opacity-40">Send</button>
      </form>}
    </div>
  )
}
