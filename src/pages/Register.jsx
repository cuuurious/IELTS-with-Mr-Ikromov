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
    <div
      className="min-h-screen text-[#171A31] flex items-center justify-center px-4 py-10 relative overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at 75% 15%, rgba(113,104,255,0.16), transparent 30%), radial-gradient(circle at 12% 85%, rgba(69,214,208,0.10), transparent 28%), linear-gradient(135deg, #F7F8FC 0%, #EEF0FA 48%, #F9F9FC 100%)',
        fontFamily:
          "'Gilroy', 'Product Sans', 'Manrope', 'Inter', system-ui, sans-serif",
      }}
    >

      {/* Soft angled accent line, echoes the login page */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-[0.15]">
        <div
          className="absolute w-[120%] h-px bg-[#6C63FF] rotate-[-18deg]"
          style={{ top: '18%', left: '-10%' }}
        />
      </div>

      <div className="w-full max-w-md relative z-10">

        <div className="text-center mb-7">
          <img
            src="/ielts.png"
            alt="IELTS with Mr Ikromov"
            className="w-14 h-14 mx-auto rounded-[16px] object-cover mb-4"
            style={{ boxShadow: '0 8px 25px rgba(30,35,70,0.14)' }}
          />

          <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-[#6C63FF]">
            Join the class
          </p>

          <h1 className="mt-2 text-[28px] leading-tight tracking-[-0.03em] font-bold text-[#171A31]">
            Create your account
          </h1>

          <p className="text-[#747A91] text-sm mt-2 max-w-[320px] mx-auto">
            Your account needs Mr Ikromov's approval before you can log in.
          </p>
        </div>

        <div
          className="rounded-[27px] bg-white/95 backdrop-blur-xl overflow-hidden"
          style={{
            border: '1px solid rgba(214,217,234,0.9)',
            boxShadow:
              '0 25px 75px rgba(39,44,82,0.13), 0 8px 25px rgba(39,44,82,0.05)',
          }}
        >

          <form
            onSubmit={submit}
            className="px-6 sm:px-8 py-6 flex flex-col gap-4"
          >

            <div className="flex gap-2 bg-[#F1F2F7] rounded-[12px] p-1">
              {['student', 'teacher'].map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setRole(r)}
                  className={`focus-ring flex-1 py-2 rounded-[9px] text-sm font-semibold capitalize transition-all duration-200 ${
                    role === r
                      ? 'text-white'
                      : 'text-[#7A8092] hover:text-[#30354D]'
                  }`}
                  style={
                    role === r
                      ? {
                          background:
                            'linear-gradient(135deg, #6C63FF 0%, #5A50E8 100%)',
                          boxShadow: '0 6px 16px rgba(100,91,238,0.24)',
                        }
                      : undefined
                  }
                >
                  {r}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-sm font-bold text-[#30354D]">
                Full name
              </label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="focus-ring w-full mt-1.5 bg-[#F8F9FC] border border-[#D9DCE8] rounded-[14px] px-4 py-3 text-[#171A31] placeholder:text-[#AAB0C0] outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/10 transition"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-[#30354D]">
                Username
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="focus-ring w-full mt-1.5 bg-[#F8F9FC] border border-[#D9DCE8] rounded-[14px] px-4 py-3 text-[#171A31] placeholder:text-[#AAB0C0] outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/10 transition"
                placeholder="letters, numbers, no spaces"
                pattern="[A-Za-z0-9_.]+"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-[#30354D]">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="focus-ring w-full mt-1.5 bg-[#F8F9FC] border border-[#D9DCE8] rounded-[14px] px-4 py-3 text-[#171A31] placeholder:text-[#AAB0C0] outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/10 transition"
                minLength={6}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-[#30354D]">
                Recovery email
              </label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="focus-ring w-full mt-1.5 bg-[#F8F9FC] border border-[#D9DCE8] rounded-[14px] px-4 py-3 text-[#171A31] placeholder:text-[#AAB0C0] outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/10 transition"
                placeholder="you will receive password reset emails here"
                required
              />
            </div>

            {role === 'student' && (
              <div>
                <label className="block text-sm font-bold text-[#30354D]">
                  Your group(s) — choose up to 2
                </label>

                <div className="mt-2 flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {groups.length === 0 && (
                    <p className="text-[#747A91] text-sm">
                      No groups yet — ask your teacher to add one first.
                    </p>
                  )}

                  {groups.map((g) => (
                    <label
                      key={g.id}
                      className="flex items-center gap-2 bg-[#F8F9FC] border border-[#D9DCE8] rounded-[14px] px-4 py-2.5 cursor-pointer transition hover:border-[#6C63FF]/40"
                    >
                      <input
                        type="checkbox"
                        checked={selectedGroups.includes(g.id)}
                        onChange={() => toggleGroup(g.id)}
                        className="accent-[#6C63FF]"
                      />
                      <span className="text-[#30354D] text-sm font-medium">{g.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {role === 'student' && (
              <div>
                <label className="block text-sm font-bold text-[#30354D]">
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
                      className={`focus-ring flex flex-col items-center gap-0.5 rounded-[12px] border px-1.5 py-2 text-center transition-colors ${
                        targetBand === band.value
                          ? 'border-[#6C63FF] bg-[#6C63FF]/10 text-[#6C63FF]'
                          : 'border-[#D9DCE8] text-[#7A8092] hover:border-[#6C63FF]/40'
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

                <p className="text-[#8A8FA2] text-xs mt-2">
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

            {error && (
              <div className="rounded-[12px] border border-[#F0C4C1] bg-[#FFF1F0] px-4 py-2.5">
                <p className="text-sm text-[#B64D46] font-medium">{error}</p>
              </div>
            )}

            <button
              disabled={loading}
              className="w-full rounded-[14px] py-3.5 text-white font-bold text-[15px] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-[1px] active:translate-y-0"
              style={{
                background:
                  'linear-gradient(135deg, #6C63FF 0%, #5A50E8 100%)',
                boxShadow: '0 12px 28px rgba(100,91,238,0.24)',
              }}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <div className="border-t border-[#E5E6ED] bg-[#F7F8FB] px-6 sm:px-8 py-3.5 text-center">
            <p className="text-sm text-[#7A8092]">
              Already registered?{' '}
              <Link
                to="/login"
                className="font-bold text-[#555DE0] hover:text-[#4038B8] hover:underline underline-offset-4"
              >
                Sign in
              </Link>
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
