// supabase/functions/telegram-bigfile/index.ts
//
// Saves files BIGGER than 20 MB that the teacher forwarded to the bot
// (2026-09-30). Telegram's normal Bot API refuses to hand bots anything
// over 20 MB, but a bot logged in over Telegram's own MTProto protocol
// (what the Telegram apps use) can download files up to 2 GB — same bot,
// same token, no extra server.
//
// Switched OFF until two secrets exist on the project (Edge Functions →
// Secrets): TELEGRAM_API_ID and TELEGRAM_API_HASH, which Jasur gets from
// https://my.telegram.org → "API development tools". telegram-webhook only
// calls this function when both are set.
//
// Called by telegram-webhook with the service-role key:
//   { chatId, messageId, teacherId, folderId, title, caption,
//     file: { fileName, mimeType, size, uniqueId } }
//
// The bot's MTProto login is kept in public.telegram_bot_session
// (migration_67, service-role only) so it doesn't log in again on every
// file — Telegram rate-limits repeated bot logins.

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { TelegramClient, Api } from 'npm:telegram@2'
import { StringSession } from 'npm:telegram@2/sessions'

const MATERIALS_BUCKET = 'materials'
// Edge Functions have limited memory; above this we ask for a website
// upload instead of risking a crash halfway through.
const MAX_BYTES = 180 * 1024 * 1024

function safeStorageName(name: string) {
  const clean = String(name || 'file')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return clean.slice(-120) || 'file'
}

async function botApi(botToken: string, method: string, body: Record<string, unknown>) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error(`telegram-bigfile: ${method} failed`, err)
  }
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')!
  const apiId = Number(Deno.env.get('TELEGRAM_API_ID'))
  const apiHash = Deno.env.get('TELEGRAM_API_HASH')

  // Only telegram-webhook (service role) may call this.
  if ((req.headers.get('authorization') || '') !== `Bearer ${serviceKey}`) {
    return new Response('Forbidden', { status: 403 })
  }
  if (!apiId || !apiHash) return new Response('big-file support is off', { status: 200 })

  const job = await req.json().catch(() => null)
  if (!job?.chatId || !job?.messageId || !job?.file) return new Response('bad request', { status: 400 })

  const run = async () => {
    const supabase = createClient(supabaseUrl, serviceKey)
    const { chatId, messageId, teacherId, folderId, title, caption, file } = job
    const say = (text: string) => botApi(botToken, 'sendMessage', { chat_id: chatId, text, reply_to_message_id: messageId })

    if (file.size && file.size > MAX_BYTES) {
      await say(`“${file.fileName}” is ${Math.round(file.size / 1048576)} MB — too big to copy over automatically. Please add it on the website: Materials Library → Upload files.`)
      return
    }

    let client: TelegramClient | null = null
    try {
      const { data: saved } = await supabase.from('telegram_bot_session').select('session').eq('id', 1).maybeSingle()
      client = new TelegramClient(new StringSession(saved?.session || ''), apiId, apiHash, {
        connectionRetries: 3,
        useWSS: true,
      })
      await client.start({ botAuthToken: botToken })
      const sessionString = (client.session as StringSession).save()
      if (sessionString && sessionString !== saved?.session) {
        await supabase.from('telegram_bot_session').upsert({ id: 1, session: sessionString, updated_at: new Date().toISOString() })
      }

      // In a private chat with the bot, message ids are enough to find the
      // message — no need to know the user's access hash.
      const result: any = await client.invoke(
        new Api.messages.GetMessages({ id: [new Api.InputMessageID({ id: Number(messageId) })] })
      )
      const message = result?.messages?.[0]
      if (!message?.media) throw new Error('Could not find that message any more.')

      const buffer = (await client.downloadMedia(message, {})) as Uint8Array
      if (!buffer || !buffer.byteLength) throw new Error('Telegram returned an empty file.')

      const storagePath = `${teacherId}/telegram/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeStorageName(file.fileName)}`
      const { error: upErr } = await supabase.storage
        .from(MATERIALS_BUCKET)
        .upload(storagePath, buffer, { contentType: file.mimeType || 'application/octet-stream', upsert: false })
      if (upErr) {
        const hint = /exceed|too large|payload/i.test(upErr.message)
          ? ' (raise “Upload file size limit” in Supabase → Storage → Settings)'
          : ''
        throw new Error(`storage: ${upErr.message}${hint}`)
      }
      const url = supabase.storage.from(MATERIALS_BUCKET).getPublicUrl(storagePath).data.publicUrl

      const { error: insErr } = await supabase.from('materials').insert({
        folder_id: folderId || null,
        title: title || file.fileName,
        file_name: file.fileName,
        storage_path: storagePath,
        url,
        mime_type: file.mimeType || null,
        size_bytes: file.size || buffer.byteLength,
        source: 'telegram',
        telegram_file_unique_id: file.uniqueId || null,
        caption: caption || null,
        created_by: teacherId,
      })
      if (insErr) {
        await supabase.storage.from(MATERIALS_BUCKET).remove([storagePath])
        if (!/duplicate|unique/i.test(insErr.message)) throw insErr
      }

      await botApi(botToken, 'setMessageReaction', {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji: '👌' }],
      })
    } catch (err) {
      console.error('telegram-bigfile failed:', err)
      await say(`Couldn't save the big file “${file.fileName}”: ${(err as Error)?.message || err}`)
    } finally {
      try {
        await client?.disconnect()
      } catch {
        // ignore
      }
    }
  }

  const runtime = (globalThis as any).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(run())
  else await run()
  return new Response('accepted', { status: 202 })
})
