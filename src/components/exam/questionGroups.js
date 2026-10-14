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

// Matching prompts that repeat the task in every question (2026-10-14,
// "doesnt look like real exam"): "Which paragraph contains a mention of
// X" ×5 or "Match Ian Hunter with the correct idea." ×4. The real test
// says the task once and lists only the varying part — "14 a mention of
// X", "23 Ian Hunter" — with the options under a "List of Ideas" title.
const letterRange = (choices) => {
  const letters = choices.map((c) => /^\s*([A-Z])\b/.exec(c)?.[1]).filter(Boolean)
  return letters.length === choices.length && letters.length > 1 ? `${letters[0]}–${letters[letters.length - 1]}` : ''
}
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t)
function tidyMatching(texts, questions) {
  if (questions[0]?.type !== 'matching' || texts.length === 0) return null
  const choices = questions[0].options?.choices || []
  const range = letterRange(choices)
  const para = texts.map((t) => /^which (paragraph|section)\s+(?:contains|mentions)\s+(.+)$/i.exec(t))
  if (para.every(Boolean)) {
    const unit = para[0][1].toLowerCase()
    return {
      texts: para.map((m) => cap(m[2].replace(/\?\s*$/, ''))),
      lead: `Which ${unit} contains the following information?${range ? ` Choose the correct letter, ${range}.` : ''}`,
      reusable: true,
    }
  }
  // "What information is given about the Chamber Museum?" ×5 → the real
  // test's "What information is given about each of the following?"
  // once, then just "The Chamber Museum", "Harris Park"… beside the gaps.
  if (texts.length > 1 && !texts.some((t) => /_{2,}/.test(t))) {
    const words = texts.map((t) => t.split(/\s+/))
    let n = 0
    while (words.every((w) => w[n] !== undefined && w[n].toLowerCase() === words[0][n].toLowerCase())) n++
    const rests = words.map((w) => w.slice(n).join(' ').replace(/[?:.]\s*$/, '').trim())
    if (n >= 3 && rests.every((r) => r && r.split(/\s+/).length <= 8)) {
      const stem = words[0].slice(0, n).join(' ')
      return {
        texts: rests.map(cap),
        lead: `${stem} each of the following? Choose the correct answer and move it into the gap.`,
      }
    }
  }
  const match = texts.map((t) => /^match\s+(.+?)\s+with\s+the\s+correct\s+([a-z ]+?)\.?$/i.exec(t))
  if (match.every(Boolean) && match.every((m) => m[2].toLowerCase() === match[0][2].toLowerCase())) {
    const noun = match[0][2].toLowerCase()
    const names = match.map((m) => m[1])
    const people = names.every((n) => /^[A-Z][\w'’.-]*(\s+[A-Z][\w'’.-]*)+$/.test(n))
    const item = people ? 'person' : 'statement'
    return {
      texts: names,
      lead: `Look at the following ${people ? 'people' : 'statements'} and the list of ${noun}s below. Match each ${item} with the correct ${noun}${range ? `, ${range}` : ''}.`,
      bankTitle: `List of ${cap(noun)}s`,
    }
  }
  return null
}

