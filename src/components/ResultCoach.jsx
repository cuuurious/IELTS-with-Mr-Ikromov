import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatBand } from '../lib/ieltsBands'
import { COMMENT_CATEGORIES } from './writing/EssayAnnotator'
import { SPEAKING_CATEGORIES } from './SpeakingComments'
import { SkillIcon } from './SkillArt'

/*
 * RESULTS THAT TEACH (2026-10-16) — Jasur picked "results that teach"
 * from the list of next improvements. Under the student's released
 * bands this says, skill by skill, what went wrong most often and what
 * to practise next:
 *   - Listening / Reading: accuracy per question type in the latest
 *     released attempt (get_mock_answer_breakdown — students only get
 *     rows for released attempts);
 *   - Writing / Speaking: how many examiner comments of each kind
 *     (grammar, vocabulary…) on the latest released essay / exam, with
 *     one real example;
 *   - "Practise next": the skills furthest below the target first.
 * Everything here is read-only and only uses released results.
 */

const QUESTION_TYPES = {
  multiple_choice: {
    label: 'Multiple choice',
    tip: 'Underline the key words in the question, then find the part of the text that answers it before you look at the options. Wrong options often repeat words from the text.',
  },
  multi_select: {
    label: 'Choose two or three answers',
    tip: 'Treat each option as its own true/false check against the text. Don’t stop after finding the first right answer.',
  },
  true_false_ng: {
    label: 'True / False / Not Given',
    tip: 'False means the text says the opposite; Not Given means it doesn’t say. Don’t use your own knowledge, only the passage.',
  },
  yes_no_ng: {
    label: 'Yes / No / Not Given',
    tip: 'Look for the writer’s opinion, not just facts. Words like “claims”, “believes”, “unfortunately” show the writer’s view.',
  },
  matching: {
    label: 'Matching',
    tip: 'Read each paragraph’s main idea first and write it in two or three words. Then match, starting with the ones you are sure about.',
  },
  short_answer: {
    label: 'Gap fill / short answer',
    tip: 'Check the word limit and the grammar of the gap (noun? number? plural?). Copy spelling exactly; one wrong letter loses the mark.',
  },
}

const WRITING_TIPS = {
  grammar: 'Re-read each sentence once for verbs and articles (a/the). Keep sentences you are sure about rather than long risky ones.',
  vocabulary: 'Learn topic collocations (e.g. “tackle a problem”, “a sharp rise”) and use them in your next essay.',
  spelling: 'Make a list of the words marked here and write each one three times. Check them before you hand in.',
  coherence: 'Start each paragraph with one clear main idea, and link ideas with words like “however”, “as a result”, “for example”.',
  task: 'Answer every part of the question. Plan for two minutes: list the parts and tick them off.',
  other: 'Read the examiner’s notes on your essay and rewrite one paragraph using them.',
}

const SPEAKING_TIPS = {
  fluency: 'Practise answering Part 1 questions out loud for 30 seconds without stopping. Fillers like “that’s an interesting question” buy time.',
  vocabulary: 'Prepare 5–6 topic words for common topics (home, work, travel) and use them in practice answers.',
  grammar: 'Mix tenses on purpose: talk about the past, the present and your plans in the same answer.',
  pronunciation: 'Record yourself and listen back. Work on word stress for long words (deVElopment, eCOnomy).',
  other: 'Listen to your recording with the examiner’s notes and repeat the weak answers.',
}

const SKILL_TONE = {
  listening: 'bg-[#1b3b73] text-white',
  reading: 'bg-[#1e9e9a] text-white',
  writing: 'bg-[#b23a48] text-white',
  speaking: 'bg-[#6a3f99] text-white',
}

