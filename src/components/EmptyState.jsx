/*
 * A friendly empty state (2026-11-02): the soft blue panel with arch
 * shapes, a small drawn card and one short line — instead of a dashed
 * box with grey text.
 */
const ICONS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 14.5A5 5 0 0 1 21 19" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
}

export default function EmptyState({ icon = 'check', title, text, children }) {
  return (
    <div className="auth-side relative flex flex-col items-center overflow-hidden rounded-[24px] px-6 py-12 text-center">
      <div className="auth-arch-a pointer-events-none absolute -bottom-12 -left-12 h-[220px] w-[160px] rounded-[999px_999px_0_0]" aria-hidden="true" />
      <div className="auth-arch-b pointer-events-none absolute -right-8 -top-8 h-[180px] w-[130px] rounded-[0_0_999px_999px]" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-6 right-16 h-[70px] w-[52px] rounded-[999px_999px_0_0] border-[3px] border-b-0 border-saffron/60" aria-hidden="true" />
      <div className="relative grid h-20 w-20 place-items-center rounded-[24px] bg-panel shadow-[0_12px_28px_rgba(36,86,176,0.16)]" aria-hidden="true">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,#2456b0,#1a9bb5)] text-white">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{ICONS[icon]}</svg>
        </span>
      </div>
      <h2 className="relative mt-5 font-brand text-[20px] font-semibold text-paper">{title}</h2>
      {text && <p className="relative mt-1.5 max-w-sm text-sm leading-6 text-mist">{text}</p>}
      {children && <div className="relative mt-4">{children}</div>}
    </div>
  )
}
