import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import ConfirmModal from '../../components/ConfirmModal'
import Icon from '../../components/Icon'

/*
 * ================================================================
 * LIVE MOCKS — the teacher's control room for Full Mock sittings
 * ================================================================
 * Added 2026-09-29 (migration_62); rebuilt 2026-10-14 (Jasur: "how can we
 * upgrade this dashboard" → "yes do all"). "In progress (58)" was mostly
 * sittings nobody had touched for days, so the screen now:
 *
 *   - splits sittings into Live now / Abandoned / Finished / All;
 *   - shows a summary strip (how many in each section, paused, offline,
 *     needing attention, abandoned);
 *   - lists them as compact rows (one line per student) with progress
 *     ("24 / 40 answered", Writing word counts), time left, last seen;
 *   - raises alerts and puts those students on top: offline, time over
 *     but not submitted, many tab switches, no answers / no writing yet,
 *     under the word count near the end, stuck on the instructions;
 *   - lets the teacher tick several students and pause / resume / add
 *     time / void & retake / delete them all at once;
 *   - search by name, filter by group and section.
 *
 * Every control still goes through the teacher-only database functions
 * (teacher_pause_full_mock etc.) — the student's screen picks each change
 * up within about 5 seconds on its own.
 * ================================================================
 */

const STAGES = ['listening', 'reading', 'writing']
const STAGE_LABEL = { listening: 'Listening', reading: 'Reading', writing: 'Writing', done: 'Finished' }
const STAGE_COLOR = { listening: 'text-listening bg-listening-tint', reading: 'text-reading bg-reading-tint', writing: 'text-writing bg-writing-tint' }

const MIN = 60_000
const OFFLINE_AFTER = 2 * MIN
const ABANDONED_AFTER = 3 * 60 * MIN

