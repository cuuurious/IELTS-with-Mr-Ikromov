import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/*
 * SHARED LOGINS (2026-11-06, migration_109). Students whose account kept
 * moving between devices in the last two weeks — a sign that the login is
 * shared. "Sign out everywhere" closes it on every device; they sign in
 * again. Only shows when there is something to see.
 */
const fmt = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

export default function SharedLogins() {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () =>
    supabase.rpc('shared_login_report', { p_days: 14 }).then(({ data, error }) => setRows(error ? false : data || []))
  useEffect(() => {
    load()
  }, [])

  if (!rows || !rows.length) return null
  const strong = rows.filter((r) => r.switches >= 4 || r.devices >= 3)

  const signOutAll = async (r) => {
    setMsg('')
    const { error } = await supabase.rpc('sign_out_everywhere', { p_user: r.user_id })
    setMsg(error ? error.message : `${r.full_name} is signed out on every device within a minute.`)
  }

  return (
    <section className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="focus-ring flex items-center gap-3 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-urgent-tint text-coral" aria-hidden="true">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="12" height="9" rx="2" />
            <rect x="15" y="10" width="6" height="10" rx="1.5" />
            <path d="M7 17h5" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-extrabold text-paper">Shared logins?</span>
          <span className="block text-[12px] font-semibold text-mist">
            {rows.length} student{rows.length === 1 ? '' : 's'} switched devices in the last 14 days{strong.length ? ` · ${strong.length} often` : ''}
          </span>
        </span>
        <span className="text-[13px] font-extrabold text-brass">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <>
          <p className="text-[12px] font-semibold text-mist">
            Each student account can be open on one phone and one computer at a time; signing in on a second phone (or a second computer) signs the old one out. Many switches between different phones or computers usually means the login is shared.
          </p>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
              const hot = r.switches >= 4 || r.devices >= 3
              return (
                <li key={r.user_id} className={`flex min-w-0 flex-wrap items-center gap-3 rounded-[14px] px-3 py-2.5 ${hot ? 'bg-urgent-tint/60' : 'bg-panel-2/70'}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-extrabold text-paper">{r.full_name}</span>
                    <span className="block truncate text-[12px] font-semibold text-mist">
                      {r.switches} switches · {r.devices} device{r.devices === 1 ? '' : 's'} · last {fmt(r.last_switch)}
                    </span>
                    {r.labels && <span className="block truncate text-[12px] text-paper-dim">{r.labels}</span>}
                  </span>
                  <button type="button" onClick={() => signOutAll(r)} className="focus-ring h-9 shrink-0 rounded-[12px] bg-panel px-3 text-[12px] font-extrabold text-coral hover:brightness-95">
                    Sign out everywhere
                  </button>
                </li>
              )
            })}
          </ul>
          {msg && <p className="text-[12px] font-bold text-paper-dim">{msg}</p>}
        </>
      )}
    </section>
  )
}
