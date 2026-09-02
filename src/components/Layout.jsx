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
    <div
      className="
        min-h-screen
        flex flex-col
        text-paper
        bg-ink
        relative
        overflow-x-hidden
      "
    >

      {/* =====================================================
          DECORATIVE BACKGROUND
          ===================================================== */}

      <div
        aria-hidden="true"
        className="
          pointer-events-none
          fixed inset-0
          overflow-hidden
          -z-0
        "
      >

        {/* Large lavender glow */}
        <div
          className="
            absolute
            -top-56
            right-[-10rem]
            w-[38rem]
            h-[38rem]
            rounded-full
            bg-indigo/10
            blur-3xl
          "
        />

        {/* Cyan glow */}
        <div
          className="
            absolute
            bottom-[-15rem]
            left-[-12rem]
            w-[34rem]
            h-[34rem]
            rounded-full
            bg-cyan/10
            blur-3xl
          "
        />

        {/* Soft angled line */}
        <div
          className="
            absolute
            top-[24rem]
            -left-[10rem]
            w-[75rem]
            h-[1px]
            bg-indigo/10
            rotate-[-17deg]
          "
        />

        {/* Floating rounded square */}
        <div
          className="
            absolute
            top-[9rem]
            right-[7%]
            w-20
            h-20
            rounded-[1.5rem]
            bg-gradient-to-br
            from-indigo/20
            to-lavender/10
            rotate-[14deg]
            blur-[0.2px]
          "
        />

        {/* Floating cyan shape */}
        <div
          className="
            absolute
            bottom-[10rem]
            left-[4%]
            w-14
            h-14
            rounded-[1.1rem]
            bg-cyan/20
            rotate-[-18deg]
          "
        />

        {/* Floating coral shape */}
        <div
          className="
            absolute
            bottom-[5rem]
            right-[5%]
            w-16
            h-16
            rounded-[1.2rem]
            bg-coral/15
            rotate-[20deg]
          "
        />

      </div>


      {/* =====================================================
          HEADER
          ===================================================== */}

      <header
        className="
          sticky top-0 z-40
          border-b border-line
          bg-panel/80
          backdrop-blur-xl
        "
      >

        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">

          <div className="h-[76px] flex items-center justify-between gap-4">

            {/* BRAND */}

            <div className="flex items-center gap-3 min-w-0">

              <div className="relative shrink-0">

                <img
                  src="/mrikromov.jpg"
                  alt="IELTS with Mr Ikromov"
                  className="
                    w-11 h-11
                    sm:w-12 sm:h-12
                    rounded-[1rem]
                    object-cover
                    object-center
                    border border-panel
                    shadow-[0_8px_25px_rgba(30,35,70,0.12)]
                  "
                />

                <span
                  className="
                    absolute
                    -right-1
                    -bottom-1
                    w-3
                    h-3
                    rounded-full
                    bg-sage
                    border-2
                    border-panel
                  "
                />

              </div>

              <div className="min-w-0">

                <div
                  className="
                    text-[17px]
                    sm:text-[19px]
                    leading-tight
                    font-semibold
                    tracking-[-0.02em]
                    text-paper
                    truncate
                  "
                >
                  IELTS with Mr Ikromov
                </div>

                <div
                  className="
                    text-[10px]
                    sm:text-[11px]
                    text-mist
                    font-mono
                    uppercase
                    tracking-[0.14em]
                    mt-0.5
                  "
                >
                  {isTeacher
                    ? 'Examiner desk'
                    : 'Candidate portal'}
                </div>

              </div>

            </div>


            {/* RIGHT CONTROLS */}

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

              <span
                className="
                  hidden
                  lg:block
                  text-sm
                  text-mist
                  mr-1
                  max-w-[180px]
                  truncate
                "
              >
                {profile?.full_name}
              </span>


              {/* Theme */}

              <div
                className="
                  rounded-full
                  border border-line
                  bg-panel/80
                  shadow-sm
                "
              >
                <ThemeToggle />
              </div>


              {/* Notifications */}

              <div
                className="
                  rounded-full
                  border border-line
                  bg-panel/80
                  shadow-sm
                "
              >
                <NotificationBell profile={profile} />
              </div>


              {/* Settings */}

              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="
                  focus-ring
                  w-9 h-9
                  rounded-full
                  border border-line
                  bg-panel/80
                  flex items-center justify-center
                  text-mist
                  hover:text-brass
                  hover:border-brass/50
                  hover:bg-brass/10
                  hover:shadow-[0_6px_20px_rgba(99,87,232,0.12)]
                  transition-all
                  duration-200
                "
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
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1.51 1v.09a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>

              </button>


              {/* Logout */}

              <button
                type="button"
                onClick={signOut}
                className="
                  focus-ring
                  hidden sm:inline-flex
                  items-center justify-center
                  h-9
                  px-3.5
                  rounded-[0.7rem]
                  border border-line
                  bg-panel/80
                  text-sm
                  font-medium
                  text-mist
                  hover:text-brass
                  hover:border-brass/50
                  hover:bg-brass/10
                  transition-all
                  duration-200
                "
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

        <nav
          className="
            sticky
            top-[76px]
            z-30
            px-3
            pt-3
          "
        >

          <div className="max-w-[1440px] mx-auto">

            <div
              className="
                inline-flex
                max-w-full
                items-center
                gap-1
                overflow-x-auto
                rounded-[1.15rem]
                border border-line
                bg-panel/75
                backdrop-blur-xl
                p-1.5
                shadow-[0_10px_35px_rgba(0,0,0,0.12)]
                scrollbar-none
              "
            >

              {tabs.map((t) => {

                const active =
                  activeTab === t.key

                return (

                  <button
                    type="button"
                    key={t.key}
                    onClick={() =>
                      onTabChange(t.key)
                    }
                    className={`
                      focus-ring
                      relative
                      shrink-0
                      px-4
                      py-2.5
                      rounded-[0.85rem]
                      text-sm
                      font-semibold
                      whitespace-nowrap
                      transition-all
                      duration-200

                      ${
                        active
                          ? `
                            text-onbrass
                            bg-gradient-to-r
                            from-brass
                            to-lavender
                            shadow-[0_7px_18px_rgba(101,89,236,0.25)]
                          `
                          : `
                            text-mist
                            hover:text-paper
                            hover:bg-panel-2
                          `
                      }
                    `}
                  >
                    {t.label}

                    {/* Notification count for approvals */}

                    {t.key === 'approvals' &&
                      pendingCountSafe(t.label) && null}

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

      <main className="flex-1 relative z-10">

        <div
          className="
            max-w-[1440px]
            mx-auto
            px-4
            sm:px-6
            lg:px-8
            py-6
            sm:py-8
          "
        >

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
          onClose={() =>
            setSettingsOpen(false)
          }
        />
      )}

    </div>
  )
}


/*
 * Kept deliberately harmless.
 * Approval counts are already included in the tab label
 * by TeacherDashboard, so no extra notification UI is needed.
 */
function pendingCountSafe() {
  return false
}