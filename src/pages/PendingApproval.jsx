import { useAuth } from '../context/AuthContext'

export default function PendingApproval() {
  const { profile, signOut, refreshProfile } = useAuth()
  const rejected = profile?.status === 'rejected'

  return (
    <div className="min-h-screen bg-ink text-paper flex items-center justify-center px-4">
      <div className="ticket rounded-lg p-8 max-w-md text-center flex flex-col items-center gap-4">
        <span
          className={`stamp w-20 h-20 text-xs uppercase ${
            rejected ? 'border-coral text-coral' : ''
          }`}
        >
          {rejected ? 'Not approved' : 'Pending'}
        </span>
        <h1 className="font-display text-xl">
          {rejected ? 'Account not approved' : 'Waiting for approval'}
        </h1>
        <p className="text-mist text-sm">
          {rejected
            ? 'Mr Ikromov did not approve this account. Contact him directly if you think this is a mistake.'
            : `Hi ${profile?.full_name?.split(' ')[0] || ''}, your account is waiting for Mr Ikromov to approve it. This page will unlock automatically once you're approved.`}
        </p>
        <div className="flex gap-3">
          <button
            onClick={refreshProfile}
            className="focus-ring px-4 py-2 rounded-md border border-line hover:border-brass hover:text-brass transition-colors text-sm"
          >
            Check again
          </button>
          <button
            onClick={signOut}
            className="focus-ring px-4 py-2 rounded-md border border-line hover:border-coral hover:text-coral transition-colors text-sm"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
