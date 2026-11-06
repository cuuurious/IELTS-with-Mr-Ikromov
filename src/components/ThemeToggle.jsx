import { useEffect, useState } from 'react'

const STORAGE_KEY = 'ielts-mrikromov-theme'

// Storage can be blocked (strict privacy settings, some in-app browsers);
// reading it then throws and used to crash the whole page (Errors page,
// 2026-11-05). Fall back to the device's light/dark setting.
function readSaved() {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function getInitialTheme() {
  const saved = readSaved()
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* storage blocked: the theme just isn't remembered */
    }
  }, [theme])

  return (
    <button
      onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      className="focus-ring w-9 h-9 rounded-[10px] border border-line bg-panel-2 flex items-center justify-center shrink-0 hover:border-brass/40 transition-colors"
      title={theme === 'dark' ? 'Switch to day mode' : 'Switch to night mode'}
      aria-label="Toggle day/night mode"
    >
      {theme === 'dark' ? (
        // Switching TO day mode — a warm amber sun, not a flat gray
        // glyph, so the icon itself carries a little of the mode
        // it's offering instead of every top-bar icon reading the
        // same neutral color.
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber transition-colors group-hover:brightness-110">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        // Switching TO night mode — the app's brand lavender rather
        // than gray, echoing the dark theme's own accent color.
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-lavender">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  )
}
