/*
 * FULL MOCK FROM ONE FILE (2026-11-16).
 * Jasur: "these should be mocks like in the mock centre" — one of Mr
 * Ikromov's "Full Mock Test N" pages (Listening + Reading + Writing in one
 * html file) becomes one full mock set on the site, built into the real exam
 * screen, nothing retyped.
 *
 * The file is only ever READ here. Its own scripts run inside a sandboxed
 * iframe with no access to the site (no cookies, no storage, no network
 * calls from us); the result comes back as plain data and is turned into the
 * same shape parseMockHtml() gives, so saveImportedExam() can store it.
 *
 *   parseFullMock(text)  ->  { title, listening, reading, writing, warnings,
 *                              problems, audio (data: URL), engine }
 *   saveFullMock(supabase, { parsed, userId, active })  ->  { setId, ... }
 */
import { clean, line, inlineText, bodyLines, promptFromBody, gapKind, matchKind, wordLimitOf, uploadBlob, dataUrlToBlob } from './mockHtmlImport.js'

/* ------------------------------------------------------------------ */
/* Sandbox                                                              */
/* ------------------------------------------------------------------ */

const BOOT = `<script>
(function(){
  try{var m={};var st={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},setItem:function(k,v){m[k]=String(v)},removeItem:function(k){delete m[k]},clear:function(){m={}},key:function(){return null},length:0};
  Object.defineProperty(window,'localStorage',{value:st,configurable:true});Object.defineProperty(window,'sessionStorage',{value:st,configurable:true});}catch(e){}
  window.addEventListener('message',function(e){var d=e.data||{};if(d.t!=='eval')return;var r;
    try{r={t:'result',id:d.id,ok:true,v:(0,eval)(d.code)}}catch(err){r={t:'result',id:d.id,ok:false,e:String(err&&err.message||err)}}
    try{e.source.postMessage(r,'*')}catch(err2){e.source.postMessage({t:'result',id:d.id,ok:false,e:'result could not be sent: '+err2.message},'*')}});
})();
<\/script>`

function openSandbox(appHtml) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:1200px;height:900px;border:0;visibility:hidden'
    let html = appHtml || '<!doctype html><html><head></head><body></body></html>'
    const at = html.search(/<head[^>]*>/i)
    if (at >= 0) {
      const end = html.indexOf('>', at) + 1
      html = html.slice(0, end) + BOOT + html.slice(end)
    } else html = BOOT + html
    let n = 0
    const waiting = new Map()
    const onMsg = (e) => {
      if (e.source !== frame.contentWindow) return
      const d = e.data
      if (d?.t === 'result' && waiting.has(d.id)) {
        const w = waiting.get(d.id)
        waiting.delete(d.id)
        clearTimeout(w.timer)
        if (d.ok) w.resolve(d.v)
        else w.reject(new Error(d.e))
      }
    }
    window.addEventListener('message', onMsg)
    const api = {
      call(code, ms = 60000) {
        return new Promise((res, rej) => {
          const id = ++n
          const timer = setTimeout(() => {
            waiting.delete(id)
            rej(new Error('The page took too long to answer.'))
          }, ms)
          waiting.set(id, { resolve: res, reject: rej, timer })
          frame.contentWindow.postMessage({ t: 'eval', id, code }, '*')
        })
      },
      close() {
        window.removeEventListener('message', onMsg)
        frame.remove()
      },
    }
    frame.addEventListener('load', () => setTimeout(() => resolve(api), appHtml ? 1200 : 50), { once: true })
    frame.addEventListener('error', () => reject(new Error('Could not open the page.')), { once: true })
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}

async function evalData(code) {
  const box = await openSandbox('')
  try {
    return await box.call(code)
  } finally {
    box.close()
  }
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                         */
/* ------------------------------------------------------------------ */

const parseHtml = (html) => new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html')
const textOf = (html) => clean(parseHtml(html).body.textContent)

// "<b>A</b><br>text" → [{ text, bold }] one entry per line.
function htmlLines(html) {
  const root = parseHtml(html).body
  const out = []
  let cur = { text: '', bold: true, any: false }
  const flush = () => {
    const t = clean(cur.text)
    if (t) out.push({ text: t, bold: cur.bold && cur.any })
    cur = { text: '', bold: true, any: false }
  }
  const walk = (node, inBold) => {
    node.childNodes.forEach((ch) => {
      if (ch.nodeType === 3) {
        const t = ch.textContent
        if (clean(t)) {
          cur.any = true
          if (!inBold) cur.bold = false
        }
        cur.text += t
      } else if (ch.nodeType === 1) {
        if (ch.tagName === 'BR') flush()
        else walk(ch, inBold || ch.tagName === 'B' || ch.tagName === 'STRONG')
      }
    })
  }
  walk(root, false)
  flush()
  return out
}

// Keeps the real instruction, drops what the computer test never shows.
function tidyText(text) {
  const t = clean(text)
  const sentences = t.split(/(?<=[.?!])\s+/)
  return sentences
    .filter((s) => s && !/answer sheet|\bin boxes?\b|next to questions?\s+\d|^move\b.*\b(gaps?|box)\b/i.test(s))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function limitOf(text) {
  const t = clean(text)
    .replace(/(WORDS?)\s*\/\s*NUMBERS?/gi, '$1 AND/OR A NUMBER')
    .replace(/AND\/OR NUMBERS/gi, 'AND/OR A NUMBER')
  return wordLimitOf(t)
}

const letterOf = (c) => /^\s*([A-Za-z]{1,4})[.)]?(\s|$)/.exec(c)?.[1] || ''
const byLetter = (choices, l) => choices.find((c) => letterOf(c).toUpperCase() === String(l || '').trim().toUpperCase()) || ''
const altsOf = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split('|'))
    .map((a) => clean(a))
    .filter(Boolean)
