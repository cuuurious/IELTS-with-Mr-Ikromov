import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { lazyWithReload } from '../../lib/lazyWithReload'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout, {
  IconHome,
  IconHomework,
  IconMockExam,
  IconWordlist,
  IconLeaderboard,
  IconGroupChat,
  IconChat,
  IconHelp,
} from '../../components/Layout'
import LoadingScreen from '../../components/LoadingScreen'
import HomeworkCard from './HomeworkCard'
import StudentHome from './StudentHome'
import NotificationSetupGate from '../../components/NotificationSetupGate'
import { useSessionState } from '../../lib/sessionState'
import { homeworkState } from '../../lib/skills'

const GroupChats = lazyWithReload(() => import('../../components/GroupChats'))
const Leaderboard = lazyWithReload(() => import('../../components/Leaderboard'))
const StudentWordlists = lazyWithReload(() => import('./StudentWordlists'))
const PrivateChats = lazyWithReload(() => import('../../components/PrivateChats'))
const MockTestCenter = lazyWithReload(() => import('../../components/MockTestCenter'))
const HowToUseGuide = lazyWithReload(() => import('../../components/HowToUseGuide'))

// One-line description shown under the top bar's own title — see the
// "PAGE INTRO" comment below for why this no longer repeats the title
// itself (the top bar already has it).
const PAGE_SUBTITLES = {
  homework: 'Keep track of your assignments and submit your work on time.',
  wordlists: 'Build your vocabulary and strengthen your English.',
  leaderboard: 'See your progress alongside your classmates.',
  'group-chat': 'Stay connected with your group and classmates.',
  chats: 'Private conversations with your teacher and other students.',
  // 'howto' intentionally has no entry — HowToUseGuide.jsx renders its
  // own header card (eyebrow + title + description), so this generic
  // subtitle card would just duplicate it right above.
}

