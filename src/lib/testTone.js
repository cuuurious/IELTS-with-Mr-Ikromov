// Pre-exam system check — a synthesized test tone, added 2026-09-26 so a
// student can confirm their audio actually works before sitting a Full
// Mock, matching real computer-delivered IELTS's own pre-test system
// check ("can you hear this clearly?"). Deliberately generated client-side
// via the Web Audio API rather than an uploaded/hosted audio file — no
// storage bucket, no network fetch, nothing that can itself fail to load
// and be mistaken for a real audio problem; it works the same offline as
// online. Zero ongoing cost, matching this feature's own "zero ongoing
// AI/hosting cost" positioning everywhere else in the app.

let activeCtx = null

export function isTestToneSupported() {
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext)
}

// Plays a short, gentle two-note chime (not a harsh raw square wave) and
// resolves once it's finished. Safe to call again before the previous one
// finishes — any still-running context is stopped first.
export function playTestTone() {
  return new Promise((resolve) => {
    if (!isTestToneSupported()) {
      resolve(false)
      return
    }

    stopTestTone()

    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    activeCtx = ctx

    const notes = [523.25, 659.25] // C5, E5 — a plain, unmistakable two-note chime
    const noteDurationSec = 0.35
    const gapSec = 0.08

    notes.forEach((freq, i) => {
      const startAt = ctx.currentTime + i * (noteDurationSec + gapSec)
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      // Fade in/out so it reads as a chime, not a click.
      gain.gain.setValueAtTime(0, startAt)
      gain.gain.linearRampToValueAtTime(0.35, startAt + 0.03)
      gain.gain.linearRampToValueAtTime(0.35, startAt + noteDurationSec - 0.05)
      gain.gain.linearRampToValueAtTime(0, startAt + noteDurationSec)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(startAt)
      osc.stop(startAt + noteDurationSec)
    })

    const totalMs = (notes.length * (noteDurationSec + gapSec)) * 1000
    setTimeout(() => {
      if (activeCtx === ctx) {
        ctx.close().catch(() => {})
        activeCtx = null
      }
      resolve(true)
    }, totalMs + 100)
  })
}

export function stopTestTone() {
  if (activeCtx) {
    activeCtx.close().catch(() => {})
    activeCtx = null
  }
}
