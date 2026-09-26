import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

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

    const NORMAL_DELAY = 30_000
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
        .select('id, started_at, draft_answers')
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

        if (draft.reviewStartedAt) {
          // Resuming mid-review-window: restore the REMAINING review time
          // from the real start, not a fresh 2 minutes — and set reviewPhase
          // synchronously here (not left for the review-detection effect to
          // notice) so that effect's own `if (... || reviewPhase) return`
          // guard skips it on the very next render instead of overwriting
          // this with a brand-new window.
          reviewStartedAtRef.current = draft.reviewStartedAt
          setReviewPhase(true)
          setDeadline(new Date(draft.reviewStartedAt).getTime() + REVIEW_WINDOW_MS)
        } else {
          setDeadline(new Date(existing.started_at).getTime() + TIME_LIMIT_MINUTES[exam.module] * 60_000)
        }

        setPhase('in-progress')
        onAttemptStarted?.(existing.id)
        return
      }

      const { data, error: startError } = await supabase
        .from('mock_attempts')
        .insert({ exam_id: exam.id, user_id: selfId })
        .select('id, started_at')
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
      setDeadline(new Date(data.started_at).getTime() + TIME_LIMIT_MINUTES[exam.module] * 60_000)
      setPhase('in-progress')
      onAttemptStarted?.(data.id)
    }

    start()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id])

  useEffect(() => {
    if (phase !== 'in-progress' || !deadline) return

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
  }, [phase, deadline])

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

    if (attempt === 1) {
      if (!auto && answeredCount < totalQuestions) {
        const ok = window.confirm(
          `You've answered ${answeredCount} of ${totalQuestions} questions. Submit anyway?`
        )
        if (!ok) return
        // Re-check after the confirm dialog closes — it's an async gap the
        // auto-submit timer could have slipped through while it was open.
        if (submittingRef.current) return
      }
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
    const pct = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0

    return (
      <div className="flex flex-col gap-5">
        <div className="ticket rounded-2xl p-8 text-center">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-brass">
            Test submitted
          </span>
          <p className="mt-2 font-display text-4xl text-paper">
            {result.score}
            <span className="text-lg font-medium text-mist"> / {result.maxScore}</span>
          </p>
          <p className="mt-1 text-sm text-mist">{pct}% correct</p>
          <button
            type="button"
            onClick={onExit}
            className="focus-ring mt-6 inline-block rounded-full bg-brass px-6 py-2.5 text-sm font-bold text-onbrass shadow-sm transition-transform hover:scale-105"
          >
            {ctaLabel}
          </button>
        </div>

        {exam.module === 'listening' && (
          <div className="ticket rounded-2xl p-6">
            <p className="font-display text-base text-paper">Transcripts</p>
            <p className="mt-1 text-xs text-mist">For review now that the test is over.</p>
            <div className="mt-4 flex flex-col gap-4">
              {sections.map((s, i) => (
                <details key={s.id} className="rounded-xl border border-line bg-panel-2 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-paper">
                    {s.title || `Section ${i + 1}`}
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-mist">
                    {s.passage_text || 'No transcript available.'}
                  </p>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const timerLevel = reviewPhase || remainingMs <= 5 * 60_000
    ? 'critical'
    : remainingMs <= 10 * 60_000
      ? 'warning'
      : 'normal'
  const timerClass =
    timerLevel === 'critical'
      ? 'text-coral animate-pulse'
      : timerLevel === 'warning'
        ? 'text-amber'
        : 'text-onbrass'

  return (
    <div className="flex flex-col gap-5 pb-10">
      {flashMessage && (
        <div className="fixed top-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink/95 px-4 py-2 text-sm font-semibold text-paper shadow-lg animate-pulse">
          ⏱ {flashMessage}
        </div>
      )}

      <div className="sticky top-3 z-10 flex flex-col gap-2.5 rounded-2xl bg-brass px-5 py-3.5 text-onbrass shadow-md">
        {(!isOnline || saveFailing || submitRetry) && (
          <div className="flex items-center gap-2 rounded-xl bg-ink/20 px-3 py-2 text-xs font-semibold">
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
            <p className="text-[11px] font-semibold uppercase tracking-widest text-onbrass/70">
              {reviewPhase ? 'Review time' : exam.module}
            </p>
            <p className="font-display text-sm font-bold leading-tight">{exam.title}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-onbrass/70">
              {answeredCount}/{totalQuestions} answered
            </span>
            <span className={`font-display text-lg font-bold tabular-nums ${timerClass}`}>
              {formatClock(remainingMs)}
            </span>
            <div className="relative" ref={settingsRef}>
              <button
                type="button"
                onClick={() => setSettingsOpen((o) => !o)}
                className="focus-ring rounded-full bg-onbrass/15 px-3 py-1.5 text-xs font-bold text-onbrass shadow-sm hover:bg-onbrass/25"
              >
                ⚙ Settings
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-line bg-panel p-4 text-left shadow-lg">
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
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={phase === 'submitting'}
              className="focus-ring rounded-full bg-onbrass px-4 py-1.5 text-xs font-bold text-brass shadow-sm disabled:opacity-60"
            >
              {phase === 'submitting' ? 'Submitting…' : 'Submit test'}
            </button>
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
          <p className="text-[11px] font-medium text-onbrass/85">
            All audio has finished — no more will play. You have 2 minutes to review your
            answers before this submits automatically.
          </p>
        )}
      </div>

      {sections.map((section, sIdx) => (
        <div
          key={section.id}
          className="ticket rounded-2xl p-5 sm:p-6"
          style={sectionThemeStyle}
        >
          <p
            className="mb-3 font-display text-base"
            style={sectionThemeStyle ? { color: activeTheme.text } : undefined}
          >
            {section.title ||
              `${exam.module === 'reading' ? 'Passage' : 'Section'} ${sIdx + 1}`}
          </p>

          {exam.module === 'reading' && section.passage_text && (
            <div className="mb-5">
              <HighlightablePassage
                text={section.passage_text}
                highlights={highlightsBySection[section.id] || []}
                onAdd={(range) => addHighlight(section.id, range)}
                onUpdateNote={(id, note) => updateHighlightNote(section.id, id, note)}
                onRemove={(id) => removeHighlight(section.id, id)}
                fontScale={activeFontScale}
                theme={activeTheme}
              />
            </div>
          )}

          {exam.module === 'listening' && section.audio_url && (
            <div className="mb-5">
              <SectionAudioPlayer
                url={section.audio_url}
                onEnded={() => handleAudioEnded(section.id)}
                alreadyEnded={!!audioEndedBySection[section.id]}
              />
            </div>
          )}

          <div className="flex flex-col gap-4">
            {section.questions.map((q) => (
              <QuestionBlock
                key={q.id}
                index={questionIndexById[q.id]}
                question={q}
                value={answers[q.id] ?? ''}
                onChange={(v) => setAnswer(q.id, v)}
                flagged={flags.has(q.id)}
                onToggleFlag={() => toggleFlag(q.id)}
                fontScale={activeFontScale}
                theme={activeTheme}
              />
            ))}
          </div>
        </div>
      ))}
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
// a full progress bar, "Played" label, no play button — matching exactly
// what the student would already be looking at if the page had never
// reloaded.
function SectionAudioPlayer({ url, onEnded, alreadyEnded = false }) {
  const audioRef = useRef(null)
  const [status, setStatus] = useState(alreadyEnded ? 'done' : 'ready') // ready | playing | done
  const [volume, setVolume] = useState(1)
  const [progressPct, setProgressPct] = useState(alreadyEnded ? 100 : 0)

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  const handlePlay = () => {
    if (status !== 'ready') return
    setStatus('playing')
    audioRef.current?.play()
  }

  const handleTimeUpdate = () => {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    setProgressPct(Math.min(100, (audio.currentTime / audio.duration) * 100))
  }

  const handleEnded = () => {
    setProgressPct(100)
    setStatus('done')
    onEnded?.()
  }

  return (
    <div className="rounded-xl border border-line bg-panel-2 p-4">
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onContextMenu={(e) => e.preventDefault()}
        controlsList="nodownload noplaybackrate nofullscreen"
        className="hidden"
      />

      <div className="flex items-center gap-3">
        {status === 'ready' ? (
          <button
            type="button"
            onClick={handlePlay}
            className="focus-ring shrink-0 rounded-full bg-brass px-4 py-1.5 text-xs font-bold text-onbrass shadow-sm hover:bg-brass-dim"
          >
            ▶ Play audio
          </button>
        ) : (
          <>
            <span className="w-14 shrink-0 text-[11px] font-semibold text-mist">
              {status === 'playing' ? 'Playing…' : 'Played'}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-brass transition-[width]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs text-mist" aria-hidden>🔊</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-16 accent-brass"
            aria-label="Volume"
          />
        </div>
      </div>

      <p className="mt-2 text-[11px] text-mist">
        {status === 'ready'
          ? 'Plays once, start to finish — no pausing or rewinding, just like the real test.'
          : 'The transcript will be available for review after you submit.'}
      </p>
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

  useEffect(() => {
    if (!toolbar) return
    const onDown = (e) => {
      if (containerRef.current?.contains(e.target)) return
      setToolbar(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [toolbar])

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
        <div className="absolute z-30 mt-2 w-64 rounded-xl border border-line bg-panel p-3 shadow-lg">
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

export function QuestionBlock({ index, question, value, onChange, flagged = false, onToggleFlag, fontScale = 1, theme }) {
  const promptStyle = {
    fontSize: `${0.875 * fontScale}rem`,
    ...(theme?.bg ? { color: theme.text } : {}),
  }
  const optionTextStyle = { fontSize: `${0.875 * fontScale}rem` }

  return (
    <div id={`q-${question.id}`} className="border-t border-line pt-4 first:border-0 first:pt-0 scroll-mt-40">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <p className="font-medium text-paper" style={promptStyle}>
          <span className="mr-1.5 text-mist">{index}.</span>
          {question.prompt}
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
        />
      )}

      {question.type === 'short_answer' && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Your answer"
          style={{ ...optionTextStyle, ...(theme?.bg ? { backgroundColor: theme.surface, borderColor: theme.surfaceBorder, color: theme.text } : {}) }}
          className="focus-ring w-full max-w-sm rounded-xl border border-line bg-panel px-3.5 py-2 text-paper"
        />
      )}
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
function MatchingQuestion({ question, value, onChange, fontScale = 1, theme }) {
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
        {value || 'Drag an option here, or tap one below'}
      </div>

      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', choice)}
            onClick={() => onChange(choice)}
            style={{ ...optionTextStyle, ...themedOptionStyle(theme, value === choice) }}
            className={`focus-ring cursor-grab rounded-full border px-3.5 py-1.5 transition-colors active:cursor-grabbing ${
              value === choice
                ? 'border-brass/40 bg-brass/10 text-paper'
                : 'border-line bg-panel text-mist hover:border-brass/30'
            }`}
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  )
}
