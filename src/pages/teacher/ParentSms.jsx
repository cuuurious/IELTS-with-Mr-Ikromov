import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { groupDisplayName } from '../../lib/groupLook'

/*
 * PARENT SMS (2026-10-19). Jasur: "send a message (I will draft it
 * myself) to students' parents who are not doing homework on time;
 * the teacher adds the parent phone number."
 *
 * Updated 2026-10-20: the automatic SMS goes out on the weekdays the
 * teacher picks, either to parents whose child missed homework or to
 * every parent with automatic SMS on; plus "Send now" by hand.
 *
 * Every morning at 9:00 (Tashkent) the parent-sms Edge Function texts
 * the parent of each student who didn't hand in homework that was due
 * the day before: one SMS per parent, through Eskiz.uz. This page is
 * where the teacher:
 *   - switches it on or off and writes the message;
 *   - adds parent phone numbers (and can switch one student off);
 *   - switches whole groups off;
 *   - sees who will get an SMS tomorrow morning, and what was sent.
 */

const PLACEHOLDERS = [
  { key: '{student}', label: 'Student name' },
  { key: '{homework}', label: 'Homework titles' },
  { key: '{count}', label: 'How many' },
  { key: '{date}', label: 'Deadline date' },
  { key: '{group}', label: 'Group' },
]

const SAMPLE = {
  '{student}': 'Aliyev Vali',
  '{homework}': 'Writing Task 2, Reading Passage 1',
  '{count}': '2',
  '{date}': '18.10.2026',
  '{group}': 'Group 71',
}

const fill = (template) => PLACEHOLDERS.reduce((t, p) => t.replaceAll(p.key, SAMPLE[p.key]), template || '').trim()

// Latin text fits 160 characters in one SMS (153 per part when longer);
// Cyrillic or other non-Latin letters fit only 70 (67 per part).
// Placeholders make the real length vary, so this uses the sample.
const GSM = /^[A-Za-z0-9 @£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€‘’ʻʼ`]*$/
export function smsParts(text) {
  const latin = GSM.test(text)
  const one = latin ? 160 : 70
  const many = latin ? 153 : 67
  const n = text.length
  return { latin, length: n, parts: n === 0 ? 0 : n <= one ? 1 : Math.ceil(n / many), limit: n <= one ? one : many * Math.ceil(n / many) }
}

// 2026-10-19 → 19 Oct
const shortDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// Shows 998901234567 as +998 90 123 45 67.
export function prettyPhone(digits) {
  const d = String(digits || '').replace(/\D/g, '')
  if (d.length !== 12) return digits || ''
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`
}

// Accepts "+998 90 123-45-67", "90 123 45 67", "998901234567" …
export function parsePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '')
  if (d.length === 9) d = '998' + d
  return /^998\d{9}$/.test(d) ? d : null
}

async function fnErrorMessage(error, data) {
  if (data?.error) return data.error
  try {
    const body = await error?.context?.json?.()
    if (body?.error) return body.error
  } catch {
    /* ignore */
  }
  return error?.message || 'Something went wrong.'
}

const card = 'rounded-[22px] border border-line bg-panel'
const sectionTitle = 'font-brand text-[17px] font-semibold text-brass'

function Toggle({ on, onChange, label, disabled, size = 'md' }) {
  const big = size === 'lg'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`focus-ring relative shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-turquoise' : 'bg-line'} ${big ? 'h-8 w-14' : 'h-6 w-10'}`}
    >
      <span
        className={`absolute top-1 rounded-full bg-white shadow transition-all ${big ? 'h-6 w-6' : 'h-4 w-4'} ${on ? (big ? 'left-7' : 'left-5') : 'left-1'}`}
      />
    </button>
  )
}

