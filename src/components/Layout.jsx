import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from './ThemeToggle'
import NotificationBell from './NotificationBell'
import AccountSettingsModal from './AccountSettingsModal'
import { formatTargetBand } from '../lib/targetBands'
import TargetBandIcon from './TargetBandIcon'

/*
 * =============================================================
 * NAV ICONS
 * =============================================================
 * Small, self-contained line icons (24x24, stroke-only) so the
 * sidebar doesn't need an icon library dependency. One consistent
 * stroke weight (1.8) across all of them, matching the settings/
 * logout icons this file already drew by hand before this redesign.
 */

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function IconGroups({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="M7 11.5 3 13.5V16l9 5 9-5v-2.5" />
    </svg>
  )
}

export function IconStudents({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.6 2.7-5.6 6-5.6s6 2 6 5.6" />
      <circle cx="17" cy="8.5" r="2.4" />
      <path d="M15.3 14.3c2.7.3 4.7 2.1 4.7 5.7" />
    </svg>
  )
}

export function IconWordlist({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M5 4.5A2 2 0 0 1 7 2.5h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-14Z" />
      <path d="M5 18.5A2 2 0 0 1 7 16.5h12" />
      <path d="M9 7h6M9 10.5h6" />
    </svg>
  )
}

export function IconHomework({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  )
}

export function IconGroupChat({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M8 4.5h9A2.5 2.5 0 0 1 19.5 7v5A2.5 2.5 0 0 1 17 14.5h-2l-4 3v-3H8A2.5 2.5 0 0 1 5.5 12V7A2.5 2.5 0 0 1 8 4.5Z" />
      <path d="M3.5 10.5v3.2a1.8 1.8 0 0 0 1.8 1.8h.2v2.3l2.6-2.3" opacity="0.5" />
    </svg>
  )
}

export function IconChat({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M6 4.5h12A2.5 2.5 0 0 1 20.5 7v6A2.5 2.5 0 0 1 18 15.5h-8l-4.5 3.7V15.5A2.5 2.5 0 0 1 3.5 13V7A2.5 2.5 0 0 1 6 4.5Z" />
    </svg>
  )
}

export function IconLeaderboard({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M8 21V11M12 21V4M16 21v-7" />
    </svg>
  )
}

