import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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

        if (data?.length) {
          setActiveGroup(data[0].id)
        }
      })
  }, [])

  const loadLists = async () => {
    if (!activeGroup) return

    const { data } = await supabase
      .from('wordlists')
      .select('*, wordlist_items(count)')
      .eq('group_id', activeGroup)
      .order('created_at', {
        ascending: false,
      })

    setLists(data || [])
  }

  useEffect(() => {
    loadLists()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup])

  return (
    <div className="flex flex-col gap-6">

      {/* GROUP SELECTOR */}
      {groups.length === 0 && (
        <div className="surface rounded-xl p-6">
          <p className="text-mist">
            Create a group first.
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {groups.map((group) => {
            const active =
              activeGroup === group.id

            return (
              <button
                key={group.id}
                onClick={() =>
                  setActiveGroup(group.id)
                }
                className={`focus-ring px-4 py-2 rounded-lg text-sm border transition-colors ${
                  active
                    ? 'bg-brass text-onbrass border-brass font-medium'
                    : 'bg-panel border-line text-mist hover:text-paper hover:border-brass'
                }`}
              >
                {group.name}
              </button>
            )
          })}
        </div>
      )}

      {activeGroup && (
        <>
          {/* CREATE */}
          {creating ? (
            <NewWordlistForm
              groupId={activeGroup}
              teacherId={teacherId}
              onDone={() => {
                setCreating(false)
                loadLists()
              }}
              onCancel={() =>
                setCreating(false)
              }
            />
          ) : (
            <button
              onClick={() =>
                setCreating(true)
              }
              className="btn-primary w-fit"
            >
              + New word list
            </button>
          )}

          {/* WORD LISTS */}
          <section className="flex flex-col gap-4">

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
                  Vocabulary
                </div>

                <h2 className="font-display text-2xl sm:text-3xl mt-1">
                  Word lists
                </h2>
              </div>

              <div className="text-xs font-mono text-mist border border-line rounded-full px-3 py-1.5">
                {lists.length} list
                {lists.length === 1 ? '' : 's'}
              </div>
            </div>

            <div className="flex flex-col gap-3">

              {lists.map((list) => (
                <div
                  key={list.id}
                  className="ticket p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="font-display text-xl text-paper">
                      {list.title}
                    </div>

                    <div className="text-mist text-xs font-mono mt-1">
                      {list.wordlist_items?.[0]?.count ?? 0}{' '}
                      words · posted{' '}
                      {new Date(
                        list.created_at
                      ).toLocaleDateString()}
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      setViewingResults(list)
                    }
                    className="btn-secondary shrink-0"
                  >
                    View results
                  </button>
                </div>
              ))}

              {lists.length === 0 && (
                <div className="surface rounded-xl p-8 text-center">
                  <p className="text-mist text-sm">
                    No word lists for this group yet.
                  </p>
                </div>
              )}

            </div>
          </section>
        </>
      )}

      {viewingResults && (
        <ResultsModal
          wordlist={viewingResults}
          onClose={() =>
            setViewingResults(null)
          }
        />
      )}

    </div>
  )
}


/* ============================================================
   NEW WORD LIST
   ============================================================ */

