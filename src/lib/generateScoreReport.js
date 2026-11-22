// Mock "Test Report Form"-style score report (PDF or PNG) combining a
// student's most recent Listening, Reading, Writing and Speaking results.
//
// Look: a plain report form (candidate details + photo, one row of band
// boxes, overall band, CEFR level, comments) in the site's own brand.
// It is clearly marked "Mock test, not an official IELTS result" and carries
// no IELTS / British Council / IDP marks.
//
// Reading/Listening bands are ESTIMATED from the raw percentage (see
// ieltsBands.js) and the form says so; Writing/Speaking bands are the
// human examiner's band as given. The report is drawn as a hidden DOM block
// and captured with html2canvas, then wrapped in a PDF with jsPDF. Both
// libraries load on demand from esm.sh, like the other lazy libraries here.

import { roundOverallBand, formatBand } from './ieltsBands'

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out. Check your connection and try again.`)), ms)
    ),
  ])
}

let jsPDFModulePromise = null
function loadJsPDF() {
  if (!jsPDFModulePromise) {
    jsPDFModulePromise = withTimeout(import('https://esm.sh/jspdf@2.5.2'), 20000, 'Loading the PDF library')
  }
  return jsPDFModulePromise
}

let html2canvasPromise = null
function loadHtml2Canvas() {
  if (!html2canvasPromise) {
    html2canvasPromise = withTimeout(
      import('https://esm.sh/html2canvas@1.4.1'),
      20000,
      'Loading the image library'
    ).then((m) => m.default || m)
  }
  return html2canvasPromise
}

async function ensureFonts() {
  const id = 'score-report-fonts'
  if (!document.getElementById(id)) {
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href =
      'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700;800&family=Unbounded:wght@500;600;700&display=swap'
    document.head.appendChild(link)
  }
  try {
    await withTimeout(
      Promise.all([
        document.fonts.load('700 20px Unbounded'),
        document.fonts.load('600 16px Unbounded'),
        document.fonts.load('700 14px "Nunito Sans"'),
        document.fonts.load('800 12px "Nunito Sans"'),
      ]),
      8000,
      'Loading fonts'
    )
  } catch {
    /* fall back to system fonts rather than failing the download */
  }
}

// The photo is fetched ourselves and inlined as a data URL, so the capture
// never taints the canvas. Any failure just means initials are shown.
async function photoDataUrl(url) {
  if (!url) return null
  try {
    const res = await withTimeout(fetch(url, { mode: 'cors' }), 8000, 'Loading the photo')
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve) => {
      const r = new FileReader()
      r.onloadend = () => resolve(typeof r.result === 'string' ? r.result : null)
      r.onerror = () => resolve(null)
      r.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export function cefrForBand(band) {
  const b = Number(band)
  if (!Number.isFinite(b)) return null
  if (b >= 8.5) return 'C2'
  if (b >= 7) return 'C1'
  if (b >= 5.5) return 'B2'
  if (b >= 4) return 'B1'
  if (b >= 3) return 'A2'
  return 'A1'
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const initialsOf = (name) =>
  String(name || 'S')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || 'S'

function buildHtml({ studentName, targetBand, skills, overall, photo, issued, testLabel, estimated }) {
  const U = "font-family:Unbounded,sans-serif;"
  const lab = 'font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#55607a;'
  const field = (l, v, span = 1) =>
    `<div style="grid-column:span ${span};border-bottom:1px solid #b9c5e0;padding:7px 0 6px"><div style="${lab}">${l}</div><div style="font-size:16px;font-weight:700;margin-top:3px">${esc(v)}</div></div>`
  const colours = { listening: '#1f4e8c', reading: '#0f6b66', writing: '#8a4d1f', speaking: '#6a3f99' }
  const tile = (key, name) => {
    const info = skills?.[key]
    return `<div style="flex:1;border:1px solid #9fb0d6;background:#fff;border-radius:6px;padding:26px 8px;text-align:center"><div style="${lab}color:${colours[key]};">${name}</div><div style="${U}font-weight:700;font-size:46px;margin-top:10px">${info ? esc(formatBand(info.band)) : '—'}</div></div>`
  }
  const cefr = cefrForBand(overall)
  const photoBox = photo
    ? `<div style="width:130px;height:160px;border:1px solid #9fb0d6;background:#eef2fa url('${photo}') center/cover no-repeat"></div>`
    : `<div style="width:130px;height:160px;border:1px solid #9fb0d6;background:#e4ebf8;display:flex;align-items:center;justify-content:center;${U}font-weight:700;font-size:40px;color:#22489a">${esc(initialsOf(studentName))}</div>`
  const note = estimated
    ? 'Listening and Reading bands are estimated from the raw percentage and are not an official result. Writing and Speaking bands are given by a human examiner.'
    : 'Band scale 0 to 9. The overall band score is the average of the four modules, rounded to the nearest half band.'
  return `<div style="position:relative;width:794px;height:1123px;box-sizing:border-box;background:#fff;font-family:'Nunito Sans',Arial,sans-serif;color:#17213a;display:flex;flex-direction:column">
