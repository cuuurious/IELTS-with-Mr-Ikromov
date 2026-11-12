import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/*
 * ENTRY TESTS — teacher (2026-11-11, migration_124).
 * The code people type on /entry (change it any time), a link to share,
 * and every entry test: name, phone, estimated band and level, the two
 * section scores, target, exam date, where they heard about the center,
 * the questions they got wrong, a "Contacted" tick and a note.
 */

const SITE = typeof window !== 'undefined' ? window.location.origin : 'https://ieltswithmrikromov.com'
const band = (b) => (b == null ? '—' : Number(b).toFixed(1))
const when = (t) =>
  t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const testName = (url = '') => {
  const m = /listening\/part-2\/test-(\d+)/.exec(url)
  if (m) return `Listening Part 2 · Test ${m[1]}`
  const r = /reading-full\/test-(\d+)/.exec(url)
  return r ? `Reading Test ${Number(r[1])} · Passage 1` : url
}

function Wrong({ qs }) {
  const wrong = (Array.isArray(qs) ? qs : []).filter((q) => !q.ok).map((q) => q.n)
  if (!Array.isArray(qs) || !qs.length) return <span className="text-mist">—</span>
  return wrong.length ? <span>Wrong: {wrong.join(', ')}</span> : <span className="text-reading">All right</span>
}

function Row({ t, onChange, onDelete }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState(t.note || '')
  const finished = !!t.finished_at

  const save = async (patch) => {
    const { error } = await supabase.from('entry_tests').update(patch).eq('id', t.id)
    if (!error) onChange({ ...t, ...patch })
  }

  return (
    <li className="rounded-[20px] border border-line bg-panel">
      <button type="button" onClick={() => setOpen((v) => !v)} className="focus-ring flex w-full items-center gap-3 rounded-[20px] px-4 py-3 text-left">
        <span className={`grid h-12 w-14 shrink-0 place-items-center rounded-[14px] font-brand text-[20px] font-semibold ${finished ? 'bg-brass/10 text-brass' : 'bg-panel-2 text-mist'}`}>
          {finished ? band(t.band) : '…'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-extrabold text-paper">{t.full_name}</span>
            {t.contacted && <span className="rounded-xl bg-reading-tint px-2 py-0.5 text-[11px] font-extrabold text-reading">Contacted</span>}
            {!finished && <span className="rounded-xl bg-panel-2 px-2 py-0.5 text-[11px] font-extrabold text-mist">{t.listening_at ? 'On reading' : 'Not finished'}</span>}
          </span>
          <span className="block truncate text-[13px] font-semibold text-mist">
            {t.level || 'In progress'} · {when(t.created_at)}
          </span>
        </span>
        <a href={`tel:${t.phone}`} onClick={(e) => e.stopPropagation()} className="focus-ring hidden shrink-0 rounded-[12px] bg-panel-2 px-3 py-2 text-[13px] font-extrabold text-paper sm:block">
          {t.phone}
        </a>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-[13px] font-semibold text-paper">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-[14px] bg-panel-2 px-3 py-2">
              <p className="text-[12px] font-extrabold uppercase tracking-wide text-listening">Listening · band {band(t.listening_band)}</p>
              <p>{t.listening_score != null ? `${t.listening_score} / ${t.listening_max}` : 'Not done'} · <Wrong qs={t.listening_qs} /></p>
              <p className="text-mist">{testName(t.listening_url)}</p>
            </div>
            <div className="rounded-[14px] bg-panel-2 px-3 py-2">
              <p className="text-[12px] font-extrabold uppercase tracking-wide text-reading">Reading · band {band(t.reading_band)}</p>
              <p>{t.reading_score != null ? `${t.reading_score} / ${t.reading_max}` : 'Not done'} · <Wrong qs={t.reading_qs} /></p>
              <p className="text-mist">{testName(t.reading_url)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>Phone: <a href={`tel:${t.phone}`} className="text-brass underline">{t.phone}</a></span>
            <span>Target: {t.target_band != null ? band(t.target_band) : 'not sure'}</span>
            <span>Exam: {t.exam_date ? new Date(t.exam_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'not booked'}</span>
            <span>Heard from: {t.heard_from || '—'}</span>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!t.contacted} onChange={(e) => save({ contacted: e.target.checked })} className="h-4 w-4" />
            Contacted
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (t.note || '') && save({ note })}
            rows={2}
            placeholder="Note (group, when they start…)"
            className="focus-ring w-full rounded-[14px] border border-line bg-panel px-3 py-2 text-[13px] text-paper"
          />
          <button type="button" onClick={() => onDelete(t)} className="focus-ring self-start text-[12px] font-extrabold text-urgent">
            Delete this test
          </button>
        </div>
      )}
    </li>
  )
}

