import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { SkillIcon } from '../../components/SkillArt'
import EmptyState from '../../components/EmptyState'
import { CoinAmount, CoinIcon, SKILL_GRADIENT, youtubeId } from '../../components/coins/Coin'
import ShopAdmin from '../../components/coins/ShopAdmin'

/*
 * COINS & COURSES — teacher side (2026-11-02).
 *   Courses: video courses (unlisted YouTube links) students unlock with coins.
 *   Prices:  how many coins homework earns and what a mock costs.
 *   Students: everyone's balance.
 *   Rewards shop (2026-11-05): real things students swap coins for.
 */
const SKILLS = ['reading', 'listening', 'writing', 'speaking', 'vocab', 'general']
const SKILL_LABEL = { reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking', vocab: 'Vocabulary', general: 'General' }

export default function CoinsAdmin() {
  const [tab, setTab] = useState('shop')
  return (
    <div className="flex flex-col gap-5">
      <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-[16px] border border-line bg-panel p-1">
        {[
          ['shop', 'Rewards shop'],
          ['courses', 'Courses'],
          ['prices', 'Coins & prices'],
          ['students', 'Student coins'],
        ].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
            className={`focus-ring h-10 shrink-0 rounded-[12px] px-4 text-sm font-extrabold transition ${tab === k ? 'bg-brass text-onbrass' : 'text-paper-dim hover:text-paper'}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'shop' && <ShopAdmin />}
      {tab === 'courses' && <CoursesTab />}
      {tab === 'prices' && <PricesTab />}
      {tab === 'students' && <StudentsTab />}
    </div>
  )
}

function CoursesTab() {
  const [courses, setCourses] = useState(null)
  const [stats, setStats] = useState({})
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    const [c, l, u] = await Promise.all([
      supabase.from('courses').select('*').order('sort_order').order('created_at'),
      supabase.from('course_lessons').select('id, course_id'),
      supabase.from('course_unlocks').select('course_id'),
    ])
    if (c.error) setError(c.error.message)
    setCourses(c.data || [])
    const s = {}
    ;(l.data || []).forEach((r) => ((s[r.course_id] ||= { lessons: 0, students: 0 }).lessons += 1))
    ;(u.data || []).forEach((r) => ((s[r.course_id] ||= { lessons: 0, students: 0 }).students += 1))
    setStats(s)
  }
  useEffect(() => {
    load()
  }, [])

  const togglePublish = async (c) => {
    setCourses((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_published: !x.is_published } : x)))
    await supabase.from('courses').update({ is_published: !c.is_published }).eq('id', c.id)
  }

  if (editing) return <CourseEditor course={editing === 'new' ? null : editing} onDone={() => { setEditing(null); load() }} />
  if (courses === null) return <p className="text-sm font-semibold text-mist">Loading…</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-paper-dim">Students unlock a course with coins and watch it inside the site.</p>
        <button type="button" onClick={() => setEditing('new')} className="focus-ring h-11 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] hover:brightness-105">
          + New course
        </button>
      </div>
      {error && <p className="text-sm font-bold text-coral">{error}</p>}
      {courses.length === 0 ? (
        <EmptyState icon="check" title="No courses yet" text="Make your first video course: paste unlisted YouTube links, set a coin price, publish." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => (
            <div key={c.id} className="flex flex-col overflow-hidden rounded-[20px] border border-line bg-panel">
              <div className="relative h-24 p-4 text-white" style={{ background: SKILL_GRADIENT[c.skill] || SKILL_GRADIENT.general }}>
                <SkillIcon skill={c.skill} className="absolute -bottom-4 -right-3 h-24 w-24 opacity-20" />
                <span className="rounded-lg bg-white/20 px-2 py-1 text-[11px] font-extrabold uppercase tracking-wide">{SKILL_LABEL[c.skill]}</span>
                <p className="mt-2 truncate font-brand text-[18px] font-semibold">{c.title}</p>
              </div>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-[12px] bg-panel-2/70 py-2"><div className="font-brand text-[18px] font-semibold text-paper">{stats[c.id]?.lessons || 0}</div><div className="text-[11px] font-extrabold text-mist">lessons</div></div>
                  <div className="rounded-[12px] bg-panel-2/70 py-2"><div className="font-brand text-[18px] font-semibold text-paper">{stats[c.id]?.students || 0}</div><div className="text-[11px] font-extrabold text-mist">students</div></div>
                  <div className="rounded-[12px] bg-[color-mix(in_srgb,var(--color-saffron)_16%,var(--color-panel))] py-2"><div className="font-brand text-[18px] font-semibold text-amber">{c.price}</div><div className="text-[11px] font-extrabold text-mist">coins</div></div>
                </div>
                <div className="mt-auto flex gap-2">
                  <button type="button" onClick={() => togglePublish(c)}
                    className={`focus-ring h-10 flex-1 rounded-[14px] text-[13px] font-extrabold ${c.is_published ? 'bg-reading-tint text-reading' : 'bg-panel-2 text-mist'}`}>
                    {c.is_published ? 'Published' : 'Draft — publish'}
                  </button>
                  <button type="button" onClick={() => setEditing(c)} className="focus-ring h-10 flex-1 rounded-[14px] bg-brass text-[13px] font-extrabold text-onbrass hover:brightness-110">
                    Edit
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CourseEditor({ course, onDone }) {
  const [title, setTitle] = useState(course?.title || '')
  const [description, setDescription] = useState(course?.description || '')
  const [skill, setSkill] = useState(course?.skill || 'reading')
  const [price, setPrice] = useState(course?.price ?? 150)
  const [lessons, setLessons] = useState([])
  const [removed, setRemoved] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!course) {
      setLessons([{ title: '', youtube_url: '', notes: '' }])
      return
    }
    supabase.from('course_lessons').select('*').eq('course_id', course.id).order('position').then(({ data }) => setLessons(data || []))
  }, [course])

  const update = (i, patch) => setLessons((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= lessons.length) return
    const next = [...lessons]
    ;[next[i], next[j]] = [next[j], next[i]]
    setLessons(next)
  }

  const save = async () => {
    setError('')
    const clean = lessons.filter((l) => l.title.trim() || l.youtube_url.trim())
    if (!title.trim()) return setError('Give the course a title.')
    const bad = clean.findIndex((l) => !l.title.trim() || !youtubeId(l.youtube_url))
    if (bad !== -1) return setError(`Lesson ${bad + 1} needs a title and a YouTube link.`)
    setSaving(true)
    try {
      let id = course?.id
      const row = { title: title.trim(), description: description.trim(), skill, price: Math.max(0, Number(price) || 0) }
      if (id) {
        const { error: e } = await supabase.from('courses').update(row).eq('id', id)
        if (e) throw e
      } else {
        const { data, error: e } = await supabase.from('courses').insert(row).select('id').single()
        if (e) throw e
        id = data.id
      }
      if (removed.length) {
        const { error: e } = await supabase.from('course_lessons').delete().in('id', removed)
        if (e) throw e
      }
      for (let i = 0; i < clean.length; i += 1) {
        const l = clean[i]
        const payload = { course_id: id, position: i, title: l.title.trim(), youtube_url: l.youtube_url.trim(), notes: (l.notes || '').trim() }
        const { error: e } = l.id
          ? await supabase.from('course_lessons').update(payload).eq('id', l.id)
          : await supabase.from('course_lessons').insert(payload)
        if (e) throw e
      }
      onDone()
    } catch (err) {
      setError(err?.message || 'Could not save the course.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!course) return onDone()
    const { count } = await supabase.from('course_unlocks').select('course_id', { count: 'exact', head: true }).eq('course_id', course.id)
    if (count > 0) {
      setError(`${count} student${count === 1 ? ' has' : 's have'} unlocked this course, so it can't be deleted. Make it a draft instead.`)
      return
    }
    setSaving(true)
    const { error: e } = await supabase.from('courses').delete().eq('id', course.id)
    setSaving(false)
    if (e) setError(e.message)
    else onDone()
  }

  const input = 'focus-ring w-full rounded-[14px] border border-line bg-panel px-3.5 py-2.5 text-sm font-semibold text-paper placeholder:text-mist'

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onDone} className="focus-ring w-fit text-sm font-bold text-mist hover:text-paper">← All courses</button>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Course title (e.g. Reading: True/False/Not Given)" className={`${input} font-brand text-[18px]`} />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What students will learn (one or two lines)" className={input} />
          <div className="flex flex-wrap gap-2">
            {SKILLS.map((s) => (
              <button key={s} type="button" onClick={() => setSkill(s)} aria-pressed={skill === s}
                className={`focus-ring h-9 rounded-[12px] px-3 text-[13px] font-extrabold ${skill === s ? 'text-white' : 'bg-panel-2 text-paper-dim'}`}
                style={skill === s ? { background: SKILL_GRADIENT[s] } : undefined}>
                {SKILL_LABEL[s]}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3 rounded-[14px] bg-[color-mix(in_srgb,var(--color-saffron)_14%,var(--color-panel))] px-3.5 py-2.5">
            <CoinIcon className="h-6 w-6" />
            <span className="text-sm font-extrabold text-paper">Price</span>
            <input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className="focus-ring w-28 rounded-[12px] border border-line bg-panel px-3 py-1.5 text-sm font-extrabold" />
            <span className="text-sm font-bold text-mist">coins</span>
          </label>
        </div>
        <div className="flex flex-col justify-center gap-2 rounded-[20px] p-5 text-white" style={{ background: SKILL_GRADIENT[skill] }}>
          <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Preview</p>
          <p className="font-brand text-[20px] font-semibold leading-tight">{title || 'Course title'}</p>
          <p className="text-sm font-semibold text-white/85">{lessons.filter((l) => l.title).length} lesson{lessons.filter((l) => l.title).length === 1 ? '' : 's'} · {price || 0} coins</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="font-brand text-[18px] font-semibold text-paper">Lessons</h3>
        {lessons.map((l, i) => {
          const vid = youtubeId(l.youtube_url)
          return (
            <div key={l.id || i} className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4 sm:flex-row">
              <div className="grid aspect-video w-full shrink-0 place-items-center overflow-hidden rounded-[14px] bg-panel-2 sm:w-44">
                {vid ? <img src={`https://i.ytimg.com/vi/${vid}/mqdefault.jpg`} alt="" className="h-full w-full object-cover" /> : <span className="text-xs font-bold text-mist">Paste a YouTube link</span>}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-panel-2 text-[13px] font-extrabold text-paper">{i + 1}</span>
                  <input value={l.title} onChange={(e) => update(i, { title: e.target.value })} placeholder="Lesson title" className={input} />
                </div>
                <input value={l.youtube_url} onChange={(e) => update(i, { youtube_url: e.target.value })} placeholder="https://youtu.be/… (unlisted)" className={input} />
                <textarea value={l.notes || ''} onChange={(e) => update(i, { notes: e.target.value })} rows={2} placeholder="Notes under the video (optional)" className={input} />
              </div>
              <div className="flex shrink-0 gap-1 sm:flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="focus-ring grid h-9 w-9 place-items-center rounded-xl text-mist hover:bg-panel-2 disabled:opacity-30">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === lessons.length - 1} aria-label="Move down" className="focus-ring grid h-9 w-9 place-items-center rounded-xl text-mist hover:bg-panel-2 disabled:opacity-30">↓</button>
                <button type="button" onClick={() => { if (l.id) setRemoved((r) => [...r, l.id]); setLessons((prev) => prev.filter((_, j) => j !== i)) }} aria-label="Remove lesson" className="focus-ring grid h-9 w-9 place-items-center rounded-xl text-coral hover:bg-urgent-tint">×</button>
              </div>
            </div>
          )
        })}
        <button type="button" onClick={() => setLessons((prev) => [...prev, { title: '', youtube_url: '', notes: '' }])}
          className="focus-ring h-12 rounded-[16px] border-2 border-dashed border-line text-sm font-extrabold text-brass hover:bg-panel">
          + Add a lesson
        </button>
      </div>

      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        {course ? (
          <button type="button" onClick={remove} disabled={saving} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-extrabold text-coral hover:bg-urgent-tint">Delete course</button>
        ) : <span />}
        <button type="button" onClick={save} disabled={saving} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save course'}
        </button>
      </div>
    </div>
  )
}

const PRICE_FIELDS = [
  { key: 'homework_on_time', label: 'Homework handed in on time', unit: 'coins earned' },
  { key: 'homework_late', label: 'Homework handed in late', unit: 'coins earned' },
  // First try of each in-site task, by its score (migration_95).
  { key: 'score_coins_top', label: 'Task score 90%+ · or band 7+', unit: 'coins earned' },
  { key: 'score_coins_good', label: 'Task score 70%+ · or band 6+', unit: 'coins earned' },
  { key: 'score_coins_ok', label: 'Task score 50%+ · or band 5+', unit: 'coins earned' },
  { key: 'streak_length', label: 'Homeworks in a row for a bonus', unit: 'homeworks' },
  { key: 'streak_bonus', label: 'Streak bonus', unit: 'coins earned' },
  { key: 'top_group_bonus', label: 'Week’s top group, each student', unit: 'coins earned' },
  { key: 'mock_slot_price', label: 'Full mock request', unit: 'coins it costs' },
  { key: 'warmup_coins', label: 'Daily speaking warm-up done', unit: 'coins earned' },
]

function PricesTab() {
  const [values, setValues] = useState(null)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.from('coin_settings').select('*').eq('id', 1).maybeSingle().then(({ data, error: e }) => {
      if (e) setError(e.message)
      setValues(data || {})
    })
  }, [])
  const save = async () => {
    setSaved('')
    // Score tiers only once migration_95 has added their columns.
    const patch = Object.fromEntries(PRICE_FIELDS.filter((f) => f.key in values || !(f.key.startsWith('score_') || f.key === 'warmup_coins')).map((f) => [f.key, Math.max(0, Number(values[f.key]) || 0)]))
    if ('speaking_warmup' in values) patch.speaking_warmup = Boolean(values.speaking_warmup)
    const { error: e } = await supabase.from('coin_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1)
    if (e) setError(e.message)
    else setSaved('Saved.')
  }
  if (!values) return <p className="text-sm font-semibold text-mist">Loading…</p>
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {PRICE_FIELDS.filter((f) => f.key in values || !(f.key.startsWith('score_') || f.key === 'warmup_coins')).map((f) => (
          <label key={f.key} className={`flex flex-col gap-2 rounded-[20px] p-5 ${f.key === 'mock_slot_price' ? 'bg-[color-mix(in_srgb,var(--color-brass)_10%,var(--color-panel))]' : 'bg-[color-mix(in_srgb,var(--color-saffron)_12%,var(--color-panel))]'}`}>
            <span className="text-sm font-extrabold text-paper">{f.label}</span>
            <span className="flex items-center gap-2">
              {f.key !== 'streak_length' && <CoinIcon className="h-7 w-7" />}
              <input type="number" min="0" value={values[f.key] ?? 0} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                className="focus-ring w-24 rounded-[12px] border border-line bg-panel px-3 py-2 font-brand text-[20px] font-semibold text-paper" />
              <span className="text-[13px] font-bold text-mist">{f.unit}</span>
            </span>
          </label>
        ))}
      </div>
      {'speaking_warmup' in values && (
        <label className="flex items-start gap-3 rounded-[20px] border border-line bg-panel p-4">
          <input type="checkbox" checked={Boolean(values.speaking_warmup)} onChange={(e) => setValues({ ...values, speaking_warmup: e.target.checked })} className="mt-1 h-4 w-4 accent-brass" />
          <span>
            <span className="block text-sm font-extrabold text-paper">Daily speaking warm-up for students</span>
            <span className="block text-[13px] font-semibold text-mist">Three Part 1 questions a day from your speaking sets, on the students’ home page. They answer out loud and see a Band 8 answer. No AI marking.</span>
          </span>
        </label>
      )}
      <p className="text-[13px] font-semibold text-mist">Coins are only earned — nobody can buy them or give them by hand. A declined mock request gives the coins back.</p>
      {error && <p className="text-sm font-bold text-coral">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] hover:brightness-105">Save</button>
        {saved && <span className="text-sm font-bold text-reading">{saved}</span>}
      </div>
    </div>
  )
}

function StudentsTab() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    supabase.rpc('coin_balances').then(({ data }) => setRows(data || []))
  }, [])
  if (!rows) return <p className="text-sm font-semibold text-mist">Loading…</p>
  const shown = rows.filter((r) => (r.full_name || '').toLowerCase().includes(q.trim().toLowerCase()))
  const total = rows.reduce((n, r) => n + r.balance, 0)
  const spent = rows.reduce((n, r) => n + r.spent, 0)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { v: total, l: 'coins students hold', c: 'bg-[color-mix(in_srgb,var(--color-saffron)_16%,var(--color-panel))] text-amber' },
          { v: spent, l: 'coins spent', c: 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] text-brass' },
          { v: rows.filter((r) => r.earned > 0).length, l: 'students earning', c: 'bg-reading-tint text-reading' },
        ].map((t) => (
          <div key={t.l} className={`rounded-[20px] px-5 py-4 ${t.c}`}>
            <div className="font-brand text-[28px] font-semibold leading-none">{t.v}</div>
            <div className="mt-1.5 text-[13px] font-extrabold text-paper-dim">{t.l}</div>
          </div>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a student" className="focus-ring h-11 rounded-[14px] border border-line bg-panel px-3.5 text-sm font-semibold" />
      <div className="grid gap-2 md:grid-cols-2">
        {shown.map((r, i) => (
          <div key={r.user_id} className="flex items-center gap-3 rounded-[16px] border border-line bg-panel px-3 py-2.5">
            <span className="w-6 text-center text-[13px] font-extrabold text-mist">{i + 1}</span>
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-panel-2 text-xs font-bold text-brass">
              {r.avatar_url ? <img src={r.avatar_url} alt="" className="h-full w-full object-cover" /> : (r.full_name || '?').charAt(0)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-paper">{r.full_name}</span>
            <span className="text-xs font-bold text-mist">+{r.earned} · −{r.spent}</span>
            <CoinAmount value={r.balance} className="w-16 justify-end text-[15px] text-amber" />
          </div>
        ))}
      </div>
    </div>
  )
}
