import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout, { IconHome, IconHomework, IconChat } from '../../components/Layout'
import LoadingScreen from '../../components/LoadingScreen'
import PrivateChats from '../../components/PrivateChats'
import { countWords } from '../../lib/writingMock'
import { formatBand } from '../../lib/ieltsBands'
import WritingReviewModal from '../../components/writing/WritingReviewModal'
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

  // Marks/comments saved inside WritingReviewModal → re-read that one
  // attempt so the queue shows its new band straight away.
  const refreshAttempt = (id) => {
    pendingIdsRef.current.add(id)
    flushPending()
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
        <WritingReviewModal
          attemptId={reviewTarget.attempt.id}
          role="examiner"
          initialTask={reviewTarget.initialTask}
          onClose={() => setReviewTarget(null)}
          onSaved={(row) => refreshAttempt(row.id)}
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
        <h2 className="font-brand text-[17px] font-semibold text-brass">{title}</h2>
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