export default function EntryTests() {
  const [code, setCode] = useState('')
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState('all')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    const [{ data: s }, { data, error: e }] = await Promise.all([
      supabase.from('entry_settings').select('code').eq('id', 1).maybeSingle(),
      supabase.from('entry_tests').select('*').order('created_at', { ascending: false }).limit(300),
    ])
    if (e) setError('Entry tests could not load. Has migration_124 been run?')
    setCode(s?.code || '')
    setRows(data || [])
  }
  // 2026-11-12: results appear by themselves — the list checks again
  // every 15 seconds while this tab is open (and when you come back to it).
  useEffect(() => {
    load()
    const tick = () => {
      if (document.visibilityState === 'visible') load()
    }
    const timer = setInterval(tick, 15000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [])

  const newCode = async () => {
    const next = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    const { error: e } = await supabase.from('entry_settings').update({ code: next, updated_at: new Date().toISOString() }).eq('id', 1)
    if (!e) setCode(next)
  }

  const link = `${SITE}/entry${code ? `?code=${code}` : ''}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const shown = useMemo(() => {
    const list = rows || []
    if (filter === 'todo') return list.filter((t) => t.finished_at && !t.contacted)
    if (filter === 'unfinished') return list.filter((t) => !t.finished_at)
    return list
  }, [rows, filter])

  const remove = async (t) => {
    if (!window.confirm(`Delete ${t.full_name}'s entry test?`)) return
    const { error: e } = await supabase.from('entry_tests').delete().eq('id', t.id)
    if (!e) setRows((r) => r.filter((x) => x.id !== t.id))
  }

  const todo = (rows || []).filter((t) => t.finished_at && !t.contacted).length

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="text-[13px] font-extrabold uppercase tracking-wide text-mist">Today’s code</p>
          <p className="font-brand text-[32px] font-semibold tracking-[0.3em] text-paper">{code || '····'}</p>
          <p className="text-[13px] font-semibold text-mist">People type it on {SITE.replace(/^https?:\/\//, '')}/entry. “Copy link with code” gives a link that fills it in for them.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copy} className="focus-ring h-11 rounded-[14px] bg-saffron px-4 text-[14px] font-extrabold text-[#17213a]">
            {copied ? 'Link copied' : 'Copy link with code'}
          </button>
          <button type="button" onClick={newCode} className="focus-ring h-11 rounded-[14px] border border-line px-4 text-[14px] font-extrabold text-paper">
            New code
          </button>
        </div>
      </section>

      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-urgent">{error}</p>}

      <div className="flex gap-1.5 overflow-x-auto">
        {[
          ['all', `All (${rows?.length || 0})`],
          ['todo', `To contact (${todo})`],
          ['unfinished', 'Not finished'],
        ].map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`focus-ring h-10 shrink-0 rounded-[12px] px-4 text-[13px] font-extrabold ${filter === k ? 'bg-brass text-white' : 'bg-panel text-paper-dim'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {rows === null ? (
        <p className="py-10 text-center text-sm text-mist">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="rounded-[20px] border border-dashed border-line px-4 py-10 text-center text-sm font-semibold text-mist">
          {rows.length ? 'Nothing here.' : 'No entry tests yet. Share the link above and results appear here.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((t) => (
            <Row key={t.id} t={t} onDelete={remove} onChange={(n) => setRows((r) => r.map((x) => (x.id === n.id ? n : x)))} />
          ))}
        </ul>
      )}
    </div>
  )
}