<div style="background:linear-gradient(120deg,#22489a,#1a6a8a 70%,#13807c);color:#fff;padding:34px 52px 30px;display:flex;justify-content:space-between;align-items:center">
<div style="display:flex;align-items:center;gap:12px"><div style="width:48px;height:48px;border-radius:12px;background:#fff;color:#22489a;display:flex;align-items:center;justify-content:center;${U}font-weight:700;font-size:17px">MI</div><div style="display:flex;flex-direction:column;gap:3px"><span style="${U}font-weight:600;font-size:16px">MrIkromov's IELTS</span><span style="${lab}color:#dfe8fb;">Mock Test Centre</span></div></div>
<div style="text-align:right"><div style="${U}font-weight:700;font-size:26px">Test Report Form</div><div style="${U}font-weight:600;font-size:14px;letter-spacing:.2em;color:#ffd27a;margin-top:6px">ACADEMIC</div></div></div>
<div style="flex:1;padding:30px 52px 36px;display:flex;flex-direction:column;justify-content:space-between">
<div><span style="font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#6f4608;background:#fdf3df;border:1px solid #c8932f;border-radius:10px;padding:5px 10px">Mock test · Not an official IELTS result</span></div>
<div style="display:flex;gap:28px;align-items:flex-start"><div style="flex:1;display:grid;grid-template-columns:1fr 1fr;column-gap:24px">${field('Candidate name', studentName || 'Student', 2)}${field('Test date', issued)}${field('Target band', targetBand != null ? formatBand(targetBand) : '—')}${field('Test', testLabel, 2)}</div>${photoBox}</div>
<div><div style="${lab}color:#22489a;margin-bottom:10px">Test results</div>
<div style="display:flex;gap:10px">${tile('listening', 'Listening')}${tile('reading', 'Reading')}${tile('writing', 'Writing')}${tile('speaking', 'Speaking')}<div style="flex:1.15;border:2px solid #22489a;background:#22489a;color:#fff;border-radius:6px;padding:26px 8px;text-align:center"><div style="${lab}color:#dfe8fb;">Overall band</div><div style="${U}font-weight:700;font-size:46px;margin-top:10px;color:#ffd27a">${overall != null ? esc(formatBand(overall)) : '—'}</div></div></div>
<div style="display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:12px"><span style="${lab}">CEFR level</span><span style="${U}font-weight:700;font-size:20px;color:#22489a;border:2px solid #22489a;border-radius:8px;padding:4px 14px">${cefr || '—'}</span></div>
<div style="font-size:12px;font-weight:600;color:#55607a;margin-top:10px;line-height:1.5">${note}</div></div>
<div style="border:1px solid #b9c5e0;border-radius:6px;min-height:90px;padding:12px"><div style="${lab}margin-bottom:6px">Administrator comments</div></div>
<div style="display:flex;justify-content:space-between;align-items:center;border-top:2px solid #22489a;padding-top:10px;font-size:12px;font-weight:700;color:#3a4560"><span>Issued ${esc(issued)}</span><span>ieltswithmrikromov.com</span></div>
</div></div>`
}

/*
 * skills: { listening, reading, writing, speaking }, each null (no result
 * yet) or { band, note, estimated? }. format: 'pdf' (default) or 'png'.
 * avatarUrl: the student's profile photo, optional.
 */
export async function downloadScoreReport({
  studentName,
  targetBand,
  skills,
  avatarUrl,
  testLabel = 'Mock Test · IELTS Academic',
  format = 'pdf',
}) {
  const [html2canvas] = await Promise.all([loadHtml2Canvas(), ensureFonts()])
  const photo = await photoDataUrl(avatarUrl)

  const keys = ['listening', 'reading', 'writing', 'speaking']
  const bands = keys.map((k) => skills?.[k]?.band).filter((b) => b != null)
  const overall =
    bands.length === 4 ? roundOverallBand(bands.reduce((s, b) => s + Number(b), 0) / 4) : null
  const estimated = Boolean(skills?.listening || skills?.reading)
  // English month names always: some computers' own date text has Cyrillic.
  const issued = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })

  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;pointer-events:none'
  host.innerHTML = buildHtml({ studentName, targetBand, skills, overall, photo, issued, testLabel, estimated })
  document.body.appendChild(host)
  let canvas
  try {
    canvas = await html2canvas(host.firstElementChild, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    })
  } finally {
    document.body.removeChild(host)
  }

  const safeName = (studentName || 'student').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  if (format === 'png') {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${safeName}-ielts-mock-report.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    return
  }
  const { jsPDF } = await loadJsPDF()
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight())
  doc.save(`${safeName}-ielts-mock-score-report.pdf`)
}
