export const SUBMISSION_TYPE_OPTIONS = [
  { value: 'image', label: 'Pictures / images', accept: 'image/*' },
  { value: 'pdf', label: 'PDF', accept: '.pdf,application/pdf' },
  { value: 'doc', label: 'Word (.doc)', accept: '.doc,application/msword' },
  { value: 'docx', label: 'Word (.docx)', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { value: 'xls', label: 'Excel (.xls)', accept: '.xls,application/vnd.ms-excel' },
  { value: 'xlsx', label: 'Excel (.xlsx)', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { value: 'ppt', label: 'PowerPoint (.ppt)', accept: '.ppt,application/vnd.ms-powerpoint' },
  { value: 'pptx', label: 'PowerPoint (.pptx)', accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { value: 'txt', label: 'Text (.txt)', accept: '.txt,text/plain' },
  { value: 'csv', label: 'CSV (.csv)', accept: '.csv,text/csv' },
  // Both audio options accept ANY common phone-recording format under
  // the hood (see AUDIO_EXTENSIONS/matchesSubmissionType below) — a
  // student's actual file is almost never really "just mp3" or "just
  // wav": an iPhone Voice Memo is .m4a, most Android recorders save
  // .m4a or .3gp, WhatsApp voice notes are .ogg/.opus, and a
  // browser-based recording is .webm. Keeping two checkbox values
  // (instead of collapsing to one) preserves whatever teachers already
  // have saved on existing homeworks.
  { value: 'mp3', label: 'MP3 audio', accept: 'audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.3gp,.3gpp,.amr,.webm,.flac,.wma,.wav' },
  { value: 'wav', label: 'WAV audio', accept: 'audio/*,.wav,.m4a,.aac,.ogg,.oga,.opus,.3gp,.3gpp,.amr,.webm,.flac,.wma,.mp3' },
  { value: 'mp4', label: 'MP4 video', accept: '.mp4,video/mp4' },
  { value: 'zip', label: 'ZIP archive', accept: '.zip,application/zip' },
  { value: 'other', label: 'Other file types', accept: '*/*' },
]

export function extensionOf(name = '') {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : ''
}

// heic/heif included so an iPhone photo handed over in its native
// format (rather than auto-converted to JPEG) is still recognized as
// a picture instead of being rejected outright — compressImage.js
// converts it to a universally-viewable JPEG before it's ever
// uploaded, so nothing downstream needs to know HEIC exists at all.
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'heif']

// Used to decide whether a homework/mock attachment should be shown
// inline as a picture (chart, screenshot, etc.) instead of just a
// "download this file" link.
export function isImageExtension(name = '') {
  return IMAGE_EXTENSIONS.includes(extensionOf(name))
}

export function matchesSubmissionType(file, type) {
  if (type === 'image') return file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(extensionOf(file.name))
  if (type === 'other') return true
  return extensionOf(file.name) === type || (type === 'mp3' && file.type === 'audio/mpeg') || (type === 'wav' && file.type === 'audio/wav')
}

export function buildAccept(types = []) {
  if (types.includes('other') || !types.length) return ''
  return SUBMISSION_TYPE_OPTIONS.filter((o) => types.includes(o.value)).map((o) => o.accept).join(',')
}
