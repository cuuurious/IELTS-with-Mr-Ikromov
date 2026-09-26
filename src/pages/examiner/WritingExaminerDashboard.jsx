import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout, { IconHomework, IconChat } from '../../components/Layout'
import LoadingScreen from '../../components/LoadingScreen'
import PrivateChats from '../../components/PrivateChats'
import { countWords } from '../../lib/writingMock'
import { roundOverallBand, formatBand } from '../../lib/ieltsBands'

/*
 * ================================================================
 * WRITING EXAMINER DASHBOARD
 * ================================================================
 * Rewritten 2026-09-24 (migration_34) to read from the brand new,
 * wholly self-service writing_mock_exams / writing_mock_attempts
 * tables instead of homeworks/submissions.
 *
 * Jasur's own words, verbatim: "only when students take the full mock
 * which will be in a different dashboard not in a homework, basically
 * everything teacher posts is homework be it full or not full writing
 * they are separate." So ANY homework a teacher posts to a group —
 * regardless of task mode — is homework: AI-graded, teacher-reviewed,
 * and PERMANENTLY invisible here. This dashboard now only ever reads
 * writing_mock_attempts, which a student can only create by sitting a
 * mock themselves from their own Mock Test Center (WritingMockExam.jsx)
 * — no teacher, no group, no homework row involved anywhere.
 *
 * "Review queue" is still two sections, Task 1s and Task 2s, ordered
 * by student name. Every attempt here is inherently "the whole mock"
 * now (there's no other kind in this system), so the split just checks
 * whether an attempt has task1_text — an attempt with only a Task 2
 * prompt (writing_mock_exams.task1_prompt left blank) never appears in
 * Task 1s at all.
 * ================================================================
 */

function studentLabel(student) {
  return student?.full_name || student?.username || 'Student'
}

// The four IELTS Writing criteria, added 2026-09-26 (migration_49) so an
// examiner's report is a real breakdown, not just one number. Locked with
// Jasur via AskUserQuestion the same day: the overall band is calculated
// from these four, never typed in separately — only once all four are
// filled in, so editing feedback alone on an older, already-marked
// attempt (which has no breakdown) never overwrites its existing
// examiner_band with a bogus average of blanks.
const WRITING_CRITERIA = [
  { key: 'ta', label: 'Task Achievement / Response' },
  { key: 'cc', label: 'Coherence & Cohesion' },
  { key: 'lr', label: 'Lexical Resource' },
  { key: 'gra', label: 'Grammatical Range & Accuracy' },
]

function computeOverallBand(criteriaValues) {
  const nums = criteriaValues.map((v) => (v === '' || v == null ? null : Number(v)))
  if (nums.some((n) => n == null || Number.isNaN(n))) return null
  return roundOverallBand(nums.reduce((sum, n) => sum + n, 0) / nums.length)
}

