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
}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at 75% 15%, rgba(113,104,255,0.16), transparent 30%), radial-gradient(circle at 12% 85%, rgba(69,214,208,0.10), transparent 28%), linear-gradient(135deg, #F7F8FC 0%, #EEF0FA 48%, #F9F9FC 100%)',
        fontFamily:
          "'Gilroy', 'Product Sans', 'Manrope', 'Inter', system-ui, sans-serif",
      }}
    >

      {/* Floating brand-colored shapes, echoing the login page */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-24 -right-16 w-72 h-72 rounded-[80px] rotate-[18deg] blur-[2px]"
          style={{
            background: 'linear-gradient(135deg, rgba(108,99,255,0.14), rgba(155,156,255,0.03))',
            border: '1px solid rgba(108,99,255,0.08)',
          }}
        />
        <div
          className="absolute bottom-[-4rem] left-[-3rem] w-56 h-56 rounded-[70px] rotate-[-16deg]"
          style={{ background: 'linear-gradient(145deg, rgba(103,226,219,0.20), rgba(58,203,194,0.05))' }}
        />
        <div
          className="absolute top-[8%] left-[8%] w-16 h-16 rounded-[20px] rotate-[-14deg] hidden sm:block"
          style={{
            background: 'linear-gradient(145deg, #FF9A95, #FF7770)',
            boxShadow: '0 16px 40px rgba(255,107,95,0.18)',
            opacity: 0.85,
          }}
        />
        <div
          className="absolute bottom-[12%] right-[10%] w-12 h-12 rounded-[16px] rotate-[20deg] hidden sm:block"
          style={{
            background: 'linear-gradient(145deg, #918BFF, #6258E8)',
            boxShadow: '0 14px 35px rgba(91,82,220,0.2)',
            opacity: 0.9,
          }}
        />
      </div>

      <div className="flex flex-col items-center gap-5 text-center relative z-10">

        {/* Spinning color halo around his photo */}
        <div className="relative w-24 h-24">
          <div
            className="absolute inset-0 rounded-full animate-spin"
            style={{
              animationDuration: '1.4s',
              background:
                'conic-gradient(from 0deg, #6C63FF, #45D6D0, #FF9A95, #6C63FF)',
              WebkitMask:
                'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))',
              mask:
                'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))',
            }}
          />

          <img
            src="/ielts.png"
            alt=""
            className="absolute rounded-full object-cover"
            style={{ inset: '9px', width: 'calc(100% - 18px)', height: 'calc(100% - 18px)' }}
          />
        </div>

        <div>
          <div className="font-display text-lg text-[#171A31]">
            IELTS with Mr Ikromov
          </div>

          <div className="mt-1.5 text-sm text-[#747A91] max-w-[260px]">
            {label}
          </div>
        </div>

      </div>
    </div>
  )
}
