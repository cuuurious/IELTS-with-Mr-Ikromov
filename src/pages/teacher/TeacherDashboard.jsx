import { Suspense, useEffect, useState } from 'react'
import { lazyWithReload } from '../../lib/lazyWithReload'
import LoadingScreen from '../../components/LoadingScreen'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout, {
  IconHome,
  IconGroups,
  IconStudents,
  IconWordlist,
  IconGroupChat,
  IconChat,
  IconLeaderboard,
  IconAI,
  IconApprovals,
  IconStaff,
  IconMockExam,
  IconHelp,
} from '../../components/Layout'
import GroupWorkspace from './GroupWorkspace'
import TeacherHome from './TeacherHome'
import { useSessionState, writeSession } from '../../lib/sessionState'

const TeacherStudents = lazyWithReload(() => import('./TeacherStudents'))
const PendingApprovals = lazyWithReload(() => import('./PendingApprovals'))
const PrivateChats = lazyWithReload(() => import('../../components/PrivateChats'))
const GroupChats = lazyWithReload(() => import('../../components/GroupChats'))
const TeacherLeaderboards = lazyWithReload(() => import('./TeacherLeaderboards'))
const TeacherWordlists = lazyWithReload(() => import('./TeacherWordlists'))
const AiGradingSettings = lazyWithReload(() => import('./AiGradingSettings'))
const TeacherAccounts = lazyWithReload(() => import('./TeacherAccounts'))
const TeacherMockCenter = lazyWithReload(() => import('./TeacherMockCenter'))
const MaterialsLibrary = lazyWithReload(() => import('./MaterialsLibrary'))
const ClientErrors = lazyWithReload(() => import('./ClientErrors'))
const HowToUseGuide = lazyWithReload(() => import('../../components/HowToUseGuide'))

