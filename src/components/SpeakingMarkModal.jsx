import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { formatBand } from '../lib/ieltsBands'
import { SPEAKING_CRITERIA, computeOverallBand, bandProblem, toBandOrNull } from '../lib/marking'
import Icon from './Icon'
import SpeakingComments from './SpeakingComments'

/*
 * TEACHER: CHANGE SPEAKING MARKS (2026-10-16) — Jasur: "same for
 * speaking, should be changeable by the teacher". Shows the speaking
 * examiner's four criteria, overall band, feedback and recording, and
 * lets the teacher change them, and add or edit comments tied to
 * moments in the recording (SpeakingComments). Saving stamps teacher_edited_by/at so
 * everyone can see the marks were changed.
 */

const nameOf = (p) => p?.full_name || p?.username || 'Someone'
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

export default function SpeakingMarkModal({ slotId, onClose, onSaved }) {
  const { profile } = useAuth()
  const [slot, setSlot] = useState(null)
  const [people, setPeople] = useState({})
  const [error, setError] = useState('')
  const [criteria, setCriteria] = useState({ fc: '', lr: '', gra: '', pron: '' })
  const [feedback, setFeedback] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const backdropDown = useRef(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('mock_speaking_slots')
      .select('*')
      .eq('id', slotId)
      .maybeSingle()
      .then(async ({ data, error: err }) => {
        if (cancelled) return
        if (err || !data) {
          setError(err?.message || 'This speaking exam could not be found.')
          return
        }
        const ids = [data.student_id, data.examiner_id, data.teacher_edited_by].filter(Boolean)
        const { data: ps } = await supabase.from('profiles').select('id, full_name, username').in('id', ids)
        if (cancelled) return
        const map = {}
        ;(ps || []).forEach((p) => { map[p.id] = p })
        setPeople(map)
        setSlot(data)
        setCriteria({ fc: data.fc_band ?? '', lr: data.lr_band ?? '', gra: data.gra_band ?? '', pron: data.pron_band ?? '' })
        setFeedback(data.examiner_feedback || '')
      })
    return () => {
      cancelled = true
    }
  }, [slotId])

  const computed = computeOverallBand([criteria.fc, criteria.lr, criteria.gra, criteria.pron])
  const overall = computed != null ? computed : slot?.examiner_band ?? null
  const dirty =
    slot &&
    (['fc', 'lr', 'gra', 'pron'].some((k) => String(criteria[k]) !== String(slot[`${k}_band`] ?? '')) ||
      feedback !== (slot.examiner_feedback || ''))

  const save = async () => {
    const problem = SPEAKING_CRITERIA.map((c) => bandProblem(criteria[c.key])).find(Boolean)
    if (problem) {
      setSaveError(problem)
      return
    }
    setSaving(true)
    setSaveError('')
    const nowIso = new Date().toISOString()
    const patch = {
      fc_band: toBandOrNull(criteria.fc),
      lr_band: toBandOrNull(criteria.lr),
      gra_band: toBandOrNull(criteria.gra),
      pron_band: toBandOrNull(criteria.pron),
      examiner_band: computed != null ? computed : slot.examiner_band ?? null,
      examiner_feedback: feedback.trim() || null,
      teacher_edited_by: profile.id,
      teacher_edited_at: nowIso,
    }
    if (!slot.examiner_reviewed_at) patch.examiner_reviewed_at = nowIso
    let { data, error: err } = await supabase.from('mock_speaking_slots').update(patch).eq('id', slotId).select('*').single()
    // Before migration_81 the teacher_edited_* columns don't exist yet.
    if (err && (err.code === '42703' || /teacher_edited/.test(err.message || ''))) {
      delete patch.teacher_edited_by
      delete patch.teacher_edited_at
      ;({ data, error: err } = await supabase.from('mock_speaking_slots').update(patch).eq('id', slotId).select('*').single())
    }
    setSaving(false)
    if (err) {
      setSaveError(err.message || 'Could not save the marks.')
      return
    }
    setSlot(data)
    setPeople((prev) => (prev[profile.id] ? prev : { ...prev, [profile.id]: profile }))
    onSaved?.(data)
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-3 sm:p-4"
      onMouseDown={(e) => {
        backdropDown.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropDown.current) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Speaking marks" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[22px] border border-line bg-panel shadow-xl">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-speaking-tint text-speaking">
            <Icon name="mic" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold text-paper">{slot ? nameOf(people[slot.student_id]) : 'Speaking exam'}</h3>
            <p className="truncate text-[13px] text-mist">
              {slot ? `Speaking exam ${when(slot.scheduled_at)}${slot.examiner_id ? ` · with ${nameOf(people[slot.examiner_id])}` : ''}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring flex h-10 w-10 items-center justify-center rounded-full text-mist hover:bg-panel-2 hover:text-paper">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <p className="px-5 py-8 text-sm text-urgent">{error}</p>
        ) : !slot ? (
          <p className="px-5 py-8 text-sm text-mist">Loading…</p>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap gap-1.5 text-[12px]">
                {slot.examiner_reviewed_at ? (
                  <span className="rounded-full bg-reading-tint px-2.5 py-1 font-medium text-reading">Marked {when(slot.examiner_reviewed_at)}</span>
                ) : (
                  <span className="rounded-full bg-speaking-tint px-2.5 py-1 font-medium text-speaking">Not marked yet</span>
                )}
                {slot.teacher_edited_at && (
                  <span className="rounded-full bg-listening-tint px-2.5 py-1 font-medium text-listening">
                    Changed by {nameOf(people[slot.teacher_edited_by])} {when(slot.teacher_edited_at)}
                  </span>
                )}
                <span className="rounded-full bg-panel-2 px-2.5 py-1 font-medium text-mist">{slot.released_at ? 'Released to student' : 'Not released'}</span>
              </div>


              <div className="mt-4 grid grid-cols-2 gap-3">
                {SPEAKING_CRITERIA.map((c) => (
                  <label key={c.key} className="flex flex-col gap-1 text-[12px] leading-tight text-mist">
                    {c.label}
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="9"
                      step="0.5"
                      value={criteria[c.key]}
                      onChange={(e) => setCriteria((prev) => ({ ...prev, [c.key]: e.target.value }))}
                      className="focus-ring h-10 rounded-xl border border-line bg-panel-2 px-3 text-sm font-semibold tabular-nums text-paper"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-2xl bg-speaking-tint px-4 py-3">
                <span className="text-sm font-medium text-speaking">Overall</span>
                <span className="text-2xl font-semibold tabular-nums text-speaking">{formatBand(overall)}</span>
                <span className="ml-auto text-[11px] text-speaking/80">{computed != null ? 'from the four criteria' : 'fill in all four'}</span>
              </div>
              <label className="mt-4 flex flex-col gap-1 text-[13px] font-medium text-mist">
                Feedback
                <textarea
                  rows={5}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="focus-ring w-full resize-y rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm font-normal text-paper"
                />
              </label>
              <div className="mt-5 border-t border-line pt-4">
                <SpeakingComments slot={slot} editable />
              </div>
            </div>
            <div className="border-t border-line px-5 py-3">
              {saveError && <p className="mb-2 text-[13px] text-urgent">{saveError}</p>}
              <button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="focus-ring h-11 w-full rounded-xl bg-brass text-sm font-semibold text-onbrass hover:bg-brass-dim disabled:opacity-50"
              >
                {saving ? 'Saving…' : dirty ? 'Save changed marks' : 'Marks saved'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
