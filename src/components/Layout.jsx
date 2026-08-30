import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from './ThemeToggle'
import NotificationBell from './NotificationBell'
import AccountSettingsModal from './AccountSettingsModal'

export default function Layout({
  tabs,
  activeTab,
  onTabChange,
  children,
}) {
  const { profile, signOut } = useAuth()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const isTeacher = profile?.role === 'teacher'

  return (
    <div className="min-h-screen bg-ink text-paper flex flex-col">

      {/* =====================================================
          HEADER
      ===================================================== */}

      <header className="sticky top-0 z-40 border-b border-line bg-ink/95 backdrop-blur-md">

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">

          <div className="h-[76px] flex items-center justify-between gap-4">

            {/* BRAND */}

            <div className="flex items-center gap-3 min-w-0">

              <div className="relative shrink-0">
                <img
                  src="/mrikromov.jpg"
                  alt="IELTS with Mr Ikromov"
                  className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl object-cover object-center border border-line shadow-sm"
                />

                <span className="absolute -right-1 -bottom-1 w-3 h-3 rounded-full bg-sage border-2 border-ink" />
              </div>

              <div className="min-w-0">

                <div className="font-display text-[17px] sm:text-[19px] leading-tight font-semibold tracking-tight truncate">
                  IELTS with Mr Ikromov
                </div>

                <div className="text-[10px] sm:text-[11px] text-mist font-mono uppercase tracking-[0.12em] mt-0.5">
                  {isTeacher
                    ? 'Examiner desk'
                    : 'Candidate portal'}
                </div>

              </div>

            </div>

            {/* RIGHT CONTROLS */}

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

              <span className="hidden lg:block text-sm text-mist mr-2 max-w-[180px] truncate">
                {profile?.full_name}
              </span>

              <ThemeToggle />

              <NotificationBell profile={profile} />

              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="focus-ring w-9 h-9 rounded-full border border-line bg-panel/40 flex items-center justify-center text-mist hover:text-brass hover:border-brass hover:bg-panel transition-all duration-200"
                title="Account settings"
                aria-label="Account settings"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1.51 1v.09a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              </button>

              <button
                type="button"
                onClick={signOut}
                className="focus-ring hidden sm:inline-flex items-center justify-center h-9 px-3.5 rounded-lg border border-line bg-panel/30 text-sm text-paper-dim hover:text-brass hover:border-brass hover:bg-panel transition-all duration-200"
              >
                Log out
              </button>

            </div>

          </div>

        </div>

      </header>


      {/* =====================================================
          NAVIGATION
      ===================================================== */}

      {tabs && (
        <nav className="sticky top-[76px] z-30 border-b border-line bg-ink/90 backdrop-blur-md">

          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">

            <div className="flex items-center gap-1 overflow-x-auto py-2 scrollbar-none">

              {tabs.map((t) => {
                const active = activeTab === t.key

                return (
                  <button
                    type="button"
                    key={t.key}
                    onClick={() => onTabChange(t.key)}
                    className={`focus-ring relative shrink-0 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200 ${
                      active
                        ? 'bg-panel-2 text-brass shadow-sm'
                        : 'text-mist hover:text-paper hover:bg-panel/60'
                    }`}
                  >
                    {t.label}

                    {active && (
                      <span className="absolute left-3 right-3 -bottom-[9px] h-0.5 rounded-full bg-brass" />
                    )}
                  </button>
                )
              })}

            </div>

          </div>

        </nav>
      )}


      {/* =====================================================
          MAIN CONTENT
      ===================================================== */}

      <main className="flex-1">

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

          <div className="animate-fade-up">
            {children}
          </div>

        </div>

      </main>


      {/* =====================================================
          ACCOUNT SETTINGS
      ===================================================== */}

      {settingsOpen && (
        <AccountSettingsModal
          onClose={() => setSettingsOpen(false)}
        />
      )}

    </div>
  )
}