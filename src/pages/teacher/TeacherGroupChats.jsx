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

  return (
    <div className="flex flex-col gap-5 min-h-0">

      {groups.length === 0 && (
        <div className="rounded-lg border border-line bg-panel p-4">
          <p className="text-mist text-sm">
            Create a group first.
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">

          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveGroup(group.id)}
              className={`focus-ring px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeGroup === group.id
                  ? 'bg-brass text-onbrass border-brass font-medium'
                  : 'border-line text-mist hover:text-paper'
              }`}
            >
              {group.name}
            </button>
          ))}

        </div>
      )}

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