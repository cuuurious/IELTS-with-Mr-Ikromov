import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Leaderboard from '../../components/Leaderboard'

export default function TeacherLeaderboards() {
  const [groups, setGroups] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)

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
      {activeGroup && <Leaderboard groupId={activeGroup} />}
    </div>
  )
}
