import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { skillOfHomework, formatDue, isSameDay } from '../../lib/skills'
import { groupBadge, groupColour, groupDisplayName } from '../../lib/groupLook'
import { fetchAll } from '../../lib/fetchAll'
import SkillArt, { SkillIcon } from '../../components/SkillArt'

/*
 * TEACHER HOME — "Study room" design (2026-10-06), the teacher's
 * version of the student Home. Mavluda: "we need window like overview
 * for teachers dashboard as well … as visually attractive as students'".
 *
 * One screen answering "what needs me today?":
 *   - the next deadline: who has handed it in and who hasn't;
 *   - things waiting for the teacher (approvals, mock requests, mock
 *     results to release);
 *   - this week's homework across every group, with hand-in progress;
 *   - each group's hand-in rate for the last two weeks;
 *   - students who missed two or more recent deadlines;
 *   - the latest hand-ins and this week's word practice.
 * Everything links into the existing screens; nothing here edits data.
 *
 * "Handed in" = a submissions row with status 'done'; for deadlines that
 * have passed, a homework_completions row also counts (kept after a reset).
 */

const DAY = 86400000
const WINDOW_DAYS = 14

function useTeacherOverview() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const now = Date.now()
    const since = new Date(now - WINDOW_DAYS * DAY).toISOString()
    const weekAgo = new Date(now - 7 * DAY).toISOString()

    const load = async () => {
      try {
        const [groupsRes, membersRes, hwRes, accessRes, mockRes, writingRes, wordRes, reviewRes, feedRes] = await Promise.all([
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
          supabase.from('mock_access_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase
            .from('mock_attempts')
            .select('id', { count: 'exact', head: true })
            .not('submitted_at', 'is', null)
            .is('released_at', null),
          supabase
            .from('writing_mock_attempts')
            .select('id', { count: 'exact', head: true })
            .not('submitted_at', 'is', null)
            .is('released_at', null),
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
          // fetchAll (2026-10-06): the API caps a request at 1000 rows no
          // matter what .limit() says, so completion stats came out short.
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
        setData({
          groups: groupsRes.data || [],
          members: membersRes.data || [],
          homeworks,
          extraHomeworks,
          submissions,
          completions,
          feed,
          accessRequests: accessRes.count || 0,
          unreleased: (mockRes.count || 0) + (writingRes.count || 0),
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
  }, [])

  return { data, error }
}

function Card({ className = '', children }) {
  return <section className={`rounded-[22px] border border-line bg-panel ${className}`}>{children}</section>
}

function Arrow({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function GroupChip({ group, index, className = '' }) {
  const c = groupColour(index)
  const badge = groupBadge(group?.name)
  return (
    <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-1.5 text-[13px] font-semibold ${c.tint} ${c.text} ${className}`}>
      {badge}
    </span>
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

/* Progress ring: handed in / expected. */
function Ring({ done, total, colour = 'text-reading', size = 92 }) {
  const pct = total ? done / total : 0
  const r = 40
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0" aria-hidden="true">
      <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-panel-2" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 50 50)"
        className={colour}
      />
      <text x="50" y="49" textAnchor="middle" className="fill-paper" style={{ font: '600 22px var(--font-body)' }}>
        {done}
      </text>
      <text x="50" y="66" textAnchor="middle" className="fill-mist" style={{ font: '400 12px var(--font-body)' }}>
        of {total}
      </text>
    </svg>
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

export default function TeacherHome({ profile, pendingCount = 0, onNavigate, onOpenGroup, onOpenMockCenter }) {
  const { data, error } = useTeacherOverview()
  const now = useMemo(() => new Date(), [])
  const firstName = (profile?.full_name || '').trim().split(/\s+/)[0] || ''

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

    // Upcoming deadlines: the current hand-in (a reset means "do it again").
    // Past deadlines: also count a completion recorded before the reset.
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
    const past = hwWithGroup.filter((h) => h.due_date && new Date(h.due_date) < now && now - new Date(h.due_date) <= WINDOW_DAYS * DAY)

    const next = upcoming[0] || null
    const nextProgress = next ? progress(next) : null

    const weekEnd = new Date(now.getTime() + 7 * DAY)
    const thisWeek = upcoming.filter((h) => new Date(h.due_date) <= weekEnd && h !== next).slice(0, 4)
    // Fill with the most recent past deadlines when the week is quiet.
    if (thisWeek.length < 4) {
      const recentPast = [...past].sort((a, b) => new Date(b.due_date) - new Date(a.due_date))
      for (const h of recentPast) {
        if (thisWeek.length >= 4) break
        if (h !== next) thisWeek.push(h)
      }
    }

    const dueToday = upcoming.filter((h) => isSameDay(new Date(h.due_date), now)).length
    const handedInToday = data.submissions.filter((s) => s.submitted_at && isSameDay(new Date(s.submitted_at), now)).length

    // Per group: hand-in rate over deadlines in the last two weeks.
    const groupsRows = data.groups.map((g) => {
      const gPast = past.filter((h) => h.group_id === g.id)
      let expected = 0
      let done = 0
      for (const h of gPast) {
        const p = progress(h)
        expected += p.total
        done += p.done
      }
      const latest = hwWithGroup
        .filter((h) => h.group_id === g.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
      return {
        group: g,
        index: groupIndex[g.id],
        students: (membersByGroup[g.id] || []).length,
        rate: expected ? Math.round((done / expected) * 100) : null,
        deadlines: gPast.length,
        latest,
      }
    })

    // Students who missed 2+ deadlines in the window.
    const missedByStudent = {}
    for (const h of past) {
      for (const m of progress(h).missing) {
        const key = m.student_id
        missedByStudent[key] ||= { person: personById[key], groupId: m.group_id, count: 0, titles: [] }
        missedByStudent[key].count += 1
        missedByStudent[key].titles.push(h.title)
      }
    }
    const behind = Object.values(missedByStudent)
      .filter((r) => r.count >= 2 && r.person)
      .sort((a, b) => b.count - a.count || (a.person.full_name || '').localeCompare(b.person.full_name || ''))

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
      next,
      nextProgress,
      thisWeek: thisWeek.map((h) => ({ hw: h, p: progress(h) })),
      dueToday,
      handedInToday,
      groupsRows,
      behind,
      feed,
      perDay,
      activeLearners: Object.keys(practisers).length,
      topPractisers,
      totalStudents: new Set(data.members.map((m) => m.student_id)).size,
    }
  }, [data, now])

  if (error) {
    return (
      <Card className="p-8 text-center">
        <p className="text-lg font-semibold">Couldn’t load the overview</p>
        <p className="mt-1 text-sm text-mist">{error}</p>
        <button
          type="button"
          onClick={() => onNavigate('groups')}
          className="focus-ring mt-4 inline-flex h-11 items-center rounded-xl bg-brass px-5 text-sm font-medium text-onbrass hover:bg-brass-dim"
        >
          Open Groups & Homework
        </button>
      </Card>
    )
  }

  if (!model) {
    return (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" aria-busy="true">
        {['lg:col-span-8 h-[300px]', 'lg:col-span-4 h-[300px]', 'lg:col-span-12 h-[220px]', 'lg:col-span-7 h-[280px]', 'lg:col-span-5 h-[280px]'].map((c) => (
          <div key={c} className={`${c} animate-pulse rounded-[22px] border border-line bg-panel`} />
        ))}
      </div>
    )
  }

  const { next, nextProgress } = model
  const nextSkill = next ? skillOfHomework(next) : null
  const nextGroup = next ? model.groupById[next.group_id] : null

  const waiting = [
    pendingCount > 0 && {
      key: 'approvals',
      count: pendingCount,
      label: pendingCount === 1 ? 'new student to approve' : 'new students to approve',
      action: () => onNavigate('approvals'),
      tone: 'bg-speaking-tint text-speaking',
    },
    model.behind.length > 0 && {
      key: 'behind',
      count: model.behind.length,
      label: model.behind.length === 1 ? 'student missed 2+ deadlines' : 'students missed 2+ deadlines',
      action: () => document.getElementById('teacher-home-behind')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      tone: 'bg-urgent-tint text-urgent',
    },
    data.accessRequests > 0 && {
      key: 'access',
      count: data.accessRequests,
      label: data.accessRequests === 1 ? 'mock access request' : 'mock access requests',
      action: onOpenMockCenter,
      tone: 'bg-listening-tint text-listening',
    },
    data.unreleased > 0 && {
      key: 'release',
      count: data.unreleased,
      label: data.unreleased === 1 ? 'mock result to release' : 'mock results to release',
      action: onOpenMockCenter,
      tone: 'bg-writing-tint text-writing',
    },
  ].filter(Boolean)

  const maxDay = Math.max(1, ...model.perDay.map((d) => d.count))

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* GREETING */}
      <div className="lg:col-span-12 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">
            {greeting(now)}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-[15px] text-paper-dim">
            {model.dueToday > 0
              ? `${model.dueToday} ${model.dueToday === 1 ? 'deadline' : 'deadlines'} today`
              : 'No deadlines today'}
            {' · '}
            {model.handedInToday} {model.handedInToday === 1 ? 'hand-in' : 'hand-ins'} so far today
            {' · '}
            {model.totalStudents} students in {data.groups.length} {data.groups.length === 1 ? 'group' : 'groups'}
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

      {/* NEXT DEADLINE */}
      <Card className="lg:col-span-8 overflow-hidden grid grid-cols-1 md:grid-cols-[1.3fr_1fr]">
        {next ? (
          <>
            <div className="flex flex-col gap-4 p-6 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <GroupChip group={nextGroup} index={model.groupIndex[next.group_id]} />
                <span className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium ${nextSkill.tint} ${nextSkill.text}`}>
                  <SkillIcon skill={nextSkill.key} className="h-3.5 w-3.5" />
                  {nextSkill.label}
                </span>
                <span
                  className={`inline-flex h-7 items-center rounded-lg px-2.5 text-[13px] font-medium ${
                    isSameDay(new Date(next.due_date), now) ? 'bg-urgent-tint text-urgent' : 'bg-panel-2 text-paper'
                  }`}
                >
                  Due {formatDue(next.due_date, now).replace(/^Today/, 'today').replace(/^Tomorrow/, 'tomorrow')}
                </span>
              </div>
              <div>
                <p className="text-[13px] font-medium text-mist">Next deadline · {groupDisplayName(nextGroup?.name)}</p>
                <h2 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{next.title}</h2>
              </div>
              <div className="flex items-center gap-5">
                <Ring done={nextProgress.done} total={nextProgress.total} colour={nextSkill.key === 'general' ? 'text-paper' : nextSkill.text} />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">
                    {nextProgress.total === 0
                      ? 'No students in this group yet'
                      : nextProgress.missing.length === 0
                        ? 'Everyone has handed it in'
                        : `${nextProgress.missing.length} still to hand in`}
                  </p>
                  {nextProgress.missing.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {nextProgress.missing.slice(0, 6).map((m) => (
                        <span key={m.student_id} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-panel-2 pl-1 pr-2.5 text-[13px]">
                          <Avatar person={m.profiles} size="h-6 w-6" />
                          <span className="max-w-[9rem] truncate">{(m.profiles?.full_name || m.profiles?.username || '').split(' ')[0]}</span>
                        </span>
                      ))}
                      {nextProgress.missing.length > 6 && (
                        <span className="text-[13px] text-mist">+{nextProgress.missing.length - 6} more</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-auto flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => onOpenGroup(next.group_id)}
                  className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-brass px-5 text-[15px] font-medium text-onbrass hover:bg-brass-dim"
                >
                  Open {groupDisplayName(nextGroup?.name)}
                  <Arrow />
                </button>
              </div>
            </div>
            <div className={`order-first flex items-center justify-center p-4 md:order-none md:p-6 ${nextSkill.tint}`}>
              <SkillArt skill={nextSkill.key} title={next.title} className="h-[150px] w-full max-w-[300px] md:h-auto" />
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col justify-center gap-3 p-7">
              <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">No deadlines coming up</h2>
              <p className="text-[15px] leading-relaxed text-paper-dim">
                Every group is clear. Post the next homework when you’re ready.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('groups')}
                className="focus-ring mt-1 inline-flex h-11 w-fit items-center gap-2 rounded-xl bg-brass px-5 text-[15px] font-medium text-onbrass hover:bg-brass-dim"
              >
                Post homework <Arrow />
              </button>
            </div>
            <div className="flex items-center justify-center bg-writing-tint p-6">
              <SkillArt skill="writing" className="h-auto w-full max-w-[280px]" />
            </div>
          </>
        )}
      </Card>

      {/* WAITING FOR YOU */}
      <Card className="lg:col-span-4 flex flex-col gap-4 p-6">
        <h2 className="text-[17px] font-semibold">Waiting for you</h2>
        {waiting.length ? (
          <ul className="flex flex-col gap-2">
            {waiting.map((w) => (
              <li key={w.key}>
                <button
                  type="button"
                  onClick={w.action}
                  className="focus-ring flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-panel-2"
                >
                  <span className={`flex h-10 min-w-10 items-center justify-center rounded-[11px] px-2 text-[17px] font-semibold tabular-nums ${w.tone}`}>
                    {w.count}
                  </span>
                  <span className="flex-1 text-[15px] leading-snug">{w.label}</span>
                  <Arrow className="h-4 w-4 text-mist" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-reading-tint px-4 py-6 text-center">
            <svg viewBox="0 0 64 64" className="h-14 w-14 text-reading" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="32" cy="32" r="24" />
              <path d="M21 33l7 7 15-16" />
            </svg>
            <p className="text-[15px] font-medium text-reading">All clear. Nothing is waiting for you.</p>
          </div>
        )}
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-line pt-4">
          <button type="button" onClick={onOpenMockCenter} className="focus-ring flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-line/60">
            <SkillIcon skill="listening" className="h-4 w-4 text-listening" />
            Mock Center
          </button>
          <button type="button" onClick={() => onNavigate('students')} className="focus-ring flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-line/60">
            <svg className="h-4 w-4 text-speaking" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M17.5 14.2A5 5 0 0 1 20.5 19" /></svg>
            Students
          </button>
        </div>
      </Card>

      {/* THIS WEEK */}
      {model.thisWeek.length > 0 && (
        <>
          <div className="lg:col-span-12 mt-1 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">This week’s homework</h2>
            <button type="button" onClick={() => onNavigate('groups')} className="focus-ring text-sm font-medium text-paper-dim hover:text-paper">
              All groups
            </button>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-4">
            {model.thisWeek.map(({ hw, p }) => {
              const skill = skillOfHomework(hw)
              const g = model.groupById[hw.group_id]
              const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
              const passed = new Date(hw.due_date) < now
              return (
                <button
                  key={hw.id}
                  type="button"
                  onClick={() => onOpenGroup(hw.group_id)}
                  className="focus-ring flex flex-col overflow-hidden rounded-[20px] border border-line bg-panel text-left transition-colors hover:border-paper/30"
                >
                  <div className={`relative flex h-[112px] items-center justify-center ${skill.tint}`}>
                    <SkillArt skill={skill.key} title={hw.title} className="h-[92px] w-[210px]" />
                    <GroupChip group={g} index={model.groupIndex[hw.group_id]} className="absolute left-3 top-3 bg-panel" />
                  </div>
                  <div className="flex flex-1 flex-col gap-2 px-[18px] pb-[18px] pt-4">
                    <span className={`text-xs font-semibold ${skill.text}`}>{skill.label}</span>
                    <span className="line-clamp-2 text-base font-medium leading-snug">{hw.title}</span>
                    <div className="mt-auto flex flex-col gap-1.5 pt-1.5">
                      <div className="flex items-baseline justify-between text-[13px]">
                        <span className={passed ? 'text-mist' : 'text-paper-dim'}>
                          {passed ? 'Closed' : 'Due'} {formatDue(hw.due_date, now)}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {p.done}/{p.total}
                        </span>
                      </div>
                      <div className="h-1.5 rounded bg-panel-2">
                        <div className={`h-full rounded ${skill.key === 'general' ? 'bg-paper' : skill.bg}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* GROUPS */}
      <Card className="lg:col-span-7 flex flex-col gap-4 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-semibold">Your groups</h2>
          <span className="text-[13px] text-mist">Handed in on time or late, last {WINDOW_DAYS} days</span>
        </div>
        <ul className="flex flex-col">
          {model.groupsRows.map((row) => {
            const c = groupColour(row.index)
            const latestSkill = row.latest ? skillOfHomework(row.latest) : null
            return (
              <li key={row.group.id} className="border-t border-line first:border-0">
                <button
                  type="button"
                  onClick={() => onOpenGroup(row.group.id)}
                  className="focus-ring grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-xl px-1.5 py-3 text-left hover:bg-panel-2 sm:grid-cols-[44px_minmax(0,1fr)_minmax(120px,32%)_auto]"
                >
                  <span className={`flex h-11 w-11 items-center justify-center rounded-[13px] text-[15px] font-semibold ${c.tint} ${c.text}`}>
                    {groupBadge(row.group.name)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[15px] font-medium">{groupDisplayName(row.group.name)}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-mist">
                      {row.students} students
                      {row.latest && (
                        <>
                          <span aria-hidden>·</span>
                          <SkillIcon skill={latestSkill.key} className={`h-3.5 w-3.5 shrink-0 ${latestSkill.key === 'general' ? '' : latestSkill.text}`} />
                          <span className="truncate">{row.latest.title}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="hidden flex-col gap-1 sm:flex">
                    <span className="h-2 rounded bg-panel-2">
                      {row.rate != null && <span className={`block h-full rounded ${c.bar}`} style={{ width: `${Math.max(3, row.rate)}%` }} />}
                    </span>
                  </span>
                  <span className="w-12 text-right text-[15px] font-semibold tabular-nums">{row.rate != null ? `${row.rate}%` : '–'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </Card>

      {/* FALLING BEHIND */}
      <Card className="lg:col-span-5 flex flex-col gap-4 p-6">
        <div id="teacher-home-behind" className="flex scroll-mt-24 items-baseline justify-between">
          <h2 className="text-[17px] font-semibold">Missed 2+ deadlines</h2>
          <span className="text-[13px] text-mist">Last {WINDOW_DAYS} days</span>
        </div>
        {model.behind.length ? (
          <ul className="flex max-h-[360px] flex-col gap-1 overflow-y-auto pr-1">
            {model.behind.slice(0, 20).map((r) => (
              <li key={r.person.id}>
                <button
                  type="button"
                  onClick={() => onOpenGroup(r.groupId)}
                  title={r.titles.join('\n')}
                  className="focus-ring flex w-full items-center gap-3 rounded-xl px-1.5 py-2 text-left hover:bg-panel-2"
                >
                  <Avatar person={r.person} size="h-9 w-9" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px]">{r.person.full_name || r.person.username}</span>
                    <span className="truncate text-[13px] text-mist">{groupDisplayName(model.groupById[r.groupId]?.name)}</span>
                  </span>
                  <span className="rounded-lg bg-urgent-tint px-2.5 py-1 text-[13px] font-semibold text-urgent tabular-nums">
                    {r.count} missed
                  </span>
                </button>
              </li>
            ))}
            {model.behind.length > 20 && <li className="px-1.5 pt-1 text-[13px] text-mist">+{model.behind.length - 20} more</li>}
          </ul>
        ) : (
          <p className="rounded-2xl bg-reading-tint px-4 py-6 text-center text-[15px] font-medium text-reading">
            Nobody has missed two deadlines. Nice.
          </p>
        )}
      </Card>

      {/* LATEST HAND-INS */}
      <Card className="lg:col-span-7 flex flex-col gap-4 p-6">
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
      <Card className="lg:col-span-5 flex flex-col gap-4 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-semibold">Word practice this week</h2>
          <button type="button" onClick={() => onNavigate('wordlists')} className="focus-ring text-[13px] font-medium text-paper-dim hover:text-paper">
            Word lists
          </button>
        </div>
        <div
          className="flex h-[200px] items-stretch gap-2"
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
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-sm text-paper-dim">
            <strong className="font-semibold text-paper">{model.activeLearners}</strong> of {model.totalStudents} students practised
          </span>
          {model.topPractisers.length > 0 && (
            <span className="flex -space-x-2" title={`Most active: ${model.topPractisers.map((t) => t.person.full_name).join(', ')}`}>
              {model.topPractisers.map((t) => (
                <Avatar key={t.person.id} person={t.person} size="h-8 w-8" className="ring-2 ring-panel" />
              ))}
            </span>
          )}
        </div>
      </Card>
    </div>
  )
}
