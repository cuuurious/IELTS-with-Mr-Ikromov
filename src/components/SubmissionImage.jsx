import { useEffect, useState } from 'react'
import Icon from './Icon'

// Student pictures are deleted from storage 5 days after they're sent
// (cleanup-submission-storage keeps the free 1 GB limit). Show that
// plainly instead of a broken-image icon (2026-10-07).
export default function SubmissionImage({ src, alt, className, removedClassName = '', ...rest }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  if (broken) {
    return (
      <span className={`flex flex-col items-center justify-center gap-1.5 p-3 text-center text-mist ${removedClassName}`}>
        <Icon name="image" className="h-6 w-6 opacity-60" />
        <span className="text-xs font-semibold text-paper-dim">Picture removed</span>
        <span className="text-[11px] leading-4">Pictures are kept for 5 days after sending</span>
      </span>
    )
  }
  return <img src={src} alt={alt} className={className} onError={() => setBroken(true)} {...rest} />
}
