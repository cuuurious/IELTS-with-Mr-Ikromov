/*
 * ============================================================
 * AUTOMATIC AUDIO COMPRESSION — BEFORE UPLOAD
 * ============================================================
 *
 * A voice memo exported from a phone (iPhone Voice Memos .m4a,
 * Android's own recorder, etc.) can run several megabytes per minute
 * at whatever bitrate the phone's recorder app used — completely fine
 * to listen to, but exactly the kind of large file that times out or
 * fails to upload on a slow connection, the same underlying problem
 * compressImage.js solves for photos.
 *
 * This decodes an uploaded audio file right in the browser and
 * re-encodes it as mono MP3 at a much lower bitrate that's still
 * perfectly clear for a single speaker (not music).
 *
 * REWRITTEN 2026-09-24 — the previous version worked by literally
 * PLAYING the decoded audio back through a virtual output while
 * MediaRecorder captured that live stream, because that used to be the
 * only "re-encode this" trick available without a proper encoder — but
 * it meant compression took roughly as long as the recording itself (a
 * 5-minute voice memo took about 5 minutes), which students correctly
 * read as "this looks frozen" and reloaded the page mid-compression,
 * losing their upload.
 *
 * This version decodes the file (fast — not real-time), downmixes to
 * mono and resamples down to a voice-appropriate rate via
 * OfflineAudioContext (also fast — it renders as quickly as the CPU
 * can, not in real time), then encodes the resulting PCM samples
 * straight to MP3 with a dedicated JS encoder (lamejs) — no playback
 * involved anywhere. In practice this finishes in a few seconds to
 * maybe half a minute even for a several-minute recording, instead of
 * taking as long as the recording itself.
 * ============================================================
 */

// Don't bother for anything already small — nothing meaningful to
// save.
const SKIP_BELOW_BYTES = 3 * 1024 * 1024

// Mono, 22.05kHz, 40kbps MP3 — very clear for a single speaker's voice
// (not music), a fraction of what a phone's own voice-memo app
// typically records at.
const TARGET_SAMPLE_RATE = 22050
const TARGET_BITRATE_KBPS = 40

// Now a generous safety ceiling rather than an expected duration — the
// old real-time approach could legitimately need up to several
// minutes; decode+resample+encode should never come close to this
// even for a long recording, so hitting it at all would mean something
// is genuinely wrong (a very old/slow device, a huge file) rather than
// "still working as expected."
const MAX_PROCESS_MS = 90 * 1000

export function looksLikeAudio(file) {
  const type = (file.type || '').toLowerCase()
  if (type.startsWith('audio/')) return true

  const name = (file.name || '').toLowerCase()

  return [
    '.mp3',
    '.wav',
    '.m4a',
    '.aac',
    '.ogg',
    '.oga',
    '.opus',
    '.weba',
    '.webm',
    '.flac',
    '.wma',
    '.amr',
    '.3gp',
    '.3ga',
  ].some((ext) => name.endsWith(ext))
}

function getAudioContextClass() {
  if (typeof window === 'undefined') return null
  return window.AudioContext || window.webkitAudioContext || null
}

function getOfflineAudioContextClass() {
  if (typeof window === 'undefined') return null
  return window.OfflineAudioContext || window.webkitOfflineAudioContext || null
}

async function decodeToBuffer(file) {
  const AudioContextClass = getAudioContextClass()

  if (!AudioContextClass) {
    throw new Error('Web Audio is not supported in this browser.')
  }

  const arrayBuffer = await file.arrayBuffer()
  const ctx = new AudioContextClass()

  try {
    return await ctx.decodeAudioData(arrayBuffer)
  } finally {
    ctx.close?.()
  }
}

