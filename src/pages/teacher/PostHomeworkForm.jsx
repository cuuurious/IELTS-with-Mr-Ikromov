import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { lessonTime, toLocalInput } from '../../lib/courses'
import HomeworkTasksEditor from '../../components/homework/HomeworkTasksEditor'
import { saveHomeworkTasks, taskTitle } from '../../lib/homeworkTasks'
import { supabase } from '../../lib/supabaseClient'
import { guessMimeType } from '../../lib/mime'
import { safeFileName } from '../../lib/storageKey'
import { useFileDrop, DropOverlay } from '../../lib/useFileDrop'
import { SUBMISSION_TYPE_OPTIONS } from '../../lib/submissionTypes'
import { MOCK_TASK_MODES, DEFAULT_TIME_LIMITS } from '../../lib/writingMock'
import MaterialPicker, { PickedMaterialsList, attachMaterialsToHomework } from '../../components/MaterialPicker'
import Icon from '../../components/Icon'
import { SkillIcon } from '../../components/SkillArt'
import HomeworkLessonFields from '../../components/HomeworkLessonFields'
import { loadLessonDefaults, loadTelegramLink, postHomeworkToTelegram } from '../../lib/telegramGroupPost'
import { notifyGroup } from '../../lib/notify'
import { groupColour, groupDisplayName } from '../../lib/groupLook'

/*
 * Post homework (redesigned 2026-11-05).
 * Three steps on one sheet:
 *   1. What will they do? — "In the site" (tests, practice pages, word
 *      lists, shadowing; marked by themselves) is the main way. "Writing
 *      mock" is the timed essay. "Files / pictures" is kept for extras
 *      such as General English, where students upload their work.
 *   2. Which groups — this group, plus any others (same homework is
 *      posted to each, with its own next lesson as the deadline).
 *   3. Deadline — next lesson by default.
 * One saffron Post button with a summary of what will happen.
 */

const DEFAULT_TYPES = ['image']
const DEFAULT_MOCK_MODE = 'task2'

const endOfDay = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(23, 59, 0, 0)
  return toLocalInput(d.toISOString())
}

const MODES = [
  { key: 'site', title: 'In the site', line: 'Tests, practice pages, word lists, shadowing — marked by themselves', skill: 'reading', tint: 'bg-reading-tint', text: 'text-reading' },
  { key: 'writing_mock', title: 'Writing mock', line: 'Timed Task 1 / Task 2 essay typed in the exam screen', skill: 'writing', tint: 'bg-writing-tint', text: 'text-writing' },
]