// How a group of gaps is laid out (2026-10-14, from the official demos):
//   notes     — bold title, bulleted lines, gaps inside the lines
//   sentences — one sentence per line, gaps inside
//   summary   — one paragraph, gaps inside
//   table     — bordered table (label | text)
//   flow      — boxes joined by ↓ arrows
const LAYOUT_BY_KIND = {
  note_completion: 'notes',
  form_completion: 'notes',
  table_completion: 'table',
  sentence_completion: 'sentences',
  summary_completion: 'summary',
  flow_chart: 'flow',
  diagram_labelling: 'sentences',
  map_labelling: 'sentences',
  short_answer: 'questions',
}
function layoutFor({ kind, text, questions, module, hasTitle }) {
  if (kind && LAYOUT_BY_KIND[kind]) return LAYOUT_BY_KIND[kind]
  const t = text || ''
  if (/flow-?\s?chart/i.test(t)) return 'flow'
  if (/\btable\b/i.test(t)) return 'table'
  if (/\bsummary\b/i.test(t)) return 'summary'
  if (/\b(notes|form)\b/i.test(t)) return 'notes'
  if (/\bsentences?\b/i.test(t)) return 'sentences'
  const blanks = questions.every((q) => /_{2,}/.test(q.prompt || ''))
  if (!blanks) return questions[0].type === 'short_answer' ? 'questions' : null
  if (hasTitle || module === 'listening') return 'notes'
  return 'sentences'
}
const LAYOUT_LEAD = {
  notes: 'Complete the notes.',
  sentences: 'Complete the sentences.',
  summary: 'Complete the summary.',
  table: 'Complete the table.',
  flow: 'Complete the flow-chart.',
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
    case 'multi_select': {
      const m = /\b(TWO|THREE|FOUR)\b/.exec(questions.map((q) => q.prompt || '').join(' '))
      return m ? `Choose ${m[1]} correct answers.` : 'Choose the correct answers.'
    }
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
  // A gap task answered by dragging (map with a list of places, flow-chart
  // with a word bank) — the official wording, no word limit.
  if (kind?.family === 'gap' && questions[0]?.type === 'matching') {
    parts.push('Choose the correct answer and move it into the gap.')
    return parts.join(' ')
  }
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
    if (group.options_reusable || group.kind === 'matching_info') parts.push('NB You may use any letter more than once.')
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

    // A shared "Which paragraph contains the following information?" stem
    // still gets the official wording, the A–H range and reusable letters.
    const paraStem = stem && qs[0]?.type === 'matching' && /which (paragraph|section)/i.test(stem)
    const tidy = paraStem
      ? (() => {
          const range = letterRange(qs[0].options?.choices || [])
          const unit = /section/i.test(stem) ? 'section' : 'paragraph'
          return {
            texts,
            lead: `Which ${unit} contains the following information?${range ? ` Choose the correct letter, ${range}.` : ''}`,
            reusable: true,
          }
        })()
      : stem
        ? null
        : tidyMatching(texts, qs)
    if (tidy) texts = tidy.texts

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
        reusable: Boolean(g.options_reusable) || Boolean(tidy?.reusable),
        bankTitle: tidy?.bankTitle || '',
        kind: g.kind,
        layout: layoutFor({ kind: g.kind, text: g.instruction || '', questions: qs, module, hasTitle: Boolean(g.title || run.title) }),
        // migration_80: the notes/table text around the gaps, and a
        // map/diagram picture with each gap's position on it.
        body: g.body || '',
        imageUrl: g.image_url || '',
        gapPositions: g.gap_positions || {},
        wordLimit: g.word_limit || null,
      }
    }

    const instructionParts = tidy
      ? [tidy.lead, run.instruction && !/move (it|them) into the gap/i.test(run.instruction) ? run.instruction : '']
      : [stem, run.instruction || defaultInstruction(run.family, qs)]
    let allText = instructionParts.filter(Boolean).join(' ')
    if (tidy?.reusable && !/more than once/i.test(allText)) allText += ' NB You may use any letter more than once.'
    const hasSubheadings = run.rows.some((r) => r.subheading)
    const layout = layoutFor({ kind: null, text: allText, questions: qs, module, hasTitle: Boolean(run.title) || hasSubheadings })
    // The real header always says what to do first: "Complete the notes.
    // Write ONE WORD ONLY…" — add that first sentence when it's missing.
    if (LAYOUT_LEAD[layout] && !/^\s*(complete|label|choose the correct|look at)/i.test(allText)) {
      allText = /move (it|them) into the gaps?/i.test(allText)
        ? `${LAYOUT_LEAD[layout].replace(/\.$/, '')}. Choose the correct answer and move it into the gap.`
        : `${LAYOUT_LEAD[layout]} ${allText}`.trim()
    }
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
      bankTitle: tidy?.bankTitle || '',
      layout,
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
