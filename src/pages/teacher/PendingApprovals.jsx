import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function PendingApprovals() {
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, full_name, username, role, status, contact_email, created_at',
        { count: 'exact' }
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true })

    console.log('PENDING APPROVALS:', {
      data,
      error,
      count: data?.length ?? 0,
    })

    if (error) {
      console.error('Failed to load pending approvals:', error)
      setError(error.message)
      setPending([])
    } else {
      setPending(data || [])
    }

    setLoading(false)
  }

  useEffect(() => {
    load()

    const channel = supabase
      .channel('pending-approvals')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
        },
        () => {
          load()
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error(
            'Pending approvals realtime channel failed'
          )
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const decide = async (id, status) => {
    setError('')
    setActionId(id)

    const { error } = await supabase
      .from('profiles')
      .update({ status })
      .eq('id', id)

    if (error) {
      console.error(`Failed to ${status} student:`, error)

      setError(
        `Could not ${
          status === 'approved'
            ? 'approve'
            : 'reject'
        } this student: ${error.message}`
      )

      setActionId(null)
      return
    }

    setPending((prev) =>
      prev.filter((student) => student.id !== id)
    )

    setActionId(null)
  }

  if (loading) {
    return (
      <p className="text-mist">
        Loading...
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">

      {error && (
        <div className="rounded-lg border border-coral bg-panel-2 px-4 py-3 text-sm text-coral">
          {error}
        </div>
      )}

      {pending.length === 0 ? (
        <div className="ticket rounded-lg p-5">
          <div className="font-medium text-paper">
            No pending sign-ups
          </div>

          <p className="text-mist text-sm mt-1">
            New student registration requests will appear
            here automatically.
          </p>
        </div>
      ) : (
        pending.map((student) => (
          <div
            key={student.id}
            className="ticket rounded-lg p-4 flex items-center justify-between gap-4 flex-wrap"
          >

            <div className="min-w-0">

              <div className="font-display text-lg text-paper">
                {student.full_name || 'Unnamed student'}
              </div>

              <div className="text-mist text-sm font-mono mt-1">
                @{student.username || 'no username'}
                {' · '}
                {student.role || 'student'}
              </div>

              {student.contact_email && (
                <div className="text-mist text-xs mt-1 break-all">
                  {student.contact_email}
                </div>
              )}

              {student.created_at && (
                <div className="text-mist text-xs mt-1">
                  Requested{' '}
                  {new Date(
                    student.created_at
                  ).toLocaleString()}
                </div>
              )}

            </div>

            <div className="flex gap-2 shrink-0">

              <button
                type="button"
                disabled={actionId === student.id}
                onClick={() =>
                  decide(student.id, 'approved')
                }
                className="focus-ring px-4 py-2 rounded-md bg-sage text-onbrass text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {actionId === student.id
                  ? 'Please wait...'
                  : 'Approve'}
              </button>

              <button
                type="button"
                disabled={actionId === student.id}
                onClick={() =>
                  decide(student.id, 'rejected')
                }
                className="focus-ring px-4 py-2 rounded-md border border-coral text-coral text-sm hover:bg-coral hover:text-paper transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Reject
              </button>

            </div>

          </div>
        ))
      )}

    </div>
  )
}