function StepTitle({ n, children, hint }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-brass text-[13px] font-extrabold text-onbrass">{n}</span>
      <p className="font-brand text-[15px] font-semibold text-paper">{children}</p>
      {hint && <p className="truncate text-xs font-semibold text-mist">{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, title, line }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[14px] border px-3 py-2.5 transition ${checked ? 'border-brass bg-brass/10' : 'border-line bg-panel'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brass" />
      <span className="min-w-0">
        <span className="block text-sm font-extrabold text-paper">{title}</span>
        {line && <span className="block text-xs font-semibold text-mist">{line}</span>}
      </span>
    </label>
  )
}

export default function PostHomeworkForm({ groupId, teacherId, groupName = '', onPosted }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('site') // 'site' | 'files' | 'writing_mock'
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [enableSpeaking, setEnableSpeaking] = useState(false)
  const [aiEvalEnabled, setAiEvalEnabled] = useState(false)
  const [allowedTypes, setAllowedTypes] = useState(DEFAULT_TYPES)
  const [minFiles, setMinFiles] = useState(1)
  const [maxFiles, setMaxFiles] = useState(10)
  const [file, setFile] = useState(null)
  const [libraryFiles, setLibraryFiles] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [tasks, setTasks] = useState([])
  const [moreOpen, setMoreOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Groups (this one is always on) and each group's next lesson.
  const [groups, setGroups] = useState([])
  const [extraGroups, setExtraGroups] = useState(() => new Set())
  const [nextLessons, setNextLessons] = useState({}) // group id -> ISO | null

  // Deadline: 'next' (each group's next lesson), 'none', or a datetime-local string.
  const [due, setDue] = useState('next')

  // Lesson number/date + Telegram (2026-10-08).
  const [lessonsSupported, setLessonsSupported] = useState(false)
  const [lessonNumber, setLessonNumber] = useState('')
  const [lessonDate, setLessonDate] = useState('')
  const [telegram, setTelegram] = useState({ supported: false, linked: false, title: null })
  const [postToTelegram, setPostToTelegram] = useState(true)

  // Writing mock.
  const [mockTaskMode, setMockTaskMode] = useState(DEFAULT_MOCK_MODE)
  const [mockTimeLimit, setMockTimeLimit] = useState(DEFAULT_TIME_LIMITS[DEFAULT_MOCK_MODE])
  const [mockTask1Prompt, setMockTask1Prompt] = useState('')
  const [mockTask2Prompt, setMockTask2Prompt] = useState('')
  const [mockTask1Image, setMockTask1Image] = useState(null)
  const mockTask1ImageInputRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!open || !groupId) return undefined
    let cancelled = false
    loadLessonDefaults(groupId).then((d) => {
      if (cancelled) return
      setLessonsSupported(d.supported)
      setLessonNumber(d.lessonNumber)
      setLessonDate(d.lessonDate)
    })
    loadTelegramLink(groupId).then((t) => {
      if (cancelled) return
      setTelegram(t)
      setPostToTelegram(true)
    })
    supabase
      .from('groups')
      .select('id, name, created_at, telegram_chat_id')
      .order('created_at')
      .then(async ({ data }) => {
        if (cancelled) return
        const list = data || []
        setGroups(list)
        const ids = list.some((g) => g.id === groupId) ? list.map((g) => g.id) : [groupId, ...list.map((g) => g.id)]
        const pairs = await Promise.all(
          ids.map((id) =>
            supabase.rpc('next_group_lesson', { p_group_id: id }).then(({ data: d, error: e }) => {
              const row = Array.isArray(d) ? d[0] : d
              return [id, !e && row?.starts_at ? row.starts_at : null]
            })
          )
        )
        if (!cancelled) setNextLessons(Object.fromEntries(pairs))
      })
    return () => {
      cancelled = true
    }
  }, [open, groupId])

  // Esc closes; the page behind does not scroll.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && !pickerOpen && setOpen(false)
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, pickerOpen])

  const clearMockTask1Image = () => {
    setMockTask1Image(null)
    if (mockTask1ImageInputRef.current) mockTask1ImageInputRef.current.value = ''
  }
  const clearFile = () => {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  const pasteInto = (setter) => (e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file') {
        const pasted = item.getAsFile()
        if (pasted) {
          e.preventDefault()
          setter(pasted)
          break
        }
      }
    }
  }
  const attachmentDrop = useFileDrop({ multiple: false, onFiles: (files) => setFile(files[0] || null) })
  const mockImageDrop = useFileDrop({
    accept: 'image/*',
    multiple: false,
    onFiles: (files) => setMockTask1Image(files[0] || null),
    onReject: () => setError('The Task 1 chart has to be an image file.'),
  })

  const chooseMode = (m) => {
    setMode(m)
    setError('')
    // Speaking and a writing mock don't mix; a mock has its own chart
    // image instead of the general attachment.
    if (m === 'writing_mock') {
      setEnableSpeaking(false)
      setFile(null)
    }
    if (m === 'files' && minFiles === 0 && !tasks.length) setMinFiles(1)
  }
  const chooseMockTaskMode = (m) => {
    setMockTaskMode(m)
    setMockTimeLimit(DEFAULT_TIME_LIMITS[m])
  }
  const toggleType = (value) => setAllowedTypes((prev) => (prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]))
  const toggleGroup = (id) =>
    setExtraGroups((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const isMock = mode === 'writing_mock'
  const autoTitle = useMemo(() => {
    if (isMock) {
      const m = MOCK_TASK_MODES.find((x) => x.value === mockTaskMode)
      return `Writing mock · ${m?.label || 'Task 2'}`
    }
    if (mode === 'site' && tasks.length) return tasks.length === 1 ? taskTitle(tasks[0]) : `${taskTitle(tasks[0])} + ${tasks.length - 1} more`
    return ''
  }, [isMock, mockTaskMode, mode, tasks])
  const finalTitle = title.trim() || autoTitle

  const groupIndex = (id) => Math.max(0, groups.findIndex((g) => g.id === id))
  const nameOf = (id) => (id === groupId && groupName ? groupDisplayName(groupName) : groupDisplayName(groups.find((g) => g.id === id)?.name || ''))
  const targetIds = [groupId, ...[...extraGroups].filter((id) => id !== groupId)]

  const dueFor = (gid) => {
    if (due === 'none') return null
    if (due === 'next') return nextLessons[gid] || new Date(endOfDay(2)).toISOString()
    return new Date(due).toISOString()
  }
  const dueSummary = (() => {
    if (due === 'none') return 'no deadline'
    if (due === 'next') {
      const iso = nextLessons[groupId]
      return iso ? `next lesson · ${lessonTime(iso)}` : 'in 2 days (no lesson times yet)'
    }
    return lessonTime(new Date(due).toISOString())
  })()

  const whatSummary = isMock
    ? 'Timed writing mock'
    : mode === 'site'
      ? tasks.length
        ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} in the site`
        : 'No tasks yet'
      : `Upload ${allowedTypes.length ? 'work' : '—'}${libraryFiles.length || file ? ' · with files' : ''}`

  const reset = () => {
    setMode('site')
    setLibraryFiles([])
    setTasks([])
    setTitle('')
    setDescription('')
    setDue('next')
    setEnableSpeaking(false)
    setAiEvalEnabled(false)
    setAllowedTypes(DEFAULT_TYPES)
    setMinFiles(1)
    setMaxFiles(10)
    setFile(null)
    setExtraGroups(new Set())
    setMoreOpen(false)
    setMockTaskMode(DEFAULT_MOCK_MODE)
    setMockTimeLimit(DEFAULT_TIME_LIMITS[DEFAULT_MOCK_MODE])
    setMockTask1Prompt('')
    setMockTask2Prompt('')
    setMockTask1Image(null)
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (mode === 'site' && !tasks.length) throw new Error('Add at least one task — or choose “Files / pictures” for an extra.')
      if (mode === 'files') {
        if (!allowedTypes.length) throw new Error('Choose at least one kind of file students may upload.')
        if (minFiles < 0 || maxFiles < 1 || minFiles > maxFiles) throw new Error('Check the smallest and largest number of files.')
      }
      if (isMock) {
        if (!mockTimeLimit || mockTimeLimit < 1) throw new Error('Set a time limit for the mock test.')
        if ((mockTaskMode === 'task1' || mockTaskMode === 'full') && !mockTask1Prompt.trim()) throw new Error('Add the Task 1 prompt.')
        if ((mockTaskMode === 'task2' || mockTaskMode === 'full') && !mockTask2Prompt.trim()) throw new Error('Add the Task 2 prompt.')
      }
      if (!finalTitle) throw new Error('Give the homework a title.')

      // Uploads happen once and are shared by every group.
      let attachment_url = null
      let attachment_name = null
      if (file && !isMock) {
        const path = `${teacherId}/${groupId}/${safeFileName(file.name)}`
        const { error: upErr } = await supabase.storage.from('homework-files').upload(path, file, { contentType: guessMimeType(file.name, file.type) })
        if (upErr) throw upErr
        attachment_url = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
        attachment_name = file.name
      }
      let mock_task1_image_url = null
      if (isMock && mockTask1Image) {
        const path = `${teacherId}/${groupId}/mock-task1-${safeFileName(mockTask1Image.name)}`
        const { error: mockUpErr } = await supabase.storage
          .from('homework-files')
          .upload(path, mockTask1Image, { contentType: guessMimeType(mockTask1Image.name, mockTask1Image.type) })
        if (mockUpErr) throw mockUpErr
        mock_task1_image_url = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
      }

      const siteMode = mode === 'site'
      const base = {
        title: finalTitle,
        description,
        enable_speaking: isMock ? false : enableSpeaking,
        ai_eval_enabled: aiEvalEnabled,
        // In-site homework: an upload is allowed but never required.
        allowed_submission_types: isMock ? [] : siteMode ? DEFAULT_TYPES : allowedTypes,
        min_submission_files: isMock || siteMode ? 0 : minFiles,
        max_submission_files: isMock ? 0 : siteMode ? 10 : maxFiles,
        attachment_url,
        attachment_name,
        created_by: teacherId,
        homework_type: isMock ? 'writing_mock' : 'standard',
        mock_task_mode: isMock ? mockTaskMode : null,
        mock_time_limit_minutes: isMock ? mockTimeLimit : null,
        mock_task1_prompt: isMock ? mockTask1Prompt : null,
        mock_task1_image_url: isMock ? mock_task1_image_url : null,
        mock_task2_prompt: isMock ? mockTask2Prompt : null,
      }

      const postTo = async (gid) => {
        let lesson = {}
        if (lessonsSupported) {
          if (gid === groupId) lesson = { lesson_number: lessonNumber === '' ? null : Number(lessonNumber), lesson_date: lessonDate || null }
          else {
            const d = await loadLessonDefaults(gid)
            lesson = d.supported ? { lesson_number: d.lessonNumber === '' ? null : Number(d.lessonNumber), lesson_date: d.lessonDate || null } : {}
          }
        }
        const { data, error: insErr } = await supabase
          .from('homeworks')
          .insert({ ...base, group_id: gid, due_date: dueFor(gid), ...lesson })
          .select()
          .maybeSingle()
        if (insErr) throw insErr
        // maybeSingle() can return no row right after a migration even
        // though the insert worked — read it back before giving up.
        let posted = data
        if (!posted) {
          const { data: refetched } = await supabase
            .from('homeworks')
            .select()
            .eq('group_id', gid)
            .eq('created_by', teacherId)
            .eq('title', finalTitle)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          posted = refetched
        }
        if (!posted) throw new Error('The homework may not have posted — check the list before trying again.')
        const warnings = []
        if (!isMock && libraryFiles.length) {
          try {
            await attachMaterialsToHomework(posted.id, libraryFiles)
          } catch (attachErr) {
            warnings.push(`library files not attached (${attachErr.message})`)
          }
        }
        if (!isMock && tasks.length) {
          try {
            await saveHomeworkTasks(posted.id, tasks)
          } catch (taskErr) {
            warnings.push(`in-site tasks not saved (${taskErr.message})`)
          }
        }
        const linked = gid === groupId ? telegram.linked : Boolean(groups.find((g) => g.id === gid)?.telegram_chat_id)
        if (linked && postToTelegram) postHomeworkToTelegram(posted.id, 'post')
        return { posted, warnings }
      }

      const problems = []
      const doneExtra = []
      for (const gid of targetIds) {
        try {
          const { posted, warnings } = await postTo(gid)
          if (gid === groupId) onPosted(posted)
          else {
            notifyGroup({ groupId: gid, type: 'homework_new', title: 'New homework posted', body: posted.title, link: `homework:${posted.id}` })
            doneExtra.push(gid)
          }
          if (warnings.length) problems.push(`${nameOf(gid)}: posted, but ${warnings.join(' and ')}. Open “Edit” on it to add them again.`)
        } catch (err) {
          if (gid === groupId) throw err
          problems.push(`${nameOf(gid)}: ${err.message}`)
        }
      }

      if (problems.length) {
        // Groups that worked are taken off, so pressing Post again only
        // tries the ones that failed (this group is already posted).
        setExtraGroups((prev) => new Set([...prev].filter((id) => !doneExtra.includes(id))))
        setError(problems.join('\n'))
        return
      }
      reset()
      setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="focus-ring inline-flex h-11 w-fit items-center gap-2 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] shadow-sm transition hover:brightness-105"
    >
      <span className="text-lg leading-none">＋</span> Post homework
    </button>
  )
  if (!open) return trigger

  const dueChip = (value, label, sub) => (
    <button
      key={label}
      type="button"
      onClick={() => setDue(value)}
      aria-pressed={due === value}
      className={`focus-ring flex flex-col items-start rounded-[14px] px-3.5 py-2 text-left transition ${due === value ? 'bg-brass text-onbrass' : 'bg-panel text-paper hover:bg-panel-2'}`}
    >
      <span className="text-[13px] font-extrabold leading-tight">{label}</span>
      {sub && <span className={`text-[11px] font-bold ${due === value ? 'text-onbrass/80' : 'text-mist'}`}>{sub}</span>}
    </button>
  )

  const isCustomDue = due !== 'next' && due !== 'none' && ![endOfDay(0), endOfDay(1), endOfDay(2)].includes(due)

  const attachments = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-extrabold text-paper-dim">Your files for students {libraryFiles.length ? `(${libraryFiles.length + (file ? 1 : 0)})` : '(optional)'}</p>
        <button type="button" onClick={() => setPickerOpen(true)} className="focus-ring h-9 rounded-[12px] bg-brass/10 px-3 text-xs font-extrabold text-brass hover:bg-brass/20">
          ＋ From Materials Library
        </button>
      </div>
      <PickedMaterialsList items={libraryFiles} onRemove={(m) => setLibraryFiles((prev) => prev.filter((x) => x.id !== m.id))} />
      {file ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-line bg-panel px-3 py-2.5">
          <span className="flex min-w-0 max-w-[260px] items-center gap-1.5 truncate text-sm font-bold text-paper">
            <Icon name="paperclip" className="h-4 w-4 shrink-0" /> {file.name}
          </span>
          <button type="button" onClick={clearFile} className="focus-ring rounded-[12px] px-2.5 py-1 text-xs font-extrabold text-coral hover:bg-urgent-tint">
            Remove
          </button>
        </div>
      ) : (
        <div
          tabIndex={0}
          role="button"
          onPaste={pasteInto(setFile)}
          onClick={() => fileInputRef.current?.click()}
          {...attachmentDrop.dropProps}
          className="focus-ring relative flex cursor-pointer items-center gap-3 rounded-[14px] border border-dashed border-line bg-panel px-3 py-3 transition hover:border-brass/60"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-panel-2 text-mist">
            <Icon name="paperclip" className="h-4 w-4" />
          </span>
          <span className="text-xs font-semibold text-mist">Upload from this computer — click, paste (Ctrl+V) or drop a file</span>
          <input ref={fileInputRef} type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} onClick={(e) => e.stopPropagation()} className="hidden" />
          <DropOverlay show={attachmentDrop.isDragging} label="Drop the file here" />
        </div>
      )}
      <MaterialPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        alreadyPickedIds={libraryFiles.map((m) => m.id)}
        onPick={(rows) => setLibraryFiles((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))])}
      />
    </div>
  )

  const speakingAndAi = (
    <div className="grid gap-2 sm:grid-cols-2">
      {!isMock && <Toggle checked={enableSpeaking} onChange={setEnableSpeaking} title="Speaking Part 1 / 2 / 3" line="Students record answers in the site" />}
      <Toggle
        checked={aiEvalEnabled}
        onChange={setAiEvalEnabled}
        title="AI feedback and band"
        line={isMock ? 'Writing feedback after the mock' : enableSpeaking ? 'IELTS Speaking feedback on recordings' : 'IELTS Writing feedback on essays'}
      />
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/60 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Post homework"
        className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-ink shadow-2xl sm:rounded-[28px]"
      >
        <div className="registan-band flex shrink-0 items-start justify-between gap-3 px-5 py-4 text-white sm:px-6">
          <div className="min-w-0">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Post homework</p>
            <p className="truncate font-brand text-[20px] font-semibold text-white">{groupName ? groupDisplayName(groupName) : 'New homework'}</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 text-xl leading-none text-white transition hover:bg-white/25"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5 sm:px-6">
          {/* 1 · What */}
          <section className="flex flex-col gap-3">
            <StepTitle n={1}>What will they do?</StepTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODES.map((m) => {
                const on = mode === m.key
                return (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => chooseMode(m.key)}
                    className={`focus-ring flex items-center gap-3 rounded-[20px] border-2 p-3.5 text-left transition ${on ? 'border-brass bg-panel' : 'border-transparent bg-panel hover:border-line'}`}
                  >
                    <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[14px] ${m.tint} ${m.text}`}>
                      <SkillIcon skill={m.skill} className="h-6 w-6" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-brand text-[15px] font-semibold text-paper">{m.title}</span>
                      <span className="block text-xs font-semibold leading-snug text-mist">{m.line}</span>
                    </span>
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-xs font-extrabold ${on ? 'bg-brass text-onbrass' : 'bg-panel-2 text-transparent'}`}>✓</span>
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              aria-pressed={mode === 'files'}
              onClick={() => chooseMode('files')}
              className={`focus-ring flex items-center gap-2.5 rounded-[14px] border px-3 py-2 text-left transition ${mode === 'files' ? 'border-brass bg-brass/10' : 'border-dashed border-line hover:border-brass/50'}`}
            >
              <Icon name="image" className={`h-4 w-4 shrink-0 ${mode === 'files' ? 'text-brass' : 'text-mist'}`} />
              <span className="shrink-0 whitespace-nowrap text-[13px] font-extrabold text-paper">Files / pictures</span>
              <span className="truncate text-xs font-semibold text-mist">extra work, e.g. General English — students upload photos or files</span>
            </button>

            {mode === 'site' && (
              <HomeworkTasksEditor groupId={groupId} tasks={tasks} onChange={setTasks} />
            )}

            {isMock && (
              <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel-2 p-4">
                <div className="flex flex-wrap gap-1.5">
                  {MOCK_TASK_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => chooseMockTaskMode(m.value)}
                      className={`focus-ring h-9 rounded-[12px] px-3.5 text-[13px] font-extrabold ${mockTaskMode === m.value ? 'bg-writing text-white' : 'bg-panel text-paper-dim hover:text-paper'}`}
                    >
                      {m.label}
                    </button>
                  ))}
                  <label className="ml-auto flex items-center gap-2 text-xs font-extrabold text-paper-dim">
                    <Icon name="timer" className="h-4 w-4" />
                    <input
                      type="number"
                      min="1"
                      max="180"
                      value={mockTimeLimit}
                      onChange={(e) => setMockTimeLimit(Number(e.target.value))}
                      className="focus-ring w-16 rounded-[12px] border border-line bg-panel px-2 py-1.5 text-sm text-paper"
                    />
                    min
                  </label>
                </div>
                {(mockTaskMode === 'task1' || mockTaskMode === 'full') && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[13px] font-extrabold text-paper-dim">Task 1 prompt</p>
                    <textarea
                      value={mockTask1Prompt}
                      onChange={(e) => setMockTask1Prompt(e.target.value)}
                      rows={3}
                      placeholder="The chart below shows… Summarise the information by selecting and reporting the main features…"
                      className="focus-ring w-full rounded-[14px] border border-line bg-panel px-3 py-2 text-sm text-paper"
                    />
                    {mockTask1Image ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-line bg-panel px-3 py-2.5">
                        <span className="flex max-w-[260px] items-center gap-1.5 truncate text-sm font-bold text-paper">
                          <Icon name="image" className="h-4 w-4 shrink-0" /> {mockTask1Image.name}
                        </span>
                        <button type="button" onClick={clearMockTask1Image} className="focus-ring rounded-[12px] px-2.5 py-1 text-xs font-extrabold text-coral hover:bg-urgent-tint">
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div
                        tabIndex={0}
                        role="button"
                        onPaste={pasteInto(setMockTask1Image)}
                        onClick={() => mockTask1ImageInputRef.current?.click()}
                        {...mockImageDrop.dropProps}
                        className="focus-ring relative flex cursor-pointer items-center gap-3 rounded-[14px] border border-dashed border-line bg-panel px-3 py-3 transition hover:border-brass/60"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-writing-tint text-writing">
                          <Icon name="image" className="h-4 w-4" />
                        </span>
                        <span className="text-xs font-semibold text-mist">Chart / graph image (optional) — click, paste or drop</span>
                        <input
                          ref={mockTask1ImageInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) => setMockTask1Image(e.target.files?.[0] || null)}
                          onClick={(e) => e.stopPropagation()}
                          className="hidden"
                        />
                        <DropOverlay show={mockImageDrop.isDragging} label="Drop the image here" />
                      </div>
                    )}
                  </div>
                )}
                {(mockTaskMode === 'task2' || mockTaskMode === 'full') && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[13px] font-extrabold text-paper-dim">Task 2 prompt</p>
                    <textarea
                      value={mockTask2Prompt}
                      onChange={(e) => setMockTask2Prompt(e.target.value)}
                      rows={3}
                      placeholder="Some people believe that… To what extent do you agree or disagree?"
                      className="focus-ring w-full rounded-[14px] border border-line bg-panel px-3 py-2 text-sm text-paper"
                    />
                  </div>
                )}
                <p className="text-xs font-semibold text-mist">
                  Full-screen and timed; pasting is off and it hands in by itself when time runs out.
                  {mockTaskMode === 'full' && ' Both tasks share one timer, like the real exam.'}
                </p>
                {speakingAndAi}
              </div>
            )}

            {mode === 'files' && (
              <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] font-extrabold text-paper-dim">Students may upload</p>
                  <div className="flex items-center gap-2 text-xs font-extrabold text-paper-dim">
                    <label className="flex items-center gap-1.5">
                      at least
                      <input type="number" min="0" max="99" value={minFiles} onChange={(e) => setMinFiles(Number(e.target.value))} className="focus-ring w-14 rounded-[12px] border border-line bg-panel px-2 py-1.5 text-sm text-paper" />
                    </label>
                    <label className="flex items-center gap-1.5">
                      up to
                      <input type="number" min="1" max="99" value={maxFiles} onChange={(e) => setMaxFiles(Number(e.target.value))} className="focus-ring w-14 rounded-[12px] border border-line bg-panel px-2 py-1.5 text-sm text-paper" />
                    </label>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SUBMISSION_TYPE_OPTIONS.map((o) => {
                    const on = allowedTypes.includes(o.value)
                    return (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleType(o.value)}
                        className={`focus-ring h-9 rounded-[12px] px-3 text-[13px] font-extrabold transition ${on ? 'bg-brass text-onbrass' : 'bg-panel text-paper-dim hover:text-paper'}`}
                      >
                        {on ? '✓ ' : ''}
                        {o.label}
                      </button>
                    )
                  })}
                </div>
                {attachments}
                {speakingAndAi}
              </div>
            )}
          </section>

          {/* Title + note */}
          <section className="flex flex-col gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={autoTitle ? `Title — “${autoTitle}”` : 'Title (e.g. Unit 4 grammar)'}
              className="focus-ring rounded-[14px] border border-line bg-panel px-3.5 py-2.5 text-sm font-bold text-paper"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Note for students (optional)"
              rows={2}
              className="focus-ring resize-y rounded-[14px] border border-line bg-panel px-3.5 py-2.5 text-sm text-paper"
            />
            {mode === 'site' && (
              <div>
                <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} className="focus-ring rounded-[12px] px-1 py-1 text-xs font-extrabold text-brass hover:underline">
                  {moreOpen ? '− Fewer options' : '+ Add your own file, speaking or AI feedback'}
                </button>
                {moreOpen && (
                  <div className="mt-2 flex flex-col gap-3 rounded-[20px] border border-line bg-panel-2 p-4">
                    {attachments}
                    {speakingAndAi}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 2 · Groups */}
          <section className="flex flex-col gap-3">
            <StepTitle n={2} hint="tap to add more groups">Which groups?</StepTitle>
            <div className="flex flex-wrap gap-1.5">
              {(groups.length ? groups : [{ id: groupId, name: groupName }]).map((g) => {
                const here = g.id === groupId
                const on = here || extraGroups.has(g.id)
                const c = groupColour(groupIndex(g.id))
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    disabled={here}
                    onClick={() => toggleGroup(g.id)}
                    className={`focus-ring flex h-10 items-center gap-2 rounded-[12px] border-2 px-3 text-sm font-extrabold transition ${on ? `${c.border} ${c.tint} ${c.text}` : 'border-transparent bg-panel text-paper-dim hover:text-paper'} ${here ? 'cursor-default' : ''}`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-[4px] ${c.bar}`} aria-hidden="true" />
                    {groupDisplayName(g.name)}
                    {on && <span aria-hidden="true">✓</span>}
                  </button>
                )
              })}
            </div>
          </section>

          {/* 3 · Deadline */}
          <section className="flex flex-col gap-3">
            <StepTitle n={3}>Deadline</StepTitle>
            <div className="flex flex-wrap gap-1.5">
              {dueChip('next', 'Next lesson', nextLessons[groupId] ? lessonTime(nextLessons[groupId]) : 'no lesson times — 2 days')}
              {dueChip(endOfDay(0), 'Tonight', '23:59')}
              {dueChip(endOfDay(1), 'Tomorrow', '23:59')}
              {dueChip(endOfDay(2), 'In 2 days', '23:59')}
              {dueChip('none', 'No deadline')}
              <label className={`focus-ring flex cursor-pointer flex-col items-start rounded-[14px] px-3.5 py-2 ${isCustomDue ? 'bg-brass text-onbrass' : 'bg-panel text-paper'}`}>
                <span className="text-[13px] font-extrabold leading-tight">Pick a time</span>
                <input
                  type="datetime-local"
                  value={isCustomDue ? due : ''}
                  onChange={(e) => setDue(e.target.value || 'next')}
                  className={`w-[170px] bg-transparent text-[11px] font-bold outline-none ${isCustomDue ? 'text-onbrass' : 'text-mist'}`}
                />
              </label>
            </div>
            {due === 'next' && extraGroups.size > 0 && (
              <p className="text-xs font-semibold text-mist">
                Each group gets its own next lesson:{' '}
                {targetIds.map((id) => `${nameOf(id)} ${nextLessons[id] ? lessonTime(nextLessons[id]) : '— in 2 days'}`).join(' · ')}
              </p>
            )}
            {due === 'next' && !nextLessons[groupId] && (
              <p className="rounded-[14px] bg-brass/10 px-3 py-2 text-xs font-semibold text-paper">
                This group has no lesson times yet. Set the lesson days and times under <span className="font-extrabold">Course &amp; tools → Follow a course</span>, and “Next lesson” will use the real lesson.
              </p>
            )}
          </section>

          {lessonsSupported && (
            <HomeworkLessonFields
              lessonNumber={lessonNumber}
              lessonDate={lessonDate}
              onLessonNumber={setLessonNumber}
              onLessonDate={setLessonDate}
              telegram={telegram}
              postToTelegram={postToTelegram}
              onPostToTelegram={setPostToTelegram}
              telegramLabel={extraGroups.size ? 'Also post in each group’s Telegram chat' : undefined}
            />
          )}

          {error && <p className="whitespace-pre-line rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-panel px-5 py-3.5 sm:px-6">
          <p className="min-w-0 flex-1 text-xs font-bold leading-snug text-paper-dim">
            <span className="text-paper">{whatSummary}</span>
            <br />
            {targetIds.map(nameOf).join(', ')} · {dueSummary}
          </p>
          <button type="button" onClick={() => setOpen(false)} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist hover:text-paper">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] transition hover:brightness-105 disabled:opacity-50"
          >
            {saving ? 'Posting…' : targetIds.length > 1 ? `Post to ${targetIds.length} groups` : 'Post'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
