import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import ConfirmModal from '../../components/ConfirmModal'
import { useSessionState } from '../../lib/sessionState'
import Icon from '../../components/Icon'
import { groupBadge, groupColour, groupDisplayName } from '../../lib/groupLook'

// Strips a leading list marker off one pasted line — "1.", "12)",
// "3 -", or a bullet glyph like •/‣/◦/●/○/▪/▸ — before it's treated as
// a word or collocation. Word lists are often pasted in from a
// numbered source, and sometimes from TWO of them back to back (the
// numbering restarting partway down, e.g. 1–54 then 1 again) — without
// this, the number/bullet was being sent along as if it were part of
// the word itself ("1. abandon"), which is what a teacher actually
// saw baked into a generated list, and is also a very plausible cause
// of the AI/dictionary lookup failing outright for some of those
// lines. A real hyphenated word at the start of a line (e.g.
// "-year-old") is left alone — the dash-bullet pattern only matches
// when a space follows the dash/asterisk.
function stripListMarker(line) {
  return String(line || '')
    .replace(/^\s*\(?\d{1,4}\)?[.):\-]\s*/, '')
    .replace(/^\s*[•‣◦▪▸●○∙·]\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    .trim()
}


export default function TeacherWordlists({ teacherId }) {
  const [groups, setGroups] = useState([])
  // Remembered across a refresh (Jasur, 2026-09-30).
  const [activeGroup, setActiveGroup] = useSessionState(`ielts:${teacherId}:wordlists:group`, null)

  // Every word list this teacher owns, and every group it's linked to
  // (across ALL groups, not just the active tab) — fetched together
  // once, instead of the old approach of re-fetching the teacher's
  // entire word list collection PLUS a links query every single time
  // a different group tab was clicked. Switching tabs is now just a
  // client-side filter of what's already in memory (see `lists`
  // below), with zero network requests.
  const [ownedLists, setOwnedLists] = useState([])
  const [groupLinks, setGroupLinks] = useState([])

  const [creating, setCreating] = useState(false)
  const [viewingResults, setViewingResults] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)

  const [editingList, setEditingList] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editGroupIds, setEditGroupIds] = useState([])
  const [editItems, setEditItems] = useState([])
  
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editGenerating, setEditGenerating] = useState(false)
  const [editRegenerating, setEditRegenerating] = useState(false)
  const [editError, setEditError] = useState('')

  useEffect(() => {
    const loadGroups = async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('created_at')

      if (error) {
        console.error('Failed to load groups:', error)
        return
      }

      setGroups(data || [])

      if (data?.length && (!activeGroup || !data.some((g) => g.id === activeGroup))) {
        setActiveGroup(data[0].id)
      }
    }

    loadGroups()
  }, [activeGroup])

  const loadWordlistsData = async () => {
    if (!teacherId) return

    const { data: ownedListsData, error: listsError } =
      await supabase
        .from('wordlists')
        .select('*, wordlist_items(count)')
        .eq('created_by', teacherId)
        .order('created_at', { ascending: false })

    if (listsError) {
      console.error('Failed to load word lists:', listsError)
      setOwnedLists([])
      setGroupLinks([])
      return
    }

    setOwnedLists(ownedListsData || [])

    const ownedListIds = (ownedListsData || []).map(
      (list) => list.id
    )

    if (!ownedListIds.length) {
      setGroupLinks([])
      return
    }

    // Every link for every one of this teacher's word lists, in one
    // shot — not just the active group's — so switching tabs
    // afterwards never has to ask the server again.
    const { data: links, error: linksError } = await supabase
      .from('wordlist_groups')
      .select('wordlist_id, group_id')
      .in('wordlist_id', ownedListIds)

    if (linksError) {
      console.error('Failed to load word list group assignments:', linksError)
      setGroupLinks([])
      return
    }

    setGroupLinks(links || [])
  }

  useEffect(() => {
    loadWordlistsData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId])

  // The list shown for whichever group tab is active — purely a
  // client-side filter of ownedLists/groupLinks, so clicking between
  // group tabs is instant and never triggers a fetch.
  const lists = useMemo(() => {
    if (!activeGroup) return []

    const linkedIds = new Set(
      groupLinks
        .filter((link) => link.group_id === activeGroup)
        .map((link) => link.wordlist_id)
    )

    return ownedLists.filter(
      (list) =>
        linkedIds.has(list.id) ||
        list.group_id === activeGroup
    )
  }, [ownedLists, groupLinks, activeGroup])

  const deleteWordlist = (list) => {
    setConfirmDialog({
      title: `Delete "${list.title}" permanently?`,
      message: 'This will delete the word list, its words, group assignments, and stored student results.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'coral',
      onConfirm: () => doDeleteWordlist(list),
    })
  }

  const doDeleteWordlist = async (list) => {
    try {
      const { error: attemptsError } = await supabase
        .from('wordlist_attempts')
        .delete()
        .eq('wordlist_id', list.id)

      if (attemptsError) throw attemptsError

      const { error: itemsError } = await supabase
        .from('wordlist_items')
        .delete()
        .eq('wordlist_id', list.id)

      if (itemsError) throw itemsError

      const { error: linksError } = await supabase
        .from('wordlist_groups')
        .delete()
        .eq('wordlist_id', list.id)

      if (linksError) throw linksError

      const { error: listError } = await supabase
        .from('wordlists')
        .delete()
        .eq('id', list.id)
        .eq('created_by', teacherId)

      if (listError) throw listError

      if (viewingResults?.id === list.id) {
        setViewingResults(null)
      }

      await loadWordlistsData()
    } catch (err) {
      console.error('Word list deletion failed:', err)
      setConfirmDialog({
        title: "Couldn't delete this word list",
        message: err?.message || 'Unknown error',
        tone: 'coral',
        hideCancel: true,
      })
    }
  }


const openEditWordlist = async (list) => {
  setEditLoading(true)
  setEditError('')
  setEditingList(list)

  try {
    const [
      { data: items, error: itemsError },
      { data: links, error: linksError },
    ] = await Promise.all([
      supabase
        .from('wordlist_items')
        .select('*')
        .eq('wordlist_id', list.id)
        .order('position'),

      supabase
        .from('wordlist_groups')
        .select('group_id')
        .eq('wordlist_id', list.id),
    ])

    if (itemsError) throw itemsError
    if (linksError) throw linksError

    setEditTitle(list.title || '')

    /*
     * Some older lists may have their original
     * group only in wordlists.group_id.
     */
    const assignedGroupIds = [
      ...new Set([
        list.group_id,
        ...(links || []).map((link) => link.group_id),
      ].filter(Boolean)),
    ]

    setEditGroupIds(assignedGroupIds)

    setEditItems(
      (items || []).map((item) => ({
        id: item.id,
        word: item.word || '',
        definition: item.definition || '',
        uzbek_translation:
          item.uzbek_translation || '',
        example_sentence:
          item.example_sentence || '',
        position: item.position,
        isNew: false,
        clientId: item.id,
      }))
    )
  } catch (err) {
    console.error(
      'Failed to load word list for editing:',
      err
    )

    setEditError(
      err?.message ||
        'Could not load this word list.'
    )
  } finally {
    setEditLoading(false)
  }
}


