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
    <div className="flex flex-col gap-5">

      {groups.length === 0 && (
        <p className="text-mist">
          Create a group first.
        </p>
      )}

      {groups.length > 0 && (
        <div className="flex gap-2 flex-wrap">

          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() =>
                setActiveGroup(g.id)
              }
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
              onCancel={() =>
                setCreating(false)
              }
            />
          ) : (
            <button
              onClick={() =>
                setCreating(true)
              }
              className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium hover:bg-brass-dim transition-colors w-fit"
            >
              + New word list
            </button>
          )}

          <div className="flex flex-col gap-2">

            {lists.map((list) => (
              <div
                key={list.id}
                className="ticket rounded-lg p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-display text-lg">
                    {list.title}
                  </div>

                  <div className="text-mist text-xs font-mono">
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
                  className="focus-ring px-3 py-1.5 rounded-md border border-line text-sm hover:border-brass hover:text-brass transition-colors"
                >
                  View results
                </button>
              </div>
            ))}

            {lists.length === 0 && (
              <p className="text-mist text-sm">
                No word lists for this group yet.
              </p>
            )}

          </div>
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
      .map((w) => w.trim())
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

      /*
       * Do not blindly call resp.json().
       * If Netlify returns an empty/non-JSON response,
       * this gives the teacher a useful error instead of:
       * "Unexpected end of JSON input".
       */
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

      /*
       * Keep only the fields needed by the new
       * translation-only generator.
       *
       * Definition and example_sentence are deliberately
       * kept empty for compatibility with the existing
       * database schema.
       */
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

      /*
       * Keep definition/example columns empty for new
       * translation-only wordlists.
       *
       * We do NOT remove those database columns because
       * older wordlists may still use them.
       */
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
    <div className="ticket rounded-lg p-4 flex flex-col gap-3">

      <input
        value={title}
        onChange={(e) =>
          setTitle(
            e.target.value
          )
        }
        placeholder="Title (e.g. Passage 3 vocabulary — Lesson 5)"
        className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2"
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
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2 font-mono text-sm"
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

          <div className="flex gap-2">

            <button
              onClick={generate}
              disabled={
                generating
              }
              className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-50"
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
            Review and edit the Uzbek
            translations before publishing.
            Students will see exactly these
            translations.
          </p>

          <div className="flex flex-col gap-3 max-h-96 overflow-y-auto">

            {items.map(
              (item, index) => (
                <div
                  key={`${item.word}-${index}`}
                  className="bg-panel-2 border border-line rounded-md p-3 flex flex-col gap-2"
                >

                  <div className="flex items-center justify-between gap-3">

                    <div className="font-medium">
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
                    className="focus-ring bg-panel border border-line rounded-md px-2 py-1.5 text-sm"
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

          <div className="flex gap-2">

            <button
              onClick={publish}
              disabled={
                saving ||
                !title.trim()
              }
              className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-50"
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

function ResultsModal({
  wordlist,
  onClose,
}) {
  const [attempts, setAttempts] =
    useState(null)

  useEffect(() => {
    supabase
      .from('wordlist_attempts')
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
      .then(({ data }) =>
        setAttempts(
          data || []
        )
      )
  }, [wordlist.id])

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="ticket rounded-lg p-6 max-w-md w-full max-h-[85vh] overflow-y-auto flex flex-col gap-3"
        onClick={(e) =>
          e.stopPropagation()
        }
      >

        <div className="flex items-start justify-between">

          <h2 className="font-display text-xl">
            {wordlist.title}
          </h2>

          <button
            onClick={onClose}
            className="focus-ring text-mist hover:text-paper text-xl leading-none"
          >
            ×
          </button>

        </div>

        {attempts === null && (
          <p className="text-mist text-sm">
            Loading…
          </p>
        )}

        {attempts?.length ===
          0 && (
          <p className="text-mist text-sm">
            No attempts yet.
          </p>
        )}

        {attempts?.map(
          (attempt) => (
            <div
              key={
                attempt.id
              }
              className="bg-panel-2 border border-line rounded-md p-3"
            >

              <div className="flex items-center justify-between">

                <span className="font-medium">
                  {
                    attempt
                      .profiles
                      ?.full_name
                  }
                </span>

                <span className="font-mono text-sm text-brass">
                  {
                    attempt.percentage
                  }
                  %
                </span>

              </div>

              <div className="text-mist text-xs font-mono mt-1">
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
    </div>
  )
}