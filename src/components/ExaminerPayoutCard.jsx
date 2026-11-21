import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/*
 * The card an examiner's pay goes to (migration 139). Examiners type it in
 * themselves. Their students and the admin can read it so they can pay.
 * Card number only: never a CVV or an expiry date.
 */
const TYPES = ['Humo', 'Uzcard', 'Visa', 'Mastercard', 'Other']

const group4 = (digits) => digits.replace(/(.{4})/g, '$1 ').trim()

export default function ExaminerPayoutCard({ userId }) {
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(null)
  const [number, setNumber] = useState('')
  const [holder, setHolder] = useState('')
  const [type, setType] = useState('Humo')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let off = false
    supabase
      .from('examiner_payout_details')
      .select('card_number, card_holder, card_type, updated_at')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (off) return
        if (error) setErr('Card details are not set up yet. Please tell Mr Ikromov.')
        setSaved(data || null)
        setEditing(!data)
        setLoading(false)
      })
    return () => {
      off = true
    }
  }, [userId])

  const startEdit = () => {
    setNumber(saved ? saved.card_number : '')
    setHolder(saved ? saved.card_holder : '')
    setType(saved ? saved.card_type : 'Humo')
    setMsg('')
    setErr('')
    setEditing(true)
  }

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    setMsg('')
    const digits = number.replace(/\D/g, '')
    if (digits.length !== 16) return setErr('The card number must have 16 digits.')
    if (holder.trim().length < 2) return setErr('Type the name as it is written on the card.')
    setBusy(true)
    const row = { user_id: userId, card_number: digits, card_holder: holder.trim().toUpperCase(), card_type: type, updated_at: new Date().toISOString() }
    const { error } = await supabase.from('examiner_payout_details').upsert(row, { onConflict: 'user_id' })
    setBusy(false)
    if (error) return setErr(error.message)
    setSaved(row)
    setEditing(false)
    setNumber('')
    setMsg('Saved. Students can now see this card.')
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="font-mono text-xs uppercase tracking-wide text-mist">Payment card</div>
      <p className="text-[13px] leading-relaxed text-paper-dim">
        Your pay for sessions and checked essays goes to this card. Students and Mr Ikromov can see it so they can pay you.
        Never type the CVV or the expiry date.
      </p>

      {loading ? (
        <p className="text-sm text-mist">Loading…</p>
      ) : editing ? (
        <form onSubmit={save} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-bold text-paper">
            Card number
            <input
              inputMode="numeric"
              autoComplete="off"
              value={group4(number.replace(/\D/g, '').slice(0, 16))}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="8600 0000 0000 0000"
              className="focus-ring h-11 rounded-[14px] border border-line bg-panel px-3 font-mono text-[15px] tracking-wider text-paper"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold text-paper">
            Name on the card
            <input
              autoComplete="off"
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              placeholder="NAME SURNAME"
              className="focus-ring h-11 rounded-[14px] border border-line bg-panel px-3 text-[15px] uppercase text-paper"
            />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Card type">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={`focus-ring h-9 rounded-xl border px-3 text-[13px] font-extrabold ${type === t ? 'border-brass bg-brass text-white' : 'border-line bg-panel text-paper-dim hover:border-brass'}`}
              >
                {t}
              </button>
            ))}
          </div>
          {err && <p className="text-sm font-bold text-coral">{err}</p>}
          <div className="flex gap-2">
            <button disabled={busy} className="focus-ring h-10 rounded-[14px] bg-saffron px-4 text-sm font-extrabold text-onsaffron disabled:opacity-60">
              {busy ? 'Saving…' : 'Save card'}
            </button>
            {saved && (
              <button type="button" onClick={() => setEditing(false)} className="focus-ring h-10 rounded-[14px] border border-line px-4 text-sm font-bold text-paper-dim">
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-[14px] bg-panel-2 px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[15px] font-bold tracking-wider text-paper">•••• •••• •••• {saved.card_number.slice(-4)}</p>
            <p className="truncate text-xs font-bold text-mist">{saved.card_type} · {saved.card_holder}</p>
          </div>
          <button type="button" onClick={startEdit} className="focus-ring h-9 shrink-0 rounded-xl border border-line bg-panel px-3 text-[13px] font-extrabold text-brass">
            Change
          </button>
        </div>
      )}
      {msg && <p className="text-sm font-bold text-sage">{msg}</p>}
      {!loading && err && !editing && <p className="text-sm font-bold text-coral">{err}</p>}
    </div>
  )
}
