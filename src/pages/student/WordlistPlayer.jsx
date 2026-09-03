import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

function shuffle(arr) {
  const a = [...arr]

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    )

    ;[a[i], a[j]] = [a[j], a[i]]
  }

  return a
}

function decodeHtmlEntities(value) {
  if (!value) return ''

  const textarea =
    document.createElement('textarea')

  textarea.innerHTML = value

  return textarea.value
}

function buildQuestions(items) {  
	return shuffle(items).map((item) => {
    		const distractorPool = items.filter(
      (it) => it.id !== item.id
    )

    const correctTranslation =
      item.uzbek_translation || ''

    const distractors = shuffle(
      distractorPool
    )
      .map(
        (it) =>
          it.uzbek_translation || ''
      )
      .filter(Boolean)
      .slice(0, 3)

    const options = shuffle([
      correctTranslation,
      ...distractors,
    ])

    return {
      word: item.word,
      correctAnswer: correctTranslation,
      options,
    }
  })
}
function categoryFor(percentage) {
  if (percentage >= 90) return { label: 'Excellent!', tone: 'sage', note: 'Outstanding recall — these words are locked in.' }
  if (percentage >= 70) return { label: 'Good job', tone: 'brass', note: 'Solid work. A quick review of the missed ones will make it perfect.' }
  return { label: 'Keep practicing', tone: 'coral', note: "Don't worry — review the list again and try once more." }
}

