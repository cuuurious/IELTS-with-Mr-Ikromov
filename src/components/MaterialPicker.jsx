import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import {
  KIND_LABEL,
  descendantIds,
  fileKind,
  folderPath,
  formatBytes,
  uploadMaterial,
} from '../lib/materials'

/*
 * "Add from Library" window used by Post homework / Edit homework
 * (2026-09-30). Tick any number of files from the Materials Library —
 * browse by folder or search everything — and they're attached to the
 * homework. New files can be uploaded right here too (they're saved to
 * the library at the same time, so they're there next time).
 *
 * Props: open, onClose, onPick(materials[]), alreadyPickedIds (Set|array)
 */
export default function MaterialPicker({ open, onClose, onPick, alreadyPickedIds = [] }) {
  const { profile } = useAuth()
  const [folders, setFolders] = useState([])
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [folder, setFolder] = useState('__all__')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const already = useMemo(() => new Set(alreadyPickedIds), [alreadyPickedIds])

  useEffect(() => {
    if (!open) return
    setPicked(new Set())
    setSearch('')
    setError('')
    setLoading(true)
    Promise.all([
      supabase.from('material_folders').select('*').order('name'),
      supabase.from('materials').select('*').order('created_at', { ascending: false }),
    ]).then(([f, m]) => {
      setFolders(f.data || [])
      setMaterials(m.data || [])
      if (f.error || m.error) setError((f.error || m.error).message)
      setLoading(false)
    })
  }, [open])

  const foldersById = useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f])), [folders])

  const tree = useMemo(() => {
    const byParent = {}
    folders.forEach((f) => {
      ;(byParent[f.parent_id || 'root'] = byParent[f.parent_id || 'root'] || []).push(f)
    })
    const out = []
    const walk = (p, d) => (byParent[p] || []).forEach((f) => { out.push({ ...f, depth: d }); walk(f.id, d + 1) })
    walk('root', 0)
    return out
  }, [folders])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q) {
      const words = q.split(/\s+/)
      return materials.filter((m) => {
        const hay = `${m.title} ${m.file_name} ${m.caption || ''} ${m.folder_id ? folderPath(m.folder_id, foldersById) : ''}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    }
    if (folder === '__all__') return materials
    if (folder === '__inbox__') return materials.filter((m) => !m.folder_id)
    const ids = descendantIds(folder, folders)
    return materials.filter((m) => m.folder_id && ids.has(m.folder_id))
  }, [materials, search, folder, folders, foldersById])

  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const uploadHere = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setError('')
    setUploading((n) => n + files.length)
    const targetFolder = folder === '__all__' || folder === '__inbox__' ? null : folder
    for (const file of files) {
      try {
        const row = await uploadMaterial(file, { folderId: targetFolder, userId: profile?.id })
        setMaterials((prev) => [row, ...prev])
        setPicked((prev) => new Set(prev).add(row.id))
      } catch (err) {
        setError(`${file.name}: ${err?.message || 'upload failed'}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  if (!open) return null

  const confirm = () => {
    const rows = materials.filter((m) => picked.has(m.id))
    onPick(rows)
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="font-display text-lg text-paper">Add from Materials Library</p>
            <p className="text-xs text-mist">Tick as many files as you need.</p>
          </div>
          <button type="button" onClick={onClose} className="focus-ring rounded-full px-2 py-1 text-mist hover:text-paper" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all files…"
            className="focus-ring min-w-[12rem] flex-1 rounded-full border border-line bg-panel-2 px-4 py-2 text-sm text-paper placeholder:text-mist"
          />
          <select
            value={folder}
            onChange={(e) => {
              setSearch('')
              setFolder(e.target.value)
            }}
            className="focus-ring rounded-full border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
          >
            <option value="__all__">All files</option>
            <option value="__inbox__">Not in a folder</option>
            {tree.map((f) => (
              <option key={f.id} value={f.id}>
                {'  '.repeat(f.depth)}
                {f.name}
              </option>
            ))}
          </select>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { uploadHere(e.target.files); e.target.value = '' }} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="focus-ring rounded-full border border-line px-3 py-2 text-sm text-mist hover:border-brass hover:text-brass"
          >
            {uploading ? `Uploading ${uploading}…` : 'Upload new'}
          </button>
        </div>

        {error && <p className="px-5 pt-3 text-sm text-coral">{error}</p>}

        <div className="min-h-[14rem] flex-1 overflow-y-auto px-5 py-2">
          {loading ? (
            <p className="py-10 text-center text-sm text-mist">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-mist">
              {search.trim() ? 'Nothing matches that search.' : 'No files here yet — upload some, or forward them to the Telegram bot.'}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {visible.map((m) => {
                const kind = fileKind(m.mime_type || m.file_name)
                const isAlready = already.has(m.id)
                return (
                  <li key={m.id}>
                    <label className={`flex cursor-pointer items-center gap-3 py-2.5 ${isAlready ? 'opacity-50' : ''}`}>
                      <input
                        type="checkbox"
                        disabled={isAlready}
                        checked={isAlready || picked.has(m.id)}
                        onChange={() => toggle(m.id)}
                        className="h-4 w-4 shrink-0 accent-brass"
                      />
                      {kind === 'image' ? (
                        <img src={m.url} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brass/15 text-[9px] font-bold text-brass">
                          {KIND_LABEL[kind]}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-paper">{m.title}</span>
                        <span className="block truncate text-[11px] text-mist">
                          {[formatBytes(m.size_bytes), m.folder_id ? `📁 ${folderPath(m.folder_id, foldersById)}` : null, isAlready ? 'already attached' : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} className="focus-ring rounded-full border border-line px-4 py-2 text-sm text-mist hover:text-paper">
            Cancel
          </button>
          <button
            type="button"
            disabled={!picked.size || uploading > 0}
            onClick={confirm}
            className="focus-ring rounded-full bg-brass hover:bg-brass-dim px-5 py-2 text-sm font-medium text-onbrass disabled:opacity-40"
          >
            Add {picked.size || ''} file{picked.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Save picked library files onto a homework (after it's been created).
export async function attachMaterialsToHomework(homeworkId, rows, startOrder = 0) {
  if (!rows?.length) return
  const payload = rows.map((m, i) => ({
    homework_id: homeworkId,
    material_id: m.id || m.material_id || null,
    url: m.url,
    name: m.file_name || m.name || m.title,
    mime_type: m.mime_type || null,
    size_bytes: m.size_bytes || null,
    sort_order: startOrder + i,
  }))
  const { error } = await supabase.from('homework_attachments').insert(payload)
  if (error) throw error
}

// Small chip list used in the forms.
export function PickedMaterialsList({ items, onRemove }) {
  if (!items.length) return null
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((m) => {
        const kind = fileKind(m.mime_type || m.file_name || m.name)
        return (
          <li key={m.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brass/15 text-[8px] font-bold text-brass">
              {KIND_LABEL[kind]}
            </span>
            <a href={m.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm text-paper hover:text-brass">
              {m.title || m.name}
            </a>
            <span className="shrink-0 text-[11px] text-mist">{formatBytes(m.size_bytes)}</span>
            <button type="button" onClick={() => onRemove(m)} className="focus-ring shrink-0 rounded px-1.5 text-xs text-mist hover:text-coral" aria-label="Remove">
              ✕
            </button>
          </li>
        )
      })}
    </ul>
  )
}
