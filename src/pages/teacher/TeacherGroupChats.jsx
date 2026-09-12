import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import GroupChat from '../../components/GroupChat'

export default function TeacherGroupChats({
  teacherId,
  initialGroupId = null,
  initialGroupName = null,
  initialMessageId = null,
}) {
  const [groups, setGroups] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)

  useEffect(() => {
    let active = true

    const loadGroups = async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('created_at')

      if (error) {
        console.error('Failed to load groups:', error)
        return
      }

      if (!active) return

      const rows = data || []
      setGroups(rows)

      /*
       * If we arrived here from a notification,
       * open THAT group instead of automatically
       * opening the first group.
       */
      if (initialGroupId) {
        const exists = rows.some(
          (group) => group.id === initialGroupId
        )

        if (exists) {
          setActiveGroup(initialGroupId)
          return
        }
      }

      if (rows.length) {
        setActiveGroup(rows[0].id)
      }
    }

    loadGroups()

    return () => {
      active = false
    }
  }, [initialGroupId])

  /*
   * When a new notification navigation arrives,
   * immediately switch to that group.
   */
  useEffect(() => {
    if (!initialGroupId) return

    setActiveGroup(initialGroupId)
  }, [initialGroupId])

  const activeGroupData = groups.find(
    (group) => group.id === activeGroup
  )

  const displayedGroupName =
    activeGroupData?.name ||
    (activeGroup === initialGroupId
      ? initialGroupName
      : '') ||
    ''

  /*
   * Same rotation used on Groups & homework, Students, Word lists
   * and Leaderboards — keyed by a group's position in the same
   * created_at-ordered list every one of those pages fetches, so a
   * given group carries the same color everywhere in the app.
   */
  const groupAccentPalette = [
    { bg: 'bg-sage/15', text: 'text-sage', border: 'border-sage/40', dot: 'bg-sage' },
    { bg: 'bg-coral/15', text: 'text-coral', border: 'border-coral/40', dot: 'bg-coral' },
    { bg: 'bg-cyan/15', text: 'text-cyan', border: 'border-cyan/40', dot: 'bg-cyan' },
    { bg: 'bg-brass/15', text: 'text-brass', border: 'border-brass/40', dot: 'bg-brass' },
    { bg: 'bg-lavender/15', text: 'text-lavender', border: 'border-lavender/40', dot: 'bg-lavender' },
  ]

  return (
    <div className="flex flex-col gap-5 min-h-0">

      <div className="ticket rounded-2xl p-5 sm:p-6 flex flex-col gap-5">

        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
            Conversations
          </div>

          <h2 className="font-display text-2xl sm:text-3xl mt-1">
            Group chats
          </h2>

          <p className="text-sm text-mist mt-1.5 max-w-md">
            Chat with each class as a group — announcements, questions, and shared media in one place.
          </p>
        </div>

        {groups.length === 0 ? (
          <div className="border-t border-line pt-4">
            <p className="text-mist text-sm">
              Create a group first.
            </p>
          </div>
        ) : (
          <div className="border-t border-line pt-4">

            <div className="text-[10px] uppercase tracking-[0.16em] text-mist font-mono mb-2.5">
              Group
            </div>

            <div className="flex items-center gap-2 flex-wrap">

              {groups.map((group, index) => {
                const active = activeGroup === group.id
                const accent = groupAccentPalette[index % groupAccentPalette.length]

                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setActiveGroup(group.id)}
                    className={`focus-ring inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                      active
                        ? `${accent.border} ${accent.bg} ${accent.text} shadow-[0_6px_16px_-8px_rgba(0,0,0,0.3)]`
                        : 'border-line bg-panel-2 text-mist hover:border-line hover:text-paper'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
                    {group.name}
                  </button>
                )
              })}

            </div>

          </div>
        )}

      </div>

      {activeGroup && (
        <div className="min-h-0">
          <GroupChat
            key={`${activeGroup}-${initialMessageId || 'normal'}`}
            groupId={activeGroup}
            selfId={teacherId}
            groupName={displayedGroupName}
            initialMessageId={
              activeGroup === initialGroupId
                ? initialMessageId
                : null
            }
          />
        </div>
      )}

    </div>
  )
}