export default function WordlistPlayer({ wordlist, studentId, onExit }) {
  const [items, setItems] = useState(null)
  const [mode, setMode] = useState('study') // 'study' | 'quiz' | 'results'
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const [questions, setQuestions] = useState([])
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState([])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    supabase
      .from('wordlist_items')
      .select('*')
      .eq('wordlist_id', wordlist.id)
      .order('position')
      .then(({ data }) => setItems(data || []))
  }, [wordlist.id])

  const startQuiz = () => {
    setQuestions(buildQuestions(items))
    setQIndex(0)
    setDetail([])
    setSelected(null)
    setMode('quiz')
  }

  const answer = (option) => {
    if (selected) return
    setSelected(option)
    const q = questions[qIndex]
    const isCorrect = option === q.correctAnswer
    const newDetail = [...detail, { word: q.word, correct: q.correctAnswer, chosen: option, isCorrect }]
    setDetail(newDetail)

    setTimeout(async () => {
      if (qIndex + 1 < questions.length) {
        setQIndex((i) => i + 1)
        setSelected(null)
      } else {
        const score = newDetail.filter((d) => d.isCorrect).length
        const total = newDetail.length
        const percentage = Math.round((score / total) * 100)
        setSaving(true)
        await supabase.from('wordlist_attempts').insert({
          wordlist_id: wordlist.id,
          student_id: studentId,
          score,
          total,
          percentage,
          detail: newDetail,
        })
        setSaving(false)
        setResult({ score, total, percentage, detail: newDetail })
        setMode('results')
      }
    }, 600)
  }

  const category = result ? categoryFor(result.percentage) : null

  if (!items) return <p className="text-mist">Loading…</p>

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4 items-center text-center">
        <div className="w-full flex items-center justify-between">
          <button onClick={onExit} className="focus-ring text-mist hover:text-paper text-sm">
            ← Back
          </button>
        </div>
        <p className="text-mist">This word list doesn't have any words in it yet.</p>
      </div>
    )
  }

  if (mode === 'study') {
    const item = items[cardIndex]
    return (
      <div className="flex flex-col gap-4 items-center">
        <div className="w-full flex items-center justify-between">
          <button onClick={onExit} className="focus-ring text-mist hover:text-paper text-sm">
            ← Back
          </button>
          <span className="text-mist text-xs font-mono">
            {cardIndex + 1} / {items.length}
          </span>
        </div>

        <button
          onClick={() => setFlipped((f) => !f)}
          className="focus-ring ticket rounded-xl w-full max-w-sm h-64 flex flex-col items-center justify-center gap-3 p-6 text-center"
        >
          {!flipped ? (
            <span className="font-display text-3xl">{item.word}</span>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-paper">{item.definition}</p>
              <p className="text-brass font-medium">{item.uzbek_translation}</p>
              <p className="text-mist text-sm italic">"{item.example_sentence}"</p>
            </div>
          )}
          <span className="text-mist text-xs font-mono mt-2">tap to {flipped ? 'see word' : 'reveal'}</span>
        </button>

        <div className="flex gap-3">
          <button
            onClick={() => {
              setCardIndex((i) => Math.max(0, i - 1))
              setFlipped(false)
            }}
            disabled={cardIndex === 0}
            className="focus-ring px-4 py-2 rounded-md border border-line text-sm disabled:opacity-30"
          >
            Previous
          </button>
          {cardIndex + 1 < items.length ? (
            <button
              onClick={() => {
                setCardIndex((i) => i + 1)
                setFlipped(false)
              }}
              className="focus-ring px-4 py-2 rounded-md border border-line text-sm hover:border-brass hover:text-brass"
            >
              Next
            </button>
          ) : (
            <button
              onClick={startQuiz}
              className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium"
            >
              I'm ready — start the test

            </button>
          )}
        </div>
      </div>
    )
  }

  if (mode === 'quiz') {
    const q = questions[qIndex]
    return (
      <div className="flex flex-col gap-4 items-center">
        <span className="text-mist text-xs font-mono">
          Question {qIndex + 1} / {questions.length}
        </span>
        <div className="ticket rounded-xl w-full max-w-sm p-6 flex flex-col gap-4">
          <p className="text-mist text-sm">What does this mean?</p>
         <p className="font-display text-2xl text-center">
  {decodeHtmlEntities(q.word)}
</p>
          <div className="flex flex-col gap-2">
            {q.options.map((opt, i) => {
              const isCorrect = opt === q.correctAnswer
              const isChosen = opt === selected
              let style = 'border-line hover:border-brass'
              if (selected) {
                if (isCorrect) style = 'border-sage text-sage'
                else if (isChosen) style = 'border-coral text-coral'
                else style = 'border-line opacity-50'
              }
              return (
                <button
                  key={i}
                  onClick={() => answer(opt)}
                  disabled={!!selected}
                  className={`focus-ring text-left px-3 py-2 rounded-md border text-sm transition-colors ${style}`}
                >
                  {decodeHtmlEntities(opt)}
                </button>
              )
            })}
          </div>
        </div>
        {saving && <p className="text-mist text-xs font-mono">saving result…</p>}
      </div>
    )
  }

  // results
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="ticket rounded-lg p-6 max-w-sm w-full flex flex-col gap-4 text-center">
        <span className={`stamp stamp-${category.tone === 'sage' ? 'done' : category.tone === 'coral' ? 'overdue' : 'pending'} w-20 h-20 mx-auto text-xs`}>
          {result.percentage}%
        </span>
        <h2 className="font-display text-2xl">{category.label}</h2>
        <p className="text-mist text-sm">{category.note}</p>
        <p className="text-sm">
          {result.score} / {result.total} correct
        </p>

        {result.detail.some((d) => !d.isCorrect) && (
          <div className="text-left bg-panel-2 border border-line rounded-md p-3 max-h-40 overflow-y-auto">
            <div className="text-xs uppercase tracking-wide text-mist font-mono mb-2">
              Words to review
            </div>
            {result.detail
              .filter((d) => !d.isCorrect)
              .map((d, i) => (
                <div key={i} className="text-sm mb-1">
                  <span className="font-medium">{d.word}</span>
                  <span className="text-mist"> — {decodeHtmlEntities(d.correct)}</span>
                </div>
              ))}
          </div>
        )}

        <button
          onClick={onExit}
          className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium"
        >
          Close
        </button>
      </div>
    </div>
  )
}
