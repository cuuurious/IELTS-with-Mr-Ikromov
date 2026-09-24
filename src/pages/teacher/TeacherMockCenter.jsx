import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { formatTargetBand } from '../../lib/targetBands'

/*
 * ================================================================
 * TEACHER MOCK CENTER
 * ================================================================
 * Shipped 2026-09-24. Jasur's own words: "i want mock dashboard to be
 * separate in teachers account as well, he has to see another layout
 * where everything is about mocks, nothing distracting groups
 * leaderboard ANYTHING." So this is its own full-screen portal — same
 * pattern as the student's MockTestCenter.jsx — launched from a card
 * on the regular Teacher dashboard (see TeacherDashboard.jsx's
 * mockCenterOpen state) rather than living as just another tab mixed
 * in with Groups/Students/Leaderboards in the ordinary sidebar.
 *
 * Only one section for now (Student Progress — the former
 * TeacherMockProgress.jsx content, folded in here and pointed at the
 * new writing_mock_exams/writing_mock_attempts tables instead of
 * homeworks/submissions). Nav is deliberately structured to grow —
 * Jasur: "yes we will add other details in mock dashboard".
 *
 * Requires migration_32.sql (teacher-visibility policy on
 * mock_attempts) and migration_34.sql (writing_mock_exams/
 * writing_mock_attempts + severing writing examiners from homeworks/
 * submissions entirely).
 * ================================================================
 */

const SECTIONS = [{ key: 'progress', label: 'Student Progress' }]

function pct(score, max) {
  if (!max) return 0
  return Math.round((score / max) * 100)
}

function studentLabel(student) {
  return student?.full_name || student?.username || 'Student'
}

