import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { weekStart } from '../lib/homeworkTasks'

/*
 * WEEKLY SEASON (2026-11-02) — the leaderboard starts again every
 * Monday, so everyone has a fresh chance. Points this week: homework on
 * time 10 (late 5), the first try of each in-site task up to 10, the
 * Daily Marathon one per right answer, word practice up to 20. Shows
 * the top three on a podium, your place, the days left, and last
 * week's champion.
 */
function daysLeft() {
  const start = new Date(`${weekStart()}T00:00:00+05:00`).getTime()
  const end = start + 7 * 86400000
  return Math.max(0, Math.ceil((end - Date.now()) / 86400000))
}

const initial = (n) => (n || '?').trim().charAt(0).toUpperCase()

export default function WeeklySeason({ groupId, meId }) {
  const [rows, setRows] = useState(null)
  const [champion, setChampion] = useState(null)
  const [openRules, setOpenRules] = useState(false)
  const [race, setRace] = useState([])
  const [prize, setPrize] = useState(20)

  useEffect(() => {
    if (!groupId || groupId === 'all') return undefined
    let cancelled = false
    // Group race + coins (migration_86): pays last week's winners once,
    // then shows this week's group standings. Quietly skipped if the
    // migration isn't there yet.
    supabase
      .rpc('claim_weekly_prizes')
      .then(() => Promise.all([supabase.rpc('group_race', { p_week_start: weekStart() }), supabase.from('coin_settings').select('top_group_bonus').eq('id', 1).maybeSingle()]))
      .then(([r, s]) => {
        if (cancelled || r.error) return
        setRace([...(r.data || [])].sort((a, b) => b.average - a.average))
        if (s.data) setPrize(s.data.top_group_bonus)
      })
      .catch(() => {})
    Promise.all([
      supabase.rpc('weekly_leaderboard', { p_group_id: groupId, p_week_start: weekStart() }),
      supabase.rpc('weekly_leaderboard', { p_group_id: groupId, p_week_start: weekStart(new Date(), -1) }),
    ]).then(([now, last]) => {
      if (cancelled) return
      if (now.error) {
        setRows(false)
        return
      }
      setRows(now.data || [])
      const top = (last.data || [])[0]
      setChampion(top && top.points > 0 ? top : null)
    })
    return () => {
      cancelled = true
    }
  }, [groupId])

  if (!groupId || groupId === 'all' || rows === null || rows === false) return null

  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }))
  const me = ranked.find((r) => r.user_id === meId)
  const podium = [ranked[1], ranked[0], ranked[2]]
  const left = daysLeft()
  const heights = ['h-16', 'h-24', 'h-12']
  const tones = ['bg-[#c9d3e3] text-[#17213a]', 'bg-saffron text-[#17213a]', 'bg-[#e0b48a] text-[#3b2410]']

  return (
    <div className="overflow-hidden rounded-[24px] border border-line bg-panel">
      <div className="relative bg-[linear-gradient(135deg,#2456b0,#1a9bb5)] px-5 pb-4 pt-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">This week’s season</p>
            <p className="font-brand text-[20px] font-semibold">{left} day{left === 1 ? '' : 's'} left</p>
          </div>
          <button type="button" onClick={() => setOpenRules((v) => !v)} className="focus-ring rounded-xl bg-white/15 px-3 py-1.5 text-xs font-extrabold hover:bg-white/25">
            {openRules ? 'Hide' : 'How points work'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-3 items-end gap-2">
          {podium.map((r, i) => (
            <div key={i} className="flex min-w-0 flex-col items-center gap-1.5">
              {r ? (
                <>
                  <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-full border-2 border-white/70 bg-white/20 font-brand text-sm font-bold">
                    {r.avatar_url ? <img src={r.avatar_url} alt="" className="h-full w-full object-cover" /> : initial(r.full_name)}
                  </span>
                  <span className="max-w-full truncate text-[12px] font-extrabold">{r.user_id === meId ? 'You' : (r.full_name || '').split(' ')[0]}</span>
                </>
              ) : (
                <span className="h-11" />
              )}
              <span className={`grid w-full place-items-center rounded-t-[14px] ${heights[i]} ${r ? tones[i] : 'bg-white/10'}`}>
                {r && (
                  <span className="text-center leading-none">
                    <span className="block font-brand text-[18px] font-bold">{r.points}</span>
                    <span className="text-[10px] font-extrabold uppercase">pts</span>
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {openRules && (
        <ul className="grid gap-1.5 border-b border-line bg-panel-2/60 px-5 py-3 text-[13px] font-bold text-paper-dim sm:grid-cols-2">
          <li>Homework on time · 10 (late · 5)</li>
          <li>In-site task, first try · up to 10</li>
          <li>Daily Marathon · 1 per right answer</li>
          <li>Word practice · 1 per 10 answers (max 20)</li>
        </ul>
      )}

      <div className="flex flex-col gap-2 p-4">
        {me && (
          <div className="flex items-center gap-3 rounded-[16px] bg-[color-mix(in_srgb,var(--color-brass)_10%,var(--color-panel))] px-3 py-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brass font-brand text-[15px] font-bold text-onbrass">#{me.rank}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-paper">You · {me.points} points</p>
              <p className="truncate text-xs font-bold text-mist">
                Homework {me.homework_points} · Tasks {me.task_points} · Marathon {me.marathon_points} · Words {me.word_points}
              </p>
            </div>
          </div>
        )}
        {ranked.slice(3, 8).map((r) => (
          <div key={r.user_id} className="flex items-center gap-3 px-3 py-1.5">
            <span className="w-6 text-center text-[13px] font-extrabold text-mist">{r.rank}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-paper">{r.user_id === meId ? 'You' : r.full_name}</span>
            <span className="text-sm font-extrabold text-brass">{r.points}</span>
          </div>
        ))}
        {race.length > 1 && (
          <div className="mt-1 rounded-[16px] border border-line p-3">
            <p className="mb-2 flex items-center justify-between gap-2 text-[13px] font-extrabold text-paper">
              <span>Group race</span>
              <span className="flex items-center gap-1 text-amber">
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#e6a33a" /><path d="M9.2 9.2h5.6M12 9.2v6.2M9.6 15.4h4.8" stroke="#7a4a00" strokeWidth="1.9" strokeLinecap="round" /></svg>
                +{prize} each for the winners
              </span>
            </p>
            <div className="flex flex-col gap-1.5">
              {race.slice(0, 4).map((g, i) => {
                const top = race[0]?.average || 1
                const mine = g.group_id === groupId
                return (
                  <div key={g.group_id} className="flex items-center gap-2">
                    <span className={`w-5 text-center text-[12px] font-extrabold ${i === 0 ? 'text-amber' : 'text-mist'}`}>{i + 1}</span>
                    <span className={`w-20 truncate text-[13px] font-extrabold ${mine ? 'text-brass' : 'text-paper'}`}>{g.name}</span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                      <span className={`block h-full rounded-full ${mine ? 'bg-brass' : i === 0 ? 'bg-saffron' : 'bg-mist/40'}`} style={{ width: `${Math.max(4, (g.average / top) * 100)}%` }} />
                    </span>
                    <span className="w-10 text-right text-[12px] font-extrabold tabular-nums text-paper-dim">{Number(g.average).toFixed(0)}</span>
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] font-bold text-mist">Average points per student, so small groups can win too.</p>
          </div>
        )}
        {champion && (
          <div className="mt-1 flex items-center gap-3 rounded-[16px] bg-[color-mix(in_srgb,var(--color-saffron)_16%,var(--color-panel))] px-3 py-2.5">
            <svg className="h-6 w-6 shrink-0 text-amber" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" /></svg>
            <p className="min-w-0 flex-1 truncate text-[13px] font-extrabold text-paper">
              Last week’s champion: {champion.user_id === meId ? 'You!' : champion.full_name} · {champion.points} pts
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
