import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

/*
 * SPEAKING COMMENTS (2026-10-16) — Jasur: "comment on speaking too".
 * The speaking version of the essay highlights: each comment is tied to
 * a moment in the recording (mm:ss) and/or a part of the test, with a
 * category. The speaking examiner and the teacher add/edit/delete; the
 * student reads them once the result is released.
 *
 * If the recording link is a direct audio/video file, it plays here:
 * "Use current time" fills in the moment, and clicking a comment's time
 * jumps the player there. Otherwise (a Google Drive / Zoom link) the
 * time is typed in and the link opens in a new tab.
 */

export const SPEAKING_CATEGORIES = [
  { key: 'fluency', label: 'Fluency', chip: 'bg-listening-tint text-listening' },
  { key: 'vocabulary', label: 'Vocabulary', chip: 'bg-vocab-tint text-vocab' },
  { key: 'grammar', label: 'Grammar', chip: 'bg-urgent-tint text-urgent' },
  { key: 'pronunciation', label: 'Pronunciation', chip: 'bg-speaking-tint text-speaking' },
  { key: 'good', label: 'Well done', chip: 'bg-reading-tint text-reading' },
  { key: 'other', label: 'Note', chip: 'bg-panel-2 text-paper' },
]
const catOf = (k) => SPEAKING_CATEGORIES.find((c) => c.key === k) || SPEAKING_CATEGORIES[SPEAKING_CATEGORIES.length - 1]

