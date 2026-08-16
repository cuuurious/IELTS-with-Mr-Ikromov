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
  { value: 'mp3', label: 'MP3 audio', accept: '.mp3,audio/mpeg' },
  { value: 'wav', label: 'WAV audio', accept: '.wav,audio/wav' },
  { value: 'mp4', label: 'MP4 video', accept: '.mp4,video/mp4' },
  { value: 'zip', label: 'ZIP archive', accept: '.zip,application/zip' },
  { value: 'other', label: 'Other file types', accept: '*/*' },
]

export function extensionOf(name = '') {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : ''
}

export function matchesSubmissionType(file, type) {
  if (type === 'image') return file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extensionOf(file.name))
  if (type === 'other') return true
  return extensionOf(file.name) === type || (type === 'mp3' && file.type === 'audio/mpeg') || (type === 'wav' && file.type === 'audio/wav')
}

export function buildAccept(types = []) {
  if (types.includes('other') || !types.length) return ''
  return SUBMISSION_TYPE_OPTIONS.filter((o) => types.includes(o.value)).map((o) => o.accept).join(',')
}
