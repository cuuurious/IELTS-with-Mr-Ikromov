import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { countWords } from '../../lib/writingMock'
import { formatBand } from '../../lib/ieltsBands'
import { WRITING_CRITERIA, computeOverallBand, bandProblem, toBandOrNull } from '../../lib/marking'
import Icon from '../Icon'
import EssayAnnotator, { COMMENT_CATEGORIES, categoryOf, numberComments } from './EssayAnnotator'

/*
 * WRITING REVIEW (2026-10-16) — one screen for marking a writing mock,
 * used by three people:
 *   - the writing examiner: highlights parts of the essay and comments
 *     on them, fills in the four criteria and the overall feedback;
 *   - the teacher: sees all of that, can add/edit/delete comments and
 *     change any mark (stamped "changed by the teacher");
 *   - the student, once the result is released: reads the essay with
 *     the comments (read-only).
 * Comments save as soon as they're added; marks save with the button.
 */

const BASE_COLUMNS =
  'id, exam_id, student_id, submitted_at, task1_text, task2_text, examiner_band, examiner_feedback, examiner_reviewed_by, examiner_reviewed_at, ta_band, cc_band, lr_band, gra_band, released_at'
const ATTEMPT_COLUMNS = `${BASE_COLUMNS}, teacher_edited_by, teacher_edited_at`
// Until migration_81 has been run the teacher_edited_* columns don't
// exist; the screen still works, just without the "changed by" stamp.
const missingColumn = (err) => err && (err.code === '42703' || /teacher_edited/.test(err.message || ''))

const nameOf = (p) => p?.full_name || p?.username || 'Someone'

