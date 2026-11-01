import { useEffect, useMemo, useRef, useState } from 'react'

/*
 * Player for a speaking recording (2026-11-02) — replaces the browser's
 * grey <audio controls> in homework hand-ins. A violet card with the
 * part name, a round play button, a waveform you can tap to jump to a
 * point, the time, a speed button and a download link.
 */

const SPEEDS = [1, 1.25, 1.5, 0.75]

const fmt = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

// Same bars every time for the same recording, so it doesn't jump around.
function barsFor(seed, n = 48) {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0
    const wave = Math.sin(i / 3) * 0.25 + 0.55
    return Math.max(0.18, Math.min(1, wave + ((h % 100) / 100 - 0.5) * 0.7))
  })
}

export default function SkillAudioPlayer({ src, label, sublabel }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const bars = useMemo(() => barsFor(String(src || label || 'x')), [src, label])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return undefined
    const onMeta = () => setDuration(Number.isFinite(a.duration) ? a.duration : 0)
    const onTime = () => setTime(a.currentTime || 0)
    const onEnd = () => {
      setPlaying(false)
      setTime(0)
    }
    const onPause = () => setPlaying(false)
    const onPlay = () => setPlaying(true)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('durationchange', onMeta)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('ended', onEnd)
    a.addEventListener('pause', onPause)
    a.addEventListener('play', onPlay)
    return () => {
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('durationchange', onMeta)
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('ended', onEnd)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('play', onPlay)
    }
  }, [src])

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }

  const seek = (e) => {
    const a = audioRef.current
    if (!a || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX ?? 0) - rect.left
    a.currentTime = Math.max(0, Math.min(duration, (x / rect.width) * duration))
    setTime(a.currentTime)
  }

  const onSeekKey = (e) => {
    const a = audioRef.current
    if (!a || !duration) return
    if (e.key === 'ArrowRight') a.currentTime = Math.min(duration, a.currentTime + 5)
    if (e.key === 'ArrowLeft') a.currentTime = Math.max(0, a.currentTime - 5)
  }

  const nextSpeed = () => {
    const i = SPEEDS.indexOf(speed)
    const next = SPEEDS[(i + 1) % SPEEDS.length]
    setSpeed(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  const progress = duration ? time / duration : 0

  return (
    <div className="flex flex-col gap-3 rounded-[20px] bg-speaking-tint p-4">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      {(label || sublabel) && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-speaking text-white" aria-hidden="true">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            </span>
            <span className="text-sm font-extrabold text-speaking">{label}</span>
            {sublabel && <span className="text-xs font-bold text-paper-dim">{sublabel}</span>}
          </div>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="focus-ring rounded-lg px-2 py-1 text-xs font-extrabold text-speaking hover:bg-panel/60"
          >
            Download
          </a>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className="focus-ring grid h-12 w-12 shrink-0 place-items-center rounded-full bg-speaking text-white shadow-[0_6px_16px_rgba(106,63,153,0.35)] transition hover:brightness-110"
        >
          {playing ? (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5" /><rect x="14" y="5" width="4" height="14" rx="1.5" /></svg>
          ) : (
            <svg className="ml-0.5 h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>
          )}
        </button>
        <div
          role="slider"
          tabIndex={0}
          aria-label={`${label || 'Recording'} position`}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          onClick={seek}
          onKeyDown={onSeekKey}
          className="focus-ring flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-[3px] rounded-lg"
        >
          {bars.map((h, i) => (
            <span
              key={i}
              className={`flex-1 rounded-full transition-colors ${i / bars.length < progress ? 'bg-speaking' : 'bg-speaking/25'}`}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          ))}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-brand text-[13px] font-semibold tabular-nums text-paper">
            {fmt(time)} <span className="text-mist">/ {fmt(duration)}</span>
          </span>
          <button
            type="button"
            onClick={nextSpeed}
            aria-label={`Playback speed ${speed}x`}
            className="focus-ring rounded-md bg-panel px-1.5 py-0.5 text-[11px] font-extrabold text-speaking"
          >
            {speed}×
          </button>
        </div>
      </div>
    </div>
  )
}
