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
// HEIC/HEIF is NOT excluded, on purpose — see the dedicated
// convertHeicToJpeg() step below, which is what actually handles it now.
function isCompressible(file) {
  const type = (file.type || '').toLowerCase()

  if (type === 'image/gif' || type === 'image/svg+xml') return false

  if (type.startsWith('image/')) return true

  // file.type can come back completely empty for HEIC on some
  // browsers/OS combinations — fall back to checking the extension.
  const name = (file.name || '').toLowerCase()
  return name.endsWith('.heic') || name.endsWith('.heif')
}

function isHeicFile(file) {
  const type = (file.type || '').toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true

  const name = (file.name || '').toLowerCase()
  return name.endsWith('.heic') || name.endsWith('.heif')
}

/*
 * Real-world confirmed bug (2026-09-24): a HEIC photo a student
 * submitted showed up as a broken image icon in the teacher's
 * dashboard. Root cause — the previous version of this file assumed
 * "an iPhone uploading a raw .heic file is almost always doing it from
 * Safari, which can decode it", but that's wrong in practice: Safari's
 * own createImageBitmap()/canvas APIs frequently CAN'T decode HEIC
 * either (only Safari's native <img>-tag renderer can, using the OS's
 * own codec — a capability this app's JS code has no access to). So a
 * HEIC upload's decode attempt below was silently failing on every
 * browser, including Safari, and compressImageIfNeeded was falling
 * back to uploading the raw, unconverted .heic file — which then
 * displays as a broken icon for literally anyone viewing it outside
 * Safari (i.e. any teacher/examiner on Windows, and most
 * Android/desktop browsers).
 *
 * Fixed by converting HEIC/HEIF with a dedicated, pure-JavaScript
 * decoder (heic2any, WASM-based, doesn't depend on ANY browser's
 * native codec support) before ever attempting the normal
 * canvas-based path below. Loaded on demand from a CDN, only when a
 * HEIC file is actually encountered, so nothing changes for the vast
 * majority of uploads that are already JPEG/PNG — and nothing needs
 * installing (no package.json/node_modules change) for this fix to
 * take effect.
 */
// Students on a slow/unstable mobile connection are exactly this
// app's normal case (see the file-level comment above) — a dynamic
// import() of a CDN module has no built-in timeout, so on a bad
// connection this could otherwise hang indefinitely, freezing the
// whole upload with no way out except reloading the page. Racing it
// against a plain timeout guarantees this step always either succeeds
// or fails within a few seconds, so the surrounding try/catch in
// compressImageIfNeeded can always fall back to the normal
// canvas-based attempt (or, failing that, the raw file) instead of
// hanging forever.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms
      )
    ),
  ])
}

async function convertHeicToJpeg(file) {
  const heic2any = (
    await withTimeout(
      import(
        /* @vite-ignore */
        'https://esm.sh/heic2any@0.0.4'
      ),
      8000,
      'Loading the HEIC decoder'
    )
  ).default

  const result = await withTimeout(
    heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.9,
    }),
    15000,
    'HEIC conversion'
  )

  // Resolves to an array when the source HEIC contains multiple images
  // (Live Photos/burst shots) — the first frame is the actual photo in
  // every real-world case here.
  const blob = Array.isArray(result) ? result[0] : result

  return new File(
    [blob],
    renameForCompressedOutput(file.name),
    {
      type: 'image/jpeg',
      lastModified: file.lastModified || Date.now(),
    }
  )
}

// createImageBitmap with imageOrientation:"from-image" both decodes
// AND rotates the image according to its own EXIF orientation tag.
// Skipping that option is a classic way naive compression code ends
// up handing back a portrait iPhone photo rotated sideways — the
// phone stores the sensor's raw (often landscape) pixel data plus a
// "rotate this for display" tag, and only decoders that actually
// honor that tag draw it upright.
//
// The FIRST attempt below also asks the browser to resize DURING
// decode (resizeWidth/resizeHeight/resizeFit), instead of decoding
// the full original and downscaling afterwards via canvas the way
// every earlier version of this function did. This matters a lot on
// a modern phone photo: a 12-108 megapixel original needs the browser
// to hold tens to hundreds of MB of raw decoded pixel data in memory
// just to draw a ~1920px-wide result — on a lower-end Android phone
// that's exactly the kind of spike that can crash the whole tab with
// an out-of-memory error before this function's own try/catch (below,
// in compressImageIfNeeded) ever gets a chance to run — the crash
// happens at the browser/OS level, not as a catchable JS exception.
// Where a browser supports it, decoding at roughly the target size
// from the start (Chromium can do this straight from a JPEG's own
// scaled decode path) avoids ever allocating the full-resolution
// bitmap at all. Where it isn't supported, this simply fails and
// falls through to the exact same full-decode chain this function
// already had.
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, {
        imageOrientation: 'from-image',
        resizeWidth: MAX_DIMENSION,
        resizeHeight: MAX_DIMENSION,
        resizeFit: 'contain',
        resizeQuality: 'medium',
      })
    } catch {
      // Resize-during-decode isn't supported/accepted here — fall
      // through to a plain full-resolution decode instead.
    }

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
  // browser, and always decodes at full resolution — but it's only
  // ever reached as a final fallback, and a same-orientation
  // compressed photo beats failing compression outright.
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
  if (!file || typeof file !== 'object') return file
  if (!isCompressible(file)) return file

  // Convert HEIC/HEIF to JPEG FIRST, before anything else — see
  // convertHeicToJpeg's own comment above for why this can't be left
  // to the usual canvas-based path below. Once this succeeds,
  // workingFile is a normal JPEG that every subsequent step (and every
  // future viewer) can handle, regardless of what browser uploaded it.
  let workingFile = file

  if (isHeicFile(file)) {
    try {
      workingFile = await convertHeicToJpeg(file)
    } catch (error) {
      console.error(
        'HEIC conversion failed — falling back to the normal compression attempt (which may also fail to decode it, in which case the raw file is uploaded as-is):',
        error
      )
    }
  }

  try {
    if (workingFile.size <= SKIP_BELOW_BYTES) return workingFile

    const image = await decodeImage(workingFile)
    const canvas = drawToCanvas(image)
    const blob = await compressToTargetSize(canvas)

    if (!blob || blob.size >= workingFile.size) {
      // Compression didn't actually help (can happen with an
      // already well-compressed JPEG) — keep the working file as-is
      // rather than hand back a "compressed" file that's actually
      // bigger.
      return workingFile
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
      'Image compression failed — uploading the working file instead:',
      error
    )

    // If HEIC conversion above already succeeded, workingFile is a
    // normal, universally-viewable JPEG — always prefer returning
    // that over falling all the way back to the original raw file,
    // even if this later resize/compress step failed for some reason.
    return workingFile
  }
}
