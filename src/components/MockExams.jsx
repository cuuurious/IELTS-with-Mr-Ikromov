import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ConfirmModal from './ConfirmModal'
import { readSession, writeSession } from '../lib/sessionState'
import { ChoiceDragProvider, useActiveChoiceDrag, useChoiceDragSource } from './exam/choiceDrag'
import { buildQuestionGroups } from './exam/questionGroups'
import QuestionHighlighter from './exam/QuestionHighlighter'

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

// Exam clocks use the DATABASE's time, not the student's computer clock
// (2026-10-06): a laptop set a few minutes wrong used to show the wrong
// time left (and auto-submit early or late). Returns serverNow - Date.now()
// in ms (midpoint of the round trip), or 0 if server_now() isn't
// reachable. Also used by WritingMockExam.jsx.
export async function fetchServerClockOffset() {
  try {
    const sentAt = Date.now()
    const { data, error } = await supabase.rpc('server_now')
    const receivedAt = Date.now()
    if (error || !data) return 0
    const serverMs = new Date(Array.isArray(data) ? data[0] : data).getTime()
    if (!Number.isFinite(serverMs)) return 0
    return Math.round(serverMs - (sentAt + receivedAt) / 2)
  } catch {
    return 0
  }
}

export function ExamTaker({
  selfId,
  exam,
  sections,
  onExit,
  ctaLabel = 'Back to exams',
  onAttemptStarted,
  onSubmitted,
  // false in a Full Mock (2026-10-06): there the "exit" button advances the
  // sitting to the next section, so the error screen must never offer it
  // while this section has no submitted attempt — only "Try again".
  allowExitOnError = true,
}) {
  const [phase, setPhase] = useState('starting')
  const [attemptId, setAttemptId] = useState(null)
  const [error, setError] = useState(null)
  // Which step failed — 'start' retries starting/resuming, 'submit'
  // retries the submit (2026-10-06; "Try submitting again" used to be the
  // only button, and it did nothing when the attempt never started).
  const [errorKind, setErrorKind] = useState(null)
  const [startNonce, setStartNonce] = useState(0)
  // serverNow - Date.now(), measured once when the attempt starts, so a
  // wrong clock on the student's computer can't change their time left.
  const clockOffsetRef = useRef(0)
  const serverNow = () => Date.now() + clockOffsetRef.current
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

  // ------------------------------------------------------------------
  // ONE PART AT A TIME (2026-09-29, Jasur: "switching to passage 2 should
  // be possible, it is not supposed to be in the continuation of the
  // passage 1"). Every section stays MOUNTED (so a Listening part's audio
  // keeps playing and nothing typed is lost) but only `activeSectionIdx`
  // is shown; the footer's Part 1 / Part 2 / Part 3 buttons switch it,
  // exactly like the real exam's own footer. Remembered for this attempt
  // in sessionStorage so a refresh comes back to the same part.
  // `currentQuestionId` is the question the ← / → arrows move from —
  // set by clicking a footer number, by the arrows themselves, or by
  // clicking/typing inside any question.
  // ------------------------------------------------------------------
  const partKey = attemptId ? `ielts:examPart:${attemptId}` : null
  const [activeSectionIdx, setActiveSectionIdxRaw] = useState(0)
  const [currentQuestionId, setCurrentQuestionId] = useState(null)
  useEffect(() => {
    if (!partKey) return
    const saved = Number(readSession(partKey, 0))
    if (Number.isInteger(saved) && saved > 0 && saved < sections.length) setActiveSectionIdxRaw(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partKey])
  const setActiveSectionIdx = (idx) => {
    setActiveSectionIdxRaw(idx)
    if (partKey) writeSession(partKey, idx)
  }
  const sectionIdxByQuestionId = useMemo(() => {
    const map = {}
    sections.forEach((s, i) => s.questions.forEach((q) => { map[q.id] = i }))
    return map
  }, [sections])

  const jumpToQuestion = (questionId) => {
    const idx = sectionIdxByQuestionId[questionId]
    if (idx !== undefined && idx !== activeSectionIdx) setActiveSectionIdx(idx)
    setCurrentQuestionId(questionId)
    // Wait one frame for a just-unhidden part to lay out before scrolling.
    setTimeout(() => {
      const el = document.getElementById(`q-${questionId}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const input = el.querySelector('input[type="text"], input:not([type]), textarea')
      if (input) input.focus({ preventScroll: true })
    }, 60)
  }

  const stepQuestion = (dir) => {
    if (!flatQuestions.length) return
    const cur = currentQuestionId ? flatQuestions.findIndex((q) => q.id === currentQuestionId) : -1
    let next
    if (cur === -1) {
      // Nothing picked yet: → goes to the first question of the part on
      // screen, ← to the previous part's last question.
      const first = sections[activeSectionIdx]?.questions?.[0]
      const firstIdx = first ? flatQuestions.findIndex((q) => q.id === first.id) : 0
      next = dir > 0 ? firstIdx : firstIdx - 1
    } else {
      next = cur + dir
    }
    if (next < 0 || next >= flatQuestions.length) return
    jumpToQuestion(flatQuestions[next].id)
  }

  // Clicking or typing anywhere inside a question makes it "current".
  const trackCurrentQuestion = (e) => {
    const holder = e.target.closest?.('[id^="q-"]')
    if (holder) setCurrentQuestionId(holder.id.slice(2))
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
    // Real exam: when one part's recording finishes, the screen moves on
    // to the next part by itself (whose recording then starts — see
    // SectionAudioPlayer's autoStart). Only if the student is still
    // looking at the part that just ended; never yanks them off a part
    // they switched to on purpose.
    const idx = sections.findIndex((s) => s.id === sectionId)
    if (idx !== -1 && idx === activeSectionIdx && idx + 1 < sections.length) {
      setActiveSectionIdx(idx + 1)
      setCurrentQuestionId(null)
    }
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

    // Last payload that was saved successfully — nothing is sent again
    // until something actually changes (2026-09-30 speed-up).
    let lastSavedKey = null

    const save = async () => {
      const payload = {
        tab_switch_count: tabSwitchCountRef.current,
        draft_answers: {
          answers: answersRef.current,
          audioEnded: Object.keys(audioEndedBySectionRef.current),
          reviewStartedAt: reviewStartedAtRef.current,
          notes: notesRef.current,
        },
      }
      const key = JSON.stringify(payload)
      if (key === lastSavedKey) {
        timeoutId = setTimeout(save, NORMAL_DELAY)
        return
      }

      const { error: saveError } = await supabase
        .from('mock_attempts')
        .update(payload)
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
      lastSavedKey = key
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
  //
  // START RETRIES (2026-10-06 review): if the "in-progress attempt?"
  // lookup itself failed (offline for a moment), this used to fall through
  // and INSERT a brand-new attempt — fresh clock, empty answers, the old
  // one orphaned. Now the lookup is retried with backoff and, if it still
  // fails, the student gets an error with "Try again" instead of a new
  // attempt. The database also allows only ONE unsubmitted attempt per
  // student+exam now (unique partial index), so an insert that loses a race
  // (two tabs, a double mount) comes back as 23505 — then we look again and
  // resume the one that won.
  useEffect(() => {
    let cancelled = false
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    const lookup = async () => {
      let lastError = null
      for (let i = 0; i < 4; i += 1) {
        if (i > 0) await sleep(1000 * 2 ** (i - 1))
        if (cancelled) return { cancelled: true }
        const { data, error: lookupError } = await supabase
          .from('mock_attempts')
          .select('*')
          .eq('exam_id', exam.id)
          .eq('user_id', selfId)
          .is('submitted_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!lookupError) return { existing: data || null }
        lastError = lookupError
        console.error('Could not check for an in-progress attempt:', lookupError)
      }
      return { error: lastError }
    }

    const failStart = (message) => {
      setError(message)
      setErrorKind('start')
      setPhase('error')
    }

    const resume = (existing) => {
        const draft = existing.draft_answers || {}
        setAttemptId(existing.id)
        setAnswers(draft.answers || {})
        // Keep counting from what's already saved (2026-10-06) — the
        // autosave and the presence heartbeat write this value back, so
        // starting from 0 on a refresh wiped the teacher's integrity log.
        tabSwitchCountRef.current = existing.tab_switch_count || 0

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
    }

    const start = async () => {
      // Server clock (2026-10-06): measured once per start, in parallel
      // with the lookup; 0 if the call fails.
      const offsetPromise = fetchServerClockOffset()

      const found = await lookup()
      if (cancelled || found.cancelled) return
      if (found.error) {
        failStart("Couldn't check for a test already in progress. Please check your connection and try again.")
        return
      }

      clockOffsetRef.current = await offsetPromise
      if (cancelled) return

      if (found.existing) {
        resume(found.existing)
        return
      }

      const { data, error: startError } = await supabase
        .from('mock_attempts')
        .insert({ exam_id: exam.id, user_id: selfId })
        .select('*')
        .single()

      if (cancelled) return

      if (startError) {
        if (startError.code === '23505') {
          // Another start won the race — resume that one instead.
          const again = await lookup()
          if (cancelled || again.cancelled) return
          if (again.existing) {
            resume(again.existing)
            return
          }
        }
        failStart(startError.message || 'Could not start this test.')
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
  }, [exam.id, startNonce])

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
      const left = deadline - serverNow()
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
    let lastHeartbeatAt = Date.now()

    const poll = async () => {
      // Only the status columns (2026-10-06) — select('*') re-downloaded
      // the whole draft_answers jsonb every 5 s for every student.
      const { data: row, error: pollError } = await supabase
        .from('mock_attempts')
        .select('id, submitted_at, deadline_at, paused_at')
        .eq('id', attemptId)
        .maybeSingle()

      if (cancelled || pollError) return

      // Presence heartbeat (2026-10-06): the autosave skips unchanged
      // payloads, so a student reading without answering stopped moving
      // last_seen_at and looked disconnected in Live Mocks. A tiny no-op
      // update at most every 30 s lets the server trigger bump it.
      if (row && !row.submitted_at && Date.now() - lastHeartbeatAt >= 30_000) {
        lastHeartbeatAt = Date.now()
        supabase
          .from('mock_attempts')
          .update({ tab_switch_count: tabSwitchCountRef.current })
          .eq('id', attemptId)
          .then(({ error: beatError }) => {
            if (beatError) console.error('Presence heartbeat failed:', beatError)
          })
      }

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

    // Server time (2026-10-06) — same clock the countdown ticks against.
    const startedAt = new Date(serverNow()).toISOString()
    reviewStartedAtRef.current = startedAt
    setReviewPhase(true)
    setDeadline(serverNow() + REVIEW_WINDOW_MS)
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

  // Drag-and-drop result from the drag engine (exam/choiceDrag.jsx):
  //   onto a gap  → that gap gets the option; if it came out of another
  //                 gap, that one is emptied (a move). Whatever the target
  //                 gap held before goes back to the bank by itself, since
  //                 banks list every option no gap is using.
  //   onto a bank → the gap it came from is emptied.
  // An option can only land in a gap whose own question offers it.
  const questionById = useMemo(() => {
    const map = {}
    flatQuestions.forEach((q) => {
      map[q.id] = q
    })
    return map
  }, [flatQuestions])

  const handleChoiceDrop = ({ choice, from, target }) => {
    if (target.startsWith('q:')) {
      const qid = target.slice(2)
      if (qid === from) return
      const q = questionById[qid]
      if (!q || !(q.options?.choices || []).includes(choice)) return
      setAnswers((prev) => {
        const next = { ...prev, [qid]: choice }
        if (from) next[from] = ''
        return next
      })
      setCurrentQuestionId(qid)
      return
    }
    if (target === 'bank' && from) setAnswer(from, '')
  }

  // "Go to submission page" (2026-10-06). Jasur removed Finish on
  // 2026-09-28; after Mock #1 students complained about having to sit and
  // wait, and Mavluda chose to bring finishing early back the way the
  // real computer test does it: Options → Go to submission page → a
  // review of every part → Submit, with a confirmation.
  const [submissionOpen, setSubmissionOpen] = useState(false)
  const confirmFinishEarly = () => {
    const missing = totalQuestions - answeredCount
    setConfirmDialog({
      title: 'Submit your answers now?',
      message:
        missing > 0
          ? `You have ${missing} unanswered question${missing === 1 ? '' : 's'}. After you submit, you can't change any answers.`
          : "After you submit, you can't change any answers.",
      tone: 'brass',
      confirmLabel: 'Submit',
      onConfirm: () => {
        setSubmissionOpen(false)
        runSubmit(false, 1)
      },
    })
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
      setErrorKind('submit')
      setPhase('error')
      submittingRef.current = false // allow a manual retry rather than permanently locking up
      return
    }

    setSubmitRetry(null)
    const row = Array.isArray(data) ? data[0] : data
    // submit_mock_attempt returns score/max_score = null for students now
    // (2026-10-06 — only teachers get numbers), so pass through null rather
    // than inventing a 0/0; nothing on the student side shows them.
    const finalResult = { score: row?.score ?? null, maxScore: row?.max_score ?? null }
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
          {errorKind === 'start'
            ? 'Nothing has been lost — any answers already saved will be there when you try again.'
            : 'Your answers are still saved on this device — retrying won\'t lose anything.'}
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          {errorKind === 'start' ? (
            <button
              type="button"
              onClick={() => {
                setError(null)
                setErrorKind(null)
                setPhase('starting')
                setStartNonce((n) => n + 1)
              }}
              className="focus-ring inline-block rounded-full bg-brass px-5 py-2 text-sm font-bold text-onbrass shadow-sm hover:bg-brass-dim"
            >
              Try again
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleSubmit(lastSubmitAutoRef.current)}
              className="focus-ring inline-block rounded-full bg-brass px-5 py-2 text-sm font-bold text-onbrass shadow-sm hover:bg-brass-dim"
            >
              Try submitting again
            </button>
          )}
          {/* Full Mock (2026-10-06): this button moves the sitting on, so a
              section that was never started/submitted would be skipped for
              good — only offered outside a Full Mock. */}
          {allowExitOnError && (
            <button
              type="button"
              onClick={onExit}
              className="focus-ring inline-block rounded-full bg-panel-2 px-5 py-2 text-sm font-medium text-mist hover:text-paper"
            >
              {ctaLabel}
            </button>
          )}
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
  const activeSection = sections[activeSectionIdx] || null
  const activeRange = (() => {
    const qs = activeSection?.questions || []
    if (!qs.length) return { from: '', to: '' }
    return { from: questionIndexById[qs[0].id], to: questionIndexById[qs[qs.length - 1].id] }
  })()

  const examChromeBg = '#e3a7ae'
  const examChromeText = '#1c1b29'

  return (
    // Whole exam = exactly one screen (Jasur, 2026-09-29: "scrolling the
    // whole window shouldnt be possible"). Fixed to the viewport, never
    // scrolls itself; only the passage pane and the questions pane
    // (whichever one the mouse is over) scroll, each on its own.
    <ChoiceDragProvider onDrop={handleChoiceDrop}>
    <div className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-ink text-paper">
      {submissionOpen && (
        <SubmissionPage
          sections={sections}
          answers={answers}
          flags={flags}
          questionIndexById={questionIndexById}
          module={exam.module}
          onBack={() => setSubmissionOpen(false)}
          onJump={(qid) => {
            setSubmissionOpen(false)
            jumpToQuestion(qid)
          }}
          onSubmit={confirmFinishEarly}
        />
      )}
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
        className="relative z-20 flex shrink-0 flex-col gap-2.5 px-5 py-2.5 shadow-md"
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
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false)
                      setSubmissionOpen(true)
                    }}
                    className="focus-ring mb-4 flex w-full items-center justify-between rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm font-medium text-paper hover:border-brass/40"
                  >
                    Go to submission page
                    <span aria-hidden>→</span>
                  </button>
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
            {/* No "Finish" button in this bar (Jasur, 2026-09-28). Since
                2026-10-06 a student can still finish early the way the
                real computer test allows it: ☰ → "Go to submission page"
                → review → Submit (SubmissionPage below). */}
          </div>
        </div>

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

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pt-4 sm:px-6">
        {activeSection && (
          <div className="shrink-0 rounded-md border border-line bg-panel px-5 py-3">
            <p className="font-display text-2xl leading-tight text-paper">Part {activeSectionIdx + 1}</p>
            <p className="mt-1 text-sm text-paper/85">
              {exam.module === 'listening' ? 'Listen and answer' : 'Read the text below and answer'} questions{' '}
              {activeRange.from}
              {activeRange.to !== activeRange.from ? ` - ${activeRange.to}` : ''}.
            </p>
          </div>
        )}

        <div className="relative min-h-0 flex-1">
      {sections.map((section, sIdx) => {
        const isActivePart = sIdx === activeSectionIdx
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

        // Questions are shown in their IELTS groups ("Questions 1–7" +
        // the instruction once) — see exam/questionGroups.js. Each
        // matching group gets one option bank beside its gaps.
        const questionGroups = buildQuestionGroups(visibleQuestions, questionIndexById)

        const questionsList = (
          <QuestionHighlighter>
            <div className="flex flex-col gap-8">
              {questionGroups.map((g) => (
                <QuestionGroupView
                  key={g.key}
                  group={g}
                  answers={answers}
                  onChange={setAnswer}
                  flags={flags}
                  onToggleFlag={toggleFlag}
                  questionIndexById={questionIndexById}
                  fontScale={activeFontScale}
                  theme={activeTheme}
                />
              ))}
            </div>
          </QuestionHighlighter>
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
              className={`${isActivePart ? '' : 'hidden'} ticket h-full overflow-y-auto overscroll-contain rounded-2xl p-5 sm:p-6 lg:overflow-hidden`}
              style={sectionThemeStyle}
              onFocusCapture={trackCurrentQuestion}
              onMouseDownCapture={trackCurrentQuestion}
            >
              <div className="grid grid-cols-1 gap-5 lg:h-full lg:grid-cols-2 lg:gap-0">
                {/* Left pane = the whole passage, filling the screen height
                    below the exam bar and scrolling on its own (real exam
                    layout), title in bold at the top of it. */}
                <div className="lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pr-6">
                  <p
                    className="mb-4 font-bold"
                    style={{ fontSize: `${activeFontScale}rem`, ...(sectionThemeStyle ? { color: activeTheme.text } : {}) }}
                  >
                    {sectionTitle}
                  </p>
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
                      fill
                    />
                  )}
                </div>
                <div className="pb-16 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:border-line lg:pl-6">
                  {questionsList}
                </div>
              </div>
            </div>
          )
        }

        return (
          <div
            key={section.id}
            className={`${isActivePart ? '' : 'hidden'} ticket h-full overflow-y-auto overscroll-contain rounded-2xl p-5 pb-20 sm:p-6 sm:pb-20`}
            style={sectionThemeStyle}
            onFocusCapture={trackCurrentQuestion}
            onMouseDownCapture={trackCurrentQuestion}
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
                  autoStart={(() => {
                    const prevAudio = sections.slice(0, sIdx).reverse().find((s) => s.audio_url)
                    return prevAudio ? Boolean(audioEndedBySection[prevAudio.id]) : false
                  })()}
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

          {/* ← / → : previous / next question, across parts — the real
              exam's two square arrow buttons, bottom-right. */}
          {flatQuestions.length > 0 && (
            <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex gap-1.5">
              <button
                type="button"
                onClick={() => stepQuestion(-1)}
                title="Previous question"
                className="pointer-events-auto focus-ring flex h-12 w-12 items-center justify-center rounded-sm bg-[#8a8a8a] text-2xl font-bold text-white shadow hover:bg-[#777]"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => stepQuestion(1)}
                title="Next question"
                className="pointer-events-auto focus-ring flex h-12 w-12 items-center justify-center rounded-sm bg-black text-2xl font-bold text-white shadow hover:bg-[#222]"
              >
                →
              </button>
            </div>
          )}
        </div>
      </div>

      {flatQuestions.length > 0 && (
        <PartNavigator
          sections={sections}
          activeIdx={activeSectionIdx}
          answers={answers}
          flags={flags}
          currentQuestionId={currentQuestionId}
          questionIndexById={questionIndexById}
          onSelectPart={(idx) => {
            setActiveSectionIdx(idx)
            setCurrentQuestionId(null)
          }}
          onJump={jumpToQuestion}
        />
      )}
    </div>
    </ChoiceDragProvider>
  )
}

