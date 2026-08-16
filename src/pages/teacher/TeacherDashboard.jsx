import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout from '../../components/Layout'
import GroupWorkspace from './GroupWorkspace'
import PendingApprovals from './PendingApprovals'
import TeacherChat from './TeacherChat'
import TeacherGroupChats from './TeacherGroupChats'
import TeacherLeaderboards from './TeacherLeaderboards'
import TeacherWordlists from './TeacherWordlists'

export default function TeacherDashboard() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('groups')
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    const refresh = () =>
      supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then(({ count }) => setPendingCount(count || 0))
    refresh()
    const channel = supabase
      .channel('profiles-pending')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refresh)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const tabs = [
    { key: 'groups', label: 'Groups & homework' },
    { key: 'wordlists', label: 'Word lists' },
    { key: 'leaderboards', label: 'Leaderboards' },
    { key: 'approvals', label: `Approvals${pendingCount ? ` (${pendingCount})` : ''}` },
    { key: 'group-chat', label: 'Group chats' },
    { key: 'chat', label: 'Chat' },
  ]

  return (
    <Layout tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === 'groups' && <GroupWorkspace teacherId={profile.id} />}
      {tab === 'wordlists' && <TeacherWordlists teacherId={profile.id} />}
      {tab === 'leaderboards' && <TeacherLeaderboards />}
      {tab === 'approvals' && <PendingApprovals />}
      {tab === 'group-chat' && <TeacherGroupChats teacherId={profile.id} />}
      {tab === 'chat' && <TeacherChat teacherId={profile.id} />}
    </Layout>
  )
}