export default function WritingExaminerDashboard() {
  const { profile } = useAuth()

  const [tab, setTab] = useState('task1')
  const [loading, setLoading] = useState(true)
  const [exams, setExams] = useState([])
  const [attempts, setAttempts] = useState([])
  const [studentsById, setStudentsById] = useState({})
  const [reviewTarget, setReviewTarget] = useState(null)
  const [notificationChat, setNotificationChat] = useState(null)

  const loadAll = async () => {
    const { data: examRows, error: examsError } = await supabase
      .from('writing_mock_exams')
      .select('*')

    if (examsError) {
      console.error('Failed to load writing mock exams:', examsError)
    }

    const { data: attemptRows, error: attemptError } = await supabase
      .from('writing_mock_attempts')
      .select('*')
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })

    if (attemptError) {
      console.error('Failed to load writing mock attempts:', attemptError)
    }

    const studentIds = [...new Set((attemptRows || []).map((a) => a.student_id))]

    let studentMap = {}

    if (studentIds.length > 0) {
      const { data: studentRows, error: studentsError } = await supabase
        .from('profiles')
        .select('id, full_name, username')
        .in('id', studentIds)

      if (studentsError) {
        console.error('Failed to load students for review queue:', studentsError)
      }

      ;(studentRows || []).forEach((s) => { studentMap[s.id] = s })
    }

    setExams(examRows || [])
    setAttempts(attemptRows || [])
    setStudentsById(studentMap)
    setLoading(false)
  }

  useEffect(() => {
    if (!profile?.id) return
    loadAll()

    const channel = supabase
      .channel('writing-examiner-attempts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'writing_mock_attempts' }, loadAll)
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const examById = useMemo(() => {
    const map = {}
    exams.forEach((e) => { map[e.id] = e })
    return map
  }, [exams])

  const { task1Queue, task2Queue } = useMemo(() => {
    const t1 = []
    const t2 = []

    attempts.forEach((attempt) => {
      const exam = examById[attempt.exam_id]
      if (!exam) return

      const student = studentsById[attempt.student_id]
      const entry = { attempt, exam, student }

      if (attempt.task1_text) t1.push(entry)
      if (attempt.task2_text) t2.push(entry)
    })

    const byName = (a, b) =>
      studentLabel(a.student).localeCompare(studentLabel(b.student))

    t1.sort(byName)
    t2.sort(byName)

    return { task1Queue: t1, task2Queue: t2 }
  }, [attempts, examById, studentsById])

  const handleMessageStudent = (student) => {
    if (!student?.id) return
    setNotificationChat({ studentId: student.id, studentName: studentLabel(student) })
    setTab('chats')
  }

  const saveReview = async ({ ta, cc, lr, gra, feedback }) => {
    const { attempt } = reviewTarget
    const computedOverall = computeOverallBand([ta, cc, lr, gra])

    const { error: updateError } = await supabase
      .from('writing_mock_attempts')
      .update({
        ta_band: ta === '' ? null : Number(ta),
        cc_band: cc === '' ? null : Number(cc),
        lr_band: lr === '' ? null : Number(lr),
        gra_band: gra === '' ? null : Number(gra),
        // Only overwrite the overall band once all four criteria are
        // filled — otherwise leave whatever was already there (e.g. an
        // older attempt marked before the breakdown existed, or a
        // feedback-only edit) untouched.
        examiner_band: computedOverall != null ? computedOverall : attempt.examiner_band ?? null,
        examiner_feedback: feedback || null,
        examiner_reviewed_by: profile.id,
        examiner_reviewed_at: new Date().toISOString(),
      })
      .eq('id', attempt.id)

    if (updateError) {
      console.error('Could not save review:', updateError)
      throw updateError
    }

    setReviewTarget(null)
    await loadAll()
  }

  const sections = useMemo(
    () => [
      {
        items: [
          { key: 'task1', label: 'Task 1s', icon: IconHomework },
          { key: 'task2', label: 'Task 2s', icon: IconHomework },
          { key: 'chats', label: 'Chats', icon: IconChat },
        ],
      },
    ],
    []
  )

  if (loading) {
    return <LoadingScreen label="Loading your review queue…" />
  }

  return (
    <Layout sections={sections} activeTab={tab} onTabChange={setTab}>
      <div className="space-y-5">

        {tab === 'task1' && (
          <QueueSection
            blurb="Every Task 1 writing mock waiting to be marked, sorted by student name."
            entries={task1Queue}
            taskKey="task1_text"
            onOpen={setReviewTarget}
            onMessage={handleMessageStudent}
          />
        )}

        {tab === 'task2' && (
          <QueueSection
            blurb="Every Task 2 writing mock waiting to be marked, sorted by student name."
            entries={task2Queue}
            taskKey="task2_text"
            onOpen={setReviewTarget}
            onMessage={handleMessageStudent}
          />
        )}

        {tab === 'chats' && (
          <PrivateChats
            selfId={profile.id}
            selfRole="writing_examiner"
            initialPeerId={notificationChat?.studentId}
            initialPeerName={notificationChat?.studentName}
          />
        )}
      </div>

      {reviewTarget && (
        <ReviewModal
          entry={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onSave={saveReview}
        />
      )}
    </Layout>
  )
}

// No repeated title here — Layout's own sidebar/header already says
// "Task 1s" / "Task 2s", so this only carries the one line of context
// that isn't shown anywhere else (per Jasur: "repetitions should be
// removed from each dashboard be it teacher/examiner or student").
function QueueSection({ blurb, entries, taskKey, onOpen, onMessage }) {
  return (
    <section className="space-y-3">
      <p className="text-sm text-mist max-w-2xl">{blurb}</p>

      {entries.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
          Nothing to review here right now.
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map((entry) => {
            const reviewed = Boolean(entry.attempt.examiner_reviewed_at)
            const words = countWords(entry.attempt[taskKey])

            return (
              <div
                key={entry.attempt.id + taskKey}
                className="rounded-2xl border border-line bg-panel shadow-sm p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-paper truncate">
                    {studentLabel(entry.student)}
                  </p>
                  <p className="text-xs text-mist font-mono mt-0.5">
                    {entry.exam.title} · {words} words
                    {entry.attempt.submitted_at &&
                      ` · submitted ${new Date(entry.attempt.submitted_at).toLocaleDateString()}`}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {reviewed ? (
                    <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full border border-sage/30 bg-sage/10 text-sage px-2.5 py-1">
                      Band {entry.attempt.examiner_band ?? '—'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full border border-amber/30 bg-amber/10 text-amber px-2.5 py-1">
                      Not marked
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => onMessage(entry.student)}
                    className="focus-ring rounded-full border border-line text-xs font-medium text-mist hover:text-paper hover:border-brass/40 px-3 py-1.5 transition-colors"
                  >
                    Message
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpen(entry)}
                    className="focus-ring rounded-full bg-brass text-onbrass text-xs font-semibold px-3.5 py-1.5 shadow-sm hover:bg-brass-dim transition-colors"
                  >
                    {reviewed ? 'View / edit' : 'Mark'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ReviewModal({ entry, onClose, onSave }) {
  const { attempt, exam, student } = entry

  const [criteria, setCriteria] = useState({
    ta: attempt.ta_band ?? '',
    cc: attempt.cc_band ?? '',
    lr: attempt.lr_band ?? '',
    gra: attempt.gra_band ?? '',
  })
  const [feedback, setFeedback] = useState(attempt.examiner_feedback || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeTask, setActiveTask] = useState(attempt.task1_text ? 'task1' : 'task2')

  const tasksAvailable = [
    attempt.task1_text ? 'task1' : null,
    attempt.task2_text ? 'task2' : null,
  ].filter(Boolean)

  const computedOverall = computeOverallBand([criteria.ta, criteria.cc, criteria.lr, criteria.gra])
  const displayOverall = computedOverall != null ? computedOverall : attempt.examiner_band ?? null

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await onSave({ ta: criteria.ta, cc: criteria.cc, lr: criteria.lr, gra: criteria.gra, feedback })
    } catch (err) {
      setError(err?.message || 'Could not save this review.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg text-paper">{studentLabel(student)}</h3>
            <p className="text-xs text-mist font-mono mt-0.5">{exam.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring text-mist hover:text-paper text-sm"
          >
            Close
          </button>
        </div>

        {tasksAvailable.length > 1 && (
          <div className="flex gap-2 mt-4 border-b border-line pb-3">
            {tasksAvailable.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTask(t)}
                className={`focus-ring px-3 py-1.5 rounded-md text-sm font-medium ${
                  activeTask === t ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
                }`}
              >
                {t === 'task1' ? 'Task 1' : 'Task 2'}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-4">
          {activeTask === 'task1' && exam.task1_prompt && (
            <div className="rounded-lg border border-line bg-panel-2 p-3 text-sm text-paper-dim whitespace-pre-wrap">
              {exam.task1_prompt}
            </div>
          )}
          {activeTask === 'task2' && exam.task2_prompt && (
            <div className="rounded-lg border border-line bg-panel-2 p-3 text-sm text-paper-dim whitespace-pre-wrap">
              {exam.task2_prompt}
            </div>
          )}

          {activeTask === 'task1' && exam.task1_image_url && (
            <img
              src={exam.task1_image_url}
              alt="Task 1 chart"
              className="max-h-64 rounded-lg border border-line object-contain"
            />
          )}

          <div className="rounded-lg border border-line bg-panel-2 p-4 text-sm leading-relaxed text-paper whitespace-pre-wrap max-h-96 overflow-y-auto">
            {attempt[`${activeTask}_text`] || 'No answer written.'}
          </div>

          <p className="text-xs text-mist font-mono">
            {countWords(attempt[`${activeTask}_text`])} words
          </p>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs text-mist font-mono uppercase tracking-wide mb-2">
            Criteria marks
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {WRITING_CRITERIA.map((c) => (
              <label key={c.key} className="text-[11px] text-mist">
                {c.label}
                <input
                  type="number"
                  min="0"
                  max="9"
                  step="0.5"
                  value={criteria[c.key]}
                  onChange={(e) => setCriteria((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-sm text-paper"
                />
              </label>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-mist font-mono uppercase tracking-wide">
              Overall band
            </span>
            <span className="text-sm font-semibold text-paper">
              {formatBand(displayOverall)}
            </span>
            <span className="text-[11px] text-mist">
              {computedOverall != null
                ? '— calculated from the four criteria'
                : 'fill in all four to calculate'}
            </span>
          </div>

          <label className="mt-4 block text-xs text-mist font-mono uppercase tracking-wide">
            Feedback
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              placeholder="What went well, what to improve…"
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper resize-none"
            />
          </label>
        </div>

        {error && <p className="text-coral text-sm mt-3">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="focus-ring rounded-full px-4 py-2 text-sm text-mist hover:text-paper disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save review'}
          </button>
        </div>
      </div>
    </div>
  )
}
