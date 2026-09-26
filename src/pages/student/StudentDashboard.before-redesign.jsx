import {
  useEffect,
  useMemo,
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
                  ? 'bg-brass text-onbrass border-brass font-medium'
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
      onTabChange={
        handleTabChange
      }
    >

      {/* ======================================================
          HOMEWORK
         ====================================================== */}

      {tab === 'homework' && (
        <div className="flex flex-col gap-5">

          <GroupPicker />

          {myGroups.length === 0 && (
            <p className="text-mist">
              You're not in a group yet.
              Ask Mr Ikromov to add you
              to one.
            </p>
          )}

          {homeworks.length === 0 &&
            myGroups.length > 0 && (
              <p className="text-mist">
                No homework posted for
                this group yet.
              </p>
            )}

          {homeworks.map(
            (homework) => (
              <HomeworkCard
                key={
                  homework.id
                }
                homework={
                  homework
                }
                submission={
                  submissions[
                    homework.id
                  ]
                }
                studentId={
                  profile.id
                }
                onChange={
                  updateSubmission
                }
              />
            )
          )}

        </div>
      )}

      {/* ======================================================
          WORD LISTS
         ====================================================== */}

      {tab === 'wordlists' && (
        <StudentWordlists
          studentId={
            profile.id
          }
        />
      )}

      {/* ======================================================
          LEADERBOARD
         ====================================================== */}

      {tab === 'leaderboard' && (
        <div>

          <GroupPicker />

          {activeGroup ? (
            <Leaderboard
              groupId={
                activeGroup
              }
              highlightStudentId={
                profile.id
              }
              onOpenChat={(
                student
              ) => {
                if (
                  !student?.student_id
                ) {
                  return
                }

                /*
                 * IMPORTANT:
                 *
                 * Store the actual student selected
                 * from the leaderboard.
                 */
                setChatPeer({
                  id:
                    student.student_id,

                  full_name:
                    student.full_name ||
                    student.username ||
                    'Student',

                  username:
                    student.username ||
                    '',
                })

                /*
                 * Open the Chats tab.
                 */
                setTab('chats')
              }}
            />
          ) : (
            <p className="text-mist">
              You're not in a group yet.
            </p>
          )}

        </div>
      )}

      {/* ======================================================
          GROUP CHAT
         ====================================================== */}

      {tab === 'group-chat' && (
        <div>

          <GroupPicker />

          <GroupChat
            groupId={
              activeGroup
            }
            selfId={
              profile.id
            }
            groupName={
              myGroups.find(
                (group) =>
                  group.id ===
                  activeGroup
              )?.name
            }
          />

        </div>
      )}

      {/* ======================================================
          PRIVATE CHATS
         ====================================================== */}

      {tab === 'chats' && (
  <div className="flex flex-col gap-4">

    {/* ==================================================
        CHAT LIST
       ================================================== */}

    <div className="bg-panel border border-line rounded-xl overflow-hidden">

      <div className="px-5 py-4 border-b border-line">
        <div className="text-xl font-display">
          Chats
        </div>

        <div className="text-sm text-mist mt-1">
          Private conversations
        </div>
      </div>

      <div className="divide-y divide-line">

        {chatContacts.length === 0 && (
          <div className="px-5 py-6 text-mist">
            No chats yet.
          </div>
        )}

        {chatContacts.map(
          (contact) => {
            const isTeacher =
              contact.id ===
              teacher?.id

            const isSelected =
              chatPeer?.id ===
              contact.id ||
              (
                !chatPeer &&
                isTeacher
              )

            return (
              <button
                key={contact.id}
                type="button"
                onClick={() => {
                  if (isTeacher) {
                    /*
                     * null means teacher.
                     */
                    setChatPeer(null)
                  } else {
                    /*
                     * Student selected.
                     */
                    setChatPeer({
                      id:
                        contact.id,
                      full_name:
                        contact.full_name ||
                        contact.username ||
                        'Student',
                      username:
                        contact.username ||
                        '',
                    })
                  }
                }}
                className={`w-full text-left px-5 py-4 transition-colors ${
                  isSelected
                    ? 'bg-brass/10'
                    : 'hover:bg-panel-2'
                }`}
              >

                <div className="flex items-center gap-3">

                  {/* AVATAR */}

                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                      isTeacher
                        ? 'bg-ink text-brass border border-line'
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
                  </div>

                  {/* NAME */}

                  <div className="min-w-0">

                    <div className="text-paper font-medium truncate">
                      {contact.full_name ||
                        contact.username ||
                        'Student'}
                    </div>

                    {isTeacher ? (
                      <div className="text-xs text-brass">
                        Teacher
                      </div>
                    ) : (
                      <div className="text-xs text-mist font-mono truncate">
                        {contact.username
                          ? `@${contact.username}`
                          : 'Student'}
                      </div>
                    )}

                  </div>

                </div>

              </button>
            )
          }
        )}

      </div>

    </div>

    {/* ==================================================
        ACTIVE CHAT
       ================================================== */}

    <div className="bg-panel border border-line rounded-xl overflow-hidden">

      <Chat
        selfId={
          profile.id
        }
        peerId={
          chatPeer?.id ||
          teacher?.id
        }
        peerName={
          chatPeer?.full_name ||
          teacher?.full_name ||
          'Teacher'
        }
      />

        </div>

  </div>
)}

    </Layout>
  )
}