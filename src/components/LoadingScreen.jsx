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
  // Same look as the sign-in pages (2026-11-02): the blue-to-turquoise
  // band, Mr Ikromov's photo in an arch, soft arch shapes behind, and a
  // saffron bar sliding along while the page loads.
  return (
    <div className="registan-band relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute -bottom-16 left-[8%] h-[360px] w-[240px] rounded-[999px_999px_0_0] bg-white/[0.07]" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-10 right-[10%] h-[300px] w-[200px] rounded-[0_0_999px_999px] bg-white/[0.07]" aria-hidden="true" />
      <div className="pointer-events-none absolute bottom-[12%] right-[22%] h-[110px] w-[80px] rounded-[999px_999px_0_0] border-[3px] border-b-0 border-saffron/70" aria-hidden="true" />

      <div className="relative flex flex-col items-center gap-6 text-center text-white">
        <div className="relative h-[150px] w-[120px]">
          <div className="absolute inset-[10px_-10px_-6px_10px] rounded-[999px_999px_18px_18px] bg-white/15" aria-hidden="true" />
          <div className="absolute inset-0 overflow-hidden rounded-[999px_999px_18px_18px] border-4 border-white bg-white/20">
            <img src="/mrikromov.jpg" alt="" className="h-full w-full object-cover" />
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="font-brand text-[22px] font-semibold">IELTS with Mr Ikromov</div>
          <div className="max-w-[300px] text-[15px] text-white/85" role="status">
            {label}
          </div>
        </div>

        {!onRetry && (
          <div className="h-1.5 w-[180px] overflow-hidden rounded-full bg-white/20" aria-hidden="true">
            <div className="loading-slide h-full w-1/3 rounded-full bg-saffron" />
          </div>
        )}

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] transition hover:brightness-105"
          >
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  )
}
