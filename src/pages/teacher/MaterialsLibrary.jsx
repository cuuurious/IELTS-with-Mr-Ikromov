import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import ConfirmModal from '../../components/ConfirmModal'
import { useSessionState } from '../../lib/sessionState'
import {
  KIND_LABEL,
  MATERIALS_BUCKET,
  descendantIds,
  fileKind,
  folderPath,
  formatBytes,
  uploadMaterial,
} from '../../lib/materials'

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME

/*
 * MATERIALS LIBRARY (2026-09-30)
 *
 * Jasur: "most of my files that i have to attach when i post homework
 * are in telegram … i want to fully switch to the website … i want my
 * telegram account to be used for my private life".
 *
 * One place for every teaching file:
 *   - drag files (or a whole Telegram Desktop export) onto this page,
 *   - or forward them from any Telegram chat/channel to the bot — they
 *     appear here by themselves (see telegram-webhook),
 *   - organise into folders, find anything with the search bar,
 *   - then tick them in "Post new homework" (MaterialPicker.jsx).
 */

const ALL = '__all__'
const INBOX = '__inbox__'

export default function MaterialsLibrary() {
  const { profile } = useAuth()
  const [folders, setFolders] = useState([])
  const [materials, setMaterials] = useState([])
  const [usage, setUsage] = useState({}) // material_id -> homework count
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [currentFolder, setCurrentFolder] = useSessionState(`ielts:${profile?.id}:materials:folder`, ALL)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [uploads, setUploads] = useState([]) // {id, name, status: 'uploading'|'done'|'error', error}
  const [dragOver, setDragOver] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renaming, setRenaming] = useState(null) // { type: 'file'|'folder', id, value }
  const [moveOpen, setMoveOpen] = useState(false)
  const [botState, setBotState] = useState({ linked: false, folderId: null, loading: true })

  const fileInputRef = useRef(null)
  const dragDepth = useRef(0)

  const foldersById = useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f])), [folders])

  const load = useCallback(async () => {
    setError('')
    const [f, m, u] = await Promise.all([
      supabase.from('material_folders').select('*').order('name'),
      supabase.from('materials').select('*').order('created_at', { ascending: false }),
      supabase.from('homework_attachments').select('material_id').not('material_id', 'is', null),
    ])
    if (f.error || m.error) setError((f.error || m.error).message)
    setFolders(f.data || [])
    setMaterials(m.data || [])
    const counts = {}
    ;(u.data || []).forEach((row) => {
      counts[row.material_id] = (counts[row.material_id] || 0) + 1
    })
    setUsage(counts)
    setLoading(false)
  }, [])

  const loadBotState = useCallback(async () => {
    if (!profile?.id) return
    const [link, inbox] = await Promise.all([
      supabase.from('telegram_links').select('user_id').eq('user_id', profile.id).maybeSingle(),
      supabase.from('material_inbox_state').select('folder_id').eq('user_id', profile.id).maybeSingle(),
    ])
    setBotState({ linked: Boolean(link.data), folderId: inbox.data?.folder_id || null, loading: false })
  }, [profile?.id])

  useEffect(() => {
    load()
    loadBotState()
  }, [load, loadBotState])

  // New files forwarded to the bot show up without a refresh.
  useEffect(() => {
    const channel = supabase
      .channel(`materials-${profile?.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'materials' }, (payload) => {
        setMaterials((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [payload.new, ...prev]))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile?.id])

  // A remembered folder that was deleted since falls back to "All files".
  useEffect(() => {
    if (!loading && currentFolder !== ALL && currentFolder !== INBOX && !foldersById[currentFolder]) {
      setCurrentFolder(ALL)
    }
  }, [loading, currentFolder, foldersById, setCurrentFolder])

  const folderIdForUploads = currentFolder === ALL || currentFolder === INBOX ? null : currentFolder

  // ------------------------------------------------------------------
  // Which files are on screen: search looks through EVERYTHING (title,
  // original file name, Telegram caption, folder name); otherwise just
  // the chosen folder (and its sub-folders).
  // ------------------------------------------------------------------
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q) {
      const words = q.split(/\s+/)
      return materials.filter((m) => {
        const hay = `${m.title} ${m.file_name} ${m.caption || ''} ${m.folder_id ? folderPath(m.folder_id, foldersById) : ''}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    }
    if (currentFolder === ALL) return materials
    if (currentFolder === INBOX) return materials.filter((m) => !m.folder_id)
    const ids = descendantIds(currentFolder, folders)
    return materials.filter((m) => m.folder_id && ids.has(m.folder_id))
  }, [materials, search, currentFolder, folders, foldersById])

  const countFor = (folderId) => {
    const ids = descendantIds(folderId, folders)
    return materials.filter((m) => m.folder_id && ids.has(m.folder_id)).length
  }

  // ---------------- uploads ----------------
  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f && f.size > 0)
    if (!files.length) return
    const batch = files.map((file) => ({ id: `${Date.now()}-${Math.random()}`, file, name: file.name, status: 'uploading' }))
    setUploads((prev) => [...batch.map(({ file: _f, ...rest }) => rest), ...prev].slice(0, 50))

    // Three at a time — fast, without flooding a slow connection.
    const queue = [...batch]
    const worker = async () => {
      while (queue.length) {
        const item = queue.shift()
        try {
          const row = await uploadMaterial(item.file, { folderId: folderIdForUploads, userId: profile?.id })
          setMaterials((prev) => (prev.some((m) => m.id === row.id) ? prev : [row, ...prev]))
          setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, status: 'done' } : u)))
        } catch (err) {
          const message = /exceeded|too large|payload/i.test(err?.message || '')
            ? 'Too big for the current storage limit'
            : err?.message || 'Upload failed'
          setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, status: 'error', error: message } : u)))
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
  }

  const onDragEnter = (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setDragOver(true)
  }
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }
  const onDrop = (e) => {
    if (!e.dataTransfer?.files?.length) return
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    uploadFiles(e.dataTransfer.files)
  }

  // ---------------- folders ----------------
  const createFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    const { data, error: err } = await supabase
      .from('material_folders')
      .insert({ name, parent_id: folderIdForUploads })
      .select()
      .single()
    if (err) {
      setError(/duplicate|unique/i.test(err.message) ? 'A folder with that name already exists here.' : err.message)
      return
    }
    setFolders((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewFolderName('')
    setNewFolderOpen(false)
    setCurrentFolder(data.id)
  }

  const saveRename = async () => {
    if (!renaming) return
    const value = renaming.value.trim()
    if (!value) return setRenaming(null)
    const table = renaming.type === 'folder' ? 'material_folders' : 'materials'
    const patch = renaming.type === 'folder' ? { name: value } : { title: value }
    const { error: err } = await supabase.from(table).update(patch).eq('id', renaming.id)
    if (err) {
      setError(err.message)
      return
    }
    if (renaming.type === 'folder') {
      setFolders((prev) => prev.map((f) => (f.id === renaming.id ? { ...f, name: value } : f)))
    } else {
      setMaterials((prev) => prev.map((m) => (m.id === renaming.id ? { ...m, title: value } : m)))
    }
    setRenaming(null)
  }

  const deleteFolder = (folder) => {
    const inside = countFor(folder.id)
    setConfirmDialog({
      title: `Delete folder "${folder.name}"?`,
      message: inside
        ? `Its ${inside} file${inside === 1 ? '' : 's'} (and sub-folders' files) will move to "Not in a folder" — no file is deleted.`
        : 'The folder is empty.',
      confirmLabel: 'Delete folder',
      tone: 'coral',
      onConfirm: async () => {
        // Move files out first (sub-folders are removed with the folder).
        const ids = [...descendantIds(folder.id, folders)]
        await supabase.from('materials').update({ folder_id: null }).in('folder_id', ids)
        const { error: err } = await supabase.from('material_folders').delete().eq('id', folder.id)
        if (err) setError(err.message)
        if (ids.includes(currentFolder)) setCurrentFolder(ALL)
        load()
      },
    })
  }

  // ---------------- files ----------------
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const moveSelected = async (folderId) => {
    const ids = [...selected]
    if (!ids.length) return
    const { error: err } = await supabase.from('materials').update({ folder_id: folderId }).in('id', ids)
    if (err) return setError(err.message)
    setMaterials((prev) => prev.map((m) => (selected.has(m.id) ? { ...m, folder_id: folderId } : m)))
    setSelected(new Set())
    setMoveOpen(false)
  }

  const deleteMaterials = (ids) => {
    const rows = materials.filter((m) => ids.includes(m.id))
    const inUse = rows.filter((m) => usage[m.id])
    setConfirmDialog({
      title: rows.length === 1 ? `Delete "${rows[0].title}"?` : `Delete ${rows.length} files?`,
      message: inUse.length
        ? `${inUse.length} of these ${inUse.length === 1 ? 'is' : 'are'} attached to homework — students will still be able to open ${inUse.length === 1 ? 'it' : 'them'} there, but ${inUse.length === 1 ? 'it' : 'they'} will leave the library.`
        : 'This removes the file for good.',
      confirmLabel: 'Delete',
      tone: 'coral',
      onConfirm: async () => {
        // Files still attached to homework keep their stored copy so the
        // homework link never breaks; everything else is removed.
        const removable = rows.filter((m) => !usage[m.id]).map((m) => m.storage_path)
        const { error: err } = await supabase.from('materials').delete().in('id', ids)
        if (err) return setError(err.message)
        if (removable.length) await supabase.storage.from(MATERIALS_BUCKET).remove(removable)
        setMaterials((prev) => prev.filter((m) => !ids.includes(m.id)))
        setSelected(new Set())
      },
    })
  }

  // ---------------- Telegram bot ----------------
  const connectBot = async () => {
    if (!TELEGRAM_BOT_USERNAME) {
      setError('The Telegram bot name (VITE_TELEGRAM_BOT_USERNAME) is not set for this website.')
      return
    }
    const tab = window.open('', '_blank')
    try {
      const token = crypto.randomUUID()
      const { error: err } = await supabase.from('telegram_link_tokens').insert({ token, user_id: profile.id })
      if (err) throw err
      const url = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`
      if (tab) tab.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
      const deadline = Date.now() + 90000
      const poll = async () => {
        if (Date.now() > deadline) return
        const { data } = await supabase.from('telegram_links').select('user_id').eq('user_id', profile.id).maybeSingle()
        if (data) return loadBotState()
        setTimeout(poll, 3000)
      }
      setTimeout(poll, 3000)
    } catch (err) {
      tab?.close()
      setError(err?.message || 'Could not start connecting Telegram.')
    }
  }

  const setBotFolder = async (folderId) => {
    const { error: err } = await supabase
      .from('material_inbox_state')
      .upsert({ user_id: profile.id, folder_id: folderId || null, updated_at: new Date().toISOString() })
    if (err) return setError(err.message)
    setBotState((s) => ({ ...s, folderId: folderId || null }))
  }

  // ---------------- render helpers ----------------
  const tree = useMemo(() => {
    const byParent = {}
    folders.forEach((f) => {
      const key = f.parent_id || 'root'
      ;(byParent[key] = byParent[key] || []).push(f)
    })
    const out = []
    const walk = (parent, depth) => {
      ;(byParent[parent] || []).forEach((f) => {
        out.push({ ...f, depth })
        walk(f.id, depth + 1)
      })
    }
    walk('root', 0)
    return out
  }, [folders])

  const folderLabel =
    currentFolder === ALL ? 'All files' : currentFolder === INBOX ? 'Not in a folder' : folderPath(currentFolder, foldersById)

  const inboxCount = materials.filter((m) => !m.folder_id).length

  return (
    <div
      className="relative flex flex-col gap-5"
      onDragEnter={onDragEnter}
      onDragOver={(e) => dragOver && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <ConfirmModal
        open={Boolean(confirmDialog)}
        {...confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const run = confirmDialog?.onConfirm
          setConfirmDialog(null)
          run?.()
        }}
      />

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/70 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-brass bg-panel px-10 py-8 text-center shadow-xl">
            <p className="font-display text-xl text-paper">Drop files to add them</p>
            <p className="mt-1 text-sm text-mist">They'll go into: {folderLabel === 'All files' ? 'Not in a folder' : folderLabel}</p>
          </div>
        </div>
      )}

      {/* TELEGRAM → LIBRARY */}
      <div className="ticket flex flex-col gap-3 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-display text-lg text-paper">Save files straight from Telegram</p>
          <p className="mt-1 max-w-2xl text-sm text-mist">
            In any chat or channel, select the files → <span className="text-paper">Forward</span> → send them to the bot.
            They appear here on their own. Write <span className="font-mono text-paper">#FolderName</span> in the caption to
            file them into a folder, or send <span className="font-mono text-paper">/folder</span> to the bot to choose one.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {botState.loading ? null : botState.linked ? (
            <>
              <span className="inline-flex items-center gap-2 rounded-full border border-sage/40 bg-sage/10 px-3 py-1 text-xs text-sage">
                ● Bot connected
              </span>
              <label className="flex items-center gap-2 text-xs text-mist">
                Bot saves into
                <select
                  value={botState.folderId || ''}
                  onChange={(e) => setBotFolder(e.target.value || null)}
                  className="focus-ring rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs text-paper"
                >
                  <option value="">Not in a folder</option>
                  {tree.map((f) => (
                    <option key={f.id} value={f.id}>
                      {'  '.repeat(f.depth)}
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              {TELEGRAM_BOT_USERNAME && (
                <a
                  href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-right text-xs text-brass hover:underline"
                >
                  Open @{TELEGRAM_BOT_USERNAME}
                </a>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={connectBot}
              className="focus-ring rounded-full bg-gradient-to-br from-brass to-brass-dim px-4 py-2 text-sm font-medium text-onbrass shadow-[0_6px_16px_-8px_rgba(0,0,0,0.5)]"
            >
              Connect the bot
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-coral/40 bg-coral/10 px-4 py-2.5 text-sm text-coral">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="shrink-0 text-coral/80 hover:text-coral">
            ✕
          </button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
        {/* FOLDERS */}
        <aside className="ticket h-max rounded-2xl p-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-mist">Folders</span>
            <button
              type="button"
              onClick={() => setNewFolderOpen((v) => !v)}
              className="focus-ring rounded-full px-2 py-0.5 text-xs text-brass hover:bg-brass/10"
              title={currentFolder !== ALL && currentFolder !== INBOX ? `New folder inside "${folderLabel}"` : 'New folder'}
            >
              + New
            </button>
          </div>

          {newFolderOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                createFolder()
              }}
              className="mb-2 flex gap-1.5 px-1"
            >
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={folderIdForUploads ? `Inside ${foldersById[folderIdForUploads]?.name}` : 'Folder name'}
                className="focus-ring min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-paper"
              />
              <button type="submit" className="focus-ring rounded-lg bg-brass px-2.5 text-xs font-medium text-onbrass">
                Add
              </button>
            </form>
          )}

          <FolderRow label="All files" count={materials.length} active={currentFolder === ALL && !search} onClick={() => { setSearch(''); setCurrentFolder(ALL) }} />
          <FolderRow label="Not in a folder" count={inboxCount} active={currentFolder === INBOX && !search} onClick={() => { setSearch(''); setCurrentFolder(INBOX) }} />
          <div className="my-1.5 border-t border-line" />
          {tree.length === 0 && <p className="px-2 py-2 text-xs text-mist">No folders yet — make one with “+ New”.</p>}
          {tree.map((f) =>
            renaming?.type === 'folder' && renaming.id === f.id ? (
              <form
                key={f.id}
                onSubmit={(e) => {
                  e.preventDefault()
                  saveRename()
                }}
                className="flex gap-1.5 py-0.5"
                style={{ paddingLeft: `${f.depth * 14 + 4}px` }}
              >
                <input
                  autoFocus
                  value={renaming.value}
                  onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                  onBlur={saveRename}
                  className="focus-ring min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-2 py-1 text-sm text-paper"
                />
              </form>
            ) : (
              <FolderRow
                key={f.id}
                label={f.name}
                depth={f.depth}
                count={countFor(f.id)}
                active={currentFolder === f.id && !search}
                onClick={() => {
                  setSearch('')
                  setCurrentFolder(f.id)
                }}
                onRename={() => setRenaming({ type: 'folder', id: f.id, value: f.name })}
                onDelete={() => deleteFolder(f)}
              />
            )
          )}
        </aside>

        {/* FILES */}
        <section className="ticket flex min-w-0 flex-col gap-4 rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search all files — name, caption, folder…"
                className="focus-ring w-full rounded-full border border-line bg-panel-2 py-2.5 pl-9 pr-4 text-sm text-paper placeholder:text-mist"
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                uploadFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="focus-ring rounded-full bg-gradient-to-br from-brass to-brass-dim px-4 py-2.5 text-sm font-medium text-onbrass shadow-[0_6px_16px_-8px_rgba(0,0,0,0.5)]"
            >
              Upload files
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-mist">
              {search.trim() ? (
                <>
                  <span className="text-paper">{visible.length}</span> result{visible.length === 1 ? '' : 's'} for “{search.trim()}”
                </>
              ) : (
                <>
                  <span className="font-display text-base text-paper">{folderLabel}</span> · {visible.length} file{visible.length === 1 ? '' : 's'}
                </>
              )}
            </p>
            {selected.size > 0 && (
              <div className="relative flex items-center gap-2">
                <span className="text-xs text-mist">{selected.size} selected</span>
                <button type="button" onClick={() => setMoveOpen((v) => !v)} className="focus-ring rounded-full border border-line px-3 py-1.5 text-xs text-paper hover:border-brass">
                  Move to…
                </button>
                <button type="button" onClick={() => deleteMaterials([...selected])} className="focus-ring rounded-full border border-coral/50 px-3 py-1.5 text-xs text-coral hover:bg-coral hover:text-paper">
                  Delete
                </button>
                <button type="button" onClick={() => setSelected(new Set())} className="focus-ring px-1 text-xs text-mist hover:text-paper">
                  Clear
                </button>
                {moveOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 max-h-72 w-60 overflow-y-auto rounded-xl border border-line bg-panel-2 py-1 shadow-xl">
                    <button type="button" onClick={() => moveSelected(null)} className="block w-full px-3 py-2 text-left text-sm text-paper hover:bg-panel">
                      Not in a folder
                    </button>
                    {tree.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => moveSelected(f.id)}
                        className="block w-full px-3 py-2 text-left text-sm text-paper hover:bg-panel"
                        style={{ paddingLeft: `${12 + f.depth * 14}px` }}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {uploads.length > 0 && (
            <div className="flex flex-col gap-1 rounded-xl border border-line bg-panel-2/60 p-3 text-xs">
              <div className="mb-1 flex items-center justify-between text-mist">
                <span>
                  Uploads — {uploads.filter((u) => u.status === 'done').length} of {uploads.length} done
                </span>
                {uploads.every((u) => u.status !== 'uploading') && (
                  <button type="button" onClick={() => setUploads([])} className="hover:text-paper">
                    Hide
                  </button>
                )}
              </div>
              {uploads.slice(0, 8).map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3">
                  <span className="truncate text-paper">{u.name}</span>
                  <span className={u.status === 'error' ? 'text-coral' : u.status === 'done' ? 'text-sage' : 'text-mist'}>
                    {u.status === 'uploading' ? 'Uploading…' : u.status === 'done' ? 'Saved' : u.error}
                  </span>
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <p className="py-10 text-center text-sm text-mist">Loading…</p>
          ) : visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
              <p className="font-display text-lg text-paper">{search.trim() ? 'Nothing found' : 'No files here yet'}</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-mist">
                {search.trim()
                  ? 'Try another word, or check the spelling.'
                  : 'Drag files onto this page, press “Upload files”, or forward them to the Telegram bot.'}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {visible.map((m) => {
                const kind = fileKind(m.mime_type || m.file_name)
                const isRenaming = renaming?.type === 'file' && renaming.id === m.id
                return (
                  <li key={m.id} className={`flex items-center gap-3 py-2.5 ${selected.has(m.id) ? 'bg-brass/5' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      className="h-4 w-4 shrink-0 accent-brass"
                      aria-label={`Select ${m.title}`}
                    />
                    <a href={m.url} target="_blank" rel="noreferrer" className="shrink-0" title="Open">
                      {kind === 'image' ? (
                        <img src={m.url} alt="" loading="lazy" className="h-10 w-10 rounded-lg border border-line object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brass/15 text-[9px] font-bold tracking-wide text-brass">
                          {KIND_LABEL[kind]}
                        </span>
                      )}
                    </a>
                    <div className="min-w-0 flex-1">
                      {isRenaming ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            saveRename()
                          }}
                        >
                          <input
                            autoFocus
                            value={renaming.value}
                            onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                            onBlur={saveRename}
                            className="focus-ring w-full rounded-lg border border-line bg-panel-2 px-2 py-1 text-sm text-paper"
                          />
                        </form>
                      ) : (
                        <a href={m.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-paper hover:text-brass">
                          {m.title}
                        </a>
                      )}
                      <p className="truncate text-[11px] text-mist">
                        {[
                          formatBytes(m.size_bytes),
                          new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
                          m.source === 'telegram' ? 'from Telegram' : null,
                          (search.trim() || currentFolder === ALL) && m.folder_id ? `📁 ${folderPath(m.folder_id, foldersById)}` : null,
                          usage[m.id] ? `used in ${usage[m.id]} homework` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        {m.caption ? ` · “${m.caption.slice(0, 80)}”` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setRenaming({ type: 'file', id: m.id, value: m.title })}
                        className="focus-ring rounded-full px-2 py-1 text-xs text-mist hover:text-brass"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMaterials([m.id])}
                        className="focus-ring rounded-full px-2 py-1 text-xs text-mist hover:text-coral"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function FolderRow({ label, count, active, onClick, depth = 0, onRename, onDelete }) {
  return (
    <div
      className={`group flex items-center gap-1 rounded-lg pr-1 transition ${active ? 'bg-brass/15' : 'hover:bg-panel-2'}`}
      style={{ paddingLeft: `${depth * 14}px` }}
    >
      <button type="button" onClick={onClick} className="focus-ring flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm">
        <span className={active ? 'text-brass' : 'text-mist'} aria-hidden>
          {onDelete ? '📁' : '🗂'}
        </span>
        <span className={`truncate ${active ? 'font-medium text-paper' : 'text-paper/90'}`}>{label}</span>
        <span className="ml-auto text-[11px] text-mist">{count}</span>
      </button>
      {onRename && (
        <button type="button" onClick={onRename} title="Rename" className="hidden rounded px-1 text-xs text-mist hover:text-brass group-hover:block">
          ✎
        </button>
      )}
      {onDelete && (
        <button type="button" onClick={onDelete} title="Delete folder" className="hidden rounded px-1 text-xs text-mist hover:text-coral group-hover:block">
          ✕
        </button>
      )}
    </div>
  )
}
