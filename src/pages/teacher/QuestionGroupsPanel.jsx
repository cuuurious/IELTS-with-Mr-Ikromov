import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { estimateBandFromPercent } from '../../lib/ieltsBands'
import { safeFileName } from '../../lib/storageKey'
import { guessMimeType } from '../../lib/mime'
import {
  GROUP_KINDS,
  WORD_LIMITS,
  buildQuestionGroups,
  generateInstruction,
} from '../../components/exam/questionGroups'

/*
 * QUESTION GROUPS — teacher side (2026-10-06, migration_74).
 *
 * One group = one "Questions 11–15" block: task type, word limit, title,
 * optional own instruction, and whether bank letters can be used more
 * than once. The exam prints the header once from these settings, and
 * marking applies the word limit.
 *
 * "Set up automatically" turns the current questions into groups using
 * the same reading of the prompts the exam screen used before
 * (instruction at the end of a prompt, "Title — subheading:" at the
 * start, shared stems). The teacher can then fix anything by hand.
 *
 * Also here: "Re-mark submitted tests" (regrade_mock_exam) for when an
 * answer key was corrected after students sat the test.
 */

const MISSING_TABLE = /mock_question_groups|PGRST205|42P01|does not exist|schema cache/i
const GAP_KINDS = new Set(GROUP_KINDS.filter((k) => k.family === 'gap' || k.value === 'other').map((k) => k.value))
const MATCH_KINDS = new Set(GROUP_KINDS.filter((k) => k.family === 'match').map((k) => k.value))
// migration_80: a picture with gaps on it, or the notes/table text.
const IMAGE_KINDS = new Set(['map_labelling', 'diagram_labelling'])
const BODY_KINDS = new Set(['note_completion', 'form_completion', 'table_completion', 'summary_completion', 'sentence_completion', 'flow_chart', 'matching_features', 'other'])
const MISSING_LAYOUT_COLS = /body|image_url|gap_positions|PGRST204|42703/i
const countGaps = (body) => (String(body || '').match(/\[\[[^\]]*\]\]|_{3,}/g) || []).length

/**
 * Click on the picture to put the selected question's gap there; the
 * next unplaced question is selected after each click.
 */
function GapPlacer({ imageUrl, questions, posById, positions, onChange }) {
  const [active, setActive] = useState(() => questions.find((q) => !positions[q.id])?.id || questions[0]?.id)
  const boxRef = useRef(null)
  const place = (e) => {
    if (!active || !boxRef.current) return
    const r = boxRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(95, ((e.clientX - r.left) / r.width) * 100))
    const y = Math.max(0, Math.min(95, ((e.clientY - r.top) / r.height) * 100))
    const next = { ...positions, [active]: { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } }
    onChange(next)
    const following = questions.find((q) => !next[q.id])
    if (following) setActive(following.id)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-mist">Place gap:</span>
        {questions.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => setActive(q.id)}
            className={`focus-ring rounded-md border px-2 py-0.5 text-xs font-bold ${
              active === q.id ? 'border-brass bg-brass text-onbrass' : positions[q.id] ? 'border-sage/50 text-sage' : 'border-line text-mist'
            }`}
          >
            {posById[q.id]}
          </button>
        ))}
        {active && positions[active] && (
          <button
            type="button"
            onClick={() => {
              const next = { ...positions }
              delete next[active]
              onChange(next)
            }}
            className="focus-ring ml-1 text-xs text-coral underline"
          >
            Remove this gap
          </button>
        )}
      </div>
      <div ref={boxRef} onClick={place} className="relative inline-block max-w-full cursor-crosshair self-start">
        <img src={imageUrl} alt="" className="block w-[640px] max-w-full select-none" draggable={false} />
        {questions
          .filter((q) => positions[q.id])
          .map((q) => (
            <span
              key={q.id}
              className={`pointer-events-none absolute flex h-[27px] w-[110px] items-center justify-center rounded-[5px] border border-dashed bg-white text-sm font-bold text-black ${
                active === q.id ? 'border-[#418ec8] ring-2 ring-[#418ec8]/40' : 'border-[#333]'
              }`}
              style={{ left: `${positions[q.id].x}%`, top: `${positions[q.id].y}%` }}
            >
              {posById[q.id]}
            </span>
          ))}
      </div>
      <p className="text-xs text-mist">Click the picture where the gap's top-left corner should be.</p>
    </div>
  )
}

