import { useMemo } from 'react'
import { countWords } from '../../lib/writingMock'
import SkillArt, { SkillIcon } from '../../components/SkillArt'
import Icon from '../../components/Icon'
import {
  DAY,
  Card,
  Arrow,
  Avatar,
  greeting,
  todayLabel,
  timeAgo,
  ageLabel,
  startOfWeek,
  startOfMonth,
  average,
  formatAvg,
  EmptyNote,
  DayBars,
  lastSevenDays,
  BandDistribution,
  CriteriaTiles,
  Stat,
  BandChip,
  CriteriaGuide,
} from './ExaminerHomeParts'

/*
 * WRITING EXAMINER HOME (2026-10-07) — the first tab a writing
 * examiner sees. Mavluda: "in examiners dashboard, too empty or idk i
 * feel like smth is not enough". Answers "what's waiting for me, how
 * long has it waited, and how have I been marking?" from the
 * writing_mock_attempts rows WritingExaminerDashboard already loads —
 * no extra queries. "Open" jumps straight into the existing ReviewModal.
 *
 * Marking is per attempt (one review covers Task 1 + Task 2), so an
 * attempt is "waiting" until examiner_reviewed_at is set. "Your" stats
 * count attempts whose examiner_reviewed_by is this examiner.
 */

const LONG_WAIT_DAYS = 3

export const WRITING_GUIDE = [
  { key: 'ta', short: 'TA', label: 'Task Achievement / Response', hint: 'Task 1: key features and a clear overview. Task 2: every part answered, clear position.' },
  { key: 'cc', short: 'CC', label: 'Coherence & Cohesion', hint: 'Logical order, one idea per paragraph, linking that feels natural.' },
  { key: 'lr', short: 'LR', label: 'Lexical Resource', hint: 'Range and precision of words, collocation, spelling, word formation.' },
  { key: 'gra', short: 'GRA', label: 'Grammatical Range & Accuracy', hint: 'A mix of simple and complex sentences, and how many are error-free.' },
]

const MIN_WORDS = { task1: 150, task2: 250 }

function studentName(student) {
  return student?.full_name || student?.username || 'Student'
}

