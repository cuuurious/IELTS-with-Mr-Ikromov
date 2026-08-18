import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }

  if (name === 'plus') {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    )
  }

  if (name === 'refresh') {
    return (
      <svg {...common}>
        <path d="M20 11a8.1 8.1 0 0 0-14.9-4L3 10" />
        <path d="M3 5v5h5" />
        <path d="M4 13a8.1 8.1 0 0 0 14.9 4L21 14" />
        <path d="M21 19v-5h-5" />
      </svg>
    )
  }

  if (name === 'chart') {
    return (
      <svg {...common}>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M8 16v-5" />
        <path d="M12 16V7" />
        <path d="M16 16v-8" />
      </svg>
    )
  }

  if (name === 'close') {
    return (
      <svg {...common}>
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    )
  }

  if (name === 'check') {
    return (
      <svg {...common}>
        <path d="m5 12 4 4L19 6" />
      </svg>
    )
  }

  return null
}

export default function TeacherWordlists({ teacherId }) {
  const [groups, setGroups] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)
  const [lists, setLists] = useState([])
  const [creating, setCreating] = useState(false)
  const [viewingResults, setViewingResults] = useState(null)
  const [resettingId, setResettingId] = useState(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const loadGroups = async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('created_at')

      if (error) {
        console.error('Could not load groups:', error)
        return
      }

      setGroups(data || [])

      if (data?.length) {
        setActiveGroup(data[0].id)
      }
    }

    loadGroups()
  }, [])

  const loadLists = async () => {
    if (!activeGroup) return

    const { data, error } = await supabase
      .from('wordlists')
      .select(
        `
          *,
          wordlist_items(count)
        `
      )
      .eq('group_id', activeGroup)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Could not load word lists:', error)
      return
    }

    setLists(data || [])
  }

  useEffect(() => {
    loadLists()

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup])

  const resetCompletion = async (list) => {
    const confirmed = window.confirm(
      `Reset completion for "${list.title}"?\n\nStudents will be able to complete this vocabulary list again. Previous attempts will remain in your results history.`
    )

    if (!confirmed) return

    setResettingId(list.id)
    setNotice('')

    try {
      const { error } = await supabase
        .from('wordlists')
        .update({
          completion_reset_at:
            new Date().toISOString(),
        })
        .eq('id', list.id)

      if (error) throw error

      setNotice(
        `"${list.title}" is ready for a fresh student attempt.`
      )

      await loadLists()

      window.setTimeout(() => {
        setNotice('')
      }, 3500)
    } catch (err) {
      console.error('Could not reset word list:', err)

      setNotice(
        err?.message ||
          'Could not reset this word list.'
      )
    } finally {
      setResettingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-7">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">

        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-brass font-mono mb-2">
            Vocabulary studio
          </div>

          <h1 className="font-display text-2xl sm:text-3xl text-paper">
            Word lists
          </h1>

          <p className="text-mist text-sm mt-2 max-w-xl leading-relaxed">
            Build focused vocabulary practice for your students.
            Review generated definitions before publishing, then
            monitor their progress over time.
          </p>
        </div>

        {!creating && activeGroup && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="focus-ring inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-brass text-onbrass font-medium hover:bg-brass-dim transition-colors"
          >
            <Icon name="plus" size={17} />
            New word list
          </button>
        )}

      </div>

      {/* =====================================================
          GROUP NAVIGATION
      ===================================================== */}

      {groups.length === 0 && (
        <div className="border border-line bg-panel-2 px-4 py-5 rounded-lg">
          <p className="text-mist text-sm">
            Create a group first.
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="border-b border-line">
          <div className="flex gap-1 overflow-x-auto pb-px">

            {groups.map((group) => {
              const active =
                activeGroup === group.id

              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() =>
                    setActiveGroup(group.id)
                  }
                  className={`
                    focus-ring shrink-0 px-4 py-2.5 text-sm
                    border-b-2 transition-colors
                    ${
                      active
                        ? 'border-brass text-paper'
                        : 'border-transparent text-mist hover:text-paper'
                    }
                  `}
                >
                  {group.name}
                </button>
              )
            })}

          </div>
        </div>
      )}

      {/* =====================================================
          NOTICE
      ===================================================== */}

      {notice && (
        <div className="flex items-start gap-3 border border-sage/30 bg-sage/10 rounded-md px-4 py-3">

          <span className="text-sage mt-0.5">
            <Icon name="check" size={17} />
          </span>

          <p className="text-sm text-sage">
            {notice}
          </p>

        </div>
      )}

      {activeGroup && (
        <>
          {/* =================================================
              CREATION FORM
          ================================================= */}

          {creating && (
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
          )}

          {/* =================================================
              LISTS
          ================================================= */}

          {!creating && (
            <div className="flex flex-col gap-3">

              {lists.length === 0 && (
                <div className="border border-line bg-panel-2 rounded-lg px-5 py-10 text-center">

                  <div className="text-brass text-[11px] uppercase tracking-[0.18em] font-mono">
                    No vocabulary yet
                  </div>

                  <p className="text-mist text-sm mt-2">
                    Create your first word list for this group.
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      setCreating(true)
                    }
                    className="focus-ring mt-5 inline-flex items-center gap-2 text-sm text-brass hover:underline"
                  >
                    <Icon name="plus" size={15} />
                    Create word list
                  </button>

                </div>
              )}

              {lists.map((list) => {
                const count =
                  list.wordlist_items?.[0]
                    ?.count ?? 0

                const isResetting =
                  resettingId === list.id

                return (
                  <article
                    key={list.id}
                    className="
                      group
                      border border-line
                      bg-panel-2
                      rounded-lg
                      px-4 sm:px-5
                      py-4
                      transition-all
                      hover:border-brass/40
                    "
                  >

                    <div className="flex flex-col lg:flex-row lg:items-center gap-4">

                      {/* LIST INFORMATION */}

                      <div className="min-w-0 flex-1">

                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] uppercase tracking-[0.16em] font-mono text-brass">
                            Vocabulary
                          </span>

                          {list.completion_reset_at && (
                            <span className="text-[10px] uppercase tracking-[0.12em] font-mono text-sage">
                              Resettable
                            </span>
                          )}
                        </div>

                        <h2 className="font-display text-lg sm:text-xl text-paper truncate">
                          {list.title}
                        </h2>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-mist font-mono">

                          <span>
                            {count}{' '}
                            {count === 1
                              ? 'item'
                              : 'items'}
                          </span>

                          <span className="text-line">
                            ·
                          </span>

                          <span>
                            posted{' '}
                            {new Date(
                              list.created_at
                            ).toLocaleDateString()}
                          </span>

                          {list.completion_reset_at && (
                            <>
                              <span className="text-line">
                                ·
                              </span>

                              <span className="text-sage">
                                practice reset{' '}
                                {new Date(
                                  list.completion_reset_at
                                ).toLocaleDateString()}
                              </span>
                            </>
                          )}

                        </div>

                      </div>

                      {/* ACTIONS */}

                      <div className="flex flex-wrap items-center gap-2">

                        <button
                          type="button"
                          onClick={() =>
                            setViewingResults(
                              list
                            )
                          }
                          className="
                            focus-ring
                            inline-flex items-center
                            justify-center gap-2
                            px-3 py-2
                            rounded-md
                            border border-line
                            text-sm text-paper
                            hover:border-brass/60
                            hover:text-brass
                            transition-colors
                          "
                        >
                          <Icon
                            name="chart"
                            size={16}
                          />
                          Results
                        </button>

                        <button
                          type="button"
                          title="Reset student completion"
                          disabled={
                            isResetting
                          }
                          onClick={() =>
                            resetCompletion(
                              list
                            )
                          }
                          className="
                            focus-ring
                            inline-flex items-center
                            justify-center gap-2
                            px-3 py-2
                            rounded-md
                            border border-line
                            text-sm text-mist
                            hover:border-sage/60
                            hover:text-sage
                            transition-colors
                            disabled:opacity-50
                          "
                        >
                          <Icon
                            name="refresh"
                            size={16}
                          />

                          {isResetting
                            ? 'Resetting…'
                            : 'Reset practice'}
                        </button>

                      </div>

                    </div>

                  </article>
                )
              })}

            </div>
          )}

        </>
      )}

      {/* =====================================================
          RESULTS
      ===================================================== */}

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

