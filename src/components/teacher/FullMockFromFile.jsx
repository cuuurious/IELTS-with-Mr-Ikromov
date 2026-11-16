import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { useFileDrop, DropOverlay } from '../../lib/useFileDrop'
import { parseFullMock, saveFullMock } from '../../lib/fullMockImport'
import { dataUrlToBlob } from '../../lib/mockHtmlImport'

/*
 * WHOLE FULL MOCKS FROM "Full Mock Test N" FILES (2026-11-16).
 * Drop one file or many. Each file becomes one full mock in the Mock Centre:
 * Listening (one continuous recording), Reading with its explanations and
 * Writing, built into the real exam screen. Nothing is saved until Build.
 */

const readText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result || ''))
    r.onerror = () => rej(r.error)
    r.readAsText(file)
  })

function Tick({ ok, warn, children }) {
  return (
    <li className={`flex items-start gap-2 text-[13px] font-semibold ${ok ? 'text-paper' : warn ? 'text-paper-dim' : 'text-coral'}`}>
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-extrabold ${ok ? 'bg-reading text-white' : warn ? 'bg-saffron text-[#17213a]' : 'bg-coral text-white'}`}>{ok ? '✓' : '!'}</span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function Item({ it, onName, onInclude }) {
  const [open, setOpen] = useState(false)
  const p = it.parsed
  return (
    <section className="rounded-[20px] border border-line bg-panel-2/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          checked={it.include}
          disabled={!p || p.problems.length > 0 || !!it.done}
          onChange={(e) => onInclude(e.target.checked)}
          className="h-4 w-4"
          aria-label="Include this mock"
        />
        <input
          value={it.name}
          onChange={(e) => onName(e.target.value)}
          disabled={!p || !!it.done}
          className="focus-ring h-10 min-w-0 flex-1 rounded-[12px] border border-line bg-panel px-3 text-[15px] font-semibold text-paper"
          aria-label="Name of the full mock"
        />
        <span className="text-[12px] font-semibold text-mist">{it.file.name.slice(0, 40)}</span>
      </div>
      {it.status === 'reading' && <p className="mt-2 text-sm font-semibold text-mist">Reading the file…</p>}
      {it.error && <p className="mt-2 rounded-[12px] bg-urgent-tint px-3 py-2 text-sm font-bold text-coral">{it.error}</p>}
      {it.done && <p className="mt-2 text-sm font-extrabold text-reading">✓ Built. It is now in the Mock Centre.</p>}
      {it.building && <p className="mt-2 text-sm font-semibold text-brass">{it.building}</p>}
      {p && (
        <>
          <ul className="mt-3 flex flex-col gap-1.5">
            <Tick ok={p.listening.count === 40}>
              Listening: {p.listening.count} questions, {p.listening.hasTranscript ? 'with transcript' : 'no transcript'}, one recording ({p.audioMb} MB)
            </Tick>
            <Tick ok={p.reading.count === 40}>Reading: {p.reading.count} questions in {p.reading.sections.length} passages, with explanations</Tick>
            <Tick ok={!!p.writing.task1_prompt && !!p.writing.task2_prompt}>
              Writing: Task 1 {p.writing.task1_image ? 'with picture' : 'without picture'} and Task 2 ({p.writing.minutes} minutes)
            </Tick>
            {it.duplicate && (
              <Tick warn>A full mock called “{it.name}” is already on the site. Tick the box only if you want a second copy.</Tick>
            )}
            {p.problems.map((x, i) => (
              <Tick key={`p${i}`}>{x}</Tick>
            ))}
            {p.warnings.map((x, i) => (
              <Tick key={`w${i}`} warn>
                {x}
              </Tick>
            ))}
          </ul>
          <button type="button" onClick={() => setOpen((v) => !v)} className="focus-ring mt-2 text-[12px] font-extrabold text-brass">
            {open ? 'Hide what was read' : 'Show what was read'}
          </button>
          {open && (
            <div className="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
              {[p.listening, p.reading].map((part) =>
                part.sections.map((s, si) => (
                  <div key={`${part.module}${si}`}>
                    <p className="text-[12px] font-extrabold uppercase tracking-wide text-mist">
                      {part.module} · {s.title}
                    </p>
                    {s.groups.map((g, gi) => (
                      <div key={gi} className="mt-1 rounded-[12px] bg-panel px-3 py-2 text-[12px] font-semibold text-paper-dim">
                        <p className="font-extrabold text-paper">
                          Questions {g.questions[0]?.number}–{g.questions[g.questions.length - 1]?.number + (g.questions[g.questions.length - 1]?.width || 1) - 1} · {g.kind.replace(/_/g, ' ')}
                          {g.image ? ' · picture' : ''}
                        </p>
                        {g.questions.map((q) => (
                          <p key={q.number} className="truncate">
                            {q.number}. {q.prompt || '—'} → <b className="text-reading">{q.correct_answer || '?'}</b>
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default function FullMockFromFile({ profileId, onClose, onDone, onBack }) {
  const [items, setItems] = useState([])
  const [existing, setExisting] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef(null)
  const idRef = useRef(0)
  const { isDragging, dropProps } = useFileDrop({ onFiles: (f) => addFiles(f), accept: '.html,.htm' })

  useEffect(() => {
    supabase
      .from('full_mock_sets')
      .select('title')
      .then(({ data }) => setExisting((data || []).map((r) => String(r.title || '').trim().toLowerCase())))
  }, [])

  const patch = (id, change) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...change } : x)))

  async function addFiles(files) {
    setError('')
    const htmls = files.filter((f) => /\.html?$/i.test(f.name))
    if (!htmls.length) return setError('Drop the “Full Mock Test” .html files.')
    for (const file of htmls) {
      const id = ++idRef.current
      setItems((l) => [...l, { id, file, status: 'reading', name: file.name.replace(/\.html?$/i, '').replace(/\s*-\s*Mr\.?Ikromov.*$/i, ''), include: false }])
      try {
        const parsed = await parseFullMock(await readText(file))
        if (parsed.error) {
          patch(id, { status: 'error', error: `${file.name}: ${parsed.error}` })
          continue
        }
        // Keep the recording as a Blob, not a 20 MB string, so many files fit in memory.
        parsed.audioBlob = parsed.audio ? dataUrlToBlob(parsed.audio) : null
        parsed.audioMb = parsed.audioBlob ? Math.round((parsed.audioBlob.size / 1048576) * 10) / 10 : 0
        parsed.audio = ''
        parsed.listening.audio = ''
        const duplicate = existing.includes(parsed.title.trim().toLowerCase())
        patch(id, { status: 'ready', parsed, name: parsed.title, duplicate, include: parsed.problems.length === 0 && !duplicate })
      } catch (e) {
        patch(id, { status: 'error', error: `${file.name}: ${e?.message || 'could not be read.'}` })
      }
    }
  }

  const ready = items.filter((x) => x.include && x.parsed && !x.done)
  const reading = items.some((x) => x.status === 'reading')

  const build = async () => {
    setBusy(true)
    setError('')
    let anyDone = false
    for (const it of ready) {
      try {
        const out = await saveFullMock(supabase, { parsed: it.parsed, userId: profileId, title: it.name.trim() || it.parsed.title, active: true, onStep: (s) => patch(it.id, { building: s }) })
        patch(it.id, { done: true, building: '', include: false, extras: out.extras })
        anyDone = true
      } catch (e) {
        patch(it.id, { building: '', error: `Nothing was saved for this one: ${e?.message || 'unknown error'}` })
      }
    }
    setBusy(false)
    if (anyDone) onDone?.()
  }

  const noExtras = items.some((x) => x.done && x.extras === false)

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Add full mocks from files">
      <div className="flex max-h-[96vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] bg-panel shadow-xl sm:rounded-[28px]">
        <div className="registan-band shrink-0 px-5 py-4 text-white">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Full mocks · from “Full Mock Test” files</p>
          <p className="font-brand text-[20px] font-semibold">Drop the files, check, build</p>
          <p className="text-[13px] font-semibold text-white/85">Each file becomes one full mock: Listening, Reading and Writing in the real exam screen. Nothing is saved until you press Build.</p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-5">
          <div {...dropProps} className="relative">
            <button type="button" onClick={() => ref.current?.click()} className="focus-ring flex w-full flex-col items-center justify-center gap-1 rounded-[16px] border-2 border-dashed border-line px-4 py-6 text-center hover:border-brass hover:bg-panel-2/50">
              <span className="text-sm font-extrabold text-brass">{reading ? 'Reading…' : 'Drop one or more “Full Mock Test” files here'}</span>
              <span className="text-[12px] font-semibold text-mist">The files are big (about 25 MB each), so reading takes a few seconds per file.</span>
            </button>
            <input
              ref={ref}
              type="file"
              multiple
              accept=".html,.htm"
              className="hidden"
              onChange={(e) => {
                addFiles([...(e.target.files || [])])
                e.target.value = ''
              }}
            />
            <DropOverlay show={isDragging} label="Drop here" />
          </div>

          {items.map((it) => (
            <Item key={it.id} it={it} onName={(name) => patch(it.id, { name })} onInclude={(include) => patch(it.id, { include })} />
          ))}
          {noExtras && (
            <p className="rounded-[14px] bg-panel-2 px-4 py-2 text-sm font-bold text-paper-dim">
              The mocks were built, but explanations and transcripts were not saved because migration_130 has not been run yet. Run it, then add the files again to get them.
            </p>
          )}
          {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-5">
          <button type="button" onClick={onBack} disabled={busy} className="focus-ring text-[12px] font-extrabold text-mist hover:text-brass">
            Build from separate pages instead
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist">
              Close
            </button>
            <button type="button" onClick={build} disabled={!ready.length || busy || reading} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] disabled:opacity-50">
              {busy ? 'Building…' : ready.length ? `Build ${ready.length} full mock${ready.length === 1 ? '' : 's'}` : 'Build'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
