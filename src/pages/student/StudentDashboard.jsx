import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import Layout from '../../components/Layout'
import HomeworkCard from './HomeworkCard'
import Chat from '../../components/Chat'
import GroupChat from '../../components/GroupChat'
import Leaderboard from '../../components/Leaderboard'
import StudentWordlists from './StudentWordlists'

export default function StudentDashboard() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('homework')
  const [myGroups, setMyGroups] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)
  const [homeworks, setHomeworks] = useState([])
  const [submissions, setSubmissions] = useState({})
  const [teacher, setTeacher] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: gm } = await supabase
        .from('group_members')
        .select('group_id, groups(id, name)')
        .eq('student_id', profile.id)
      const groups = (gm || []).map((r) => r.groups).filter(Boolean)
      setMyGroups(groups)
      setActiveGroup(groups[0]?.id || null)

      const { data: teacherRow } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'teacher')
        .eq('status', 'approved')
        .limit(1)
        .maybeSingle()
      setTeacher(teacherRow)

      setLoading(false)
    }
    load()
  }, [profile.id])

  useEffect(() => {
    if (!activeGroup) return
    const load = async () => {
      const { data: hw } = await supabase
        .from('homeworks')
        .select('*')
        .eq('group_id', activeGroup)
        .order('created_at', { ascending: false })
      setHomeworks(hw || [])

      const { data: subs } = await supabase
        .from('submissions')
        .select('*')
        .eq('student_id', profile.id)
        .eq('group_id', activeGroup)
      const map = {}
      ;(subs || []).forEach((s) => (map[s.homework_id] = s))
      setSubmissions(map)
    }
    load()
  }, [activeGroup, profile.id])

  const tabs = useMemo(
    () => [
      { key: 'homework', label: 'Homework' },
      { key: 'wordlists', label: 'Word lists' },
      { key: 'leaderboard', label: 'Leaderboard' },
      { key: 'group-chat', label: 'Group chat' },
      { key: 'chat', label: 'Chat with teacher' },
    ],
    []
  )

  const updateSubmission = (sub) => {
    setSubmissions((prev) => ({ ...prev, [sub.homework_id]: sub }))
  }

  const GroupPicker = () =>
    myGroups.length > 1 ? (
      <div className="flex gap-2 flex-wrap mb-5">
        {myGroups.map((g) => (
          <button
            key={g.id}
            onClick={() => setActiveGroup(g.id)}
            className={`focus-ring px-3 py-1.5 rounded-full text-sm border transition-colors ${
              activeGroup === g.id
                ? 'bg-brass text-onbrass border-brass font-medium'
                : 'border-line text-mist hover:text-paper'
            }`}
          >
            {g.name}
          </button>
        ))}
      </div>
    ) : null

  if (loading) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center text-mist">
        Loading…
      </div>
    )
  }

  return (
    <Layout tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === 'homework' && (
        <div className="flex flex-col gap-5">
          <GroupPicker />

          {myGroups.length === 0 && (
            <p className="text-mist">
              You're not in a group yet. Ask Mr Ikromov to add you to one.
            </p>
          )}

          {homeworks.length === 0 && myGroups.length > 0 && (
            <p className="text-mist">No homework posted for this group yet.</p>
          )}

          {homeworks.map((hw) => (
            <HomeworkCard
              key={hw.id}
              homework={hw}
              submission={submissions[hw.id]}
              studentId={profile.id}
              onChange={updateSubmission}
            />
          ))}
        </div>
      )}

      {tab === 'wordlists' && <StudentWordlists studentId={profile.id} />}

      {tab === 'leaderboard' && (
        <div>
          <GroupPicker />
          {activeGroup ? (
            <Leaderboard groupId={activeGroup} highlightStudentId={profile.id} />
          ) : (
            <p className="text-mist">You're not in a group yet.</p>
          )}
        </div>
      )}

      {tab === 'group-chat' && (
        <div>
          <GroupPicker />
          <GroupChat
            groupId={activeGroup}
            selfId={profile.id}
            groupName={myGroups.find((g) => g.id === activeGroup)?.name}
          />
        </div>
      )}

      {tab === 'chat' && (
        <Chat selfId={profile.id} peerId={teacher?.id} peerName={teacher?.full_name || 'Teacher'} />
      )}
    </Layout>
  )
}
