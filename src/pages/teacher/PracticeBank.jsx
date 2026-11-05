import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { BANK_SKILLS, TOPICS, deleteSet, loadBank, loadGivenPages, loadPageStats, loadSets, saveSet, shortTitle, uploadPages } from '../../lib/pageBank'
import PageReport from '../../components/bank/PageReport'
import WeeklyDrafts from '../../components/bank/WeeklyDrafts'
import { groupBadge, groupColour, groupDisplayName } from '../../lib/groupLook'
import { BookCoverCard, PageRow, skillShade, splitSet } from '../../components/bank/BookCover'
import { QUESTION_TYPES, qtypeLabel } from '../../lib/questionTypes'
import PagePreview from '../../components/bank/PagePreview'
import AssignPagesModal from '../../components/bank/AssignPagesModal'

/*
 * PRACTICE BANK — teacher (2026-11-02, migration_92; reworked 2026-11-05).
 * Interactive HTML pages kept by book / set: upload them (files or a whole
 * folder, with audio), preview them with a live score check, and give any
 * of them to one or more groups as homework.
 *   - Search every page by passage name.
 *   - Choose a group to see which pages it has done ("New only" hides them).
 *   - Ticked pages from different sets collect in one basket.
 *   - Easy / medium / hard from real first tries (migration_96).
 *   - Each set can go on the students' shelf for all groups or chosen ones.
 */

