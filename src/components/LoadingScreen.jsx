/*
 * Full-screen "please wait" screen shown while the app is checking
 * who's signed in and loading their profile — this is what both
 * students and the teacher see for a moment on every fresh page
 * load, refresh, or reconnect, before their dashboard is ready.
 *
 * Hardcoded to the same light palette as the login and create-account
 * pages (not the app's dark-by-default theme tokens), so it never
 * goes near-black regardless of device theme. Styled with the actual
 * brand colors — purple, teal, coral — and his photo front and
 * center, instead of a flat white screen with a plain grey spinner.
 */
export default function LoadingScreen({
  label = 'Just a moment — getting everything ready for you…',
  // Set only when a real, timed-out or failed load needs a way out —
  // see App.jsx's Gate(). Showing a button here (instead of just
  // leaving the spinner running) is what turns a hung request into a
  // recoverable moment instead of a screen that never changes no
  // matter how many times someone reloads it.
  onRetry,
  retryLabel = 'Try again',
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-6 text-paper">
      <div className="flex flex-col items-center gap-5 text-center">
        {/* His photo inside a ring that fills with the four skill
            colours (Study room design, 2026-10-05). */}
        <div className="relative h-24 w-24">
          <div
            className="absolute inset-0 animate-spin rounded-full"
            style={{
              animationDuration: '1.6s',
              background:
                'conic-gradient(var(--color-listening) 0 25%, var(--color-reading) 0 50%, var(--color-writing) 0 75%, var(--color-speaking) 0 100%)',
              WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))',
            }}
            aria-hidden="true"
          />
          <img
            src="/mrikromov.jpg"
            alt=""
            className="absolute rounded-full object-cover"
            style={{ inset: '9px', width: 'calc(100% - 18px)', height: 'calc(100% - 18px)' }}
          />
        </div>

        <div>
          <div className="text-lg font-semibold">IELTS with Mr Ikromov</div>
          <div className="mt-1.5 max-w-[280px] text-sm text-mist" role="status">
            {label}
          </div>

          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="focus-ring mt-4 h-11 rounded-xl bg-brass px-5 text-sm font-medium text-onbrass transition-colors hover:bg-brass-dim"
            >
              {retryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
