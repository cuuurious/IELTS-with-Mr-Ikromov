import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/*
 * Extra items for "Today's plan" (2026-11-05): the speaking warm-up if
 * not done today, mistakes waiting in the notebook, and grammar cards due.
 * Each item opens its card's window through an 'ielts:open' event.
 */
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })

export function usePlanExtras(studentId) {
  const [x, setX] = useState({ warmup: false, notebook: 0, grammar: 0 })
  useEffect(() => {
    if (!studentId) return undefined
    let cancelled = false
    Promise.all([
      supabase.from('coin_settings').select('speaking_warmup').eq('id', 1).maybeSingle(),
      supabase.from('coin_ledger').select('id').eq('user_id', studentId).eq('ref_type', 'warmup').eq('ref_key', today()).limit(1),
      supabase.from('mistake_pages').select('wrong').eq('user_id', studentId),
      supabase.from('grammar_cards').select('id', { count: 'exact', head: true }).eq('user_id', studentId).lte('due_at', new Date().toISOString()),
    ]).then(([s, led, nb, gc]) => {
      if (cancelled) return
      setX({
        warmup: Boolean(s.data?.speaking_warmup) && !led.error && !(led.data || []).length,
        notebook: nb.error ? 0 : (nb.data || []).reduce((n, p) => n + (p.wrong?.length || 0), 0),
        grammar: gc.error ? 0 : gc.count || 0,
      })
    })
    return () => {
      cancelled = true
    }
  }, [studentId])
  return x
}

export const openCard = (name) => window.dispatchEvent(new CustomEvent('ielts:open', { detail: name }))