function PhoneRow({ student, saved, onSaved }) {
  const [phone, setPhone] = useState(saved ? prettyPhone(saved.phone) : '')
  const [parentName, setParentName] = useState(saved?.parent_name || '')
  const [state, setState] = useState('') // '' | saving | saved | error text
  const parsed = parsePhone(phone)
  const changed = (saved ? prettyPhone(saved.phone) : '') !== phone.trim() || (saved?.parent_name || '') !== parentName.trim()

  useEffect(() => {
    setPhone(saved ? prettyPhone(saved.phone) : '')
    setParentName(saved?.parent_name || '')
  }, [saved?.phone, saved?.parent_name])

  const save = async () => {
    if (!phone.trim()) {
      if (!saved) return
      setState('saving')
      const { error } = await supabase.from('parent_phones').delete().eq('student_id', student.id)
      if (error) return setState(error.message)
      setState('saved')
      onSaved(student.id, null)
      return
    }
    if (!parsed) return setState('Use a number like +998 90 123 45 67')
    setState('saving')
    const row = { student_id: student.id, phone: parsed, parent_name: parentName.trim() }
    const { data, error } = await supabase.from('parent_phones').upsert(row, { onConflict: 'student_id' }).select().single()
    if (error) return setState(error.message)
    setPhone(prettyPhone(parsed))
    setState('saved')
    onSaved(student.id, data)
  }

  const toggle = async (on) => {
    const { data, error } = await supabase.from('parent_phones').update({ sms_enabled: on }).eq('student_id', student.id).select().single()
    if (error) return setState(error.message)
    onSaved(student.id, data)
  }

  return (
    <li className="grid grid-cols-1 items-center gap-2 border-t border-line py-3 first:border-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_120px]">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-paper">{student.full_name || student.username}</p>
        <p className="truncate text-[12px] text-mist">{student.groups.join(', ')}</p>
      </div>
      <input
        type="tel"
        inputMode="tel"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value)
          setState('')
        }}
        onKeyDown={(e) => e.key === 'Enter' && changed && save()}
        placeholder="+998 90 123 45 67"
        aria-label={`Parent phone for ${student.full_name || student.username}`}
        className={`h-10 w-full rounded-xl border bg-panel-2 px-3 text-[15px] tabular-nums text-paper outline-none focus:border-brass ${phone && !parsed ? 'border-urgent' : 'border-line'}`}
      />
      <input
        type="text"
        value={parentName}
        onChange={(e) => {
          setParentName(e.target.value)
          setState('')
        }}
        onKeyDown={(e) => e.key === 'Enter' && changed && save()}
        placeholder="Parent's name (optional)"
        aria-label={`Parent name for ${student.full_name || student.username}`}
        className="h-10 w-full rounded-xl border border-line bg-panel-2 px-3 text-[15px] text-paper outline-none focus:border-brass"
      />
      <div className="flex items-center justify-end gap-3">
        {changed ? (
          <button
            type="button"
            onClick={save}
            disabled={state === 'saving'}
            className="focus-ring h-9 rounded-[10px] bg-brass px-4 text-[13px] font-bold text-onbrass hover:bg-brass-dim disabled:opacity-60"
          >
            {state === 'saving' ? 'Saving…' : 'Save'}
          </button>
        ) : saved ? (
          <span className="flex items-center gap-2 text-[12px] text-mist">
            {saved.sms_enabled ? 'Auto SMS on' : 'Auto SMS off'}
            <Toggle on={saved.sms_enabled} onChange={toggle} label={`Automatic SMS for ${student.full_name || student.username}`} />
          </span>
        ) : (
          <span className="text-[12px] text-mist">No number</span>
        )}
      </div>
      {state && state !== 'saving' && state !== 'saved' && <p className="text-[13px] text-urgent sm:col-span-4">{state}</p>}
    </li>
  )
}

const PRICE_PER_SMS = 95 // so'm, Eskiz standard price (Oct 2026)

const WEEKDAYS = [
  { n: 1, short: 'Mon' },
  { n: 2, short: 'Tue' },
  { n: 3, short: 'Wed' },
  { n: 4, short: 'Thu' },
  { n: 5, short: 'Fri' },
  { n: 6, short: 'Sat' },
  { n: 7, short: 'Sun' },
]

/*
 * SEND NOW (2026-10-20). Jasur: "the teacher can manually choose which
 * students' parents get the SMS … sendable any time the teacher
 * presses". Tick students, review the exact texts and the cost, then
 * send. {homework}/{count} are that student's homework not handed in
 * with a deadline in the last 14 days; {date} is today.
 */
