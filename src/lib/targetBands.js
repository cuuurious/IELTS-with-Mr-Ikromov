// Shared by the sign-up form and Account Settings so both offer the
// exact same choices. IELTS bands only ever move in half-point steps,
// and this app only accepts 7.0 and up per Mr Ikromov's own rule
// (anything below isn't a realistic target for this class).
export const TARGET_BANDS = [
  { value: 7, label: 'Solid Start', emoji: '🎯' },
  { value: 7.5, label: 'Strong Push', emoji: '💪' },
  { value: 8, label: 'High Achiever', emoji: '🚀' },
  { value: 8.5, label: 'Elite Level', emoji: '🔥' },
  { value: 9, label: 'Perfect Score', emoji: '👑' },
]

export const DEFAULT_TARGET_BAND = 7.5

export const MIN_TARGET_BAND = 7
export const MAX_TARGET_BAND = 9

export function isValidTargetBand(value) {
  const n = Number(value)

  if (!Number.isFinite(n)) return false
  if (n < MIN_TARGET_BAND || n > MAX_TARGET_BAND) return false

  // Half-point steps only: 7, 7.5, 8, 8.5, 9 — reject 7.2, 8.1, etc.
  return Number.isInteger(n * 2)
}

export function getTargetBandInfo(value) {
  const n = Number(value)

  return (
    TARGET_BANDS.find((b) => b.value === n) ||
    TARGET_BANDS.find(
      (b) => b.value === DEFAULT_TARGET_BAND
    )
  )
}

// IELTS bands are conventionally written with one decimal place
// (7 -> "7.0"), so this keeps that convention everywhere it's shown.
export function formatTargetBand(value) {
  const n = Number(value)

  if (!Number.isFinite(n)) return ''

  return n.toFixed(1)
}
