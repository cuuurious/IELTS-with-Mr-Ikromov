// The browser's reported file.type is sometimes empty or wrong (varies by
// OS/browser), which made .html attachments get stored with the wrong
// Content-Type and show as raw source instead of rendering. This maps by
// extension as a reliable fallback.
const MIME_MAP = {
  html: 'text/html',
  htm: 'text/html',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  weba: 'audio/webm',
  flac: 'audio/flac',
  wma: 'audio/x-ms-wma',
  amr: 'audio/amr',
  '3gp': 'audio/3gpp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
}

export function guessMimeType(filename, browserReportedType) {
  const ext = filename?.split('.').pop()?.toLowerCase()
  return MIME_MAP[ext] || browserReportedType || 'application/octet-stream'
}
