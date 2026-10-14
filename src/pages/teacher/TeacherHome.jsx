import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { skillOfHomework, formatDue, isSameDay } from '../../lib/skills'
import { groupBadge, groupColour, groupDisplayName } from '../../lib/groupLook'
import { fetchAll } from '../../lib/fetchAll'
import { notifyUsers } from '../../lib/notify'
import { firstNameOf } from '../../lib/names'
import { SkillIcon } from '../../components/SkillArt'
import ConfirmModal from '../../components/ConfirmModal'

/*
 * TEACHER HOME — "Study room" design (2026-10-06), reworked 2026-10-14
 * after Jasur's "don't you think we can improve teachers dashboard?":
 *
 *   - the numbers agree with the Mock Center: "results to release" only
 *     counts real results (an attempt with 0 correct or handed in within
 *     10 minutes is an abandoned sitting, same rule as the Results tab);
 *   - the top line names the next deadline instead of "No deadlines
 *     today" next to a card showing tomorrow's deadline;
 *   - one card per group (next deadline, who's handed in, a Remind
 *     button, two-week hand-in rate, how many are behind) instead of one
 *     group in a big hero card;
 *   - "Missed 2+ deadlines" is split by group;
 *   - every "Waiting for you" row opens the exact tab it is about.
 *
 * "Handed in" = a submissions row with status 'done'; for deadlines that
 * have passed, a homework_completions row also counts (kept after a reset).
 */

const DAY = 86400000
const WINDOW_DAYS = 14
const INCOMPLETE_MINUTES = 10 // same rule as TeacherMockCenter's isEmptyAttempt

function isRealResult(a) {
  if (Number(a.score) <= 0) return false
  if (a.started_at && a.submitted_at) {
    const mins = (new Date(a.submitted_at) - new Date(a.started_at)) / 60000
    if (mins < INCOMPLETE_MINUTES) return false
  }
  return true
}

