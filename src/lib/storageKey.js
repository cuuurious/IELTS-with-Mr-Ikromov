/*
 * Safe Supabase Storage object names (2026-10-06).
 *
 * Storage rejects keys with characters outside a small ASCII set, so a
 * file called "Тест 1.pdf" or "Ўқиш (2).docx" failed to upload when its
 * raw name was used in the path. Use safeFileName(file.name) for the
 * last path segment and keep the original name in the database row for
 * display.
 *
 *   `${folder}/${safeFileName(file.name)}`  →  "folder/1696582000000-a1b2c3-test-1.pdf"
 */

const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
}

export function safeFileName(originalName = 'file') {
  const name = String(originalName || 'file')
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot + 1) : ''
  const slug = base
    .toLowerCase()
    .split('')
    .map((ch) => (CYR[ch] !== undefined ? CYR[ch] : ch))
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${Date.now()}-${rand}-${slug || 'file'}${cleanExt ? `.${cleanExt}` : ''}`
}
