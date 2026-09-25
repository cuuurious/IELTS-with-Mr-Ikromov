// supabase/functions/telegram-webhook/index.ts
//
// Receives updates from Telegram's Bot API (configured as this bot's
// webhook URL via https://api.telegram.org/bot<token>/setWebhook) and
// completes the "Connect Telegram" flow started in AccountSettingsModal.jsx:
//
//   1. Student taps "Connect Telegram" -> the browser inserts a
//      one-time row into telegram_link_tokens and opens
//      t.me/<bot>?start=<token>.
//   2. Telegram opens a chat with the bot and sends us an update with
//      message.text = "/start <token>". We remember which Telegram
//      chat that token came from (telegram_link_tokens.telegram_chat_id,
//      migration_41) and reply asking the student to share their
//      contact — this is the ONLY way to get a phone number Telegram
//      itself has verified, rather than trusting whatever the student
//      might type.
//   3. Student taps Telegram's own "Share my contact" button -> we get
//      an update with message.contact = { phone_number, ... }. We look
//      up the token by chat_id, mark it consumed, and upsert
//      telegram_links with the verified phone number + chat_id.
//
// This function must run with the service-role key (RLS on
// telegram_links/telegram_link_tokens is select/insert-by-owner only —
// a webhook has no Supabase user session to authenticate as) and is
// never called by the browser directly.

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function sendTelegramMessage(botToken, chatId, text, replyMarkup) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: replyMarkup,
      }),
    })
  } catch (err) {
    console.error('telegram-webhook: sendMessage failed:', err)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')

  // Optional extra protection: if a secret was configured on this
  // function AND on the bot's setWebhook call, only accept requests
  // that carry it. If it isn't configured, this check is skipped —
  // still fine, since nothing here is destructive without a valid,
  // unexpired, unconsumed token already having been created by a
  // logged-in user first.
  if (webhookSecret) {
    const incomingSecret = req.headers.get('x-telegram-bot-api-secret-token')
    if (incomingSecret !== webhookSecret) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders })
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!botToken || !supabaseUrl || !serviceKey) {
    console.error('telegram-webhook: missing required environment variables.')
    // Still 200 — Telegram will just keep retrying otherwise, and this
    // is a configuration problem, not something a retry fixes.
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  let update
  try {
    update = await req.json()
  } catch {
    return new Response('ok', { headers: corsHeaders })
  }

  const message = update?.message
  if (!message) {
    return new Response('ok', { headers: corsHeaders })
  }

  const chatId = message.chat?.id
  if (!chatId) {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ------------------------------------------------------------
    // Step 3: the student shared their contact.
    // ------------------------------------------------------------
    if (message.contact) {
      const { data: tokenRow, error: tokenLookupError } = await supabase
        .from('telegram_link_tokens')
        .select('*')
        .eq('telegram_chat_id', chatId)
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (tokenLookupError) throw tokenLookupError

      if (!tokenRow) {
        await sendTelegramMessage(
          botToken,
          chatId,
          "This link has expired or wasn't started from the website. Go back and tap \"Connect Telegram\" again."
        )
        return new Response('ok', { headers: corsHeaders })
      }

      const { error: upsertError } = await supabase.from('telegram_links').upsert(
        {
          user_id: tokenRow.user_id,
          telegram_chat_id: chatId,
          telegram_username: message.from?.username || null,
          phone_number: message.contact.phone_number || null,
        },
        { onConflict: 'user_id' }
      )

      if (upsertError) throw upsertError

      await supabase
        .from('telegram_link_tokens')
        .update({ consumed_at: new Date().toISOString() })
        .eq('token', tokenRow.token)

      await sendTelegramMessage(
        botToken,
        chatId,
        "You're all set! You'll get your speaking-exam reminders here too, alongside the website's push notifications."
      )

      return new Response('ok', { headers: corsHeaders })
    }

    // ------------------------------------------------------------
    // Step 2: "/start <token>" from the t.me deep link.
    // ------------------------------------------------------------
    const text = message.text || ''
    if (text.startsWith('/start')) {
      const token = text.split(' ')[1]?.trim()

      if (!token) {
        await sendTelegramMessage(
          botToken,
          chatId,
          'Open this from the "Connect Telegram" button on the website — that link carries the code this bot needs.'
        )
        return new Response('ok', { headers: corsHeaders })
      }

      const { data: tokenRow, error: tokenLookupError } = await supabase
        .from('telegram_link_tokens')
        .select('*')
        .eq('token', token)
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()

      if (tokenLookupError) throw tokenLookupError

      if (!tokenRow) {
        await sendTelegramMessage(
          botToken,
          chatId,
          "This link has expired. Go back to the website and tap \"Connect Telegram\" again."
        )
        return new Response('ok', { headers: corsHeaders })
      }

      const { error: updateError } = await supabase
        .from('telegram_link_tokens')
        .update({ telegram_chat_id: chatId })
        .eq('token', token)

      if (updateError) throw updateError

      await sendTelegramMessage(
        botToken,
        chatId,
        'Almost done — tap the button below to share your phone number and finish connecting.',
        {
          keyboard: [[{ text: '📱 Share my contact', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        }
      )

      return new Response('ok', { headers: corsHeaders })
    }

    return new Response('ok', { headers: corsHeaders })
  } catch (error) {
    console.error('telegram-webhook failed:', error)
    // Always 200 back to Telegram regardless — a 500 makes Telegram
    // retry the same update repeatedly, which won't fix a real error.
    return new Response('ok', { headers: corsHeaders })
  }
})
