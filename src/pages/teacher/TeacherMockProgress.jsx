import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { formatTargetBand } from '../../lib/targetBands'

/*
 * ================================================================
 * TEACHER MOCK PROGRESS
 * ================================================================
 * Phase 7 of the examiner-platform expansion plan — the teacher-side
 * mirror of what a student now sees in their own Mock Test Center
 * Overview (see MockTestCenter.jsx): every student's reading/
 * listening average+highest score, plus their writing mock bands
 * once a writing examiner has reviewed them.
 *
 * Requires migration_32.sql (adds a teacher-visibility policy on
 * mock_attempts — without it this query would silently return only
 * the teacher's own attempts, if any, and nothing for real students).
 * ================================================================
 */

function pct(score, max) {
  if (!max) return 0
  return Math.round((score / max) * 100)
}

function studentLabel(student) {
  return student?.full_name || student?.username || 'Student'
}

export default function TeacherMockProgress() {
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
        { data: hwRows, error: hwError },
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
        supabase
          .from('homeworks')
          .select('id, title')
          .eq('homework_type', 'writing_mock'),
      ])

      if (studentsError) console.error('Failed to load students:', studentsError)
      if (attemptsError) console.error('Failed to load mock attempts:', attemptsError)
      if (hwError) console.error('Failed to load writing homeworks:', hwError)

      const examIds = [...new Set((attemptRows || []).map((a) => a.exam_id))]
      let examMap = {}

      if (examIds.length > 0) {
        const { data: examRows, error: examsError } = await supabase
          .from('mock_exams')
          .select('id, title, module')
          .in('id', examIds)

        if (examsError) console.error('Failed to load exam titles:', examsError)
        ;(examRows || []).forEach((e) => { examMap[e.id] = e })
      }

      const hwIds = (hwRows || []).map((h) => h.id)
      const hwTitleById = {}
      ;(hwRows || []).forEach((h) => { hwTitleById[h.id] = h.title })

      let reviews = []

      if (hwIds.length > 0) {
        const { data: subRows, error: subError } = await supabase
          .from('submissions')
          .select('*')
          .in('homework_id', hwIds)
          .not('examiner_reviewed_at', 'is', null)
          .order('examiner_reviewed_at', { ascending: false })

        if (subError) console.error('Failed to load writing reviews:', subError)

        reviews = (subRows || []).map((s) => ({
          ...s,
          homeworkTitle: hwTitleById[s.homework_id] || 'Writing mock',
        }))
      }

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
    window.dispatchEvent(
      new CustomEvent('notification-navigate', {
        detail: { link: `private-chat:${studentId}` },
      })
    )
  }

  if (loading) {
    return <p className="text-sm text-mist">Loading mock progress…</p>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="ticket rounded-2xl p-5 sm:p-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
          Mock exam progress
        </div>
        <h2 className="font-display text-2xl sm:text-3xl mt-1">Mock Progress</h2>
        <p className="text-sm text-mist mt-1.5 max-w-lg">
          Reading/listening scores from Mock Exams, and writing mock bands once a writing
          examiner has marked them — one row per student.
        </p>
      </div>

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
                          <span className="text-paper">{r.homeworkTitle}</span>
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
