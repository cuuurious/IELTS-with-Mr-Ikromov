// supabase/functions/telegram-webhook/index.ts
//
// Receives updates from Telegram's Bot API (configured as this bot's
// webhook URL via https://api.telegram.org/bot<token>/setWebhook).
//
// 1) "Connect Telegram": the website opens t.me/<bot>?start=<token>; we
//    remember the chat, ask for the user's contact, and on "Share my
//    contact" link the account in telegram_links. 2026-10-02: every reply
//    after that removes the "Share my contact" button (it used to stay on
//    screen if a connected user tapped it again), and students who send
//    the bot files/text get a short "submit on the website" answer
//    instead of silence — only the teacher's files go to the Library.
//
// 2) MATERIALS INBOX (2026-09-30, migration_66). Jasur: "most of my
//    files … are in telegram … i want my telegram account to be used for
//    my private life". When a TEACHER whose Telegram is connected sends
//    or forwards files to the bot (from any chat or channel), each file
//    is saved into the website's Materials Library:
//      - documents, PDFs, photos, audio, voice, video, round videos
//      - "#FolderName" in the caption files it into that folder
//        (created if it doesn't exist; "#Cambridge_17" → "Cambridge 17")
//      - otherwise it goes into the folder picked with /folder (or on
//        the website), else "Not in a folder"
//      - the same file forwarded twice is only saved once
//      - the bot reacts 👌 when saved, 🤝 if it was already there
//    Commands: /folder, /newfolder <name>, /help.
//    Bots may only download files up to 20 MB through the normal Bot
//    API; bigger files are handed to the `telegram-bigfile` function
//    when it's been switched on (TELEGRAM_API_ID/TELEGRAM_API_HASH set),
//    otherwise the bot explains how to add them on the website.
//
// Runs with the service-role key (a webhook has no user session) and is
// never called by the browser.

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BOT_API_MAX_DOWNLOAD = 20 * 1024 * 1024
const MATERIALS_BUCKET = 'materials'

// ------------------------------------------------------------------
// Telegram helpers
// ------------------------------------------------------------------
async function tg(botToken: string, method: string, body: Record<string, unknown>) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json().catch(() => null)
  } catch (err) {
    console.error(`telegram-webhook: ${method} failed:`, err)
    return null
  }
}

function sendTelegramMessage(botToken: string, chatId: number, text: string, replyMarkup?: unknown, extra: Record<string, unknown> = {}) {
  return tg(botToken, 'sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup, ...extra })
}

function react(botToken: string, chatId: number, messageId: number, emoji: string) {
  return tg(botToken, 'setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: 'emoji', emoji }],
  })
}

// ------------------------------------------------------------------
// File helpers
// ------------------------------------------------------------------
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif', zip: 'application/zip',
}
const EXT_BY_MIME: Record<string, string> = Object.fromEntries(Object.entries(MIME_BY_EXT).map(([e, m]) => [m, e]))

function safeStorageName(name: string) {
  const clean = String(name || 'file')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return clean.slice(-120) || 'file'
}

function titleFromFileName(name: string) {
  return String(name || 'File').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/_+/g, ' ').trim() || 'File'
}

type TgFile = {
  fileId: string
  uniqueId: string
  fileName: string
  mimeType: string
  size: number | null
}

// Pull the one file out of a message (a photo comes in several sizes —
// the biggest is kept).
export function extractFile(message: any): TgFile | null {
  const stamp = new Date((message.forward_date || message.date || Date.now() / 1000) * 1000)
    .toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const pick = (obj: any, fallbackName: string, fallbackMime: string): TgFile | null =>
    obj?.file_id
      ? {
          fileId: obj.file_id,
          uniqueId: obj.file_unique_id,
          fileName: obj.file_name || fallbackName,
          mimeType: obj.mime_type || fallbackMime,
          size: typeof obj.file_size === 'number' ? obj.file_size : null,
        }
      : null

  if (message.document) {
    const d = message.document
    const ext = String(d.file_name || '').split('.').pop()?.toLowerCase() || ''
    return pick(d, `file-${stamp}.${EXT_BY_MIME[d.mime_type] || 'bin'}`, d.mime_type || MIME_BY_EXT[ext] || 'application/octet-stream')
  }
  if (message.audio) {
    const a = message.audio
    const name = a.file_name || [a.performer, a.title].filter(Boolean).join(' - ') || `audio-${stamp}`
    return pick({ ...a, file_name: /\.[a-z0-9]{2,4}$/i.test(name) ? name : `${name}.${EXT_BY_MIME[a.mime_type] || 'mp3'}` }, name, a.mime_type || 'audio/mpeg')
  }
  if (message.video) return pick(message.video, `video-${stamp}.mp4`, 'video/mp4')
  if (message.voice) return pick(message.voice, `voice-${stamp}.ogg`, 'audio/ogg')
  if (message.video_note) return pick(message.video_note, `video-note-${stamp}.mp4`, 'video/mp4')
  if (message.animation) return pick(message.animation, `animation-${stamp}.mp4`, 'video/mp4')
  if (Array.isArray(message.photo) && message.photo.length) {
    const biggest = [...message.photo].sort((a, b) => (b.file_size || b.width * b.height) - (a.file_size || a.width * a.height))[0]
    return pick(biggest, `photo-${stamp}.jpg`, 'image/jpeg')
  }
  return null
}

