import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { SkillIcon } from '../../components/SkillArt'
import { CoinAmount, CoinIcon, CoinStackArt, SKILL_GRADIENT, SKILL_TONES, youtubeId } from '../../components/coins/Coin'
import RewardsShop from '../../components/coins/RewardsShop'

/*
 * COINS & COURSES (2026-11-02).
 * Coins are only earned: homework on time, a run of on-time homeworks,
 * and the weekly group race. They pay for Mr Ikromov's video courses
 * and for full mock requests.
 */
const DEFAULTS = { homework_on_time: 5, homework_late: 1, streak_bonus: 10, streak_length: 7, top_group_bonus: 20, mock_slot_price: 100 }

export default function CoursesPage({ studentId, onOpenMockCenter }) {
  const [balance, setBalance] = useState(null)
  const [settings, setSettings] = useState(DEFAULTS)
  const [courses, setCourses] = useState([])
  const [counts, setCounts] = useState({})
  const [unlocked, setUnlocked] = useState(new Set())
  const [history, setHistory] = useState([])
  const [open, setOpen] = useState(null)
  const [buying, setBuying] = useState(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  const load = useCallback(async () => {
    await supabase.rpc('claim_weekly_prizes').then(() => {}, () => {})
    const [bal, set, list, mine, hist] = await Promise.all([
      supabase.rpc('my_coins'),
      supabase.from('coin_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('courses').select('id, title, description, skill, price, sort_order, created_at').eq('is_published', true).order('sort_order').order('created_at'),
      supabase.from('course_unlocks').select('course_id').eq('user_id', studentId),
      supabase.from('coin_ledger').select('id, amount, reason, created_at').eq('user_id', studentId).order('created_at', { ascending: false }).limit(20),
    ])
    setBalance(bal.error ? 0 : bal.data ?? 0)
    if (set.data) setSettings({ ...DEFAULTS, ...set.data })
    const rows = list.data || []
    setCourses(rows)
    setUnlocked(new Set((mine.data || []).map((r) => r.course_id)))
    setHistory(hist.data || [])
    const outlines = await Promise.all(rows.map((c) => supabase.rpc('course_outline', { p_course_id: c.id })))
    setCounts(Object.fromEntries(rows.map((c, i) => [c.id, outlines[i].data || []])))
    setReady(true)
  }, [studentId])

  useEffect(() => {
    load()
  }, [load])

  const buy = async (course) => {
    setBuying(course.id)
    setError('')
    const { data, error: e } = await supabase.rpc('buy_course', { p_course_id: course.id })
    setBuying(null)
    if (e) {
      setError(e.message)
      return
    }
    setBalance(data)
    setUnlocked((prev) => new Set(prev).add(course.id))
    setOpen(course)
    load()
  }

  if (open) {
    return <CoursePlayer course={open} studentId={studentId} onBack={() => setOpen(null)} />
  }

  const earn = [
    { v: `+${settings.homework_on_time}`, l: 'homework on time', sub: `late +${settings.homework_late}` },
    { v: `+${settings.streak_bonus}`, l: `${settings.streak_length} on time in a row`, sub: 'streak bonus' },
    ...(settings.score_coins_top ? [{ v: `+${settings.score_coins_top}`, l: 'score 90%+ on a task', sub: `70%+ gets +${settings.score_coins_good ?? 0}, 50%+ gets +${settings.score_coins_ok ?? 0} · first try` }] : []),
    { v: `+${settings.top_group_bonus}`, l: 'your group wins the week', sub: 'everyone in the group' },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Balance */}
      <div className="relative overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#2456b0,#1a9bb5)] p-5 text-white sm:p-7">
        <CoinStackArt className="pointer-events-none absolute -bottom-3 right-2 hidden h-36 w-48 sm:block" />
        <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Your coins</p>
        <p className="mt-1 flex items-center gap-2 font-brand text-[44px] font-semibold leading-none">
          <CoinIcon className="h-10 w-10" />
          {balance ?? '—'}
        </p>
        <div className="mt-5 grid max-w-3xl gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {earn.map((e) => (
            <div key={e.l} className="rounded-[16px] bg-white/12 px-4 py-3 backdrop-blur-[2px]" style={{ background: 'rgba(255,255,255,0.13)' }}>
              <div className="flex items-center gap-1.5 font-brand text-[20px] font-semibold"><CoinIcon className="h-5 w-5" />{e.v}</div>
              <div className="mt-0.5 text-[13px] font-extrabold">{e.l}</div>
              <div className="text-[12px] font-semibold text-white/75">{e.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}

      {/* Rewards shop (2026-11-05): real things for coins */}
      <RewardsShop studentId={studentId} balance={balance} onBalance={setBalance} />

      {/* Spend */}
      <h2 className="-mb-2 font-brand text-[18px] font-semibold text-paper">Spend your coins</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] text-brass" aria-hidden="true">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
            </span>
            <div className="min-w-0">
              <p className="font-brand text-[17px] font-semibold text-paper">Full mock exam</p>
              <p className="text-[13px] font-bold text-mist">Listening, Reading, Writing · real-test screen</p>
            </div>
          </div>
          <p className="text-sm font-semibold leading-6 text-paper-dim">Ask for a full mock. Your coins are held until Mr Ikromov approves; if he declines, they come back.</p>
          <div className="mt-auto flex items-center justify-between gap-2">
            <CoinAmount value={settings.mock_slot_price} className="text-[18px] text-amber" />
            <button type="button" onClick={onOpenMockCenter} className="focus-ring h-11 rounded-[14px] bg-saffron px-4 text-sm font-extrabold text-[#17213a] hover:brightness-105">
              Request a mock
            </button>
          </div>
        </div>

        {courses.map((c) => {
          const lessons = counts[c.id] || []
          const owned = unlocked.has(c.id)
          const short = balance != null && balance < c.price
          return (
            <div key={c.id} className="flex flex-col overflow-hidden rounded-[20px] border border-line bg-panel">
              <div className="relative h-28 p-4 text-white" style={{ background: SKILL_GRADIENT[c.skill] || SKILL_GRADIENT.general }}>
                <SkillIcon skill={c.skill === 'general' ? 'general' : c.skill} className="absolute -bottom-4 -right-3 h-28 w-28 opacity-20" />
                <span className="rounded-lg bg-white/20 px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide">{lessons.length} lesson{lessons.length === 1 ? '' : 's'}</span>
                <p className="mt-3 line-clamp-2 font-brand text-[18px] font-semibold leading-tight">{c.title}</p>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                {c.description && <p className="line-clamp-3 text-sm font-semibold leading-6 text-paper-dim">{c.description}</p>}
                {lessons.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {lessons.slice(0, 3).map((l, i) => (
                      <li key={l.lesson_id} className="flex items-center gap-2 text-[13px] font-bold text-paper">
                        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] ${SKILL_TONES[c.skill] || SKILL_TONES.general}`}>{i + 1}</span>
                        <span className="truncate">{l.title}</span>
                      </li>
                    ))}
                    {lessons.length > 3 && <li className="pl-8 text-xs font-bold text-mist">+{lessons.length - 3} more</li>}
                  </ul>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  {owned ? <span className="rounded-xl bg-reading-tint px-2.5 py-1 text-xs font-extrabold text-reading">Unlocked</span> : <CoinAmount value={c.price} className="text-[18px] text-amber" />}
                  {owned ? (
                    <button type="button" onClick={() => setOpen(c)} className="focus-ring h-11 rounded-[14px] bg-brass px-4 text-sm font-extrabold text-onbrass hover:brightness-110">
                      Open course
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => buy(c)}
                      disabled={short || buying === c.id}
                      title={short ? `You need ${c.price - balance} more coins` : ''}
                      className="focus-ring h-11 rounded-[14px] bg-saffron px-4 text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {buying === c.id ? 'Unlocking…' : short ? `${c.price - balance} more to go` : 'Unlock'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {ready && courses.length === 0 && (
          <div className="flex flex-col justify-center gap-2 rounded-[20px] bg-panel-2/70 p-5">
            <p className="font-brand text-[17px] font-semibold text-paper">Courses are coming</p>
            <p className="text-sm font-semibold text-mist">Keep saving — Mr Ikromov’s video courses will appear here.</p>
          </div>
        )}
      </div>

      {/* History */}
      <div className="rounded-[20px] border border-line bg-panel p-5">
        <h2 className="mb-3 font-brand text-[18px] font-semibold text-paper">Coin history</h2>
        {history.length === 0 ? (
          <p className="text-sm font-semibold text-mist">Hand in your next homework on time to earn your first coins.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-[14px] bg-panel-2/60 px-3 py-2">
                <span className={`w-14 shrink-0 text-right font-brand text-[15px] font-semibold ${h.amount > 0 ? 'text-reading' : 'text-coral'}`}>
                  {h.amount > 0 ? `+${h.amount}` : h.amount}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-paper">{h.reason}</span>
                <span className="shrink-0 text-xs font-bold text-mist">{new Date(h.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function CoursePlayer({ course, studentId, onBack }) {
  const [lessons, setLessons] = useState([])
  const [done, setDone] = useState(new Set())
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('course_lessons').select('id, position, title, youtube_url, notes').eq('course_id', course.id).order('position'),
      supabase.from('lesson_progress').select('lesson_id').eq('user_id', studentId),
    ]).then(([l, p]) => {
      if (cancelled) return
      const rows = l.data || []
      const doneSet = new Set((p.data || []).map((r) => r.lesson_id))
      setLessons(rows)
      setDone(doneSet)
      const firstOpen = rows.findIndex((r) => !doneSet.has(r.id))
      setCurrent(firstOpen === -1 ? 0 : firstOpen)
    })
    return () => {
      cancelled = true
    }
  }, [course.id, studentId])

  const lesson = lessons[current]
  const vid = youtubeId(lesson?.youtube_url)
  const pct = lessons.length ? Math.round((lessons.filter((l) => done.has(l.id)).length / lessons.length) * 100) : 0

  const toggleDone = async () => {
    if (!lesson) return
    const isDone = done.has(lesson.id)
    setDone((prev) => {
      const next = new Set(prev)
      if (isDone) next.delete(lesson.id)
      else next.add(lesson.id)
      return next
    })
    if (isDone) await supabase.from('lesson_progress').delete().eq('lesson_id', lesson.id).eq('user_id', studentId)
    else {
      await supabase.from('lesson_progress').insert({ lesson_id: lesson.id })
      if (current < lessons.length - 1) setCurrent((c) => c + 1)
    }
  }

  const progressLabel = useMemo(() => `${pct}% done`, [pct])

  return (
    <div className="flex flex-col gap-5">
      <button type="button" onClick={onBack} className="focus-ring w-fit text-sm font-bold text-mist hover:text-paper">
        ← Back to courses
      </button>
      <div className="rounded-[24px] p-5 text-white sm:p-6" style={{ background: SKILL_GRADIENT[course.skill] || SKILL_GRADIENT.general }}>
        <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Course · {progressLabel}</p>
        <h2 className="mt-1 font-brand text-[24px] font-semibold text-white">{course.title}</h2>
        <div className="mt-3 h-2 max-w-md overflow-hidden rounded-full bg-white/25">
          <div className="h-full rounded-full bg-saffron transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-[20px] border border-line bg-black">
            {vid ? (
              <iframe
                key={vid}
                title={lesson.title}
                src={`https://www.youtube-nocookie.com/embed/${vid}?rel=0&modestbranding=1`}
                className="aspect-video w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="grid aspect-video place-items-center text-sm font-bold text-white/70">{lessons.length ? 'This lesson has no video link.' : 'Loading…'}</div>
            )}
          </div>
          {lesson && (
            <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-brand text-[18px] font-semibold text-paper">{current + 1}. {lesson.title}</h3>
                <button
                  type="button"
                  onClick={toggleDone}
                  className={`focus-ring h-11 rounded-[14px] px-4 text-sm font-extrabold ${done.has(lesson.id) ? 'bg-reading-tint text-reading' : 'bg-saffron text-[#17213a] hover:brightness-105'}`}
                >
                  {done.has(lesson.id) ? 'Done ✓' : 'Mark as done'}
                </button>
              </div>
              {lesson.notes && <p className="whitespace-pre-wrap text-sm leading-6 text-paper-dim">{lesson.notes}</p>}
            </div>
          )}
        </div>

        <ol className="flex flex-col gap-2">
          {lessons.map((l, i) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => setCurrent(i)}
                className={`focus-ring flex w-full items-center gap-3 rounded-[16px] border px-3 py-2.5 text-left transition ${i === current ? 'border-brass bg-[color-mix(in_srgb,var(--color-brass)_8%,var(--color-panel))]' : 'border-line bg-panel hover:bg-panel-2'}`}
              >
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[13px] font-extrabold ${done.has(l.id) ? 'bg-reading text-white' : SKILL_TONES[course.skill] || SKILL_TONES.general}`}>
                  {done.has(l.id) ? '✓' : i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-paper">{l.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
