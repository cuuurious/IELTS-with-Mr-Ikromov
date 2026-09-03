import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import {
  TARGET_BANDS,
  DEFAULT_TARGET_BAND,
  formatTargetBand,
} from '../lib/targetBands'

export default function Register() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [role, setRole] = useState('student')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [groups, setGroups] = useState([])
  const [selectedGroups, setSelectedGroups] = useState([])
  const [targetBand, setTargetBand] = useState(
    DEFAULT_TARGET_BAND
  )
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (role !== 'student') return

    supabase
      .from('groups')
      .select('id, name')
      .order('name')
      .then(({ data, error }) => {
        if (!error) setGroups(data || [])
      })
  }, [role])

  const toggleGroup = (id) => {
    setSelectedGroups((prev) =>
      prev.includes(id)
        ? prev.filter((g) => g !== id)
        : prev.length < 2
          ? [...prev, id]
          : prev
    )
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    if (role === 'student' && selectedGroups.length === 0) {
      setError('Choose at least one group.')
      return
    }

    setLoading(true)

    try {
      await signUp({
        username,
        password,
        fullName,
        role,
        groupIds: selectedGroups,
        contactEmail,
        targetBand:
          role === 'student'
            ? targetBand
            : undefined,
      })

      navigate('/app')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink text-paper flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src="/ielts.png"
            alt="IELTS with Mr Ikromov"
            className="w-16 h-16 mx-auto rounded-2xl mb-3"
          />

          <h1 className="font-display text-2xl">Create your account</h1>

          <p className="text-mist text-sm mt-1">
            Your account needs Mr Ikromov's approval before you can log in.
          </p>
        </div>

        <form onSubmit={submit} className="ticket rounded-lg p-6 flex flex-col gap-4">
          <div className="flex gap-2 bg-panel-2 rounded-md p-1">
            {['student', 'teacher'].map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => setRole(r)}
                className={`focus-ring flex-1 py-2 rounded text-sm capitalize transition-colors ${
                  role === r
                    ? 'bg-brass text-onbrass font-medium'
                    : 'text-mist'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-mist font-mono">
              Full name
            </label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="focus-ring w-full mt-1 bg-panel-2 border border-line rounded-md px-3 py-2"
              required
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-mist font-mono">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="focus-ring w-full mt-1 bg-panel-2 border border-line rounded-md px-3 py-2"
              placeholder="letters, numbers, no spaces"
              pattern="[A-Za-z0-9_.]+"
              required
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-mist font-mono">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="focus-ring w-full mt-1 bg-panel-2 border border-line rounded-md px-3 py-2"
              minLength={6}
              required
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-mist font-mono">
              Recovery email (required for password reset)
            </label>
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="focus-ring w-full mt-1 bg-panel-2 border border-line rounded-md px-3 py-2"
              placeholder="you will receive password reset emails here"
              required
            />
          </div>

          {role === 'student' && (
            <div>
              <label className="text-xs uppercase tracking-wide text-mist font-mono">
                Your group(s) — choose up to 2
              </label>

              <div className="mt-2 flex flex-col gap-2 max-h-48 overflow-y-auto">
                {groups.length === 0 && (
                  <p className="text-mist text-sm">
                    No groups yet — ask your teacher to add one first.
                  </p>
                )}

                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-2 bg-panel-2 border border-line rounded-md px-3 py-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroups.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                    />
                    <span>{g.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {role === 'student' && (
            <div>
              <label className="text-xs uppercase tracking-wide text-mist font-mono">
                Your target band
              </label>

              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {TARGET_BANDS.map((band) => (
                  <button
                    type="button"
                    key={band.value}
                    onClick={() =>
                      setTargetBand(band.value)
                    }
                    aria-pressed={
                      targetBand === band.value
                    }
                    className={`focus-ring flex flex-col items-center gap-0.5 rounded-md border px-1.5 py-2 text-center transition-colors ${
                      targetBand === band.value
                        ? 'border-brass bg-brass/10 text-brass'
                        : 'border-line text-mist hover:border-brass/50'
                    }`}
                  >
                    <span className="text-lg leading-none">
                      {band.emoji}
                    </span>
                    <span className="text-sm font-semibold leading-none">
                      {formatTargetBand(band.value)}
                    </span>
                  </button>
                ))}
              </div>

              <p className="text-mist text-xs mt-2">
                {
                  TARGET_BANDS.find(
                    (b) => b.value === targetBand
                  )?.label
                }{' '}
                — you can change this anytime later in
                Account Settings.
              </p>
            </div>
          )}

          {error && <p className="text-coral text-sm">{error}</p>}

          <button
            disabled={loading}
            className="focus-ring bg-brass text-onbrass font-medium rounded-md py-2.5 hover:bg-brass-dim transition-colors disabled:opacity-50"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-mist mt-5">
          Already registered?{' '}
          <Link to="/login" className="text-brass hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
