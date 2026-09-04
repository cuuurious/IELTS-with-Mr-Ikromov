import { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { guessMimeType } from '../../lib/mime'
import { SUBMISSION_TYPE_OPTIONS, isImageExtension } from '../../lib/submissionTypes'
import { MOCK_TASK_MODES } from '../../lib/writingMock'

function toLocalInputValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function EditHomeworkModal({ homework, onClose, onSaved }) {
  const isMock = homework.homework_type === 'writing_mock'

  const [title, setTitle] = useState(homework.title)
  const [description, setDescription] = useState(homework.description || '')
  const [dueDate, setDueDate] = useState(toLocalInputValue(homework.due_date))
  const [enableSpeaking, setEnableSpeaking] = useState(homework.enable_speaking)
  const [allowedTypes, setAllowedTypes] = useState(homework.allowed_submission_types?.length ? homework.allowed_submission_types : ['image'])
  const [minFiles, setMinFiles] = useState(homework.min_submission_files ?? 1)
  const [maxFiles, setMaxFiles] = useState(homework.max_submission_files ?? 10)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Standard homework's optional teacher attachment — kept as plain
  // url/name state (like the mock Task 1 image below) so "Remove" can
  // just clear it locally; save() only uploads a replacement when a
  // new file was actually picked.
  const [attachmentUrl, setAttachmentUrl] = useState(homework.attachment_url || null)
  const [attachmentName, setAttachmentName] = useState(homework.attachment_name || null)
  const [attachmentFile, setAttachmentFile] = useState(null)

  // Writing Mock Test fields — only relevant, and only shown, for a
  // homework whose type was already set to writing_mock at creation.
  // The type itself isn't editable here: switching it after students
  // may have already started submitting would leave old submissions
  // in a shape the new type doesn't know how to read.
  const [mockTaskMode, setMockTaskMode] = useState(homework.mock_task_mode || 'task2')
  const [mockTimeLimit, setMockTimeLimit] = useState(homework.mock_time_limit_minutes || 40)
  const [mockTask1Prompt, setMockTask1Prompt] = useState(homework.mock_task1_prompt || '')
  const [mockTask2Prompt, setMockTask2Prompt] = useState(homework.mock_task2_prompt || '')
  const [mockTask1Image, setMockTask1Image] = useState(null)
  const [mockTask1ImageUrl, setMockTask1ImageUrl] = useState(homework.mock_task1_image_url || null)

  const toggleType = (value) => {
    setAllowedTypes((prev) => {
      if (value === 'other') return prev.includes('other') ? prev.filter((x) => x !== 'other') : ['other']
      const next = prev.filter((x) => x !== 'other')
      return next.includes(value) ? next.filter((x) => x !== value) : [...next, value]
    })
  }

  const save = async (e) => {
    e.preventDefault()

    if (!isMock) {
      if (!allowedTypes.length) return setError('Choose at least one allowed submission type.')
      if (minFiles < 0 || maxFiles < 1 || minFiles > maxFiles) return setError('Check the minimum and maximum number of files.')
    } else {
      if (!mockTimeLimit || mockTimeLimit < 1) return setError('Set a time limit for the mock test.')
      if ((mockTaskMode === 'task1' || mockTaskMode === 'full') && !mockTask1Prompt.trim()) return setError('Add the Task 1 prompt.')
      if ((mockTaskMode === 'task2' || mockTaskMode === 'full') && !mockTask2Prompt.trim()) return setError('Add the Task 2 prompt.')
    }

    setSaving(true)
    setError('')

    try {
      let nextMockTask1ImageUrl = mockTask1ImageUrl

      if (isMock && mockTask1Image) {
        const path = `${homework.created_by}/${homework.group_id}/mock-task1-${Date.now()}-${mockTask1Image.name}`
        const { error: upErr } = await supabase.storage
          .from('homework-files')
          .upload(path, mockTask1Image, { contentType: guessMimeType(mockTask1Image.name, mockTask1Image.type) })
        if (upErr) throw upErr
        nextMockTask1ImageUrl = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
        setMockTask1ImageUrl(nextMockTask1ImageUrl)
      }

      let nextAttachmentUrl = attachmentUrl
      let nextAttachmentName = attachmentName

      if (!isMock && attachmentFile) {
        const path = `${homework.created_by}/${homework.group_id}/${Date.now()}-${attachmentFile.name}`
        const { error: attUpErr } = await supabase.storage
          .from('homework-files')
          .upload(path, attachmentFile, { contentType: guessMimeType(attachmentFile.name, attachmentFile.type) })
        if (attUpErr) throw attUpErr
        nextAttachmentUrl = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
        nextAttachmentName = attachmentFile.name
        setAttachmentUrl(nextAttachmentUrl)
        setAttachmentName(nextAttachmentName)
        setAttachmentFile(null)
      }

      const patch = {
        title,
        description,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        enable_speaking: isMock ? false : enableSpeaking,
        allowed_submission_types: isMock ? homework.allowed_submission_types || [] : allowedTypes,
        min_submission_files: isMock ? homework.min_submission_files ?? 0 : minFiles,
        max_submission_files: isMock ? homework.max_submission_files ?? 0 : maxFiles,
        attachment_url: isMock ? homework.attachment_url || null : nextAttachmentUrl,
        attachment_name: isMock ? homework.attachment_name || null : nextAttachmentName,
      }

      if (isMock) {
        patch.mock_task_mode = mockTaskMode
        patch.mock_time_limit_minutes = mockTimeLimit
        patch.mock_task1_prompt = mockTaskMode === 'task1' || mockTaskMode === 'full' ? mockTask1Prompt : homework.mock_task1_prompt
        patch.mock_task2_prompt = mockTaskMode === 'task2' || mockTaskMode === 'full' ? mockTask2Prompt : homework.mock_task2_prompt
        patch.mock_task1_image_url = nextMockTask1ImageUrl
      }

      const { data, error: updErr } = await supabase
        .from('homeworks')
        .update(patch)
        .eq('id', homework.id)
        .select()
        .single()

      if (updErr) throw updErr

      onSaved(data)
      onClose()
    } catch (err) {
      setError(err?.message || 'Could not save these changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <form onSubmit={save} className="ticket rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h2 className="font-display text-xl">Edit homework</h2><p className="text-mist text-xs mt-1">Submission rules can be changed before students submit.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-mist text-xl leading-none transition hover:border-brass hover:text-brass">×</button>
        </div>
        <div className="text-xs text-mist bg-panel-2 border border-line rounded-md px-3 py-2">
          Type: <span className="text-paper font-medium">{isMock ? 'Writing Mock Test' : 'Standard (files / pictures)'}</span> — this can't be changed here. To turn this into a {isMock ? 'standard' : 'Writing Mock Test'} homework, delete it and post a new one.
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="focus-ring w-full bg-panel-2 border border-line rounded-md px-3 py-2" required />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="focus-ring w-full min-h-[88px] resize-y bg-panel-2 border border-line rounded-md px-3 py-2" />
        <div className="grid sm:grid-cols-2 gap-3">
          <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 text-sm" />
          {!isMock && (
            <label className="flex items-center gap-2 text-sm bg-panel-2 border border-line rounded-md px-3 py-2 cursor-pointer"><input type="checkbox" checked={enableSpeaking} onChange={(e) => setEnableSpeaking(e.target.checked)} /> Include speaking recording</label>
          )}
        </div>

        {!isMock && (
          <div className="bg-panel-2 border border-line rounded-lg p-3">
            <label className="text-xs uppercase tracking-wide text-mist font-mono block mb-1">
              Teacher attachment {attachmentUrl ? '(replace)' : '(optional)'}
            </label>

            {attachmentUrl && !attachmentFile && (
              <div className="mb-2 flex flex-col gap-2">
                {isImageExtension(attachmentName) && (
                  <img src={attachmentUrl} alt={attachmentName || 'Attachment'} className="max-h-32 rounded-md border border-line object-contain" />
                )}

                <div className="flex items-center gap-3">
                  <a href={attachmentUrl} target="_blank" rel="noreferrer" className="text-brass text-sm hover:underline truncate">
                    📎 {attachmentName || 'Current attachment'}
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      setAttachmentUrl(null)
                      setAttachmentName(null)
                    }}
                    className="focus-ring shrink-0 text-xs text-coral hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}

            <input
              type="file"
              onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
              className="focus-ring text-sm text-mist file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-panel file:text-paper file:cursor-pointer"
            />
          </div>
        )}

        {isMock ? (
          <div className="bg-panel-2 border border-line rounded-lg p-3 flex flex-col gap-3">
            <div>
              <div className="text-sm font-medium mb-1">Which task(s)?</div>
              <div className="flex gap-2">
                {MOCK_TASK_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMockTaskMode(m.value)}
                    className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium ${mockTaskMode === m.value ? 'border-brass bg-brass/10 text-paper' : 'border-line text-mist'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="text-xs font-mono flex items-center gap-2">
              Time limit (minutes)
              <input type="number" min="1" max="180" value={mockTimeLimit} onChange={(e) => setMockTimeLimit(Number(e.target.value))} className="w-20 bg-panel border border-line rounded px-2 py-1" />
            </label>

            {(mockTaskMode === 'task1' || mockTaskMode === 'full') && (
              <div>
                <label className="text-xs uppercase tracking-wide text-mist font-mono block mb-1">Task 1 prompt</label>
                <textarea value={mockTask1Prompt} onChange={(e) => setMockTask1Prompt(e.target.value)} rows={3} className="focus-ring w-full bg-panel border border-line rounded-md px-3 py-2 text-sm" />
                <label className="text-xs uppercase tracking-wide text-mist font-mono block mt-2 mb-1">Task 1 chart / graph image {mockTask1ImageUrl ? '(replace)' : '(optional)'}</label>
                {mockTask1ImageUrl && !mockTask1Image && (
                  <div className="mb-2 flex flex-col gap-2">
                    <img src={mockTask1ImageUrl} alt="Current Task 1 chart" className="max-h-32 rounded-md border border-line object-contain" />
                    <button
                      type="button"
                      onClick={() => setMockTask1ImageUrl(null)}
                      className="focus-ring w-fit text-xs text-coral hover:underline"
                    >
                      Remove image
                    </button>
                  </div>
                )}
                <input type="file" accept="image/*" onChange={(e) => setMockTask1Image(e.target.files?.[0] || null)} className="focus-ring text-sm text-mist file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-panel-2 file:text-paper file:cursor-pointer" />
              </div>
            )}

            {(mockTaskMode === 'task2' || mockTaskMode === 'full') && (
              <div>
                <label className="text-xs uppercase tracking-wide text-mist font-mono block mb-1">Task 2 prompt</label>
                <textarea value={mockTask2Prompt} onChange={(e) => setMockTask2Prompt(e.target.value)} rows={3} className="focus-ring w-full bg-panel border border-line rounded-md px-3 py-2 text-sm" />
              </div>
            )}
          </div>
        ) : (
          <div className="bg-panel-2 border border-line rounded-lg p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div><div className="text-sm font-medium">Student upload rules</div><div className="text-xs text-mist">Allowed types and total file/picture count.</div></div>
              <div className="flex gap-2 text-xs font-mono"><label>Min <input type="number" min="0" max="99" value={minFiles} onChange={(e) => setMinFiles(Number(e.target.value))} className="w-16 bg-panel border border-line rounded px-2 py-1" /></label><label>Max <input type="number" min="1" max="99" value={maxFiles} onChange={(e) => setMaxFiles(Number(e.target.value))} className="w-16 bg-panel border border-line rounded px-2 py-1" /></label></div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto">
              {SUBMISSION_TYPE_OPTIONS.map((option) => <label key={option.value} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm cursor-pointer ${allowedTypes.includes(option.value) ? 'border-brass bg-brass/10' : 'border-line text-mist'}`}><input type="checkbox" checked={allowedTypes.includes(option.value)} onChange={() => toggleType(option.value)} />{option.label}</label>)}
            </div>
          </div>
        )}
        {error && <p className="text-coral text-sm">{error}</p>}
        <div className="flex gap-2 mt-2"><button disabled={saving} className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium hover:bg-brass-dim transition-colors disabled:opacity-50 disabled:hover:bg-brass">{saving ? 'Saving…' : 'Save changes'}</button><button type="button" onClick={onClose} className="focus-ring px-4 py-2 rounded-md border border-line text-mist hover:border-brass hover:text-brass transition-colors">Cancel</button></div>
      </form>
    </div>
  )
}
