/*
 * How a group looks everywhere (Study room design, 2026-10-06): a
 * badge (the number for "71", the first letter for "EL STARS"), a
 * display name ("Group 71"), and one soft colour from the skill palette
 * picked by the group's position, so a group keeps the same colour on
 * Home, in Groups & Homework and in the Mock Center.
 */

const PALETTE = [
  { tint: 'bg-reading-tint', text: 'text-reading', bar: 'bg-reading' },
  { tint: 'bg-writing-tint', text: 'text-writing', bar: 'bg-writing' },
  { tint: 'bg-listening-tint', text: 'text-listening', bar: 'bg-listening' },
  { tint: 'bg-speaking-tint', text: 'text-speaking', bar: 'bg-speaking' },
  { tint: 'bg-vocab-tint', text: 'text-vocab', bar: 'bg-vocab' },
]

export function groupColour(index) {
  return PALETTE[(index < 0 ? 0 : index) % PALETTE.length]
}

export function groupBadge(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return '?'
  if (/^\d+$/.test(trimmed)) return trimmed
  return trimmed.charAt(0).toUpperCase()
}

export function groupDisplayName(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'Group'
  return /^\d+$/.test(trimmed) ? `Group ${trimmed}` : trimmed
}
