import { roundOverallBand } from './ieltsBands'

/*
 * Shared by the writing/speaking examiner screens and the teacher's
 * "change marks" screens (2026-10-16), so both sides always calculate
 * the overall band the same way.
 */

export const WRITING_CRITERIA = [
  { key: 'ta', column: 'ta_band', short: 'TA', label: 'Task Achievement / Response' },
  { key: 'cc', column: 'cc_band', short: 'CC', label: 'Coherence & Cohesion' },
  { key: 'lr', column: 'lr_band', short: 'LR', label: 'Lexical Resource' },
  { key: 'gra', column: 'gra_band', short: 'GRA', label: 'Grammatical Range & Accuracy' },
]

export const SPEAKING_CRITERIA = [
  { key: 'fc', column: 'fc_band', short: 'FC', label: 'Fluency & Coherence' },
  { key: 'lr', column: 'lr_band', short: 'LR', label: 'Lexical Resource' },
  { key: 'gra', column: 'gra_band', short: 'GRA', label: 'Grammatical Range & Accuracy' },
  { key: 'pron', column: 'pron_band', short: 'PRON', label: 'Pronunciation' },
]

// Overall band from the four criteria, only once all four are filled in
// (an older result with no breakdown keeps its existing band).
export function computeOverallBand(values) {
  const nums = values.map((v) => (v === '' || v == null ? null : Number(v)))
  if (nums.some((n) => n == null || Number.isNaN(n))) return null
  return roundOverallBand(nums.reduce((sum, n) => sum + n, 0) / nums.length)
}

// A criterion band must be 0–9 in steps of 0.5 (or left empty).
export function bandProblem(value) {
  if (value === '' || value == null) return ''
  const n = Number(value)
  if (Number.isNaN(n) || n < 0 || n > 9) return 'Use a band from 0 to 9.'
  if (Math.round(n * 2) !== n * 2) return 'Use whole or half bands (6, 6.5, 7…).'
  return ''
}

export const toBandOrNull = (v) => (v === '' || v == null ? null : Number(v))