function when(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function WritingReviewModal({ attemptId, role = 'examiner', initialTask, onClose, onSaved }) {
  const { profile } = useAuth()
  const canMark = role === 'examiner' || role === 'teacher'

  const [state, setState] = useState({ loading: true, error: '' })
  const [attempt, setAttempt] = useState(null)
  const [exam, setExam] = useState(null)
  const [people, setPeople] = useState({}) // id -> profile
  const [comments, setComments] = useState([])
  const [task, setTask] = useState(1)
  const [activeId, setActiveId] = useState(null)
  const [side, setSide] = useState(role === 'teacher' ? 'marks' : 'comments')

  const [criteria, setCriteria] = useState({ ta: '', cc: '', lr: '', gra: '' })
  const [feedback, setFeedback] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmClose, setConfirmClose] = useState(false)
  const [legacy, setLegacy] = useState(false)
  const backdropDown = useRef(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      let { data: a, error: aErr } = await supabase.from('writing_mock_attempts').select(ATTEMPT_COLUMNS).eq('id', attemptId).maybeSingle()
      if (missingColumn(aErr)) {
        setLegacy(true)
        ;({ data: a, error: aErr } = await supabase.from('writing_mock_attempts').select(BASE_COLUMNS).eq('id', attemptId).maybeSingle())
      }
      if (cancelled) return
      if (aErr || !a) {
        setState({ loading: false, error: aErr?.message || 'This essay could not be found.' })
        return
      }
      const [{ data: e }, { data: cs, error: cErr }] = await Promise.all([
        supabase.from('writing_mock_exams').select('id, title, task1_prompt, task2_prompt, task1_image_url').eq('id', a.exam_id).maybeSingle(),
        supabase.from('writing_mock_comments').select('*').eq('attempt_id', attemptId).order('start_offset'),
      ])
      const ids = [...new Set([a.student_id, a.examiner_reviewed_by, a.teacher_edited_by, ...(cs || []).map((c) => c.author_id)].filter(Boolean))]
      const { data: ps } = ids.length ? await supabase.from('profiles').select('id, full_name, username, role').in('id', ids) : { data: [] }
      if (cancelled) return
      const map = {}
      ;(ps || []).forEach((p) => { map[p.id] = p })
      setAttempt(a)
      setExam(e || null)
      setPeople(map)
      setComments(cs || [])
      setCriteria({ ta: a.ta_band ?? '', cc: a.cc_band ?? '', lr: a.lr_band ?? '', gra: a.gra_band ?? '' })
      setFeedback(a.examiner_feedback || '')
      const want = initialTask === 'task1' ? 1 : initialTask === 'task2' ? 2 : null
      setTask(want && a[`task${want}_text`] ? want : a.task1_text ? 1 : 2)
      setState({ loading: false, error: cErr ? 'Comments could not be loaded.' : '' })
    }
    load()
    return () => {
      cancelled = true
    }
  }, [attemptId, initialTask])

  const taskComments = useMemo(() => numberComments(comments.filter((c) => c.task === task)), [comments, task])
  const countFor = (t) => comments.filter((c) => c.task === t).length

  const original = attempt
    ? { ta: attempt.ta_band ?? '', cc: attempt.cc_band ?? '', lr: attempt.lr_band ?? '', gra: attempt.gra_band ?? '', feedback: attempt.examiner_feedback || '' }
    : null
  const dirty =
    canMark &&
    original &&
    (['ta', 'cc', 'lr', 'gra'].some((k) => String(criteria[k]) !== String(original[k])) || feedback !== original.feedback)

  const computed = computeOverallBand([criteria.ta, criteria.cc, criteria.lr, criteria.gra])
  const overall = computed != null ? computed : attempt?.examiner_band ?? null
  const problems = WRITING_CRITERIA.map((c) => bandProblem(criteria[c.key])).filter(Boolean)

  const requestClose = () => {
    if (dirty && !confirmClose) {
      setConfirmClose(true)
      return
    }
    onClose()
  }

  // ---- comments ---------------------------------------------------------
  const addComment = async ({ start, end, quote, category, comment }) => {
    const { data, error } = await supabase
      .from('writing_mock_comments')
      .insert({ attempt_id: attemptId, task, start_offset: start, end_offset: end, quote, category, comment, author_id: profile.id })
      .select('*')
      .single()
    if (error) throw error
    setComments((prev) => [...prev, data])
    setPeople((prev) => (prev[profile.id] ? prev : { ...prev, [profile.id]: profile }))
    setActiveId(data.id)
  }

  const updateComment = async (id, patch) => {
    const { data, error } = await supabase.from('writing_mock_comments').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    setComments((prev) => prev.map((c) => (c.id === id ? data : c)))
  }

  const deleteComment = async (id) => {
    const { error } = await supabase.from('writing_mock_comments').delete().eq('id', id)
    if (error) throw error
    setComments((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) setActiveId(null)
  }

  // ---- marks --------------------------------------------------------------
  const saveMarks = async () => {
    if (problems.length) {
      setSaveError(problems[0])
      return
    }
    setSaving(true)
    setSaveError('')
    const nowIso = new Date().toISOString()
    const patch = {
      ta_band: toBandOrNull(criteria.ta),
      cc_band: toBandOrNull(criteria.cc),
      lr_band: toBandOrNull(criteria.lr),
      gra_band: toBandOrNull(criteria.gra),
      examiner_band: computed != null ? computed : attempt.examiner_band ?? null,
      examiner_feedback: feedback.trim() || null,
    }
    if (role === 'examiner') {
      patch.examiner_reviewed_by = profile.id
      patch.examiner_reviewed_at = nowIso
    } else {
      if (!legacy) {
        patch.teacher_edited_by = profile.id
        patch.teacher_edited_at = nowIso
      }
      // Marked by the teacher before any examiner: it counts as marked.
      if (!attempt.examiner_reviewed_at) {
        patch.examiner_reviewed_by = profile.id
        patch.examiner_reviewed_at = nowIso
      }
    }
    const { data, error } = await supabase
      .from('writing_mock_attempts')
      .update(patch)
      .eq('id', attemptId)
      .select(legacy ? BASE_COLUMNS : ATTEMPT_COLUMNS)
      .single()
    setSaving(false)
    if (error) {
      setSaveError(error.message || 'Could not save the marks.')
      return
    }
    setAttempt(data)
    setPeople((prev) => (prev[profile.id] ? prev : { ...prev, [profile.id]: profile }))
    setConfirmClose(false)
    onSaved?.(data)
  }

  // ---- render ---------------------------------------------------------------
  const student = attempt ? people[attempt.student_id] : null
  const essay = attempt ? attempt[`task${task}_text`] || '' : ''
  const words = countWords(essay)
  const minWords = task === 1 ? 150 : 250
  const prompt = exam ? exam[`task${task}_prompt`] : ''
  const tasks = attempt ? [1, 2].filter((t) => attempt[`task${t}_text`]) : []

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-2 sm:p-4"
      // Close only on a click that both starts and ends on the backdrop:
      // dragging to select essay text and letting go outside must not
      // close the screen.
      onMouseDown={(e) => {
        backdropDown.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropDown.current) requestClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Writing review"
        className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-[22px] border border-line bg-panel shadow-xl"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-writing-tint text-sm font-semibold text-writing">
            {nameOf(student).split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold text-paper">{role === 'student' ? 'Your essay, marked' : nameOf(student)}</h3>
            <p className="truncate text-[13px] text-mist">
              {exam?.title || 'Writing mock'}
              {attempt?.submitted_at && ` · handed in ${when(attempt.submitted_at)}`}
            </p>
          </div>
          {attempt && role !== 'student' && (
            <div className="order-last flex w-full flex-wrap items-center gap-1.5 text-[12px] md:order-none md:w-auto">
              {attempt.examiner_reviewed_at ? (
                <span className="rounded-full bg-reading-tint px-2.5 py-1 font-medium text-reading">
                  Marked by {nameOf(people[attempt.examiner_reviewed_by])}
                </span>
              ) : (
                <span className="rounded-full bg-writing-tint px-2.5 py-1 font-medium text-writing">Not marked yet</span>
              )}
              {attempt.teacher_edited_at && (
                <span className="rounded-full bg-listening-tint px-2.5 py-1 font-medium text-listening" title={when(attempt.teacher_edited_at)}>
                  Changed by {nameOf(people[attempt.teacher_edited_by])}
                </span>
              )}
              <span className={`rounded-full px-2.5 py-1 font-medium ${attempt.released_at ? 'bg-panel-2 text-paper' : 'bg-panel-2 text-mist'}`}>
                {attempt.released_at ? 'Released to student' : 'Not released'}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-mist hover:bg-panel-2 hover:text-paper"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        {state.loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-mist">Loading the essay…</div>
        ) : state.error && !attempt ? (
          <div className="flex flex-1 items-center justify-center text-sm text-urgent">{state.error}</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
            {/* Essay */}
            <div className="min-w-0 px-4 py-4 sm:px-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {tasks.length > 1 ? (
                  <div className="inline-flex gap-1 rounded-full bg-panel-2 p-1" role="tablist">
                    {tasks.map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={task === t}
                        onClick={() => {
                          setTask(t)
                          setActiveId(null)
                        }}
                        className={`focus-ring rounded-full px-4 py-1.5 text-sm font-medium ${task === t ? 'bg-panel text-writing shadow-sm' : 'text-mist hover:text-paper'}`}
                      >
                        Task {t}
                        {countFor(t) > 0 && <span className="ml-1.5 text-[12px] opacity-70">{countFor(t)}</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm font-semibold text-paper">Task {task}</span>
                )}
                <span className={`text-[13px] ${words < minWords ? 'font-medium text-urgent' : 'text-mist'}`}>
                  {words} words{words < minWords ? ` · under the ${minWords}-word minimum` : ` · minimum ${minWords}`}
                </span>
              </div>

              {prompt && (
                <details className="mt-3 rounded-2xl bg-writing-tint/60 px-4 py-3 text-sm text-paper-dim" open={role === 'student'}>
                  <summary className="cursor-pointer text-[13px] font-medium text-writing">Task {task} question</summary>
                  <p className="mt-1.5 whitespace-pre-wrap">{prompt}</p>
                  {task === 1 && exam?.task1_image_url && (
                    <img src={exam.task1_image_url} alt="Task 1 chart" className="mt-2 max-h-64 rounded-xl border border-line object-contain" />
                  )}
                </details>
              )}

              {canMark && (
                <p className="mt-3 flex items-center gap-2 text-[13px] text-mist">
                  <Icon name="pencil" className="h-3.5 w-3.5" />
                  Select any words in the essay to comment on them.
                </p>
              )}

              <EssayAnnotator
                key={task}
                text={essay}
                comments={taskComments}
                editable={canMark}
                activeId={activeId}
                onActivate={(id) => {
                  setActiveId(id)
                  setSide('comments')
                  document.getElementById(`comment-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }}
                onAdd={addComment}
                className="mt-3 rounded-2xl border border-line bg-panel-2/60 px-4 py-4 sm:px-6 sm:py-5"
              />

              <CategoryKey comments={comments.filter((c) => c.task === task)} />
            </div>

            {/* Side panel: comments + marks */}
            <aside className="flex w-full flex-col border-t border-line lg:min-h-0 lg:w-[380px] lg:shrink-0 lg:border-l lg:border-t-0">
              <div className="flex gap-1 border-b border-line px-4 pt-3 sm:px-5" role="tablist" aria-label="Comments or marks">
                {[
                  { key: 'comments', label: `Comments${taskComments.length ? ` · ${taskComments.length}` : ''}` },
                  { key: 'marks', label: `Marks · ${formatBand(overall)}` },
                ].map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={side === t.key}
                    onClick={() => setSide(t.key)}
                    className={`focus-ring -mb-px border-b-2 px-3 pb-2.5 pt-1 text-sm font-semibold ${
                      side === t.key ? 'border-paper text-paper' : 'border-transparent text-mist hover:text-paper'
                    }`}
                  >
                    {t.label}
                    {t.key === 'marks' && dirty && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-urgent align-middle" aria-label="unsaved" />}
                  </button>
                ))}
              </div>
              <div className="px-4 py-4 sm:px-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                {side === 'comments' && (
                <>
                <h4 className="text-[15px] font-semibold text-paper">Task {task}</h4>
                {taskComments.length === 0 ? (
                  <p className="mt-2 text-sm text-mist">
                    {canMark ? 'No comments yet. Select words in the essay to add one.' : 'No comments on this task.'}
                  </p>
                ) : (
                  <ol className="mt-3 flex flex-col gap-2.5">
                    {taskComments.map((c) => (
                      <CommentCard
                        key={c.id}
                        comment={c}
                        author={people[c.author_id]}
                        active={activeId === c.id}
                        editable={canMark}
                        showAuthor={role !== 'student'}
                        onSelect={() => setActiveId(c.id)}
                        onUpdate={(patch) => updateComment(c.id, patch)}
                        onDelete={() => deleteComment(c.id)}
                      />
                    ))}
                  </ol>
                )}
                </>
                )}

                {side === 'marks' && (
                <MarksPanel
                  role={role}
                  attempt={attempt}
                  criteria={criteria}
                  setCriteria={setCriteria}
                  feedback={feedback}
                  setFeedback={setFeedback}
                  overall={overall}
                  computed={computed}
                />
                )}
              </div>

              {canMark && (
                <div className="sticky bottom-0 border-t border-line bg-panel px-4 py-3 sm:px-5 lg:static">
                  {confirmClose && dirty && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-urgent-tint px-3 py-2 text-[13px] text-urgent">
                      <span className="flex-1">Your mark changes aren’t saved.</span>
                      <button type="button" onClick={onClose} className="focus-ring font-semibold underline">
                        Close without saving
                      </button>
                    </div>
                  )}
                  {saveError && <p className="mb-2 text-[13px] text-urgent">{saveError}</p>}
                  <button
                    type="button"
                    onClick={saveMarks}
                    disabled={saving || !dirty}
                    className="focus-ring h-11 w-full rounded-xl bg-brass text-sm font-semibold text-onbrass hover:bg-brass-dim disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : !dirty ? 'Marks saved' : role === 'teacher' ? 'Save changed marks' : 'Save marks'}
                  </button>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryKey({ comments }) {
  if (!comments.length) return null
  const counts = {}
  comments.forEach((c) => {
    counts[c.category] = (counts[c.category] || 0) + 1
  })
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {COMMENT_CATEGORIES.filter((c) => counts[c.key]).map((c) => (
        <span key={c.key} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${c.chip}`}>
          {c.label} <span className="tabular-nums opacity-80">{counts[c.key]}</span>
        </span>
      ))}
    </div>
  )
}

function CommentCard({ comment, author, active, editable, showAuthor, onSelect, onUpdate, onDelete }) {
  const cat = categoryOf(comment.category)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(comment.comment)
  const [category, setCategory] = useState(comment.category)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [askDelete, setAskDelete] = useState(false)

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err?.message || 'That didn’t work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      id={`comment-${comment.id}`}
      onClick={onSelect}
      className={`cursor-pointer rounded-2xl border p-3 transition-colors ${active ? 'border-paper/40 bg-panel-2' : 'border-line hover:border-paper/20'}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-paper px-1 text-[11px] font-semibold text-panel">{comment.n}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cat.chip}`}>{cat.label}</span>
        {showAuthor && author && <span className="ml-auto truncate text-[11px] text-mist">{author.full_name || author.username}</span>}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] italic text-paper-dim">“{comment.quote}”</p>

      {editing ? (
        <div className="mt-2 flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="focus-ring rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-sm text-paper"
            aria-label="Category"
          >
            {COMMENT_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="focus-ring w-full resize-none rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-sm text-paper"
            aria-label="Comment"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="focus-ring text-[13px] text-mist hover:text-paper">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await onUpdate({ comment: text.trim(), category })
                  setEditing(false)
                })
              }
              className="focus-ring rounded-full bg-brass px-3 py-1 text-[13px] font-semibold text-onbrass disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        comment.comment && <p className="mt-1.5 whitespace-pre-wrap text-sm text-paper">{comment.comment}</p>
      )}

      {editable && !editing && (
        <div className="mt-2 flex items-center gap-3 text-[12px]" onClick={(e) => e.stopPropagation()}>
          {askDelete ? (
            <>
              <span className="text-urgent">Delete this comment?</span>
              <button type="button" disabled={busy} onClick={() => run(onDelete)} className="focus-ring font-semibold text-urgent underline">
                Delete
              </button>
              <button type="button" onClick={() => setAskDelete(false)} className="focus-ring text-mist hover:text-paper">
                Keep
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setText(comment.comment)
                  setCategory(comment.category)
                  setEditing(true)
                }}
                className="focus-ring font-medium text-paper-dim hover:text-paper"
              >
                Edit
              </button>
              <button type="button" onClick={() => setAskDelete(true)} className="focus-ring font-medium text-paper-dim hover:text-urgent">
                Delete
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-[12px] text-urgent">{error}</p>}
    </li>
  )
}

