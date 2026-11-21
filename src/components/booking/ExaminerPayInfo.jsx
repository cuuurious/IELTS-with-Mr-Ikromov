import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/* The examiner's payment card, shown to students above the chat so they can
 * pay for a speaking session or an essay check (migration 139). Renders
 * nothing when the examiner has not added a card. */
export default function ExaminerPayInfo({ examinerId }) {
  const [card, setCard] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let off = false
    setCard(null)
    supabase
      .from('examiner_payout_details')
      .select('card_number, card_holder, card_type')
      .eq('user_id', examinerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!off) setCard(data || null)
      })
    return () => {
      off = true
    }
  }, [examinerId])

  if (!card) return null

  const pretty = card.card_number.replace(/(.{4})/g, '$1 ').trim()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.card_number)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* the number is on screen, the student can copy it by hand */
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-panel-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-mist">Payment card · {card.card_type}</p>
        <p className="font-mono text-[15px] font-bold tracking-wider text-paper">{pretty}</p>
        <p className="truncate text-xs font-bold text-mist">{card.card_holder}</p>
      </div>
      <button type="button" onClick={copy} className="focus-ring h-9 shrink-0 rounded-xl border border-line bg-panel px-3 text-[13px] font-extrabold text-brass">
        {copied ? 'Copied ✓' : 'Copy number'}
      </button>
    </div>
  )
}
