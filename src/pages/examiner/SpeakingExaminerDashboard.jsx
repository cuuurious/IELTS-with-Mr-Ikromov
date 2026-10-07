import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout, { IconHome, IconStudents, IconMockExam, IconChat } from '../../components/Layout'
import LoadingScreen from '../../components/LoadingScreen'
import PrivateChats from '../../components/PrivateChats'
import ConfirmModal from '../../components/ConfirmModal'
import { formatTargetBand } from '../../lib/targetBands'
import { downloadSpeakingSlotIcs } from '../../lib/calendarEvent'
import { roundOverallBand, formatBand } from '../../lib/ieltsBands'
import Icon from '../../components/Icon'
import { SkillIcon } from '../../components/SkillArt'
import SpeakingExaminerHome from './SpeakingExaminerHome'
import { Card, Avatar } from './ExaminerHomeParts'

/*
 * ================================================================
 * SPEAKING EXAMINER DASHBOARD
 * ================================================================
 * Shipped 2026-09-24 as part of the examiner-platform expansion (see
 * the project's examiner-platform-expansion-plan.md). A speaking
 * examiner is its own role (migration_29) — deliberately NOT a
 * teacher, so this is its own dashboard rather than a tab bolted onto
 * TeacherDashboard.
 *
 * Three jobs, three tabs:
 *   Students  — the roster (same students a teacher sees), each with
 *               a "Book speaking exam" action.
 *   Timetable — every slot this examiner has booked, upcoming first.
 *   Chats     — same shared PrivateChats component the rest of the
 *               app uses, so examiner<->student messaging is the
 *               exact same mechanism as teacher<->student.
 *
 * Data: public.mock_speaking_slots (migration_29) — RLS already lets
 * an examiner select/insert/update/delete their own rows.
 * ================================================================
 */

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function formatSlotTime(iso) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// The four IELTS Speaking criteria, added 2026-09-26 (migration_49) —
// same pattern and same locked decision as WritingExaminerDashboard.jsx:
// the overall band is calculated from these, never typed in separately,
// and only once all four are filled (so editing an older, already-marked
// slot's feedback alone never overwrites its existing examiner_band with
// a bogus average of blanks).
const SPEAKING_CRITERIA = [
  { key: 'fc', label: 'Fluency & Coherence' },
  { key: 'lr', label: 'Lexical Resource' },
  { key: 'gra', label: 'Grammatical Range & Accuracy' },
  { key: 'pron', label: 'Pronunciation' },
]

function computeOverallBand(criteriaValues) {
  const nums = criteriaValues.map((v) => (v === '' || v == null ? null : Number(v)))
  if (nums.some((n) => n == null || Number.isNaN(n))) return null
  return roundOverallBand(nums.reduce((sum, n) => sum + n, 0) / nums.length)
}

const STATUS_META = {
  scheduled: { label: 'Scheduled', className: 'bg-speaking-tint text-speaking' },
  completed: { label: 'Completed', className: 'bg-reading-tint text-reading' },
  cancelled: { label: 'Cancelled', className: 'bg-panel-2 text-mist' },
  no_show: { label: 'No-show', className: 'bg-urgent-tint text-urgent' },
}

