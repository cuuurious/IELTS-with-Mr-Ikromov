/*
 * What to tell a student when the microphone does not start (2026-11-07).
 * The Errors page showed students on iPhone and Android who had blocked
 * the microphone and did not know how to allow it again.
 */
const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || '')

export const isIphone = () => /iPhone|iPad|iPod/i.test(ua()) || (/Macintosh/.test(ua()) && typeof document !== 'undefined' && 'ontouchend' in document)
export const isInAppBrowser = () => /Telegram|Instagram|FBAN|FBAV|Line\/|TikTok|Snapchat/i.test(ua())

// Problems on the student's side (not bugs): no need to send them to the Errors page.
export const isUserSideMicProblem = (err) =>
  ['NotAllowedError', 'PermissionDeniedError', 'SecurityError', 'NotFoundError', 'DevicesNotFoundError', 'NotReadableError', 'AbortError'].includes(err?.name)

export function micBlockedHelp() {
  if (isInAppBrowser()) return 'Telegram / Instagram block the microphone. Open the website in Chrome or Safari and try again.'
  if (isIphone())
    return 'The microphone is blocked. On iPhone: tap “aA” in the address bar → Website Settings → Microphone → Allow. Also check Settings → Safari → Microphone → Allow. Then press the button again.'
  if (/Android/i.test(ua()))
    return 'The microphone is blocked. Tap the icon left of the website address → Permissions → Microphone → Allow, then press the button again.'
  return 'The microphone is blocked. Click the lock icon left of the website address → Microphone → Allow, then press the button again.'
}

export function micErrorText(err) {
  const name = err?.name
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return micBlockedHelp()
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found. Connect a microphone or headphones with a microphone and try again.'
  if (name === 'NotReadableError' || name === 'AbortError') return 'Another app is using the microphone (a call, Zoom, Telegram). Close it and try again.'
  return ''
}

// Keep the screen on while recording: a locked screen stops the microphone on phones.
export async function keepScreenOn() {
  try {
    if (navigator.wakeLock?.request) return await navigator.wakeLock.request('screen')
  } catch {
    /* not allowed or not supported */
  }
  return null
}
