import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { guessMimeType } from '../../lib/mime'
import { SUBMISSION_TYPE_OPTIONS } from '../../lib/submissionTypes'
import { MOCK_TASK_MODES, DEFAULT_TIME_LIMITS } from '../../lib/writingMock'

const DEFAULT_TYPES = ['image']
const DEFAULT_MOCK_MODE = 'task2'

export default function PostHomeworkForm({ groupId, teacherId, onPosted }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [enableSpeaking, setEnableSpeaking] = useState(false)
  const [aiEvalEnabled, setAiEvalEnabled] = useState(false)
  const [allowedTypes, setAllowedTypes] = useState(DEFAULT_TYPES)
  const [minFiles, setMinFiles] = useState(1)
  const [maxFiles, setMaxFiles] = useState(10)
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Writing Mock Test — an alternative to the file-upload homework
  // above. Students type a timed essay directly in the app instead of
  // uploading anything, so this whole block of state only matters
  // when homeworkType is 'writing_mock'.
  //
  // Starts as null (neither button highlighted) rather than defaulting
  // to 'standard' — a teacher who never touches this toggle used to
  // silently post a Standard homework even when they meant to post a
  // Writing Mock Test, since "Standard" was already selected before
  // they'd looked at it. submit() below refuses to post until one is
  // explicitly picked, and homework type can never be changed after
  // posting (see EditHomeworkModal), so this is the only place a wrong
  // choice can be caught before it locks in.
  const [homeworkType, setHomeworkType] = useState(null)
  const [mockTaskMode, setMockTaskMode] = useState(DEFAULT_MOCK_MODE)
  const [mockTimeLimit, setMockTimeLimit] = useState(
    DEFAULT_TIME_LIMITS[DEFAULT_MOCK_MODE]
  )
  const [mockTask1Prompt, setMockTask1Prompt] = useState('')
  const [mockTask2Prompt, setMockTask2Prompt] = useState('')
  const [mockTask1Image, setMockTask1Image] = useState(null)
  const mockTask1ImageInputRef = useRef(null)

  // Clears the picked file AND resets the native input's own value —
  // just calling setMockTask1Image(null) alone left the browser still
  // showing the old filename next to the button (its onChange only
  // fires on an actual change, so picking the exact same file again
  // afterward wouldn't have registered at all).
  const clearMockTask1Image = () => {
    setMockTask1Image(null)

    if (mockTask1ImageInputRef.current) {
      mockTask1ImageInputRef.current.value = ''
    }
  }

  const chooseHomeworkType = (type) => {
    setHomeworkType(type)

    // Speaking and Writing Mock Test are mutually exclusive homework
    // shapes — switching to one turns the other off rather than
    // leaving a stale, hidden checkbox checked underneath. The generic
    // "teacher attachment" field is also hidden for a mock (it has its
    // own Task 1 chart image field instead) — clear it too, so an
    // already-picked file can't silently get uploaded once the field
    // holding it is gone from view.
    if (type === 'writing_mock') {
      setEnableSpeaking(false)
      setFile(null)
    }
  }

  const chooseMockTaskMode = (mode) => {
    setMockTaskMode(mode)
    setMockTimeLimit(DEFAULT_TIME_LIMITS[mode])
  }

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

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!homeworkType) {
        throw new Error('Choose a homework type — Standard or Writing Mock Test — before posting.')
      }

      const isMock = homeworkType === 'writing_mock'

      if (!isMock) {
        if (!allowedTypes.length) throw new Error('Choose at least one allowed submission type.')
        if (minFiles < 0 || maxFiles < 1 || minFiles > maxFiles) throw new Error('Check the minimum and maximum number of files.')
      }

      if (isMock) {
        if (!mockTimeLimit || mockTimeLimit < 1) throw new Error('Set a time limit for the mock test.')
        if ((mockTaskMode === 'task1' || mockTaskMode === 'full') && !mockTask1Prompt.trim()) throw new Error('Add the Task 1 prompt.')
        if ((mockTaskMode === 'task2' || mockTaskMode === 'full') && !mockTask2Prompt.trim()) throw new Error('Add the Task 2 prompt.')
      }

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

      let mock_task1_image_url = null
      if (isMock && mockTask1Image) {
        const path = `${teacherId}/${groupId}/mock-task1-${Date.now()}-${mockTask1Image.name}`
        const { error: mockUpErr } = await supabase.storage
          .from('homework-files')
          .upload(path, mockTask1Image, { contentType: guessMimeType(mockTask1Image.name, mockTask1Image.type) })
        if (mockUpErr) throw mockUpErr
        mock_task1_image_url = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
      }

      const { data, error: insErr } = await supabase
        .from('homeworks')
        .insert({
          group_id: groupId,
          title,
          description,
          due_date: dueDate ? new Date(dueDate).toISOString() : null,
          enable_speaking: isMock ? false : enableSpeaking,
          ai_eval_enabled: aiEvalEnabled,
          allowed_submission_types: isMock ? [] : allowedTypes,
          min_submission_files: isMock ? 0 : minFiles,
          max_submission_files: isMock ? 0 : maxFiles,
          attachment_url,
          attachment_name,
          created_by: teacherId,
          homework_type: homeworkType,
          mock_task_mode: isMock ? mockTaskMode : null,
          mock_time_limit_minutes: isMock ? mockTimeLimit : null,
          mock_task1_prompt: isMock ? mockTask1Prompt : null,
          mock_task1_image_url: isMock ? mock_task1_image_url : null,
          mock_task2_prompt: isMock ? mockTask2Prompt : null,
        })
        .select()
        .maybeSingle()
      if (insErr) throw insErr

      // maybeSingle() doesn't throw when 0 rows come back — which can
      // happen as a brief, harmless glitch (e.g. right after running a
      // database migration) even though the insert itself succeeded.
      // Rather than show a scary "cannot coerce" error over something
      // that actually worked, fall back to reading the row we just
      // created before giving up.
      let posted = data
      if (!posted) {
        const { data: refetched } = await supabase
          .from('homeworks')
          .select()
          .eq('group_id', groupId)
          .eq('created_by', teacherId)
          .eq('title', title)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        posted = refetched
      }
      if (!posted) {
        throw new Error(
          'The homework may not have posted — please check the list and try again if it is missing.'
        )
      }

      onPosted(posted)
      setTitle('')
      setDescription('')
      setDueDate('')
      setEnableSpeaking(false)
      setAiEvalEnabled(false)
      setAllowedTypes(DEFAULT_TYPES)
      setMinFiles(1)
      setMaxFiles(10)
      setFile(null)
      setHomeworkType(null)
      setMockTaskMode(DEFAULT_MOCK_MODE)
      setMockTimeLimit(DEFAULT_TIME_LIMITS[DEFAULT_MOCK_MODE])
      setMockTask1Prompt('')
      setMockTask2Prompt('')
      setMockTask1Image(null)
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

      <div className="bg-panel-2 border border-line rounded-lg p-3">
        <div className="text-sm font-medium mb-1">Homework type</div>
        <p className="text-xs text-mist mb-2">Pick one — this can't be changed once it's posted.</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => chooseHomeworkType('standard')}
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${homeworkType === 'standard' ? 'border-brass bg-brass/10 text-paper' : 'border-line text-mist'}`}
          >
            Standard (files / pictures)
          </button>
          <button
            type="button"
            onClick={() => chooseHomeworkType('writing_mock')}
            className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${homeworkType === 'writing_mock' ? 'border-brass bg-brass/10 text-paper' : 'border-line text-mist'}`}
          >
            Writing Mock Test
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-mist font-mono block mb-1">Deadline</label>
          <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="focus-ring w-full bg-panel-2 border border-line rounded-md px-3 py-2 text-sm" />
        </div>
        {homeworkType === 'standard' && (
          <label className="flex items-center gap-2 text-sm bg-panel-2 border border-line rounded-md px-3 py-2 cursor-pointer self-end">
            <input type="checkbox" checked={enableSpeaking} onChange={(e) => setEnableSpeaking(e.target.checked)} />
            Include speaking Part 1 / 2 / 3
          </label>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm bg-panel-2 border border-line rounded-md px-3 py-2 cursor-pointer">
        <input type="checkbox" checked={aiEvalEnabled} onChange={(e) => setAiEvalEnabled(e.target.checked)} />
        <span>
          Evaluate submissions with AI
          <span className="block text-xs text-mist font-normal mt-0.5">Students get detailed feedback automatically when they submit, graded against your uploaded {enableSpeaking ? 'Speaking' : 'Writing'} criteria (set up under the "AI Grading" tab).</span>
        </span>
      </label>

      {!homeworkType && (
        <p className="text-xs text-mist bg-panel-2 border border-line rounded-md px-3 py-2.5">
          Choose a homework type above to continue.
        </p>
      )}

      {homeworkType === 'writing_mock' && (
        <div className="bg-panel-2 border border-line rounded-lg p-3 flex flex-col gap-3">

          <div>
            <div className="text-sm font-medium mb-1">Which task(s)?</div>
            <div className="flex gap-2">
              {MOCK_TASK_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => chooseMockTaskMode(m.value)}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium ${mockTaskMode === m.value ? 'border-brass bg-brass/10 text-paper' : 'border-line text-mist'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <label className="text-xs font-mono flex items-center gap-2">
            Time limit (minutes)
            <input
              type="number"
              min="1"
              max="180"
              value={mockTimeLimit}
              onChange={(e) => setMockTimeLimit(Number(e.target.value))}
              className="w-20 bg-panel border border-line rounded px-2 py-1"
            />
          </label>

          {(mockTaskMode === 'task1' || mockTaskMode === 'full') && (
            <div>
              <label className="text-xs uppercase tracking-wide text-mist font-mono block mb-1">Task 1 prompt</label>
              <textarea
                value={mockTask1Prompt}
                onChange={(e) => setMockTask1Prompt(e.target.value)}
                rows={3}
                placeholder="e.g. The chart below shows the number of tourists visiting a country between 2000 and 2020. Summarise the information..."
                className="focus-ring w-full bg-panel border border-line rounded-md px-3 py-2 text-sm"
              />
              <label className="text-xs uppercase tracking-wide text-mist font-mono block mt-2 mb-1">Task 1 chart / graph image (optional)</label>

              {mockTask1Image ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-paper truncate max-w-[220px]">
                    {mockTask1Image.name}
                  </span>
                  <button
                    type="button"
                    onClick={clearMockTask1Image}
                    className="focus-ring px-2.5 py-1 rounded-md text-xs bg-panel-2 text-coral hover:bg-coral hover:text-white transition"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <input
                  ref={mockTask1ImageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setMockTask1Image(e.target.files?.[0] || null)}
                  className="focus-ring text-sm text-mist file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-brass file:text-onbrass file:font-medium file:cursor-pointer"
                />
              )}

              <p className="text-xs text-mist mt-1">Shown to students inline in the writing window — no extra tab needed.</p>
            </div>
          )}

          {(mockTaskMode === 'task2' || mockTaskMode === 'full') && (
            <div>
              <label className="text-xs uppercase tracking-wide text-mist font-mono block mb-1">Task 2 prompt</label>
              <textarea
                value={mockTask2Prompt}
                onChange={(e) => setMockTask2Prompt(e.target.value)}
                rows={3}
                placeholder="e.g. Some people believe that... To what extent do you agree or disagree?"
                className="focus-ring w-full bg-panel border border-line rounded-md px-3 py-2 text-sm"
              />
            </div>
          )}

          <p className="text-xs text-mist">
            Students type their essay directly in a timed, full-screen window — pasting is disabled, word count is shown live, and it submits automatically the moment time runs out.
            {mockTaskMode === 'full' && ' Both tasks share one continuous 60-minute-style timer, and students can switch between them freely, exactly like the real exam.'}
          </p>
        </div>
      )}

      {homeworkType === 'standard' && (
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
      )}

      {homeworkType === 'standard' && (
        <div>
          <label className="text-xs uppercase tracking-wide text-mist font-mono block mb-1">Optional teacher attachment</label>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="focus-ring text-sm text-mist file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-panel-2 file:text-paper file:cursor-pointer" />
        </div>
      )}
      {error && <p className="text-coral text-sm">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving} className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-50">{saving ? 'Posting…' : 'Post to group'}</button>
        <button type="button" onClick={() => setOpen(false)} className="focus-ring px-4 py-2 rounded-md border border-line text-mist">Cancel</button>
      </div>
    </form>
  )
}
