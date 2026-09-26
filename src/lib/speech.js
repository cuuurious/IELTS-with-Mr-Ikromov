/*
 * ================================================================
 * SPEECH — tiny wrapper around the browser's built-in Web Speech API
 * (window.speechSynthesis).
 * ================================================================
 * Added 2026-09-26. Jasur, verbatim (about the mock check-in/
 * instructions screen): "they will see instrutcions and hear them as
 * well and confirm there", and later the same day: "yes ofcourse audio
 * instructions have to be added just like in real exam." The real
 * computer-delivered IELTS test narrates its own instructions before
 * each section rather than only showing text — this is the mechanism
 * that closes that gap.
 *
 * Deliberately NOT recorded audio files: no storage bucket, no
 * per-stage recording to manage/re-record if instruction text ever
 * changes, zero ongoing cost, and every modern browser already ships a
 * TTS engine (this is the same API family Chrome/Edge/Safari/Firefox
 * all support natively — no external service, no API key). Falls back
 * silently to text-only when unsupported (very old browsers, some
 * locked-down kiosk browsers) — narration is a bonus, the printed
 * instructions text already on screen (FullMockRunner.jsx,
 * MockCheckIn.jsx) is always still there and never depends on this.
 *
 * Kept intentionally tiny — one active utterance at a time
 * (speak() always cancels whatever's already playing first, so
 * clicking "Replay" or moving to the next stage never overlaps two
 * narrations), no queueing, no voice-picking UI. A slightly slower
 * rate (0.95) matches a real invigilator reading instructions aloud
 * rather than the browser's default, slightly-rushed pace.
 */

export function isSpeechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
}

export function speak(text, { rate = 0.95, pitch = 1, onStart, onEnd } = {}) {
  if (!isSpeechSupported() || !text) return false

  // Never let two narrations overlap — starting a new one always
  // silences whatever was already playing (same convention as the real
  // test never narrating two things at once).
  window.speechSynthesis.cancel()

  const utterance = new window.SpeechSynthesisUtterance(text)
  utterance.rate = rate
  utterance.pitch = pitch
  utterance.onstart = () => onStart?.()
  utterance.onend = () => onEnd?.()
  utterance.onerror = () => onEnd?.()

  window.speechSynthesis.speak(utterance)
  return true
}

export function stopSpeaking() {
  if (isSpeechSupported()) window.speechSynthesis.cancel()
}
