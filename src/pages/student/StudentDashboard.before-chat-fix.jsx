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
 * Other students are automatically added when there is
 * at least one message between the current student and them.
 * ============================================================
 */

useEffect(() => {
  if (!profile?.id) return

  const loadChatContacts = async () => {
    try {
      /*
       * Get all private messages involving this student.
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
       * Find every person this student has exchanged
       * messages with.
       */
      const peerIds = []

      ;(messages || []).forEach(
        (message) => {
          const peerId =
            message.sender_id ===
            profile.id
              ? message.receiver_id
              : message.sender_id

          if (
            peerId &&
            peerId !== profile.id &&
            !peerIds.includes(peerId)
          ) {
            peerIds.push(peerId)
          }
        }
      )

      let contacts = []

      if (peerIds.length > 0) {
        const {
          data: profiles,
          error: profilesError,
        } = await supabase
          .from('profiles')
          .select(
            'id, full_name, username, role'
          )
          .in(
            'id',
            peerIds
          )

        if (profilesError) {
          console.error(
            'Failed to load chat profiles:',
            profilesError
          )
        } else {
          contacts =
            (profiles || []).sort(
              (a, b) =>
                peerIds.indexOf(
                  a.id
                ) -
                peerIds.indexOf(
                  b.id
                )
            )
        }
      }

      /*
       * Teacher must ALWAYS be available,
       * even if there are no messages yet.
       */
      if (teacher?.id) {
        const alreadyExists =
          contacts.some(
            (contact) =>
              contact.id ===
              teacher.id
          )

        if (!alreadyExists) {
          contacts.unshift(
            teacher
          )
        }
      }

      setChatContacts(
        contacts
      )
    } catch (err) {
      console.error(
        'Chat contacts error:',
        err
      )
    }
  }

  loadChatContacts()
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