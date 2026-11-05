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
  { value: 'speaking', label: 'Speaking' },
]
// "Workshops" was its own shelf until 2026-11-05; every Reading page has
// its Workshop built in, so it was always empty and is gone.

export const BANK_FIELDS = 'id, title, url, file_name, skill, question_type, collection, position, on_shelf, created_at'
const BANK_FIELDS_TOPIC = `${BANK_FIELDS}, topic`

// Reading passages by topic (migration_97 tags them by passage name).
export const TOPICS = [
  'Science & space',
  'Nature & animals',
  'Food & farming',
  'History & archaeology',
  'People & biographies',
  'Psychology & mind',
  'Health & sleep',
  'Technology & buildings',
  'Environment',
  'Business & work',
  'Education & language',
  'Arts & culture',
  'Society & sport',
]

export async function loadBank() {
  // With topics when migration_97 has been run, without them before.
  const first = await supabase.from('materials').select(BANK_FIELDS_TOPIC).not('collection', 'is', null).order('collection').order('position', { ascending: true })
  if (!first.error) return { pages: first.data || [], missing: false, error: null }
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

// Average first-try score per page (migration_96): { url: { tries, avg } }.
// Quiet (empty) until the migration is run.
export async function loadPageStats() {
  const { data, error } = await supabase.rpc('page_stats')
  if (error) return {}
  return Object.fromEntries((data || []).map((r) => [r.url, { tries: r.tries, avg: r.avg_pct, favs: r.favs || 0 }]))
}

// Saved sets of pages (migration_97). Quiet (null) before it is run.
export async function loadSets() {
  const { data, error } = await supabase.from('bank_sets').select('id, name, material_ids, created_at').order('created_at', { ascending: false })
  return error ? null : data || []
}
export async function saveSet(name, ids) {
  const { error } = await supabase.from('bank_sets').insert({ name, material_ids: ids })
  if (error) throw error
}
export async function deleteSet(id) {
  const { error } = await supabase.from('bank_sets').delete().eq('id', id)
  if (error) throw error
}

// Every student's first try on one page, with the questions they missed.
export async function loadPageReport(url) {
  const { data, error } = await supabase.rpc('page_report', { p_url: url })
  if (error) throw error
  return data || []
}

// Post pages as one in-site homework to one group (weekly drafts and
// saved sets). Same rows as "Give as homework".
export async function postPagesHomework({ groupId, pages, title, dueIso, teacherId, telegram = true, telegramLinked = false, note = '' }) {
  const { data: hw, error } = await supabase
    .from('homeworks')
    .insert({
      group_id: groupId,
      title: title || 'Practice',
      description: note,
      due_date: dueIso,
      enable_speaking: false,
      ai_eval_enabled: false,
      allowed_submission_types: ['image'],
      min_submission_files: 0,
      max_submission_files: 10,
      created_by: teacherId,
      homework_type: 'standard',
    })
    .select()
    .single()
  if (error) throw error
  const { saveHomeworkTasks } = await import('./homeworkTasks')
  await saveHomeworkTasks(
    hw.id,
    pages.map((p) => ({ kind: 'html', html_url: p.url, title: shortTitle(p.title) }))
  )
  const { notifyGroup } = await import('./notify')
  notifyGroup({ groupId, type: 'homework_new', title: 'New homework posted', body: hw.title, link: `homework:${hw.id}` })
  if (telegram && telegramLinked) {
    const { postHomeworkToTelegram } = await import('./telegramGroupPost')
    postHomeworkToTelegram(hw.id, 'post')
  }
  return hw
}

// Easy / medium / hard from the average first try (needs 3+ tries).
export function difficultyOf(stat) {
  if (!stat || stat.tries < 3) return null
  if (stat.avg >= 75) return { label: 'Easy', cls: 'bg-reading-tint text-reading' }
  if (stat.avg >= 55) return { label: 'Medium', cls: 'bg-[color-mix(in_srgb,var(--color-saffron)_20%,var(--color-panel))] text-amber' }
  return { label: 'Hard', cls: 'bg-urgent-tint text-coral' }
}

// First lines of a page's passage, for the quick peek (cached).
const peekCache = {}
export function peekPage(url) {
  if (!url) return Promise.resolve(null)
  // Speaking tests live in the database (migration_101), not in a file.
  if (/^speaking:/.test(url)) {
    if (!peekCache[url]) {
      peekCache[url] = import('./speaking').then(async ({ parseSpeakingUrl, loadSpeakingSet }) => {
        const ref = parseSpeakingUrl(url)
        const set = await loadSpeakingSet(ref.setId)
        const c = set.content || {}
        const p1 = (c.part1 || []).map((t) => `${t.topic}: ${(t.questions || []).map((q) => q.q).join(' ')}`).join('  ')
        const p2 = c.part2?.cue ? `${c.part2.cue}. You should say: ${(c.part2.bullets || []).join('; ')}${c.part2.explain ? `; ${c.part2.explain}` : ''}` : ''
        const p3 = (c.part3?.questions || []).map((q) => q.q).join(' ')
        const text = { part1: p1, part2: p2, part3: p3 }[ref.part] || [p1, p2].filter(Boolean).join('  ·  ')
        return { title: `Set ${set.number} · ${set.topics || ''}`, sub: { full: 'Full test · Parts 1, 2 and 3', part1: 'Part 1', part2: 'Part 2 · cue card', part3: `Part 3 · ${c.part3?.theme || ''}` }[ref.part], text: text.slice(0, 260) }
      }).catch(() => null)
    }
    return peekCache[url]
  }
  if (!peekCache[url]) {
    peekCache[url] = fetch(url)
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => {
        // Writing pages keep their question as data: show that.
        const st = /"promptStatement":\s*(\[[^\]]*\])/.exec(html)
        const ins = /"promptInstruction":\s*(\[[^\]]*\])/.exec(html)
        if (st) {
          try {
            return { title: 'Essay question', sub: '', text: [...JSON.parse(st[1]), ...(ins ? JSON.parse(ins[1]) : [])].join(' ') }
          } catch {
            /* fall through */
          }
        }
        // Writing Task 1 pages: the graphic's name, its type and the picture.
        const cfg = /const CFG = \{"no": \d+, "minutes": \d+, "minWords": \d+, "title": ("(?:[^"\\]|\\.)*")/.exec(html)
        if (cfg) {
          let name = ''
          try {
            name = JSON.parse(cfg[1])
          } catch {
            /* keep empty */
          }
          const kind = /<strong>Task \d+<\/strong> &middot; ([^<]+)<\/p>/.exec(html)
          const img = /<div class="chart-container">\s*<img src="(data:image\/[^"]+)"/.exec(html)
          return { title: name, sub: kind ? kind[1].trim() : '', text: 'Write at least 150 words in 20 minutes. The page checks the report against a sample answer.', img: img ? img[1] : '' }
        }
        const doc = new DOMParser().parseFromString(html, 'text/html')
        const title = doc.querySelector('.passage-title')?.textContent?.trim() || ''
        const sub = doc.querySelector('.passage-subtitle')?.textContent?.trim() || ''
        const box = doc.querySelector('.passage-container') || doc.querySelector('.questions-container') || doc.body
        const paras = [...(box?.querySelectorAll('p') || [])].map((p) => p.textContent.trim()).filter((t) => t.length > 60)
        const text = (paras[0] || box?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 260)
        return { title, sub, text }
      })
      .catch(() => null)
  }
  return peekCache[url]
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
