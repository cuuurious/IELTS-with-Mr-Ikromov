/*
 * How a group looks everywhere (Study room design, 2026-10-06): a
 * badge (the number for "71", the first letter for "EL STARS"), a
 * display name ("Group 71"), and one soft colour from the skill palette
 * picked by the group's position, so a group keeps the same colour on
 * Home, in Groups & Homework and in the Mock Center.
 */

// Group colours (2026-10-29): their own six Registan colours, separate
// from the skill colours, so "blue" never means both Listening and a group.
const PALETTE = [
  { tint: 'bg-group1-tint', text: 'text-group1', bar: 'bg-group1', border: 'border-group1', hex: 'var(--color-group1)' },
  { tint: 'bg-group2-tint', text: 'text-group2', bar: 'bg-group2', border: 'border-group2', hex: 'var(--color-group2)' },
  { tint: 'bg-group3-tint', text: 'text-group3', bar: 'bg-group3', border: 'border-group3', hex: 'var(--color-group3)' },
  { tint: 'bg-group4-tint', text: 'text-group4', bar: 'bg-group4', border: 'border-group4', hex: 'var(--color-group4)' },
  { tint: 'bg-group5-tint', text: 'text-group5', bar: 'bg-group5', border: 'border-group5', hex: 'var(--color-group5)' },
  { tint: 'bg-group6-tint', text: 'text-group6', bar: 'bg-group6', border: 'border-group6', hex: 'var(--color-group6)' },
]

// A group's colour comes from its position in the list of groups ordered
// by creation date, so it is the same on every page.
export function groupColour(index) {
  return PALETTE[(index < 0 ? 0 : index) % PALETTE.length]
}

export function groupBadge(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return '?'
  if (/^\d+$/.test(trimmed)) return trimmed
  // "Group 71" → "71"
  const tail = /(\d+)\s*$/.exec(trimmed)
  if (tail) return tail[1]
  return trimmed.charAt(0).toUpperCase()
}

export function groupDisplayName(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return 'Group'
  return /^\d+$/.test(trimmed) ? `Group ${trimmed}` : trimmed
}