function NewWordlistForm({
  groupId,
  teacherId,
  onDone,
  onCancel,
}) {
  const [title, setTitle] = useState('')
  const [rawWords, setRawWords] = useState('')
  const [items, setItems] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const generate = async () => {
    const words = rawWords
      .split('\n')
      .map((word) => word.trim())
      .filter(Boolean)

    if (!words.length) {
      setError(
        'Paste at least one word or collocation first.'
      )
      return
    }

    if (words.length > 250) {
      setError(
        `You entered ${words.length} items. Please use 250 words or fewer at a time.`
      )
      return
    }

    setGenerating(true)
    setError('')

    try {
      const {
        data: sessionData,
      } =
        await supabase.auth.getSession()

      const token =
        sessionData?.session
          ?.access_token

      if (!token) {
        throw new Error(
          'Your session has expired. Please log in again.'
        )
      }

      const resp = await fetch(
        'https://grdfwleehlgoooizyowz.supabase.co/functions/v1/define-words',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            words,
          }),
        }
      )

      const responseText =
        await resp.text()

      let data = null

      if (responseText.trim()) {
        try {
          data =
            JSON.parse(
              responseText
            )
        } catch {
          throw new Error(
            `The translation service returned an invalid response (${resp.status}). Please try again.`
          )
        }
      }

      if (!resp.ok) {
        throw new Error(
          data?.error ||
            `Translation service failed (${resp.status}).`
        )
      }

      if (
        !data ||
        !Array.isArray(
          data.results
        )
      ) {
        throw new Error(
          'The translation service did not return a valid word list.'
        )
      }

      const cleanedResults =
        data.results.map(
          (item) => ({
            word:
              item?.word || '',
            definition: '',
            uzbek_translation:
              item?.uzbek_translation ||
              '',
            example_sentence: '',
          })
        )

      setItems(
        cleanedResults
      )
    } catch (err) {
      console.error(
        'Word translation generation failed:',
        err
      )

      setError(
        err?.message ||
          'Could not generate translations.'
      )
    } finally {
      setGenerating(false)
    }
  }

  const updateItem = (
    index,
    field,
    value
  ) => {
    setItems((prev) =>
      prev.map(
        (item, i) =>
          i === index
            ? {
                ...item,
                [field]: value,
              }
            : item
      )
    )
  }

  const publish = async () => {
    if (
      !title.trim() ||
      !items?.length
    ) {
      return
    }

    setSaving(true)
    setError('')

    try {
      const {
        data: wl,
        error: wlErr,
      } =
        await supabase
          .from('wordlists')
          .insert({
            group_id:
              groupId,
            title:
              title.trim(),
            created_by:
              teacherId,
          })
          .select()
          .single()

      if (wlErr) {
        throw wlErr
      }

      const rows =
        items.map(
          (item, index) => ({
            wordlist_id:
              wl.id,
            word:
              item.word,
            definition: '',
            uzbek_translation:
              item.uzbek_translation ||
              '',
            example_sentence: '',
            position:
              index,
          })
        )

      const {
        error: itemsErr,
      } =
        await supabase
          .from(
            'wordlist_items'
          )
          .insert(rows)

      if (itemsErr) {
        throw itemsErr
      }

      onDone()
    } catch (err) {
      console.error(
        'Wordlist publishing failed:',
        err
      )

      setError(
        err?.message ||
          'Could not publish the word list.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ticket p-5 flex flex-col gap-4">

      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
          New vocabulary
        </div>

        <h2 className="font-display text-2xl mt-1">
          Create a word list
        </h2>
      </div>

      <input
        value={title}
        onChange={(e) =>
          setTitle(
            e.target.value
          )
        }
        placeholder="Title (e.g. Passage 3 vocabulary — Lesson 5)"
        className="focus-ring bg-panel-2 border border-line rounded-lg px-3 py-2.5 text-paper"
      />

      {!items && (
        <>
          <textarea
            value={rawWords}
            onChange={(e) =>
              setRawWords(
                e.target.value
              )
            }
            rows={8}
            placeholder={
              'One word or collocation per line, e.g.\nimitate\nsubconscious\ntrial and error'
            }
            className="focus-ring bg-panel-2 border border-line rounded-lg px-3 py-2.5 font-mono text-sm text-paper resize-y"
          />

          <p className="text-mist text-xs">
            Maximum 250 words or collocations.
            Only Uzbek translations will be generated.
          </p>

          {error && (
            <p className="text-coral text-sm">
              {error}
            </p>
          )}

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={generate}
              disabled={generating}
              className="btn-primary disabled:opacity-50"
            >
              {generating
                ? 'Generating translations…'
                : 'Generate translations'}
            </button>

            <button
              onClick={
                onCancel
              }
              disabled={
                generating
              }
              className="btn-secondary disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {items && (
        <>
          <p className="text-mist text-xs">
            Review and edit the Uzbek
            translations before publishing.
            Students will see exactly these
            translations.
          </p>

          <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-1">

            {items.map(
              (item, index) => (
                <div
                  key={`${item.word}-${index}`}
                  className="bg-panel-2 border border-line rounded-lg p-3 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-paper">
                      {item.word}
                    </div>

                    <span className="text-[10px] font-mono text-mist">
                      {index + 1}/
                      {items.length}
                    </span>
                  </div>

                  <input
                    value={
                      item.uzbek_translation ||
                      ''
                    }
                    onChange={(e) =>
                      updateItem(
                        index,
                        'uzbek_translation',
                        e.target.value
                      )
                    }
                    placeholder="Uzbek translation"
                    className="focus-ring bg-panel border border-line rounded-lg px-2.5 py-2 text-sm text-paper"
                  />
                </div>
              )
            )}

          </div>

          {error && (
            <p className="text-coral text-sm">
              {error}
            </p>
          )}

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={publish}
              disabled={
                saving ||
                !title.trim()
              }
              className="btn-primary disabled:opacity-50"
            >
              {saving
                ? 'Publishing…'
                : 'Publish to group'}
            </button>

            <button
              onClick={() =>
                setItems(null)
              }
              disabled={saving}
              className="btn-secondary disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </>
      )}

    </div>
  )
}


/* ============================================================
   RESULTS MODAL
   ============================================================ */

function ResultsModal({
  wordlist,
  onClose,
}) {
  const [attempts, setAttempts] =
    useState(null)

  useEffect(() => {
    const loadAttempts = async () => {
      const { data } =
        await supabase
          .from(
            'wordlist_attempts'
          )
          .select(
            '*, profiles(full_name, username)'
          )
          .eq(
            'wordlist_id',
            wordlist.id
          )
          .order(
            'created_at',
            {
              ascending: false,
            }
          )

      setAttempts(
        data || []
      )
    }

    loadAttempts()
  }, [wordlist.id])

  /*
   * Render directly into document.body.
   *
   * This is the important fix:
   * the modal is no longer affected by the
   * dashboard's layout/overflow/stacking context.
   */
  if (
    typeof document === 'undefined'
  ) {
    return null
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${wordlist.title} results`}
      onClick={onClose}
    >

      {/* BACKDROP */}
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px]" />

      {/* MODAL */}
      <div
        className="relative z-10 w-full max-w-2xl max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
        onClick={(e) =>
          e.stopPropagation()
        }
      >

        {/* HEADER */}
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-5 border-b border-line bg-panel">

          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
              Student results
            </div>

            <h2 className="font-display text-2xl sm:text-3xl mt-1 truncate">
              {wordlist.title}
            </h2>
          </div>

          <button
            onClick={onClose}
            className="focus-ring shrink-0 h-9 w-9 rounded-full border border-line text-mist hover:text-paper hover:border-brass transition-colors text-xl leading-none"
            aria-label="Close results"
          >
            ×
          </button>

        </div>

        {/* CONTENT */}
        <div className="overflow-y-auto max-h-[calc(100vh-9rem)] p-4 sm:p-5">

          {attempts === null && (
            <div className="surface rounded-xl p-8 text-center">
              <p className="text-mist text-sm">
                Loading results…
              </p>
            </div>
          )}

          {attempts?.length === 0 && (
            <div className="surface rounded-xl p-8 text-center">
              <p className="text-mist text-sm">
                No attempts yet.
              </p>
            </div>
          )}

          {attempts?.length > 0 && (
            <div className="flex flex-col gap-3">

              {attempts.map(
                (attempt) => (
                  <div
                    key={
                      attempt.id
                    }
                    className="bg-panel-2 border border-line rounded-xl p-4"
                  >

                    <div className="flex items-center justify-between gap-4">

                      <span className="font-medium text-paper">
                        {
                          attempt
                            .profiles
                            ?.full_name ||
                          attempt
                            .profiles
                            ?.username ||
                          'Student'
                        }
                      </span>

                      <span
                        className={`font-mono text-sm font-medium ${
                          attempt.percentage >= 90
                            ? 'text-sage'
                            : attempt.percentage >= 70
                              ? 'text-brass'
                              : 'text-coral'
                        }`}
                      >
                        {
                          attempt.percentage
                        }%
                      </span>

                    </div>

                    <div className="text-mist text-xs font-mono mt-1.5">
                      {attempt.score}/
                      {
                        attempt.total
                      }{' '}
                      correct ·{' '}
                      {new Date(
                        attempt.created_at
                      ).toLocaleString()}
                    </div>

                  </div>
                )
              )}

            </div>
          )}

        </div>

      </div>

    </div>,
    document.body
  )
}