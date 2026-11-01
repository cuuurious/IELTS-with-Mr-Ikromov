/*
 * The right side of Group chats / Chats before a chat is open
 * (redesign 2026-11-02): the soft blue panel and arch shapes of the
 * sign-in pages, a small drawn conversation, and whatever quick
 * actions the page passes in (e.g. one button per group).
 */
export default function ChatEmptyState({ title, text, children }) {
  return (
    <div className="auth-side relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-10 text-center">
      <div className="auth-arch-a pointer-events-none absolute -bottom-12 -left-14 h-[300px] w-[220px] rounded-[999px_999px_0_0]" aria-hidden="true" />
      <div className="auth-arch-b pointer-events-none absolute -right-10 -top-8 h-[260px] w-[190px] rounded-[0_0_999px_999px]" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-10 right-12 h-[100px] w-[74px] rounded-[999px_999px_0_0] border-[3px] border-b-0 border-saffron/60" aria-hidden="true" />

      <div className="relative flex w-full max-w-[300px] flex-col gap-2 rounded-[22px] bg-panel p-4 shadow-[0_14px_32px_rgba(36,86,176,0.14)]" aria-hidden="true">
        <div className="max-w-[80%] self-end rounded-[14px] rounded-br-[4px] bg-brass px-3 py-2 text-left text-[13px] font-semibold text-onbrass">
          New homework is up. Due Thursday.
        </div>
        <div className="max-w-[80%] self-start rounded-[14px] rounded-bl-[4px] bg-panel-2 px-3 py-2 text-left text-[13px] font-semibold text-paper">
          Thank you, teacher!
        </div>
        <div className="flex items-center gap-1 self-start rounded-[14px] bg-panel-2 px-3 py-2.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mist" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mist [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mist [animation-delay:300ms]" />
        </div>
      </div>

      <h2 className="relative mt-6 font-brand text-[20px] font-semibold text-paper">{title}</h2>
      <p className="relative mt-1.5 max-w-sm text-sm leading-6 text-mist">{text}</p>
      {children && <div className="relative mt-5 flex max-w-md flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}