const textQuestion = (number, prompt, v) => {
  const a = altsOf(v)
  return { number, type: 'short_answer', prompt, options: null, correct_answer: a[0] || '', accepted_answers: a.slice(1) }
}
const matchQuestion = (number, prompt, choices, letter) => ({ number, type: 'matching', prompt, options: { choices }, correct_answer: byLetter(choices, altsOf(letter)[0]), accepted_answers: [] })

/* ------------------------------------------------------------------ */
/* Outer file                                                           */
/* ------------------------------------------------------------------ */

function objectAfter(src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) return null
  const start = src.indexOf('{', at)
  let depth = 0
  let q = ''
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = ''
      continue
    }
    if (c === "'" || c === '"' || c === '`') q = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  return null
}

function appsLiteral(src) {
  const at = src.indexOf('const APPS')
  if (at < 0) return null
  const start = src.indexOf('{', at)
  let from = src.indexOf('reading:', start)
  while (from >= 0) {
    const i = src.indexOf('`\n};', from)
    if (i < 0) return null
    if (src[i - 1] !== '\\') return src.slice(start, i + 3)
    from = i + 1
  }
  return null
}

function writingImage(src) {
  const at = src.indexOf('id="scWriting"')
  if (at < 0) return { src: '', alt: '' }
  const i = src.indexOf('<img', at)
  if (i < 0) return { src: '', alt: '' }
  const tag = src.slice(i, src.indexOf('>', i) + 1)
  return { src: /\ssrc="([^"]+)"/.exec(tag)?.[1] || '', alt: /\salt="([^"]*)"/.exec(tag)?.[1] || '' }
}

/* ------------------------------------------------------------------ */
/* Reading (the "universal engine" data)                                 */
/* ------------------------------------------------------------------ */

function passageText(p) {
  const root = parseHtml(p?.content).body
  const paras = []
  let subtitle = ''
  root.querySelectorAll('p, h2, h3, h4, li').forEach((el) => {
    if (el.closest('p') && el.tagName !== 'P') return
    const letter = clean(el.querySelector('.para-letter')?.textContent)
    const copy = el.cloneNode(true)
    copy.querySelectorAll('.para-letter').forEach((x) => x.remove())
    const text = clean(copy.textContent)
    if (!text) return
    const onlyEm = el.children.length === 1 && el.firstElementChild.tagName === 'EM' && clean(el.textContent) === clean(el.firstElementChild.textContent)
    if (onlyEm && !paras.length && !subtitle) subtitle = text
    else paras.push({ key: /^[A-Z]$/.test(letter) ? letter : '', text })
  })
  const lettered = paras.length > 0 && paras.every((x) => x.key)
  let body
  if (lettered) {
    const blocks = []
    paras.forEach((x) => {
      const last = blocks[blocks.length - 1]
      if (last && last.key === x.key) last.texts.push(x.text)
      else blocks.push({ key: x.key, texts: [x.text] })
    })
    body = blocks.map((b) => `${b.key}\n\n${b.texts.join('\n\n')}`).join('\n\n')
  } else body = paras.map((x) => x.text).join('\n\n')
  return subtitle ? `${subtitle}\n\n${body}` : body
}

// "…the royal antelope? 9 _____" — the number and underline are the old gap.
const tidyLabel = (h) => String(h || '').replace(/\s*\d+\s*_{2,}\s*$/, '')

