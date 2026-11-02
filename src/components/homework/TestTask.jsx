import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { ExamTaker, buildAttemptQuestions } from '../MockExams'
import { loadQuestionGroups } from '../exam/questionGroups'
import { examMinutes, gradeLabel, gradeTone, percentOf, summariseAttempts } from '../../lib/homeworkTasks'
import TaskShell, { BandRing, Panel } from './TaskShell'
import { WordLookupArea } from './WordLookup'

/*
 * A Reading/Listening homework test (2026-11-02).
 *   1. The student picks Practice (no clock, free audio, tap words for
 *      meaning) or Real exam (the test-day clock, audio once).
 *   2. The real-test screen (ExamTaker) runs it on homework_attempts.
 *   3. Marked straight away: score, band if it is out of 40, every
 *      answer with the right one. Retakes are allowed; the first try is
 *      the one that counts.
 */

async function loadTaskExam(examId) {
  const { data: exam, error: examError } = await supabase.from('mock_exams').select('*').eq('id', examId).single()
  if (examError) throw examError
  const { data: sections, error: sectionsError } = await supabase
    .from('mock_sections')
    .select('*')
    .eq('exam_id', examId)
    .order('order_index', { ascending: true })
  if (sectionsError) throw sectionsError
  const sectionIds = (sections || []).map((s) => s.id)
  const { data: questionsRaw, error: questionsError } = await supabase.rpc('get_mock_questions_public', {
    p_section_ids: sectionIds.length ? sectionIds : ['00000000-0000-0000-0000-000000000000'],
  })
  if (questionsError) throw questionsError
  const questions = [...(questionsRaw || [])].sort((a, b) => a.order_index - b.order_index)
  const groups = await loadQuestionGroups(supabase, sectionIds)
  return {
    exam,
    sections: (sections || []).map((s) => ({
      ...s,
      groups: groups.filter((g) => g.section_id === s.id),
      questions: buildAttemptQuestions(questions.filter((q) => q.section_id === s.id), exam),
    })),
  }
}

const MODES = [
  {
    key: 'practice',
    title: 'Practice',
    text: 'No clock. Pause and replay the audio. Double-click any word for its meaning.',
    tone: 'bg-reading-tint text-reading',
    btn: 'bg-reading',
  },
  {
    key: 'exam',
    title: 'Real exam',
    text: 'The test-day clock. Audio plays once. Like the real IELTS.',
    tone: 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] text-brass',
    btn: 'bg-brass',
  },
]

