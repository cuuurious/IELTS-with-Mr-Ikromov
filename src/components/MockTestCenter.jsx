import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import MockCheckIn from './MockCheckIn'
import Chat from './Chat'
import {
  TARGET_BANDS,
  formatTargetBand,
} from '../lib/targetBands'
import { downloadSpeakingSlotIcs } from '../lib/calendarEvent'
import { estimateBandFromPercent } from '../lib/ieltsBands'
import { downloadScoreReport } from '../lib/generateScoreReport'

/*
 * ================================================================
 * MOCK TEST CENTER
 * ================================================================
 * Its own full-screen portal, not a tab in the regular sidebar — per
 * Jasur's own words: "they have to feel that it is like a real exam
 * not just a website they use every day". Launched from a card/button
 * on the regular Homework dashboard (see StudentDashboard.jsx),
 * takes over the whole screen, and hands control back via onExit.
 *
 * Four sections along its own top nav (deliberately NOT the app's
 * usual left sidebar, to feel distinct):
 *   Overview        — average/highest reading+listening scores,
 *                     target band (editable here too), writing mock
 *                     bands/feedback from a writing examiner.
 *   Take a Test      — MockCheckIn: a real-IELTS-style candidate
 *                     check-in (full name + a teacher-issued code,
 *                     migration_45) gates entry, then hands off to
 *                     FullMockRunner for a forced Listening→Reading→
 *                     Writing sequence built from a teacher-bundled
 *                     "Full Mock" set (migration_37). Replaces the old
 *                     free pick-any-exam-anytime MockExams/WritingMockExam
 *                     screens (2026-09-25) and, as of 2026-09-26, free
 *                     code-less access to Full Mocks too — every attempt
 *                     now needs a code issued for that student.
 *   Speaking Exam    — the student's booked slot(s) from
 *                     mock_speaking_slots (migration_29), with the
 *                     join link and examiner name.
 *   Message Examiners — direct chat with the speaking/writing
 *                     examiner accounts, reusing the same Chat.jsx
 *                     bubble used everywhere else in the app.
 * ================================================================
 */

const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'take-test', label: 'Take a Test' },
  { key: 'speaking', label: 'Speaking Exam' },
  { key: 'examiners', label: 'Message Examiners' },
]

function pct(score, max) {
  if (!max) return 0
  return Math.round((score / max) * 100)
}

function formatSlotTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function MockTestCenter({ onExit }) {
  const { profile, refreshProfile } = useAuth()
  const [section, setSection] = useState('overview')

  const [attempts, setAttempts] = useState([])
  const [examsById, setExamsById] = useState({})
  const [writingReviews, setWritingReviews] = useState([])
  const [slots, setSlots] = useState([])
  const [examiners, setExaminers] = useState([])
  const [loading, setLoading] = useState(true)

  const [targetSaving, setTargetSaving] = useState(false)
  const [reportGenerating, setReportGenerating] = useState(false)
  const [reportError, setReportError] = useState('')

  useEffect(() => {
    if (!profile?.id) return

    const load = async () => {
      const [
        { data: attemptRows, error: attemptsError },
        { data: slotRows, error: slotsError },
        { data: examinerRows, error: examinersError },
      ] = await Promise.all([
        supabase
          .from('mock_attempts')
          .select('*')
          .eq('user_id', profile.id)
          .not('submitted_at', 'is', null)
          .order('submitted_at', { ascending: false }),
        supabase
          .from('mock_speaking_slots')
          .select('*')
          .eq('student_id', profile.id)
          .order('scheduled_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, full_name, username, role')
          .in('role', ['speaking_examiner', 'writing_examiner']),
      ])

      if (attemptsError) console.error('Failed to load mock attempts:', attemptsError)
      if (slotsError) console.error('Failed to load speaking slots:', slotsError)
      if (examinersError) console.error('Failed to load examiners:', examinersError)

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

      // Writing mock reviews: writing_mock_attempts (this student's,
      // reviewed) joined with writing_mock_exams for the title. This is
      // the brand new self-service system (migration_34) — deliberately
      // NOT homeworks/submissions, which is a separate, teacher-posted
      // homework system that never counts as "the whole mock" (Jasur,
      // 2026-09-24: "everything teacher posts is homework... they are
      // separate").
      const { data: writingAttemptRows, error: writingAttemptsError } = await supabase
        .from('writing_mock_attempts')
        .select('*')
        .eq('student_id', profile.id)
        .not('examiner_reviewed_at', 'is', null)
        .order('examiner_reviewed_at', { ascending: false })

      if (writingAttemptsError) {
        console.error('Failed to load writing mock reviews:', writingAttemptsError)
      }

      const writingExamIds = [...new Set((writingAttemptRows || []).map((a) => a.exam_id))]
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

      setAttempts(attemptRows || [])
      setExamsById(examMap)
      setWritingReviews(reviews)
      setSlots(slotRows || [])
      setExaminers(examinerRows || [])
      setLoading(false)
    }

    load()
  }, [profile?.id])

  const stats = useMemo(() => {
    const byModule = { reading: [], listening: [] }

    attempts.forEach((a) => {
      const exam = examsById[a.exam_id]
      if (!exam || !byModule[exam.module]) return
      byModule[exam.module].push(pct(a.score, a.max_score))
    })

    const summarize = (arr) =>
      arr.length === 0
        ? null
        : { average: Math.round(arr.reduce((s, v) => s + v, 0) / arr.length), highest: Math.max(...arr), count: arr.length }

    return { reading: summarize(byModule.reading), listening: summarize(byModule.listening) }
  }, [attempts, examsById])

  const saveTargetBand = async (value) => {
    setTargetSaving(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ target_band: value })
        .eq('id', profile.id)
      if (error) throw error
      await refreshProfile()
    } catch (err) {
      console.error('Could not save target band:', err)
    } finally {
      setTargetSaving(false)
    }
  }

  /*
   * ============================================================
   * TRF-STYLE PDF SCORE REPORT
   * ============================================================
   * Added 2026-09-25 — one of the "next level" picks. Reading/
   * Listening only ever have a raw percentage here, so their bands are
   * ESTIMATED (see ieltsBands.js) from the student's average % across
   * every attempt; Writing/Speaking use the most recent human-marked
   * band as-is, no estimation. generateScoreReport.js clearly labels
   * which is which in the PDF itself.
   */
  const handleDownloadReport = async () => {
    setReportGenerating(true)
    setReportError('')
    try {
      const latestWritingReview = writingReviews[0] || null
      const latestSpeakingSlot = slots.find((s) => s.examiner_band != null) || null

      await downloadScoreReport({
        studentName: profile?.full_name || profile?.username,
        targetBand: profile?.target_band,
        skills: {
          listening: stats.listening
            ? {
                band: estimateBandFromPercent(stats.listening.average),
                note: `${stats.listening.average}% average across ${stats.listening.count} attempt(s) — estimated`,
              }
            : null,
          reading: stats.reading
            ? {
                band: estimateBandFromPercent(stats.reading.average),
                note: `${stats.reading.average}% average across ${stats.reading.count} attempt(s) — estimated`,
              }
            : null,
          writing: latestWritingReview
            ? {
                band: latestWritingReview.examiner_band,
                note: `Reviewed ${new Date(latestWritingReview.examiner_reviewed_at).toLocaleDateString()}`,
              }
            : null,
          speaking: latestSpeakingSlot
            ? {
                band: latestSpeakingSlot.examiner_band,
                note: `Speaking exam ${new Date(latestSpeakingSlot.scheduled_at).toLocaleDateString()}`,
              }
            : null,
        },
      })
    } catch (err) {
      console.error('Could not generate score report:', err)
      setReportError(err?.message || 'Could not generate the report. Please try again.')
    } finally {
      setReportGenerating(false)
    }
  }

  const upcomingSlot = slots.find((s) => s.status === 'scheduled')
  const speakingExaminer = examiners.find((e) => e.role === 'speaking_examiner')
  const writingExaminer = examiners.find((e) => e.role === 'writing_examiner')

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col bg-ink text-paper">

      {/* EXAM-CENTER CHROME — deliberately distinct from the regular
          app header (candidate-ID styling, a hard exit instead of a
          sidebar) so this reads as its own environment. */}
      <header className="shrink-0 border-b border-line bg-panel px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-brass/15 border border-brass-dim/30 flex items-center justify-center text-brass font-display text-sm shrink-0">
            IC
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-brass font-mono">
              Mock Test Center
            </p>
            <p className="font-display text-base text-paper truncate">
              Candidate: {profile?.full_name || profile?.username}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onExit}
          className="focus-ring shrink-0 rounded-full border-2 border-brass bg-brass text-onbrass px-4 py-2 text-sm font-bold shadow-sm hover:bg-brass-dim hover:border-brass-dim transition-colors"
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

          {loading && <p className="text-sm text-mist">Loading…</p>}

          {!loading && section === 'overview' && (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <ScoreCard
                  label="Reading"
                  stats={stats.reading}
                />
                <ScoreCard
                  label="Listening"
                  stats={stats.listening}
                />
              </div>

              <div className="rounded-2xl border border-line bg-panel p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-mist font-mono">
                    Score report
                  </p>
                  <p className="text-sm text-mist mt-1">
                    Download a one-page PDF combining your Listening, Reading, Writing and
                    Speaking results so far.
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <button
                    type="button"
                    onClick={handleDownloadReport}
                    disabled={reportGenerating}
                    className="focus-ring rounded-full bg-brass text-onbrass text-sm font-semibold px-4 py-2 shadow-sm hover:bg-brass-dim transition-colors disabled:opacity-50"
                  >
                    {reportGenerating ? 'Generating…' : 'Download score report'}
                  </button>
                  {reportError && <p className="text-coral text-xs mt-2 max-w-xs">{reportError}</p>}
                </div>
              </div>

              <div className="rounded-2xl border border-line bg-panel p-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-mist font-mono">
                  Target band
                </p>
                <div className="grid grid-cols-5 gap-1.5 mt-2.5 max-w-md">
                  {TARGET_BANDS.map((band) => (
                    <button
                      key={band.value}
                      type="button"
                      disabled={targetSaving}
                      onClick={() => saveTargetBand(band.value)}
                      className={`focus-ring flex flex-col items-center gap-0.5 rounded-md border px-1.5 py-2 text-center transition-colors disabled:opacity-50 ${
                        profile?.target_band === band.value
                          ? 'border-brass bg-brass/10 text-brass'
                          : 'border-line text-mist hover:border-brass/50'
                      }`}
                    >
                      <span className="text-lg leading-none">{band.emoji}</span>
                      <span className="text-sm font-semibold leading-none">
                        {formatTargetBand(band.value)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-line bg-panel p-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-mist font-mono mb-3">
                  Writing mock feedback
                </p>

                {writingReviews.length === 0 ? (
                  <p className="text-sm text-mist">No writing mocks marked yet.</p>
                ) : (
                  <div className="space-y-3">
                    {writingReviews.map((review) => (
                      <div key={review.id} className="rounded-xl border border-line bg-panel-2 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-paper">{review.examTitle}</p>
                          <span className="text-xs font-semibold rounded-full border border-sage/30 bg-sage/10 text-sage px-2.5 py-1">
                            Band {review.examiner_band ?? '—'}
                          </span>
                        </div>
                        {review.examiner_feedback && (
                          <p className="text-sm text-mist mt-2 whitespace-pre-wrap">
                            {review.examiner_feedback}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {!loading && section === 'take-test' && (
            // 2026-09-26 (migration_45): free self-practice access is gone —
            // every attempt now needs a teacher-issued code first, real
            // IELTS candidate check-in style. MockCheckIn renders
            // <FullMockRunner> itself once a code checks out.
            <MockCheckIn selfId={profile.id} />
          )}

          {!loading && section === 'speaking' && (
            <div className="space-y-4">
              {slots.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center">
                  <h2 className="font-display text-xl">No speaking exam booked yet</h2>
                  <p className="text-sm text-mist mt-2">
                    Message the speaking examiner to arrange a time.
                  </p>
                </div>
              ) : (
                slots.map((slot) => (
                  <div key={slot.id} className="rounded-2xl border border-line bg-panel p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-display text-lg text-paper">
                        {formatSlotTime(slot.scheduled_at)}
                      </p>
                      <span
                        className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2.5 py-1 ${
                          slot.status === 'scheduled'
                            ? 'text-brass border-brass-dim/30 bg-brass/10'
                            : slot.status === 'completed'
                              ? 'text-sage border-sage/30 bg-sage/10'
                              : 'text-mist border-line bg-panel-2'
                        }`}
                      >
                        {slot.status}
                      </span>
                    </div>
                    <p className="text-sm text-mist mt-1">{slot.duration_minutes} minutes</p>
                    {slot.status === 'scheduled' && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {slot.meeting_link && (
                          <a
                            href={slot.meeting_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="focus-ring inline-block rounded-full bg-brass text-onbrass text-sm font-semibold px-4 py-2"
                          >
                            Join exam link
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            downloadSpeakingSlotIcs(slot, {
                              summary: 'IELTS Speaking Mock Exam',
                            })
                          }
                          className="focus-ring inline-block rounded-full border border-line text-sm font-medium px-4 py-2 text-mist hover:text-paper hover:border-brass/40"
                        >
                          📅 Add to calendar
                        </button>
                      </div>
                    )}

                    {slot.status === 'completed' && (
                      <div className="mt-3 rounded-xl border border-line bg-panel-2 p-3.5">
                        {slot.examiner_band != null ? (
                          <span className="text-xs font-semibold rounded-full border border-sage/30 bg-sage/10 text-sage px-2.5 py-1">
                            Band {slot.examiner_band}
                          </span>
                        ) : (
                          <p className="text-sm text-mist">Not marked yet.</p>
                        )}
                        {slot.examiner_feedback && (
                          <p className="text-sm text-mist mt-2 whitespace-pre-wrap">
                            {slot.examiner_feedback}
                          </p>
                        )}
                        {slot.recording_url && (
                          <a
                            href={slot.recording_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-brass hover:text-brass-dim mt-2 inline-block"
                          >
                            🎙 Listen to your recording
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {!loading && section === 'examiners' && (
            <ExaminerMessages
              selfId={profile.id}
              speakingExaminer={speakingExaminer}
              writingExaminer={writingExaminer}
            />
          )}
        </div>
      </main>
    </div>
  )
}

function ScoreCard({ label, stats }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-mist font-mono">{label}</p>
      {stats ? (
        <div className="mt-2 flex items-end gap-6">
          <div>
            <p className="font-display text-3xl text-brass">{stats.average}%</p>
            <p className="text-xs text-mist mt-0.5">Average</p>
          </div>
          <div>
            <p className="font-display text-3xl text-paper">{stats.highest}%</p>
            <p className="text-xs text-mist mt-0.5">Highest</p>
          </div>
          <div>
            <p className="font-display text-3xl text-paper">{stats.count}</p>
            <p className="text-xs text-mist mt-0.5">Attempts</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-mist mt-2">No attempts yet.</p>
      )}
    </div>
  )
}

function ExaminerMessages({ selfId, speakingExaminer, writingExaminer }) {
  const options = [speakingExaminer, writingExaminer].filter(Boolean)
  const [activeId, setActiveId] = useState(options[0]?.id || null)

  const active = options.find((o) => o.id === activeId) || null

  if (options.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
        No examiner accounts have been set up yet.
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-line bg-panel overflow-hidden flex flex-col sm:flex-row">
      <div className="sm:w-64 shrink-0 border-b sm:border-b-0 sm:border-r border-line">
        {options.map((examiner) => (
          <button
            key={examiner.id}
            type="button"
            onClick={() => setActiveId(examiner.id)}
            className={`w-full text-left px-4 py-3.5 text-sm transition-colors ${
              activeId === examiner.id
                ? 'bg-brass/10 text-brass font-semibold'
                : 'text-mist hover:text-paper hover:bg-panel-2'
            }`}
          >
            <p>{examiner.full_name || examiner.username}</p>
            <p className="text-[10px] uppercase tracking-wide font-mono mt-0.5 opacity-70">
              {examiner.role === 'speaking_examiner' ? 'Speaking examiner' : 'Writing examiner'}
            </p>
          </button>
        ))}
      </div>

      <section className="flex-1 min-w-0 p-3">
        {active && (
          <Chat
            selfId={selfId}
            peerId={active.id}
            peerName={active.full_name || active.username}
          />
        )}
      </section>
    </div>
  )
}
