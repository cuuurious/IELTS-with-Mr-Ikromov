/*
 * Band maths for the forecast (2026-11-05). Plain JavaScript: tested by `npm test`.
 */
// Percentage of a practice page → band, as if it were out of 40.
export function bandFromPct(pct) {
  const raw = (pct / 100) * 40
  const table = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4]]
  for (const [r, b] of table) if (raw >= r) return b
  return 3.5
}

// IELTS overall: the average, rounded to the nearest half (x.25 → x.5, x.75 → x+1).
export function overallBand(bands) {
  const v = bands.filter((b) => b != null)
  if (v.length < 2) return null
  const avg = v.reduce((a, b) => a + b, 0) / v.length
  const whole = Math.floor(avg)
  const f = avg - whole
  return f < 0.25 ? whole : f < 0.75 ? whole + 0.5 : whole + 1
}