function guessWordLimit(text) {
  const t = (text || '').toUpperCase()
  if (/THREE WORDS AND\/OR A NUMBER/.test(t)) return 'three_words_and_or_number'
  if (/THREE WORDS/.test(t)) return 'three_words'
  if (/TWO WORDS AND\/OR A NUMBER/.test(t)) return 'two_words_and_or_number'
  if (/TWO WORDS/.test(t)) return 'two_words'
  if (/ONE WORD AND\/OR A NUMBER/.test(t)) return 'one_word_and_or_number'
  if (/ONE WORD/.test(t)) return 'one_word'
  if (/\bA NUMBER\b/.test(t)) return 'number_only'
  return null
}

function guessKind(type, text) {
  const t = (text || '').toLowerCase()
  if (type === 'true_false_ng') return 'tfng'
  if (type === 'yes_no_ng') return 'ynng'
  if (type === 'multiple_choice') return 'mcq_single'
  if (type === 'multi_select') return 'mcq_multi'
  if (type === 'matching') {
    if (/paragraph contains|which paragraph|which section contains/.test(t)) return 'matching_info'
    if (/heading/.test(t)) return 'matching_headings'
    if (/ending/.test(t)) return 'matching_sentence_endings'
    return 'matching_features'
  }
  if (/\bnotes?\b/.test(t)) return 'note_completion'
  if (/\btable\b/.test(t)) return 'table_completion'
  if (/\bform\b/.test(t)) return 'form_completion'
  if (/\bsummary\b/.test(t)) return 'summary_completion'
  if (/flow-?chart/.test(t)) return 'flow_chart'
  if (/\bdiagram\b/.test(t)) return 'diagram_labelling'
  if (/\b(map|plan)\b/.test(t)) return 'map_labelling'
  if (/\bsentences?\b/.test(t)) return 'sentence_completion'
  if (/answer the questions/.test(t)) return 'short_answer'
  return 'other'
}

/** Create groups for these (ungrouped) questions. Returns how many. */
async function createGroupsFor(sectionId, questions) {
  const sorted = [...questions].sort((a, b) => a.order_index - b.order_index)
  const idx = Object.fromEntries(sorted.map((q, i) => [q.id, i + 1]))
  const runs = buildQuestionGroups(sorted, idx)
  let made = 0
  for (const run of runs) {
    const text = `${run.instruction} ${run.title}`
    const kind = guessKind(run.questions[0].type, text)
    const row = {
      section_id: sectionId,
      kind,
      word_limit: GAP_KINDS.has(kind) ? guessWordLimit(text) : null,
      title: run.title || null,
      // Keep the original wording when we couldn't name the task type.
      instruction: kind === 'other' && run.instruction && !guessWordLimit(run.instruction) ? run.instruction : null,
      options_reusable: run.reusable || false,
      order_index: run.from,
    }
    const { data, error: err } = await supabase.from('mock_question_groups').insert(row).select('id').single()
    if (err) throw err
    const { error: e2 } = await supabase
      .from('mock_questions')
      .update({ group_id: data.id })
      .in('id', run.questions.map((q) => q.id))
    if (e2) throw e2
    made += 1
  }
  return made
}

/**
 * Used right after the Listening/Reading wizards save a part: (re)builds
 * that part's groups from its questions. Quietly does nothing before
 * migration_74 is run. `replace` drops the part's old groups first.
 */
export async function autoGroupSection(sectionId, { replace = false } = {}) {
  try {
    if (replace) {
      const { error: delErr } = await supabase.from('mock_question_groups').delete().eq('section_id', sectionId)
      if (delErr) return 0
    }
    const { data, error } = await supabase
      .from('mock_questions')
      .select('id, type, prompt, options, order_index, group_id')
      .eq('section_id', sectionId)
    if (error || !data?.length) return 0
    return await createGroupsFor(sectionId, data.filter((q) => !q.group_id))
  } catch {
    return 0
  }
}