function useTeacherOverview(reloadKey) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    const since = new Date(now - WINDOW_DAYS * DAY).toISOString()
    const weekAgo = new Date(now - 7 * DAY).toISOString()
    const threeHoursAgo = new Date(now - 3 * 3600 * 1000).toISOString()

    const load = async () => {
      try {
        const [groupsRes, membersRes, hwRes, accessRes, mockRes, writingRes, liveRes, wordRes, reviewRes, feedRes] = await Promise.all([
          supabase.from('groups').select('id, name, created_at').order('created_at'),
          // fetchAll (2026-10-06) — same 1000-row cap.
          fetchAll(() =>
            supabase
              .from('group_members')
              .select('group_id, student_id, created_at, profiles!inner(id, full_name, username, avatar_url, status)')
              .eq('profiles.status', 'approved')
              .order('group_id')
              .order('student_id')
          ),
          supabase
            .from('homeworks')
            .select('id, group_id, title, description, homework_type, enable_speaking, due_date, created_at')
            .or(`due_date.gte.${since},created_at.gte.${since}`)
            .order('due_date', { ascending: true }),
          supabase.from('mock_access_requests').select('id, requested_at').eq('status', 'pending').order('requested_at'),
          supabase
            .from('mock_attempts')
            .select('id, score, started_at, submitted_at')
            .not('submitted_at', 'is', null)
            .is('released_at', null)
            .limit(1000),
          supabase
            .from('writing_mock_attempts')
            .select('id', { count: 'exact', head: true })
            .not('submitted_at', 'is', null)
            .is('released_at', null),
          // Same "live" rule as the Mock Center's Live Mocks badge.
          supabase
            .from('full_mock_attempts')
            .select('id', { count: 'exact', head: true })
            .neq('stage', 'done')
            .gte('updated_at', threeHoursAgo),
          supabase.from('wordlist_attempts').select('student_id, created_at').gte('created_at', weekAgo).limit(5000),
          supabase.from('word_review_sessions').select('student_id, created_at').gte('created_at', weekAgo).limit(5000),
          supabase
            .from('submissions')
            .select('id, homework_id, student_id, group_id, submitted_at, ai_status')
            .eq('status', 'done')
            .not('submitted_at', 'is', null)
            .order('submitted_at', { ascending: false })
            .limit(8),
        ])

        const homeworks = hwRes.data || []
        let submissions = []
        let completions = []
        if (homeworks.length) {
          const subsRes = await fetchAll(() =>
            supabase
              .from('submissions')
              .select('id, homework_id, student_id, status, submitted_at')
              .in('homework_id', homeworks.map((h) => h.id))
              .eq('status', 'done')
              .order('id')
          )
          submissions = subsRes.data || []
          // A teacher reset puts the submission back to pending but keeps
          // the homework_completions row. Past deadlines count those too
          // (same rule as the leaderboard and the parent report).
          const compRes = await fetchAll(() =>
            supabase
              .from('homework_completions')
              .select('homework_id, student_id, completed_at')
              .in('homework_id', homeworks.map((h) => h.id))
              .order('id')
          )
          completions = compRes.data || []
        }

        // Titles for feed rows whose homework is older than the window.
        const feed = feedRes.data || []
        const known = new Set(homeworks.map((h) => h.id))
        const missing = [...new Set(feed.map((f) => f.homework_id).filter((id) => !known.has(id)))]
        let extraHomeworks = []
        if (missing.length) {
          const extra = await supabase
            .from('homeworks')
            .select('id, group_id, title, description, homework_type, enable_speaking, due_date, created_at')
            .in('id', missing)
          extraHomeworks = extra.data || []
        }

        if (cancelled) return
        if (groupsRes.error) throw groupsRes.error
        const unreleasedRows = mockRes.data || []
        setData({
          groups: groupsRes.data || [],
          members: membersRes.data || [],
          homeworks,
          extraHomeworks,
          submissions,
          completions,
          feed,
          accessRequests: accessRes.data || [],
          unreleased: unreleasedRows.filter(isRealResult).length + (writingRes.count || 0),
          liveMocks: liveRes.count || 0,
          wordActivity: [...(wordRes.data || []), ...(reviewRes.data || [])],
        })
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load the overview.')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return { data, error }
}

function Card({ className = '', children, ...rest }) {
  return (
    <section className={`rounded-[22px] border border-line bg-panel ${className}`} {...rest}>
      {children}
    </section>
  )
}

function Arrow({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function Avatar({ person, size = 'h-8 w-8', className = '' }) {
  const name = person?.full_name || person?.username || '?'
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return person?.avatar_url ? (
    <img src={person.avatar_url} alt="" className={`${size} shrink-0 rounded-full object-cover ${className}`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-panel-2 text-[11px] font-semibold text-paper-dim ${className}`}>
      {initials}
    </span>
  )
}

function greeting(now) {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function timeAgo(value, now) {
  const mins = Math.max(0, Math.round((now - new Date(value)) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

function dueLabel(value, now) {
  return formatDue(value, now).replace(/^Today/, 'today').replace(/^Tomorrow/, 'tomorrow')
}

export default function TeacherHome({ profile, pendingCount = 0, onNavigate, onOpenGroup, onOpenMockCenter }) {
  const [reloadKey, setReloadKey] = useState(0)
  const { data, error } = useTeacherOverview(reloadKey)
  const now = useMemo(() => new Date(), [])
  const firstName = firstNameOf(profile?.full_name)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [reminding, setReminding] = useState('')
  const [reminded, setReminded] = useState({}) // homework id → count sent
  const [openBehind, setOpenBehind] = useState(null) // group id

  const model = useMemo(() => {
    if (!data) return null
    const groupIndex = {}
    data.groups.forEach((g, i) => {
      groupIndex[g.id] = i
    })
    const groupById = Object.fromEntries(data.groups.map((g) => [g.id, g]))

    const membersByGroup = {}
    const personById = {}
    for (const m of data.members) {
      if (!m.profiles) continue // only approved students (inner join) — never crash on a missing profile
      ;(membersByGroup[m.group_id] ||= []).push(m)
      personById[m.student_id] = m.profiles
    }

    const doneSet = new Set(data.submissions.map((s) => `${s.homework_id}:${s.student_id}`))
    const completedSet = new Set((data.completions || []).map((c) => `${c.homework_id}:${c.student_id}`))
    const isDone = (hwId, studentId, countCompletions = false) =>
      doneSet.has(`${hwId}:${studentId}`) || (countCompletions && completedSet.has(`${hwId}:${studentId}`))

    // Expected students for a homework: members of its group who had
    // joined before the deadline.
    const expectedFor = (hw) => {
      const due = hw.due_date ? new Date(hw.due_date) : null
      return (membersByGroup[hw.group_id] || []).filter((m) => !due || !m.created_at || new Date(m.created_at) <= due)
    }

    const progress = (hw) => {
      const expected = expectedFor(hw)
      const past = hw.due_date && new Date(hw.due_date) < now
      const done = expected.filter((m) => isDone(hw.id, m.student_id, past))
      const missing = expected.filter((m) => !isDone(hw.id, m.student_id, past))
      return { total: expected.length, done: done.length, missing }
    }

    const hwWithGroup = data.homeworks.filter((h) => groupById[h.group_id])
    const upcoming = hwWithGroup
      .filter((h) => h.due_date && new Date(h.due_date) >= now)
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    const past = hwWithGroup
      .filter((h) => h.due_date && new Date(h.due_date) < now && now - new Date(h.due_date) <= WINDOW_DAYS * DAY)
      .sort((a, b) => new Date(b.due_date) - new Date(a.due_date))

    const tomorrow = new Date(now.getTime() + DAY)
    const dueToday = upcoming.filter((h) => isSameDay(new Date(h.due_date), now)).length
    const dueTomorrow = upcoming.filter((h) => isSameDay(new Date(h.due_date), tomorrow)).length
    const handedInToday = data.submissions.filter((s) => s.submitted_at && isSameDay(new Date(s.submitted_at), now)).length

    // Students who missed 2+ deadlines in the window, per group.
    const missedByStudent = {}
    for (const h of past) {
      for (const m of progress(h).missing) {
        const key = `${m.group_id}:${m.student_id}`
        missedByStudent[key] ||= { person: personById[m.student_id], groupId: m.group_id, count: 0, titles: [] }
        missedByStudent[key].count += 1
        missedByStudent[key].titles.push(h.title)
      }
    }
    const behind = Object.values(missedByStudent)
      .filter((r) => r.count >= 2 && r.person)
      .sort((a, b) => b.count - a.count || (a.person.full_name || '').localeCompare(b.person.full_name || ''))
    const behindByGroup = {}
    for (const r of behind) (behindByGroup[r.groupId] ||= []).push(r)
    const behindStudents = new Set(behind.map((r) => r.person.id)).size

    // One card per group.
    const groupCards = data.groups.map((g) => {
      const gPast = past.filter((h) => h.group_id === g.id)
      let expected = 0
      let done = 0
      for (const h of gPast) {
        const p = progress(h)
        expected += p.total
        done += p.done
      }
      const next = upcoming.find((h) => h.group_id === g.id) || null
      const lastClosed = gPast[0] || null
      return {
        group: g,
        index: groupIndex[g.id],
        students: (membersByGroup[g.id] || []).length,
        rate: expected ? Math.round((done / expected) * 100) : null,
        next,
        nextProgress: next ? progress(next) : null,
        moreDue: upcoming.filter((h) => h.group_id === g.id).length - (next ? 1 : 0),
        lastClosed,
        lastClosedProgress: lastClosed ? progress(lastClosed) : null,
        behind: (behindByGroup[g.id] || []).length,
      }
    })
    // Groups with a deadline first (soonest first), then the rest.
    groupCards.sort((a, b) => {
      if (a.next && b.next) return new Date(a.next.due_date) - new Date(b.next.due_date)
      if (a.next) return -1
      if (b.next) return 1
      return a.index - b.index
    })

    // Recently closed deadlines with their hand-in rate.
    const closed = past.slice(0, 6).map((h) => ({ hw: h, p: progress(h) }))

    // Feed rows.
    const hwById = Object.fromEntries([...data.homeworks, ...data.extraHomeworks].map((h) => [h.id, h]))
    const feed = data.feed.map((s) => ({
      ...s,
      person: personById[s.student_id],
      hw: hwById[s.homework_id],
      group: groupById[s.group_id] || groupById[hwById[s.homework_id]?.group_id],
    }))

    // Word practice per day, last 7 days (oldest first).
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now)
      d.setDate(now.getDate() - (6 - i))
      return d
    })
    const perDay = days.map((d) => ({
      date: d,
      count: data.wordActivity.filter((a) => isSameDay(new Date(a.created_at), d)).length,
    }))
    const practisers = {}
    for (const a of data.wordActivity) practisers[a.student_id] = (practisers[a.student_id] || 0) + 1
    const topPractisers = Object.entries(practisers)
      .map(([id, count]) => ({ person: personById[id], count }))
      .filter((r) => r.person)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)

    return {
      groupIndex,
      groupById,
      firstNext: upcoming[0] || null,
      dueToday,
      dueTomorrow,
      handedInToday,
      groupCards,
      behind,
      behindByGroup,
      behindStudents,
      closed,
      feed,
      perDay,
      activeLearners: Object.keys(practisers).length,
      topPractisers,
      totalStudents: new Set(data.members.map((m) => m.student_id)).size,
    }
  }, [data, now])

  const remind = (hw, missing) => {
    if (!missing.length) return
    const overdue = hw.due_date && new Date(hw.due_date) < new Date()
    setConfirmDialog({
      title: `Remind ${plural(missing.length, 'student')}?`,
      message:
        `They haven't handed in "${hw.title}" yet:\n` +
        missing
          .slice(0, 12)
          .map((m) => `• ${m.profiles?.full_name || m.profiles?.username || 'Student'}`)
          .join('\n') +
        (missing.length > 12 ? `\n…and ${missing.length - 12} more` : ''),
      confirmLabel: 'Send reminder',
      cancelLabel: 'Cancel',
      tone: 'brass',
      onConfirm: async () => {
        setReminding(hw.id)
        const result = await notifyUsers({
          userIds: missing.map((m) => m.student_id),
          type: 'homework_reminder',
          title: overdue ? 'Homework overdue' : 'Homework reminder',
          body: overdue
            ? `"${hw.title}" was due — please complete it as soon as possible.`
            : `Don't forget "${hw.title}"${hw.due_date ? ` — due ${new Date(hw.due_date).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.`,
          link: `homework:${hw.id}`,
        })
        setReminding('')
        if (!result.ok && result.reason === 'all') {
          setConfirmDialog({
            title: "Reminder wasn't sent",
            message: result.detail || 'Unknown error',
            tone: 'coral',
            confirmLabel: 'OK',
            hideCancel: true,
            onConfirm: () => {},
          })
        } else {
          setReminded((prev) => ({ ...prev, [hw.id]: missing.length }))
        }
      },
    })
  }

  if (error) {
    return (
      <Card className="p-8 text-center">
        <p className="text-lg font-semibold">Couldn’t load the overview</p>
        <p className="mt-1 text-sm text-mist">{error}</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="focus-ring mt-4 inline-flex h-11 items-center rounded-xl bg-brass px-5 text-sm font-medium text-onbrass hover:bg-brass-dim"
        >
          Try again
        </button>
      </Card>
    )
  }

  if (!model) {
    return (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" aria-busy="true">
        {['lg:col-span-12 h-[96px]', 'lg:col-span-8 h-[420px]', 'lg:col-span-4 h-[420px]', 'lg:col-span-5 h-[280px]', 'lg:col-span-7 h-[280px]'].map((c) => (
          <div key={c} className={`${c} animate-pulse rounded-[22px] border border-line bg-panel`} />
        ))}
      </div>
    )
  }

  const oldestRequest = data.accessRequests[0]
  const waiting = [
    pendingCount > 0 && {
      key: 'approvals',
      count: pendingCount,
      label: pendingCount === 1 ? 'new student to approve' : 'new students to approve',
      hint: 'Approvals',
      action: () => onNavigate('approvals'),
    },
    data.accessRequests.length > 0 && {
      key: 'access',
      count: data.accessRequests.length,
      label: data.accessRequests.length === 1 ? 'mock request' : 'mock requests',
      hint: oldestRequest ? `oldest ${timeAgo(oldestRequest.requested_at, now)}` : '',
      action: () => onOpenMockCenter('access'),
    },
    data.unreleased > 0 && {
      key: 'release',
      count: data.unreleased,
      label: data.unreleased === 1 ? 'mock result to release' : 'mock results to release',
      hint: 'Results',
      action: () => onOpenMockCenter('results'),
    },
    model.behindStudents > 0 && {
      key: 'behind',
      count: model.behindStudents,
      label: model.behindStudents === 1 ? 'student missed 2+ deadlines' : 'students missed 2+ deadlines',
      hint: `last ${WINDOW_DAYS} days`,
      action: () => document.getElementById('teacher-home-behind')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    },
  ].filter(Boolean)

  const next = model.firstNext
  const nextGroup = next ? model.groupById[next.group_id] : null
  const maxDay = Math.max(1, ...model.perDay.map((d) => d.count))
  const behindGroups = model.groupCards.filter((c) => (model.behindByGroup[c.group.id] || []).length)

  const stats = [
    {
      key: 'live',
      value: data.liveMocks,
      label: data.liveMocks === 1 ? 'mock running now' : 'mocks running now',
      dot: data.liveMocks > 0,
      action: () => onOpenMockCenter('live'),
    },
    {
      key: 'due',
      value: model.dueToday,
      label: `due today${model.dueTomorrow ? ` · ${model.dueTomorrow} tomorrow` : ''}`,
      action: () => onNavigate('groups'),
    },
    { key: 'handins', value: model.handedInToday, label: model.handedInToday === 1 ? 'hand-in today' : 'hand-ins today', action: () => document.getElementById('teacher-home-feed')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
    {
      key: 'words',
      value: model.perDay[6]?.count || 0,
      label: 'word practice sessions today',
      action: () => onNavigate('wordlists'),
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* GREETING */}
      <div className="lg:col-span-12 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">
            {greeting(now)}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-[15px] text-paper-dim">
            {next ? (
              <>
                Next deadline <span className="font-medium text-paper">{dueLabel(next.due_date, now)}</span> · {groupDisplayName(nextGroup?.name)}
              </>
            ) : (
              'No deadlines coming up'
            )}
            {' · '}
            {plural(model.totalStudents, 'student')} in {plural(data.groups.length, 'group')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('groups')}
          className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-brass px-5 text-[15px] font-medium text-onbrass hover:bg-brass-dim"
        >
          Post homework
          <Arrow />
        </button>
      </div>

      {/* TODAY STRIP */}
      <div className="lg:col-span-12 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={s.action}
            className="focus-ring flex flex-col items-start gap-0.5 rounded-[18px] border border-line bg-panel px-4 py-3.5 text-left transition-colors hover:border-paper/30"
          >
            <span className="flex items-center gap-2 text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em]">
              {s.dot && (
                <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-reading opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-reading" />
                </span>
              )}
              {s.value}
            </span>
            <span className="text-[13px] text-mist">{s.label}</span>
          </button>
        ))}
      </div>

      {/* WAITING FOR YOU */}
      <div className="lg:col-span-4 lg:col-start-9 lg:row-start-3 flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Waiting for you</h2>
        <Card className="flex flex-col gap-1 p-3">
          {waiting.length ? (
            waiting.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={w.action}
                className="focus-ring flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left hover:bg-panel-2"
              >
                <span
                  className={`flex h-10 min-w-10 items-center justify-center rounded-[11px] px-2 text-[17px] font-semibold tabular-nums ${
                    w.key === 'behind' ? 'bg-urgent-tint text-urgent' : 'bg-brass/10 text-brass'
                  }`}
                >
                  {w.count}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] leading-snug">{w.label}</span>
                  {w.hint && <span className="text-[12px] text-mist">{w.hint}</span>}
                </span>
                <Arrow className="h-4 w-4 shrink-0 text-mist" />
              </button>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-reading-tint px-4 py-8 text-center">
              <svg viewBox="0 0 64 64" className="h-12 w-12 text-reading" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="32" cy="32" r="24" />
                <path d="M21 33l7 7 15-16" />
              </svg>
              <p className="text-[15px] font-medium text-reading">All clear. Nothing is waiting for you.</p>
            </div>
          )}
        </Card>

        {/* Recently closed deadlines */}
        <Card className="flex flex-col gap-3 p-5">
          <h3 className="text-[15px] font-semibold">Recently closed</h3>
          {model.closed.length ? (
            <ul className="flex flex-col gap-2.5">
              {model.closed.map(({ hw, p }) => {
                const g = model.groupById[hw.group_id]
                const colour = groupColour(model.groupIndex[hw.group_id])
                const pctDone = p.total ? Math.round((p.done / p.total) * 100) : 0
                return (
                  <li key={hw.id}>
                    <button
                      type="button"
                      onClick={() => onOpenGroup(hw.group_id)}
                      className="focus-ring grid w-full grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg text-left hover:bg-panel-2"
                    >
                      <span className={`flex h-[30px] w-[30px] items-center justify-center rounded-lg text-[12px] font-semibold ${colour.tint} ${colour.text}`}>
                        {groupBadge(g?.name)}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[14px]">{hw.title}</span>
                        <span className="text-[12px] text-mist">Closed {formatDue(hw.due_date, now)}</span>
                      </span>
                      <span className={`text-[14px] font-semibold tabular-nums ${pctDone < 60 ? 'text-urgent' : ''}`}>{pctDone}%</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-mist">No deadlines in the last {WINDOW_DAYS} days.</p>
          )}
        </Card>
      </div>

      {/* GROUPS */}
      <div className="lg:col-span-8 lg:col-start-1 lg:row-start-3 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Your groups</h2>
          <span className="text-[13px] text-mist">Rate = handed in, last {WINDOW_DAYS} days</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {model.groupCards.map((c) => {
            const colour = groupColour(c.index)
            const skill = c.next ? skillOfHomework(c.next) : null
            const p = c.nextProgress
            const pctDone = p && p.total ? Math.round((p.done / p.total) * 100) : 0
            const urgent = c.next && isSameDay(new Date(c.next.due_date), now)
            return (
              <Card key={c.group.id} className="flex flex-col gap-3.5 p-5">
                <button
                  type="button"
                  onClick={() => onOpenGroup(c.group.id)}
                  className="focus-ring -m-1 flex items-center gap-3 rounded-xl p-1 text-left hover:bg-panel-2"
                >
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] text-[15px] font-semibold ${colour.tint} ${colour.text}`}>
                    {groupBadge(c.group.name)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[16px] font-semibold">{groupDisplayName(c.group.name)}</span>
                    <span className="text-[13px] text-mist">
                      {plural(c.students, 'student')}
                      {c.behind > 0 && <span className="text-urgent"> · {c.behind} behind</span>}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="text-[17px] font-semibold tabular-nums">{c.rate != null ? `${c.rate}%` : '–'}</span>
                    <span className="text-[11px] text-mist">hand-in rate</span>
                  </span>
                </button>

                {c.next ? (
                  <div className="flex flex-1 flex-col gap-2.5 rounded-2xl bg-panel-2 p-3.5">
                    <div className="flex items-center gap-2 text-[13px]">
                      <SkillIcon skill={skill.key} className={`h-4 w-4 shrink-0 ${skill.key === 'general' ? '' : skill.text}`} />
                      <span className={urgent ? 'font-medium text-urgent' : 'text-paper-dim'}>Due {dueLabel(c.next.due_date, now)}</span>
                      {c.moreDue > 0 && <span className="ml-auto text-mist">+{c.moreDue} more</span>}
                    </div>
                    <p className="line-clamp-2 text-[15px] font-medium leading-snug">{c.next.title}</p>
                    <div className="flex items-center gap-2.5">
                      <div className="h-2 flex-1 rounded bg-line/70">
                        <div className={`h-full rounded ${colour.bar}`} style={{ width: `${Math.max(p.done ? 3 : 0, pctDone)}%` }} />
                      </div>
                      <span className="text-[13px] font-semibold tabular-nums">
                        {p.done}/{p.total}
                      </span>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[13px] text-mist">
                        {p.total === 0 ? 'No students yet' : p.missing.length === 0 ? 'Everyone has handed in' : `${p.missing.length} still to hand in`}
                      </span>
                      {p.missing.length > 0 &&
                        (reminded[c.next.id] ? (
                          <span className="text-[13px] font-medium text-reading">Reminded {reminded[c.next.id]}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => remind(c.next, p.missing)}
                            disabled={reminding === c.next.id}
                            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-[13px] font-medium hover:border-paper/30 disabled:opacity-50"
                          >
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                            {reminding === c.next.id ? 'Sending…' : 'Remind'}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col justify-between gap-2 rounded-2xl border border-dashed border-line p-3.5">
                    <p className="text-[14px] text-paper-dim">
                      No deadline coming up.
                      {c.lastClosed && (
                        <span className="text-mist">
                          {' '}Last: {c.lastClosed.title} ({c.lastClosedProgress.done}/{c.lastClosedProgress.total})
                        </span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenGroup(c.group.id)}
                      className="focus-ring inline-flex h-8 w-fit items-center gap-1.5 rounded-lg bg-brass px-3 text-[13px] font-medium text-onbrass hover:bg-brass-dim"
                    >
                      Post homework <Arrow className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* FALLING BEHIND — by group */}
      <Card id="teacher-home-behind" className="lg:col-span-5 lg:self-start flex scroll-mt-24 flex-col gap-3 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-semibold">Missed 2+ deadlines</h2>
          <span className="text-[13px] text-mist">Last {WINDOW_DAYS} days</span>
        </div>
        {behindGroups.length ? (
          <ul className="flex flex-col">
            {behindGroups.map((c) => {
              const rows = model.behindByGroup[c.group.id]
              const colour = groupColour(c.index)
              const open = openBehind === c.group.id
              return (
                <li key={c.group.id} className="border-t border-line first:border-0">
                  <button
                    type="button"
                    onClick={() => setOpenBehind(open ? null : c.group.id)}
                    aria-expanded={open}
                    className="focus-ring flex w-full items-center gap-3 rounded-xl px-1.5 py-2.5 text-left hover:bg-panel-2"
                  >
                    <span className={`flex h-9 w-9 items-center justify-center rounded-[11px] text-[13px] font-semibold ${colour.tint} ${colour.text}`}>
                      {groupBadge(c.group.name)}
                    </span>
                    <span className="flex-1 text-[15px]">{groupDisplayName(c.group.name)}</span>
                    <span className="rounded-lg bg-urgent-tint px-2.5 py-1 text-[13px] font-semibold text-urgent tabular-nums">
                      {rows.length} of {c.students}
                    </span>
                    <svg className={`h-4 w-4 text-mist transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {open && (
                    <ul className="mb-2 ml-12 flex flex-col gap-0.5">
                      {rows.map((r) => (
                        <li key={r.person.id} className="flex items-center gap-2.5 py-1" title={r.titles.join('\n')}>
                          <Avatar person={r.person} size="h-7 w-7" />
                          <span className="min-w-0 flex-1 truncate text-[14px]">{r.person.full_name || r.person.username}</span>
                          <span className="text-[13px] font-medium text-urgent tabular-nums">{r.count} missed</span>
                        </li>
                      ))}
                      <li className="pt-1">
                        <button type="button" onClick={() => onOpenGroup(c.group.id)} className="focus-ring text-[13px] font-medium text-paper-dim hover:text-paper">
                          Open {groupDisplayName(c.group.name)} →
                        </button>
                      </li>
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="rounded-2xl bg-reading-tint px-4 py-6 text-center text-[15px] font-medium text-reading">
            Nobody has missed two deadlines. Nice.
          </p>
        )}
      </Card>

      {/* LATEST HAND-INS */}
      <Card id="teacher-home-feed" className="lg:col-span-7 flex scroll-mt-24 flex-col gap-4 p-6">
        <h2 className="text-[17px] font-semibold">Latest hand-ins</h2>
        {model.feed.length ? (
          <ul className="flex flex-col">
            {model.feed.map((s) => {
              const skill = s.hw ? skillOfHomework(s.hw) : null
              return (
                <li key={s.id} className="border-t border-line first:border-0">
                  <button
                    type="button"
                    onClick={() => s.group && onOpenGroup(s.group.id)}
                    className="focus-ring flex w-full items-center gap-3 rounded-xl px-1.5 py-2.5 text-left hover:bg-panel-2"
                  >
                    <Avatar person={s.person} size="h-9 w-9" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px]">
                        <span className="font-medium">{s.person?.full_name || 'A student'}</span>
                        <span className="text-mist"> handed in </span>
                        {s.hw?.title || 'homework'}
                      </span>
                      <span className="flex items-center gap-1.5 text-[13px] text-mist">
                        {skill && <SkillIcon skill={skill.key} className={`h-3.5 w-3.5 ${skill.key === 'general' ? '' : skill.text}`} />}
                        {groupDisplayName(s.group?.name)} · {timeAgo(s.submitted_at, now)}
                        {s.ai_status === 'done' && <span className="ml-1 rounded-md bg-listening-tint px-1.5 text-[12px] font-medium text-listening">AI checked</span>}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-mist">Hand-ins will appear here as students send their work.</p>
        )}
      </Card>

      {/* WORD PRACTICE */}
      <Card className="lg:col-span-12 flex flex-col gap-4 p-6 md:flex-row md:items-stretch md:gap-8">
        <div className="flex flex-col justify-between gap-3 md:w-[260px]">
          <div>
            <h2 className="text-[17px] font-semibold">Word practice this week</h2>
            <p className="mt-1 text-sm text-paper-dim">
              <strong className="font-semibold text-paper">{model.activeLearners}</strong> of {model.totalStudents} students practised
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            {model.topPractisers.length > 0 && (
              <span className="flex -space-x-2" title={`Most active: ${model.topPractisers.map((t) => t.person.full_name).join(', ')}`}>
                {model.topPractisers.map((t) => (
                  <Avatar key={t.person.id} person={t.person} size="h-8 w-8" className="ring-2 ring-panel" />
                ))}
              </span>
            )}
            <button type="button" onClick={() => onNavigate('wordlists')} className="focus-ring text-[13px] font-medium text-paper-dim hover:text-paper">
              Word lists →
            </button>
          </div>
        </div>
        <div
          className="flex h-[140px] flex-1 items-stretch gap-2"
          role="img"
          aria-label={`Word practice sessions per day: ${model.perDay.map((d) => d.count).join(', ')}`}
        >
          {model.perDay.map((d) => (
            <div key={d.date.toISOString()} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full flex-1 flex-col justify-end">
                <span className="mb-1 text-center text-[11px] font-medium tabular-nums text-mist">{d.count || ''}</span>
                <div
                  className={`w-full rounded-t-lg ${isSameDay(d.date, now) ? 'bg-vocab' : 'bg-vocab-tint'}`}
                  style={{ height: `${Math.max(3, (d.count / maxDay) * 85)}%` }}
                />
              </div>
              <span className="text-[11px] text-mist">{d.date.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}</span>
            </div>
          ))}
        </div>
      </Card>

      <ConfirmModal
        open={Boolean(confirmDialog)}
        {...confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const run = confirmDialog?.onConfirm
          setConfirmDialog(null)
          run?.()
        }}
      />
    </div>
  )
}
