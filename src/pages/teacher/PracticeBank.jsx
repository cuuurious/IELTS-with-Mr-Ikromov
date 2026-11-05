import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { BANK_SKILLS, loadBank, loadGivenPages, shortTitle, uploadPages } from '../../lib/pageBank'
import { groupBadge, groupColour } from '../../lib/groupLook'
import { QUESTION_TYPES, qtypeLabel } from '../../lib/questionTypes'
import { SkillIcon } from '../../components/SkillArt'
import PagePreview from '../../components/bank/PagePreview'
import AssignPagesModal from '../../components/bank/AssignPagesModal'

/*
 * PRACTICE BANK — teacher (2026-11-02, migration_92).
 * Interactive HTML pages kept by book / set: upload them (files or a whole
 * folder, with audio), preview them with a live score check, and give any
 * of them to one or more groups as homework.
 */
const SKILL_LOOK = {
  reading: { icon: 'reading', tint: 'bg-reading-tint', text: 'text-reading' },
  listening: { icon: 'listening', tint: 'bg-listening-tint', text: 'text-listening' },
  writing: { icon: 'writing', tint: 'bg-writing-tint', text: 'text-writing' },
  workshop: { icon: 'vocab', tint: 'bg-vocab-tint', text: 'text-vocab' },
}

export default function PracticeBank() {
  const [pages, setPages] = useState(null)
  const [missing, setMissing] = useState(false)
  const [skill, setSkill] = useState('reading')
  const [collection, setCollection] = useState(null)
  const [adding, setAdding] = useState(false)

  // Which groups already got each page (small group badges on the rows).
  const [given, setGiven] = useState({})
  const [groups, setGroups] = useState([])
  const load = async () => {
    const r = await loadBank()
    setPages(r.pages)
    setMissing(r.missing)
    loadGivenPages().then(setGiven)
    supabase.from('groups').select('id, name, created_at').order('created_at').then(({ data }) => setGroups(data || []))
  }
  useEffect(() => {
    load()
  }, [])

  const counts = useMemo(() => {
    const c = {}
    ;(pages || []).forEach((p) => {
      const k = p.skill || 'reading'
      c[k] = (c[k] || 0) + 1
    })
    return c
  }, [pages])

  const collections = useMemo(() => {
    const map = {}
    ;(pages || []).filter((p) => (p.skill || 'reading') === skill).forEach((p) => {
      map[p.collection] = map[p.collection] || { name: p.collection, n: 0, types: new Set(), shelf: 0 }
      map[p.collection].n += 1
      if (p.question_type) map[p.collection].types.add(p.question_type)
      if (p.on_shelf) map[p.collection].shelf += 1
    })
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [pages, skill])

  if (missing) {
    return <p className="rounded-[20px] bg-panel px-5 py-4 text-sm font-bold text-mist">Run migration_92_practice_bank.sql to use the Practice Bank.</p>
  }

  if (collection) {
    return (
      <CollectionView
        name={collection}
        pages={(pages || []).filter((p) => p.collection === collection)}
        onBack={() => setCollection(null)}
        onChanged={load}
        given={given}
        groups={groups}
        onRenamed={(n) => {
          setCollection(n)
          load()
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {BANK_SKILLS.map((s) => {
          const look = SKILL_LOOK[s.value]
          const on = s.value === skill
          return (
            <button
              key={s.value}
              type="button"
              onClick={() => setSkill(s.value)}
              className={`focus-ring flex h-11 items-center gap-2 rounded-[14px] px-4 text-sm font-extrabold transition ${on ? `${look.tint} ${look.text} ring-2 ring-current` : 'bg-panel text-paper-dim hover:text-paper'}`}
            >
              <SkillIcon skill={look.icon} className="h-4 w-4" />
              {s.label}
              <span className="opacity-70">{counts[s.value] || 0}</span>
            </button>
          )
        })}
      </div>

      {pages === null ? (
        <p className="text-sm font-semibold text-mist">Loading…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c) => {
            const look = SKILL_LOOK[skill]
            return (
              <button key={c.name} type="button" onClick={() => setCollection(c.name)} className="focus-ring flex min-h-[150px] flex-col gap-3 rounded-[20px] border border-line bg-panel p-5 text-left transition hover:-translate-y-0.5 hover:border-brass/50">
                <span className={`grid h-11 w-11 place-items-center rounded-2xl ${look.tint} ${look.text}`}>
                  <SkillIcon skill={look.icon} className="h-5 w-5" />
                </span>
                <span className="font-brand text-[18px] font-semibold leading-tight text-paper">{c.name}</span>
                <span className="mt-auto flex flex-wrap gap-1.5 text-[12px] font-extrabold">
                  <span className="rounded-lg bg-panel-2 px-2 py-0.5 text-paper-dim">{c.n} pages</span>
                  {c.types.size > 0 && <span className="rounded-lg bg-panel-2 px-2 py-0.5 text-paper-dim">{c.types.size} question type{c.types.size === 1 ? '' : 's'}</span>}
                  {c.shelf > 0 && <span className="rounded-lg bg-reading-tint px-2 py-0.5 text-reading">On students’ shelf</span>}
                </span>
              </button>
            )
          })}
          <button type="button" onClick={() => setAdding(true)} className="focus-ring flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-line p-5 text-center text-brass hover:bg-panel">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brass/10 text-2xl font-bold">+</span>
            <span className="text-sm font-extrabold">Add pages</span>
            <span className="text-[12px] font-semibold text-mist">A whole book folder, or single pages</span>
          </button>
        </div>
      )}

      {adding && (
        <AddPages
          skill={skill}
          collections={[...new Set((pages || []).map((p) => p.collection))]}
          existing={pages || []}
          onClose={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false)
            load().then(() => setCollection(name))
          }}
        />
      )}
    </div>
  )
}

