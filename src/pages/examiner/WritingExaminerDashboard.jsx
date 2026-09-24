import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout, { IconHomework, IconChat } from '../../components/Layout'
import LoadingScreen from '../../components/LoadingScreen'
import PrivateChats from '../../components/PrivateChats'
import { countWords } from '../../lib/writingMock'

/*
 * ================================================================
 * WRITING EXAMINER DASHBOARD
 * ================================================================
 * Shipped 2026-09-24, sibling to SpeakingExaminerDashboard.jsx. Sits
 * entirely on top of the EXISTING Writing Mock Test system —
 * homeworks.homework_type = 'writing_mock' + submissions.mock_essay —
 * not the newer mock_exams/mock_attempts reading & listening tables,
 * which is a separate, unrelated system.
 *
 * "Review queue" is two sections, Task 1s and Task 2s, each ordered
 * by student name, per Jasur's spec. A 'full' mode submission (Task 1
 * + Task 2 in one sitting) appears in both sections since each task
 * gets read on its own — but it's still ONE submission row with ONE
 * band/feedback pair (that's the schema migration_29 added), so
 * marking it from either section reviews the whole thing.
 * ================================================================
 */

function studentLabel(student) {
  return student?.full_name || student?.username || 'Student'
}

export default function WritingExaminerDashboard() {
  const { profile } = useAuth()

  const [tab, setTab] = useState('task1')
  const [loading, setLoading] = useState(true)
  const [homeworks, setHomeworks] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [studentsById, setStudentsById] = useState({})
  const [reviewTarget, setReviewTarget] = useState(null)
  const [notificationChat, setNotificationChat] = useState(null)

  const loadAll = async () => {
    const { data: hwRows, error: hwError } = await supabase
      .from('homeworks')
      .select('*')
      .eq('homework_type', 'writing_mock')

    if (hwError) {
      console.error('Failed to load writing mock homeworks:', hwError)
      setLoading(false)
      return
    }

    const homeworkIds = (hwRows || []).map((h) => h.id)

    if (homeworkIds.length === 0) {
      setHomeworks([])
      setSubmissions([])
      setLoading(false)
      return
    }

    const { data: subRows, error: subError } = await supabase
      .from('submissions')
      .select('*')
      .in('homework_id', homeworkIds)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })

    if (subError) {
      console.error('Failed to load writing mock submissions:', subError)
    }

    const studentIds = [...new Set((subRows || []).map((s) => s.student_id))]

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

    setHomeworks(hwRows || [])
    setSubmissions(subRows || [])
    setStudentsById(studentMap)
    setLoading(false)
  }

  useEffect(() => {
    if (!profile?.id) return
    loadAll()

    const channel = supabase
      .channel('writing-examiner-submissions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, loadAll)
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const homeworkById = useMemo(() => {
    const map = {}
    homeworks.forEach((h) => { map[h.id] = h })
    return map
  }, [homeworks])

  const { task1Queue, task2Queue } = useMemo(() => {
    const t1 = []
    const t2 = []

    submissions.forEach((submission) => {
      const homework = homeworkById[submission.homework_id]
      if (!homework) return

      const mockEssay = submission.mock_essay || {}
      const student = studentsById[submission.student_id]
      const mode = homework.mock_task_mode

      const entry = { submission, homework, student, mockEssay }

      if ((mode === 'task1' || mode === 'full') && mockEssay.task1_text) {
        t1.push(entry)
      }
      if ((mode === 'task2' || mode === 'full') && mockEssay.task2_text) {
        t2.push(entry)
      }
    })

    const byName = (a, b) =>
      studentLabel(a.student).localeCompare(studentLabel(b.student))

    t1.sort(byName)
    t2.sort(byName)

    return { task1Queue: t1, task2Queue: t2 }
  }, [submissions, homeworkById, studentsById])

  const handleMessageStudent = (student) => {
    if (!student?.id) return
    setNotificationChat({ studentId: student.id, studentName: studentLabel(student) })
    setTab('chats')
  }

  const saveReview = async ({ band, feedback }) => {
    const { submission } = reviewTarget

    const { error: updateError } = await supabase
      .from('submissions')
      .update({
        examiner_band: band === '' ? null : Number(band),
        examiner_feedback: feedback || null,
        examiner_reviewed_by: profile.id,
        examiner_reviewed_at: new Date().toISOString(),
      })
      .eq('id', submission.id)

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
            title="Task 1s"
            blurb="Every Task 1 writing mock waiting to be marked, oldest submitted first isn't required — sorted by student name."
            entries={task1Queue}
            taskKey="task1_text"
            onOpen={setReviewTarget}
            onMessage={handleMessageStudent}
          />
        )}

        {tab === 'task2' && (
          <QueueSection
            title="Task 2s"
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

function QueueSection({ title, blurb, entries, taskKey, onOpen, onMessage }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-xl text-paper">{title}</h2>
        <p className="text-sm text-mist mt-1 max-w-2xl">{blurb}</p>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
          Nothing to review here right now.
        </div>
      ) : (
        <div className="space-y-2.5">
          {entries.map((entry) => {
            const reviewed = Boolean(entry.submission.examiner_reviewed_at)
            const words = countWords(entry.mockEssay[taskKey])

            return (
              <div
                key={entry.submission.id + taskKey}
                className="rounded-2xl border border-line bg-panel shadow-sm p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-paper truncate">
                    {studentLabel(entry.student)}
                  </p>
                  <p className="text-xs text-mist font-mono mt-0.5">
                    {entry.homework.title} · {words} words
                    {entry.submission.submitted_at &&
                      ` · submitted ${new Date(entry.submission.submitted_at).toLocaleDateString()}`}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {reviewed ? (
                    <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full border border-sage/30 bg-sage/10 text-sage px-2.5 py-1">
                      Band {entry.submission.examiner_band ?? '—'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold uppercase tracking-wide rounded-full border border-line bg-panel-2 text-mist px-2.5 py-1">
                      Not marked
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => onMessage(entry.student)}
                    className="focus-ring text-xs text-mist hover:text-paper px-2 py-1"
                  >
                    Message
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpen(entry)}
                    className="focus-ring rounded-full bg-brass text-onbrass text-xs font-semibold px-3.5 py-1.5"
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
  const { submission, homework, student, mockEssay } = entry

  const [band, setBand] = useState(submission.examiner_band ?? '')
  const [feedback, setFeedback] = useState(submission.examiner_feedback || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeTask, setActiveTask] = useState(mockEssay.task1_text ? 'task1' : 'task2')

  const tasksAvailable = [
    mockEssay.task1_text ? 'task1' : null,
    mockEssay.task2_text ? 'task2' : null,
  ].filter(Boolean)

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await onSave({ band, feedback })
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
            <p className="text-xs text-mist font-mono mt-0.5">{homework.title}</p>
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
          {activeTask === 'task1' && homework.mock_task1_prompt && (
            <div className="rounded-lg border border-line bg-panel-2 p-3 text-sm text-paper-dim whitespace-pre-wrap">
              {homework.mock_task1_prompt}
            </div>
          )}
          {activeTask === 'task2' && homework.mock_task2_prompt && (
            <div className="rounded-lg border border-line bg-panel-2 p-3 text-sm text-paper-dim whitespace-pre-wrap">
              {homework.mock_task2_prompt}
            </div>
          )}

          {activeTask === 'task1' && homework.mock_task1_image_url && (
            <img
              src={homework.mock_task1_image_url}
              alt="Task 1 chart"
              className="max-h-64 rounded-lg border border-line object-contain"
            />
          )}

          <div className="rounded-lg border border-line bg-panel-2 p-4 text-sm leading-relaxed text-paper whitespace-pre-wrap max-h-96 overflow-y-auto">
            {mockEssay[`${activeTask}_text`] || 'No answer written.'}
          </div>

          <p className="text-xs text-mist font-mono">
            {countWords(mockEssay[`${activeTask}_text`])} words
          </p>
        </div>

        <div className="mt-5 border-t border-line pt-4 grid gap-3 sm:grid-cols-[120px_1fr]">
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
