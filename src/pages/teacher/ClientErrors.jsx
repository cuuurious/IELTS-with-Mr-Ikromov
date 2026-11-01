import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import EmptyState from '../../components/EmptyState'

/*
 * ERRORS (2026-10-02) — what broke on students' / staff phones.
 * Filled by lib/errorReporter.js; old rows are cleared automatically
 * after 30 days. Same error from many people is grouped into one row.
 */
function describeDevice(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Other'
  const browser = /Telegram/i.test(ua) ? 'Telegram browser' : /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : 'browser'
  return `${os} · ${browser}`
}

export default function ClientErrors() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState('')

  const load = async () => {
    setError('')
    const plain = await supabase
      .from('client_errors')
      .select('id, user_id, role, message, stack, url, user_agent, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (plain.error) {
      setError(plain.error.message)
      setRows([])
      return
    }
    const ids = [...new Set((plain.data || []).map((r) => r.user_id).filter(Boolean))]
    let names = {}
    if (ids.length) {
      const { data: people } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      names = Object.fromEntries((people || []).map((p) => [p.id, p.full_name]))
    }
    setRows((plain.data || []).map((r) => ({ ...r, profiles: { full_name: names[r.user_id] } })))
  }

  useEffect(() => {
    load()
  }, [])

  const groups = useMemo(() => {
    const map = new Map()
    for (const row of rows || []) {
      const key = row.message
      if (!map.has(key)) map.set(key, { message: row.message, rows: [] })
      map.get(key).rows.push(row)
    }
    return [...map.values()].sort((a, b) => b.rows[0].created_at.localeCompare(a.rows[0].created_at))
  }, [rows])

  const clearGroup = async (group) => {
    setBusy(group.message)
    const { error: delError } = await supabase.from('client_errors').delete().in('id', group.rows.map((r) => r.id))
    setBusy('')
    if (delError) {
      setError(delError.message)
      return
    }
    setRows((prev) => prev.filter((r) => r.message !== group.message))
  }

  if (rows === null) return <p className="py-10 text-center text-sm text-mist">Loading…</p>

  const weekAgo = Date.now() - 7 * 86400000
  const thisWeek = (rows || []).filter((r) => new Date(r.created_at).getTime() >= weekAgo).length
  const peopleAll = new Set((rows || []).map((r) => r.user_id || r.user_agent)).size
  const fmtDay = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
        {[
          { v: groups.length, l: 'different problems', c: groups.length ? 'bg-urgent-tint text-coral' : 'bg-reading-tint text-reading' },
          { v: thisWeek, l: 'times this week', c: 'bg-[color-mix(in_srgb,var(--color-saffron)_16%,var(--color-panel))] text-amber' },
          { v: peopleAll, l: 'people affected', c: 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] text-brass' },
        ].map((t) => (
          <div key={t.l} className={`rounded-[20px] px-5 py-4 ${t.c}`}>
            <div className="font-brand text-[30px] font-semibold leading-none">{t.v}</div>
            <div className="mt-1.5 text-[13px] font-extrabold text-paper-dim">{t.l}</div>
          </div>
        ))}
        <button type="button" onClick={load} className="focus-ring min-h-[64px] rounded-[20px] border border-line bg-panel px-6 text-sm font-extrabold text-brass hover:bg-panel-2">
          Refresh
        </button>
      </div>
      <p className="px-1 text-[13px] font-semibold text-mist">Last 30 days. The same problem from many people shows once.</p>

      {error && <p className="text-sm text-coral">{error}</p>}

      {groups.length === 0 ? (
        <EmptyState icon="shield" title="No problems reported" text="Everything is running smoothly." />
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((group) => {
            const people = new Set(group.rows.map((r) => r.user_id || r.user_agent)).size
            const latest = group.rows[0]
            const isOpen = open === group.message
            const serious = group.rows.length >= 5 || people >= 3
            return (
              <li key={group.message} className="overflow-hidden rounded-[20px] border border-line bg-panel">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : group.message)}
                  aria-expanded={isOpen}
                  className="focus-ring flex w-full items-center gap-4 px-4 py-4 text-left sm:px-5"
                >
                  <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl font-brand text-[15px] font-bold ${serious ? 'bg-urgent-tint text-coral' : 'bg-[color-mix(in_srgb,var(--color-saffron)_16%,var(--color-panel))] text-amber'}`}>
                    {group.rows.length}×
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-extrabold text-paper">{group.message}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5 text-xs font-bold">
                      <span className="rounded-lg bg-panel-2 px-2 py-0.5 text-paper-dim">{people} {people === 1 ? 'person' : 'people'}</span>
                      <span className="rounded-lg bg-panel-2 px-2 py-0.5 text-paper-dim">last {fmtDay(latest.created_at)}</span>
                      <span className="rounded-lg bg-panel-2 px-2 py-0.5 text-paper-dim">{describeDevice(latest.user_agent)}</span>
                    </span>
                  </span>
                  <svg className={`h-5 w-5 shrink-0 text-mist transition ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-3 border-t border-line bg-panel-2/50 px-4 py-4 sm:px-5">
                    <ul className="flex flex-col gap-1.5">
                      {group.rows.slice(0, 15).map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                          <span className="font-extrabold text-paper">{r.profiles?.full_name || 'Not signed in'}</span>
                          <span className="text-mist">{fmtDay(r.created_at)} · {describeDevice(r.user_agent)}</span>
                          <span className="truncate text-xs text-mist">{r.url}</span>
                        </li>
                      ))}
                    </ul>
                    {latest.stack && (
                      <details className="rounded-[14px] bg-panel p-3">
                        <summary className="cursor-pointer text-xs font-extrabold text-paper-dim">Technical details</summary>
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] text-mist">{latest.stack}</pre>
                      </details>
                    )}
                    <button
                      type="button"
                      disabled={busy === group.message}
                      onClick={() => clearGroup(group)}
                      className="focus-ring h-10 self-start rounded-[14px] bg-reading px-4 text-[13px] font-extrabold text-white transition hover:brightness-110 disabled:opacity-50"
                    >
                      Mark as fixed
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
