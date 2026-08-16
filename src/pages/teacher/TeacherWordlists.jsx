import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function TeacherWordlists({ teacherId }) {
  const [groups, setGroups] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)
  const [lists, setLists] = useState([])
  const [creating, setCreating] = useState(false)
  const [viewingResults, setViewingResults] = useState(null)

  useEffect(() => {
    supabase
      .from('groups')
      .select('*')
      .order('created_at')
      .then(({ data }) => {
        setGroups(data || [])
        if (data?.length) setActiveGroup(data[0].id)
      })
  }, [])

  const loadLists = async () => {
    if (!activeGroup) return
    const { data } = await supabase
      .from('wordlists')
      .select('*, wordlist_items(count)')
      .eq('group_id', activeGroup)
      .order('created_at', { ascending: false })
    setLists(data || [])
  }

  useEffect(() => {
    loadLists()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup])

  return (
    <div className="flex flex-col gap-5">
      {groups.length === 0 && <p className="text-mist">Create a group first.</p>}
      {groups.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setActiveGroup(g.id)}
              className={`focus-ring px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeGroup === g.id
                  ? 'bg-brass text-onbrass border-brass font-medium'
                  : 'border-line text-mist hover:text-paper'
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {activeGroup && (
        <>
          {creating ? (
            <NewWordlistForm
              groupId={activeGroup}
              teacherId={teacherId}
              onDone={() => {
                setCreating(false)
                loadLists()
              }}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium hover:bg-brass-dim transition-colors w-fit"
            >
              + New word list
            </button>
          )}

          <div className="flex flex-col gap-2">
            {lists.map((list) => (
              <div key={list.id} className="ticket rounded-lg p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="font-display text-lg">{list.title}</div>
                  <div className="text-mist text-xs font-mono">
                    {list.wordlist_items?.[0]?.count ?? 0} words · posted{' '}
                    {new Date(list.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => setViewingResults(list)}
                  className="focus-ring px-3 py-1.5 rounded-md border border-line text-sm hover:border-brass hover:text-brass transition-colors"
                >
                  View results
                </button>
              </div>
            ))}
            {lists.length === 0 && (
              <p className="text-mist text-sm">No word lists for this group yet.</p>
            )}
          </div>
        </>
      )}

      {viewingResults && (
        <ResultsModal wordlist={viewingResults} onClose={() => setViewingResults(null)} />
      )}
    </div>
  )
}

function NewWordlistForm({ groupId, teacherId, onDone, onCancel }) {
  const [title, setTitle] = useState('')
  const [rawWords, setRawWords] = useState('')
  const [items, setItems] = useState(null) // after AI generation, editable
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const generate = async () => {
    const words = rawWords
      .split('\n')
      .map((w) => w.trim())
      .filter(Boolean)
    if (!words.length) {
      setError('Paste at least one word first.')
      return
    }
    setGenerating(true)
    setError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      const resp = await fetch('/.netlify/functions/define-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ words }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Failed to generate definitions.')
      setItems(data.results)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const updateItem = (i, field, value) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)))
  }

  const publish = async () => {
    if (!title.trim() || !items?.length) return
    setSaving(true)
    setError('')
    try {
      const { data: wl, error: wlErr } = await supabase
        .from('wordlists')
        .insert({ group_id: groupId, title: title.trim(), created_by: teacherId })
        .select()
        .single()
      if (wlErr) throw wlErr

      const rows = items.map((it, i) => ({
        wordlist_id: wl.id,
        word: it.word,
        definition: it.definition,
        uzbek_translation: it.uzbek_translation,
        example_sentence: it.example_sentence,
        position: i,
      }))
      const { error: itemsErr } = await supabase.from('wordlist_items').insert(rows)
      if (itemsErr) throw itemsErr

      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ticket rounded-lg p-4 flex flex-col gap-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (e.g. Passage 3 vocabulary — Lesson 5)"
        className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2"
      />

      {!items && (
        <>
          <textarea
            value={rawWords}
            onChange={(e) => setRawWords(e.target.value)}
            rows={6}
            placeholder={'One word or collocation per line, e.g.\nimitate\nsubconscious\ntrial and error'}
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 font-mono text-sm"
          />
          {error && <p className="text-coral text-sm">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={generate}
              disabled={generating}
              className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-50"
            >
              {generating ? 'Generating…' : 'Generate definitions with AI'}
            </button>
            <button
              onClick={onCancel}
              className="focus-ring px-4 py-2 rounded-md border border-line text-mist"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {items && (
        <>
          <p className="text-mist text-xs">
            Review and edit before publishing — students will see exactly this.
          </p>
          <div className="flex flex-col gap-3 max-h-96 overflow-y-auto">
            {items.map((it, i) => (
              <div key={i} className="bg-panel-2 border border-line rounded-md p-3 flex flex-col gap-2">
                <div className="font-medium">{it.word}</div>
                <input
                  value={it.definition}
                  onChange={(e) => updateItem(i, 'definition', e.target.value)}
                  placeholder="Definition"
                  className="focus-ring bg-panel border border-line rounded-md px-2 py-1.5 text-sm"
                />
                <input
                  value={it.uzbek_translation}
                  onChange={(e) => updateItem(i, 'uzbek_translation', e.target.value)}
                  placeholder="Uzbek translation"
                  className="focus-ring bg-panel border border-line rounded-md px-2 py-1.5 text-sm"
                />
                <input
                  value={it.example_sentence}
                  onChange={(e) => updateItem(i, 'example_sentence', e.target.value)}
                  placeholder="Example sentence"
                  className="focus-ring bg-panel border border-line rounded-md px-2 py-1.5 text-sm"
                />
              </div>
            ))}
          </div>
          {error && <p className="text-coral text-sm">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={publish}
              disabled={saving || !title.trim()}
              className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-50"
            >
              {saving ? 'Publishing…' : 'Publish to group'}
            </button>
            <button
              onClick={() => setItems(null)}
              className="focus-ring px-4 py-2 rounded-md border border-line text-mist"
            >
              Back
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ResultsModal({ wordlist, onClose }) {
  const [attempts, setAttempts] = useState(null)

  useEffect(() => {
    supabase
      .from('wordlist_attempts')
      .select('*, profiles(full_name, username)')
      .eq('wordlist_id', wordlist.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setAttempts(data || []))
  }, [wordlist.id])

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="ticket rounded-lg p-6 max-w-md w-full max-h-[85vh] overflow-y-auto flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-display text-xl">{wordlist.title}</h2>
          <button onClick={onClose} className="focus-ring text-mist hover:text-paper text-xl leading-none">
            ×
          </button>
        </div>
        {attempts === null && <p className="text-mist text-sm">Loading…</p>}
        {attempts?.length === 0 && <p className="text-mist text-sm">No attempts yet.</p>}
        {attempts?.map((a) => (
          <div key={a.id} className="bg-panel-2 border border-line rounded-md p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{a.profiles?.full_name}</span>
              <span className="font-mono text-sm text-brass">{a.percentage}%</span>
            </div>
            <div className="text-mist text-xs font-mono mt-1">
              {a.score}/{a.total} correct · {new Date(a.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
