import SkillAudioPlayer from './SkillAudioPlayer'
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { reportError } from '../lib/errorReporter'

/*
 * Speaking homework recorder: record with the microphone, or upload an
 * audio file.
 *
 * Rewritten 2026-11-01 after "speaking recording is bugging sometimes".
 * What the storage logs showed and what changed:
 *   • About 1 in 20 browser recordings saved was only 1–2 seconds long
 *     (a mis-tap on Re-record, or the mic stopping early). A short take
 *     replaced the student's good recording. Now a take under
 *     MIN_SECONDS is not saved, and the previous recording is kept.
 *   • If the upload failed (bad internet), the student still saw their
 *     recording on screen as if it was saved, but it was gone after a
 *     reload. Now the take is kept and a "Save again" button appears.
 *   • If the microphone stopped by itself (a phone call, Bluetooth
 *     headphones disconnecting, another app taking the mic), the timer
 *     kept running over silence. Now it stops and saves what was
 *     recorded, and says why.
 *   • Leaving the page while recording or saving now asks first.
 *   • Clearer messages for old iPhones (no MediaRecorder) and for apps
 *     like Telegram/Instagram that block the microphone.
 *   • Every recorder failure is written to the Errors page with the
 *     phone/browser, so the next problem can be traced.
 */

const MIN_SECONDS = 2

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4']) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t
    } catch {
      // ignore
    }
  }
  return ''
}

function isInAppBrowser() {
  const ua = navigator.userAgent || ''
  return /Telegram|Instagram|FBAN|FBAV|Line\/|TikTok|Snapchat/i.test(ua)
}

function logProblem(stage, err) {
  const msg = `Speaking recorder (${stage}): ${err?.name ? `${err.name}: ` : ''}${err?.message || String(err)}`
  reportError(new Error(msg), '', { always: true })
}

