/*
 * MOCK FROM HTML (2026-11-16).
 * Jasur: "we have other htmls for mock like we got for practice but after
 * theyre inserted the website should automatically build it into the real
 * exam environment".
 *
 * Reads Mr Ikromov's own test pages, the same kind as the practice ones,
 * and turns them into exam rows for the real exam screen. No AI, nothing
 * to retype: the answers come from the page's own answer key.
 *
 *   Reading   — one full test page (const CFG + const QS, three passages)
 *               or single-passage pages of the same kind.
 *   Listening — one full test page or a page per Part (const TEST with
 *               key + parts), the audio from the page's own mp3 links.
 *
 * The result is plain data:
 *   { module, title, warnings: [], sections: [
 *       { title, passage_text?, audio_url?, number, groups: [
 *           { kind, title, instruction, body, word_limit, options_reusable,
 *             image (data: URL or link), questions: [
 *               { number, type, prompt, options, correct_answer, accepted_answers } ] } ] } ] }
 * and saveImportedExam() writes it to mock_exams / mock_sections /
 * mock_question_groups / mock_questions.
 */

const clean = (s) =>
  String(s || '')
    .replace(/ /g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()

function jsonAfter(src, re) {
  const m = re.exec(src)
  if (!m) return null
  // Read the balanced { … } or [ … ] that starts at m.index + m[0].length - 1.
  const start = m.index + m[0].length - 1
  const open = src[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(src.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Instructions and word limits                                        */
/* ------------------------------------------------------------------ */

const WORD_LIMIT_RULES = [
  [/NO MORE THAN THREE WORDS AND\/OR A NUMBER/i, 'three_words_and_or_number'],
  [/NO MORE THAN TWO WORDS AND\/OR A NUMBER/i, 'two_words_and_or_number'],
  [/NO MORE THAN THREE WORDS/i, 'three_words'],
  [/NO MORE THAN TWO WORDS/i, 'two_words'],
  [/ONE WORD AND\/OR A NUMBER/i, 'one_word_and_or_number'],
  [/ONE WORD ONLY|ONE WORD\b/i, 'one_word'],
  [/A NUMBER ONLY|\bA NUMBER\b/i, 'number_only'],
]
export function wordLimitOf(text) {
  for (const [re, v] of WORD_LIMIT_RULES) if (re.test(text || '')) return v
  return null
}

// The real computer test drops "Write … on your answer sheet" — keep the rest.
function tidyInstruction(lines) {
  return lines
    .map(clean)
    .filter((l) => l && !/answer sheet|next to questions?\s+\d/i.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function gapKind(text, { hasTable = false, hasFlow = false, hasImage = false } = {}) {
  const t = text || ''
  if (hasFlow || /flow-?\s?chart/i.test(t)) return 'flow_chart'
  if (hasTable || /\btable\b/i.test(t)) return 'table_completion'
  if (/\bsummary\b/i.test(t)) return 'summary_completion'
  if (/\bform\b/i.test(t)) return 'form_completion'
  if (/\bnotes?\b/i.test(t)) return 'note_completion'
  if (/\bdiagram\b/i.test(t)) return 'diagram_labelling'
  if (/\b(map|plan)\b/i.test(t) || hasImage) return 'map_labelling'
  if (/answer the questions?/i.test(t)) return 'short_answer'
  if (/\bsentences?\b/i.test(t)) return 'sentence_completion'
  return 'sentence_completion'
}

function matchKind(text) {
  const t = text || ''
  if (/heading/i.test(t)) return 'matching_headings'
  if (/(paragraph|section)[^.]*\b(contains?|information|mentions?)\b|which (paragraph|section)/i.test(t)) return 'matching_info'
  if (/ending|complete each sentence/i.test(t)) return 'matching_sentence_endings'
  return 'matching_features'
}

/* ------------------------------------------------------------------ */
/* Notes / tables / flow-charts → the exam screen's layout text          */
/* ( # title, ## heading, - bullet, | table |, [[ ]] gaps, **bold** )   */
/* ------------------------------------------------------------------ */

const isGapInput = (el) => el.tagName === 'INPUT' && (el.type === 'text' || !el.type || el.classList.contains('gap') || el.classList.contains('q-text'))

function inlineText(node, gaps) {
  let out = ''
  node.childNodes.forEach((ch) => {
    if (ch.nodeType === 3) {
      out += ch.textContent
      return
    }
    if (ch.nodeType !== 1) return
    const el = ch
    if (isGapInput(el)) {
      const n = Number(el.dataset.q || (el.name || '').replace(/\D/g, '') || el.placeholder)
      gaps.push(n)
      out += ' [[ ]] '
      return
    }
    if (el.classList.contains('q-num') || el.classList.contains('n')) return
    if (el.tagName === 'BR') {
      out += ' '
      return
    }
    if (el.classList.contains('bl')) {
      out += '______'
      return
    }
    const inner = inlineText(el, gaps)
    if ((el.tagName === 'B' || el.tagName === 'STRONG') && inner.trim() && !/\[\[/.test(inner)) out += ` **${inner.trim()}** `
    else out += inner
  })
  return out
}
const line = (s) => clean(s).replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').replace(/\s{2,}/g, ' ')

const BLOCK = /^(DIV|P|LI|UL|OL|TABLE|THEAD|TBODY|TR|H1|H2|H3|H4|SECTION)$/

function bodyLines(root, gaps) {
  const lines = []
  const walk = (el) => {
    if (el.nodeType !== 1) return
    const cls = el.classList
    if (cls.contains('q-num') || cls.contains('arr') || cls.contains('gp') || el.tagName === 'IMG') return
    if (el.tagName === 'TABLE') {
      const rows = [...el.querySelectorAll('tr')]
      rows.forEach((tr, ri) => {
        const cells = [...tr.children].map((td) => {
          const parts = [...td.children].some((c) => BLOCK.test(c.tagName))
            ? [...td.childNodes].map((c) => (c.nodeType === 1 ? line(inlineText(c, gaps)) : clean(c.textContent))).filter(Boolean).join(' / ')
            : line(inlineText(td, gaps))
          return parts.replace(/\|/g, '/')
        })
        lines.push(`| ${cells.join(' | ')} |`)
        if (ri === 0 && tr.querySelector('th')) lines.push(`|${cells.map(() => '---').join('|')}|`)
      })
      return
    }
    const hasBlockKids = [...el.children].some((c) => BLOCK.test(c.tagName))
    if (hasBlockKids && el.tagName !== 'LI') {
      el.childNodes.forEach((c) => {
        if (c.nodeType === 3 && clean(c.textContent)) lines.push(line(c.textContent))
        else walk(c)
      })
      return
    }
    const text = line(inlineText(el, gaps))
    if (!text) return
    if (cls.contains('notes-title') || cls.contains('nt') || cls.contains('ptitle')) lines.push(`# ${text.replace(/\*\*/g, '')}`)
    else if (cls.contains('notes-sub') || cls.contains('h')) lines.push(`## ${text.replace(/\*\*/g, '')}`)
    else if (el.tagName === 'LI' || cls.contains('b') || cls.contains('s') || cls.contains('cb')) lines.push(`- ${text}`)
    else if (/^\*\*[^*]+\*\*$/.test(text)) lines.push(`## ${text.replace(/\*\*/g, '')}`)
    else lines.push(text)
  }
  walk(root)
  return lines
}

// The text around gap n, for the review screen ("…a food ______ being used…").
function promptFromBody(lines, n, order) {
  let k = 0
  for (const l of lines) {
    const count = (l.match(/\[\[ \]\]/g) || []).length
    for (let i = 0; i < count; i++, k++) {
      if (order[k] === n) {
        let j = 0
        return l
          .replace(/\[\[ \]\]/g, () => (j++ === i ? '______' : '…'))
          .replace(/^(#+|-|\|)\s*/, '')
          .replace(/\s*\|\s*/g, ' · ')
          .replace(/\*\*/g, '')
          .trim()
      }
    }
  }
  return '______'
}

/* ------------------------------------------------------------------ */
/* Reading: const CFG + const QS                                        */
/* ------------------------------------------------------------------ */

const TFNG = { TRUE: 'True', FALSE: 'False', 'NOT GIVEN': 'Not Given' }
const YNNG = { YES: 'Yes', NO: 'No', 'NOT GIVEN': 'Not Given' }
const choiceFor = (choices, letter) => choices.find((c) => c === letter || c.startsWith(`${letter} `)) || ''

function parseReading(doc, src) {
  const CFG = jsonAfter(src, /const\s+CFG\s*=\s*\{/)
  const QS = jsonAfter(src, /const\s+QS\s*=\s*\[/)
  if (!QS) return null
  const warnings = []
  const byN = Object.fromEntries(QS.map((q) => [q.n, q]))
  const parts = [...doc.querySelectorAll('.part[data-part]')]
  const sections = parts.map((part, pi) => {
    const pc = part.querySelector('.passage-container') || part
    const title = clean(pc.querySelector('.passage-title')?.textContent) || CFG?.parts?.[pi]?.title || `Passage ${pi + 1}`
    const subtitle = clean(pc.querySelector('.passage-subtitle')?.textContent)
    // Paragraphs, grouped by their letter when the passage has A, B, C…
    const paras = [...pc.querySelectorAll('p[data-para]')].map((p) => {
      const copy = p.cloneNode(true)
      copy.querySelectorAll('.para-letter').forEach((x) => x.remove())
      return { key: p.dataset.para, text: clean(copy.textContent) }
    })
    const lettered = paras.length && paras.every((p) => /^[A-Z]$/.test(p.key))
    let passage = ''
    if (lettered) {
      const blocks = []
      paras.forEach((p) => {
        const last = blocks[blocks.length - 1]
        if (last && last.key === p.key) last.texts.push(p.text)
        else blocks.push({ key: p.key, texts: [p.text] })
      })
      passage = blocks.map((b) => `${b.key}\n\n${b.texts.join('\n\n')}`).join('\n\n')
    } else {
      passage = paras.map((p) => p.text).join('\n\n')
    }
    if (subtitle) passage = `${subtitle}\n\n${passage}`
    if (pc.querySelector('img')) warnings.push(`Passage ${pi + 1} has a picture inside the passage. The exam screen shows the passage text only.`)

    const dropzones = Object.fromEntries([...pc.querySelectorAll('.para-dropzone[data-qnum]')].map((d) => [Number(d.dataset.qnum), d.dataset.letter]))
    const qc = part.querySelector('.questions-container') || part
    const groups = [...qc.querySelectorAll('.q-group')].map((g) => readingGroup(g, QS, byN, dropzones, pc, warnings)).filter(Boolean)
    return { number: pi + 1, title, passage_text: passage, groups }
  })
  const titleText = clean(doc.querySelector('title')?.textContent) || (CFG?.test ? `Reading Test ${CFG.test}` : 'Reading test')
  return { module: 'reading', title: CFG?.test ? `Reading Test ${CFG.test}` : titleText, minutes: CFG?.minutes || 60, sections, warnings }
}

function readingGroup(g, QS, byN, dropzones, passageEl, warnings) {
  const gid = g.dataset.gid
  const qs = QS.filter((q) => q.group === gid).sort((a, b) => a.n - b.n)
  if (!qs.length) return null
  const instrLines = [...g.querySelectorAll('.q-group-instructions')].flatMap((box) => {
    const kids = [...box.children]
    return kids.length ? kids.map((k) => k.textContent) : [box.textContent]
  })
  const fullInstr = instrLines.map(clean).join(' ')
  const instruction = tidyInstruction(instrLines)
  const kind0 = qs[0].kind
  const reusable = /more than once/i.test(fullInstr)

  if (kind0 === 'heading') {
    const choices = [...g.querySelectorAll('.info-chip')].map((c) => clean(`${c.dataset.heading || c.querySelector('.ic-num')?.textContent} ${c.querySelector('span:last-child')?.textContent || ''}`))
    return {
      kind: 'matching_headings',
      instruction,
      options_reusable: false,
      questions: qs.map((q) => {
        const letter = dropzones[q.n] || ''
        const ans = choiceFor(choices, q.ans)
        if (!letter) warnings.push(`Question ${q.n}: could not find which paragraph it belongs to.`)
        return { number: q.n, type: 'matching', prompt: `Paragraph ${letter || '?'}`, options: { choices }, correct_answer: ans, accepted_answers: [] }
      }),
    }
  }

  if (kind0 === 'multi') {
    const boxes = [...g.querySelectorAll('input[type=checkbox]')]
    const choices = boxes.map((b) => clean(`${b.value} ${b.closest('label')?.querySelector('span:last-child')?.textContent || ''}`))
    const stem = clean([...g.querySelectorAll('.mcq-stem')].map((s) => s.textContent).join(' '))
    const ansLetters = qs[0].groupAns || []
    const correct = choices.filter((c) => ansLetters.some((l) => c.startsWith(`${l} `))).join(', ')
    return {
      kind: 'mcq_multi',
      instruction,
      questions: [{ number: qs[0].n, type: 'multi_select', prompt: stem, options: { choices }, correct_answer: correct, accepted_answers: [], width: qs.length }],
    }
  }

  if (kind0 === 'radio') {
    return {
      kind: 'mcq_single',
      instruction,
      questions: qs.map((q) => {
        const radios = [...g.querySelectorAll(`input[type=radio][name="q${q.n}"]`)]
        const choices = radios.map((r) => clean(`${r.value} ${r.closest('label')?.querySelector('span:last-child')?.textContent || ''}`))
        const stemEl = [...g.querySelectorAll('.mcq-stem')].find((s) => clean(s.querySelector('.q-num')?.textContent) === String(q.n))
        const stemCopy = stemEl?.cloneNode(true)
        stemCopy?.querySelectorAll('.q-num').forEach((x) => x.remove())
        return { number: q.n, type: 'multiple_choice', prompt: clean(stemCopy?.textContent), options: { choices }, correct_answer: choiceFor(choices, q.ans), accepted_answers: [] }
      }),
    }
  }

  if (kind0 === 'select') {
    const sel = g.querySelector(`select[name="q${qs[0].n}"]`)
    const values = sel ? [...sel.options].map((o) => o.value).filter(Boolean) : []
    const up = values.map((v) => v.toUpperCase())
    const isTF = up.length && up.every((v) => v in TFNG) && up.includes('TRUE')
    const isYN = up.length && up.every((v) => v in YNNG) && up.includes('YES')
    const rowFor = (n) => g.querySelector(`select[name="q${n}"]`)?.closest('.q-row')
    const stemOf = (n) => {
      const row = rowFor(n)
      const s = row?.querySelector('.q-stem')
      return clean((s || row)?.textContent).replace(/^\d+\s*/, '')
    }
    if (isTF || isYN) {
      const map = isTF ? TFNG : YNNG
      return {
        kind: isTF ? 'tfng' : 'ynng',
        instruction: '',
        questions: qs.map((q) => ({ number: q.n, type: isTF ? 'true_false_ng' : 'yes_no_ng', prompt: stemOf(q.n), options: null, correct_answer: map[String(q.ans).toUpperCase()] || q.ans, accepted_answers: [] })),
      }
    }
    const bank = [...g.querySelectorAll('.word-bank .wb-item, .wb-item')]
    const choices = bank.length
      ? bank.map((b) => clean(`${clean(b.querySelector('.wb-letter')?.textContent)} ${clean([...b.childNodes].filter((c) => !(c.nodeType === 1 && c.classList.contains('wb-letter'))).map((c) => c.textContent).join(' '))}`))
      : values
    const kind = matchKind(fullInstr)
    return {
      kind,
      title: '',
      instruction,
      options_reusable: reusable || kind === 'matching_info',
      questions: qs.map((q) => ({ number: q.n, type: 'matching', prompt: stemOf(q.n), options: { choices }, correct_answer: choiceFor(choices, q.ans), accepted_answers: [] })),
    }
  }

  // Gaps (kind "text"): notes, summary, table, flow-chart, sentences, short answers.
  const box = g.querySelector('.notes-box, .flow, table')
  const kind = gapKind(fullInstr, { hasTable: !!g.querySelector('table'), hasFlow: !!g.querySelector('.flow') })
  const ans = (q) => (Array.isArray(q.ans) ? q.ans : [q.ans]).map((a) => clean(a)).filter(Boolean)
  if (box) {
    const order = []
    const lines = bodyLines(box, order)
    let title = ''
    if (lines[0]?.startsWith('# ')) title = lines.shift().slice(2)
    const body = lines.join('\n')
    return {
      kind,
      title,
      instruction,
      word_limit: wordLimitOf(fullInstr),
      body,
      questions: qs.map((q) => {
        const a = ans(q)
        return { number: q.n, type: 'short_answer', prompt: promptFromBody(lines, q.n, order), options: null, correct_answer: a[0] || '', accepted_answers: a.slice(1) }
      }),
    }
  }
  return {
    kind: kind === 'note_completion' ? 'sentence_completion' : kind,
    instruction,
    word_limit: wordLimitOf(fullInstr),
    questions: qs.map((q) => {
      const input = g.querySelector(`input[name="q${q.n}"]`)
      const row = input?.closest('.q-row')
      const host = row ? [...row.children].find((c) => c.contains(input) && c !== input) || row : null
      let prompt = '______'
      if (host) {
        const gaps = []
        prompt = line(inlineText(host, gaps)).replace(/\[\[ \]\]/, '______').replace(/^\d+\s+/, '')
        if (!/______/.test(prompt)) prompt = `${prompt} ______`
      }
      const a = ans(q)
      return { number: q.n, type: 'short_answer', prompt, options: null, correct_answer: a[0] || '', accepted_answers: a.slice(1) }
    }),
  }
}

/* ------------------------------------------------------------------ */
/* Listening: const TEST = { key, parts:[{ n, from, to, html }] }       */
/* ------------------------------------------------------------------ */

function audioLinks(src) {
  const list = jsonAfter(src, /var\s+parts\s*=\s*\[/)
  if (Array.isArray(list) && list.length) return list
  const one = /<audio[^>]*\ssrc=["']([^"']+)["']/i.exec(src)
  return one ? [one[1]] : []
}

function parseListening(doc, src) {
  const TEST = jsonAfter(src, /const\s+TEST\s*=\s*\{/)
  if (!TEST?.key || !Array.isArray(TEST.parts)) return null
  const warnings = []
  const audios = audioLinks(src)
  const sections = TEST.parts.map((part, pi) => {
    const keyOf = (n) => TEST.key[String(n)] || TEST.key[String(n - (part.from || 1) + 1)] || null
    const holder = doc.createElement('div')
    holder.innerHTML = part.html
    // Split at every <h3>Questions …</h3>.
    const chunks = []
    let cur = null
    let partTitle = ''
    ;[...holder.childNodes].forEach((node) => {
      if (node.nodeType === 1 && node.tagName === 'H3') {
        cur = { head: clean(node.textContent), nodes: [] }
        chunks.push(cur)
      } else if (node.nodeType === 1 && node.classList.contains('ptitle') && !cur) {
        partTitle = clean(node.textContent)
      } else if (cur) cur.nodes.push(node)
    })
    const groups = chunks.map((c) => listeningGroup(c, keyOf, doc, warnings, part.n)).filter(Boolean)
    const audio = audios.length > 1 ? audios[pi] || '' : pi === 0 || TEST.parts.length === 1 ? audios[0] || '' : ''
    return { number: part.n, title: partTitle ? `Part ${part.n} · ${partTitle}` : `Part ${part.n}`, audio_url: /^data:/.test(audio) ? '' : audio, groups }
  })
  const isFull = TEST.parts.length >= 4
  return { module: 'listening', title: TEST.no ? `Listening Test ${TEST.no}` : 'Listening test', sections, warnings, partOnly: !isFull }
}

function listeningGroup(chunk, keyOf, doc, warnings, partNo) {
  const box = doc.createElement('div')
  chunk.nodes.forEach((n) => box.appendChild(n.cloneNode(true)))
  const instrEls = [...box.querySelectorAll('p.instr')]
  const fullInstr = instrEls.map((p) => clean(p.textContent)).join(' ')
  // Other short lines before the task ("Which THREE kinds of help…?") are part of the task.
  const leads = [...box.children].filter((el) => el.tagName === 'P' && !el.classList.contains('instr') && !el.querySelector('input'))
  instrEls.forEach((p) => p.remove())
  const image = box.querySelector('img')?.getAttribute('src') || ''
  const bankChips = [...box.querySelectorAll('.bank .chip')]
  // No box of options (a map with letters A–E): the letters from the instruction.
  const range = /\b([A-Z])\s*[–-]\s*([A-Z])\b/.exec(fullInstr)
  const rangeLetters = range ? Array.from({ length: range[2].charCodeAt(0) - range[1].charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(range[1].charCodeAt(0) + i)) : []
  const choicesFromBank = bankChips.length ? bankChips.map((c) => clean(c.textContent)) : rangeLetters
  const instruction = tidyInstruction(instrEls.map((p) => p.textContent))

  // Choose TWO / THREE (one row, several marks).
  const picks = [...box.querySelectorAll('input.pick, input[type=checkbox]')]
  if (picks.length) {
    const byGroup = {}
    picks.forEach((p) => (byGroup[p.dataset.g] = byGroup[p.dataset.g] || []).push(p))
    const qs = Object.entries(byGroup).map(([g, list]) => {
      const choices = list.map((p) => clean(p.closest('label')?.textContent))
      const k = keyOf(g)
      const set = k?.set || []
      const width = Number(list[0].dataset.max) || set.length || 2
      const stem = clean(leads.map((p) => p.textContent).join(' '))
      return { number: Number(g), type: 'multi_select', prompt: stem, options: { choices }, correct_answer: choices.filter((c) => set.some((l) => c.startsWith(`${l} `))).join(', '), accepted_answers: [], width }
    })
    return { kind: 'mcq_multi', instruction, questions: qs }
  }

  // One-answer multiple choice.
  const radioQs = [...box.querySelectorAll('.q[data-q]')].filter((q) => q.querySelector('input[type=radio]'))
  if (radioQs.length) {
    return {
      kind: 'mcq_single',
      instruction,
      questions: radioQs.map((qel) => {
        const n = Number(qel.dataset.q)
        const choices = [...qel.querySelectorAll('label')].map((l) => clean(l.textContent))
        const copy = qel.cloneNode(true)
        copy.querySelectorAll('label, .n').forEach((x) => x.remove())
        const k = keyOf(n)
        return { number: n, type: 'multiple_choice', prompt: clean(copy.textContent), options: { choices }, correct_answer: choiceFor(choices, k?.accept), accepted_answers: [] }
      }),
    }
  }

  // Drag a letter onto a line (matching, map with letters).
  const zones = [...box.querySelectorAll('.zone[data-q]')]
  if (zones.length) {
    const choices = choicesFromBank
    const hasImage = !!image
    const kind = hasImage ? gapKind(fullInstr, { hasImage: true }) : matchKind(fullInstr)
    const lead = clean(leads.filter((p) => !/^statements$/i.test(clean(p.textContent))).map((p) => p.textContent).join(' '))
    return {
      kind,
      instruction: [lead, instruction].filter(Boolean).join(' '),
      options_reusable: /more than once/i.test(fullInstr),
      image,
      questions: zones.map((z) => {
        const n = Number(z.dataset.q)
        const lab = z.closest('.lab, .drow')?.cloneNode(true)
        lab?.querySelectorAll('.zone, .n').forEach((x) => x.remove())
        const k = keyOf(n)
        return { number: n, type: 'matching', prompt: clean(lab?.textContent), options: { choices }, correct_answer: choiceFor(choices, k?.accept), accepted_answers: [] }
      }),
    }
  }

  // Gaps.
  const inputs = [...box.querySelectorAll('input.gap, input[type=text]')]
  if (inputs.length) {
    const flow = !!box.querySelector('.flow')
    const table = !!box.querySelector('table')
    const kind = gapKind(fullInstr, { hasFlow: flow, hasTable: table, hasImage: !!image })
    box.querySelectorAll('.bank, .helpline, img, .side > div:empty').forEach((x) => x.remove())
    const order = []
    const lines = bodyLines(box, order)
    let title = ''
    if (lines[0]?.startsWith('# ')) title = lines.shift().slice(2)
    else if (/^## /.test(lines[0] || '') && kind !== 'table_completion') title = lines.shift().slice(3)
    const letterGaps = order.every((n) => keyOf(n)?.type === 'letter')
    return {
      kind,
      title,
      instruction,
      word_limit: letterGaps ? null : wordLimitOf(fullInstr),
      body: lines.join('\n'),
      image,
      questions: order.map((n) => {
        const k = keyOf(n)
        if (k?.type === 'letter')
          return { number: n, type: 'matching', prompt: promptFromBody(lines, n, order), options: { choices: choicesFromBank }, correct_answer: choiceFor(choicesFromBank, k.accept), accepted_answers: [] }
        const acc = (Array.isArray(k?.accept) ? k.accept : [k?.accept]).map(clean).filter(Boolean)
        return { number: n, type: 'short_answer', prompt: promptFromBody(lines, n, order), options: null, correct_answer: acc[0] || '', accepted_answers: acc.slice(1) }
      }),
    }
  }
  warnings.push(`Part ${partNo}: "${chunk.head}" has no questions the site can read.`)
  return null
}

/* ------------------------------------------------------------------ */
/* Entry point + checks                                                 */
/* ------------------------------------------------------------------ */

export function parseMockHtml(html) {
  const src = String(html || '')
  const doc = new DOMParser().parseFromString(src, 'text/html')
  if (/const\s+TEST\s*=\s*\{/.test(src)) {
    const r = parseListening(doc, src)
    if (r) return finish(r)
  }
  if (/const\s+QS\s*=\s*\[/.test(src)) {
    const r = parseReading(doc, src)
    if (r) return finish(r)
  }
  return { module: null, error: 'This page is not one of the test pages the site can read (it needs the answer key inside, like the practice tests).' }
}

const widthOf = (q) => (q.type === 'multi_select' ? q.width || Math.max(1, (q.correct_answer || '').split(', ').length) : 1)

function finish(r) {
  const problems = [...(r.warnings || [])]
  r.sections.forEach((s) => {
    s.groups.forEach((g) => {
      g.questions.forEach((q) => {
        if (!clean(q.correct_answer)) problems.push(`Question ${q.number}: no answer in the page's key.`)
        if (q.options?.choices && !q.options.choices.length) problems.push(`Question ${q.number}: no options found.`)
      })
    })
    s.count = s.groups.reduce((n, g) => n + g.questions.reduce((m, q) => m + widthOf(q), 0), 0)
    s.from = s.groups[0]?.questions[0]?.number || 0
  })
  r.count = r.sections.reduce((n, s) => n + s.count, 0)
  // Numbers must run without holes.
  const nums = []
  r.sections.forEach((s) => s.groups.forEach((g) => g.questions.forEach((q) => { for (let i = 0; i < widthOf(q); i++) nums.push(q.number + i) })))
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  const missing = []
  for (let n = lo; n <= hi; n++) if (!nums.includes(n)) missing.push(n)
  if (missing.length) problems.push(`Question${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing.`)
  r.range = nums.length ? [lo, hi] : [0, 0]
  r.problems = [...new Set(problems)]
  return r
}

/** Several Listening part pages → one Listening test (Parts 1–4 in order). */
export function combineListeningParts(results) {
  const parts = results.filter((r) => r.module === 'listening').flatMap((r) => r.sections)
  parts.sort((a, b) => a.number - b.number)
  const seen = new Set()
  const sections = parts.filter((s) => (seen.has(s.number) ? false : seen.add(s.number)))
  const base = results.find((r) => r.module === 'listening')
  return finish({ module: 'listening', title: base?.title || 'Listening test', sections, warnings: results.flatMap((r) => r.warnings || []) })
}

/* ------------------------------------------------------------------ */
/* Saving                                                               */
/* ------------------------------------------------------------------ */

const dataUrlToBlob = (url) => {
  const [head, b64] = url.split(',')
  const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

async function uploadBlob(supabase, userId, blob, name) {
  const path = `${userId}/mock-import/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${name}`
  const { error } = await supabase.storage.from('homework-files').upload(path, blob, { contentType: blob.type || undefined })
  if (error) throw error
  return supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
}

/**
 * Write one parsed Listening / Reading test. `audioFiles` maps a section
 * index to an mp3 File the teacher dropped in. Returns the new exam id.
 * Everything made is removed again if a step fails.
 */
export async function saveImportedExam(supabase, { parsed, title, userId, audioFiles = {}, active = true }) {
  const { data: exam, error: e1 } = await supabase
    .from('mock_exams')
    .insert({ title, module: parsed.module, bank: 'mock', is_active: active, sort_order: 0, randomize_questions: false, questions_per_section: null })
    .select('id')
    .single()
  if (e1) throw e1
  try {
    for (let si = 0; si < parsed.sections.length; si++) {
      const s = parsed.sections[si]
      let audio = s.audio_url || null
      if (audioFiles[si]) audio = await uploadBlob(supabase, userId, audioFiles[si], `part${si + 1}.${(audioFiles[si].name || 'a.mp3').split('.').pop()}`)
      const { data: sec, error: e2 } = await supabase
        .from('mock_sections')
        .insert({ exam_id: exam.id, order_index: si, title: s.title, passage_text: parsed.module === 'reading' ? s.passage_text : null, audio_url: parsed.module === 'listening' ? audio : null })
        .select('id')
        .single()
      if (e2) throw e2
      let order = 0
      for (let gi = 0; gi < s.groups.length; gi++) {
        const g = s.groups[gi]
        let image = g.image || null
        if (image && /^data:/.test(image)) image = await uploadBlob(supabase, userId, dataUrlToBlob(image), `map-${si + 1}-${gi + 1}.${(/image\/(\w+)/.exec(image) || [])[1] || 'png'}`)
        const { data: grp, error: e3 } = await supabase
          .from('mock_question_groups')
          .insert({
            section_id: sec.id,
            order_index: gi,
            kind: g.kind || 'other',
            word_limit: g.word_limit || null,
            title: g.title || null,
            instruction: g.instruction || null,
            options_reusable: !!g.options_reusable,
            body: g.body || null,
            image_url: image,
          })
          .select('id')
          .single()
        if (e3) throw e3
        const rows = g.questions.map((q) => ({
          section_id: sec.id,
          group_id: grp.id,
          order_index: order++,
          type: q.type,
          prompt: q.prompt || '',
          options: q.options || null,
          correct_answer: q.correct_answer || '',
          accepted_answers: q.accepted_answers || [],
        }))
        if (rows.length) {
          const { error: e4 } = await supabase.from('mock_questions').insert(rows)
          if (e4) throw e4
        }
      }
    }
    return exam.id
  } catch (err) {
    await supabase.from('mock_exams').delete().eq('id', exam.id)
    throw err
  }
}

export { uploadBlob, dataUrlToBlob }
