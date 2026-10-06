/*
 * QUESTION GROUPS (2026-10-06) — "Questions 1–7 / Complete the notes.
 * Choose ONE WORD ONLY from the passage for each answer." shown ONCE.
 *
 * Our data is one row per question (mock_questions), with no group
 * row. When a test is imported, the group's title and instruction have
 * nowhere to go, so they get pasted into every question's prompt, e.g.
 *   "Pest control — Early 20th-century problems in Australia: The
 *    larvae of a type of ______ were a serious pest … Choose ONE WORD
 *    ONLY from the passage."
 * Students saw that in all seven questions (Mock #1 complaint).
 *
 * Until question groups get their own table (plan Phase 1), the exam
 * screen rebuilds the groups from consecutive questions:
 *   - a trailing instruction ("Choose/Write … ONE WORD …") is cut off
 *     and shown once in the group header;
 *   - a leading "Title — Subheading:" is cut off; the title goes in the
 *     header, the subheading is printed once above its questions;
 *   - a stem shared by every question in a run ("Which paragraph
 *     contains the following information?") goes in the header;
 *   - a question number typed into the prompt ("27. …") is removed,
 *     since the gap or the list already shows the number.
 * This is display only — prompts in the database are unchanged and
 * grading never looks at them.
 */

const INSTRUCTION_RE =
  /\s*((?:Choose|Write|Use|Answer)\b[^.]*?\b(?:ONE|TWO|THREE|FOUR|NO MORE THAN|A NUMBER|NUMBER)\b[^.]*\.?)\s*$/

const TITLE_RE = /^([^:?]{2,90}?)\s+[—–-]\s+([^:?]{2,120}?):\s+/

const NUMBER_WORDS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']

function stripBakedNumber(text, index) {
  return text.replace(new RegExp(`^\\s*${index}\\s*[.)]\\s+`), '')
}

/** Longest prefix shared by every string, cut back to a sentence end. */
function sharedStem(prompts) {
  if (prompts.length < 2) return ''
  let prefix = prompts[0]
  for (const p of prompts.slice(1)) {
    let i = 0
    while (i < prefix.length && i < p.length && prefix[i] === p[i]) i++
    prefix = prefix.slice(0, i)
    if (!prefix) return ''
  }
  // Only a complete sentence counts as a stem ("…information? ").
  const m = /^(.*[?:.])\s+/.exec(prefix)
  if (!m || m[1].length < 12) return ''
  // Never swallow a whole prompt — every question must keep its own text.
  if (prompts.some((p) => p.slice(m[0].length).trim() === '')) return ''
  return m[1]
}

function familyOf(q) {
  if (q.type === 'matching') return `matching:${JSON.stringify(q.options?.choices || [])}`
  return q.type
}

function defaultInstruction(family, questions) {
  const type = questions[0].type
  const n = questions.length
  switch (type) {
    case 'true_false_ng':
      return 'Do the following statements agree with the information given in the text? Choose TRUE if the statement agrees with the information, FALSE if the statement contradicts the information, NOT GIVEN if there is no information on this.'
    case 'yes_no_ng':
      return 'Do the following statements agree with the claims of the writer? Choose YES if the statement agrees with the claims of the writer, NO if the statement contradicts the claims of the writer, NOT GIVEN if it is impossible to say what the writer thinks about this.'
    case 'multiple_choice':
      return 'Choose the correct answer.'
    case 'multi_select':
      return 'Choose the correct answers.'
    case 'matching': {
      const word = NUMBER_WORDS[n] || String(n)
      return `Choose ${word} answer${n === 1 ? '' : 's'} from the box and move ${n === 1 ? 'it' : 'them'} into the gap${n === 1 ? '' : 's'}.`
    }
    default:
      return ''
  }
}

/* ------------------------------------------------------------------
 * Stored groups (migration_74, 2026-10-06): mock_question_groups holds
 * each "Questions X–Y" block once — task type (kind), word limit, title
 * and an optional custom instruction. When a question has a group_id,
 * that group decides the header; otherwise the guesswork above is used
 * (older tests, or before the migration is run).
 * ------------------------------------------------------------------ */

