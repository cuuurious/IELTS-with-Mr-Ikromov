import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout, { IconStudents, IconMockExam, IconChat } from '../../components/Layout'
import LoadingScreen from '../../components/LoadingScreen'
import PrivateChats from '../../components/PrivateChats'
import { formatTargetBand } from '../../lib/targetBands'

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

const STATUS_META = {
  scheduled: { label: 'Scheduled', className: 'text-brass border-brass-dim/30 bg-brass/10' },
  completed: { label: 'Completed', className: 'text-sage border-sage/30 bg-sage/10' },
  cancelled: { label: 'Cancelled', className: 'text-mist border-line bg-panel-2' },
  no_show: { label: 'No-show', className: 'text-coral border-coral/30 bg-coral/10' },
}

export default function SpeakingExaminerDashboard() {
  const { profile } = useAuth()

  const [tab, setTab] = useState('students')
  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState([])
  const [slots, setSlots] = useState([])

  const [notificationChat, setNotificationChat] = useState(null)

  const [bookModal, setBookModal] = useState(null) // { student } or { slot } for edit
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [scoreModal, setScoreModal] = useState(null) // { slot } once a session is completed
  const [scoreSaving, setScoreSaving] = useState(false)
  const [scoreError, setScoreError] = useState('')

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

    const channel = supabase
      .channel('speaking-slots-examiner')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mock_speaking_slots', filter: `examiner_id=eq.${profile.id}` },
        loadAll
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const studentById = useMemo(() => {
    const map = {}
    students.forEach((s) => { map[s.id] = s })
    return map
  }, [students])

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

  const saveScore = async ({ band, feedback }) => {
    setScoreSaving(true)
    setScoreError('')

    try {
      const { error: updateError } = await supabase
        .from('mock_speaking_slots')
        .update({
          examiner_band: band === '' ? null : Number(band),
          examiner_feedback: feedback || null,
          examiner_reviewed_at: new Date().toISOString(),
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

        {tab === 'students' && (
          <section className="space-y-4">
            <p className="text-sm text-mist max-w-2xl">
              Every candidate on the platform. Book a speaking exam slot or message a
              student directly.
            </p>

            {students.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center">
                <h2 className="font-display text-xl">No students yet</h2>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {students.map((student) => (
                  <div
                    key={student.id}
                    className="rounded-2xl border border-line bg-panel shadow-sm p-4 flex flex-col gap-3"
                  >
                    <div>
                      <p className="font-display text-base text-paper truncate">
                        {student.full_name || student.username}
                      </p>
                      <p className="text-xs text-mist font-mono">@{student.username}</p>
                      {student.target_band != null && (
                        <p className="text-xs text-brass mt-1">
                          Target {formatTargetBand(student.target_band)}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2 mt-auto">
                      <button
                        type="button"
                        onClick={() => openBookModal(student)}
                        className="focus-ring flex-1 rounded-full bg-brass text-onbrass text-xs font-semibold px-3 py-2 hover:scale-[1.02] transition-transform"
                      >
                        Book exam
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMessageStudent(student)}
                        className="focus-ring flex-1 rounded-full border border-line text-xs font-medium px-3 py-2 text-mist hover:text-paper hover:border-brass/40"
                      >
                        Message
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'timetable' && (
          <section className="space-y-6">
            <div>
              <h3 className="font-display text-lg text-paper mb-2.5">Upcoming</h3>

              {upcomingSlots.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line bg-panel/80 px-5 py-8 text-center text-sm text-mist">
                  No upcoming speaking exams booked.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {upcomingSlots.map((slot) => (
                    <SlotRow
                      key={slot.id}
                      slot={slot}
                      student={studentById[slot.student_id]}
                      onEdit={() => openEditModal(slot)}
                      onStatus={(status) => updateStatus(slot, status)}
                      onScore={() => openScoreModal(slot)}
                    />
                  ))}
                </div>
              )}
            </div>

            {pastSlots.length > 0 && (
              <div>
                <h3 className="font-display text-lg text-paper mb-2.5">Past / other</h3>
                <div className="space-y-2.5">
                  {pastSlots.map((slot) => (
                    <SlotRow
                      key={slot.id}
                      slot={slot}
                      student={studentById[slot.student_id]}
                      onEdit={() => openEditModal(slot)}
                      onStatus={(status) => updateStatus(slot, status)}
                      onScore={() => openScoreModal(slot)}
                    />
                  ))}
                </div>
              </div>
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
    </Layout>
  )
}

function SlotRow({ slot, student, onEdit, onStatus, onScore }) {
  const meta = STATUS_META[slot.status] || STATUS_META.scheduled
  const scored = slot.examiner_band != null || slot.examiner_feedback

  return (
    <div className="rounded-2xl border border-line bg-panel shadow-sm p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="min-w-0">
          <p className="font-medium text-paper truncate">
            {student?.full_name || student?.username || 'Student'}
          </p>
          <p className="text-xs text-mist font-mono mt-0.5">
            {formatSlotTime(slot.scheduled_at)} · {slot.duration_minutes} min
          </p>
          {slot.meeting_link && (
            <a
              href={slot.meeting_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brass hover:text-brass-dim mt-0.5 inline-block truncate max-w-xs"
            >
              {slot.meeting_link}
            </a>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2.5 py-1 ${meta.className}`}>
            {meta.label}
          </span>

          {slot.status === 'scheduled' && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="focus-ring text-xs text-mist hover:text-paper px-2 py-1"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onStatus('completed')}
                className="focus-ring text-xs text-sage hover:text-sage/80 px-2 py-1"
              >
                Mark done
              </button>
              <button
                type="button"
                onClick={() => onStatus('cancelled')}
                className="focus-ring text-xs text-coral hover:text-coral/80 px-2 py-1"
              >
                Cancel
              </button>
            </>
          )}

          {slot.status === 'completed' && (
            <>
              {slot.examiner_band != null ? (
                <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full border border-sage/30 bg-sage/10 text-sage px-2.5 py-1">
                  Band {slot.examiner_band}
                </span>
              ) : (
                <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full border border-amber/30 bg-amber/10 text-amber px-2.5 py-1">
                  Not marked
                </span>
              )}
              <button
                type="button"
                onClick={onScore}
                className="focus-ring rounded-full bg-brass text-onbrass text-xs font-semibold px-3.5 py-1.5 shadow-sm hover:bg-brass-dim transition-colors"
              >
                {scored ? 'View / edit' : 'Mark'}
              </button>
            </>
          )}
        </div>
      </div>

      {slot.examiner_feedback && (
        <p className="text-xs text-mist whitespace-pre-wrap">{slot.examiner_feedback}</p>
      )}
    </div>
  )
}

function ScoreModal({ studentName, slot, saving, error, onCancel, onSave }) {
  const [band, setBand] = useState(slot.examiner_band ?? '')
  const [feedback, setFeedback] = useState(slot.examiner_feedback || '')

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel shadow-xl p-5 sm:p-6">
        <h3 className="font-display text-lg text-paper">Score speaking exam</h3>
        <p className="text-sm text-mist mt-0.5">{studentName}</p>
        <p className="text-xs text-mist font-mono mt-0.5">{formatSlotTime(slot.scheduled_at)}</p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Band
            <input
              type="number"
              min="0"
              max="9"
              step="0.5"
              value={band}
              onChange={(e) => setBand(e.target.value)}
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Feedback
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              placeholder="Fluency, pronunciation, grammar, what to improve…"
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper resize-none"
            />
          </label>
        </div>

        {error && <p className="text-coral text-sm mt-3">{error}</p>}

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="focus-ring rounded-full px-4 py-2 text-sm text-mist hover:text-paper disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave({ band, feedback })}
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

function SlotModal({ mode, studentName, initial, saving, error, onCancel, onSave }) {
  const [scheduledAt, setScheduledAt] = useState(initial.scheduledAt)
  const [durationMinutes, setDurationMinutes] = useState(initial.durationMinutes)
  const [meetingLink, setMeetingLink] = useState(initial.meetingLink)
  const [notes, setNotes] = useState(initial.notes)

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel shadow-xl p-5 sm:p-6">
        <h3 className="font-display text-lg text-paper">
          {mode === 'create' ? 'Book speaking exam' : 'Edit speaking exam'}
        </h3>
        <p className="text-sm text-mist mt-0.5">{studentName}</p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Date &amp; time
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Duration (minutes)
            <input
              type="number"
              min="5"
              max="60"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Meeting link
            <input
              type="url"
              placeholder="https://meet.google.com/..."
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Notes (optional)
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper resize-none"
            />
          </label>
        </div>

        {error && <p className="text-coral text-sm mt-3">{error}</p>}

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="focus-ring rounded-full px-4 py-2 text-sm text-mist hover:text-paper disabled:opacity-50"
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
