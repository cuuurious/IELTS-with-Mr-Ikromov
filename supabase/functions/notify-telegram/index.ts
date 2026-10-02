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

type Row = { user_id: string; title?: string; body?: string; link?: string; type?: string }

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
        const body = escapeHtml(String(row.body || ''))
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
          if (json?.ok) sent++
          else {
            failed++
            console.error('notify-telegram: send failed', json?.description)
          }
        } catch (err) {
          failed++
          console.error('notify-telegram: send threw', err)
        }
      })
    )
    if (i + 20 < jobs.length) await new Promise((r) => setTimeout(r, 1100))
  }

  return new Response(JSON.stringify({ ok: true, sent, failed }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