function explanationOf(e) {
  if (!e) return null
  const out = { en: '', uz: '', ru: '' }
  const strip = (h) => clean(parseHtml(h).body.textContent)
  if (e.en || e.uz || e.ru) {
    out.en = strip(e.en)
    out.uz = strip(e.uz)
    out.ru = strip(e.ru)
  }
  if (!out.en && e.explanation) {
    const body = parseHtml(e.explanation).body
    const divs = [...body.querySelectorAll('div')]
    divs.forEach((d) => {
      const t = clean(d.textContent)
      if (/^O[ʻ'’`]?zbekcha/i.test(t)) out.uz = t.replace(/^O[ʻ'’`]?zbekcha:?\s*/i, '')
      else if (/^По-русски/i.test(t)) out.ru = t.replace(/^По-русски:?\s*/i, '')
      d.remove()
    })
    out.en = clean(body.textContent)
  }
  return out.en || out.uz || out.ru ? out : null
}

function readingGroups(sectionsOfPassage, passage, explanations, warnings, pi) {
  const groups = []
  const explain = (q) => {
    const ex = explanationOf(explanations?.[q.number])
    if (ex) q.explanation = ex
    return q
  }
  for (const s of sectionsOfPassage) {
    const full = textOf(s.instruction)
    const instruction = tidyText(full)
    const items = s.items || []
    const t = s.type
    if (t === 'tfng' || t === 'ynng') {
      const map = t === 'tfng' ? { TRUE: 'True', FALSE: 'False', 'NOT GIVEN': 'Not Given' } : { YES: 'Yes', NO: 'No', 'NOT GIVEN': 'Not Given' }
      groups.push({
        kind: t,
        instruction: '',
        questions: items.map((it) => explain({ number: it.id, type: t === 'tfng' ? 'true_false_ng' : 'yes_no_ng', prompt: textOf(it.label), options: null, correct_answer: map[String(it.answer).trim().toUpperCase()] || it.answer, accepted_answers: [] })),
      })
    } else if (t === 'mcq') {
      groups.push({
        kind: 'mcq_single',
        instruction,
        questions: items.map((it) => {
          const choices = (it.options || []).map((o) => textOf(o))
          return explain({ number: it.id, type: 'multiple_choice', prompt: textOf(it.label), options: { choices }, correct_answer: byLetter(choices, it.answer), accepted_answers: [] })
        }),
      })
    } else if (t === 'mcq-multi') {
      const choices = (s.options || []).map((o) => `${o.l} ${textOf(o.t)}`)
      const letters = items.map((it) => String(it.answer).trim().toUpperCase())
      const q = { number: items[0].id, type: 'multi_select', prompt: textOf(s.prompt), options: { choices }, correct_answer: choices.filter((c) => letters.includes(letterOf(c).toUpperCase())).join(', '), accepted_answers: [], width: items.length }
      const ex = items.map((it) => explanationOf(explanations?.[it.id])).find(Boolean)
      if (ex) q.explanation = ex
      groups.push({ kind: 'mcq_multi', instruction, questions: [q] })
    } else if (t === 'matching-info') {
      const choices = (s.options || []).map((o) => String(o))
      groups.push({ kind: 'matching_info', instruction, options_reusable: true, questions: items.map((it) => explain(matchQuestion(it.id, textOf(it.label), choices, it.answer))) })
    } else if (t === 'matching-features') {
      const choices = (s.people || []).map((p) => `${p.l} ${textOf(p.name)}`)
      groups.push({ kind: 'matching_features', instruction, options_reusable: /more than once/i.test(full), questions: items.map((it) => explain(matchQuestion(it.id, textOf(it.label), choices, it.answer))) })
    } else if (t === 'sentence-endings') {
      const choices = (s.endings || []).map((e) => `${e.l} ${textOf(e.text)}`)
      groups.push({ kind: 'matching_sentence_endings', instruction, options_reusable: false, questions: items.map((it) => explain(matchQuestion(it.id, textOf(it.label), choices, it.answer))) })
    } else if (t === 'matching-headings') {
      const choices = (passage?.headings || []).map((h) => `${h.id} ${textOf(h.text)}`)
      const slot = Object.fromEntries((passage?.headingSlots || []).map((x) => [x.qNum, x.letter]))
      groups.push({
        kind: 'matching_headings',
        instruction,
        options_reusable: false,
        questions: items.map((it) => {
          const letter = slot[it.id] || /Section\s+([A-Z])/i.exec(textOf(it.label))?.[1] || ''
          if (!letter) warnings.push(`Question ${it.id}: could not find which paragraph it belongs to.`)
          return explain({ number: it.id, type: 'matching', prompt: `Paragraph ${letter || '?'}`, options: { choices }, correct_answer: byLetter(choices, it.answer), accepted_answers: [] })
        }),
      })
    } else if ((t === 'notes' || t === 'summary') && /answer the questions?/i.test(full)) {
      groups.push({
        kind: 'short_answer',
        instruction,
        word_limit: limitOf(full),
        questions: items.map((it) => explain(textQuestion(it.id, line(`${tidyLabel(it.label)} ${textOf(it.after)}`), it.answer))),
      })
    } else if (t === 'notes' || t === 'summary') {
      const asParagraph = t === 'summary' || /\bsummary\b/i.test(full)
      const lines = []
      const order = []
      const noteTitle = textOf(s.noteTitle)
      if (!asParagraph) {
        items.forEach((it) => {
          const ls = htmlLines(tidyLabel(it.label))
          ls.slice(0, -1).forEach((l) => lines.push(l.bold ? `## ${l.text}` : `- ${l.text}`))
          const last = ls[ls.length - 1]
          lines.push(line(`- ${last ? last.text : ''} [[ ]] ${textOf(it.after)}`))
          order.push(it.id)
        })
      } else {
        const para = items
          .map((it) => {
            order.push(it.id)
            return `${textOf(tidyLabel(it.label))} [[ ]] ${textOf(it.after)}`
          })
          .join(' ')
        lines.push(line(para))
      }
      groups.push({
        kind: asParagraph ? 'summary_completion' : 'note_completion',
        title: noteTitle,
        instruction,
        word_limit: limitOf(full),
        body: lines.join('\n'),
        questions: items.map((it) => explain(textQuestion(it.id, promptFromBody(lines, it.id, order), it.answer))),
      })
    } else if (t === 'sentence') {
      groups.push({
        kind: 'sentence_completion',
        instruction,
        word_limit: limitOf(full),
        questions: items.map((it) => {
          const before = textOf(tidyLabel(it.label))
          const after = textOf(it.after)
          return explain(textQuestion(it.id, line(`${before} ______ ${after}`), it.answer))
        }),
      })
    } else if (t === 'wordbank') {
      const choices = (s.bank || []).map((b) => `${b.id} ${textOf(b.word)}`)
      const prose = String(s.prose || '')
      const order = []
      const lines = [
        line(
          textOf(prose.replace(/\{\{(\d+)\}\}/g, (m, n) => {
            order.push(Number(n))
            return ' [[ ]] '
          }))
        ),
      ]
      groups.push({
        kind: 'summary_completion',
        title: textOf(s.noteTitle),
        instruction,
        options_reusable: false,
        body: lines.join('\n'),
        questions: items.map((it) => explain(matchQuestion(it.id, promptFromBody(lines, it.id, order), choices, it.answer))),
      })
    } else {
      warnings.push(`Passage ${pi + 1}: a question type ("${t}") is not supported yet.`)
    }
  }
  return groups
}

