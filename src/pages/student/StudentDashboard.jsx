import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'

import Layout from '../../components/Layout'
import HomeworkCard from './HomeworkCard'
import GroupChat from '../../components/GroupChat'
import Leaderboard from '../../components/Leaderboard'
import StudentWordlists from './StudentWordlists'
import Chat from '../../components/Chat'

export default function StudentDashboard() {
  const { profile } = useAuth()

  const [tab, setTab] =
    useState('homework')

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
   * The person currently selected for a private chat.
   *
   * null = no student selected,
   * so the Chats tab falls back to the teacher.
   */
  const [chatPeer, setChatPeer] =
  useState(null)

const [chatContacts, setChatContacts] =
  useState([])

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
  }, [
    activeGroup,
    profile?.id,
  ])

  /*
   * ============================================================
   * REALTIME: AI GRADING RESULTS
   * ============================================================
   * The ai-grading Edge Function writes ai_status/ai_result onto a
   * submission a little while after it's sent (it's an API call, not
   * instant) — this is what makes that result appear on its own,
   * without the student needing to refresh, same as chat messages.
   */

  useEffect(() => {
    if (!activeGroup || !profile?.id) return

    const channel = supabase
      .channel(
        `student-submissions-${profile.id}-${activeGroup}`
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'submissions',
          filter: `student_id=eq.${profile.id}`,
        },
        (payload) => {
          const submission = payload.new

          if (submission.group_id !== activeGroup) return

          setSubmissions((prev) => ({
            ...prev,
            [submission.homework_id]: submission,
          }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [activeGroup, profile?.id])

  /*
 * ============================================================
 * LOAD PRIVATE CHAT CONTACTS
 * ============================================================
 *
 * The teacher is always available.
 *
 * Every student who has exchanged at least one private
 * message with the current student is also shown.
 *
 * The currently selected chat is always preserved.
 * ============================================================
 */
useEffect(() => {
  if (!profile?.id) return

  let cancelled = false

  const addContactFromProfile = (
    person,
    lastMessageAt = null
  ) => {
    if (!person?.id) {
      return
    }

    setChatContacts((previous) => {
      const existingIndex =
        previous.findIndex(
          (contact) =>
            contact.id === person.id
        )

      const newContact = {
        id: person.id,
        full_name:
          person.full_name ||
          person.username ||
          (person.role === 'teacher'
            ? 'Teacher'
            : 'Student'),
        username:
          person.username || '',
        role:
          person.role ||
          'student',
        lastMessageAt,
      }

      /*
       * Contact already exists.
       *
       * Update its information, but NEVER remove it.
       */
      if (existingIndex !== -1) {
        const updated = [
          ...previous,
        ]

        updated[
          existingIndex
        ] = {
          ...updated[
            existingIndex
          ],
          ...newContact,
          lastMessageAt:
            lastMessageAt ||
            updated[
              existingIndex
            ].lastMessageAt ||
            null,
        }

        return updated
      }

      /*
       * New conversation.
       */
      return [
        ...previous,
        newContact,
      ]
    })
  }

  const loadChatContacts =
    async () => {
      try {
        /*
         * Load every private message involving
         * the current student.
         */
        const {
          data: messages,
          error: messagesError,
        } = await supabase
          .from('messages')
          .select(
            'sender_id, receiver_id, created_at'
          )
          .or(
            `sender_id.eq.${profile.id},receiver_id.eq.${profile.id}`
          )
          .order(
            'created_at',
            {
              ascending: false,
            }
          )

        if (messagesError) {
          console.error(
            'Failed to load chat contacts:',
            messagesError
          )
          return
        }

        /*
         * Build a unique list of people who have
         * exchanged messages with this student.
         *
         * Map keeps the newest message for each person.
         */
        const latestByPeer =
          new Map()

        ;(messages || []).forEach(
          (message) => {
            const peerId =
              message.sender_id ===
              profile.id
                ? message.receiver_id
                : message.sender_id

            if (
              !peerId ||
              peerId === profile.id
            ) {
              return
            }

            if (
              !latestByPeer.has(
                peerId
              )
            ) {
              latestByPeer.set(
                peerId,
                message.created_at ||
                  null
              )
            }
          }
        )

        const peerIds =
          Array.from(
            latestByPeer.keys()
          )

        let loadedContacts = []

        if (
          peerIds.length > 0
        ) {
          const {
            data: peerProfiles,
            error: profileError,
          } = await supabase
            .from('profiles')
            .select(
              'id, full_name, username, role'
            )
            .in(
              'id',
              peerIds
            )

          if (profileError) {
            console.error(
              'Failed to load chat profiles:',
              profileError
            )
          } else {
            loadedContacts =
              (
                peerProfiles || []
              ).map(
                (person) => ({
                  id:
                    person.id,
                  full_name:
                    person.full_name ||
                    person.username ||
                    'Student',
                  username:
                    person.username ||
                    '',
                  role:
                    person.role ||
                    'student',
                  lastMessageAt:
                    latestByPeer.get(
                      person.id
                    ) || null,
                })
              )
          }
        }

        /*
         * Teacher is ALWAYS available.
         */
        if (
          teacher?.id
        ) {
          const teacherContact = {
            id:
              teacher.id,
            full_name:
              teacher.full_name ||
              teacher.username ||
              'Teacher',
            username:
              teacher.username ||
              '',
            role:
              'teacher',
            lastMessageAt:
              latestByPeer.get(
                teacher.id
              ) || null,
          }

          const teacherAlreadyLoaded =
            loadedContacts.some(
              (contact) =>
                contact.id ===
                teacher.id
            )

          if (
            !teacherAlreadyLoaded
          ) {
            loadedContacts.push(
              teacherContact
            )
          }
        }

        /*
         * Sort newest conversation first.
         * Teacher with no messages goes after
         * existing conversations.
         */
        loadedContacts.sort(
          (a, b) => {
            const aTime =
              a.lastMessageAt
                ? new Date(
                    a.lastMessageAt
                  ).getTime()
                : 0

            const bTime =
              b.lastMessageAt
                ? new Date(
                    b.lastMessageAt
                  ).getTime()
                : 0

            return (
              bTime - aTime
            )
          }
        )

        if (
          cancelled
        ) {
          return
        }

        /*
         * INITIAL LOAD ONLY.
         *
         * This is the only place where we replace
         * the complete list.
         */
        setChatContacts(
          loadedContacts
        )
      } catch (err) {
        if (
          cancelled
        ) {
          return
        }

        console.error(
          'Chat contacts error:',
          err
        )
      }
    }

  /*
   * Initial database load.
   */
  loadChatContacts()

  /*
   * REALTIME:
   *
   * New messages are MERGED into the existing
   * chat list.
   *
   * We do NOT call loadChatContacts() here.
   * That is important because doing so can replace
   * the existing list and make old conversations
   * disappear.
   */
  const channel =
    supabase
      .channel(
        `student-chat-contacts-${profile.id}`
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        async (payload) => {
          const message =
            payload.new

          const involvesMe =
            message.sender_id ===
              profile.id ||
            message.receiver_id ===
              profile.id

          if (
            !involvesMe
          ) {
            return
          }

          const peerId =
            message.sender_id ===
            profile.id
              ? message.receiver_id
              : message.sender_id

          if (
            !peerId ||
            peerId === profile.id
          ) {
            return
          }

          /*
           * Get the person's profile.
           */
          const {
            data: person,
            error: personError,
          } = await supabase
            .from('profiles')
            .select(
              'id, full_name, username, role'
            )
            .eq(
              'id',
              peerId
            )
            .maybeSingle()

          if (
            personError
          ) {
            console.error(
              'Failed to load new chat contact:',
              personError
            )
            return
          }

          if (
            person
          ) {
            addContactFromProfile(
              person,
              message.created_at ||
                null
            )
          }
        }
      )
      .subscribe()

  return () => {
    cancelled = true

    supabase.removeChannel(
      channel
    )
  }
}, [
  profile?.id,
  teacher?.id,
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

const studentId =
  link
    .split(':')[1]

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

        setChatPeer({
          id: student.id,
          full_name:
            student.full_name ||
            student.username ||
            'Student',
          username:
            student.username ||
            '',
        })

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

  const tabs = useMemo(
    () => [
      {
        key: 'homework',
        label: 'Homework',
      },
      {
        key: 'wordlists',
        label: 'Word lists',
      },
      {
        key: 'leaderboard',
        label: 'Leaderboard',
      },
      {
        key: 'group-chat',
        label: 'Group chat',
      },
      {
        key: 'chats',
        label: 'Chats',
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
      setTab(nextTab)

      /*
       * Do NOT erase chatPeer when switching between
       * leaderboard and chats.
       *
       * If the student clicked another student in the
       * leaderboard, we want that person to remain selected.
       */
    }

  /*
   * ============================================================
   * LOADING
   * ============================================================
   */

  if (loading) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center text-mist">
        Loading…
      </div>
    )
  }

  /*
   * ============================================================
   * RENDER
   * ============================================================
   */

  return (
    <Layout
      tabs={tabs}
      activeTab={tab}
      onTabChange={handleTabChange}
    >
      <div className="space-y-5">

        {/* ======================================================
            PAGE INTRO
           ====================================================== */}
        <section className="dashboard-hero relative overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
  <div className="hero-atmosphere" />
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-brass/10 blur-3xl" />
            <div className="absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-sage/10 blur-3xl" />
          </div>

          <div className="relative px-5 py-4 sm:px-7 sm:py-5">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-brass-dim/25 bg-brass/10 px-2.5 py-1 text-[9px] uppercase tracking-[0.2em] text-brass font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-brass" />
                  Candidate portal
                </div>

                <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-2">
                  {tab === 'homework'
                    ? 'Your homework'
                    : tab === 'wordlists'
                      ? 'Word lists'
                      : tab === 'leaderboard'
                        ? 'Leaderboard'
                        : tab === 'group-chat'
                          ? 'Group chat'
                          : 'Chats'}
                </h1>

                <p className="mt-1.5 text-sm text-mist leading-6 max-w-2xl">
                  {tab === 'homework'
                    ? 'Keep track of your assignments and submit your work on time.'
                    : tab === 'wordlists'
                      ? 'Build your vocabulary and strengthen your English.'
                      : tab === 'leaderboard'
                        ? 'See your progress alongside your classmates.'
                        : tab === 'group-chat'
                          ? 'Stay connected with your group and classmates.'
                          : 'Private conversations with your teacher and other students.'}
                </p>
              </div>

              {tab === 'homework' && myGroups.length > 0 && (
                <div className="flex items-center gap-3">
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

                      setChatPeer({
                        id: student.student_id,
                        full_name:
                          student.full_name ||
                          student.username ||
                          'Student',
                        username: student.username || '',
                      })

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
           ====================================================== */}
        {tab === 'group-chat' && (
          <section className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <GroupPicker />

              {activeGroup && (
                <div className="text-xs text-mist font-mono">
                  {myGroups.find((group) => group.id === activeGroup)?.name || 'Group'}
                </div>
              )}
            </div>

            <section className="rounded-3xl border border-line bg-panel shadow-sm overflow-hidden">
              <GroupChat
                groupId={activeGroup}
                selfId={profile.id}
                groupName={
                  myGroups.find(
                    (group) => group.id === activeGroup
                  )?.name
                }
              />
            </section>
          </section>
        )}

        {/* ======================================================
            PRIVATE CHATS
           ====================================================== */}
        {tab === 'chats' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4 px-1">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-brass font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-brass" />
                Messages
              </div>

              <div className="text-xs text-mist font-mono">
                {chatContacts.length}{' '}
                {chatContacts.length === 1
                  ? 'conversation'
                  : 'conversations'}
              </div>
            </div>

            <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-4">
              <section className="rounded-3xl border border-line bg-panel shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-line bg-panel-2/50">
                  <div className="font-display text-lg">
                    Conversations
                  </div>
                  <div className="text-xs text-mist mt-1">
                    Teacher and classmates
                  </div>
                </div>

                <div className="max-h-[560px] overflow-y-auto">
                  {chatContacts.length === 0 && (
                    <div className="px-5 py-10 text-sm text-mist text-center">
                      No chats yet.
                    </div>
                  )}

                  {chatContacts.map((contact) => {
                    const isTeacher =
                      contact.id === teacher?.id

                    const isSelected =
                      chatPeer?.id === contact.id ||
                      (!chatPeer && isTeacher)

                    return (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => {
                          if (isTeacher) {
                            setChatPeer(null)
                          } else {
                            setChatPeer({
                              id: contact.id,
                              full_name:
                                contact.full_name ||
                                contact.username ||
                                'Student',
                              username:
                                contact.username || '',
                            })
                          }
                        }}
                        className={`w-full text-left px-4 py-3.5 border-b border-line last:border-b-0 transition-colors ${
                          isSelected
                            ? 'bg-brass/10'
                            : 'hover:bg-panel-2/70'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`relative w-11 h-11 rounded-2xl flex items-center justify-center font-semibold shrink-0 ${
                              isTeacher
                                ? 'bg-ink text-brass border border-brass-dim/30'
                                : 'bg-brass text-onbrass'
                            }`}
                          >
                            {(
                              contact.full_name ||
                              contact.username ||
                              'S'
                            )
                              .charAt(0)
                              .toUpperCase()}

                            {isSelected && (
                              <span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-panel bg-brass" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="text-paper font-medium truncate">
                              {contact.full_name ||
                                contact.username ||
                                'Student'}
                            </div>

                            {isTeacher ? (
                              <div className="text-xs text-brass mt-0.5">
                                Teacher
                              </div>
                            ) : (
                              <div className="text-xs text-mist font-mono truncate mt-0.5">
                                {contact.username
                                  ? `@${contact.username}`
                                  : 'Student'}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>

              <section className="rounded-3xl border border-line bg-panel shadow-sm overflow-hidden min-w-0 min-h-[520px]">
                <Chat
                  selfId={profile.id}
                  peerId={chatPeer?.id || teacher?.id}
                  peerName={
                    chatPeer?.full_name ||
                    teacher?.full_name ||
                    'Teacher'
                  }
                />
              </section>
            </div>
          </section>
        )}
      </div>
    </Layout>
  )
}

