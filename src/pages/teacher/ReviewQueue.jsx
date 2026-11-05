import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { parseSpeakingUrl, loadSpeakingSet } from '../../lib/speaking'
import TeacherBand from '../../components/homework/TeacherBand'
import WritingFeedback from '../../components/homework/WritingFeedback'
import SpeakingFeedback from '../../components/speaking/SpeakingFeedback'
import CommonMistakes from '../../components/teacher/CommonMistakes'

/*
 * REVIEW (2026-11-05, migration_107). One queue for Mr Ikromov:
 *   To check  — writing and speaking homework the AI has marked, waiting
 *               for his band (confirm the AI band or change it, one click);
 *   Speaking mocks — requests to unlock, mocks to give, finished mocks.
 * The student sees his band and comment above the AI feedback.
 */

const fmt = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const kindOf = (t) => (/^speaking/.test(t?.question_type || '') || /^speaking:/.test(t?.html_url || '') ? 'speaking' : 'writing')
const nameOf = (p) => p?.full_name || p?.username || 'Student'

export default function ReviewQueue() {
  const [tab, setTab] = useState('check')
  const [rows, setRows] = useState(null)
  const [mocks, setMocks] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null) // { kind, row, table }
  const [showDone, setShowDone] = useState(false)

  const load = async () => {
    setError('')
    const since = new Date(Date.now() - 45 * 86400000).toISOString()
    const [a, m] = await Promise.all([
      supabase
        .from('homework_attempts')
        .select('id, user_id, band, submitted_at, task_id, ai_status:results->ai->>status, ai_band:results->ai->overall_band, teacher:results->teacher, homework_tasks!inner(title, html_url, question_type, homeworks(group_id, groups(name))), profiles!homework_attempts_user_id_fkey(full_name, username)')
        .not('submitted_at', 'is', null)
        .gte('submitted_at', since)
        .not('results->ai', 'is', null)
        .order('submitted_at', { ascending: false })
        .limit(200),
      supabase
        .from('speaking_mocks')
        .select('id, user_id, status, source, set_id, band, created_at, submitted_at, ai_status:results->ai->>status, teacher:results->teacher, sp_set:results->speaking->>setId, profiles!speaking_mocks_user_id_fkey(full_name, username)')
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    if (a.error) setError(a.error.message)
    setRows((a.data || []).filter((r) => r.ai_status === 'done' || r.ai_status === 'error'))
    setMocks(m.error ? false : m.data || [])
  }

  useEffect(() => {
    load()
  }, [])

  const toCheck = useMemo(() => (rows || []).filter((r) => (showDone ? true : !r.teacher)), [rows, showDone])
  const waitingCount = (rows || []).filter((r) => !r.teacher).length
  const requests = (mocks || []).filter((m) => m.status === 'requested')
  const finished = (mocks || []).filter((m) => m.status === 'done')
  const openMocks = (mocks || []).filter((m) => m.status === 'unlocked')

  const decide = async (m, unlock) => {
    const { error: e } = await supabase.rpc('decide_speaking_mock', { p_id: m.id, p_unlock: unlock })
    if (e) setError(e.message)
    load()
  }

  const confirmAi = async (r) => {
    // One click: the AI band becomes the teacher's band.
    const b = r.ai_band
    if (b == null) return
    // Read the latest results first so nothing in them is lost.
    const { data: cur, error: readErr } = await supabase.from('homework_attempts').select('results').eq('id', r.id).maybeSingle()
    if (readErr) return setError(readErr.message)
    const teacher = { band: Number(b), comment: '', at: new Date().toISOString() }
    const { error: e } = await supabase.from('homework_attempts').update({ band: Number(b), results: { ...(cur?.results || {}), teacher } }).eq('id', r.id)
    if (e) return setError(e.message)
    setRows((list) => list.map((x) => (x.id === r.id ? { ...x, band: Number(b), teacher } : x)))
  }

  if (open) {
    return <ReviewItem item={open} onBack={() => { setOpen(null); load() }} />
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist">
        {[
          ['check', `To check${waitingCount ? ` · ${waitingCount}` : ''}`],
          ['mocks', `Speaking mocks${requests.length ? ` · ${requests.length} new` : ''}`],
          ['common', 'Common mistakes'],
        ].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`focus-ring h-10 shrink-0 rounded-[12px] px-4 text-[13px] font-extrabold ${tab === k ? 'bg-brass text-onbrass' : 'bg-panel text-paper-dim hover:text-paper'}`}>
            {l}
          </button>
        ))}
      </div>
      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}

      {tab === 'check' && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] font-semibold text-mist">Writing and speaking homework from the last 45 days that the AI has marked. Confirm the AI band, or open it to give your own band and a comment.</p>
            <label className="flex items-center gap-2 text-[13px] font-bold text-paper-dim">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show checked ones
            </label>
          </div>
          {rows === null ? (
            <p className="text-sm font-semibold text-mist">Loading…</p>
          ) : !toCheck.length ? (
            <p className="rounded-[20px] border border-line bg-panel p-6 text-center text-sm font-bold text-paper-dim">All checked ✓</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {toCheck.map((r) => {
                const t = r.homework_tasks
                const kind = kindOf(t)
                const ai = { status: r.ai_status, overall_band: r.ai_band }
                const mine = r.teacher
                return (
                  <li key={r.id} className="flex min-w-0 items-center gap-3 rounded-[16px] border border-line bg-panel p-3">
                    <span className={`grid h-12 min-w-[52px] shrink-0 place-items-center rounded-[14px] px-2 font-brand text-[18px] font-semibold ${kind === 'speaking' ? 'bg-speaking-tint text-speaking' : 'bg-writing-tint text-writing'}`}>
                      {mine ? Number(mine.band).toFixed(1) : ai?.overall_band != null ? Number(ai.overall_band).toFixed(1) : '—'}
                    </span>
                    <button type="button" onClick={() => setOpen({ kind, row: r, table: 'homework_attempts', url: t?.html_url })} className="focus-ring min-w-0 flex-1 text-left">
                      <span className="block truncate text-[14px] font-extrabold text-paper">{nameOf(r.profiles)}</span>
                      <span className="block truncate text-[12px] font-semibold text-mist">
                        {t?.homeworks?.groups?.name ? `${t.homeworks.groups.name} · ` : ''}{t?.title} · {fmt(r.submitted_at)}
                      </span>
                      <span className={`block text-[12px] font-bold ${mine ? 'text-reading' : ai?.status === 'error' ? 'text-coral' : 'text-paper-dim'}`}>
                        {mine ? 'Your band ✓' : ai?.status === 'error' ? 'AI marking failed — open to mark' : 'AI band · waiting for you'}
                      </span>
                    </button>
                    {!mine && ai?.overall_band != null && (
                      <button type="button" onClick={() => confirmAi(r)} title="Use the AI band as your band" className="focus-ring h-10 shrink-0 rounded-[12px] bg-panel-2 px-3 text-[12px] font-extrabold text-paper hover:brightness-95">
                        Confirm {Number(ai.overall_band).toFixed(1)}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {tab === 'common' && <GroupMistakes />}

      {tab === 'mocks' && (
        <section className="flex flex-col gap-4">
          {mocks === false ? (
            <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">Run migration_107 first.</p>
          ) : (
            <>
              <GiveMock onGiven={load} />
              <Block title={`Requests${requests.length ? ` · ${requests.length}` : ''}`} empty="No requests.">
                {requests.map((m) => (
                  <li key={m.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-[16px] border border-line bg-panel p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-extrabold text-paper">{nameOf(m.profiles)}</span>
                      <span className="block text-[12px] font-semibold text-mist">Asked {fmt(m.created_at)}</span>
                    </span>
                    <button type="button" onClick={() => decide(m, false)} className="focus-ring h-10 rounded-[12px] px-3 text-[13px] font-extrabold text-mist hover:text-paper">Not now</button>
                    <button type="button" onClick={() => decide(m, true)} className="focus-ring h-10 rounded-[12px] bg-saffron px-4 text-[13px] font-extrabold text-[#17213a]">Unlock</button>
                  </li>
                ))}
              </Block>
              {openMocks.length > 0 && (
                <Block title="Open, not taken yet">
                  {openMocks.map((m) => (
                    <li key={m.id} className="rounded-[16px] border border-line bg-panel p-3 text-[13px] font-bold text-paper">
                      {nameOf(m.profiles)} <span className="font-semibold text-mist">· {m.source === 'coins' ? 'bought with coins' : 'unlocked by you'}</span>
                    </li>
                  ))}
                </Block>
              )}
              <Block title="Finished" empty="No speaking mocks yet.">
                {finished.map((m) => {
                  const mine = m.teacher
                  const ai = { status: m.ai_status }
                  return (
                    <li key={m.id} className="min-w-0">
                      <button type="button" onClick={() => setOpen({ kind: 'speaking', row: m, table: 'speaking_mocks', url: `speaking:${m.set_id || m.sp_set}#full` })} className="focus-ring flex w-full items-center gap-3 rounded-[16px] border border-line bg-panel p-3 text-left hover:brightness-95">
                        <span className="grid h-12 min-w-[52px] shrink-0 place-items-center rounded-[14px] bg-speaking-tint px-2 font-brand text-[18px] font-semibold text-speaking">
                          {(mine?.band ?? m.band) != null ? Number(mine?.band ?? m.band).toFixed(1) : '—'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-extrabold text-paper">{nameOf(m.profiles)}</span>
                          <span className="block truncate text-[12px] font-semibold text-mist">{fmt(m.submitted_at)} · {mine ? 'your band ✓' : ai?.status === 'done' ? 'AI band · waiting for you' : ai?.status === 'error' ? 'AI marking failed' : 'marking…'}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </Block>
            </>
          )}
        </section>
      )}
    </div>
  )
}

function Block({ title, empty, children }) {
  const list = Array.isArray(children) ? children : [children]
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-brand text-[16px] font-semibold text-paper">{title}</h3>
      {list.filter(Boolean).length ? <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">{children}</ul> : <p className="text-[13px] font-semibold text-mist">{empty}</p>}
    </div>
  )
}

// Give a mock to any student without a request.
function GiveMock({ onGiven }) {
  const [students, setStudents] = useState(null)
  const [pick, setPick] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, username')
      .eq('role', 'student')
      .order('full_name')
      .then(({ data }) => setStudents(data || []))
  }, [])
  const give = async () => {
    if (!pick) return
    setMsg('')
    const { error } = await supabase.rpc('give_speaking_mock', { p_user: pick })
    setMsg(error ? error.message : 'Opened ✓ — the student was told.')
    if (!error) {
      setPick('')
      onGiven?.()
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[16px] bg-panel-2/60 p-3">
      <span className="text-[13px] font-extrabold text-paper">Open a mock for</span>
      <select value={pick} onChange={(e) => setPick(e.target.value)} className="focus-ring h-10 min-w-0 flex-1 rounded-[12px] border border-line bg-panel px-2 text-[13px] font-bold text-paper sm:max-w-xs" aria-label="Student">
        <option value="">Choose a student…</option>
        {(students || []).map((s) => (
          <option key={s.id} value={s.id}>{s.full_name || s.username}</option>
        ))}
      </select>
      <button type="button" onClick={give} disabled={!pick} className="focus-ring h-10 rounded-[12px] bg-brass px-4 text-[13px] font-extrabold text-onbrass disabled:opacity-50">Open it</button>
      {msg && <span className="w-full text-[12px] font-bold text-paper-dim">{msg}</span>}
    </div>
  )
}

function ReviewItem({ item, onBack }) {
  const [row, setRow] = useState({ ...item.row, results: null })
  const [set, setSet] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase
      .from(item.table)
      .select('id, band, results')
      .eq('id', item.row.id)
      .maybeSingle()
      .then(({ data }) => setRow((r) => ({ ...r, ...(data || {}), results: data?.results || {} })))
  }, [item])

  useEffect(() => {
    if (item.kind !== 'speaking') return
    const ref = parseSpeakingUrl(item.url)
    if (ref) loadSpeakingSet(ref.setId).then(setSet).catch(() => setSet({ content: {} }))
    else setSet({ content: {} })
  }, [item])

  const markAgain = async () => {
    setBusy(true)
    const body = item.table === 'speaking_mocks' ? { action: 'speaking_task', mockId: row.id } : { action: 'speaking_task', attemptId: row.id }
    await supabase.functions.invoke('ai-grading', { body })
    const { data } = await supabase.from(item.table).select('id, band, results').eq('id', row.id).maybeSingle()
    if (data) setRow((r) => ({ ...r, ...data }))
    setBusy(false)
  }

  const who = row.profiles ? nameOf(row.profiles) : ''
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="focus-ring h-10 rounded-[12px] bg-panel px-4 text-sm font-extrabold text-paper hover:bg-panel-2">← Back to the list</button>
        <p className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-paper">{who}{row.homework_tasks?.title ? ` · ${row.homework_tasks.title}` : item.table === 'speaking_mocks' ? ' · Speaking mock' : ''}</p>
      </div>
      {!row.results ? <p className="text-sm font-semibold text-mist">Loading…</p> : <>
      <TeacherBand attemptId={row.id} table={item.table} results={row.results} aiBand={row.results?.ai?.overall_band} onSaved={(next) => setRow((r) => ({ ...r, results: next, band: next.teacher?.band ?? r.band }))} />
      {item.kind === 'speaking' ? (
        <>
          {row.results?.ai?.status === 'error' && (
            <button type="button" onClick={markAgain} disabled={busy} className="focus-ring self-start h-10 rounded-[12px] bg-speaking px-4 text-[13px] font-extrabold text-white disabled:opacity-50">
              {busy ? 'Marking… (about a minute)' : 'Mark with AI again'}
            </button>
          )}
          {set ? <SpeakingFeedback set={set} results={row.results} teacher /> : <p className="text-sm font-semibold text-mist">Loading…</p>}
        </>
      ) : (
        <WritingFeedback results={row.results} teacher />
      )}
      </>}
    </div>
  )
}

// Common mistakes of one group (2026-11-05): the grammar to teach next.
function GroupMistakes() {
  const [groups, setGroups] = useState(null)
  const [gid, setGid] = useState('')
  const [days, setDays] = useState(14)
  useEffect(() => {
    supabase
      .from('groups')
      .select('id, name')
      .order('created_at')
      .then(({ data }) => {
        setGroups(data || [])
        if (data?.[0]) setGid(data[0].id)
      })
  }, [])
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={gid} onChange={(e) => setGid(e.target.value)} className="focus-ring h-10 rounded-[12px] border border-line bg-panel px-2 text-[14px] font-bold text-paper" aria-label="Group">
          {(groups || []).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="focus-ring h-10 rounded-[12px] border border-line bg-panel px-2 text-[14px] font-bold text-paper" aria-label="Period">
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
        <p className="min-w-0 flex-1 text-[13px] font-semibold text-mist">The AI’s corrections in this group’s writing and speaking, grouped by reason — most students first. Teach these next lesson.</p>
      </div>
      {gid && <CommonMistakes groupId={gid} days={days} />}
    </section>
  )
}
