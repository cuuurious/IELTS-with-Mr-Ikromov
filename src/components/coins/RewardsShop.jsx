import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { CoinAmount, CoinIcon } from './Coin'

/*
 * REWARDS SHOP — student side (2026-11-05, migration_102).
 * Real things for coins: books, notebooks, a free mock… Ordering takes
 * the coins at once and holds them; Mr Ikromov hands the item over in
 * class (or declines, and the coins come back). A waiting order can be
 * cancelled.
 */

const STATUS = {
  waiting: { label: 'Waiting — Mr Ikromov will hand it over', cls: 'bg-[color-mix(in_srgb,var(--color-saffron)_20%,var(--color-panel))] text-amber' },
  given: { label: 'Handed over ✓', cls: 'bg-reading-tint text-reading' },
  declined: { label: 'Declined — coins back', cls: 'bg-urgent-tint text-coral' },
  cancelled: { label: 'Cancelled — coins back', cls: 'bg-panel-2 text-mist' },
}

export function ItemPhoto({ src, title, className = 'h-44' }) {
  return (
    <div className={`relative grid place-items-center overflow-hidden bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-saffron)_22%,var(--color-panel)),color-mix(in_srgb,var(--color-brass)_14%,var(--color-panel)))] ${className}`}>
      {src ? (
        <img src={src} alt={title} loading="lazy" className="h-full w-full object-contain p-3 drop-shadow-[0_8px_14px_rgba(23,33,58,0.22)]" />
      ) : (
        <svg className="h-14 w-14 text-amber/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8" />
          <path d="M2 8h20v4H2zM12 21V8M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5" />
        </svg>
      )}
    </div>
  )
}

