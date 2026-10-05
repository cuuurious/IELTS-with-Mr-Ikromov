import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import AuthShell, { AuthField, AuthNotice, authInputClass, authPrimaryButtonClass } from '../components/AuthShell'
import {
  TARGET_BANDS,
  DEFAULT_TARGET_BAND,
  formatTargetBand,
} from '../lib/targetBands'

export default function Register() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  // Registration only ever creates student accounts — Jasur Ikromov is
  // the only teacher on this site, so there is no role picker here
  // anymore. (See AuthContext.jsx's signUp(), which also refuses to
  // create a teacher account as a second layer of protection.)
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
    supabase
      .from('groups')
      .select('id, name')
      .order('name')
      .then(({ data, error }) => {
        if (!error) setGroups(data || [])
      })
  }, [])

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

    if (selectedGroups.length === 0) {
      setError('Choose at least one group.')
      return
    }

    setLoading(true)

    try {
      await signUp({
        username,
        password,
        fullName,
        role: 'student',
        groupIds: selectedGroups,
        contactEmail,
        targetBand,
      })

      navigate('/app')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Join Mr Ikromov's IELTS class."
      subtitle="Create your account, choose your group and your target band. Mr Ikromov approves every new student before the first sign-in."
      cardTitle="Create your account"
      cardSubtitle="It takes about a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="focus-ring rounded font-semibold text-paper hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <AuthField label="Full name">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={authInputClass}
            placeholder="Aziz Karimov"
            autoComplete="name"
            required
          />
        </AuthField>

        <AuthField label="Username" hint="Letters, numbers, dots and underscores. No spaces.">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={authInputClass}
            placeholder="aziz_08"
            pattern="[A-Za-z0-9_.]+"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </AuthField>

        <AuthField label="Password" hint="At least 6 characters.">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
            placeholder="Choose a password"
            autoComplete="new-password"
            minLength={6}
            required
          />
        </AuthField>

        <AuthField label="Email" hint="Only used to send you a link if you forget your password.">
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className={authInputClass}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </AuthField>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-paper">Your group, up to 2</legend>
          {groups.length === 0 && (
            <p className="mt-1.5 text-sm text-mist">No groups yet. Ask Mr Ikromov to add one first.</p>
          )}
          <div className="mt-1.5 flex max-h-48 flex-col gap-2 overflow-y-auto">
            {groups.map((g) => {
              const checked = selectedGroups.includes(g.id)
              return (
                <label
                  key={g.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
                    checked ? 'border-paper bg-panel-2 font-medium' : 'border-line hover:bg-panel-2'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleGroup(g.id)}
                    className="h-4 w-4 accent-[var(--color-brass)]"
                  />
                  {g.name}
                </label>
              )
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-paper">Your target band</legend>
          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {TARGET_BANDS.map((band) => {
              const on = targetBand === band.value
              return (
                <button
                  type="button"
                  key={band.value}
                  onClick={() => setTargetBand(band.value)}
                  aria-pressed={on}
                  className={`focus-ring h-11 rounded-xl border text-sm font-semibold tabular-nums transition-colors ${
                    on ? 'border-brass bg-brass text-onbrass' : 'border-line bg-panel text-paper-dim hover:bg-panel-2'
                  }`}
                >
                  {formatTargetBand(band.value)}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-mist">
            {TARGET_BANDS.find((b) => b.value === targetBand)?.label}. You can change it later in Account settings.
          </p>
        </fieldset>

        {error && <AuthNotice>{error}</AuthNotice>}

        <button type="submit" disabled={loading} className={authPrimaryButtonClass}>
          {loading ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  )
}
