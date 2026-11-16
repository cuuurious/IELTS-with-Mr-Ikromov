import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { useFileDrop, DropOverlay } from '../../lib/useFileDrop'
import FullMockFromFile from './FullMockFromFile'
import { parseMockHtml, combineListeningParts, saveImportedExam, uploadBlob } from '../../lib/mockHtmlImport'

/*
 * NEW FULL MOCK FROM FILES (2026-11-16).
 * One window instead of four: title, then drop the Listening page(s),
 * the Reading page and the Writing tasks. The site reads the answer key
 * inside each page and builds the exams for the real exam screen, then
 * the full mock itself. Nothing is saved until "Build the full mock".
 * Each skill can also use an exam that is already on the site.
 */

const readText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result || ''))
    r.onerror = () => rej(r.error)
    r.readAsText(file)
  })

function combinePages(pages) {
  if (!pages.length) return null
  if (pages.length === 1 && !pages[0].partOnly) return pages[0]
  const r = combineListeningParts(pages)
  r.partOnly = r.sections.length < 4
  return r
}

const partOf = (name) => {
  const m = /part[\s_-]*([1-4])/i.exec(name || '') || /(?:^|\D)([1-4])(?:\D*)\.(mp3|m4a|wav|ogg)$/i.exec(name || '')
  return m ? Number(m[1]) : null
}

function Tick({ ok, children }) {
  return (
    <li className={`flex items-start gap-2 text-[13px] font-semibold ${ok ? 'text-paper' : 'text-coral'}`}>
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-extrabold ${ok ? 'bg-reading text-white' : 'bg-coral text-white'}`}>{ok ? '✓' : '!'}</span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function Card({ n, title, mode, setMode, existing, existingId, setExistingId, children }) {
  return (
    <section className="rounded-[20px] border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-brass font-brand text-[14px] font-semibold text-onbrass">{n}</span>
        <h3 className="flex-1 font-brand text-[17px] font-semibold text-paper">{title}</h3>
        <div className="flex rounded-[12px] bg-panel-2 p-0.5 text-[12px] font-extrabold">
          {[
            ['new', 'New from files'],
            ['existing', 'Use one on the site'],
          ].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setMode(k)} className={`focus-ring rounded-[10px] px-2.5 py-1.5 ${mode === k ? 'bg-panel text-paper shadow-sm' : 'text-mist'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {mode === 'existing' ? (
        <select value={existingId} onChange={(e) => setExistingId(e.target.value)} className="focus-ring h-11 w-full rounded-[14px] border border-line bg-panel-2 px-3 text-sm font-semibold text-paper">
          <option value="">{existing.length ? 'Choose…' : 'Nothing on the site yet'}</option>
          {existing.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
              {e.is_active === false ? ' (draft)' : ''}
            </option>
          ))}
        </select>
      ) : (
        children
      )}
    </section>
  )
}

function DropBox({ accept, onFiles, label, hint, busy }) {
  const ref = useRef(null)
  const { isDragging, dropProps } = useFileDrop({ onFiles, accept })
  return (
    <div {...dropProps} className="relative">
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="focus-ring flex w-full flex-col items-center justify-center gap-1 rounded-[16px] border-2 border-dashed border-line px-4 py-5 text-center hover:border-brass hover:bg-panel-2/50"
      >
        <span className="text-sm font-extrabold text-brass">{busy ? 'Reading…' : label}</span>
        <span className="text-[12px] font-semibold text-mist">{hint}</span>
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          onFiles([...(e.target.files || [])])
          e.target.value = ''
        }}
      />
      <DropOverlay show={isDragging} label="Drop here" />
    </div>
  )
}