function MarksPanel({ role, attempt, criteria, setCriteria, feedback, setFeedback, overall, computed }) {
  const readOnly = role === 'student'
  return (
    <section aria-labelledby="marks-h">
      <div className="flex items-baseline justify-between">
        <h4 id="marks-h" className="text-[15px] font-semibold text-paper">
          Band scores
        </h4>
        {role === 'teacher' && <span className="text-[12px] text-mist">You can change any mark</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {WRITING_CRITERIA.map((c) => (
          <label key={c.key} className="flex flex-col gap-1 text-[12px] leading-tight text-mist">
            <span title={c.label}>{c.label}</span>
            {readOnly ? (
              <span className="text-lg font-semibold tabular-nums text-paper">{criteria[c.key] === '' ? '–' : formatBand(Number(criteria[c.key]))}</span>
            ) : (
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="9"
                step="0.5"
                value={criteria[c.key]}
                onChange={(e) => setCriteria((prev) => ({ ...prev, [c.key]: e.target.value }))}
                className="focus-ring h-10 w-full rounded-xl border border-line bg-panel-2 px-3 text-sm font-semibold tabular-nums text-paper"
              />
            )}
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-2xl bg-writing-tint px-4 py-3">
        <span className="text-sm font-medium text-writing">Overall</span>
        <span className="text-2xl font-semibold tabular-nums text-writing">{formatBand(overall)}</span>
        {!readOnly && (
          <span className="ml-auto text-right text-[11px] leading-tight text-writing/80">
            {computed != null ? 'from the four criteria' : 'fill in all four'}
          </span>
        )}
      </div>
      <label className="mt-4 flex flex-col gap-1 text-[13px] font-medium text-mist">
        Overall feedback
        {readOnly ? (
          <p className="whitespace-pre-wrap text-sm font-normal text-paper">{feedback || '–'}</p>
        ) : (
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={5}
            placeholder="What went well, what to work on next…"
            className="focus-ring w-full resize-y rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm font-normal text-paper"
          />
        )}
      </label>
      {attempt?.teacher_edited_at && role !== 'student' && (
        <p className="mt-2 text-[12px] text-mist">Marks last changed by the teacher {when(attempt.teacher_edited_at)}.</p>
      )}
    </section>
  )
}
