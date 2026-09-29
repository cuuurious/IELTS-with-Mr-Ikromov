import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ConfirmModal from './ConfirmModal'

/*
 * ================================================================
 * MOCK EXAMS — ported from the standalone `ielts-mock-tests` app
 * (Next.js, mocks.ieltswithmrikromov.com) into the main site.
 * ================================================================
 * Jasur's call (2026-09-24): Mock Tests shouldn't be a separate site a
 * student/teacher has to sign into again — it should be a section of
 * this app, reached from the dashboard, one deploy. See
 * `mock-test-site-concept.md`'s "Merge plan into the main site" for the
 * full technical plan this was built from (a real read of the standalone
 * app's actual source, not a guess).
 *
 * This is the student-facing slice only, per that plan's suggested build
 * order — exam list, exam-taking, instant scoring. The admin exam
 * manager/editor is a separate follow-up, gated on deciding whether
 * "who can edit mock exam content" reuses this app's existing
 * `is_admin`/teacher concept or stays its own `mock_test_admins`
 * allow-list (open question, flagged in the doc — not resolved here).
 *
 * Nothing about the DATA changed in this port: same shared Supabase
 * project, same `mock_`-prefixed tables, same `submit_mock_attempt()`
 * security-definer function doing 100% of the grading in Postgres (case-
 * insensitive trimmed string match, one row per question, never returns
 * per-question correctness — only the aggregate score). Only the app
 * code calling that data moved from Next.js Server Actions to plain
 * Supabase JS calls made directly from this component, since every one
 * of those actions was already just a thin RLS-gated pass-through (the
 * standalone app's own code comments say so) — nothing privileged to
 * replicate. No separate login screen either: a signed-in user here is
 * already signed into the same Supabase project. Time limits are still
 * the same hardcoded per-module constants the standalone app used
 * (`mock_exams` has no time-limit column) — porting behavior as-is, not
 * changing it.
 *
 * EXPANDED 2026-09-26 — Phase 8 (exam-screen rebuild), first real pass.
 * Jasur picked "every single thing" from the still-open Phase 8 list:
 * flashing 10/5-minute timer warnings, single-playback audio with a
 * volume control (no scrub bar, no replay), a question navigator with
 * flag-for-review, a Reading highlight+note tool, and — the trickiest —
 * a genuine 2-minute Listening-only review window once all audio has
 * played, plus a quiet tab-switch integrity log (migration_47,
 * `mock_attempts.tab_switch_count`, same pattern
 * `WritingMockTest.jsx`/`WritingMockExam.jsx` already use).
 *
 * RESOLVED 2026-09-26 — Settings panel (font size + background/text
 * color): researched off the official British Council "how IELTS on
 * computer works" page ("A 'Settings' button allows adjusting font
 * size and background color") and IDP's own feature rundown
 * (highlighter, adjustable text size, split-screen). ExamTaker now has
 * a ⚙ Settings popover in the sticky bar with three font-size steps
 * and four background/text combinations (the app's own default, plus
 * white/black, cream/black, and black/yellow — the three high-contrast
 * pairings real accessibility-minded candidates actually use), applied
 * only to the exam content (passage, question text, answer controls),
 * never the branded timer chrome. In-memory only, same convention as
 * the highlight/notes tool. The passage/question highlight color
 * itself stays the app's own `amber` token — research turned up no
 * single official hex value beyond "works like word-processor
 * highlighting," and amber already reads as a standard highlighter
 * yellow, so there was nothing concrete to change it to.
 *
 * Still not done: the pink exam-chrome/split-pane visual restyle (a
 * separate, purely cosmetic pass — the STRUCTURE below is real-exam-
 * accurate, the paint job on the sticky bar/cards is still this app's
 * own brass/dark theme, by design, so it doesn't clash with the rest of
 * the site's look outside of an active exam).
 */

const MODULE_LABEL = { reading: 'Reading', listening: 'Listening' }

const MODULE_BLURB = {
  reading: '60 minutes, three passages, timed just like the real test.',
  listening: 'Play the audio once through, answer as you go.',
}

export const TIME_LIMIT_MINUTES = { reading: 60, listening: 40 }

// Real IELTS gives exactly 2 minutes of silent review time once the
// Listening audio has finished — no more audio, just a last look at
// your answers before it submits. This is a fixed allowance tacked onto
// the end of the module, not "however much of the 40-minute budget
// happens to be left" — see the review-phase effect in ExamTaker below.
const REVIEW_WINDOW_MS = 2 * 60_000

export const TRUE_FALSE_NG_CHOICES = ['True', 'False', 'Not Given']

// Settings panel (font size + background/text color) — added 2026-09-26
// alongside spoken instructions, closing the other concrete gap the
// "how the real IELTS on computer interface works" research turned up
// (britishcouncil.org/takeielts's own "how it works" page: "A 'Settings'
// button allows adjusting font size and background color"). Real
// candidates use this for readability/accessibility (e.g. a
// cream-on-black or black-on-cream combination), not cosmetics — so
// this is scoped to exactly those two things, not a full re-theme.
// Applied only to the exam content itself (passage/questions), not the
// sticky brass timer bar — the real exam's own settings only ever
// touch the reading/question pane, never its chrome either. In-memory
// only for the sitting, same convention as the highlight/notes tool
// above — nothing here is saved server-side.
const FONT_SCALE_STEPS = [
  { key: 'normal', label: 'A', scale: 1 },
  { key: 'large', label: 'A+', scale: 1.15 },
  { key: 'xlarge', label: 'A++', scale: 1.3 },
]

// surface/surfaceBorder/mutedText let the answer controls (option chips,
// the short-answer input, etc.) stay legible against a non-default
// background too, instead of the app's own dark bg-panel chips floating
// oddly on top of a white/cream/black override — see the components
// below that consume `theme` for exactly this.
const EXAM_THEMES = [
  { key: 'default', label: 'App theme (default)', bg: null, text: null, surface: null, surfaceBorder: null, mutedText: null },
  { key: 'light', label: 'White background, black text', bg: '#ffffff', text: '#1a1a1a', surface: '#f2f2f0', surfaceBorder: '#d8d6d0', mutedText: '#57534e' },
  { key: 'cream', label: 'Cream background, black text', bg: '#fdf6e3', text: '#2b2313', surface: '#f5ecd0', surfaceBorder: '#ddcf9e', mutedText: '#6b5d33' },
  { key: 'contrast', label: 'Black background, yellow text', bg: '#0a0a0a', text: '#ffe066', surface: '#1a1a1a', surfaceBorder: '#4a4420', mutedText: '#c9b94d' },
]

// New question types — added 2026-09-26 alongside the teacher-side editor
// in TeacherMockCenter.jsx (see that file's QUESTION_TYPE_LABELS comment
// for the full taxonomy this maps to). Kept as small standalone consts
// here rather than importing from the teacher file, since this component
// is the student-facing side and the two don't otherwise share code.
export const YES_NO_NG_CHOICES = ['Yes', 'No', 'Not Given']

// Mirrors TeacherMockCenter.jsx's MULTI_SELECT_SEPARATOR /
// canonicalizeMultiSelect exactly — this is the half of that contract
// that runs on the student's submitted answer. The teacher's
// correct_answer is always every correct choice joined by this
// separator IN AUTHORED ORDER, so the student's submission has to be
// canonicalized the same way (by that question's own options.choices
// order, not click order) for the exact-string-match grading RPC to
// ever award multi_select points correctly.
const MULTI_SELECT_SEPARATOR = ', '

function canonicalizeMultiSelect(selectedChoices, allChoices) {
  return allChoices.filter((c) => selectedChoices.includes(c)).join(MULTI_SELECT_SEPARATOR)
}

// Randomized question bank — added 2026-09-25, RETIRED 2026-09-26.
// Was scoped with Jasur as "just shuffle": a toggle on the exam
// ("Randomize questions from bank") plus an optional "questions per
// section" count, drawing a random subset in random order from a
// larger authored pool per section. Removed from the UI for both
// modules (Listening's was already gone; Reading's went with it here)
// once Jasur pointed out a passage's questions are written to match
// that specific passage — shuffling breaks that. buildAttemptQuestions
// below is kept as a stable no-op (old rows may still have
// randomize_questions set) rather than deleted outright, so nothing
// upstream that still passes an exam through it needs to change.
export function buildAttemptQuestions(allQuestionsForSection, exam) {
  // Randomizing was tried for both modules and retired for both.
  // Listening never worked with it (one fixed audio track narrates in
  // a set order — shuffling or drawing a subset would desync what's on
  // screen from what's playing), and Jasur flagged 2026-09-26 that
  // Reading has the same problem for a different reason: a passage's
  // questions are written to match that specific passage (e.g.
  // "Questions 14-20 refer to paragraph C"), so shuffling their order
  // or dropping some breaks that correspondence. So this is now a
  // permanent no-op — every section's questions are always returned as
  // authored, in order, regardless of what any row's
  // randomize_questions/questions_per_section columns say (old data
  // from before this guard, or before the UI to set it was removed
  // entirely).
  return allQuestionsForSection
}

