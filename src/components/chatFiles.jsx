/*
 * Shared document handling for every chat (private and group) —
 * 2026-09-30, so a PDF / Word / Excel / PowerPoint / text file can be
 * sent and looks the same everywhere.
 */

export const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt'

const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt']

export function isDocumentFile(file) {
  const ext = String(file?.name || '').split('.').pop().toLowerCase()
  return DOCUMENT_EXTENSIONS.includes(ext)
}

function extensionOf(name, url) {
  const source = name || String(url || '').split('?')[0].split('/').pop() || ''
  const ext = source.includes('.') ? source.split('.').pop().toUpperCase() : 'FILE'
  return ext.slice(0, 4)
}

export function FileBubble({ url, name, mine = false }) {
  const label = name || 'Open file'
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`focus-ring flex min-w-[12rem] max-w-full items-center gap-3 rounded-xl px-2.5 py-2 transition ${
        mine ? 'bg-black/10 hover:bg-black/15' : 'border border-line bg-panel hover:border-brass/40'
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold tracking-wide ${
          mine ? 'bg-onbrass/20 text-onbrass' : 'bg-brass/15 text-brass'
        }`}
      >
        {extensionOf(name, url)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block text-[11px] opacity-70">Tap to open</span>
      </span>
    </a>
  )
}
