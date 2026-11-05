import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { groupColour, groupDisplayName } from '../../lib/groupLook'
import { CoinIcon } from './Coin'
import { ItemPhoto } from './RewardsShop'

/*
 * REWARDS SHOP — teacher side (2026-11-05, migration_102).
 *   Orders: who is waiting for what — "Handed over" when you give it,
 *           "Decline" gives the coins back.
 *   Rewards: add a photo, a name, a coin price, optional stock and
 *           optional groups (none = every student).
 */

// Phone photos are big: shrink to 1000 px JPEG before uploading.
async function shrinkImage(file) {
  if (!/^image\//.test(file.type) || /gif|svg/.test(file.type)) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise((r) => c.toBlob(r, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86))
    return blob || file
  } catch {
    return file
  }
}

function ItemEditor({ item, groups, onDone }) {
  const [title, setTitle] = useState(item?.title || '')
  const [description, setDescription] = useState(item?.description || '')
  const [price, setPrice] = useState(item?.price ?? 100)
  const [stock, setStock] = useState(item?.stock ?? '')
  const [groupIds, setGroupIds] = useState(item?.group_ids || [])
  const [active, setActive] = useState(item?.is_active ?? true)
  const [image, setImage] = useState(item?.image_url || '')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const field = 'focus-ring w-full rounded-[12px] border border-line bg-panel px-3 py-2.5 text-[14px] text-paper placeholder:text-mist/70'

  const upload = async (file) => {
    if (!file) return
    setUploading(true)
    setError('')
    const blob = await shrinkImage(file)
    const ext = blob.type === 'image/png' ? 'png' : /webp/.test(blob.type) ? 'webp' : 'jpg'
    const path = `items/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: e } = await supabase.storage.from('shop').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false })
    setUploading(false)
    if (e) return setError(/bucket/i.test(e.message) ? 'Run migration_102_coin_shop.sql first.' : e.message)
    setImage(supabase.storage.from('shop').getPublicUrl(path).data.publicUrl)
  }

  const save = async () => {
    setError('')
    const p = Number(price)
    const s = stock === '' || stock == null ? null : Number(stock)
    if (!title.trim()) return setError('Give it a name.')
    if (!Number.isInteger(p) || p < 1) return setError('The price must be a whole number of coins.')
    if (s != null && (!Number.isInteger(s) || s < 0)) return setError('Stock must be empty (unlimited) or a whole number.')
    setBusy(true)
    const row = { title: title.trim(), description: description.trim(), price: p, stock: s, group_ids: groupIds, is_active: active, image_url: image || null }
    const { error: e } = item ? await supabase.from('shop_items').update(row).eq('id', item.id) : await supabase.from('shop_items').insert(row)
    setBusy(false)
    if (e) return setError(/shop_items/.test(e.message) ? 'Run migration_102_coin_shop.sql first.' : e.message)
    onDone()
  }

  const remove = async () => {
    if (!window.confirm(`Delete “${item.title}”? Orders already made stay in the list.`)) return
    const { error: e } = await supabase.from('shop_items').delete().eq('id', item.id)
    if (e) return setError(e.message)
    onDone()
  }

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onDone} className="focus-ring self-start text-sm font-extrabold text-brass">← Rewards shop</button>
      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-[20px] border border-line">
            <ItemPhoto src={image} title={title} className="h-64" />
          </div>
          <label className="focus-ring flex h-11 cursor-pointer items-center justify-center rounded-[14px] border-2 border-dashed border-line text-sm font-extrabold text-brass hover:border-brass">
            {uploading ? 'Uploading…' : image ? 'Change photo' : '+ Add a photo'}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {image && (
            <button type="button" onClick={() => setImage('')} className="focus-ring text-[12px] font-extrabold text-mist hover:text-coral">
              Remove photo
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4 sm:p-5">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold text-mist">Name</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cambridge IELTS 19" className={`${field} font-extrabold`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold text-mist">Description (optional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Academic, with answers and audio" className={field} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold text-mist">Price (coins)</span>
              <input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-extrabold text-mist">How many you have</span>
              <input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Unlimited" className={field} />
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold text-mist">Who can get it</span>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setGroupIds([])} aria-pressed={!groupIds.length} className={`focus-ring h-8 rounded-[10px] px-2.5 text-[12px] font-extrabold ${!groupIds.length ? 'bg-brass text-onbrass' : 'bg-panel-2 text-paper-dim'}`}>
                All students
              </button>
              {groups.map((g, i) => {
                const c = groupColour(i)
                const on = groupIds.includes(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setGroupIds((prev) => (on ? prev.filter((x) => x !== g.id) : [...prev, g.id]))}
                    className={`focus-ring h-8 rounded-[10px] border-2 px-2.5 text-[12px] font-extrabold ${on ? `${c.border} ${c.tint} ${c.text}` : 'border-transparent bg-panel-2 text-paper-dim'}`}
                  >
                    {groupDisplayName(g.name)}
                  </button>
                )
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm font-extrabold text-paper">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-brass" />
            Show it in the shop
          </label>
          {error && <p className="rounded-[12px] bg-urgent-tint px-3 py-2 text-sm font-bold text-coral">{error}</p>}
          <div className="mt-1 flex flex-wrap gap-2">
            {item && (
              <button type="button" onClick={remove} className="focus-ring h-11 rounded-[14px] px-3 text-sm font-extrabold text-coral hover:bg-urgent-tint">
                Delete
              </button>
            )}
            <span className="flex-1" />
            <button type="button" onClick={onDone} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist">Cancel</button>
            <button type="button" onClick={save} disabled={busy || uploading} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save reward'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ShopAdmin() {
  const [items, setItems] = useState(null)
  const [orders, setOrders] = useState([])
  const [groups, setGroups] = useState([])
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [showDone, setShowDone] = useState(false)

  const load = async () => {
    const [it, or, gr] = await Promise.all([
      supabase.from('shop_items').select('*').order('sort_order').order('created_at'),
      supabase.from('shop_orders').select('id, item_id, item_title, item_image, price, status, note, created_at, decided_at, user_id, profiles(full_name, avatar_url)').order('created_at', { ascending: false }).limit(200),
      supabase.from('groups').select('id, name, created_at').order('created_at'),
    ])
    if (it.error) {
      setError(/shop_items/.test(it.error.message) ? 'Run migration_102_coin_shop.sql to open the rewards shop.' : it.error.message)
      setItems([])
      return
    }
    setItems(it.data || [])
    setOrders(or.data || [])
    setGroups(gr.data || [])
  }
  useEffect(() => {
    load()
  }, [])

  const decide = async (o, status) => {
    let note = ''
    if (status === 'declined') {
      note = window.prompt(`Decline the order from ${o.profiles?.full_name || 'this student'} for “${o.item_title}”? The ${o.price} coins go back. A short note for the student (optional):`, '')
      if (note === null) return
    }
    setBusy(o.id)
    const { error: e } = await supabase.rpc('shop_decide', { p_order: o.id, p_status: status, p_note: note || '' })
    setBusy('')
    if (e) setError(e.message)
    load()
  }

  const toggleActive = async (it) => {
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, is_active: !x.is_active } : x)))
    await supabase.from('shop_items').update({ is_active: !it.is_active }).eq('id', it.id)
  }

  if (editing) return <ItemEditor item={editing === 'new' ? null : editing} groups={groups} onDone={() => { setEditing(null); load() }} />
  if (items === null) return <p className="text-sm font-semibold text-mist">Loading…</p>

  const waiting = orders.filter((o) => o.status === 'waiting')
  const past = orders.filter((o) => o.status !== 'waiting')
  const sold = (id) => orders.filter((o) => o.item_id === id && (o.status === 'given' || o.status === 'waiting')).length
  const groupNames = (ids) => ids.map((id) => groupDisplayName(groups.find((g) => g.id === id)?.name || '')).filter(Boolean).join(', ')

  return (
    <div className="flex flex-col gap-5">
      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}

      <section className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="font-brand text-[18px] font-semibold text-paper">To hand over</p>
          <span className={`rounded-lg px-2 py-0.5 text-[12px] font-extrabold ${waiting.length ? 'bg-saffron text-[#17213a]' : 'bg-panel-2 text-mist'}`}>{waiting.length}</span>
          <p className="text-[12px] font-semibold text-mist">Coins are already taken. Press “Handed over” when you give it.</p>
        </div>
        {waiting.length === 0 ? (
          <p className="text-sm font-semibold text-mist">No orders waiting.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {waiting.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 rounded-[16px] bg-panel-2/60 p-2.5">
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-[12px] bg-panel">
                  {o.item_image ? <img src={o.item_image} alt="" className="h-full w-full object-contain p-1" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-paper">{o.profiles?.full_name || 'Student'}</p>
                  <p className="truncate text-[12px] font-bold text-mist">
                    {o.item_title} · {o.price} coins · {new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <button type="button" onClick={() => decide(o, 'declined')} disabled={busy === o.id} className="focus-ring h-10 flex-1 rounded-[12px] px-3 text-[13px] font-extrabold text-coral hover:bg-urgent-tint disabled:opacity-50 sm:flex-none">
                    Decline
                  </button>
                  <button type="button" onClick={() => decide(o, 'given')} disabled={busy === o.id} className="focus-ring h-10 flex-[2] rounded-[12px] bg-reading px-4 text-[13px] font-extrabold text-white hover:brightness-110 disabled:opacity-50 sm:flex-none">
                    Handed over
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <>
            <button type="button" onClick={() => setShowDone((v) => !v)} className="focus-ring self-start text-[13px] font-extrabold text-brass">
              {showDone ? 'Hide' : 'Show'} past orders ({past.length})
            </button>
            {showDone && (
              <ul className="flex flex-col gap-1">
                {past.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-[12px] px-2 py-1.5 text-[13px]">
                    <span className="min-w-0 flex-1 truncate font-bold text-paper">{o.profiles?.full_name || 'Student'} · {o.item_title}</span>
                    <span className={`rounded-lg px-2 py-0.5 text-[11px] font-extrabold ${o.status === 'given' ? 'bg-reading-tint text-reading' : 'bg-panel-2 text-mist'}`}>
                      {o.status === 'given' ? 'Handed over' : o.status === 'declined' ? 'Declined' : 'Cancelled by student'}
                    </span>
                    <span className="text-[12px] font-bold text-mist">{new Date(o.decided_at || o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-paper-dim">Put a photo, a name and a coin price. Students order with their coins; you hand it over in class.</p>
        <button type="button" onClick={() => setEditing('new')} className="focus-ring h-11 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] hover:brightness-105">
          + New reward
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line bg-panel px-5 py-10 text-center">
          <p className="font-brand text-[17px] font-semibold text-paper">No rewards yet</p>
          <p className="mt-1 text-sm font-semibold text-mist">Add your first one — a book, a notebook, a free mock…</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {items.map((it) => (
            <div key={it.id} className={`flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-line bg-panel ${it.is_active ? '' : 'opacity-60'}`}>
              <div className="relative">
                <ItemPhoto src={it.image_url} title={it.title} className="h-36" />
                {it.stock != null && (
                  <span className={`absolute left-2 top-2 rounded-lg px-2 py-0.5 text-[11px] font-extrabold ${it.stock <= 0 ? 'bg-coral text-white' : 'bg-panel/90 text-paper'}`}>
                    {it.stock <= 0 ? 'Sold out' : `${it.stock} left`}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <p className="line-clamp-2 text-[14px] font-extrabold leading-snug text-paper">{it.title}</p>
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-bold text-mist">
                  <span className="flex items-center gap-1 text-[14px] font-extrabold text-amber"><CoinIcon className="h-4 w-4" />{it.price}</span>
                  <span>· {sold(it.id)} ordered</span>
                </div>
                {it.group_ids?.length > 0 && <p className="truncate text-[11px] font-bold text-mist">Only {groupNames(it.group_ids)}</p>}
                <div className="mt-auto flex gap-2 pt-1">
                  <button type="button" onClick={() => toggleActive(it)} className={`focus-ring h-9 flex-1 rounded-[12px] text-[12px] font-extrabold ${it.is_active ? 'bg-reading-tint text-reading' : 'bg-panel-2 text-mist'}`}>
                    {it.is_active ? 'In the shop' : 'Hidden'}
                  </button>
                  <button type="button" onClick={() => setEditing(it)} className="focus-ring h-9 flex-1 rounded-[12px] bg-brass text-[12px] font-extrabold text-onbrass hover:brightness-110">
                    Edit
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
