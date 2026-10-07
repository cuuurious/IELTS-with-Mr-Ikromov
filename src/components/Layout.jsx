import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from './ThemeToggle'
import NotificationBell from './NotificationBell'
import AccountSettingsModal from './AccountSettingsModal'
import TargetBandModal from './TargetBandModal'
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

export function IconMockExam({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 13V9M9.5 3.5h5M12 3.5V5" />
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

export function IconHelp({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.5 2-2.5 3.7" />
      <path d="M12 17.3h.01" />
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

export function IconHome({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M4 11l8-7 8 7v9H4z" />
      <path d="M10 20v-6h4v6" />
    </svg>
  )
}

function IconChevron({ className }) {
  return (
    <svg className={className} {...iconProps}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/*
 * =============================================================
 * LAYOUT — "Study room" top navigation (2026-10-05)
 * =============================================================
 * Replaces the old left sidebar. Same props as before (sections,
 * activeTab, onTabChange, spotlight, children), so every dashboard
 * that uses it keeps working and keeps every menu item:
 *
 *   - the first section's items are shown directly in the top bar,
 *     with the spotlight (Mock Center) right after them;
 *   - later sections with one item are shown directly too, sections
 *     with several items become a small dropdown named after the
 *     section (e.g. "Admin", "Messages");
 *   - "How to use" moves to the "?" button on the right;
 *   - below 1280px wide the whole menu folds into a drawer.
 *
 * Speaking Spin (teacher) and the target band (students) live in the
 * account menu so they can never push into the main menu (2026-10-05).
 *
 * NotificationBell is mounted exactly once (it opens a realtime
 * channel — mounting it twice crashed the site on 2026-09-23).
 */

const ICON_BUTTON_CLASS =
  'focus-ring flex items-center justify-center w-[42px] h-[42px] rounded-xl border border-line bg-panel text-paper hover:bg-panel-2 transition-colors shrink-0'

const SECTION_LABELS = {
  Communication: 'Messages',
  Reference: 'Help',
}

// Shorter names in the top bar only (the drawer and page titles keep
// the full names), so the whole menu fits on a 1280px laptop.
const SHORT_LABELS = {
  'Groups & Homework': 'Groups',
  'Materials Library': 'Materials',
  'Mock Test Center': 'Mock Center',
  'Word Lists': 'Word lists',
  'Group Chats': 'Group chats',
  'Group Chat': 'Group chat',
}

function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export default function Layout({
  sections,
  activeTab,
  onTabChange,
  spotlight,
  children,
}) {
  const { profile, signOut } = useAuth()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [targetOpen, setTargetOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState(null)
  const navRef = useRef(null)

  const isTeacher = profile?.role === 'teacher'
  const isExaminer = profile?.role === 'examiner' || profile?.role === 'writing_examiner' || profile?.role === 'speaking_examiner'

  // Close the drawer if the window grows to desktop width.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)')
    const handleChange = (e) => {
      if (e.matches) setMobileOpen(false)
    }
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  // Close an open dropdown on outside click or Escape. The ref sits on
  // the whole header so the account menu counts as "inside" — when it
  // only covered the nav, pressing "Log out" closed the menu before
  // the click landed, so logging out did nothing (2026-10-05).
  useEffect(() => {
    if (!openMenu) return
    const onDown = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) setOpenMenu(null)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  const safeSections = sections || []
  const allItems = safeSections.flatMap((section) => section.items || [])
  const activeItem = allItems.find((item) => item.key === activeTab)
  const pageTitle = activeItem?.label || ''
  const helpItem = allItems.find((item) => item.key === 'howto')

  const goToTab = (key) => {
    onTabChange(key)
    setMobileOpen(false)
    setOpenMenu(null)
  }

  // Build the top-bar entries.
  const entries = []
  safeSections.forEach((section, index) => {
    const items = (section.items || []).filter((item) => item.key !== 'howto')
    if (!items.length) return
    if (index === 0 || items.length === 1) {
      items.forEach((item) => entries.push({ type: 'item', item }))
    } else {
      const label = SECTION_LABELS[section.title] || section.title || 'More'
      entries.push({ type: 'menu', key: `menu-${index}`, label, items })
    }
    if (index === 0 && spotlight) {
      entries.push({
        type: 'item',
        item: {
          key: spotlight.key,
          label: spotlight.navLabel || spotlight.label,
          icon: spotlight.icon,
        },
      })
    }
  })

  const navButtonClass = (active) =>
    `focus-ring inline-flex items-center gap-2 h-10 px-2 min-[1400px]:px-2.5 2xl:px-3 rounded-[11px] text-sm whitespace-nowrap transition-colors ${
      active ? 'bg-brass text-onbrass font-medium' : 'text-paper-dim hover:text-paper hover:bg-panel-2'
    }`

  const subtitle = isTeacher
    ? 'Teacher'
    : profile?.role === 'writing_examiner'
      ? 'Writing examiner'
      : profile?.role === 'speaking_examiner'
        ? 'Speaking examiner'
        : isExaminer
          ? 'Examiner'
          : 'Student'

  // Phone tab bar: first four items with an icon from the first sections.
  const bottomTabs = allItems.filter((item) => item.key !== 'howto' && item.icon).slice(0, 4)

  return (
    <div className="min-h-screen flex flex-col text-paper bg-ink">
      <header ref={navRef} className="sticky top-0 z-40 border-b border-line bg-panel">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-3 px-4 sm:px-6 xl:gap-4 min-[1400px]:gap-6 xl:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className={`${ICON_BUTTON_CLASS} xl:hidden`}
            aria-label="Open menu"
          >
            <IconMenu className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => goToTab(safeSections[0]?.items?.[0]?.key)}
            className="focus-ring flex items-center gap-3 rounded-xl text-left shrink-0"
          >
            <img
              src="/mrikromov.jpg"
              alt=""
              className="h-[38px] w-[38px] rounded-xl object-cover"
            />
            <span className="hidden sm:flex flex-col leading-tight">
              <span className="text-[16px] font-semibold whitespace-nowrap">IELTS with Mr Ikromov</span>
              <span className="text-xs text-mist">{subtitle}</span>
            </span>
          </button>

          <nav aria-label="Main" className="hidden xl:flex items-center gap-0.5 2xl:gap-1 min-w-0">
            {entries.map((entry) => {
              if (entry.type === 'item') {
                const Icon = entry.item.icon
                const active = activeTab === entry.item.key
                return (
                  <button
                    key={entry.item.key}
                    type="button"
                    onClick={() => goToTab(entry.item.key)}
                    className={navButtonClass(active)}
                    aria-current={active ? 'page' : undefined}
                  >
                    {Icon && entries.length <= 7 && <Icon className="hidden min-[1720px]:block h-[18px] w-[18px] shrink-0" />}
                    {SHORT_LABELS[entry.item.label] || entry.item.label}
                  </button>
                )
              }
              const active = entry.items.some((item) => item.key === activeTab)
              const open = openMenu === entry.key
              return (
                <div key={entry.key} className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenMenu(open ? null : entry.key)}
                    className={navButtonClass(active)}
                    aria-expanded={open}
                    aria-haspopup="menu"
                  >
                    {entry.label}
                    <IconChevron className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div role="menu" className="absolute left-0 top-[calc(100%+8px)] z-50 min-w-[220px] rounded-2xl border border-line bg-panel p-1.5 shadow-[0_16px_40px_-12px_rgba(20,22,45,0.25)]">
                      {entry.items.map((item) => {
                        const Icon = item.icon
                        const itemActive = item.key === activeTab
                        return (
                          <button
                            key={item.key}
                            type="button"
                            role="menuitem"
                            onClick={() => goToTab(item.key)}
                            className={`focus-ring flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm ${
                              itemActive ? 'bg-panel-2 font-medium text-paper' : 'text-paper-dim hover:bg-panel-2 hover:text-paper'
                            }`}
                          >
                            {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
                            {item.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {helpItem && (
              <button
                type="button"
                onClick={() => goToTab(helpItem.key)}
                className={`${ICON_BUTTON_CLASS} hidden sm:flex ${activeTab === helpItem.key ? 'bg-panel-2' : ''}`}
                title={helpItem.label}
                aria-label={helpItem.label}
              >
                <IconHelp className="h-[19px] w-[19px]" />
              </button>
            )}

            <ThemeToggle />
            <NotificationBell profile={profile} />

            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu(openMenu === 'account' ? null : 'account')}
                className="focus-ring flex h-[42px] items-center gap-2.5 rounded-xl border border-line bg-panel pl-[5px] pr-1.5 min-[1720px]:pr-3 hover:bg-panel-2"
                aria-label="Account"
                aria-expanded={openMenu === 'account'}
              >
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-[9px] object-cover" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-speaking-tint text-[13px] font-semibold text-speaking">
                    {initials(profile?.full_name)}
                  </span>
                )}
                <span className="hidden min-[1720px]:inline max-w-[120px] truncate text-sm">
                  {(profile?.full_name || '').split(' ')[0]}
                </span>
              </button>
              {openMenu === 'account' && (
                <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 rounded-2xl border border-line bg-panel p-1.5 shadow-[0_16px_40px_-12px_rgba(20,22,45,0.25)]">
                  <div className="px-3 py-2.5">
                    <div className="truncate text-sm font-medium">{profile?.full_name}</div>
                    {profile?.username && <div className="truncate text-xs text-mist">@{profile.username}</div>}
                  </div>
                  {!isTeacher && !isExaminer && profile?.target_band != null && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenMenu(null)
                        setTargetOpen(true)
                      }}
                      title="Change your target band"
                      className="focus-ring flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-paper-dim hover:bg-panel-2 hover:text-paper"
                    >
                      <TargetBandIcon value={profile.target_band} className="h-[18px] w-[18px]" />
                      Target band {formatTargetBand(profile.target_band)}
                    </button>
                  )}
                  {isTeacher && (
                    <a
                      role="menuitem"
                      href="https://speaking.ieltswithmrikromov.com/admin"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setOpenMenu(null)}
                      className="focus-ring flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-paper-dim hover:bg-panel-2 hover:text-paper"
                    >
                      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 12a8 8 0 0 1 13.66-5.66M20 12a8 8 0 0 1-13.66 5.66" />
                        <path d="M17 3v4h-4M7 21v-4h4" />
                      </svg>
                      Speaking Spin admin
                    </a>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null)
                      setSettingsOpen(true)
                    }}
                    className="focus-ring flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-paper-dim hover:bg-panel-2 hover:text-paper"
                  >
                    <IconSettings className="h-[18px] w-[18px]" />
                    Account settings
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={signOut}
                    className="focus-ring flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-coral hover:bg-panel-2"
                  >
                    <IconLogout className="h-[18px] w-[18px]" />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Click-away layer for the account menu (the nav has its own). */}
      {openMenu === 'account' && (
        <div className="fixed inset-0 z-30" onMouseDown={() => setOpenMenu(null)} aria-hidden="true" />
      )}

      {/* MOBILE / TABLET DRAWER */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div className="absolute inset-0 bg-paper/40" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-[300px] max-w-[85vw] flex-col bg-panel shadow-xl">
            <div className="flex h-[72px] items-center gap-3 border-b border-line px-4">
              <img src="/mrikromov.jpg" alt="" className="h-[38px] w-[38px] rounded-xl object-cover" />
              <span className="flex flex-1 flex-col leading-tight">
                <span className="text-[16px] font-semibold">IELTS with Mr Ikromov</span>
                <span className="text-xs text-mist">{subtitle}</span>
              </span>
              <button type="button" onClick={() => setMobileOpen(false)} className={ICON_BUTTON_CLASS} aria-label="Close menu">
                <IconClose className="h-5 w-5" />
              </button>
            </div>
            <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
              {spotlight && (
                <button
                  type="button"
                  onClick={() => goToTab(spotlight.key)}
                  className="focus-ring mb-3 flex w-full items-center gap-3 rounded-2xl bg-brass px-3.5 py-3 text-left text-onbrass"
                >
                  {spotlight.icon && <spotlight.icon className="h-5 w-5 shrink-0" />}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{spotlight.label}</span>
                    {spotlight.description && <span className="block truncate text-xs opacity-80">{spotlight.description}</span>}
                  </span>
                </button>
              )}
              {safeSections.map((section, index) => (
                <div key={section.title || index} className={index ? 'mt-4' : ''}>
                  {section.title && (
                    <p className="mb-1 px-3 text-xs font-medium text-mist">{SECTION_LABELS[section.title] || section.title}</p>
                  )}
                  {(section.items || []).map((item) => {
                    const Icon = item.icon
                    const active = activeTab === item.key
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => goToTab(item.key)}
                        className={`focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] ${
                          active ? 'bg-brass font-medium text-onbrass' : 'text-paper-dim hover:bg-panel-2 hover:text-paper'
                        }`}
                      >
                        {Icon && <Icon className="h-5 w-5 shrink-0" />}
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              ))}
            </nav>
            <div className="border-t border-line p-3">
              <button
                type="button"
                onClick={signOut}
                className="focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] text-coral hover:bg-panel-2"
              >
                <IconLogout className="h-5 w-5" />
                Log out
              </button>
            </div>
          </aside>
        </div>
      )}

      <main className="flex-1 pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0">
        <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 xl:px-8 xl:py-7">
          {pageTitle && !activeItem?.hideTitle && (
            <h1 className="mb-5 text-[26px] font-semibold tracking-[-0.02em]">{pageTitle}</h1>
          )}
          <div className="animate-fade-up">{children}</div>
        </div>
      </main>

      {/* PHONE TAB BAR (2026-10-06): the four main pages one thumb away;
          everything else stays in the drawer behind "More". */}
      {bottomTabs.length > 0 && (
        <nav
          aria-label="Quick"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        >
          <div className="mx-auto grid max-w-md grid-cols-5">
            {bottomTabs.map((item) => {
              const TabIcon = item.icon
              const active = activeTab === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => goToTab(item.key)}
                  aria-current={active ? 'page' : undefined}
                  className="focus-ring relative flex h-[62px] flex-col items-center justify-center gap-1 text-[11px] font-medium"
                >
                  <span
                    className={`flex h-8 w-12 items-center justify-center rounded-full transition-colors duration-200 ${
                      active ? 'bg-brass text-onbrass' : 'text-paper-dim'
                    }`}
                  >
                    {TabIcon && <TabIcon className="h-5 w-5" />}
                  </span>
                  <span className={`max-w-full truncate px-1 ${active ? 'text-paper' : 'text-mist'}`}>
                    {SHORT_LABELS[item.label] || item.label}
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="focus-ring flex h-[62px] flex-col items-center justify-center gap-1 text-[11px] font-medium"
            >
              <span
                className={`flex h-8 w-12 items-center justify-center rounded-full ${
                  activeTab && !bottomTabs.some((t) => t.key === activeTab) ? 'bg-panel-2 text-paper' : 'text-paper-dim'
                }`}
              >
                <IconMenu className="h-5 w-5" />
              </span>
              <span className="text-mist">More</span>
            </button>
          </div>
        </nav>
      )}

      {settingsOpen && <AccountSettingsModal onClose={() => setSettingsOpen(false)} />}
      {targetOpen && <TargetBandModal onClose={() => setTargetOpen(false)} />}
    </div>
  )
}
