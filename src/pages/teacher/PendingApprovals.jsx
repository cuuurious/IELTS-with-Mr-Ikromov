import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function PendingApprovals() {
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    setPending(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const decide = async (id, status) => {
    await supabase.from('profiles').update({ status }).eq('id', id)
    setPending((prev) => prev.filter((p) => p.id !== id))
  }

  if (loading) return <p className="text-mist">Loading…</p>

  if (pending.length === 0) {
    return <p className="text-mist">No pending sign-ups. New accounts will show up here.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {pending.map((p) => (
        <div
          key={p.id}
          className="ticket rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap"
        >
          <div>
            <div className="font-display text-lg">{p.full_name}</div>
            <div className="text-mist text-sm font-mono">
              @{p.username} · {p.role}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => decide(p.id, 'approved')}
              className="focus-ring px-3 py-1.5 rounded-md bg-sage text-onbrass text-sm font-medium hover:opacity-90"
            >
              Approve
            </button>
            <button
              onClick={() => decide(p.id, 'rejected')}
              className="focus-ring px-3 py-1.5 rounded-md border border-coral text-coral text-sm hover:bg-coral hover:text-paper transition-colors"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
