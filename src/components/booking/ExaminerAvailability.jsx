import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/*
 * Speaking examiner: "My free time" (migration 135).
 * The examiner opens a window (e.g. 15:00–19:00, 15 minutes each) and the
 * site cuts it into slots. Students see the free ones and ask for one; the
 * examiner answers here. Accepting puts the session on the normal timetable.
 */

const LENGTHS = [10, 15, 20, 30, 45]
const LINK_KEY = 'ielts:examiner:lastMeetingLink'

const pad = (n) => String(n).padStart(2, '0')
const todayInput = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const dayLabel = (d) =>
  d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const timeLabel = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
const dayKey = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function readLink() {
  try {
    return localStorage.getItem(LINK_KEY) || ''
  } catch {
    return ''
  }
}

export default function ExaminerAvailability({ examinerId, onChanged }) {
  const [slots, setSlots] = useState([])
  const [requests, setRequests] = useState([])
  const [slotById, setSlotById] = useState({})
  const [students, setStudents] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [date, setDate] = useState(todayInput())
  const [from, setFrom] = useState('15:00')
  const [to, setTo] = useState('19:00')
  const [length, setLength] = useState(15)
  const [days, setDays] = useState(1)
  const [adding, setAdding] = useState(false)

  const [links, setLinks] = useState({})
  const [busy, setBusy] = useState('')
  const [armedDay, setArmedDay] = useState('')

  const load = useCallback(async () => {
    const nowIso = new Date().toISOString()
    const [{ data: slotRows, error: slotErr }, { data: reqRows, error: reqErr }] = await Promise.all([
      supabase
        .from('speaking_open_slots')
        .select('*')
        .eq('examiner_id', examinerId)
        .gte('starts_at', nowIso)
        .order('starts_at'),
      supabase
        .from('speaking_slot_requests')
        .select('*')
        .eq('examiner_id', examinerId)
        .eq('status', 'pending')
        .order('created_at'),
    ])
    if (slotErr || reqErr) setError((slotErr || reqErr).message)

    const reqList = reqRows || []
    const slotMap = Object.fromEntries((slotRows || []).map((s) => [s.id, s]))
    const missing = reqList.map((r) => r.open_slot_id).filter((id) => !slotMap[id])
    if (missing.length) {
      const { data: extra } = await supabase.from('speaking_open_slots').select('*').in('id', missing)
      ;(extra || []).forEach((s) => (slotMap[s.id] = s))
    }
    const studentIds = [...new Set(reqList.map((r) => r.student_id))]
    let studentMap = {}
    if (studentIds.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, username, target_band')
        .in('id', studentIds)
      studentMap = Object.fromEntries((profs || []).map((p) => [p.id, p]))
    }

    setSlots(slotRows || [])
    setRequests(reqList)
    setSlotById(slotMap)
    setStudents(studentMap)
    setLoading(false)
  }, [examinerId])

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`examiner-availability-${examinerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'speaking_slot_requests', filter: `examiner_id=eq.${examinerId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'speaking_open_slots', filter: `examiner_id=eq.${examinerId}` }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [examinerId, load])

  const preview = useMemo(() => {
    const [fh, fm] = from.split(':').map(Number)
    const [th, tm] = to.split(':').map(Number)
    const total = th * 60 + tm - (fh * 60 + fm)
    if (!Number.isFinite(total) || total < length) return 0
    return Math.floor(total / length) * Math.max(1, Math.min(14, Number(days) || 1))
  }, [from, to, length, days])

  const addSlots = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    const [fh, fm] = from.split(':').map(Number)
    const [th, tm] = to.split(':').map(Number)
    if (!date || [fh, fm, th, tm].some((n) => !Number.isFinite(n))) {
      setError('Pick a date and a from/to time.')
      return
    }
    if (th * 60 + tm - (fh * 60 + fm) < length) {
      setError('The "to" time must be at least one slot after the "from" time.')
      return
    }
    const rows = []
    const dayCount = Math.max(1, Math.min(14, Number(days) || 1))
    const now = Date.now()
    for (let i = 0; i < dayCount; i++) {
      const base = new Date(`${date}T00:00:00`)
      base.setDate(base.getDate() + i)
      let t = new Date(base)
      t.setHours(fh, fm, 0, 0)
      const end = new Date(base)
      end.setHours(th, tm, 0, 0)
      while (t.getTime() + length * 60000 <= end.getTime()) {
        if (t.getTime() > now) {
          rows.push({ examiner_id: examinerId, starts_at: t.toISOString(), duration_minutes: length })
        }
        t = new Date(t.getTime() + length * 60000)
      }
    }
    if (!rows.length) {
      setError('Those times are already in the past.')
      return
    }
    if (rows.length > 200) {
      setError('That is more than 200 slots at once — shorten the window or the number of days.')
      return
    }
    setAdding(true)
    const { error: insErr } = await supabase
      .from('speaking_open_slots')
      .upsert(rows, { onConflict: 'examiner_id,starts_at', ignoreDuplicates: true })
    setAdding(false)
    if (insErr) {
      setError(insErr.message)
      return
    }
    setNotice(`Opened ${rows.length} slot${rows.length === 1 ? '' : 's'}. Students can see them now.`)
    await load()
  }

  const removeSlot = async (slot) => {
    setError('')
    const { error: delErr } = await supabase.from('speaking_open_slots').delete().eq('id', slot.id).eq('status', 'open')
    if (delErr) setError(delErr.message)
    await load()
  }

  const removeDayFree = async (key) => {
    if (armedDay !== key) {
      setArmedDay(key)
      return
    }
    setArmedDay('')
    const ids = slots.filter((s) => s.status === 'open' && dayKey(s.starts_at) === key).map((s) => s.id)
    if (!ids.length) return
    const { error: delErr } = await supabase.from('speaking_open_slots').delete().in('id', ids).eq('status', 'open')
    if (delErr) setError(delErr.message)
    await load()
  }

  const respond = async (req, accept) => {
    setError('')
    setNotice('')
    setBusy(req.id)
    const link = (links[req.id] ?? readLink()).trim()
    const { error: rpcErr } = await supabase.rpc('respond_speaking_request', {
      p_request: req.id,
      p_accept: accept,
      p_meeting_link: accept && link ? link : null,
    })
    setBusy('')
    if (rpcErr) {
      setError(rpcErr.message)
      await load()
      return
    }
    if (accept && link) {
      try {
        localStorage.setItem(LINK_KEY, link)
      } catch {
        /* optional convenience */
      }
    }
    setNotice(accept ? 'Booked. It is on your timetable now and the student has been told.' : 'Declined. The student has been told.')
    await load()
    onChanged?.()
  }

  const grouped = useMemo(() => {
    const map = new Map()
    slots.forEach((s) => {
      const k = dayKey(s.starts_at)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(s)
    })
    return [...map.entries()]
  }, [slots])

  const inputCls = 'focus-ring h-11 rounded-[14px] border border-line bg-panel-2 px-3 text-sm text-paper'

  if (loading) return <p className="py-10 text-center text-sm text-mist">Loading…</p>

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-coral bg-panel-2 px-4 py-3 text-sm text-coral">{error}</div>}
      {notice && <div className="rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm font-semibold text-paper">{notice}</div>}

      <section className="space-y-3">
        <h3 className="font-brand text-[17px] font-semibold text-paper">
          Requests waiting for you{requests.length ? ` (${requests.length})` : ''}
        </h3>
        {requests.length === 0 ? (
          <p className="rounded-[20px] border border-dashed border-line bg-panel/80 px-5 py-6 text-sm text-mist">
            No requests right now. When a student asks for one of your free slots it appears here.
          </p>
        ) : (
          requests.map((req) => {
            const st = students[req.student_id]
            const slot = slotById[req.open_slot_id]
            return (
              <div key={req.id} className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <p className="text-[15px] font-semibold text-paper">{st?.full_name || st?.username || 'A student'}</p>
                  {st?.target_band != null && <span className="rounded-lg bg-panel-2 px-2 py-0.5 text-xs text-paper-dim">target {st.target_band}</span>}
                  <p className="ml-auto font-brand text-[15px] font-semibold text-speaking">
                    {slot ? `${dayLabel(new Date(slot.starts_at))}, ${timeLabel(slot.starts_at)} (${slot.duration_minutes} min)` : '—'}
                  </p>
                </div>
                <input
                  value={links[req.id] ?? readLink()}
                  onChange={(e) => setLinks((p) => ({ ...p, [req.id]: e.target.value }))}
                  placeholder="Meeting link (Zoom / Meet / Telegram) — optional, you can add it later"
                  className={`${inputCls} w-full`}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy === req.id}
                    onClick={() => respond(req, true)}
                    className="focus-ring h-11 rounded-[14px] bg-brass px-5 text-sm font-extrabold text-onbrass hover:bg-brass-dim disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busy === req.id}
                    onClick={() => respond(req, false)}
                    className="focus-ring h-11 rounded-[14px] border border-coral/40 px-5 text-sm font-extrabold text-coral hover:bg-urgent-tint disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            )
          })
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-brand text-[17px] font-semibold text-paper">Open free time</h3>
        <form onSubmit={addSlots} className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4">
          <div className="grid gap-3 sm:grid-cols-5">
            <label className="flex flex-col gap-1 text-xs font-bold text-mist">
              Date
              <input type="date" value={date} min={todayInput()} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-mist">
              Free from
              <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-mist">
              Free until
              <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-mist">
              Each slot
              <select value={length} onChange={(e) => setLength(Number(e.target.value))} className={inputCls}>
                {LENGTHS.map((n) => (
                  <option key={n} value={n}>{n} minutes</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-mist">
              Repeat for days
              <input type="number" min="1" max="14" value={days} onChange={(e) => setDays(e.target.value)} className={inputCls} />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={adding || preview === 0}
              className="focus-ring h-11 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50"
            >
              {adding ? 'Opening…' : preview ? `Open ${preview} slot${preview === 1 ? '' : 's'}` : 'Open slots'}
            </button>
            <p className="text-xs text-mist">
              Example: 15:00 to 19:00 with 15-minute slots opens 15:00, 15:15, 15:30 … 18:45. Slots you already opened are kept.
            </p>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h3 className="font-brand text-[17px] font-semibold text-paper">Your upcoming slots</h3>
        {grouped.length === 0 ? (
          <p className="rounded-[20px] border border-dashed border-line bg-panel/80 px-5 py-6 text-sm text-mist">
            No slots yet. Open some above and students will be able to ask for them.
          </p>
        ) : (
          grouped.map(([key, list]) => {
            const freeCount = list.filter((s) => s.status === 'open').length
            return (
              <div key={key} className="rounded-[20px] border border-line bg-panel p-4">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <p className="font-brand text-[15px] font-semibold text-paper">{dayLabel(new Date(list[0].starts_at))}</p>
                  <span className="text-xs text-mist">{freeCount} free · {list.length - freeCount} booked</span>
                  {freeCount > 0 && (
                    <button
                      type="button"
                      onClick={() => removeDayFree(key)}
                      onBlur={() => setArmedDay('')}
                      className="focus-ring ml-auto rounded-lg px-2 py-1 text-xs font-bold text-coral hover:bg-urgent-tint"
                    >
                      {armedDay === key ? 'Tap again to remove free slots' : 'Remove free slots'}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) =>
                    s.status === 'open' ? (
                      <span key={s.id} className="inline-flex items-center gap-1 rounded-xl border border-line bg-panel-2 py-1.5 pl-3 pr-1.5 text-sm font-bold text-paper">
                        {timeLabel(s.starts_at)}
                        <button
                          type="button"
                          onClick={() => removeSlot(s)}
                          aria-label={`Remove ${timeLabel(s.starts_at)}`}
                          className="focus-ring grid h-6 w-6 place-items-center rounded-lg text-mist hover:bg-urgent-tint hover:text-coral"
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <span key={s.id} className="rounded-xl bg-speaking-tint px-3 py-1.5 text-sm font-bold text-speaking">
                        {timeLabel(s.starts_at)} · booked
                      </span>
                    )
                  )}
                </div>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}
