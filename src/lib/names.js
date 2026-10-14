/*
 * The name to greet someone by (2026-10-14). Many profiles are saved
 * surname-first ("Ikromov Jasur", "Solijonov Murodilbek"), so taking the
 * first word greeted Jasur as "Ikromov". When the first word looks like
 * an Uzbek/Russian surname (-ov, -ova, -ev, -eva, -yev, -yeva, -iy) and
 * the second doesn't, greet with the second word instead.
 */
const SURNAME = /(ov|ova|ev|eva|yev|yeva|iy|aya)$/i

export function firstNameOf(fullName, fallback = '') {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return fallback
  if (parts.length >= 2 && SURNAME.test(parts[0]) && !SURNAME.test(parts[1])) return parts[1]
  return parts[0]
}
