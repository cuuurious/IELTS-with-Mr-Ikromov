import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { roundOverallBand, formatBand } from '../../lib/ieltsBands'
import {
  SKILLS,
  skillOfHomework,
  homeworkState,
  formatDue,
  STATE_PILL,
} from '../../lib/skills'
import SkillArt, { SkillIcon, VocabArt } from '../../components/SkillArt'
import TargetBandModal from '../../components/TargetBandModal'
import { LearningCurve, PracticeTime, WordOfTheDay, useStudyActivity } from './HomeExtras'
import { firstNameOf } from '../../lib/names'

/*
 * STUDENT HOME — "Study room" design (approved 2026-10-05).
 *
 * The first thing a student sees: tonight's task with Mr Ikromov's
 * note, the four skill bands against their target, this week's work
 * as picture cards, words to revise, his latest marking and a door
 * into the leaderboard. Everything here is a shortcut — the full
 * Homework, Word Lists, Mock Center and Leaderboard screens are all
 * still where they were.
 *
 * 2026-10-14 (Jasur: "we have to do the same with students dashboard"):
 * a greeting with a one-line summary, an overdue strip so missed work
 * isn't hidden, the student's own mock status (code ready / request
 * waiting / unfinished sitting) and a real hand-in record in place of
 * the decorative leaderboard card.
 *
 * Homework + submissions come from StudentDashboard (same data the
 * Homework tab already loads for the selected group). Bands, words
 * due and the latest marked work are loaded here.
 */

const TEACHER_PHOTO = '/mrikromov.jpg'

function useReleasedBands(studentId) {
  const [bands, setBands] = useState(null)

  useEffect(() => {
    if (!studentId) return
    let cancelled = false

    Promise.all([
      supabase
        .from('mock_attempts')
        .select('band, score, max_score, released_at, mock_exams(module)')
        .eq('user_id', studentId)
        .not('released_at', 'is', null)
        .order('released_at', { ascending: false })
        .limit(20),
      supabase
        .from('writing_mock_attempts')
        .select('examiner_band, released_at')
        .eq('student_id', studentId)
        .not('released_at', 'is', null)
        .not('examiner_band', 'is', null)
        .order('released_at', { ascending: false })
        .limit(1),
      supabase
        .from('mock_speaking_slots')
        .select('examiner_band, released_at')
        .eq('student_id', studentId)
        .not('released_at', 'is', null)
        .not('examiner_band', 'is', null)
        .order('released_at', { ascending: false })
        .limit(1),
    ])
      .then(([objective, writing, speaking]) => {
        if (cancelled) return
        const latest = { listening: null, reading: null, writing: null, speaking: null }
        let lastDate = null
        for (const row of objective.data || []) {
          const module = row.mock_exams?.module
          if (module && latest[module] == null && row.band != null) {
            latest[module] = Number(row.band)
            lastDate = lastDate || row.released_at
          }
        }
        const w = writing.data?.[0]
        if (w) latest.writing = Number(w.examiner_band)
        const s = speaking.data?.[0]
        if (s) latest.speaking = Number(s.examiner_band)
        const values = Object.values(latest).filter((b) => b != null)
        const overall =
          values.length === 4
            ? roundOverallBand(values.reduce((a, b) => a + b, 0) / 4)
            : null
        setBands({ ...latest, overall, releasedAt: lastDate || w?.released_at || s?.released_at || null })
      })
      .catch(() => {
        if (!cancelled) setBands({ listening: null, reading: null, writing: null, speaking: null, overall: null })
      })

    return () => {
      cancelled = true
    }
  }, [studentId])

  return bands
}