export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function MockExams({ selfId }) {
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeExam, setActiveExam] = useState(null)

  useEffect(() => {
    let active = true

    const loadExams = async () => {
      setLoading(true)
      setError('')

      const { data, error: examsError } = await supabase
        .from('mock_exams')
        .select('*')
        .eq('is_active', true)
        .order('module', { ascending: true })
        .order('sort_order', { ascending: true })

      if (!active) return

      if (examsError) {
        setError(examsError.message || 'Could not load mock exams.')
        setLoading(false)
        return
      }

      setExams(data || [])
      setLoading(false)
    }

    loadExams()

    return () => {
      active = false
    }
  }, [])

  const byModule = useMemo(() => {
    const grouped = { reading: [], listening: [] }
    exams.forEach((exam) => {
      if (grouped[exam.module]) grouped[exam.module].push(exam)
    })
    return grouped
  }, [exams])

  const openExam = async (exam) => {
    setError('')

    const { data: sections, error: sectionsError } = await supabase
      .from('mock_sections')
      .select('*')
      .eq('exam_id', exam.id)
      .order('order_index', { ascending: true })

    if (sectionsError) {
      setError(sectionsError.message || 'Could not load this exam.')
      return
    }

    const sectionIds = (sections || []).map((s) => s.id)

    // 2026-09-26: mock_questions_public used to be a plain view anyone
    // signed in could query directly for ANY active exam, with no check
    // that this student was ever actually issued a code for it —
    // migration_57 replaced it with this security-definer function,
    // which only returns rows for a teacher or a student holding a
    // checked-in access code for the Full Mock set this exam belongs
    // to. Same columns back (never correct_answer), just sorted here
    // instead of via a chained .order() on an rpc() call.
    const { data: questionsRaw, error: questionsError } = await supabase.rpc(
      'get_mock_questions_public',
      { p_section_ids: sectionIds.length ? sectionIds : ['00000000-0000-0000-0000-000000000000'] }
    )

    if (questionsError) {
      setError(questionsError.message || 'Could not load this exam.')
      return
    }

    const questions = [...(questionsRaw || [])].sort((a, b) => a.order_index - b.order_index)

    setActiveExam({
      exam,
      sections: (sections || []).map((s) => ({
        ...s,
        questions: buildAttemptQuestions((questions || []).filter((q) => q.section_id === s.id), exam),
      })),
    })
  }

  if (activeExam) {
    return (
      <ExamTaker
        selfId={selfId}
        exam={activeExam.exam}
        sections={activeExam.sections}
        onExit={() => setActiveExam(null)}
      />
    )
  }

  return (
    <div className="ticket rounded-2xl p-5 sm:p-6 flex flex-col gap-5">

      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
          Full mock exams
        </div>

        <h2 className="font-display text-2xl sm:text-3xl mt-1">
          Mock Exams
        </h2>

        <p className="text-sm text-mist mt-1.5 max-w-md">
          Sit a full, timed exam under real IELTS conditions — timed, can't
          pause, scored instantly the moment you submit.
        </p>
      </div>

      <div className="border-t border-line pt-4">

        {loading && (
          <p className="text-sm text-mist">Loading exams…</p>
        )}

        {!loading && error && (
          <p className="text-sm text-coral">{error}</p>
        )}

        {!loading && !error && exams.length === 0 && (
          <p className="text-sm text-mist">
            No mock exams published yet — check back soon.
          </p>
        )}

        {!loading && !error && exams.length > 0 && (
          <div className="flex flex-col gap-6">
            {['reading', 'listening'].map((mod) =>
              byModule[mod].length === 0 ? null : (
                <div key={mod}>
                  <div className="mb-2.5 flex items-baseline gap-2.5">
                    <h3 className="font-display text-base text-paper">
                      {MODULE_LABEL[mod]}
                    </h3>
                    <span className="text-xs text-mist">{MODULE_BLURB[mod]}</span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {byModule[mod].map((exam) => (
                      <button
                        key={exam.id}
                        type="button"
                        onClick={() => openExam(exam)}
                        className="focus-ring group flex flex-col justify-between rounded-xl border border-line bg-panel-2 p-4 text-left transition hover:border-brass/40 hover:bg-panel"
                      >
                        <div>
                          <span className="inline-flex items-center rounded-full bg-brass/15 px-2.5 py-1 text-[11px] font-semibold capitalize text-brass">
                            {mod}
                          </span>
                          <p className="mt-2.5 font-display text-sm text-paper">
                            {exam.title}
                          </p>
                        </div>
                        <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brass group-hover:text-brass-dim">
                          Start test <span aria-hidden>→</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )}

      </div>

    </div>
  )
}

export function ExamTaker({
  selfId,
  exam,
  sections,
  onExit,
  ctaLabel = 'Back to exams',
  onAttemptStarted,
  onSubmitted,
}) {
  const [phase, setPhase] = useState('starting')
  const [attemptId, setAttemptId] = useState(null)
  const [error, setError] = useState(null)
  const [answers, setAnswers] = useState({})
  const [deadline, setDeadline] = useState(null)
  const [remainingMs, setRemainingMs] = useState(0)
  const [result, setResult] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)

  // ------------------------------------------------------------------
  // Teacher control (migration_62, 2026-09-29). The deadline is now the
  // server's own `deadline_at` (set by trigger when the attempt is
  // created) instead of being recomputed here from started_at — that's
  // what lets the teacher pause (resume pushes deadline_at forward by
  // however long it was paused) or add minutes from Live Mocks. This
  // component polls its own row every few seconds to pick those up:
  //   pausedAt        — ms timestamp while the teacher has it paused; the
  //                     clock freezes at (deadline - pausedAt) and a
  //                     full-screen "paused" cover blocks the test.
  //   endedExternally — 'submitted' if the teacher ended this section
  //                     (graded from the last autosave), 'deleted' if the
  //                     sitting was cancelled. FullMockRunner's own poll
  //                     then moves the student on.
  // Before migration_62 is run, deadline_at/paused_at simply don't come
  // back and everything behaves exactly as before.
  // ------------------------------------------------------------------
  const [pausedAt, setPausedAt] = useState(null)
  const [endedExternally, setEndedExternally] = useState(null)

  // ------------------------------------------------------------------
  // Refs mirroring the state above — fixes a real bug found 2026-09-26
  // during a full audit: the auto-submit timer's `tick` closure (below)
  // is only re-created when `phase`/`deadline` change, which for
  // Reading is ONCE, right at the start. Every answer a student picked
  // after that point was invisible to that stale closure's `answers`,
  // so a full-time auto-submit could grade against an empty/outdated
  // answers object even though the student answered everything —
  // silently scoring 0 with no error shown. Reading these refs'
  // `.current` instead of the state variables directly inside
  // handleSubmit means it's always correct regardless of which
  // render's closure ends up calling it (a fresh button click, or a
  // year-old interval tick).
  // ------------------------------------------------------------------
  const answersRef = useRef(answers)
  useEffect(() => {
    answersRef.current = answers
  }, [answers])

  const attemptIdRef = useRef(attemptId)
  useEffect(() => {
    attemptIdRef.current = attemptId
  }, [attemptId])

  // Synchronous double-submit guard — set the instant handleSubmit
  // starts, before any `await`, so a manual click and an auto-submit
  // landing at nearly the same moment (the clock hits 0:00 right as the
  // student clicks Submit) can't both pass the check and both call the
  // grading RPC concurrently. A plain `phase === 'submitting'` state
  // check isn't enough for this — two calls can both read the old phase
  // before either's setPhase('submitting') has been applied.
  const submittingRef = useRef(false)

  // ------------------------------------------------------------------
  // Offline/flaky-connection banner + retry queue (2026-09-26) — one of
  // the ~15 "build everything" brainstorm items. Before this, a dropped
  // autosave just logged to the console (invisible to the student) and a
  // failed final submit dumped them straight onto a dead-end "Something
  // went wrong" screen with no way back in except Exit. Neither told the
  // student their answers were actually safe, and neither tried again on
  // its own — exactly the moment a flaky connection does the most
  // damage, since it's also the moment a panicked student is most likely
  // to hit refresh (which resume-on-refresh handles, but shouldn't be
  // the FIRST line of defense against a normal network blip).
  //
  // `isOnline` mirrors the browser's own online/offline events, but
  // that signal alone isn't enough — a captive portal or a dead upstream
  // link can leave a browser reporting "online" while every real request
  // still fails — so `saveFailing` (set by the autosave retry loop
  // below) is the other half of the signal the banner reacts to.
  // isOnlineRef exists for the same stale-closure reason every other ref
  // in this component exists: handleSubmit's retry recursion needs the
  // CURRENT value at the moment a request fails, not whatever value
  // existed when that particular closure was created.
  // ------------------------------------------------------------------
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const isOnlineRef = useRef(isOnline)
  useEffect(() => {
    isOnlineRef.current = isOnline
  }, [isOnline])

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const [saveFailing, setSaveFailing] = useState(false)
  // { attempt, of } while an automatic submit retry is in flight, else null.
  const [submitRetry, setSubmitRetry] = useState(null)
  const lastSubmitAutoRef = useRef(false)

  // ------------------------------------------------------------------
  // Question navigator + flag-for-review — numbers run CONTINUOUSLY
  // across every section (1..40), matching the real test, instead of
  // resetting to 1 at the top of each section/passage the way the old
  // per-section `qIdx + 1` did.
  // ------------------------------------------------------------------
  const flatQuestions = useMemo(() => sections.flatMap((s) => s.questions), [sections])
  const questionIndexById = useMemo(() => {
    const map = {}
    flatQuestions.forEach((q, i) => {
      map[q.id] = i + 1
    })
    return map
  }, [flatQuestions])

  const [flags, setFlags] = useState(() => new Set())

  const toggleFlag = (questionId) => {
    setFlags((prev) => {
      const next = new Set(prev)
      if (next.has(questionId)) next.delete(questionId)
      else next.add(questionId)
      return next
    })
  }

  const jumpToQuestion = (questionId) => {
    document.getElementById(`q-${questionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // ------------------------------------------------------------------
  // Reading highlight + notes — in-memory only for this sitting (never
  // persisted; this app has never autosaved Reading/Listening answers
  // either, and there's nowhere on `mock_sections` to save it back to
  // anyway). Keyed by section id, each entry {id, start, end, note}.
  // ------------------------------------------------------------------
  const [highlightsBySection, setHighlightsBySection] = useState({})

  // Settings panel state — see FONT_SCALE_STEPS/EXAM_THEMES comment above.
  const [fontScaleIdx, setFontScaleIdx] = useState(0)
  const [themeIdx, setThemeIdx] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const activeFontScale = FONT_SCALE_STEPS[fontScaleIdx].scale
  const activeTheme = EXAM_THEMES[themeIdx]
  const sectionThemeStyle = activeTheme.bg ? { backgroundColor: activeTheme.bg, color: activeTheme.text } : undefined
  const settingsRef = useRef(null)

  useEffect(() => {
    if (!settingsOpen) return
    const onDown = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [settingsOpen])

  // Returns whether the highlight was actually added — a bug found
  // 2026-09-26: this used to always report success by returning nothing,
  // so a student who selected text overlapping an existing highlight and
  // then clicked "Note" got a note editor opened for a highlight that
  // was silently never created — typing and saving a note there did
  // nothing, with zero feedback that anything had gone wrong. Checking
  // the overlap against the current state directly (rather than inside
  // the setter callback, whose return value the caller can't see) lets
  // HighlightablePassage below tell the difference and react to it.
  const addHighlight = (sectionId, range) => {
    const existing = highlightsBySection[sectionId] || []
    const overlaps = existing.some((h) => range.start < h.end && range.end > h.start)
    if (overlaps) return false

    setHighlightsBySection((prev) => ({
      ...prev,
      [sectionId]: [...(prev[sectionId] || []), { id: range.id, start: range.start, end: range.end, note: '' }],
    }))
    return true
  }

  const updateHighlightNote = (sectionId, highlightId, note) => {
    setHighlightsBySection((prev) => ({
      ...prev,
      [sectionId]: (prev[sectionId] || []).map((h) => (h.id === highlightId ? { ...h, note } : h)),
    }))
  }

  const removeHighlight = (sectionId, highlightId) => {
    setHighlightsBySection((prev) => ({
      ...prev,
      [sectionId]: (prev[sectionId] || []).filter((h) => h.id !== highlightId),
    }))
  }

  // ------------------------------------------------------------------
  // Listening-only: track which sections' audio has played all the way
  // through, so the 2-minute review window (below) knows when to start.
  //
  // Both of these are now also persisted (see the resume-on-refresh fix
  // above/below) — without that, a refresh would reset this to {}/false
  // and let a student re-hear audio that already finished, or get a
  // fresh 2-minute review window instead of whatever was left of the
  // real one. audioEndedBySectionRef/reviewStartedAtRef exist purely so
  // the periodic-save interval always writes the CURRENT value (same
  // stale-closure reasoning as answersRef above), not whatever value
  // existed when the interval was created.
  // ------------------------------------------------------------------
  const [audioEndedBySection, setAudioEndedBySection] = useState({})
  const audioEndedBySectionRef = useRef(audioEndedBySection)
  useEffect(() => {
    audioEndedBySectionRef.current = audioEndedBySection
  }, [audioEndedBySection])

  const [reviewPhase, setReviewPhase] = useState(false)
  const reviewStartedAtRef = useRef(null)

  // ------------------------------------------------------------------
  // Notes — the real exam's pencil icon (Jasur's screenshot, 2026-09-28,
  // showing the full chrome bar: signal / bell / hamburger / pencil-in-
  // a-box) opens a free-text notepad available throughout the test, not
  // tied to any passage — the one real, working icon in that row, unlike
  // the network/notification icons beside it which the real exam shows
  // but never wires up either. A single running note per attempt (not
  // per-section) since the real tool works the same way in every part,
  // including Listening where there's no passage to select text in at
  // all. Persisted the same way answers/audioEnded already are, so a
  // refresh mid-test doesn't wipe out what the student jotted down; kept
  // out of grading entirely, same as Reading's highlight notes — a study
  // aid, never scored or sent anywhere else.
  // ------------------------------------------------------------------
  const [notes, setNotes] = useState('')
  const notesRef = useRef(notes)
  useEffect(() => {
    notesRef.current = notes
  }, [notes])
  const [notesOpen, setNotesOpen] = useState(false)

  // One volume setting for every section's audio, adjusted from the ☰
  // Settings panel (see EXAM_THEMES block) — the real exam's own chrome
  // bar has no visible slider next to the audio status line, so this
  // lives alongside Text size/Background instead of in that line.
  const [volume, setVolume] = useState(1)

  const handleAudioEnded = (sectionId) => {
    setAudioEndedBySection((prev) => (prev[sectionId] ? prev : { ...prev, [sectionId]: true }))
  }

  // ------------------------------------------------------------------
  // Momentary flash messages — the real exam's timer "flashes" at 10
  // and 5 minutes remaining, and again once the review window opens.
  // announcedRef makes sure each one only fires once per attempt.
  // ------------------------------------------------------------------
  const [flashMessage, setFlashMessage] = useState('')
  const announcedRef = useRef(new Set())

  useEffect(() => {
    if (!flashMessage) return
    const t = setTimeout(() => setFlashMessage(''), 4500)
    return () => clearTimeout(t)
  }, [flashMessage])

  // ------------------------------------------------------------------
  // Quiet tab-switch integrity log — same convention as
  // WritingMockTest.jsx/WritingMockExam.jsx: window blur AND tab
  // visibility both feed one shared "away" flag so a single switch is
  // counted once, not twice. Deliberately NOT the real Fullscreen API,
  // for the same reason those two files already settled on this —
  // most browsers force-exit fullscreen on a tab switch anyway, which
  // would make the window look like it closed. Never shown to or
  // enforced against the student; saved quietly for a teacher to see
  // as context later (migration_47 adds the column this writes to).
  // ------------------------------------------------------------------
  const tabSwitchCountRef = useRef(0)

  useEffect(() => {
    if (phase !== 'in-progress') return

    let away = false
    const markAway = () => {
      if (!away) {
        away = true
        tabSwitchCountRef.current += 1
      }
    }
    const markBack = () => {
      away = false
    }
    const onVisibility = () => {
      if (document.hidden) markAway()
      else markBack()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', markAway)
    window.addEventListener('focus', markBack)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', markAway)
      window.removeEventListener('focus', markBack)
    }
  }, [phase])

  // Cheap periodic save so the count (and, as of the resume-on-refresh
  // fix above, the student's answers-so-far) survive a crash/refresh even
  // if the student never reaches a normal submit — mirrors how Writing's
  // own autosave keeps its state current throughout, not just at the end.
  // Bundled into the same 30s tick/update as tab_switch_count rather than
  // a separate interval, to avoid doubling how often this writes to the
  // database.
  //
  // RETRY QUEUE (2026-09-26): this used to be a plain setInterval that
  // just console.error'd on failure and waited a full new 30s before
  // trying again — meaning up to a minute of unsaved answers on a flaky
  // connection, with zero visible feedback to the student. Rewritten as
  // a self-rescheduling loop instead: on success it waits the normal 30s
  // like before, but on failure it retries much sooner (5s, then 10s,
  // 20s, capped at 30s) until a save actually goes through, and flips
  // `saveFailing` so the banner below can tell the student. Always saves
  // the CURRENT answers/tab-switch-count via the refs, not a snapshot
  // frozen at the moment of the original failure — so a retry after a
  // dropped connection sends whatever the student has answered by the
  // time connectivity returns, never stale data.
  useEffect(() => {
    if (phase !== 'in-progress' || !attemptId) return
    let cancelled = false
    let timeoutId
    let failures = 0

    // 15s (was 30s) since 2026-09-29: "End section now" from Live Mocks
    // grades whatever was last autosaved, so a shorter gap loses less.
    const NORMAL_DELAY = 15_000
    const MIN_RETRY_DELAY = 5_000
    const MAX_RETRY_DELAY = 30_000

    const save = async () => {
      const { error: saveError } = await supabase
        .from('mock_attempts')
        .update({
          tab_switch_count: tabSwitchCountRef.current,
          draft_answers: {
            answers: answersRef.current,
            audioEnded: Object.keys(audioEndedBySectionRef.current),
            reviewStartedAt: reviewStartedAtRef.current,
            notes: notesRef.current,
          },
        })
        .eq('id', attemptId)

      if (cancelled) return

      if (saveError) {
        console.error('Could not save integrity log:', saveError)
        failures += 1
        setSaveFailing(true)
        const delay = Math.min(MIN_RETRY_DELAY * 2 ** (failures - 1), MAX_RETRY_DELAY)
        timeoutId = setTimeout(save, delay)
        return
      }

      failures = 0
      setSaveFailing(false)
      timeoutId = setTimeout(save, NORMAL_DELAY)
    }

    timeoutId = setTimeout(save, NORMAL_DELAY)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [phase, attemptId])

  const totalQuestions = useMemo(
    () => sections.reduce((n, s) => n + s.questions.length, 0),
    [sections]
  )

  const answeredCount = Object.values(answers).filter((v) => v.trim() !== '').length

  // Start the attempt as soon as the student opens the test, so
  // started_at reflects when they actually began rather than when they
  // submit — same as the standalone app.
  //
  // RESUME-ON-REFRESH (bug found during the 2026-09-26 audit, fixed here):
  // this used to unconditionally INSERT a brand-new mock_attempts row on
  // every mount, with a fresh full-length deadline. That meant a dropped
  // connection or an accidental refresh/back-button mid-section silently
  // orphaned whatever was in progress and started over from a blank sheet
  // with a brand new clock — losing every answer, AND (worse) letting a
  // student reset their own countdown just by refreshing the page. Now,
  // before inserting anything, this checks for an attempt already in
  // progress (submitted_at is null) for this exact exam+student and
  // resumes it instead: same attemptId, same original deadline (computed
  // from the real started_at, not "now"), and whatever answers were last
  // autosaved (see the periodic-save effect below, which now also writes
  // draft_answers alongside tab_switch_count).
  useEffect(() => {
    let cancelled = false

    const start = async () => {
      const { data: existing, error: lookupError } = await supabase
        .from('mock_attempts')
        .select('*')
        .eq('exam_id', exam.id)
        .eq('user_id', selfId)
        .is('submitted_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cancelled) return

      if (lookupError) {
        // Not fatal on its own — fall through to starting a fresh attempt
        // rather than blocking the student entirely over a transient read
        // error (e.g. offline for a moment).
        console.error('Could not check for an in-progress attempt:', lookupError)
      }

      if (existing) {
        const draft = existing.draft_answers || {}
        setAttemptId(existing.id)
        setAnswers(draft.answers || {})

        const restoredAudioEnded = {}
        ;(draft.audioEnded || []).forEach((sectionId) => {
          restoredAudioEnded[sectionId] = true
        })
        setAudioEndedBySection(restoredAudioEnded)
        setNotes(draft.notes || '')

        if (draft.reviewStartedAt) {
          // Resuming mid-review-window: restore the REMAINING review time
          // from the real start, not a fresh 2 minutes — and set reviewPhase
          // synchronously here (not left for the review-detection effect to
          // notice) so that effect's own `if (... || reviewPhase) return`
          // guard skips it on the very next render instead of overwriting
          // this with a brand-new window.
          reviewStartedAtRef.current = draft.reviewStartedAt
          setReviewPhase(true)
          setDeadline(
            existing.deadline_at
              ? new Date(existing.deadline_at).getTime()
              : new Date(draft.reviewStartedAt).getTime() + REVIEW_WINDOW_MS
          )
        } else {
          setDeadline(
            existing.deadline_at
              ? new Date(existing.deadline_at).getTime()
              : new Date(existing.started_at).getTime() + TIME_LIMIT_MINUTES[exam.module] * 60_000
          )
        }
        setPausedAt(existing.paused_at ? new Date(existing.paused_at).getTime() : null)

        setPhase('in-progress')
        onAttemptStarted?.(existing.id)
        return
      }

      const { data, error: startError } = await supabase
        .from('mock_attempts')
        .insert({ exam_id: exam.id, user_id: selfId })
        .select('*')
        .single()

      if (cancelled) return

      if (startError) {
        setError(startError.message)
        setPhase('error')
        return
      }

      setAttemptId(data.id)
      // started_at comes back from the row itself (server-assigned) rather
      // than Date.now() here, so the very first render already agrees with
      // whatever a resume later computes from the same column.
      setDeadline(
        data.deadline_at
          ? new Date(data.deadline_at).getTime()
          : new Date(data.started_at).getTime() + TIME_LIMIT_MINUTES[exam.module] * 60_000
      )
      setPhase('in-progress')
      onAttemptStarted?.(data.id)
    }

    start()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id])

  // One-off immediate save of the current draft — same payload as the
  // periodic autosave below. Used the moment a teacher pause is detected.
  const saveDraftNow = () => {
    const currentAttemptId = attemptIdRef.current
    if (!currentAttemptId) return
    supabase
      .from('mock_attempts')
      .update({
        tab_switch_count: tabSwitchCountRef.current,
        draft_answers: {
          answers: answersRef.current,
          audioEnded: Object.keys(audioEndedBySectionRef.current),
          reviewStartedAt: reviewStartedAtRef.current,
          notes: notesRef.current,
        },
      })
      .eq('id', currentAttemptId)
      .then(({ error: saveError }) => {
        if (saveError) console.error('Could not save on pause:', saveError)
      })
  }

  useEffect(() => {
    if (phase !== 'in-progress' || !deadline) return

    // Paused by the teacher: the clock shows exactly the time that was
    // left at the moment of pausing and never runs out.
    if (pausedAt) {
      setRemainingMs(Math.max(0, deadline - pausedAt))
      return
    }

    const tick = () => {
      const left = deadline - Date.now()
      setRemainingMs(Math.max(0, left))
      if (left <= 0) {
        handleSubmit(true)
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, deadline, pausedAt])

  // Poll this attempt's own row for teacher actions (pause/resume, extra
  // time, section ended, sitting cancelled) — see the TEACHER CONTROL note
  // at the top of this component. Every 5s is quick enough that a pause
  // lands almost immediately, and it's one tiny single-row read.
  const pausedAtRef = useRef(pausedAt)
  pausedAtRef.current = pausedAt
  useEffect(() => {
    if (phase !== 'in-progress' || !attemptId) return
    let cancelled = false

    const poll = async () => {
      const { data: row, error: pollError } = await supabase
        .from('mock_attempts')
        .select('*')
        .eq('id', attemptId)
        .maybeSingle()

      if (cancelled || pollError) return

      if (!row) {
        setEndedExternally('deleted')
        setPhase('ended')
        return
      }
      if (row.submitted_at && !submittingRef.current) {
        setEndedExternally('submitted')
        setPhase('ended')
        return
      }

      if (row.deadline_at) {
        const serverDeadline = new Date(row.deadline_at).getTime()
        setDeadline((prev) => (prev === serverDeadline ? prev : serverDeadline))
      }

      const nextPaused = row.paused_at ? new Date(row.paused_at).getTime() : null
      if (nextPaused && !pausedAtRef.current) {
        // Just got paused — save everything right now so nothing typed
        // since the last autosave is lost if the break is a long one.
        saveDraftNow()
      }
      setPausedAt((prev) => (prev === nextPaused ? prev : nextPaused))
    }

    const id = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, attemptId])

  // Flash the 10-minute / 5-minute warnings, exactly once each, per the
  // real computer-delivered test's own "timer flashes at 10 and 5
  // minutes remaining" behavior (confirmed during the cdielts.gelielts.com
  // research pass). Skipped once in review phase — that window is only
  // ever 2 minutes long to begin with, so it's already "critical".
  useEffect(() => {
    if (phase !== 'in-progress' || reviewPhase) return
    ;[10, 5].forEach((mark) => {
      const key = `warn-${mark}`
      if (remainingMs > 0 && remainingMs <= mark * 60_000 && !announcedRef.current.has(key)) {
        announcedRef.current.add(key)
        setFlashMessage(`${mark} minute${mark === 1 ? '' : 's'} remaining`)
      }
    })
  }, [remainingMs, phase, reviewPhase])

  // ------------------------------------------------------------------
  // The 2-minute Listening review window. Once every section that has
  // audio has played it through to the end, this OVERWRITES `deadline`
  // with a fresh 2-minute one — a fixed allowance for reviewing answers
  // with no more audio playing, same as the real test, rather than
  // whatever happened to be left of the app's own 40-minute budget.
  // That's deliberate even if it means granting a little more time than
  // the flat 40-minute figure would otherwise leave: the real exam's
  // pacing is driven by the audio, not by an arbitrary app-side clock.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (exam.module !== 'listening' || phase !== 'in-progress' || reviewPhase) return
    const sectionsWithAudio = sections.filter((s) => s.audio_url)
    if (sectionsWithAudio.length === 0) return
    const allDone = sectionsWithAudio.every((s) => audioEndedBySection[s.id])
    if (!allDone) return

    const startedAt = new Date().toISOString()
    reviewStartedAtRef.current = startedAt
    setReviewPhase(true)
    setDeadline(Date.now() + REVIEW_WINDOW_MS)
    setFlashMessage('Audio finished — 2 minutes to review your answers')

    // Save immediately rather than waiting for the next 30s autosave tick
    // — entering review phase is exactly the moment a refresh would do
    // the most damage (losing the "already reviewed, don't replay" state
    // right when it just became true), so this can't wait.
    const currentAttemptId = attemptIdRef.current
    if (currentAttemptId) {
      supabase
        .from('mock_attempts')
        .update({
          draft_answers: {
            answers: answersRef.current,
            audioEnded: Object.keys(audioEndedBySectionRef.current),
            reviewStartedAt: startedAt,
            notes: notesRef.current,
          },
        })
        .eq('id', currentAttemptId)
        .then(({ error: saveError }) => {
          if (saveError) console.error('Could not save review-phase state:', saveError)
        })
    }
  }, [audioEndedBySection, exam.module, phase, reviewPhase, sections])

  const setAnswer = (questionId, value) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }

  // MAX_SUBMIT_ATTEMPTS total tries (1 initial + 4 automatic retries)
  // spread over roughly a minute — long enough to ride out a genuine
  // blip (wifi drop, a phone briefly losing signal) without leaving the
  // student stuck on a dead-end error screen for something that fixes
  // itself in a few seconds. `attempt` is internal — always called as
  // handleSubmit(auto) from a button/timer; recursion supplies the rest.
  const MAX_SUBMIT_ATTEMPTS = 5

  const handleSubmit = async (auto = false, attempt = 1) => {
    const currentAttemptId = attemptIdRef.current
    if (!currentAttemptId || submittingRef.current) return

    if (attempt === 1 && !auto && answeredCount < totalQuestions) {
      // Styled stand-in for window.confirm() — matches the rest of the
      // app's convention (see ConfirmModal.jsx) instead of a native
      // browser dialog, which looked jarring and out of place mid-exam.
      setConfirmDialog({
        title: 'Submit anyway?',
        message: `You've answered ${answeredCount} of ${totalQuestions} questions.`,
        tone: 'brass',
        confirmLabel: 'Submit',
        onConfirm: () => runSubmit(auto, attempt),
      })
      return
    }

    runSubmit(auto, attempt)
  }

  const runSubmit = async (auto, attempt) => {
    const currentAttemptId = attemptIdRef.current
    if (!currentAttemptId || submittingRef.current) return

    if (attempt === 1) {
      lastSubmitAutoRef.current = auto
    }

    submittingRef.current = true
    setPhase('submitting')
    setSubmitRetry(attempt > 1 ? { attempt, of: MAX_SUBMIT_ATTEMPTS } : null)

    // Save the integrity log one last time alongside the real submit —
    // best-effort, a failure here shouldn't block the actual grading.
    const { error: logError } = await supabase
      .from('mock_attempts')
      .update({ tab_switch_count: tabSwitchCountRef.current })
      .eq('id', currentAttemptId)
    if (logError) console.error('Could not save integrity log:', logError)

    // Read from the ref, not the `answers` state closed over by whichever
    // render created this particular function instance — see the ref's
    // own comment above for why that distinction is the actual fix.
    const currentAnswers = answersRef.current
    const payload = sections.flatMap((s) =>
      s.questions.map((q) => ({ question_id: q.id, answer: currentAnswers[q.id] ?? '' }))
    )

    const { data, error: submitError } = await supabase.rpc('submit_mock_attempt', {
      p_attempt_id: currentAttemptId,
      p_answers: payload,
    })

    if (submitError) {
      // Only auto-retry a failure that LOOKS like a connectivity problem
      // (the browser itself is offline, or the error text matches a
      // fetch/network-shaped message) — a real validation/authorization
      // error from the RPC won't fix itself by trying again, so those
      // still go straight to the error screen below rather than wasting
      // a minute retrying something that will never succeed.
      const looksLikeNetworkTrouble =
        !isOnlineRef.current || /fetch|network|timeout|connection/i.test(submitError.message || '')

      if (looksLikeNetworkTrouble && attempt < MAX_SUBMIT_ATTEMPTS) {
        submittingRef.current = false
        const delay = Math.min(3000 * 2 ** (attempt - 1), 20_000)
        setTimeout(() => handleSubmit(auto, attempt + 1), delay)
        return
      }

      setSubmitRetry(null)
      setError(submitError.message)
      setPhase('error')
      submittingRef.current = false // allow a manual retry rather than permanently locking up
      return
    }

    setSubmitRetry(null)
    const row = Array.isArray(data) ? data[0] : data
    const finalResult = { score: row?.score ?? 0, maxScore: row?.max_score ?? 0 }
    setResult(finalResult)
    setPhase('done')
    onSubmitted?.(finalResult)
  }

  if (phase === 'starting') {
    return (
      <div className="ticket rounded-2xl p-8 text-center">
        <p className="text-sm text-mist">Starting your attempt…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="ticket rounded-2xl p-8 text-center">
        <p className="font-display text-lg text-paper">Something went wrong</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-coral">{error}</p>
        <p className="mx-auto mt-2 max-w-sm text-xs text-mist">
          Your answers are still saved on this device — retrying won't lose anything.
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => handleSubmit(lastSubmitAutoRef.current)}
            className="focus-ring inline-block rounded-full bg-brass px-5 py-2 text-sm font-bold text-onbrass shadow-sm hover:bg-brass-dim"
          >
            Try submitting again
          </button>
          <button
            type="button"
            onClick={onExit}
            className="focus-ring inline-block rounded-full bg-panel-2 px-5 py-2 text-sm font-medium text-mist hover:text-paper"
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'done' && result) {
    // No score, percentage, or transcript here on purpose — same
    // release-gate rule the rest of the app already applies to Writing/
    // Speaking (mock_attempts.released_at, migration_48): a real exam
    // gives no feedback the moment you submit, so this screen doesn't
    // either. The raw score is still saved via submit_mock_attempt() and
    // reaches the student once a teacher releases it on the Results tab
    // (MockTestCenter.jsx) — this screen only confirms the submission
    // went through.
    return (
      <div className="flex flex-col gap-5">
        <div className="ticket rounded-2xl p-8 text-center">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-brass">
            Test submitted
          </span>
          <p className="mt-3 font-display text-lg text-paper">
            Your answers have been recorded.
          </p>
          <p className="mt-1 text-sm text-mist">
            Your teacher will release your score once it's confirmed.
          </p>
          <button
            type="button"
            onClick={onExit}
            className="focus-ring mt-6 inline-block rounded-full bg-brass px-6 py-2.5 text-sm font-bold text-onbrass shadow-sm transition-transform hover:scale-105"
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'ended') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-900 shadow-sm">
        <p className="text-lg font-bold">
          {endedExternally === 'deleted'
            ? 'This sitting was cancelled by your teacher.'
            : 'Your teacher has ended this section.'}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {endedExternally === 'deleted'
            ? 'Please wait — you will be taken back in a moment.'
            : 'Your answers have been recorded. Please wait — the next part will open in a moment.'}
        </p>
      </div>
    )
  }

  const timerLevel = reviewPhase || remainingMs <= 5 * 60_000
    ? 'critical'
    : remainingMs <= 10 * 60_000
      ? 'warning'
      : 'normal'
  const timerClass = timerLevel === 'critical' ? 'animate-pulse' : ''
  const timerColor =
    timerLevel === 'critical' ? '#c81e3a' : timerLevel === 'warning' ? '#9a5b00' : '#1c1b29'

  // Fixed light pink/candidate-ID chrome bar, deliberately NOT using the
  // app's own dark brass theme tokens — same reasoning as the restyled
  // confirm-before-start gate in FullMockRunner.jsx: this one screen is
  // meant to look like the real exam regardless of the site's own
  // light/dark mode, not blend in with the rest of the app. Colors and
  // layout (candidate name top-left, live countdown, a bordered "Finish
  // test" button, disabled-during-test network/notification icons) match
  // Jasur's own screenshots of the official IELTS-on-computer
  // familiarisation test (cdielts.gelielts.com), 2026-09-28.
  const examChromeBg = '#e3a7ae'
  const examChromeText = '#1c1b29'

  return (
    <div className="flex flex-col gap-5 pb-10">
      <ConfirmModal
        open={Boolean(confirmDialog)}
        {...confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const run = confirmDialog?.onConfirm
          setConfirmDialog(null)
          run?.()
        }}
      />
      {pausedAt && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 p-6">
          <div className="max-w-md rounded-xl bg-white px-8 py-7 text-center text-slate-900 shadow-2xl">
            <p className="text-xl font-bold">Your test has been paused</p>
            <p className="mt-2 text-sm text-slate-600">
              Your teacher has paused this test. The timer is stopped and your answers are saved.
              It will continue from exactly where you are when your teacher resumes it.
            </p>
          </div>
        </div>
      )}
      {flashMessage && (
        <div className="fixed top-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink/95 px-4 py-2 text-sm font-semibold text-paper shadow-lg animate-pulse">
          ⏱ {flashMessage}
        </div>
      )}

      <div
        className="sticky top-3 z-10 flex flex-col gap-2.5 rounded-md px-5 py-3 shadow-md"
        style={{ background: examChromeBg, color: examChromeText }}
      >
        {(!isOnline || saveFailing || submitRetry) && (
          <div
            className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold"
            style={{ background: 'rgba(0,0,0,0.1)' }}
          >
            <span aria-hidden>⚠</span>
            {submitRetry ? (
              <span>
                Couldn't reach the server — retrying your submission (attempt {submitRetry.attempt} of{' '}
                {submitRetry.of})… your answers are safe.
              </span>
            ) : !isOnline ? (
              <span>
                You're offline — your answers are saved on this device and will sync once you're back
                online. Don't close this tab.
              </span>
            ) : (
              <span>
                Having trouble reaching the server — retrying automatically. Your answers are safe on
                this device.
              </span>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest opacity-60">
              {reviewPhase ? 'Review time' : exam.module}
            </p>
            <p className="font-display text-sm font-bold leading-tight">{exam.title}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs opacity-70">
              {answeredCount}/{totalQuestions} answered
            </span>
            <span
              className={`font-display text-lg font-bold tabular-nums ${timerClass}`}
              style={{ color: timerColor }}
            >
              {formatClock(remainingMs)}
            </span>
            {/* Network/notification icons — cosmetic only, matching the real
                exam's own icons, which are shown but disabled throughout
                the test. */}
            <span className="opacity-40" title="Network connection" aria-hidden>
              📶
            </span>
            <span className="opacity-40" title="Notifications" aria-hidden>
              🔔
            </span>
            <div className="relative" ref={settingsRef}>
              <button
                type="button"
                onClick={() => setSettingsOpen((o) => !o)}
                title="Settings"
                className="focus-ring rounded-md px-2 py-1.5 text-sm opacity-80 hover:opacity-100"
              >
                ☰
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-line bg-panel p-4 text-left shadow-lg text-paper">
                  <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-mist">Text size</p>
                  <div className="mb-4 flex gap-2">
                    {FONT_SCALE_STEPS.map((step, i) => (
                      <button
                        key={step.key}
                        type="button"
                        onClick={() => setFontScaleIdx(i)}
                        className={`focus-ring flex-1 rounded-lg border px-2 py-1.5 text-sm font-bold transition-colors ${
                          i === fontScaleIdx
                            ? 'border-brass/40 bg-brass/15 text-paper'
                            : 'border-line bg-panel-2 text-mist hover:border-brass/30'
                        }`}
                      >
                        {step.label}
                      </button>
                    ))}
                  </div>

                  <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-mist">Background</p>
                  <div className="flex flex-col gap-1.5">
                    {EXAM_THEMES.map((theme, i) => (
                      <button
                        key={theme.key}
                        type="button"
                        onClick={() => setThemeIdx(i)}
                        className={`focus-ring flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                          i === themeIdx
                            ? 'border-brass/40 bg-brass/15 text-paper'
                            : 'border-line bg-panel-2 text-mist hover:border-brass/30'
                        }`}
                      >
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded-full border border-line"
                          style={{ backgroundColor: theme.bg || '#8a8578' }}
                          aria-hidden
                        />
                        {theme.label}
                      </button>
                    ))}
                  </div>

                  {exam.module === 'listening' && (
                    <>
                      <p className="mb-2 mt-4 font-mono text-[11px] uppercase tracking-wide text-mist">Volume</p>
                      <div className="flex items-center gap-2">
                        <span className="text-sm" aria-hidden>🔊</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={volume}
                          onChange={(e) => setVolume(Number(e.target.value))}
                          className="w-full accent-brass"
                          aria-label="Volume"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setNotesOpen((o) => !o)}
              title="Notes"
              aria-pressed={notesOpen}
              className={`focus-ring rounded-md px-2 py-1.5 text-sm transition-colors ${
                notesOpen ? 'bg-black/10 opacity-100' : 'opacity-80 hover:opacity-100'
              }`}
            >
              ✏️
            </button>
            {/* No manual "Finish test"/submit control here — Jasur,
                verbatim: "finish test button has to be removed/ submit
                button shouldnt be available." Matches the real exam:
                a section ends only when its own clock runs out
                (handleSubmit(true) above, on the deadline timer), never
                by the student's own choice. Do not re-add a manual
                submit button to this bar. */}
          </div>
        </div>

        {flatQuestions.length > 0 && (
          <QuestionNavigator
            questions={flatQuestions}
            answers={answers}
            flags={flags}
            onJump={jumpToQuestion}
          />
        )}

        {reviewPhase && (
          <p className="text-[11px] font-medium opacity-85">
            All audio has finished — no more will play. You have 2 minutes to review your
            answers before this submits automatically.
          </p>
        )}
      </div>

      {notesOpen && (
        <div
          className="fixed right-3 top-20 bottom-3 z-30 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col rounded-xl border border-line bg-panel shadow-xl"
          role="dialog"
          aria-label="Notes"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-display text-sm font-bold text-paper">Notes</p>
            <button
              type="button"
              onClick={() => setNotesOpen(false)}
              title="Close notes"
              className="focus-ring rounded-md px-1.5 py-0.5 text-mist hover:text-paper"
            >
              ✕
            </button>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Jot anything down here — nothing in this box is graded or seen by anyone else, just like the real test's notepad."
            className="focus-ring flex-1 resize-none rounded-b-xl bg-panel-2 p-4 text-sm text-paper placeholder:text-mist"
          />
        </div>
      )}

      {sections.map((section, sIdx) => {
        const sectionTitle =
          section.title || `${exam.module === 'reading' ? 'Passage' : 'Section'} ${sIdx + 1}`

        // "Matching headings"-style questions — a "matching" question
        // whose prompt names a specific paragraph ("Paragraph B") — get
        // their drop target rendered inline at the start of that
        // paragraph instead of only in the question list, per Jasur's
        // 2026-09-28 request ("make a space before the beginning of the
        // paragraph and options should be draggable"). Only kicks in when
        // the passage actually has recognizable lettered paragraphs
        // (splitLetteredParagraphs returns null otherwise) — every other
        // Reading section (no paragraph letters, or matching questions
        // that don't reference one) renders exactly as before.
        const paragraphMatchRe = /^paragraph\s+([a-z0-9]+)\b/i
        const paragraphMatchQuestions = new Map()
        section.questions.forEach((q) => {
          if (q.type !== 'matching') return
          const m = paragraphMatchRe.exec((q.prompt || '').trim())
          if (m) paragraphMatchQuestions.set(m[1].toUpperCase(), q)
        })
        const letteredParagraphs =
          exam.module === 'reading' && section.passage_text && paragraphMatchQuestions.size > 0
            ? splitLetteredParagraphs(section.passage_text)
            : null
        // Only the questions that actually land on a real paragraph in
        // this passage get pulled out of the question list — a matching
        // question naming a letter the passage doesn't have (shouldn't
        // happen, but never trust it blindly) simply stays in the normal
        // list rather than disappearing from both places.
        const renderedLetters = letteredParagraphs
          ? new Set(
              letteredParagraphs
                .filter((p) => p.letter && paragraphMatchQuestions.has(p.letter))
                .map((p) => p.letter)
            )
          : new Set()
        const useParagraphDrops = renderedLetters.size > 0
        const inlineQuestionIds = useParagraphDrops
          ? new Set(Array.from(renderedLetters).map((letter) => paragraphMatchQuestions.get(letter).id))
          : null

        const visibleQuestions = section.questions.filter(
          (q) => !inlineQuestionIds || !inlineQuestionIds.has(q.id)
        )

        // Group consecutive `matching` questions that share the exact
        // same choice bank so it renders once instead of being repeated
        // under every question — see MatchingQuestion's hideBank comment
        // for the full story. A lone matching question (no matching
        // neighbor with the same bank) falls through to the single-item
        // branch unchanged.
        const questionRenderGroups = []
        for (let i = 0; i < visibleQuestions.length; ) {
          const q = visibleQuestions[i]
          if (q.type !== 'matching') {
            questionRenderGroups.push({ kind: 'single', question: q })
            i++
            continue
          }
          const bankKey = JSON.stringify(q.options?.choices || [])
          let j = i + 1
          while (
            j < visibleQuestions.length &&
            visibleQuestions[j].type === 'matching' &&
            JSON.stringify(visibleQuestions[j].options?.choices || []) === bankKey
          ) {
            j++
          }
          const run = visibleQuestions.slice(i, j)
          if (run.length > 1) {
            questionRenderGroups.push({ kind: 'group', questions: run, choices: q.options?.choices || [] })
          } else {
            questionRenderGroups.push({ kind: 'single', question: run[0] })
          }
          i = j
        }

        const questionsList = (
          <div className="flex flex-col gap-4">
            {questionRenderGroups.map((g) =>
              g.kind === 'group' ? (
                <MatchingQuestionGroup
                  key={g.questions[0].id}
                  questions={g.questions}
                  choices={g.choices}
                  answers={answers}
                  onChange={setAnswer}
                  flags={flags}
                  onToggleFlag={toggleFlag}
                  questionIndexById={questionIndexById}
                  fontScale={activeFontScale}
                  theme={activeTheme}
                />
              ) : (
                <QuestionBlock
                  key={g.question.id}
                  index={questionIndexById[g.question.id]}
                  question={g.question}
                  value={answers[g.question.id] ?? ''}
                  onChange={(v) => setAnswer(g.question.id, v)}
                  flagged={flags.has(g.question.id)}
                  onToggleFlag={() => toggleFlag(g.question.id)}
                  fontScale={activeFontScale}
                  theme={activeTheme}
                />
              )
            )}
          </div>
        )

        // Reading gets the real computer-delivered exam's split screen —
        // passage on the left, questions on the right, divided by a
        // vertical line — instead of the passage stacked above the
        // questions. Each scrolls independently (the passage stays put
        // while you scroll through questions, same as the real test)
        // once there's room for two columns; on a narrow screen it falls
        // back to stacked, since there's no room for a real split there.
        if (exam.module === 'reading' && section.passage_text) {
          return (
            <div
              key={section.id}
              className="ticket rounded-2xl p-5 sm:p-6"
              style={sectionThemeStyle}
            >
              <p
                className="mb-3 font-display text-base"
                style={sectionThemeStyle ? { color: activeTheme.text } : undefined}
              >
                {sectionTitle}
              </p>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-0">
                <div className="lg:sticky lg:top-24 lg:max-h-[75vh] lg:self-start lg:overflow-y-auto lg:pr-6">
                  {useParagraphDrops ? (
                    <LetteredMatchingPassage
                      fullText={section.passage_text}
                      paragraphs={letteredParagraphs}
                      matchingByParagraph={Object.fromEntries(paragraphMatchQuestions)}
                      bankChoices={Array.from(
                        new Set(
                          Array.from(paragraphMatchQuestions.values()).flatMap(
                            (q) => q.options?.choices || []
                          )
                        )
                      )}
                      answers={answers}
                      setAnswer={setAnswer}
                      flags={flags}
                      toggleFlag={toggleFlag}
                      questionIndexById={questionIndexById}
                      highlights={highlightsBySection[section.id] || []}
                      onAdd={(range) => addHighlight(section.id, range)}
                      onUpdateNote={(id, note) => updateHighlightNote(section.id, id, note)}
                      onRemove={(id) => removeHighlight(section.id, id)}
                      fontScale={activeFontScale}
                      theme={activeTheme}
                    />
                  ) : (
                    <HighlightablePassage
                      text={section.passage_text}
                      highlights={highlightsBySection[section.id] || []}
                      onAdd={(range) => addHighlight(section.id, range)}
                      onUpdateNote={(id, note) => updateHighlightNote(section.id, id, note)}
                      onRemove={(id) => removeHighlight(section.id, id)}
                      fontScale={activeFontScale}
                      theme={activeTheme}
                    />
                  )}
                </div>
                <div className="lg:border-l lg:border-line lg:pl-6">{questionsList}</div>
              </div>
            </div>
          )
        }

        return (
          <div
            key={section.id}
            className="ticket rounded-2xl p-5 sm:p-6"
            style={sectionThemeStyle}
          >
            <p
              className="mb-3 font-display text-base"
              style={sectionThemeStyle ? { color: activeTheme.text } : undefined}
            >
              {sectionTitle}
            </p>

            {exam.module === 'listening' && section.audio_url && (
              <div className="mb-4">
                <SectionAudioPlayer
                  url={section.audio_url}
                  onEnded={() => handleAudioEnded(section.id)}
                  alreadyEnded={!!audioEndedBySection[section.id]}
                  volume={volume}
                  paused={Boolean(pausedAt)}
                />
              </div>
            )}

            {questionsList}
          </div>
        )
      })}
    </div>
  )
}

// Numbered chips the student can click to jump straight to any
// question — answered ones fill in, an unanswered one stays hollow, and
// a flagged one (regardless of answered state) gets a small coral dot,
// mirroring the real test's own flag-for-review navigator.
function QuestionNavigator({ questions, answers, flags, onJump }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
      {questions.map((q, i) => {
        const answered = Boolean((answers[q.id] ?? '').trim())
        const flagged = flags.has(q.id)
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => onJump(q.id)}
            title={flagged ? `Question ${i + 1} — flagged for review` : `Question ${i + 1}`}
            className={`focus-ring relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold transition-colors ${
              answered
                ? 'bg-onbrass text-brass'
                : 'bg-onbrass/20 text-onbrass/80 hover:bg-onbrass/35'
            }`}
          >
            {i + 1}
            {flagged && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-brass bg-coral" />
            )}
          </button>
        )
      })}
    </div>
  )
}