export const GROUP_KINDS = [
  { value: 'note_completion', label: 'Note completion', family: 'gap', text: 'Complete the notes below.' },
  { value: 'form_completion', label: 'Form completion', family: 'gap', text: 'Complete the form below.' },
  { value: 'table_completion', label: 'Table completion', family: 'gap', text: 'Complete the table below.' },
  { value: 'sentence_completion', label: 'Sentence completion', family: 'gap', text: 'Complete the sentences below.' },
  { value: 'summary_completion', label: 'Summary completion', family: 'gap', text: 'Complete the summary below.' },
  { value: 'flow_chart', label: 'Flow-chart completion', family: 'gap', text: 'Complete the flow-chart below.' },
  { value: 'diagram_labelling', label: 'Diagram labelling', family: 'gap', text: 'Label the diagram below.' },
  { value: 'map_labelling', label: 'Map / plan labelling', family: 'gap', text: 'Label the map below.' },
  { value: 'short_answer', label: 'Short answer', family: 'gap', text: 'Answer the questions below.' },
  { value: 'mcq_single', label: 'Multiple choice (one answer)', family: 'choice', text: 'Choose the correct letter, A, B, C or D.' },
  { value: 'mcq_multi', label: 'Multiple choice (several answers)', family: 'choice', text: 'Choose the correct letters.' },
  { value: 'tfng', label: 'True / False / Not Given', family: 'choice', text: '' },
  { value: 'ynng', label: 'Yes / No / Not Given', family: 'choice', text: '' },
  { value: 'matching_headings', label: 'Matching headings', family: 'match', text: 'Choose the correct heading for each paragraph from the list of headings below.' },
  { value: 'matching_info', label: 'Matching information', family: 'match', text: 'Which paragraph contains the following information?' },
  { value: 'matching_features', label: 'Matching features', family: 'match', text: 'Match each statement with the correct option from the box.' },
  { value: 'matching_sentence_endings', label: 'Matching sentence endings', family: 'match', text: 'Complete each sentence with the correct ending from the box.' },
  { value: 'other', label: 'Other', family: 'other', text: '' },
]

export const WORD_LIMITS = [
  { value: 'one_word', label: 'One word only', words: 'ONE WORD ONLY' },
  { value: 'one_word_and_or_number', label: 'One word and/or a number', words: 'ONE WORD AND/OR A NUMBER' },
  { value: 'two_words', label: 'No more than two words', words: 'NO MORE THAN TWO WORDS' },
  { value: 'two_words_and_or_number', label: 'No more than two words and/or a number', words: 'NO MORE THAN TWO WORDS AND/OR A NUMBER' },
  { value: 'three_words', label: 'No more than three words', words: 'NO MORE THAN THREE WORDS' },
  { value: 'three_words_and_or_number', label: 'No more than three words and/or a number', words: 'NO MORE THAN THREE WORDS AND/OR A NUMBER' },
  { value: 'number_only', label: 'A number only', words: 'A NUMBER' },
]

const KIND_BY_VALUE = Object.fromEntries(GROUP_KINDS.map((k) => [k.value, k]))
const LIMIT_BY_VALUE = Object.fromEntries(WORD_LIMITS.map((w) => [w.value, w]))

/** The instruction the real test prints, built from the group's settings. */
export function generateInstruction(group, { module, questions = [] } = {}) {
  if (!group) return ''
  if (group.instruction && group.instruction.trim()) return group.instruction.trim()
  const kind = KIND_BY_VALUE[group.kind]
  const parts = []
  if (group.kind === 'tfng' || group.kind === 'ynng') {
    return defaultInstruction(null, [{ type: group.kind === 'tfng' ? 'true_false_ng' : 'yes_no_ng' }])
  }
  if (group.kind === 'mcq_single' || group.kind === 'mcq_multi') {
    const letters = (questions[0]?.options?.choices || []).map((_, i) => String.fromCharCode(65 + i))
    if (group.kind === 'mcq_multi') {
      const n = questions.length
      parts.push(`Choose ${NUMBER_WORDS[n] || n} letters${letters.length ? `, ${letters[0]}–${letters[letters.length - 1]}` : ''}.`)
    } else {
      parts.push(letters.length > 1 ? `Choose the correct letter, ${letters.slice(0, -1).join(', ')} or ${letters[letters.length - 1]}.` : 'Choose the correct answer.')
    }
    return parts.join(' ')
  }
  if (kind?.text) parts.push(kind.text)
  const limit = LIMIT_BY_VALUE[group.word_limit]
  if (limit) {
    parts.push(
      module === 'reading'
        ? `Choose ${limit.words} from the passage for each answer.`
        : `Write ${limit.words} for each answer.`
    )
  }
  if (kind?.family === 'match') {
    const n = questions.length
    if (group.kind !== 'matching_info' && n) {
      parts.push(`Choose ${NUMBER_WORDS[n] || n} answer${n === 1 ? '' : 's'} from the box.`)
    }
    if (group.options_reusable) parts.push('You may use any letter more than once.')
  }
  return parts.join(' ')
}

