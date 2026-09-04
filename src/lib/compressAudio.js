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
 * re-encodes it at a much lower bitrate that's still perfectly clear
 * for a single speaker (not music) — the same target bitrate
 * AudioRecorder.jsx now records at directly, just applied here to a
 * file that already exists instead of a live microphone stream.
 *
 * IMPORTANT — how this differs from compressImage.js: there is no
 * instant "transcode this file" API in a browser, only real-time
 * playback capture (decode the audio, play it back through a virtual
 * output, and record THAT). So re-encoding here takes roughly as
 * long as the recording's own length — a 3-minute voice memo takes
 * about 3 minutes to process. MAX_PROCESS_MS below is a hard ceiling
 * that gives up and falls back to the original file if that ever
 * takes unexpectedly long, so this can only ever help, never block a
 * submission outright.
 * ============================================================
 */

// Don't bother for anything already small — nothing meaningful to
// save, and it's not worth the real-time re-encode wait.
const SKIP_BELOW_BYTES = 3 * 1024 * 1024

// 40kbps opus — very clear for a single speaker, a fraction of what a
// phone's own voice-memo app typically records at.
const TARGET_BITRATE = 40000

// Absolute ceiling on how long this will wait before giving up and
// using the original file untouched.
const MAX_PROCESS_MS = 6 * 60 * 1000

function looksLikeAudio(file) {
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

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''

  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus'
  }

  if (MediaRecorder.isTypeSupported('audio/webm')) {
    return 'audio/webm'
  }

  return ''
}

function getAudioContextClass() {
  if (typeof window === 'undefined') return null
  return window.AudioContext || window.webkitAudioContext || null
}

// Decode the file, then play it back into a virtual (silent to the
// student — nothing is routed to their speakers) audio destination
// while MediaRecorder captures that stream at the lower bitrate. Both
// AudioContexts are closed as soon as they're no longer needed so a
// long recording doesn't leave decoded audio sitting in memory.
async function reencode(file) {
  const AudioContextClass = getAudioContextClass()

  if (!AudioContextClass) {
    throw new Error('Web Audio is not supported in this browser.')
  }

  const arrayBuffer = await file.arrayBuffer()

  const decodeCtx = new AudioContextClass()
  let audioBuffer

  try {
    audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer)
  } finally {
    decodeCtx.close?.()
  }

  const playCtx = new AudioContextClass()

  try {
    const destination = playCtx.createMediaStreamDestination()
    const source = playCtx.createBufferSource()

    source.buffer = audioBuffer
    source.connect(destination)

    const mimeType = pickMimeType()

    const recorderOptions = {
      audioBitsPerSecond: TARGET_BITRATE,
    }

    if (mimeType) {
      recorderOptions.mimeType = mimeType
    }

    const recorder = new MediaRecorder(
      destination.stream,
      recorderOptions
    )

    const chunks = []

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data)
      }
    }

    const finished = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve()

      recorder.onerror = (event) => {
        reject(
          event?.error ||
            new Error('Recording failed during audio compression.')
        )
      }

      source.onended = () => {
        // A short grace delay lets the recorder flush its final
        // chunk before stopping.
        setTimeout(() => {
          if (recorder.state !== 'inactive') {
            recorder.stop()
          }
        }, 200)
      }
    })

    recorder.start(1000)
    source.start()

    await finished

    const blob = new Blob(chunks, {
      type: recorder.mimeType || mimeType || 'audio/webm',
    })

    if (!blob.size) {
      throw new Error('Compressed audio came out empty.')
    }

    return blob
  } finally {
    playCtx.close?.()
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Audio compression took too long.'))
    }, ms)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function renameForCompressedOutput(originalName) {
  const base =
    originalName && originalName.includes('.')
      ? originalName.slice(0, originalName.lastIndexOf('.'))
      : originalName

  return `${base || 'audio'}.webm`
}

/*
 * The one function everything else calls. ALWAYS resolves — worst
 * case (an unsupported format, a browser without Web Audio, a
 * timeout, any decoding error) it resolves with the ORIGINAL,
 * untouched File, same as if this function didn't exist at all.
 */
export async function compressAudioIfNeeded(file) {
  try {
    if (!file || typeof file !== 'object') return file
    if (!looksLikeAudio(file)) return file
    if (file.size <= SKIP_BELOW_BYTES) return file
    if (typeof MediaRecorder === 'undefined') return file

    const blob = await withTimeout(
      reencode(file),
      MAX_PROCESS_MS
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
        type: blob.type || 'audio/webm',
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
