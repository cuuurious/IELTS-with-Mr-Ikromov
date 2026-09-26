import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { ExamTaker, buildAttemptQuestions } from './MockExams'
import { WritingTaker } from './WritingMockExam'
import { isSpeechSupported, speak, stopSpeaking } from '../lib/speech'
import { isTestToneSupported, playTestTone } from '../lib/testTone'

/*
 * ================================================================
 * FULL MOCK RUNNER
 * ================================================================
 * Shipped 2026-09-25 (migration_37), replacing free single-module
 * practice in the Mock Test Center's "Take a Test" tab. Jasur's own
 * words: "i dont want them to be able to do watever test they want at
 * anytime, once they start the mock they have to solve listening
 * first, reading and writing next but between there should be
 * instuction smth and confirming like in real exam."
 *
 * A "Full Mock" (full_mock_sets) bundles one already-authored
 * Listening exam + one Reading exam + one Writing exam, built by a
 * teacher in the Content tab. This component is the whole forced-order
 * sequence: pick a set -> Listening instructions/confirm gate ->
 * Listening exam -> Reading gate -> Reading exam -> Writing gate ->
 * Writing exam -> done. Nothing here lets a student jump ahead, go
 * back to a finished section, or pick which module to do first.
 *
 * Reuses the ALREADY-BUILT per-module exam-taking UI rather than
 * duplicating it — <ExamTaker> (exported from MockExams.jsx) runs the
 * timed Listening/Reading experience exactly as it already worked
 * (single-play audio, split passage/questions, instant scoring);
 * <WritingTaker> (exported from WritingMockExam.jsx) runs the Writing
 * task with all its existing real-exam behavior (task switching, paste
 * blocked, autosave, tab-switch logging, minimize/resume). Only the
 * SEQUENCING and the confirm gates between stages are new.
 *
 * Resume behavior: Listening/Reading never supported resuming mid-
 * question (neither did the old free-pick MockExams.jsx) — refreshing
 * mid-section starts that section over, same as before. Writing DOES
 * resume mid-question (it always has, via writing_mock_attempts.
 * started_at) — so re-opening "Take a Test" while on the Writing stage
 * skips straight back into the unfinished essay, no gate repeated,
 * exactly like the real test wouldn't re-show one-time instructions.
 *
 * Visual fidelity note (Jasur agreed to this, 2026-09-25): Listening/
 * Reading's actual exam-taking screen is still MockExams.jsx's
 * original, simpler layout — not yet the full pixel-accurate rebuild
 * (highlighting, notes, a flagged-question navigator, the exact
 * Settings panel) that's still blocked on a couple of visual details
 * from the real test. What's new here — the confirm-before-start gate
 * and the forced Listening->Reading->Writing order — IS real-exam-
 * accurate; the deeper visual polish of the exam screen itself is a
 * separate, later pass.
 *
 * Access-code gate (2026-09-26, migration_45): free self-practice
 * access is gone — MockTestCenter.jsx now renders MockCheckIn.jsx in
 * front of this component instead of this component directly.
 * MockCheckIn hands down `restrictedSet` (the one full_mock_sets row
 * the student's code was issued for) once the student's teacher-issued
 * code checks out. When `restrictedSet` is set, the free "pick a full
 * mock" grid below is skipped entirely — there's only ever one set to
 * sit — and a fresh attempt is started automatically the moment this
 * component loads with nothing already in progress. The instructions+
 * confirm gate itself was also restyled to match the real IELTS
 * check-in/instructions screen (white card, black text, gray
 * instructions box, black pill "Start" button) researched the same
 * day on the official familiarisation site — a deliberate break from
 * the rest of this file's dark brass "ticket" theme, same reasoning as
 * MockCheckIn.jsx's own header comment.
 *
 * Spoken instructions (2026-09-26): the gap flagged right above — "the
 * *seeing* and *confirming* part is real-exam-accurate; there's no
 * actual spoken-audio narration" — is closed here. Jasur, verbatim:
 * "yes ofcourse audio instructions have to be added just like in real
 * exam." Each stage's instructions box now narrates itself once,
 * automatically, via the browser's own text-to-speech (see
 * `lib/speech.js` for why that beats a recorded-audio-file approach),
 * with a Replay/Stop control for anyone who wants to hear it again or
 * would rather read in silence. narratedStagesRef makes sure a stage
 * only auto-narrates the first time its gate is shown per mount — not
 * every re-render, and not again if the student backs out and returns
 * to an already-narrated stage in the same sitting.
 * ================================================================
 */