/** Groups for these sections, or [] when the table isn't there yet. */
export async function loadQuestionGroups(supabase, sectionIds) {
  if (!sectionIds?.length) return []
  try {
    const { data, error } = await supabase.rpc('get_mock_question_groups', { p_section_ids: sectionIds })
    if (error) return []
    return data || []
  } catch {
    return []
  }
}

/**
 * Split a section's questions into display groups.
 * Returns [{ key, questions, from, to, title, instruction, family,
 *            prompts: {id: cleanedPrompt}, subheadings: {id: text} }]
 */
export function buildQuestionGroups(questions, questionIndexById, { groups = [], module } = {}) {
  const groupById = Object.fromEntries((groups || []).map((g) => [g.id, g]))
  const rows = questions.map((q) => {
    let text = (q.prompt || '').trim()
    let instruction = ''
    const ins = INSTRUCTION_RE.exec(text)
    if (ins && ins.index > 0) {
      instruction = ins[1].trim()
      text = text.slice(0, ins.index).trim()
    }
    let title = ''
    let subheading = ''
    const t = TITLE_RE.exec(text)
    if (t) {
      title = t[1].trim()
      subheading = t[2].trim()
      text = text.slice(t[0].length).trim()
    }
    text = stripBakedNumber(text, questionIndexById[q.id])
    const stored = q.group_id ? groupById[q.group_id] : null
    return { q, text, instruction, title, subheading, family: familyOf(q), stored }
  })

  // Runs: same family, same title, and the same instruction (an
  // instruction that is missing on one row doesn't split the run).
  const runs = []
  for (const row of rows) {
    const last = runs[runs.length - 1]
    // A stored group keeps its questions together, whatever the text says.
    if (row.stored || last?.stored) {
      if (last && last.stored && row.stored && last.stored.id === row.stored.id) {
        last.rows.push(row)
      } else {
        runs.push({ family: row.family, title: row.title, instruction: row.instruction, rows: [row], stored: row.stored })
      }
      continue
    }
    const fits =
      last &&
      last.family === row.family &&
      last.title === row.title &&
      (!row.instruction || !last.instruction || row.instruction === last.instruction)
    if (fits) {
      last.rows.push(row)
      if (!last.instruction) last.instruction = row.instruction
    } else {
      runs.push({ family: row.family, title: row.title, instruction: row.instruction, rows: [row] })
    }
  }

  return runs.map((run) => {
    const qs = run.rows.map((r) => r.q)
    let texts = run.rows.map((r) => r.text)
    const stem = sharedStem(texts)
    if (stem) texts = texts.map((t, i) => stripBakedNumber(t.slice(stem.length).trim(), questionIndexById[qs[i].id]))

    const prompts = {}
    const subheadings = {}
    let lastSub = ''
    run.rows.forEach((r, i) => {
      prompts[r.q.id] = texts[i]
      if (r.subheading && r.subheading !== lastSub) subheadings[r.q.id] = r.subheading
      lastSub = r.subheading || lastSub
    })

    if (run.stored) {
      const g = run.stored
      const generated = generateInstruction(g, { module, questions: qs })
      const isInfo = g.kind === 'matching_info'
      return {
        key: g.id,
        questions: qs,
        family: run.family,
        from: questionIndexById[qs[0].id],
        to: questionIndexById[qs[qs.length - 1].id],
        title: g.title || run.title,
        // The stored instruction already says what a shared stem would
        // ("Which paragraph contains…"), so don't print it twice.
        instruction: [isInfo && !g.instruction ? '' : stem, generated].filter(Boolean).join(' '),
        prompts,
        subheadings,
        reusable: Boolean(g.options_reusable),
        kind: g.kind,
        wordLimit: g.word_limit || null,
      }
    }

    const instructionParts = [stem, run.instruction || defaultInstruction(run.family, qs)].filter(Boolean)
    const allText = instructionParts.join(' ')
    return {
      key: qs[0].id,
      questions: qs,
      family: run.family,
      from: questionIndexById[qs[0].id],
      to: questionIndexById[qs[qs.length - 1].id],
      title: run.title,
      instruction: allText,
      prompts,
      subheadings,
      reusable: /any letter more than once|any (?:option|answer) more than once/i.test(allText),
    }
  })
}

/** Same clean-up for a single prompt shown on its own (results pages). */
export function cleanPrompt(prompt, index) {
  let text = (prompt || '').trim()
  const ins = INSTRUCTION_RE.exec(text)
  if (ins && ins.index > 0) text = text.slice(0, ins.index).trim()
  const t = TITLE_RE.exec(text)
  if (t) text = text.slice(t[0].length).trim()
  return index ? stripBakedNumber(text, index) : text
}
