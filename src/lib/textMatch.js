/*
 * Text matching for the speaking "Get ready" step (2026-11-05): which
 * phrases and grammar a student used, and gap-fills from a model answer.
 * Plain JavaScript so it can be tested with `npm test`.
 */
export const norm = (t) =>
  String(t || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const STOP = new Set(['a', 'an', 'the', 'be', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'your', 'someone', "someone's", 'something', 'sb', 'sth', 'it', 'is', 'are'])
export const keyWords = (phrase) =>
  norm(String(phrase).replace(/\([^)]*\)/g, ' '))
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w))
export const stem = (w) => w.replace(/'s$/, '').slice(0, Math.max(3, Math.min(5, w.length - 1)))
export function saidPhrase(said, phrase) {
  const ks = keyWords(phrase)
  if (!ks.length) return false
  const words = norm(said).split(' ')
  return ks.every((k) => words.some((w) => w.startsWith(stem(k))))
}
// The fixed start of a grammar "Try it" frame: "I'm majoring in ______." → "i'm majoring in".
export function frameStem(tryText) {
  const t = norm(String(tryText || '').split(/_{2,}|…/).find((x) => norm(x).split(' ').filter(Boolean).length >= 2) || '')
  return t.split(' ').filter(Boolean).length >= 2 ? t : ''
}

export function targets(q) {
  const out = []
  ;(q.model?.phrases || []).forEach(([p, m]) => out.push({ kind: 'phrase', label: String(p), meaning: m }))
  ;(q.model?.grammar || []).forEach((g) => {
    const st = frameStem(g.try)
    if (st) out.push({ kind: 'grammar', label: g.pattern, stem: st })
  })
  return out
}

// One gap per phrase: a sentence of the model answer with the phrase's key word blanked.
export function makeGaps(q) {
  const phrases = (q.model?.phrases || []).map(([p]) => String(p))
  const sentences = String(q.model?.answer || '').replace(/([.!?])\s+/g, '$1\u0001').split('\u0001')
  const gaps = []
  phrases.forEach((p) => {
    const k = keyWords(p)[0]
    if (!k) return
    const sIdx = sentences.findIndex((x) => norm(x).split(' ').some((w) => w.startsWith(stem(k))))
    if (sIdx < 0) return
    const words = sentences[sIdx].split(/(\s+)/)
    const wIdx = words.findIndex((w) => norm(w) && norm(w).startsWith(stem(k)))
    if (wIdx < 0) return
    const answer = words[wIdx].replace(/[^A-Za-z'’-]/g, '')
    const trail = words[wIdx].slice(words[wIdx].indexOf(answer) + answer.length)
    gaps.push({ phrase: p, before: words.slice(0, wIdx).join(''), after: trail + words.slice(wIdx + 1).join(''), answer })
  })
  return gaps.slice(0, 3)
}

