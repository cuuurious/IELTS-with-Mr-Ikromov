import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/*
 * Student side of speaking-exam booking (migration 135).
 * Free slots are shown as buttons, taken slots greyed out (no names or
 * details of who booked). Asking for a slot sends a request; once the
 * examiner accepts, it is officially booked and shows in "Speaking Exam".
 * One pending request or upcoming booking at a time; cancel up to 2 hours
 * before the start.
 */

const pad = (n) => String(n).padStart(2, '0')
const dayKey = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const dayLabel = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const timeLabel = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
const fullLabel = (iso) => `${dayLabel(iso)}, ${timeLabel(iso)}`

const HORIZON_DAYS = 21

export default function StudentSpeakingBooking({ selfId, hasUpcomingSlot, onChanged }) {
  const [examiners, setExaminers] = useState([])
  const [slots, setSlots] = useState([])
  const [myRequests, setMyRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [picked, setPicked] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const from = new Date().toISOString()
    const to = new Date(Date.now() + HORIZON_DAYS * 86400000).toISOString()
    const [{ data: ex }, { data: sl }, { data: rq }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, username')
        .eq('role', 'speaking_examiner')
        .eq('status', 'approved'),
      supabase
        .from('speaking_open_slots')
        .select('*')
        .gte('starts_at', from)
        .lte('starts_at', to)
        .order('starts_at'),
      supabase
        .from('speaking_slot_requests')
        .select('*')
        .eq('student_id', selfId)
        .in('status', ['pending', 'accepted'])
        .order('created_at', { ascending: false }),
    ])
    setExaminers(ex || [])
    setSlots(sl || [])

    const reqs = rq || []
    const ids = reqs.map((r) => r.open_slot_id)
    let slotMap = {}
    if (ids.length) {
      const { data: rs } = await supabase.from('speaking_open_slots').select('*').in('id', ids)
      slotMap = Object.fromEntries((rs || []).map((s) => [s.id, s]))
    }
    setMyRequests(
      reqs
        .map((r) => ({ ...r, slot: slotMap[r.open_slot_id] }))
        .filter((r) => r.slot && (r.status === 'pending' || new Date(r.slot.starts_at) > new Date()))
    )
    setLoading(false)
  }, [selfId])

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`student-booking-${selfId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'speaking_open_slots' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'speaking_slot_requests', filter: `student_id=eq.${selfId}` }, () => {
        load()
        onChanged?.()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [selfId, load])

  const nameOf = useMemo(() => {
    const map = Object.fromEntries(examiners.map((e) => [e.id, e.full_name || e.username]))
    return (id) => map[id] || 'Examiner'
  }, [examiners])

  const active = myRequests[0] || null
  const blocked = Boolean(active) || hasUpcomingSlot

  const visibleSlots = useMemo(() => {
    const soon = Date.now() + 30 * 60000
    return slots.filter(
      (s) => new Date(s.starts_at).getTime() > Date.now() && (filter === 'all' || s.examiner_id === filter)
    ).filter((s) => s.status === 'booked' || new Date(s.starts_at).getTime() >= soon)
  }, [slots, filter])

  const grouped = useMemo(() => {
    const map = new Map()
    visibleSlots.forEach((s) => {
      const k = dayKey(s.starts_at)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(s)
    })
    return [...map.entries()]
  }, [visibleSlots])

  const send = async () => {
    if (!picked) return
    setBusy('send')
    setError('')
    setNotice('')
    const { error: rpcErr } = await supabase.rpc('request_speaking_slot', { p_open_slot: picked.id, p_note: note || null })
    setBusy('')
    if (rpcErr) {
      setError(rpcErr.message)
      setPicked(null)
      await load()
      return
    }
    setPicked(null)
    setNote('')
    setNotice('Request sent. You will be notified as soon as the examiner answers.')
    await load()
  }

  const cancel = async (req) => {
    setBusy(req.id)
    setError('')
    setNotice('')
    const { error: rpcErr } = await supabase.rpc('cancel_speaking_request', { p_request: req.id })
    setBusy('')
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setNotice(req.status === 'accepted' ? 'Your session was cancelled and the slot is free again.' : 'Request cancelled.')
    await load()
    onChanged?.()
  }

  if (loading) return <p className="py-6 text-center text-sm text-mist">Loading free times…</p>

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="rounded-xl border border-coral bg-panel-2 px-4 py-3 text-sm text-coral">{error}</div>}
      {notice && <div className="rounded-xl border border-line bg-panel-2 px-4 py-3 text-sm font-semibold text-paper">{notice}</div>}

      {active && (
        <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-line bg-speaking-tint/60 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold uppercase tracking-wide text-speaking">
              {active.status === 'pending' ? 'Waiting for the examiner' : 'Confirmed'}
            </p>
            <p className="font-brand text-[16px] font-semibold text-paper">{fullLabel(active.slot.starts_at)}</p>
            <p className="text-[13px] text-paper-dim">with {nameOf(active.examiner_id)} · {active.slot.duration_minutes} minutes</p>
          </div>
          <button
            type="button"
            disabled={busy === active.id}
            onClick={() => cancel(active)}
            className="focus-ring h-11 rounded-[14px] border border-coral/40 px-4 text-sm font-extrabold text-coral hover:bg-urgent-tint disabled:opacity-50"
          >
            {active.status === 'pending' ? 'Cancel request' : 'Cancel session'}
          </button>
        </div>
      )}

      <div className="rounded-[20px] border border-line bg-panel p-5">
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h3 className="font-brand text-[17px] font-semibold text-paper">Book a speaking session</h3>
          {examiners.length > 1 && (
            <div className="ml-auto flex flex-wrap gap-1.5">
              {[{ id: 'all', name: 'All examiners' }, ...examiners.map((e) => ({ id: e.id, name: e.full_name || e.username }))].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setFilter(o.id)}
                  className={`focus-ring rounded-full px-3 py-1.5 text-xs font-extrabold transition ${
                    filter === o.id ? 'bg-brass text-onbrass' : 'border border-line text-paper-dim hover:text-paper'
                  }`}
                >
                  {o.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="mb-4 text-[13px] text-mist">
          Pick a free time and send a request. The session is officially booked once the examiner accepts. You can hold one request or session at a time.
          {blocked && ' Cancel your current one above to pick another time.'}
        </p>

        {grouped.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-line px-4 py-8 text-center text-sm text-mist">
            No free times yet. The examiner opens new slots regularly — check back soon or send a message.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map(([key, list]) => (
              <div key={key}>
                <p className="mb-2 text-sm font-extrabold text-paper">{dayLabel(list[0].starts_at)}</p>
                <div className="flex flex-wrap gap-2">
                  {list.map((s) => {
                    const label = timeLabel(s.starts_at)
                    const who = examiners.length > 1 && filter === 'all' ? ` · ${String(nameOf(s.examiner_id)).split(' ')[0]}` : ''
                    if (s.status === 'booked') {
                      return (
                        <span key={s.id} className="rounded-xl bg-panel-2 px-3 py-2 text-sm font-bold text-mist line-through decoration-1">
                          {label}{who}
                        </span>
                      )
                    }
                    const isPicked = picked?.id === s.id
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={blocked}
                        onClick={() => setPicked(isPicked ? null : s)}
                        className={`focus-ring rounded-xl border px-3 py-2 text-sm font-extrabold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          isPicked ? 'border-brass bg-brass text-onbrass' : 'border-speaking/40 bg-speaking-tint text-speaking hover:border-speaking'
                        }`}
                      >
                        {label}{who}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <p className="text-xs text-mist">Crossed-out times are already taken.</p>
          </div>
        )}

        {picked && !blocked && (
          <div className="mt-5 flex flex-col gap-3 rounded-[14px] border border-brass/40 bg-panel-2 p-4">
            <p className="text-sm font-extrabold text-paper">
              Ask for {fullLabel(picked.starts_at)} with {nameOf(picked.examiner_id)} ({picked.duration_minutes} min)?
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 200))}
              placeholder="Message for the examiner (optional)"
              className="focus-ring h-11 rounded-[14px] border border-line bg-panel px-3 text-sm text-paper"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy === 'send'}
                onClick={send}
                className="focus-ring h-11 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50"
              >
                {busy === 'send' ? 'Sending…' : 'Send request'}
              </button>
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="focus-ring h-11 rounded-[14px] border border-line px-4 text-sm font-extrabold text-paper-dim hover:text-paper"
              >
                Not now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
