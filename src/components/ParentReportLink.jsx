import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/*
 * Parent progress report link — teacher side (2026-10-02).
 * Lives in the student's details (Students tab). One secret link per
 * student; the teacher can copy it, turn it off, or make a new one
 * (the old link stops working).
 */
export default function ParentReportLink({ studentId }) {
  const [link, setLink] = useState(undefined) // undefined = loading, null = none
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLink(undefined)
    supabase
      .from('parent_report_links')
      .select('token, enabled, last_viewed_at')
      .eq('student_id', studentId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        if (loadError) setError(loadError.message)
        setLink(data || null)
      })
    return () => {
      cancelled = true
    }
  }, [studentId])

  const url = link?.token ? `${window.location.origin}/report/${link.token}` : ''

  const save = async (values) => {
    setBusy(true)
    setError('')
    const { data: auth } = await supabase.auth.getUser()
    const { data, error: saveError } = await supabase
      .from('parent_report_links')
      .upsert({ student_id: studentId, created_by: auth?.user?.id ?? null, ...values }, { onConflict: 'student_id' })
      .select('token, enabled, last_viewed_at')
      .single()
    setBusy(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setLink(data)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  if (link === undefined) return null

  return (
    <div>
      <span className="text-mist">Parent progress report</span>
      <div className="mt-2 rounded-xl border border-line bg-panel-2 p-3">
        {!link || !link.enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-mist">
              {link ? 'The link is turned off.' : 'A private page for parents: homework, vocabulary, mock results. No login needed.'}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => save({ enabled: true })}
              className="focus-ring rounded-lg border border-brass/50 px-3 py-1.5 text-xs font-semibold text-brass hover:bg-brass/10 disabled:opacity-50"
            >
              {link ? 'Turn on' : 'Create link'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input readOnly value={url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-paper-dim" />
              <button
                type="button"
                onClick={copy}
                className="focus-ring shrink-0 rounded-lg bg-brass px-3 py-1.5 text-xs font-semibold text-onbrass"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mist">
              <span>
                {link.last_viewed_at
                  ? `Last opened ${new Date(link.last_viewed_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
                  : 'Not opened yet'}
              </span>
              <span className="flex gap-3">
                <a href={url} target="_blank" rel="noreferrer" className="underline hover:text-paper">Preview</a>
                <button type="button" disabled={busy} onClick={() => save({ token: crypto.randomUUID(), enabled: true, last_viewed_at: null })} className="underline hover:text-paper">
                  New link
                </button>
                <button type="button" disabled={busy} onClick={() => save({ enabled: false })} className="text-coral underline">
                  Turn off
                </button>
              </span>
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-coral">{error}</p>}
      </div>
    </div>
  )
}
