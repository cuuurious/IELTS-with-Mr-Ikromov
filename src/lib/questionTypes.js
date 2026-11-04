import { GROUP_KINDS } from '../components/exam/questionGroups'

/*
 * Question types shared by the Books shelf, homework tasks and the
 * weak-spot report (migration_89, 2026-11-02). The keys are the question
 * group kinds from the exam builder, so mock answers, homework tests and
 * book pages all land in the same bucket.
 */

const EXTRA = {
  // Listen with Mr.Ikromov books: one book per Part of the test.
  listening_part1: 'Part 1 · conversation',
  listening_part2: 'Part 2 · one speaker, maps',
  listening_part3: 'Part 3 · discussion',
  listening_part4: 'Part 4 · lecture',
  // Writing pages (2026-11-02): homework only, never on the Books shelf.
  writing_task1: 'Writing Task 1',
  writing_task2: 'Writing Task 2',
  completion: 'Gap-fill (completion)',
  matching: 'Matching',
  other: 'Other',
}

const LABELS = { ...Object.fromEntries(GROUP_KINDS.map((k) => [k.value, k.label])), ...EXTRA }

export const QUESTION_TYPES = [
  ...GROUP_KINDS.filter((k) => k.value !== 'other').map((k) => ({ value: k.value, label: k.label })),
  ...[1, 2, 3, 4].map((n) => ({ value: `listening_part${n}`, label: `Listening ${EXTRA[`listening_part${n}`]}` })),
  { value: 'writing_task1', label: 'Writing Task 1' },
  { value: 'writing_task2', label: 'Writing Task 2' },
]

export function qtypeLabel(key) {
  if (!key) return 'Other'
  return LABELS[key] || String(key).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export const SKILLS = [
  { value: 'reading', label: 'Reading' },
  { value: 'listening', label: 'Listening' },
  { value: 'writing', label: 'Writing' },
]

// What a page is, from its own <title> and headings — used when the folder
// name says nothing (e.g. "Task 1 · IELTS Writing Task 1 · MrIkromov's IELTS").
export function detectFromHtml(html = '', fallback = { skill: 'reading', qtype: null }) {
  const head = `${(String(html).match(/<title[^>]*>([^<]*)/i) || [])[1] || ''} ${String(html).slice(0, 4000)}`
  if (/writing\s*task\s*1|task\s*1\b[^<]{0,40}(graph|chart|table|map|process|diagram)/i.test(head)) return { skill: 'writing', qtype: 'writing_task1' }
  if (/writing\s*task\s*2|task\s*2\b[^<]{0,40}essay/i.test(head)) return { skill: 'writing', qtype: 'writing_task2' }
  if (fallback.qtype) return fallback
  if (/listening/i.test(head)) return { skill: 'listening', qtype: fallback.qtype }
  return fallback
}

// Guess skill + question type from a book folder path, e.g.
// "thematic reading/21-40 IDENTIFYING INFORMATION TRUE FALSE NG/test_21.html".
// Order matters: the more specific names are checked first.
const RULES = [
  [/true\s*[-/]?\s*false|\btfng\b/i, 'tfng'],
  [/yes\s*[-/]?\s*no|writer'?s?\s*view|\bynng\b/i, 'ynng'],
  [/heading/i, 'matching_headings'],
  [/sentence\s*ending/i, 'matching_sentence_endings'],
  [/paragraph|matching\s*info/i, 'matching_info'],
  [/feature/i, 'matching_features'],
  [/summary/i, 'summary_completion'],
  [/flow/i, 'flow_chart'],
  [/table/i, 'table_completion'],
  [/diagram/i, 'diagram_labelling'],
  [/\bmap\b|plan\b/i, 'map_labelling'],
  [/sentence/i, 'sentence_completion'],
  [/short\s*answer/i, 'short_answer'],
  [/\bform\b/i, 'form_completion'],
  [/\bnote/i, 'note_completion'],
  [/mcq\s*ii\b|choos\w*\s*(two|three)|two\s*or\s*three|multiple\s*answers/i, 'mcq_multi'],
  [/mcq|multiple\s*choice/i, 'mcq_single'],
  [/matching/i, 'matching'],
]

export function detectFromPath(path = '') {
  const s = String(path)
  const parts = s.split(/[\\/]/)
  const fileName = parts.pop() || ''
  // "Part 1 (HTML)/Part 1 - Test 7.html" = a Listen with Mr.Ikromov page:
  // sorted by Part of the Listening test.
  const partTest = fileName.match(/^part\s*([1-4])\s*[-–—]\s*test\s*\d+/i)
  if (partTest) return { skill: 'listening', qtype: `listening_part${partTest[1]}` }
  const skill = /listen/i.test(s) ? 'listening' : 'reading'
  if (skill === 'listening') {
    const part = s.match(/\bpart\s*([1-4])\b/i)
    if (part) return { skill, qtype: `listening_part${part[1]}` }
  }
  // Look at folder names from the innermost outwards, then the file name.
  for (const part of [...parts].reverse()) {
    for (const [re, key] of RULES) if (re.test(part)) return { skill, qtype: key }
  }
  for (const [re, key] of RULES) if (re.test(fileName)) return { skill, qtype: key }
  return { skill, qtype: null }
}

// "<title>Test 51 — A second attempt…</title>" → the page title, cleaned.
export function htmlTitle(html, fallback) {
  const m = String(html || '').match(/<title[^>]*>([^<]*)<\/title>/i)
  const t = (m ? m[1] : '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/IELTS with Mr\.? ?Ikromov\s*[·—-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t || fallback
}

// Accuracy → colour tone used by the weak-spot bars.
export function accuracyTone(pct) {
  if (pct >= 75) return { bar: 'bg-sage', text: 'text-sage', label: 'Strong' }
  if (pct >= 55) return { bar: 'bg-saffron', text: 'text-brass', label: 'Getting there' }
  return { bar: 'bg-coral', text: 'text-coral', label: 'Weak spot' }
}
