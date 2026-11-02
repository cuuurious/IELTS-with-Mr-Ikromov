/*
 * Coins (2026-11-02): the coin picture, the amount chip and YouTube
 * helpers shared by the student Courses page and the teacher admin.
 */
export function CoinIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#e6a33a" />
      <circle cx="12" cy="12" r="7.2" fill="none" stroke="#fff3d6" strokeWidth="1.6" />
      <path d="M9.2 9.2h5.6M12 9.2v6.2M9.6 15.4h4.8" stroke="#7a4a00" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

export function CoinAmount({ value, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 font-extrabold tabular-nums ${className}`}>
      <CoinIcon className="h-[1.1em] w-[1.1em]" />
      {value}
    </span>
  )
}

export function CoinStackArt({ className = '' }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden="true">
      <ellipse cx="80" cy="104" rx="62" ry="10" fill="#000" opacity="0.08" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(${30 + (i % 2) * 6} ${78 - i * 13})`}>
          <ellipse cx="22" cy="10" rx="22" ry="8" fill="#c98316" />
          <rect x="0" y="2" width="44" height="8" fill="#c98316" />
          <ellipse cx="22" cy="2" rx="22" ry="8" fill="#e6a33a" />
        </g>
      ))}
      <circle cx="112" cy="58" r="30" fill="#e6a33a" />
      <circle cx="112" cy="58" r="22" fill="none" stroke="#fff3d6" strokeWidth="3" />
      <path d="M103 49h18M112 49v19M104 68h16" stroke="#7a4a00" strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}

// "https://youtu.be/ID", "watch?v=ID", "/shorts/ID", "/embed/ID" -> ID
export function youtubeId(url) {
  const s = String(url || '').trim()
  const m =
    s.match(/youtu\.be\/([\w-]{6,})/) ||
    s.match(/[?&]v=([\w-]{6,})/) ||
    s.match(/youtube(?:-nocookie)?\.com\/(?:embed|shorts|live)\/([\w-]{6,})/)
  return m ? m[1] : null
}

export const SKILL_TONES = {
  listening: 'bg-listening-tint text-listening',
  reading: 'bg-reading-tint text-reading',
  writing: 'bg-writing-tint text-writing',
  speaking: 'bg-speaking-tint text-speaking',
  vocab: 'bg-vocab-tint text-vocab',
  general: 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] text-brass',
}

export const SKILL_GRADIENT = {
  listening: 'linear-gradient(135deg,#1f4e8c,#3f86d6)',
  reading: 'linear-gradient(135deg,#0f6e63,#22a596)',
  writing: 'linear-gradient(135deg,#7a4a1c,#c47a36)',
  speaking: 'linear-gradient(135deg,#5a3487,#9365c9)',
  vocab: 'linear-gradient(135deg,#8a6100,#d2a12c)',
  general: 'linear-gradient(135deg,#2456b0,#1a9bb5)',
}