export default function AudioRecorder({ label, existingUrl, onSaved, onUpload, onDelete, uploading, compressingAudio }) {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [recordingSize, setRecordingSize] = useState(0)
  // From Stop until the recording is encoded and saved.
  const [finishing, setFinishing] = useState(false)
  // A take that could not be saved, kept so the student can retry.
  const [unsavedBlob, setUnsavedBlob] = useState(null)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const streamRef = useRef(null)
  const fileRef = useRef(null)
  const secondsRef = useRef(0)
  const previewRef = useRef(null)
  const stopReasonRef = useRef('')

  // Revoke old preview URLs.
  useEffect(() => {
    const old = previewRef.current
    previewRef.current = previewUrl
    if (old && old !== previewUrl) URL.revokeObjectURL(old)
  }, [previewUrl])

  // Unmount: finish an active recording (it still gets saved) and free
  // the microphone.
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current)
      const rec = mediaRecorderRef.current
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop()
        } catch {
          // ignore
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    }
  }, [])

  // Ask before leaving the page while recording or saving.
  const busy = recording || finishing
  useEffect(() => {
    if (!busy) return undefined
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const startTimer = () => {
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      secondsRef.current += 1
      setSeconds(secondsRef.current)
    }, 1000)
  }

  const save = async (blob) => {
    setFinishing(true)
    try {
      await onSaved(blob)
      setUnsavedBlob(null)
      setError('')
    } catch (err) {
      console.error('Speaking recording save error:', err)
      logProblem('save', err)
      setUnsavedBlob(blob)
      setError(
        `Your recording was NOT saved${err?.message ? ` (${err.message})` : ''}. Check your internet and press "Save again".`
      )
    } finally {
      setFinishing(false)
    }
  }

  const start = async () => {
    setError('')
    setNotice('')
    setRecordingSize(0)
    stopReasonRef.current = ''

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('no getUserMedia'), { name: 'NoMediaDevices' })
      }
      if (typeof MediaRecorder === 'undefined') {
        throw Object.assign(new Error('no MediaRecorder'), { name: 'NoMediaRecorder' })
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      streamRef.current = stream

      const mimeType = pickMimeType()
      // 40 kbps is plenty for one speaking voice and keeps uploads small.
      const options = { audioBitsPerSecond: 40000 }
      if (mimeType) options.mimeType = mimeType
      let recorder
      try {
        recorder = new MediaRecorder(stream, options)
      } catch {
        recorder = new MediaRecorder(stream)
      }
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data)
          setRecordingSize((prev) => prev + event.data.size)
        }
      }

      recorder.onstop = async () => {
        clearInterval(timerRef.current)
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        mediaRecorderRef.current = null
        const chunks = chunksRef.current
        chunksRef.current = []
        setRecording(false)
        setPaused(false)

        const type = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunks, { type })
        const tooShort = secondsRef.current < MIN_SECONDS || blob.size < 1500

        if (!blob.size || tooShort) {
          setFinishing(false)
          if (stopReasonRef.current) logProblem('ended-early', new Error(`${stopReasonRef.current}; ${secondsRef.current}s, ${blob.size} bytes`))
          setError(
            existingUrl || previewRef.current
              ? `That recording was too short (${secondsRef.current}s), so it was not saved. Your previous recording is kept.`
              : `That recording was too short (${secondsRef.current}s). Please record again.`
          )
          return
        }

        setPreviewUrl(URL.createObjectURL(blob))
        if (stopReasonRef.current) {
          setNotice(`${stopReasonRef.current} We saved the ${Math.floor(secondsRef.current / 60)}:${String(secondsRef.current % 60).padStart(2, '0')} that was recorded — listen to it and re-record if it is cut off.`)
        }
        await save(blob)
      }

      recorder.onerror = (event) => {
        console.error('MediaRecorder error:', event)
        logProblem('recorder', event?.error || new Error('MediaRecorder error'))
        stopReasonRef.current = 'The browser stopped recording.'
        try {
          if (recorder.state !== 'inactive') recorder.stop()
        } catch {
          // ignore
        }
      }

      // The microphone can stop on its own (phone call, headphones
      // unplugged, another app). Stop and save what we have.
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (recorder.state !== 'inactive') {
            stopReasonRef.current = 'The microphone stopped (a call, headphones or another app may have taken it).'
            logProblem('track-ended', new Error(stopReasonRef.current))
            setFinishing(true)
            try {
              recorder.stop()
            } catch {
              // ignore
            }
          }
        }
      })

      recorder.start(1000)
      secondsRef.current = 0
      setSeconds(0)
      setRecording(true)
      setPaused(false)
      startTimer()
    } catch (err) {
      console.error('Microphone recording error:', err)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setRecording(false)
      setPaused(false)

      const inApp = isInAppBrowser()
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        setError(
          inApp
            ? 'This app (Telegram/Instagram) blocks the microphone. Open the website in Chrome or Safari, or upload a voice memo below.'
            : 'Microphone access was blocked. Allow the microphone for this site in your browser settings and try again.'
        )
      } else if (err?.name === 'NotFoundError') {
        setError('No microphone was found. Connect one and try again, or upload a voice memo below.')
      } else if (err?.name === 'NotReadableError') {
        setError('Another app is using the microphone. Close it (or end the call) and try again.')
      } else if (err?.name === 'NoMediaRecorder' || err?.name === 'NoMediaDevices') {
        setError(
          inApp
            ? 'Recording does not work inside this app. Open the website in Chrome or Safari, or upload a voice memo below.'
            : 'This browser cannot record. Update your phone/browser, use Chrome, or record a voice memo and upload it below.'
        )
      } else {
        setError(err?.message || 'Could not start recording.')
      }
      logProblem('start', err)
    }
  }

  const pause = () => {
    const rec = mediaRecorderRef.current
    if (!rec || rec.state !== 'recording') return
    try {
      rec.pause()
    } catch {
      return
    }
    clearInterval(timerRef.current)
    setPaused(true)
  }

  const resume = () => {
    const rec = mediaRecorderRef.current
    if (!rec || rec.state !== 'paused') return
    try {
      rec.resume()
    } catch {
      return
    }
    startTimer()
    setPaused(false)
  }

  const stop = () => {
    const rec = mediaRecorderRef.current
    if (!rec || rec.state === 'inactive') return
    clearInterval(timerRef.current)
    setFinishing(true)
    try {
      rec.requestData()
    } catch {
      // some browsers can't at this moment
    }
    rec.stop()
  }

  const discard = async () => {
    setPreviewUrl(null)
    setUnsavedBlob(null)
    setSeconds(0)
    setRecordingSize(0)
    setError('')
    setNotice('')
    try {
      await onDelete()
    } catch (err) {
      setError(err?.message || 'Could not delete the recording.')
    }
  }

  const handleUpload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const extension = file.name.toLowerCase().split('.').pop()
    // Whatever a phone's voice-memo app produces.
    const allowed = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'weba', 'webm', 'flac', 'wma', 'amr', '3gp', '3ga', 'mp4', 'caf']
    if (!allowed.includes(extension) && !file.type.startsWith('audio/')) {
      setError('Please choose an audio file (MP3, WAV, M4A, OGG and most other audio formats are fine).')
      return
    }
    if (file.size > 100 * 1024 * 1024) {
      setError('This audio file is very large. Please use a shorter recording.')
      return
    }
    setError('')
    setNotice('')
    try {
      await onUpload(file)
      setUnsavedBlob(null)
    } catch (err) {
      console.error('Audio upload error:', err)
      logProblem('upload-file', err)
      setError(err?.message || 'Failed to upload audio.')
    }
  }

  const hasTake = Boolean(existingUrl || previewUrl)
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const sizeMb = recordingSize ? (recordingSize / 1024 / 1024).toFixed(2) : '0.00'
  const btn = 'focus-ring inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:opacity-40'

  return (
    <div className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-panel p-4">
      <div className="text-[15px] font-bold text-paper">{label}</div>
      <div className="text-xs text-mist">Record here, or upload a voice memo (MP3, M4A, WAV, OGG and most formats work).</div>

      {!recording && !hasTake && !finishing && (
        <button type="button" onClick={start} disabled={uploading} className={`${btn} bg-brass text-onbrass hover:bg-brass-dim`}>
          <Icon name="mic" className="h-4 w-4" /> Start recording
        </button>
      )}

      {finishing && !recording && (
        <button type="button" disabled className={`${btn} bg-brass/50 text-onbrass`}>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-onbrass/40 border-t-onbrass" />
          Saving your recording…
        </button>
      )}

      {recording && (
        <div className="flex items-center gap-2 rounded-xl bg-urgent-tint px-3 py-2 text-sm font-semibold text-urgent">
          <span className={`h-2.5 w-2.5 rounded-full bg-urgent ${paused ? '' : 'animate-pulse'}`} />
          {paused ? 'Paused' : 'Recording'} · <span className="tabular-nums">{time}</span>
        </div>
      )}

      {recording && (
        <div className="grid grid-cols-2 gap-2">
          {!paused ? (
            <button type="button" onClick={pause} className={`${btn} border border-brass text-brass`}>
              Pause
            </button>
          ) : (
            <button type="button" onClick={resume} className={`${btn} border border-brass text-brass`}>
              Resume
            </button>
          )}
          <button type="button" onClick={stop} className={`${btn} bg-coral text-white`}>
            Stop &amp; save
          </button>
        </div>
      )}

      {!recording && hasTake && !finishing && (
        <>
          <SkillAudioPlayer src={previewUrl || existingUrl} download={false} />
          {recordingSize > 0 && <span className="text-xs text-mist">Recorded audio: {sizeMb} MB</span>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={start} disabled={uploading} className={`${btn} border border-line text-paper hover:border-brass`}>
              Re-record
            </button>
            <button type="button" onClick={discard} disabled={uploading} className={`${btn} border border-coral text-coral`}>
              Delete
            </button>
          </div>
        </>
      )}

      {unsavedBlob && !recording && !finishing && (
        <button type="button" onClick={() => save(unsavedBlob)} disabled={uploading} className={`${btn} bg-saffron text-onsaffron`}>
          Save again
        </button>
      )}

      {!recording && !finishing && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.weba,.webm,.flac,.wma,.amr,.3gp,.3ga,.caf"
            onChange={handleUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className={`${btn} border border-line text-mist hover:border-brass hover:text-brass`}
          >
            <Icon name="paperclip" className="h-4 w-4" /> Upload audio file
          </button>
        </>
      )}

      {uploading && !finishing && (
        <span className="text-xs text-brass">
          {compressingAudio ? 'Compressing your recording — keep this page open, it has not frozen.' : 'Saving…'}
        </span>
      )}

      {notice && <span className="text-xs text-amber">{notice}</span>}
      {error && <span className="text-xs font-semibold text-coral">{error}</span>}
    </div>
  )
}