function CollectionView({ name, pages, onBack, onChanged, onRenamed, given = {}, groups = [] }) {
  const [selected, setSelected] = useState(() => new Set())
  const [preview, setPreview] = useState(null)
  const [assign, setAssign] = useState(null)
  const [typeOpen, setTypeOpen] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const skill = pages[0]?.skill || 'reading'
  const shelfable = skill === 'reading' || skill === 'listening'
  const onShelf = pages.length > 0 && pages.every((p) => p.on_shelf)

  const groupsByType = useMemo(() => {
    const out = []
    pages.forEach((p) => {
      const k = p.question_type || ''
      let g = out.find((x) => x.k === k)
      if (!g) out.push((g = { k, items: [] }))
      g.items.push(p)
    })
    return out
  }, [pages])

  const toggle = (id) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const chosen = pages.filter((p) => selected.has(p.id))

  const update = async (ids, patch) => {
    setError('')
    const { error: err } = await supabase.from('materials').update(patch).in('id', ids)
    if (err) setError(err.message)
    onChanged()
  }
  const remove = async () => {
    if (!window.confirm(`Delete ${chosen.length} page${chosen.length === 1 ? '' : 's'} from the bank? Homework that already uses them keeps working.`)) return
    const { error: err } = await supabase.from('materials').delete().in('id', chosen.map((p) => p.id))
    if (err) setError(err.message)
    setSelected(new Set())
    onChanged()
  }
  const rename = async () => {
    const n = renaming.trim()
    if (!n || n === name) return setRenaming(null)
    const { error: err } = await supabase.from('materials').update({ collection: n }).eq('collection', name)
    if (err) return setError(err.message)
    setRenaming(null)
    onRenamed(n)
  }

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="focus-ring self-start text-sm font-extrabold text-brass">← Practice Bank</button>
      <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-line bg-panel p-5">
        <div className="min-w-0 flex-1">
          {renaming !== null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                rename()
              }}
              className="flex gap-2"
            >
              <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} className="focus-ring min-w-0 flex-1 rounded-[12px] border border-line bg-panel-2 px-3 py-2 font-brand text-[18px] text-paper" />
              <button type="submit" className="focus-ring rounded-[12px] bg-brass px-3 text-sm font-extrabold text-onbrass">Save</button>
            </form>
          ) : (
            <p className="font-brand text-[22px] font-semibold text-paper">{name}</p>
          )}
          <p className="text-[13px] font-semibold text-mist">{pages.length} pages · tick pages, then give them to groups as homework</p>
        </div>
        {renaming === null && (
          <button type="button" onClick={() => setRenaming(name)} className="focus-ring h-9 rounded-[12px] px-3 text-[13px] font-extrabold text-mist hover:text-paper">Rename</button>
        )}
        {shelfable && (
          <button
            type="button"
            onClick={() => update(pages.map((p) => p.id), { on_shelf: !onShelf })}
            aria-pressed={onShelf}
            title="Students can practise these pages on their own in Books"
            className={`focus-ring h-10 rounded-[14px] px-3.5 text-[13px] font-extrabold ${onShelf ? 'bg-reading text-white' : 'bg-panel-2 text-paper-dim'}`}
          >
            {onShelf ? 'On students’ shelf ✓' : 'Put on students’ shelf'}
          </button>
        )}
        <button type="button" onClick={() => setAdding(true)} className="focus-ring h-10 rounded-[14px] border border-line px-3.5 text-[13px] font-extrabold text-paper hover:border-brass">+ Add pages</button>
      </div>

      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}

      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-[16px] border border-brass/40 bg-panel p-3 shadow-lg">
          <span className="text-sm font-extrabold text-paper">{selected.size} selected</span>
          <button type="button" onClick={() => setAssign(chosen)} className="focus-ring h-10 rounded-[14px] bg-saffron px-4 text-sm font-extrabold text-[#17213a]">Give as homework</button>
          <div className="relative">
            <button type="button" onClick={() => setTypeOpen((v) => !v)} className="focus-ring h-10 rounded-[14px] border border-line px-3 text-[13px] font-extrabold text-paper">Question type…</button>
            {typeOpen && (
              <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-[14px] border border-line bg-panel-2 py-1 shadow-xl">
                {QUESTION_TYPES.map((q) => (
                  <button
                    key={q.value}
                    type="button"
                    onClick={() => {
                      setTypeOpen(false)
                      update([...selected], { question_type: q.value })
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-paper hover:bg-panel"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={remove} className="focus-ring h-10 rounded-[14px] px-3 text-[13px] font-extrabold text-coral hover:bg-urgent-tint">Delete</button>
          <button type="button" onClick={() => setSelected(new Set())} className="focus-ring ml-auto h-10 px-2 text-[13px] font-bold text-mist">Clear</button>
        </div>
      )}

      {groupsByType.map((g) => (
        <section key={g.k} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-extrabold uppercase tracking-[0.1em] text-mist">{g.k ? qtypeLabel(g.k) : 'Pages'} · {g.items.length}</p>
            <button
              type="button"
              onClick={() =>
                setSelected((prev) => {
                  const n = new Set(prev)
                  const all = g.items.every((p) => n.has(p.id))
                  g.items.forEach((p) => (all ? n.delete(p.id) : n.add(p.id)))
                  return n
                })
              }
              className="focus-ring text-[12px] font-extrabold text-brass"
            >
              Select all
            </button>
          </div>
          <ul className="grid gap-1.5 md:grid-cols-2">
            {g.items.map((p) => (
              <li key={p.id} className={`flex items-center gap-3 rounded-[14px] px-3 py-2 ${selected.has(p.id) ? 'bg-brass/10 ring-1 ring-brass/50' : 'bg-panel'}`}>
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 shrink-0 accent-brass" aria-label={`Select ${p.title}`} />
                <span className="w-8 shrink-0 text-[13px] font-extrabold text-mist">{p.position ?? ''}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-paper">{shortTitle(p.title)}</span>
                {given[p.url]?.size > 0 && (
                  <span className="flex shrink-0 gap-1" title={`Given to ${groups.filter((g) => given[p.url].has(g.id)).map((g) => g.name).join(', ')}`}>
                    {groups
                      .map((g, i) => ({ g, c: groupColour(i) }))
                      .filter(({ g }) => given[p.url].has(g.id))
                      .slice(0, 4)
                      .map(({ g, c }) => (
                        <span key={g.id} className={`grid h-6 min-w-6 place-items-center rounded-lg px-1 text-[11px] font-extrabold ${c.tint} ${c.text}`}>
                          {groupBadge(g.name)}
                        </span>
                      ))}
                  </span>
                )}
                <button type="button" onClick={() => setPreview(p)} className="focus-ring shrink-0 rounded-[10px] px-2.5 py-1 text-[12px] font-extrabold text-brass hover:bg-panel-2">Preview</button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {preview && <PagePreview page={preview} onClose={() => setPreview(null)} />}
      {assign && (
        <AssignPagesModal
          pages={assign}
          onClose={() => setAssign(null)}
          onDone={() => setSelected(new Set())}
        />
      )}
      {adding && (
        <AddPages
          skill={skill}
          fixedCollection={name}
          collections={[name]}
          existing={pages}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function AddPages({ skill: startSkill, fixedCollection, collections, existing, onClose, onAdded }) {
  const { profile } = useAuth()
  const [skill, setSkill] = useState(startSkill)
  const [name, setName] = useState(fixedCollection || '')
  const [files, setFiles] = useState(null)
  const [shelf, setShelf] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)
  const folderRef = useRef(null)

  const list = files ? Array.from(files) : []
  const htmlCount = list.filter((f) => /\.html?$/i.test(f.name)).length
  const audioCount = list.filter((f) => /\.(mp3|m4a|wav|ogg|aac)$/i.test(f.name)).length
  const folderName = list[0]?.webkitRelativePath?.split('/')[0] || ''

  const start = async () => {
    const collection = (name || folderName || 'New set').trim()
    const startAt = Math.max(0, ...existing.filter((p) => p.collection === collection).map((p) => p.position || 0))
    setProgress({ done: 0, total: htmlCount + audioCount, failed: 0 })
    const r = await uploadPages({ files, skill, collection, userId: profile?.id, startAt, onShelf: shelf, onProgress: setProgress })
    setResult({ ...r, collection })
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/60 sm:items-center sm:p-4" onClick={progress && !result ? undefined : onClose}>
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-t-[28px] bg-ink p-5 sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add pages">
        <p className="font-brand text-[20px] font-semibold text-paper">Add pages</p>
        {result ? (
          <>
            <p className="rounded-[14px] bg-sage/15 px-4 py-3 text-sm font-bold text-sage">{result.added} page{result.added === 1 ? '' : 's'} added to “{result.collection}”.</p>
            {result.failed.slice(0, 5).map((f) => (
              <p key={f} className="rounded-[14px] bg-urgent-tint px-4 py-2 text-[13px] font-bold text-coral">{f}</p>
            ))}
            <button type="button" onClick={() => onAdded(result.collection)} className="focus-ring h-11 self-start rounded-[14px] bg-brass px-5 text-sm font-extrabold text-onbrass">Open it</button>
          </>
        ) : progress ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-paper">Uploading {progress.done} of {progress.total}…</p>
            <div className="h-2 overflow-hidden rounded-full bg-panel"><div className="h-full rounded-full bg-saffron" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></div>
          </div>
        ) : (
          <>
            {!fixedCollection && (
              <div className="flex flex-wrap gap-1.5">
                {BANK_SKILLS.map((s) => (
                  <button key={s.value} type="button" onClick={() => setSkill(s.value)} className={`focus-ring h-9 rounded-[12px] px-3 text-[13px] font-extrabold ${s.value === skill ? 'bg-brass text-onbrass' : 'bg-panel text-paper-dim'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <label className="flex flex-col gap-1.5 text-[13px] font-extrabold text-paper-dim">
              Book or set name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={Boolean(fixedCollection)}
                list="bank-collections"
                placeholder={folderName || 'e.g. Reading Book 1, Listen with Mr.Ikromov Part 2, Task 1 Book'}
                className="focus-ring rounded-[12px] border border-line bg-panel px-3 py-2 text-sm font-bold text-paper disabled:opacity-70"
              />
              <datalist id="bank-collections">
                {collections.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input ref={folderRef} type="file" multiple webkitdirectory="" directory="" className="hidden" onChange={(e) => setFiles(e.target.files)} />
              <input ref={fileRef} type="file" multiple accept=".html,.htm,audio/*" className="hidden" onChange={(e) => setFiles(e.target.files)} />
              <button type="button" onClick={() => folderRef.current?.click()} className="focus-ring flex flex-col items-center gap-1 rounded-[16px] border-2 border-dashed border-line px-3 py-4 text-sm font-extrabold text-paper hover:border-brass">
                Choose a folder
                <span className="text-[12px] font-semibold text-mist">pages + audio inside</span>
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className="focus-ring flex flex-col items-center gap-1 rounded-[16px] border-2 border-dashed border-line px-3 py-4 text-sm font-extrabold text-paper hover:border-brass">
                Choose files
                <span className="text-[12px] font-semibold text-mist">one or many .html</span>
              </button>
            </div>
            {files && (
              <p className="text-sm font-bold text-paper">
                {htmlCount} page{htmlCount === 1 ? '' : 's'}
                {audioCount ? ` · ${audioCount} audio files` : ''}
                {folderName ? ` from “${folderName}”` : ''}
              </p>
            )}
            {(skill === 'reading' || skill === 'listening') && (
              <label className="flex items-center gap-2 text-sm font-bold text-paper">
                <input type="checkbox" checked={shelf} onChange={(e) => setShelf(e.target.checked)} className="h-4 w-4 accent-brass" />
                Also put them on the students’ Books shelf for self-practice
              </label>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={start} disabled={!htmlCount} className="focus-ring h-11 flex-1 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] disabled:opacity-50">
                Upload {htmlCount || ''} page{htmlCount === 1 ? '' : 's'}
              </button>
              <button type="button" onClick={onClose} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
