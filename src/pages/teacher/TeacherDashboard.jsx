import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout from '../../components/Layout'
import GroupWorkspace from './GroupWorkspace'
import TeacherStudents from './TeacherStudents'
import PendingApprovals from './PendingApprovals'
import TeacherChat from './TeacherChat'
import TeacherGroupChats from './TeacherGroupChats'
import TeacherLeaderboards from './TeacherLeaderboards'
import TeacherWordlists from './TeacherWordlists'

export default function TeacherDashboard() {
  const { profile } = useAuth()

  const [tab, setTab] = useState('groups')
  const [pendingCount, setPendingCount] = useState(0)

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

    return () => {
      window.removeEventListener(
        'notification-navigate',
        handleNotificationNavigation
      )
    }
  }, [])

  const tabs = [
    {
      key: 'groups',
      label: 'Groups & homework',
    },
    {
      key: 'students',
      label: 'Students',
    },
    {
      key: 'wordlists',
      label: 'Word lists',
    },
    {
      key: 'leaderboards',
      label: 'Leaderboards',
    },
    {
      key: 'approvals',
      label: `Approvals${
        pendingCount
          ? ` (${pendingCount})`
          : ''
      }`,
    },
    {
      key: 'group-chat',
      label: 'Group chats',
    },
    {
      key: 'chat',
      label: 'Chat',
    },
  ]

  const handleTabChange = (nextTab) => {
    setTab(nextTab)

    if (nextTab !== 'chat') {
      setNotificationChat(null)
    }

    if (nextTab !== 'group-chat') {
      setNotificationGroup(null)
    }
  }

  return (
    <Layout
      tabs={tabs}
      activeTab={tab}
      onTabChange={handleTabChange}
    >
      {tab === 'groups' && (
        <GroupWorkspace
          teacherId={profile.id}
        />
      )}

      {tab === 'students' && (
        <TeacherStudents />
      )}

      {tab === 'wordlists' && (
        <TeacherWordlists
          teacherId={profile.id}
        />
      )}

      {tab === 'leaderboards' && (
        <TeacherLeaderboards />
      )}

      {tab === 'approvals' && (
        <PendingApprovals />
      )}

      {tab === 'group-chat' && (
        <TeacherGroupChats
          teacherId={profile.id}
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
        <TeacherChat
          teacherId={profile.id}
          initialStudentId={
            notificationChat?.studentId
          }
          initialStudentName={
            notificationChat?.studentName
          }
          initialMessageId={
            notificationChat?.messageId
          }
        />
      )}
    </Layout>
  )
}