/* ===========================================================
   NEW WORD LIST
   =========================================================== */

function NewWordlistForm({
  groupId,
  teacherId,
  onDone,
  onCancel,
}) {
  const [title, setTitle] =
    useState('')

  const [rawWords, setRawWords] =
    useState('')

  const [items, setItems] =
    useState(null)

  const [generating, setGenerating] =
    useState(false)

  const [saving, setSaving] =
    useState(false)

  const [error, setError] =
    useState('')

  const inputCount =
    rawWords
      .split('\n')
      .map((w) => w.trim())
      .filter(Boolean)
      .length

  const generate = async () => {
    const words =
      rawWords
        .split('\n')
        .map((w) => w.trim())
        .filter(Boolean)

    if (!words.length) {
      setError(
        'Paste at least one word or collocation first.'
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

      const resp = await fetch(
        '/.netlify/functions/define-words',
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

      const data =
        await resp.json()

      if (!resp.ok) {
        throw new Error(
          data.error ||
            'Failed to generate definitions.'
        )
      }

      setItems(
        data.results || []
      )
    } catch (err) {
      setError(
        err?.message ||
          'Could not generate the vocabulary list.'
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
      prev.map((item, i) =>
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
        data: wordlist,
        error: wordlistError,
      } = await supabase
        .from('wordlists')
        .insert({
          group_id: groupId,
          title: title.trim(),
          created_by: teacherId,
        })
        .select()
        .single()

      if (wordlistError) {
        throw wordlistError
      }

      const rows =
        items.map((item, index) => ({
          wordlist_id:
            wordlist.id,
          word: item.word,
          definition:
            item.definition,
          uzbek_translation:
            item.uzbek_translation,
          example_sentence:
            item.example_sentence,
          position: index,
        }))

      const {
        error: itemsError,
      } = await supabase
        .from('wordlist_items')
        .insert(rows)

      if (itemsError) {
        throw itemsError
      }

      onDone()
    } catch (err) {
      setError(
        err?.message ||
          'Could not publish the word list.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="border border-line bg-panel-2 rounded-lg overflow-hidden">

      {/* FORM HEADER */}

      <div className="px-4 sm:px-5 py-4 border-b border-line">

        <div className="text-[10px] uppercase tracking-[0.18em] font-mono text-brass">
          New vocabulary practice
        </div>

        <h2 className="font-display text-xl mt-1">
          Build a word list
        </h2>

        <p className="text-mist text-xs mt-1.5">
          Add as many words or collocations as you need.
          There is no fixed 30-item limit.
        </p>

      </div>

      <div className="p-4 sm:p-5 flex flex-col gap-4">

        {/* TITLE */}

        <div>
          <label className="text-[11px] uppercase tracking-[0.14em] text-mist font-mono">
            List title
          </label>

          <input
            value={title}
            onChange={(e) =>
              setTitle(e.target.value)
            }
            placeholder="e.g. Passage 3 — Environmental vocabulary"
            className="
              focus-ring
              w-full mt-1.5
              bg-panel
              border border-line
              rounded-md
              px-3 py-2.5
              text-paper
            "
          />
        </div>

        {/* WORD INPUT */}

        {!items && (
          <>
            <div>

              <div className="flex items-end justify-between gap-3">

                <label className="text-[11px] uppercase tracking-[0.14em] text-mist font-mono">
                  Words & collocations
                </label>

                <span className="text-xs font-mono text-brass">
                  {inputCount}{' '}
                  {inputCount === 1
                    ? 'item'
                    : 'items'}
                </span>

              </div>

              <textarea
                value={rawWords}
                onChange={(e) =>
                  setRawWords(
                    e.target.value
                  )
                }
                rows={9}
                placeholder={
                  'One word or collocation per line\n\nmitigate\npose a threat\ntake into account\nheavy rainfall'
                }
                className="
                  focus-ring
                  w-full mt-1.5
                  bg-panel
                  border border-line
                  rounded-md
                  px-3 py-3
                  font-mono
                  text-sm
                  leading-6
                  resize-y
                "
              />

              <p className="text-xs text-mist mt-2">
                One item per line. Words and multi-word
                collocations are both supported.
              </p>

            </div>

            {error && (
              <p className="text-coral text-sm">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">

              <button
                type="button"
                onClick={generate}
                disabled={
                  generating ||
                  !inputCount
                }
                className="
                  focus-ring
                  inline-flex items-center
                  justify-center
                  px-4 py-2.5
                  rounded-md
                  bg-brass
                  text-onbrass
                  font-medium
                  hover:bg-brass-dim
                  transition-colors
                  disabled:opacity-50
                "
              >
                {generating
                  ? 'Preparing vocabulary…'
                  : `Generate ${inputCount || ''} items`}
              </button>

              <button
                type="button"
                onClick={onCancel}
                className="
                  focus-ring
                  px-4 py-2.5
                  rounded-md
                  border border-line
                  text-mist
                  hover:text-paper
                  hover:border-brass/50
                  transition-colors
                "
              >
                Cancel
              </button>

            </div>
          </>
        )}

        {/* GENERATED ITEMS */}

        {items && (
          <>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">

              <p className="text-mist text-xs">
                Review every item before publishing.
                Students will see exactly this content.
              </p>

              <span className="shrink-0 text-xs font-mono text-brass">
                {items.length}{' '}
                {items.length === 1
                  ? 'item'
                  : 'items'}
              </span>

            </div>

            <div className="flex flex-col gap-2 max-h-[32rem] overflow-y-auto pr-1">

              {items.map(
                (item, index) => (
                  <div
                    key={`${item.word}-${index}`}
                    className="
                      border border-line
                      bg-panel
                      rounded-md
                      p-3
                      flex flex-col gap-2
                    "
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
                        item.definition ||
                        ''
                      }
                      onChange={(e) =>
                        updateItem(
                          index,
                          'definition',
                          e.target.value
                        )
                      }
                      placeholder="Definition"
                      className="
                        focus-ring
                        bg-panel-2
                        border border-line
                        rounded-md
                        px-2.5 py-2
                        text-sm
                      "
                    />

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
                      className="
                        focus-ring
                        bg-panel-2
                        border border-line
                        rounded-md
                        px-2.5 py-2
                        text-sm
                      "
                    />

                    <input
                      value={
                        item.example_sentence ||
                        ''
                      }
                      onChange={(e) =>
                        updateItem(
                          index,
                          'example_sentence',
                          e.target.value
                        )
                      }
                      placeholder="Example sentence"
                      className="
                        focus-ring
                        bg-panel-2
                        border border-line
                        rounded-md
                        px-2.5 py-2
                        text-sm
                      "
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

            <div className="flex flex-wrap gap-2">

              <button
                type="button"
                onClick={publish}
                disabled={
                  saving ||
                  !title.trim()
                }
                className="
                  focus-ring
                  px-4 py-2.5
                  rounded-md
                  bg-brass
                  text-onbrass
                  font-medium
                  hover:bg-brass-dim
                  transition-colors
                  disabled:opacity-50
                "
              >
                {saving
                  ? 'Publishing…'
                  : `Publish ${items.length} items`}
              </button>

              <button
                type="button"
                onClick={() =>
                  setItems(null)
                }
                className="
                  focus-ring
                  px-4 py-2.5
                  rounded-md
                  border border-line
                  text-mist
                  hover:text-paper
                  hover:border-brass/50
                  transition-colors
                "
              >
                Back
              </button>

            </div>

          </>
        )}

      </div>
    </section>
  )
}

/* ===========================================================
   RESULTS
   =========================================================== */

function ResultsModal({
  wordlist,
  onClose,
}) {
  const [attempts, setAttempts] =
    useState(null)

  useEffect(() => {
    const loadAttempts =
      async () => {
        const {
          data,
          error,
        } = await supabase
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

        if (error) {
          console.error(
            'Could not load attempts:',
            error
          )
        }

        setAttempts(data || [])
      }

    loadAttempts()
  }, [wordlist.id])

  return (
    <div
      className="
        fixed inset-0
        bg-black/60
        backdrop-blur-sm
        flex items-center
        justify-center
        p-4
        z-50
      "
      onClick={onClose}
    >

      <div
        className="
          bg-panel
          border border-line
          rounded-lg
          p-5 sm:p-6
          max-w-lg
          w-full
          max-h-[85vh]
          overflow-y-auto
          flex flex-col gap-4
          shadow-2xl
        "
        onClick={(e) =>
          e.stopPropagation()
        }
      >

        {/* HEADER */}

        <div className="flex items-start justify-between gap-4">

          <div>

            <div className="text-[10px] uppercase tracking-[0.18em] font-mono text-brass mb-1">
              Results
            </div>

            <h2 className="font-display text-xl text-paper">
              {wordlist.title}
            </h2>

            <p className="text-xs text-mist mt-1">
              Previous attempts remain available even
              after a practice reset.
            </p>

          </div>

          <button
            type="button"
            onClick={onClose}
            className="
              focus-ring
              shrink-0
              text-mist
              hover:text-paper
              p-1
            "
            aria-label="Close"
          >
            <Icon
              name="close"
              size={19}
            />
          </button>

        </div>

        {/* RESULTS */}

        {attempts === null && (
          <p className="text-mist text-sm">
            Loading results…
          </p>
        )}

        {attempts?.length === 0 && (
          <div className="border border-line rounded-md px-4 py-6 text-center">
            <p className="text-mist text-sm">
              No attempts yet.
            </p>
          </div>
        )}

        {attempts?.map(
          (attempt) => (
            <div
              key={attempt.id}
              className="
                border border-line
                bg-panel-2
                rounded-md
                px-4 py-3
              "
            >

              <div className="flex items-center justify-between gap-3">

                <div className="min-w-0">

                  <div className="font-medium text-paper truncate">
                    {attempt.profiles
                      ?.full_name ||
                      attempt.profiles
                        ?.username ||
                      'Student'}
                  </div>

                  {attempt.profiles
                    ?.username && (
                    <div className="text-[11px] text-mist font-mono mt-0.5">
                      @
                      {
                        attempt
                          .profiles
                          .username
                      }
                    </div>
                  )}

                </div>

                <div className="text-right shrink-0">

                  <div className="font-mono text-lg text-brass">
                    {attempt.percentage}%
                  </div>

                  <div className="text-[10px] text-mist uppercase tracking-wide">
                    score
                  </div>

                </div>

              </div>

              <div className="text-mist text-xs font-mono mt-3">
                {attempt.score}/
                {attempt.total} correct
                {' · '}
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