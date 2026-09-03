import { useEffect, useRef, useState } from 'react'

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

  return (
    <div className="flex items-center gap-2.5 min-w-[200px] max-w-[260px]">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[13px] ${
          mine ? 'bg-onbrass text-brass' : 'bg-brass text-onbrass'
        }`}
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>

      <div className="flex-1 min-w-0">
        <div
          onClick={seek}
          className={`h-1.5 rounded-full cursor-pointer ${
            mine ? 'bg-onbrass/30' : 'bg-line'
          }`}
        >
          <div
            className={`h-full rounded-full ${
              mine ? 'bg-onbrass' : 'bg-brass'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div
          className={`mt-1 text-[10px] font-mono ${
            mine ? 'text-onbrass/80' : 'text-mist'
          }`}
        >
          {format(isPlaying || currentTime ? currentTime : duration)}
        </div>
      </div>
    </div>
  )
}