function HomeworkFilterBar({ counts, value, onChange }) {
  const chips = [
    ['todo', 'To do', 'bg-vocab-tint text-vocab'],
    ['done', 'Handed in', 'bg-reading-tint text-reading'],
    ['missed', 'Missed', 'bg-urgent-tint text-urgent'],
    ['all', 'All', 'bg-panel-2 text-paper'],
  ]
  const total = counts.all || 1
  return (
    <div className="flex flex-col gap-3 rounded-[22px] border border-line bg-panel p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-lg font-semibold text-paper">
            {counts.todo ? `${counts.todo} to do` : 'All caught up'}
          </p>
          <p className="text-xs text-mist">
            {counts.done} of {counts.all} handed in{counts.missed ? ` · ${counts.missed} missed` : ''}
          </p>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-panel-2 sm:w-56" aria-hidden="true">
          <span className="h-full bg-reading transition-[width] duration-700" style={{ width: `${(counts.done / total) * 100}%` }} />
          <span className="h-full bg-[#F3D27A] transition-[width] duration-700" style={{ width: `${(counts.todo / total) * 100}%` }} />
          <span className="h-full bg-urgent/70 transition-[width] duration-700" style={{ width: `${(counts.missed / total) * 100}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter homework">
        {chips.map(([key, label, tone]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={value === key}
            onClick={() => onChange(key)}
            className={`focus-ring inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              value === key ? 'bg-brass text-onbrass' : 'border border-line text-paper-dim hover:border-brass/40'
            }`}
          >
            {label}
            <span className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${value === key ? 'bg-white/20 text-onbrass' : tone}`}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function StudentDashboard() {
  const { profile, signOut } = useAuth()

  // Remembered across a refresh (see lib/sessionState.js).
  const [tab, setTab] =
    useSessionState(`ielts:${profile?.id}:student:tab`, 'home')

  // The Mock Test Center is its OWN full-screen portal now, not a tab
  // in this dashboard's sidebar — see MockTestCenter.jsx's header
  // comment for why (Jasur wants it to feel like a real exam
  // environment, not another section of the everyday site). Clicking
  // its sidebar entry below sets this instead of changing `tab`.
  const [mockCenterOpen, setMockCenterOpen] =
    useSessionState(`ielts:${profile?.id}:student:mockCenterOpen`, false)

  const [myGroups, setMyGroups] =
    useState([])

  // Remembered across a refresh (Jasur, 2026-09-30).
  const [activeGroup, setActiveGroup] =
    useSessionState(`ielts:${profile?.id}:student:activeGroup`, null)

  // The notification-tap handler below is wired up once (its effect
  // only depends on profile?.id, so it doesn't re-subscribe every
  // time the student switches groups). Without this ref, it would
  // keep comparing against whatever activeGroup was on that very
  // first render — so tapping a notification for a different group
  // than the one currently open could fail to actually switch groups.
  const activeGroupRef = useRef(activeGroup)
  activeGroupRef.current = activeGroup

  const [homeworks, setHomeworks] =
    useState([])

  const [submissions, setSubmissions] =
    useState({})

  // Homework page filter (2026-10-06): open work first, newest deadline
  // order; "Done" and "Missed" tucked behind their own chips.
  const [homeworkFilter, setHomeworkFilter] = useState('todo')
  const homeworkStateById = useMemo(() => {
    const now = new Date()
    return Object.fromEntries(homeworks.map((h) => [h.id, homeworkState(h, submissions[h.id], now)]))
  }, [homeworks, submissions])
  const homeworkCounts = useMemo(() => {
    const c = { all: homeworks.length, todo: 0, done: 0, missed: 0 }
    for (const h of homeworks) {
      const k = homeworkStateById[h.id]?.key
      if (k === 'todo' || k === 'today') c.todo += 1
      else if (k === 'overdue') c.missed += 1
      else c.done += 1
    }
    return c
  }, [homeworks, homeworkStateById])
  const visibleHomeworks = useMemo(() => {
    const due = (h) => (h.due_date ? new Date(h.due_date).getTime() : Infinity)
    const pick = homeworks.filter((h) => {
      const k = homeworkStateById[h.id]?.key
      if (homeworkFilter === 'todo') return k === 'todo' || k === 'today'
      if (homeworkFilter === 'done') return k === 'sent' || k === 'late' || k === 'marked'
      if (homeworkFilter === 'missed') return k === 'overdue'
      return true
    })
    if (homeworkFilter === 'todo') return [...pick].sort((a, b) => due(a) - due(b))
    return pick
  }, [homeworks, homeworkStateById, homeworkFilter])

  // Land on "All" when there's nothing open, so the page is never empty.
  const autoFilterDone = useRef(false)
  useEffect(() => {
    if (autoFilterDone.current || !homeworks.length) return
    autoFilterDone.current = true
    if (homeworkCounts.todo === 0) setHomeworkFilter('all')
  }, [homeworks.length, homeworkCounts.todo])

  const [teacher, setTeacher] =
    useState(null)

  /*
   * A notification (or a push while the app is closed) can ask the
   * Chats tab to open already pointed at a specific person/message —
   * PrivateChats itself now owns everything else about the private
   * chat list (who's in it, search, preview, unread, delete), the
   * same shared component the teacher side uses.
   */
  const [notificationChatPeerId, setNotificationChatPeerId] =
    useState(null)
  const [notificationChatPeerName, setNotificationChatPeerName] =
    useState(null)
  const [notificationChatMessageId, setNotificationChatMessageId] =
    useState(null)

const [loading, setLoading] =
  useState(true)

  /*
   * ============================================================
   * LOAD GROUPS + TEACHER
   * ============================================================
   */

  useEffect(() => {
    if (!profile?.id) return

    const load = async () => {
      // SPEED (2026-09-30): the student's groups and the teacher's row
      // don't depend on each other — ask for both at once instead of
      // one after the other (each round trip to the database is
      // ~0.4 s from Uzbekistan).
      const teacherRequest = supabase
        .from('profiles')
        .select(
          'id, full_name, username'
        )
        .eq(
          'role',
          'teacher'
        )
        .eq(
          'status',
          'approved'
        )
        .limit(1)
        .maybeSingle()
        // .then() is what actually sends a Supabase request — without
        // it, this would only start when awaited further down.
        .then((result) => result)

      const {
        data: gm,
        error: groupError,
      } = await supabase
        .from('group_members')
        .select(
          'group_id, groups(id, name)'
        )
        .eq(
          'student_id',
          profile.id
        )

      if (groupError) {
        console.error(
          'Failed to load groups:',
          groupError
        )
      }

      const groups =
        (gm || [])
          .map(
            (row) =>
              row.groups
          )
          .filter(Boolean)

      setMyGroups(groups)

      // Keep the group the student had open before a refresh, as long
      // as they're still in it.
      setActiveGroup((prev) =>
        prev && groups.some((g) => g.id === prev)
          ? prev
          : groups[0]?.id || null
      )

      /*
       * Load the approved teacher.
       */
      const {
        data: teacherRow,
        error: teacherError,
      } = await teacherRequest

      if (teacherError) {
        console.error(
          'Failed to load teacher:',
          teacherError
        )
      }

      setTeacher(
        teacherRow || null
      )

      setLoading(false)
    }

    load()
  }, [profile?.id])

  /*
   * ============================================================
   * LOAD HOMEWORK + SUBMISSIONS
   * ============================================================
   */

  useEffect(() => {
    if (
      !activeGroup ||
      !profile?.id
    ) {
      return
    }

    // 2026-10-06: switching groups quickly could let the previous
    // group's slower response land under the new group. Each run of
    // this effect has its own `cancelled` flag, and the old group's
    // list is cleared straight away instead of lingering.
    let cancelled = false
    let lastLoadAt = 0

    setHomeworks([])
    setSubmissions({})

    const load = async () => {
      lastLoadAt = Date.now()
      // Homework list and this student's own submissions are fetched
      // together (2026-09-30 speed-up) — see the note above.
      const submissionsRequest = supabase
        .from('submissions')
        .select('*')
        .eq(
          'student_id',
          profile.id
        )
        .eq(
          'group_id',
          activeGroup
        )
        .then((result) => result) // start it now (see above)

      const {
        data: hw,
        error: homeworkError,
      } = await supabase
        .from('homeworks')
        // + the files attached from the teacher's Materials Library
        .select('*, homework_attachments(id, url, name, mime_type, size_bytes, sort_order)')
        .eq(
          'group_id',
          activeGroup
        )
        .order(
          'created_at',
          {
            ascending: false,
          }
        )

      if (cancelled) return

      if (homeworkError) {
        console.error(
          'Failed to load homework:',
          homeworkError
        )
      }

      setHomeworks(
        hw || []
      )

      const {
        data: subs,
        error: submissionError,
      } = await submissionsRequest

      if (cancelled) return

      if (submissionError) {
        console.error(
          'Failed to load submissions:',
          submissionError
        )
      }

      const map = {}

      ;(subs || []).forEach(
        (submission) => {
          map[
            submission.homework_id
          ] = submission
        }
      )

      setSubmissions(map)
    }

    load()

    /*
     * Re-sync when the tab comes back to the foreground.
     *
     * On phones (Samsung/Android in particular), switching to the
     * camera or gallery to pick a photo and coming back doesn't
     * always give this page a real reload — the browser can instead
     * freeze the page and later restore it from a snapshot, or
     * restore it from the back-forward cache. Either way, this
     * effect never re-runs (activeGroup/profile.id haven't changed),
     * so the screen keeps showing whatever it last had in memory —
     * e.g. "not yet submitted" from just before an upload — even
     * though the upload itself may have already finished on the
     * server while the tab was away. Re-running `load()` whenever
     * the tab becomes visible again (or is restored from that cache)
     * catches the app back up to what actually happened.
     */
    // 2026-10-06: at most once a minute — every tab switch used to
    // refetch the whole homework list.
    const handleVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastLoadAt > 60000
      ) {
        load()
      }
    }

    const handlePageShow = (event) => {
      if (event.persisted) {
        load()
      }
    }

    document.addEventListener(
      'visibilitychange',
      handleVisible
    )

    window.addEventListener(
      'pageshow',
      handlePageShow
    )

    return () => {
      cancelled = true

      document.removeEventListener(
        'visibilitychange',
        handleVisible
      )

      window.removeEventListener(
        'pageshow',
        handlePageShow
      )
    }
  }, [
    activeGroup,
    profile?.id,
  ])

  
  /*
   * ============================================================
   * PRIVATE CHAT NAVIGATION
   * ============================================================
   *
   * Notifications can send:
   *
   * private-chat:STUDENT_ID
   *
   * We resolve that student's profile and open the Chats tab
   * with THAT student selected.
   *
   * This prevents the student from being sent to the teacher's
   * chat accidentally.
   * ============================================================
   */

  useEffect(() => {
    if (!profile?.id) return

    const handleNavigation =
      async (event) => {
        const notification =
          event.detail
            ?.notification

        const link =
          event.detail?.link ||
          notification?.link ||
          ''

        // Open a specific homework from a notification.
if (link.startsWith('homework:')) {
  const homeworkId = link.split(':')[1]

  if (!homeworkId) return

  /*
   * The notification only carries the homework id, but the
   * homework card only renders when its group is the active
   * group. A student can belong to more than one group, so
   * look up which group this homework actually belongs to
   * and switch to it before trying to scroll.
   */
  const {
    data: targetHomework,
    error: targetHomeworkError,
  } = await supabase
    .from('homeworks')
    .select('id, group_id')
    .eq('id', homeworkId)
    .maybeSingle()

  if (targetHomeworkError) {
    console.error(
      'Could not look up homework for notification:',
      targetHomeworkError
    )
  }

  if (
    targetHomework?.group_id &&
    targetHomework.group_id !== activeGroupRef.current
  ) {
    setActiveGroup(targetHomework.group_id)
  }

  setTab('homework')

  // Give React a moment to switch groups/tabs and load the
  // homework list, then scroll to and briefly highlight the
  // assignment. Retry for a bit since a group switch triggers
  // its own async fetch that a single fixed delay can miss.
  let attempts = 0

  const tryScrollToHomework = () => {
    const element = document.getElementById(
      `homework-${homeworkId}`
    )

    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })

      element.classList.add('homework-highlight')

      setTimeout(() => {
        element.classList.remove('homework-highlight')
      }, 2200)

      return
    }

    attempts += 1

    if (attempts < 15) {
      setTimeout(tryScrollToHomework, 200)
    }
  }

  setTimeout(tryScrollToHomework, 150)

  return
}

if (
  !link.startsWith(
    'private-chat:'
  )
) {
  return
}

const linkParts = link.split(':')
const studentId = linkParts[1]
const messageId = linkParts[2] || null

        if (
          !studentId ||
          studentId ===
            profile.id
        ) {
          return
        }

        const {
          data: student,
          error,
        } = await supabase
          .from('profiles')
          .select(
            'id, full_name, username'
          )
          .eq(
            'id',
            studentId
          )
          .maybeSingle()

        if (error) {
          console.error(
            'Could not find chat student:',
            error
          )
          return
        }

        if (!student) {
          console.error(
            'Chat student not found:',
            studentId
          )
          return
        }

        setNotificationChatPeerId(student.id)
        setNotificationChatPeerName(
          student.full_name ||
            student.username ||
            'Student'
        )
        setNotificationChatMessageId(messageId)

        setTab('chats')
      }

    window.addEventListener(
      'notification-navigate',
      handleNavigation
    )

    // A push notification may have arrived (and dispatched this event)
    // before this listener existed — main.jsx stashes it here for
    // exactly that case, so pick it up now instead of losing it.
    if (window.__pendingNav) {
      const pendingLink = window.__pendingNav
      window.__pendingNav = null
      handleNavigation({ detail: { link: pendingLink } })
    }

    return () => {
      window.removeEventListener(
        'notification-navigate',
        handleNavigation
      )
    }
  }, [profile?.id])

  /*
   * ============================================================
   * TABS
   * ============================================================
   */

  // A single unlabeled group is enough for now — the sidebar (see
  // Layout.jsx) only really needs section headers once there's more
  // than one natural grouping, which happens once Mock Exams lands.
  const sections = useMemo(
    () => [
      {
        items: [
          { key: 'home', label: 'Home', icon: IconHome, hideTitle: true },
          { key: 'homework', label: 'Homework', icon: IconHomework },
          { key: 'wordlists', label: 'Word lists', icon: IconWordlist },
          { key: 'leaderboard', label: 'Leaderboard', icon: IconLeaderboard },
          { key: 'group-chat', label: 'Group chat', icon: IconGroupChat },
          { key: 'chats', label: 'Chats', icon: IconChat },
        ],
      },
      {
        items: [
          { key: 'howto', label: 'How to use', icon: IconHelp },
        ],
      },
    ],
    []
  )

  /*
   * ============================================================
   * SUBMISSION UPDATE
   * ============================================================
   */

  const updateSubmission =
    (submission) => {
      if (!submission?.homework_id) {
        return
      }

      setSubmissions(
        (previous) => ({
          ...previous,
          [submission.homework_id]:
            submission,
        })
      )
    }

  /*
   * ============================================================
   * GROUP PICKER
   * ============================================================
   */

  const GroupPicker = () =>
    myGroups.length > 1 ? (
      <div className="flex gap-2 flex-wrap mb-5">
        {myGroups.map(
          (group) => (
            <button
              key={group.id}
              type="button"
              onClick={() =>
                setActiveGroup(
                  group.id
                )
              }
              className={`focus-ring px-3 py-1.5 rounded-full text-sm border transition-colors ${
                activeGroup ===
                group.id
                  ? 'bg-brass text-onbrass border-brass-dim font-medium'
                  : 'border-line text-mist hover:text-paper'
              }`}
            >
              {group.name}
            </button>
          )
        )}
      </div>
    ) : null

  /*
   * ============================================================
   * TAB CHANGE
   * ============================================================
   */

  const handleTabChange =
    (nextTab) => {
      // The Mock Test Center is a full-screen takeover, not a tab —
      // open it and leave `tab` exactly where it was, so exiting the
      // portal lands back on whatever section was open before.
      if (nextTab === 'mock-center') {
        setMockCenterOpen(true)
        return
      }

      setTab(nextTab)

      /*
       * Intentionally does nothing else — PrivateChats keeps its own
       * selected conversation in its own state now, so switching to
       * and from the leaderboard or homework tabs and back never
       * resets which chat was open.
       */
    }

  /*
   * ============================================================
   * LOADING
   * ============================================================
   */

  if (loading) {
    return (
      <LoadingScreen label="Loading your dashboard…" />
    )
  }

  if (mockCenterOpen) {
    return (
      <Suspense fallback={<LoadingScreen label="Opening Mock Test Center…" />}>
        <MockTestCenter
          onExit={() => setMockCenterOpen(false)}
        />
      </Suspense>
    )
  }

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <>
    {/* Required once: phone notifications or the Telegram bot (2026-10-02). */}
    {profile?.id && <NotificationSetupGate profile={profile} onSignOut={signOut} />}
    <Layout
      sections={sections}
      activeTab={tab}
      onTabChange={handleTabChange}
      spotlight={{
        key: 'mock-center',
        label: 'Mock Test Center',
        description: 'Take a timed reading, listening or writing mock',
        icon: IconMockExam,
      }}
    >
      <Suspense fallback={<div className="py-16 text-center text-sm text-mist">Loading…</div>}>
      <div className="space-y-5">

        {/* ======================================================
            PAGE INTRO
            The top bar (Layout.jsx) already shows the "Candidate
            portal" eyebrow and the page title in big text right
            above this — repeating both again here in a second card
            was pure noise. This keeps only the one-line description
            (which the top bar doesn't have room for) plus the
            homework tab's group/task-count readout.
           ====================================================== */}
        {PAGE_SUBTITLES[tab] && tab !== 'homework' && (
          <section className="relative overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">

            <div className="relative px-5 py-4 sm:px-7 sm:py-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <p className="text-sm text-mist leading-6 max-w-2xl">
                  {PAGE_SUBTITLES[tab]}
                </p>

                {tab === 'homework' && myGroups.length > 0 && (
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="hidden sm:block text-right">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-mist font-mono">
                        Current group
                      </div>
                      <div className="font-medium text-paper mt-1">
                        {myGroups.find((group) => group.id === activeGroup)?.name || 'Group'}
                      </div>
                    </div>

                    <div className="h-12 min-w-12 rounded-2xl border border-brass-dim/30 bg-brass/10 px-3 flex flex-col items-center justify-center">
                      <span className="text-[9px] uppercase tracking-widest text-mist font-mono">
                        Tasks
                      </span>
                      <span className="font-display text-lg leading-none text-brass mt-0.5">
                        {homeworks.length}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ======================================================
            HOMEWORK
           ====================================================== */}
        {/* ======================================================
            HOME — "Study room" overview (2026-10-05)
           ====================================================== */}
        {tab === 'home' && (
          <StudentHome
            profile={profile}
            groups={myGroups}
            activeGroup={activeGroup}
            onSelectGroup={setActiveGroup}
            homeworks={homeworks}
            submissions={submissions}
            onNavigate={handleTabChange}
            onOpenMockCenter={() => setMockCenterOpen(true)}
            onOpenHomework={(homeworkId) => {
              setTab('homework')
              setHomeworkFilter('all')
              // Wait for the Homework tab to render, then bring the
              // card into view (HomeworkCard rows carry this id).
              setTimeout(() => {
                document
                  .getElementById(`homework-${homeworkId}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }, 120)
            }}
          />
        )}

        {tab === 'homework' && (
          <section className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <GroupPicker />

              {myGroups.length > 1 && (
                <div className="text-xs text-mist font-mono sm:text-right">
                  Choose a group to view its assignments
                </div>
              )}
            </div>

            {myGroups.length === 0 && (
              <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 sm:py-14 text-center">
                <div className="mx-auto h-14 w-14 rounded-2xl border border-brass-dim/25 bg-brass/10 flex items-center justify-center text-brass text-2xl">
                  —
                </div>

                <h2 className="font-display text-2xl mt-5">
                  No group yet
                </h2>

                <p className="text-sm text-mist mt-2 max-w-md mx-auto leading-6">
                  You're not in a group yet. Ask Mr Ikromov to add you to one.
                </p>
              </div>
            )}

            {myGroups.length > 0 && (
              <>
                {/* Summary + filter (2026-10-06): what's left to do at a
                    glance, then only the cards that matter right now. */}
                {homeworks.length > 0 && (
                  <HomeworkFilterBar
                    counts={homeworkCounts}
                    value={homeworkFilter}
                    onChange={setHomeworkFilter}
                  />
                )}

                {homeworks.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center">
                    <div className="mx-auto h-14 w-14 rounded-2xl border border-line bg-panel-2 flex items-center justify-center text-brass text-2xl">
                      —
                    </div>

                    <h2 className="font-display text-xl mt-5">
                      No homework yet
                    </h2>

                    <p className="text-sm text-mist mt-2 max-w-md mx-auto">
                      No homework has been posted for this group yet.
                    </p>
                  </div>
                )}

                {homeworks.length > 0 && visibleHomeworks.length === 0 && (
                  <div className="rounded-[22px] border border-dashed border-line bg-panel px-6 py-10 text-center text-sm text-mist">
                    {homeworkFilter === 'todo' ? 'Nothing left to do — well done!' : 'Nothing here.'}
                  </div>
                )}

                {visibleHomeworks.length > 0 && (
                  <div className="space-y-3">
                    {visibleHomeworks.map((homework, i) => (
                      <div
                        key={homework.id}
                        id={`homework-${homework.id}`}
                        className={`wp-pop group relative overflow-hidden rounded-[22px] border bg-panel transition-shadow duration-200 hover:shadow-[0_10px_28px_-16px_rgba(31,35,64,0.35)] ${
                          homeworkStateById[homework.id]?.key === 'overdue' || homeworkStateById[homework.id]?.key === 'today'
                            ? 'border-urgent/30'
                            : 'border-line'
                        }`}
                        style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}
                      >

                        <HomeworkCard
                          homework={homework}
                          submission={submissions[homework.id]}
                          studentId={profile.id}
                          onChange={updateSubmission}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ======================================================
            WORD LISTS
           ====================================================== */}
        {tab === 'wordlists' && (
          <section>
            <StudentWordlists studentId={profile.id} />
          </section>
        )}

        {/* ======================================================
            LEADERBOARD
           ====================================================== */}
        {tab === 'leaderboard' && (
          <section className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <GroupPicker />

              {activeGroup && (
                <div className="text-xs text-mist font-mono">
                  {myGroups.find((group) => group.id === activeGroup)?.name || 'Current group'}
                </div>
              )}
            </div>

            {activeGroup ? (
              <section className="rounded-3xl border border-line bg-panel shadow-sm overflow-hidden">
                <div className="px-5 sm:px-7 py-3.5 border-b border-line flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-brass font-mono">
                    <span className="h-1.5 w-1.5 rounded-full bg-brass" />
                    Your group
                  </div>

                  <div className="hidden sm:block text-xs text-mist font-mono">
                    Tap a student to view progress
                  </div>
                </div>

                <div className="p-3 sm:p-5">
                  <Leaderboard
                    groupId={activeGroup}
                    highlightStudentId={profile.id}
                    onOpenChat={(student) => {
                      if (!student?.student_id) {
                        return
                      }

                      setNotificationChatPeerId(student.student_id)
                      setNotificationChatPeerName(
                        student.full_name ||
                          student.username ||
                          'Student'
                      )
                      setNotificationChatMessageId(null)

                      setTab('chats')
                    }}
                  />
                </div>
              </section>
            ) : (
              <div className="rounded-3xl border border-dashed border-line bg-panel px-6 py-12 text-center">
                <h2 className="font-display text-xl">
                  No group selected
                </h2>

                <p className="text-sm text-mist mt-2">
                  You're not in a group yet.
                </p>
              </div>
            )}
          </section>
        )}

        {/* ======================================================
            GROUP CHAT
            Telegram-style list + preview, shared with the teacher
            side — see GroupChats.jsx. Intentionally does NOT use
            `activeGroup`/`GroupPicker` (that pair stays a simple
            "filter by group" control for Homework/Leaderboard above)
            — this owns its own selection so opening a group's chat
            here never changes what those other tabs are filtered to.
           ====================================================== */}
        {tab === 'group-chat' && (
          <section className="space-y-5">
            <GroupChats selfId={profile.id} selfRole="student" />
          </section>
        )}

        {/* ======================================================
            PRIVATE CHATS
            Shared with the teacher side — see PrivateChats.jsx.
           ====================================================== */}
        {tab === 'chats' && (
          <PrivateChats
            selfId={profile.id}
            selfRole="student"
            teacher={teacher}
            initialPeerId={notificationChatPeerId}
            initialPeerName={notificationChatPeerName}
            initialMessageId={notificationChatMessageId}
          />
        )}

        {/* ======================================================
            HOW TO USE
            Onboarding walkthrough for new students — see
            HowToUseGuide.jsx. Also downloadable as a PDF from
            inside that component (public/how-to-use-ielts-portal.pdf).
           ====================================================== */}
        {tab === 'howto' && <HowToUseGuide />}
      </div>
      </Suspense>
    </Layout>
    </>
  )
}

