import { KIND_LABEL, fileKind, formatBytes } from '../lib/materials'
import FileActions from './FileActions'

/*
 * The files a teacher attached to a homework from the Materials Library
 * (homework_attachments, migration_66) — shown to students on the
 * homework card. Audio plays right here (listening practice without
 * downloading anything), images show as pictures, everything else is a
 * tap-to-open file row.
 */
export default function HomeworkFiles({ files }) {
  const list = [...(files || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  if (!list.length) return null

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-mist">
        Materials ({list.length})
      </p>
      <ul className="flex flex-col gap-2">
        {list.map((f) => {
          const kind = fileKind(f.mime_type || f.name)
          if (kind === 'image') {
            return (
              <li key={f.id}>
                <a href={f.url} target="_blank" rel="noreferrer" className="block w-fit">
                  <img src={f.url} alt={f.name} loading="lazy" className="max-h-64 rounded-md border border-line object-contain" />
                </a>
                <FileActions url={f.url} name={f.name} isImage className="mt-2" />
              </li>
            )
          }
          return (
            <li key={f.id} className="flex flex-col gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2.5">
              <a href={f.url} target="_blank" rel="noreferrer" data-file-name={f.name} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brass/15 text-[9px] font-bold tracking-wide text-brass">
                  {KIND_LABEL[kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-paper">{f.name}</span>
                  <span className="block text-[11px] text-mist">
                    {[formatBytes(f.size_bytes), kind === 'audio' || kind === 'video' ? 'Play below or tap to open' : kind === 'html' ? 'Tap to open the page' : 'Tap to open'].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </a>
              {kind === 'audio' && <audio controls preload="none" src={f.url} className="w-full" />}
              <FileActions url={f.url} name={f.name} />
              {kind === 'video' && <video controls preload="metadata" src={f.url} className="max-h-72 w-full rounded-lg" />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
