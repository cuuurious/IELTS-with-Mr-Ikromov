import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Icon from '../../components/Icon'

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-mist">
          Errors that happened on someone&apos;s phone or computer while using the website (last 30 days).
          Send this list to whoever fixes the site — one row can be many people hitting the same problem.
        </p>
        <button type="button" onClick={load} className="focus-ring rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brass/50">
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-coral">{error}</p>}

      {groups.length === 0 ? (
        <div className="rounded-lg border border-line bg-panel-2 px-5 py-8 text-sm text-mist">No errors reported. <Icon name="party" className="h-4 w-4" /></div>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map((group) => {
            const people = new Set(group.rows.map((r) => r.user_id || r.user_agent)).size
            const latest = group.rows[0]
            const isOpen = open === group.message
            return (
              <li key={group.message} className="rounded-xl border border-line bg-panel">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : group.message)}
                  className="focus-ring flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="break-words font-mono text-sm text-paper">{group.message}</p>
                    <p className="mt-1 text-xs text-mist">
                      {group.rows.length}× · {people} {people === 1 ? 'person' : 'people'} · last{' '}
                      {new Date(latest.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                  <span className="text-xs text-mist">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
                    <ul className="flex flex-col gap-1 text-xs text-mist">
                      {group.rows.slice(0, 15).map((r) => (
                        <li key={r.id}>
                          {new Date(r.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} —{' '}
                          <span className="text-paper-dim">{r.profiles?.full_name || 'Not signed in'}</span>
                          {r.role ? ` (${r.role})` : ''} · {describeDevice(r.user_agent)} · {r.url}
                        </li>
                      ))}
                    </ul>
                    {latest.stack && (
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-panel-2 p-3 text-[11px] text-mist">{latest.stack}</pre>
                    )}
                    <button
                      type="button"
                      disabled={busy === group.message}
                      onClick={() => clearGroup(group)}
                      className="focus-ring self-start rounded-lg border border-line px-3 py-1.5 text-xs hover:border-sage/50 hover:text-sage disabled:opacity-50"
                    >
                      Mark as fixed (remove)
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
