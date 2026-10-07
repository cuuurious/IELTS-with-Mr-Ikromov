import { useMemo } from 'react'
import { isSameDay } from '../../lib/skills'
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
  startOfWeek,
  startOfMonth,
  average,
  formatAvg,
  EmptyNote,
  DayBars,
  BandDistribution,
  CriteriaTiles,
  Stat,
  BandChip,
  CriteriaGuide,
} from './ExaminerHomeParts'

/*
 * SPEAKING EXAMINER HOME (2026-10-07) — the first tab a speaking
 * examiner sees. Built only from the mock_speaking_slots rows (and the
 * workload RPC) SpeakingExaminerDashboard already loads. Every action
 * here calls the dashboard's existing handlers (updateStatus,
 * openScoreModal, the meeting link), so behaviour is identical to the
 * Timetable tab.
 */

export const SPEAKING_GUIDE = [
  { key: 'fc', short: 'FC', label: 'Fluency & Coherence', hint: 'Speaks at length without effort, ideas linked and easy to follow.' },
  { key: 'lr', short: 'LR', label: 'Lexical Resource', hint: 'Range of vocabulary, idiomatic language, paraphrases when stuck.' },
  { key: 'gra', short: 'GRA', label: 'Grammatical Range & Accuracy', hint: 'Mix of simple and complex structures, how often errors appear.' },
  { key: 'pron', short: 'P', label: 'Pronunciation', hint: 'Clear sounds, word and sentence stress, intonation, easy to understand.' },
]

const STATUS_CHIP = {
  scheduled: { label: 'Scheduled', className: 'bg-speaking-tint text-speaking' },
  completed: { label: 'Completed', className: 'bg-reading-tint text-reading' },
  cancelled: { label: 'Cancelled', className: 'bg-panel-2 text-mist' },
  no_show: { label: 'No-show', className: 'bg-urgent-tint text-urgent' },
}

function name(student) {
  return student?.full_name || student?.username || 'Student'
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function slotEnd(slot) {
  return new Date(slot.scheduled_at).getTime() + (Number(slot.duration_minutes) || 15) * 60000
}

function dayHeading(date, now) {
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (isSameDay(date, tomorrow)) return 'Tomorrow'
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
}

/* What a slot row offers, mirroring SlotRow on the Timetable tab. */
function SlotAction({ slot, now, onStatus, onScore }) {
  const started = new Date(slot.scheduled_at).getTime() <= now.getTime()
  const over = slotEnd(slot) <= now.getTime()

  if (slot.status === 'scheduled' && !over) {
    return slot.meeting_link ? (
      <a
        href={slot.meeting_link}
        target="_blank"
        rel="noopener noreferrer"
        className={`focus-ring inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium ${
          started ? 'bg-brass text-onbrass hover:bg-brass-dim' : 'border border-line text-paper-dim hover:border-paper/30 hover:text-paper'
        }`}
      >
        <Icon name="video" className="h-4 w-4" />
        Join
      </a>
    ) : (
      <span className="text-[13px] text-mist">No link yet</span>
    )
  }
  if (slot.status === 'scheduled' && over) {
    return (
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onStatus(slot, 'completed')}
          className="focus-ring inline-flex h-9 items-center rounded-full bg-brass px-3.5 text-[13px] font-medium text-onbrass hover:bg-brass-dim"
        >
          Mark done
        </button>
        <button
          type="button"
          onClick={() => onStatus(slot, 'no_show')}
          disabled={!started}
          className="focus-ring inline-flex h-9 items-center rounded-full border border-line px-3 text-[13px] font-medium text-paper-dim hover:border-paper/30 hover:text-paper disabled:opacity-40"
          title="Student didn't attend — notifies the teacher"
        >
          No-show
        </button>
      </span>
    )
  }
  if (slot.status === 'completed') {
    return slot.examiner_band != null ? (
      <button type="button" onClick={() => onScore(slot)} className="focus-ring rounded-lg" title="View / edit the score">
        <BandChip band={slot.examiner_band} />
      </button>
    ) : (
      <button
        type="button"
        onClick={() => onScore(slot)}
        className="focus-ring inline-flex h-9 items-center rounded-full bg-brass px-4 text-[13px] font-medium text-onbrass hover:bg-brass-dim"
      >
        Mark
      </button>
    )
  }
  const meta = STATUS_CHIP[slot.status] || STATUS_CHIP.scheduled
  return <span className={`inline-flex h-7 items-center rounded-lg px-2.5 text-[13px] font-medium ${meta.className}`}>{meta.label}</span>
}