export default function TestTask({ task, studentId, onClose, onChanged }) {
  const [phase, setPhase] = useState('loading') // loading | pick | running | result | error
  const [data, setData] = useState(null)
  const [attempts, setAttempts] = useState([])
  const [mode, setMode] = useState('practice')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [runKey, setRunKey] = useState(0)

  const loadAttempts = async () => {
    const { data: rows } = await supabase
      .from('homework_attempts')
      .select('id, attempt_no, mode, started_at, deadline_at, submitted_at, score, max_score, band, late, results')
      .eq('task_id', task.id)
      .eq('user_id', studentId)
      .order('attempt_no', { ascending: true })
    setAttempts(rows || [])
    return rows || []
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [loaded] = await Promise.all([loadTaskExam(task.exam_id), loadAttempts()])
        if (cancelled) return
        setData(loaded)
        setPhase('pick')
      } catch (err) {
        if (cancelled) return
        setError(err?.message || 'Could not open this test.')
        setPhase('error')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  const summary = useMemo(() => summariseAttempts(attempts), [attempts])
  const module = data?.exam?.module || task.kind
  const partWord = module === 'listening' ? 'part' : 'passage'
  const sectionCount = data?.sections?.length || 0
  const minutes = examMinutes(data?.exam, sectionCount)
  const questionCount = (data?.sections || []).reduce((n, s) => n + s.questions.length, 0)

  const start = (m) => {
    setMode(m)
    setResult(null)
    setRunKey((k) => k + 1)
    setPhase('running')
  }

  if (phase === 'running' && data) {
    const open = summary.open
    const runMode = open ? open.mode : mode
    return (
      <WordLookupArea enabled={runMode === 'practice'} source={data.exam.title}>
        <ExamTaker
          key={runKey}
          selfId={studentId}
          exam={data.exam}
          sections={data.sections}
          ctaLabel="Back to homework"
          onExit={() => {
            loadAttempts()
            setPhase('pick')
          }}
          onSubmitted={async (r) => {
            setResult(r)
            const rows = await loadAttempts()
            setPhase('result')
            onChanged?.(rows)
          }}
          store={{
            table: 'homework_attempts',
            match: { task_id: task.id },
            insertRow: { task_id: task.id, user_id: studentId, mode: runMode },
            submitRpc: 'submit_homework_attempt',
            untimed: runMode === 'practice',
          }}
        />
      </WordLookupArea>
    )
  }

  const title = task.title || data?.exam?.title || 'Homework test'

  return (
    <TaskShell
      kind={module}
      title={title}
      subtitle={data ? `${sectionCount} ${partWord}${sectionCount === 1 ? '' : 's'} · ${questionCount} questions` : ''}
      onClose={onClose}
      wide={phase === 'result'}
    >
      {phase === 'loading' && <Panel><p className="text-sm font-semibold text-mist">Opening the test…</p></Panel>}
      {phase === 'error' && (
        <Panel>
          <p className="text-sm font-semibold text-coral">{error}</p>
        </Panel>
      )}

      {phase === 'pick' && data && (
        <div className="flex flex-col gap-4">
          {summary.open ? (
            <Panel className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--color-saffron)_18%,var(--color-panel))] text-amber" aria-hidden="true">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></svg>
                </span>
                <div>
                  <p className="font-brand text-[18px] font-semibold text-paper">You have a try in progress</p>
                  <p className="text-sm font-semibold text-mist">
                    {summary.open.mode === 'exam' ? 'Real exam mode — the clock kept running.' : 'Practice mode — your answers are saved.'}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => start(summary.open.mode)} className="focus-ring h-12 rounded-[14px] bg-saffron text-[15px] font-extrabold text-[#17213a] hover:brightness-105">
                Continue
              </button>
            </Panel>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => start(m.key)}
                  className="focus-ring group flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(36,86,176,0.12)]"
                >
                  <span className={`grid h-14 w-14 place-items-center rounded-2xl ${m.tone}`} aria-hidden="true">
                    {m.key === 'practice' ? (
                      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5z" /><path d="M8 7h6M8 11h6" /></svg>
                    ) : (
                      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></svg>
                    )}
                  </span>
                  <span className="font-brand text-[20px] font-semibold text-paper">{m.title}</span>
                  <span className="text-sm font-semibold leading-6 text-paper-dim">{m.text}</span>
                  <span className="mt-auto flex flex-wrap gap-1.5 text-xs font-extrabold">
                    <span className="rounded-lg bg-panel-2 px-2 py-1 text-paper-dim">{m.key === 'exam' ? `${minutes} minutes` : 'No time limit'}</span>
                    <span className="rounded-lg bg-panel-2 px-2 py-1 text-paper-dim">{questionCount} questions</span>
                  </span>
                  <span className={`mt-1 grid h-11 place-items-center rounded-[14px] text-sm font-extrabold text-white ${m.btn}`}>Start {m.title.toLowerCase()}</span>
                </button>
              ))}
            </div>
          )}

          <AttemptHistory attempts={attempts} />
        </div>
      )}

      {phase === 'result' && data && (
        <TestResult
          data={data}
          attempts={attempts}
          result={result}
          onAgain={() => setPhase('pick')}
          onClose={onClose}
        />
      )}
    </TaskShell>
  )
}

