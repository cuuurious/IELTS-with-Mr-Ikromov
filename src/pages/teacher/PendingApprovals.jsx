import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import EmptyState from '../../components/EmptyState'

export default function PendingApprovals() {
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState({ week: null, total: null })

  const load = async () => {
    setLoading(true)
    setError('')

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, full_name, username, role, status, contact_email, created_at, avatar_url',
        { count: 'exact' }
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    if (error) {
      console.error(
        'Failed to load pending approvals:',
        error
      )

      setError(error.message)
      setPending([])
    } else {
      setPending(data || [])
    }

    setLoading(false)

    // Two small numbers for the tiles at the top (2026-11-02).
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const [week, total] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('status', 'approved').gte('created_at', weekAgo),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('status', 'approved'),
    ])
    setCounts({ week: week.count ?? null, total: total.count ?? null })
  }

  useEffect(() => {
    load()

    const channel = supabase
      .channel('pending-approvals')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
        },
        () => {
          load()
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error(
            'Pending approvals realtime channel failed'
          )
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const decide = async (id, status) => {
    setError('')
    setActionId(id)

    const { error } = await supabase
      .from('profiles')
      .update({ status })
      .eq('id', id)

    if (error) {
      console.error(
        `Failed to ${status} student:`,
        error
      )

      setError(
        `Could not ${
          status === 'approved'
            ? 'approve'
            : 'reject'
        } this student: ${error.message}`
      )

      setActionId(null)
      return
    }

    setPending((prev) =>
      prev.filter(
        (student) => student.id !== id
      )
    )

    setActionId(null)
  }

  const filteredPending = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return pending
    }

    return pending.filter((student) => {
      return [
        student.full_name,
        student.username,
        student.contact_email,
        student.role,
      ]
        .filter(Boolean)
        .some((value) =>
          value
            .toLowerCase()
            .includes(query)
        )
    })
  }, [pending, search])

  const getInitial = (name, username) => {
    const source = (name || username || '?').trim()
    return source.charAt(0).toUpperCase() || '?'
  }

  if (loading) {
    return (
      <p className="text-mist">
        Loading...
      </p>
    )
  }

  const tiles = [
    { value: pending.length, label: 'waiting for you', tone: pending.length ? 'text-coral' : 'text-reading', bg: pending.length ? 'bg-urgent-tint' : 'bg-reading-tint' },
    { value: counts.week ?? '—', label: 'joined this week', tone: 'text-brass', bg: 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))]' },
    { value: counts.total ?? '—', label: 'students approved', tone: 'text-speaking', bg: 'bg-speaking-tint' },
  ]

  return (
    <div className="flex flex-col gap-5">

      {error && (
        <div className="rounded-[14px] border border-coral bg-coral/10 px-4 py-3 text-sm text-coral">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className={`rounded-[20px] px-5 py-4 ${t.bg}`}>
            <div className={`font-brand text-[30px] font-semibold leading-none ${t.tone}`}>{t.value}</div>
            <div className="mt-1.5 text-[13px] font-extrabold text-paper-dim">{t.label}</div>
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <label className="flex h-[46px] items-center gap-2.5 rounded-[14px] border border-line bg-panel px-3.5">
          <svg className="h-[18px] w-[18px] shrink-0 text-mist" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span className="sr-only">Search sign-ups</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a name or username"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-paper outline-none placeholder:text-mist"
          />
        </label>
      )}

      {pending.length === 0 ? (
        <EmptyState icon="check" title="All caught up" text="New sign-ups will appear here." />
      ) : filteredPending.length === 0 ? (
        <EmptyState icon="people" title="No one by that name" text="Try another name or username.">
          <button type="button" onClick={() => setSearch('')} className="focus-ring h-10 rounded-[14px] bg-panel px-4 text-sm font-extrabold text-brass">
            Clear search
          </button>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {filteredPending.map((student) => (
            <li key={student.id} className="flex flex-col gap-4 rounded-[20px] border border-line bg-panel p-4 sm:p-5">
              <div className="flex items-center gap-3.5">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-brass)_14%,var(--color-panel))] font-brand text-lg font-bold text-brass">
                  {student.avatar_url ? <img src={student.avatar_url} alt="" className="h-full w-full object-cover" /> : getInitial(student.full_name, student.username)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[16px] font-extrabold text-paper">{student.full_name || 'No name yet'}</div>
                  <div className="truncate text-[13px] font-semibold text-mist">@{student.username || 'no username'}</div>
                </div>
                {student.created_at && (
                  <span className="shrink-0 rounded-xl bg-panel-2 px-2.5 py-1 text-xs font-extrabold text-paper-dim">
                    {new Date(student.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={actionId === student.id}
                  onClick={() => decide(student.id, 'rejected')}
                  className="focus-ring h-11 rounded-[14px] border border-line bg-panel text-sm font-extrabold text-coral transition hover:bg-urgent-tint disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={actionId === student.id}
                  onClick={() => decide(student.id, 'approved')}
                  className="focus-ring h-11 rounded-[14px] bg-brass text-sm font-extrabold text-onbrass transition hover:brightness-110 disabled:opacity-40"
                >
                  {actionId === student.id ? 'Saving…' : 'Approve'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

    </div>
  )
}