export default function TeacherMockCenter({ onExit }) {
  const { profile } = useAuth()
  const [section, setSection] = useState('progress')

  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState([])
  const [attempts, setAttempts] = useState([])
  const [examsById, setExamsById] = useState({})
  const [writingReviews, setWritingReviews] = useState([])
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    const load = async () => {
      const [
        { data: studentRows, error: studentsError },
        { data: attemptRows, error: attemptsError },
        { data: writingAttemptRows, error: writingAttemptsError },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, target_band')
          .eq('role', 'student')
          .order('full_name', { ascending: true }),
        supabase
          .from('mock_attempts')
          .select('*')
          .not('submitted_at', 'is', null)
          .order('submitted_at', { ascending: false }),
        // Writing bands live in the brand new self-service system
        // (migration_34) — NEVER homeworks/submissions, which is a
        // separate, teacher-posted homework flow that doesn't count
        // as "the whole mock" (Jasur, 2026-09-24).
        supabase
          .from('writing_mock_attempts')
          .select('*')
          .not('examiner_reviewed_at', 'is', null)
          .order('examiner_reviewed_at', { ascending: false }),
      ])

      if (studentsError) console.error('Failed to load students:', studentsError)
      if (attemptsError) console.error('Failed to load mock attempts:', attemptsError)
      if (writingAttemptsError) console.error('Failed to load writing mock reviews:', writingAttemptsError)

      const examIds = [...new Set((attemptRows || []).map((a) => a.exam_id))]
      const writingExamIds = [...new Set((writingAttemptRows || []).map((a) => a.exam_id))]
      let examMap = {}

      if (examIds.length > 0) {
        const { data: examRows, error: examsError } = await supabase
          .from('mock_exams')
          .select('id, title, module')
          .in('id', examIds)

        if (examsError) console.error('Failed to load exam titles:', examsError)
        ;(examRows || []).forEach((e) => { examMap[e.id] = e })
      }

      let writingExamTitleById = {}

      if (writingExamIds.length > 0) {
        const { data: writingExamRows, error: writingExamsError } = await supabase
          .from('writing_mock_exams')
          .select('id, title')
          .in('id', writingExamIds)

        if (writingExamsError) console.error('Failed to load writing exam titles:', writingExamsError)
        ;(writingExamRows || []).forEach((e) => { writingExamTitleById[e.id] = e.title })
      }

      const reviews = (writingAttemptRows || []).map((a) => ({
        ...a,
        examTitle: writingExamTitleById[a.exam_id] || 'Writing mock',
      }))

      setStudents(studentRows || [])
      setAttempts(attemptRows || [])
      setExamsById(examMap)
      setWritingReviews(reviews)
      setLoading(false)
    }

    load()
  }, [])

  const rows = useMemo(() => {
    return students.map((student) => {
      const own = attempts.filter((a) => a.user_id === student.id)

      const byModule = { reading: [], listening: [] }
      own.forEach((a) => {
        const exam = examsById[a.exam_id]
        if (exam && byModule[exam.module]) {
          byModule[exam.module].push({ ...a, examTitle: exam.title, module: exam.module })
        }
      })

      const summarize = (arr) => {
        if (arr.length === 0) return null
        const pcts = arr.map((a) => pct(a.score, a.max_score))
        return {
          average: Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length),
          highest: Math.max(...pcts),
          count: arr.length,
        }
      }

      const ownReviews = writingReviews.filter((r) => r.student_id === student.id)
      const bands = ownReviews.filter((r) => r.examiner_band != null).map((r) => r.examiner_band)
      const avgBand = bands.length
        ? Math.round((bands.reduce((s, v) => s + Number(v), 0) / bands.length) * 2) / 2
        : null

      return {
        student,
        reading: summarize(byModule.reading),
        listening: summarize(byModule.listening),
        readingAttempts: byModule.reading,
        listeningAttempts: byModule.listening,
        writingReviews: ownReviews,
        avgBand,
      }
    })
  }, [students, attempts, examsById, writingReviews])

  const openChat = (studentId) => {
    onExit()
    window.dispatchEvent(
      new CustomEvent('notification-navigate', {
        detail: { link: `private-chat:${studentId}` },
      })
    )
  }

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col bg-ink text-paper">

      {/* Own chrome, deliberately not the regular Teaching/Communication/
          Insights sidebar — nothing about groups, leaderboards or
          homework belongs in this window at all. */}
      <header className="shrink-0 border-b border-line bg-panel px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-brass/15 border border-brass-dim/30 flex items-center justify-center text-brass font-display text-sm shrink-0">
            MC
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-brass font-mono">
              Mock Center
            </p>
            <p className="text-sm font-medium text-paper truncate">
              {profile?.full_name || profile?.username}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onExit}
          className="focus-ring shrink-0 rounded-full border border-line px-4 py-2 text-xs font-semibold text-mist hover:text-paper hover:border-brass/40 transition-colors"
        >
          ← Exit to dashboard
        </button>
      </header>

      <nav className="shrink-0 border-b border-line bg-panel-2 px-4 sm:px-6 flex gap-1 overflow-x-auto">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={`focus-ring shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              section === s.key
                ? 'border-brass text-brass'
                : 'border-transparent text-mist hover:text-paper'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">

          {loading && <p className="text-sm text-mist">Loading mock progress…</p>}

          {!loading && section === 'progress' && (
            <div className="flex flex-col gap-5">
              <p className="text-sm text-mist max-w-lg">
                Reading/listening scores from Mock Exams, and writing mock bands once a writing
                examiner has marked them — one row per student.
              </p>

              {rows.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
                  No students yet.
                </div>
              ) : (
                <div className="rounded-2xl border border-line bg-panel overflow-hidden">
                  <div className="hidden sm:grid grid-cols-[1.6fr_1fr_1fr_1fr_auto] gap-3 px-5 py-3 border-b border-line text-[10px] uppercase tracking-[0.14em] text-mist font-mono">
                    <span>Student</span>
                    <span>Reading</span>
                    <span>Listening</span>
                    <span>Writing</span>
                    <span />
                  </div>

                  {rows.map((row) => {
                    const expanded = expandedId === row.student.id

                    return (
                      <div key={row.student.id} className="border-b border-line last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : row.student.id)}
                          className="w-full text-left grid grid-cols-2 sm:grid-cols-[1.6fr_1fr_1fr_1fr_auto] gap-3 px-5 py-3.5 hover:bg-panel-2 transition-colors"
                        >
                          <div className="col-span-2 sm:col-span-1 min-w-0">
                            <p className="font-medium text-paper truncate">{studentLabel(row.student)}</p>
                            {row.student.target_band != null && (
                              <p className="text-xs text-brass mt-0.5">
                                Target {formatTargetBand(row.student.target_band)}
                              </p>
                            )}
                          </div>

                          <MetricCell stats={row.reading} />
                          <MetricCell stats={row.listening} />

                          <div className="text-sm text-paper">
                            {row.avgBand != null ? (
                              <>
                                <span className="font-semibold text-sage">Band {row.avgBand}</span>
                                <span className="text-mist text-xs ml-1">
                                  ({row.writingReviews.length})
                                </span>
                              </>
                            ) : (
                              <span className="text-mist text-xs">Not marked</span>
                            )}
                          </div>

                          <span className="text-xs text-mist self-center hidden sm:block">
                            {expanded ? '▲' : '▼'}
                          </span>
                        </button>

                        {expanded && (
                          <div className="px-5 pb-4 pt-1 space-y-3 bg-panel-2/40">
                            <button
                              type="button"
                              onClick={() => openChat(row.student.id)}
                              className="focus-ring text-xs text-brass hover:text-brass-dim"
                            >
                              Message {studentLabel(row.student)} →
                            </button>

                            {[...row.readingAttempts, ...row.listeningAttempts].length === 0 &&
                              row.writingReviews.length === 0 && (
                                <p className="text-sm text-mist">No mock activity yet.</p>
                              )}

                            {[...row.readingAttempts, ...row.listeningAttempts]
                              .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
                              .map((a) => (
                                <div
                                  key={a.id}
                                  className="flex items-center justify-between gap-3 text-sm rounded-lg border border-line bg-panel px-3.5 py-2.5"
                                >
                                  <span className="text-paper capitalize">
                                    {a.module} · {a.examTitle}
                                  </span>
                                  <span className="text-mist font-mono text-xs">
                                    {a.score}/{a.max_score} ({pct(a.score, a.max_score)}%) ·{' '}
                                    {new Date(a.submitted_at).toLocaleDateString()}
                                  </span>
                                </div>
                              ))}

                            {row.writingReviews.map((r) => (
                              <div key={r.id} className="rounded-lg border border-line bg-panel px-3.5 py-2.5">
                                <div className="flex items-center justify-between gap-3 text-sm">
                                  <span className="text-paper">{r.examTitle}</span>
                                  <span className="text-sage font-semibold text-xs">
                                    Band {r.examiner_band ?? '—'}
                                  </span>
                                </div>
                                {r.examiner_feedback && (
                                  <p className="text-xs text-mist mt-1.5 whitespace-pre-wrap">
                                    {r.examiner_feedback}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function MetricCell({ stats }) {
  if (!stats) {
    return <span className="text-xs text-mist self-center">—</span>
  }

  return (
    <div className="text-sm self-center">
      <span className="text-paper font-medium">{stats.average}%</span>
      <span className="text-mist text-xs"> avg</span>
      <span className="text-mist text-xs mx-1">·</span>
      <span className="text-brass font-medium">{stats.highest}%</span>
      <span className="text-mist text-xs"> high</span>
    </div>
  )
}