function AttemptHistory({ attempts }) {
  const done = attempts.filter((a) => a.submitted_at)
  if (!done.length) return null
  return (
    <Panel>
      <h3 className="mb-3 font-brand text-[17px] font-semibold text-paper">Your tries</h3>
      <div className="flex flex-col gap-2">
        {done.map((a) => {
          const pct = percentOf(a)
          const tone = gradeTone(pct)
          return (
            <div key={a.id} className="flex items-center gap-3 rounded-[14px] bg-panel-2/70 px-3 py-2.5">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl font-brand text-[14px] font-bold ${tone.bg} ${tone.text}`}>{pct ?? '✓'}{pct != null && <span className="text-[10px]">%</span>}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-paper">{gradeLabel(a)}</p>
                <p className="text-xs font-bold text-mist">
                  {new Date(a.submitted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {a.mode === 'exam' ? 'Real exam' : 'Practice'}
                  {a.late ? ' · late' : ''}
                </p>
              </div>
              {a.attempt_no === 1 && <span className="rounded-lg bg-saffron/20 px-2 py-1 text-[11px] font-extrabold text-amber">Counts</span>}
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function TestResult({ data, attempts, result, onAgain, onClose }) {
  const latest = [...attempts].filter((a) => a.submitted_at).pop()
  const score = result?.score ?? latest?.score ?? 0
  const max = result?.maxScore ?? latest?.max_score ?? 0
  const band = result?.band ?? latest?.band ?? null
  const rows = result?.results || latest?.results || []
  const isFirst = (latest?.attempt_no || 1) === 1
  const pct = max ? Math.round((score / max) * 100) : 0
  const [showPassage, setShowPassage] = useState(false)

  const byId = useMemo(() => {
    const map = {}
    rows.forEach((r) => {
      map[r.question_id] = r
    })
    return map
  }, [rows])

  let n = 0
  const parts = data.sections.map((s) => ({
    section: s,
    questions: s.questions.map((q) => {
      n += 1
      return { q, n, r: byId[q.id] }
    }),
  }))
  const wrongCount = rows.filter((r) => !r.is_correct).length

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col items-center gap-5 sm:flex-row">
        {band != null ? <BandRing value={Number(band).toFixed(1)} /> : <BandRing value={`${pct}%`} max={100} label="score" tone="#1a9bb5" />}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="font-brand text-[22px] font-semibold text-paper">
            {pct >= 80 ? 'Excellent work!' : pct >= 60 ? 'Good result' : 'Keep practising'}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: `${score}/${max}`, l: 'correct', c: 'bg-reading-tint text-reading' },
              { v: wrongCount, l: 'to learn', c: 'bg-urgent-tint text-coral' },
              { v: isFirst ? '1st' : `#${latest?.attempt_no}`, l: isFirst ? 'try — counts' : 'retake', c: 'bg-[color-mix(in_srgb,var(--color-saffron)_18%,var(--color-panel))] text-amber' },
            ].map((t) => (
              <div key={t.l} className={`rounded-[14px] px-3 py-2.5 ${t.c}`}>
                <div className="font-brand text-[20px] font-semibold leading-none">{t.v}</div>
                <div className="mt-1 text-[12px] font-extrabold text-paper-dim">{t.l}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onAgain} className="focus-ring h-11 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] hover:brightness-105">
              Try again
            </button>
            {data.exam.module === 'reading' && (
              <button type="button" onClick={() => setShowPassage((v) => !v)} className="focus-ring h-11 rounded-[14px] border border-line bg-panel px-4 text-sm font-extrabold text-paper hover:bg-panel-2">
                {showPassage ? 'Hide the passages' : 'Read the passages again'}
              </button>
            )}
            <button type="button" onClick={onClose} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-extrabold text-mist hover:text-paper">
              Back to homework
            </button>
          </div>
        </div>
      </Panel>

      {showPassage && (
        <WordLookupArea source={data.exam.title}>
          <Panel className="flex flex-col gap-5">
            <p className="rounded-[14px] bg-vocab-tint px-3 py-2 text-sm font-bold text-vocab">Double-click any word to see its meaning and save it.</p>
            {data.sections.map((s) => (
              <div key={s.id}>
                <h4 className="mb-2 font-brand text-[16px] font-semibold text-paper">{s.title}</h4>
                <p className="whitespace-pre-wrap text-[15px] leading-7 text-paper">{s.passage_text}</p>
              </div>
            ))}
          </Panel>
        </WordLookupArea>
      )}

      {parts.map(({ section, questions }) => (
        <Panel key={section.id}>
          <h3 className="mb-3 font-brand text-[17px] font-semibold text-paper">{section.title}</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {questions.map(({ q, n: num, r }) => {
              const ok = r?.is_correct
              return (
                <div key={q.id} className={`flex items-start gap-3 rounded-[14px] px-3 py-2.5 ${ok ? 'bg-reading-tint/60' : 'bg-urgent-tint/60'}`}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[13px] font-extrabold text-white ${ok ? 'bg-reading' : 'bg-coral'}`}>{num}</span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-extrabold text-paper">
                      {r?.answer ? r.answer : <span className="text-mist">No answer</span>}
                    </p>
                    {!ok && r && (
                      <p className="font-bold text-reading">
                        Right answer: <span className="text-paper">{String(r.correct_answer || '').split('|').join(' / ')}</span>
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 text-[13px] font-extrabold ${ok ? 'text-reading' : 'text-coral'}`}>{ok ? '✓' : '✗'}</span>
                </div>
              )
            })}
          </div>
        </Panel>
      ))}
    </div>
  )
}
