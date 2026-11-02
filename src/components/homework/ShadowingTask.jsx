import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import SkillAudioPlayer from '../SkillAudioPlayer'
import TaskShell, { BandRing, Panel } from './TaskShell'

/*
 * SHADOWING (2026-11-02): listen to a line, say it straight after the
 * speaker, compare. The teacher's transcript can have times per line
 * ("[0:05] It was a cold morning.") so each line plays on its own;
 * without times the whole clip plays and the student records line by
 * line while reading. Where the browser can recognise speech (Chrome,
 * Edge, Android, newer Safari) each take gets a match %; the average is
 * the score. Recordings are kept so the teacher can listen.
 */

export function parseTranscript(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const out = lines.map((l) => {
    const m = l.match(/^\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]\s*(.*)$/)
    return m ? { start: Number(m[1]) * 60 + Number(m[2]), text: m[3] } : { start: null, text: l }
  })
  return out.map((l, i) => ({ ...l, end: out[i + 1]?.start ?? null }))
}

const words = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

export function matchPercent(target, said) {
  const t = words(target)
  if (!t.length) return null
  const pool = words(said)
  let hit = 0
  t.forEach((w) => {
    const i = pool.indexOf(w)
    if (i !== -1) {
      hit += 1
      pool.splice(i, 1)
    }
  })
  return Math.round((hit / t.length) * 100)
}

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