// "#Cambridge_17 Reading test 3 answers" → folder "Cambridge 17",
// title "Reading test 3 answers"
export function parseCaption(caption: string | undefined) {
  const text = String(caption || '')
  const tag = text.match(/#([\p{L}\p{N}_-]{1,60})/u)?.[1] || null
  const folderName = tag ? tag.replace(/_+/g, ' ').trim() : null
  const firstLine = text.replace(/#[\p{L}\p{N}_-]+/gu, '').split('\n').map((l) => l.trim()).find(Boolean) || ''
  return { folderName, titleFromCaption: firstLine.slice(0, 120) || null, caption: text.trim() || null }
}

// ------------------------------------------------------------------
// Library helpers (service role)
// ------------------------------------------------------------------
async function teacherForChat(supabase: any, chatId: number) {
  const { data: link } = await supabase
    .from('telegram_links')
    .select('user_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle()
  if (!link?.user_id) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, status, full_name')
    .eq('id', link.user_id)
    .maybeSingle()
  if (!profile || profile.role !== 'teacher' || profile.status !== 'approved') return null
  return profile
}

// Any connected account (student, examiner or teacher) for this chat.
async function linkedProfileForChat(supabase: any, chatId: number) {
  const { data: link } = await supabase
    .from('telegram_links')
    .select('user_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle()
  if (!link?.user_id) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, status, full_name')
    .eq('id', link.user_id)
    .maybeSingle()
  return profile || null
}

// Removes the "📱 Share my contact" button from the chat (Telegram keeps
// a reply keyboard on screen until a message explicitly removes it).
const REMOVE_KEYBOARD = { remove_keyboard: true }

function studentInfoText(siteUrl?: string) {
  const site = (siteUrl || 'https://ieltswithmrikromov.com').replace(/\/+$/, '')
  return "You're connected ✅\n\n" +
    'This bot sends you homework, deadline reminders, messages and results from the website.\n\n' +
    'It does not accept homework — please submit your work on the website:\n' + site
}

async function findOrCreateFolder(supabase: any, name: string, userId: string) {
  const { data: existing } = await supabase
    .from('material_folders')
    .select('id, name, parent_id')
    .ilike('name', name.replace(/[%_]/g, (c) => `\\${c}`))
  const match = (existing || []).sort((a: any, b: any) => (a.parent_id ? 1 : 0) - (b.parent_id ? 1 : 0))[0]
  if (match) return { folder: match, created: false }
  const { data: created, error } = await supabase
    .from('material_folders')
    .insert({ name, parent_id: null, created_by: userId })
    .select('id, name, parent_id')
    .single()
  if (error) throw error
  return { folder: created, created: true }
}

async function currentFolder(supabase: any, userId: string) {
  const { data } = await supabase.from('material_inbox_state').select('folder_id').eq('user_id', userId).maybeSingle()
  if (!data?.folder_id) return null
  const { data: folder } = await supabase.from('material_folders').select('id, name').eq('id', data.folder_id).maybeSingle()
  return folder || null
}

async function foldersKeyboard(supabase: any) {
  const { data: folders } = await supabase.from('material_folders').select('id, name, parent_id').order('name')
  const list = folders || []
  const byParent: Record<string, any[]> = {}
  list.forEach((f: any) => { (byParent[f.parent_id || 'root'] = byParent[f.parent_id || 'root'] || []).push(f) })
  const rows: any[] = []
  const walk = (parent: string, depth: number) => {
    ;(byParent[parent] || []).forEach((f) => {
      rows.push([{ text: `${'   '.repeat(depth)}📁 ${f.name}`.slice(0, 60), callback_data: `f:${f.id}` }])
      walk(f.id, depth + 1)
    })
  }
  walk('root', 0)
  rows.push([{ text: '🗂 Not in a folder', callback_data: 'f:none' }])
  return { inline_keyboard: rows.slice(0, 90) }
}

const HELP_TEXT =
  'Forward or send me files from any chat or channel and I\'ll save them to your website Materials Library.\n\n' +
  '• Put #FolderName in the caption to file it (e.g. #Listening or #Cambridge_17).\n' +
  '• /folder — choose where files go when there\'s no #tag\n' +
  '• /newfolder Name — make a folder and save into it\n\n' +
  'I react 👌 when a file is saved and 🤝 if it was already in the library.'

// Saves one file message. Returns a short status for logging/tests.
export async function saveFileMessage(opts: {
  supabase: any
  botToken: string
  message: any
  teacher: { id: string }
  bigFileEnabled: boolean
  invokeBigFile?: (payload: Record<string, unknown>) => Promise<void>
  siteUrl?: string
}) {
  const { supabase, botToken, message, teacher } = opts
  const chatId = message.chat.id
  const file = extractFile(message)
  if (!file) return 'no-file'

  // Already saved?
  const { data: dup } = await supabase
    .from('materials')
    .select('id, title')
    .eq('telegram_file_unique_id', file.uniqueId)
    .maybeSingle()
  if (dup) {
    await react(botToken, chatId, message.message_id, '🤝')
    return 'duplicate'
  }

  const { folderName, titleFromCaption, caption } = parseCaption(message.caption)
  let folderId: string | null = null
  if (folderName) {
    const { folder, created } = await findOrCreateFolder(supabase, folderName, teacher.id)
    folderId = folder.id
    if (created) await sendTelegramMessage(botToken, chatId, `📁 New folder created: ${folder.name}`)
  } else {
    folderId = (await currentFolder(supabase, teacher.id))?.id || null
  }

  const title = titleFromCaption || titleFromFileName(file.fileName)

  if (file.size !== null && file.size > BOT_API_MAX_DOWNLOAD) {
    if (opts.bigFileEnabled && opts.invokeBigFile) {
      await opts.invokeBigFile({ chatId, messageId: message.message_id, teacherId: teacher.id, folderId, title, caption, file })
      await react(botToken, chatId, message.message_id, '👀')
      return 'big-file-queued'
    }
    const mb = Math.round(file.size / (1024 * 1024))
    await sendTelegramMessage(
      botToken,
      chatId,
      `“${file.fileName}” is ${mb} MB — Telegram only lets bots download files up to 20 MB, so I couldn't save this one.` +
        (opts.siteUrl ? `\nAdd it on the website instead: ${opts.siteUrl}` : '\nAdd it on the website in Materials Library → Upload files.'),
      undefined,
      { reply_to_message_id: message.message_id }
    )
    return 'too-big'
  }

  // Download from Telegram
  const info = await tg(botToken, 'getFile', { file_id: file.fileId })
  const filePath = info?.result?.file_path
  if (!filePath) {
    const desc = info?.description || 'unknown error'
    if (/too big/i.test(desc) && opts.bigFileEnabled && opts.invokeBigFile) {
      await opts.invokeBigFile({ chatId, messageId: message.message_id, teacherId: teacher.id, folderId, title, caption, file })
      await react(botToken, chatId, message.message_id, '👀')
      return 'big-file-queued'
    }
    await sendTelegramMessage(botToken, chatId, `Couldn't fetch “${file.fileName}” from Telegram (${desc}).`, undefined, { reply_to_message_id: message.message_id })
    return 'getfile-failed'
  }
  const res = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)
  if (!res.ok) {
    await sendTelegramMessage(botToken, chatId, `Couldn't download “${file.fileName}” (HTTP ${res.status}).`, undefined, { reply_to_message_id: message.message_id })
    return 'download-failed'
  }
  const bytes = new Uint8Array(await res.arrayBuffer())

  const storagePath = `${teacher.id}/telegram/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeStorageName(file.fileName)}`
  const { error: upErr } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(storagePath, bytes, { contentType: file.mimeType, upsert: false })
  if (upErr) {
    await sendTelegramMessage(botToken, chatId, `Couldn't store “${file.fileName}”: ${upErr.message}`, undefined, { reply_to_message_id: message.message_id })
    return 'upload-failed'
  }
  const url = supabase.storage.from(MATERIALS_BUCKET).getPublicUrl(storagePath).data.publicUrl

  const { error: insErr } = await supabase.from('materials').insert({
    folder_id: folderId,
    title,
    file_name: file.fileName,
    storage_path: storagePath,
    url,
    mime_type: file.mimeType,
    size_bytes: file.size ?? bytes.byteLength,
    source: 'telegram',
    telegram_file_unique_id: file.uniqueId,
    caption,
    created_by: teacher.id,
  })
  if (insErr) {
    await supabase.storage.from(MATERIALS_BUCKET).remove([storagePath])
    if (/duplicate|unique/i.test(insErr.message)) {
      await react(botToken, chatId, message.message_id, '🤝')
      return 'duplicate'
    }
    await sendTelegramMessage(botToken, chatId, `Couldn't save “${file.fileName}”: ${insErr.message}`, undefined, { reply_to_message_id: message.message_id })
    return 'insert-failed'
  }

  await react(botToken, chatId, message.message_id, '👌')
  return 'saved'
}

// ------------------------------------------------------------------
// Teacher commands / callbacks
// ------------------------------------------------------------------
async function handleTeacherText(supabase: any, botToken: string, message: any, teacher: any) {
  const chatId = message.chat.id
  const text = String(message.text || '').trim()

  if (/^\/folder(@\w+)?$/i.test(text)) {
    const current = await currentFolder(supabase, teacher.id)
    await sendTelegramMessage(
      botToken,
      chatId,
      `Files without a #tag are saved into: ${current ? `📁 ${current.name}` : '🗂 Not in a folder'}\nPick another folder:`,
      await foldersKeyboard(supabase)
    )
    return
  }

  const newFolder = text.match(/^\/newfolder(@\w+)?\s+(.{1,80})$/i)
  if (newFolder) {
    const { folder, created } = await findOrCreateFolder(supabase, newFolder[2].trim(), teacher.id)
    await supabase.from('material_inbox_state').upsert({ user_id: teacher.id, folder_id: folder.id, updated_at: new Date().toISOString() })
    await sendTelegramMessage(botToken, chatId, `${created ? 'Created' : 'Found'} 📁 ${folder.name} — new files will be saved there.`)
    return
  }

  await sendTelegramMessage(botToken, chatId, HELP_TEXT, REMOVE_KEYBOARD)
}

async function handleCallback(supabase: any, botToken: string, callback: any) {
  const chatId = callback.message?.chat?.id
  const data = String(callback.data || '')
  if (!chatId || !data.startsWith('f:')) {
    await tg(botToken, 'answerCallbackQuery', { callback_query_id: callback.id })
    return
  }
  const teacher = await teacherForChat(supabase, chatId)
  if (!teacher) {
    await tg(botToken, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Only the teacher account can do this.' })
    return
  }
  const folderId = data === 'f:none' ? null : data.slice(2)
  let label = '🗂 Not in a folder'
  if (folderId) {
    const { data: folder } = await supabase.from('material_folders').select('id, name').eq('id', folderId).maybeSingle()
    if (!folder) {
      await tg(botToken, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'That folder no longer exists.' })
      return
    }
    label = `📁 ${folder.name}`
  }
  await supabase.from('material_inbox_state').upsert({ user_id: teacher.id, folder_id: folderId, updated_at: new Date().toISOString() })
  await tg(botToken, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Saved' })
  await tg(botToken, 'editMessageText', {
    chat_id: chatId,
    message_id: callback.message.message_id,
    text: `New files without a #tag will be saved into: ${label}`,
  })
}

// ------------------------------------------------------------------
// Connect-Telegram flow (unchanged behaviour)
// ------------------------------------------------------------------
async function handleLinking(supabase: any, botToken: string, message: any, siteUrl?: string): Promise<boolean> {
  const chatId = message.chat.id

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
      // Most often: already connected and tapped "Share my contact" again.
      const linked = await linkedProfileForChat(supabase, chatId)
      await sendTelegramMessage(
        botToken,
        chatId,
        linked
          ? (linked.role === 'teacher' ? "You're already connected ✅\n\n" + HELP_TEXT : studentInfoText(siteUrl))
          : "This link has expired or wasn't started from the website. Go back and tap \"Connect Telegram\" again.",
        REMOVE_KEYBOARD
      )
      return true
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

    await supabase.from('telegram_link_tokens').update({ consumed_at: new Date().toISOString() }).eq('token', tokenRow.token)

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', tokenRow.user_id).maybeSingle()
    await sendTelegramMessage(
      botToken,
      chatId,
      profile?.role === 'teacher'
        ? "You're connected! ✅\n\n" + HELP_TEXT
        : studentInfoText(siteUrl),
      REMOVE_KEYBOARD
    )
    return true
  }

  const text = message.text || ''
  if (text.startsWith('/start')) {
    const token = text.split(' ')[1]?.trim()

    if (!token) {
      // Someone opening the bot directly (not from the website button).
      const linked = await linkedProfileForChat(supabase, chatId)
      await sendTelegramMessage(
        botToken,
        chatId,
        linked
          ? (linked.role === 'teacher' && linked.status === 'approved' ? HELP_TEXT : studentInfoText(siteUrl))
          : 'Open this from the "Connect Telegram" button on the website — that link carries the code this bot needs.',
        REMOVE_KEYBOARD
      )
      return true
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
      await sendTelegramMessage(botToken, chatId, 'This link has expired. Go back to the website and tap "Connect Telegram" again.')
      return true
    }

    const { error: updateError } = await supabase.from('telegram_link_tokens').update({ telegram_chat_id: chatId }).eq('token', token)
    if (updateError) throw updateError

    await sendTelegramMessage(botToken, chatId, 'Almost done — tap the button below to share your phone number and finish connecting.', {
      keyboard: [[{ text: '📱 Share my contact', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    })
    return true
  }

  return false
}

// ------------------------------------------------------------------
// Entry point
// ------------------------------------------------------------------
export async function handleUpdate(update: any, env: {
  supabase: any
  botToken: string
  bigFileEnabled: boolean
  invokeBigFile?: (payload: Record<string, unknown>) => Promise<void>
  siteUrl?: string
}) {
  const { supabase, botToken } = env

  if (update?.callback_query) {
    await handleCallback(supabase, botToken, update.callback_query)
    return 'callback'
  }

  const message = update?.message
  const chatId = message?.chat?.id
  if (!message || !chatId) return 'ignored'

  // Only private chats with the bot — never act on group messages.
  if (message.chat.type && message.chat.type !== 'private') return 'ignored'

  if (await handleLinking(supabase, botToken, message, env.siteUrl)) return 'linking'

  const teacher = await teacherForChat(supabase, chatId)
  if (!teacher) {
    // Students (and anyone else) can't save files to the Materials
    // Library — tell them once per message instead of silently ignoring
    // it, and point them to the website for homework. Albums arrive as
    // one message per photo: answer only the first one (the one with a
    // caption, or a lone message).
    if (message.media_group_id && !message.caption) return 'not-teacher'
    const linked = await linkedProfileForChat(supabase, chatId)
    await sendTelegramMessage(
      botToken,
      chatId,
      linked
        ? studentInfoText(env.siteUrl)
        : 'Open this from the "Connect Telegram" button on the website — that link carries the code this bot needs.',
      REMOVE_KEYBOARD
    )
    return 'not-teacher'
  }

  if (extractFile(message)) {
    return await saveFileMessage({ ...env, message, teacher })
  }
  if (message.text) {
    await handleTeacherText(supabase, botToken, message, teacher)
    return 'command'
  }
  return 'ignored'
}

if (typeof Deno !== 'undefined' && (Deno as any).serve && !(globalThis as any).__TEST__) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
    if (webhookSecret) {
      const incomingSecret = req.headers.get('x-telegram-bot-api-secret-token')
      if (incomingSecret !== webhookSecret) return new Response('Forbidden', { status: 403, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!botToken || !supabaseUrl || !serviceKey) {
      console.error('telegram-webhook: missing required environment variables.')
      return new Response('ok', { headers: corsHeaders })
    }

    let update
    try {
      update = await req.json()
    } catch {
      return new Response('ok', { headers: corsHeaders })
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const bigFileEnabled = Boolean(Deno.env.get('TELEGRAM_API_ID') && Deno.env.get('TELEGRAM_API_HASH'))
    const invokeBigFile = async (payload: Record<string, unknown>) => {
      await fetch(`${supabaseUrl}/functions/v1/telegram-bigfile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify(payload),
      })
    }

    // Answer Telegram straight away and do the (possibly slow) download +
    // upload in the background, so a big batch of forwarded files never
    // makes Telegram time out and resend them.
    const work = handleUpdate(update, {
      supabase,
      botToken,
      bigFileEnabled,
      invokeBigFile,
      siteUrl: Deno.env.get('SITE_URL') || undefined,
    }).catch((error) => console.error('telegram-webhook failed:', error))

    const runtime = (globalThis as any).EdgeRuntime
    if (runtime?.waitUntil) runtime.waitUntil(work)
    else await work

    // Always 200 — a 500 makes Telegram retry the same update forever.
    return new Response('ok', { headers: corsHeaders })
  })
}