export default function SpeakingExaminerHome({
  profile,
  slots,
  studentById,
  now,
  myWeekCount,
  teamAverage,
  onStatus,
  onScore,
  onNavigate,
}) {
  const firstName = (profile?.full_name || '').trim().split(/\s+/)[0] || ''

  const m = useMemo(() => {
    const sorted = [...slots].sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)))
    const today = sorted.filter((s) => isSameDay(new Date(s.scheduled_at), now))

    const endOfToday = new Date(now)
    endOfToday.setHours(23, 59, 59, 999)
    const weekAhead = endOfToday.getTime() + 7 * DAY
    const upcoming = sorted.filter(
      (s) => s.status === 'scheduled' && new Date(s.scheduled_at).getTime() > endOfToday.getTime()
    )
    const comingUp = upcoming.filter((s) => new Date(s.scheduled_at).getTime() <= weekAhead).slice(0, 6)
    const groups = []
    comingUp.forEach((s) => {
      const d = new Date(s.scheduled_at)
      const last = groups[groups.length - 1]
      if (last && isSameDay(last.date, d)) last.slots.push(s)
      else groups.push({ date: d, slots: [s] })
    })

    const toMark = sorted.filter((s) => s.status === 'completed' && s.examiner_band == null)
    const toClose = sorted.filter((s) => s.status === 'scheduled' && slotEnd(s) <= now.getTime())

    const weekStart = startOfWeek(now)
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY)
    const inWeek = (s) => {
      const t = new Date(s.scheduled_at)
      return t >= weekStart && t < weekEnd
    }
    const thisWeek = sorted.filter((s) => inWeek(s) && (s.status === 'scheduled' || s.status === 'completed')).length
    const monthStart = startOfMonth(now)
    const doneMonth = sorted.filter((s) => s.status === 'completed' && new Date(s.scheduled_at) >= monthStart).length
    const noShowMonth = sorted.filter((s) => s.status === 'no_show' && new Date(s.scheduled_at) >= monthStart).length

    // Sessions per day for today + the next six days.
    const ahead = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now)
      d.setDate(now.getDate() + i)
      return {
        date: d,
        count: sorted.filter((s) => s.status !== 'cancelled' && isSameDay(new Date(s.scheduled_at), d)).length,
      }
    })

    const marked = sorted
      .filter((s) => s.examiner_band != null)
      .sort((a, b) =>
        String(b.examiner_reviewed_at || b.scheduled_at).localeCompare(String(a.examiner_reviewed_at || a.scheduled_at))
      )
    const bands = marked.map((s) => s.examiner_band)
    const criteria = SPEAKING_GUIDE.map((c) => ({ ...c, avg: average(marked.map((s) => s[`${c.key}_band`])) }))

    const nextSlot = sorted.find((s) => s.status === 'scheduled' && slotEnd(s) > now.getTime()) || null

    return { today, groups, upcoming, toMark, toClose, thisWeek, doneMonth, noShowMonth, ahead, marked, bands, avgBand: average(bands), criteria, nextSlot }
  }, [slots, now])

  const busiest = m.ahead.reduce((best, d) => (d.count > best.count ? d : best), m.ahead[0])
  const noLink = slots.filter((s) => s.status === 'scheduled' && !s.meeting_link && slotEnd(s) > now.getTime()).length
  const todayLive = m.today.filter((s) => s.status === 'scheduled' && slotEnd(s) > now.getTime())

  const waitingRows = [
    m.toMark.length > 0 && {
      key: 'mark',
      count: m.toMark.length,
      label: m.toMark.length === 1 ? 'session to mark' : 'sessions to mark',
      tone: 'bg-speaking-tint text-speaking',
      action: () => onScore(m.toMark[0]),
    },
    m.toClose.length > 0 && {
      key: 'close',
      count: m.toClose.length,
      label: m.toClose.length === 1 ? 'past session still open' : 'past sessions still open',
      tone: 'bg-urgent-tint text-urgent',
      action: () => onNavigate('timetable'),
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
            {todayLive.length === 0
              ? 'No more sessions today'
              : new Date(todayLive[0].scheduled_at) <= now
                ? `${todayLive.length} ${todayLive.length === 1 ? 'session' : 'sessions'} left today · one in progress now`
                : `${todayLive.length} ${todayLive.length === 1 ? 'session' : 'sessions'} left today · next at ${clock(todayLive[0].scheduled_at)}`}
            {' · '}
            {m.toMark.length} to mark
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('students')}
          className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-brass px-5 text-[15px] font-medium text-onbrass hover:bg-brass-dim"
        >
          Book a session
          <Arrow />
        </button>
      </div>

      {/* TODAY */}
      <Card className="lg:col-span-8 flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">Today</h2>
          <span className="text-[13px] text-mist">
            {m.today.length} {m.today.length === 1 ? 'session' : 'sessions'}
          </span>
        </div>
        {m.today.length ? (
          <ol className="flex flex-col">
            {m.today.map((slot, i) => {
              const start = new Date(slot.scheduled_at).getTime()
              const live = slot.status === 'scheduled' && start <= now.getTime() && slotEnd(slot) > now.getTime()
              const done = slot.status !== 'scheduled' || slotEnd(slot) <= now.getTime()
              const student = studentById[slot.student_id]
              return (
                <li key={slot.id} className="grid grid-cols-[52px_20px_minmax(0,1fr)] gap-x-2.5 sm:grid-cols-[64px_24px_minmax(0,1fr)]">
                  <div className="pt-3 text-right">
                    <p className={`text-[15px] font-semibold tabular-nums ${done ? 'text-mist' : ''}`}>{clock(slot.scheduled_at)}</p>
                    <p className="text-[12px] text-mist">{slot.duration_minutes} min</p>
                  </div>
                  <div className="relative flex justify-center">
                    {m.today.length > 1 && (
                      <span
                        className="absolute w-px bg-line"
                        style={{ top: i === 0 ? 22 : 0, bottom: i === m.today.length - 1 ? 'calc(100% - 22px)' : 0 }}
                      />
                    )}
                    <span
                      className={`relative mt-4 h-3 w-3 rounded-full ring-4 ring-panel ${
                        live ? 'bg-speaking' : done ? 'bg-line' : 'bg-speaking-tint border border-speaking'
                      }`}
                    />
                  </div>
                  <div
                    className={`my-1 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-3 py-2.5 ${
                      live ? 'bg-speaking-tint' : 'hover:bg-panel-2/70'
                    }`}
                  >
                    <span className="hidden sm:block">
                      <Avatar person={student} tone={live ? 'bg-panel text-speaking' : done ? 'bg-panel-2 text-paper-dim' : 'bg-speaking-tint text-speaking'} />
                    </span>
                    <div className="min-w-0 flex-1 basis-36">
                      <p className={`truncate text-[15px] font-medium ${slot.status === 'cancelled' ? 'text-mist line-through' : ''}`}>{name(student)}</p>
                      <p className="truncate text-[13px] text-mist">
                        {live ? <span className="font-medium text-speaking">In progress now</span> : (STATUS_CHIP[slot.status] || STATUS_CHIP.scheduled).label}
                        {slot.notes ? ` · ${slot.notes}` : ''}
                      </p>
                    </div>
                    <div className="ml-auto shrink-0">
                      <SlotAction slot={slot} now={now} onStatus={onStatus} onScore={onScore} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        ) : (
          <div className="flex flex-1 flex-col items-center gap-4 rounded-2xl bg-speaking-tint/60 px-5 py-6 text-center sm:flex-row sm:text-left">
            <SkillArt skill="speaking" className="h-[96px] w-[160px] shrink-0" />
            <div>
              <p className="text-[15px] font-medium">No sessions booked for today</p>
              <p className="mt-0.5 text-sm text-paper-dim">
                {m.nextSlot
                  ? `Next: ${name(studentById[m.nextSlot.student_id])}, ${dayHeading(new Date(m.nextSlot.scheduled_at), now).toLowerCase()} at ${clock(m.nextSlot.scheduled_at)}.`
                  : 'Book a student from the Students tab when you’re ready.'}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* WAITING FOR YOU */}
      <Card className="lg:col-span-4 flex flex-col gap-4 p-6">
        <h2 className="text-[17px] font-semibold">Waiting for you</h2>
        {waitingRows.length ? (
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
            <p className="text-[15px] font-medium text-reading">All clear. Every session is marked.</p>
          </div>
        )}
        {m.nextSlot && (
          <div className="flex flex-col gap-2.5 rounded-2xl bg-speaking-tint/70 p-4">
            <p className="text-[13px] font-medium text-speaking">
              {new Date(m.nextSlot.scheduled_at) <= now ? 'In progress now' : 'Next session'}
            </p>
            <div className="flex items-center gap-3">
              <Avatar person={studentById[m.nextSlot.student_id]} size="h-10 w-10" tone="bg-panel text-speaking" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{name(studentById[m.nextSlot.student_id])}</p>
                <p className="text-[13px] text-paper-dim">
                  {isSameDay(new Date(m.nextSlot.scheduled_at), now) ? 'Today' : dayHeading(new Date(m.nextSlot.scheduled_at), now)}
                  {' · '}
                  {clock(m.nextSlot.scheduled_at)}–{clock(new Date(slotEnd(m.nextSlot)).toISOString())}
                </p>
              </div>
            </div>
            <div className="flex [&>a]:flex-1 [&>a]:justify-center">
              <SlotAction slot={m.nextSlot} now={now} onStatus={onStatus} onScore={onScore} />
            </div>
          </div>
        )}
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-line pt-4">
          <div className="rounded-xl bg-panel-2 px-3 py-2.5">
            <p className="text-[12px] text-mist">You this week</p>
            <p className="text-[17px] font-semibold tabular-nums">
              {myWeekCount ?? m.thisWeek} <span className="text-[13px] font-normal text-mist">sessions</span>
            </p>
          </div>
          <div className="rounded-xl bg-panel-2 px-3 py-2.5">
            <p className="text-[12px] text-mist">Team average</p>
            <p className="text-[17px] font-semibold tabular-nums">{teamAverage != null ? teamAverage.toFixed(1) : '–'}</p>
          </div>
        </div>
      </Card>

      {/* COMING UP */}
      <Card className="lg:col-span-7 flex flex-col gap-3 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">Coming up</h2>
          <button type="button" onClick={() => onNavigate('timetable')} className="focus-ring text-[13px] font-medium text-paper-dim hover:text-paper">
            Full timetable
          </button>
        </div>
        {m.groups.length ? (
          <div className="flex flex-col gap-3">
            {m.groups.map((g) => (
              <div key={g.date.toISOString()}>
                <p className="mb-1 px-1.5 text-[13px] font-medium text-mist">{dayHeading(g.date, now)}</p>
                <ul className="flex flex-col">
                  {g.slots.map((slot) => {
                    const student = studentById[slot.student_id]
                    return (
                      <li key={slot.id} className="flex items-center gap-3 rounded-xl px-1.5 py-2 hover:bg-panel-2/70">
                        <span className="w-12 shrink-0 text-[15px] font-semibold tabular-nums">{clock(slot.scheduled_at)}</span>
                        <Avatar person={student} tone="bg-speaking-tint text-speaking" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[15px]">{name(student)}</span>
                          <span className="truncate text-[13px] text-mist">
                            {slot.duration_minutes} min{slot.notes ? ` · ${slot.notes}` : ''}
                          </span>
                        </span>
                        {slot.meeting_link ? (
                          <a
                            href={slot.meeting_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="focus-ring hidden h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium text-paper-dim hover:border-paper/30 hover:text-paper sm:inline-flex"
                          >
                            <Icon name="video" className="h-3.5 w-3.5" />
                            Link
                          </a>
                        ) : (
                          <span className="hidden text-[12px] text-mist sm:inline">No link yet</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            {m.upcoming.length > 6 && (
              <p className="px-1.5 text-[13px] text-mist">+{m.upcoming.length - 6} more in your timetable</p>
            )}
          </div>
        ) : (
          <EmptyNote icon={<Icon name="calendar" className="h-5 w-5" />} tone="bg-speaking-tint text-speaking">
            Nothing booked for the next seven days.
          </EmptyNote>
        )}
      </Card>

      {/* WEEK AHEAD */}
      <Card className="lg:col-span-5 flex flex-col gap-4 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[17px] font-semibold">Your week ahead</h2>
          <span className="text-[13px] text-mist">Sessions per day</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat value={m.ahead.reduce((s, d) => s + d.count, 0)} label="next 7 days" tone="text-speaking" />
          <Stat value={m.doneMonth} label="done this month" />
          <Stat value={m.noShowMonth} label="no-shows" tone={m.noShowMonth ? 'text-urgent' : 'text-paper'} />
        </div>
        <DayBars days={m.ahead} now={now} strong="bg-speaking" tint="bg-speaking-tint" label="Sessions booked per day, today and the next six days" className="h-[160px]" />
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-line pt-4">
          <div className="rounded-xl bg-panel-2 px-3 py-2.5">
            <p className="text-[12px] text-mist">Busiest day</p>
            <p className="text-[15px] font-semibold">
              {busiest.count ? `${busiest.date.toLocaleDateString('en-GB', { weekday: 'long' })} · ${busiest.count}` : '–'}
            </p>
          </div>
          <div className={`rounded-xl px-3 py-2.5 ${noLink ? 'bg-urgent-tint' : 'bg-panel-2'}`}>
            <p className={`text-[12px] ${noLink ? 'text-urgent' : 'text-mist'}`}>Booked without a link</p>
            <p className={`text-[15px] font-semibold tabular-nums ${noLink ? 'text-urgent' : ''}`}>{noLink}</p>
          </div>
        </div>
      </Card>

      {/* BANDS GIVEN */}
      <Card className="lg:col-span-7 flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">Bands you’ve given</h2>
          <span className="text-[13px] text-mist">{m.bands.length} marked sessions</span>
        </div>
        {m.bands.length ? (
          <>
            <div className="grid grid-cols-1 items-center gap-5 sm:grid-cols-[150px_minmax(0,1fr)]">
              <div className="flex flex-col items-start gap-1 rounded-2xl bg-speaking-tint px-4 py-4 sm:items-center sm:text-center">
                <span className="text-[13px] font-medium text-speaking">Average band</span>
                <span className="text-[40px] font-semibold leading-none tabular-nums">{formatAvg(m.avgBand)}</span>
                <span className="text-[12px] text-paper-dim">across {m.bands.length} sessions</span>
              </div>
              <BandDistribution bands={m.bands} strong="bg-speaking" />
            </div>
            <div className="mt-auto flex flex-col gap-2.5">
              <p className="text-[13px] font-medium text-mist">Average per criterion</p>
              <CriteriaTiles items={m.criteria} tint="bg-panel-2" text="text-speaking" />
            </div>
          </>
        ) : (
          <EmptyNote icon={<Icon name="target" className="h-5 w-5" />} tone="bg-speaking-tint text-speaking">
            Your averages appear here after you score your first session.
          </EmptyNote>
        )}
      </Card>

      {/* RECENTLY MARKED */}
      <Card className="lg:col-span-5 flex flex-col gap-3 p-6">
        <h2 className="text-[17px] font-semibold">Recently marked</h2>
        {m.marked.length ? (
          <ul className="flex flex-col">
            {m.marked.slice(0, 5).map((slot) => {
              const student = studentById[slot.student_id]
              return (
                <li key={slot.id} className="border-t border-line first:border-0">
                  <button
                    type="button"
                    onClick={() => onScore(slot)}
                    className="focus-ring flex w-full items-center gap-3 rounded-xl px-1.5 py-2.5 text-left hover:bg-panel-2"
                  >
                    <Avatar person={student} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px]">{name(student)}</span>
                      <span className="flex items-center gap-1.5 truncate text-[13px] text-mist">
                        {timeAgo(slot.examiner_reviewed_at || slot.scheduled_at, now)}
                        {slot.recording_url && (
                          <>
                            <span aria-hidden>·</span>
                            <Icon name="mic" className="h-3.5 w-3.5" /> recording
                          </>
                        )}
                      </span>
                    </span>
                    <BandChip band={slot.examiner_band} />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyNote icon={<SkillIcon skill="speaking" className="h-5 w-5" />} tone="bg-speaking-tint text-speaking">
            Sessions you score will be listed here.
          </EmptyNote>
        )}
      </Card>

      {/* MARKING GUIDE */}
      <div className="lg:col-span-12">
        <CriteriaGuide
          title="Marking guide"
          items={SPEAKING_GUIDE}
          tint="bg-speaking-tint"
          text="text-speaking"
          footer={
            <div className="flex flex-wrap gap-2 border-t border-line pt-4 text-[13px]">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-3 py-1.5">
                <span className="font-semibold">Part 1</span> 4–5 min, familiar topics
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-3 py-1.5">
                <span className="font-semibold">Part 2</span> 1 min to prepare, up to 2 min talk
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-3 py-1.5">
                <span className="font-semibold">Part 3</span> 4–5 min discussion
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 px-3 py-1.5 text-paper-dim">
                Overall = average of the four, rounded to the nearest half band
              </span>
            </div>
          }
        />
      </div>
    </div>
  )
}
