// PARENT PROGRESS REPORT — PDF version (2026-10-02).
//
// Same data as the /report/<token> page (get_parent_report), laid out
// as a one-page A4 PDF a parent can save, print or forward. Built in the
// browser with jsPDF, loaded on demand from a CDN — the same approach as
// the teacher's mock score report (generateScoreReport.js).
//
// jsPDF's built-in Helvetica only has Western European letters, so
// Cyrillic is transliterated and Uzbek apostrophes (oʻ, gʻ) become a
// plain ' — otherwise they print as garbage.

let jsPDFModulePromise = null
function loadJsPDF() {
  if (!jsPDFModulePromise) {
    jsPDFModulePromise = Promise.race([
      import(/* @vite-ignore */ 'https://esm.sh/jspdf@2.5.2'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Loading the PDF maker timed out — check the internet connection and try again.')), 20000)
      ),
    ]).catch((err) => {
      jsPDFModulePromise = null // allow a retry
      throw err
    })
  }
  return jsPDFModulePromise
}

const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: "'", ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
}

export function pdfSafe(value) {
  return String(value ?? '')
    .replace(/[ʻʼ‘’`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[Ѐ-ӿ]/g, (ch) => {
      const lower = ch.toLowerCase()
      const t = CYRILLIC[lower]
      if (t === undefined) return ''
      return ch === lower ? t : t.charAt(0).toUpperCase() + t.slice(1)
    })
    // anything else outside Latin-1 (emoji etc.) is dropped
    .replace(/[^\u0000-ÿ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATE = {
  done: { text: 'Done', color: [46, 125, 80] },
  late: { text: 'Done late', color: [176, 120, 20] },
  missed: { text: 'Not done', color: [190, 55, 55] },
  open: { text: 'In progress', color: [110, 110, 120] },
}

const INK = [28, 28, 34]
const MUTED = [120, 120, 130]
const LINE = [222, 222, 228]
const ACCENT = [109, 84, 196]

export async function buildParentReportPdf(report, { jsPDF: injected } = {}) {
  const jsPDF = injected || (await loadJsPDF()).jsPDF
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 44
  let y = 56

  const { student = {}, groups = [], homework = {}, words = {}, mocks = {} } = report || {}
  const name = pdfSafe(student.full_name) || 'Student'

  const text = (value, x, yy, opts = {}) => {
    const { size = 10, bold = false, color = INK, align } = opts
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    doc.text(value, x, yy, align ? { align } : undefined)
  }

  const ensureSpace = (needed) => {
    if (y + needed > H - 60) {
      doc.addPage()
      y = 56
    }
  }

  // Header band
  doc.setFillColor(...ACCENT)
  doc.rect(0, 0, W, 6, 'F')
  text('IELTS WITH MR IKROMOV', M, y - 16, { size: 8, bold: true, color: ACCENT })
  text('Progress report', W - M, y - 16, { size: 8, color: MUTED, align: 'right' })

  y += 8
  text(name, M, y, { size: 22, bold: true })
  y += 18
  const sub = [
    groups.length ? `Group ${groups.map(pdfSafe).join(', ')}` : null,
    student.target_band ? `Target band ${Number(student.target_band).toFixed(1)}` : null,
    `Report date ${formatDate(report?.generated_at || Date.now())}`,
  ].filter(Boolean).join('   |   ')
  text(sub, M, y, { size: 10, color: MUTED })

  // Stat boxes
  const statRow = (items) => {
    const gap = 10
    const boxW = (W - M * 2 - gap * (items.length - 1)) / items.length
    const boxH = 58
    ensureSpace(boxH + 10)
    items.forEach((item, i) => {
      const x = M + i * (boxW + gap)
      doc.setDrawColor(...LINE)
      doc.setFillColor(248, 247, 252)
      doc.roundedRect(x, y, boxW, boxH, 6, 6, 'FD')
      text(item.label.toUpperCase(), x + 10, y + 15, { size: 7, bold: true, color: MUTED })
      text(String(item.value), x + 10, y + 38, { size: 18, bold: true, color: item.color || INK })
      if (item.hint) text(item.hint, x + 10, y + 50, { size: 7, color: MUTED })
    })
    y += boxH + 12
  }

  const section = (title) => {
    ensureSpace(40)
    y += 14
    text(title, M, y, { size: 13, bold: true })
    y += 6
    doc.setDrawColor(...LINE)
    doc.line(M, y, W - M, y)
    y += 12
  }

  // Homework
  const assigned = homework.assigned || 0
  const done = homework.done || 0
  const late = homework.late || 0
  const rate = assigned ? Math.round((done / assigned) * 100) : null
  y += 16
  section('Homework - last 60 days')
  statRow([
    { label: 'Completed', value: rate === null ? '-' : `${rate}%`, hint: `${done} of ${assigned} homework` },
    { label: 'On time', value: Math.max(done - late, 0) },
    { label: 'Late', value: late, color: late ? STATE.late.color : INK },
    { label: 'Not done', value: homework.missed || 0, hint: 'past the deadline', color: homework.missed ? STATE.missed.color : INK },
  ])

  const recent = homework.recent || []
  if (recent.length) {
    ensureSpace(30)
    const colTitle = M
    const colSet = W - M - 230
    const colDue = W - M - 150
    const colState = W - M
    text('HOMEWORK', colTitle, y + 4, { size: 7, bold: true, color: MUTED })
    text('SET', colSet, y + 4, { size: 7, bold: true, color: MUTED })
    text('DUE', colDue, y + 4, { size: 7, bold: true, color: MUTED })
    text('STATUS', colState, y + 4, { size: 7, bold: true, color: MUTED, align: 'right' })
    y += 12
    recent.forEach((hw) => {
      ensureSpace(20)
      const state = STATE[hw.state] || STATE.open
      doc.setDrawColor(...LINE)
      doc.line(M, y, W - M, y)
      y += 13
      let title = pdfSafe(hw.title) || 'Homework'
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      const maxW = colSet - colTitle - 12
      while (title.length > 4 && doc.getTextWidth(title) > maxW) title = `${title.slice(0, -4)}...`
      text(title, colTitle, y, { size: 9.5 })
      text(formatDate(hw.created_at).replace(/ \d{4}$/, ''), colSet, y, { size: 9, color: MUTED })
      text(hw.due_date ? formatDate(hw.due_date).replace(/ \d{4}$/, '') : '-', colDue, y, { size: 9, color: MUTED })
      text(state.text, colState, y, { size: 9, bold: true, color: state.color, align: 'right' })
      y += 6
    })
    doc.setDrawColor(...LINE)
    doc.line(M, y, W - M, y)
    y += 6
  }

  // Vocabulary
  section('Vocabulary')
  statRow([
    { label: 'Words learned', value: words.words_learned || 0, hint: `of ${words.words_practised || 0} practised` },
    { label: 'Quizzes (30 days)', value: (words.quizzes_30d || 0) + (words.reviews_30d || 0) },
    { label: 'Average score', value: words.avg_score_30d != null ? `${words.avg_score_30d}%` : '-', hint: 'last 30 days' },
  ])

  // Mocks
  const mockItems = [
    ['Listening', mocks.listening],
    ['Reading', mocks.reading],
    ['Writing', mocks.writing],
    ['Speaking', mocks.speaking],
  ].filter(([, band]) => band !== null && band !== undefined)
  if (mockItems.length) {
    section('Latest mock exam results')
    statRow(mockItems.map(([label, band]) => ({ label, value: Number(band).toFixed(1), hint: 'band' })))
  }

  // Footer on every page
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...LINE)
    doc.line(M, H - 40, W - M, H - 40)
    text('IELTS with Mr Ikromov  |  ieltswithmrikromov.com  |  Questions? Contact the teacher directly.', M, H - 26, { size: 7.5, color: MUTED })
    if (pages > 1) text(`${p} / ${pages}`, W - M, H - 26, { size: 7.5, color: MUTED, align: 'right' })
  }

  const fileName = `${(name || 'student').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'student'}-progress-report.pdf`
  return { doc, fileName }
}

export async function downloadParentReport(report) {
  const { doc, fileName } = await buildParentReportPdf(report)
  // Telegram's in-app browser ignores normal downloads — open the PDF
  // in a new tab there instead so it can be viewed / shared.
  if (/Telegram/i.test(navigator.userAgent)) {
    const url = doc.output('bloburl')
    window.open(url, '_blank') || (window.location.href = url)
    return
  }
  doc.save(fileName)
}