// Downmixes to a single (mono) channel and resamples down to
// targetSampleRate, all inside an OfflineAudioContext — this renders
// as fast as the CPU can go, completely unlike a real AudioContext
// played through real speakers/a real destination, which is
// necessarily locked to real time.
async function resampleToMonoOffline(audioBuffer, targetSampleRate) {
  const OfflineAudioContextClass = getOfflineAudioContextClass()

  // No OfflineAudioContext available in this browser — encode at the
  // original rate/channel layout instead of failing outright. Rare in
  // practice (every modern browser has it), and still gets a real
  // compression benefit from the bitrate drop alone.
  if (!OfflineAudioContextClass) {
    return audioBuffer
  }

  const rate = Math.min(audioBuffer.sampleRate, targetSampleRate)
  const length = Math.max(1, Math.ceil(audioBuffer.duration * rate))

  const offlineCtx = new OfflineAudioContextClass(1, length, rate)
  const source = offlineCtx.createBufferSource()

  source.buffer = audioBuffer
  source.connect(offlineCtx.destination)
  source.start()

  return await offlineCtx.startRendering()
}

function floatTo16BitPCM(float32Samples) {
  const output = new Int16Array(float32Samples.length)

  for (let i = 0; i < float32Samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32Samples[i]))
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }

  return output
}

// Loaded on demand from a CDN, same pattern as compressImage.js's HEIC
// decoder — most uploads never need this exact path re-run (it's only
// for audio over SKIP_BELOW_BYTES), so there's no reason to bundle a
// dedicated MP3 encoder into everyone's main JS bundle.
async function encodeMp3(pcmSamples, sampleRate) {
  const lamejsModule = await withTimeout(
    import(
      /* @vite-ignore */
      'https://esm.sh/@breezystack/lamejs@1.2.7'
    ),
    8000
  )

  const Mp3Encoder =
    lamejsModule.Mp3Encoder || lamejsModule.default?.Mp3Encoder

  if (!Mp3Encoder) {
    throw new Error('MP3 encoder failed to load.')
  }

  const encoder = new Mp3Encoder(1, sampleRate, TARGET_BITRATE_KBPS)

  // lamejs expects fixed-size chunks — 1152 samples per MPEG frame is
  // its own documented block size for mono encoding.
  const BLOCK_SIZE = 1152
  const chunks = []

  for (let i = 0; i < pcmSamples.length; i += BLOCK_SIZE) {
    const chunk = pcmSamples.subarray(i, i + BLOCK_SIZE)
    const mp3buf = encoder.encodeBuffer(chunk)

    if (mp3buf.length > 0) {
      chunks.push(mp3buf)
    }
  }

  const finalBuf = encoder.flush()

  if (finalBuf.length > 0) {
    chunks.push(finalBuf)
  }

  return new Blob(chunks, { type: 'audio/mpeg' })
}

async function reencode(file) {
  const decoded = await decodeToBuffer(file)
  const mono = await resampleToMonoOffline(decoded, TARGET_SAMPLE_RATE)
  const pcm = floatTo16BitPCM(mono.getChannelData(0))
  const blob = await encodeMp3(pcm, mono.sampleRate)

  if (!blob.size) {
    throw new Error('Compressed audio came out empty.')
  }

  return blob
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `${label || 'Audio compression'} timed out after ${ms}ms`
            )
          ),
        ms
      )
    ),
  ])
}

function renameForCompressedOutput(originalName) {
  const base =
    originalName && originalName.includes('.')
      ? originalName.slice(0, originalName.lastIndexOf('.'))
      : originalName

  return `${base || 'audio'}.mp3`
}

/*
 * The one function everything else calls. ALWAYS resolves — worst
 * case (an unsupported format, a browser without Web Audio, a
 * timeout, any decoding/encoding error) it resolves with the
 * ORIGINAL, untouched File, same as if this function didn't exist at
 * all.
 */
export async function compressAudioIfNeeded(file) {
  try {
    if (!file || typeof file !== 'object') return file
    if (!looksLikeAudio(file)) return file
    if (file.size <= SKIP_BELOW_BYTES) return file
    if (!getAudioContextClass()) return file

    const blob = await withTimeout(
      reencode(file),
      MAX_PROCESS_MS,
      'Audio compression'
    )

    if (!blob || blob.size >= file.size) {
      // Compression didn't actually help — keep the original rather
      // than hand back a "compressed" file that's actually bigger.
      return file
    }

    return new File(
      [blob],
      renameForCompressedOutput(file.name),
      {
        type: 'audio/mpeg',
        lastModified: file.lastModified || Date.now(),
      }
    )
  } catch (error) {
    console.error(
      'Audio compression failed — uploading the original file instead:',
      error
    )

    return file
  }
}
