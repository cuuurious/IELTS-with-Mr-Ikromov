import { createElement, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/*
 * RUSSIAN UNDER EVERY WORD (2026-11-07). Students asked for Russian next
 * to the Uzbek. One shared dictionary (public.word_ru, migration_118):
 * words are read from it in batches; a word nobody has needed yet is
 * translated once by the translate-ru function and stored for everyone.
 * Until the migration / function are live, nothing shows (no errors).
 */

// Same rule as supabase/functions/translate-ru: "12. bankrupt" → "bankrupt".
export function ruKey(w) {
  return String(w || '')
    .replace(/^\s*(?:\d+\s*[.)]|[•·\-–—*])\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“‘(]+|[\s"'”’).,;:!?]+$/g, '')
    .trim()
    .toLowerCase()
    .slice(0, 120)
}

const cache = new Map() // key → Russian ('' = none)
const waiting = new Map() // key → { word, df, uz }
const busy = new Set()
const listeners = new Set()
let timer = 0

function notify() {
  listeners.forEach((f) => f())
}

async function run() {
  timer = 0
  const batch = [...waiting.entries()].slice(0, 80)
  batch.forEach(([k]) => {
    waiting.delete(k)
    busy.add(k)
  })
  if (!batch.length) return
  const keys = batch.map(([k]) => k)
  try {
    const { data, error } = await supabase.from('word_ru').select('word, ru').in('word', keys)
    if (!error) (data || []).forEach((r) => cache.set(r.word, r.ru))
    const missing = batch.filter(([k]) => !cache.has(k))
    if (!error && missing.length) {
      const { data: res } = await supabase.functions.invoke('translate-ru', { body: { words: missing.map(([, v]) => v) } })
      Object.entries(res?.ru || {}).forEach(([k, v]) => cache.set(k, v))
    }
  } catch {
    /* offline or not set up yet */
  }
  keys.forEach((k) => {
    if (!cache.has(k)) cache.set(k, '')
    busy.delete(k)
  })
  notify()
  if (waiting.size) timer = setTimeout(run, 50)
}

export function requestRu(items) {
  let added = false
  for (const it of items || []) {
    const k = ruKey(it?.word)
    if (!k || cache.has(k) || busy.has(k) || waiting.has(k)) continue
    waiting.set(k, { word: String(it.word).slice(0, 120), df: String(it.df || it.definition || '').slice(0, 300), uz: String(it.uz || it.uzbek_translation || '').slice(0, 200) })
    added = true
  }
  if (added && !timer) timer = setTimeout(run, 120)
}

export const ruNow = (word) => cache.get(ruKey(word)) || ''

// Russian for many words at once: { key: ru }.
export async function fetchRuMap(items) {
  requestRu(items)
  for (let i = 0; i < 60 && (items || []).some((x) => { const k = ruKey(x.word); return k && !cache.has(k) }); i++) await new Promise((r) => setTimeout(r, 250))
  const out = {}
  for (const x of items || []) {
    const k = ruKey(x.word)
    if (cache.get(k)) out[k] = cache.get(k)
  }
  return out
}

export function useRu(word, definition, uzbek) {
  const k = ruKey(word)
  const [v, setV] = useState(() => cache.get(k) || '')
  useEffect(() => {
    if (!k) return undefined
    const f = () => setV(cache.get(k) || '')
    listeners.add(f)
    requestRu([{ word, df: definition, uz: uzbek }])
    f()
    return () => listeners.delete(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k])
  return v
}

// <RuLine word="relentless" definition="…" uzbek="…" /> → "RU  неустанный"
export function RuLine({ word, definition, uzbek, className = '' }) {
  const ru = useRu(word, definition, uzbek)
  if (!ru) return null
  return createElement(
    'span',
    { lang: 'ru', className: `block text-[0.92em] font-semibold text-paper-dim ${className}` },
    createElement('span', { className: 'mr-1.5 rounded-[6px] bg-panel-2 px-1.5 py-px text-[10px] font-extrabold tracking-wide text-mist' }, 'RU'),
    ru
  )
}