// Single-playback audio — plays once, start to finish, with a volume
// slider but no scrub bar (no native `controls`, so there's no drag
// handle to seek with, and the context menu is blocked so a browser's
// own "show controls" option can't reopen one either). Matches the
// real test's "audio plays once" rule instead of the old plain
// `<audio controls>` element, which let a student scrub back and
// replay freely.
// `alreadyEnded` — restored from the resume-on-refresh fix above: without
// this, a page refresh after this section's audio already finished would
// remount this component fresh (status defaulting back to 'ready'),
// silently letting a student re-hear audio the real exam only ever plays
// once. When true, this mounts straight into the 'done' state instead —
// matching exactly what the student would already be looking at if the
// page had never reloaded.
//
// RESTYLED 2026-09-28 — Jasur's own screenshot of the real chrome bar
// shows the audio status as one plain line next to the timer: a small
// speaker icon and the words "Audio is playing," nothing else — no
// bordered card, no progress bar, no "transcript available" caption. He
// then asked, of the old version: "why is this box at the top." Browsers
// still won't auto-play without a click, so the one-time "Play audio"
// button stays (the real exam doesn't need it — it starts itself), but
// everything after that click is now this same plain line, and nothing
// at all is shown once the audio has finished instead of a lingering
// "Played" state. The volume slider moved into the ☰ Settings panel
// (see EXAM_THEMES block below) alongside the other display controls,
// rather than sitting in this line the real exam doesn't show it in.
function SectionAudioPlayer({ url, onEnded, alreadyEnded = false, volume, paused = false }) {
  const audioRef = useRef(null)
  const [status, setStatus] = useState(alreadyEnded ? 'done' : 'ready') // ready | playing | done

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  // Teacher pause (migration_62) stops the recording where it is; resume
  // carries on from the same second — the only way this player is ever
  // paused, since the student has no pause control of their own.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || status !== 'playing') return
    if (paused) audio.pause()
    else audio.play().catch(() => {})
  }, [paused, status])

  const handlePlay = () => {
    if (status !== 'ready') return
    setStatus('playing')
    audioRef.current?.play()
  }

  const handleEnded = () => {
    setStatus('done')
    onEnded?.()
  }

  return (
    <div className="flex items-center gap-2">
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onEnded={handleEnded}
        onContextMenu={(e) => e.preventDefault()}
        controlsList="nodownload noplaybackrate nofullscreen"
        className="hidden"
      />

      {status === 'ready' && (
        <button
          type="button"
          onClick={handlePlay}
          className="focus-ring shrink-0 rounded-full bg-brass px-4 py-1.5 text-xs font-bold text-onbrass shadow-sm hover:bg-brass-dim"
        >
          ▶ Play audio
        </button>
      )}
      {status === 'playing' && (
        <p className="text-xs font-medium text-mist">
          <span aria-hidden>🔊</span> Audio is playing
        </p>
      )}
    </div>
  )
}