// "Go to submission page" — the real computer test's review screen:
// every part with how many questions are answered, each number clickable
// to go back to it, then Submit (confirmed in ExamTaker).
function SubmissionPage({ sections, answers, flags, questionIndexById, module, onBack, onJump, onSubmit }) {
  const isAnswered = (q) => Boolean(String(answers[q.id] ?? '').trim())
  return (
    <div className="fixed inset-0 z-[10000] flex flex-col bg-white text-[#1a1a1a]" role="dialog" aria-label="Submission page">
      <div className="flex shrink-0 items-center justify-between border-b border-[#d8d8d8] px-6 py-4">
        <p className="text-lg font-semibold">Submission page</p>
        <button
          type="button"
          onClick={onBack}
          className="focus-ring rounded-md border border-[#bdbdbd] px-4 py-2 text-sm font-medium hover:bg-[#f2f2f2]"
        >
          ← Back to the test
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <p className="text-[15px] text-[#444]">
            Check your answers before you submit. Click a question number to go back to it.
            {module === 'listening' && ' If the recording is still playing, submitting stops it.'}
          </p>
          {sections.map((section, i) => {
            const done = section.questions.filter(isAnswered).length
            return (
              <div key={section.id} className="rounded-lg border border-[#d8d8d8] p-4">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <p className="font-semibold">Part {i + 1}</p>
                  <p className="text-sm text-[#555]">
                    {done} of {section.questions.length} answered
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {section.questions.map((q) => {
                    const answered = isAnswered(q)
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => onJump(q.id)}
                        title={answered ? `Question ${questionIndexById[q.id]}: answered` : `Question ${questionIndexById[q.id]}: not answered`}
                        className={`focus-ring relative flex h-9 w-9 items-center justify-center rounded-md border text-sm font-medium ${
                          answered ? 'border-[#1f2340] bg-[#1f2340] text-white' : 'border-[#9a9a9a] bg-white text-[#1a1a1a] hover:bg-[#f2f2f2]'
                        }`}
                      >
                        {questionIndexById[q.id]}
                        {flags.has(q.id) && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#b23a22]" aria-hidden />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="flex items-center gap-4 text-xs text-[#555]">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-[#1f2340]" /> Answered</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-[#9a9a9a]" /> Not answered</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#b23a22]" /> Flagged</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 justify-end border-t border-[#d8d8d8] px-6 py-4">
        <button
          type="button"
          onClick={onSubmit}
          className="focus-ring rounded-md bg-[#1f2340] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#2c3157]"
        >
          Submit answers
        </button>
      </div>
    </div>
  )
}

// The real exam's footer (Jasur's screenshots, 2026-09-28/29): one
// block per part along the bottom. The part on screen shows "Part 3"
// followed by every question number in it (click one to go straight
// there; the one you're on is boxed); every other part is collapsed to
// "Part 1   0 of 14" — how many of its questions are answered — and
// clicking it switches to that part. The thin line above each number
// turns solid once that question is answered; a flagged one gets a dot.
function PartNavigator({ sections, activeIdx, answers, flags, currentQuestionId, questionIndexById, onSelectPart, onJump }) {
  const isAnswered = (q) => Boolean(String(answers[q.id] ?? '').trim())
  return (
    <div className="flex shrink-0 items-stretch gap-4 overflow-x-auto border-t border-line bg-panel px-3 pb-2 sm:px-4">
      {sections.map((section, i) => {
        const qs = section.questions
        const answered = qs.filter(isAnswered).length
        if (i !== activeIdx) {
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelectPart(i)}
              className="focus-ring flex shrink-0 items-center gap-4 border-t-2 border-line px-2 pt-2.5 text-sm text-paper/80 hover:text-paper"
            >
              <span>Part {i + 1}</span>
              <span className="text-mist">
                {answered} of {qs.length}
              </span>
            </button>
          )
        }
        return (
          <div key={section.id} className="order-first flex min-w-[17rem] flex-1 items-center gap-2 pt-1.5 sm:order-none">
            <span className="shrink-0 px-2 pt-1 text-sm font-bold text-paper">Part {i + 1}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {qs.map((q) => {
                const num = questionIndexById[q.id]
                const current = q.id === currentQuestionId
                const done = isAnswered(q)
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => onJump(q.id)}
                    title={flags.has(q.id) ? `Question ${num} — flagged for review` : `Question ${num}`}
                    className={`focus-ring relative flex h-8 min-w-[2.1rem] items-center justify-center border-t-2 px-1 text-sm font-bold transition-colors ${
                      done ? 'border-t-paper' : 'border-t-line'
                    } ${current ? 'rounded-sm outline outline-2 outline-brass text-paper' : 'text-paper/85 hover:text-paper'}`}
                  >
                    {num}
                    {flags.has(q.id) && (
                      <span className="absolute -right-0.5 top-0.5 h-2 w-2 rounded-full bg-coral" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
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
function SectionAudioPlayer({ url, onEnded, alreadyEnded = false, volume, paused = false, autoStart = false }) {
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
    // If the browser refuses to start sound on its own (e.g. straight
    // after a page refresh, before any click), fall back to the button.
    audioRef.current?.play()?.catch?.(() => setStatus('ready'))
  }

  // Next part's recording starts by itself once the previous part's
  // recording has finished — no extra click, same as the real exam.
  useEffect(() => {
    if (autoStart && !paused && status === 'ready') handlePlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, paused])

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
function HighlightablePassage({ text, highlights, onAdd, onUpdateNote, onRemove, fontScale = 1, theme, fill = false }) {
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
        className={
          // `fill` (Reading split screen, 2026-09-29): the passage is plain
          // text using the whole left pane, like the real exam — Jasur: "why
          // it is inside of a tiny box?? ... the real exam uses the whole left
          // side". The pane itself scrolls. Without `fill` it keeps the old
          // compact scrolling box.
          fill
            ? 'leading-relaxed text-paper whitespace-pre-wrap'
            : 'max-h-72 overflow-y-auto rounded-xl border border-line bg-panel-2 p-4 leading-relaxed text-paper whitespace-pre-wrap'
        }
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
              className="cursor-pointer rounded-sm bg-[#ffe14d] px-0.5 text-[#1a1a1a]"
            >
              {seg.plain}
            </mark>
          ) : (
            <span key={seg.key}>{seg.plain}</span>
          )
        )}
      </div>

      {(!fill || rejectFlash) && (
        <p className={`mt-1.5 text-[11px] ${rejectFlash ? 'text-coral font-medium' : 'text-mist'}`}>
          {rejectFlash
            ? "That overlaps a highlight you already made — remove it first, or select different text."
            : 'Select any text above to highlight it or attach a note.'}
        </p>
      )}

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
            Highlight
          </button>
          <button
            type="button"
            onClick={handleAddNote}
            className="focus-ring rounded-full bg-panel-2 px-3 py-1 text-xs font-semibold text-paper-dim hover:text-paper"
          >
            Note
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

// The passage side of a "matching headings" Reading section — one
// HighlightablePassage per paragraph (highlights/notes still scoped to
// each paragraph's slice) with a gap right before every paragraph a
// "matching" question names ("Paragraph B"). The list of headings stays
// pinned at the top of the passage pane while it scrolls, so every gap
// can be reached mid-drag (2026-10-06 drag rewrite — see
// exam/choiceDrag.jsx).
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
  const questions = Object.values(matchingByParagraph)
  const usedValues = questions.map((q) => answers[q.id] ?? '').filter(Boolean)

  return (
    <div className="flex flex-col gap-3">
      <div
        className="sticky top-0 z-10 pb-2"
        style={{ backgroundColor: theme?.bg || 'var(--color-panel)' }}
      >
        <MatchingBank
          choices={bankChoices}
          usedValues={usedValues}
          hint="Drag a heading onto the gap above the paragraph it belongs to."
          onPick={(choice) => {
            const target = questions.find((q) => !(answers[q.id] ?? '').trim())
            if (target) setAnswer(target.id, choice)
          }}
          fontScale={fontScale}
          theme={theme}
          layout="wrap"
        />
      </div>

      {paragraphs.map((p) => {
        const q = p.letter ? matchingByParagraph[p.letter] : null
        const localHighlights = highlights
          .filter((h) => h.start >= p.start && h.end <= p.end)
          .map((h) => ({ ...h, start: h.start - p.start, end: h.end - p.start }))

        return (
          <div key={`${p.letter || 'lead'}-${p.start}`} className="mb-4">
            {p.letter && <p className="mb-2 font-bold text-paper">{p.letter}</p>}
            {q && (
              <div id={`q-${q.id}`} className="mb-2 flex items-center gap-2 scroll-mt-24">
                <DropGap
                  questionId={q.id}
                  index={questionIndexById[q.id]}
                  value={answers[q.id] ?? ''}
                  onClear={() => setAnswer(q.id, '')}
                  fontScale={fontScale}
                  theme={theme}
                  wide
                />
                <FlagButton flagged={flags.has(q.id)} onToggle={() => toggleFlag(q.id)} />
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
              fill
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

  // "A wooden 1 ______" and "Price: £4 ______" — the number right
  // before the blank is the question number, not part of the sentence.
  const dupNumber = new RegExp(`(^|[^0-9A-Za-z])${index}\\s*$`).exec(before)
  if (dupNumber) before = before.slice(0, dupNumber.index) + dupNumber[1]

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

function FlagButton({ flagged, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={flagged ? 'Remove flag' : 'Flag for review'}
      aria-pressed={flagged}
      className={`focus-ring shrink-0 rounded-md p-1 transition-colors ${flagged ? 'text-coral' : 'text-mist/60 hover:text-coral'}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={flagged ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 21V4h11l-2 4 2 4H5" />
      </svg>
    </button>
  )
}

// One question. `prompt` is the cleaned-up prompt from its group (title,
// instruction and typed-in number removed — exam/questionGroups.js);
// falls back to the raw prompt. Matching questions never come through
// here any more — MatchingQuestionGroup draws them with their bank.
export function QuestionBlock({ index, question, prompt, value, onChange, flagged = false, onToggleFlag, fontScale = 1, theme }) {
  const text = prompt ?? question.prompt
  const promptStyle = {
    fontSize: `${0.875 * fontScale}rem`,
    ...(theme?.bg ? { color: theme.text } : {}),
  }
  const optionTextStyle = { fontSize: `${0.875 * fontScale}rem` }

  // Short-answer: the gap sits INSIDE the sentence, exactly where the
  // blank is, with the question number as light text in the box (real
  // test). See splitPromptBlank.
  const isShortAnswer = question.type === 'short_answer'
  const shortAnswerParts = isShortAnswer ? splitPromptBlank(text, index) : null
  const shortAnswerInput = isShortAnswer && (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={String(index)}
      aria-label={`Question ${index}`}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      size={Math.max(10, Math.min(28, (value || '').length + 2))}
      style={{ ...optionTextStyle, ...(theme?.bg ? { backgroundColor: theme.surface, borderColor: theme.surfaceBorder, color: theme.text } : {}) }}
      className="focus-ring mx-1 inline-block rounded-md border border-line bg-panel px-2 py-1 text-center align-baseline text-paper"
    />
  )

  return (
    <div
      id={`q-${question.id}`}
      className={isShortAnswer ? 'pt-2.5 first:pt-0 scroll-mt-40' : 'pt-1 scroll-mt-40'}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <p className="leading-relaxed text-paper" style={promptStyle}>
          {isShortAnswer ? (
            <>
              {shortAnswerParts.before}
              {shortAnswerInput}
              {shortAnswerParts.after}
            </>
          ) : (
            <>
              <span className="mr-2 font-semibold">{index}</span>
              {text}
            </>
          )}
        </p>
        {onToggleFlag && <FlagButton flagged={flagged} onToggle={onToggleFlag} />}
      </div>

      {question.type === 'multiple_choice' && (
        <div className="flex flex-col gap-2">
          {(question.options?.choices ?? []).map((choice) => (
            <label
              key={choice}
              style={{ ...optionTextStyle, ...themedOptionStyle(theme, value === choice) }}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2 transition-colors ${
                value === choice
                  ? 'border-brass/40 bg-brass/10 text-paper'
                  : 'border-line bg-panel text-paper-dim hover:border-brass/30'
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

      {(question.type === 'true_false_ng' || question.type === 'yes_no_ng') && (
        <div className="flex flex-wrap gap-2">
          {(question.type === 'true_false_ng' ? TRUE_FALSE_NG_CHOICES : YES_NO_NG_CHOICES).map((choice) => (
            <label
              key={choice}
              style={{ ...optionTextStyle, ...themedOptionStyle(theme, value === choice) }}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-1.5 transition-colors ${
                value === choice
                  ? 'border-brass/40 bg-brass/10 text-paper'
                  : 'border-line bg-panel text-paper-dim hover:border-brass/30'
              }`}
            >
              <input
                type="radio"
                name={question.id}
                checked={value === choice}
                onChange={() => onChange(choice)}
                className="accent-brass"
              />
              {choice.toUpperCase()}
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

// ------------------------------------------------------------------
// MATCHING (drag-and-drop) — rewritten 2026-10-06 after Mock #1.
//
// A gap (DropGap) and an option bank (MatchingBank) per group, like the
// real computer test:
//   - the bank sits BESIDE the gaps (to the right) and stays pinned
//     while the pane scrolls, so the last gaps of a long group (Listening
//     Q15, Q28–30, Reading Q23–26 in Mock #1) can always be reached; on a
//     narrow pane it is pinned at the top instead;
//   - an option used in a gap disappears from the bank and comes back,
//     in its original place, when the gap is emptied or given another
//     option;
//   - a filled gap can be dragged to another gap (move) or back to the
//     bank (clear), and has a small × to clear it;
//   - clicking an option (or tapping on a phone) puts it in the first
//     empty gap of the group.
// Values saved are still the full option text — grading is unchanged.
// The drag itself lives in exam/choiceDrag.jsx.
// ------------------------------------------------------------------

function DropGap({ questionId, index, value, onClear, fontScale = 1, theme, inline = false, wide = false }) {
  const source = useChoiceDragSource()
  const active = useActiveChoiceDrag()
  const textStyle = { fontSize: `${0.875 * fontScale}rem` }
  const filledStyle = theme?.bg ? { backgroundColor: theme.surface, borderColor: theme.surfaceBorder, color: theme.text } : undefined

  return (
    <span
      data-drop={`q:${questionId}`}
      style={textStyle}
      className={`${inline ? 'mx-1 inline-flex align-middle' : 'flex'} ${wide ? 'w-full' : 'min-w-[10rem] max-w-full'} min-h-[2.25rem] items-stretch rounded-md border-2 transition-colors data-[drag-over]:border-brass data-[drag-over]:bg-brass/10 ${
        value ? 'border-line' : active ? 'border-dashed border-brass/60' : 'border-dashed border-line'
      }`}
    >
      {value ? (
        <>
          <span
            {...source({ choice: value, from: questionId })}
            style={filledStyle}
            title="Drag to another gap, or back to the options to remove it"
            className="flex flex-1 cursor-grab touch-none select-none items-center rounded-l-[4px] bg-panel-2 px-2.5 py-1 text-left leading-snug text-paper data-[dragging]:opacity-40"
          >
            {value}
          </span>
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear answer ${index}`}
            title="Clear this answer"
            className="focus-ring flex w-7 shrink-0 items-center justify-center rounded-r-[4px] text-mist hover:bg-panel-2 hover:text-paper"
          >
            ×
          </button>
        </>
      ) : (
        <span className="flex flex-1 items-center justify-center px-3 font-semibold text-mist">{index}</span>
      )}
    </span>
  )
}

function MatchingBank({ choices, usedValues, onPick, fontScale = 1, theme, hint, layout = 'stack' }) {
  const source = useChoiceDragSource()
  const optionTextStyle = { fontSize: `${0.875 * fontScale}rem` }
  const remaining = choices.filter((choice) => !usedValues.includes(choice))
  return (
    <div
      data-drop="bank"
      className="rounded-lg border border-line bg-panel p-3 transition-colors data-[drag-over]:border-brass data-[drag-over]:bg-brass/5"
      style={theme?.bg ? { backgroundColor: theme.bg, borderColor: theme.surfaceBorder } : undefined}
    >
      <p className="mb-2 text-xs text-mist" style={theme?.bg ? { color: theme.mutedText } : undefined}>
        {hint || 'Drag an option into a gap, or click it to fill the next empty gap.'}
      </p>
      <div className={layout === 'wrap' ? 'flex flex-wrap gap-1.5' : 'flex flex-col gap-1.5'}>
        {remaining.length > 0 ? (
          remaining.map((choice) => (
            <button
              key={choice}
              type="button"
              {...source({ choice, onClick: () => onPick(choice) })}
              style={{ ...optionTextStyle, ...themedOptionStyle(theme, false) }}
              className="focus-ring cursor-grab touch-none select-none rounded-md border border-line bg-panel px-3 py-1.5 text-left leading-snug text-paper transition-colors hover:border-brass/50 data-[dragging]:opacity-40"
            >
              {choice}
            </button>
          ))
        ) : (
          <p className="text-xs text-mist">All options used. Drag one back here to change it.</p>
        )}
      </div>
    </div>
  )
}

// A whole matching group: gaps on the left, bank on the right.
function MatchingQuestionGroup({ group, answers, onChange, flags, onToggleFlag, questionIndexById, fontScale = 1, theme }) {
  const { questions } = group
  const choices = questions[0].options?.choices || []
  const usedValues = questions.map((q) => answers[q.id] ?? '').filter(Boolean)
  const promptStyle = { fontSize: `${0.875 * fontScale}rem`, ...(theme?.bg ? { color: theme.text } : {}) }

  return (
    <div className="@container">
      <div className="grid items-start gap-4 @[560px]:grid-cols-[minmax(0,1fr)_minmax(170px,38%)]">
        <div className="order-2 flex flex-col gap-3 @[560px]:order-1">
          {questions.map((q) => {
            const index = questionIndexById[q.id]
            const text = group.prompts[q.id] ?? q.prompt
            const blank = /_{2,}/.test(text)
            const gap = (
              <DropGap
                questionId={q.id}
                index={index}
                value={answers[q.id] ?? ''}
                onClear={() => onChange(q.id, '')}
                fontScale={fontScale}
                theme={theme}
                inline={blank}
              />
            )
            const parts = blank ? splitPromptBlank(text, index) : null
            return (
              <div key={q.id} id={`q-${q.id}`} className="scroll-mt-40">
                {group.subheadings[q.id] && <p className="mb-1.5 mt-1 font-semibold text-paper" style={promptStyle}>{group.subheadings[q.id]}</p>}
                <div className="flex items-start justify-between gap-2">
                  {blank ? (
                    <p className="leading-[2.4] text-paper" style={promptStyle}>
                      {parts.before}
                      {gap}
                      {parts.after}
                    </p>
                  ) : (
                    <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
                      <p className="leading-relaxed text-paper" style={promptStyle}>
                        <span className="mr-2 font-semibold">{index}</span>
                        {text}
                      </p>
                      {gap}
                    </div>
                  )}
                  <FlagButton flagged={flags.has(q.id)} onToggle={() => onToggleFlag(q.id)} />
                </div>
              </div>
            )
          })}
        </div>
        <div
          className="sticky top-0 z-10 order-1 @[560px]:order-2"
          style={{ backgroundColor: theme?.bg || 'var(--color-panel)' }}
        >
          <div className="max-h-[42vh] overflow-y-auto @[560px]:max-h-none @[560px]:overflow-visible">
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
          </div>
        </div>
      </div>
    </div>
  )
}

// One IELTS question group: "Questions 11–15", the instruction once,
// then the questions.
function QuestionGroupView({ group, answers, onChange, flags, onToggleFlag, questionIndexById, fontScale = 1, theme }) {
  const headStyle = theme?.bg ? { color: theme.text } : undefined
  const isMatching = group.questions[0].type === 'matching'
  return (
    <section className="flex flex-col gap-3" aria-label={`Questions ${group.from}–${group.to}`}>
      <div style={headStyle}>
        <p className="font-semibold text-paper" style={{ fontSize: `${0.95 * fontScale}rem`, ...(headStyle || {}) }}>
          Questions {group.from}
          {group.to !== group.from ? `–${group.to}` : ''}
        </p>
        {group.instruction && (
          <p className="mt-1 text-paper-dim" style={{ fontSize: `${0.875 * fontScale}rem`, ...(headStyle || {}) }}>
            {group.instruction}
          </p>
        )}
        {group.title && (
          <p className="mt-3 font-semibold text-paper" style={{ fontSize: `${0.95 * fontScale}rem`, ...(headStyle || {}) }}>
            {group.title}
          </p>
        )}
      </div>

      {isMatching ? (
        <MatchingQuestionGroup
          group={group}
          answers={answers}
          onChange={onChange}
          flags={flags}
          onToggleFlag={onToggleFlag}
          questionIndexById={questionIndexById}
          fontScale={fontScale}
          theme={theme}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {group.questions.map((q) => (
            <div key={q.id}>
              {group.subheadings[q.id] && (
                <p className="mb-1 mt-1 font-semibold text-paper" style={{ fontSize: `${0.875 * fontScale}rem`, ...(headStyle || {}) }}>
                  {group.subheadings[q.id]}
                </p>
              )}
              <QuestionBlock
                index={questionIndexById[q.id]}
                question={q}
                prompt={group.prompts[q.id]}
                value={answers[q.id] ?? ''}
                onChange={(v) => onChange(q.id, v)}
                flagged={flags.has(q.id)}
                onToggleFlag={() => onToggleFlag(q.id)}
                fontScale={fontScale}
                theme={theme}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
