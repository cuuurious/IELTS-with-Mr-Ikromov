import { useEffect, useRef, useState } from 'react'

export default function AudioRecorder({ label, existingUrl, onSaved, onUpload, onDelete, uploading }) {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [error, setError] = useState('')
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const streamRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => () => {
    clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const start = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const mr = new MediaRecorder(stream, { mimeType: mime })
      chunksRef.current = []
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data)
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setPreviewUrl(URL.createObjectURL(blob))
        onSaved(blob)
        stream.getTracks().forEach((t) => t.stop())
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true)
      setPaused(false)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch {
      setError('Microphone access was blocked. Allow microphone access and try again.')
    }
  }

  const pause = () => { mediaRecorderRef.current?.pause(); clearInterval(timerRef.current); setPaused(true) }
  const resume = () => { mediaRecorderRef.current?.resume(); timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000); setPaused(false) }
  const stop = () => { mediaRecorderRef.current?.stop(); setRecording(false); clearInterval(timerRef.current) }
  const discard = () => { setPreviewUrl(null); setSeconds(0); onDelete() }
  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const ext = file.name.toLowerCase().split('.').pop()
    if (!['mp3', 'wav'].includes(ext)) return setError('Please choose an MP3 or WAV file.')
    setError('')
    await onUpload(file)
  }

  const hasTake = Boolean(existingUrl || previewUrl)
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3 flex flex-col gap-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-mist">Record directly or upload an MP3/WAV.</div>
      {!recording && !hasTake && <button onClick={start} disabled={uploading} className="focus-ring px-3 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40">🎙 Start recording</button>}
      {recording && !paused && <button onClick={pause} className="focus-ring px-3 py-2 rounded-md border border-brass text-brass">Pause · {time}</button>}
      {recording && paused && <button onClick={resume} className="focus-ring px-3 py-2 rounded-md border border-brass text-brass">Resume · {time}</button>}
      {recording && <button onClick={stop} className="focus-ring px-3 py-2 rounded-md bg-coral text-paper">Stop</button>}
      {!recording && hasTake && <>
        <audio controls src={previewUrl || existingUrl} className="w-full" />
        <div className="flex gap-2">
          <button onClick={start} disabled={uploading} className="focus-ring px-3 py-2 rounded-md border border-line text-sm">Re-record</button>
          <button onClick={discard} disabled={uploading} className="focus-ring px-3 py-2 rounded-md border border-coral text-coral text-sm">Delete</button>
        </div>
      </>}
      {!recording && <>
        <input ref={fileRef} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={handleUpload} className="hidden" />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="focus-ring px-3 py-2 rounded-md border border-line text-mist hover:border-brass hover:text-brass text-sm disabled:opacity-40">📎 Upload MP3 / WAV</button>
      </>}
      {uploading && <span className="text-mist text-xs font-mono">saving…</span>}
      {error && <span className="text-coral text-xs">{error}</span>}
    </div>
  )
}
