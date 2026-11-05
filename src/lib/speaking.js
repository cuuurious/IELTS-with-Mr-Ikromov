import { supabase } from './supabaseClient'

/*
 * SPEAKING TESTS (2026-11-05, migration_101).
 *
 * A speaking set is one full IELTS Speaking test (a `speaking_sets` row):
 *   content = {
 *     period,
 *     part1: [{ topic, intro, questions: [{ q, model }] }],
 *     part2: { cue, bullets: [], explain, notes: [], tip, rounding: { q, model }, model },
 *     part3: { theme, intro, questions: [{ q, model }] },
 *   }
 *   model = { answer, phrases: [[phrase, meaning]], grammar: [{ pattern, use, example, try }] }
 *   (Part 2 model also has sections: [{ label, text }] and why: [])
 *
 * Two banks from the Sep–Dec 2026 books (migration_110/111/112) are sets too:
 *   - Part 2 & 3 topics: content.topic_no (1–66), no Part 1, numbers 1001–1066,
 *     shown as "Topic N"; content.category = People / Places / …
 *   - Part 1 topics: content.p1_no (1–39), only Part 1, numbers 2001–2039,
 *     shown as "Part 1 · Topic N". A speaking mock on a Part 2 & 3 topic
 *     borrows its Part 1 from these (withMockPart1).
 *
 * In the Practice Bank each set is four pages whose url is
 * "speaking:<set id>#full" / "#part1" / "#part2" / "#part3"; a homework
 * task keeps that url in html_url and opens the speaking exam screen.
 */

export const SPEAKING_PARTS = {
  full: { label: 'Full test', short: 'Full test', minutes: '11–14 min' },
  part1: { label: 'Part 1', short: 'Part 1', minutes: '4–5 min' },
  part2: { label: 'Part 2', short: 'Part 2', minutes: '3–4 min' },
  part3: { label: 'Part 3', short: 'Part 3', minutes: '4–5 min' },
}

// Lines every test uses. The same list is in the ai-grading function
// (only these and the set's own lines are ever spoken).
export const FIXED = {
  hello: 'Good afternoon. This is the speaking test. Let’s begin.',
  p1: 'Now, in this first part, I’d like to ask you some questions about yourself.',
  p2a: 'Now I’m going to give you a topic, and I’d like you to talk about it for one to two minutes. Before you talk, you’ll have one minute to think about what you’re going to say, and you can make some notes if you wish. Here’s your topic.',
  p2b: 'All right? Remember, you have one to two minutes for this, so don’t worry if I stop you. I’ll tell you when the time is up. Can you start speaking now, please?',
  thanks: 'Thank you.',
  p3: 'We’ve been talking about your topic, and now I’d like to discuss with you one or two more general questions related to this.',
  end: 'Thank you. That is the end of the speaking test.',
}

// How long each answer may run (seconds) — the screen stops it there.
export const LIMITS = { part1: 45, part2: 120, rounding: 30, part3: 90, prep: 60 }

export function isSpeakingUrl(url) {
  return /^speaking:/.test(String(url || ''))
}