export default function SpeakingExaminerDashboard() {
  const { profile } = useAuth()

  const [tab, setTab] = useState('home')
  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState([])
  const [slots, setSlots] = useState([])
  const [studentSearch, setStudentSearch] = useState('')

  const [notificationChat, setNotificationChat] = useState(null)

  const [bookModal, setBookModal] = useState(null) // { student } or { slot } for edit
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [scoreModal, setScoreModal] = useState(null) // { slot } once a session is completed
  const [scoreSaving, setScoreSaving] = useState(false)
  const [scoreError, setScoreError] = useState('')

  // Delete a cancelled/no-show slot from the Past/other list — Jasur,
  // 2026-09-27: these are dead rows with no real exam data attached
  // (unlike a completed one, which holds a real band/feedback record
  // worth keeping), so clearing them out of the list should be possible.
  // Kept as a two-step confirm (this app's ConfirmModal, not
  // window.confirm) since delete is permanent — RLS already lets an
  // examiner delete their own mock_speaking_slots rows (migration_29).
  const [confirmDialog, setConfirmDialog] = useState(null)

  const confirmDeleteSlot = (slot) => {
    setConfirmDialog({
      title: 'Delete this slot?',
      message: "This removes it from your timetable for good — there's no undo.",
      tone: 'coral',
      confirmLabel: 'Delete',
      onConfirm: () => deleteSlot(slot),
    })
  }

  const deleteSlot = async (slot) => {
    const { error: deleteError } = await supabase
      .from('mock_speaking_slots')
      .delete()
      .eq('id', slot.id)

    if (deleteError) {
      console.error('Could not delete speaking slot:', deleteError)
      setConfirmDialog({
        title: "Couldn't delete this slot",
        message: deleteError.message || 'Something went wrong. Please try again.',
        tone: 'coral',
        hideCancel: true,
      })
      return
    }

    await loadAll()
  }

  // Examiner workload auto-balancing (2026-09-26, migration_55) — one of
  // the ~15 "build everything" brainstorm items. Booking has always been
  // fully self-service (this examiner picks a student and books a slot
  // for THEMSELVES, no queue or assignment step), so two examiners can
  // end up wildly uneven with neither ever finding out — TeacherMockCenter
  // .jsx already has a read-only "Examiner workload" tile, but only a
  // teacher ever sees it. This is deliberately a NUDGE, not a forced
  // reassignment: get_speaking_examiner_workload() (a security-definer
  // RPC, since RLS otherwise keeps one examiner from seeing another's
  // slot rows at all) returns just {examiner_name, this_week_count} per
  // examiner — never another examiner's actual students or slot details
  // — so this can show "you vs. the team average" without exposing
  // anything beyond a headcount.
  const [workload, setWorkload] = useState([])

  const loadWorkload = async () => {
    const { data, error: workloadError } = await supabase.rpc('get_speaking_examiner_workload')
    if (workloadError) {
      console.error('Could not load examiner workload:', workloadError)
      return
    }
    setWorkload(data || [])
  }

  const loadAll = async () => {
    const [{ data: studentRows, error: studentsError }, { data: slotRows, error: slotsError }] =
      await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, target_band')
          .eq('role', 'student')
          .order('full_name', { ascending: true }),
        supabase
          .from('mock_speaking_slots')
          .select('*')
          .eq('examiner_id', profile.id)
          .order('scheduled_at', { ascending: true }),
      ])

    if (studentsError) console.error('Failed to load students:', studentsError)
    if (slotsError) console.error('Failed to load speaking slots:', slotsError)

    setStudents(studentRows || [])
    setSlots(slotRows || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!profile?.id) return
    loadAll()
    loadWorkload()

    const channel = supabase
      .channel('speaking-slots-examiner')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mock_speaking_slots', filter: `examiner_id=eq.${profile.id}` },
        () => {
          loadAll()
          // A slot this examiner just booked/cancelled changes their own
          // count immediately; re-pull the shared workload view too so
          // the "you vs. team average" numbers stay current without
          // waiting for a manual refresh.
          loadWorkload()
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // "You" vs. "everyone else's average" for THIS week — the number this
  // component actually shows. A lone examiner (or one with no peers who
  // have booked anything yet) has nobody to compare against, so the
  // note/strip below simply doesn't render rather than comparing against
  // zero and always looking "overloaded."
  const myWorkload = useMemo(
    () => workload.find((w) => w.examiner_id === profile?.id) || null,
    [workload, profile?.id]
  )
  const otherExaminers = useMemo(
    () => workload.filter((w) => w.examiner_id !== profile?.id),
    [workload, profile?.id]
  )
  const teamAverageThisWeek = useMemo(() => {
    if (otherExaminers.length === 0) return null
    const sum = otherExaminers.reduce((s, w) => s + Number(w.this_week_count || 0), 0)
    return sum / otherExaminers.length
  }, [otherExaminers])

  // A full 3 sessions above the team's average is the "worth a nudge"
  // threshold — enough to be a real, visible gap rather than the normal
  // give-and-take of everyone's differing availability day to day.
  const WORKLOAD_IMBALANCE_THRESHOLD = 3
  const isOverloaded =
    myWorkload != null &&
    teamAverageThisWeek != null &&
    Number(myWorkload.this_week_count) - teamAverageThisWeek >= WORKLOAD_IMBALANCE_THRESHOLD

  const studentById = useMemo(() => {
    const map = {}
    students.forEach((s) => { map[s.id] = s })
    return map
  }, [students])

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase()
    if (!q) return students
    return students.filter((s) =>
      (s.full_name || '').toLowerCase().includes(q) ||
      (s.username || '').toLowerCase().includes(q)
    )
  }, [students, studentSearch])

  // "Now" for the Home tab; refreshed whenever the slot list reloads.
  const now = useMemo(() => new Date(), [slots])

  const upcomingSlots = slots.filter((s) => s.status === 'scheduled')
  const pastSlots = slots.filter((s) => s.status !== 'scheduled')

  const handleMessageStudent = (student) => {
    setNotificationChat({ studentId: student.id, studentName: student.full_name || student.username })
    setTab('chats')
  }

  const openBookModal = (student) => setBookModal({ mode: 'create', student })
  const openEditModal = (slot) => setBookModal({ mode: 'edit', slot })

  const saveSlot = async (formValues) => {
    setSaving(true)
    setError('')

    try {
      if (bookModal.mode === 'create') {
        const { error: insertError } = await supabase.from('mock_speaking_slots').insert({
          student_id: bookModal.student.id,
          examiner_id: profile.id,
          scheduled_at: new Date(formValues.scheduledAt).toISOString(),
          duration_minutes: Number(formValues.durationMinutes) || 15,
          meeting_link: formValues.meetingLink || null,
          notes: formValues.notes || null,
        })
        if (insertError) throw insertError
      } else {
        const { error: updateError } = await supabase
          .from('mock_speaking_slots')
          .update({
            scheduled_at: new Date(formValues.scheduledAt).toISOString(),
            duration_minutes: Number(formValues.durationMinutes) || 15,
            meeting_link: formValues.meetingLink || null,
            notes: formValues.notes || null,
          })
          .eq('id', bookModal.slot.id)
        if (updateError) throw updateError
      }

      setBookModal(null)
      await loadAll()
    } catch (err) {
      console.error('Could not save speaking slot:', err)
      setError(err?.message || 'Could not save this slot.')
    } finally {
      setSaving(false)
    }
  }

  const updateStatus = async (slot, status) => {
    const { error: updateError } = await supabase
      .from('mock_speaking_slots')
      .update({ status })
      .eq('id', slot.id)

    if (updateError) {
      console.error('Could not update slot status:', updateError)
      return
    }

    await loadAll()
  }

  /*
   * ============================================================
   * SCORE A COMPLETED SESSION
   * ============================================================
   * Added 2026-09-24 (migration_35) — once a slot is marked
   * "completed", a speaking examiner can leave a band + feedback, the
   * same way a writing examiner already does on writing_mock_attempts.
   * This is what makes the score show up in the student's Mock Test
   * Center and the teacher's Mock Center Speaking column/section.
   */
  const openScoreModal = (slot) => setScoreModal({ slot })

  const saveScore = async ({ fc, lr, gra, pron, feedback, recordingUrl }) => {
    setScoreSaving(true)
    setScoreError('')

    try {
      const computedOverall = computeOverallBand([fc, lr, gra, pron])

      const { error: updateError } = await supabase
        .from('mock_speaking_slots')
        .update({
          fc_band: fc === '' ? null : Number(fc),
          lr_band: lr === '' ? null : Number(lr),
          gra_band: gra === '' ? null : Number(gra),
          pron_band: pron === '' ? null : Number(pron),
          examiner_band:
            computedOverall != null ? computedOverall : scoreModal.slot.examiner_band ?? null,
          examiner_feedback: feedback || null,
          examiner_reviewed_at: new Date().toISOString(),
          recording_url: recordingUrl || null,
        })
        .eq('id', scoreModal.slot.id)

      if (updateError) throw updateError

      setScoreModal(null)
      await loadAll()
    } catch (err) {
      console.error('Could not save speaking score:', err)
      setScoreError(err?.message || 'Could not save this score.')
    } finally {
      setScoreSaving(false)
    }
  }

  const sections = useMemo(
    () => [
      {
        items: [
          { key: 'home', label: 'Home', icon: IconHome, hideTitle: true },
          { key: 'students', label: 'Students', icon: IconStudents },
          { key: 'timetable', label: 'Timetable', icon: IconMockExam },
          { key: 'chats', label: 'Chats', icon: IconChat },
        ],
      },
    ],
    []
  )

  if (loading) {
    return <LoadingScreen label="Loading your dashboard…" />
  }

  return (
    <Layout sections={sections} activeTab={tab} onTabChange={setTab}>
      <div className="space-y-5">

        {tab === 'home' && (
          <SpeakingExaminerHome
            profile={profile}
            slots={slots}
            studentById={studentById}
            now={now}
            myWeekCount={myWorkload != null ? Number(myWorkload.this_week_count) : null}
            teamAverage={teamAverageThisWeek}
            onStatus={updateStatus}
            onScore={openScoreModal}
            onNavigate={setTab}
          />
        )}

        {tab === 'students' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="mr-auto text-sm text-mist max-w-2xl">
                Every candidate on the platform. Book a speaking exam slot or message a
                student directly.
              </p>
              {students.length > 0 && (
                <label className="relative w-full sm:w-72">
                  <span className="sr-only">Search students</span>
                  <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mist" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="Search students by name…"
                    className="focus-ring w-full rounded-full border border-line bg-panel py-2 pl-10 pr-4 text-sm text-paper placeholder:text-mist"
                  />
                </label>
              )}
            </div>

            {myWorkload != null && teamAverageThisWeek != null && (
              <div
                className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl px-4 py-3 text-[13px] ${
                  isOverloaded ? 'bg-urgent-tint text-urgent' : 'bg-panel-2 text-paper-dim'
                }`}
              >
                <Icon name="scale" className="h-4 w-4 shrink-0" />
                <span>
                  Your workload this week: <strong className="font-semibold">{myWorkload.this_week_count}</strong>
                  {' · '}Team average: <strong className="font-semibold">{teamAverageThisWeek.toFixed(1)}</strong>
                  {isOverloaded && ' — you\'re carrying noticeably more than others right now.'}
                </span>
              </div>
            )}

            {students.length === 0 ? (
              <EmptyCard icon={<Icon name="clipboard" className="h-6 w-6" />} title="No students yet" />
            ) : filteredStudents.length === 0 ? (
              <EmptyCard icon={<Icon name="clipboard" className="h-6 w-6" />} title="No students match" line="Try a different name or username." />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredStudents.map((student) => {
                  const booked = upcomingSlots.find((sl) => sl.student_id === student.id)
                  return (
                    <div
                      key={student.id}
                      className="rounded-[22px] border border-line bg-panel p-4 flex flex-col gap-3.5"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar person={student} size="h-11 w-11" tone="bg-speaking-tint text-speaking" />
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-paper">
                            {student.full_name || student.username}
                          </p>
                          <p className="truncate text-[13px] text-mist">@{student.username}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {student.target_band != null && (
                          <span className="inline-flex h-7 items-center rounded-lg bg-panel-2 px-2.5 text-[13px] text-paper-dim">
                            Target <span className="ml-1 font-semibold text-paper">{formatTargetBand(student.target_band)}</span>
                          </span>
                        )}
                        {booked && (
                          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-speaking-tint px-2.5 text-[13px] font-medium text-speaking">
                            <Icon name="calendar" className="h-3.5 w-3.5" />
                            {formatSlotTime(booked.scheduled_at)}
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2 mt-auto">
                        <button
                          type="button"
                          onClick={() => openBookModal(student)}
                          className="focus-ring flex-1 rounded-full bg-brass text-onbrass text-[13px] font-medium px-3 py-2 hover:bg-brass-dim transition-colors"
                        >
                          Book exam
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMessageStudent(student)}
                          className="focus-ring flex-1 rounded-full border border-line text-[13px] font-medium px-3 py-2 text-paper-dim hover:text-paper hover:border-paper/30"
                        >
                          Message
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {tab === 'timetable' && (
          <section className="space-y-5">
            <Card className="p-4 sm:p-5">
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h2 className="text-[17px] font-semibold">Upcoming</h2>
                <span className="text-[13px] text-mist tabular-nums">{upcomingSlots.length}</span>
              </div>

              {upcomingSlots.length === 0 ? (
                <div className="flex items-center gap-3 rounded-2xl bg-panel-2/60 px-4 py-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-speaking-tint text-speaking">
                    <Icon name="calendar" className="h-5 w-5" />
                  </span>
                  <p className="text-sm text-paper-dim">No upcoming speaking exams booked.</p>
                </div>
              ) : (
                <div className="flex flex-col">
                  {upcomingSlots.map((slot) => (
                    <SlotRow
                      key={slot.id}
                      slot={slot}
                      student={studentById[slot.student_id]}
                      onEdit={() => openEditModal(slot)}
                      onStatus={(status) => updateStatus(slot, status)}
                      onScore={() => openScoreModal(slot)}
                      onDelete={() => confirmDeleteSlot(slot)}
                    />
                  ))}
                </div>
              )}
            </Card>

            {pastSlots.length > 0 && (
              <Card className="p-4 sm:p-5">
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="text-[17px] font-semibold">Past and other</h2>
                  <span className="text-[13px] text-mist tabular-nums">{pastSlots.length}</span>
                </div>
                <div className="flex flex-col">
                  {pastSlots.map((slot) => (
                    <SlotRow
                      key={slot.id}
                      slot={slot}
                      student={studentById[slot.student_id]}
                      onEdit={() => openEditModal(slot)}
                      onStatus={(status) => updateStatus(slot, status)}
                      onScore={() => openScoreModal(slot)}
                      onDelete={() => confirmDeleteSlot(slot)}
                    />
                  ))}
                </div>
              </Card>
            )}
          </section>
        )}

        {tab === 'chats' && (
          <PrivateChats
            selfId={profile.id}
            selfRole="speaking_examiner"
            initialPeerId={notificationChat?.studentId}
            initialPeerName={notificationChat?.studentName}
          />
        )}
      </div>

      {bookModal && (
        <SlotModal
          mode={bookModal.mode}
          studentName={
            bookModal.mode === 'create'
              ? bookModal.student.full_name || bookModal.student.username
              : studentById[bookModal.slot.student_id]?.full_name ||
                studentById[bookModal.slot.student_id]?.username
          }
          initial={
            bookModal.mode === 'edit'
              ? {
                  scheduledAt: toLocalInputValue(new Date(bookModal.slot.scheduled_at)),
                  durationMinutes: bookModal.slot.duration_minutes,
                  meetingLink: bookModal.slot.meeting_link || '',
                  notes: bookModal.slot.notes || '',
                }
              : {
                  scheduledAt: toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000)),
                  durationMinutes: 15,
                  meetingLink: '',
                  notes: '',
                }
          }
          saving={saving}
          error={error}
          workloadNote={
            bookModal.mode === 'create' && isOverloaded
              ? `You already have ${myWorkload.this_week_count} sessions booked this week — noticeably more than the team average (${teamAverageThisWeek.toFixed(1)}). Worth booking this one if the student needs you specifically, or leaving it for a colleague otherwise.`
              : null
          }
          onCancel={() => setBookModal(null)}
          onSave={saveSlot}
        />
      )}

      {scoreModal && (
        <ScoreModal
          studentName={studentById[scoreModal.slot.student_id]?.full_name || studentById[scoreModal.slot.student_id]?.username}
          slot={scoreModal.slot}
          saving={scoreSaving}
          error={scoreError}
          onCancel={() => setScoreModal(null)}
          onSave={saveScore}
        />
      )}

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
    </Layout>
  )
}

function EmptyCard({ icon, title, line }) {
  return (
    <Card className="flex items-center gap-4 px-6 py-8">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-speaking-tint text-speaking">
        {icon || <SkillIcon skill="speaking" className="h-6 w-6" />}
      </span>
      <div>
        <p className="text-[15px] font-semibold">{title}</p>
        {line && <p className="text-sm text-mist">{line}</p>}
      </div>
    </Card>
  )
}

// Small neutral action pill used in SlotRow (2026-10-07: one calm style
// instead of five competing accent colours; behaviour unchanged).
const PILL =
  'focus-ring inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[13px] font-medium text-paper-dim transition-colors hover:border-paper/30 hover:text-paper'

function SlotRow({ slot, student, onEdit, onStatus, onScore, onDelete }) {
  const meta = STATUS_META[slot.status] || STATUS_META.scheduled
  const scored = slot.examiner_band != null || slot.examiner_feedback

  // No-show can only be reported once the exam's own scheduled time has
  // actually passed — Jasur, 2026-09-27: it shouldn't be possible to mark
  // a student a no-show before the session was even due to start.
  const slotTimeHasPassed = new Date(slot.scheduled_at).getTime() <= Date.now()
  const d = new Date(slot.scheduled_at)

  return (
    <div className="flex gap-3 border-t border-line px-1 py-3.5 first:border-0">
      <div
        className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl ${
          slot.status === 'scheduled' ? 'bg-speaking-tint text-speaking' : 'bg-panel-2 text-mist'
        }`}
      >
        <span className="text-[11px] font-medium leading-none">{d.toLocaleDateString('en-GB', { month: 'short' })}</span>
        <span className="text-[20px] font-semibold leading-tight tabular-nums">{d.getDate()}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2 justify-between">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-paper">
              {student?.full_name || student?.username || 'Student'}
            </p>
            <p className="text-[13px] text-mist mt-0.5">
              {formatSlotTime(slot.scheduled_at)} · {slot.duration_minutes} min
            </p>
            {slot.meeting_link && (
              <a
                href={slot.meeting_link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex max-w-[16rem] items-center gap-1 truncate text-[13px] font-medium text-speaking hover:underline sm:max-w-xs"
              >
                <Icon name="video" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{slot.meeting_link}</span>
              </a>
            )}
          </div>

          <span className={`inline-flex h-7 shrink-0 items-center rounded-lg px-2.5 text-[13px] font-medium ${meta.className}`}>
            {meta.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {slot.status === 'scheduled' && (
            <>
              <button
                type="button"
                onClick={() => onStatus('completed')}
                className={
                  slotTimeHasPassed
                    ? 'focus-ring inline-flex h-8 items-center rounded-full bg-brass px-3.5 text-[13px] font-medium text-onbrass transition-colors hover:bg-brass-dim'
                    : PILL
                }
              >
                Mark done
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadSpeakingSlotIcs(slot, {
                    summary: `IELTS Speaking Mock Exam — ${student?.full_name || student?.username || 'Student'}`,
                    description: slot.notes || undefined,
                  })
                }
                className={PILL}
                title="Download a calendar file for this slot"
              >
                <Icon name="calendar" className="h-3.5 w-3.5" /> Calendar
              </button>
              <button type="button" onClick={onEdit} className={PILL}>
                <Icon name="pencil" className="h-3.5 w-3.5" /> Edit
              </button>
              <button
                type="button"
                onClick={() => onStatus('no_show')}
                disabled={!slotTimeHasPassed}
                className={`${PILL} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-paper-dim`}
                title={
                  slotTimeHasPassed
                    ? "Student didn't attend — notifies the teacher"
                    : "Can't mark no-show until this slot's scheduled time has passed"
                }
              >
                No-show
              </button>
              <button
                type="button"
                onClick={() => onStatus('cancelled')}
                className={`${PILL} hover:border-urgent/40 hover:text-urgent`}
              >
                Cancel
              </button>
            </>
          )}

          {slot.status === 'completed' && (
            <>
              {slot.examiner_band != null ? (
                <span className="inline-flex h-8 items-center rounded-lg bg-reading-tint px-2.5 text-[13px] font-semibold tabular-nums text-reading">
                  Band {formatBand(slot.examiner_band)}
                </span>
              ) : (
                <span className="inline-flex h-8 items-center rounded-lg bg-speaking-tint px-2.5 text-[13px] font-medium text-speaking">
                  Not marked
                </span>
              )}
              <button
                type="button"
                onClick={onScore}
                className="focus-ring inline-flex h-8 items-center rounded-full bg-brass px-3.5 text-[13px] font-medium text-onbrass transition-colors hover:bg-brass-dim"
              >
                {scored ? 'View / edit' : 'Mark'}
              </button>
            </>
          )}

          {(slot.status === 'cancelled' || slot.status === 'no_show') && (
            <button
              type="button"
              onClick={onDelete}
              className={`${PILL} hover:border-urgent/40 hover:text-urgent`}
              title="Remove this slot from your timetable"
            >
              <Icon name="trash" className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>

        {slot.examiner_feedback && (
          <p className="rounded-xl bg-panel-2/70 px-3 py-2 text-[13px] text-paper-dim whitespace-pre-wrap">{slot.examiner_feedback}</p>
        )}

        {slot.recording_url && (
          <a
            href={slot.recording_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-xs items-center gap-1 truncate text-[13px] font-medium text-speaking hover:underline"
          >
            <Icon name="mic" className="h-3.5 w-3.5" /> Session recording
          </a>
        )}
      </div>
    </div>
  )
}

function ScoreModal({ studentName, slot, saving, error, onCancel, onSave }) {
  const [criteria, setCriteria] = useState({
    fc: slot.fc_band ?? '',
    lr: slot.lr_band ?? '',
    gra: slot.gra_band ?? '',
    pron: slot.pron_band ?? '',
  })
  const [feedback, setFeedback] = useState(slot.examiner_feedback || '')
  const [recordingUrl, setRecordingUrl] = useState(slot.recording_url || '')

  const computedOverall = computeOverallBand([criteria.fc, criteria.lr, criteria.gra, criteria.pron])
  const displayOverall = computedOverall != null ? computedOverall : slot.examiner_band ?? null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[22px] border border-line bg-panel shadow-xl p-5 sm:p-6">
        <h3 className="text-lg font-semibold text-paper">Score speaking exam</h3>
        <p className="text-sm text-mist mt-0.5">{studentName}</p>
        <p className="text-[13px] text-mist mt-0.5">{formatSlotTime(slot.scheduled_at)}</p>

        <div className="mt-4 flex flex-col gap-3">
          <div>
            <p className="mb-2 text-sm font-semibold text-paper">
              Criteria marks
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {SPEAKING_CRITERIA.map((c) => (
                <label key={c.key} className="text-[12px] text-mist">
                  {c.label}
                  <input
                    type="number"
                    min="0"
                    max="9"
                    step="0.5"
                    value={criteria[c.key]}
                    onChange={(e) => setCriteria((prev) => ({ ...prev, [c.key]: e.target.value }))}
                    className="focus-ring mt-1 w-full rounded-xl border border-line bg-panel-2 px-2.5 py-2 text-sm text-paper"
                  />
                </label>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="text-[13px] font-medium text-mist">
                Overall band
              </span>
              <span className="inline-flex h-7 items-center rounded-lg bg-speaking-tint px-2.5 text-sm font-semibold tabular-nums text-speaking">
                {formatBand(displayOverall)}
              </span>
              <span className="text-[11px] text-mist">
                {computedOverall != null
                  ? 'calculated from the four criteria'
                  : 'fill in all four to calculate'}
              </span>
            </div>
          </div>

          <label className="text-[13px] font-medium text-mist">
            Feedback
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              placeholder="Fluency, pronunciation, grammar, what to improve…"
              className="focus-ring mt-1 w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-paper resize-none"
            />
          </label>

          <label className="text-[13px] font-medium text-mist">
            Recording link (optional)
            <input
              type="url"
              placeholder="https://drive.google.com/..."
              value={recordingUrl}
              onChange={(e) => setRecordingUrl(e.target.value)}
              className="focus-ring mt-1 w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>
          <p className="text-xs text-mist -mt-2">
            Paste the cloud-recording link once it's uploaded — the student and teacher will see it here too.
          </p>
        </div>

        {error && <p className="text-coral text-sm mt-3">{error}</p>}

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="focus-ring rounded-full border border-line bg-panel-2 px-4 py-2 text-sm font-semibold text-paper-dim shadow-sm transition-colors hover:border-brass/50 hover:text-brass disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                fc: criteria.fc,
                lr: criteria.lr,
                gra: criteria.gra,
                pron: criteria.pron,
                feedback,
                recordingUrl,
              })
            }
            disabled={saving}
            className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save score'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SlotModal({ mode, studentName, initial, saving, error, workloadNote, onCancel, onSave }) {
  const [scheduledAt, setScheduledAt] = useState(initial.scheduledAt)
  const [durationMinutes, setDurationMinutes] = useState(initial.durationMinutes)
  const [meetingLink, setMeetingLink] = useState(initial.meetingLink)
  const [notes, setNotes] = useState(initial.notes)

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[22px] border border-line bg-panel shadow-xl p-5 sm:p-6">
        <h3 className="text-lg font-semibold text-paper">
          {mode === 'create' ? 'Book speaking exam' : 'Edit speaking exam'}
        </h3>
        <p className="text-sm text-mist mt-0.5">{studentName}</p>

        {workloadNote && (
          <div className="mt-3 flex gap-2 rounded-xl bg-urgent-tint px-3 py-2.5 text-[13px] text-urgent">
            <Icon name="scale" className="h-3.5 w-3.5" /> {workloadNote}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-[13px] font-medium text-mist">
            Date &amp; time
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="focus-ring mt-1 w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>

          <label className="text-[13px] font-medium text-mist">
            Duration (minutes)
            <input
              type="number"
              min="5"
              max="60"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className="focus-ring mt-1 w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>

          <label className="text-[13px] font-medium text-mist">
            Meeting link
            <input
              type="url"
              placeholder="https://meet.google.com/..."
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              className="focus-ring mt-1 w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>

          <label className="text-[13px] font-medium text-mist">
            Notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="focus-ring mt-1 w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-paper resize-none"
            />
          </label>
        </div>

        {error && <p className="text-coral text-sm mt-3">{error}</p>}

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="focus-ring rounded-full border border-line bg-panel-2 px-4 py-2 text-sm font-semibold text-paper-dim shadow-sm transition-colors hover:border-brass/50 hover:text-brass disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                scheduledAt,
                durationMinutes,
                meetingLink,
                notes,
              })
            }
            disabled={saving || !scheduledAt}
            className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