const STAGE_ORDER = ['listening', 'reading', 'writing']

const STAGE_META = {
  listening: {
    label: 'Listening',
    instructions:
      "You will hear a number of different recordings and answer questions on what you hear. " +
      "Each recording is played once only — there's no way to replay it, same as the real test. " +
      "You'll have some time to read each set of questions before its recording starts.",
  },
  reading: {
    label: 'Reading',
    instructions:
      'You have 60 minutes for three passages and 40 questions. Read the instructions for each ' +
      "set of questions carefully and answer every question — there's no extra time to transfer " +
      'answers afterwards.',
  },
  writing: {
    label: 'Writing',
    instructions:
      'You have 60 minutes to complete both writing tasks. Task 1 needs at least 150 words, ' +
      "Task 2 needs at least 250 words. Once you begin you can't go back to Listening or Reading.",
  },
}

export default function FullMockRunner({ selfId, restrictedSet, onExitRestricted }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sets, setSets] = useState([])
  const [activeAttempt, setActiveAttempt] = useState(null) // { attempt, set } | null
  const [gateConfirmed, setGateConfirmed] = useState(false)
  const [readyToStart, setReadyToStart] = useState(false) // "I confirm" clicked, black Start pill now showing — see gate render below
  const [moduleExamData, setModuleExamData] = useState(null) // { exam, sections } for listening/reading
  const [moduleLoading, setModuleLoading] = useState(false)
  const [writingResume, setWritingResume] = useState(undefined) // undefined = not checked, null = none, object = in-progress attempt
  const [currentStageAttemptId, setCurrentStageAttemptId] = useState(null)
  const [justFinished, setJustFinished] = useState(null) // { score, maxScore } | 'writing' | null, shown before advancing
  const [writingStarting, setWritingStarting] = useState(false) // guards startWriting() from firing more than once

  // Pre-exam system check (2026-09-26) — real computer-delivered IELTS
  // runs a short system/sound check before the test proper begins; this
  // mirrors that once per sitting, right before the very first (Listening)
  // gate, rather than repeating it before every stage. Plain in-memory
  // state is enough — the resume-on-refresh fix already skips straight
  // past the gate entirely (via gateConfirmed) for a Listening attempt
  // already under way, so this naturally never re-appears on a refresh
  // either; it only shows for a genuinely fresh start.
  const [systemCheckPassed, setSystemCheckPassed] = useState(false)

  // Spoken instructions — see lib/speech.js and the header comment
  // above. narratedStagesRef tracks which stage keys have already
  // auto-played once this mount, so returning to a gate already heard
  // doesn't narrate itself again unprompted.
  const [narrating, setNarrating] = useState(false)
  const narratedStagesRef = useRef(new Set())

  const narrationKey = activeAttempt ? `${activeAttempt.attempt.id}:${activeAttempt.attempt.stage}` : null
  const gateIsShowing = Boolean(
    activeAttempt && activeAttempt.attempt.stage !== 'done' && !gateConfirmed &&
      !(activeAttempt.attempt.stage === 'writing' && writingResume)
  )

  const speakInstructions = () => {
    const meta = activeAttempt ? STAGE_META[activeAttempt.attempt.stage] : null
    if (!meta) return
    speak(meta.instructions, { onStart: () => setNarrating(true), onEnd: () => setNarrating(false) })
  }

  useEffect(() => {
    if (!gateIsShowing || !narrationKey) return
    if (narratedStagesRef.current.has(narrationKey)) return
    narratedStagesRef.current.add(narrationKey)
    speakInstructions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateIsShowing, narrationKey])

  // Stop narrating the moment the student moves on (confirms, exits, or
  // the whole runner unmounts) — a real invigilator doesn't keep talking
  // once the section has started either.
  useEffect(() => {
    if (!gateIsShowing) stopSpeaking()
  }, [gateIsShowing])

  useEffect(() => stopSpeaking, [])

  const loadAll = async () => {
    setLoading(true)
    setError('')

    // Access-code gate: MockCheckIn already verified the code and knows
    // exactly which set this is for — no free pick, and no need to load
    // every published set just to show one.
    if (restrictedSet) {
      const { data: attemptRows, error: attemptsError } = await supabase
        .from('full_mock_attempts')
        .select('*')
        .eq('student_id', selfId)
        .neq('stage', 'done')
        .order('started_at', { ascending: false })
        .limit(1)

      if (attemptsError) console.error('Failed to load full mock progress:', attemptsError)

      setSets([restrictedSet])

      const inProgress = (attemptRows || [])[0] || null
      if (inProgress) {
        // Resume whatever's already in progress — same "don't lose their
        // place" behavior as the free-pick path always had. Only
        // restrictedSet's own title/exam ids are available here, which is
        // fine even in the edge case of a stale in-progress attempt from
        // a different set (unreachable going forward, now that every
        // attempt starts from a code tied to one specific set).
        setActiveAttempt({ attempt: inProgress, set: restrictedSet })
        setGateConfirmed(false)
        setReadyToStart(false)
        setLoading(false)
      } else {
        // Nothing in progress — this code is fresh, start the one set it
        // was issued for immediately. No grid, no picking.
        await startFullMock(restrictedSet)
        setLoading(false)
      }
      return
    }

    const [{ data: setRows, error: setsError }, { data: attemptRows, error: attemptsError }] =
      await Promise.all([
        supabase
          .from('full_mock_sets')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('full_mock_attempts')
          .select('*')
          .eq('student_id', selfId)
          .neq('stage', 'done')
          .order('started_at', { ascending: false })
          .limit(1),
      ])

    if (setsError) setError(setsError.message || 'Could not load full mocks.')
    if (attemptsError) console.error('Failed to load full mock progress:', attemptsError)

    setSets(setRows || [])

    const inProgress = (attemptRows || [])[0] || null
    if (inProgress) {
      const set = (setRows || []).find((s) => s.id === inProgress.set_id) || null
      setActiveAttempt({ attempt: inProgress, set })
      setGateConfirmed(false)
      setReadyToStart(false)
    } else {
      setActiveAttempt(null)
    }

    setLoading(false)
  }

  useEffect(() => {
    if (!selfId) return
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId])

  // Load the specific Listening/Reading exam's sections+questions once
  // an attempt is on that stage — same query MockExams.jsx's openExam()
  // uses, just pointed at one specific exam id instead of a free pick.
  useEffect(() => {
    const stage = activeAttempt?.attempt?.stage
    if (!activeAttempt?.set || (stage !== 'listening' && stage !== 'reading')) {
      setModuleExamData(null)
      return
    }

    let cancelled = false
    const examId = stage === 'listening' ? activeAttempt.set.listening_exam_id : activeAttempt.set.reading_exam_id

    const load = async () => {
      setModuleLoading(true)
      const { data: exam, error: examError } = await supabase
        .from('mock_exams')
        .select('*')
        .eq('id', examId)
        .single()

      if (cancelled) return
      if (examError) {
        setError(examError.message || 'Could not load this exam.')
        setModuleLoading(false)
        return
      }

      // Resume-on-refresh, gate half: ExamTaker itself already resumes an
      // in-progress mock_attempts row instead of starting over (see
      // MockExams.jsx), but it never even mounts until `gateConfirmed` is
      // true — and that's plain component state, so a refresh reset it to
      // false and re-showed the "read the instructions and confirm"
      // screen every time, even for a stage already well underway. The
      // real exam's own rule is "you'll only see this once" — so if an
      // attempt already exists here (unsubmitted), skip straight past the
      // gate instead of making the student click "I confirm" again for an
      // exam they already started.
      const { data: inProgress } = await supabase
        .from('mock_attempts')
        .select('id')
        .eq('exam_id', examId)
        .eq('user_id', selfId)
        .is('submitted_at', null)
        .limit(1)
        .maybeSingle()
      if (!cancelled && inProgress) setGateConfirmed(true)

      const { data: sections, error: sectionsError } = await supabase
        .from('mock_sections')
        .select('*')
        .eq('exam_id', examId)
        .order('order_index', { ascending: true })

      if (cancelled) return
      if (sectionsError) {
        setError(sectionsError.message || 'Could not load this exam.')
        setModuleLoading(false)
        return
      }

      const sectionIds = (sections || []).map((s) => s.id)
      const { data: questions, error: questionsError } = await supabase
        .from('mock_questions_public')
        .select('*')
        .in('section_id', sectionIds.length ? sectionIds : ['00000000-0000-0000-0000-000000000000'])
        .order('order_index', { ascending: true })

      if (cancelled) return
      if (questionsError) {
        setError(questionsError.message || 'Could not load this exam.')
        setModuleLoading(false)
        return
      }

      setModuleExamData({
        exam,
        sections: (sections || []).map((s) => ({
          ...s,
          // Randomized question bank (2026-09-25) — draws a fresh random
          // subset/order each time this stage loads, if the exam has it
          // turned on. See MockExams.jsx's buildAttemptQuestions comment.
          questions: buildAttemptQuestions((questions || []).filter((q) => q.section_id === s.id), exam),
        })),
      })
      setModuleLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [activeAttempt?.attempt?.stage, activeAttempt?.set])

  // Writing stage: check for an already-started, unsubmitted attempt so
  // a refresh/minimize resumes straight back in instead of re-showing
  // the gate — same resume convention WritingMockExam.jsx already uses.
  useEffect(() => {
    const stage = activeAttempt?.attempt?.stage
    if (stage !== 'writing' || !activeAttempt?.set) {
      setWritingResume(undefined)
      return
    }

    let cancelled = false
    const check = async () => {
      const { data, error: checkError } = await supabase
        .from('writing_mock_attempts')
        .select('*')
        .eq('exam_id', activeAttempt.set.writing_exam_id)
        .eq('student_id', selfId)
        .is('submitted_at', null)
        .order('started_at', { ascending: false })
        .limit(1)

      if (cancelled) return
      if (checkError) {
        console.error('Failed to check for an in-progress writing attempt:', checkError)
        setWritingResume(null)
        return
      }
      setWritingResume((data || [])[0] || null)
    }

    check()
    return () => {
      cancelled = true
    }
  }, [activeAttempt?.attempt?.stage, activeAttempt?.set, selfId])

  // Writing stage: once confirmed and we know there's nothing to resume,
  // start a fresh writing_mock_attempts row exactly once. This has to be
  // an effect (not a call inside the render body) — a render-body call
  // would fire again on every re-render until writingResume updates,
  // inserting duplicate attempts. writingStarting guards the in-flight
  // gap between kicking off the insert and its result landing in state.
  useEffect(() => {
    const stage = activeAttempt?.attempt?.stage
    if (stage !== 'writing' || !gateConfirmed || writingResume !== null || writingStarting) return

    let cancelled = false
    setWritingStarting(true)
    startWriting().finally(() => {
      if (!cancelled) setWritingStarting(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAttempt?.attempt?.stage, gateConfirmed, writingResume, writingStarting])

  const startFullMock = async (set) => {
    setError('')
    const { data, error: startError } = await supabase
      .from('full_mock_attempts')
      .insert({ set_id: set.id, student_id: selfId, stage: 'listening' })
      .select('*')
      .single()

    if (startError) {
      setError(startError.message || 'Could not start this full mock.')
      return
    }

    setActiveAttempt({ attempt: data, set })
    setGateConfirmed(false)
    setReadyToStart(false)
    setCurrentStageAttemptId(null)
    setJustFinished(null)
  }

  const advanceStage = async (nextStage, extra = {}) => {
    const payload = { stage: nextStage, updated_at: new Date().toISOString(), ...extra }
    if (nextStage === 'done') payload.completed_at = new Date().toISOString()

    const { data, error: updateError } = await supabase
      .from('full_mock_attempts')
      .update(payload)
      .eq('id', activeAttempt.attempt.id)
      .select('*')
      .single()

    if (updateError) {
      setError(updateError.message || 'Could not save your progress — please try again.')
      return
    }

    setActiveAttempt((prev) => ({ ...prev, attempt: data }))
    setGateConfirmed(false)
    setReadyToStart(false)
    setCurrentStageAttemptId(null)
    setModuleExamData(null)
    setJustFinished(null)
  }

  const startWriting = async () => {
    setError('')
    const { data, error: startError } = await supabase
      .from('writing_mock_attempts')
      .insert({ exam_id: activeAttempt.set.writing_exam_id, student_id: selfId })
      .select('*')
      .single()

    if (startError) {
      setError(startError.message || 'Could not start the writing task.')
      return
    }

    setWritingResume(data)
  }

  const backToPicker = () => {
    setActiveAttempt(null)
    setGateConfirmed(false)
    setReadyToStart(false)
    setModuleExamData(null)
    setWritingResume(undefined)
    loadAll()
  }

  // Once a code is checked in there's no free picker to go "back" to —
  // hand control back to MockCheckIn so it shows the check-in form again
  // for whatever code the student uses next time.
  const finishUp = restrictedSet && onExitRestricted ? onExitRestricted : backToPicker

  if (loading) {
    return (
      <div className="ticket rounded-2xl p-8 text-center">
        <p className="text-sm text-mist">Loading…</p>
      </div>
    )
  }

  // ---- No attempt in progress: pick a full mock ----
  if (!activeAttempt) {
    return (
      <div className="ticket rounded-2xl p-5 sm:p-6 flex flex-col gap-5">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
            Full mock exams
          </div>
          <h2 className="font-display text-2xl sm:text-3xl mt-1">Full Mock</h2>
          <p className="text-sm text-mist mt-1.5 max-w-md">
            Sit Listening, Reading and Writing back-to-back, in that order, under real exam
            conditions — timed, no skipping ahead. Just like a real exam, results aren't
            available immediately — your teacher releases them once they're ready.
          </p>
        </div>

        <div className="border-t border-line pt-4">
          {error && <p className="text-sm text-coral mb-3">{error}</p>}

          {sets.length === 0 ? (
            <p className="text-sm text-mist">No full mocks published yet — check back soon.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {sets.map((set) => (
                <button
                  key={set.id}
                  type="button"
                  onClick={() => startFullMock(set)}
                  className="focus-ring group flex flex-col justify-between rounded-xl border border-line bg-panel-2 p-4 text-left transition hover:border-brass/40 hover:bg-panel"
                >
                  <div>
                    <span className="inline-flex items-center rounded-full bg-brass/15 px-2.5 py-1 text-[11px] font-semibold text-brass">
                      Full Mock
                    </span>
                    <p className="mt-2.5 font-display text-sm text-paper">{set.title}</p>
                    <p className="mt-1 text-xs text-mist">Listening → Reading → Writing</p>
                  </div>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brass group-hover:text-brass-dim">
                    Start <span aria-hidden>→</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const stage = activeAttempt.attempt.stage
  const meta = STAGE_META[stage]
  const setTitle = activeAttempt.set?.title || 'Full Mock'

  // ---- System check (once, before Listening's gate only) ----
  if (stage === 'listening' && !gateConfirmed && !systemCheckPassed) {
    return <SystemCheckGate setTitle={setTitle} onContinue={() => setSystemCheckPassed(true)} />
  }

  // ---- Done ----
  if (stage === 'done') {
    return (
      <div className="ticket rounded-2xl p-8 text-center">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-brass">
          Full mock complete
        </span>
        <p className="mt-2 font-display text-2xl text-paper">{setTitle}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-mist">
          Submitted. Just like a real exam, your results aren't out yet — your teacher will
          release your Listening, Reading and Writing bands to Overview once they're ready.
        </p>
        <button
          type="button"
          onClick={finishUp}
          className="focus-ring mt-6 inline-block rounded-full bg-brass px-6 py-2.5 text-sm font-bold text-onbrass shadow-sm transition-transform hover:scale-105"
        >
          {restrictedSet ? 'Done' : 'Back to Full Mocks'}
        </button>
      </div>
    )
  }

  // ---- Writing stage: resume straight in if already started ----
  if (stage === 'writing' && writingResume) {
    return (
      <WritingTaker
        exam={{
          id: activeAttempt.set.writing_exam_id,
          title: activeAttempt.set.title,
          task1_prompt: writingResume.task1_prompt_snapshot,
          task2_prompt: writingResume.task2_prompt_snapshot,
        }}
        attempt={writingResume}
        onDone={() => advanceStage('done', { writing_attempt_id: writingResume.id })}
        onMinimize={backToPicker}
      />
    )
  }

  // ---- Listening/Reading stage: exam already confirmed+started ----
  if ((stage === 'listening' || stage === 'reading') && gateConfirmed) {
    if (moduleLoading || !moduleExamData) {
      return (
        <div className="ticket rounded-2xl p-8 text-center">
          <p className="text-sm text-mist">Loading {meta.label.toLowerCase()} exam…</p>
        </div>
      )
    }

    const nextStage = stage === 'listening' ? 'reading' : 'writing'
    const nextLabel = stage === 'listening' ? 'Reading' : 'Writing'

    return (
      <ExamTaker
        selfId={selfId}
        exam={moduleExamData.exam}
        sections={moduleExamData.sections}
        ctaLabel={`Continue to ${nextLabel} →`}
        onAttemptStarted={setCurrentStageAttemptId}
        onExit={() =>
          advanceStage(nextStage, {
            [stage === 'listening' ? 'listening_attempt_id' : 'reading_attempt_id']:
              currentStageAttemptId,
          })
        }
      />
    )
  }

  // ---- Writing stage: confirmed, no in-progress attempt yet — the effect
  // above starts one; this just shows a loading state while that lands.
  if (stage === 'writing' && gateConfirmed && writingResume === null) {
    return (
      <div className="ticket rounded-2xl p-8 text-center">
        <p className="text-sm text-mist">Starting the writing task…</p>
        {error && <p className="mt-3 text-sm text-coral">{error}</p>}
      </div>
    )
  }

  // ---- Instructions + confirm gate (default for every stage) ----
  // Restyled 2026-09-26 to match the real IELTS check-in/instructions
  // screen (researched on the official familiarisation site the same
  // day): white card, black text, gray "Test information"-style
  // instructions box, and a two-step confirm -> black pill "Start"
  // button, instead of this app's own dark brass "ticket" theme used
  // everywhere else. Jasur, verbatim: "this confirming window has to be
  // the same as well... they will see instrutcions and hear them as
  // well and confirm there."
  const examTitleForGate =
    stage === 'writing'
      ? activeAttempt.set?.title
      : stage === 'listening'
      ? moduleExamData?.exam?.title || 'Listening'
      : moduleExamData?.exam?.title || 'Reading'

  return (
    <div className="rounded-2xl border border-slate-200 bg-white text-slate-900 p-6 sm:p-8 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-red-600" aria-hidden />
        <span className="text-[11px] uppercase tracking-[0.18em] text-red-600 font-semibold">
          {setTitle} — {meta.label}
        </span>
      </div>

      <h2 className="text-2xl font-bold mt-1.5 text-slate-900">{examTitleForGate}</h2>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
        {meta.instructions}
      </div>

      {isSpeechSupported() && (
        <button
          type="button"
          onClick={() => (narrating ? stopSpeaking() : speakInstructions())}
          className="focus-ring mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-900 hover:text-slate-900 transition-colors"
        >
          {narrating ? (
            <>⏸ Stop reading</>
          ) : (
            <>🔊 Hear these instructions again</>
          )}
        </button>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6">
        <p className="text-lg font-bold text-slate-900">Ready?</p>
        <p className="mt-0.5 text-sm text-slate-500">
          Please confirm that you have understood the instructions above.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!gateConfirmed && !readyToStart && (
            <button
              type="button"
              onClick={() => setReadyToStart(true)}
              className="focus-ring rounded-full border-2 border-slate-900 text-slate-900 px-5 py-2.5 text-sm font-semibold hover:bg-slate-900 hover:text-white transition-colors"
            >
              I confirm
            </button>
          )}

          {!gateConfirmed && readyToStart && (
            <button
              type="button"
              onClick={() => setGateConfirmed(true)}
              className="focus-ring inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-6 py-2.5 text-sm font-semibold shadow-sm hover:bg-slate-700 transition-colors"
            >
              <span aria-hidden>→</span> Start {meta.label}
            </button>
          )}

          {gateConfirmed && (stage === 'listening' || stage === 'reading') && (
            <span className="text-sm text-slate-500">Loading exam…</span>
          )}

          {gateConfirmed && stage === 'writing' && writingResume === undefined && (
            <span className="text-sm text-slate-500">Checking for anything already in progress…</span>
          )}
        </div>
      </div>

      <p className="mt-6 text-[11px] text-slate-400">
        Like the real test, these instructions are read aloud once automatically — use the button
        above if you need to hear them again.
      </p>
    </div>
  )
}

// ------------------------------------------------------------------
// Pre-exam system check — see the state comment above where this is
// rendered. Styled to match the instructions/confirm gate immediately
// after it (white card, black text, red eyebrow) so the two feel like
// one continuous real-exam check-in flow, not a bolted-on extra screen.
// Deliberately narrow in scope: a connection status readout (best-effort
// — `navigator.onLine` is a hint, not a guarantee, so this only ever
// warns, never hard-blocks on it) and a synthesized audio chime the
// student has to confirm they heard before Continue enables, since a
// silent/broken speaker or a muted tab is the one failure mode here that
// would otherwise only surface once the actual Listening audio starts.
// Speaking isn't checked here — it isn't recorded in-app at all (a live
// Zoom call with the examiner), so there's nothing about a microphone
// this screen could meaningfully verify.
// ------------------------------------------------------------------
function SystemCheckGate({ setTitle, onContinue }) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [toneStatus, setToneStatus] = useState('idle') // idle | playing | asked
  const [audioConfirmed, setAudioConfirmed] = useState(false)
  const toneSupported = isTestToneSupported()

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const handlePlayTone = async () => {
    setToneStatus('playing')
    await playTestTone()
    setToneStatus('asked')
  }

  const canContinue = audioConfirmed || !toneSupported

  return (
    <div className="rounded-2xl border border-slate-200 bg-white text-slate-900 p-6 sm:p-8 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-red-600" aria-hidden />
        <span className="text-[11px] uppercase tracking-[0.18em] text-red-600 font-semibold">
          {setTitle} — System check
        </span>
      </div>

      <h2 className="text-2xl font-bold mt-1.5 text-slate-900">Before you begin</h2>
      <p className="mt-1 text-sm text-slate-500">
        A quick check, the same way a real test center checks your computer before you sit down —
        just once, before Listening starts.
      </p>

      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-600'}`}
            aria-hidden
          />
          <span className="text-sm font-semibold text-slate-900">
            {online ? "You're online" : 'You appear to be offline'}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {online
            ? 'A stable connection matters most for Listening, since the audio streams as it plays.'
            : "Your browser reports no connection right now — check your wifi or data before starting. This can sometimes be wrong, so it won't stop you here, but a mock started offline may not save properly."}
        </p>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">Sound check</p>
        <p className="mt-1 text-xs text-slate-500">
          Listening plays once, with no way to replay it — make sure you can hear it clearly now,
          not partway through the real thing.
        </p>

        {toneSupported ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePlayTone}
              disabled={toneStatus === 'playing'}
              className="focus-ring rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-900 hover:text-slate-900 transition-colors disabled:opacity-60"
            >
              {toneStatus === 'playing' ? 'Playing…' : '▶ Play test sound'}
            </button>

            {toneStatus === 'asked' && !audioConfirmed && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">Did you hear it clearly?</span>
                <button
                  type="button"
                  onClick={() => setAudioConfirmed(true)}
                  className="focus-ring rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={handlePlayTone}
                  className="focus-ring rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-900 hover:text-slate-900"
                >
                  No, play again
                </button>
              </div>
            )}

            {audioConfirmed && (
              <span className="text-xs font-medium text-emerald-600">✓ Sound confirmed</span>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-amber-600">
            This browser doesn't support the check itself — you can still continue, just make sure
            your volume is up and unmuted before Listening starts.
          </p>
        )}
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="focus-ring inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue to instructions <span aria-hidden>→</span>
        </button>
        {!canContinue && (
          <p className="mt-2 text-xs text-slate-400">Confirm you can hear the test sound to continue.</p>
        )}
      </div>
    </div>
  )
}
