import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Leaderboard({ groupId, highlightStudentId }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!groupId) return
    setRows(null)
    supabase
      .rpc('group_leaderboard', { p_group_id: groupId })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setRows(data || [])
      })
  }, [groupId])

  if (error) return <p className="text-coral text-sm">{error}</p>
  if (rows === null) return <p className="text-mist text-sm">Loading…</p>
  if (rows.length === 0) return <p className="text-mist text-sm">No students here yet.</p>

  const rankStyle = (rank) => {
    if (rank === 1) return 'bg-brass text-onbrass border-brass'
    if (rank === 2) return 'bg-panel-2 text-paper border-mist'
    if (rank === 3) return 'bg-panel-2 text-paper border-brass-dim'
    return 'bg-panel-2 text-mist border-line'
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const rank = i + 1
        return (
          <div
            key={r.student_id}
            className={`ticket rounded-lg p-3 flex items-center gap-3 ${
              r.student_id === highlightStudentId ? 'border-brass' : ''
            }`}
          >
            <div
              className={`flex-shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center font-display font-bold text-sm ${rankStyle(
                rank
              )}`}
            >
              {rank}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{r.full_name}</span>
                <span className="font-mono text-sm text-brass">{r.percentage}%</span>
              </div>
              <div className="h-1.5 bg-panel-2 rounded-full overflow-hidden mt-1.5">
                <div
                  className="h-full bg-brass rounded-full transition-all"
                  style={{ width: `${Math.min(100, r.percentage)}%` }}
                />
              </div>
              <div className="text-mist text-xs font-mono mt-1 flex gap-3">
                <span>
                  {r.completed}/{r.total} tasks
                </span>
                {r.streak > 0 && (
                  <span>
                    🔥 {r.streak} day{r.streak === 1 ? '' : 's'} in a row
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
