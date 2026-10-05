import { Link } from 'react-router-dom'
import SkillArt from './SkillArt'

/*
 * AUTH SHELL — one frame for Sign in, Create account, Forgot
 * password and Reset password ("Study room" design, 2026-10-05).
 *
 * Before this, each of those four pages carried its own copy of the
 * old purple/teal look (gradients, floating shapes, Gilroy) written
 * straight into the page, so they never followed the site's design.
 * Now they all share this frame and the same tokens as the rest of
 * the site: left, Mr Ikromov's school with the four IELTS skills
 * drawn in their colours; right, the form card.
 */

const SKILL_TILES = [
  { key: 'listening', label: 'Listening', tint: 'bg-listening-tint', text: 'text-listening' },
  { key: 'reading', label: 'Reading', tint: 'bg-reading-tint', text: 'text-reading' },
  { key: 'writing', label: 'Writing', tint: 'bg-writing-tint', text: 'text-writing', title: 'essay' },
  { key: 'speaking', label: 'Speaking', tint: 'bg-speaking-tint', text: 'text-speaking' },
]

export const authInputClass =
  'focus-ring mt-1.5 h-12 w-full rounded-xl border border-line bg-panel px-4 text-[15px] text-paper placeholder:text-mist outline-none transition focus:border-paper focus:ring-4 focus:ring-paper/10'

export const authPrimaryButtonClass =
  'focus-ring inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brass px-5 text-[15px] font-medium text-onbrass transition-colors hover:bg-brass-dim disabled:cursor-not-allowed disabled:opacity-60'

export function AuthField({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-paper">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-mist">{hint}</span>}
    </label>
  )
}

export function AuthNotice({ tone = 'error', children }) {
  const styles =
    tone === 'success'
      ? 'bg-reading-tint text-reading'
      : 'bg-urgent-tint text-urgent'
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${styles}`}>
      {children}
    </p>
  )
}

function InstagramIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.2 6.8h.01" />
    </svg>
  )
}

function TelegramIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 4 3 11l6 2.5L19 7l-7.5 8L18 20z" />
    </svg>
  )
}

export default function AuthShell({ title, subtitle, cardTitle, cardSubtitle, children, footer }) {
  return (
    <div className="min-h-screen bg-ink text-paper">
      <div className="mx-auto grid min-h-screen max-w-[1360px] grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
        {/* LEFT — the school */}
        <section className="flex flex-col gap-8 px-5 pb-2 pt-6 sm:px-8 lg:px-12 lg:py-10">
          <Link to="/login" className="focus-ring flex w-fit items-center gap-3 rounded-xl">
            <img src="/mrikromov.jpg" alt="" className="h-11 w-11 rounded-[13px] object-cover" />
            <span className="flex flex-col leading-tight">
              <span className="text-lg font-semibold">IELTS with Mr Ikromov</span>
              <span className="text-xs text-mist">Mr Jasur Ikromov’s IELTS school</span>
            </span>
          </Link>

          <div className="flex flex-col gap-4 lg:mt-auto">
            <h1 className="max-w-[560px] text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[44px]">
              {title}
            </h1>
            {subtitle && <p className="max-w-[520px] text-base leading-relaxed text-paper-dim sm:text-[17px]">{subtitle}</p>}
          </div>

          <div className="hidden grid-cols-2 gap-3 lg:grid" aria-hidden="true">
            {SKILL_TILES.map((tile) => (
              <div key={tile.key} className={`flex flex-col gap-1 rounded-[20px] p-4 ${tile.tint}`}>
                <div className="flex h-[92px] items-center justify-center">
                  <SkillArt skill={tile.key} title={tile.title || ''} className="h-full w-auto max-w-full" />
                </div>
                <span className={`text-sm font-semibold ${tile.text}`}>{tile.label}</span>
              </div>
            ))}
          </div>

          <div className="hidden items-center gap-3 lg:mt-auto lg:flex">
            <span className="text-sm text-mist">Follow Mr Ikromov</span>
            <a
              href="https://www.instagram.com/ustoz_jasur/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Mr Ikromov on Instagram"
              className="focus-ring flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel text-paper hover:bg-panel-2"
            >
              <InstagramIcon />
            </a>
            <a
              href="https://t.me/TeamMrIkromov"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Mr Ikromov on Telegram"
              className="focus-ring flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel text-paper hover:bg-panel-2"
            >
              <TelegramIcon />
            </a>
          </div>
        </section>

        {/* RIGHT — the form */}
        <section className="flex items-start justify-center px-4 pb-10 pt-4 sm:px-8 lg:items-center lg:py-10">
          <div className="w-full max-w-[460px] overflow-hidden rounded-[22px] border border-line bg-panel">
            {(cardTitle || cardSubtitle) && (
              <div className="px-6 pb-2 pt-7 sm:px-8">
                {cardTitle && <h2 className="text-[26px] font-semibold tracking-[-0.02em]">{cardTitle}</h2>}
                {cardSubtitle && <p className="mt-1.5 text-[15px] leading-relaxed text-mist">{cardSubtitle}</p>}
              </div>
            )}
            <div className="px-6 pb-7 pt-4 sm:px-8">{children}</div>
            {footer && <div className="border-t border-line bg-panel-2 px-6 py-4 text-center text-sm text-paper-dim sm:px-8">{footer}</div>}
          </div>
        </section>
      </div>
    </div>
  )
}
