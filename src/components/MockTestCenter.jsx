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
import { estimateBandFromPercent, roundOverallBand, formatBand } from '../lib/ieltsBands'
import { downloadScoreReport } from '../lib/generateScoreReport'
import ThemeToggle from './ThemeToggle'

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

  // Per-question mistake breakdown ("mountin → mountain"), added
  // 2026-09-26 once mock_answers' real columns were confirmed
  // (student_answer, is_correct). Fetched on demand per attempt via the
  // get_mock_answer_breakdown() RPC (migration_50) — that function itself
  // enforces the release gate (a student can only ever pull this for
  // their own attempt, and only once released_at is set), so there's
  // nothing more to check client-side here.
  const [openBreakdownId, setOpenBreakdownId] = useState(null)
  const [breakdowns, setBreakdowns] = useState({})

  const toggleBreakdown = async (attemptId) => {
    if (openBreakdownId === attemptId) {
      setOpenBreakdownId(null)
      return
    }
    setOpenBreakdownId(attemptId)
    if (breakdowns[attemptId]) return

    setBreakdowns((prev) => ({ ...prev, [attemptId]: { loading: true, error: '', rows: null } }))
    const { data, error } = await supabase.rpc('get_mock_answer_breakdown', {
      p_attempt_id: attemptId,
    })
    setBreakdowns((prev) => ({
      ...prev,
      [attemptId]: { loading: false, error: error?.message || '', rows: data || [] },
    }))
  }

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
          // 2026-09-26: Reading/Listening used to score the instant a
          // student submitted — now nothing reaches a student until their
          // teacher explicitly releases it (migration_48). An unreleased
          // attempt simply doesn't exist yet as far as this screen is
          // concerned; it reappears the moment released_at is set.
          .not('released_at', 'is', null)
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

  // Every released Reading/Listening attempt, newest first, with its
  // module/title attached — the list this screen shows under the
  // aggregate ScoreCards, each with a "View mistakes" toggle.
  const attemptsWithModule = useMemo(() => {
    return attempts
      .map((a) => ({ ...a, module: examsById[a.exam_id]?.module, examTitle: examsById[a.exam_id]?.title }))
      .filter((a) => a.module)
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
  }, [attempts, examsById])

  // "Just like a real exam" results, added 2026-09-26: one band per
  // skill plus a combined overall band, using whichever data is already
  // release-gated above rather than re-deriving anything. Reading/
  // Listening use the teacher-confirmed `band` column (set at release —
  // may differ from a fresh percentage estimate if the teacher edited
  // the suggestion), never a live re-estimate.
  const latestAttemptByModule = useMemo(() => {
    const latest = (module) => attemptsWithModule.find((a) => a.module === module) || null
    return { reading: latest('reading'), listening: latest('listening') }
  }, [attemptsWithModule])

  const latestWritingReview = useMemo(
    () => writingReviews.find((r) => r.released_at != null) || null,
    [writingReviews]
  )
  const latestSpeakingSlot = useMemo(
    () => slots.find((s) => s.examiner_band != null && s.released_at != null) || null,
    [slots]
  )

  const resultBands = useMemo(() => {
    const bandFor = (attempt) =>
      attempt ? attempt.band ?? estimateBandFromPercent(pct(attempt.score, attempt.max_score)) : null

    const reading = bandFor(latestAttemptByModule.reading)
    const listening = bandFor(latestAttemptByModule.listening)
    const writing = latestWritingReview?.examiner_band ?? null
    const speaking = latestSpeakingSlot?.examiner_band ?? null

    const available = [reading, listening, writing, speaking].filter((b) => b != null)
    const overall =
      available.length > 0
        ? roundOverallBand(available.reduce((sum, b) => sum + Number(b), 0) / available.length)
        : null

    return { reading, listening, writing, speaking, overall, availableCount: available.length }
  }, [latestAttemptByModule, latestWritingReview, latestSpeakingSlot])

  // Score history / trend — the "Score history" bullet from
  // mock-test-site-concept.md's "Not built yet" list, built 2026-09-26.
  // One chronological (oldest -> newest) {date, band} series per skill,
  // released results only, same convention as everywhere else on this
  // screen: Reading/Listening use each attempt's own teacher-confirmed
  // `band` where set, falling back to a percentage estimate only for an
  // attempt that predates migration_48 and never got one; Writing/
  // Speaking use the examiner's own band, never an estimate.
  const bandHistory = useMemo(() => {
    const bandFor = (attempt) => attempt.band ?? estimateBandFromPercent(pct(attempt.score, attempt.max_score))
    const byDateAsc = (a, b) => new Date(a.date) - new Date(b.date)

    const readingHistory = attemptsWithModule
      .filter((a) => a.module === 'reading')
      .map((a) => ({ date: a.submitted_at, band: bandFor(a) }))
      .filter((p) => p.band != null)
      .sort(byDateAsc)

    const listeningHistory = attemptsWithModule
      .filter((a) => a.module === 'listening')
      .map((a) => ({ date: a.submitted_at, band: bandFor(a) }))
      .filter((p) => p.band != null)
      .sort(byDateAsc)

    const writingHistory = writingReviews
      .filter((r) => r.released_at != null && r.examiner_band != null)
      .map((r) => ({ date: r.examiner_reviewed_at, band: r.examiner_band }))
      .sort(byDateAsc)

    const speakingHistory = slots
      .filter((s) => s.released_at != null && s.examiner_band != null)
      .map((s) => ({ date: s.scheduled_at, band: s.examiner_band }))
      .sort(byDateAsc)

    return { listening: listeningHistory, reading: readingHistory, writing: writingHistory, speaking: speakingHistory }
  }, [attemptsWithModule, writingReviews, slots])

  const hasAnyHistory =
    bandHistory.listening.length + bandHistory.reading.length + bandHistory.writing.length + bandHistory.speaking.length > 0

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
      // 2026-09-26: this used to re-estimate Reading/Listening from the
      // AVERAGE percentage across every attempt — now it uses the same
      // single most-recent-attempt bands resultBands already computed
      // for the on-screen "Your results" card, including the teacher's
      // own confirmed `band` value (which may differ from a fresh
      // estimate if they edited the suggestion at release time).
      await downloadScoreReport({
        studentName: profile?.full_name || profile?.username,
        targetBand: profile?.target_band,
        skills: {
          listening: latestAttemptByModule.listening
            ? {
                band: resultBands.listening,
                note: `${pct(latestAttemptByModule.listening.score, latestAttemptByModule.listening.max_score)}% · ${new Date(latestAttemptByModule.listening.submitted_at).toLocaleDateString()}`,
              }
            : null,
          reading: latestAttemptByModule.reading
            ? {
                band: resultBands.reading,
                note: `${pct(latestAttemptByModule.reading.score, latestAttemptByModule.reading.max_score)}% · ${new Date(latestAttemptByModule.reading.submitted_at).toLocaleDateString()}`,
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

        <div className="flex items-center gap-3 shrink-0">
          <ThemeToggle />
          <button
            type="button"
            onClick={onExit}
            className="focus-ring shrink-0 rounded-full border-2 border-brass bg-brass text-onbrass px-4 py-2 text-sm font-bold shadow-sm hover:bg-brass-dim hover:border-brass-dim transition-colors"
          >
            ← Exit to dashboard
          </button>
        </div>
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
              <div className="rounded-2xl border border-line bg-panel p-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-mist font-mono mb-3">
                  Your results
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    { label: 'Listening', band: resultBands.listening },
                    { label: 'Reading', band: resultBands.reading },
                    { label: 'Writing', band: resultBands.writing },
                    { label: 'Speaking', band: resultBands.speaking },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-center">
                      <p className="text-[10px] font-mono uppercase tracking-wide text-paper-dim">{s.label}</p>
                      <p className="mt-1 text-lg font-semibold text-paper">{formatBand(s.band)}</p>
                    </div>
                  ))}
                  <div className="rounded-xl border border-brass/40 bg-brass/10 px-3 py-2.5 text-center">
                    <p className="text-[10px] font-mono uppercase tracking-wide text-brass">Overall</p>
                    <p className="mt-1 text-lg font-semibold text-brass">{formatBand(resultBands.overall)}</p>
                  </div>
                </div>
                {resultBands.availableCount > 0 && resultBands.availableCount < 4 && (
                  <p className="text-xs text-mist mt-3">
                    Overall is based on {resultBands.availableCount} of 4 skills — the rest haven't
                    been released yet.
                  </p>
                )}
                {resultBands.availableCount === 0 && (
                  <p className="text-xs text-mist mt-3">
                    Nothing released yet — your bands will appear here as soon as your teacher
                    confirms them.
                  </p>
                )}
              </div>

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

              {attemptsWithModule.length > 0 && (
                <div className="rounded-2xl border border-line bg-panel p-5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-mist font-mono mb-3">
                    Your attempts
                  </p>
                  <div className="space-y-2.5">
                    {attemptsWithModule.map((a) => {
                      const isOpen = openBreakdownId === a.id
                      const bd = breakdowns[a.id]
                      const mistakes = bd?.rows ? bd.rows.filter((r) => r.is_correct === false) : null

                      return (
                        <div key={a.id} className="rounded-xl border border-line bg-panel-2 p-3.5">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-paper capitalize">
                              {a.module} · {a.examTitle}
                            </span>
                            <span className="text-paper-dim font-mono text-xs">
                              {a.score}/{a.max_score} ({pct(a.score, a.max_score)}%) ·{' '}
                              {new Date(a.submitted_at).toLocaleDateString()}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleBreakdown(a.id)}
                            className="focus-ring text-xs text-brass hover:text-brass-dim mt-2"
                          >
                            {isOpen ? 'Hide mistakes ▲' : 'View mistakes ▼'}
                          </button>

                          {isOpen && (
                            <div className="mt-2.5">
                              {bd?.loading && <p className="text-xs text-mist">Loading…</p>}
                              {bd?.error && <p className="text-xs text-coral">{bd.error}</p>}
                              {mistakes && mistakes.length === 0 && (
                                <p className="text-xs text-sage">
                                  No mistakes — every question was answered correctly.
                                </p>
                              )}
                              {mistakes && mistakes.length > 0 && (
                                <div className="space-y-1.5">
                                  {mistakes.map((r) => (
                                    <div key={r.question_id} className="rounded-lg bg-panel px-3 py-2 text-xs">
                                      {r.section_title && (
                                        <p className="text-[10px] uppercase tracking-wide text-paper-dim font-mono mb-1">
                                          {r.section_title}
                                        </p>
                                      )}
                                      <p className="text-paper-dim">{r.prompt}</p>
                                      <p className="mt-1">
                                        <span className="text-coral">{r.student_answer || '(no answer)'}</span>
                                        <span className="text-mist mx-1.5">→</span>
                                        <span className="text-sage">{r.correct_answer}</span>
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {hasAnyHistory && (
                <div className="rounded-2xl border border-line bg-panel p-5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-mist font-mono mb-3">
                    Score history
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <BandTrendCard label="Listening" history={bandHistory.listening} />
                    <BandTrendCard label="Reading" history={bandHistory.reading} />
                    <BandTrendCard label="Writing" history={bandHistory.writing} />
                    <BandTrendCard label="Speaking" history={bandHistory.speaking} />
                  </div>
                </div>
              )}

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
                          {review.released_at != null ? (
                            <span className="text-xs font-semibold rounded-full border border-sage/30 bg-sage/10 text-sage px-2.5 py-1">
                              Band {review.examiner_band ?? '—'}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold rounded-full border border-line bg-panel text-mist px-2.5 py-1">
                              Awaiting release
                            </span>
                          )}
                        </div>
                        {review.released_at != null ? (
                          review.examiner_feedback && (
                            <p className="text-sm text-mist mt-2 whitespace-pre-wrap">
                              {review.examiner_feedback}
                            </p>
                          )
                        ) : (
                          <p className="text-sm text-mist mt-2">
                            Marked — your teacher will release your result soon.
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
                        {slot.examiner_band == null ? (
                          <p className="text-sm text-mist">Not marked yet.</p>
                        ) : slot.released_at == null ? (
                          <p className="text-sm text-mist">
                            Marked — your teacher will release your result soon.
                          </p>
                        ) : (
                          <span className="text-xs font-semibold rounded-full border border-sage/30 bg-sage/10 text-sage px-2.5 py-1">
                            Band {slot.examiner_band}
                          </span>
                        )}
                        {slot.released_at != null && slot.examiner_feedback && (
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

// A small hand-rolled trend line — no charting library in this project
// (see package.json), and a handful of points per skill doesn't need
// one. X positions are evenly spaced by attempt ORDER, not by real date
// gaps — a student who sits mocks a month apart vs. a week apart still
// gets an evenly-readable line rather than points bunched at one edge.
function BandSparkline({ points }) {
  const bands = points.map((p) => Number(p.band))
  const minB = Math.min(...bands)
  const maxB = Math.max(...bands)
  // Pad the domain a bit so a flat line (every attempt the same band)
  // still draws as a visible centered line, not a line pinned to one edge.
  const domainMin = minB === maxB ? minB - 0.5 : minB - 0.25
  const domainMax = minB === maxB ? maxB + 0.5 : maxB + 0.25
  const w = 100
  const h = 32
  const stepX = points.length > 1 ? w / (points.length - 1) : 0

  const coords = points.map((p, i) => {
    const x = points.length > 1 ? i * stepX : w / 2
    const y = h - ((Number(p.band) - domainMin) / (domainMax - domainMin)) * h
    return [x, y]
  })

  const pathD = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-8">
      <path d={pathD} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.2" fill="currentColor" />
      ))}
    </svg>
  )
}

// One skill's trend card — used in the "Score history" panel above.
// `history` is already sorted oldest -> newest, released results only
// (see the bandHistory useMemo). Needs at least 2 points to draw a line
// (one point is just a dot with nothing to compare it to), but still
// shows that one result rather than an empty "no attempts" state.
function BandTrendCard({ label, history }) {
  const latest = history[history.length - 1]
  const first = history[0]
  const delta = history.length >= 2 ? Number(latest.band) - Number(first.band) : null

  return (
    <div className="rounded-xl border border-line bg-panel-2 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-paper">{label}</p>
        {history.length > 0 && (
          <span className="text-sm font-semibold text-brass">{formatBand(latest.band)}</span>
        )}
      </div>

      {history.length === 0 && (
        <p className="text-xs text-mist mt-2">No released results yet.</p>
      )}

      {history.length === 1 && (
        <p className="text-xs text-mist mt-2">
          One result so far ({new Date(first.date).toLocaleDateString()}) — sit another to see a
          trend.
        </p>
      )}

      {history.length >= 2 && (
        <>
          <div className="mt-2 text-brass">
            <BandSparkline points={history} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-mist">
            <span>{new Date(first.date).toLocaleDateString()}</span>
            {delta !== null && delta !== 0 && (
              <span className={delta > 0 ? 'font-semibold text-sage' : 'font-semibold text-coral'}>
                {delta > 0 ? '+' : ''}
                {formatBand(delta).replace('-', '−')} since first
              </span>
            )}
            <span>{new Date(latest.date).toLocaleDateString()}</span>
          </div>
        </>
      )}
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