export default function TeacherDashboard() {
  const { profile } = useAuth()

  // Remembered across a refresh (see lib/sessionState.js).
  const [tab, setTab] = useSessionState(`ielts:${profile?.id}:teacher:tab`, 'home')
  const [pendingCount, setPendingCount] = useState(0)
  const [mockCenterOpen, setMockCenterOpen] = useSessionState(`ielts:${profile?.id}:teacher:mockCenterOpen`, false)

  const [notificationChat, setNotificationChat] = useState(null)
  const [notificationGroup, setNotificationGroup] = useState(null)

  useEffect(() => {
    const refresh = () =>
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then(({ count }) => {
          setPendingCount(count || 0)
        })

    refresh()

    const channel = supabase
      .channel('profiles-pending')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
        },
        refresh
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    const handleNotificationNavigation = async (event) => {
      const notification = event.detail?.notification

      const link =
        event.detail?.link ||
        notification?.link ||
        ''

      if (!link) return

      /*
       * PRIVATE CHAT
       *
       * private-chat:STUDENT_ID:MESSAGE_ID
       */
      if (link.startsWith('private-chat:')) {
        const parts = link.split(':')

        const studentId = parts[1]
        const messageId = parts[2]

        if (!studentId) return

        const { data: student, error } =
          await supabase
            .from('profiles')
            .select(
              'id, full_name, username'
            )
            .eq('id', studentId)
            .single()

        if (error || !student) {
          console.error(
            'Could not find private-chat student:',
            studentId,
            error
          )
          return
        }

        setNotificationChat({
          studentId: student.id,
          studentName: student.full_name,
          messageId: messageId || null,
        })

        setNotificationGroup(null)
        setTab('chat')

        return
      }

      /*
       * GROUP CHAT
       *
       * group-chat:GROUP_ID:MESSAGE_ID
       */
      if (link.startsWith('group-chat:')) {
        const parts = link.split(':')

        const groupId = parts[1]
        const messageId = parts[2]

        if (!groupId) return

        const { data: group, error } =
          await supabase
            .from('groups')
            .select('id, name')
            .eq('id', groupId)
            .single()

        if (error || !group) {
          console.error(
            'Could not find notification group:',
            groupId,
            error
          )
          return
        }

        setNotificationGroup({
          groupId: group.id,
          groupName: group.name,
          messageId: messageId || null,
        })

        setNotificationChat(null)
        setTab('group-chat')

        return
      }

      /*
       * Existing generic app links.
       */
      if (link === '/app') {
        setTab('groups')
      }
    }

    window.addEventListener(
      'notification-navigate',
      handleNotificationNavigation
    )

    // A push notification may have arrived (and dispatched this event)
    // before this listener existed — main.jsx stashes it here for
    // exactly that case, so pick it up now instead of losing it.
    if (window.__pendingNav) {
      const pendingLink = window.__pendingNav
      window.__pendingNav = null
      handleNotificationNavigation({ detail: { link: pendingLink } })
    }

    return () => {
      window.removeEventListener(
        'notification-navigate',
        handleNotificationNavigation
      )
    }
  }, [])

  /*
   * "Chat with student" button on a student's profile (Students tab)
   * jumps to the Chat tab with that student already selected — same
   * mechanism a push-notification deep link uses above, just
   * triggered by a click instead of an incoming notification.
   */
  const handleStartChat = (student) => {
    if (!student?.id) return

    setNotificationChat({
      studentId: student.id,
      studentName: student.full_name,
      messageId: null,
    })

    setNotificationGroup(null)
    setTab('chat')
  }

  // Grouped for the sidebar (see Layout.jsx) instead of one flat row of
  // pill tabs — the old shape stopped scaling once there were 8-9 of
  // these, and it's only going to grow (Mock Exams, Speaking/Writing
  // examiner views, etc.).
  const sections = [
    {
      title: 'Teaching',
      items: [
        // Overview of every group (2026-10-06) — the teacher's Home.
        { key: 'home', label: 'Home', icon: IconHome, hideTitle: true },
        { key: 'groups', label: 'Groups & Homework', icon: IconGroups },
        { key: 'students', label: 'Students', icon: IconStudents },
        { key: 'wordlists', label: 'Word Lists', icon: IconWordlist },
        // All teaching files in one place — uploaded here or forwarded
        // from Telegram to the bot (2026-09-30).
        { key: 'materials', label: 'Materials Library', icon: IconFolder },
      ],
    },
    {
      title: 'Communication',
      items: [
        { key: 'group-chat', label: 'Group Chats', icon: IconGroupChat },
        { key: 'chat', label: 'Chat', icon: IconChat },
      ],
    },
    {
      title: 'Insights',
      items: [
        { key: 'leaderboards', label: 'Leaderboards', icon: IconLeaderboard },
      ],
    },
    {
      title: 'Admin',
      items: [
        { key: 'ai-grading', label: 'AI Grading', icon: IconAI },
        {
          key: 'approvals',
          label: `Approvals${pendingCount ? ` (${pendingCount})` : ''}`,
          icon: IconApprovals,
        },
        // Only Jasur Ikromov's account (profile.is_admin) can see this —
        // see TeacherAccounts.jsx and the create-staff-account /
        // delete-staff-account edge functions, which both re-check this
        // independently of the UI hiding it here. Widened 2026-09-24
        // from "teacher accounts" to "staff accounts" (teacher +
        // speaking_examiner + writing_examiner all live here now).
        ...(profile.is_admin
          ? [
              { key: 'staff-accounts', label: 'Staff accounts', icon: IconStaff },
              // Errors students hit on their devices (lib/errorReporter.js).
              { key: 'errors', label: 'Errors', icon: IconAlert },
            ]
          : []),
      ],
    },
    {
      title: 'Reference',
      items: [
        // Same walkthrough students see in their own dashboard (see
        // src/components/HowToUseGuide.jsx) — kept here too so a teacher
        // can preview exactly what a new student sees, and grab the PDF
        // to distribute, without needing a student login.
        { key: 'howto', label: 'How to Use (Student Guide)', icon: IconHelp },
      ],
    },
  ]

  // From Home straight into one group's homework screen: Groups &
  // Homework restores the open group from sessionStorage when it mounts
  // (see GroupWorkspace's useSessionState keys), so set those first.
  const openGroup = (groupId) => {
    writeSession(`ielts:${profile.id}:groups:activeGroup`, groupId)
    writeSession(`ielts:${profile.id}:groups:screen`, 'detail')
    handleTabChange('groups')
  }

  const handleTabChange = (nextTab) => {
    // Mock Center is its own full-screen portal (see TeacherMockCenter.jsx)
    // — nothing about groups, leaderboards or homework belongs in it, per
    // Jasur's own words, so it never becomes a regular sidebar tab.
    if (nextTab === 'mock-center') {
      setMockCenterOpen(true)
      return
    }

    setTab(nextTab)

    if (nextTab !== 'chat') {
      setNotificationChat(null)
    }

    if (nextTab !== 'group-chat') {
      setNotificationGroup(null)
    }
  }

  if (mockCenterOpen) {
    return (
      <Suspense fallback={<LoadingScreen label="Opening Mock Center…" />}>
        <TeacherMockCenter onExit={() => setMockCenterOpen(false)} />
      </Suspense>
    )
  }

  return (
    <Layout
      sections={sections}
      activeTab={tab}
      onTabChange={handleTabChange}
      spotlight={{
        key: 'mock-center',
        label: 'Mock Center',
        description: 'Student mock results, all in one place',
        icon: IconMockExam,
      }}
    >
      {/* Every tab except Groups & Homework is its own small download,
          fetched the first time it's opened (2026-09-30 speed-up). */}
      <Suspense fallback={<TabLoading />}>
      {tab === 'home' && (
        <TeacherHome
          profile={profile}
          pendingCount={pendingCount}
          onNavigate={handleTabChange}
          onOpenGroup={openGroup}
          onOpenMockCenter={() => setMockCenterOpen(true)}
        />
      )}

      {tab === 'groups' && (
        <GroupWorkspace
          teacherId={profile.id}
        />
      )}

      {tab === 'students' && (
        <TeacherStudents onStartChat={handleStartChat} />
      )}

      {tab === 'wordlists' && (
        <TeacherWordlists
          teacherId={profile.id}
        />
      )}

      {tab === 'materials' && <MaterialsLibrary />}

      {tab === 'leaderboards' && (
        <TeacherLeaderboards />
      )}

      {tab === 'ai-grading' && (
        <AiGradingSettings
          teacherId={profile.id}
        />
      )}

      {tab === 'approvals' && (
        <PendingApprovals />
      )}

      {tab === 'group-chat' && (
        <GroupChats
          selfId={profile.id}
          selfRole="teacher"
          initialGroupId={
            notificationGroup?.groupId
          }
          initialGroupName={
            notificationGroup?.groupName
          }
          initialMessageId={
            notificationGroup?.messageId
          }
        />
      )}

      {tab === 'chat' && (
        <PrivateChats
          selfId={profile.id}
          selfRole="teacher"
          initialPeerId={
            notificationChat?.studentId
          }
          initialPeerName={
            notificationChat?.studentName
          }
          initialMessageId={
            notificationChat?.messageId
          }
        />
      )}

      {tab === 'staff-accounts' && profile.is_admin && (
        <TeacherAccounts
          currentTeacherId={profile.id}
        />
      )}

      {tab === 'errors' && profile.is_admin && <ClientErrors />}

      {tab === 'howto' && <HowToUseGuide />}
      </Suspense>
    </Layout>
  )
}

function TabLoading() {
  return <div className="py-16 text-center text-sm text-mist">Loading…</div>
}

function IconAlert({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

function IconFolder({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2.5h8a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10Z" />
      <path d="M3 10.5h18" />
    </svg>
  )
}
