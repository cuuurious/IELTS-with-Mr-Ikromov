import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/*
 * "Telegram" button in a group's header (2026-11-17).
 * Links the website group to its Telegram group chat so homework posted
 * here is posted there by the bot (telegram-group-post). Uses the
 * telegram_group_connect table + the bot's /start g<code> handler
 * (migration_91). Teacher only; the group page already is.
 */
const BOT = import.meta.env.VITE_TELEGRAM_BOT_USERNAME

function newCode() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return 'g' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export default function TelegramGroupLink({ groupId, teacherId }) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState({ loading: true, chatId: null, title: null })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const { data, error } = await supabase
      .from('groups')
      .select('telegram_chat_id, telegram_chat_title')
      .eq('id', groupId)
      .maybeSingle()
    if (error) return setLink({ loading: false, chatId: null, title: null })
    setLink({ loading: false, chatId: data?.telegram_chat_id || null, title: data?.telegram_chat_title || null })
  }

  useEffect(() => {
    setLink({ loading: true, chatId: null, title: null })
    setMsg('')
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  // While the window is open, notice the moment the bot confirms the link.
  useEffect(() => {
    if (!open || link.chatId) return undefined
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, link.chatId, groupId])

  async function connect() {
    setBusy(true)
    setMsg('')
    const code = newCode()
    const { error } = await supabase.from('telegram_group_connect').insert({ code, group_id: groupId, created_by: teacherId })
    setBusy(false)
    if (error) return setMsg('Could not start the connection: ' + error.message)
    window.open(`https://t.me/${BOT}?startgroup=${code}`, '_blank', 'noopener')
    setMsg('Telegram opened. Pick this group’s Telegram chat, confirm, and this window will turn green.')
  }

  async function disconnect() {
    setBusy(true)
    const { error } = await supabase
      .from('groups')
      .update({ telegram_chat_id: null, telegram_chat_title: null, telegram_linked_at: null })
      .eq('id', groupId)
    setBusy(false)
    if (error) return setMsg('Could not disconnect: ' + error.message)
    setLink({ loading: false, chatId: null, title: null })
  }

  const linked = Boolean(link.chatId)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`focus-ring flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition hover:bg-panel-2 ${linked ? 'text-emerald-600' : 'text-mist hover:text-accent'}`}
        title={linked ? `Telegram: ${link.title || 'connected'}` : 'Connect this group to its Telegram chat'}
        aria-label="Telegram group"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2 11 13" />
          <path d="M22 2 15 22l-4-9-9-4 20-7z" />
        </svg>
        <span className="hidden sm:inline">{linked ? 'Telegram ✓' : 'Telegram'}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-[20px] bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-paper">Telegram group</h3>

            {linked ? (
              <>
                <p className="mt-2 text-sm text-paper-dim">
                  ✅ Connected{link.title ? <> to <b>{link.title}</b></> : ''}. Homework you post here is posted there by the bot
                  (tick “Also post to the Telegram group” in the homework form).
                </p>
                <button type="button" onClick={disconnect} disabled={busy} className="focus-ring mt-4 rounded-[14px] border border-coral/40 px-4 py-2 text-sm font-semibold text-coral disabled:opacity-50">
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-paper-dim">
                  <li>Press the button, choose this group’s Telegram chat, and confirm adding the bot.</li>
                  <li>If Telegram asks, make the bot an admin (needed to post files and delete its own posts).</li>
                  <li>That’s it. The bot answers “connected” in the chat.</li>
                </ol>
                {BOT ? (
                  <button type="button" onClick={connect} disabled={busy} className="focus-ring mt-4 rounded-[14px] bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {busy ? 'Starting…' : 'Connect Telegram group'}
                  </button>
                ) : (
                  <p className="mt-3 text-sm text-paper-dim">
                    Add the bot to the Telegram chat yourself and send <b>/connect</b> in it, then tap this group’s name.
                  </p>
                )}
              </>
            )}

            {msg && <p className="mt-3 text-sm text-paper-dim">{msg}</p>}
            <button type="button" onClick={() => setOpen(false)} className="focus-ring mt-4 block text-sm text-mist hover:text-paper">
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