const closeEditWordlist = () => {
  if (editSaving) return

  setEditingList(null)
  setEditTitle('')
  setEditGroupIds([])
  setEditItems([])
  setEditError('')
}

const updateEditItem = (
  index,
  field,
  value
) => {
  setEditItems((previous) =>
    previous.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            [field]: value,
          }
        : item
    )
  )
}


const addEditItem = () => {
  setEditItems((previous) => [
    {
      id: null,
      clientId:
        typeof crypto !== 'undefined' &&
        crypto.randomUUID
          ? crypto.randomUUID()
          : `new-${Date.now()}-${previous.length}`,
      isNew: true,
      word: '',
      definition: '',
      uzbek_translation: '',
      example_sentence: '',
      position: previous.length,
    },
    ...previous,
  ])
}

const removeEditItem = (index) => {
  setEditItems((previous) =>
    previous.filter(
      (_, itemIndex) => itemIndex !== index
    )
  )
}

const toggleEditGroup = (groupId) => {
  setEditGroupIds((previous) => {
    if (previous.includes(groupId)) {
      return previous.filter(
        (id) => id !== groupId
      )
    }

    return [...previous, groupId]
  })
}

const generateEditDetails = async () => {
  /*
   * Clean up any numbering/bullet a new word may have picked up (e.g.
   * pasting "1. abandon" straight into a single word field) before
   * anything else uses it — so the text sent to the AI, the text it's
   * matched back up against below, and the text actually saved all
   * agree on the same clean word.
   */
  const cleanedItems = editItems.map((item) =>
    item.isNew
      ? { ...item, word: stripListMarker(item.word) }
      : item
  )

  setEditItems(cleanedItems)

  /*
   * Only generate details for words added during this edit session.
   * Existing words are never sent again, so editing an old list does
   * not overwrite or reprocess its original vocabulary.
   */
  const newItems = cleanedItems.filter(
    (item) =>
      item.isNew &&
      item.word.trim()
  )

  if (!newItems.length) {
    setEditError(
      'Add a new word or collocation first, then enter it before generating details.'
    )
    return
  }

  if (newItems.length > 250) {
    setEditError(
      `You have ${newItems.length} new items. Please generate 250 words or fewer at a time.`
    )
    return
  }

  const wordsToGenerate = newItems.map(
    (item) => item.word.trim()
  )

  setEditGenerating(true)
  setEditError('')

  try {
    const {
      data: sessionData,
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      throw sessionError
    }

    const session = sessionData?.session

    if (!session?.access_token) {
      throw new Error(
        'Your session has expired. Please log in again.'
      )
    }

    const {
      data,
      error: functionError,
    } = await supabase.functions.invoke(
      'define-words',
      {
        body: {
          words: wordsToGenerate,
        },
        headers: {
          Authorization:
            `Bearer ${session.access_token}`,
        },
      }
    )

    if (functionError) {
      throw new Error(
        functionError.message ||
          'The word definition service failed.'
      )
    }

    if (
      !data ||
      !Array.isArray(data.results)
    ) {
      throw new Error(
        'The definition service did not return a valid word list.'
      )
    }

    const generatedByWord = new Map(
      data.results.map((item) => [
        (item?.word || '')
          .trim()
          .toLowerCase(),
        {
          definition:
            item?.definition || '',
          uzbek_translation:
            item?.uzbek_translation || '',
          example_sentence:
            item?.example_sentence || '',
        },
      ])
    )

    setEditItems((previous) =>
      previous.map((item) => {
        if (
          !item.isNew ||
          !item.word.trim()
        ) {
          return item
        }

        const generated =
          generatedByWord.get(
            item.word.trim().toLowerCase()
          )

        if (!generated) {
          return item
        }

        return {
          ...item,
          /*
           * Keep any details the teacher already typed manually.
           * Only fill fields that are still blank.
           */
          definition:
            item.definition ||
            generated.definition,
          uzbek_translation:
            item.uzbek_translation ||
            generated.uzbek_translation,
          example_sentence:
            item.example_sentence ||
            generated.example_sentence,
        }
      })
    )
  } catch (err) {
    console.error(
      'Edit word detail generation failed:',
      err
    )

    setEditError(
      err?.message ||
        'Could not generate details for the new words.'
    )
  } finally {
    setEditGenerating(false)
  }
}

/*
 * Re-fetches the definition/translation/example for EVERY item in this
 * list (not just ones added this session) and overwrites whatever was
 * there before — the fix for a list whose word/definition pairs got
 * scrambled by the old numbered-paste bug (a word like "36. packaging"
 * saved with the number still attached, paired with a different word's
 * definition). Re-running the whole list through the definition
 * service — which now strips stray numbering and pairs each result
 * back up by the word's own text — heals both problems in one pass.
 * This is a separate, opt-in action from "Generate details for new
 * words" above specifically because it overwrites existing entries,
 * including any the teacher already fixed by hand.
 */
const regenerateAllDetails = () => {
  if (!editItems.length) return

  setConfirmDialog({
    title: 'Regenerate every definition in this list?',
    message:
      "This re-fetches the definition, translation, and example for EVERY word below and replaces what's currently there — including anything you've edited by hand. Word text itself is also cleaned up (stray numbering like \"36. \" in front of a word is removed). This cannot be undone.",
    confirmLabel: 'Regenerate all',
    cancelLabel: 'Cancel',
    tone: 'coral',
    onConfirm: doRegenerateAllDetails,
  })
}

