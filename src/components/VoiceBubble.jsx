import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

/*
 * A Telegram-style voice message player: a round play/pause button,
 * a progress track you can tap to seek, and a running time — instead
 * of the browser's plain, boxy default <audio controls>. Used by both
 * Chat.jsx and GroupChat.jsx.
 *
 * `tone="mine"` is for a voice note sitting inside your own (brass)
 * bubble, where the button needs to be the light color and the bubble
 * background the dark one — the reverse of everyone else's bubbles —
 * same as how Telegram flips its player colors on outgoing messages.
 */
export default function VoiceBubble({ src, tone = 'theirs' }) {
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoaded = () => setDuration(audio.duration || 0)
    const onTime = () => setCurrentTime(audio.currentTime || 0)

    const onEnd = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnd)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnd)
    }
  }, [])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play()
      setIsPlaying(true)
    }
  }

  const seek = (e) => {
    const audio = audioRef.current
    if (!audio || !duration) return

    const rect = e.currentTarget.getBoundingClientRect()

    const ratio = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / rect.width)
    )

    audio.currentTime = ratio * duration
    setCurrentTime(audio.currentTime)
  }

  const format = (seconds) => {
    if (!Number.isFinite(seconds)) return '0:00'

    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)

    return `${m}:${String(s).padStart(2, '0')}`
  }

  const progress = duration ? (currentTime / duration) * 100 : 0
  const mine = tone === 'mine'

  // Study room look (2026-10-07): a calm waveform instead of a bar —
  // purely decorative heights, seeded from the file name so a voice
  // note keeps the same shape every time it is shown.
  let seed = 0
  for (let i = 0; i < String(src || '').length; i++) {
    seed = (seed * 31 + String(src).charCodeAt(i)) >>> 0
  }
  const bars = Array.from({ length: 28 }, (_, i) => {
    seed = (seed * 1103515245 + 12345) >>> 0
    const wave = Math.sin((i / 27) * Math.PI) * 0.45 + 0.35
    return Math.max(0.18, Math.min(1, wave + ((seed % 100) / 100 - 0.5) * 0.55))
  })

  return (
    <div className="flex min-w-[208px] max-w-[260px] items-center gap-3 py-0.5">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        className={`focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 ${
          mine ? 'bg-onbrass text-brass' : 'bg-brass text-onbrass'
        }`}
      >
        {isPlaying ? (
          <Icon name="pause" className="h-4 w-4" strokeWidth={2.6} />
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          onClick={seek}
          className="flex h-7 cursor-pointer items-center gap-[2px]"
          role="presentation"
        >
          {bars.map((h, i) => {
            const filled = (i + 0.5) / bars.length * 100 <= progress
            return (
              <span
                key={i}
                className={`w-[3px] flex-1 rounded-full transition-colors ${
                  mine
                    ? filled ? 'bg-onbrass' : 'bg-onbrass/35'
                    : filled ? 'bg-brass' : 'bg-brass/25'
                }`}
                style={{ height: `${Math.round(h * 100)}%` }}
              />
            )
          })}
        </div>

        <div
          className={`mt-0.5 text-[11px] tabular-nums ${
            mine ? 'text-onbrass/75' : 'text-mist'
          }`}
        >
          {format(isPlaying || currentTime ? currentTime : duration)}
        </div>
      </div>
    </div>
  )
}
