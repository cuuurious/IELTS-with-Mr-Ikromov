import { supabase } from './supabaseClient'
import { guessMimeType } from './mime'

/*
 * Materials Library helpers (migration_66, 2026-09-30).
 *
 * Files live in the public `materials` storage bucket; every file also
 * gets a row in `materials` (title, folder, size, where it came from).
 * Files forwarded to the Telegram bot are saved by the telegram-webhook
 * edge function using exactly the same shape.
 */

export const MATERIALS_BUCKET = 'materials'

// "Cambridge 17 – Test 1 (Listening).mp3" -> "Cambridge-17-Test-1-Listening.mp3"
// Storage keys must be plain ASCII; the original name is kept in the row.
export function safeStorageName(name) {
  const clean = String(name || 'file')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return clean.slice(-120) || 'file'
}

export function titleFromFileName(name) {
  const base = String(name || 'File').replace(/\.[a-z0-9]{1,5}$/i, '')
  return base.replace(/[_]+/g, ' ').trim() || 'File'
}

export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function fileKind(nameOrMime) {
  const s = String(nameOrMime || '').toLowerCase()
  if (/^image\/|\.(png|jpe?g|gif|webp|heic|heif|svg)$/.test(s)) return 'image'
  if (/^audio\/|\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|wma|amr)$/.test(s)) return 'audio'
  if (/^video\/|\.(mp4|mov|webm|mkv|avi)$/.test(s)) return 'video'
  if (/pdf$/.test(s)) return 'pdf'
  if (/(text\/html|\.html?$)/.test(s)) return 'html'
  if (/(msword|wordprocessingml|\.docx?$)/.test(s)) return 'doc'
  if (/(ms-excel|spreadsheetml|\.xlsx?$|\.csv$)/.test(s)) return 'sheet'
  if (/(ms-powerpoint|presentationml|\.pptx?$)/.test(s)) return 'slides'
  return 'file'
}

export const KIND_LABEL = {
  image: 'IMG',
  audio: 'AUDIO',
  video: 'VIDEO',
  pdf: 'PDF',
  html: 'PAGE',
  doc: 'DOC',
  sheet: 'XLS',
  slides: 'PPT',
  file: 'FILE',
}

// Upload one file into the library. `onProgress` isn't available from
// supabase-js's simple upload, so callers show per-file "uploading…".
export async function uploadMaterial(file, { folderId = null, userId } = {}) {
  const contentType = guessMimeType(file.name, file.type)
  const path = `${userId || 'teacher'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeStorageName(file.name)}`

  const { error: uploadError } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .upload(path, file, { contentType, upsert: false })
  if (uploadError) throw uploadError

  const url = supabase.storage.from(MATERIALS_BUCKET).getPublicUrl(path).data.publicUrl

  const { data, error } = await supabase
    .from('materials')
    .insert({
      folder_id: folderId,
      title: titleFromFileName(file.name),
      file_name: file.name,
      storage_path: path,
      url,
      mime_type: contentType,
      size_bytes: file.size,
      source: 'upload',
    })
    .select()
    .single()

  if (error) {
    // Don't leave an orphaned file behind if the row couldn't be saved.
    await supabase.storage.from(MATERIALS_BUCKET).remove([path])
    throw error
  }
  return data
}

// Folder helpers — folders come back flat; these build the tree/paths.
export function folderPath(folderId, foldersById) {
  const parts = []
  let current = foldersById[folderId]
  let guard = 0
  while (current && guard < 20) {
    parts.unshift(current.name)
    current = current.parent_id ? foldersById[current.parent_id] : null
    guard += 1
  }
  return parts.join(' › ')
}

export function descendantIds(folderId, folders) {
  const out = new Set([folderId])
  let added = true
  while (added) {
    added = false
    folders.forEach((f) => {
      if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) {
        out.add(f.id)
        added = true
      }
    })
  }
  return out
}
