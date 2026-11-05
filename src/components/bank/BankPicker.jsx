import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BANK_SKILLS, SPEAKING_TOPICS, TOPICS, loadBank, loadGivenPages, loadPageStats, loadSets, shortTitle } from '../../lib/pageBank'
import { BookCoverCard, PageRow, skillShade, splitSet } from './BookCover'

/*
 * Pick Practice Bank pages for a homework or a course lesson (2026-11-02,
 * reworked 2026-11-05).
 *   - Opened from "+ Reading" or "+ Listening" it shows only that shelf
 *     (`lockSkill`), so there are no other tabs to wonder about.
 *   - Search across every set by passage name.
 *   - With a group: pages it already did are marked, can be hidden, and
 *     "Pick 3 new" ticks the first three it hasn't done.
 *   - Pages ticked in different sets collect in the basket at the bottom.
 *   - Easy / medium / hard from real first tries (migration_96), and a
 *     peek at the passage's first lines.
 * onPick(pages) with the chosen rows. onLibrary (optional) switches to the
 * Materials Library picker.
 */
const NEW_PICK = 3

export default function BankPicker({ open, onClose, onPick, onLibrary, initialSkill = 'reading', groupId = null, lockSkill = false, book = null, notBook = null, heading = null }) {
  const [pages, setPages] = useState(null)
  const [missing, setMissing] = useState(false)
  const [skill, setSkill] = useState('reading')
  const [collection, setCollection] = useState(null)
  const [picked, setPicked] = useState(() => new Map()) // id -> page, in pick order
  const [given, setGiven] = useState({}) // url -> Set(groupId)
  const [stats, setStats] = useState({})
  const [search, setSearch] = useState('')
  const [hideGiven, setHideGiven] = useState(false)
  const [topic, setTopic] = useState('')
  const [order, setOrder] = useState('book') // 'book' | 'easy'
  const [sets, setSets] = useState([])

  useEffect(() => {
    if (!open) return
    setPicked(new Map())
    setSkill(initialSkill)
    setCollection(null)
    setSearch('')
    setTopic('')
    loadSets().then((r) => setSets(r || []))
    if (groupId) loadGivenPages().then(setGiven)
    loadPageStats().then(setStats)
    loadBank().then((r) => {
      setPages(r.pages)
      setMissing(r.missing)
    })
  }, [open, initialSkill, groupId])

  // Esc closes.
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const isGiven = (p) => Boolean(groupId && given[p.url]?.has(groupId))
  // Opened from "Reading by type" / "Full reading test": only that book.
  const ofSkill = useMemo(
    () =>
      (pages || []).filter((p) => {
        if ((p.skill || 'reading') !== skill) return false
        const b = String(p.collection || '').split(' · ')[0]
        if (book && b !== book) return false
        if (notBook && b === notBook) return false
        return true
      }),
    [pages, skill, book, notBook]
  )

  const setsOf = useMemo(() => {
    const map = {}
    ofSkill.forEach((p) => {
      map[p.collection] = map[p.collection] || { name: p.collection, n: 0, fresh: 0, types: new Set() }
      map[p.collection].n += 1
      if (!isGiven(p)) map[p.collection].fresh += 1
      if (p.question_type) map[p.collection].types.add(p.question_type)
    })
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ofSkill, given, groupId])

  const counts = {}
  ;(pages || []).forEach((p) => {
    const k = p.skill || 'reading'
    counts[k] = (counts[k] || 0) + 1
  })
  const tabs = BANK_SKILLS.filter((s) => pages === null || counts[s.value] || s.value === skill)
  const skillLabel = BANK_SKILLS.find((x) => x.value === skill)?.label || 'Practice'

  if (!open) return null

  const q = search.trim().toLowerCase()
  const visible = (list) => (hideGiven ? list.filter((p) => !isGiven(p)) : list)
  const ease = (p) => (stats[p.url]?.tries >= 3 ? stats[p.url].avg : -1)
  const rows =
    q || topic
      ? visible(ofSkill.filter((p) => (!q || `${p.title} ${p.collection} ${p.topic || ''}`.toLowerCase().includes(q)) && (!topic || p.topic === topic))).slice(0, 100)
      : collection
        ? visible(ofSkill.filter((p) => p.collection === collection)).sort((a, b) => (order === 'easy' ? ease(b) - ease(a) : 0) || (a.position ?? 0) - (b.position ?? 0))
        : null
  const topicCounts = {}
  ofSkill.forEach((p) => p.topic && (topicCounts[p.topic] = (topicCounts[p.topic] || 0) + 1))

  const toggle = (p) =>
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(p.id)) next.delete(p.id)
      else next.set(p.id, p)
      return next
    })
  const pickNew = () => {
    const fresh = ofSkill
      .filter((p) => p.collection === collection && !isGiven(p) && !picked.has(p.id))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .slice(0, NEW_PICK)
    setPicked((prev) => {
      const next = new Map(prev)
      fresh.forEach((p) => next.set(p.id, p))
      return next
    })
  }
  const pickedList = [...picked.values()]
  const shade = skillShade(skill, 0)
  const books = {}
  setsOf.forEach((c, i) => {
    const { book } = splitSet(c.name)
    ;(books[book] = books[book] || []).push({ ...c, i })
  })

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/85 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] bg-ink shadow-2xl sm:h-[88vh] sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Choose pages">
        <div className="flex shrink-0 items-center gap-3 px-5 py-4 text-white" style={{ backgroundColor: shade }}>
          {collection && !q ? (
            <button type="button" onClick={() => setCollection(null)} aria-label="Back to all sets" className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/15 hover:bg-white/25">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">{collection && !q ? splitSet(collection).book || skillLabel : `${heading || skillLabel} · Practice Bank`}</p>
            <p className="truncate font-brand text-[19px] font-semibold text-white">{collection && !q ? (/^Full (Reading|Listening) Tests$/.test(splitSet(collection).book) ? splitSet(collection).short : splitSet(collection).subtitle) : 'Choose pages'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/15 hover:bg-white/25">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {!lockSkill && tabs.length > 1 && (
            <div className="flex max-w-full gap-1 overflow-x-auto rounded-[14px] bg-panel p-1">
              {tabs.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    setSkill(s.value)
                    setCollection(null)
                  }}
                  className={`focus-ring h-8 shrink-0 rounded-[10px] px-3 text-[13px] font-extrabold ${s.value === skill ? 'bg-brass text-onbrass' : 'text-paper-dim'}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${ofSkill.length || ''} ${book === 'Writing Task 1' ? 'reports' : book === 'Writing Task 2' ? 'essays' : book ? 'tests' : `${skillLabel.toLowerCase()} pages`}…`}
            className="focus-ring h-10 min-w-0 flex-1 rounded-[12px] border border-line bg-panel px-3.5 text-sm text-paper placeholder:text-mist/70"
          />
          {groupId && (
            <button
              type="button"
              aria-pressed={hideGiven}
              onClick={() => setHideGiven((v) => !v)}
              className={`focus-ring h-10 shrink-0 rounded-[12px] px-3 text-[13px] font-extrabold ${hideGiven ? 'bg-brass text-onbrass' : 'bg-panel text-paper-dim'}`}
            >
              {hideGiven ? '✓ New only' : 'New only'}
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {missing ? (
            <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">Run migration_92_practice_bank.sql first.</p>
          ) : pages === null ? (
            <p className="text-sm font-semibold text-mist">Loading…</p>
          ) : rows ? (
            <>
              {collection && !q && !topic && (
                <div className="flex flex-wrap items-center gap-2">
                  {groupId && (
                    <>
                      <button type="button" onClick={pickNew} className="focus-ring h-9 rounded-[12px] bg-brass/10 px-3 text-[13px] font-extrabold text-brass hover:bg-brass/20">
                        Pick {NEW_PICK} new
                      </button>
                      <span className="text-xs font-bold text-mist">
                        {setsOf.find((c) => c.name === collection)?.fresh ?? 0} of {setsOf.find((c) => c.name === collection)?.n ?? 0} not done by this group yet
                      </span>
                    </>
                  )}
                  <span className="ml-auto flex gap-1 rounded-[12px] bg-panel p-0.5">
                    {[
                      ['book', 'Book order'],
                      ['easy', 'Easiest first'],
                    ].map(([k, l]) => (
                      <button key={k} type="button" onClick={() => setOrder(k)} aria-pressed={order === k} className={`focus-ring h-8 rounded-[10px] px-2.5 text-[12px] font-extrabold ${order === k ? 'bg-brass text-onbrass' : 'text-paper-dim'}`}>
                        {l}
                      </button>
                    ))}
                  </span>
                </div>
              )}
              {topic && (
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold text-mist">{rows.length} pages about {topic}</p>
                  <button type="button" onClick={() => setTopic('')} className="focus-ring text-[12px] font-extrabold text-brass">× Clear</button>
                </div>
              )}
              {q && <p className="text-xs font-bold text-mist">{rows.length ? `${rows.length} found` : 'Nothing found — try another word from the passage title.'}</p>}
              <ul className="flex flex-col gap-1.5">
                {rows.map((p) => (
                  <PageRow
                    key={p.id}
                    page={p}
                    checked={picked.has(p.id)}
                    onToggle={() => toggle(p)}
                    stat={stats[p.url]}
                    showType={Boolean(q || topic)}
                    given={isGiven(p) ? [{ key: 'g', label: '✓ Done', cls: 'bg-reading-tint text-reading', title: 'This group already did it' }] : []}
                  />
                ))}
              </ul>
            </>
          ) : setsOf.length === 0 ? (
            <p className="rounded-[14px] bg-panel px-4 py-6 text-center text-sm font-semibold text-mist">No {skillLabel.toLowerCase()} pages yet. Add them in Practice Bank.</p>
          ) : (
            <>
              {sets.filter((st) => ofSkill.some((p) => st.material_ids.includes(p.id))).length > 0 && (
                <section className="flex flex-col gap-2">
                  <p className="px-1 text-[12px] font-extrabold uppercase tracking-[0.12em] text-mist">Your saved sets</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sets.map((st) => {
                      const list = ofSkill.filter((p) => st.material_ids.includes(p.id))
                      if (!list.length) return null
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() =>
                            setPicked((prev) => {
                              const n = new Map(prev)
                              list.forEach((p) => n.set(p.id, p))
                              return n
                            })
                          }
                          className="focus-ring h-9 rounded-[12px] bg-brass/10 px-3 text-[13px] font-extrabold text-brass hover:bg-brass/20"
                        >
                          + {st.name} <span className="text-mist">{list.length}</span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}
              {Object.keys(topicCounts).length > 0 && (
                <section className="flex flex-col gap-2">
                  <p className="px-1 text-[12px] font-extrabold uppercase tracking-[0.12em] text-mist">By topic</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[...TOPICS, ...SPEAKING_TOPICS].filter((t) => topicCounts[t]).map((t) => (
                      <button key={t} type="button" onClick={() => setTopic(t)} className="focus-ring h-8 rounded-[10px] border border-line bg-panel px-2.5 text-[12px] font-extrabold text-paper-dim hover:border-brass hover:text-paper">
                        {t} <span className="text-mist">{topicCounts[t]}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            {Object.entries(books).map(([book, list]) => (
              <section key={book || '-'} className="flex flex-col gap-2">
                {book && <p className="px-1 text-[12px] font-extrabold uppercase tracking-[0.12em] text-mist">{book}</p>}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {list.map((c) => (
                    <BookCoverCard
                      key={c.name}
                      compact
                      name={c.name}
                      types={c.types}
                      count={c.n}
                      skill={skill}
                      index={c.i}
                      onClick={() => setCollection(c.name)}
                      footer={groupId && c.fresh < c.n ? <span className="text-reading">· {c.fresh} new</span> : null}
                    />
                  ))}
                </div>
              </section>
            ))}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-panel px-4 py-3">
          {pickedList.length > 0 && (
            <ul className="flex max-h-[68px] flex-wrap gap-1.5 overflow-y-auto">
              {pickedList.map((p) => (
                <li key={p.id} className="flex max-w-[220px] items-center gap-1 rounded-[10px] bg-brass/10 py-0.5 pl-2 pr-0.5 text-[12px] font-extrabold text-paper">
                  <span className="truncate">{shortTitle(p.title)}</span>
                  <button type="button" onClick={() => toggle(p)} aria-label={`Remove ${p.title}`} className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded-md text-mist hover:text-coral">×</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {onLibrary && (
              <button type="button" onClick={onLibrary} className="focus-ring mr-auto text-[13px] font-extrabold text-mist hover:text-paper">
                HTML file from the Library instead
              </button>
            )}
            <button
              type="button"
              disabled={!pickedList.length}
              onClick={() => onPick(pickedList)}
              className="focus-ring ml-auto h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] disabled:opacity-50"
            >
              {pickedList.length ? `Add ${pickedList.length} page${pickedList.length === 1 ? '' : 's'}` : 'Tick pages to add'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