export default function PracticeBank() {
  const [pages, setPages] = useState(null)
  const [missing, setMissing] = useState(false)
  const [skill, setSkill] = useState('reading')
  const [collection, setCollection] = useState(null)
  const [adding, setAdding] = useState(false)
  const [given, setGiven] = useState({}) // url -> Set(groupId)
  const [groups, setGroups] = useState([])
  const [stats, setStats] = useState({})
  const [shelf, setShelf] = useState({}) // collection -> Set(groupId)
  const [shelfMissing, setShelfMissing] = useState(false)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [newOnly, setNewOnly] = useState(false)
  const [selected, setSelected] = useState(() => new Map()) // id -> page
  const [assign, setAssign] = useState(null)
  const [preview, setPreview] = useState(null)
  const [typeOpen, setTypeOpen] = useState(false)
  const [topicOpen, setTopicOpen] = useState(false)
  const [error, setError] = useState('')
  const [topic, setTopic] = useState('')
  const [sets, setSets] = useState(null) // saved sets (null before migration_97)
  const [setName, setSetName] = useState(null) // naming a new set
  const [report, setReport] = useState(null)

  const load = async () => {
    const r = await loadBank()
    setPages(r.pages)
    setMissing(r.missing)
    loadGivenPages().then(setGiven)
    loadPageStats().then(setStats)
    supabase.from('groups').select('id, name, created_at, telegram_chat_id').order('created_at').then(({ data }) => setGroups(data || []))
    loadSets().then(setSets)
    supabase.from('group_shelf').select('group_id, collection').then(({ data, error: e }) => {
      setShelfMissing(Boolean(e))
      const m = {}
      ;(data || []).forEach((x) => (m[x.collection] = m[x.collection] || new Set()).add(x.group_id))
      setShelf(m)
    })
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

  const doneBy = (p, gid) => Boolean(gid && given[p.url]?.has(gid))
  const collections = useMemo(() => {
    const map = {}
    ;(pages || []).filter((p) => (p.skill || 'reading') === skill).forEach((p, i) => {
      map[p.collection] = map[p.collection] || { name: p.collection, n: 0, types: new Set(), shelf: 0, given: 0, fresh: 0 }
      const c = map[p.collection]
      c.n += 1
      if (p.question_type) c.types.add(p.question_type)
      if (p.on_shelf) c.shelf += 1
      if (given[p.url]?.size) c.given += 1
      if (!doneBy(p, groupFilter)) c.fresh += 1
    })
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, skill, given, groupFilter])

  const badgesFor = (p) =>
    groups
      .map((g, i) => ({ g, c: groupColour(i) }))
      .filter(({ g }) => given[p.url]?.has(g.id))
      .map(({ g, c }) => ({ key: g.id, label: groupBadge(g.name), cls: `${c.tint} ${c.text}`, title: `Given to ${groupDisplayName(g.name)}` }))

  const toggle = (p) =>
    setSelected((prev) => {
      const n = new Map(prev)
      if (n.has(p.id)) n.delete(p.id)
      else n.set(p.id, p)
      return n
    })
  const chosen = [...selected.values()]

  const update = async (ids, patch) => {
    setError('')
    const { error: err } = await supabase.from('materials').update(patch).in('id', ids)
    if (err) setError(err.message)
    load()
  }
  const remove = async () => {
    if (!window.confirm(`Delete ${chosen.length} page${chosen.length === 1 ? '' : 's'} from the bank? Homework that already uses them keeps working.`)) return
    const { error: err } = await supabase.from('materials').delete().in('id', chosen.map((p) => p.id))
    if (err) setError(err.message)
    setSelected(new Map())
    load()
  }

  if (missing) {
    return <p className="rounded-[20px] bg-panel px-5 py-4 text-sm font-bold text-mist">Run migration_92_practice_bank.sql to use the Practice Bank.</p>
  }

  const tabs = BANK_SKILLS.filter((s) => counts[s.value] || s.value === skill)
  const q = search.trim().toLowerCase()
  const found = q || topic
    ? (pages || [])
        .filter((p) => !q || `${p.title} ${p.collection} ${p.topic || ''}`.toLowerCase().includes(q))
        .filter((p) => !topic || p.topic === topic)
        .filter((p) => !(newOnly && doneBy(p, groupFilter)))
        .slice(0, 100)
    : null
  const books = {}
  collections.forEach((c, i) => {
    const { book } = splitSet(c.name)
    ;(books[book] = books[book] || []).push({ ...c, i })
  })

  return (
    <div className="flex flex-col gap-5 pb-24">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {!collection && (
          <div role="tablist" className="flex gap-1 rounded-[16px] border border-line bg-panel p-1">
            {tabs.map((s) => {
              const on = s.value === skill
              return (
                <button
                  key={s.value}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSkill(s.value)}
                  className={`focus-ring flex h-10 items-baseline gap-2 rounded-[12px] px-4 pt-2.5 text-sm font-extrabold transition ${on ? 'text-white' : 'text-paper-dim hover:bg-panel-2 hover:text-paper'}`}
                  style={on ? { backgroundColor: skillShade(s.value, 0) } : undefined}
                >
                  {s.label}
                  <span className={`text-[12px] ${on ? 'text-white/75' : 'text-mist'}`}>{counts[s.value] || 0}</span>
                </button>
              )
            })}
          </div>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search every page by passage name…"
          className="focus-ring h-11 min-w-[200px] flex-1 rounded-[14px] border border-line bg-panel px-4 text-sm text-paper placeholder:text-mist/70"
        />
        <select
          value={groupFilter}
          onChange={(e) => {
            setGroupFilter(e.target.value)
            if (!e.target.value) setNewOnly(false)
          }}
          className="focus-ring h-11 rounded-[14px] border border-line bg-panel px-3 text-sm font-extrabold text-paper"
          aria-label="Show which pages a group has done"
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              For {groupDisplayName(g.name)}
            </option>
          ))}
        </select>
        {groupFilter && (
          <button
            type="button"
            aria-pressed={newOnly}
            onClick={() => setNewOnly((v) => !v)}
            className={`focus-ring h-11 rounded-[14px] px-3.5 text-sm font-extrabold ${newOnly ? 'bg-brass text-onbrass' : 'border border-line bg-panel text-paper-dim'}`}
          >
            {newOnly ? '✓ New only' : 'New only'}
          </button>
        )}
        <button type="button" onClick={() => setAdding(true)} className="focus-ring h-11 rounded-[14px] border border-line bg-panel px-4 text-sm font-extrabold text-brass hover:border-brass">
          + Add pages
        </button>
      </div>

      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}

      {pages === null ? (
        <p className="text-sm font-semibold text-mist">Loading…</p>
      ) : found ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-bold text-mist">{found.length ? `${found.length} page${found.length === 1 ? '' : 's'}${topic ? ` about ${topic}` : ''}` : 'Nothing found — try another word from the passage title.'}</p>
            {topic && <button type="button" onClick={() => setTopic('')} className="focus-ring text-[12px] font-extrabold text-brass">× Clear topic</button>}
          </div>
          <ul className="grid gap-1.5 md:grid-cols-2">
            {found.map((p) => (
              <PageRow
                key={p.id}
                page={p}
                showType
                checked={selected.has(p.id)}
                onToggle={() => toggle(p)}
                stat={stats[p.url]}
                given={badgesFor(p)}
                onReport={setReport}
                actions={<PreviewButton onClick={() => setPreview(p)} />}
              />
            ))}
          </ul>
        </section>
      ) : collection ? (
        <CollectionView
          name={collection}
          pages={(pages || []).filter((p) => p.collection === collection).filter((p) => !(newOnly && doneBy(p, groupFilter)))}
          allCount={(pages || []).filter((p) => p.collection === collection).length}
          onBack={() => setCollection(null)}
          onChanged={load}
          selected={selected}
          onToggle={toggle}
          onSelectMany={(list, on) =>
            setSelected((prev) => {
              const n = new Map(prev)
              list.forEach((p) => (on ? n.set(p.id, p) : n.delete(p.id)))
              return n
            })
          }
          groupFilter={groupFilter}
          doneBy={doneBy}
          badgesFor={badgesFor}
          stats={stats}
          groups={groups}
          shelfGroups={shelf[collection] || new Set()}
          shelfMissing={shelfMissing}
          onPreview={setPreview}
          onReport={setReport}
          onRenamed={(n) => {
            setCollection(n)
            load()
          }}
        />
      ) : (
        <>
          <WeeklyDrafts pages={pages || []} given={given} stats={stats} groups={groups} onPosted={load} />

          {sets && sets.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-brand text-[17px] font-semibold text-paper">Saved sets</h2>
              <ul className="flex gap-2 overflow-x-auto pb-1">
                {sets.map((st) => {
                  const list = (pages || []).filter((p) => st.material_ids.includes(p.id))
                  return (
                    <li key={st.id} className="flex w-60 shrink-0 flex-col gap-2 rounded-[16px] border border-line bg-panel p-3">
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 text-[14px] font-extrabold leading-snug text-paper">{st.name}</p>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(`Delete the set “${st.name}”? The pages stay in the bank.`)) return
                            try {
                              await deleteSet(st.id)
                            } catch (e) {
                              setError(e.message)
                            }
                            load()
                          }}
                          aria-label={`Delete set ${st.name}`}
                          className="focus-ring grid h-6 w-6 shrink-0 place-items-center rounded-md text-mist hover:text-coral"
                        >
                          ×
                        </button>
                      </div>
                      <p className="truncate text-[12px] font-semibold text-mist">{list.length} pages · {list.map((p) => shortTitle(p.title)).slice(0, 3).join(', ')}</p>
                      <div className="mt-auto flex gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setSelected((prev) => {
                              const n = new Map(prev)
                              list.forEach((p) => n.set(p.id, p))
                              return n
                            })
                          }
                          className="focus-ring h-8 flex-1 rounded-[10px] bg-panel-2 text-[12px] font-extrabold text-paper-dim hover:text-paper"
                        >
                          Into basket
                        </button>
                        <button type="button" onClick={() => setAssign(list)} disabled={!list.length} className="focus-ring h-8 flex-1 rounded-[10px] bg-brass/10 text-[12px] font-extrabold text-brass hover:bg-brass/20 disabled:opacity-50">
                          Give
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {skill === 'reading' && (pages || []).some((p) => p.topic) && (
            <section className="flex flex-col gap-2">
              <h2 className="font-brand text-[17px] font-semibold text-paper">By topic</h2>
              <div className="flex flex-wrap gap-1.5">
                {TOPICS.map((t) => {
                  const n = (pages || []).filter((p) => p.topic === t).length
                  if (!n) return null
                  return (
                    <button key={t} type="button" onClick={() => setTopic(t)} className="focus-ring h-9 rounded-[12px] border border-line bg-panel px-3 text-[13px] font-extrabold text-paper-dim hover:border-brass hover:text-paper">
                      {t} <span className="text-mist">{n}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      {pages === null || found || collection ? null : collections.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line bg-panel px-5 py-10 text-center">
          <p className="font-brand text-[17px] font-semibold text-paper">No {BANK_SKILLS.find((x) => x.value === skill)?.label} pages yet</p>
          <p className="mt-1 text-sm font-semibold text-mist">Press “Add pages” and choose a whole book folder.</p>
        </div>
      ) : (
        Object.entries(books).map(([book, list]) => (
          <section key={book || '-'} className="flex flex-col gap-3">
            {book && (
              <div className="flex items-baseline gap-3">
                <h2 className="font-brand text-[20px] font-semibold text-paper">{book}</h2>
                <span className="text-[13px] font-bold text-mist">
                  {list.reduce((n, c) => n + c.n, 0)} pages · {list.length} sets
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {list.map((c) => (
                <BookCoverCard
                  key={c.name}
                  name={c.name}
                  types={c.types}
                  count={c.n}
                  skill={skill}
                  index={c.i}
                  onClick={() => setCollection(c.name)}
                  footer={
                    <>
                      {groupFilter ? (
                        <span className={c.fresh ? 'text-reading' : 'text-mist'}>· {c.fresh} new for this group</span>
                      ) : (
                        c.given > 0 && <span className="text-paper-dim">· {c.given} given</span>
                      )}
                      {c.shelf > 0 && (
                        <span className="rounded-md bg-reading-tint px-1.5 py-0.5 text-[11px] font-extrabold text-reading">
                          {shelf[c.name]?.size ? `Shelf · ${shelf[c.name].size} group${shelf[c.name].size === 1 ? '' : 's'}` : 'On shelf'}
                        </span>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          </section>
        ))
      )}

      {/* Basket — pages ticked anywhere */}
      {chosen.length > 0 && (
        <div className="fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-[20px] border border-brass/40 bg-panel p-3 shadow-2xl md:bottom-5">
          <span className="text-sm font-extrabold text-paper">{chosen.length} picked</span>
          <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {chosen.slice(0, 12).map((p) => (
              <li key={p.id} className="flex max-w-[180px] shrink-0 items-center gap-1 rounded-[10px] bg-brass/10 py-0.5 pl-2 pr-0.5 text-[12px] font-extrabold text-paper">
                <span className="truncate">{shortTitle(p.title)}</span>
                <button type="button" onClick={() => toggle(p)} aria-label={`Remove ${p.title}`} className="focus-ring grid h-5 w-5 place-items-center rounded-md text-mist hover:text-coral">×</button>
              </li>
            ))}
            {chosen.length > 12 && <li className="shrink-0 px-1 text-[12px] font-extrabold text-mist">+{chosen.length - 12}</li>}
          </ul>
          <div className="relative">
            <button type="button" onClick={() => setTypeOpen((v) => !v)} className="focus-ring h-10 rounded-[14px] border border-line px-3 text-[13px] font-extrabold text-paper">Question type…</button>
            {typeOpen && (
              <div className="absolute bottom-full right-0 z-30 mb-1 max-h-72 w-64 overflow-y-auto rounded-[14px] border border-line bg-panel-2 py-1 shadow-xl">
                {QUESTION_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setTypeOpen(false)
                      update(chosen.map((p) => p.id), { question_type: t.value })
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-paper hover:bg-panel"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {skill === 'reading' && (
            <div className="relative">
              <button type="button" onClick={() => setTopicOpen((v) => !v)} className="focus-ring h-10 rounded-[14px] border border-line px-3 text-[13px] font-extrabold text-paper">Topic…</button>
              {topicOpen && (
                <div className="absolute bottom-full right-0 z-30 mb-1 max-h-72 w-56 overflow-y-auto rounded-[14px] border border-line bg-panel-2 py-1 shadow-xl">
                  {TOPICS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTopicOpen(false)
                        update(chosen.map((p) => p.id), { topic: t })
                      }}
                      className="block w-full px-3 py-2 text-left text-sm text-paper hover:bg-panel"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {sets !== null &&
            (setName === null ? (
              <button type="button" onClick={() => setSetName('')} className="focus-ring h-10 rounded-[14px] border border-line px-3 text-[13px] font-extrabold text-paper">Save as set</button>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!setName.trim()) return
                  try {
                    await saveSet(setName.trim(), chosen.map((p) => p.id))
                    setSetName(null)
                    load()
                  } catch (err) {
                    setError(err.message)
                  }
                }}
                className="flex gap-1"
              >
                <input autoFocus value={setName} onChange={(e) => setSetName(e.target.value)} placeholder="Set name, e.g. Week 3 TFNG" className="focus-ring h-10 w-48 rounded-[12px] border border-line bg-panel-2 px-3 text-sm text-paper" />
                <button type="submit" className="focus-ring h-10 rounded-[12px] bg-brass px-3 text-[13px] font-extrabold text-onbrass">Save</button>
              </form>
            ))}
          <button type="button" onClick={remove} className="focus-ring h-10 rounded-[14px] px-3 text-[13px] font-extrabold text-coral hover:bg-urgent-tint">Delete</button>
          <button type="button" onClick={() => setSelected(new Map())} className="focus-ring h-10 px-2 text-[13px] font-bold text-mist">Clear</button>
          <button type="button" onClick={() => setAssign(chosen)} className="focus-ring h-10 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a]">
            Give as homework
          </button>
        </div>
      )}

      {preview && <PagePreview page={preview} onClose={() => setPreview(null)} />}
      {report && <PageReport page={report} onClose={() => setReport(null)} />}
      {assign && (
        <AssignPagesModal
          pages={assign}
          initialGroups={groupFilter ? [groupFilter] : []}
          onClose={() => setAssign(null)}
          onDone={() => {
            setSelected(new Map())
            load()
          }}
        />
      )}
      {adding && (
        <AddPages
          skill={collection ? (pages || []).find((p) => p.collection === collection)?.skill || skill : skill}
          fixedCollection={collection || undefined}
          collections={collection ? [collection] : [...new Set((pages || []).map((p) => p.collection))]}
          existing={pages || []}
          onClose={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false)
            load().then(() => name && setCollection(name))
          }}
        />
      )}
    </div>
  )
}

function PreviewButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className="focus-ring shrink-0 rounded-[10px] px-2 py-1 text-[12px] font-extrabold text-brass hover:bg-panel-2"
    >
      Open
    </button>
  )
}

function CollectionView({ name, pages, allCount, onBack, onChanged, onRenamed, selected, onToggle, onSelectMany, groupFilter, doneBy, badgesFor, stats, groups, shelfGroups, shelfMissing, onPreview, onReport }) {
  const [order, setOrder] = useState('book') // 'book' | 'easy'
  const [renaming, setRenaming] = useState(null)
  const [shelfOpen, setShelfOpen] = useState(false)
  const [error, setError] = useState('')
  const skill = pages[0]?.skill || 'reading'
  const shelfable = skill === 'reading' || skill === 'listening'
  const onShelf = pages.length > 0 && pages.every((p) => p.on_shelf)
  const { book, subtitle } = splitSet(name)

  // "Easiest first" (ladder): pages with 3+ first tries by their average,
  // highest first; pages nobody has tried yet keep book order after them.
  const ease = (p) => (stats[p.url]?.tries >= 3 ? stats[p.url].avg : -1)
  const ordered = order === 'easy' ? [...pages].sort((a, b) => ease(b) - ease(a) || (a.position ?? 0) - (b.position ?? 0)) : pages
  const rated = pages.filter((p) => stats[p.url]?.tries >= 3).length
  const groupsByType = useMemo(() => {
    const out = []
    ordered.forEach((p) => {
      const k = p.question_type || ''
      let g = out.find((x) => x.k === k)
      if (!g) out.push((g = { k, items: [] }))
      g.items.push(p)
    })
    return out
  }, [ordered])

  const setShelfOn = async (on) => {
    setError('')
    const { error: err } = await supabase.from('materials').update({ on_shelf: on }).eq('collection', name)
    if (err) setError(err.message)
    onChanged()
  }
  const toggleShelfGroup = async (gid) => {
    setError('')
    const has = shelfGroups.has(gid)
    const { error: err } = has
      ? await supabase.from('group_shelf').delete().eq('group_id', gid).eq('collection', name)
      : await supabase.from('group_shelf').insert({ group_id: gid, collection: name })
    if (err) setError(err.message)
    onChanged()
  }
  const rename = async () => {
    const n = renaming.trim()
    if (!n || n === name) return setRenaming(null)
    const { error: err } = await supabase.from('materials').update({ collection: n }).eq('collection', name)
    if (err) return setError(err.message)
    await supabase.from('group_shelf').update({ collection: n }).eq('collection', name)
    setRenaming(null)
    onRenamed(n)
  }

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="focus-ring self-start text-sm font-extrabold text-brass">← Practice Bank</button>
      <div className="relative z-20 flex flex-wrap items-center gap-3 rounded-[20px] border border-line bg-panel">
        <span className="w-2 self-stretch rounded-l-[20px]" style={{ backgroundColor: skillShade(skill, 0) }} aria-hidden="true" />
        <div className="min-w-0 flex-1 py-4">
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
            <>
              {book && <p className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-mist">{book}</p>}
              <p className="font-brand text-[22px] font-semibold text-paper">{subtitle}</p>
            </>
          )}
          <p className="text-[13px] font-semibold text-mist">
            {pages.length < allCount ? `${pages.length} new of ${allCount}` : `${allCount}`} pages · tick pages (from any set), then give them as homework
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-4 pr-4 sm:pb-0">
          {renaming === null && (
            <button type="button" onClick={() => setRenaming(name)} className="focus-ring h-9 rounded-[12px] px-3 text-[13px] font-extrabold text-mist hover:text-paper">Rename</button>
          )}
          {shelfable && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShelfOpen((v) => !v)}
                aria-expanded={shelfOpen}
                title="Students can practise these pages on their own"
                className={`focus-ring h-10 rounded-[14px] px-3.5 text-[13px] font-extrabold ${onShelf ? 'bg-reading text-white' : 'bg-panel-2 text-paper-dim'}`}
              >
                {onShelf ? (shelfGroups.size ? `On shelf · ${shelfGroups.size} group${shelfGroups.size === 1 ? '' : 's'}` : 'On shelf · all groups') : 'Students’ shelf'} ▾
              </button>
              {shelfOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 flex w-72 flex-col gap-3 rounded-[16px] border border-line bg-panel-2 p-4 shadow-xl">
                  <label className="flex items-center gap-2 text-sm font-extrabold text-paper">
                    <input type="checkbox" checked={onShelf} onChange={(e) => setShelfOn(e.target.checked)} className="h-4 w-4 accent-brass" />
                    On the students’ practice shelf
                  </label>
                  {onShelf && !shelfMissing && (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-semibold text-mist">Only for some groups? Tick them. A group with sets ticked sees only its own sets; the rest see every set on the shelf.</p>
                      <div className="flex flex-wrap gap-1.5">
                        {groups.map((g, i) => {
                          const c = groupColour(i)
                          const on = shelfGroups.has(g.id)
                          return (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => toggleShelfGroup(g.id)}
                              aria-pressed={on}
                              className={`focus-ring h-8 rounded-[10px] border-2 px-2.5 text-[12px] font-extrabold ${on ? `${c.border} ${c.tint} ${c.text}` : 'border-transparent bg-panel text-paper-dim'}`}
                            >
                              {groupDisplayName(g.name)}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {onShelf && shelfMissing && <p className="text-xs font-semibold text-mist">Run migration_96 to choose groups.</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}

      {groupsByType.map((g) => {
        const all = g.items.every((p) => selected.has(p.id))
        const fresh = groupFilter ? g.items.filter((p) => !doneBy(p, groupFilter) && !selected.has(p.id)) : []
        return (
          <section key={g.k} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] font-extrabold uppercase tracking-[0.1em] text-mist">{g.k ? qtypeLabel(g.k) : 'Pages'} · {g.items.length}</p>
              <button type="button" onClick={() => onSelectMany(g.items, !all)} className="focus-ring text-[12px] font-extrabold text-brass">
                {all ? 'Untick all' : 'Tick all'}
              </button>
              {groupsByType.indexOf(g) === 0 && (
                <span className="ml-auto flex gap-1 rounded-[12px] bg-panel p-0.5" role="group" aria-label="Order">
                  {[
                    ['book', 'Book order'],
                    ['easy', `Easiest first${rated ? ` · ${rated} rated` : ''}`],
                  ].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setOrder(k)} aria-pressed={order === k} className={`focus-ring h-8 rounded-[10px] px-2.5 text-[12px] font-extrabold ${order === k ? 'bg-brass text-onbrass' : 'text-paper-dim'}`}>
                      {l}
                    </button>
                  ))}
                </span>
              )}
              {fresh.length > 0 && (
                <button type="button" onClick={() => onSelectMany(fresh.slice(0, 3), true)} className="focus-ring rounded-[10px] bg-brass/10 px-2.5 py-1 text-[12px] font-extrabold text-brass hover:bg-brass/20">
                  Pick 3 new for this group
                </button>
              )}
            </div>
            <ul className="grid gap-1.5 md:grid-cols-2">
              {g.items.map((p) => (
                <PageRow
                  key={p.id}
                  page={p}
                  checked={selected.has(p.id)}
                  onToggle={() => onToggle(p)}
                  stat={stats[p.url]}
                  given={badgesFor(p)}
                  onReport={onReport}
                  actions={<PreviewButton onClick={() => onPreview(p)} />}
                />
              ))}
            </ul>
          </section>
        )
      })}
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