const doRegenerateAllDetails = async () => {
  /*
   * Clean up any leftover numbering/bullets on every word first — the
   * exact same cleanup newly-added words already get, just applied
   * retroactively to the whole list.
   */
  const cleanedItems = editItems.map((item) => ({
    ...item,
    word: stripListMarker(item.word),
  }))

  setEditItems(cleanedItems)

  const wordsToGenerate = cleanedItems
    .map((item) => item.word.trim())
    .filter(Boolean)

  if (!wordsToGenerate.length) {
    setEditError('This list has no words to regenerate.')
    return
  }

  if (wordsToGenerate.length > 250) {
    setEditError(
      `This list has ${wordsToGenerate.length} items. Please regenerate 250 words or fewer at a time.`
    )
    return
  }

  setEditRegenerating(true)
  setEditError('')

  try {
    const {
      data: sessionData,
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      throw sessionError
    }

    const session = sessionData?.session

    if (!session?.access_token) {
      throw new Error(
        'Your session has expired. Please log in again.'
      )
    }

    const {
      data,
      error: functionError,
    } = await supabase.functions.invoke(
      'define-words',
      {
        body: {
          words: wordsToGenerate,
        },
        headers: {
          Authorization:
            `Bearer ${session.access_token}`,
        },
      }
    )

    if (functionError) {
      throw new Error(
        functionError.message ||
          'The word definition service failed.'
      )
    }

    if (
      !data ||
      !Array.isArray(data.results)
    ) {
      throw new Error(
        'The definition service did not return a valid word list.'
      )
    }

    const generatedByWord = new Map(
      data.results.map((item) => [
        (item?.word || '')
          .trim()
          .toLowerCase(),
        {
          definition:
            item?.definition || '',
          uzbek_translation:
            item?.uzbek_translation || '',
          example_sentence:
            item?.example_sentence || '',
        },
      ])
    )

    setEditItems((previous) =>
      previous.map((item) => {
        const cleanedWord = stripListMarker(item.word)

        const generated = generatedByWord.get(
          cleanedWord.trim().toLowerCase()
        )

        if (!generated) {
          return { ...item, word: cleanedWord }
        }

        return {
          ...item,
          word: cleanedWord,
          definition: generated.definition,
          uzbek_translation: generated.uzbek_translation,
          example_sentence: generated.example_sentence,
        }
      })
    )
  } catch (err) {
    console.error(
      'Regenerating word list details failed:',
      err
    )

    setEditError(
      err?.message ||
        'Could not regenerate details for this word list.'
    )
  } finally {
    setEditRegenerating(false)
  }
}