function Summary({ parsed, audio, onAudio }) {
  const [open, setOpen] = useState(false)
  if (!parsed) return null
  const isL = parsed.module === 'listening'
  return (
    <div className="mt-3 rounded-[16px] bg-panel-2/60 p-3">
      <ul className="flex flex-col gap-1.5">
        <Tick ok={parsed.count === 40}>
          {parsed.title}: {parsed.sections.length} {isL ? 'part' : 'passage'}
          {parsed.sections.length === 1 ? '' : 's'}, {parsed.count} questions ({parsed.range[0]}–{parsed.range[1]})
          {parsed.count !== 40 && ' — a full test has 40'}
        </Tick>
        {isL &&
          parsed.sections.map((s, i) => {
            const has = !!(audio[s.number] || s.audio_url)
            return (
              <Tick key={i} ok={has}>
                {s.title}: {has ? (audio[s.number] ? `audio “${audio[s.number].name}”` : 'audio from the page') : 'no audio — drop the mp3 for this part'}
                {!has && (
                  <label className="ml-2 inline-block cursor-pointer rounded-lg bg-panel px-2 py-0.5 text-[12px] font-extrabold text-brass">
                    Choose mp3
                    <input type="file" accept="audio/*,.mp3,.m4a" className="hidden" onChange={(e) => e.target.files?.[0] && onAudio(s.number, e.target.files[0])} />
                  </label>
                )}
              </Tick>
            )
          })}
        {parsed.problems.map((p, i) => (
          <Tick key={`p${i}`} ok={false}>
            {p}
          </Tick>
        ))}
      </ul>
      <button type="button" onClick={() => setOpen((v) => !v)} className="focus-ring mt-2 text-[12px] font-extrabold text-brass">
        {open ? 'Hide the questions' : 'Show what was read'}
      </button>
      {open && (
        <div className="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
          {parsed.sections.map((s, si) => (
            <div key={si}>
              <p className="text-[12px] font-extrabold uppercase tracking-wide text-mist">{s.title}</p>
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
          ))}
        </div>
      )}
    </div>
  )
}