// Select text in the passage to highlight it, or attach a short note —
// the real exam's own highlighter/notes tool. Ranges are plain
// character offsets into the passage text (computed via a Range from
// the start of the container, a standard DOM technique that works
// regardless of how many spans the text is broken into for rendering),
// so this works with no contenteditable and no external library.
// Deliberately simple for v1: an overlapping selection is rejected
// rather than merged/split — good enough for what a real passage
// actually needs, and a lot less code to get wrong.
function HighlightablePassage({ text, highlights, onAdd, onUpdateNote, onRemove, fontScale = 1, theme }) {
  const themeStyle = theme?.bg ? { backgroundColor: theme.bg, color: theme.text } : undefined
  const containerRef = useRef(null)
  const [toolbar, setToolbar] = useState(null) // { start, end, rect }
  const [openNoteFor, setOpenNoteFor] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [rejectFlash, setRejectFlash] = useState(false) // true briefly after an overlapping selection is rejected

  useEffect(() => {
    if (!rejectFlash) return
    const t = setTimeout(() => setRejectFlash(false), 2200)
    return () => clearTimeout(t)
  }, [rejectFlash])

  const getSelectionOffsets = () => {
    const container = containerRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return null

    const range = selection.getRangeAt(0)
    if (range.collapsed || !container.contains(range.commonAncestorContainer)) return null

    const preRange = document.createRange()
    preRange.selectNodeContents(container)
    preRange.setEnd(range.startContainer, range.startOffset)
    const start = preRange.toString().length
    const end = start + range.toString().length
    if (end <= start) return null

    return { start, end, rect: range.getBoundingClientRect() }
  }

  const handleMouseUp = () => {
    setToolbar(getSelectionOffsets())
  }

  // BUG FIX 2026-09-29 (Jasur: "highlighting, note taking is not
  // working"): this outside-click handler used to close the toolbar on
  // ANY mousedown outside the passage container — and the toolbar itself
  // is rendered outside that container. So pressing "Highlight" or
  // "Note" fired this first, unmounted the toolbar, and the button's own
  // click never happened. Neither action could ever succeed with a mouse.
  // Clicks inside the toolbar (and the note editor) are now ignored here.
  const toolbarRef = useRef(null)
  const noteEditorRef = useRef(null)
  const noteDraftRef = useRef('')
  noteDraftRef.current = noteDraft
  useEffect(() => {
    if (!toolbar) return
    const onDown = (e) => {
      if (containerRef.current?.contains(e.target)) return
      if (toolbarRef.current?.contains(e.target)) return
      setToolbar(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [toolbar])

  // The note editor had no way to close by clicking elsewhere, and was
  // pinned to the bottom of the passage box rather than near anything —
  // close it on an outside click, keeping whatever was typed saved.
  useEffect(() => {
    if (!openNoteFor) return
    const onDown = (e) => {
      if (noteEditorRef.current?.contains(e.target)) return
      onUpdateNote(openNoteFor, noteDraftRef.current)
      setOpenNoteFor(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNoteFor])

  const handleHighlight = () => {
    if (!toolbar) return
    const added = onAdd({ id: crypto.randomUUID(), start: toolbar.start, end: toolbar.end })
    setToolbar(null)
    window.getSelection()?.removeAllRanges()
    if (!added) setRejectFlash(true)
  }

  const handleAddNote = () => {
    if (!toolbar) return
    const id = crypto.randomUUID()
    const added = onAdd({ id, start: toolbar.start, end: toolbar.end })
    setToolbar(null)
    window.getSelection()?.removeAllRanges()
    if (!added) {
      // Bug fix 2026-09-26: don't open a note editor for a highlight that
      // was never created (an overlapping selection) — see addHighlight's
      // own comment in ExamTaker for the full failure this used to cause.
      setRejectFlash(true)
      return
    }
    setNoteDraft('')
    setOpenNoteFor(id)
  }

  const segments = useMemo(() => {
    const sorted = [...highlights].sort((a, b) => a.start - b.start)
    const out = []
    let cursor = 0
    sorted.forEach((h) => {
      if (h.start > cursor) out.push({ key: `t${cursor}`, plain: text.slice(cursor, h.start) })
      out.push({ key: `h${h.id}`, highlight: h, plain: text.slice(h.start, h.end) })
      cursor = Math.max(cursor, h.end)
    })
    if (cursor < text.length) out.push({ key: `t${cursor}`, plain: text.slice(cursor) })
    return out
  }, [text, highlights])

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="max-h-72 overflow-y-auto rounded-xl border border-line bg-panel-2 p-4 leading-relaxed text-paper whitespace-pre-wrap"
        style={{ fontSize: `${0.875 * fontScale}rem`, ...(themeStyle || {}) }}
      >
        {segments.map((seg) =>
          seg.highlight ? (
            <mark
              key={seg.key}
              onClick={(e) => {
                e.stopPropagation()
                setNoteDraft(seg.highlight.note || '')
                setOpenNoteFor(seg.highlight.id)
              }}
              title={seg.highlight.note ? `Note: ${seg.highlight.note}` : 'Click to add a note or remove'}
              className="cursor-pointer rounded bg-amber/35 px-0.5"
            >
              {seg.plain}
            </mark>
          ) : (
            <span key={seg.key}>{seg.plain}</span>
          )
        )}
      </div>

      <p className={`mt-1.5 text-[11px] ${rejectFlash ? 'text-coral font-medium' : 'text-mist'}`}>
        {rejectFlash
          ? "That overlaps a highlight you already made — remove it first, or select different text."
          : 'Select any text above to highlight it or attach a note.'}
      </p>

      {toolbar && (
        <div
          ref={toolbarRef}
          onMouseDown={(e) => e.preventDefault()}
          style={{ position: 'fixed', left: Math.max(8, toolbar.rect.left), top: Math.max(8, toolbar.rect.top - 46) }}
          className="z-30 flex items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-1.5 shadow-lg"
        >
          <button
            type="button"
            onClick={handleHighlight}
            className="focus-ring rounded-full bg-amber/20 px-3 py-1 text-xs font-semibold text-amber hover:bg-amber/30"
          >
            🖊 Highlight
          </button>
          <button
            type="button"
            onClick={handleAddNote}
            className="focus-ring rounded-full bg-panel-2 px-3 py-1 text-xs font-semibold text-paper-dim hover:text-paper"
          >
            📝 Note
          </button>
        </div>
      )}

      {openNoteFor && (
        <div ref={noteEditorRef} className="absolute z-30 mt-2 w-64 rounded-xl border border-line bg-panel p-3 shadow-lg">
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-mist font-mono">Note</p>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={3}
            placeholder="Jot a note about this…"
            className="focus-ring w-full resize-none rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs text-paper"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onRemove(openNoteFor)
                setOpenNoteFor(null)
              }}
              className="focus-ring rounded-full border border-coral/30 px-3 py-1 text-[11px] font-semibold text-coral hover:bg-coral/10"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateNote(openNoteFor, noteDraft)
                setOpenNoteFor(null)
              }}
              className="focus-ring rounded-full bg-brass px-3 py-1 text-[11px] font-bold text-onbrass"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Splits a Reading passage into its lettered paragraphs (A, B, C, ...) —
// each one printed as a bare capital letter on its own line, blank-line
// separated from its body text, exactly the convention real "matching
// headings" passages use (and the one mock-content-import's own AI
// extraction preserves verbatim when the source document has it). Added
// 2026-09-28 so a "matching" question whose prompt is "Paragraph B" can
// get its drop target rendered right at the start of paragraph B itself,
// per Jasur's request, instead of only in the separate question list.
//
// Offsets in the returned array are into the ORIGINAL passage text, not
// the individual paragraph slices — this matters because every stored
// highlight (highlightsBySection) is a {start, end} pair against that
// same original text, and this split has to stay reversible: a highlight
// made inside one paragraph's own mini highlighter gets its LOCAL offset
// translated back to a GLOBAL one before it's ever stored, so nothing
// about how highlights are created, stored, or rendered elsewhere has to
// change. Returns null when the text doesn't actually contain at least
// two of these letter markers, so the caller can fall back to the
// existing single-block passage instead of guessing at a structure that
// isn't really there.
function splitLetteredParagraphs(text) {
  const lines = text.split('\n')
  // lineStarts[i] — the character offset in the ORIGINAL text where
  // lines[i] begins, so a marker found by scanning `lines` can still be
  // reported in terms of the original string's own offsets.
  const lineStarts = []
  let offset = 0
  for (const line of lines) {
    lineStarts.push(offset)
    offset += line.length + 1 // +1 for the '\n' every split() boundary consumed
  }

  const isBlank = (i) => i < 0 || i >= lines.length || lines[i].trim() === ''
  const letterLineRe = /^[ \t]*([A-Z])[ \t]*$/

  const markers = []
  for (let i = 0; i < lines.length; i++) {
    const match = letterLineRe.exec(lines[i])
    if (!match) continue
    if (i !== 0 && !isBlank(i - 1)) continue // must open a new paragraph, not sit mid-line-group
    if (!isBlank(i + 1)) continue // must be followed by the blank line that separates it from its body

    let bodyLine = i + 1
    while (bodyLine < lines.length && lines[bodyLine].trim() === '') bodyLine++
    if (bodyLine >= lines.length) continue // nothing after it — not a real paragraph label

    markers.push({ letter: match[1], labelStart: lineStarts[i], bodyStart: lineStarts[bodyLine] })
  }
  if (markers.length < 2) return null

  const paragraphs = []
  if (markers[0].labelStart > 0) {
    paragraphs.push({ letter: null, start: 0, end: markers[0].labelStart })
  }
  markers.forEach((marker, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].labelStart : text.length
    paragraphs.push({ letter: marker.letter, start: marker.bodyStart, end })
  })
  return paragraphs
}

// The passage side of a "matching headings" (or matching-anything-per-
// paragraph) Reading section — one HighlightablePassage per paragraph
// (so highlighting/notes keep working exactly as before, just scoped to
// that paragraph's own slice) with a draggable-drop-target inserted right
// before any paragraph a "matching" question's prompt names ("Paragraph
// B"). The bank of headings is rendered once, at the top, shared by every
// slot — the same drag chips as MatchingQuestion below, so dragging one
// onto a slot (or a slot further down) behaves identically; a slot can
// also be tapped to open... no — kept drag-or-nothing here deliberately
// simple since every slot is visible at once (unlike MatchingQuestion's
// single hidden target), a student can just drag from the bank straight
// to the right paragraph without needing a tap fallback.
function LetteredMatchingPassage({
  fullText,
  paragraphs,
  matchingByParagraph,
  bankChoices,
  answers,
  setAnswer,
  flags,
  toggleFlag,
  questionIndexById,
  highlights,
  onAdd,
  onUpdateNote,
  onRemove,
  fontScale = 1,
  theme,
}) {
  const [dragOverLetter, setDragOverLetter] = useState(null)

  // Once a heading is placed on a paragraph, it drops out of this bank
  // entirely instead of staying visible-but-dimmed — Jasur, 2026-09-28:
  // "once the answer is dragged it should disappear from the list."
  // Re-dragging a DIFFERENT heading onto an already-answered paragraph
  // still works and still overwrites it (setAnswer just replaces the
  // value), which naturally puts the old heading straight back in this
  // list the next render, since it's no longer any paragraph's answer.
  const remainingBankChoices = bankChoices.filter(
    (choice) => !Object.values(matchingByParagraph).some((q) => answers[q.id] === choice)
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-dashed border-line bg-panel p-3">
        <p className="mb-2 text-[11px] text-mist">
          Drag a heading onto the blank at the start of the paragraph it belongs to.
        </p>
        <div className="flex flex-wrap gap-2">
          {remainingBankChoices.length > 0 ? (
            remainingBankChoices.map((choice) => (
              <button
                key={choice}
                type="button"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', choice)}
                style={{ fontSize: `${0.8125 * fontScale}rem`, ...themedOptionStyle(theme, false) }}
                className="focus-ring cursor-grab rounded-full border border-line bg-panel-2 px-3 py-1.5 text-mist transition-colors hover:border-brass/30 active:cursor-grabbing"
              >
                {choice}
              </button>
            ))
          ) : (
            <p className="text-[11px] text-mist">All headings placed.</p>
          )}
        </div>
      </div>

      {paragraphs.map((p) => {
        const q = p.letter ? matchingByParagraph[p.letter] : null
        const localHighlights = highlights
          .filter((h) => h.start >= p.start && h.end <= p.end)
          .map((h) => ({ ...h, start: h.start - p.start, end: h.end - p.start }))

        return (
          <div key={`${p.letter || 'lead'}-${p.start}`}>
            {q && (
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOverLetter(p.letter)
                }}
                onDragLeave={() => setDragOverLetter((cur) => (cur === p.letter ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverLetter(null)
                  const choice = e.dataTransfer.getData('text/plain')
                  if (choice) setAnswer(q.id, choice)
                }}
                style={{ fontSize: `${0.8125 * fontScale}rem` }}
                className={`mb-1.5 flex items-center gap-2 rounded-lg border-2 border-dashed px-3 py-1.5 transition-colors ${
                  dragOverLetter === p.letter
                    ? 'border-brass bg-brass/10 text-paper'
                    : answers[q.id]
                      ? 'border-brass/40 bg-brass/5 text-paper'
                      : 'border-line bg-panel text-mist'
                }`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 text-[10px] font-bold text-paper">
                  {questionIndexById[q.id]}
                </span>
                <span className="flex-1">{answers[q.id] || 'Drag a heading here'}</span>
                <button
                  type="button"
                  onClick={() => toggleFlag(q.id)}
                  title={flags.has(q.id) ? 'Unflag this question' : 'Flag this question for review'}
                  className={`shrink-0 text-xs ${flags.has(q.id) ? 'text-coral' : 'text-mist hover:text-paper'}`}
                >
                  ⚑
                </button>
              </div>
            )}
            <HighlightablePassage
              text={fullText.slice(p.start, p.end).replace(/\s+$/, '')}
              highlights={localHighlights}
              onAdd={(range) => onAdd({ ...range, start: range.start + p.start, end: range.end + p.start })}
              onUpdateNote={onUpdateNote}
              onRemove={onRemove}
              fontScale={fontScale}
              theme={theme}
            />
          </div>
        )
      })}
    </div>
  )
}

// Splits a short_answer prompt around its blank so the answer box can
// be dropped INLINE, exactly where the blank is — real exam screenshots
// (Jasur, 2026-09-28) show the gap as part of the running sentence
// ("The lecture will be useful for any students who are writing [box]
// and theses.") with the question's own number shown only as light
// placeholder text inside that box, never typed into the sentence
// itself and never a separate "N." prefix or a full-width input on its
// own line below. mock-content-import's AI extraction already writes a
// run of underscores at the blank (e.g. "A wooden 1 _____ (a model)."),
// but — unlike the real exam — it also writes the question's own number
// as plain text right before the underscores, duplicating what the
// input box's placeholder is about to show; this strips that duplicate
// number so it isn't printed twice.
//
// Returns { before, after } to render as `{before}<input/>{after}`. When
// no blank run is found at all (a standalone question like "What number
// room will Mr Griffin be in at the Sunrise Hotel?"), `after` is '' and
// the input simply lands inline at the end of the sentence — the same
// real-exam screenshots show that's just the blank-at-the-very-end case
// of the same pattern, not a different one.
function splitPromptBlank(prompt, index) {
  const text = prompt || ''
  const blankMatch = /_{2,}/.exec(text)
  if (!blankMatch) return { before: text, after: '' }

  let before = text.slice(0, blankMatch.index)
  const after = text.slice(blankMatch.index + blankMatch[0].length)

  const dupNumber = new RegExp(`(^|\\s)${index}\\s*$`).exec(before)
  if (dupNumber) before = before.slice(0, dupNumber.index) + (dupNumber[1] === '' ? '' : dupNumber[1])

  return { before, after }
}

// Shared theme helper for every answer control below — a selected
// option always uses the accent-brass look regardless of background
// (it's the app's own selection color, still legible on any of the
// EXAM_THEMES), but an UNselected option's own dark bg-panel/border-line
// classes would otherwise float oddly on top of a white/cream/black
// section background. When a non-default theme is active, this
// overrides just that resting-state background/border/text via inline
// style — inline style always wins over the Tailwind classes already
// on the element, so nothing needs stripping.
function themedOptionStyle(theme, selected) {
  if (!theme?.bg || selected) return undefined
  return { backgroundColor: theme.surface, borderColor: theme.surfaceBorder, color: theme.text }
}

export function QuestionBlock({ index, question, value, onChange, flagged = false, onToggleFlag, fontScale = 1, theme, hideMatchingBank = false }) {
  const promptStyle = {
    fontSize: `${0.875 * fontScale}rem`,
    ...(theme?.bg ? { color: theme.text } : {}),
  }
  const optionTextStyle = { fontSize: `${0.875 * fontScale}rem` }

  // Short-answer questions (a standalone sentence ending in a real
  // question, not a note with an inline blank) get the real exam's own
  // treatment — Jasur, sending a screenshot of the real interface:
  // "like this." There, the sentence carries no leading number at all;
  // the number only appears (as light placeholder text) inside its own
  // small answer box, and consecutive questions run straight into each
  // other with no divider line between them — a continuous form, not a
  // stack of separately-bordered cards. The QuestionNavigator strip in
  // the sticky header already shows which number is which, so nothing
  // is lost by dropping the inline "N." prefix here.
  const isShortAnswer = question.type === 'short_answer'
  const shortAnswerParts = isShortAnswer ? splitPromptBlank(question.prompt, index) : null
  const shortAnswerInput = isShortAnswer && (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={String(index)}
      style={{ ...optionTextStyle, ...(theme?.bg ? { backgroundColor: theme.surface, borderColor: theme.surfaceBorder, color: theme.text } : {}) }}
      className="focus-ring mx-1 inline-block w-28 rounded-lg border border-line bg-panel px-2 py-1 text-center align-baseline text-paper"
    />
  )

  return (
    <div
      id={`q-${question.id}`}
      className={
        isShortAnswer
          ? 'pt-3 first:pt-0 scroll-mt-40'
          : 'border-t border-line pt-4 first:border-0 first:pt-0 scroll-mt-40'
      }
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <p className="font-medium text-paper" style={promptStyle}>
          {isShortAnswer ? (
            <>
              {shortAnswerParts.before}
              {shortAnswerInput}
              {shortAnswerParts.after}
            </>
          ) : (
            <>
              <span className="mr-1.5 text-mist">{index}.</span>
              {question.prompt}
            </>
          )}
        </p>
        {onToggleFlag && (
          <button
            type="button"
            onClick={onToggleFlag}
            title={flagged ? 'Remove flag' : 'Flag for review'}
            className={`focus-ring shrink-0 rounded-full px-2 py-1 text-xs transition-colors ${
              flagged ? 'bg-coral/15 text-coral' : 'text-mist hover:text-coral'
            }`}
          >
            🚩
          </button>
        )}
      </div>

      {question.type === 'multiple_choice' && (
        <div className="flex flex-col gap-2">
          {(question.options?.choices ?? []).map((choice) => (
            <label
              key={choice}
              style={{ ...optionTextStyle, ...themedOptionStyle(theme, value === choice) }}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2 transition-colors ${
                value === choice
                  ? 'border-brass/40 bg-brass/10 text-paper'
                  : 'border-line bg-panel text-mist hover:border-brass/30'
              }`}
            >
              <input
                type="radio"
                name={question.id}
                checked={value === choice}
                onChange={() => onChange(choice)}
                className="accent-brass"
              />
              {choice}
            </label>
          ))}
        </div>
      )}

      {question.type === 'true_false_ng' && (
        <div className="flex flex-wrap gap-2">
          {TRUE_FALSE_NG_CHOICES.map((choice) => (
            <label
              key={choice}
              style={{ ...optionTextStyle, ...themedOptionStyle(theme, value === choice) }}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-4 py-1.5 transition-colors ${
                value === choice
                  ? 'border-brass/40 bg-brass/10 text-paper'
                  : 'border-line bg-panel text-mist hover:border-brass/30'
              }`}
            >
              <input
                type="radio"
                name={question.id}
                checked={value === choice}
                onChange={() => onChange(choice)}
                className="accent-brass"
              />
              {choice}
            </label>
          ))}
        </div>
      )}

      {question.type === 'yes_no_ng' && (
        <div className="flex flex-wrap gap-2">
          {YES_NO_NG_CHOICES.map((choice) => (
            <label
              key={choice}
              style={{ ...optionTextStyle, ...themedOptionStyle(theme, value === choice) }}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-4 py-1.5 transition-colors ${
                value === choice
                  ? 'border-brass/40 bg-brass/10 text-paper'
                  : 'border-line bg-panel text-mist hover:border-brass/30'
              }`}
            >
              <input
                type="radio"
                name={question.id}
                checked={value === choice}
                onChange={() => onChange(choice)}
                className="accent-brass"
              />
              {choice}
            </label>
          ))}
        </div>
      )}

      {question.type === 'multi_select' && (
        <MultiSelectQuestion
          question={question}
          value={value}
          onChange={onChange}
          fontScale={fontScale}
          theme={theme}
        />
      )}

      {question.type === 'matching' && (
        <MatchingQuestion
          question={question}
          value={value}
          onChange={onChange}
          fontScale={fontScale}
          theme={theme}
          hideBank={hideMatchingBank}
        />
      )}

      {/* short_answer's own input is now embedded inline in the prompt
          paragraph above, right at the blank — see shortAnswerInput. */}
    </div>
  )
}

// choose MORE THAN ONE from a list. `value` is the canonical
// comma-joined string (see canonicalizeMultiSelect above) — this
// component only ever writes that same canonical form back out, never
// a raw click-order join, so grading stays exact-match-safe.
function MultiSelectQuestion({ question, value, onChange, fontScale = 1, theme }) {
  const choices = question.options?.choices ?? []
  const selected = value ? value.split(MULTI_SELECT_SEPARATOR).map((s) => s.trim()) : []
  const optionTextStyle = { fontSize: `${0.875 * fontScale}rem` }

  const toggle = (choice) => {
    const next = selected.includes(choice)
      ? selected.filter((c) => c !== choice)
      : [...selected, choice]
    onChange(canonicalizeMultiSelect(next, choices))
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-mist -mt-1 mb-0.5">Choose every answer that applies.</p>
      {choices.map((choice) => {
        const checked = selected.includes(choice)
        return (
          <label
            key={choice}
            style={{ ...optionTextStyle, ...themedOptionStyle(theme, checked) }}
            className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2 transition-colors ${
              checked
                ? 'border-brass/40 bg-brass/10 text-paper'
                : 'border-line bg-panel text-mist hover:border-brass/30'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(choice)}
              className="accent-brass"
            />
            {choice}
          </label>
        )
      })}
    </div>
  )
}

// match a statement/heading/paragraph-ref/name to one item from a bank
// of options — the same single-pick data shape as multiple_choice
// (one options.choices bank, one correct_answer), but given the drag-
// and-drop interaction Jasur specifically asked for. Dragging a chip
// into the drop target (or just clicking a chip — kept as a fallback
// for touch/mobile, where HTML5 drag-and-drop doesn't work) both set
// the same single answer; dragging/clicking a different chip replaces
// it, same as picking a different radio would.
// `hideBank` — added 2026-09-28: when several `matching` questions in a
// row share the exact same choice bank (a "matching headings"/"matching
// information" group), MatchingQuestionGroup below renders that bank
// ONCE above all of them and passes hideBank=true to every question's own
// MatchingQuestion, instead of the bank being repeated, identically,
// under each and every question — Jasur, verbatim, about the Listening
// exam's matching questions: "the options are grouped and not repeated
// under each question". A lone matching question with no shared-bank
// neighbor (hideBank left false, the default) is completely unaffected —
// still shows its own bank right below its own drop target, exactly as
// before.
function MatchingQuestion({ question, value, onChange, fontScale = 1, theme, hideBank = false }) {
  const choices = question.options?.choices ?? []
  const [dragOver, setDragOver] = useState(false)
  const optionTextStyle = { fontSize: `${0.875 * fontScale}rem` }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const choice = e.dataTransfer.getData('text/plain')
    if (choice) onChange(choice)
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{ ...optionTextStyle, ...(!dragOver && !value ? themedOptionStyle(theme, false) : {}) }}
        className={`flex min-h-[2.75rem] items-center rounded-xl border-2 border-dashed px-3.5 py-2 transition-colors ${
          dragOver
            ? 'border-brass bg-brass/10 text-paper'
            : value
              ? 'border-brass/40 bg-brass/5 text-paper'
              : 'border-line bg-panel text-mist'
        }`}
      >
        {value || (hideBank ? 'Drag an option here' : 'Drag an option here, or tap one below')}
      </div>

      {/* A choice already sitting in the drop target above disappears from
          this list instead of staying visible-but-highlighted — Jasur,
          2026-09-28: "once the answer is dragged it should disappear from
          the list." Dragging/tapping a different one still overwrites the
          drop target as before. */}
      {!hideBank && (
        <div className="flex flex-wrap gap-2">
          {choices.filter((choice) => choice !== value).map((choice) => (
            <button
              key={choice}
              type="button"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', choice)}
              onClick={() => onChange(choice)}
              style={{ ...optionTextStyle, ...themedOptionStyle(theme, false) }}
              className="focus-ring cursor-grab rounded-full border border-line bg-panel px-3.5 py-1.5 text-mist transition-colors hover:border-brass/30 active:cursor-grabbing"
            >
              {choice}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// The chip bank shared by a MatchingQuestionGroup — same drag chip
// markup as MatchingQuestion's own (unhidden) bank above, just rendered
// once for the whole group instead of once per question. Tapping a chip
// (the touch/mobile fallback, since HTML5 drag-and-drop doesn't work
// there) fills the first still-unanswered question in the group; drag-
// and-drop instead targets whichever question's own drop zone it's
// dropped on, so a chip can still be placed anywhere in the group
// regardless of tap order.
//
// A chip already used by one of this group's questions is removed from
// this list entirely rather than just dimmed — Jasur, 2026-09-28: "once
// the answer is dragged it should disappear from the list." Dragging (or
// tapping) a DIFFERENT chip onto an already-answered question still
// overwrites it, which naturally returns the old chip to this list on
// the next render, since `usedValues` is recomputed from live answers
// every time, never a frozen snapshot.
function MatchingBank({ choices, usedValues, onPick, fontScale = 1, theme }) {
  const optionTextStyle = { fontSize: `${0.875 * fontScale}rem` }
  const remaining = choices.filter((choice) => !usedValues.includes(choice))
  return (
    <div className="flex flex-wrap gap-2">
      {remaining.length > 0 ? (
        remaining.map((choice) => (
          <button
            key={choice}
            type="button"
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', choice)}
            onClick={() => onPick(choice)}
            style={{ ...optionTextStyle, ...themedOptionStyle(theme, false) }}
            className="focus-ring cursor-grab rounded-full border border-line bg-panel px-3.5 py-1.5 text-mist transition-colors hover:border-brass/30 active:cursor-grabbing"
          >
            {choice}
          </button>
        ))
      ) : (
        <p className="text-xs text-mist">All options placed.</p>
      )}
    </div>
  )
}

// A run of consecutive `matching` questions that share the exact same
// choice bank — see MatchingQuestion's hideBank comment above for why
// this exists. Each question keeps its own QuestionBlock (own number,
// own prompt, own flag button) so nothing about navigation/flagging/
// answered-count changes; only the repeated bank underneath every one of
// them collapses into this single shared bank up top.
function MatchingQuestionGroup({ questions, choices, answers, onChange, flags, onToggleFlag, questionIndexById, fontScale = 1, theme }) {
  const usedValues = questions.map((q) => answers[q.id] ?? '').filter(Boolean)

  return (
    <div className="border-t border-line pt-4 first:border-0 first:pt-0 flex flex-col gap-4">
      <MatchingBank
        choices={choices}
        usedValues={usedValues}
        onPick={(choice) => {
          const target = questions.find((q) => !(answers[q.id] ?? '').trim())
          if (target) onChange(target.id, choice)
        }}
        fontScale={fontScale}
        theme={theme}
      />

      {questions.map((q) => (
        <QuestionBlock
          key={q.id}
          index={questionIndexById[q.id]}
          question={q}
          value={answers[q.id] ?? ''}
          onChange={(v) => onChange(q.id, v)}
          flagged={flags.has(q.id)}
          onToggleFlag={() => onToggleFlag(q.id)}
          fontScale={fontScale}
          theme={theme}
          hideMatchingBank
        />
      ))}
    </div>
  )
}
