// supabase/functions/telegram-group-post/index.ts
//
// HOMEWORK → TELEGRAM GROUP (2026-10-08, migration_79).
//
// Jasur still posted every lesson's homework by hand in each group's
// Telegram chat ("Assalomu aleykum. Lesson 3. October 8." + the PDFs,
// audio and HTML files), on top of the website. Now the website does it:
// when the teacher posts homework for a group whose Telegram chat was
// linked with /connect (see telegram-webhook), the bot posts
//
//   Assalomu aleykum. Lesson 4. October 8.        ← once per lesson
//   1. <b>Title</b> + task + deadline   [📝 Open on the website]
//      <the real files: PDF, audio, Word, HTML, pictures…>
//   2. …
//
// Called by the website (teacher's session) right after a homework is
// posted ("post") or edited ("update"). Deleting a homework is handled
// by the database (trigger → notify-telegram deletes the messages).
//
// Files: library files that came in through the bot are re-sent by
// their Telegram file_id (instant, any size). Everything else is
// downloaded from storage and uploaded (Telegram's limit for bots:
// 50 MB; photos 10 MB). The file_id Telegram hands back is saved on the
// library file, so the next time it goes out instantly.

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UPLOAD_LIMIT = 50 * 1024 * 1024
const PHOTO_LIMIT = 10 * 1024 * 1024
const TZ = 'Asia/Tashkent'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

export function escapeHtml(value: string) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// "2026-10-08" → "October 8"
export function formatLessonDate(d?: string | null) {
  if (!d) return ''
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number)
  if (!y || !m || !day) return ''
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export function lessonHeader(n?: number | null, d?: string | null) {
  const parts = ['Assalomu aleykum.']
  if (n) parts.push(`Lesson ${n}.`)
  const date = formatLessonDate(d)
  if (date) parts.push(`${date}.`)
  return parts.join(' ')
}

export function formatDeadline(iso?: string | null) {
  if (!iso) return ''
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return ''
  const date = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: TZ })
  const time = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
  return `${date}, ${time}`
}

const MOCK_LABEL: Record<string, string> = {
  task1: 'Writing Task 1',
  task2: 'Writing Task 2',
  full: 'Writing Task 1 + Task 2',
}

export function homeworkText(hw: any, n: number | null, fileCount: number, skipped: string[] = []) {
  const lines: string[] = []
  lines.push(`${n ? `${n}. ` : ''}<b>${escapeHtml(hw.title || 'Homework')}</b>`)
  const desc = String(hw.description || '').trim()
  if (desc) lines.push(escapeHtml(desc.length > 3000 ? desc.slice(0, 2997) + '…' : desc))
  if (hw.homework_type === 'writing_mock') {
    const what = MOCK_LABEL[hw.mock_task_mode] || 'Writing test'
    const mins = hw.mock_time_limit_minutes ? `, ${hw.mock_time_limit_minutes} min` : ''
    lines.push(`✍️ ${what}${mins} — write it on the website.`)
  }
  const extra: string[] = []
  const deadline = formatDeadline(hw.due_date)
  if (deadline) extra.push(`⏰ Deadline: ${deadline}`)
  if (fileCount) extra.push(`📎 ${fileCount} file${fileCount === 1 ? '' : 's'} below`)
  if (skipped.length) extra.push(`⚠️ Too big for Telegram — open on the website: ${skipped.map(escapeHtml).join(', ')}`)
  if (extra.length) lines.push('', ...extra)
  return lines.join('\n')
}

type FileItem = {
  key: string
  name: string
  url: string | null
  mime: string
  size: number | null
  materialId: string | null
  fileId: string | null
  fileKind: string | null
}

const KIND_METHOD: Record<string, [string, string]> = {
  document: ['sendDocument', 'document'],
  audio: ['sendAudio', 'audio'],
  photo: ['sendPhoto', 'photo'],
  video: ['sendVideo', 'video'],
  voice: ['sendVoice', 'voice'],
  video_note: ['sendVideoNote', 'video_note'],
  animation: ['sendAnimation', 'animation'],
}

export function kindForFile(mime: string, name: string, size: number | null) {
  const m = String(mime || '').toLowerCase()
  const ext = String(name || '').split('.').pop()?.toLowerCase() || ''
  if (/^audio\/(mpeg|mp3|mp4|x-m4a|m4a|aac)$/.test(m) || ['mp3', 'm4a'].includes(ext)) return 'audio'
  if (/^image\/(jpeg|png|webp)$/.test(m) && (size == null || size <= PHOTO_LIMIT)) return 'photo'
  if (m === 'video/mp4' || ext === 'mp4') return 'video'
  return 'document'
}