const saveEditWordlist = async () => {
  if (!editingList) return

  const cleanTitle = editTitle.trim()

  if (!cleanTitle) {
    setEditError('Please enter a title for the word list.')
    return
  }

  const cleanItems = editItems
    .map((item, index) => ({
      ...item,
      word: item.word.trim(),
      definition: item.definition.trim(),
      uzbek_translation:
        item.uzbek_translation.trim(),
      example_sentence:
        item.example_sentence.trim(),
      position: index,
    }))
    .filter((item) => item.word)

  if (!cleanItems.length) {
    setEditError(
      'Add at least one word or collocation.'
    )
    return
  }

  if (!editGroupIds.length) {
    setEditError(
      'Select at least one group for this word list.'
    )
    return
  }

  setEditSaving(true)
  setEditError('')

  try {
    /*
     * 1. Update the word list title.
     * The main group_id remains the first
     * selected group.
     */

    const { error: listError } = await supabase
      .from('wordlists')
      .update({
        title: cleanTitle,
        group_id: editGroupIds[0],
      })
      .eq('id', editingList.id)
      .eq('created_by', teacherId)

    if (listError) throw listError


    /*
     * 2. Get the IDs of the words currently
     * stored in the database.
     */

    // Current values too (2026-10-06) so step 4 only writes rows that
    // actually changed.
    const { data: existingItems, error: existingError } =
      await supabase
        .from('wordlist_items')
        .select('id, word, definition, uzbek_translation, example_sentence, position')
        .eq('wordlist_id', editingList.id)

    if (existingError) throw existingError

    const existingIds = new Set(
      (existingItems || []).map(
        (item) => item.id
      )
    )


    /*
     * 3. Determine which existing words
     * were removed by the teacher.
     */

    const keptExistingIds = new Set(
      cleanItems
        .filter(
          (item) =>
            item.id &&
            existingIds.has(item.id)
        )
        .map((item) => item.id)
    )

    const removedIds = [...existingIds].filter(
      (id) => !keptExistingIds.has(id)
    )

    if (removedIds.length) {
      const { error: deleteItemsError } =
        await supabase
          .from('wordlist_items')
          .delete()
          .in('id', removedIds)

      if (deleteItemsError) {
        throw deleteItemsError
      }
    }


    /*
     * 4. Update existing words.
     */

    const existingToUpdate = cleanItems.filter(
      (item) =>
        item.id &&
        existingIds.has(item.id)
    )

    // ONE upsert of only the changed rows (2026-10-06 review) instead of
    // one UPDATE request per word — a 100-word list was 100 round trips.
    const existingById = new Map(
      (existingItems || []).map((row) => [row.id, row])
    )
    const changedRows = existingToUpdate
      .filter((item) => {
        const before = existingById.get(item.id)
        return (
          !before ||
          (before.word ?? '') !== (item.word ?? '') ||
          (before.definition ?? '') !== (item.definition ?? '') ||
          (before.uzbek_translation ?? '') !== (item.uzbek_translation ?? '') ||
          (before.example_sentence ?? '') !== (item.example_sentence ?? '') ||
          before.position !== item.position
        )
      })
      .map((item) => ({
        id: item.id,
        wordlist_id: editingList.id,
        word: item.word,
        definition: item.definition,
        uzbek_translation: item.uzbek_translation,
        example_sentence: item.example_sentence,
        position: item.position,
      }))

    if (changedRows.length) {
      const { error: updateItemError } =
        await supabase
          .from('wordlist_items')
          .upsert(changedRows, { onConflict: 'id' })

      if (updateItemError) {
        throw updateItemError
      }
    }


    /*
     * 5. Insert newly added words.
     */

    const newItems = cleanItems
      .filter(
        (item) =>
          !item.id ||
          !existingIds.has(item.id)
      )
      .map((item) => ({
        wordlist_id: editingList.id,
        word: item.word,
        definition: item.definition,
        uzbek_translation:
          item.uzbek_translation,
        example_sentence:
          item.example_sentence,
        position: item.position,
      }))

    if (newItems.length) {
      const { error: insertItemsError } =
        await supabase
          .from('wordlist_items')
          .insert(newItems)

      if (insertItemsError) {
        throw insertItemsError
      }
    }


    /*
     * 6. Replace group assignments.
     */

    // Add new links FIRST, then remove only the dropped ones (2026-10-06
    // review). It used to delete every link and re-insert — if the
    // insert failed, the list was left in no group at all.
    const { data: currentLinks, error: currentLinksError } =
      await supabase
        .from('wordlist_groups')
        .select('group_id')
        .eq('wordlist_id', editingList.id)

    if (currentLinksError) {
      throw currentLinksError
    }

    const currentGroupIds = new Set(
      (currentLinks || []).map((link) => link.group_id)
    )
    const wantedGroupIds = new Set(editGroupIds)

    const newLinks = editGroupIds
      .filter((groupId) => !currentGroupIds.has(groupId))
      .map((groupId) => ({
        wordlist_id: editingList.id,
        group_id: groupId,
      }))

    if (newLinks.length) {
      const { error: insertLinksError } =
        await supabase
          .from('wordlist_groups')
          .insert(newLinks)

      if (insertLinksError) {
        throw insertLinksError
      }
    }

    const removedGroupIds = [...currentGroupIds].filter(
      (groupId) => !wantedGroupIds.has(groupId)
    )

    if (removedGroupIds.length) {
      const { error: deleteLinksError } =
        await supabase
          .from('wordlist_groups')
          .delete()
          .eq('wordlist_id', editingList.id)
          .in('group_id', removedGroupIds)

      if (deleteLinksError) {
        throw deleteLinksError
      }
    }


    /*
     * 7. Delete old student attempts.
     *
     * Students must retake the updated list.
     */

    const { error: attemptsError } =
      await supabase
        .from('wordlist_attempts')
        .delete()
        .eq(
          'wordlist_id',
          editingList.id
        )

    if (attemptsError) {
      throw attemptsError
    }


    /*
     * 8. Reload the visible lists and close
     * the editor.
     */

    await loadWordlistsData()

    setEditingList(null)
    setEditItems([])
    setEditTitle('')
    setEditGroupIds([])
    setEditError('')

    setConfirmDialog({
      title: 'Word list updated',
      message:
        'The word list was successfully updated. Previous student results were cleared, so students can complete the updated list again.',
      hideCancel: true,
    })
  } catch (err) {
    console.error(
      'Word list update failed:',
      err
    )

    setEditError(
      err?.message ||
        'Could not save the word list changes.'
    )
  } finally {
    setEditSaving(false)
  }
}

  const getWordlistBadge = (title) => {
    const unitMatch = title?.match(/unit\s*(\d+)/i)
    if (unitMatch) return unitMatch[1]
    return (title || '?').trim().charAt(0).toUpperCase() || '?'
  }

  return (
    <div className="flex flex-col gap-6">

      {groups.length === 0 && (
        <div className="surface rounded-xl p-6">
          <p className="text-mist">
            Create a group first.
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <>

          {/* =================================================
              HEADER — title, description, group filter, and the
              create button all live inside one bounded card, so
              the button reads as part of this toolbar instead of
              a button floating alone out in empty page space.
          ================================================= */}

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-mist">
                Vocabulary sets your students review and get tested on, by class.
              </p>
              {activeGroup && !creating && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="focus-ring shrink-0 rounded-full bg-brass px-4 py-2 text-sm font-semibold text-onbrass transition hover:bg-brass-dim"
                >
                  + New word list
                </button>
              )}
            </div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Group">
              {groups.map((group, index) => {
                const active = activeGroup === group.id
                const c = groupColour(index)
                return (
                  <button
                    key={group.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveGroup(group.id)}
                    className={`focus-ring inline-flex shrink-0 items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 text-sm font-medium transition-colors ${
                      active ? 'border-brass bg-brass text-onbrass' : 'border-line bg-panel text-paper-dim hover:bg-panel-2'
                    }`}
                  >
                    <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-semibold ${c.tint} ${c.text}`}>
                      {groupBadge(group.name)}
                    </span>
                    {groupDisplayName(group.name)}
                  </button>
                )
              })}
            </div>
          </div>

        </>
      )}

      {activeGroup && (
        <>
          {creating && (
            <NewWordlistForm
              groups={groups}
              groupIds={[activeGroup]}
              teacherId={teacherId}
              onDone={() => {
                setCreating(false)
                loadWordlistsData()
              }}
              onCancel={() => setCreating(false)}
            />
          )}

          {!creating && (
            <section className="flex flex-col gap-4">

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-mist">
                  {lists.length} list{lists.length === 1 ? '' : 's'} for this group
                </span>
              </div>

              {lists.length === 0 ? (

                <div className="rounded-[22px] border border-dashed border-line bg-panel p-8 text-center">
                  <p className="text-mist text-sm">
                    No word lists for this group yet.
                  </p>

                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="focus-ring mt-3 text-sm font-semibold text-brass hover:underline"
                  >
                    + Create your first word list
                  </button>
                </div>

              ) : (

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">

                  {lists.map((list) => (
                    <div
                      key={list.id}
                      className="wp-pop group flex flex-col justify-between gap-4 rounded-[22px] border border-line bg-panel p-5 transition-shadow hover:shadow-[0_10px_28px_-16px_rgba(31,35,64,0.35)]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative h-11 w-11 shrink-0">
                          <span className="absolute inset-0 rotate-[-8deg] rounded-xl border border-[#F3D27A] bg-white transition-transform group-hover:rotate-[-14deg]" />
                          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-vocab-tint text-sm font-semibold text-vocab">
                            {getWordlistBadge(list.title)}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-semibold leading-snug text-paper">{list.title}</p>
                          <p className="mt-0.5 text-xs text-mist">
                            {list.wordlist_items?.[0]?.count ?? 0} words · {new Date(list.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setViewingResults(list)}
                          className="focus-ring flex-1 rounded-full bg-vocab-tint px-3 py-2 text-center text-sm font-semibold text-vocab transition hover:brightness-95"
                        >
                          View results
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditWordlist(list)}
                          className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-mist transition hover:bg-panel-2 hover:text-paper"
                          title="Edit word list"
                          aria-label="Edit word list"
                        >
                          <Icon name="pencil" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteWordlist(list)}
                          className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-mist transition hover:bg-urgent-tint hover:text-urgent"
                          title="Delete word list"
                          aria-label="Delete word list"
                        >
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}

                </div>

              )}

            </section>
          )}
        </>
      )}

      {editingList && (
  <EditWordlistModal
  wordlist={editingList}
  groups={groups}
  title={editTitle}
  setTitle={setEditTitle}
  groupIds={editGroupIds}
  toggleGroup={toggleEditGroup}
  items={editItems}
  updateItem={updateEditItem}
  addItem={addEditItem}
  removeItem={removeEditItem}
  onGenerate={generateEditDetails}
  generating={editGenerating}
  onRegenerateAll={regenerateAllDetails}
  regeneratingAll={editRegenerating}
  loading={editLoading}
  saving={editSaving}
  error={editError}
  onSave={saveEditWordlist}
  onClose={closeEditWordlist}
/>
)}

{viewingResults && (
  <ResultsModal
    wordlist={viewingResults}
    allGroups={groups}
    initialGroupId={activeGroup}
    onClose={() => setViewingResults(null)}
  />
)}

<ConfirmModal
  open={Boolean(confirmDialog)}
  {...confirmDialog}
  onCancel={() => setConfirmDialog(null)}
  onConfirm={() => {
    const run = confirmDialog?.onConfirm
    setConfirmDialog(null)
    run?.()
  }}
/>
    </div>
  )
}

/* ============================================================
   EDIT WORD LIST
   ============================================================
*/

function EditWordlistModal({
  wordlist,
  groups,
  title,
  setTitle,
  groupIds,
  toggleGroup,
  items,
  updateItem,
  addItem,
  removeItem,
  onGenerate,
  generating,
  onRegenerateAll,
  regeneratingAll,
  loading,
  saving,
  error,
  onSave,
  onClose,
}) {  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-6">
      <div className="surface my-4 w-full max-w-5xl rounded-2xl border border-line shadow-2xl">

        {/* HEADER */}

        <div className="flex items-start justify-between gap-4 border-b border-line p-5 sm:p-6">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
              Edit vocabulary
            </div>

            <h2 className="font-display text-2xl sm:text-3xl mt-1">
              Edit word list
            </h2>

            <p className="text-sm text-mist mt-2">
              Changes will require students to complete
              the updated word list again.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-mist transition hover:text-paper hover:border-brass disabled:opacity-40"
            aria-label="Close editor"
          >
            ×
          </button>
        </div>


        <div className="p-5 sm:p-6 flex flex-col gap-6">

          {loading ? (
            <div className="py-16 text-center text-mist">
              Loading word list...
            </div>
          ) : (
            <>

              {/* TITLE */}

              <div>
                <label className="text-xs font-mono uppercase tracking-[0.14em] text-mist">
                  Word list title
                </label>

                <input
                  type="text"
                  value={title}
                  onChange={(e) =>
                    setTitle(e.target.value)
                  }
                  className="focus-ring mt-2 w-full rounded-xl border border-line bg-panel px-4 py-3 text-paper outline-none transition focus:border-brass"
                  placeholder="e.g. Academic Vocabulary"
                />
              </div>


              {/* GROUPS */}

              <div>
                <div className="text-xs font-mono uppercase tracking-[0.14em] text-mist mb-3">
                  Assigned groups
                </div>

                <div className="flex flex-wrap gap-2">
                  {groups.map((group) => {
                    const selected =
                      groupIds.includes(group.id)

                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() =>
                          toggleGroup(group.id)
                        }
                        className={`focus-ring rounded-lg border px-4 py-2 text-sm transition ${
                          selected
                            ? 'border-brass bg-brass text-onbrass'
                            : 'border-line bg-panel text-mist hover:border-brass hover:text-paper'
                        }`}
                      >
                        {selected ? '✓ ' : ''}
                        {group.name}
                      </button>
                    )
                  })}
                </div>
              </div>


              {/* WORDS HEADER */}

              <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-mono uppercase tracking-[0.14em] text-mist">
                    Vocabulary items
                  </div>

                  <p className="text-sm text-mist mt-1">
                    Edit existing words or add new ones. Generation only
                    processes words added during this editing session.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">

                  <button
                    type="button"
                    onClick={onGenerate}
                    disabled={
                      generating ||
                      items.length === 0
                    }
                    className="btn-secondary disabled:opacity-50"
                  >
                    {generating
                      ? 'Generating details...'
                      : <><Icon name="sparkle" className="h-3.5 w-3.5" /> Generate details for new words</>}
                  </button>

                  <button
                    type="button"
                    onClick={onRegenerateAll}
                    disabled={
                      regeneratingAll ||
                      items.length === 0
                    }
                    title="Re-fetch and replace the definition, translation, and example for every word below — use this if a list's words and definitions got mixed up"
                    className="focus-ring rounded-lg border border-coral px-4 py-2 text-sm font-medium text-coral transition hover:bg-coral/10 disabled:opacity-50"
                  >
                    {regeneratingAll
                      ? 'Regenerating all...'
                      : <><Icon name="refresh" className="h-3.5 w-3.5" /> Regenerate all definitions</>}
                  </button>

                  <button
                    type="button"
                    onClick={addItem}
                    className="btn-primary"
                  >
                    + Add word
                  </button>

                </div>
              </div>


              {/* WORD ITEMS */}

              <div className="flex flex-col gap-4">

                {items.map((item, index) => (
                  <div
                    key={
                      item.id ||
                      item.clientId ||
                      `new-word-${index}`
                    }
                    className="rounded-2xl border border-line bg-panel p-4 sm:p-5"
                  >

                    <div className="flex items-center justify-between gap-3 mb-4">

                      <div className="flex items-center gap-2">
                        <div className="text-xs font-mono text-brass">
                          ITEM {index + 1}
                        </div>

                        {item.isNew && (
                          <span className="rounded-full border border-sage/30 bg-sage/10 px-2 py-0.5 text-[10px] font-mono text-sage">
                            NEW
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          removeItem(index)
                        }
                        className="focus-ring rounded-lg px-3 py-1.5 text-xs text-coral transition hover:bg-coral/10"
                      >
                        Remove
                      </button>

                    </div>


                    <div className="grid gap-4">

                      {/* WORD */}

                      <div>
                        <label className="text-xs text-mist">
                          Word / collocation
                        </label>

                        <input
                          type="text"
                          value={item.word}
                          onChange={(e) =>
                            updateItem(
                              index,
                              'word',
                              e.target.value
                            )
                          }
                          className="focus-ring mt-1.5 w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-paper outline-none focus:border-brass"
                          placeholder="Enter word or collocation"
                        />
                      </div>


                      {/* DEFINITION */}

                      <div>
                        <label className="text-xs text-mist">
                          Definition
                        </label>

                        <textarea
                          value={item.definition}
                          onChange={(e) =>
                            updateItem(
                              index,
                              'definition',
                              e.target.value
                            )
                          }
                          rows={2}
                          className="focus-ring mt-1.5 w-full resize-y rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-paper outline-none focus:border-brass"
                          placeholder="Definition"
                        />
                      </div>


                      {/* UZBEK */}

                      <div>
                        <label className="text-xs text-mist">
                          Uzbek translation
                        </label>

                        <input
                          type="text"
                          value={
                            item.uzbek_translation
                          }
                          onChange={(e) =>
                            updateItem(
                              index,
                              'uzbek_translation',
                              e.target.value
                            )
                          }
                          className="focus-ring mt-1.5 w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-paper outline-none focus:border-brass"
                          placeholder="Uzbek translation"
                        />
                      </div>


                      {/* EXAMPLE */}

                      <div>
                        <label className="text-xs text-mist">
                          Example sentence
                        </label>

                        <textarea
                          value={
                            item.example_sentence
                          }
                          onChange={(e) =>
                            updateItem(
                              index,
                              'example_sentence',
                              e.target.value
                            )
                          }
                          rows={2}
                          className="focus-ring mt-1.5 w-full resize-y rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-paper outline-none focus:border-brass"
                          placeholder="Example sentence"
                        />
                      </div>

                    </div>
                  </div>
                ))}


                {items.length === 0 && (
                  <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-mist">
                    No words yet. Add a word to start
                    building this list.
                  </div>
                )}

              </div>


              {/* ERROR */}

              {error && (
                <div className="rounded-xl border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-coral">
                  {error}
                </div>
              )}


              {/* FOOTER */}

              <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:justify-end">

                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="btn-secondary"
                >
                  Cancel
                </button>

                <button
  type="button"
  onClick={onSave}
  disabled={saving || loading}
  className="btn-primary disabled:opacity-50"
>
  {saving
    ? 'Saving changes...'
    : 'Save changes'}
</button>

              </div>

            </>
          )}

        </div>
      </div>
    </div>,
    document.body
  )
}


/* ============================================================
   NEW WORD LIST
   ============================================================
*/

function NewWordlistForm({
  groups,
  groupIds,
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
  const [selectedGroupIds, setSelectedGroupIds] = useState(groupIds || [])

  const generate = async () => {
    const words = rawWords
      .split('\n')
      .map((word) => stripListMarker(word))
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
  error: sessionError,
} = await supabase.auth.getSession()

if (sessionError) {
  throw sessionError
}

let session = sessionData?.session

if (!session) {
  throw new Error(
    'Your session has expired. Please log in again.'
  )
}

/*
 * Refresh only when the access token is close to expiring.
 * Do not force-refresh every request.
 */
const expiresAt =
  session.expires_at
    ? session.expires_at * 1000
    : 0

const expiresSoon =
  expiresAt &&
  expiresAt - Date.now() < 60 * 1000

if (expiresSoon) {
  const {
    data: refreshedData,
    error: refreshError,
  } = await supabase.auth.refreshSession()

  if (refreshError) {
    throw new Error(
      'Your session has expired. Please log in again.'
    )
  }

  session = refreshedData?.session

  if (!session) {
    throw new Error(
      'Your session has expired. Please log in again.'
    )
  }
}

/*
 * Use the Supabase client instead of manually calling fetch.
 * This automatically handles the Edge Function request correctly.
 */
const {
  data,
  error: functionError,
} = await supabase.functions.invoke(
  'define-words',
  {
    body: {
      words,
    },
    headers: {
      Authorization:
        `Bearer ${session.access_token}`,
    },
  }
)

if (functionError) {
  throw new Error(
    functionError.message ||
      'Could not reach the word generation service.'
  )
}

if (
  !data ||
  !Array.isArray(data.results)
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
            definition:
              item?.definition ||
              '',
            uzbek_translation:
              item?.uzbek_translation ||
              '',
            example_sentence:
              item?.example_sentence ||
              '',
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
      !items?.length ||
      !selectedGroupIds.length
    ) {
      setError(
        'Select at least one group before publishing.'
      )
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
              selectedGroupIds[0],
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

      const { error: groupLinksError } =
        await supabase
          .from('wordlist_groups')
          .insert(
            selectedGroupIds.map((groupId) => ({
              wordlist_id: wl.id,
              group_id: groupId,
            }))
          )

      if (groupLinksError) {
        await supabase
          .from('wordlists')
          .delete()
          .eq('id', wl.id)

        throw groupLinksError
      }

      const rows =
        items.map(
          (item, index) => ({
            wordlist_id:
              wl.id,
            word:
              item.word,
            definition:
              item.definition ||
              '',
            uzbek_translation:
              item.uzbek_translation ||
              '',
            example_sentence:
              item.example_sentence ||
              '',
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
        // The list itself and its group links were already saved in
        // the two steps above, and each of those is its own separate
        // database write — so a failure here alone used to leave a
        // real, group-linked word list behind with zero words in it.
        // Undo both earlier steps so a failed publish never leaves a
        // half-created list — same as the rollback just above for a
        // failed group-link save.
        await supabase
          .from('wordlist_groups')
          .delete()
          .eq('wordlist_id', wl.id)

        await supabase
          .from('wordlists')
          .delete()
          .eq('id', wl.id)

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

      <div className="rounded-xl border border-line bg-panel-2 p-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
          Assign to groups
        </div>

        <p className="text-xs text-mist mt-1 mb-3">
          Select one or more groups. The same word list will be available to students in every selected group.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {groups.map((group) => {
            const checked = selectedGroupIds.includes(group.id)

            return (
              <label
                key={group.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                  checked
                    ? 'border-brass bg-brass/10 text-paper'
                    : 'border-line bg-panel hover:border-brass/50 text-mist'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setSelectedGroupIds((prev) =>
                      prev.includes(group.id)
                        ? prev.filter((id) => id !== group.id)
                        : [...prev, group.id]
                    )
                  }}
                  className="accent-brass"
                />

                <span className="text-sm truncate">
                  {group.name}
                </span>
              </label>
            )
          })}
        </div>
      </div>

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
            Each gets an English definition, an example sentence, and
            a Uzbek translation — from Merriam-Webster's Learner's
            Dictionary when it has an entry, and AI-generated when it
            doesn't (most collocations/phrases aren't their own
            dictionary headword). Review everything before publishing.
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
                ? 'Generating definitions…'
                : 'Generate definitions & translations'}
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
            Review and edit the definitions,
            example sentences, and Uzbek
            translations before publishing —
            students will see exactly what's
            here. A field is only still blank if
            neither the dictionary nor the AI
            could fill it in; worth double-checking
            those by hand.
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
                    placeholder="English definition"
                    className="focus-ring bg-panel border border-line rounded-lg px-2.5 py-2 text-sm text-paper"
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
                    className="focus-ring bg-panel border border-line rounded-lg px-2.5 py-2 text-sm text-paper"
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
                    placeholder="Example sentence (optional)"
                    className="focus-ring bg-panel border border-line rounded-lg px-2.5 py-2 text-sm text-paper italic"
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
                !title.trim() ||
                !selectedGroupIds.length
              }
              className="btn-primary disabled:opacity-50"
            >
              {saving
                ? 'Publishing…'
                : selectedGroupIds.length > 1
              ? `Publish to ${selectedGroupIds.length} groups`
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
   RESULTS MODAL — rebuilt 2026-10-07
   ============================================================
   One group at a time (chips across the top, opening on the group
   the teacher was looking at), one row per student instead of one
   row per attempt, and who hasn't done it yet listed at the bottom.
   Summary for the chosen group: done / members, average best score,
   passed (best ≥ 70%), needs another go. Search + sort. Every attempt
   is still there — click a student to see all of their tries.
   ============================================================ */

const PASS_MARK = 70

function scoreTone(p) {
  if (p >= 90) return 'bg-reading-tint text-reading'
  if (p >= PASS_MARK) return 'bg-vocab-tint text-vocab'
  return 'bg-urgent-tint text-urgent'
}

function initialsOf(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

function shortDate(value) {
  return new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function ResultsModal({ wordlist, allGroups, initialGroupId, onClose }) {
  const [attempts, setAttempts] = useState(null)
  const [members, setMembers] = useState([]) // {student_id, group_id, profiles}
  const [assignedGroupIds, setAssignedGroupIds] = useState([])
  const [tab, setTab] = useState(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('score-asc')
  const [openStudent, setOpenStudent] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [{ data, error }, { data: links, error: linksError }] = await Promise.all([
        supabase
          .from('wordlist_attempts')
          .select('*, profiles(full_name, username, avatar_url)')
          .eq('wordlist_id', wordlist.id)
          .order('created_at', { ascending: false }),
        supabase.from('wordlist_groups').select('group_id').eq('wordlist_id', wordlist.id),
      ])
      if (error) console.error('Failed to load word list results:', error)
      if (linksError) console.error('Failed to load word list group assignments:', linksError)

      // Older lists may only have wordlists.group_id.
      const groupIds = [...new Set([wordlist.group_id, ...(links || []).map((l) => l.group_id)].filter(Boolean))]

      let memberRows = []
      if (groupIds.length) {
        const { data: m, error: membersError } = await supabase
          .from('group_members')
          .select('student_id, group_id, profiles(full_name, username, avatar_url, status)')
          .in('group_id', groupIds)
        if (membersError) console.error('Failed to load group memberships for results:', membersError)
        memberRows = (m || []).filter((row) => !row.profiles || row.profiles.status !== 'rejected')
      }
      if (cancelled) return
      setAssignedGroupIds(groupIds)
      setMembers(memberRows)
      setAttempts(data || [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [wordlist.id, wordlist.group_id])

  // Groups in the app-wide order, plus "No group" for attempts from
  // students no longer in any assigned group.
  const tabs = useMemo(() => {
    if (!attempts) return []
    const ordered = (allGroups || [])
      .map((g, index) => ({ ...g, index }))
      .filter((g) => assignedGroupIds.includes(g.id))
    const inAssigned = new Set(members.map((m) => m.student_id))
    const orphan = attempts.some((a) => !inAssigned.has(a.student_id))
    return [...ordered.map((g) => ({ id: g.id, name: g.name, index: g.index })), ...(orphan ? [{ id: '__none__', name: 'No group', index: -1 }] : [])]
  }, [attempts, members, assignedGroupIds, allGroups])

  useEffect(() => {
    if (!tabs.length || (tab && tabs.some((t) => t.id === tab))) return
    setTab(tabs.some((t) => t.id === initialGroupId) ? initialGroupId : tabs[0].id)
  }, [tabs, tab, initialGroupId])

  // Per student: all attempts, best, latest.
  const byStudent = useMemo(() => {
    const map = new Map()
    for (const a of attempts || []) {
      if (!map.has(a.student_id)) map.set(a.student_id, [])
      map.get(a.student_id).push(a)
    }
    return map
  }, [attempts])

  const tabStats = useMemo(() => {
    const out = {}
    for (const t of tabs) {
      let roster
      if (t.id === '__none__') {
        const inAssigned = new Set(members.map((m) => m.student_id))
        const seen = new Set()
        roster = []
        for (const a of attempts || []) {
          if (inAssigned.has(a.student_id) || seen.has(a.student_id)) continue
          seen.add(a.student_id)
          roster.push({ student_id: a.student_id, profiles: a.profiles })
        }
      } else {
        roster = members.filter((m) => m.group_id === t.id)
      }
      const rows = roster.map((m) => {
        const list = byStudent.get(m.student_id) || []
        const best = list.length ? Math.max(...list.map((a) => Number(a.percentage) || 0)) : null
        return {
          id: m.student_id,
          name: m.profiles?.full_name || m.profiles?.username || 'Student',
          username: m.profiles?.username,
          avatar: m.profiles?.avatar_url,
          attempts: list,
          best,
          latest: list[0] || null,
        }
      })
      const done = rows.filter((r) => r.best != null)
      out[t.id] = {
        rows,
        done: done.length,
        total: rows.length,
        avg: done.length ? Math.round(done.reduce((s2, r) => s2 + r.best, 0) / done.length) : null,
        passed: done.filter((r) => r.best >= PASS_MARK).length,
        below: done.filter((r) => r.best < PASS_MARK).length,
      }
    }
    return out
  }, [tabs, members, attempts, byStudent])

  const current = tab ? tabStats[tab] : null
  const visible = useMemo(() => {
    if (!current) return { done: [], notDone: [] }
    const q = query.trim().toLowerCase()
    const match = (r) => !q || r.name.toLowerCase().includes(q) || (r.username || '').toLowerCase().includes(q)
    const done = current.rows.filter((r) => r.best != null && match(r))
    const sorters = {
      'score-asc': (x, y) => x.best - y.best || x.name.localeCompare(y.name),
      'score-desc': (x, y) => y.best - x.best || x.name.localeCompare(y.name),
      name: (x, y) => x.name.localeCompare(y.name),
      recent: (x, y) => new Date(y.latest.created_at) - new Date(x.latest.created_at),
    }
    done.sort(sorters[sort] || sorters.name)
    const notDone = current.rows.filter((r) => r.best == null && match(r)).sort((x, y) => x.name.localeCompare(y.name))
    return { done, notDone }
  }, [current, query, sort])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${wordlist.title} results`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="absolute inset-0 bg-black/55" aria-hidden="true" />

      <div
        className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[22px] border border-line bg-panel shadow-2xl sm:rounded-[22px]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 pb-3 pt-5 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-medium text-vocab">Word list results</p>
            <h2 className="mt-0.5 truncate text-xl font-semibold text-paper">{wordlist.title}</h2>
            <p className="mt-0.5 text-xs text-mist">
              {attempts ? `${attempts.length} attempt${attempts.length === 1 ? '' : 's'} · pass mark ${PASS_MARK}%` : 'Loading…'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-mist transition hover:bg-panel-2 hover:text-paper"
            aria-label="Close results"
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        {/* Group chips */}
        {tabs.length > 1 && (
          <div className="flex gap-2 overflow-x-auto border-b border-line px-5 py-3 sm:px-6" role="tablist" aria-label="Group">
            {tabs.map((t) => {
              const active = t.id === tab
              const c = t.index >= 0 ? groupColour(t.index) : { tint: 'bg-panel-2', text: 'text-mist' }
              const st = tabStats[t.id]
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setTab(t.id)
                    setOpenStudent(null)
                  }}
                  className={`focus-ring inline-flex shrink-0 items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-sm font-medium transition-colors ${
                    active ? 'border-brass bg-brass text-onbrass' : 'border-line text-paper-dim hover:bg-panel-2'
                  }`}
                >
                  <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-semibold ${c.tint} ${c.text}`}>
                    {t.id === '__none__' ? '–' : groupBadge(t.name)}
                  </span>
                  {t.id === '__none__' ? 'No group' : groupDisplayName(t.name)}
                  {st && (
                    <span className={`text-xs tabular-nums ${active ? 'text-onbrass/80' : 'text-mist'}`}>
                      {st.done}/{st.total}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {attempts === null && <div className="h-40 animate-pulse rounded-2xl bg-panel-2" />}

          {current && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-2xl bg-panel-2 px-3 py-2.5">
                  <p className="text-xs text-mist">Done</p>
                  <p className="text-xl font-semibold tabular-nums text-paper">
                    {current.done}
                    <span className="text-sm font-normal text-mist">/{current.total}</span>
                  </p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel">
                    <div className="h-full rounded-full bg-vocab" style={{ width: `${current.total ? (current.done / current.total) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className="rounded-2xl bg-vocab-tint px-3 py-2.5">
                  <p className="text-xs text-vocab">Average best score</p>
                  <p className="text-xl font-semibold tabular-nums text-paper">{current.avg == null ? '—' : `${current.avg}%`}</p>
                </div>
                <div className="rounded-2xl bg-reading-tint px-3 py-2.5">
                  <p className="text-xs text-reading">Passed ({PASS_MARK}%+)</p>
                  <p className="text-xl font-semibold tabular-nums text-paper">{current.passed}</p>
                </div>
                <div className="rounded-2xl bg-urgent-tint px-3 py-2.5">
                  <p className="text-xs text-urgent">Need another go</p>
                  <p className="text-xl font-semibold tabular-nums text-paper">{current.below}</p>
                </div>
              </div>

              {/* Toolbar */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="relative min-w-0 flex-1">
                  <span className="sr-only">Search students</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search a student…"
                    className="focus-ring w-full rounded-full border border-line bg-panel px-4 py-2 text-sm text-paper placeholder:text-mist"
                  />
                </label>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="focus-ring rounded-full border border-line bg-panel px-3 py-2 text-sm text-paper"
                  aria-label="Sort"
                >
                  <option value="score-asc">Lowest score first</option>
                  <option value="score-desc">Highest score first</option>
                  <option value="recent">Most recent</option>
                  <option value="name">Name A–Z</option>
                </select>
              </div>

              {/* Students who did it */}
              {visible.done.length > 0 ? (
                <ul className="mt-3 overflow-hidden rounded-2xl border border-line">
                  {visible.done.map((r) => {
                    const open = openStudent === r.id
                    return (
                      <li key={r.id} className="border-b border-line last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setOpenStudent(open ? null : r.id)}
                          aria-expanded={open}
                          className="focus-ring flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-panel-2 sm:px-4"
                        >
                          {r.avatar ? (
                            <img src={r.avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                          ) : (
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-speaking-tint text-xs font-semibold text-speaking">
                              {initialsOf(r.name)}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-paper">{r.name}</span>
                            <span className="block truncate text-xs text-mist">
                              {r.attempts.length} attempt{r.attempts.length === 1 ? '' : 's'} · last {shortDate(r.latest.created_at)}
                            </span>
                          </span>
                          <span className="hidden w-28 sm:block">
                            <span className="block h-1.5 overflow-hidden rounded-full bg-panel-2">
                              <span
                                className={`block h-full rounded-full ${r.best >= 90 ? 'bg-reading' : r.best >= PASS_MARK ? 'bg-vocab' : 'bg-urgent'}`}
                                style={{ width: `${r.best}%` }}
                              />
                            </span>
                          </span>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${scoreTone(r.best)}`}>{r.best}%</span>
                          <span className={`text-mist transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">
                            ›
                          </span>
                        </button>
                        {open && (
                          <div className="border-t border-line bg-panel-2 px-4 py-2">
                            <p className="mb-1 text-xs font-medium text-mist">Every attempt, newest first</p>
                            <ul className="flex flex-col">
                              {r.attempts.map((a) => (
                                <li key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                                  <span className="text-paper-dim">{shortDate(a.created_at)}</span>
                                  <span className="flex items-center gap-2">
                                    <span className="tabular-nums text-mist">
                                      {a.score}/{a.total}
                                    </span>
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${scoreTone(a.percentage)}`}>
                                      {a.percentage}%
                                    </span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <div className="mt-3 rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-mist">
                  {query ? 'No student matches that search.' : 'Nobody in this group has done this list yet.'}
                </div>
              )}

              {/* Not done yet */}
              {visible.notDone.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-sm font-semibold text-paper">
                    Not done yet <span className="font-normal text-mist">· {visible.notDone.length}</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {visible.notDone.map((r) => (
                      <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel py-1 pl-1 pr-3 text-sm text-paper-dim">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-panel-2 text-[10px] font-semibold text-mist">
                          {initialsOf(r.name)}
                        </span>
                        {r.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {attempts && !current && (
            <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center">
              <p className="text-sm font-semibold text-paper">No attempts yet</p>
              <p className="mt-1 text-sm text-mist">Students have not completed this word list yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