export default function ShadowingTask({ task, studentId, onClose, onChanged }) {
  const [clip, setClip] = useState(null)
  const [lines, setLines] = useState([])
  const [takes, setTakes] = useState({}) // index -> { blob, url, said, pct }
  const [recording, setRecording] = useState(null) // index
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)
  const lineAudioRef = useRef(null)
  const stopAtRef = useRef(null)
  const recRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('shadowing_clips')
      .select('*')
      .eq('id', task.shadowing_clip_id)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e || !data) {
          setError(e?.message || 'This shadowing clip was removed.')
          return
        }
        setClip(data)
        setLines(parseTranscript(data.transcript))
      })
    return () => {
      cancelled = true
    }
  }, [task.shadowing_clip_id])

  const timed = lines.some((l) => l.start != null)

  const playLine = (l) => {
    const a = lineAudioRef.current
    if (!a || l.start == null) return
    a.currentTime = l.start
    stopAtRef.current = l.end
    a.play().catch(() => {})
  }

  const startRecording = async (index) => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks = []
      let said = ''
      let recog = null
      if (Recognition) {
        recog = new Recognition()
        recog.lang = 'en-GB'
        recog.interimResults = false
        recog.continuous = true
        recog.onresult = (e) => {
          said = Array.from(e.results)
            .map((r) => r[0]?.transcript || '')
            .join(' ')
        }
        try {
          recog.start()
        } catch {
          recog = null
        }
      }
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const finish = () => {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
          setTakes((prev) => {
            if (prev[index]?.url) URL.revokeObjectURL(prev[index].url)
            return {
              ...prev,
              [index]: { blob, url: URL.createObjectURL(blob), said, pct: recog ? matchPercent(lines[index].text, said) : null },
            }
          })
        }
        if (recog) {
          recog.onend = finish
          try {
            recog.stop()
          } catch {
            finish()
          }
        } else finish()
      }
      recRef.current = rec
      rec.start()
      setRecording(index)
    } catch {
      setError('Allow the microphone to record yourself.')
    }
  }

  const stopRecording = () => {
    recRef.current?.stop()
    recRef.current = null
    setRecording(null)
  }

  const recorded = Object.keys(takes).length
  const scored = Object.values(takes).filter((t) => t.pct != null)
  const average = scored.length ? Math.round(scored.reduce((n, t) => n + t.pct, 0) / scored.length) : null

  const handIn = async () => {
    setSaving(true)
    setError('')
    try {
      const uploads = []
      for (const [i, t] of Object.entries(takes)) {
        const ext = (t.blob.type.includes('mp4') ? 'm4a' : 'webm')
        const path = `${studentId}/shadowing/${task.id}-${Date.now()}-${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('submissions').upload(path, t.blob, { contentType: t.blob.type || 'audio/webm' })
        if (upErr) throw upErr
        uploads.push({ line: Number(i), text: lines[i]?.text, url: supabase.storage.from('submissions').getPublicUrl(path).data.publicUrl, pct: t.pct, said: t.said || null })
      }
      const { data, error: rpcError } = await supabase.rpc('submit_homework_score', {
        p_task_id: task.id,
        p_score: average,
        p_max: average == null ? null : 100,
        p_details: { lines: uploads, total_lines: lines.length },
      })
      if (rpcError) throw rpcError
      setDone((Array.isArray(data) ? data[0] : data) || { attempt_no: 1 })
      onChanged?.()
    } catch (err) {
      setError(err?.message || 'Could not hand it in.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <TaskShell kind="shadowing" title={task.title || clip?.title || 'Shadowing'} subtitle={lines.length ? `${lines.length} lines · listen, then repeat` : ''} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {clip && (
          <Panel className="flex flex-col gap-4">
            <SkillAudioPlayer src={clip.audio_url} label="Whole recording" download={false} />
            {timed && (
              <audio
                ref={lineAudioRef}
                src={clip.audio_url}
                preload="auto"
                className="hidden"
                onTimeUpdate={(e) => {
                  const end = stopAtRef.current
                  if (end != null && e.currentTarget.currentTime >= end) {
                    e.currentTarget.pause()
                    stopAtRef.current = null
                  }
                }}
              />
            )}
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: `${recorded}/${lines.length}`, l: 'lines said', c: 'bg-speaking-tint text-speaking' },
                { v: average == null ? '—' : `${average}%`, l: 'match', c: 'bg-reading-tint text-reading' },
                { v: Recognition ? 'On' : 'Off', l: 'speech check', c: 'bg-panel-2 text-paper-dim' },
              ].map((t) => (
                <div key={t.l} className={`rounded-[14px] px-3 py-2.5 ${t.c}`}>
                  <div className="font-brand text-[20px] font-semibold leading-none">{t.v}</div>
                  <div className="mt-1 text-[12px] font-extrabold text-paper-dim">{t.l}</div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {lines.map((l, i) => {
          const take = takes[i]
          const isRec = recording === i
          return (
            <div key={i} className={`flex flex-col gap-3 rounded-[20px] border bg-panel p-4 ${isRec ? 'border-speaking' : 'border-line'}`}>
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-speaking-tint text-[13px] font-extrabold text-speaking">{i + 1}</span>
                <p className="flex-1 text-[16px] font-semibold leading-7 text-paper">{l.text}</p>
                {take?.pct != null && (
                  <span className={`shrink-0 rounded-xl px-2.5 py-1 text-xs font-extrabold ${take.pct >= 80 ? 'bg-reading-tint text-reading' : take.pct >= 50 ? 'bg-listening-tint text-listening' : 'bg-urgent-tint text-coral'}`}>{take.pct}%</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {l.start != null && (
                  <button type="button" onClick={() => playLine(l)} className="focus-ring inline-flex h-10 items-center gap-2 rounded-[14px] border border-line bg-panel px-3.5 text-sm font-extrabold text-paper hover:bg-panel-2">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>
                    Listen
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (isRec ? stopRecording() : startRecording(i))}
                  disabled={recording != null && !isRec}
                  className={`focus-ring inline-flex h-10 items-center gap-2 rounded-[14px] px-4 text-sm font-extrabold text-white transition disabled:opacity-40 ${isRec ? 'animate-pulse bg-coral' : 'bg-speaking hover:brightness-110'}`}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                  {isRec ? 'Stop' : take ? 'Say it again' : 'Record'}
                </button>
              </div>
              {take?.url && <SkillAudioPlayer key={take.url} src={take.url} download={false} />}
              {take?.said && <p className="text-[13px] font-semibold text-mist">We heard: “{take.said}”</p>}
            </div>
          )
        })}

        {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}

        {done ? (
          <Panel className="flex flex-col items-center gap-4 sm:flex-row">
            <BandRing value={average == null ? '✓' : `${average}%`} max={100} label={average == null ? 'done' : 'match'} tone="#6a3f99" />
            <div className="flex flex-col gap-2">
              <p className="font-brand text-[20px] font-semibold text-paper">Handed in</p>
              <p className="text-sm font-semibold text-mist">{done.attempt_no === 1 ? 'Your first try counts. Mr Ikromov can listen to your recordings.' : 'Saved as a retake. Your first try still counts.'}</p>
              <button type="button" onClick={onClose} className="focus-ring h-11 self-start rounded-[14px] bg-speaking px-5 text-sm font-extrabold text-white">Back to homework</button>
            </div>
          </Panel>
        ) : (
          lines.length > 0 && (
            <button
              type="button"
              onClick={handIn}
              disabled={saving || recorded === 0 || recording != null}
              className="focus-ring h-12 rounded-[14px] bg-saffron text-[15px] font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50"
            >
              {saving ? 'Handing in…' : recorded < lines.length ? `Hand in (${recorded} of ${lines.length} lines)` : 'Hand in'}
            </button>
          )
        )}
      </div>
    </TaskShell>
  )
}
