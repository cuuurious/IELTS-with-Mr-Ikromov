import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { groupDisplayName } from '../../lib/groupLook'
import { saveHomeworkTasks } from '../../lib/homeworkTasks'
import { notifyGroup } from '../../lib/notify'
import { postHomeworkToTelegram } from '../../lib/telegramGroupPost'
import { lessonTime, toLocalInput } from '../../lib/courses'
import { shortTitle } from '../../lib/pageBank'

/*
 * "Give as homework" from the Practice Bank (2026-11-02).
 * The chosen pages become in-site tasks of a new homework in every group
 * ticked here. Students do them on the site; the score is saved by itself,
 * so no screenshots (minimum files = 0). Each group gets a notification
 * and, when its Telegram chat is connected, a post there.
 */
const deadline = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(23, 59, 0, 0)
  return toLocalInput(d.toISOString())
}

export default function AssignPagesModal({ pages, onClose, onDone, initialGroups = [], initialTitle = '' }) {
  const { profile } = useAuth()
  const [groups, setGroups] = useState([])
  const [next, setNext] = useState({}) // group id -> next lesson start (ISO)
  const [chosen, setChosen] = useState(() => new Set(initialGroups))
  const [title, setTitle] = useState(initialTitle || (pages.length === 1 ? shortTitle(pages[0].title) : `${pages[0]?.collection || 'Practice'} · ${pages.length} pages`))
  const [note, setNote] = useState('')
  const [due, setDue] = useState('next') // 'next' | 'none' | datetime-local string
  const [telegram, setTelegram] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    supabase
      .from('groups')
      .select('id, name, created_at, telegram_chat_id')
      .order('created_at')
      .then(async ({ data }) => {
        const list = data || []
        setGroups(list)
        const pairs = await Promise.all(
          list.map((g) =>
            supabase.rpc('next_group_lesson', { p_group_id: g.id }).then(({ data: d, error }) => {
              const row = Array.isArray(d) ? d[0] : d
              return [g.id, !error && row?.starts_at ? row.starts_at : null]
            })
          )
        )
        setNext(Object.fromEntries(pairs))
      })
  }, [])

  const anyNext = [...chosen].some((id) => next[id])
  const dueFor = (gid) => {
    if (due === 'none') return null
    if (due === 'next') return next[gid] || new Date(deadline(2)).toISOString()
    return new Date(due).toISOString()
  }

  const give = async () => {
    setBusy(true)
    const done = []
    const failed = []
    for (const gid of chosen) {
      const g = groups.find((x) => x.id === gid)
      try {
        const { data: hw, error } = await supabase
          .from('homeworks')
          .insert({
            group_id: gid,
            title: title.trim() || 'Homework',
            description: note.trim(),
            due_date: dueFor(gid),
            enable_speaking: false,
            ai_eval_enabled: false,
            allowed_submission_types: ['image'],
            min_submission_files: 0,
            max_submission_files: 10,
            created_by: profile?.id,
            homework_type: 'standard',
          })
          .select()
          .single()
        if (error) throw error
        await saveHomeworkTasks(
          hw.id,
          pages.map((p) => ({ kind: 'html', html_url: p.url, title: shortTitle(p.title) }))
        )
        notifyGroup({ groupId: gid, type: 'homework_new', title: 'New homework posted', body: hw.title, link: `homework:${hw.id}` })
        if (telegram && g?.telegram_chat_id) postHomeworkToTelegram(hw.id, 'post')
        done.push(groupDisplayName(g?.name || ''))
      } catch (e) {
        failed.push(`${groupDisplayName(g?.name || '')}: ${e.message}`)
      }
    }
    setBusy(false)
    setResult({ done, failed })
    if (done.length) onDone?.()
  }

  const chip = (value, label) => (
    <button type="button" onClick={() => setDue(value)} className={`focus-ring h-9 rounded-[12px] px-3 text-[13px] font-extrabold ${due === value ? 'bg-brass text-onbrass' : 'bg-panel text-paper-dim hover:text-paper'}`}>
      {label}
    </button>
  )

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/60 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-ink sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Give as homework">
        <div className="registan-band px-5 py-4 text-white">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Give as homework</p>
          <p className="font-brand text-[19px] font-semibold text-white">{pages.length} page{pages.length === 1 ? '' : 's'}</p>
        </div>

        {result ? (
          <div className="flex flex-col gap-3 p-5">
            {result.done.length > 0 && <p className="rounded-[14px] bg-sage/15 px-4 py-3 text-sm font-bold text-sage">Posted to {result.done.join(', ')}.</p>}
            {result.failed.map((f) => (
              <p key={f} className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{f}</p>
            ))}
            <button type="button" onClick={onClose} className="focus-ring h-11 self-start rounded-[14px] bg-brass px-5 text-sm font-extrabold text-onbrass">Done</button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 overflow-y-auto p-5">
              <ul className="flex flex-wrap gap-1.5">
                {pages.slice(0, 8).map((p) => (
                  <li key={p.id} className="max-w-full truncate rounded-lg bg-panel px-2 py-1 text-[12px] font-bold text-paper-dim">{shortTitle(p.title)}</li>
                ))}
                {pages.length > 8 && <li className="rounded-lg bg-panel px-2 py-1 text-[12px] font-bold text-mist">+{pages.length - 8} more</li>}
              </ul>

              <div className="flex flex-col gap-1.5">
                <p className="text-[13px] font-extrabold text-paper-dim">Groups</p>
                <div className="flex flex-wrap gap-1.5">
                  {groups.map((g) => {
                    const on = chosen.has(g.id)
                    return (
                      <button
                        key={g.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setChosen((prev) => {
                            const n = new Set(prev)
                            if (n.has(g.id)) n.delete(g.id)
                            else n.add(g.id)
                            return n
                          })
                        }
                        className={`focus-ring h-10 rounded-[12px] px-3.5 text-sm font-extrabold ${on ? 'bg-brass text-onbrass' : 'bg-panel text-paper'}`}
                      >
                        {groupDisplayName(g.name)}
                      </button>
                    )
                  })}
                </div>
              </div>

              <label className="flex flex-col gap-1.5 text-[13px] font-extrabold text-paper-dim">
                Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="focus-ring rounded-[12px] border border-line bg-panel px-3 py-2 text-sm font-bold text-paper" />
              </label>
              <label className="flex flex-col gap-1.5 text-[13px] font-extrabold text-paper-dim">
                Note for students (optional)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="focus-ring rounded-[12px] border border-line bg-panel px-3 py-2 text-sm text-paper" />
              </label>

              <div className="flex flex-col gap-1.5">
                <p className="text-[13px] font-extrabold text-paper-dim">Deadline</p>
                <div className="flex flex-wrap gap-1.5">
                  {chip('next', 'Next lesson')}
                  {chip(deadline(0), 'Tonight 23:59')}
                  {chip(deadline(1), 'Tomorrow 23:59')}
                  {chip(deadline(2), 'In 2 days')}
                  {chip('none', 'No deadline')}
                </div>
                {due === 'next' && chosen.size > 0 && (
                  <p className="text-[12px] font-bold text-mist">
                    {[...chosen].map((id) => `${groupDisplayName(groups.find((g) => g.id === id)?.name || '')}: ${next[id] ? lessonTime(next[id]) : 'no lesson times — in 2 days'}`).join(' · ')}
                  </p>
                )}
                {due === 'next' && chosen.size > 0 && !anyNext && <p className="text-[12px] font-bold text-mist">Set lesson days and times on a group page to use the real next lesson.</p>}
              </div>

              <label className="flex items-center gap-2 text-sm font-bold text-paper">
                <input type="checkbox" checked={telegram} onChange={(e) => setTelegram(e.target.checked)} className="h-4 w-4 accent-brass" />
                Also post in each group’s Telegram chat (if connected)
              </label>
            </div>
            <div className="flex gap-2 border-t border-line px-5 py-4">
              <button type="button" onClick={give} disabled={busy || !chosen.size} className="focus-ring h-11 flex-1 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] disabled:opacity-50">
                {busy ? 'Posting…' : chosen.size ? `Post to ${chosen.size} group${chosen.size === 1 ? '' : 's'}` : 'Choose groups'}
              </button>
              <button type="button" onClick={onClose} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist hover:text-paper">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
