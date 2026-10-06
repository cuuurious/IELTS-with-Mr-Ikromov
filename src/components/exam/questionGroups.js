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

/**
 * Split a section's questions into display groups.
 * Returns [{ key, questions, from, to, title, instruction, family,
 *            prompts: {id: cleanedPrompt}, subheadings: {id: text} }]
 */
export function buildQuestionGroups(questions, questionIndexById) {
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
    return { q, text, instruction, title, subheading, family: familyOf(q) }
  })

  // Runs: same family, same title, and the same instruction (an
  // instruction that is missing on one row doesn't split the run).
  const runs = []
  for (const row of rows) {
    const last = runs[runs.length - 1]
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

    const instructionParts = [stem, run.instruction || defaultInstruction(run.family, qs)].filter(Boolean)
    return {
      key: qs[0].id,
      questions: qs,
      family: run.family,
      from: questionIndexById[qs[0].id],
      to: questionIndexById[qs[qs.length - 1].id],
      title: run.title,
      instruction: instructionParts.join(' '),
      prompts,
      subheadings,
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