async function parseReading(readingApp, warnings) {
  const s = readingApp.indexOf('const ExamApp = (function() {')
  const a = readingApp.indexOf('const SECTIONS', s < 0 ? 0 : s)
  const b = readingApp.indexOf('const state', a)
  if (a < 0 || b < 0) throw new Error('The Reading part of this file is in a layout the site does not know.')
  const data = await evalData(`(function(){${readingApp.slice(a, b)};return JSON.parse(JSON.stringify({SECTIONS:SECTIONS,PASSAGES:PASSAGES,READING_EXPLANATIONS:READING_EXPLANATIONS}))})()`)
  const sections = Object.keys(data.SECTIONS)
    .sort((x, y) => x - y)
    .map((k, pi) => {
      const passage = data.PASSAGES[k]
      return { number: pi + 1, title: clean(passage?.title) || `Passage ${pi + 1}`, passage_text: passageText(passage), groups: readingGroups(data.SECTIONS[k], passage, data.READING_EXPLANATIONS, warnings, pi) }
    })
  return { module: 'reading', title: 'Reading', sections, warnings: [] }
}

/* ------------------------------------------------------------------ */
/* Listening                                                             */
/* ------------------------------------------------------------------ */

// Gaps that are really drag boxes become plain gap inputs so one reader handles all.
function squash(root) {
  const w = root.ownerDocument.createTreeWalker(root, 4)
  const list = []
  while (w.nextNode()) list.push(w.currentNode)
  list.forEach((n) => (n.textContent = n.textContent.replace(/\s+/g, ' ')))
}

