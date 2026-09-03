import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { SUBMISSION_TYPE_OPTIONS } from '../../lib/submissionTypes'

function toLocalInputValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function EditHomeworkModal({ homework, onClose, onSaved }) {
  const [title, setTitle] = useState(homework.title)
  const [description, setDescription] = useState(homework.description || '')
  const [dueDate, setDueDate] = useState(toLocalInputValue(homework.due_date))
  const [enableSpeaking, setEnableSpeaking] = useState(homework.enable_speaking)
  const [aiEvalEnabled, setAiEvalEnabled] = useState(homework.ai_eval_enabled ?? false)
  const [allowedTypes, setAllowedTypes] = useState(homework.allowed_submission_types?.length ? homework.allowed_submission_types : ['image'])
  const [minFiles, setMinFiles] = useState(homework.min_submission_files ?? 1)
  const [maxFiles, setMaxFiles] = useState(homework.max_submission_files ?? 10)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Was previously special-cased so checking "Other file types" wiped
  // out every other checked type (and vice versa) — meant to make
  // "other" exclusive, but it actually just silently discarded
  // whatever the teacher had already picked, so a real multi-select
  // ("audio + video + other") collapsed down to whatever was clicked
  // last. Now every checkbox is a plain, independent toggle; "other"
  // combined with specific types is redundant (accepting "any file"
  // already covers them) but harmless — buildAccept()/
  // matchesSubmissionType() in lib/submissionTypes.js already treat
  // "other" as "no restriction" regardless of what else is checked.
  const toggleType = (value) => {
    setAllowedTypes((prev) =>
      prev.includes(value)
        ? prev.filter((x) => x !== value)
        : [...prev, value]
    )
  }

  const save = async (e) => {
    e.preventDefault()
    if (!allowedTypes.length) return setError('Choose at least one allowed submission type.')
    if (minFiles < 0 || maxFiles < 1 || minFiles > maxFiles) return setError('Check the minimum and maximum number of files.')
    setSaving(true)
    setError('')
    const { data, error: updErr } = await supabase.from('homeworks').update({
      title,
      description,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      enable_speaking: enableSpeaking,
      ai_eval_enabled: aiEvalEnabled,
      allowed_submission_types: allowedTypes,
      min_submission_files: minFiles,
      max_submission_files: maxFiles,
    }).eq('id', homework.id).select().maybeSingle()
    if (updErr) { setSaving(false); return setError(updErr.message) }

    // maybeSingle() returns null instead of throwing when 0 rows come
    // back — which can happen as a brief, harmless glitch (e.g. right
    // after running a database migration) even though the update
    // itself went through. Re-read the row by its known id before
    // showing an error over something that actually worked.
    let saved = data
    if (!saved) {
      const { data: refetched } = await supabase
        .from('homeworks')
        .select()
        .eq('id', homework.id)
        .maybeSingle()
      saved = refetched
    }
    setSaving(false)
    if (!saved) return setError('The change may not have saved — please check and try again if it looks wrong.')
    onSaved(saved)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <form onSubmit={save} className="ticket rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h2 className="font-display text-xl">Edit homework</h2><p className="text-mist text-xs mt-1">Submission rules can be changed before students submit.</p></div>
          <button type="button" onClick={onClose} className="focus-ring text-mist hover:text-paper text-xl leading-none">×</button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2" required />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2" />
        <div className="grid sm:grid-cols-2 gap-3">
          <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-sm bg-panel-2 border border-line rounded-md px-3 py-2 cursor-pointer"><input type="checkbox" checked={enableSpeaking} onChange={(e) => setEnableSpeaking(e.target.checked)} /> Include speaking recording</label>
        </div>
        <label className="flex items-center gap-2 text-sm bg-panel-2 border border-line rounded-md px-3 py-2 cursor-pointer">
          <input type="checkbox" checked={aiEvalEnabled} onChange={(e) => setAiEvalEnabled(e.target.checked)} />
          <span>Evaluate submissions with AI<span className="block text-xs text-mist font-normal mt-0.5">Graded automatically against your uploaded {enableSpeaking ? 'Speaking' : 'Writing'} criteria.</span></span>
        </label>
        <div className="bg-panel-2 border border-line rounded-lg p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div><div className="text-sm font-medium">Student upload rules</div><div className="text-xs text-mist">Allowed types and total file/picture count.</div></div>
            <div className="flex gap-2 text-xs font-mono"><label>Min <input type="number" min="0" max="99" value={minFiles} onChange={(e) => setMinFiles(Number(e.target.value))} className="w-16 bg-panel border border-line rounded px-2 py-1" /></label><label>Max <input type="number" min="1" max="99" value={maxFiles} onChange={(e) => setMaxFiles(Number(e.target.value))} className="w-16 bg-panel border border-line rounded px-2 py-1" /></label></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto">
            {SUBMISSION_TYPE_OPTIONS.map((option) => <label key={option.value} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm cursor-pointer ${allowedTypes.includes(option.value) ? 'border-brass bg-brass/10' : 'border-line text-mist'}`}><input type="checkbox" checked={allowedTypes.includes(option.value)} onChange={() => toggleType(option.value)} />{option.label}</label>)}
          </div>
        </div>
        {error && <p className="text-coral text-sm">{error}</p>}
        <div className="flex gap-2 mt-2"><button disabled={saving} className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button><button type="button" onClick={onClose} className="focus-ring px-4 py-2 rounded-md border border-line text-mist">Cancel</button></div>
      </form>
    </div>
  )
}