const emptyDraft = (from, to) => ({
  id: null,
  kind: 'note_completion',
  word_limit: 'one_word',
  title: '',
  instruction: '',
  options_reusable: false,
  body: '',
  image_url: '',
  gap_positions: {},
  from,
  to,
})

export default function QuestionGroupsPanel({ exam, section, questions, onChanged }) {
  const [groups, setGroups] = useState([])
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null)
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)

  const uploadImage = async (file) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const path = `mock-groups/${section.id}/${Date.now()}-${safeFileName(file.name)}`
      const { error: upErr } = await supabase.storage
        .from('homework-files')
        .upload(path, file, { contentType: guessMimeType(file.name, file.type) })
      if (upErr) throw upErr
      const url = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
      setDraft((d) => (d ? { ...d, image_url: url } : d))
    } catch (err) {
      setError(err?.message || 'Could not upload the picture.')
    } finally {
      setUploading(false)
    }
  }

  const sorted = useMemo(() => [...questions].sort((a, b) => a.order_index - b.order_index), [questions])
  const posById = useMemo(() => Object.fromEntries(sorted.map((q, i) => [q.id, i + 1])), [sorted])

  const load = useCallback(async () => {
    if (!section?.id) return
    setLoading(true)
    const { data, error: err } = await supabase
      .from('mock_question_groups')
      .select('*')
      .eq('section_id', section.id)
      .order('order_index')
    if (err) {
      if (MISSING_TABLE.test(`${err.code} ${err.message}`)) setMissing(true)
      else setError(err.message)
      setGroups([])
    } else {
      setMissing(false)
      setGroups(data || [])
    }
    setLoading(false)
  }, [section?.id])

  useEffect(() => {
    load()
  }, [load])

  const rangeOf = (g) => {
    const pos = sorted.filter((q) => q.group_id === g.id).map((q) => posById[q.id])
    if (!pos.length) return null
    return { from: Math.min(...pos), to: Math.max(...pos), count: pos.length }
  }

  const ungrouped = sorted.filter((q) => !q.group_id || !groups.some((g) => g.id === q.group_id))

  const assign = async (groupId, from, to) => {
    const inRange = sorted.filter((q) => posById[q.id] >= from && posById[q.id] <= to).map((q) => q.id)
    const leaving = sorted.filter((q) => q.group_id === groupId && !inRange.includes(q.id)).map((q) => q.id)
    if (leaving.length) {
      const { error: e1 } = await supabase.from('mock_questions').update({ group_id: null }).in('id', leaving)
      if (e1) throw e1
    }
    if (inRange.length) {
      const { error: e2 } = await supabase.from('mock_questions').update({ group_id: groupId }).in('id', inRange)
      if (e2) throw e2
    }
  }

  const saveDraft = async () => {
    if (!draft) return
    const from = Number(draft.from)
    const to = Number(draft.to)
    if (!from || !to || to < from) {
      setError('Choose the first and last question of the group.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const row = {
        section_id: section.id,
        kind: draft.kind,
        word_limit: GAP_KINDS.has(draft.kind) ? draft.word_limit || null : null,
        title: draft.title.trim() || null,
        instruction: draft.instruction.trim() || null,
        options_reusable: MATCH_KINDS.has(draft.kind) ? Boolean(draft.options_reusable) : false,
        order_index: from,
      }
      // Only send the migration_80 columns when something is in them, so
      // saving still works before that migration is run.
      const hasLayout = (draft.body || '').trim() || draft.image_url || Object.keys(draft.gap_positions || {}).length
      if (hasLayout || draft.hadLayout) {
        row.body = (draft.body || '').trim() || null
        row.image_url = IMAGE_KINDS.has(draft.kind) ? draft.image_url || null : null
        row.gap_positions = IMAGE_KINDS.has(draft.kind) ? draft.gap_positions || {} : {}
      }
      let id = draft.id
      if (id) {
        const { error: err } = await supabase.from('mock_question_groups').update(row).eq('id', id)
        if (err) throw err
      } else {
        const { data, error: err } = await supabase.from('mock_question_groups').insert(row).select('id').single()
        if (err) throw err
        id = data.id
      }
      await assign(id, from, to)
      setDraft(null)
      setMessage('Group saved.')
      await load()
      await onChanged?.()
    } catch (err) {
      setError(
        MISSING_LAYOUT_COLS.test(`${err?.code} ${err?.message}`)
          ? 'The layout text and picture need migration_80_group_layouts.sql to be run in the Supabase SQL Editor first.'
          : err?.message || 'Could not save the group.'
      )
    } finally {
      setBusy(false)
    }
  }

  const removeGroup = async (g) => {
    setBusy(true)
    setError('')
    try {
      const { error: err } = await supabase.from('mock_question_groups').delete().eq('id', g.id)
      if (err) throw err
      setMessage('Group removed — its questions are still there.')
      await load()
      await onChanged?.()
    } catch (err) {
      setError(err?.message || 'Could not remove the group.')
    } finally {
      setBusy(false)
    }
  }

  const autoSetup = async () => {
    setBusy(true)
    setError('')
    try {
      const made = await createGroupsFor(section.id, ungrouped)
      setMessage(`${made} group${made === 1 ? '' : 's'} set up. Check each one below.`)
      await load()
      await onChanged?.()
    } catch (err) {
      setError(err?.message || 'Could not set up the groups.')
    } finally {
      setBusy(false)
    }
  }

  const regrade = async () => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { data, error: err } = await supabase.rpc('regrade_mock_exam', { p_exam_id: exam.id })
      if (err) throw err
      const changed = data || []
      // Released results: move the band with the new score.
      for (const row of changed.filter((r) => r.released)) {
        const band = estimateBandFromPercent(row.max_score ? (row.new_score / row.max_score) * 100 : 0)
        await supabase.from('mock_attempts').update({ band }).eq('id', row.attempt_id)
      }
      setMessage(
        changed.length
          ? `Re-marked. ${changed.length} test${changed.length === 1 ? '' : 's'} got a new score${
              changed.some((r) => r.released) ? ' (released bands updated too)' : ''
            }.`
          : 'Re-marked. No scores changed.'
      )
    } catch (err) {
      setError(
        /regrade_mock_exam|PGRST202|42883/.test(`${err?.code} ${err?.message}`)
          ? 'Re-marking needs migration_74 to be run in the SQL Editor first.'
          : err?.message || 'Could not re-mark.'
      )
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (g) => {
    const r = rangeOf(g) || { from: 1, to: 1 }
    setDraft({
      id: g.id,
      kind: g.kind,
      word_limit: g.word_limit || 'one_word',
      title: g.title || '',
      instruction: g.instruction || '',
      options_reusable: g.options_reusable,
      body: g.body || '',
      image_url: g.image_url || '',
      gap_positions: g.gap_positions || {},
      hadLayout: Boolean(g.body || g.image_url || Object.keys(g.gap_positions || {}).length),
      from: r.from,
      to: r.to,
    })
  }

  const previewQuestions = draft
    ? sorted.filter((q) => posById[q.id] >= Number(draft.from) && posById[q.id] <= Number(draft.to))
    : []
  const preview = draft
    ? generateInstruction(
        {
          ...draft,
          word_limit: GAP_KINDS.has(draft.kind) ? draft.word_limit : null,
          options_reusable: MATCH_KINDS.has(draft.kind) && draft.options_reusable,
        },
        { module: exam?.module, questions: previewQuestions }
      )
    : ''

  const field = 'focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper'
  const label = 'text-xs font-medium text-mist'

  return (
    <div className="rounded-2xl border border-line bg-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span>
          <span className="block text-sm font-semibold text-paper">Question groups & marking</span>
          <span className="block text-xs text-mist">
            {missing
              ? 'Not switched on yet'
              : loading
                ? 'Loading…'
                : groups.length
                  ? `${groups.length} group${groups.length === 1 ? '' : 's'}${ungrouped.length ? ` · ${ungrouped.length} question${ungrouped.length === 1 ? '' : 's'} not in a group` : ''}`
                  : 'No groups yet — the exam guesses them from the prompts'}
          </span>
        </span>
        <span className={`text-mist transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
          ⌄
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-4 py-4">
          {missing ? (
            <p className="text-sm text-paper-dim">
              Groups are switched on by running <code className="rounded bg-panel-2 px-1">migration_74_question_groups.sql</code>{' '}
              in the Supabase SQL Editor. Until then the exam keeps guessing the groups from the prompts.
            </p>
          ) : (
            <>
              <p className="text-xs text-mist">
                Each group prints "Questions X–Y" and its instruction once. The word limit is also used
                when marking: an answer longer than the limit is wrong, like in the real test. Numbers
                below count from the first question of this part.
              </p>

              {groups.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {groups.map((g) => {
                    const r = rangeOf(g)
                    const kind = GROUP_KINDS.find((k) => k.value === g.kind)
                    const qs = sorted.filter((q) => q.group_id === g.id)
                    return (
                      <li key={g.id} className="rounded-xl border border-line bg-panel-2 px-3 py-2.5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-paper">
                              {r ? `Questions ${r.from}${r.to !== r.from ? `–${r.to}` : ''}` : 'No questions'} ·{' '}
                              <span className="font-normal">{kind?.label || g.kind}</span>
                              {g.options_reusable && <span className="ml-1 text-xs text-mist">(letters reusable)</span>}
                            </p>
                            {g.title && <p className="text-xs font-medium text-paper-dim">{g.title}</p>}
                            <p className="mt-0.5 text-xs text-mist">
                              {generateInstruction(g, { module: exam?.module, questions: qs }) || 'No instruction'}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEdit(g)}
                              disabled={busy}
                              className="focus-ring rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-mist hover:border-brass/50 hover:text-brass"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => removeGroup(g)}
                              disabled={busy}
                              className="focus-ring rounded-full border border-coral/30 px-2.5 py-1 text-xs font-semibold text-coral hover:bg-coral/10"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}

              {draft ? (
                <div className="rounded-xl border border-brass/40 bg-brass/5 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={label}>
                      Task type
                      <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className={field}>
                        {GROUP_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {GAP_KINDS.has(draft.kind) ? (
                      <label className={label}>
                        Word limit
                        <select
                          value={draft.word_limit || ''}
                          onChange={(e) => setDraft({ ...draft, word_limit: e.target.value || null })}
                          className={field}
                        >
                          <option value="">No limit</option>
                          {WORD_LIMITS.map((w) => (
                            <option key={w.value} value={w.value}>
                              {w.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : MATCH_KINDS.has(draft.kind) ? (
                      <label className="flex items-center gap-2 self-end pb-2 text-sm text-paper">
                        <input
                          type="checkbox"
                          checked={draft.options_reusable}
                          onChange={(e) => setDraft({ ...draft, options_reusable: e.target.checked })}
                          className="accent-brass"
                        />
                        Letters can be used more than once
                      </label>
                    ) : (
                      <span />
                    )}
                    <label className={label}>
                      First question
                      <select value={draft.from} onChange={(e) => setDraft({ ...draft, from: Number(e.target.value) })} className={field}>
                        {sorted.map((q) => (
                          <option key={q.id} value={posById[q.id]}>
                            {posById[q.id]}. {(q.prompt || '').slice(0, 50)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={label}>
                      Last question
                      <select value={draft.to} onChange={(e) => setDraft({ ...draft, to: Number(e.target.value) })} className={field}>
                        {sorted.map((q) => (
                          <option key={q.id} value={posById[q.id]}>
                            {posById[q.id]}. {(q.prompt || '').slice(0, 50)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={`${label} sm:col-span-2`}>
                      Title (optional, e.g. "Hotel booking form")
                      <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={field} />
                    </label>
                    <label className={`${label} sm:col-span-2`}>
                      Own instruction (optional — replaces the one below)
                      <textarea
                        value={draft.instruction}
                        onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
                        rows={2}
                        className={`${field} resize-none`}
                      />
                    </label>
                    {IMAGE_KINDS.has(draft.kind) && (
                      <div className="sm:col-span-2">
                        <p className={label}>Picture (map, plan or diagram)</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <label className="focus-ring cursor-pointer rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-paper hover:border-brass/50">
                            {uploading ? 'Uploading…' : draft.image_url ? 'Change picture' : 'Upload picture'}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={uploading}
                              onChange={(e) => {
                                uploadImage(e.target.files?.[0])
                                e.target.value = ''
                              }}
                            />
                          </label>
                          {draft.image_url && (
                            <button
                              type="button"
                              onClick={() => setDraft({ ...draft, image_url: '', gap_positions: {} })}
                              className="focus-ring text-xs text-coral underline"
                            >
                              Remove picture
                            </button>
                          )}
                        </div>
                        {draft.image_url && previewQuestions.length > 0 && (
                          <div className="mt-2">
                            <GapPlacer
                              key={draft.image_url}
                              imageUrl={draft.image_url}
                              questions={previewQuestions}
                              posById={posById}
                              positions={draft.gap_positions || {}}
                              onChange={(gap_positions) => setDraft((d) => ({ ...d, gap_positions }))}
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {(BODY_KINDS.has(draft.kind) || GAP_KINDS.has(draft.kind)) && !IMAGE_KINDS.has(draft.kind) && (
                      <label className={`${label} sm:col-span-2`}>
                        Layout text (optional — the notes, form or table exactly as printed; put [[ ]] where each gap goes)
                        <textarea
                          value={draft.body || ''}
                          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                          rows={7}
                          placeholder={'# Phone call about second-hand furniture\n## Items:\n- Dining table: [[ ]] shape\n- medium size\n- price: £25.00\n\n| | Social factors | Other factors |\n|---|---|---|\n| First level | Effective support | Enjoyment of a [[ ]] |'}
                          className={`${field} resize-y font-mono text-xs leading-5`}
                        />
                        <span className="mt-1 block text-[11px] text-mist">
                          # title · ## heading · - bullet · | table | row | (a |---| line under a row makes it the header) · **bold**.
                          {(draft.body || '').trim() && (
                            <>
                              {' '}
                              <b className={countGaps(draft.body) === previewQuestions.length ? 'text-sage' : 'text-coral'}>
                                {countGaps(draft.body)} gap{countGaps(draft.body) === 1 ? '' : 's'} for {previewQuestions.length} question
                                {previewQuestions.length === 1 ? '' : 's'}
                              </b>
                            </>
                          )}
                        </span>
                      </label>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-mist">Students will see:</p>
                  <p className="mt-1 rounded-lg border border-line bg-white px-3 py-2 text-sm text-[#1a1a1a]">
                    <b>
                      Questions {draft.from}
                      {Number(draft.to) !== Number(draft.from) ? `–${draft.to}` : ''}
                    </b>
                    <br />
                    {preview || <i className="text-[#777]">no instruction</i>}
                    {draft.title && (
                      <>
                        <br />
                        <b>{draft.title}</b>
                      </>
                    )}
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft(null)}
                      disabled={busy}
                      className="focus-ring rounded-md border border-line px-3 py-1.5 text-sm text-mist hover:text-paper"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveDraft}
                      disabled={busy}
                      className="focus-ring rounded-full bg-brass px-4 py-1.5 text-sm font-semibold text-onbrass hover:bg-brass-dim disabled:opacity-50"
                    >
                      {busy ? 'Saving…' : 'Save group'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {ungrouped.length > 0 && (
                    <button
                      type="button"
                      onClick={autoSetup}
                      disabled={busy}
                      className="focus-ring rounded-full bg-brass px-4 py-1.5 text-sm font-semibold text-onbrass hover:bg-brass-dim disabled:opacity-50"
                    >
                      {busy ? 'Working…' : groups.length ? 'Group the rest automatically' : 'Set up groups automatically'}
                    </button>
                  )}
                  {sorted.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const first = ungrouped[0] ? posById[ungrouped[0].id] : 1
                        setDraft(emptyDraft(first, first))
                      }}
                      disabled={busy}
                      className="focus-ring rounded-full border border-line px-4 py-1.5 text-sm font-semibold text-paper hover:border-brass/50"
                    >
                      + New group
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="text-xs text-mist">
              Fixed an answer key after students sat this test? Re-mark every submitted attempt.
            </p>
            <button
              type="button"
              onClick={regrade}
              disabled={busy || !exam?.id}
              className="focus-ring rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-paper hover:border-brass/50 disabled:opacity-50"
            >
              Re-mark submitted tests
            </button>
          </div>

          {message && <p className="text-xs text-sage">{message}</p>}
          {error && <p className="text-xs text-coral">{error}</p>}
        </div>
      )}
    </div>
  )
}
