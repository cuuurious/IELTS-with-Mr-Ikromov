import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout, { IconHome, IconHomework, IconChat } from '../../components/Layout'
import LoadingScreen from '../../components/LoadingScreen'
import PrivateChats from '../../components/PrivateChats'
import { countWords } from '../../lib/writingMock'
import { roundOverallBand, formatBand } from '../../lib/ieltsBands'
import { fetchAll } from '../../lib/fetchAll'
import Icon from '../../components/Icon'
import { SkillIcon } from '../../components/SkillArt'
import WritingExaminerHome from './WritingExaminerHome'
import { Card, Avatar, timeAgo, ageLabel, DAY } from './ExaminerHomeParts'

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

  const [tab, setTab] = useState('home')
  const [loading, setLoading] = useState(true)
  const [exams, setExams] = useState([])
  const [attempts, setAttempts] = useState([])
  const [studentsById, setStudentsById] = useState({})
  const [reviewTarget, setReviewTarget] = useState(null)
  const [notificationChat, setNotificationChat] = useState(null)

  // 2026-10-06 review: this page used to reload EVERYTHING (three
  // sequential queries incl. select('*') of every essay) on every change
  // to writing_mock_attempts — i.e. every 5 s autosave of every student
  // mid-test. Now:
  //   - only the columns this page shows are read (essays are still
  //     needed: word counts in the queue + the review modal);
  //   - realtime events for unsubmitted rows (autosaves) are ignored;
  //   - a submitted row that is new, or whose review/release fields
  //     changed, is re-read on its own (debounced, batched by id) and
  //     patched into the list;
  //   - a request token stops an older full load overwriting a newer one.
  const ATTEMPT_COLUMNS =
    'id, exam_id, student_id, submitted_at, task1_text, task2_text, examiner_band, examiner_feedback, examiner_reviewed_by, examiner_reviewed_at, ta_band, cc_band, lr_band, gra_band'
  const WATCHED_FIELDS = [
    'submitted_at', 'examiner_band', 'examiner_feedback', 'examiner_reviewed_at',
    'ta_band', 'cc_band', 'lr_band', 'gra_band', 'released_at',
  ]

  const loadTokenRef = useRef(0)
  const attemptsRef = useRef([])
  attemptsRef.current = attempts
  const studentsRef = useRef({})
  studentsRef.current = studentsById
  const examsRef = useRef([])
  examsRef.current = exams
  const releasedRef = useRef({}) // id -> released_at last seen over realtime
  const pendingIdsRef = useRef(new Set())
  const flushTimerRef = useRef(null)

  const loadExams = async () => {
    const { data: examRows, error: examsError } = await supabase
      .from('writing_mock_exams')
      .select('id, title, task1_prompt, task2_prompt, task1_image_url')

    if (examsError) {
      console.error('Failed to load writing mock exams:', examsError)
      return null
    }
    return examRows || []
  }

  const loadProfiles = async (ids) => {
    const map = {}
    if (ids.length === 0) return map
    const { data: studentRows, error: studentsError } = await supabase
      .from('profiles')
      .select('id, full_name, username')
      .in('id', ids)
    if (studentsError) {
      console.error('Failed to load students for review queue:', studentsError)
    }
    ;(studentRows || []).forEach((st) => { map[st.id] = st })
    return map
  }

  const loadAll = async () => {
    const token = ++loadTokenRef.current

    const [examRows, attemptRes] = await Promise.all([
      loadExams(),
      fetchAll(() =>
        supabase
          .from('writing_mock_attempts')
          .select(ATTEMPT_COLUMNS)
          .not('submitted_at', 'is', null)
          .order('submitted_at', { ascending: false })
          .order('id')
      ),
    ])

    if (attemptRes.error) {
      console.error('Failed to load writing mock attempts:', attemptRes.error)
    }
    const attemptRows = attemptRes.data || []

    const studentIds = [...new Set(attemptRows.map((a) => a.student_id))]
    const studentMap = await loadProfiles(studentIds)

    if (token !== loadTokenRef.current) return // a newer load started meanwhile

    if (examRows) setExams(examRows)
    setAttempts(attemptRows)
    setStudentsById(studentMap)
    setLoading(false)
  }

  // Re-read just the queued attempt ids and patch them into the list.
  const flushPending = async () => {
    flushTimerRef.current = null
    const ids = [...pendingIdsRef.current]
    pendingIdsRef.current = new Set()
    if (ids.length === 0) return
    const token = loadTokenRef.current

    const { data: rows, error: rowsError } = await supabase
      .from('writing_mock_attempts')
      .select(ATTEMPT_COLUMNS)
      .in('id', ids)
    if (rowsError) {
      console.error('Failed to refresh writing mock attempts:', rowsError)
      return
    }
    const submitted = (rows || []).filter((r) => r.submitted_at)

    const missingStudents = [...new Set(submitted.map((r) => r.student_id))].filter(
      (id) => !studentsRef.current[id]
    )
    const knownExamIds = new Set(examsRef.current.map((e) => e.id))
    const needExams = submitted.some((r) => !knownExamIds.has(r.exam_id))
    const [newStudents, examRows] = await Promise.all([
      loadProfiles(missingStudents),
      needExams ? loadExams() : Promise.resolve(null),
    ])

    if (token !== loadTokenRef.current) return // a full reload superseded this
    if (examRows) setExams(examRows)
    if (Object.keys(newStudents).length) setStudentsById((prev) => ({ ...prev, ...newStudents }))
    const byId = {}
    submitted.forEach((r) => { byId[r.id] = r })
    setAttempts((prev) => {
      const seen = new Set()
      const next = []
      prev.forEach((a) => {
        if (!ids.includes(a.id)) return next.push(a)
        seen.add(a.id)
        if (byId[a.id]) next.push(byId[a.id]) // still submitted → patch; gone → drop
      })
      submitted.forEach((r) => { if (!seen.has(r.id)) next.push(r) })
      next.sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))
      return next
    })
  }

  const queueRefresh = (id) => {
    pendingIdsRef.current.add(id)
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    flushTimerRef.current = setTimeout(flushPending, 800)
  }

  const onAttemptChange = (payload) => {
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id
      if (id) setAttempts((prev) => prev.filter((a) => a.id !== id))
      return
    }
    const row = payload.new
    if (!row?.id) return
    // Unsubmitted = a student autosaving mid-test: nothing to show yet.
    if (!row.submitted_at) return
    const local = attemptsRef.current.find((a) => a.id === row.id)
    const prevReleased = releasedRef.current[row.id]
    releasedRef.current[row.id] = row.released_at ?? null
    if (local) {
      const changed = WATCHED_FIELDS.some((f) => {
        if (f === 'released_at') return prevReleased !== undefined && prevReleased !== (row.released_at ?? null)
        return (local[f] ?? null) !== (row[f] ?? null)
      })
      if (!changed) return
    }
    queueRefresh(row.id)
  }

  useEffect(() => {
    if (!profile?.id) return
    loadAll()

    const channel = supabase
      .channel('writing-examiner-attempts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'writing_mock_attempts' }, onAttemptChange)
      .subscribe()

    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // "Now" for the Home tab's ages and charts; refreshed whenever the
  // attempt list changes (realtime patches included).
  const now = useMemo(() => new Date(), [attempts])

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
    // Re-read just this attempt (2026-10-06) instead of reloading everything.
    pendingIdsRef.current.add(attempt.id)
    await flushPending()
  }

  const sections = useMemo(
    () => [
      {
        items: [
          { key: 'home', label: 'Home', icon: IconHome, hideTitle: true },
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

        {tab === 'home' && (
          <WritingExaminerHome
            profile={profile}
            attempts={attempts}
            examById={examById}
            studentsById={studentsById}
            now={now}
            onOpen={(entry) => setReviewTarget(entry)}
            onNavigate={setTab}
          />
        )}

        {tab === 'task1' && (
          <QueueSection
            blurb="Every writing mock with a Task 1, sorted by student name."
            entries={task1Queue}
            taskKey="task1_text"
            now={now}
            onOpen={(entry) => setReviewTarget({ ...entry, initialTask: 'task1' })}
            onMessage={handleMessageStudent}
          />
        )}

        {tab === 'task2' && (
          <QueueSection
            blurb="Every writing mock with a Task 2, sorted by student name."
            entries={task2Queue}
            taskKey="task2_text"
            now={now}
            onOpen={(entry) => setReviewTarget({ ...entry, initialTask: 'task2' })}
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
//
// 2026-10-07 "Study room" pass: same entries, same buttons, same order
// (by student name) — just split into "To mark" and "Marked" cards so
// the work left is obvious at a glance.
const QUEUE_MIN_WORDS = { task1_text: 150, task2_text: 250 }

function QueueSection({ blurb, entries, taskKey, now, onOpen, onMessage }) {
  const toMark = entries.filter((e) => !e.attempt.examiner_reviewed_at)
  const marked = entries.filter((e) => e.attempt.examiner_reviewed_at)

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-mist max-w-2xl">{blurb}</p>
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-writing-tint px-3 text-[13px] font-medium text-writing">
          <span className="font-semibold tabular-nums">{toMark.length}</span> to mark
        </span>
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-panel-2 px-3 text-[13px] font-medium text-paper-dim">
          <span className="font-semibold tabular-nums">{marked.length}</span> marked
        </span>
      </div>

      {entries.length === 0 ? (
        <Card className="flex items-center gap-4 px-6 py-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-writing-tint text-writing">
            <SkillIcon skill="writing" className="h-6 w-6" />
          </span>
          <p className="text-[15px] text-paper-dim">Nothing to review here right now.</p>
        </Card>
      ) : (
        <>
          <QueueCard
            title="To mark"
            entries={toMark}
            taskKey={taskKey}
            now={now}
            onOpen={onOpen}
            onMessage={onMessage}
            empty="All caught up — every mock here is marked."
          />
          {marked.length > 0 && (
            <QueueCard title="Marked" entries={marked} taskKey={taskKey} now={now} onOpen={onOpen} onMessage={onMessage} />
          )}
        </>
      )}
    </section>
  )
}

function QueueCard({ title, entries, taskKey, now, onOpen, onMessage, empty }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-1 flex items-baseline justify-between px-1.5">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        <span className="text-[13px] text-mist tabular-nums">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="mt-2 flex items-center gap-3 rounded-2xl bg-reading-tint px-4 py-4">
          <Icon name="checkCircle" className="h-6 w-6 shrink-0 text-reading" />
          <p className="text-sm font-medium text-reading">{empty}</p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {entries.map((entry) => {
            const reviewed = Boolean(entry.attempt.examiner_reviewed_at)
            const words = countWords(entry.attempt[taskKey])
            const short = words < QUEUE_MIN_WORDS[taskKey]
            const waitedLong = !reviewed && entry.attempt.submitted_at && now - new Date(entry.attempt.submitted_at) >= 3 * DAY

            return (
              <li
                key={entry.attempt.id + taskKey}
                className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-t border-line px-1.5 py-3 first:border-0"
              >
                <Avatar
                  person={entry.student}
                  tone={reviewed ? 'bg-panel-2 text-paper-dim' : 'bg-writing-tint text-writing'}
                />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate text-[15px] font-medium text-paper">{studentLabel(entry.student)}</p>
                  <p className="truncate text-[13px] text-mist">
                    {entry.exam.title}
                    {' · '}
                    <span className={short ? 'font-medium text-urgent' : ''} title={short ? `Under the ${QUEUE_MIN_WORDS[taskKey]}-word minimum` : undefined}>
                      {words} words
                    </span>
                    {entry.attempt.submitted_at && ` · submitted ${timeAgo(entry.attempt.submitted_at, now)}`}
                  </p>
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {reviewed ? (
                    <span className="inline-flex h-7 items-center rounded-lg bg-reading-tint px-2.5 text-[13px] font-semibold tabular-nums text-reading">
                      Band {formatBand(entry.attempt.examiner_band)}
                    </span>
                  ) : (
                    <span
                      className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium ${
                        waitedLong ? 'bg-urgent-tint text-urgent' : 'bg-writing-tint text-writing'
                      }`}
                    >
                      <Icon name="clock" className="h-3.5 w-3.5" />
                      {entry.attempt.submitted_at ? `Waiting ${ageLabel(entry.attempt.submitted_at, now)}` : 'Not marked'}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => onMessage(entry.student)}
                    className="focus-ring rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-paper-dim transition-colors hover:border-paper/30 hover:text-paper"
                  >
                    Message
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpen(entry)}
                    className={`focus-ring rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                      reviewed
                        ? 'bg-panel-2 text-paper hover:bg-line/60'
                        : 'bg-brass text-onbrass hover:bg-brass-dim'
                    }`}
                  >
                    {reviewed ? 'View / edit' : 'Mark'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

const LABEL = 'text-[13px] font-medium text-mist'
const INPUT = 'focus-ring mt-1 w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-paper'

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
  // Opened from the Task 2s list → start on Task 2 (2026-10-07).
  const [activeTask, setActiveTask] = useState(
    entry.initialTask && attempt[`${entry.initialTask}_text`] ? entry.initialTask : attempt.task1_text ? 'task1' : 'task2'
  )

  const tasksAvailable = [
    attempt.task1_text ? 'task1' : null,
    attempt.task2_text ? 'task2' : null,
  ].filter(Boolean)

  const computedOverall = computeOverallBand([criteria.ta, criteria.cc, criteria.lr, criteria.gra])
  const displayOverall = computedOverall != null ? computedOverall : attempt.examiner_band ?? null

  const activeWords = countWords(attempt[`${activeTask}_text`])
  const minWords = activeTask === 'task1' ? 150 : 250

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
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-[22px] border border-line bg-panel shadow-xl p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar person={student} size="h-10 w-10" tone="bg-writing-tint text-writing" />
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold text-paper">{studentLabel(student)}</h3>
              <p className="truncate text-[13px] text-mist">
                {exam.title}
                {attempt.submitted_at && ` · submitted ${new Date(attempt.submitted_at).toLocaleDateString()}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-mist hover:bg-panel-2 hover:text-paper"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        {tasksAvailable.length > 1 && (
          <div className="mt-4 inline-flex gap-1 rounded-full bg-panel-2 p-1">
            {tasksAvailable.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTask(t)}
                className={`focus-ring rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeTask === t ? 'bg-panel text-writing shadow-sm' : 'text-mist hover:text-paper'
                }`}
              >
                {t === 'task1' ? 'Task 1' : 'Task 2'}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {activeTask === 'task1' && exam.task1_prompt && (
            <div className="rounded-2xl bg-writing-tint/60 p-3.5 text-sm text-paper-dim whitespace-pre-wrap">
              <p className="mb-1 text-[13px] font-medium text-writing">Task 1 prompt</p>
              {exam.task1_prompt}
            </div>
          )}
          {activeTask === 'task2' && exam.task2_prompt && (
            <div className="rounded-2xl bg-writing-tint/60 p-3.5 text-sm text-paper-dim whitespace-pre-wrap">
              <p className="mb-1 text-[13px] font-medium text-writing">Task 2 prompt</p>
              {exam.task2_prompt}
            </div>
          )}

          {activeTask === 'task1' && exam.task1_image_url && (
            <img
              src={exam.task1_image_url}
              alt="Task 1 chart"
              className="max-h-64 rounded-xl border border-line object-contain"
            />
          )}

          <div className="rounded-2xl border border-line bg-panel-2 p-4 text-sm leading-relaxed text-paper whitespace-pre-wrap max-h-96 overflow-y-auto">
            {attempt[`${activeTask}_text`] || 'No answer written.'}
          </div>

          <p className={`text-[13px] ${activeWords < minWords ? 'font-medium text-urgent' : 'text-mist'}`}>
            {activeWords} words
            {activeWords < minWords ? ` · under the ${minWords}-word minimum` : ` · minimum ${minWords}`}
          </p>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-sm font-semibold text-paper">Criteria marks</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {WRITING_CRITERIA.map((c) => (
              <label key={c.key} className="text-[12px] text-mist">
                {c.label}
                <input
                  type="number"
                  min="0"
                  max="9"
                  step="0.5"
                  value={criteria[c.key]}
                  onChange={(e) => setCriteria((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  className={INPUT}
                />
              </label>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-panel-2/70 px-3.5 py-2.5">
            <span className={LABEL}>Overall band</span>
            <span className="inline-flex h-7 items-center rounded-lg bg-writing-tint px-2.5 text-sm font-semibold tabular-nums text-writing">
              {formatBand(displayOverall)}
            </span>
            <span className="text-[12px] text-mist">
              {computedOverall != null
                ? 'calculated from the four criteria'
                : 'fill in all four to calculate'}
            </span>
          </div>

          <label className={`mt-4 block ${LABEL}`}>
            Feedback
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              placeholder="What went well, what to improve…"
              className={`${INPUT} resize-none`}
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
            className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold hover:bg-brass-dim disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save review'}
          </button>
        </div>
      </div>
    </div>
  )
}
