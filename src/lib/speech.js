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

// Picking a voice, not just relying on the browser's default —
// added after Jasur reported the instructions coming through in "a
// slavic accent." Without an explicit voice, some browsers/OSes hand
// speechSynthesis whatever voice the SYSTEM's UI language is set to
// (e.g. a Russian install), regardless of the utterance's own text or
// language — so this picks an actual English voice instead of hoping
// the default happens to be one. Real IELTS instructions are narrated
// in British-accented English, so en-GB is preferred first, then
// en-US, then any English voice at all; a named "Natural"/neural voice
// (the newer, less robotic-sounding kind Edge/Chrome ship) is
// preferred over a generic one where both are available.
function pickVoice() {
  const voices = window.speechSynthesis.getVoices() || []
  if (voices.length === 0) return null

  const englishVoices = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'))
  const pool = englishVoices.length > 0 ? englishVoices : voices

  const score = (v) => {
    const lang = v.lang?.toLowerCase() || ''
    const name = v.name?.toLowerCase() || ''
    let s = 0
    if (lang.startsWith('en-gb')) s += 3
    else if (lang.startsWith('en-us')) s += 2
    else if (lang.startsWith('en')) s += 1
    if (/natural|neural|online/.test(name)) s += 2
    return s
  }

  return pool.reduce((best, v) => (score(v) > score(best) ? v : best), pool[0])
}

// Voice lists load asynchronously in some browsers (Chrome fires
// `voiceschanged` once they're ready) — resolves with whatever's
// available, waiting briefly for that event rather than always racing
// an empty list on the very first call of the page.
function getVoiceForSpeech() {
  return new Promise((resolve) => {
    const existing = pickVoice()
    if (existing) return resolve(existing)

    const onVoicesChanged = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged)
      resolve(pickVoice())
    }
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged)
    // Don't wait forever if the event never fires (some browsers just
    // never emit it) — fall back to whatever getVoices() has by then.
    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged)
      resolve(pickVoice())
    }, 300)
  })
}

export async function speak(text, { rate = 0.95, pitch = 1, onStart, onEnd } = {}) {
  if (!isSpeechSupported() || !text) return false

  // Never let two narrations overlap — starting a new one always
  // silences whatever was already playing (same convention as the real
  // test never narrating two things at once).
  window.speechSynthesis.cancel()

  const utterance = new window.SpeechSynthesisUtterance(text)
  utterance.rate = rate
  utterance.pitch = pitch
  utterance.lang = 'en-GB'

  const voice = await getVoiceForSpeech()
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }

  utterance.onstart = () => onStart?.()
  utterance.onend = () => onEnd?.()
  utterance.onerror = () => onEnd?.()

  window.speechSynthesis.speak(utterance)
  return true
}

export function stopSpeaking() {
  if (isSpeechSupported()) window.speechSynthesis.cancel()
}
