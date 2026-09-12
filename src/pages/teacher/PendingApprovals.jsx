import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function PendingApprovals() {
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, full_name, username, role, status, contact_email, created_at, avatar_url',
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
      console.error(
        'Failed to load pending approvals:',
        error
      )

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
      console.error(
        `Failed to ${status} student:`,
        error
      )

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
      prev.filter(
        (student) => student.id !== id
      )
    )

    setActionId(null)
  }

  const filteredPending = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return pending
    }

    return pending.filter((student) => {
      return [
        student.full_name,
        student.username,
        student.contact_email,
        student.role,
      ]
        .filter(Boolean)
        .some((value) =>
          value
            .toLowerCase()
            .includes(query)
        )
    })
  }, [pending, search])

  const getInitial = (name, username) => {
    const source = (name || username || '?').trim()
    return source.charAt(0).toUpperCase() || '?'
  }

  if (loading) {
    return (
      <p className="text-mist">
        Loading...
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">

      {error && (
        <div className="rounded-xl border border-coral bg-coral/10 px-4 py-3 text-sm text-coral">
          {error}
        </div>
      )}

      <div className="ticket rounded-2xl p-5 sm:p-6 flex flex-col gap-5">

        <div className="flex items-center justify-between gap-4 flex-wrap">

          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
              Sign-ups
            </div>

            <h2 className="font-display text-2xl sm:text-3xl mt-1">
              Approvals
            </h2>

            <p className="text-sm text-mist mt-1.5 max-w-md">
              Review new student registrations before they can sign in and access their dashboard.
            </p>
          </div>

          <div
            className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-mono shadow-[0_6px_16px_-10px_rgba(0,0,0,0.5)] ${
              pending.length > 0
                ? 'border-coral/40 bg-coral/10 text-coral'
                : 'border-line bg-panel text-mist'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                pending.length > 0 ? 'bg-coral' : 'bg-sage'
              }`}
            />
            <strong>{pending.length}</strong>{' '}
            {pending.length === 1 ? 'pending' : 'pending'}
          </div>

        </div>

        <div className="border-t border-line pt-4 flex flex-col gap-3">

          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mist"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>

            <input
              type="text"
              value={search}
              onChange={(e) =>
                setSearch(e.target.value)
              }
              placeholder="Search by name, username, or email..."
              className="focus-ring w-full rounded-full border border-line bg-panel-2 py-2.5 pl-10 pr-4 text-sm shadow-[inset_0_1px_3px_rgba(0,0,0,0.25)]"
            />
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">

            <span className="text-mist text-xs font-mono">
              {search.trim()
                ? `Showing ${filteredPending.length} of ${pending.length} pending requests`
                : `${pending.length} pending request${
                    pending.length === 1
                      ? ''
                      : 's'
                  }`}
            </span>

            {search && (
              <button
                type="button"
                onClick={() =>
                  setSearch('')
                }
                className="focus-ring text-xs text-brass hover:underline"
              >
                Clear search
              </button>
            )}

          </div>

        </div>

      </div>

      {pending.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-line p-8 text-center">

          <div className="font-display text-lg text-paper">
            No pending sign-ups
          </div>

          <p className="text-mist text-sm mt-1.5 max-w-sm mx-auto">
            New student registration requests will appear here automatically.
          </p>

        </div>
      ) : filteredPending.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-line p-8 text-center">

          <div className="font-display text-lg text-paper">
            No matching students
          </div>

          <p className="text-mist text-sm mt-1.5">
            No pending registration matches your search.
          </p>

          <button
            type="button"
            onClick={() =>
              setSearch('')
            }
            className="focus-ring mt-3 text-sm text-brass hover:underline"
          >
            Clear search
          </button>

        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredPending.map((student) => (
            <div
              key={student.id}
              className="group relative overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-panel-2 to-panel p-4 sm:p-5 shadow-[0_14px_32px_-22px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/[0.03] flex items-center justify-between gap-4 flex-wrap transition hover:-translate-y-0.5 hover:border-brass/40 hover:shadow-[0_20px_40px_-20px_rgba(0,0,0,0.65)]"
            >

              <div
                aria-hidden="true"
                className="pointer-events-none absolute -left-10 -top-14 h-40 w-40 rounded-full bg-brass/10 blur-3xl"
              />

              <div className="relative flex items-center gap-3.5 min-w-0">

                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-panel-2 font-display text-lg text-brass shadow-[0_6px_14px_-6px_rgba(0,0,0,0.5)]">
                  {student.avatar_url ? (
                    <img
                      src={student.avatar_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    getInitial(student.full_name, student.username)
                  )}
                </div>

                <div className="min-w-0">

                  <div className="font-display text-lg text-paper truncate">
                    {student.full_name ||
                      'Unnamed student'}
                  </div>

                  <div className="text-mist text-sm font-mono mt-0.5">
                    @{student.username ||
                      'no username'}
                    {' · '}
                    {student.role ||
                      'student'}
                  </div>

                  {student.contact_email && (
                    <div className="text-mist text-xs mt-1 break-all">
                      {student.contact_email}
                    </div>
                  )}

                  {student.created_at && (
                    <div className="inline-flex items-center gap-1 text-mist text-xs mt-1.5 rounded-full border border-line bg-panel px-2 py-0.5">
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 3" />
                      </svg>
                      Requested{' '}
                      {new Date(
                        student.created_at
                      ).toLocaleString()}
                    </div>
                  )}

                </div>

              </div>

              <div className="relative flex gap-2 shrink-0">

                <button
                  type="button"
                  disabled={
                    actionId === student.id
                  }
                  onClick={() =>
                    decide(
                      student.id,
                      'approved'
                    )
                  }
                  className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-sage px-4 py-2 text-sm font-medium text-onbrass shadow-[0_8px_18px_-8px_rgba(122,169,116,0.6)] transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {actionId === student.id
                    ? 'Please wait...'
                    : 'Approve'}
                </button>

                <button
                  type="button"
                  disabled={
                    actionId === student.id
                  }
                  onClick={() =>
                    decide(
                      student.id,
                      'rejected'
                    )
                  }
                  className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-coral/50 px-4 py-2 text-sm text-coral transition hover:bg-coral hover:text-paper disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 6L6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                  Reject
                </button>

              </div>

            </div>
          ))}
        </div>
      )}

    </div>
  )
}