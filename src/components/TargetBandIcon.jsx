// Small line-icon set for each IELTS target-band tier, replacing the
// emoji previously used in compact badges (student rows, leaderboard
// pills, profile cards, the top-nav chip). Emoji render differently
// per OS/browser and carry a fixed color that clashes with whatever
// accent tint the badge uses — these are plain currentColor SVGs, so
// they always match the badge they're sitting in and look identical
// on every device. Values follow src/lib/targetBands.js: 7 "Solid
// Start", 7.5 "Strong Push", 8 "High Achiever", 8.5 "Elite Level",
// 9 "Perfect Score".
export default function TargetBandIcon({ value, className = 'h-3.5 w-3.5' }) {
  const n = Number(value)

  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': 'true',
  }

  if (n === 9) {
    return (
      <svg {...common}>
        <path d="M4 18h16" />
        <path d="M4 18l-1-9 5 4 4-7 4 7 5-4-1 9" />
        <circle cx="4" cy="7.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="4.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="20" cy="7.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    )
  }

  if (n === 8.5) {
    return (
      <svg {...common}>
        <path d="M12 2.5c1.8 2.6-.6 4.4-1.6 6.6-1 2.2-.7 4.6 1.1 6.1a4.5 4.5 0 0 0 6.9-3.8c0-2-1.1-3.4-2.1-4.6.2 1.4-.5 2.3-.5 2.3-.4-2.3-1.7-4.3-3.8-6.6z" />
        <path d="M9.8 16.2a3 3 0 0 0 4.9 1.9" />
      </svg>
    )
  }

  if (n === 8) {
    return (
      <svg {...common}>
        <path d="M12 15l-3-3c.5-4 2-7 5-9.5 2 0 5 1 6.5 3-1.5 4.5-4.5 8.5-8.5 9.5z" />
        <path d="M9 12H5c0-2 1-4 3-5" />
        <path d="M12 15v4c2 0 4-1 5-3" />
        <circle cx="14.5" cy="8.5" r="1.4" />
      </svg>
    )
  }

  if (n === 7.5) {
    return (
      <svg {...common}>
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="14 7 21 7 21 14" />
      </svg>
    )
  }

  // 7.0 (and fallback) — Solid Start
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
