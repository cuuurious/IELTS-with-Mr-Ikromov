import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Leaderboard from '../../components/Leaderboard'

export default function TeacherLeaderboards() {
  const [groups, setGroups] = useState([])
  const [activeGroup, setActiveGroup] = useState('all')

  useEffect(() => {
    const loadGroups = async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('created_at')

      if (error) {
        console.error(
          'Failed to load groups:',
          error
        )
        return
      }

      setGroups(data || [])
    }

    loadGroups()
  }, [])

  const openStudentChat = (student) => {
    const studentId =
      student?.student_id

    if (!studentId) {
      console.error(
        'Cannot open chat: student ID is missing.',
        student
      )
      return
    }

    window.dispatchEvent(
      new CustomEvent(
        'notification-navigate',
        {
          detail: {
            link: `private-chat:${studentId}`,
          },
        }
      )
    )
  }

  return (
    <div className="flex flex-col gap-5">

      <div className="flex gap-2 flex-wrap">

        {/* ALL STUDENTS */}

        <button
          type="button"
          onClick={() =>
            setActiveGroup('all')
          }
          className={`focus-ring px-3 py-1.5 rounded-full text-sm border transition-colors ${
            activeGroup === 'all'
              ? 'bg-brass text-onbrass border-brass font-medium'
              : 'border-line text-mist hover:text-paper'
          }`}
        >
          All Students
        </button>

        {/* GROUPS */}

        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
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

      <Leaderboard
        groupId={activeGroup}
        onOpenChat={openStudentChat}
      />

    </div>
  )
}