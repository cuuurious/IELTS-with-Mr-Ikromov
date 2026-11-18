import { Suspense, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import LoadingScreen from '../../components/LoadingScreen'
import { lazyWithReload } from '../../lib/lazyWithReload'

const SpeakingExaminerDashboard = lazyWithReload(() => import('./SpeakingExaminerDashboard'))
const WritingExaminerDashboard = lazyWithReload(() => import('./WritingExaminerDashboard'))

/*
 * One examiner account can be a speaking examiner, a writing examiner, or
 * both (the teacher ticks the skills in Staff accounts — migration 135).
 * With both, the examiner gets a small switch to move between the two
 * dashboards; with one, it simply opens that dashboard.
 */
const VIEW_KEY = 'ielts:examinerView'

export default function ExaminerRouter() {
  const { profile } = useAuth()
  const primary = profile?.role === 'writing_examiner' ? 'writing' : 'speaking'
  const [skills, setSkills] = useState(null)
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem(VIEW_KEY) || ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    if (!profile?.id) return
    let alive = true
    supabase
      .from('examiner_skills')
      .select('skill')
      .eq('user_id', profile.id)
      .then(({ data }) => {
        if (!alive) return
        const list = (data || []).map((r) => r.skill)
        setSkills(list.length ? list : [primary])
      })
    return () => {
      alive = false
    }
  }, [profile?.id, primary])

  if (!skills) return <LoadingScreen label="Loading your dashboard…" />

  const both = skills.includes('speaking') && skills.includes('writing')
  const active = both ? (view === 'writing' || view === 'speaking' ? view : primary) : skills[0]

  const choose = (next) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* private window: the switch still works for this visit */
    }
  }

  const Dashboard = active === 'writing' ? WritingExaminerDashboard : SpeakingExaminerDashboard

  return (
    <>
      <Suspense fallback={<LoadingScreen />}>
        <Dashboard key={active} />
      </Suspense>
      {both && (
        <div className="fixed bottom-4 right-4 z-40 flex rounded-full border border-line bg-panel p-1 shadow-lg" role="tablist" aria-label="Examiner view">
          {[
            { key: 'speaking', label: 'Speaking' },
            { key: 'writing', label: 'Writing' },
          ].map((o) => (
            <button
              key={o.key}
              type="button"
              role="tab"
              aria-selected={active === o.key}
              onClick={() => choose(o.key)}
              className={`focus-ring rounded-full px-4 py-2 text-sm font-extrabold transition ${
                active === o.key ? 'bg-brass text-onbrass shadow-sm' : 'text-paper-dim hover:text-paper'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
