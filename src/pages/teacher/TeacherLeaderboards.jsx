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

  /*
   * Same rotation used on Groups & homework, Students, and Word
   * lists — keyed by a group's position in the same
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
    <div className="flex flex-col gap-6">

      <div className="ticket rounded-2xl p-5 sm:p-6 flex flex-col gap-5">

        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
            Rankings
          </div>

          <h2 className="font-display text-2xl sm:text-3xl mt-1">
            Leaderboards
          </h2>

          <p className="text-sm text-mist mt-1.5 max-w-md">
            Ranked by homework completed, then by completion rate — see who's leading, by class or across everyone.
          </p>
        </div>

        <div className="border-t border-line pt-4">

          <div className="text-[10px] uppercase tracking-[0.16em] text-mist font-mono mb-2.5">
            Group
          </div>

          <div className="flex gap-2 flex-wrap">

            {/* ALL STUDENTS */}

            <button
              type="button"
              onClick={() =>
                setActiveGroup('all')
              }
              className={`focus-ring inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                activeGroup === 'all'
                  ? 'border-brass bg-brass text-onbrass shadow-[0_6px_16px_-8px_rgba(0,0,0,0.3)]'
                  : 'border-line bg-panel-2 text-mist hover:text-paper'
              }`}
            >
              🏆 All Students
            </button>

            {/* GROUPS */}

            {groups.map((g, index) => {
              const active = activeGroup === g.id
              const accent = groupAccentPalette[index % groupAccentPalette.length]

              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    setActiveGroup(g.id)
                  }
                  className={`focus-ring inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                    active
                      ? `${accent.border} ${accent.bg} ${accent.text} shadow-[0_6px_16px_-8px_rgba(0,0,0,0.3)]`
                      : 'border-line bg-panel-2 text-mist hover:text-paper'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
                  {g.name}
                </button>
              )
            })}

          </div>

        </div>

      </div>

      <Leaderboard
        groupId={activeGroup}
        onOpenChat={openStudentChat}
      />

    </div>
  )
}