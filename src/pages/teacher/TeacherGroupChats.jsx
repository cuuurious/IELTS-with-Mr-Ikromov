import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import GroupChat from '../../components/GroupChat'
import { groupBadge, groupColour, groupDisplayName } from '../../lib/groupLook'

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

  const activeIndex = groups.findIndex(
    (group) => group.id === activeGroup
  )

  // Study room look (2026-10-07): a slim card of group chips (badge +
  // colour from lib/groupLook.js) above the conversation card.
  return (
    <div className="flex min-h-0 flex-col gap-4">

      <div className="rounded-[22px] border border-line bg-panel p-4 sm:p-5">

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-paper">
            Group chats
          </h2>

          <p className="text-xs text-mist">
            Announcements, questions and shared media with each class.
          </p>
        </div>

        {groups.length === 0 ? (
          <p className="mt-3 text-sm text-mist">
            Create a group first.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">

            {groups.map((group, index) => {
              const active = activeGroup === group.id
              const look = groupColour(index)

              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveGroup(group.id)}
                  aria-pressed={active}
                  className={`focus-ring inline-flex items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-brass text-onbrass'
                      : 'bg-panel-2 text-paper hover:bg-line'
                  }`}
                >
                  <span
                    className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${look.tint} ${look.text}`}
                  >
                    {groupBadge(group.name)}
                  </span>
                  {groupDisplayName(group.name)}
                </button>
              )
            })}

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
            lookIndex={activeIndex >= 0 ? activeIndex : null}
          />
        </div>
      )}

    </div>
  )
}