// "Diamond Head: it can get busy – book ______ in advance." for a table cell.
function promptFor(lines, n, order) {
  let k = 0
  for (const l of lines) {
    const count = (l.match(/\[\[ \]\]/g) || []).length
    for (let i = 0; i < count; i++, k++) {
      if (order[k] !== n || !l.startsWith('|')) continue
      const cells = l.split('|').slice(1, -1).map((c) => c.trim())
      let seen = 0
      let idx = 0
      for (let c = 0; c < cells.length; c++) {
        const cnt = (cells[c].match(/\[\[ \]\]/g) || []).length
        if (i < seen + cnt) {
          idx = c
          break
        }
        seen += cnt
      }
      let j = i - seen
      const text = cells[idx].replace(/\[\[ \]\]/g, () => (j-- === 0 ? '______' : '…'))
      const first = cells[0]
      return clean((idx > 0 && first && !/\[\[/.test(first) ? `${first}: ` : '') + text)
    }
  }
  return promptFromBody(lines, n, order)
}

function prepare(root, doc) {
  squash(root)
  root.querySelectorAll('.feedback-pill, .flag-btn, button, svg, .kb-help, .drag-num-hint, .flow-arrow').forEach((x) => x.remove())
  root.querySelectorAll('input[data-lq]').forEach((i) => {
    if (i.type !== 'hidden') i.setAttribute('data-q', i.getAttribute('data-lq'))
  })
  root.querySelectorAll('.sub, .subh, .subhead').forEach((x) => x.classList.add('notes-sub'))
  root.querySelectorAll('.flow-title').forEach((x) => x.classList.add('notes-title'))
  root.querySelectorAll('.drag-drop[data-q]').forEach((d) => {
    if (d.closest('.drag-item-row')) return
    const input = doc.createElement('input')
    input.setAttribute('type', 'text')
    input.setAttribute('data-q', d.getAttribute('data-q'))
    d.replaceWith(input)
  })
  // "-&nbsp;text<br>…" runs become real lines.
  root.querySelectorAll('.note-flow').forEach((flow) => {
    const out = doc.createElement('div')
    let li = doc.createElement('li')
    const flush = () => {
      if (clean(li.textContent) || li.querySelector('input')) {
        let first = li.firstChild
        while (first && first.nodeType === 3 && !clean(first.textContent)) {
          first.remove()
          first = li.firstChild
        }
        if (first && first.nodeType === 1 && /^(B|STRONG)$/.test(first.tagName) && /^\d+$/.test(clean(first.textContent))) {
          first.remove()
          first = li.firstChild
        }
        if (first && first.nodeType === 3) first.textContent = first.textContent.replace(/^\s*[-–•]?\s*/, '')
        out.appendChild(li)
      }
      li = doc.createElement('li')
    }
    ;[...flow.childNodes].forEach((n) => {
      if (n.nodeType === 1 && n.tagName === 'BR') flush()
      else if (n.nodeType === 1 && n.classList.contains('subhead')) {
        flush()
        const h = doc.createElement('div')
        h.className = 'notes-sub'
        h.textContent = clean(n.textContent)
        out.appendChild(h)
      } else li.appendChild(n.cloneNode(true))
    })
    flush()
    flow.replaceWith(out)
  })
}

function gapGroup({ root, instruction, full, title, image, answerOf, choices, doc, lead = '' }) {
  prepare(root, doc)
  const hasTable = !!root.querySelector('table') || root.tagName === 'TABLE'
  const hasFlow = !!root.querySelector('.flow-chart, .flow-box') || root.classList.contains('flow-chart')
  const kindText = hasTable ? full : full.replace(/\btable\b/gi, '')
  let kind = gapKind(kindText, { hasTable, hasFlow, hasImage: !!image })
  // "Complete the table" over a form, or no kind word at all: it is notes.
  if (kind === 'sentence_completion' && !/\bsentences?\b/i.test(full) && !choices?.length) kind = 'note_completion'
  const order = []
  const lines = bodyLines(root, order)
  let heading = title || ''
  if (lines[0]?.startsWith('# ')) heading = heading || lines.shift().slice(2)
  const body = (lead ? [lead, ...lines] : lines).join('\n')
  const questions = order.map((n) => {
    const a = answerOf(n)
    const prompt = promptFor(lines, n, order)
    if (choices?.length) return matchQuestion(n, prompt, choices, a)
    return textQuestion(n, prompt, a)
  })
  return { kind: choices?.length ? (hasFlow ? 'flow_chart' : kind) : kind, title: heading, instruction, word_limit: choices?.length ? null : limitOf(full), body, image: image || '', questions }
}

/* --- Engine A: pages drawn by ExamApp.jumpToListeningPart (section-block) --- */

function chunksA(html, doc) {
  const box = doc.createElement('div')
  box.innerHTML = html
  const chunks = []
  box.querySelectorAll('.section-block').forEach((blk) => {
    let cur = null
    ;[...blk.children].forEach((el) => {
      if (el.classList.contains('section-head')) {
        cur = { head: el, nodes: [] }
        chunks.push(cur)
      } else if (cur) cur.nodes.push(el)
    })
  })
  return chunks
}

function groupA(chunk, answers, doc, warnings, partNo) {
  const head = chunk.head
  const instrTexts = [...head.querySelectorAll('.instruction')].map((e) => clean(e.textContent)).filter(Boolean)
  const isMain = (t) => /\b(complete|choose|write|label|move|answer|match|select|which|what|how)\b/i.test(t)
  const mainTexts = instrTexts.filter(isMain)
  const lead = instrTexts.filter((t) => !isMain(t)).join(' ')
  const full = (mainTexts.length ? mainTexts : instrTexts).join(' ')
  const instruction = tidyText(full)
  const title = clean(head.querySelector('h2')?.textContent)
  const root = doc.createElement('div')
  chunk.nodes.forEach((n) => root.appendChild(n.cloneNode(true)))
  const ans = (n) => answers[String(n)]

  // Choose TWO.
  const ms = [...root.querySelectorAll('.ms-group')]
  if (ms.length) {
    return {
      kind: 'mcq_multi',
      title,
      instruction,
      questions: ms.map((g) => {
        const ids = (g.dataset.msIds || '').split(',').map(Number).filter(Boolean)
        const choices = [...g.querySelectorAll('label.option')].map((l) => clean(`${clean(l.querySelector('.opt-letter')?.textContent)} ${clean([...l.querySelectorAll('span:not(.opt-letter)')].map((s) => s.textContent).join(' '))}`))
        const letters = ids.flatMap((id) => altsOf(ans(id)).map((x) => x.toUpperCase()))
        return { number: ids[0], type: 'multi_select', prompt: clean(g.querySelector('.q-text')?.textContent), options: { choices }, correct_answer: choices.filter((c) => letters.includes(letterOf(c).toUpperCase())).join(', '), accepted_answers: [], width: ids.length }
      }),
    }
  }

  // One-answer multiple choice.
  const cards = [...root.querySelectorAll('.q-card')].filter((c) => c.querySelector('input[type=radio]'))
  if (cards.length) {
    return {
      kind: 'mcq_single',
      title,
      instruction,
      questions: cards.map((c) => {
        const n = Number(c.querySelector('input[type=radio]').dataset.q || clean(c.querySelector('.q-pill')?.textContent))
        const choices = [...c.querySelectorAll('label.option')].map((l) => {
          const letter = clean(l.querySelector('.opt-letter')?.textContent)
          const copy = l.cloneNode(true)
          copy.querySelectorAll('.opt-letter, input').forEach((x) => x.remove())
          return clean(`${letter} ${copy.textContent}`)
        })
        return { number: n, type: 'multiple_choice', prompt: clean(c.querySelector('.q-text')?.textContent), options: { choices }, correct_answer: byLetter(choices, altsOf(ans(n))[0]), accepted_answers: [] }
      }),
    }
  }

  // Dragging: the options in a box, one row per question or gaps in a flow-chart.
  const chips = [...root.querySelectorAll('.drag-chip')]
  const choices = chips.map((c) => {
    const l = clean(c.querySelector('.eh-opt-l, b')?.textContent) || clean(c.dataset.val)
    const t = clean(c.querySelector('.eh-opt-t')?.textContent) || clean(c.textContent).replace(new RegExp(`^${l}\\s*`), '')
    return clean(`${l} ${t === l ? '' : t}`)
  })
  const image = root.querySelector('.eh-diagram img')?.getAttribute('src') || ''
  const rows = [...root.querySelectorAll('.drag-item-row')]
  if (rows.length) {
    const kind = image ? 'map_labelling' : matchKind(full)
    return {
      kind,
      title,
      instruction,
      options_reusable: /more than once/i.test(full),
      image,
      questions: rows.map((r) => {
        const n = Number(r.querySelector('.drag-drop')?.dataset.q)
        return matchQuestion(n, clean(r.querySelector('.drag-item-label')?.textContent), choices, ans(n))
      }),
    }
  }

  const hasGaps = root.querySelector('input[data-lq], .drag-drop[data-q]')
  if (hasGaps) {
    const wrap = root.querySelector('.flow-chart') || root
    const flowTitle = clean(root.querySelector('.flow-title')?.textContent)
    const g = gapGroup({ root: wrap, instruction, full, title: title || flowTitle, image, answerOf: ans, choices: root.querySelector('.drag-drop[data-q]') ? choices : null, doc, lead })
    if (root.querySelector('.drag-drop[data-q]')) g.options_reusable = /more than once/i.test(full)
    return g
  }
  warnings.push(`Part ${partNo}: "${clean(head.textContent).slice(0, 60)}" has no questions the site can read.`)
  return null
}

/* --- Engine B: .qgroup blocks with a KEY --- */

function groupB(el, key, pairs, doc, warnings, partNo) {
  const h2 = clean(el.querySelector('h2')?.textContent)
  const instrEl = el.querySelector('.instr')
  const full = clean(instrEl?.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
  const instruction = tidyText(full)
  const title = clean(el.querySelector('.centered-title')?.textContent)
  const keyOf = (n) => key[String(n)]
  const root = el.cloneNode(true)
  root.querySelectorAll('h2, .instr, .centered-title').forEach((x) => x.remove())

  // Choose TWO.
  const pairBoxes = [...root.querySelectorAll('input.pair-choice')]
  if (pairBoxes.length) {
    const byNums = {}
    pairBoxes.forEach((p) => (byNums[p.dataset.nums] = byNums[p.dataset.nums] || []).push(p))
    return {
      kind: 'mcq_multi',
      title,
      instruction,
      questions: Object.entries(byNums).map(([nums, list]) => {
        const ids = nums.split(',').map(Number)
        const choices = list.map((p) => {
          const lab = p.closest('label')
          return clean(`${clean(lab.querySelector('strong')?.textContent)} ${clean(lab.textContent).replace(/^[A-Z]\s*/, '')}`)
        })
        const pair = pairs.find((g) => g.nums.join() === ids.join())
        const letters = (pair?.answers || ids.flatMap((id) => keyOf(id) || [])).map((x) => String(x).toUpperCase())
        const stem = clean(list[0].closest('.q-item')?.querySelector('.q-stem span:not(.q-num)')?.textContent)
        return { number: ids[0], type: 'multi_select', prompt: stem, options: { choices }, correct_answer: choices.filter((c) => letters.includes(letterOf(c).toUpperCase())).join(', '), accepted_answers: [], width: ids.length }
      }),
    }
  }

  // One-answer multiple choice.
  const items = [...root.querySelectorAll('.q-item')].filter((q) => q.querySelector('input[type=radio]') && !q.querySelector('table'))
  if (items.length) {
    return {
      kind: 'mcq_single',
      title,
      instruction,
      questions: items.map((q) => {
        const n = Number(clean(q.querySelector('.q-num')?.textContent) || q.querySelector('input[type=radio]').name.replace(/\D/g, ''))
        const choices = [...q.querySelectorAll('label.opt')].map((l) => clean(`${clean(l.querySelector('strong')?.textContent)} ${clean(l.textContent).replace(/^[A-Z]\s*/, '')}`))
        return { number: n, type: 'multiple_choice', prompt: clean(q.querySelector('.q-stem span:not(.q-num)')?.textContent), options: { choices }, correct_answer: byLetter(choices, (keyOf(n) || [])[0]), accepted_answers: [] }
      }),
    }
  }

  // Letter grid (matching, map or diagram labelling).
  const grid = root.querySelector('table.matchgrid')
  if (grid) {
    const image = root.querySelector('.diagram-img')?.getAttribute('src') || ''
    const orows = [...root.querySelectorAll('.optbox .orow')].map((r) => clean(`${clean(r.querySelector('strong')?.textContent)} ${clean(r.textContent).replace(/^[A-Z]\s*/, '')}`))
    const letters = [...grid.querySelectorAll('thead th')].map((t) => clean(t.textContent)).filter((t) => /^[A-Z]$/.test(t))
    const choices = orows.length ? orows : letters
    const kind = image ? gapKind(full, { hasImage: true }) : matchKind(full)
    return {
      kind,
      title,
      instruction,
      options_reusable: /more than once/i.test(full),
      image,
      questions: [...grid.querySelectorAll('tbody tr')].map((tr) => {
        const n = Number(tr.querySelector('td.letter')?.dataset.q)
        const copy = tr.querySelector('td.sb').cloneNode(true)
        copy.querySelectorAll('.num').forEach((x) => x.remove())
        return matchQuestion(n, clean(copy.textContent), choices, (keyOf(n) || [])[0])
      }),
    }
  }

  // Gaps.
  if (root.querySelector('input.gap, input[data-q]')) {
    const wrap = root.querySelector('.notes') || root
    const g = gapGroup({ root: wrap, instruction, full, title, image: root.querySelector('.diagram-img')?.getAttribute('src') || '', answerOf: keyOf, choices: null, doc })
    return g
  }
  warnings.push(`Part ${partNo}: "${h2}" has no questions the site can read.`)
  return null
}

async function parseListening(app, warnings) {
  const audioMatch = /data:audio\/[a-z0-9.+\-]+;base64,[A-Za-z0-9+/=]+/i.exec(app)
  const audio = audioMatch ? audioMatch[0] : ''
  const slim = audioMatch ? app.replace(audio, '') : app
  const doc = document.implementation.createHTMLDocument('')
  const isA = /const\s+LISTENING_ANSWERS/.test(app)
  const isB = /const\s+KEY\s*=/.test(app) && /L_HTML|\.lwrap/.test(app)
  if (!isA && !isB) throw new Error('The Listening part of this file is in a layout the site does not know.')
  const sections = []
  let transcript = null
  if (isA) {
    const a = app.indexOf('const LISTENING_ANSWERS')
    const b = app.indexOf('const STORAGE_KEY', a)
    const data = await evalData(`(function(){${app.slice(a, b)};return JSON.parse(JSON.stringify({A:LISTENING_ANSWERS,T:(typeof TRANSCRIPT!=='undefined'?TRANSCRIPT:null)}))})()`)
    const box = await openSandbox(slim)
    let htmls
    try {
      htmls = await box.call(`(function(){var o=[];for(var n=1;n<=4;n++){ExamApp.jumpToListeningPart(n);o.push(document.getElementById('listening-render').innerHTML)}return o})()`)
    } finally {
      box.close()
    }
    htmls.forEach((h, i) => {
      const groups = chunksA(h, doc).map((c) => groupA(c, data.A, doc, warnings, i + 1)).filter(Boolean)
      sections.push({ number: i + 1, title: `Part ${i + 1}`, groups })
    })
    transcript = data.T
  } else {
    const box = await openSandbox(slim)
    let data
    try {
      data = await box.call(`(function(){var p=[];for(var n=1;n<=4;n++){var el=document.querySelector('#screen-'+n+' .lwrap');p.push(el?el.innerHTML:'')}return {K:JSON.parse(JSON.stringify(KEY)),G:(typeof GROUPS!=='undefined'?JSON.parse(JSON.stringify(GROUPS)):[]),P:p}})()`)
    } finally {
      box.close()
    }
    data.P.forEach((h, i) => {
      const holder = doc.createElement('div')
      holder.innerHTML = h
      const groups = [...holder.querySelectorAll('.qgroup')].map((g) => groupB(g, data.K, data.G, doc, warnings, i + 1)).filter(Boolean)
      sections.push({ number: i + 1, title: `Part ${i + 1}`, groups })
    })
  }
  // The transcript, one list per Part.
  if (Array.isArray(transcript) && transcript.length) {
    const lists = []
    let cur = null
    transcript.forEach((l) => {
      if (l.type === 'break') {
        cur = []
        lists.push(cur)
      } else {
        if (!cur) {
          cur = []
          lists.push(cur)
        }
        cur.push({ sp: l.sp || '', tx: clean(String(l.tx || '').replace(/<[^>]+>/g, '')) })
      }
    })
    sections.forEach((s, i) => {
      const t = lists[i]
      if (t && t.length) s.transcript = t
    })
  }
  return { module: 'listening', title: 'Listening', sections, warnings: [], audio, engine: isA ? 'A' : 'B', hasTranscript: !!(transcript && transcript.length) }
}

/* ------------------------------------------------------------------ */
/* Entry point + checks                                                  */
/* ------------------------------------------------------------------ */

const widthOf = (q) => (q.type === 'multi_select' ? q.width || 1 : 1)

function check(part, problems, label) {
  const nums = []
  part.sections.forEach((s) => {
    s.groups.forEach((g) =>
      g.questions.forEach((q) => {
        if (!clean(q.correct_answer)) problems.push(`${label} question ${q.number}: no answer in the file's key.`)
        if (q.options?.choices && !q.options.choices.length) problems.push(`${label} question ${q.number}: no options found.`)
        for (let i = 0; i < widthOf(q); i++) nums.push(q.number + i)
      })
    )
    s.count = s.groups.reduce((n, g) => n + g.questions.reduce((m, q) => m + widthOf(q), 0), 0)
  })
  part.count = nums.length
  const sorted = [...nums].sort((a, b) => a - b)
  const dup = sorted.filter((n, i) => i && n === sorted[i - 1])
  if (dup.length) problems.push(`${label}: question ${[...new Set(dup)].join(', ')} appear twice.`)
  for (let n = 1; n <= 40; n++) if (!nums.includes(n)) problems.push(`${label}: question ${n} is missing.`)
  if (nums.length !== 40) problems.push(`${label} has ${nums.length} questions, not 40.`)
}

export async function parseFullMock(text) {
  const src = String(text || '')
  const warnings = []
  const problems = []
  const lit = appsLiteral(src)
  if (!lit || !/MOCK_TITLE/.test(src)) return { error: 'This is not one of the "Full Mock Test" files (it needs the Listening and Reading screens inside).' }
  const title = /const\s+MOCK_TITLE\s*=\s*['"]([^'"]+)['"]/.exec(src)?.[1] || 'Full Mock Test'
  const minutes = Number(/const\s+WRITING_MINUTES\s*=\s*(\d+)/.exec(src)?.[1]) || 60
  const taskLit = objectAfter(src, 'const TASK_TEXT')
  let apps
  let tasks = {}
  try {
    apps = await evalData(`(${lit})`)
    if (taskLit) tasks = await evalData(`(${taskLit})`)
  } catch (e) {
    return { error: `Could not read the file: ${e.message}` }
  }
  if (!apps?.listening || !apps?.reading) return { error: 'The Listening or Reading screen is missing from this file.' }
  const img = writingImage(src)
  const listening = await parseListening(apps.listening, warnings)
  const reading = await parseReading(apps.reading, warnings)
  check(listening, problems, 'Listening')
  check(reading, problems, 'Reading')
  if (!listening.audio) problems.push('Listening: no recording found in the file.')
  if (!clean(tasks[1])) problems.push('Writing: Task 1 text is missing.')
  if (!clean(tasks[2])) problems.push('Writing: Task 2 text is missing.')
  if (!img.src) warnings.push('Writing Task 1 has no picture in the file.')
  const writing = { task1_prompt: clean(tasks[1]), task2_prompt: clean(tasks[2]), task1_image: img.src, task1_alt: img.alt, minutes }
  if (!listening.hasTranscript) warnings.push('This Listening has no transcript, so students will not see one in their results.')
  return { title, listening, reading, writing, warnings: [...new Set([...warnings, ...listening.warnings, ...reading.warnings])], problems: [...new Set(problems)], audio: listening.audio, engine: listening.engine }
}

/* ------------------------------------------------------------------ */
/* Saving                                                                */
/* ------------------------------------------------------------------ */

const missingColumn = (e) => e && (e.code === '42703' || /column .* does not exist|schema cache|Could not find the/i.test(e.message || ''))

async function hasExtras(supabase) {
  const a = await supabase.from('mock_question_explanations').select('question_id').limit(1)
  const b = await supabase.from('mock_section_transcripts').select('section_id').limit(1)
  return !a.error && !b.error
}

async function saveOne(supabase, { part, title, userId, audioBlob, extras }) {
  const { data: exam, error: e1 } = await supabase
    .from('mock_exams')
    .insert({ title, module: part.module, bank: 'mock', is_active: true, sort_order: 0, randomize_questions: false, questions_per_section: null })
    .select('id')
    .single()
  if (e1) throw e1
  try {
    for (let si = 0; si < part.sections.length; si++) {
      const s = part.sections[si]
      let audio = null
      if (part.module === 'listening' && si === 0 && audioBlob) audio = await uploadBlob(supabase, userId, audioBlob, `${title.replace(/\W+/g, '-')}.${(audioBlob.type || '').includes('wav') ? 'wav' : 'mp3'}`)
      const { data: sec, error: e2 } = await supabase
        .from('mock_sections')
        .insert({ exam_id: exam.id, order_index: si, title: s.title, passage_text: part.module === 'reading' ? s.passage_text : null, audio_url: audio })
        .select('id')
        .single()
      if (e2) throw e2
      if (extras && s.transcript?.length) {
        const { error: et } = await supabase.from('mock_section_transcripts').insert({ section_id: sec.id, transcript: s.transcript })
        if (et) throw et
      }
      let order = 0
      for (let gi = 0; gi < s.groups.length; gi++) {
        const g = s.groups[gi]
        let image = g.image || null
        if (image && /^data:/.test(image)) image = await uploadBlob(supabase, userId, dataUrlToBlob(image), `map-${si + 1}-${gi + 1}.${(/image\/(\w+)/.exec(image) || [])[1] || 'png'}`)
        const { data: grp, error: e3 } = await supabase
          .from('mock_question_groups')
          .insert({ section_id: sec.id, order_index: gi, kind: g.kind || 'other', word_limit: g.word_limit || null, title: g.title || null, instruction: g.instruction || null, options_reusable: !!g.options_reusable, body: g.body || null, image_url: image })
          .select('id')
          .single()
        if (e3) throw e3
        const rows = g.questions.map((q) => ({ section_id: sec.id, group_id: grp.id, order_index: order++, type: q.type, prompt: q.prompt || '', options: q.options || null, correct_answer: q.correct_answer || '', accepted_answers: q.accepted_answers || [] }))
        if (!rows.length) continue
        const { data: made, error: e4 } = await supabase.from('mock_questions').insert(rows).select('id, order_index')
        if (e4) throw e4
        if (extras) {
          const byOrder = Object.fromEntries(made.map((m) => [m.order_index, m.id]))
          const ex = g.questions
            .map((q, i) => (q.explanation ? { question_id: byOrder[rows[i].order_index], explanation_en: q.explanation.en || null, explanation_uz: q.explanation.uz || null, explanation_ru: q.explanation.ru || null } : null))
            .filter(Boolean)
          if (ex.length) {
            const { error: e5 } = await supabase.from('mock_question_explanations').insert(ex)
            if (e5) throw e5
          }
        }
      }
    }
    return exam.id
  } catch (err) {
    await supabase.from('mock_exams').delete().eq('id', exam.id)
    throw err
  }
}

/** Writes Listening + Reading + Writing and the full mock set that holds them. */
export async function saveFullMock(supabase, { parsed, userId, title, active = true, onStep = () => {} }) {
  const name = title || parsed.title
  const extras = await hasExtras(supabase)
  const made = { exams: [], writing: null, set: null }
  const undo = async () => {
    if (made.set) await supabase.from('full_mock_sets').delete().eq('id', made.set)
    if (made.writing) await supabase.from('writing_mock_exams').delete().eq('id', made.writing)
    for (const id of made.exams) await supabase.from('mock_exams').delete().eq('id', id)
  }
  try {
    onStep('Uploading the recording and saving Listening…')
    const audioBlob = parsed.audioBlob || (parsed.audio ? dataUrlToBlob(parsed.audio) : null)
    const listeningId = await saveOne(supabase, { part: parsed.listening, title: `${name} · Listening`, userId, audioBlob, extras })
    made.exams.push(listeningId)
    onStep('Saving Reading…')
    const readingId = await saveOne(supabase, { part: parsed.reading, title: `${name} · Reading`, userId, audioBlob: null, extras })
    made.exams.push(readingId)
    onStep('Saving Writing…')
    let taskImage = null
    if (parsed.writing.task1_image && /^data:/.test(parsed.writing.task1_image)) taskImage = await uploadBlob(supabase, userId, dataUrlToBlob(parsed.writing.task1_image), 'task1.png')
    const { data: w, error: ew } = await supabase
      .from('writing_mock_exams')
      .insert({ title: `${name} · Writing`, task1_prompt: parsed.writing.task1_prompt, task1_image_url: taskImage, task2_prompt: parsed.writing.task2_prompt, time_limit_minutes: parsed.writing.minutes || 60, is_active: true, sort_order: 0, created_by: userId })
      .select('id')
      .single()
    if (ew) throw ew
    made.writing = w.id
    onStep('Building the full mock…')
    const { data: set, error: es } = await supabase
      .from('full_mock_sets')
      .insert({ title: name, listening_exam_id: listeningId, reading_exam_id: readingId, writing_exam_id: w.id, is_active: active, sort_order: 0, created_by: userId })
      .select('id')
      .single()
    if (es) throw es
    made.set = set.id
    return { setId: set.id, listeningId, readingId, writingId: w.id, extras }
  } catch (err) {
    await undo()
    throw err
  }
}

export { missingColumn }
