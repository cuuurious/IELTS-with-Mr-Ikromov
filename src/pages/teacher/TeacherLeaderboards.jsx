import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Leaderboard from '../../components/Leaderboard'
import { useSessionState } from '../../lib/sessionState'
import { groupBadge, groupColour, groupDisplayName } from '../../lib/groupLook'

export default function TeacherLeaderboards() {
  const [groups, setGroups] = useState([])
  const [activeGroup, setActiveGroup] = useSessionState('ielts:teacher:leaderboards:group', 'all')

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
      if (activeGroup !== 'all' && !(data || []).some((g) => g.id === activeGroup)) setActiveGroup('all')
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
      {/* Group switcher (2026-10-07): one row of chips in each group's
          own colour (src/lib/groupLook.js), scrolls sideways on phones. */}
      <div className="flex flex-col gap-2">
        <p className="text-sm text-mist">
          Ranked by homework handed in, then by completion rate. Pick a class or see everyone.
        </p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Group">
          <button
            type="button"
            role="tab"
            aria-selected={activeGroup === 'all'}
            onClick={() => setActiveGroup('all')}
            className={`focus-ring inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
              activeGroup === 'all' ? 'border-brass bg-brass text-onbrass' : 'border-line bg-panel text-paper-dim hover:bg-panel-2'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" />
              <path d="M7 5H4a2 2 0 0 0 0 4h1M17 5h3a2 2 0 0 1 0 4h-1" />
            </svg>
            Everyone
          </button>
          {groups.map((g, index) => {
            const active = activeGroup === g.id
            const c = groupColour(index)
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveGroup(g.id)}
                className={`focus-ring inline-flex shrink-0 items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 text-sm font-medium transition-colors ${
                  active ? 'border-brass bg-brass text-onbrass' : 'border-line bg-panel text-paper-dim hover:bg-panel-2'
                }`}
              >
                <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-semibold ${c.tint} ${c.text}`}>
                  {groupBadge(g.name)}
                </span>
                {groupDisplayName(g.name)}
              </button>
            )
          })}
        </div>
      </div>

      <Leaderboard
        groupId={activeGroup}
        onOpenChat={openStudentChat}
      />

    </div>
  )
}