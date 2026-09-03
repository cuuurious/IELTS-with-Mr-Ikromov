/*
 * A round "video message" bubble, the way Telegram shows video notes
 * recorded from the camera (as opposed to a regular video file, which
 * still shows as a normal rectangular player). Used by both Chat.jsx
 * and GroupChat.jsx.
 *
 * Kept to the browser's own play/pause/seek controls rather than a
 * hand-built overlay — that avoids the click ever fighting the
 * player, at the cost of the controls only showing on tap/hover, same
 * as any other video on the web.
 */
export default function VideoNoteBubble({ src }) {
  return (
    <div className="w-48 h-48 rounded-full overflow-hidden border-2 border-line bg-black">
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        className="w-full h-full object-cover"
      />
    </div>
  )
}