function fileIdFromResult(result: any, field: string) {
  if (!result) return null
  if (field === 'photo' && Array.isArray(result.photo)) return result.photo[result.photo.length - 1]?.file_id || null
  return result[field]?.file_id || result.document?.file_id || null
}

export async function handle(action: string, homeworkId: string, env: { supabase: any; botToken: string; siteUrl: string; fetchImpl?: typeof fetch }) {
  const { supabase, botToken, siteUrl } = env
  const doFetch = env.fetchImpl || fetch

  const tg = async (method: string, body: Record<string, unknown> | FormData) => {
    try {
      const isForm = typeof FormData !== 'undefined' && body instanceof FormData
      const res = await doFetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'Content-Type': 'application/json' },
        body: isForm ? (body as FormData) : JSON.stringify(body),
      })
      return await res.json().catch(() => null)
    } catch (err) {
      console.error(`telegram-group-post: ${method} threw`, err)
      return null
    }
  }

  const { data: hw, error: hwErr } = await supabase.from('homeworks').select('*').eq('id', homeworkId).maybeSingle()
  if (hwErr) throw hwErr
  if (!hw) return { ok: false, status: 'homework_not_found' }

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, telegram_chat_id')
    .eq('id', hw.group_id)
    .maybeSingle()
  const chatId = group?.telegram_chat_id ? Number(group.telegram_chat_id) : null
  if (!chatId) return { ok: true, status: 'not_linked' }

  // ---------- files ----------
  const { data: atts } = await supabase
    .from('homework_attachments')
    .select('id, material_id, url, name, mime_type, size_bytes, sort_order')
    .eq('homework_id', hw.id)
    .order('sort_order', { ascending: true })
  const materialIds = (atts || []).map((a: any) => a.material_id).filter(Boolean)
  let materialsById: Record<string, any> = {}
  if (materialIds.length) {
    const { data: mats } = await supabase
      .from('materials')
      .select('id, url, telegram_file_id, telegram_file_kind, mime_type, size_bytes, file_name')
      .in('id', materialIds)
    materialsById = Object.fromEntries((mats || []).map((m: any) => [m.id, m]))
  }
  const files: FileItem[] = []
  for (const a of atts || []) {
    const mat = a.material_id ? materialsById[a.material_id] : null
    files.push({
      key: a.material_id ? `material:${a.material_id}` : `url:${a.url}`,
      name: a.name || mat?.file_name || 'file',
      url: a.url || mat?.url || null,
      mime: a.mime_type || mat?.mime_type || '',
      size: a.size_bytes ?? mat?.size_bytes ?? null,
      materialId: a.material_id || null,
      fileId: mat?.telegram_file_id || null,
      fileKind: mat?.telegram_file_kind || null,
    })
  }
  if (hw.attachment_url) {
    files.unshift({
      key: `url:${hw.attachment_url}`,
      name: hw.attachment_name || 'file',
      url: hw.attachment_url,
      mime: '',
      size: null,
      materialId: null,
      fileId: null,
      fileKind: null,
    })
  }
  if (hw.homework_type === 'writing_mock' && hw.mock_task1_image_url) {
    files.push({ key: `url:${hw.mock_task1_image_url}`, name: 'Task 1.png', url: hw.mock_task1_image_url, mime: 'image/png', size: null, materialId: null, fileId: null, fileKind: null })
  }
  const skippedBig = files.filter((f) => !f.fileId && f.size != null && f.size > UPLOAD_LIMIT).map((f) => f.name)
  const sendable = files.filter((f) => f.fileId || f.size == null || f.size <= UPLOAD_LIMIT)

  const sendFile = async (f: FileItem): Promise<number | null> => {
    if (f.fileId) {
      const [method, field] = KIND_METHOD[f.fileKind || 'document'] || KIND_METHOD.document
      const r = await tg(method, { chat_id: chatId, [field]: f.fileId, disable_notification: true })
      if (r?.ok) return r.result.message_id
      console.error('telegram-group-post: resend by file_id failed', r?.description)
      if (!f.url) return null
    }
    if (!f.url) return null
    let res: Response
    try {
      res = await doFetch(f.url)
    } catch {
      return null
    }
    if (!res.ok) {
      console.error('telegram-group-post: download failed', f.name, res.status)
      return null
    }
    const len = Number(res.headers.get('content-length') || 0)
    if (len > UPLOAD_LIMIT) {
      skippedBig.push(f.name)
      return null
    }
    const blob = await res.blob()
    if (blob.size > UPLOAD_LIMIT) {
      skippedBig.push(f.name)
      return null
    }
    const mime = f.mime || blob.type || 'application/octet-stream'
    const kind = kindForFile(mime, f.name, blob.size)
    const [method, field] = KIND_METHOD[kind]
    const form = new FormData()
    form.append('chat_id', String(chatId))
    form.append('disable_notification', 'true')
    form.append(field, new File([blob], f.name, { type: mime }))
    let r = await tg(method, form)
    if (!r?.ok && kind !== 'document') {
      // e.g. an audio Telegram can't read as music — send it as a file.
      const retry = new FormData()
      retry.append('chat_id', String(chatId))
      retry.append('disable_notification', 'true')
      retry.append('document', new File([blob], f.name, { type: mime }))
      r = await tg('sendDocument', retry)
      if (r?.ok && f.materialId) {
        await supabase.from('materials').update({ telegram_file_id: fileIdFromResult(r.result, 'document'), telegram_file_kind: 'document' }).eq('id', f.materialId)
      }
      return r?.ok ? r.result.message_id : null
    }
    if (!r?.ok) {
      console.error('telegram-group-post: upload failed', f.name, r?.description)
      return null
    }
    if (f.materialId) {
      const newId = fileIdFromResult(r.result, field)
      if (newId) await supabase.from('materials').update({ telegram_file_id: newId, telegram_file_kind: kind }).eq('id', f.materialId)
    }
    return r.result.message_id
  }

  const sendFiles = async (items: FileItem[]) => {
    const ids: number[] = []
    for (const f of items) {
      const id = await sendFile(f)
      if (id) ids.push(id)
    }
    return ids
  }

  // ---------- lesson number within the lesson ----------
  const hasLesson = hw.lesson_number != null || hw.lesson_date != null
  let position: number | null = null
  if (hasLesson) {
    let q = supabase.from('homeworks').select('id', { count: 'exact', head: true }).eq('group_id', hw.group_id).lte('created_at', hw.created_at)
    q = hw.lesson_number != null ? q.eq('lesson_number', hw.lesson_number) : q.is('lesson_number', null)
    q = hw.lesson_date != null ? q.eq('lesson_date', hw.lesson_date) : q.is('lesson_date', null)
    const { count } = await q
    position = count || 1
  }

  const ensureHeader = async () => {
    if (!hasLesson) return
    const find = async () => {
      let q = supabase.from('group_lesson_posts').select('id, message_id').eq('group_id', hw.group_id).eq('chat_id', chatId)
      q = hw.lesson_number != null ? q.eq('lesson_number', hw.lesson_number) : q.is('lesson_number', null)
      q = hw.lesson_date != null ? q.eq('lesson_date', hw.lesson_date) : q.is('lesson_date', null)
      const { data } = await q.limit(1)
      return data?.[0] || null
    }
    const existing = await find()
    if (existing) {
      // Another homework of this lesson is sending the header right now —
      // wait for it so the header stays on top.
      for (let i = 0; i < 10 && Number(existing.message_id) === 0; i++) {
        await new Promise((r) => setTimeout(r, 700))
        const again = await find()
        if (!again || Number(again.message_id) !== 0) break
      }
      return
    }
    // Claim the header first (unique index), then send it.
    const { data: claim, error: claimErr } = await supabase
      .from('group_lesson_posts')
      .insert({ group_id: hw.group_id, chat_id: chatId, lesson_number: hw.lesson_number, lesson_date: hw.lesson_date, message_id: 0 })
      .select('id')
      .single()
    if (claimErr || !claim) return
    const r = await tg('sendMessage', { chat_id: chatId, text: lessonHeader(hw.lesson_number, hw.lesson_date) })
    if (r?.ok) {
      await supabase.from('group_lesson_posts').update({ message_id: r.result.message_id }).eq('id', claim.id)
    } else {
      await supabase.from('group_lesson_posts').delete().eq('id', claim.id)
    }
  }

  const button = { inline_keyboard: [[{ text: '📝 Open on the website', url: `${siteUrl}/app?nav=${encodeURIComponent(`homework:${hw.id}`)}` }]] }

  const { data: existingPost } = await supabase.from('homework_telegram_posts').select('*').eq('homework_id', hw.id).maybeSingle()
  const keys = sendable.map((f) => f.key)

  const postFresh = async () => {
    await ensureHeader()
    const knownBig = skippedBig.length
    const text = homeworkText(hw, position, sendable.length, skippedBig)
    const sent = await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: button })
    if (!sent?.ok) {
      console.error('telegram-group-post: sendMessage failed', sent?.description)
      return { ok: false, status: 'send_failed', error: sent?.description || 'Telegram refused the message' }
    }
    const fileIds = await sendFiles(sendable)
    if (skippedBig.length > knownBig || fileIds.length !== sendable.length) {
      // A file turned out too big (or failed) while uploading — fix the count.
      await tg('editMessageText', { chat_id: chatId, message_id: sent.result.message_id, text: homeworkText(hw, position, fileIds.length, skippedBig), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: button })
    }
    await supabase.from('homework_telegram_posts').upsert({
      homework_id: hw.id,
      group_id: hw.group_id,
      chat_id: chatId,
      text_message_id: sent.result.message_id,
      file_message_ids: fileIds,
      attachment_keys: keys,
      updated_at: new Date().toISOString(),
    })
    return { ok: true, status: 'posted', files: fileIds.length, skipped: skippedBig }
  }

  // Never posted here yet (also: edited a homework that was posted before
  // the group was linked, or the group was re-linked to another chat).
  if (!existingPost || Number(existingPost.chat_id) !== chatId) return await postFresh()

  // ---------- update an existing post ----------
  const sameFiles = keys.length === (existingPost.attachment_keys || []).length && keys.every((k, i) => k === existingPost.attachment_keys[i])
  const fileIds: number[] = existingPost.file_message_ids || []
  if (!sameFiles) {
    // Files changed — take the old post down and post it again, so the
    // text and its files stay together.
    for (const mid of [existingPost.text_message_id, ...fileIds].filter(Boolean)) {
      await tg('deleteMessage', { chat_id: chatId, message_id: mid })
    }
    const fresh = await postFresh()
    return { ...fresh, status: fresh.ok ? 'reposted' : fresh.status }
  }
  await ensureHeader()
  const text = homeworkText(hw, position, fileIds.length, skippedBig)
  const edited = await tg('editMessageText', { chat_id: chatId, message_id: existingPost.text_message_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: button })
  let textId = existingPost.text_message_id
  if (!edited?.ok && !/not modified/i.test(edited?.description || '')) {
    // The message was deleted in Telegram — send it again.
    const sent = await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: button })
    if (sent?.ok) textId = sent.result.message_id
  }
  await supabase.from('homework_telegram_posts').update({
    text_message_id: textId,
    file_message_ids: fileIds,
    attachment_keys: keys,
    updated_at: new Date().toISOString(),
  }).eq('homework_id', hw.id)
  return { ok: true, status: 'updated', files: fileIds.length, skipped: skippedBig }
}