function useCoachData({ listeningId, readingId, writingId, speakingId }) {
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    let cancelled = false
    const typeStats = async (attemptId) => {
      if (!attemptId) return null
      const { data, error } = await supabase.rpc('get_mock_answer_breakdown', { p_attempt_id: attemptId })
      if (error || !data?.length) return null
      const by = {}
      for (const row of data) {
        const key = row.question_type || 'short_answer'
        by[key] ||= { key, correct: 0, total: 0 }
        by[key].total += 1
        if (row.is_correct) by[key].correct += 1
      }
      return Object.values(by)
        .filter((t) => t.total >= 2)
        .map((t) => ({ ...t, pct: Math.round((t.correct / t.total) * 100) }))
        .sort((a, b) => a.pct - b.pct)
    }
    const commentStats = async (table, column, id) => {
      if (!id) return null
      const { data, error } = await supabase.from(table).select('category, comment, quote').eq(column, id)
      if (error || !data?.length) return null
      const by = {}
      for (const c of data) {
        if (c.category === 'good') continue
        by[c.category] ||= { key: c.category, count: 0, example: null }
        by[c.category].count += 1
        if (!by[c.category].example && c.comment) by[c.category].example = { quote: c.quote, comment: c.comment }
      }
      return Object.values(by).sort((a, b) => b.count - a.count)
    }

    Promise.all([
      typeStats(listeningId),
      typeStats(readingId),
      commentStats('writing_mock_comments', 'attempt_id', writingId),
      commentStats('speaking_comments', 'slot_id', speakingId),
    ])
      .then(([listening, reading, writing, speaking]) => {
        if (!cancelled) setState({ loading: false, listening, reading, writing, speaking })
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [listeningId, readingId, writingId, speakingId])

  return state
}

export default function ResultCoach({ bands, target, listeningId, readingId, writingId, speakingId }) {
  const data = useCoachData({ listeningId, readingId, writingId, speakingId })
  const t = target != null ? Number(target) : null

  const skills = [
    { key: 'listening', label: 'Listening', band: bands.listening, types: data.listening },
    { key: 'reading', label: 'Reading', band: bands.reading, types: data.reading },
    { key: 'writing', label: 'Writing', band: bands.writing, comments: data.writing, categories: COMMENT_CATEGORIES, tips: WRITING_TIPS },
    { key: 'speaking', label: 'Speaking', band: bands.speaking, comments: data.speaking, categories: SPEAKING_CATEGORIES, tips: SPEAKING_TIPS },
  ].filter((s) => s.band != null)

  if (!skills.length) return null

  // Furthest below the target first (or lowest band when no target).
  const ordered = [...skills].sort((a, b) => (t != null ? t - b.band - (t - a.band) : a.band - b.band))

  const focusFor = (s) => {
    if (s.types?.length) {
      const weak = s.types[0]
      const info = QUESTION_TYPES[weak.key] || { label: weak.key, tip: '' }
      return {
        headline: `${info.label}: ${weak.correct} of ${weak.total} right`,
        detail: s.types.slice(1, 3).map((x) => `${(QUESTION_TYPES[x.key] || { label: x.key }).label} ${x.correct}/${x.total}`).join(' · '),
        tip: info.tip,
      }
    }
    if (s.comments?.length) {
      const top = s.comments[0]
      const label = (s.categories.find((c) => c.key === top.key) || { label: 'Notes' }).label
      return {
        headline: `${label} came up ${top.count} ${top.count === 1 ? 'time' : 'times'}`,
        detail: s.comments
          .slice(1, 3)
          .map((x) => `${(s.categories.find((c) => c.key === x.key) || { label: x.key }).label} ×${x.count}`)
          .join(' · '),
        example: top.example,
        tip: s.tips[top.key] || s.tips.other,
      }
    }
    return null
  }

  return (
    <section aria-labelledby="coach-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="coach-h" className="font-brand text-[20px] font-semibold text-brass">
          What to work on next
        </h2>
        {t != null && <span className="text-[13px] text-mist">Biggest gap to your {formatBand(t)} target first</span>}
      </div>

      {data.loading ? (
        <p className="text-sm text-mist">Looking through your results…</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {ordered.map((s, i) => {
            const focus = focusFor(s)
            const gap = t != null ? t - s.band : null
            return (
              <li key={s.key} className="tile-cut flex flex-col gap-3 bg-panel p-4 sm:flex-row sm:items-start sm:gap-5 sm:p-5">
                <div className={`tile-cut tile-cut-sm flex w-full shrink-0 items-center gap-3 px-3.5 py-3 sm:w-[150px] sm:flex-col sm:items-start sm:gap-1 ${SKILL_TONE[s.key]}`}>
                  <span className="flex items-center gap-1.5 text-[13px] font-bold">
                    <SkillIcon skill={s.key} className="h-4 w-4" />
                    {s.label}
                  </span>
                  <span className="font-brand text-[28px] font-semibold leading-none tabular-nums">{formatBand(s.band)}</span>
                  <span className="ml-auto text-[12px] opacity-85 sm:ml-0">
                    {gap == null ? '' : gap <= 0 ? 'Target reached' : `${formatBand(gap)} to target`}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  {i === 0 && gap != null && gap > 0 && (
                    <p className="mb-1 text-[12px] font-extrabold uppercase tracking-[0.06em] text-urgent">Start here</p>
                  )}
                  {focus ? (
                    <>
                      <p className="text-[16px] font-extrabold leading-snug text-paper">{focus.headline}</p>
                      {focus.detail && <p className="mt-0.5 text-[13px] text-mist">Also: {focus.detail}</p>}
                      {focus.example && (
                        <p className="mt-2 rounded-xl bg-panel-2 px-3 py-2 text-[14px] text-paper-dim">
                          <span className="italic">“{focus.example.quote}”</span> — {focus.example.comment}
                        </p>
                      )}
                      {focus.tip && (
                        <p className="mt-2 text-[14px] leading-relaxed text-paper">
                          <span className="font-bold">Practise: </span>
                          {focus.tip}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-[14px] text-paper-dim">
                      {s.key === 'writing' || s.key === 'speaking'
                        ? 'No examiner comments on this one yet. Read the feedback in your results.'
                        : 'Open your latest attempt below to see each question you missed.'}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