export default function RewardsShop({ studentId, balance, onBalance }) {
  const [items, setItems] = useState(null)
  const [orders, setOrders] = useState([])
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [missing, setMissing] = useState(false)
  const [wishes, setWishes] = useState(null) // Set(item_id); null before migration_103

  const load = useCallback(async () => {
    const [it, or] = await Promise.all([
      supabase.from('shop_items').select('id, title, description, image_url, price, stock, sort_order, created_at').eq('is_active', true).order('sort_order').order('created_at'),
      supabase.from('shop_orders').select('id, item_title, item_image, price, status, note, created_at, decided_at').eq('user_id', studentId).order('created_at', { ascending: false }).limit(20),
    ])
    if (it.error) {
      setMissing(true)
      setItems([])
      return
    }
    setItems(it.data || [])
    setOrders(or.data || [])
    const w = await supabase.from('shop_wishes').select('item_id').eq('user_id', studentId)
    setWishes(w.error ? null : new Set((w.data || []).map((r) => r.item_id)))
  }, [studentId])

  // Star the reward you're saving for (shown on the home page).
  const toggleWish = async (it) => {
    const on = wishes?.has(it.id)
    setWishes((prev) => {
      const n = new Set(prev)
      if (on) n.delete(it.id)
      else n.add(it.id)
      return n
    })
    const { error: e } = on
      ? await supabase.from('shop_wishes').delete().eq('user_id', studentId).eq('item_id', it.id)
      : await supabase.from('shop_wishes').insert({ user_id: studentId, item_id: it.id })
    if (e) load()
  }

  useEffect(() => {
    load()
  }, [load])

  const order = async () => {
    setBusy(true)
    setError('')
    const { data, error: e } = await supabase.rpc('shop_order', { p_item: confirm.id })
    setBusy(false)
    if (e) {
      setError(e.message)
      return
    }
    onBalance?.(data)
    setDone(confirm.title)
    setConfirm(null)
    load()
  }

  const cancel = async (o) => {
    if (!window.confirm(`Cancel your order for “${o.item_title}”? Your ${o.price} coins come back.`)) return
    const { data, error: e } = await supabase.rpc('shop_cancel', { p_order: o.id })
    if (e) {
      setError(e.message)
      return
    }
    onBalance?.(data)
    load()
  }

  if (missing || items === null) return null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-brand text-[18px] font-semibold text-paper">Rewards shop</h2>
        <p className="text-[13px] font-semibold text-mist">Swap your coins for real things. Mr Ikromov hands them over in class.{wishes ? ' Tap ☆ on what you’re saving for.' : ''}</p>
      </div>

      {done && (
        <p className="rounded-[14px] bg-reading-tint px-4 py-3 text-sm font-bold text-reading">
          Ordered: {done}. Mr Ikromov will hand it over in class — you can see it under “My orders”.
        </p>
      )}
      {error && !confirm && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}

      {items.length === 0 ? (
        <div className="rounded-[20px] bg-panel-2/70 p-5">
          <p className="font-brand text-[16px] font-semibold text-paper">Rewards are coming</p>
          <p className="text-sm font-semibold text-mist">Keep saving — books and prizes will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {items.map((it) => {
            const sold = it.stock != null && it.stock <= 0
            const short = balance != null && balance < it.price
            const pct = balance != null ? Math.min(100, Math.round((balance / it.price) * 100)) : 0
            return (
              <div key={it.id} className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-line bg-panel">
                <div className="relative">
                  <ItemPhoto src={it.image_url} title={it.title} className="h-36 sm:h-44" />
                  {it.stock != null && (
                    <span className={`absolute left-2 top-2 rounded-lg px-2 py-0.5 text-[11px] font-extrabold ${sold ? 'bg-coral text-white' : 'bg-panel/90 text-paper'}`}>
                      {sold ? 'Sold out' : `${it.stock} left`}
                    </span>
                  )}
                  {wishes && (
                    <button
                      type="button"
                      onClick={() => toggleWish(it)}
                      aria-pressed={wishes.has(it.id)}
                      title={wishes.has(it.id) ? 'Saving for this — tap to remove' : 'Save for this'}
                      className={`focus-ring absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-[12px] text-[18px] leading-none ${wishes.has(it.id) ? 'bg-saffron text-[#17213a]' : 'bg-panel/90 text-mist hover:text-amber'}`}
                    >
                      {wishes.has(it.id) ? '★' : '☆'}
                    </button>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
                  <p className="line-clamp-2 text-[14px] font-extrabold leading-snug text-paper sm:text-[15px]">{it.title}</p>
                  {it.description && <p className="line-clamp-2 text-[12px] font-semibold leading-5 text-mist">{it.description}</p>}
                  <div className="mt-auto flex flex-col gap-2 pt-1">
                    <CoinAmount value={it.price} className="text-[17px] text-amber" />
                    {short && !sold && (
                      <div className="h-1.5 overflow-hidden rounded bg-panel-2" title={`${balance} of ${it.price} coins`}>
                        <div className="h-full rounded bg-saffron" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setError('')
                        setDone('')
                        setConfirm(it)
                      }}
                      disabled={sold || short}
                      className="focus-ring h-10 rounded-[12px] bg-saffron px-3 text-[13px] font-extrabold text-[#17213a] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sold ? 'Sold out' : short ? `${it.price - balance} more to go` : 'Get it'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {orders.length > 0 && (
        <div className="rounded-[20px] border border-line bg-panel p-4">
          <p className="mb-2 font-brand text-[16px] font-semibold text-paper">My orders</p>
          <ul className="flex flex-col gap-1.5">
            {orders.map((o) => {
              const st = STATUS[o.status] || STATUS.waiting
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[14px] bg-panel-2/60 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-paper">{o.item_title}</span>
                  <span className="flex items-center gap-1 text-[13px] font-bold text-amber"><CoinIcon className="h-4 w-4" />{o.price}</span>
                  <span className={`rounded-lg px-2 py-0.5 text-[11px] font-extrabold ${st.cls}`}>{st.label}</span>
                  {o.note && <span className="w-full text-[12px] font-semibold text-mist">“{o.note}”</span>}
                  {o.status === 'waiting' && (
                    <button type="button" onClick={() => cancel(o)} className="focus-ring text-[12px] font-extrabold text-mist hover:text-coral">
                      Cancel
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {confirm &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => !busy && setConfirm(null)}>
            <div className="w-full max-w-sm overflow-hidden rounded-t-[28px] bg-panel shadow-2xl sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Confirm order">
              <ItemPhoto src={confirm.image_url} title={confirm.title} className="h-48" />
              <div className="flex flex-col gap-3 p-5">
                <p className="font-brand text-[19px] font-semibold leading-tight text-paper">{confirm.title}</p>
                <p className="text-sm font-semibold text-paper-dim">
                  Use <b className="text-amber">{confirm.price} coins</b>? You’ll have {Math.max(0, (balance ?? 0) - confirm.price)} left. Mr Ikromov hands it over in class; if he can’t, your coins come back.
                </p>
                {error && <p className="rounded-[12px] bg-urgent-tint px-3 py-2 text-sm font-bold text-coral">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="focus-ring h-11 flex-1 rounded-[14px] bg-panel-2 text-sm font-extrabold text-paper">
                    Not now
                  </button>
                  <button type="button" onClick={order} disabled={busy} className="focus-ring h-11 flex-1 rounded-[14px] bg-saffron text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-60">
                    {busy ? 'Ordering…' : 'Yes, get it'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </section>
  )
}

/*
 * The reward a student is saving for, on their home page (2026-11-05):
 * photo, coins so far and what is left. Quiet when nothing is starred.
 */
export function WishGoal({ studentId, onOpen, className = '' }) {
  const [goal, setGoal] = useState(null)
  useEffect(() => {
    if (!studentId) return undefined
    let cancelled = false
    ;(async () => {
      const w = await supabase.from('shop_wishes').select('item_id, created_at, shop_items(id, title, image_url, price, stock, is_active)').eq('user_id', studentId).order('created_at', { ascending: false })
      if (cancelled || w.error) return
      const items = (w.data || []).map((r) => r.shop_items).filter((it) => it && it.is_active)
      if (!items.length) return
      const bal = await supabase.rpc('my_coins')
      if (cancelled) return
      const balance = bal.error ? 0 : bal.data ?? 0
      const item = items.find((it) => it.price > balance) || items[0]
      setGoal({ item, balance, more: items.length - 1 })
    })()
    return () => {
      cancelled = true
    }
  }, [studentId])
  if (!goal) return null
  const { item, balance } = goal
  const left = Math.max(0, item.price - balance)
  const pct = Math.min(100, Math.round((balance / item.price) * 100))
  const sold = item.stock != null && item.stock <= 0
  return (
    <section className={`flex items-center gap-3 rounded-[20px] border border-line bg-panel p-3 sm:gap-4 sm:p-4 ${className}`}>
      <span className="h-16 w-14 shrink-0 overflow-hidden rounded-[12px] sm:h-20 sm:w-16">
        <ItemPhoto src={item.image_url} title={item.title} className="h-full" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-amber">Saving for</p>
        <p className="truncate text-[15px] font-extrabold text-paper">{item.title}</p>
        <div className="mt-1.5 h-2 overflow-hidden rounded bg-panel-2">
          <div className="h-full rounded bg-saffron" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-[12px] font-bold text-mist">
          {sold ? 'Sold out for now' : left > 0 ? `${balance} of ${item.price} coins · ${left} more to go` : `You have enough coins (${balance})!`}
        </p>
      </div>
      <button type="button" onClick={onOpen} className={`focus-ring h-10 shrink-0 rounded-[12px] px-3.5 text-[13px] font-extrabold ${left === 0 && !sold ? 'bg-saffron text-[#17213a]' : 'bg-panel-2 text-paper'}`}>
        {left === 0 && !sold ? 'Get it' : 'Shop'}
      </button>
    </section>
  )
}