if (typeof Deno !== 'undefined' && (Deno as any).serve && !(globalThis as any).__TEST__) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    const siteUrl = (Deno.env.get('SITE_URL') || 'https://ieltswithmrikromov.com').replace(/\/+$/, '')
    if (!supabaseUrl || !serviceKey || !botToken) return json({ ok: false, error: 'Not configured.' }, 500)

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    // Teachers only.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: userData } = await supabase.auth.getUser(token)
    const userId = userData?.user?.id
    if (!userId) return json({ ok: false, error: 'Not signed in.' }, 401)
    const { data: profile } = await supabase.from('profiles').select('role, status').eq('id', userId).maybeSingle()
    if (profile?.role !== 'teacher' || profile?.status !== 'approved') return json({ ok: false, error: 'Teachers only.' }, 403)

    const body = await req.json().catch(() => ({}))
    const action = body?.action === 'update' ? 'update' : 'post'
    const homeworkId = String(body?.homework_id || '')
    if (!/^[0-9a-f-]{36}$/i.test(homeworkId)) return json({ ok: false, error: 'homework_id is required.' }, 400)

    // Quick answer for the website: is this group linked at all?
    const { data: hwRow } = await supabase.from('homeworks').select('group_id').eq('id', homeworkId).maybeSingle()
    if (!hwRow) return json({ ok: false, status: 'homework_not_found' }, 404)
    const { data: groupRow } = await supabase.from('groups').select('telegram_chat_id, telegram_chat_title').eq('id', hwRow.group_id).maybeSingle()
    if (!groupRow?.telegram_chat_id) return json({ ok: true, status: 'not_linked' })

    // Uploading big audio files can take a while — answer straight away
    // and keep working in the background.
    const work = handle(action, homeworkId, { supabase, botToken, siteUrl })
      .then((r) => { if (!r?.ok) console.error('telegram-group-post:', JSON.stringify(r)) })
      .catch((err) => console.error('telegram-group-post failed', err))
    const runtime = (globalThis as any).EdgeRuntime
    if (runtime?.waitUntil) {
      runtime.waitUntil(work)
      return json({ ok: true, status: 'posting', chat: groupRow.telegram_chat_title || null })
    }
    await work
    return json({ ok: true, status: 'posted', chat: groupRow.telegram_chat_title || null })
  })
}
