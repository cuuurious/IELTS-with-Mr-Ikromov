// Approximate percentage-to-band conversion for Reading/Listening,
// added 2026-09-25 for the TRF-style score report ("next level" pick).
//
// This app only ever stores a raw percentage for Reading/Listening
// attempts (mock_attempts.score/max_score) — there's no official IELTS
// band for either until IDP actually grades a real sitting. IDP/British
// Council never publish their exact raw-score-to-band table (and it can
// shift slightly between real test versions), so this uses the same
// approximate conversion most IELTS prep sites publish, scaled to a
// percentage so it still works even if a teacher-authored exam doesn't
// have exactly 40 questions like the real test. Always shown to
// students/teachers labeled as an ESTIMATE — see generateScoreReport.js.
const THRESHOLDS = [
  { minPct: 97.5, band: 9 },
  { minPct: 92.5, band: 8.5 },
  { minPct: 87.5, band: 8 },
  { minPct: 80, band: 7.5 },
  { minPct: 75, band: 7 },
  { minPct: 67.5, band: 6.5 },
  { minPct: 57.5, band: 6 },
  { minPct: 47.5, band: 5.5 },
  { minPct: 37.5, band: 5 },
  { minPct: 32.5, band: 4.5 },
  { minPct: 25, band: 4 },
  { minPct: 20, band: 3.5 },
  { minPct: 15, band: 3 },
  { minPct: 10, band: 2.5 },
  { minPct: 5, band: 2 },
]

export function estimateBandFromPercent(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return null
  const n = Number(pct)
  const hit = THRESHOLDS.find((t) => n >= t.minPct)
  return hit ? hit.band : 1
}

// Official IELTS overall-band rounding: an average ending in .25 rounds
// UP to the next half band, .75 rounds UP to the next whole band (e.g.
// 6.25 -> 6.5, 6.75 -> 7.0). Doubling first and using standard
// round-half-up reproduces exactly that rule, since JS's Math.round
// already rounds a clean .5 upward.
export function roundOverallBand(avg) {
  if (avg == null || Number.isNaN(Number(avg))) return null
  return Math.round(Number(avg) * 2) / 2
}

export function formatBand(band) {
  return band == null ? '—' : Number(band).toFixed(1)
}
