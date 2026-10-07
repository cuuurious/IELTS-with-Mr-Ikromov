// supabase/functions/notify-telegram/index.ts
//
// Sends website notifications to students (and staff) through the
// Telegram bot — 2026-10-02. Called by the database itself: an AFTER
// INSERT statement trigger on public.notifications (migration_69,
// `notifications_to_telegram`) posts every new batch of notification
// rows here, already filtered to people who connected Telegram.
//
// So anything that creates a notification — new homework, "Remind"
// from the teacher, deadline reminders, private messages, results
// released — reaches Telegram automatically, with an "Open" button that
// deep-links into the website.
//
// Auth: no user JWT (the caller is Postgres). The request must carry the
// shared secret stored in Vault as `notify_telegram_secret`; it's
// checked through public.check_notify_secret() with the service role.

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'

type Row = { id?: string; user_id: string; title?: string; body?: string; link?: string; type?: string }
type TgRef = { chat_id: number; message_id: number; title?: string; body?: string; link?: string }

// Chat photos / voice notes / round videos are stored as JSON; never
// send that raw code to Telegram (migration_77 fixes it in the database
// too — this is the safety net).
function readableBody(value: string) {
  const text = String(value || '')
  const type = text.match(/^\s*\{\s*"type"\s*:\s*"([a-z_]+)"/)?.[1]
  if (!type || !/"url"\s*:/.test(text)) return text
  let name = ''
  try { name = JSON.parse(text)?.name || '' } catch { /* cut-off JSON */ }
  return ({ image: '📷 Photo', video: '🎥 Video', video_note: '⭕ Video message', audio: '🎤 Voice message' } as Record<string, string>)[type]
    || (type === 'file' ? `📎 ${name || 'File'}` : '📎 Attachment')
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const siteUrl = (Deno.env.get('SITE_URL') || 'https://ieltswithmrikromov.com').replace(/\/+$/, '')

  if (!supabaseUrl || !serviceKey || !botToken) {
    return new Response(JSON.stringify({ ok: false, error: 'Not configured.' }), { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const secret = req.headers.get('x-notify-secret') || ''
  const { data: secretOk } = await supabase.rpc('check_notify_secret', { p_secret: secret })
  if (!secret || secretOk !== true) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), { status: 403 })
  }

  const payload = await req.json().catch(() => ({}))

  const tgCall = async (method: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return await res.json().catch(() => null)
    } catch (err) {
      console.error(`notify-telegram: ${method} threw`, err)
      return null
    }
  }
  const messageText = (title?: string, body?: string) => {
    const t = escapeHtml(String(title || 'IELTS with Mr Ikromov'))
    const b = escapeHtml(readableBody(String(body || '')))
    return `<b>${t}</b>${b ? `\n${b}` : ''}`
  }
  const openButton = (link?: string) => ({
    inline_keyboard: [[{ text: 'Open on the website', url: `${siteUrl}/app?nav=${encodeURIComponent(String(link || '/app'))}` }]],
  })

  // 2026-10-07 (migration_77): a chat message was deleted / edited on the
  // website → delete / edit the Telegram message the bot sent for it.
  // Telegram only lets a bot delete its own messages for 48 hours; older
  // ones fail quietly.
  const toDelete: TgRef[] = Array.isArray(payload?.delete) ? payload.delete.slice(0, 1000) : []
  const toEdit: TgRef[] = Array.isArray(payload?.edit) ? payload.edit.slice(0, 1000) : []
  if (toDelete.length || toEdit.length) {
    let done = 0
    for (let i = 0; i < toDelete.length; i += 20) {
      await Promise.all(
        toDelete.slice(i, i + 20).map(async (m) => {
          if (!m?.chat_id || !m?.message_id) return
          const json = await tgCall('deleteMessage', { chat_id: m.chat_id, message_id: m.message_id })
          if (json?.ok) done++
          else console.error('notify-telegram: delete failed', json?.description)
        })
      )
      if (i + 20 < toDelete.length) await new Promise((r) => setTimeout(r, 1100))
    }
    for (let i = 0; i < toEdit.length; i += 20) {
      await Promise.all(
        toEdit.slice(i, i + 20).map(async (m) => {
          if (!m?.chat_id || !m?.message_id) return
          const json = await tgCall('editMessageText', {
            chat_id: m.chat_id,
            message_id: m.message_id,
            text: messageText(m.title, m.body),
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: openButton(m.link),
          })
          if (json?.ok) done++
          else console.error('notify-telegram: edit failed', json?.description)
        })
      )
      if (i + 20 < toEdit.length) await new Promise((r) => setTimeout(r, 1100))
    }
    return new Response(JSON.stringify({ ok: true, deletedOrEdited: done }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const rows: Row[] = Array.isArray(payload?.rows) ? payload.rows.slice(0, 1000) : []
  if (!rows.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }))
  }

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
  const { data: links, error } = await supabase
    .from('telegram_links')
    .select('user_id, telegram_chat_id')
    .in('user_id', userIds)

  if (error) {
    console.error('notify-telegram: could not load links', error)
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })
  }

  const chatByUser = new Map((links || []).map((l) => [l.user_id, l.telegram_chat_id]))

  let sent = 0
  let failed = 0
  // Chats that blocked the bot / were deleted. Their link is removed so
  // the website asks that person to connect again (or use phone
  // notifications) instead of silently sending into nowhere (2026-10-07).
  const deadChats = new Set<number>()
  // Which Telegram message went out for which notification, so it can be
  // deleted / edited later (migration_77).
  const sentRefs: { id: string; chat_id: number; message_id: number }[] = []

  // Telegram allows ~30 messages/second to different chats; send in
  // small parallel batches to stay well under that.
  const jobs = rows
    .map((row) => ({ row, chatId: chatByUser.get(row.user_id) }))
    .filter((j) => j.chatId)

  for (let i = 0; i < jobs.length; i += 20) {
    const batch = jobs.slice(i, i + 20)
    await Promise.all(
      batch.map(async ({ row, chatId }) => {
        const title = escapeHtml(String(row.title || 'IELTS with Mr Ikromov'))
        const body = escapeHtml(readableBody(String(row.body || '')))
        const link = String(row.link || '/app')
        const url = `${siteUrl}/app?nav=${encodeURIComponent(link)}`
        try {
          const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `<b>${title}</b>${body ? `\n${body}` : ''}`,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              reply_markup: { inline_keyboard: [[{ text: 'Open on the website', url }]] },
            }),
          })
          const json = await res.json().catch(() => null)
          if (json?.ok) {
            sent++
            if (row.id && json?.result?.message_id) {
              sentRefs.push({ id: row.id, chat_id: Number(chatId), message_id: Number(json.result.message_id) })
            }
          } else {
            failed++
            console.error('notify-telegram: send failed', json?.description)
            if (json?.error_code === 403 || /chat not found|user is deactivated|bot was blocked/i.test(String(json?.description || ''))) {
              deadChats.add(Number(chatId))
            }
          }
        } catch (err) {
          failed++
          console.error('notify-telegram: send threw', err)
        }
      })
    )
    if (i + 20 < jobs.length) await new Promise((r) => setTimeout(r, 1100))
  }

  for (let i = 0; i < sentRefs.length; i += 50) {
    await Promise.all(
      sentRefs.slice(i, i + 50).map(async (r) => {
        const { error: saveError } = await supabase
          .from('notifications')
          .update({ telegram_chat_id: r.chat_id, telegram_message_id: r.message_id })
          .eq('id', r.id)
        // Before migration_77 the columns don't exist — nothing to save.
        if (saveError && !/telegram_(chat|message)_id/.test(saveError.message || '')) {
          console.error('notify-telegram: could not save message id', saveError)
        }
      })
    )
  }

  if (deadChats.size) {
    const { error: unlinkError } = await supabase.from('telegram_links').delete().in('telegram_chat_id', [...deadChats])
    if (unlinkError) console.error('notify-telegram: could not unlink blocked chats', unlinkError)
  }

  return new Response(JSON.stringify({ ok: true, sent, failed, unlinked: deadChats.size }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
