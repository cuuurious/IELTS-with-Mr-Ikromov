import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'

/*
 * TAP A WORD (2026-11-02) — in practice mode and when checking answers,
 * double-click (or double-tap) any word to see its meaning and Uzbek
 * translation, then save it to "My words" for spaced-repetition review.
 *
 * Looks the word up in the school's own word lists first (they already
 * have Mr Ikromov's Uzbek translations), then asks the define-words
 * function (dictionary + AI) for anything else. Answers are cached for
 * the session so a word is only fetched once.
 *
 * Usage: wrap the area — <WordLookupArea source="Cambridge 18 Test 1">…</WordLookupArea>
 */

const cache = new Map()

function cleanWord(raw) {
  return String(raw || '')
    .replace(/[^A-Za-z'’-]/g, ' ')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/^['’-]+|['’-]+$/g, '')
    .toLowerCase()
}

async function lookUp(word) {
  if (cache.has(word)) return cache.get(word)
  const promise = (async () => {
    const own = await supabase
      .from('wordlist_items')
      .select('word, definition, uzbek_translation, example_sentence')
      .ilike('word', word)
      .limit(1)
      .maybeSingle()
    if (own.data && (own.data.definition || own.data.uzbek_translation)) return own.data
    const { data, error } = await supabase.functions.invoke('define-words', { body: { words: [word] } })
    if (error) throw error
    const r = data?.results?.[0] || {}
    return {
      word,
      definition: r.definition || '',
      uzbek_translation: r.uzbek_translation || '',
      example_sentence: r.example_sentence || r.example || '',
    }
  })()
  cache.set(word, promise)
  try {
    return await promise
  } catch (err) {
    cache.delete(word)
    throw err
  }
}

export function WordLookupArea({ source, enabled = true, children, className = '' }) {
  const [card, setCard] = useState(null) // { word, x, y, status, info, saved }
  const boxRef = useRef(null)

  const open = useCallback(
    async (rawWord, rect) => {
      const word = cleanWord(rawWord)
      if (!word || word.length < 2) return
      const x = Math.min(Math.max(12, rect.left), window.innerWidth - 332)
      const below = rect.bottom + 8
      const y = below + 230 > window.innerHeight ? Math.max(12, rect.top - 238) : below
      setCard({ word, x, y, status: 'loading', info: null, saved: false })
      try {
        const info = await lookUp(word)
        setCard((c) => (c && c.word === word ? { ...c, status: 'ready', info } : c))
      } catch {
        setCard((c) => (c && c.word === word ? { ...c, status: 'error' } : c))
      }
    },
    []
  )

  const onDoubleClick = (e) => {
    if (!enabled) return
    if (e.target.closest('input, textarea, button, select, [contenteditable="true"]')) return
    const sel = window.getSelection?.()
    const text = sel?.toString() || ''
    if (!text.trim() || text.trim().split(/\s+/).length > 2) return
    const range = sel.rangeCount ? sel.getRangeAt(0) : null
    const rect = range?.getBoundingClientRect?.() || { left: e.clientX, top: e.clientY, bottom: e.clientY + 16 }
    open(text, rect)
  }

  useEffect(() => {
    if (!card) return undefined
    const close = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setCard(null)
    }
    const esc = (e) => e.key === 'Escape' && setCard(null)
    const t = setTimeout(() => document.addEventListener('mousedown', close), 0)
    document.addEventListener('keydown', esc)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [card])

  const save = async () => {
    if (!card?.info) return
    setCard((c) => ({ ...c, saving: true }))
    const { error } = await supabase.from('student_words').upsert(
      {
        word: card.word,
        definition: card.info.definition || null,
        uzbek_translation: card.info.uzbek_translation || null,
        example_sentence: card.info.example_sentence || null,
        source: source || null,
      },
      { onConflict: 'user_id,word', ignoreDuplicates: true }
    )
    setCard((c) => (c ? { ...c, saving: false, saved: !error, saveError: error ? 'Could not save it.' : '' } : c))
  }

  return (
    <div onDoubleClick={onDoubleClick} className={className}>
      {children}
      {card &&
        createPortal(
          <div
            ref={boxRef}
            role="dialog"
            aria-label={`Meaning of ${card.word}`}
            className="fixed z-[10050] w-[320px] overflow-hidden rounded-[20px] border border-line bg-panel text-paper shadow-[0_18px_40px_rgba(15,22,38,0.25)]"
            style={{ left: card.x, top: card.y, fontFamily: 'Nunito, system-ui, sans-serif' }}
          >
            <div className="flex items-center gap-2 bg-[linear-gradient(135deg,#2456b0,#1a9bb5)] px-4 py-3 text-white">
              <span className="font-brand text-[18px] font-semibold">{card.word}</span>
              <button
                type="button"
                onClick={() => {
                  try {
                    const u = new SpeechSynthesisUtterance(card.word)
                    u.lang = 'en-GB'
                    window.speechSynthesis.cancel()
                    window.speechSynthesis.speak(u)
                  } catch {
                    /* no speech */
                  }
                }}
                aria-label="Listen"
                className="focus-ring grid h-8 w-8 place-items-center rounded-xl bg-white/15 hover:bg-white/25"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7" /></svg>
              </button>
              <button type="button" onClick={() => setCard(null)} aria-label="Close" className="focus-ring ml-auto grid h-8 w-8 place-items-center rounded-xl hover:bg-white/15">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="flex flex-col gap-2.5 p-4">
              {card.status === 'loading' && <p className="text-sm font-semibold text-mist">Looking it up…</p>}
              {card.status === 'error' && <p className="text-sm font-semibold text-coral">Couldn't find this word right now.</p>}
              {card.status === 'ready' && (
                <>
                  {card.info.uzbek_translation && (
                    <p className="rounded-xl bg-vocab-tint px-3 py-2 text-[15px] font-extrabold text-vocab">{card.info.uzbek_translation}</p>
                  )}
                  {card.info.definition && <p className="text-sm leading-6 text-paper">{card.info.definition}</p>}
                  {card.info.example_sentence && <p className="text-[13px] italic leading-5 text-paper-dim">{card.info.example_sentence}</p>}
                  {!card.info.uzbek_translation && !card.info.definition && <p className="text-sm text-mist">No meaning found.</p>}
                  <button
                    type="button"
                    onClick={save}
                    disabled={card.saved || card.saving}
                    className={`focus-ring mt-1 h-10 rounded-[14px] text-sm font-extrabold transition ${
                      card.saved ? 'bg-reading-tint text-reading' : 'bg-saffron text-[#17213a] hover:brightness-105'
                    }`}
                  >
                    {card.saved ? 'Saved to My words' : card.saving ? 'Saving…' : 'Save to My words'}
                  </button>
                  {card.saveError && <p className="text-xs font-semibold text-coral">{card.saveError}</p>}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