function useWordsDue(studentId) {
  const [state, setState] = useState({ due: null, streak: 0 })

  useEffect(() => {
    if (!studentId) return
    let cancelled = false
    const since = new Date(Date.now() - 60 * 86400000).toISOString()
    const day = (value) => {
      const d = new Date(value)
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    }
    Promise.all([
      supabase
        .from('word_progress')
        .select('item_id', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .lte('due_at', new Date().toISOString()),
      supabase.from('wordlist_attempts').select('created_at').eq('student_id', studentId).gte('created_at', since),
      supabase.from('word_review_sessions').select('created_at').eq('student_id', studentId).gte('created_at', since),
    ])
      .then(([dueRes, attempts, reviews]) => {
        if (cancelled) return
        const days = new Set([...(attempts.data || []), ...(reviews.data || [])].map((r) => day(r.created_at)))
        let streak = 0
        const cursor = new Date()
        if (!days.has(day(cursor))) cursor.setDate(cursor.getDate() - 1)
        while (days.has(day(cursor))) {
          streak += 1
          cursor.setDate(cursor.getDate() - 1)
        }
        setState({ due: dueRes.count ?? 0, streak })
      })
      .catch(() => {
        if (!cancelled) setState({ due: 0, streak: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  return state
}

function useLatestFeedback(studentId) {
  const [item, setItem] = useState(undefined)

  useEffect(() => {
    if (!studentId) return
    let cancelled = false
    supabase
      .from('submissions')
      .select('id, homework_id, examiner_band, examiner_feedback, examiner_reviewed_at, homeworks(id, title, description, homework_type, enable_speaking)')
      .eq('student_id', studentId)
      .not('examiner_feedback', 'is', null)
      .order('examiner_reviewed_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setItem(data?.[0] || null)
      })
      .catch(() => {
        if (!cancelled) setItem(null)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  return item
}

function useMockStatus(studentId) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!studentId) return
    let cancelled = false
    Promise.all([
      supabase.from('full_mock_attempts').select('id, stage, updated_at').eq('student_id', studentId).neq('stage', 'done').limit(1),
      supabase.from('mock_access_codes').select('id').eq('student_id', studentId).is('used_at', null).eq('revoked', false).limit(1),
      supabase
        .from('mock_access_requests')
        .select('id, requested_at')
        .eq('student_id', studentId)
        .eq('status', 'pending')
        .order('requested_at', { ascending: false })
        .limit(1),
    ])
      .then(([open, codes, requests]) => {
        if (cancelled) return
        if (codes.data?.length) setStatus({ kind: 'code' })
        else if (open.data?.length) setStatus({ kind: 'unfinished' })
        else if (requests.data?.length) setStatus({ kind: 'pending', at: requests.data[0].requested_at })
        else setStatus({ kind: 'none' })
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: 'none' })
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  return status
}

const MOCK_STATUS = {
  code: { title: 'Your mock code is ready', body: 'Start whenever you have three quiet hours.', action: 'Start mock', tone: 'bg-reading-tint text-reading' },
  unfinished: { title: 'You have an unfinished mock', body: 'Pick it up where you left off.', action: 'Continue', tone: 'bg-listening-tint text-listening' },
  pending: { title: 'Mock requested', body: 'Waiting for Mr Ikromov to send your code.', action: 'View', tone: 'bg-panel-2 text-paper' },
  none: { title: 'Ready for a full mock?', body: 'Ask for one from the Mock Test Center.', action: 'Ask for a mock', tone: 'bg-panel-2 text-paper' },
}

function greetingFor(now) {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function Pill({ state, className = '' }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium ${STATE_PILL[state.key] || STATE_PILL.todo} ${className}`}>
      {state.label}
    </span>
  )
}

function Card({ className = '', children, ...rest }) {
  return (
    <section className={`rounded-[22px] border border-line bg-panel ${className}`} {...rest}>
      {children}
    </section>
  )
}

export default function StudentHome({
  profile,
  groups,
  activeGroup,
  onSelectGroup,
  homeworks,
  submissions,
  onOpenHomework,
  onNavigate,
  onOpenMockCenter,
}) {
  const bands = useReleasedBands(profile?.id)
  const [targetOpen, setTargetOpen] = useState(false)
  const words = useWordsDue(profile?.id)
  const feedback = useLatestFeedback(profile?.id)
  const activity = useStudyActivity(profile?.id)
  const mock = useMockStatus(profile?.id)

  const now = useMemo(() => new Date(), [])
  const group = groups.find((g) => g.id === activeGroup)
  const target = profile?.target_band != null ? Number(profile.target_band) : null

  const items = useMemo(
    () =>
      (homeworks || []).map((hw) => {
        const sub = submissions?.[hw.id]
        return { hw, sub, skill: skillOfHomework(hw), state: homeworkState(hw, sub, now) }
      }),
    [homeworks, submissions, now]
  )

  const open = items.filter((i) => ['today', 'todo', 'overdue'].includes(i.state.key))
  const upcoming = open
    .filter((i) => i.state.key !== 'overdue')
    .sort((a, b) => new Date(a.hw.due_date || 8.64e15) - new Date(b.hw.due_date || 8.64e15))
  // Missed work has its own strip now (2026-10-14), so the big card
  // is always the next thing still to come.
  const hero = upcoming[0] || null

  const rest = [
    ...upcoming.filter((i) => i !== hero),
    ...items.filter((i) => ['sent', 'late', 'marked'].includes(i.state.key)),
  ].slice(0, 4)

  const skillRows = ['listening', 'reading', 'writing', 'speaking'].map((key) => ({
    skill: SKILLS[key],
    band: bands ? bands[key] : null,
  }))

  const overdue = open
    .filter((i) => i.state.key === 'overdue')
    .sort((a, b) => new Date(b.hw.due_date) - new Date(a.hw.due_date))
  const weekEnd = new Date(now.getTime() + 7 * 86400000)
  const dueThisWeek = upcoming.filter((i) => !i.hw.due_date || new Date(i.hw.due_date) <= weekEnd).length
  const firstName = firstNameOf(profile?.full_name)

  // Hand-in record: deadlines that closed in the last 30 days.
  const record = items
    .filter((i) => i.hw.due_date && new Date(i.hw.due_date) < now && now - new Date(i.hw.due_date) <= 30 * 86400000)
    .reduce(
      (acc, i) => {
        if (i.state.key === 'overdue') acc.missed += 1
        else if (i.state.key === 'late') acc.late += 1
        else acc.onTime += 1
        return acc
      },
      { onTime: 0, late: 0, missed: 0 }
    )
  const recordTotal = record.onTime + record.late + record.missed
  const recordPct = recordTotal ? Math.round(((record.onTime + record.late) / recordTotal) * 100) : null
  const mockMeta = mock ? MOCK_STATUS[mock.kind] : null

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* GREETING + SUMMARY */}
      <div className="lg:col-span-12 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">
            {greetingFor(now)}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-[15px] text-paper-dim">
            {group
              ? [
                  dueThisWeek ? `${dueThisWeek} to do this week` : 'Nothing due this week',
                  overdue.length ? `${overdue.length} missed` : null,
                  words.streak > 1 ? `${words.streak}-day word streak` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'You’re not in a group yet'}
          </p>
        </div>
        {groups.length > 1 && (
          <div role="group" aria-label="Group" className="flex max-w-full overflow-x-auto rounded-xl border border-line bg-panel p-1">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onSelectGroup(g.id)}
                className={`focus-ring h-9 shrink-0 rounded-[9px] px-3.5 text-sm transition-colors ${
                  g.id === activeGroup ? 'bg-brass text-onbrass font-medium' : 'text-paper-dim hover:text-paper'
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* MISSED WORK — can still be handed in late */}
      {overdue.length > 0 && (
        <div className="lg:col-span-12 flex flex-col gap-3 rounded-[22px] border border-urgent/30 bg-urgent-tint px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-panel text-urgent">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-urgent">
                {overdue.length === 1 ? '1 homework missed its deadline' : `${overdue.length} homeworks missed their deadline`}
              </p>
              <p className="truncate text-sm text-paper-dim">
                You can still hand {overdue.length === 1 ? 'it' : 'them'} in late: {overdue.map((i) => i.hw.title).join(', ')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenHomework(overdue[0].hw.id)}
            className="focus-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-panel px-4 text-sm font-semibold text-paper hover:bg-panel-2"
          >
            {overdue.length === 1 ? 'Do it now' : 'Start with the latest'}
          </button>
        </div>
      )}

      {/* TODAY */}
      <Card className="lg:col-span-8 overflow-hidden grid grid-cols-1 md:grid-cols-[1.25fr_1fr]">
        {hero ? (
          <>
            <div className="flex flex-col gap-3.5 p-6 sm:p-7">
              <div className="flex flex-wrap gap-2">
                <span className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium ${hero.skill.tint} ${hero.skill.text}`}>
                  <SkillIcon skill={hero.skill.key} className="h-3.5 w-3.5" />
                  {hero.skill.key === 'general' ? 'Homework' : hero.skill.label}
                </span>
                <span className={`inline-flex h-7 items-center rounded-lg px-2.5 text-[13px] font-medium ${STATE_PILL[hero.state.key]}`}>
                  {hero.state.key === 'overdue' ? 'Deadline passed' : `Due ${formatDue(hero.hw.due_date, now).replace(/^Today/, 'today').replace(/^Tomorrow/, 'tomorrow')}`}
                </span>
              </div>
              <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{hero.hw.title}</h2>
              {hero.hw.description && (
                <p className="line-clamp-3 text-[15px] leading-relaxed text-paper-dim">{hero.hw.description}</p>
              )}
              <div className="flex items-center gap-2.5 rounded-xl bg-panel-2 px-3 py-2.5">
                <img src={TEACHER_PHOTO} alt="" className="h-8 w-8 rounded-full object-cover" />
                <span className="text-sm text-paper-dim">
                  <span className="font-semibold text-paper">Mr Ikromov</span> posted this{' '}
                  {new Date(hero.hw.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  {group ? ` for ${group.name}` : ''}.
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => onOpenHomework(hero.hw.id)}
                  className="focus-ring inline-flex h-12 items-center gap-2 rounded-xl bg-brass px-5 text-[15px] font-medium text-onbrass hover:bg-brass-dim"
                >
                  {hero.skill.key === 'writing' ? 'Start writing' : hero.skill.key === 'speaking' ? 'Start recording' : 'Open homework'}
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('homework')}
                  className="focus-ring inline-flex h-12 items-center rounded-xl border border-line px-4 text-[15px] font-medium hover:bg-panel-2"
                >
                  All homework
                </button>
              </div>
            </div>
            <div className={`order-first flex items-center justify-center p-4 md:order-none md:p-6 ${hero.skill.tint}`}>
              <SkillArt skill={hero.skill.key} title={hero.hw.title} className="h-[150px] w-full max-w-[300px] md:h-auto" />
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col justify-center gap-3 p-7">
              <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">
                {!group ? 'You’re not in a group yet' : open.some((i) => i.state.key === 'overdue') ? 'No new homework right now' : 'You’re up to date'}
              </h2>
              <p className="text-[15px] leading-relaxed text-paper-dim">
                {group
                  ? open.some((i) => i.state.key === 'overdue')
                    ? 'A good moment to catch up on the missed work above.'
                    : 'Nothing is waiting for you right now. Revise some words or look back at your marked work.'
                  : 'Ask Mr Ikromov to add you to a group, and your homework will appear here.'}
              </p>
              {group && (
                <button
                  type="button"
                  onClick={() => (overdue.length ? onOpenHomework(overdue[0].hw.id) : onNavigate('wordlists'))}
                  className="focus-ring mt-1 inline-flex h-12 w-fit items-center rounded-xl bg-brass px-5 text-[15px] font-medium text-onbrass hover:bg-brass-dim"
                >
                  {overdue.length ? 'Catch up now' : 'Revise words'}
                </button>
              )}
            </div>
            <div className="flex items-center justify-center bg-reading-tint p-6">
              <SkillArt skill="reading" className="h-auto w-full max-w-[280px]" />
            </div>
          </>
        )}
      </Card>

      {/* BANDS */}
      <Card className="lg:col-span-4 flex flex-col gap-4 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-semibold">Your bands</h2>
          <button
            type="button"
            onClick={() => setTargetOpen(true)}
            className="focus-ring rounded-lg px-1.5 py-0.5 text-[13px] text-mist hover:bg-panel-2 hover:text-paper"
            title="Change your target band"
          >
            {target != null ? (
              <>Target <strong className="font-semibold text-paper">{formatBand(target)}</strong></>
            ) : (
              'Set your target'
            )}
          </button>
        </div>
        <ul className="flex flex-col gap-3.5">
          {skillRows.map(({ skill, band }) => (
            <li key={skill.key} className="grid grid-cols-[34px_minmax(0,1fr)_40px] items-center gap-3">
              <span className={`flex h-[34px] w-[34px] items-center justify-center rounded-[10px] ${skill.tint} ${skill.text}`}>
                <SkillIcon skill={skill.key} className="h-[17px] w-[17px]" />
              </span>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm">{skill.label}</span>
                <div className="relative h-2 rounded bg-panel-2">
                  {band != null && (
                    <div className={`absolute inset-y-0 left-0 rounded ${skill.bg}`} style={{ width: `${Math.max(4, Math.min(100, ((band - 4) / 5) * 100))}%` }} />
                  )}
                  {target != null && (
                    <div className="absolute -top-[3px] h-3.5 w-0.5 rounded bg-paper" style={{ left: `${Math.max(0, Math.min(100, ((target - 4) / 5) * 100))}%` }} />
                  )}
                </div>
              </div>
              <span className="text-right text-lg font-semibold tabular-nums">{band != null ? formatBand(band) : '–'}</span>
            </li>
          ))}
        </ul>
        {mockMeta && (
          <button
            type="button"
            onClick={onOpenMockCenter}
            className={`focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ${mockMeta.tone}`}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold">{mockMeta.title}</span>
              <span className="text-[12px] opacity-80">{mockMeta.body}</span>
            </span>
            <span className="shrink-0 text-[13px] font-semibold underline-offset-2 hover:underline">{mockMeta.action} →</span>
          </button>
        )}
        <div className="mt-auto flex items-center justify-between border-t border-line pt-3.5">
          <button type="button" onClick={onOpenMockCenter} className="focus-ring text-[13px] text-mist hover:text-paper">
            {bands?.overall != null
              ? `Overall from your ${bands.releasedAt ? new Date(bands.releasedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'latest'} mock`
              : 'Bands appear after your first mock'}
          </button>
          <span className="text-[26px] font-semibold tracking-[-0.02em]">{bands?.overall != null ? formatBand(bands.overall) : '–'}</span>
        </div>
      </Card>

      {/* THIS WEEK */}
      {rest.length > 0 && (
        <>
          <div className="lg:col-span-12 mt-1 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">{rest.some((i) => ['today', 'todo'].includes(i.state.key)) ? 'Next up' : 'Recently handed in'}</h2>
            <button type="button" onClick={() => onNavigate('homework')} className="focus-ring text-sm font-medium text-paper-dim hover:text-paper">
              All homework
            </button>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-4">
          {rest.map(({ hw, skill, state }) => (
            <button
              key={hw.id}
              type="button"
              onClick={() => onOpenHomework(hw.id)}
              className="focus-ring group flex flex-col overflow-hidden rounded-[20px] border border-line bg-panel text-left transition-colors hover:border-paper/30"
            >
              <div className={`flex h-[118px] items-center justify-center ${skill.tint}`}>
                <SkillArt skill={skill.key} title={hw.title} className="h-[96px] w-[220px]" />
              </div>
              <div className="flex flex-1 flex-col gap-2 px-[18px] pb-[18px] pt-4">
                <span className={`text-xs font-semibold ${skill.text}`}>{skill.key === 'general' ? 'Homework' : skill.label}</span>
                <span className="text-base font-medium leading-snug text-paper line-clamp-2">{hw.title}</span>
                <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
                  <span className="text-[13px] text-mist">
                    {['sent', 'late', 'marked'].includes(state.key)
                      ? 'Sent'
                      : hw.due_date
                        ? `Due ${formatDue(hw.due_date, now)}`
                        : 'No deadline'}
                  </span>
                  <Pill state={state} />
                </div>
              </div>
            </button>
          ))}
          </div>
        </>
      )}

      {/* WORDS */}
      <Card className="lg:col-span-4 flex items-center gap-5 p-6">
        <div className="relative h-[110px] w-[140px] shrink-0 rounded-2xl bg-vocab-tint">
          <VocabArt front="sustainable" back="barqaror" className="absolute inset-0 h-full w-full" />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-[17px] font-semibold">
            {words.due == null ? 'Word review' : words.due === 0 ? 'No words due today' : `${words.due} ${words.due === 1 ? 'word' : 'words'} to revise`}
          </h2>
          <p className="text-sm text-mist">
            {words.streak > 0 ? `${words.streak}-day streak. Keep it going.` : 'A few minutes a day keeps words in your memory.'}
          </p>
          <button
            type="button"
            onClick={() => onNavigate('wordlists')}
            className="focus-ring mt-1 inline-flex h-10 w-fit items-center rounded-[11px] bg-vocab-tint px-4 text-sm font-semibold text-vocab hover:brightness-95"
          >
            {words.due ? 'Start review' : 'Open word lists'}
          </button>
        </div>
      </Card>

      {/* LATEST MARKING */}
      <Card className="lg:col-span-5 flex flex-col gap-3.5 p-6">
        <div className="flex items-center gap-3">
          <img src={TEACHER_PHOTO} alt="" className="h-10 w-10 rounded-full object-cover" />
          <div className="flex min-w-0 flex-col leading-snug">
            <h2 className="text-[15px] font-semibold">
              {feedback ? 'Mr Ikromov marked your work' : 'Mr Ikromov’s feedback'}
            </h2>
            <span className="truncate text-[13px] text-mist">
              {feedback
                ? `${feedback.homeworks?.title || 'Homework'}${feedback.examiner_band != null ? `, band ${formatBand(Number(feedback.examiner_band))}` : ''}`
                : 'Feedback on your homework will appear here.'}
            </span>
          </div>
        </div>
        {feedback && (
          <>
            <div className="flex items-start gap-2.5 rounded-xl bg-panel-2 px-3.5 py-3">
              <svg className="mt-0.5 h-[18px] w-[18px] shrink-0 text-writing" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
              <p className="line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-paper-dim">{feedback.examiner_feedback}</p>
            </div>
            <button
              type="button"
              onClick={() => onOpenHomework(feedback.homework_id)}
              className="focus-ring w-fit text-sm font-medium text-paper hover:underline"
            >
              See the full feedback
            </button>
          </>
        )}
      </Card>

      {/* HAND-IN RECORD + LEADERBOARD (2026-10-14: real numbers instead of
          the decorative bars) */}
      <Card className="lg:col-span-3 flex flex-col gap-3 p-6">
        <h2 className="text-[15px] font-semibold">Your hand-in record</h2>
        {recordTotal ? (
          <>
            <p className="text-[32px] font-semibold leading-none tracking-[-0.02em]">
              {recordPct}%
              <span className="ml-1.5 text-[13px] font-normal tracking-normal text-mist">handed in</span>
            </p>
            <div className="flex h-2 overflow-hidden rounded bg-panel-2" aria-hidden="true">
              <span className="bg-reading" style={{ width: `${(record.onTime / recordTotal) * 100}%` }} />
              <span className="bg-writing" style={{ width: `${(record.late / recordTotal) * 100}%` }} />
              <span className="bg-urgent" style={{ width: `${(record.missed / recordTotal) * 100}%` }} />
            </div>
            <p className="text-[13px] text-mist">
              Last 30 days: {record.onTime} on time · {record.late} late · {record.missed} missed
            </p>
          </>
        ) : (
          <p className="text-[13px] text-mist">Your record starts after your first deadline.</p>
        )}
        <button
          type="button"
          onClick={() => onNavigate('leaderboard')}
          className="focus-ring mt-auto inline-flex h-10 w-fit items-center rounded-[11px] border border-line px-4 text-sm font-medium hover:bg-panel-2"
        >
          {group ? `${group.name} leaderboard` : 'Leaderboard'}
        </button>
      </Card>
      {/* LEARNING CURVE · WHEN YOU STUDY · WORD OF THE DAY (2026-10-06) */}
      <LearningCurve activity={activity} onNavigate={onNavigate} className="lg:col-span-5" />
      <PracticeTime activity={activity} className="lg:col-span-3" />
      <WordOfTheDay onNavigate={onNavigate} className="lg:col-span-4" />
      {targetOpen && <TargetBandModal onClose={() => setTargetOpen(false)} />}
    </div>
  )
}
