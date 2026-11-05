import { supabase } from './supabaseClient'
import { MATERIALS_BUCKET, safeStorageName, titleFromFileName } from './materials'
import { guessMimeType } from './mime'
import { detectFromHtml, detectFromPath, htmlTitle } from './questionTypes'

/*
 * PRACTICE BANK (2026-11-02, migration_92).
 *
 * Mr Ikromov's interactive HTML pages — Reading and Listening books,
 * Writing Task 1 / Task 2 tests, workshops — kept apart from the Materials
 * Library. Each page is a `materials` row with a `collection` (the book or
 * set), a skill, a question type and a position, so homework tasks, the
 * students' Books shelf, scores and weak spots all keep working.
 */

export const BANK_SKILLS = [
  { value: 'reading', label: 'Reading' },
  { value: 'listening', label: 'Listening' },
  { value: 'writing', label: 'Writing' },
  { value: 'workshop', label: 'Workshops' },
]

export const BANK_FIELDS = 'id, title, url, file_name, skill, question_type, collection, position, on_shelf, created_at'

export async function loadBank() {
  const { data, error } = await supabase
    .from('materials')
    .select(BANK_FIELDS)
    .not('collection', 'is', null)
    .order('collection')
    .order('position', { ascending: true })
  if (error) return { pages: [], missing: /collection/.test(error.message || ''), error }
  return { pages: data || [], missing: false, error: null }
}

// Which groups already got each page as homework (2026-11-05):
// { url: Set(groupId) }. Used for the "Given" marks and so weak-spot
// suggestions only pick pages a group hasn't done.
export async function loadGivenPages() {
  const { data, error } = await supabase
    .from('homework_tasks')
    .select('html_url, homeworks!inner(group_id)')
    .eq('kind', 'html')
    .not('html_url', 'is', null)
  const map = {}
  if (error) return map
  ;(data || []).forEach((r) => {
    const g = r.homeworks?.group_id
    if (!g) return
    ;(map[r.html_url] = map[r.html_url] || new Set()).add(g)
  })
  return map
}

const isHtml = (f) => /\.html?$/i.test(f.name)
const isAudio = (f) => /\.(mp3|m4a|wav|ogg|aac)$/i.test(f.name)
const relPath = (f) => f.webkitRelativePath || f.name

async function putFile(file, userId, body) {
  const contentType = guessMimeType(file.name, file.type)
  const path = `${userId || 'teacher'}/bank/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeStorageName(file.name)}`
  const { error } = await supabase.storage.from(MATERIALS_BUCKET).upload(path, body || file, { contentType, upsert: false })
  if (error) throw error
  return { path, url: supabase.storage.from(MATERIALS_BUCKET).getPublicUrl(path).data.publicUrl, contentType }
}

function resolveRel(base, src) {
  const parts = base.split('/').slice(0, -1)
  for (const seg of src.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/*
 * Upload pages (and any audio next to them) into one collection.
 * `files` is a FileList from a file or folder picker. Pages are numbered
 * in natural name order after `startAt`. Audio is uploaded first and the
 * pages are pointed at it (src="audio/part1-test1.mp3" → its address).
 * onProgress({ done, total, failed }) after each file.
 */
export async function uploadPages({ files, skill, collection, userId, startAt = 0, onShelf = false, onProgress }) {
  const list = Array.from(files || []).filter((f) => f.size > 0)
  const pages = list.filter(isHtml).sort((a, b) => relPath(a).localeCompare(relPath(b), undefined, { numeric: true }))
  const audio = list.filter(isAudio)
  const total = pages.length + audio.length
  let done = 0
  const failed = []
  const tick = () => onProgress?.({ done, total, failed: failed.length })

  const audioUrl = {}
  const aq = [...audio]
  const audioWorker = async () => {
    while (aq.length) {
      const f = aq.shift()
      try {
        const up = await putFile(f, userId)
        audioUrl[relPath(f)] = up.url
        audioUrl[f.name.toLowerCase()] = up.url
      } catch (e) {
        failed.push(`${f.name}: ${e.message}`)
      }
      done += 1
      tick()
    }
  }
  await Promise.all([audioWorker(), audioWorker(), audioWorker()])

  const rows = []
  const pq = pages.map((f, i) => ({ f, i }))
  const pageWorker = async () => {
    while (pq.length) {
      const { f, i } = pq.shift()
      try {
        let text = await f.text()
        if (audio.length) {
          text = text.replace(/(src=["'])([^"':]+\.(?:mp3|m4a|wav|ogg|aac))(["'])/gi, (m, a, src, b) => {
            const clean = decodeURIComponent(src)
            const url = audioUrl[resolveRel(relPath(f), clean)] || audioUrl[clean.split('/').pop().toLowerCase()]
            return url ? `${a}${url}${b}` : m
          })
        }
        const kind = detectFromHtml(text, { ...detectFromPath(relPath(f)), skill: skill === 'workshop' ? 'reading' : skill })
        const up = await putFile(f, userId, new Blob([text], { type: 'text/html' }))
        const pageSkill = skill === 'writing' || skill === 'workshop' ? skill : kind.skill === 'writing' ? 'writing' : skill
        rows.push({
          title: htmlTitle(text, titleFromFileName(f.name)),
          file_name: f.name,
          storage_path: up.path,
          url: up.url,
          mime_type: 'text/html',
          size_bytes: f.size,
          source: 'upload',
          collection,
          position: startAt + i + 1,
          skill: pageSkill,
          question_type: skill === 'workshop' ? null : kind.qtype,
          on_shelf: onShelf && (pageSkill === 'reading' || pageSkill === 'listening'),
        })
      } catch (e) {
        failed.push(`${f.name}: ${e.message}`)
      }
      done += 1
      tick()
    }
  }
  await Promise.all([pageWorker(), pageWorker(), pageWorker()])

  rows.sort((a, b) => a.position - b.position)
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from('materials').insert(rows.slice(i, i + 50))
    if (error) {
      failed.push(error.message)
      break
    }
  }
  return { added: rows.length, failed }
}

// Strip "IELTS with Mr Ikromov · " etc. for short labels.
export function shortTitle(t = '') {
  return String(t).replace(/^(mr\.?\s*ikromov'?s ielts|ielts with mr\.? ikromov)\s*[·—–-]\s*/i, '').trim()
}