export default function MockFromFiles({ profileId, listeningExams = [], readingExams = [], writingExams = [], defaultTitle = '', onClose, onDone }) {
  const [title, setTitle] = useState(defaultTitle)
  const [lMode, setLMode] = useState('new')
  const [rMode, setRMode] = useState('new')
  const [wMode, setWMode] = useState('new')
  const [lId, setLId] = useState('')
  const [rId, setRId] = useState('')
  const [wId, setWId] = useState('')
  const [lPages, setLPages] = useState([]) // parsed Listening pages
  const [reading, setReading] = useState(null)
  const [audio, setAudio] = useState({}) // Part number -> mp3 File
  const [w, setW] = useState({ t1: '', t2: '', img: null, imgUrl: '' })
  const [reading1, setReading1] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [active, setActive] = useState(true)
  const [done, setDone] = useState(false)
  const [whole, setWhole] = useState(true) // one "Full Mock Test" file per mock (default)

  const readFiles = async (files, which) => {
    setError('')
    const htmls = files.filter((f) => /\.html?$/i.test(f.name))
    const mp3s = files.filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f.name) || /^audio\//.test(f.type))
    setReading1(which)
    try {
      const results = []
      for (const f of htmls) {
        const r = parseMockHtml(await readText(f))
        if (!r.module) throw new Error(`${f.name}: ${r.error}`)
        if (r.module !== which) throw new Error(`${f.name} is a ${r.module} test — drop it in the ${r.module === 'reading' ? 'Reading' : 'Listening'} box.`)
        results.push(r)
      }
      if (which === 'listening') {
        // A full test page replaces everything; Part pages add up (the same Part replaces the old one).
        let pages = lPages
        const full = results.filter((r) => !r.partOnly)
        if (full.length) pages = [full[full.length - 1]]
        else if (results.length) {
          const nums = new Set(results.flatMap((r) => r.sections.map((s) => s.number)))
          pages = [...pages.filter((p) => p.partOnly && !p.sections.some((s) => nums.has(s.number))), ...results]
        }
        if (pages !== lPages) {
          setLPages(pages)
          if (full.length) setAudio({})
        }
        const parsed = combinePages(pages)
        if (mp3s.length && parsed) {
          const next = { ...audio }
          const missing = parsed.sections.map((s) => s.number).filter((n) => !next[n])
          mp3s.forEach((f) => {
            const p = partOf(f.name)
            if (p && parsed.sections.some((s) => s.number === p)) next[p] = f
            else if (missing.length) next[missing.shift()] = f
          })
          setAudio(next)
        }
      } else if (results.length) {
        // One full test, or passage pages in order.
        const parsed = results.length === 1 ? results[0] : { ...results[0], sections: results.flatMap((r) => r.sections), count: results.reduce((n, r) => n + r.count, 0), problems: results.flatMap((r) => r.problems), range: [results[0].range[0], results[results.length - 1].range[1]] }
        setReading(parsed)
      }
    } catch (e) {
      setError(e?.message || 'Could not read that file.')
    } finally {
      setReading1(false)
    }
  }

  const listening = useMemo(() => combinePages(lPages), [lPages])
  const autoTitle = [listening?.title, reading?.title].filter(Boolean).join(' · ')
  const lOk = lMode === 'existing' ? !!lId : !!listening && listening.count === 40 && listening.problems.length === 0 && listening.sections.every((s) => audio[s.number] || s.audio_url)
  const rOk = rMode === 'existing' ? !!rId : !!reading && reading.count === 40 && reading.problems.length === 0
  const wOk = wMode === 'existing' ? !!wId : w.t2.trim().length > 10 && (w.img || w.imgUrl || w.t1.trim())
  const canSave = (title.trim() || autoTitle) && lOk && rOk && wOk && !busy

  const build = async () => {
    const name = title.trim() || autoTitle
    setBusy('Saving…')
    setError('')
    const made = { exams: [], writing: null }
    try {
      let listeningId = lId
      let readingId = rId
      let writingId = wId
      if (lMode === 'new') {
        setBusy('Saving Listening…')
        listeningId = await saveImportedExam(supabase, { parsed: listening, title: `${name} · Listening`, userId: profileId, audioFiles: Object.fromEntries(listening.sections.map((s, i) => [i, audio[s.number]]).filter((x) => x[1])), active: true })
        made.exams.push(listeningId)
      }
      if (rMode === 'new') {
        setBusy('Saving Reading…')
        readingId = await saveImportedExam(supabase, { parsed: reading, title: `${name} · Reading`, userId: profileId, active: true })
        made.exams.push(readingId)
      }
      if (wMode === 'new') {
        setBusy('Saving Writing…')
        let img = w.imgUrl || null
        if (w.img) img = await uploadBlob(supabase, profileId, w.img, `task1.${(w.img.name || 'p.png').split('.').pop()}`)
        const { data, error: e } = await supabase
          .from('writing_mock_exams')
          .insert({ title: `${name} · Writing`, task1_prompt: w.t1.trim() || null, task1_image_url: img, task2_prompt: w.t2.trim(), time_limit_minutes: 60, is_active: true, sort_order: 0, created_by: profileId })
          .select('id')
          .single()
        if (e) throw e
        writingId = data.id
        made.writing = data.id
      }
      setBusy('Building the full mock…')
      const { error: e5 } = await supabase.from('full_mock_sets').insert({
        title: name,
        listening_exam_id: listeningId,
        reading_exam_id: readingId,
        writing_exam_id: writingId,
        is_active: active,
        sort_order: 0,
        created_by: profileId,
      })
      if (e5) throw e5
      setDone(true)
      onDone?.()
    } catch (e) {
      // Take back what was made, so nothing half-built is left behind.
      for (const id of made.exams) await supabase.from('mock_exams').delete().eq('id', id)
      if (made.writing) await supabase.from('writing_mock_exams').delete().eq('id', made.writing)
      setError(e?.message || 'Could not build the full mock. Nothing was saved.')
    } finally {
      setBusy('')
    }
  }

  if (whole) return <FullMockFromFile profileId={profileId} onClose={onClose} onDone={onDone} onBack={() => setWhole(false)} />

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="New full mock">
      <div className="flex max-h-[96vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] bg-panel shadow-xl sm:rounded-[28px]">
        <div className="registan-band shrink-0 px-5 py-4 text-white">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">New full mock · from your test pages</p>
          <p className="font-brand text-[20px] font-semibold">Drop the files, check, build</p>
          <p className="text-[13px] font-semibold text-white/85">The site reads the answer key inside each page. Nothing is saved until you press Build.</p>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="font-brand text-[22px] font-semibold text-paper">“{title.trim() || autoTitle}” is ready</p>
            <p className="max-w-md text-sm font-semibold text-mist">Listening, Reading and Writing are saved and joined into one full mock. Give students their codes from Access codes.</p>
            <button type="button" onClick={onClose} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a]">Done</button>
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-5">
              <button type="button" onClick={() => setWhole(true)} className="focus-ring self-start text-[12px] font-extrabold text-brass">
                ← Add whole “Full Mock Test” files instead
              </button>
              <label className="block">
                <span className="text-sm font-extrabold text-paper">Name of the full mock</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={autoTitle || 'Full Mock 5'}
                  className="focus-ring mt-1.5 h-11 w-full rounded-[14px] border border-line bg-panel-2 px-3 text-[15px] font-semibold text-paper"
                />
              </label>

              <Card n="1" title="Listening" mode={lMode} setMode={setLMode} existing={listeningExams} existingId={lId} setExistingId={setLId}>
                <DropBox
                  accept=".html,.htm,audio/*,.mp3,.m4a"
                  busy={reading1 === 'listening'}
                  label={listening ? 'Add or replace files' : 'Drop the Listening page(s) here'}
                  hint="One full test page, or a page for each Part. Add the mp3 files too if the pages don't have them."
                  onFiles={(f) => readFiles(f, 'listening')}
                />
                <Summary parsed={listening} audio={audio} onAudio={(i, f) => setAudio((a) => ({ ...a, [i]: f }))} />
                {listening && (
                  <button type="button" onClick={() => { setLPages([]); setAudio({}) }} className="focus-ring mt-2 text-[12px] font-extrabold text-mist hover:text-coral">
                    Clear Listening
                  </button>
                )}
              </Card>

              <Card n="2" title="Reading" mode={rMode} setMode={setRMode} existing={readingExams} existingId={rId} setExistingId={setRId}>
                <DropBox
                  accept=".html,.htm"
                  busy={reading1 === 'reading'}
                  label={reading ? 'Replace the Reading page' : 'Drop the Reading page here'}
                  hint="One full test page with the three passages (or the passage pages in order)."
                  onFiles={(f) => readFiles(f, 'reading')}
                />
                <Summary parsed={reading} audio={{}} />
              </Card>

              <Card n="3" title="Writing" mode={wMode} setMode={setWMode} existing={writingExams} existingId={wId} setExistingId={setWId}>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="sm:w-48">
                      <ImageDrop file={w.img} onFile={(img) => setW((x) => ({ ...x, img }))} />
                    </div>
                    <textarea
                      value={w.t1}
                      onChange={(e) => setW((x) => ({ ...x, t1: e.target.value }))}
                      rows={4}
                      placeholder="Task 1 text, e.g. “The chart below shows … Summarise the information …”"
                      className="focus-ring min-h-[110px] flex-1 rounded-[14px] border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
                    />
                  </div>
                  <textarea
                    value={w.t2}
                    onChange={(e) => setW((x) => ({ ...x, t2: e.target.value }))}
                    rows={4}
                    placeholder="Task 2 question"
                    className="focus-ring w-full rounded-[14px] border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
                  />
                </div>
              </Card>

              <label className="flex items-center gap-2 px-1 text-sm font-bold text-paper">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" />
                Ready for students (they still need an access code)
              </label>
              {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-5">
              <p className="text-[12px] font-semibold text-mist">
                {canSave ? 'Everything is in place.' : !(title.trim() || autoTitle) ? 'Give the mock a name.' : !lOk ? 'Listening is not ready.' : !rOk ? 'Reading is not ready.' : 'Writing is not ready.'}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} disabled={!!busy} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist">Cancel</button>
                <button type="button" onClick={build} disabled={!canSave} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] disabled:opacity-50">
                  {busy || 'Build the full mock'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

function ImageDrop({ file, onFile }) {
  const ref = useRef(null)
  const { isDragging, dropProps } = useFileDrop({ onFiles: (f) => f[0] && onFile(f[0]), accept: 'image/*' })
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])
  return (
    <div {...dropProps} className="relative h-full">
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="focus-ring flex h-full min-h-[110px] w-full items-center justify-center overflow-hidden rounded-[14px] border-2 border-dashed border-line text-center hover:border-brass"
      >
        {url ? <img src={url} alt="Task 1" className="max-h-40 w-full object-contain" /> : <span className="px-3 text-[12px] font-extrabold text-brass">Task 1 picture (drop or click)</span>}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <DropOverlay show={isDragging} label="Drop the picture" />
    </div>
  )
}
