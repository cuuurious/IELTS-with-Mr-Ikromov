import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/*
 * The teacher's own band on a Writing / Speaking homework (2026-11-05).
 * It replaces the AI's band in the gradebook and on the student's card,
 * and the student sees it (with the comment) above the AI feedback.
 * Saved on the attempt: band, and results.teacher = { band, comment, at }.
 */

const BANDS = ['4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0', '8.5', '9.0']

export function TeacherBandNote({ teacher }) {
  if (!teacher?.band) return null
  return (
    <section className="flex items-start gap-3 rounded-[20px] border-2 border-brass/40 bg-[color-mix(in_srgb,var(--color-brass)_8%,var(--color-panel))] p-4">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[16px] bg-brass font-brand text-[20px] font-semibold text-onbrass">{Number(teacher.band).toFixed(1)}</span>
      <div className="min-w-0 flex-1">
        <p className="font-brand text-[16px] font-semibold text-paper">Mr Ikromov’s band</p>
        {teacher.comment ? <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-paper-dim">{teacher.comment}</p> : <p className="text-[13px] font-semibold text-mist">This is your final band for this task.</p>}
      </div>
    </section>
  )
}

export default function TeacherBand({ attemptId, results, aiBand, onSaved }) {
  const t = results?.teacher || null
  const [band, setBand] = useState(t?.band != null ? Number(t.band).toFixed(1) : aiBand != null ? Number(aiBand).toFixed(1) : '')
  const [comment, setComment] = useState(t?.comment || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async (clear = false) => {
    setBusy(true)
    setMsg('')
    // Read the latest results first so the AI feedback is never lost.
    const { data: row, error: readErr } = await supabase.from('homework_attempts').select('results').eq('id', attemptId).maybeSingle()
    if (readErr) {
      setBusy(false)
      return setMsg(readErr.message)
    }
    const next = { ...(row?.results || {}) }
    if (clear) delete next.teacher
    else next.teacher = { band: Number(band), comment: comment.trim(), at: new Date().toISOString() }
    const aiB = next.ai?.overall_band
    const { error } = await supabase
      .from('homework_attempts')
      .update({ band: clear ? (aiB != null ? Number(aiB) : null) : Number(band), results: next })
      .eq('id', attemptId)
    setBusy(false)
    if (error) return setMsg(error.message)
    setMsg(clear ? 'Your band removed — the AI band shows again.' : 'Saved — the student sees your band.')
    onSaved?.(next)
  }

  return (
    <div className="flex flex-col gap-2 rounded-[16px] border border-brass/30 bg-[color-mix(in_srgb,var(--color-brass)_6%,var(--color-panel))] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-extrabold text-paper">Your band</span>
        <select value={band} onChange={(e) => setBand(e.target.value)} className="focus-ring h-9 rounded-[10px] border border-line bg-panel px-2 text-[14px] font-extrabold text-paper" aria-label="Your band">
          <option value="">—</option>
          {BANDS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        {aiBand != null && <span className="text-[12px] font-bold text-mist">AI said {Number(aiBand).toFixed(1)}</span>}
        {t?.band != null && <span className="rounded-lg bg-brass px-2 py-0.5 text-[11px] font-extrabold text-onbrass">Final: {Number(t.band).toFixed(1)}</span>}
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="A short comment for the student (optional)" className="focus-ring w-full rounded-[12px] border border-line bg-panel px-3 py-2 text-[13px] text-paper placeholder:text-mist/70" />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => save(false)} disabled={busy || !band} className="focus-ring h-9 rounded-[12px] bg-brass px-4 text-[13px] font-extrabold text-onbrass hover:brightness-110 disabled:opacity-50">
          {busy ? 'Saving…' : t ? 'Update my band' : 'Give my band'}
        </button>
        {t && (
          <button type="button" onClick={() => save(true)} disabled={busy} className="focus-ring h-9 rounded-[12px] px-3 text-[12px] font-extrabold text-mist hover:text-coral">
            Remove my band
          </button>
        )}
        {msg && <span className="text-[12px] font-bold text-reading">{msg}</span>}
      </div>
    </div>
  )
}