function formatLeft(ms) {
  const neg = ms < 0
  const s = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mmss = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${neg ? '−' : ''}${h > 0 ? `${h}:${mmss}` : mmss}`
}

function formatAgo(ms) {
  if (ms == null) return '—'
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

const mins = (ms) => Math.max(1, Math.round(ms / MIN))

function countWords(text) {
  const t = (text || '').trim()
  return t ? t.split(/\s+/).length : 0
}

const ts = (iso) => (iso ? new Date(iso).getTime() : 0)

export default function LiveMocksPanel({ students, fullMockSets, groups = [], groupMembers = [], onReissueCode, onDataChanged }) {
  const [view, setView] = useState('live') // live | abandoned | finished | all
  const [sittings, setSittings] = useState([])
  const [finished, setFinished] = useState([])
  const [rlAttempts, setRlAttempts] = useState([])
  const [writingAttempts, setWritingAttempts] = useState([])
  const [questionCount, setQuestionCount] = useState({}) // examId → number of questions
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyIds, setBusyIds] = useState(() => new Set())
  const [notice, setNotice] = useState(null) // { tone, text }
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [menuFor, setMenuFor] = useState(null)

  const studentById = useMemo(() => Object.fromEntries((students || []).map((s) => [s.id, s])), [students])
  const setById = useMemo(() => Object.fromEntries((fullMockSets || []).map((s) => [s.id, s])), [fullMockSets])
  const groupNameById = useMemo(() => Object.fromEntries((groups || []).map((g) => [g.id, g.name])), [groups])
  const groupsOfStudent = useMemo(() => {
    const map = {}
    ;(groupMembers || []).forEach((m) => {
      ;(map[m.student_id] ||= []).push(m.group_id)
    })
    return map
  }, [groupMembers])

  // Only the newest load may write state (a slow load under the previous
  // view must not overwrite a newer one).
  const loadTokenRef = useRef(0)
  const countsRef = useRef({})

  const load = useCallback(async () => {
    const token = ++loadTokenRef.current
    const cols = 'id, set_id, student_id, stage, sections, paused_at, started_at, completed_at, updated_at, listening_attempt_id, reading_attempt_id, writing_attempt_id'
    const liveQuery = supabase.from('full_mock_attempts').select(cols).neq('stage', 'done').order('started_at', { ascending: false }).limit(300)
    const doneQuery =
      view === 'finished' || view === 'all'
        ? supabase.from('full_mock_attempts').select(cols).eq('stage', 'done').order('completed_at', { ascending: false }).limit(200)
        : null
    const [liveRes, doneRes] = await Promise.all([liveQuery, doneQuery || Promise.resolve({ data: null })])
    if (token !== loadTokenRef.current) return
    if (liveRes.error) {
      setLoadError(liveRes.error.message || 'Could not load sittings.')
      setLoading(false)
      return
    }
    const rows = liveRes.data || []
    const liveStudentIds = [...new Set(rows.map((r) => r.student_id))]

    let rl = []
    let w = []
    if (liveStudentIds.length > 0) {
      const [rlRes, wRes] = await Promise.all([
        supabase
          .from('mock_attempts')
          .select('id, user_id, exam_id, started_at, deadline_at, paused_at, tab_switch_count, last_seen_at, answers:draft_answers->answers')
          .in('user_id', liveStudentIds)
          .is('submitted_at', null),
        supabase
          .from('writing_mock_attempts')
          .select('id, student_id, exam_id, started_at, deadline_at, paused_at, tab_switch_count, last_seen_at, task1_text, task2_text')
          .in('student_id', liveStudentIds)
          .is('submitted_at', null),
      ])
      if (token !== loadTokenRef.current) return
      rl = rlRes.data || []
      w = wRes.data || []
    }

    // How many questions each running Listening/Reading test has, for
    // "24 / 40 answered". Fetched once per exam.
    const examIds = [...new Set(rl.map((a) => a.exam_id))].filter((id) => countsRef.current[id] == null)
    if (examIds.length) {
      const { data: secs } = await supabase.from('mock_sections').select('id, exam_id').in('exam_id', examIds)
      const secIds = (secs || []).map((s) => s.id)
      if (secIds.length) {
        const { data: qs } = await supabase.from('mock_questions').select('section_id').in('section_id', secIds)
        const examOfSection = Object.fromEntries((secs || []).map((s) => [s.id, s.exam_id]))
        const next = { ...countsRef.current }
        examIds.forEach((id) => {
          next[id] = 0
        })
        ;(qs || []).forEach((q) => {
          const e = examOfSection[q.section_id]
          if (e) next[e] = (next[e] || 0) + 1
        })
        countsRef.current = next
      }
      if (token !== loadTokenRef.current) return
      setQuestionCount({ ...countsRef.current })
    }

    setSittings(rows)
    setFinished(doneRes?.data || [])
    setRlAttempts(rl)
    setWritingAttempts(w)
    setLoadError('')
    setLoading(false)
  }, [view])

  useEffect(() => {
    setLoading(true)
    load()
    const id = setInterval(() => {
      if (!document.hidden) load()
    }, 10_000)
    const onVisible = () => {
      if (!document.hidden) load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    setSelected(new Set())
    setMenuFor(null)
  }, [view])

  useEffect(() => {
    if (!menuFor) return
    const close = (e) => {
      if (!e.target.closest?.('[data-row-menu]')) setMenuFor(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuFor])

  const nameOf = useCallback(
    (sitting) => {
      const s = studentById[sitting.student_id]
      return s?.full_name || s?.username || 'Student'
    },
    [studentById]
  )

  // The section attempt running right now for a sitting (same rule as the
  // database's own _full_mock_live_section): the newest unsubmitted
  // attempt for this student on the exam that matches the current stage.
  const liveSectionFor = useCallback(
    (sitting) => {
      const set = setById[sitting.set_id]
      if (!set || sitting.stage === 'done') return null
      if (sitting.stage === 'writing') {
        const row = writingAttempts
          .filter((a) => a.student_id === sitting.student_id && a.exam_id === set.writing_exam_id)
          .sort((a, b) => ts(b.started_at) - ts(a.started_at))[0]
        return row ? { kind: 'writing', row } : null
      }
      const examId = sitting.stage === 'listening' ? set.listening_exam_id : set.reading_exam_id
      const row = rlAttempts
        .filter((a) => a.user_id === sitting.student_id && a.exam_id === examId)
        .sort((a, b) => ts(b.started_at) - ts(a.started_at))[0]
      return row ? { kind: 'rl', row } : null
    },
    [setById, rlAttempts, writingAttempts]
  )

  // Everything the screen shows about one sitting, worked out once.
  const describe = useCallback(
    (sitting) => {
      const live = liveSectionFor(sitting)
      const done = sitting.stage === 'done'
      const paused = Boolean(sitting.paused_at || live?.row?.paused_at)
      const lastActivity = Math.max(ts(sitting.updated_at), ts(sitting.started_at), ts(live?.row?.last_seen_at), ts(live?.row?.started_at))
      const sinceActivity = now - lastActivity
      const lastSeen = live?.row?.last_seen_at ? now - ts(live.row.last_seen_at) : null

      let timeLeft = null
      if (live?.row?.deadline_at) {
        const ref = live.row.paused_at ? ts(live.row.paused_at) : now
        timeLeft = ts(live.row.deadline_at) - ref
      }
      const elapsed = live?.row?.started_at ? now - ts(live.row.started_at) : 0

      let answered = null
      let total = null
      let words = null
      if (live?.kind === 'rl') {
        answered = Object.values(live.row.answers || {}).filter((v) => String(v || '').trim() !== '').length
        total = questionCount[live.row.exam_id] || null
      } else if (live?.kind === 'writing') {
        words = { t1: countWords(live.row.task1_text), t2: countWords(live.row.task2_text) }
      }
      const tabs = live?.row?.tab_switch_count || 0

      const abandoned =
        !done &&
        ((live && !paused && timeLeft !== null && timeLeft < -15 * MIN) ||
          (!paused && sinceActivity > ABANDONED_AFTER) ||
          (paused && sinceActivity > 24 * 60 * MIN))

      // Alerts: [severity 2 = red / 1 = amber, text]
      const alerts = []
      if (!done && !abandoned) {
        if (live && !paused && timeLeft !== null && timeLeft < -MIN) alerts.push([2, 'Time over — not submitted'])
        else if (live && !paused && lastSeen !== null && lastSeen > OFFLINE_AFTER) alerts.push([2, `Offline ${mins(lastSeen)} min`])
        if (tabs >= 3) alerts.push([tabs >= 6 ? 2 : 1, `${tabs} tab switches`])
        if (live?.kind === 'rl' && !paused && answered === 0 && elapsed > 10 * MIN) alerts.push([1, 'No answers yet'])
        if (live?.kind === 'writing' && !paused) {
          if (words.t1 + words.t2 === 0 && elapsed > 10 * MIN) alerts.push([2, 'No writing yet'])
          else if (timeLeft !== null && timeLeft < 15 * MIN && (words.t1 < 150 || words.t2 < 250))
            alerts.push([1, words.t2 < 250 ? `Task 2: ${words.t2} words` : `Task 1: ${words.t1} words`])
        }
        if (!live && !paused && sinceActivity > 10 * MIN) alerts.push([1, `On ${STAGE_LABEL[sitting.stage]} instructions ${mins(sinceActivity)} min`])
      }
      const severity = alerts.reduce((m, a) => Math.max(m, a[0]), 0)

      const gids = groupsOfStudent[sitting.student_id] || []
      return {
        sitting,
        live,
        done,
        paused,
        abandoned,
        offline: alerts.some((a) => /^Offline|^Time over/.test(a[1])),
        timeLeft,
        lastSeen,
        sinceActivity,
        answered,
        total,
        words,
        tabs,
        alerts,
        severity,
        name: nameOf(sitting),
        groupIds: gids,
        groupNames: gids.map((g) => groupNameById[g]).filter(Boolean),
        set: setById[sitting.set_id],
      }
    },
    [liveSectionFor, now, questionCount, groupsOfStudent, groupNameById, nameOf, setById]
  )

  const liveRows = useMemo(() => sittings.map(describe), [sittings, describe])
  const doneRows = useMemo(() => finished.map(describe), [finished, describe])
  const nowRows = liveRows.filter((r) => !r.abandoned)
  const abandonedRows = liveRows.filter((r) => r.abandoned)

  const summary = useMemo(() => {
    const s = { listening: 0, reading: 0, writing: 0, instructions: 0, paused: 0, offline: 0, attention: 0 }
    nowRows.forEach((r) => {
      if (r.paused) s.paused++
      else if (!r.live) s.instructions++
      else s[r.sitting.stage]++
      if (r.offline) s.offline++
      if (r.severity > 0) s.attention++
    })
    return s
  }, [nowRows])

  const baseRows = view === 'live' ? nowRows : view === 'abandoned' ? abandonedRows : view === 'finished' ? doneRows : [...liveRows, ...doneRows]
  const q = search.trim().toLowerCase()
  const shown = baseRows
    .filter((r) => !q || r.name.toLowerCase().includes(q) || (studentById[r.sitting.student_id]?.username || '').toLowerCase().includes(q))
    .filter((r) => !groupFilter || r.groupIds.includes(groupFilter))
    .filter((r) => !sectionFilter || r.sitting.stage === sectionFilter)
    .sort((a, b) => {
      if (view === 'live') {
        if (b.severity !== a.severity) return b.severity - a.severity
        const ta = a.timeLeft ?? Infinity
        const tb = b.timeLeft ?? Infinity
        if (ta !== tb) return ta - tb
      }
      return ts(b.sitting.started_at) - ts(a.sitting.started_at)
    })

  const usedGroupIds = [...new Set(liveRows.concat(doneRows).flatMap((r) => r.groupIds))]

  // ---- actions ---------------------------------------------------------
  const rpc = async (name, params) => {
    const { data, error } = await supabase.rpc(name, params)
    if (error) throw error
    return data
  }

  const markBusy = (ids, on) =>
    setBusyIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
      return next
    })

  const run = async (sitting, fn, successText) => {
    markBusy([sitting.id], true)
    setNotice(null)
    setMenuFor(null)
    try {
      await fn()
      if (successText) setNotice({ tone: 'sage', text: successText })
      await load()
      onDataChanged?.()
    } catch (err) {
      console.error('Live mock action failed:', err)
      setNotice({ tone: 'coral', text: err?.message || 'That did not work — please try again.' })
    } finally {
      markBusy([sitting.id], false)
    }
  }

  // One action for many sittings, one after another; reports how it went.
  const runMany = async (rows, fn, verb) => {
    const ids = rows.map((r) => r.sitting.id)
    markBusy(ids, true)
    setNotice({ tone: 'brass', text: `${verb} ${rows.length} student${rows.length === 1 ? '' : 's'}…` })
    let ok = 0
    const failed = []
    for (const r of rows) {
      try {
        await fn(r.sitting)
        ok++
      } catch (err) {
        console.error('Bulk action failed for', r.sitting.id, err)
        failed.push(r.name)
      }
    }
    markBusy(ids, false)
    setSelected(new Set())
    setNotice({
      tone: failed.length ? 'coral' : 'sage',
      text: `${verb} ${ok} student${ok === 1 ? '' : 's'}.${failed.length ? ` Didn't work for: ${failed.join(', ')}.` : ''}`,
    })
    await load()
    onDataChanged?.()
  }

  const pause = (r) => run(r.sitting, () => rpc('teacher_pause_full_mock', { p_full_id: r.sitting.id }), `Paused ${r.name}'s mock.`)
  const resume = (r) => run(r.sitting, () => rpc('teacher_resume_full_mock', { p_full_id: r.sitting.id }), `Resumed ${r.name}'s mock.`)
  const addTime = (r, minutes) =>
    run(r.sitting, () => rpc('teacher_add_time_full_mock', { p_full_id: r.sitting.id, p_minutes: minutes }), `Added ${minutes} minutes for ${r.name}.`)

  const advance = (r) => {
    const label = STAGE_LABEL[r.sitting.stage]
    const started = Boolean(r.live)
    setMenuFor(null)
    setConfirmDialog({
      title: started ? `End ${label} now for ${r.name}?` : `Skip ${label} for ${r.name}?`,
      message: started
        ? `Their ${label} answers are marked as they were at the last autosave (at most ~15 seconds ago), and they move straight on to the next section. This can't be undone.`
        : `They haven't started ${label} yet. It will be skipped — nothing is marked for it — and they move to the next section.`,
      confirmLabel: started ? `End ${label}` : `Skip ${label}`,
      tone: 'coral',
      onConfirm: () =>
        run(
          r.sitting,
          async () => {
            const next = await rpc('teacher_advance_full_mock', { p_full_id: r.sitting.id })
            setNotice({ tone: 'sage', text: next === 'done' ? `${r.name}'s mock is now finished.` : `${r.name} moved on to ${STAGE_LABEL[next]}.` })
          },
          null
        ),
    })
  }

  const reissue = async (sitting) => onReissueCode(sitting.student_id, sitting.set_id, sitting.sections || STAGES)

  const remove = (r) => {
    setMenuFor(null)
    setConfirmDialog({
      title: 'Delete this sitting?',
      message: `${r.name} — ${r.set?.title || 'Full Mock'}, started ${new Date(r.sitting.started_at).toLocaleString()}. Every answer, score and essay from it is removed and it stops counting anywhere (results, progress, retake limit). If they're sitting it right now, their screen is closed. This can't be undone.`,
      confirmLabel: 'Delete sitting',
      tone: 'coral',
      onConfirm: () => run(r.sitting, () => rpc('teacher_delete_full_mock_attempt', { p_full_id: r.sitting.id }), 'Sitting deleted.'),
    })
  }

  const voidAndRetake = (r) => {
    setMenuFor(null)
    setConfirmDialog({
      title: `Void & give ${r.name} a retake?`,
      message: `This sitting of ${r.set?.title || 'the mock'} is deleted (it won't count anywhere), and a fresh code for the same mock and the same sections is issued and sent to them over Telegram.`,
      confirmLabel: 'Void & send new code',
      tone: 'coral',
      onConfirm: () =>
        run(
          r.sitting,
          async () => {
            await rpc('teacher_delete_full_mock_attempt', { p_full_id: r.sitting.id })
            const result = await reissue(r.sitting)
            setNotice({
              tone: result?.sent ? 'sage' : 'brass',
              text: result?.sent
                ? `Voided. New code ${result.code} sent to ${r.name} on Telegram.`
                : `Voided. New code ${result?.code || ''} issued — ${result?.reason || 'it could not be sent on Telegram'}, so share it with them another way.`,
            })
          },
          null
        ),
    })
  }

  const issueRetake = (r) => {
    setMenuFor(null)
    setConfirmDialog({
      title: `Give ${r.name} another sitting?`,
      message: `Issues a new code for ${r.set?.title || 'this mock'} (same sections) and sends it over Telegram. This finished sitting is kept.`,
      confirmLabel: 'Issue code',
      onConfirm: () =>
        run(
          r.sitting,
          async () => {
            const result = await reissue(r.sitting)
            setNotice({
              tone: result?.sent ? 'sage' : 'brass',
              text: result?.sent
                ? `New code ${result.code} sent to ${r.name} on Telegram.`
                : `New code ${result?.code || ''} issued — ${result?.reason || 'it could not be sent on Telegram'}, so share it with them another way.`,
            })
          },
          null
        ),
    })
  }

  // ---- bulk --------------------------------------------------------------
  const selectedRows = shown.filter((r) => selected.has(r.sitting.id))
  const selectable = shown.filter((r) => !r.done || view === 'finished' || view === 'all')
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.sitting.id))
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const bulk = {
    pause: () => runMany(selectedRows.filter((r) => !r.done && !r.paused), (s) => rpc('teacher_pause_full_mock', { p_full_id: s.id }), 'Paused'),
    resume: () => runMany(selectedRows.filter((r) => r.paused), (s) => rpc('teacher_resume_full_mock', { p_full_id: s.id }), 'Resumed'),
    time: (m) =>
      runMany(selectedRows.filter((r) => r.live), (s) => rpc('teacher_add_time_full_mock', { p_full_id: s.id, p_minutes: m }), `Added ${m} min for`),
    voidRetake: () => {
      const rows = selectedRows.filter((r) => !r.done)
      setConfirmDialog({
        title: `Void ${rows.length} sitting${rows.length === 1 ? '' : 's'} and give retakes?`,
        message: `These sittings are deleted (they won't count anywhere) and each student gets a fresh code for the same mock over Telegram: ${rows.map((r) => r.name).join(', ')}.`,
        confirmLabel: 'Void & send new codes',
        tone: 'coral',
        onConfirm: () =>
          runMany(
            rows,
            async (s) => {
              await rpc('teacher_delete_full_mock_attempt', { p_full_id: s.id })
              await reissue(s)
            },
            'Voided and re-issued codes for'
          ),
      })
    },
    remove: () => {
      const rows = selectedRows
      setConfirmDialog({
        title: `Delete ${rows.length} sitting${rows.length === 1 ? '' : 's'}?`,
        message: `Every answer, score and essay from these sittings is removed and they stop counting anywhere: ${rows.map((r) => r.name).join(', ')}. This can't be undone.`,
        confirmLabel: `Delete ${rows.length}`,
        tone: 'coral',
        requireTypedText: rows.length > 5 ? 'DELETE' : undefined,
        onConfirm: () => runMany(rows, (s) => rpc('teacher_delete_full_mock_attempt', { p_full_id: s.id }), 'Deleted sittings of'),
      })
    },
  }

  const tabs = [
    { key: 'live', label: 'Live now', count: nowRows.length },
    { key: 'abandoned', label: 'Abandoned', count: abandonedRows.length },
    { key: 'finished', label: 'Finished' },
    { key: 'all', label: 'All sittings' },
  ]

  const btn = 'focus-ring rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-mist hover:border-brass hover:text-brass disabled:opacity-50'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-paper">Live Mocks</h2>
          <p className="mt-1 max-w-2xl text-sm text-mist">
            Who is sitting a Full Mock right now, where they are and what needs your attention. Tick students to act on
            several at once. Changes reach their screens within a few seconds.
          </p>
        </div>
        <div className="flex flex-wrap rounded-full border border-line bg-panel-2 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setView(t.key)}
              className={`focus-ring rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                view === t.key ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
              }`}
            >
              {t.label}
              {t.count != null && (
                <span className={`ml-1.5 rounded-full px-1.5 py-px text-[10px] ${view === t.key ? 'bg-onbrass/20' : t.key === 'abandoned' && t.count ? 'bg-coral/15 text-coral' : 'bg-panel'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      {view === 'live' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {[
            { k: 'listening', label: 'Listening', n: summary.listening, cls: 'text-listening', f: () => setSectionFilter((v) => (v === 'listening' ? '' : 'listening')) },
            { k: 'reading', label: 'Reading', n: summary.reading, cls: 'text-reading', f: () => setSectionFilter((v) => (v === 'reading' ? '' : 'reading')) },
            { k: 'writing', label: 'Writing', n: summary.writing, cls: 'text-writing', f: () => setSectionFilter((v) => (v === 'writing' ? '' : 'writing')) },
            { k: 'instructions', label: 'On instructions', n: summary.instructions, cls: 'text-paper' },
            { k: 'paused', label: 'Paused', n: summary.paused, cls: 'text-amber' },
            { k: 'offline', label: 'Offline', n: summary.offline, cls: summary.offline ? 'text-coral' : 'text-paper' },
            { k: 'attention', label: 'Need attention', n: summary.attention, cls: summary.attention ? 'text-coral' : 'text-paper' },
          ].map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={t.f}
              disabled={!t.f}
              className={`focus-ring rounded-xl border bg-panel px-3 py-2.5 text-left transition-colors ${
                t.f && sectionFilter === t.k ? 'border-brass' : 'border-line'
              } ${t.f ? 'hover:border-brass/50' : 'cursor-default'}`}
            >
              <span className={`block font-display text-2xl leading-none tabular-nums ${t.cls}`}>{t.n}</span>
              <span className="mt-1 block text-[11px] font-medium text-mist">{t.label}</span>
            </button>
          ))}
        </div>
      )}

      {view === 'abandoned' && abandonedRows.length > 0 && (
        <div className="rounded-xl border border-coral/30 bg-coral/5 px-4 py-3 text-sm text-paper-dim">
          These sittings have had no activity for over 3 hours (or their time ran out long ago) — the student most likely
          closed the page. Tick them and <b>Void &amp; retake</b> to give a fresh code, or <b>Delete</b> to clear them.
        </div>
      )}

      {/* Search / filters */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <span className="sr-only">Search students</span>
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a student…"
            className="focus-ring w-full rounded-full border border-line bg-panel py-2 pl-9 pr-3 text-sm text-paper"
          />
        </label>
        {usedGroupIds.length > 0 && (
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="focus-ring rounded-full border border-line bg-panel px-3 py-2 text-sm text-paper">
            <option value="">All groups</option>
            {usedGroupIds.map((g) => (
              <option key={g} value={g}>
                {groupNameById[g] || 'Group'}
              </option>
            ))}
          </select>
        )}
        <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} className="focus-ring rounded-full border border-line bg-panel px-3 py-2 text-sm text-paper">
          <option value="">All sections</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        {(search || groupFilter || sectionFilter) && (
          <button type="button" onClick={() => { setSearch(''); setGroupFilter(''); setSectionFilter('') }} className="text-xs font-semibold text-mist underline hover:text-paper">
            Clear filters
          </button>
        )}
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-sm ${
            notice.tone === 'coral' ? 'border-coral/30 bg-coral/10 text-coral' : notice.tone === 'brass' ? 'border-brass/30 bg-brass/10 text-brass' : 'border-sage/30 bg-sage/10 text-sage'
          }`}
        >
          {notice.text}
        </div>
      )}
      {loadError && <p className="text-sm text-coral">{loadError}</p>}

      {/* Bulk bar */}
      {selectedRows.length > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-brass/40 bg-panel px-4 py-2.5 shadow-lg">
          <span className="mr-1 text-sm font-semibold text-paper">{selectedRows.length} selected</span>
          {view !== 'finished' && (
            <>
              <button type="button" onClick={bulk.pause} className={btn}>Pause</button>
              <button type="button" onClick={bulk.resume} className={btn}>Resume</button>
              <button type="button" onClick={() => bulk.time(5)} className={btn}>+5 min</button>
              <button type="button" onClick={() => bulk.time(10)} className={btn}>+10 min</button>
              <button type="button" onClick={bulk.voidRetake} className={`${btn} hover:border-coral hover:text-coral`}>Void &amp; retake</button>
            </>
          )}
          <button type="button" onClick={bulk.remove} className="focus-ring rounded-full border border-coral/40 px-3 py-1.5 text-xs font-semibold text-coral hover:bg-coral/10">
            Delete
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs font-semibold text-mist underline hover:text-paper">
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-mist">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
          {view === 'live'
            ? search || groupFilter || sectionFilter
              ? 'Nobody matches these filters.'
              : 'Nobody is sitting a mock right now.'
            : view === 'abandoned'
              ? 'No abandoned sittings. 🎉'
              : 'No sittings here yet.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-panel">
          {/* header */}
          <div className="hidden grid-cols-[2rem_minmax(0,1.6fr)_7.5rem_minmax(0,1.3fr)_6.5rem_6.5rem_minmax(0,1.5fr)_7rem] items-center gap-3 border-b border-line bg-panel-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-mist lg:grid">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.sitting.id)))}
              className="h-4 w-4 accent-brass"
              aria-label="Select all"
            />
            <span>Student</span>
            <span>Section</span>
            <span>Progress</span>
            <span>Time left</span>
            <span>Last seen</span>
            <span>Alerts</span>
            <span className="text-right">Actions</span>
          </div>

          {shown.map((r) => {
            const s = r.sitting
            const busy = busyIds.has(s.id)
            const pct = r.total ? Math.min(100, Math.round((r.answered / r.total) * 100)) : null
            const rowTone = r.severity === 2 ? 'bg-coral/5' : r.severity === 1 ? 'bg-amber/5' : ''
            return (
              <div
                key={s.id}
                className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 lg:grid-cols-[2rem_minmax(0,1.6fr)_7.5rem_minmax(0,1.3fr)_6.5rem_6.5rem_minmax(0,1.5fr)_7rem] ${rowTone} ${busy ? 'opacity-60' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="h-4 w-4 accent-brass"
                  aria-label={`Select ${r.name}`}
                />

                {/* student */}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-paper">{r.name}</p>
                  <p className="truncate text-[11px] text-mist">
                    {r.groupNames.length ? `${r.groupNames.join(', ')} · ` : ''}
                    {r.set?.title || 'Full Mock'} · {new Date(s.started_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}{' '}
                    {new Date(s.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                {/* mobile: time + menu on the right of the name */}
                <div className="flex items-center gap-2 lg:hidden">
                  {r.timeLeft !== null && (
                    <span className={`font-mono text-sm tabular-nums ${r.timeLeft < 5 * MIN ? 'text-coral' : 'text-paper'}`}>{formatLeft(r.timeLeft)}</span>
                  )}
                  <RowMenu r={r} open={menuFor === s.id} onToggle={() => setMenuFor((m) => (m === s.id ? null : s.id))} busy={busy} actions={{ pause, resume, addTime, advance, voidAndRetake, issueRetake, remove }} />
                </div>

                {/* section */}
                <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-1.5 lg:col-span-1 lg:col-start-auto">
                  {r.done ? (
                    <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-mist">Finished</span>
                  ) : r.paused ? (
                    <span className="whitespace-nowrap rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-[11px] font-semibold text-amber">{STAGE_LABEL[s.stage]} · paused</span>
                  ) : (
                    <>
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STAGE_COLOR[s.stage] || ''}`}>{STAGE_LABEL[s.stage]}</span>
                      {!r.live && <span className="whitespace-nowrap text-[11px] text-mist">not started</span>}
                    </>
                  )}
                </div>

                {/* progress */}
                <div className="col-span-2 col-start-2 min-w-0 lg:col-span-1 lg:col-start-auto">
                  {r.live?.kind === 'rl' ? (
                    <div>
                      <div className="flex items-baseline justify-between text-[11px] text-mist">
                        <span>
                          <b className="text-paper">{r.answered}</b>
                          {r.total ? ` / ${r.total}` : ''} answered
                        </span>
                        {pct != null && <span>{pct}%</span>}
                      </div>
                      {pct != null && (
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                          <div className="h-full rounded-full bg-brass" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                  ) : r.live?.kind === 'writing' ? (
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-mist">
                      {[
                        ['Task 1', r.words.t1, 150],
                        ['Task 2', r.words.t2, 250],
                      ].map(([label, n, min]) => (
                        <div key={label}>
                          <span>
                            {label}: <b className={n >= min ? 'text-sage' : 'text-paper'}>{n}</b>w
                          </span>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                            <div className={`h-full rounded-full ${n >= min ? 'bg-sage' : 'bg-brass'}`} style={{ width: `${Math.min(100, (n / min) * 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-mist">{r.done && s.completed_at ? `Finished ${new Date(s.completed_at).toLocaleString()}` : '—'}</span>
                  )}
                </div>

                {/* time left */}
                <div className="hidden lg:block">
                  {r.timeLeft !== null ? (
                    <span className={`font-mono text-sm tabular-nums ${r.timeLeft < 5 * MIN ? 'text-coral' : 'text-paper'}`}>{formatLeft(r.timeLeft)}</span>
                  ) : (
                    <span className="text-[11px] text-mist">—</span>
                  )}
                </div>

                {/* last seen */}
                <div className="hidden text-[11px] text-mist lg:block">
                  {r.done ? '—' : formatAgo(r.lastSeen ?? r.sinceActivity)}
                  {r.tabs > 0 && <span className="block">{r.tabs} tab switch{r.tabs === 1 ? '' : 'es'}</span>}
                </div>

                {/* alerts */}
                <div className="col-span-2 col-start-2 flex flex-wrap gap-1 lg:col-span-1 lg:col-start-auto">
                  {r.abandoned && <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[11px] font-semibold text-coral">No activity {formatAgo(r.sinceActivity).replace(' ago', '')}</span>}
                  {r.alerts.map(([sev, text]) => (
                    <span key={text} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${sev === 2 ? 'bg-coral/15 text-coral' : 'bg-amber/15 text-amber'}`}>
                      {text}
                    </span>
                  ))}
                </div>

                {/* actions */}
                <div className="hidden items-center justify-end gap-1.5 lg:flex">
                  {!r.done &&
                    (r.paused ? (
                      <button type="button" disabled={busy} onClick={() => resume(r)} className="focus-ring rounded-full bg-brass px-2.5 py-1 text-[11px] font-bold text-onbrass hover:bg-brass-dim disabled:opacity-50">
                        ▶ Resume
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => pause(r)} className="focus-ring inline-flex items-center gap-1 rounded-full border border-amber/40 px-2.5 py-1 text-[11px] font-bold text-amber hover:bg-amber/10 disabled:opacity-50">
                        <Icon name="pause" className="h-3 w-3" /> Pause
                      </button>
                    ))}
                  <RowMenu r={r} open={menuFor === s.id} onToggle={() => setMenuFor((m) => (m === s.id ? null : s.id))} busy={busy} actions={{ pause, resume, addTime, advance, voidAndRetake, issueRetake, remove }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmDialog)}
        {...confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const action = confirmDialog?.onConfirm
          setConfirmDialog(null)
          action?.()
        }}
      />
    </div>
  )
}

// "⋯" menu with every action for one sitting.
function RowMenu({ r, open, onToggle, busy, actions }) {
  const item = 'focus-ring block w-full px-3 py-2 text-left text-sm text-paper hover:bg-panel-2 disabled:opacity-50'
  const s = r.sitting
  return (
    <div className="relative" data-row-menu>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${r.name}`}
        className="focus-ring flex h-7 w-7 items-center justify-center rounded-full border border-line text-mist hover:border-brass hover:text-brass disabled:opacity-50"
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-panel py-1 shadow-xl">
          {!r.done && (
            <>
              {r.paused ? (
                <button type="button" className={item} onClick={() => actions.resume(r)}>▶ Resume</button>
              ) : (
                <button type="button" className={item} onClick={() => actions.pause(r)}>⏸ Pause</button>
              )}
              {r.live && (
                <>
                  <button type="button" className={item} onClick={() => actions.addTime(r, 5)}>+5 minutes</button>
                  <button type="button" className={item} onClick={() => actions.addTime(r, 10)}>+10 minutes</button>
                </>
              )}
              <button type="button" className={item} onClick={() => actions.advance(r)}>
                {r.live ? `End ${STAGE_LABEL[s.stage]} now` : `Skip ${STAGE_LABEL[s.stage]}`}
              </button>
              <button type="button" className={item} onClick={() => actions.voidAndRetake(r)}>Void &amp; retake</button>
            </>
          )}
          {r.done && (
            <button type="button" className={item} onClick={() => actions.issueRetake(r)}>Give another sitting</button>
          )}
          <div className="my-1 border-t border-line" />
          <button type="button" className={`${item} text-coral`} onClick={() => actions.remove(r)}>Delete sitting</button>
        </div>
      )}
    </div>
  )
}
