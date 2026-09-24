import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import MockExams from './MockExams'
import WritingMockExam from './WritingMockExam'
import Chat from './Chat'
import {
  TARGET_BANDS,
  formatTargetBand,
} from '../lib/targetBands'

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
 *   Take a Test      — the existing MockExams component, untouched.
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
            <p className="text-sm font-medium text-paper truncate">
              Candidate: {profile?.full_name || profile?.username}
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
            <div className="space-y-6">
              <MockExams selfId={profile.id} />
              <WritingMockExam selfId={profile.id} />
            </div>
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
                    {slot.meeting_link && slot.status === 'scheduled' && (
                      <a
                        href={slot.meeting_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="focus-ring inline-block mt-3 rounded-full bg-brass text-onbrass text-sm font-semibold px-4 py-2"
                      >
                        Join exam link
                      </a>
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
