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

  return (
    <div className="min-h-screen bg-ink text-paper flex flex-col">

      <header className="border-b border-line px-5 py-4 flex items-center justify-between">

        <div className="flex items-center gap-3">
          <img
            src="/ielts.png"
            alt="IELTS with Mr Ikromov"
            className="w-10 h-10 rounded-xl object-cover"
          />

          <div>
            <div className="font-display text-lg leading-none">
              IELTS with Mr Ikromov
            </div>

            <div className="text-xs text-mist font-mono">
              {profile?.role === 'teacher'
                ? 'Examiner desk'
                : 'Candidate portal'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">

          <span className="text-sm text-mist hidden sm:inline">
            {profile?.full_name}
          </span>

          <ThemeToggle />

          <NotificationBell profile={profile} />

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="focus-ring w-9 h-9 rounded-full border border-line flex items-center justify-center text-mist hover:text-brass hover:border-brass transition-colors"
            title="Account settings"
            aria-label="Account settings"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 001-1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l-.06-.06a2 2 0 112.83 2.83l.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={signOut}
            className="focus-ring text-sm px-3 py-1.5 rounded-md border border-line hover:border-brass hover:text-brass transition-colors"
          >
            Log out
          </button>

        </div>
      </header>

      {tabs && (
        <nav className="flex gap-1 px-5 pt-4 overflow-x-auto">
          {tabs.map((t) => (
            <button
              type="button"
              key={t.key}
              onClick={() => onTabChange(t.key)}
              className={`focus-ring px-4 py-2 text-sm rounded-t-md whitespace-nowrap transition-colors ${
                activeTab === t.key
                  ? 'bg-panel text-brass border border-line border-b-0'
                  : 'text-mist hover:text-paper'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      <main className="flex-1 bg-panel border-t border-line px-5 py-6">
        <div className="max-w-5xl mx-auto">
          {children}
        </div>
      </main>

      {settingsOpen && (
        <AccountSettingsModal
          onClose={() => setSettingsOpen(false)}
        />
      )}

    </div>
  )
}