const PLAYABLE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|mp4|mov)(\?|#|$)/i
export const isPlayable = (url) => Boolean(url) && (PLAYABLE.test(url) || /\/storage\/v1\/object\//.test(url))

export function formatTime(sec) {
  if (sec == null || Number.isNaN(sec)) return ''
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// "2:15", "02:15", "135" → seconds; '' → null; anything else → NaN.
export function parseTime(text) {
  const t = String(text || '').trim()
  if (!t) return null
  if (/^\d+$/.test(t)) return Number(t)
  const m = /^(\d{1,3}):([0-5]?\d)$/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

function sortComments(list) {
  return [...list].sort((a, b) => {
    const pa = a.part ?? 9
    const pb = b.part ?? 9
    if (a.at_seconds != null && b.at_seconds != null) return a.at_seconds - b.at_seconds
    if (pa !== pb) return pa - pb
    return new Date(a.created_at) - new Date(b.created_at)
  })
}

export default function SpeakingComments({ slot, editable = false, showAuthors = true }) {
  const { profile } = useAuth()
  const audioRef = useRef(null)
  const [comments, setComments] = useState([])
  const [people, setPeople] = useState({})
  const [status, setStatus] = useState({ loading: true, error: '' })

  const [part, setPart] = useState('')
  const [time, setTime] = useState('')
  const [category, setCategory] = useState('fluency')
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    if (!slot?.id) return
    let cancelled = false
    supabase
      .from('speaking_comments')
      .select('*')
      .eq('slot_id', slot.id)
      .then(async ({ data, error }) => {
        if (cancelled) return
        if (error) {
          setStatus({ loading: false, error: 'Comments could not be loaded.' })
          return
        }
        const ids = [...new Set((data || []).map((c) => c.author_id).filter(Boolean))]
        if (ids.length && showAuthors) {
          const { data: ps } = await supabase.from('profiles').select('id, full_name, username').in('id', ids)
          if (cancelled) return
          const map = {}
          ;(ps || []).forEach((p) => { map[p.id] = p })
          setPeople(map)
        }
        setComments(data || [])
        setStatus({ loading: false, error: '' })
      })
    return () => {
      cancelled = true
    }
  }, [slot?.id, showAuthors])

  const playable = isPlayable(slot?.recording_url)

  const seek = (sec) => {
    const a = audioRef.current
    if (!a || sec == null) return
    a.currentTime = sec
    a.play().catch(() => {})
  }

  const add = async () => {
    const seconds = parseTime(time)
    if (Number.isNaN(seconds)) {
      setAddError('Write the time as minutes:seconds, e.g. 2:15.')
      return
    }
    if (!text.trim()) {
      setAddError('Write the comment first.')
      return
    }
    setAdding(true)
    setAddError('')
    const { data, error } = await supabase
      .from('speaking_comments')
      .insert({ slot_id: slot.id, part: part ? Number(part) : null, at_seconds: seconds, category, comment: text.trim(), author_id: profile.id })
      .select('*')
      .single()
    setAdding(false)
    if (error) {
      setAddError(error.message || 'Could not save this comment.')
      return
    }
    setComments((prev) => [...prev, data])
    setPeople((prev) => (prev[profile.id] ? prev : { ...prev, [profile.id]: profile }))
    setText('')
    setTime('')
  }

  const update = async (id, patch) => {
    const { data, error } = await supabase.from('speaking_comments').update(patch).eq('id', id).select('*').single()
    if (error) throw error
    setComments((prev) => prev.map((c) => (c.id === id ? data : c)))
  }

  const remove = async (id) => {
    const { error } = await supabase.from('speaking_comments').delete().eq('id', id)
    if (error) throw error
    setComments((prev) => prev.filter((c) => c.id !== id))
  }

  const sorted = sortComments(comments)

  return (
    <section className="flex flex-col gap-3" aria-label="Speaking comments">
      {slot?.recording_url &&
        (playable ? (
          <audio ref={audioRef} src={slot.recording_url} controls preload="metadata" className="w-full" />
        ) : (
          <a href={slot.recording_url} target="_blank" rel="noopener noreferrer" className="w-fit text-sm font-medium text-paper underline-offset-2 hover:underline">
            Open the recording ↗
          </a>
        ))}

      <div className="flex items-baseline justify-between">
        <h4 className="text-[15px] font-semibold text-paper">Comments {sorted.length > 0 && <span className="font-normal text-mist">{sorted.length}</span>}</h4>
      </div>

      {status.loading ? (
        <p className="text-sm text-mist">Loading comments…</p>
      ) : status.error ? (
        <p className="text-sm text-urgent">{status.error}</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-mist">{editable ? 'No comments yet. Add the first one below.' : 'No comments on this exam.'}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {sorted.map((c) => (
            <SpeakingCommentRow
              key={c.id}
              comment={c}
              author={showAuthors ? people[c.author_id] : null}
              editable={editable}
              playable={playable}
              onSeek={() => seek(c.at_seconds)}
              onUpdate={(patch) => update(c.id, patch)}
              onDelete={() => remove(c.id)}
            />
          ))}
        </ol>
      )}

      {editable && (
        <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-panel-2/60 p-3.5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-mist">
              Part
              <select
                value={part}
                onChange={(e) => setPart(e.target.value)}
                className="focus-ring h-9 rounded-lg border border-line bg-panel px-2 text-sm text-paper"
              >
                <option value="">Any</option>
                <option value="1">Part 1</option>
                <option value="2">Part 2</option>
                <option value="3">Part 3</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-mist">
              Time
              <input
                value={time}
                onChange={(e) => setTime(e.target.value)}
                placeholder="2:15"
                inputMode="numeric"
                className="focus-ring h-9 w-20 rounded-lg border border-line bg-panel px-2 text-sm tabular-nums text-paper"
              />
            </label>
            {playable && (
              <button
                type="button"
                onClick={() => setTime(formatTime(audioRef.current?.currentTime || 0))}
                className="focus-ring h-9 rounded-lg border border-line px-2.5 text-[13px] font-medium text-paper hover:border-paper/30"
              >
                Use current time
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
            {SPEAKING_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={category === c.key}
                onClick={() => setCategory(c.key)}
                className={`focus-ring rounded-full px-2.5 py-1 text-[12px] font-semibold ${c.chip} ${category === c.key ? 'ring-2 ring-paper/70' : 'opacity-70 hover:opacity-100'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Long pause before answering; try a filler like “That’s an interesting question…”"
            className="focus-ring w-full resize-none rounded-lg border border-line bg-panel px-3 py-2 text-sm text-paper"
            aria-label="Comment"
          />
          {addError && <p className="text-[13px] text-urgent">{addError}</p>}
          <button
            type="button"
            onClick={add}
            disabled={adding}
            className="focus-ring self-end rounded-full bg-brass px-4 py-1.5 text-sm font-semibold text-onbrass hover:bg-brass-dim disabled:opacity-50"
          >
            {adding ? 'Saving…' : 'Add comment'}
          </button>
        </div>
      )}
    </section>
  )
}

function SpeakingCommentRow({ comment, author, editable, playable, onSeek, onUpdate, onDelete }) {
  const cat = catOf(comment.category)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(comment.comment)
  const [category, setCategory] = useState(comment.category)
  const [askDelete, setAskDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err?.message || 'That didn’t work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const stamp = [comment.part ? `Part ${comment.part}` : null, comment.at_seconds != null ? formatTime(comment.at_seconds) : null].filter(Boolean).join(' · ')

  return (
    <li className="rounded-2xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        {stamp &&
          (playable && comment.at_seconds != null ? (
            <button
              type="button"
              onClick={onSeek}
              className="focus-ring inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold tabular-nums text-panel"
              title="Play from here"
            >
              ▶ {stamp}
            </button>
          ) : (
            <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-paper">{stamp}</span>
          ))}
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cat.chip}`}>{cat.label}</span>
        {author && <span className="ml-auto truncate text-[11px] text-mist">{author.full_name || author.username}</span>}
      </div>

      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="focus-ring rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-sm text-paper"
            aria-label="Category"
          >
            {SPEAKING_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="focus-ring w-full resize-none rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-sm text-paper"
            aria-label="Comment"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="focus-ring text-[13px] text-mist hover:text-paper">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await onUpdate({ comment: text.trim(), category })
                  setEditing(false)
                })
              }
              className="focus-ring rounded-full bg-brass px-3 py-1 text-[13px] font-semibold text-onbrass disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-paper">{comment.comment}</p>
      )}

      {editable && !editing && (
        <div className="mt-2 flex items-center gap-3 text-[12px]">
          {askDelete ? (
            <>
              <span className="text-urgent">Delete this comment?</span>
              <button type="button" disabled={busy} onClick={() => run(onDelete)} className="focus-ring font-semibold text-urgent underline">
                Delete
              </button>
              <button type="button" onClick={() => setAskDelete(false)} className="focus-ring text-mist hover:text-paper">
                Keep
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setText(comment.comment)
                  setCategory(comment.category)
                  setEditing(true)
                }}
                className="focus-ring font-medium text-paper-dim hover:text-paper"
              >
                Edit
              </button>
              <button type="button" onClick={() => setAskDelete(true)} className="focus-ring font-medium text-paper-dim hover:text-urgent">
                Delete
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-[12px] text-urgent">{error}</p>}
    </li>
  )
}
