import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthShell, { AuthField, AuthNotice, authInputClass, authPrimaryButtonClass } from '../components/AuthShell'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signIn({ username, password })
      navigate('/app')
    } catch (err) {
      setError(
        err.message === 'Invalid login credentials'
          ? 'Wrong username or password.'
          : err.message
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Your IELTS study room with Mr Jasur Ikromov."
      subtitle="Homework, word lists, full mock exams and your teacher's feedback, all in one place."
      cardTitle="Sign in"
      cardSubtitle="Pick up where you left off."
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="focus-ring rounded font-semibold text-paper hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <AuthField label="Username">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={authInputClass}
            placeholder="aziz_08"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </AuthField>

        <AuthField label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
            placeholder="Your password"
            autoComplete="current-password"
            required
          />
        </AuthField>

        {error && <AuthNotice>{error}</AuthNotice>}

        <button type="submit" disabled={loading} className={authPrimaryButtonClass}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <Link to="/forgot-password" className="focus-ring mx-auto rounded text-sm font-medium text-paper-dim hover:text-paper hover:underline">
          Forgot your password?
        </Link>
      </form>
    </AuthShell>
  )
}
