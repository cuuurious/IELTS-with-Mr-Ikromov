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

// Band tiles: deep tile colours that read the same in light and dark.
const BAND_TILE = {
  listening: 'bg-[#1b3b73] text-white',
  reading: 'bg-[#1e9e9a] text-white',
  writing: 'bg-[#b23a48] text-white',
  speaking: 'bg-[#6a3f99] text-white',
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
      {/* TODAY — lapis band with the girih pattern (Registan look, 2026-10-16) */}
      <section aria-label="Today" className="registan-band lg:col-span-12 rounded-[28px] px-5 py-7 sm:px-9 sm:py-9">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-brand text-[28px] font-semibold leading-[1.12] tracking-[-0.02em] text-onband sm:text-[40px]">
                {greetingFor(now)}{firstName ? `, ${firstName}` : ''}
              </h1>
              <p className="mt-2 text-[16px] text-onband-dim sm:text-[17px]">
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
            {groups.length > 1 ? (
              <div role="group" aria-label="Group" className="flex max-w-full overflow-x-auto rounded-[12px] bg-white/10 p-1">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => onSelectGroup(g.id)}
                    className={`focus-ring h-9 shrink-0 rounded-[9px] px-3.5 text-sm font-bold transition-colors ${
                      g.id === activeGroup ? 'bg-[#e6a33a] text-[#17213a]' : 'text-onband-dim hover:text-onband'
                    }`}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            ) : group ? (
              <span className="rounded-[10px] bg-[#e6a33a] px-3 py-1.5 text-sm font-extrabold text-[#17213a]">
                {/^\d+$/.test((group.name || '').trim()) ? `Group ${group.name.trim()}` : group.name}
              </span>
            ) : null}
          </div>

          {hero ? (
            <div className="tile-cut flex flex-col gap-4 bg-[#f6f5f1] p-5 text-[#17213a] sm:flex-row sm:items-center sm:p-6">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold">
                  <span className="inline-flex items-center gap-1.5 text-[#1b3b73]">
                    <SkillIcon skill={hero.skill.key} className="h-4 w-4" />
                    {hero.skill.key === 'general' ? 'Homework' : hero.skill.label}
                  </span>
                  <span className={hero.state.key === 'today' ? 'text-[#b23a48]' : 'text-[#55607a]'}>
                    · due {formatDue(hero.hw.due_date, now).replace(/^Today/, 'today').replace(/^Tomorrow/, 'tomorrow')}
                  </span>
                  {upcoming.length > 1 && <span className="font-medium text-[#55607a]">· {upcoming.length - 1} more after this</span>}
                </p>
                <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight text-[#17213a] sm:text-[24px]">{hero.hw.title}</h2>
                {hero.hw.description && <p className="mt-1 line-clamp-2 text-[15px] leading-relaxed text-[#3a4560]">{hero.hw.description}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => onOpenHomework(hero.hw.id)}
                  className="focus-ring inline-flex h-12 items-center gap-2 rounded-[12px] bg-[#1b3b73] px-5 text-[15px] font-bold text-white hover:bg-[#24498a]"
                >
                  {hero.skill.key === 'writing' ? 'Start writing' : hero.skill.key === 'speaking' ? 'Start recording' : 'Open homework'}
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('homework')}
                  className="focus-ring inline-flex h-12 items-center rounded-[12px] border-2 border-[#1b3b73] px-4 text-[15px] font-bold text-[#1b3b73] hover:bg-[#1b3b73] hover:text-white"
                >
                  All homework
                </button>
              </div>
            </div>
          ) : (
            <div className="tile-cut flex flex-col gap-3 bg-[#f6f5f1] p-5 text-[#17213a] sm:flex-row sm:items-center sm:p-6">
              <div className="min-w-0 flex-1">
                <h2 className="text-[22px] font-extrabold text-[#17213a]">
                  {!group ? 'You’re not in a group yet' : overdue.length ? 'No new homework right now' : 'You’re up to date'}
                </h2>
                <p className="mt-1 text-[15px] text-[#3a4560]">
                  {group
                    ? overdue.length
                      ? 'A good moment to catch up on the missed work below.'
                      : 'Nothing is waiting for you right now. Revise some words or look back at your marked work.'
                    : 'Ask Mr Ikromov to add you to a group, and your homework will appear here.'}
                </p>
              </div>
              {group && (
                <button
                  type="button"
                  onClick={() => (overdue.length ? onOpenHomework(overdue[0].hw.id) : onNavigate('wordlists'))}
                  className="focus-ring inline-flex h-12 w-fit shrink-0 items-center rounded-[12px] bg-[#1b3b73] px-5 text-[15px] font-bold text-white hover:bg-[#24498a]"
                >
                  {overdue.length ? 'Catch up now' : 'Revise words'}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* MISSED WORK — can still be handed in late */}
      {overdue.length > 0 && (
        <div className="tile-cut lg:col-span-12 flex flex-col gap-3 bg-urgent-tint px-5 py-4 sm:flex-row sm:items-center">
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

      {/* BANDS — one tile per skill */}
      <section aria-labelledby="sh-bands" className="lg:col-span-12 flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="sh-bands" className="font-brand text-[22px] font-semibold text-brass">Your bands</h2>
          <button
            type="button"
            onClick={() => setTargetOpen(true)}
            className="focus-ring rounded-lg px-1.5 py-0.5 text-[14px] text-mist hover:bg-panel-2 hover:text-paper"
            title="Change your target band"
          >
            {target != null ? (
              <>Target <strong className="font-extrabold text-paper">{formatBand(target)}</strong></>
            ) : (
              'Set your target'
            )}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {skillRows.map(({ skill, band }) => {
            const tone = BAND_TILE[skill.key]
            const gap = band != null && target != null ? target - band : null
            return (
              <div key={skill.key} className={`tile-cut flex flex-col gap-1 px-4 py-4 ${band != null ? tone : 'bg-panel text-paper'}`}>
                <span className="flex items-center gap-1.5 text-[13px] font-bold opacity-90">
                  <SkillIcon skill={skill.key} className="h-4 w-4" />
                  {skill.label}
                </span>
                <span className="font-brand text-[30px] font-semibold leading-tight tabular-nums">{band != null ? formatBand(band) : '–'}</span>
                <span className="text-[12.5px] opacity-85">
                  {band == null ? 'After your first mock' : gap == null ? 'Set a target to compare' : gap <= 0 ? 'Target reached' : `${formatBand(gap)} to target`}
                </span>
              </div>
            )
          })}
          <button
            type="button"
            onClick={onOpenMockCenter}
            className="tile-cut col-span-2 flex flex-col justify-between gap-1 bg-[#e6a33a] px-4 py-4 text-left text-[#17213a] md:col-span-1"
          >
            <span className="text-[13px] font-bold">Overall</span>
            <span className="font-brand text-[30px] font-semibold leading-tight tabular-nums">{bands?.overall != null ? formatBand(bands.overall) : '–'}</span>
            <span className="text-[12.5px]">
              {bands?.overall != null
                ? `From your ${bands.releasedAt ? new Date(bands.releasedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'latest'} mock`
                : 'Needs all four skills'}
            </span>
          </button>
        </div>
        {mockMeta && (
          <button
            type="button"
            onClick={onOpenMockCenter}
            className={`tile-cut tile-cut-sm focus-ring flex items-center gap-3 px-4 py-3 text-left ${mockMeta.tone}`}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-extrabold">{mockMeta.title}</span>
              <span className="text-[12.5px] opacity-80">{mockMeta.body}</span>
            </span>
            <span className="shrink-0 text-[13px] font-extrabold underline-offset-2 hover:underline">{mockMeta.action} →</span>
          </button>
        )}
      </section>

      {/* THIS WEEK */}
      {rest.length > 0 && (
        <>
          <div className="lg:col-span-12 mt-1 flex items-baseline justify-between">
            <h2 className="font-brand text-[22px] font-semibold text-brass">{rest.some((i) => ['today', 'todo'].includes(i.state.key)) ? 'Next up' : 'Recently handed in'}</h2>
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
              className="tile-cut tile-cut-lg focus-ring group flex flex-col overflow-hidden bg-panel text-left transition hover:brightness-[1.02]"
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
          <h2 className="font-brand text-[17px] font-semibold text-brass">
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
