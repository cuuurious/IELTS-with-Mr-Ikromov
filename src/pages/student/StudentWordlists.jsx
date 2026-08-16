import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import WordlistPlayer from './WordlistPlayer'

export default function StudentWordlists({ studentId }) {
  const [myGroups, setMyGroups] = useState([])
  const [lists, setLists] = useState([])
  const [myAttempts, setMyAttempts] = useState({})
  const [playing, setPlaying] = useState(null)

  const load = async () => {
    const { data: gm } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('student_id', studentId)
    const groupIds = (gm || []).map((r) => r.group_id)
    setMyGroups(groupIds)
    if (!groupIds.length) return

    const { data: wl } = await supabase
      .from('wordlists')
      .select('*, wordlist_items(count)')
      .in('group_id', groupIds)
      .order('created_at', { ascending: false })
    setLists(wl || [])

    const { data: attempts } = await supabase
      .from('wordlist_attempts')
      .select('wordlist_id, percentage, created_at')
      .eq('student_id', studentId)
    const map = {}
    ;(attempts || []).forEach((a) => {
      if (!map[a.wordlist_id] || a.created_at > map[a.wordlist_id].created_at) {
        map[a.wordlist_id] = a
      }
    })
    setMyAttempts(map)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId])

  if (playing) {
    return (
      <WordlistPlayer
        wordlist={playing}
        studentId={studentId}
        onExit={() => {
          setPlaying(null)
          load()
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {myGroups.length === 0 && <p className="text-mist">You're not in a group yet.</p>}
      {myGroups.length > 0 && lists.length === 0 && (
        <p className="text-mist">No word lists posted yet.</p>
      )}
      {lists.map((list) => {
        const attempt = myAttempts[list.id]
        return (
          <button
            key={list.id}
            onClick={() => setPlaying(list)}
            className="focus-ring ticket rounded-lg p-4 flex items-center justify-between gap-3 text-left"
          >
            <div>
              <div className="font-display text-lg">{list.title}</div>
              <div className="text-mist text-xs font-mono mt-1">
                {list.wordlist_items?.[0]?.count ?? 0} words
              </div>
            </div>
            {attempt ? (
              <span className="stamp stamp-done w-16 h-16 text-[11px]">{attempt.percentage}%</span>
            ) : (
              <span className="stamp stamp-pending w-16 h-16 text-[10px]">Play</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
