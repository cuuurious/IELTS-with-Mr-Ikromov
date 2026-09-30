import { useEffect, useMemo, useRef } from 'react'

/*
 * Round video messages (Telegram-style "video notes") — shared by the
 * private chat (Chat.jsx) and the group chat (GroupChat.jsx) so both
 * record and preview them exactly the same way (2026-09-30).
 *
 * <RoundCameraPreview stream={…} /> — the live camera, mirrored like a
 *   selfie camera, inside a circle while a round video is recording, so
 *   you can see yourself in frame (before, you recorded blind).
 * <RecordedClipPreview blob={…} kind="video" | "audio" /> — the review
 *   step before Send/Discard: a round player for a video note, a normal
 *   audio player for a voice message.
 */
export function RoundCameraPreview({ stream, size = 'h-28 w-28' }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return
    video.srcObject = stream
    video.play().catch(() => {})
    return () => {
      video.srcObject = null
    }
  }, [stream])

  return (
    <div className={`${size} shrink-0 overflow-hidden rounded-full border-2 border-coral/70 bg-black shadow-[0_6px_18px_-8px_rgba(0,0,0,0.6)]`}>
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className="h-full w-full object-cover"
        style={{ transform: 'scaleX(-1)' }}
      />
    </div>
  )
}

export function RecordedClipPreview({ blob, kind }) {
  // One object URL per recording, released when it's sent/discarded —
  // creating a new one on every render leaked memory and restarted the
  // player each time the component re-rendered.
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])

  if (!url) return null

  if (kind === 'video') {
    return (
      <div className="h-28 w-28 shrink-0 overflow-hidden rounded-full border-2 border-line bg-black">
        <video
          controls
          playsInline
          src={url}
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  return <audio controls src={url} className="min-w-0 flex-1" />
}
