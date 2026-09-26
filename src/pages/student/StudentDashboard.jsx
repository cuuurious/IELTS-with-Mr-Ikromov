import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'

import Layout, {
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
import GroupChats from '../../components/GroupChats'
import Leaderboard from '../../components/Leaderboard'
import StudentWordlists from './StudentWordlists'
import PrivateChats from '../../components/PrivateChats'
import MockTestCenter from '../../components/MockTestCenter'
import HowToUseGuide from '../../components/HowToUseGuide'

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

export default function StudentDashboard() {
  const { profile } = useAuth()

  const [tab, setTab] =
    useState('homework')

  // The Mock Test Center is its OWN full-screen portal now, not a tab
  // in this dashboard's sidebar — see MockTestCenter.jsx's header
  // comment for why (Jasur wants it to feel like a real exam
  // environment, not another section of the everyday site). Clicking
  // its sidebar entry below sets this instead of changing `tab`.
  const [mockCenterOpen, setMockCenterOpen] =
    useState(false)

  const [myGroups, setMyGroups] =
    useState([])

  const [activeGroup, setActiveGroup] =
    useState(null)

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

      setActiveGroup(
        groups[0]?.id ||
          null
      )

      /*
       * Load the approved teacher.
       */
      const {
        data: teacherRow,
        error: teacherError,
      } = await supabase
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

    const load = async () => {
      const {
        data: hw,
        error: homeworkError,
      } = await supabase
        .from('homeworks')
        .select('*')
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
      } = await supabase
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
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
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
          { key: 'homework', label: 'Homework', icon: IconHomework },
          { key: 'wordlists', label: 'Word Lists', icon: IconWordlist },
          { key: 'leaderboard', label: 'Leaderboard', icon: IconLeaderboard },
          { key: 'group-chat', label: 'Group Chat', icon: IconGroupChat },
          { key: 'chats', label: 'Chats', icon: IconChat },
        ],
      },
      {
        items: [
          { key: 'howto', label: 'How to Use', icon: IconHelp },
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
      <MockTestCenter
        onExit={() => setMockCenterOpen(false)}
      />
    )
  }

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
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
        {PAGE_SUBTITLES[tab] && (
          <section className="relative overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-brass/10 blur-3xl" />
              <div className="absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-sage/10 blur-3xl" />
            </div>

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
                <div className="flex items-center justify-between gap-4 px-1">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-brass font-mono">
                    <span className="h-1.5 w-1.5 rounded-full bg-brass" />
                    Assignments
                  </div>

                  <div className="hidden sm:flex items-center gap-2 rounded-full border border-line bg-panel-2 px-3 py-1.5 text-xs text-mist font-mono">
                    {homeworks.length}{' '}
                    {homeworks.length === 1 ? 'assignment' : 'assignments'}
                  </div>
                </div>

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

                {homeworks.length > 0 && (
                  <div className="space-y-4">
                    {homeworks.map((homework) => (
                      <div
                        key={homework.id}
                        id={`homework-${homework.id}`}
                        className="group relative rounded-3xl border border-line bg-panel shadow-sm overflow-hidden transition-all duration-200 hover:border-brass-dim/40 hover:-translate-y-0.5 hover:shadow-xl"
                      >
                        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brass/30 via-brass to-brass/30 opacity-70 group-hover:opacity-100 transition-opacity" />

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
    </Layout>
  )
}