export function parseSpeakingUrl(url) {
  const m = /^speaking:([0-9a-f-]{36})(?:#(full|part1|part2|part3))?$/i.exec(String(url || ''))
  return m ? { setId: m[1], part: (m[2] || 'full').toLowerCase() } : null
}

export async function loadSpeakingSet(id) {
  const { data, error } = await supabase.from('speaking_sets').select('id, number, title, topics, content, updated_at').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('This speaking test was removed.')
  return data
}

export async function loadSpeakingSets() {
  const { data, error } = await supabase.from('speaking_sets').select('id, number, title, topics, content, updated_at').order('number')
  if (error) throw error
  // The daily warm-up bank (migration_106) is not a test: keep it out of the lists.
  return (data || []).filter((s) => !s.content?.warmup)
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/*
 * The test as a list of steps, in real test order:
 *   { type: 'say', text }                         the examiner speaks
 *   { type: 'answer', key, part, q, limit }       the student answers
 *   { type: 'cue' }                               Part 2 card + 1 minute to prepare
 *   { type: 'section', part, title }              a heading change (no audio)
 */
export function buildSteps(content, part = 'full') {
  const c = content || {}
  const steps = []
  const want = (p) => part === 'full' || part === p

  if (part === 'full') steps.push({ type: 'say', text: FIXED.hello })

  if (want('part1') && (c.part1 || []).some((t) => (t.questions || []).length)) {
    steps.push({ type: 'section', part: 1, title: 'Part 1' })
    ;(c.part1 || []).forEach((t, ti) => {
      const intro = clean(t.intro)
      if (intro) steps.push({ type: 'say', text: intro })
      else if (ti === 0) steps.push({ type: 'say', text: FIXED.p1 })
      ;(t.questions || []).forEach((q, qi) => {
        if (!clean(q.q)) return
        steps.push({ type: 'say', text: clean(q.q) })
        steps.push({ type: 'answer', key: `p1-${ti}-${qi}`, part: 1, topic: t.topic, q: clean(q.q), limit: LIMITS.part1 })
      })
    })
  }

  if (want('part2') && c.part2?.cue) {
    steps.push({ type: 'section', part: 2, title: 'Part 2' })
    steps.push({ type: 'say', text: FIXED.p2a })
    steps.push({ type: 'cue', limit: LIMITS.prep })
    steps.push({ type: 'say', text: FIXED.p2b })
    steps.push({ type: 'answer', key: 'p2-long', part: 2, q: clean(c.part2.cue), limit: LIMITS.part2, long: true })
    steps.push({ type: 'say', text: FIXED.thanks })
    if (clean(c.part2.rounding?.q)) {
      steps.push({ type: 'say', text: clean(c.part2.rounding.q) })
      steps.push({ type: 'answer', key: 'p2-round', part: 2, q: clean(c.part2.rounding.q), limit: LIMITS.rounding })
    }
  }

  if (want('part3') && (c.part3?.questions || []).length) {
    steps.push({ type: 'section', part: 3, title: 'Part 3' })
    steps.push({ type: 'say', text: clean(c.part3.intro) || FIXED.p3 })
    c.part3.questions.forEach((q, qi) => {
      if (!clean(q.q)) return
      steps.push({ type: 'say', text: clean(q.q) })
      steps.push({ type: 'answer', key: `p3-${qi}`, part: 3, q: clean(q.q), limit: LIMITS.part3 })
    })
  }

  steps.push({ type: 'say', text: part === 'full' || part === 'part3' ? FIXED.end : FIXED.thanks, last: true })
  return steps
}

// The model answer (and phrases, grammar) for one answer key.
export function modelFor(content, key) {
  const c = content || {}
  let m
  if ((m = /^p1-(\d+)-(\d+)$/.exec(key))) return c.part1?.[m[1]]?.questions?.[m[2]]?.model || null
  if (key === 'p2-long') return c.part2?.model || null
  if (key === 'p2-round') return c.part2?.rounding?.model || null
  if ((m = /^p3-(\d+)$/.exec(key))) return c.part3?.questions?.[m[1]]?.model || null
  return null
}

// Every line the examiner says in this run, for the voice.
export function linesOf(steps) {
  return [...new Set(steps.filter((s) => s.type === 'say').map((s) => s.text))]
}

// Ask the ai-grading function for the examiner's voice (made once per
// line, then reused). Resolves to { text: url }; quiet on failure — the
// screen then reads the line with the browser's own voice.
export async function fetchVoice(setId, texts) {
  try {
    const { data, error } = await supabase.functions.invoke('ai-grading', { body: { action: 'speaking_voice', setId, texts } })
    if (error) return {}
    return data?.urls || {}
  } catch {
    return {}
  }
}

// "Set 8", "Topic 12" or "Part 1 · Topic 5".
export function setLabel(set) {
  const c = set?.content || {}
  if (c.topic_no) return `Topic ${c.topic_no}`
  if (c.p1_no) return `Part 1 · Topic ${c.p1_no}`
  return `Set ${set?.number ?? ''}`
}

export function setTitle(set, part = 'full') {
  if (!set) return 'Speaking test'
  const c = set.content || {}
  const n = setLabel(set)
  if (part === 'part1') return `${n} · Part 1: ${(c.part1 || []).map((t) => t.topic).join(' · ')}`
  if (part === 'part2') return `${n} · Part 2: ${c.part2?.cue || ''}`
  if (part === 'part3') return `${n} · Part 3: ${c.part3?.theme || ''}`
  if (c.topic_no) return `${n} · Parts 2 & 3: ${set.topics || set.title}`
  return `${n} · ${set.topics || set.title}`
}

// A small steady random number from a text (same mock → same Part 1).
function seeded(seed) {
  let h = 2166136261
  for (const ch of String(seed || 'x')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

/*
 * A mock is a full test. When its set has no Part 1 (a Part 2 & 3 topic),
 * it borrows three Part 1 topics from the Part 1 bank, like the real test:
 * first one of the "about you" topics (work/studies, hometown, home, area),
 * then two others. The same mock always gets the same three. Each borrowed
 * topic keeps `from` (its set id) so the examiner's voice can be made.
 */
export async function withMockPart1(set, seed) {
  const c = set?.content || {}
  if ((c.part1 || []).some((t) => (t.questions || []).length)) return set
  const { data } = await supabase.from('speaking_sets').select('id, content').not('content->p1_no', 'is', null)
  const bank = (data || [])
    .filter((s) => s.content?.p1_no && s.content.part1?.[0]?.questions?.length)
    .sort((a, b) => a.content.p1_no - b.content.p1_no)
  if (!bank.length) return set
  const rnd = seeded(`${seed}:${set.id}`)
  const pick = (list) => list.splice(Math.floor(rnd() * list.length), 1)[0]
  const about = bank.filter((s) => s.content.p1_no <= 4)
  const rest = bank.filter((s) => s.content.p1_no > 4)
  const chosen = [about.length ? pick(about) : pick(rest)]
  while (chosen.length < 3 && rest.length) chosen.push(pick(rest))
  const part1 = chosen.map((s, i) => {
    const t = s.content.part1[0]
    // The opening line is the examiner's standard one, then the questions.
    return { ...t, intro: i === 0 && s.content.p1_no !== 1 ? '' : t.intro, questions: (t.questions || []).slice(0, 4), from: s.id }
  })
  return { ...set, content: { ...c, part1 } }
}

export function fmtTime(secs) {
  const s = Math.max(0, Math.round(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/*
 * Teacher import: turn a pasted examiner script into a set's content.
 * Understands the question bank PDFs ("Part 1 · Landscapes", "EXAMINER …",
 * "Describe …", "You should say:", "• …", "Rounding-off question",
 * "Part 3 · …") and plain lists:
 *   Part 1: Hometown
 *   - Where are you from?
 *   Part 2: Describe a place you like
 *   - where it is
 *   Rounding: Do you go there often?
 *   Part 3: Places
 *   - Why do people travel?
 */
export function parseScript(text) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*(EXAMINER|Examiner)\s*:?\s*/, '').trim())
    .filter(Boolean)
  const out = { part1: [], part2: { cue: '', bullets: [], explain: '', notes: [], tip: '', rounding: { q: '' } }, part3: { theme: '', intro: '', questions: [] } }
  let sec = null
  let topic = null
  const head = (l) => /^part\s*([123])\b\s*[·:.\-–—]?\s*(.*)$/i.exec(l)
  const isQ = (l) => /\?\s*$/.test(l)
  const stripBullet = (l) => l.replace(/^[•\-*–·]\s*|^\d+[.)]\s+/, '').trim()
  let pending = ''
  for (const raw of lines) {
    const h = head(raw)
    if (h) {
      sec = Number(h[1])
      const name = h[2].replace(/^(individual long turn|two-way discussion)$/i, '').trim()
      if (sec === 1) {
        topic = { topic: name || 'Part 1', intro: '', questions: [] }
        out.part1.push(topic)
      }
      if (sec === 3 && name) out.part3.theme = name
      pending = ''
      continue
    }
    if (/^rounding/i.test(raw)) {
      sec = 'r'
      const rest = raw.replace(/^rounding(?:[-\s]*off)?(?:\s*question)?(?:\s*\([^)]*\))?\s*[:·-]?\s*/i, '').trim()
      if (rest) out.part2.rounding.q = rest
      continue
    }
    if (/^(introduction|preparation notes|speaking time|q\d+ keywords)/i.test(raw) || /^☐/.test(raw)) continue
    const l = stripBullet(raw)
    if (sec === 1 && topic) {
      const t = pending ? `${pending} ${l}` : l
      if (isQ(t)) {
        if (/let’s talk about|let's talk about|move on to talk/i.test(t)) topic.intro = t
        else topic.questions.push({ q: t })
        pending = ''
      } else if (/[.!]$/.test(t)) {
        // "Now, in this first part … Let’s talk about landscapes."
        topic.intro = clean(`${topic.intro} ${t}`)
        pending = ''
      } else pending = t
    } else if (sec === 2) {
      if (/^describe\b/i.test(l)) out.part2.cue = l.replace(/[.:]$/, '')
      else if (/^you should say/i.test(l)) continue
      else if (/^and (explain|say)/i.test(l)) out.part2.explain = l
      else if (out.part2.cue && !out.part2.explain && /^[•\-*–·]/.test(raw)) out.part2.bullets.push(l)
      else if (out.part2.cue && !out.part2.explain && out.part2.bullets.length < 4 && !/[.?]$/.test(l) && l.length < 80) out.part2.bullets.push(l)
    } else if (sec === 'r') {
      if (isQ(l) && !out.part2.rounding.q) out.part2.rounding.q = l
    } else if (sec === 3) {
      const t = pending ? `${pending} ${l}` : l
      if (/end of the speaking test/i.test(t)) {
        pending = ''
        continue
      }
      if (isQ(t)) {
        if (/^(we’ve been talking|we've been talking)/i.test(t) && !out.part3.questions.length) out.part3.intro = t
        else out.part3.questions.push({ q: t })
        pending = ''
      } else if (/^(we’ve been talking|we've been talking)/i.test(t) && /\.$/.test(t)) {
        out.part3.intro = t
        const th = /let’s consider ([^.]+)\.|let's consider ([^.]+)\./i.exec(t)
        if (th && !out.part3.theme) out.part3.theme = th[1] || th[2]
        pending = ''
      } else pending = t
    }
  }
  return out
}

// Empty content for a new set.
export function blankContent() {
  return {
    period: '',
    part1: [
      { topic: '', intro: '', questions: [{ q: '' }, { q: '' }, { q: '' }, { q: '' }] },
      { topic: '', intro: '', questions: [{ q: '' }, { q: '' }, { q: '' }, { q: '' }] },
    ],
    part2: { cue: '', bullets: ['', '', ''], explain: '', notes: [], tip: '', rounding: { q: '' } },
    part3: { theme: '', intro: '', questions: [{ q: '' }, { q: '' }, { q: '' }, { q: '' }, { q: '' }] },
  }
}

// Drop empty questions/bullets before saving; keep model answers.
export function tidyContent(c) {
  const part1 = (c.part1 || [])
    .map((t) => ({ ...t, topic: clean(t.topic), intro: clean(t.intro), questions: (t.questions || []).filter((q) => clean(q.q)).map((q) => ({ ...q, q: clean(q.q) })) }))
    .filter((t) => t.topic || t.questions.length)
  const p2 = c.part2 || {}
  const bullets = (p2.bullets || []).map(clean).filter(Boolean)
  return {
    ...c,
    part1,
    part2: {
      ...p2,
      cue: clean(p2.cue),
      bullets,
      explain: clean(p2.explain),
      notes: (p2.notes || []).map(clean).filter(Boolean),
      rounding: { ...(p2.rounding || {}), q: clean(p2.rounding?.q) },
    },
    part3: { ...(c.part3 || {}), theme: clean(c.part3?.theme), intro: clean(c.part3?.intro), questions: (c.part3?.questions || []).filter((q) => clean(q.q)).map((q) => ({ ...q, q: clean(q.q) })) },
  }
}

export function checkContent(c) {
  const problems = []
  const p1 = (c.part1 || []).reduce((n, t) => n + (t.questions || []).length, 0)
  if (c.p1_no) return p1 < 3 ? ['Part 1 needs at least 3 questions.'] : []
  if (!c.topic_no && p1 < 3) problems.push('Part 1 needs at least 3 questions.')
  if (!c.part2?.cue) problems.push('Part 2 needs a cue card ("Describe …").')
  if ((c.part2?.bullets || []).length < 2) problems.push('The cue card needs at least 2 “You should say” points.')
  if ((c.part3?.questions || []).length < 3) problems.push('Part 3 needs at least 3 questions.')
  return problems
}