function SendNow({ students, phones, groups, template, onSent }) {
  const [groupFilter, setGroupFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [review, setReview] = useState(null) // null | {loading} | {error} | {messages, skipped}
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return students.filter(
      (s) =>
        (groupFilter === 'all' || s.groupIds.includes(groupFilter)) &&
        (!q || `${s.full_name || ''} ${s.username || ''}`.toLowerCase().includes(q))
    )
  }, [students, groupFilter, search])

  const pickable = visible.filter((s) => phones[s.id])
  const allPicked = pickable.length > 0 && pickable.every((s) => picked.has(s.id))
  const pickedWithPhone = [...picked].filter((id) => phones[id])

  const toggle = (id) => {
    setReview(null)
    setResult('')
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    setReview(null)
    setResult('')
    setPicked((prev) => {
      const next = new Set(prev)
      for (const s of pickable) allPicked ? next.delete(s.id) : next.add(s.id)
      return next
    })
  }

  const openReview = async () => {
    setResult('')
    setReview({ loading: true })
    const { data, error } = await supabase.functions.invoke('parent-sms', { body: { mode: 'compose', studentIds: pickedWithPhone } })
    if (error || data?.error) return setReview({ error: await fnErrorMessage(error, data) })
    setReview(data)
  }

  const send = async () => {
    setSending(true)
    const { data, error } = await supabase.functions.invoke('parent-sms', { body: { mode: 'send', studentIds: review.messages.map((m) => m.studentId) } })
    setSending(false)
    if (error || data?.error) {
      setResult(await fnErrorMessage(error, data))
    } else {
      setResult(
        data.failed
          ? `Sent ${data.sent}, ${data.failed} failed${data.errors?.length ? `: ${data.errors.join('; ')}` : ''}`
          : `Sent to ${data.sent} ${data.sent === 1 ? 'parent' : 'parents'}.`
      )
      setPicked(new Set())
    }
    setReview(null)
    onSent()
  }

  const totalParts = review?.messages ? review.messages.reduce((n, m) => n + smsParts(m.text).parts, 0) : 0
  const sentOk = result.startsWith('Sent to')

  return (
    <section className={`${card} lg:order-3 lg:col-span-12 flex flex-col gap-4 p-5 sm:p-6`}>
      <div>
        <h2 className={sectionTitle}>Send now</h2>
        <p className="mt-1 text-[14px] text-paper-dim">
          Tick the students whose parents should get your message right now. You’ll see every text and the cost before anything is sent.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          aria-label="Group"
          className="h-10 rounded-xl border border-line bg-panel-2 px-3 text-[14px] text-paper"
        >
          <option value="all">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {groupDisplayName(g.name)}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a student…"
          className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 text-[14px] text-paper outline-none focus:border-brass sm:max-w-[280px]"
        />
        <button
          type="button"
          onClick={toggleAll}
          disabled={!pickable.length}
          className="focus-ring h-10 rounded-xl border border-line px-3 text-[14px] font-semibold text-paper hover:border-brass disabled:opacity-50"
        >
          {allPicked ? 'Clear these' : groupFilter === 'all' ? 'Select all' : 'Select whole group'}
        </button>
        {picked.size > 0 && (
          <button type="button" onClick={() => { setPicked(new Set()); setReview(null) }} className="focus-ring text-[13px] font-medium text-paper-dim hover:text-paper">
            Clear all ({picked.size})
          </button>
        )}
      </div>

      {visible.length ? (
        <ul className="grid max-h-[360px] grid-cols-1 gap-x-6 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => {
            const has = Boolean(phones[s.id])
            return (
              <li key={s.id} className="border-b border-line">
                <label className={`flex items-center gap-3 py-2.5 ${has ? 'cursor-pointer' : 'opacity-55'}`}>
                  <input type="checkbox" className="h-4 w-4 shrink-0" checked={picked.has(s.id)} disabled={!has} onChange={() => toggle(s.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-paper">{s.full_name || s.username}</span>
                    <span className="block truncate text-[12px] text-mist">{has ? s.groups.join(', ') : 'No parent number'}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-mist">No students match.</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-panel-2 px-4 py-3">
        <p className="text-[14px] text-paper">
          <strong className="font-semibold">{pickedWithPhone.length}</strong> {pickedWithPhone.length === 1 ? 'parent' : 'parents'} selected
          {pickedWithPhone.length > 0 && template && (
            <span className="text-mist">
              {' '}· about {(pickedWithPhone.length * Math.max(1, smsParts(fill(template)).parts) * PRICE_PER_SMS).toLocaleString('en-US')} so’m
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={openReview}
          disabled={!pickedWithPhone.length || !template || review?.loading}
          className="focus-ring h-10 rounded-xl bg-brass px-5 text-[14px] font-bold text-onbrass hover:bg-brass-dim disabled:opacity-50"
        >
          {review?.loading ? 'Preparing…' : 'Review and send'}
        </button>
      </div>
      {!template && <p className="text-[13px] text-urgent">Save your message above first.</p>}
      {result && <p className={`text-[14px] font-medium ${sentOk ? 'text-reading' : 'text-urgent'}`}>{result}</p>}

      {review?.error && <p className="text-[14px] text-urgent">{review.error}</p>}
      {review?.messages && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-brass p-4">
          <p className="text-[15px] font-bold text-paper">
            {review.messages.length} {review.messages.length === 1 ? 'SMS' : 'SMS'} to send · {totalParts} SMS {totalParts === 1 ? 'part' : 'parts'} · about{' '}
            {(totalParts * PRICE_PER_SMS).toLocaleString('en-US')} so’m
          </p>
          <ul className="flex max-h-[320px] flex-col gap-2 overflow-y-auto">
            {review.messages.map((m) => (
              <li key={m.studentId} className="rounded-xl bg-panel-2 px-3.5 py-2.5">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[14px] font-semibold text-paper">{m.student}</span>
                  <span className="text-[12px] tabular-nums text-mist">
                    {prettyPhone(m.phone)} · {smsParts(m.text).parts} {smsParts(m.text).parts === 1 ? 'part' : 'parts'}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[14px] text-paper-dim">{m.text}</p>
                {!m.homework.length && /\{homework\}|\{count\}/.test(template) && (
                  <p className="mt-1 text-[12px] text-urgent">Has no missed homework in the last 14 days, so the homework part is empty.</p>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setReview(null)} disabled={sending} className="focus-ring h-10 rounded-xl border border-line px-4 text-[14px] font-semibold text-paper hover:border-brass">
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={sending || !review.messages.length}
              className="focus-ring h-10 rounded-xl bg-[#e6a33a] px-5 text-[14px] font-bold text-[#17213a] hover:brightness-105 disabled:opacity-60"
            >
              {sending ? 'Sending…' : `Send ${review.messages.length} SMS`}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export default function ParentSms() {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [settings, setSettings] = useState({ enabled: false, template: '' })
  const [draft, setDraft] = useState('')
  const [savingText, setSavingText] = useState('')
  const [groups, setGroups] = useState([])
  const [students, setStudents] = useState([])
  const [phones, setPhones] = useState({})
  const [log, setLog] = useState([])
  const [groupFilter, setGroupFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [previewDay, setPreviewDay] = useState('tomorrow')
  const [testPhone, setTestPhone] = useState('')
  const [testState, setTestState] = useState('')

  const load = async () => {
    setLoadError('')
    const [s, g, m, p, l] = await Promise.all([
      supabase.from('parent_sms_settings').select('enabled, template, send_days, audience, updated_at').eq('id', 1).maybeSingle(),
      supabase.from('groups').select('id, name, parent_sms_enabled').order('created_at'),
      supabase
        .from('group_members')
        .select('group_id, student_id, profiles!inner(id, full_name, username, status, role)')
        .eq('profiles.status', 'approved')
        .limit(5000),
      supabase.from('parent_phones').select('*').limit(5000),
      supabase.from('parent_sms_log').select('*').order('created_at', { ascending: false }).limit(60),
    ])
    const err = s.error || g.error || m.error || p.error || l.error
    if (err) {
      setLoadError(
        /parent_sms|parent_phones/.test(err.message || '')
          ? 'The database part of Parent SMS isn’t set up yet. Run migration_82_parent_sms.sql in Supabase first.'
          : err.message
      )
      setLoading(false)
      return
    }
    const st = s.data || { enabled: false, template: '' }
    setSettings(st)
    setDraft(st.template || '')
    setGroups(g.data || [])
    const byId = {}
    const groupName = Object.fromEntries((g.data || []).map((x) => [x.id, groupDisplayName(x.name)]))
    for (const row of m.data || []) {
      const pr = row.profiles
      if (!pr || (pr.role && pr.role !== 'student')) continue
      byId[pr.id] ||= { ...pr, groupIds: [], groups: [] }
      byId[pr.id].groupIds.push(row.group_id)
      byId[pr.id].groups.push(groupName[row.group_id] || '')
    }
    setStudents(Object.values(byId).sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '')))
    setPhones(Object.fromEntries((p.data || []).map((x) => [x.student_id, x])))
    setLog(l.data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const loadPreview = async (day = previewDay) => {
    setPreview({ loading: true })
    const { data, error } = await supabase.functions.invoke('parent-sms', { body: { mode: 'preview', day } })
    if (error || data?.error) return setPreview({ error: await fnErrorMessage(error, data) })
    setPreview(data)
  }

  useEffect(() => {
    if (!loading && !loadError) loadPreview(previewDay)
  }, [loading, previewDay])

  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    const { error } = await supabase.from('parent_sms_settings').update(patch).eq('id', 1)
    if (error) {
      setSettings(settings)
      setSavingText(error.message)
      return false
    }
    return true
  }

  const saveTemplate = async () => {
    setSavingText('Saving…')
    const ok = await saveSettings({ template: draft.trim() })
    if (ok) {
      setSavingText('Saved')
      loadPreview()
    }
  }

  const insertPlaceholder = (key) => {
    const el = document.getElementById('parent-sms-text')
    if (!el) return setDraft((d) => d + key)
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + key + draft.slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + key.length, start + key.length)
    })
  }

  const setGroupEnabled = async (id, on) => {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, parent_sms_enabled: on } : g)))
    const { error } = await supabase.from('groups').update({ parent_sms_enabled: on }).eq('id', id)
    if (error) {
      setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, parent_sms_enabled: !on } : g)))
      return
    }
    loadPreview()
  }

  const reloadLog = async () => {
    const l = await supabase.from('parent_sms_log').select('*').order('created_at', { ascending: false }).limit(60)
    if (!l.error) setLog(l.data || [])
  }

  const sendTest = async () => {
    if (!parsePhone(testPhone)) return setTestState('Use a number like +998 90 123 45 67')
    setTestState('Sending…')
    const { data, error } = await supabase.functions.invoke('parent-sms', { body: { mode: 'test', phone: testPhone } })
    if (error || data?.error) setTestState(await fnErrorMessage(error, data))
    else setTestState('Sent. It should arrive in a minute.')
    const l = await supabase.from('parent_sms_log').select('*').order('created_at', { ascending: false }).limit(60)
    if (!l.error) setLog(l.data || [])
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return students.filter(
      (s) =>
        (groupFilter === 'all' || s.groupIds.includes(groupFilter)) &&
        (!onlyMissing || !phones[s.id]) &&
        (!q || `${s.full_name || ''} ${s.username || ''}`.toLowerCase().includes(q))
    )
  }, [students, groupFilter, search, onlyMissing, phones])

  const withPhone = students.filter((s) => phones[s.id]).length
  const sample = fill(draft)
  const parts = smsParts(sample)
  const textChanged = draft.trim() !== (settings.template || '').trim()
  const sendDays = settings.send_days?.length ? settings.send_days : [1, 2, 3, 4, 5, 6, 7]
  const audience = settings.audience === 'all' ? 'all' : 'missed'
  const autoCount = students.filter((st) => phones[st.id]?.sms_enabled).length
  const activeGroup = groups.find((g) => g.id === groupFilter)
  const nameOf = Object.fromEntries(students.map((s) => [s.id, s.full_name || s.username]))

  if (loading) return <p className="text-sm text-mist">Loading…</p>
  if (loadError) return <p className={`${card} p-6 text-[15px] text-urgent`}>{loadError}</p>

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Right column: on/off and test, next to the message. */}
      <div className="flex flex-col gap-6 lg:order-2 lg:col-span-5">
      {/* AUTOMATIC SMS: on/off, which days, who */}
        <section className={`${card} flex flex-col gap-4 p-5 sm:p-6`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className={sectionTitle}>{settings.enabled ? 'Automatic SMS is on' : 'Automatic SMS is off'}</h2>
              <p className="mt-1 text-[14px] text-paper-dim">
                Goes out at 9:00 on the days you pick. One SMS per parent per day.
              </p>
            </div>
            <Toggle
              size="lg"
              on={settings.enabled}
              label="Automatic SMS to parents"
              disabled={!settings.enabled && !(settings.template || '').trim()}
              onChange={(on) => saveSettings({ enabled: on }).then(() => loadPreview())}
            />
          </div>
          {!settings.enabled && !(settings.template || '').trim() && (
            <p className="text-[13px] text-mist">Write and save your message to switch it on.</p>
          )}

          <div>
            <p className="mb-2 text-[13px] font-bold text-paper">Days</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = sendDays.includes(d.n)
                return (
                  <button
                    key={d.n}
                    type="button"
                    aria-pressed={on}
                    disabled={on && sendDays.length === 1}
                    onClick={() =>
                      saveSettings({ send_days: on ? sendDays.filter((x) => x !== d.n) : [...sendDays, d.n].sort() }).then(() => loadPreview())
                    }
                    className={`focus-ring h-9 min-w-[44px] rounded-[10px] px-2.5 text-[13px] font-bold transition-colors ${
                      on ? 'bg-brass text-onbrass' : 'border border-line bg-panel-2 text-paper-dim hover:text-paper'
                    }`}
                  >
                    {d.short}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[13px] font-bold text-paper">Who gets it</p>
            <div className="flex flex-col gap-2">
              {[
                ['missed', 'Only parents whose child missed homework', 'Homework due since the last sending day that wasn’t handed in.'],
                ['all', 'Every parent with automatic SMS on', 'Pick them in the list below: switch automatic SMS on only for the students you want.'],
              ].map(([key, label, hint]) => (
                <label
                  key={key}
                  className={`flex cursor-pointer gap-3 rounded-xl border px-3.5 py-2.5 ${audience === key ? 'border-brass bg-panel-2' : 'border-line'}`}
                >
                  <input
                    type="radio"
                    name="parent-sms-audience"
                    className="mt-1"
                    checked={audience === key}
                    onChange={() => saveSettings({ audience: key }).then(() => loadPreview())}
                  />
                  <span>
                    <span className="block text-[14px] font-semibold text-paper">{label}</span>
                    <span className="block text-[12px] text-mist">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <p className="rounded-xl bg-panel-2 px-3.5 py-2.5 text-[13px] text-paper-dim">
            <strong className="font-semibold text-paper">{autoCount}</strong> {autoCount === 1 ? 'student has' : 'students have'} a parent number with
            automatic SMS on ({withPhone} of {students.length} have a number). About{' '}
            <strong className="font-semibold text-paper">{(autoCount * sendDays.length * Math.max(1, parts.parts) * PRICE_PER_SMS).toLocaleString('en-US')} so’m</strong>{' '}
            a week at most.
          </p>
          {audience === 'all' && /\{homework\}|\{count\}/.test(settings.template || '') && (
            <p className="text-[13px] text-urgent">
              Your message uses {'{homework}'} or {'{count}'}. For a child who missed nothing these come out empty, so check the wording.
            </p>
          )}
        </section>

      {/* TEST */}
        <section className={`${card} flex flex-col gap-3 p-5 sm:p-6`}>
          <h2 className={sectionTitle}>Send yourself a test</h2>
          <p className="text-[14px] text-paper-dim">Sends the saved message, filled in with the example, to one number.</p>
          <div className="flex gap-2">
            <input
              type="tel"
              inputMode="tel"
              value={testPhone}
              onChange={(e) => {
                setTestPhone(e.target.value)
                setTestState('')
              }}
              placeholder="+998 90 123 45 67"
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 text-[15px] tabular-nums text-paper outline-none focus:border-brass"
            />
            <button
              type="button"
              onClick={sendTest}
              disabled={testState === 'Sending…' || !(settings.template || '').trim()}
              className="focus-ring h-11 shrink-0 rounded-xl bg-brass px-4 text-[14px] font-bold text-onbrass hover:bg-brass-dim disabled:opacity-50"
            >
              Send test
            </button>
          </div>
          {testState && <p className={`text-[13px] ${testState.startsWith('Sent') || testState === 'Sending…' ? 'text-reading' : 'text-urgent'}`}>{testState}</p>}
        </section>

      </div>

      {/* MESSAGE */}
      <section className={`${card} lg:order-1 lg:col-span-7 flex flex-col gap-4 p-5 sm:p-6`}>
        <div>
          <h2 className={sectionTitle}>Your message</h2>
          <p className="mt-1 text-[14px] text-paper-dim">Tap a box to put that detail into the text. It’s filled in for each student.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PLACEHOLDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => insertPlaceholder(p.key)}
              className="focus-ring rounded-lg border border-line bg-panel-2 px-2.5 py-1 text-[13px] text-paper hover:border-brass"
            >
              <span className="font-mono text-[12px] text-brass">{p.key}</span> {p.label}
            </button>
          ))}
        </div>
        <textarea
          id="parent-sms-text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setSavingText('')
          }}
          rows={5}
          placeholder="Hurmatli ota-ona! {student} {date} kuni berilgan uy vazifasini ({homework}) topshirmadi. IELTS with Mr Ikromov"
          className="w-full resize-y rounded-2xl border border-line bg-panel-2 p-4 text-[15px] leading-relaxed text-paper outline-none focus:border-brass"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`text-[13px] ${parts.parts > 2 ? 'text-urgent' : 'text-mist'}`}>
            Example is {parts.length} characters ·{' '}
            <strong className="font-semibold">
              {parts.parts} SMS {parts.parts === 1 ? 'part' : 'parts'}
            </strong>{' '}
            per parent{!parts.latin && parts.length > 0 ? ' · Cyrillic letters make each part shorter (70)' : ''}
          </p>
          <div className="flex items-center gap-3">
            {savingText && <span className={`text-[13px] ${savingText === 'Saved' || savingText === 'Saving…' ? 'text-mist' : 'text-urgent'}`}>{savingText}</span>}
            <button
              type="button"
              onClick={saveTemplate}
              disabled={!textChanged}
              className="focus-ring h-10 rounded-xl bg-brass px-5 text-[14px] font-bold text-onbrass hover:bg-brass-dim disabled:opacity-50"
            >
              Save message
            </button>
          </div>
        </div>
        {sample && (
          <div className="rounded-2xl bg-panel-2 p-4">
            <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-mist">How a parent will see it</p>
            <p className="mt-1.5 whitespace-pre-wrap text-[15px] text-paper">{sample}</p>
          </div>
        )}
        <p className="text-[13px] text-mist">
          Eskiz checks every new text once before it can be sent. After you save a new message, send it to Eskiz for approval in
          your Eskiz cabinet (Moderation / “SMS shablon”), using the same words.
        </p>
      </section>

      {/* SEND NOW */}
      <SendNow students={students} phones={phones} groups={groups} template={(settings.template || '').trim()} onSent={reloadLog} />

      {/* WHO GETS ONE */}
      <section className={`${card} lg:order-3 lg:col-span-12 flex flex-col gap-4 p-5 sm:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className={sectionTitle}>{previewDay === 'tomorrow' ? 'Tomorrow morning' : 'This morning'}</h2>
            <p className="mt-1 text-[14px] text-paper-dim">
              The automatic SMS{previewDay === 'tomorrow' ? ' as it looks right now' : ''}
              {preview?.window ? `, counting homework due ${shortDate(preview.window.from)}${preview.window.from !== preview.window.to ? `–${shortDate(preview.window.to)}` : ''}` : ''}.
              {previewDay === 'tomorrow' ? ' Anyone who hands work in before 9:00 is taken off.' : ''}
            </p>
          </div>
          <div className="flex rounded-xl bg-panel-2 p-1" role="tablist">
            {[
              ['tomorrow', 'Tomorrow'],
              ['today', 'This morning'],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={previewDay === k}
                onClick={() => setPreviewDay(k)}
                className={`focus-ring rounded-lg px-3 py-1.5 text-[13px] font-semibold ${previewDay === k ? 'bg-brass text-onbrass' : 'text-paper-dim hover:text-paper'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {!preview || preview.loading ? (
          <p className="text-sm text-mist">Checking homework…</p>
        ) : preview.error ? (
          <p className="text-[14px] text-urgent">
            {/Failed to send a request|FunctionsFetchError|not found/i.test(preview.error)
              ? 'The parent-sms function isn’t deployed yet, so the list can’t be shown.'
              : preview.error}
          </p>
        ) : preview.sendDay === false ? (
          <p className="rounded-2xl bg-panel-2 px-4 py-5 text-center text-[15px] font-medium text-paper-dim">
            {previewDay === 'tomorrow' ? 'Tomorrow' : 'Today'} isn’t one of your sending days, so no automatic SMS.
          </p>
        ) : !preview.messages.length && !preview.skipped.length ? (
          <p className="rounded-2xl bg-reading-tint px-4 py-5 text-center text-[15px] font-medium text-reading">
            {preview.audience === 'all' ? 'No parents to send to.' : 'Nobody has missed a deadline.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[13px] font-bold text-paper">
                {preview.messages.length} {preview.messages.length === 1 ? 'parent' : 'parents'} {previewDay === 'tomorrow' ? 'will get' : 'got'} an SMS
                {!preview.enabled && <span className="font-normal text-urgent"> (only if you switch Parent SMS on)</span>}
              </p>
              <ul className="flex flex-col gap-2">
                {preview.messages.map((m) => (
                  <li key={m.studentId} className="rounded-2xl bg-panel-2 px-4 py-3">
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[15px] font-semibold text-paper">{m.student}</span>
                      <span className="text-[13px] tabular-nums text-mist">{prettyPhone(m.phone)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[14px] text-paper-dim">{m.text || <em>No message saved yet</em>}</p>
                  </li>
                ))}
              </ul>
            </div>
            {preview.skipped.length > 0 && (
              <div>
                <p className="mb-2 text-[13px] font-bold text-paper">
                  {preview.skipped.length} missed it but won’t get an SMS
                </p>
                <ul className="flex flex-col">
                  {preview.skipped.map((s) => (
                    <li key={s.studentId} className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-0">
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] text-paper">{s.student}</span>
                        <span className="block truncate text-[12px] text-mist">{s.homework.join(', ')}</span>
                      </span>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[12px] font-medium ${s.reason === 'no_phone' ? 'bg-urgent-tint text-urgent' : 'bg-panel-2 text-mist'}`}>
                        {s.reason === 'no_phone' ? 'No parent number' : 'Auto SMS off'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* PHONES */}
      <section className={`${card} lg:order-3 lg:col-span-12 flex flex-col gap-4 p-5 sm:p-6`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={sectionTitle}>Parent phone numbers</h2>
          <span className="text-[13px] text-mist">Only teachers can see these</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            aria-label="Group"
            className="h-10 rounded-xl border border-line bg-panel-2 px-3 text-[14px] text-paper"
          >
            <option value="all">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {groupDisplayName(g.name)}
                {g.parent_sms_enabled === false ? ' (SMS off)' : ''}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a student…"
            className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 text-[14px] text-paper outline-none focus:border-brass sm:max-w-[280px]"
          />
          <label className="flex items-center gap-2 text-[14px] text-paper-dim">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
            Only students without a number
          </label>
        </div>
        {activeGroup && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-panel-2 px-4 py-3">
            <p className="text-[14px] text-paper">
              SMS for <strong className="font-semibold">{groupDisplayName(activeGroup.name)}</strong>{' '}
              {activeGroup.parent_sms_enabled === false ? 'is off: nobody in this group gets one.' : 'is on.'}
            </p>
            <Toggle
              on={activeGroup.parent_sms_enabled !== false}
              onChange={(on) => setGroupEnabled(activeGroup.id, on)}
              label={`SMS for ${groupDisplayName(activeGroup.name)}`}
            />
          </div>
        )}
        <p className="text-[13px] text-mist">Type a number and press Enter or Save. Clear the number and save to remove it. The switch next to a number decides whether that parent gets the automatic SMS.</p>
        {visible.length ? (
          <ul className="flex flex-col">
            {visible.map((s) => (
              <PhoneRow
                key={s.id}
                student={s}
                saved={phones[s.id]}
                onSaved={(id, row) =>
                  setPhones((p) => {
                    const next = { ...p }
                    if (row) next[id] = row
                    else delete next[id]
                    return next
                  })
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-mist">No students match.</p>
        )}
      </section>

      {/* LOG */}
      <section className={`${card} lg:order-3 lg:col-span-12 flex flex-col gap-3 p-5 sm:p-6`}>
        <h2 className={sectionTitle}>Sent messages</h2>
        {log.length ? (
          <ul className="flex flex-col">
            {log.map((r) => (
              <li key={r.id} className="grid grid-cols-1 gap-1 border-t border-line py-3 first:border-0 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:gap-4">
                <span className="text-[13px] text-mist">
                  {new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-paper">
                    {r.kind === 'test' ? 'Test SMS' : nameOf[r.student_id] || 'Student'}{r.kind === 'manual' && <span className="ml-1.5 rounded-md bg-panel-2 px-1.5 py-0.5 text-[11px] font-medium text-mist">Sent by hand</span>} · <span className="font-normal tabular-nums text-mist">{prettyPhone(r.phone)}</span>
                  </span>
                  <span className="block truncate text-[13px] text-paper-dim" title={r.message}>
                    {r.message}
                  </span>
                  {r.error && <span className="block text-[13px] text-urgent">{r.error}</span>}
                </span>
                <span
                  className={`h-fit w-fit rounded-md px-2 py-0.5 text-[12px] font-semibold ${
                    r.status === 'sent' ? 'bg-reading-tint text-reading' : r.status === 'failed' ? 'bg-urgent-tint text-urgent' : 'bg-panel-2 text-mist'
                  }`}
                >
                  {r.status === 'sent' ? 'Sent' : r.status === 'failed' ? 'Failed' : 'Sending'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-mist">Nothing sent yet.</p>
        )}
      </section>
    </div>
  )
}