export function IconAI({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M12 3v3M12 18v3M4.2 12H1.5M22.5 12h-2.7M6 6l1.8 1.8M16.2 16.2 18 18M18 6l-1.8 1.8M7.8 16.2 6 18" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  )
}

export function IconApprovals({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.3 2.4 2.4 4.6-5.2" />
    </svg>
  )
}

export function IconStaff({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M12 3 5 6v5c0 4.5 3 7.4 7 9 4-1.6 7-4.5 7-9V6l-7-3Z" />
    </svg>
  )
}

function IconMenu({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

function IconClose({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

function IconCollapse({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </svg>
  )
}

function IconSettings({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1.51 1v.09a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}

function IconLogout({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

/*
 * Shared recipe for the small square icon-only buttons in the top
 * bar (settings, and — via the className overrides in ThemeToggle.jsx
 * / NotificationBell.jsx — theme + notifications). Rectangular
 * (10px radius), one neutral resting state, brass on hover/focus —
 * replaces the old "every icon button is its own tinted-color pill"
 * pattern (amber for notifications, lavender for theme, brass for
 * settings, coral for logout) with one consistent, calmer vocabulary.
 */
const ICON_BUTTON_CLASS =
  'focus-ring flex items-center justify-center w-9 h-9 rounded-[10px] border border-line bg-panel-2 text-mist hover:text-paper hover:border-brass/40 transition-colors shrink-0'

const SIDEBAR_STORAGE_KEY = 'ielts-mrikromov-sidebar-collapsed'

export default function Layout({
  sections,
  activeTab,
  onTabChange,
  children,
}) {
  const { profile, signOut } = useAuth()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      // Ignore — collapsed state just won't persist across reloads.
    }
  }, [collapsed])

  // Close the mobile drawer automatically if the viewport grows past
  // the mobile breakpoint while it's open (e.g. rotating a tablet).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handleChange = (e) => {
      if (e.matches) setMobileOpen(false)
    }
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  const isTeacher = profile?.role === 'teacher'

  const safeSections = sections || []
  const activeItem = safeSections
    .flatMap((section) => section.items || [])
    .find((item) => item.key === activeTab)
  const pageTitle = activeItem?.label || ''

  const goToTab = (key) => {
    onTabChange(key)
    setMobileOpen(false)
  }

  const sidebarContent = (
    <>
      {/* BRAND */}
      <div className="flex items-center gap-3 h-[76px] px-4 border-b border-line shrink-0">
        <div className="relative shrink-0">
          <img
            src="/mrikromov.jpg"
            alt="IELTS with Mr Ikromov"
            className="w-10 h-10 rounded-[0.85rem] object-cover object-center border border-line"
          />
          <span className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full bg-sage border-2 border-panel" />
        </div>

        {!collapsed && (
          <div className="min-w-0">
            <div className="text-[14px] leading-tight font-semibold tracking-[-0.01em] text-paper truncate">
              IELTS with Mr Ikromov
            </div>
            <div className="text-[10px] text-mist font-mono uppercase tracking-[0.14em] mt-0.5">
              {isTeacher ? 'Examiner desk' : 'Candidate portal'}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="focus-ring lg:hidden ml-auto shrink-0 flex items-center justify-center w-8 h-8 rounded-[10px] text-mist hover:text-paper hover:bg-panel-2"
          aria-label="Close menu"
        >
          <IconClose className="h-4.5 w-4.5" />
        </button>
      </div>

      {/* NAV */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {safeSections.map((section, sectionIndex) => (
          <div key={section.title || sectionIndex} className={sectionIndex === 0 ? '' : 'mt-5'}>
            {section.title && !collapsed && (
              <p className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-mist/60">
                {section.title}
              </p>
            )}

            <div className="flex flex-col gap-0.5">
              {(section.items || []).map((item) => {
                const active = activeTab === item.key
                const Icon = item.icon

                return (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => goToTab(item.key)}
                    title={collapsed ? item.label : undefined}
                    className={`
                      focus-ring group flex items-center gap-3 rounded-[10px]
                      border-l-2 px-3 py-2.5 text-sm transition-colors
                      ${collapsed ? 'justify-center px-0' : ''}
                      ${
                        active
                          ? 'border-brass bg-brass/10 text-brass font-semibold'
                          : 'border-transparent text-mist hover:text-paper hover:bg-panel-2'
                      }
                    `}
                  >
                    {Icon && (
                      <Icon
                        className={`h-[18px] w-[18px] shrink-0 ${
                          active ? 'text-brass' : 'text-mist group-hover:text-paper'
                        }`}
                      />
                    )}
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* SIGNED-IN USER + LOG OUT */}
      <div className="border-t border-line px-3 py-3 shrink-0">
        {!collapsed && (
          <p className="px-1 mb-2 text-xs text-mist truncate">
            {profile?.full_name}
          </p>
        )}

        <button
          type="button"
          onClick={signOut}
          title={collapsed ? 'Log out' : undefined}
          className={`
            focus-ring w-full flex items-center gap-2.5 rounded-[10px]
            px-3 py-2 text-sm text-coral hover:bg-coral/10 transition-colors
            ${collapsed ? 'justify-center px-0' : ''}
          `}
        >
          <IconLogout className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>

      {/* COLLAPSE TOGGLE (desktop only) */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className={`
          focus-ring hidden lg:flex items-center gap-2 mx-3 mb-3 rounded-[10px]
          border border-line px-3 py-2 text-xs text-mist hover:text-paper hover:bg-panel-2
          ${collapsed ? 'justify-center px-0' : ''}
        `}
      >
        <IconCollapse className="h-4 w-4 shrink-0" />
        {!collapsed && <span>Collapse</span>}
      </button>
    </>
  )

  return (
    <div className="min-h-screen flex text-paper bg-ink">

      {/* =====================================================
          MOBILE BACKDROP
          ===================================================== */}

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* =====================================================
          SIDEBAR
          ===================================================== */}

      {/*
        * lg:static (a normal flow flex item) was the bug behind "the
        * sidebar goes blank once I scroll down": at desktop width this
        * aside sits in a `flex` row next to the main column, and a
        * flex row's default align-items:stretch makes it MATCH the
        * height of whichever sibling is taller — so once a page's main
        * content (a long leaderboard, a long table) grew past one
        * screen, this aside stretched just as tall and scrolled away
        * WITH the page instead of staying put, leaving a big empty gap
        * between the real nav items (scrolled out of view) and the
        * user/logout footer (now stranded far down at the bottom of
        * that stretched column). lg:sticky + lg:top-0 + lg:h-screen
        * pins it to the viewport instead, exactly like the top bar's
        * own `sticky top-0` already does, so it never stretches or
        * scrolls away regardless of how long the page next to it gets.
        */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col
          bg-panel border-r border-line
          transition-transform duration-200 ease-out
          lg:sticky lg:top-0 lg:h-screen lg:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          ${collapsed ? 'lg:w-[76px]' : 'lg:w-64'}
          w-72
        `}
      >
        {sidebarContent}
      </aside>

      {/* =====================================================
          MAIN COLUMN
          ===================================================== */}

      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile top bar */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-2 h-14 px-3 border-b border-line bg-panel/90 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="focus-ring flex items-center justify-center w-9 h-9 rounded-[10px] border border-line bg-panel-2 text-mist hover:text-paper"
            aria-label="Open menu"
          >
            <IconMenu className="h-5 w-5" />
          </button>

          <span className="flex-1 min-w-0 text-sm font-semibold text-paper truncate">
            {pageTitle}
          </span>

          <ThemeToggle />
          <NotificationBell profile={profile} />

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className={ICON_BUTTON_CLASS}
            aria-label="Account settings"
          >
            <IconSettings className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Desktop top bar */}
        <header className="hidden lg:flex sticky top-0 z-30 items-center justify-between gap-4 h-[76px] px-6 border-b border-line bg-panel/80 backdrop-blur-xl">
          <div className="min-w-0">
            <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-mist">
              {isTeacher ? 'Examiner desk' : 'Candidate portal'}
            </p>
            <h1 className="font-display text-xl font-semibold text-paper truncate">
              {pageTitle}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">

            {!isTeacher && profile?.target_band != null && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                title="Change your target band in Account Settings"
                className="focus-ring flex items-center gap-1.5 rounded-[10px] border border-line bg-panel-2 px-3 h-9 text-xs font-semibold text-paper hover:border-brass/40 transition-colors"
              >
                <TargetBandIcon value={profile.target_band} className="h-3.5 w-3.5 text-brass" />
                <span>Target {formatTargetBand(profile.target_band)}</span>
              </button>
            )}

            {isTeacher && (
              <a
                href="https://speaking.ieltswithmrikromov.com/admin"
                target="_blank"
                rel="noopener noreferrer"
                title="Manage Speaking Spin practice content"
                className="focus-ring inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border border-line bg-panel-2 text-sm text-cyan hover:border-cyan/40 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 12a8 8 0 0 1 13.66-5.66M20 12a8 8 0 0 1-13.66 5.66" />
                  <path d="M17 3v4h-4M7 21v-4h4" strokeLinejoin="round" />
                </svg>
                <span>Speaking Spin</span>
              </a>
            )}

            <ThemeToggle />
            <NotificationBell profile={profile} />

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className={ICON_BUTTON_CLASS}
              title="Account settings"
              aria-label="Account settings"
            >
              <IconSettings className="h-4.5 w-4.5" />
            </button>
          </div>
        </header>

        <main className="flex-1">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="animate-fade-up">
              {children}
            </div>
          </div>
        </main>
      </div>

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
