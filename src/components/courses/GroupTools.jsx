import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import MonthlyReportsModal from '../reports/MonthlyReportsModal'

const BOT = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'ieltswithmrikromov_bot'

/*
 * Two tiles on the group page (2026-11-02, migration_91):
 *  - Telegram: is this group's Telegram chat connected? One tap opens
 *    Telegram with the bot and a short code; picking the chat links it, and
 *    from then on every homework posted here (by hand or after class) goes
 *    to that chat.
 *  - Monthly reports for parents.
 */
export default function GroupTools({ groupId, groupName }) {
  const [tg, setTg] = useState(undefined) // undefined loading | { linked, title }
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')
  const [reportsOpen, setReportsOpen] = useState(false)
  const poll = useRef(null)

  const load = async () => {
    const { data } = await supabase.from('groups').select('telegram_chat_id, telegram_chat_title').eq('id', groupId).maybeSingle()
    const next = { linked: Boolean(data?.telegram_chat_id), title: data?.telegram_chat_title || null }
    setTg(next)
    return next
  }

  useEffect(() => {
    load()
    return () => clearInterval(poll.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  const connect = async () => {
    setError('')
    if (!BOT) return setError('The bot name is missing in the site settings.')
    const { data: code, error: err } = await supabase.rpc('telegram_group_connect_code', { p_group_id: groupId })
    if (err || !code) return setError(err?.message?.includes('telegram_group_connect') ? 'Run migration_91 first.' : err?.message || 'Could not start.')
    window.open(`https://t.me/${BOT}?startgroup=${code}`, '_blank', 'noopener')
    setWaiting(true)
    clearInterval(poll.current)
    let tries = 0
    poll.current = setInterval(async () => {
      tries += 1
      const now = await load()
      if (now.linked || tries > 60) {
        clearInterval(poll.current)
        setWaiting(false)
      }
    }, 3000)
  }

  const disconnect = async () => {
    const { error: err } = await supabase.from('groups').update({ telegram_chat_id: null, telegram_chat_title: null, telegram_linked_at: null }).eq('id', groupId)
    if (err) return setError(err.message)
    load()
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <section className="flex items-center gap-4 rounded-[20px] border border-line bg-panel p-4">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tg?.linked ? 'bg-[#2AABEE] text-white' : 'bg-panel-2 text-mist'}`} aria-hidden="true">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor"><path d="M21.9 4.6 18.7 19.7c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13.4l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20.5 3.1c.9-.3 1.6.2 1.4 1.5z" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-brand text-[16px] font-semibold text-paper">Telegram group</p>
          <p className="truncate text-[13px] font-semibold text-mist">
            {tg === undefined
              ? 'Checking…'
              : tg.linked
                ? `Homework goes to “${tg.title || 'the chat'}”`
                : waiting
                  ? 'In Telegram: pick the group’s chat and tap Start…'
                  : 'Not connected: homework stays on the website only'}
          </p>
          {error && <p className="text-[12px] font-bold text-coral">{error}</p>}
        </div>
        {tg?.linked ? (
          <button type="button" onClick={disconnect} className="focus-ring h-9 shrink-0 rounded-[12px] px-3 text-[13px] font-extrabold text-mist hover:text-coral">
            Disconnect
          </button>
        ) : (
          <button type="button" onClick={connect} disabled={tg === undefined} className="focus-ring h-10 shrink-0 rounded-[14px] bg-[#2AABEE] px-4 text-[13px] font-extrabold text-white disabled:opacity-50">
            {waiting ? 'Open again' : 'Connect'}
          </button>
        )}
      </section>

      <section className="flex items-center gap-4 rounded-[20px] border border-line bg-panel p-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-reading-tint text-reading" aria-hidden="true">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-brand text-[16px] font-semibold text-paper">Monthly reports</p>
          <p className="truncate text-[13px] font-semibold text-mist">One page per student for parents: attendance, homework, scores</p>
        </div>
        <button type="button" onClick={() => setReportsOpen(true)} className="focus-ring h-10 shrink-0 rounded-[14px] bg-brass px-4 text-[13px] font-extrabold text-onbrass">
          Open
        </button>
      </section>

      {reportsOpen && <MonthlyReportsModal groupId={groupId} groupName={groupName} onClose={() => setReportsOpen(false)} />}
    </div>
  )
}
