import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { guessMimeType } from '../../lib/mime'
import { SUBMISSION_TYPE_OPTIONS } from '../../lib/submissionTypes'

const DEFAULT_TYPES = ['image']

export default function PostHomeworkForm({ groupId, teacherId, onPosted }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [enableSpeaking, setEnableSpeaking] = useState(false)
  const [allowedTypes, setAllowedTypes] = useState(DEFAULT_TYPES)
  const [minFiles, setMinFiles] = useState(1)
  const [maxFiles, setMaxFiles] = useState(10)
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggleType = (value) => {
    setAllowedTypes((prev) => {
      if (value === 'other') return prev.includes('other') ? prev.filter((x) => x !== 'other') : ['other']
      const next = prev.filter((x) => x !== 'other')
      return next.includes(value) ? next.filter((x) => x !== value) : [...next, value]
    })
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!allowedTypes.length) throw new Error('Choose at least one allowed submission type.')
      if (minFiles < 0 || maxFiles < 1 || minFiles > maxFiles) throw new Error('Check the minimum and maximum number of files.')

      let attachment_url = null
      let attachment_name = null
      if (file) {
        const path = `${teacherId}/${groupId}/${Date.now()}-${file.name}`
        const { error: upErr } = await supabase.storage
          .from('homework-files')
          .upload(path, file, { contentType: guessMimeType(file.name, file.type) })
        if (upErr) throw upErr
        attachment_url = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
        attachment_name = file.name
      }

      const { data, error: insErr } = await supabase
        .from('homeworks')
        .insert({
          group_id: groupId,
          title,
          description,
          due_date: dueDate ? new Date(dueDate).toISOString() : null,
          enable_speaking: enableSpeaking,
          allowed_submission_types: allowedTypes,
          min_submission_files: minFiles,
          max_submission_files: maxFiles,
          attachment_url,
          attachment_name,
          created_by: teacherId,
        })
        .select()
        .single()
      if (insErr) throw insErr

      onPosted(data)
      setTitle('')
      setDescription('')
      setDueDate('')
      setEnableSpeaking(false)
      setAllowedTypes(DEFAULT_TYPES)
      setMinFiles(1)
      setMaxFiles(10)
      setFile(null)
      setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium hover:bg-brass-dim transition-colors w-fit">
        + Post new homework
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="ticket rounded-lg p-4 flex flex-col gap-4">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Reading Passage 3)" className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2" required />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Instructions for students (optional)" rows={3} className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2" />

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-mist font-mono block mb-1">Deadline</label>
          <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="focus-ring w-full bg-panel-2 border border-line rounded-md px-3 py-2 text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm bg-panel-2 border border-line rounded-md px-3 py-2 cursor-pointer self-end">
          <input type="checkbox" checked={enableSpeaking} onChange={(e) => setEnableSpeaking(e.target.checked)} />
          Include speaking Part 1 / 2 / 3
        </label>
      </div>

      <div className="bg-panel-2 border border-line rounded-lg p-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <div className="text-sm font-medium">What may students upload?</div>
            <div className="text-xs text-mist">Choose one or more file types.</div>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            <label>Min <input type="number" min="0" max="99" value={minFiles} onChange={(e) => setMinFiles(Number(e.target.value))} className="w-16 bg-panel border border-line rounded px-2 py-1" /></label>
            <label>Max <input type="number" min="1" max="99" value={maxFiles} onChange={(e) => setMaxFiles(Number(e.target.value))} className="w-16 bg-panel border border-line rounded px-2 py-1" /></label>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
          {SUBMISSION_TYPE_OPTIONS.map((option) => (
            <label key={option.value} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm cursor-pointer ${allowedTypes.includes(option.value) ? 'border-brass bg-brass/10 text-paper' : 'border-line text-mist'}`}>
              <input type="checkbox" checked={allowedTypes.includes(option.value)} onChange={() => toggleType(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-mist font-mono block mb-1">Optional teacher attachment</label>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="focus-ring text-sm text-mist file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-panel-2 file:text-paper file:cursor-pointer" />
      </div>
      {error && <p className="text-coral text-sm">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving} className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-50">{saving ? 'Posting…' : 'Post to group'}</button>
        <button type="button" onClick={() => setOpen(false)} className="focus-ring px-4 py-2 rounded-md border border-line text-mist">Cancel</button>
      </div>
    </form>
  )
}
