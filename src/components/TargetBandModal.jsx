import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { TARGET_BANDS, formatTargetBand } from '../lib/targetBands'
import TargetBandIcon from './TargetBandIcon'

/*
 * Small window just for the target band (2026-10-05). Clicking the
 * target used to open the whole Account settings window, which Jasur
 * didn't like — this one only does the one job: pick a band, saved
 * the moment it's picked (same profiles.target_band update Account
 * settings already uses).
 */
export default function TargetBandModal({ onClose }) {
  const { profile, refreshProfile } = useAuth()
  const [value, setValue] = useState(profile?.target_band != null ? Number(profile.target_band) : null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const choose = async (band) => {
    if (saving || band === value) return
    const previous = value
    setValue(band)
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ target_band: band })
        .eq('id', profile.id)
      if (updateError) throw updateError
      await refreshProfile()
      setMessage(`Saved. Your target is now ${formatTargetBand(band)}.`)
    } catch (err) {
      setValue(previous)
      setError(err?.message || 'Could not save your target band. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-paper/40 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-band-title"
        className="w-full max-w-md rounded-[22px] border border-line bg-panel p-6 text-paper sm:p-7"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="target-band-title" className="text-[22px] font-semibold tracking-[-0.02em]">
              Your target band
            </h2>
            <p className="mt-1 text-sm text-mist">
              The band you are aiming for. Your bands on Home are measured against it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-xl leading-none hover:bg-panel-2"
          >
            ×
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {TARGET_BANDS.map((band) => {
            const on = value === band.value
            return (
              <button
                key={band.value}
                type="button"
                onClick={() => choose(band.value)}
                disabled={saving}
                aria-pressed={on}
                className={`focus-ring flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-wait ${
                  on ? 'border-brass bg-brass text-onbrass' : 'border-line hover:bg-panel-2'
                }`}
              >
                <TargetBandIcon value={band.value} className="h-5 w-5 shrink-0" />
                <span className="text-lg font-semibold tabular-nums">{formatTargetBand(band.value)}</span>
                <span className={`text-sm ${on ? 'opacity-80' : 'text-mist'}`}>{band.label}</span>
              </button>
            )
          })}
        </div>

        {message && <p role="status" className="mt-4 rounded-xl bg-reading-tint px-4 py-3 text-sm text-reading">{message}</p>}
        {error && <p role="alert" className="mt-4 rounded-xl bg-urgent-tint px-4 py-3 text-sm text-urgent">{error}</p>}
      </div>
    </div>,
    document.body
  )
}
