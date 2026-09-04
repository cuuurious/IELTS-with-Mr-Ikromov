/*
 * ============================================================
 * AUTOMATIC PHOTO COMPRESSION — BEFORE UPLOAD
 * ============================================================
 *
 * iPhone/Mac photos and full-resolution screenshots routinely come out
 * at 3-10MB EACH straight from the Photos app — completely normal to
 * look at, but that's exactly what was causing "load failed" for
 * students trying to submit several homework photos in one go: a slow
 * mobile connection (or several multi-megabyte files queued back to
 * back) timing out mid-upload.
 *
 * This shrinks a photo entirely in the student's own browser, before
 * it's ever sent to Supabase Storage — same photo, a fraction of the
 * bytes. A teacher reviewing handwriting/an essay on screen doesn't
 * need the original's full resolution, so this is a pure win: faster,
 * more reliable uploads, and less storage used, with no visible loss
 * of readability.
 *
 * Nothing here can make an upload WORSE than before this existed —
 * every failure path below falls back to returning the original,
 * untouched file, so a bug in the compression itself can never be the
 * reason a student's homework fails to upload.
 * ============================================================
 */

// Long edge, in pixels. Plenty to read handwriting/typed text off of —
// nowhere near a modern phone's 12+ megapixel original.
const MAX_DIMENSION = 1920

// Keep lowering JPEG quality until the result is at or under this,
// or we run out of steps to try.
const TARGET_MAX_BYTES = 1.5 * 1024 * 1024

// Don't bother touching a file that's already this small — nothing
// meaningful to save, and re-encoding it would just lose quality for
// no real benefit.
const SKIP_BELOW_BYTES = 600 * 1024

const JPEG_QUALITY_STEPS = [0.82, 0.7, 0.58, 0.45]

// Formats deliberately left alone:
//   - GIF: canvas would flatten it to a single frame, killing any animation.
//   - SVG: it's vector art, not a photo — canvas would rasterize it for no size benefit.
//
// HEIC/HEIF is NOT excluded, on purpose, even though several browsers
// (mainly non-Apple ones) can't decode it into a canvas at all: an
// iPhone that hands over a raw .heic file is almost always doing the
// uploading from Safari itself, which CAN decode it — so attempting
// this actually fixes two problems in one pass for the common case:
// it shrinks the file, AND it converts it to a JPEG that every
// browser can display (a teacher reviewing on Windows/Android
// couldn't otherwise see a HEIC photo inline at all). If decoding
// does fail (a non-Apple browser genuinely handed a .heic file),
// compressImageIfNeeded's own try/catch below falls back to the
// original file untouched, exactly as if this attempt was never
// made — so there's nothing to lose by trying.
function isCompressible(file) {
  const type = (file.type || '').toLowerCase()

  if (type === 'image/gif' || type === 'image/svg+xml') return false

  if (type.startsWith('image/')) return true

  // file.type can come back completely empty for HEIC on some
  // browsers/OS combinations — fall back to checking the extension.
  const name = (file.name || '').toLowerCase()
  return name.endsWith('.heic') || name.endsWith('.heif')
}

// createImageBitmap with imageOrientation:"from-image" both decodes
// AND rotates the image according to its own EXIF orientation tag.
// Skipping that option is a classic way naive compression code ends
// up handing back a portrait iPhone photo rotated sideways — the
// phone stores the sensor's raw (often landscape) pixel data plus a
// "rotate this for display" tag, and only decoders that actually
// honor that tag draw it upright.
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, {
        imageOrientation: 'from-image',
      })
    } catch {
      // A handful of older browsers accept the call but reject the
      // option outright — retry without it before giving up on
      // createImageBitmap entirely.
      try {
        return await createImageBitmap(file)
      } catch {
        // fall through to the <img> fallback below
      }
    }
  }

  // Last-resort fallback for browsers without createImageBitmap at
  // all. This does not reliably honor EXIF orientation in every
  // browser — but it's only ever reached on very old browsers, and a
  // same-orientation compressed photo beats failing compression
  // outright.
  return await new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this image.'))
    }

    img.src = url
  })
}

function drawToCanvas(image) {
  const width = image.width
  const height = image.height

  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight)

  // ImageBitmap objects hold decoded pixel data in memory until
  // closed — several full-resolution phone photos queued back to
  // back is exactly the situation this whole feature exists for, so
  // releasing each one the moment it's been drawn matters.
  if (typeof image.close === 'function') {
    image.close()
  }

  return canvas
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Could not compress this image.'))
      },
      'image/jpeg',
      quality
    )
  })
}

// Tries progressively lower JPEG quality until the result fits under
// TARGET_MAX_BYTES, or gives up and returns whichever attempt came out
// smallest. A highly detailed photo simply won't compress much
// further no matter the quality setting, so this doesn't loop forever
// chasing a target it can't hit.
async function compressToTargetSize(canvas) {
  let best = null

  for (const quality of JPEG_QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, quality)

    if (!best || blob.size < best.size) {
      best = blob
    }

    if (blob.size <= TARGET_MAX_BYTES) {
      return blob
    }
  }

  return best
}

function renameForCompressedOutput(originalName) {
  const base =
    originalName && originalName.includes('.')
      ? originalName.slice(0, originalName.lastIndexOf('.'))
      : originalName

  return `${base || 'photo'}.jpg`
}

/*
 * The one function everything else calls. ALWAYS resolves — worst
 * case (a corrupt file, an unsupported format, a canvas error, a
 * browser quirk) it resolves with the ORIGINAL, untouched File, same
 * as if this function didn't exist at all.
 */
export async function compressImageIfNeeded(file) {
  try {
    if (!file || typeof file !== 'object') return file
    if (!isCompressible(file)) return file
    if (file.size <= SKIP_BELOW_BYTES) return file

    const image = await decodeImage(file)
    const canvas = drawToCanvas(image)
    const blob = await compressToTargetSize(canvas)

    if (!blob || blob.size >= file.size) {
      // Compression didn't actually help (can happen with an
      // already well-compressed JPEG) — keep the original rather
      // than hand back a "compressed" file that's actually bigger.
      return file
    }

    return new File(
      [blob],
      renameForCompressedOutput(file.name),
      {
        type: 'image/jpeg',
        lastModified: file.lastModified || Date.now(),
      }
    )
  } catch (error) {
    console.error(
      'Image compression failed — uploading the original file instead:',
      error
    )

    return file
  }
}