function TaskChip({ task, words }) {
  const short = words < MIN_WORDS[task]
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium ${
        short ? 'bg-urgent-tint text-urgent' : 'bg-writing-tint text-writing'
      }`}
      title={short ? `Under the ${MIN_WORDS[task]}-word minimum` : undefined}
    >
      {short && <Icon name="warning" className="h-3.5 w-3.5" />}
      {task === 'task1' ? 'Task 1' : 'Task 2'}
      <span className="font-normal opacity-80">· {words} words{short ? ` (min ${MIN_WORDS[task]})` : ''}</span>
    </span>
  )
}

export default function WritingExaminerHome({ profile, attempts, examById, studentsById, now, onOpen, onNavigate }) {
  const firstName = (profile?.full_name || '').trim().split(/\s+/)[0] || ''

  const m = useMemo(() => {
    const entries = []
    attempts.forEach((attempt) => {
      const exam = examById[attempt.exam_id]
      if (!exam) return
      entries.push({ attempt, exam, student: studentsById[attempt.student_id] })
    })

    const waiting = entries
      .filter((e) => !e.attempt.examiner_reviewed_at)
      .sort((a, b) => String(a.attempt.submitted_at).localeCompare(String(b.attempt.submitted_at)))
    const t1Waiting = waiting.filter((e) => e.attempt.task1_text).length
    const t2Waiting = waiting.filter((e) => e.attempt.task2_text).length
    const longWaits = waiting.filter((e) => now - new Date(e.attempt.submitted_at) >= LONG_WAIT_DAYS * DAY).length

    const mine = entries
      .filter((e) => e.attempt.examiner_reviewed_at && e.attempt.examiner_reviewed_by === profile?.id)
      .sort((a, b) => String(b.attempt.examiner_reviewed_at).localeCompare(String(a.attempt.examiner_reviewed_at)))
    const weekStart = startOfWeek(now)
    const monthStart = startOfMonth(now)
    const markedWeek = mine.filter((e) => new Date(e.attempt.examiner_reviewed_at) >= weekStart).length
    const markedMonth = mine.filter((e) => new Date(e.attempt.examiner_reviewed_at) >= monthStart).length
    const days = lastSevenDays(now, mine.map((e) => e.attempt.examiner_reviewed_at))

    const recent30 = mine.filter((e) => now - new Date(e.attempt.examiner_reviewed_at) <= 30 * DAY && e.attempt.submitted_at)
    const turnaroundHours = average(
      recent30.map((e) => (new Date(e.attempt.examiner_reviewed_at) - new Date(e.attempt.submitted_at)) / 3600000)
    )

    const bands = mine.map((e) => e.attempt.examiner_band).filter((b) => b != null)
    const criteria = WRITING_GUIDE.map((c) => ({
      ...c,
      avg: average(mine.map((e) => e.attempt[`${c.key}_band`])),
    }))

    return {
      waiting,
      t1Waiting,
      t2Waiting,
      longWaits,
      mine,
      markedWeek,
      markedMonth,
      markedToday: days[6].count,
      days,
      turnaroundHours,
      bands,
      avgBand: average(bands),
      criteria,
    }
  }, [attempts, examById, studentsById, profile?.id, now])

  const next = m.waiting[0] || null
  const upNext = m.waiting.slice(1, 6)
  const busiest = m.days.reduce((best, d) => (d.count > best.count ? d : best), m.days[0])
  const oldestDays = next ? (now - new Date(next.attempt.submitted_at)) / DAY : 0

  const turnaround =
    m.turnaroundHours == null
      ? '–'
      : m.turnaroundHours < 24
        ? `${Math.max(1, Math.round(m.turnaroundHours))} h`
        : `${(m.turnaroundHours / 24).toFixed(1)} d`

  const waitingRows = [
    { key: 't1', count: m.t1Waiting, label: m.t1Waiting === 1 ? 'Task 1 to mark' : 'Task 1s to mark', tone: 'bg-writing-tint text-writing', action: () => onNavigate('task1') },
    { key: 't2', count: m.t2Waiting, label: m.t2Waiting === 1 ? 'Task 2 to mark' : 'Task 2s to mark', tone: 'bg-writing-tint text-writing', action: () => onNavigate('task2') },
    m.longWaits > 0 && {
      key: 'long',
      count: m.longWaits,
      label: `waiting ${LONG_WAIT_DAYS}+ days`,
      tone: 'bg-urgent-tint text-urgent',
      action: () => next && onOpen(next),
    },
  ].filter(Boolean)

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* GREETING */}
      <div className="lg:col-span-12 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-mist">{todayLabel(now)}</p>
          <h1 className="mt-0.5 text-[28px] font-semibold leading-tight tracking-[-0.02em]">
            {greeting(now)}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-[15px] text-paper-dim">
            {m.waiting.length === 0
              ? 'Your queue is empty'
              : `${m.waiting.length} ${m.waiting.length === 1 ? 'mock' : 'mocks'} waiting to be marked`}
            {' · '}
            {m.markedToday} marked today
          </p>
        </div>
        {next && (
          <button
            type="button"
            onClick={() => onOpen(next)}
            className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-brass px-5 text-[15px] font-medium text-onbrass hover:bg-brass-dim"
          >
            Mark the oldest
            <Arrow />
          </button>
        )}
      </div>

      {/* NEXT ESSAY */}
      <Card className="lg:col-span-8 overflow-hidden grid grid-cols-1 md:grid-cols-[1.35fr_1fr]">
        {next ? (
          <>
            <div className="flex min-w-0 flex-col gap-4 p-6 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium ${
                    oldestDays >= LONG_WAIT_DAYS ? 'bg-urgent-tint text-urgent' : 'bg-panel-2 text-paper'
                  }`}
                >
                  <Icon name="clock" className="h-3.5 w-3.5" />
                  Waiting {ageLabel(next.attempt.submitted_at, now)}
                </span>
                {next.attempt.task1_text && <TaskChip task="task1" words={countWords(next.attempt.task1_text)} />}
                {next.attempt.task2_text && <TaskChip task="task2" words={countWords(next.attempt.task2_text)} />}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-mist">Next to mark · oldest in your queue</p>
                <h2 className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.02em]">{next.exam.title}</h2>
              </div>
              <div className="flex items-center gap-3">
                <Avatar person={next.student} size="h-10 w-10" tone="bg-writing-tint text-writing" />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium">{studentName(next.student)}</p>
                  <p className="text-[13px] text-mist">
                    Submitted {new Date(next.attempt.submitted_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              {(next.exam.task2_prompt || next.exam.task1_prompt) && (
                <div className="rounded-xl bg-panel-2/70 px-3.5 py-2.5">
                  <p className="line-clamp-2 text-[13px] leading-relaxed text-paper-dim">
                    {next.exam.task2_prompt || next.exam.task1_prompt}
                  </p>
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() => onOpen(next)}
                  className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-brass px-5 text-[15px] font-medium text-onbrass hover:bg-brass-dim"
                >
                  Start marking
                  <Arrow />
                </button>
              </div>
            </div>
            {/* A first look at the essay itself (2026-10-07) */}
            <div className="hidden items-center bg-writing-tint p-6 md:flex">
              <div className="relative flex w-full flex-col gap-2 overflow-hidden rounded-2xl border border-line bg-panel p-4 shadow-sm md:rotate-[1.2deg]">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-writing">
                  <SkillIcon skill="writing" className="h-3.5 w-3.5" />
                  {next.attempt.task2_text ? 'Task 2' : 'Task 1'} · first lines
                </span>
                <p className="line-clamp-[8] text-[13px] leading-relaxed text-paper-dim">
                  {next.attempt.task2_text || next.attempt.task1_text}
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col justify-center gap-3 p-7">
              <h2 className="text-[24px] font-semibold leading-tight tracking-[-0.02em]">Nothing waiting to be marked</h2>
              <p className="text-[15px] leading-relaxed text-paper-dim">
                New writing mocks land here the moment a student submits one.
              </p>
            </div>
            <div className="order-first flex items-center justify-center bg-writing-tint p-6 md:order-none">
              <SkillArt skill="writing" title="chart" className="h-[120px] w-full max-w-[280px] md:h-auto" />
            </div>
          </>
        )}
      </Card>

      {/* WAITING FOR YOU */}
      <Card className="lg:col-span-4 flex flex-col gap-4 p-6">
        <h2 className="text-[17px] font-semibold">Waiting for you</h2>
        {m.waiting.length ? (
          <ul className="flex flex-col gap-1.5">
            {waitingRows.map((w) => (
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
            <Icon name="checkCircle" className="h-12 w-12 text-reading" />
            <p className="text-[15px] font-medium text-reading">All clear. Every mock is marked.</p>
          </div>
        )}
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-line pt-4">
          <div className="rounded-xl bg-panel-2 px-3 py-2.5">
            <p className="text-[12px] text-mist">Oldest waiting</p>
            <p className={`text-[17px] font-semibold tabular-nums ${oldestDays >= LONG_WAIT_DAYS ? 'text-urgent' : ''}`}>
              {next ? ageLabel(next.attempt.submitted_at, now) : '–'}
            </p>
          </div>
          <div className="rounded-xl bg-panel-2 px-3 py-2.5">
            <p className="text-[12px] text-mist">Your usual turnaround</p>
            <p className="text-[17px] font-semibold tabular-nums">{turnaround}</p>
          </div>
        </div>
      </Card>

      {/* UP NEXT */}
      <Card className="lg:col-span-7 flex flex-col gap-3 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">Up next in the queue</h2>
          <span className="text-[13px] text-mist">Oldest first</span>
        </div>
        {upNext.length ? (
          <ul className="flex flex-col">
            {upNext.map((e) => (
              <li key={e.attempt.id} className="border-t border-line first:border-0">
                <button
                  type="button"
                  onClick={() => onOpen(e)}
                  className="focus-ring group flex w-full items-center gap-3 rounded-xl px-1.5 py-2.5 text-left hover:bg-panel-2"
                >
                  <Avatar person={e.student} tone="bg-writing-tint text-writing" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-medium">{studentName(e.student)}</span>
                    <span className="truncate text-[13px] text-mist">
                      {e.exam.title}
                      {' · '}
                      {[
                        e.attempt.task1_text && `T1 ${countWords(e.attempt.task1_text)}w`,
                        e.attempt.task2_text && `T2 ${countWords(e.attempt.task2_text)}w`,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </span>
                  <span
                    className={`hidden shrink-0 text-[13px] tabular-nums sm:inline ${
                      now - new Date(e.attempt.submitted_at) >= LONG_WAIT_DAYS * DAY ? 'font-medium text-urgent' : 'text-mist'
                    }`}
                  >
                    {timeAgo(e.attempt.submitted_at, now)}
                  </span>
                  <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-line px-3 text-[13px] font-medium text-paper-dim group-hover:border-paper/30 group-hover:text-paper">
                    Open
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote icon={<SkillIcon skill="writing" className="h-5 w-5" />} tone="bg-writing-tint text-writing">
            {next ? 'Only the one above is waiting — nothing else in the queue.' : 'Nothing in the queue right now.'}
          </EmptyNote>
        )}
        {m.waiting.length > 6 && (
          <p className="px-1.5 text-[13px] text-mist">+{m.waiting.length - 6} more in Task 1s and Task 2s</p>
        )}
        <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-4">
          <button type="button" onClick={() => onNavigate('task1')} className="focus-ring flex items-center gap-2 rounded-xl bg-panel-2 px-3.5 py-2 text-sm font-medium hover:bg-line/60">
            <SkillIcon skill="writing" className="h-4 w-4 text-writing" />
            All Task 1s
          </button>
          <button type="button" onClick={() => onNavigate('task2')} className="focus-ring flex items-center gap-2 rounded-xl bg-panel-2 px-3.5 py-2 text-sm font-medium hover:bg-line/60">
            <SkillIcon skill="writing" className="h-4 w-4 text-writing" />
            All Task 2s
          </button>
        </div>
      </Card>

      {/* YOUR MARKING */}
      <Card className="lg:col-span-5 flex flex-col gap-4 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-semibold">Your marking</h2>
          <span className="text-[13px] text-mist">Last 7 days</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat value={m.markedWeek} label="this week" tone="text-writing" />
          <Stat value={m.markedMonth} label="this month" />
          <Stat value={m.mine.length} label="all time" />
        </div>
        <DayBars days={m.days} now={now} strong="bg-writing" tint="bg-writing-tint" label="Mocks you marked per day" className="h-[160px]" />
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-line pt-4">
          <div className="rounded-xl bg-panel-2 px-3 py-2.5">
            <p className="text-[12px] text-mist">Busiest day</p>
            <p className="text-[15px] font-semibold">
              {busiest.count ? `${busiest.date.toLocaleDateString('en-GB', { weekday: 'long' })} · ${busiest.count}` : '–'}
            </p>
          </div>
          <div className="rounded-xl bg-panel-2 px-3 py-2.5">
            <p className="text-[12px] text-mist">With written feedback</p>
            <p className="text-[15px] font-semibold tabular-nums">
              {m.mine.filter((e) => e.attempt.examiner_feedback).length} of {m.mine.length}
            </p>
          </div>
        </div>
      </Card>

      {/* BANDS GIVEN */}
      <Card className="lg:col-span-7 flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">Bands you’ve given</h2>
          <span className="text-[13px] text-mist">{m.bands.length} marked with a band</span>
        </div>
        {m.bands.length ? (
          <>
            <div className="grid grid-cols-1 items-center gap-5 sm:grid-cols-[150px_minmax(0,1fr)]">
              <div className="flex flex-col items-start gap-1 rounded-2xl bg-writing-tint px-4 py-4 sm:items-center sm:text-center">
                <span className="text-[13px] font-medium text-writing">Average band</span>
                <span className="text-[40px] font-semibold leading-none tabular-nums">{formatAvg(m.avgBand)}</span>
                <span className="text-[12px] text-paper-dim">across {m.bands.length} mocks</span>
              </div>
              <BandDistribution bands={m.bands} strong="bg-writing" />
            </div>
            <div className="mt-auto flex flex-col gap-2.5">
              <p className="text-[13px] font-medium text-mist">Average per criterion</p>
              <CriteriaTiles items={m.criteria} tint="bg-panel-2" text="text-writing" />
            </div>
          </>
        ) : (
          <EmptyNote icon={<Icon name="target" className="h-5 w-5" />} tone="bg-writing-tint text-writing">
            Your averages appear here after you mark your first mock.
          </EmptyNote>
        )}
      </Card>

      {/* RECENTLY MARKED */}
      <Card className="lg:col-span-5 flex flex-col gap-3 p-6">
        <h2 className="text-[17px] font-semibold">Recently marked</h2>
        {m.mine.length ? (
          <ul className="flex flex-col">
            {m.mine.slice(0, 5).map((e) => (
              <li key={e.attempt.id} className="border-t border-line first:border-0">
                <button
                  type="button"
                  onClick={() => onOpen(e)}
                  className="focus-ring flex w-full items-center gap-3 rounded-xl px-1.5 py-2.5 text-left hover:bg-panel-2"
                >
                  <Avatar person={e.student} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px]">{studentName(e.student)}</span>
                    <span className="truncate text-[13px] text-mist">
                      {e.exam.title} · {timeAgo(e.attempt.examiner_reviewed_at, now)}
                    </span>
                  </span>
                  {e.attempt.examiner_band != null ? (
                    <BandChip band={e.attempt.examiner_band} />
                  ) : (
                    <span className="inline-flex h-7 items-center rounded-lg bg-panel-2 px-2.5 text-[13px] text-mist">Feedback only</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote icon={<Icon name="clipboard" className="h-5 w-5" />}>Mocks you mark will be listed here.</EmptyNote>
        )}
      </Card>

      {/* MARKING GUIDE */}
      <div className="lg:col-span-12">
        <CriteriaGuide
          title="Marking guide"
          items={WRITING_GUIDE}
          tint="bg-writing-tint"
          text="text-writing"
          footer={
            <div className="flex flex-wrap gap-2 border-t border-line pt-4 text-[13px]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-3 py-1.5">
                <span className="font-semibold">Task 1</span> at least 150 words
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-3 py-1.5">
                <span className="font-semibold">Task 2</span> at least 250 words
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-3 py-1.5 text-paper-dim">
                Overall = average of the four, rounded to the nearest half band (6.25 → 6.5, 6.75 → 7.0)
              </span>
            </div>
          }
        />
      </div>
    </div>
  )
}
