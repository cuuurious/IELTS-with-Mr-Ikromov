/*
 * Full-screen "please wait" screen shown while the app is checking
 * who's signed in and loading their profile — this is what both
 * students and the teacher see for a moment on every fresh page
 * load, refresh, or reconnect, before their dashboard is ready.
 *
 * This replaces a bare "Loading…" on a plain, unstyled dark box.
 * In the app's default theme (dark, unless someone has switched to
 * light), that box was near-black with barely-visible grey text —
 * it read as a stray broken window, not part of the app. This
 * version pulls its colors from the same light/dark theme tokens
 * as everywhere else, so it always looks like a deliberate part of
 * the app, and adds the app's own name plus a small spinner so it's
 * obvious something is actively happening rather than stuck.
 */
export default function LoadingScreen({
  label = 'Getting your classroom ready…',
}) {
  return (
    <div className="min-h-screen bg-ink flex items-center justify-center px-6">
      <div className="flex flex-col items-center gap-4 text-center">

        <svg
          viewBox="0 0 64 64"
          className="w-14 h-14 animate-spin"
          style={{ animationDuration: '900ms' }}
          role="status"
          aria-label="Loading"
        >
          <circle
            cx="32"
            cy="32"
            r="26"
            fill="none"
            stroke="var(--color-panel-2)"
            strokeWidth="5"
          />

          <circle
            cx="32"
            cy="32"
            r="26"
            fill="none"
            stroke="var(--color-brass)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="46 200"
          />
        </svg>

        <div>
          <div className="font-display text-lg text-paper">
            IELTS with Mr Ikromov
          </div>

          <div className="mt-1 text-xs font-mono text-mist tracking-wide">
            {label}
          </div>
        </div>

      </div>
    </div>
  )
}
