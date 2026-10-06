import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatBand } from '../lib/ieltsBands'
import { SkillIcon } from './SkillArt'

/*
 * MOCK LIBRARY (2026-10-06) — replaces the plain "Available mocks" list
 * in Take a Test. Idea from multilevelrecord.com's mock library (each
 * mock is a card that tells you what's inside before you start, with
 * "done before" filters); built our own way on our own data.
 *
 * Access rules are unchanged: a mock still needs a teacher-issued code
 * (Jasur, 2026-09-26). Each card shows what is inside the mock (the
 * Reading passage titles, the Listening parts, the start of both Writing
 * tasks), whether this student has already sat it and their released
 * bands, and the same request / use-code / continue actions as before.
 *
 * Kept in the same plain white "candidate check-in" style as the rest
 * of Take a Test, so the whole flow still feels like the real exam.
 */

const GENERIC_TITLE = /^(part|section|passage|reading passage|listening part)\s*\d+\b|^part\s*\d+\s*questions/i

function snippet(text, n = 90) {
  const t = (text || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t
}

function SkillLine({ skill, label, children }) {
  const tone = {
    listening: 'bg-listening-tint text-listening',
    reading: 'bg-reading-tint text-reading',
    writing: 'bg-writing-tint text-writing',
  }[skill]
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`} title={label}>
        <SkillIcon skill={skill} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-slate-700">
        <span className="font-semibold text-slate-900">{label}</span>
        {children}
      </div>
    </div>
  )
}

export default function MockLibrary({
  selfId,
  fullMockSets,
  loading,
  statusForSet,
  unfinishedSetIds = [],
  requestingSetId,
  requestError,
  onRequest,
  onUseCode,
  onContinue,
}) {
  const [details, setDetails] = useState(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const setIdsKey = fullMockSets.map((s) => s.id).join(',')

  useEffect(() => {
    if (!fullMockSets.length) {
      setDetails({ sections: [], writing: [], attempts: [], objective: [], writingResults: [] })
      return
    }
    let cancelled = false
    const objectiveIds = fullMockSets.flatMap((s) => [s.listening_exam_id, s.reading_exam_id]).filter(Boolean)
    const writingIds = fullMockSets.map((s) => s.writing_exam_id).filter(Boolean)

    const load = async () => {
      const [sectionsRes, writingRes, attemptsRes] = await Promise.all([
        objectiveIds.length
          ? supabase.from('mock_sections').select('exam_id, title, order_index').in('exam_id', objectiveIds)
          : { data: [] },
        writingIds.length
          ? supabase.from('writing_mock_exams').select('id, task1_prompt, task2_prompt').in('id', writingIds)
          : { data: [] },
        supabase
          .from('full_mock_attempts')
          .select('id, set_id, stage, started_at, completed_at, listening_attempt_id, reading_attempt_id, writing_attempt_id')
          .eq('student_id', selfId)
          .order('started_at', { ascending: false }),
      ])
      const attempts = attemptsRes.data || []
      const objectiveAttemptIds = attempts.flatMap((a) => [a.listening_attempt_id, a.reading_attempt_id]).filter(Boolean)
      const writingAttemptIds = attempts.map((a) => a.writing_attempt_id).filter(Boolean)
      const [objectiveRes, writingResultsRes] = await Promise.all([
        objectiveAttemptIds.length
          ? supabase.from('mock_attempts').select('id, band, released_at').in('id', objectiveAttemptIds)
          : { data: [] },
        writingAttemptIds.length
          ? supabase.from('writing_mock_attempts').select('id, examiner_band, released_at').in('id', writingAttemptIds)
          : { data: [] },
      ])
      if (cancelled) return
      setDetails({
        sections: sectionsRes.data || [],
        writing: writingRes.data || [],
        attempts,
        objective: objectiveRes.data || [],
        writingResults: writingResultsRes.data || [],
      })
    }
    load().catch(() => {
      if (!cancelled) setDetails({ sections: [], writing: [], attempts: [], objective: [], writingResults: [] })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setIdsKey, selfId])

  const cards = useMemo(() => {
    if (!details) return []
    const sectionsByExam = {}
    for (const s of details.sections) (sectionsByExam[s.exam_id] ||= []).push(s)
    Object.values(sectionsByExam).forEach((list) => list.sort((a, b) => a.order_index - b.order_index))
    const writingById = Object.fromEntries(details.writing.map((w) => [w.id, w]))
    const objectiveById = Object.fromEntries(details.objective.map((o) => [o.id, o]))
    const writingResultById = Object.fromEntries(details.writingResults.map((w) => [w.id, w]))

    return fullMockSets.map((set) => {
      const listening = sectionsByExam[set.listening_exam_id] || []
      const reading = sectionsByExam[set.reading_exam_id] || []
      const writing = writingById[set.writing_exam_id] || null
      const mine = details.attempts.filter((a) => a.set_id === set.id)
      const finished = mine.find((a) => a.stage === 'done' || a.completed_at) || null
      const released = (id, map, key) => {
        const row = id ? map[id] : null
        return row?.released_at && row[key] != null ? Number(row[key]) : null
      }
      const bands = finished
        ? {
            listening: released(finished.listening_attempt_id, objectiveById, 'band'),
            reading: released(finished.reading_attempt_id, objectiveById, 'band'),
            writing: released(finished.writing_attempt_id, writingResultById, 'examiner_band'),
          }
        : null
      const searchText = [
        set.title,
        ...reading.map((r) => r.title),
        ...listening.map((l) => l.title),
        writing?.task1_prompt,
        writing?.task2_prompt,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return { set, listening, reading, writing, finished, bands, inProgress: unfinishedSetIds.includes(set.id), searchText }
    })
  }, [details, fullMockSets, unfinishedSetIds])

  const visible = cards.filter((c) => {
    if (filter === 'todo' && c.finished) return false
    if (filter === 'done' && !c.finished) return false
    const q = query.trim().toLowerCase()
    return !q || c.searchText.includes(q)
  })

  const doneCount = cards.filter((c) => c.finished).length

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">Mock library</h3>
          <p className="mt-1 text-sm text-slate-500">
            {fullMockSets.length} {fullMockSets.length === 1 ? 'mock' : 'mocks'} · you’ve taken {doneCount}
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a topic, e.g. Mars"
          aria-label="Search mocks"
          className="h-10 w-full rounded-lg border border-slate-300 px-3.5 text-sm placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 sm:w-64"
        />
      </div>

      <div role="group" aria-label="Filter mocks" className="mt-4 inline-flex rounded-lg border border-slate-200 p-1">
        {[
          ['all', 'All'],
          ['todo', 'Not taken yet'],
          ['done', 'Done before'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`h-8 rounded-md px-3 text-sm transition-colors ${
              filter === key ? 'bg-slate-900 font-medium text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {requestError && <p className="mt-3 text-sm text-red-600">{requestError}</p>}

      {loading || !details ? (
        <p className="mt-5 text-sm text-slate-400">Loading mocks…</p>
      ) : fullMockSets.length === 0 ? (
        <p className="mt-5 text-sm text-slate-400">Nothing published yet — check back later.</p>
      ) : visible.length === 0 ? (
        <p className="mt-5 text-sm text-slate-400">No mocks match that.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map(({ set, listening, reading, writing, finished, bands, inProgress }) => {
            const status = statusForSet(set.id)
            const topicPassages = reading.filter((r) => r.title && !GENERIC_TITLE.test(r.title.trim()))
            const topicParts = listening.filter((l) => l.title && !GENERIC_TITLE.test(l.title.trim()))
            return (
              <article key={set.id} className="flex flex-col gap-4 rounded-xl border border-slate-200 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-[17px] font-semibold leading-snug">{set.title}</h4>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Added {new Date(set.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  {inProgress ? (
                    <span className="shrink-0 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">In progress</span>
                  ) : finished ? (
                    <span className="shrink-0 rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white">Done before</span>
                  ) : (
                    <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">New for you</span>
                  )}
                </div>

                <div className="flex flex-col gap-2.5">
                  {set.listening_exam_id && (
                    <SkillLine skill="listening" label="Listening">
                      {' · '}
                      {listening.length ? `${listening.length} ${listening.length === 1 ? 'part' : 'parts'}` : '4 parts'}
                      {topicParts.length > 0 && `: ${topicParts.map((p) => p.title).join(', ')}`}
                    </SkillLine>
                  )}
                  {set.reading_exam_id && (
                    <SkillLine skill="reading" label="Reading">
                      {topicPassages.length ? (
                        <ol className="mt-0.5 list-inside list-decimal text-slate-700">
                          {topicPassages.map((p) => (
                            <li key={p.title} className="truncate">{p.title}</li>
                          ))}
                        </ol>
                      ) : (
                        ` · ${reading.length || 3} passages`
                      )}
                    </SkillLine>
                  )}
                  {set.writing_exam_id && (
                    <SkillLine skill="writing" label="Writing">
                      {writing ? (
                        <span className="mt-0.5 block">
                          {writing.task1_prompt && <span className="block truncate">Task 1: {snippet(writing.task1_prompt, 70)}</span>}
                          {writing.task2_prompt && <span className="block truncate">Task 2: {snippet(writing.task2_prompt, 70)}</span>}
                        </span>
                      ) : (
                        ' · Task 1 and Task 2'
                      )}
                    </SkillLine>
                  )}
                </div>

                {finished && (
                  <div className="rounded-lg bg-slate-50 px-3.5 py-2.5 text-sm">
                    <p className="text-slate-500">
                      You took it on{' '}
                      {new Date(finished.completed_at || finished.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                    {bands && Object.values(bands).some((b) => b != null) ? (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {[
                          ['listening', 'L'],
                          ['reading', 'R'],
                          ['writing', 'W'],
                        ].map(([k, short]) =>
                          bands[k] != null ? (
                            <span key={k} className="rounded-md bg-white px-2 py-0.5 font-semibold ring-1 ring-slate-200">
                              {short} {formatBand(bands[k])}
                            </span>
                          ) : null
                        )}
                      </div>
                    ) : (
                      <p className="mt-0.5 font-medium text-slate-700">Results not released yet</p>
                    )}
                  </div>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  {inProgress ? (
                    <button
                      type="button"
                      onClick={() => onContinue(set.id)}
                      className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                    >
                      Continue →
                    </button>
                  ) : status.kind === 'has-code' ? (
                    <>
                      <span className="font-mono text-sm font-semibold tracking-wide">{status.code.code}</span>
                      <button
                        type="button"
                        onClick={() => onUseCode(status.code.code)}
                        className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                      >
                        Use this code
                      </button>
                    </>
                  ) : status.kind === 'pending' ? (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
                      Requested — waiting on your teacher
                    </span>
                  ) : (
                    <>
                      {status.kind === 'rejected' && <span className="text-xs text-slate-400">Not approved last time —</span>}
                      <button
                        type="button"
                        onClick={() => onRequest(set.id)}
                        disabled={requestingSetId === set.id}
                        className="rounded-full border border-slate-900 px-4 py-2 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {requestingSetId === set.id
                          ? 'Requesting…'
                          : status.kind === 'rejected'
                            ? 'Request again'
                            : finished
                              ? 'Request a retake'
                              : 'Request access'}
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
