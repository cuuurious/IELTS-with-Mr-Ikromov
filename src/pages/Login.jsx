import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

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
    <div
      className="auth-light min-h-screen lg:h-screen text-[#171A31] relative overflow-x-hidden lg:overflow-hidden flex flex-col"
      style={{
        background:
          'radial-gradient(circle at 75% 15%, rgba(113,104,255,0.16), transparent 30%), radial-gradient(circle at 12% 85%, rgba(69,214,208,0.10), transparent 28%), linear-gradient(135deg, #F7F8FC 0%, #EEF0FA 48%, #F9F9FC 100%)',
        fontFamily:
          "'Gilroy', 'Product Sans', 'Manrope', 'Inter', system-ui, sans-serif",
      }}
    >

      {/* =========================================================
          BACKGROUND SHAPES
          ========================================================= */}

      <div className="absolute inset-0 pointer-events-none overflow-hidden">

        {/* Large angled translucent shape */}
        <div
          className="absolute -top-44 -right-44 w-[650px] h-[650px] rounded-[110px] rotate-[18deg]"
          style={{
            background:
              'linear-gradient(135deg, rgba(108,99,255,0.09), rgba(155,156,255,0.025))',
            border: '1px solid rgba(108,99,255,0.07)',
          }}
        />

        {/* White glass shape */}
        <div
          className="absolute top-[19%] left-[3%] w-24 h-24 rounded-[27px] rotate-[-18deg] hidden lg:block"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.88), rgba(225,227,247,0.34))',
            border: '1px solid rgba(255,255,255,0.95)',
            boxShadow: '0 20px 60px rgba(53,58,100,0.07)',
          }}
        />

        {/* Purple shape */}
        <div
          className="absolute top-[11%] right-[9%] w-14 h-14 rounded-[18px] rotate-[12deg] hidden lg:block"
          style={{
            background:
              'linear-gradient(145deg, #918BFF, #6258E8)',
            boxShadow:
              '0 18px 45px rgba(91,82,220,0.18)',
          }}
        />

        {/* Teal shape */}
        <div
          className="absolute bottom-[14%] left-[43%] w-12 h-12 rounded-[16px] rotate-[25deg] hidden lg:block"
          style={{
            background:
              'linear-gradient(145deg, #67E2DB, #3ACBC2)',
            boxShadow:
              '0 16px 40px rgba(45,185,177,0.16)',
          }}
        />

        {/* Coral shape */}
        <div
          className="absolute bottom-[10%] right-[7%] w-20 h-20 rounded-[25px] rotate-[-20deg] hidden lg:block"
          style={{
            background:
              'linear-gradient(145deg, #FF7770, #FF9A95)',
            boxShadow:
              '0 18px 50px rgba(255,107,95,0.12)',
          }}
        />

        {/* Fine diagonal lines */}
        <div className="absolute inset-0 opacity-[0.15]">
          <div
            className="absolute w-[120%] h-px bg-[#6C63FF] rotate-[-18deg]"
            style={{
              top: '27%',
              left: '-10%',
            }}
          />

          <div
            className="absolute w-[120%] h-px bg-[#6C63FF] rotate-[-18deg]"
            style={{
              top: '29%',
              left: '-10%',
            }}
          />
        </div>

      </div>


      {/* =========================================================
          HEADER
          ========================================================= */}

      <header className="relative z-20 px-5 sm:px-8 lg:px-8 pt-4 lg:pt-4 shrink-0">

        <div className="flex items-center gap-3">

          <img
            src="/ielts.png"
            alt="IELTS with Mr Jasur Ikromov"
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-[16px] object-cover shadow-[0_8px_25px_rgba(30,35,70,0.12)]"
          />

          <div>

            <div className="text-[16px] sm:text-[18px] font-semibold tracking-[-0.02em]">
              IELTS with Mr Jasur Ikromov
            </div>

            <div className="text-[11px] sm:text-xs text-[#747A91] mt-0.5">
              Candidate & examiner portal
            </div>

          </div>

        </div>

      </header>


      {/* =========================================================
          MAIN
          ========================================================= */}

      <main className="relative z-10 flex-1 min-h-0 flex items-center justify-center px-5 sm:px-8 lg:px-8 py-6 lg:py-2">

        <div className="w-full max-w-[1120px] mx-auto grid lg:grid-cols-[1fr_440px] gap-8 lg:gap-16 items-center">


          {/* =====================================================
              LEFT SIDE
              ===================================================== */}

          <section className="max-w-[610px] lg:pl-8">

            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/75 border border-[#DCDFF0] shadow-[0_6px_25px_rgba(40,45,90,0.05)]">

              <span className="w-2 h-2 rounded-full bg-[#6C63FF]" />

              <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.16em] font-bold text-[#555C79]">
                IELTS preparation
              </span>

            </div>


            <h1 className="mt-5 text-[46px] sm:text-[58px] lg:text-[68px] leading-[0.94] tracking-[-0.055em] font-bold text-[#15182D]">

              Welcome
              <br />

              <span className="relative inline-block">

                back.

                <span
                  className="absolute -bottom-2 left-1 w-[72px] h-[7px] rounded-full rotate-[-2deg]"
                  style={{
                    background:
                      'linear-gradient(90deg, #6C63FF, #45D6D0)',
                  }}
                />

              </span>

            </h1>


            <p className="mt-6 max-w-[560px] text-[16px] sm:text-[18px] leading-[1.5] text-[#626981] font-medium">
              Start your IELTS journey with{' '}
              <span className="text-[#171A31] font-bold">
                Mr Jasur Ikromov
              </span>
              . Keep practising. Keep improving. Keep moving
              towards the IELTS band you are working for.
            </p>


            {/* A motivational line, not a quote — no attribution, no
                portrait. A small gradient mark carries the visual
                weight the photo used to. */}
            <div
              className="mt-7 flex items-center gap-4 sm:gap-5 max-w-[560px] rounded-[22px] bg-white/70 backdrop-blur-sm px-5 py-4 sm:px-6 sm:py-5"
              style={{
                border: '1px solid rgba(214,217,234,0.9)',
                boxShadow: '0 18px 50px rgba(39,44,82,0.06)',
              }}
            >

              <div
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-[18px] shrink-0 flex items-center justify-center"
                style={{
                  background: 'linear-gradient(145deg, #918BFF, #45D6D0)',
                  boxShadow: '0 10px 25px rgba(30,35,70,0.18)',
                }}
              >

                <svg
                  viewBox="0 0 24 24"
                  className="w-7 h-7 text-white"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.9L12 3z" />
                  <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
                </svg>

              </div>

              <div className="min-w-0">

                <p className="text-[16px] sm:text-[18px] leading-snug text-[#20233D] font-semibold">
                  Luck favors the prepared mind.
                </p>

                <p className="mt-1 text-sm leading-snug text-[#626981]">
                  Every band score is built through steady practice, honest feedback, and showing up again tomorrow.
                </p>

              </div>

            </div>

          </section>


          {/* =====================================================
              LOGIN CARD
              ===================================================== */}

          <section className="w-full max-w-[440px] mx-auto lg:mx-0">

            <div
              className="rounded-[27px] bg-white/95 backdrop-blur-xl overflow-hidden"
              style={{
                border: '1px solid rgba(214,217,234,0.9)',
                boxShadow:
                  '0 25px 75px rgba(39,44,82,0.13), 0 8px 25px rgba(39,44,82,0.05)',
              }}
            >

              {/* Card header */}
              <div className="px-6 sm:px-8 pt-6 pb-5">

                <div className="flex items-start justify-between gap-4">

                  <div>

                    <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-[#6C63FF]">
                      Your learning space
                    </p>

                    <h2 className="text-[29px] sm:text-[32px] leading-none tracking-[-0.04em] font-bold text-[#171A31] mt-3">
                      Sign in
                    </h2>

                    <p className="text-sm leading-relaxed text-[#777D92] mt-3 max-w-[330px]">
                      Continue where you left off and keep working towards your goal.
                    </p>

                  </div>


                  <div
                    className="w-11 h-11 rounded-[14px] shrink-0 rotate-[8deg] flex items-center justify-center"
                    style={{
                      background:
                        'linear-gradient(145deg, #8D88FF, #6258E8)',
                      boxShadow:
                        '0 10px 25px rgba(98,88,232,0.20)',
                    }}
                  >

                    <svg
                      viewBox="0 0 24 24"
                      className="w-5 h-5 text-white"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M6 17L17 6" />
                      <path d="M9 6h8v8" />
                    </svg>

                  </div>

                </div>

              </div>


              <div className="border-t border-[#E7E8EF]" />


              {/* Form */}
              <form
                onSubmit={submit}
                className="px-6 sm:px-8 py-5 flex flex-col gap-4"
              >

                {/* Username */}
                <div>

                  <label className="block text-sm font-bold text-[#30354D]">
                    Username
                  </label>

                  <div className="relative mt-1.5">

                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA2B4] font-semibold">
                      @
                    </span>

                    <input
                      autoFocus
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-[#F8F9FC] border border-[#D9DCE8] rounded-[14px] pl-9 pr-4 py-3 text-[#171A31] placeholder:text-[#AAB0C0] outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/10 transition"
                      placeholder="e.g. aziz_08"
                      autoComplete="username"
                      required
                    />

                  </div>

                </div>


                {/* Password */}
                <div>

                  <label className="block text-sm font-bold text-[#30354D]">
                    Password
                  </label>

                  <div className="relative mt-1.5">

                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA2B4]">
                      •
                    </span>

                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-[#F8F9FC] border border-[#D9DCE8] rounded-[14px] pl-9 pr-4 py-3 text-[#171A31] placeholder:text-[#AAB0C0] outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/10 transition"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                    />

                  </div>

                </div>


                {/* Error */}
                {error && (
                  <div className="rounded-[12px] border border-[#F0C4C1] bg-[#FFF1F0] px-4 py-2.5">

                    <p className="text-sm text-[#B64D46] font-medium">
                      {error}
                    </p>

                  </div>
                )}


                {/* Sign in */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-[14px] py-3.5 text-white font-bold text-[15px] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-[1px] active:translate-y-0"
                  style={{
                    background:
                      'linear-gradient(135deg, #6C63FF 0%, #5A50E8 100%)',
                    boxShadow:
                      '0 12px 28px rgba(100,91,238,0.24)',
                  }}
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>


                {/* Forgot */}
                <div className="text-center">

                  <Link
                    to="/forgot-password"
                    className="text-sm font-semibold text-[#555E91] hover:text-[#4038B8] hover:underline underline-offset-4 transition"
                  >
                    Forgot password?
                  </Link>

                </div>

              </form>


              {/* Registration */}
              <div className="border-t border-[#E5E6ED] bg-[#F7F8FB] px-6 sm:px-8 py-3.5 text-center">

                <p className="text-sm text-[#7A8092]">

                  New here?{' '}

                  <Link
                    to="/register"
                    className="font-bold text-[#555DE0] hover:text-[#4038B8] hover:underline underline-offset-4"
                  >
                    Create an account
                  </Link>

                </p>

              </div>


              {/* =================================================
                  SOCIALS
                  ================================================= */}

              <div className="border-t border-[#E5E6ED] bg-[#F1F2F7] px-5 py-3">

                <div className="flex items-center justify-between gap-3">

                  <span className="text-[9px] uppercase tracking-[0.14em] font-bold text-[#8A8FA2]">
                    Follow Mr Ikromov
                  </span>


                  <div className="flex items-center gap-2">

                    {/* Instagram */}
                    <a
                      href="https://www.instagram.com/ustoz_jasur/"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Instagram - Ustoz Jasur"
                      className="w-9 h-9 rounded-[11px] bg-white border border-[#DDDFE8] flex items-center justify-center hover:-translate-y-0.5 transition-all"
                    >

                      <svg
                        viewBox="0 0 24 24"
                        className="w-[19px] h-[19px]"
                      >

                        <defs>

                          <linearGradient
                            id="instagramGradient"
                            x1="0%"
                            y1="100%"
                            x2="100%"
                            y2="0%"
                          >
                            <stop offset="0%" stopColor="#FEDA75" />
                            <stop offset="25%" stopColor="#FA7E1E" />
                            <stop offset="55%" stopColor="#D62976" />
                            <stop offset="78%" stopColor="#962FBF" />
                            <stop offset="100%" stopColor="#4F5BD5" />
                          </linearGradient>

                        </defs>

                        <rect
                          x="3"
                          y="3"
                          width="18"
                          height="18"
                          rx="5"
                          fill="none"
                          stroke="url(#instagramGradient)"
                          strokeWidth="2"
                        />

                        <circle
                          cx="12"
                          cy="12"
                          r="4"
                          fill="none"
                          stroke="url(#instagramGradient)"
                          strokeWidth="2"
                        />

                        <circle
                          cx="17.5"
                          cy="6.5"
                          r="1.15"
                          fill="#D62976"
                        />

                      </svg>

                    </a>


                    {/* Telegram */}
                    <a
                      href="https://t.me/TeamMrIkromov"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Telegram - Team Mr Ikromov"
                      className="w-9 h-9 rounded-[11px] bg-white border border-[#DDDFE8] flex items-center justify-center hover:-translate-y-0.5 hover:border-[#229ED9]/40 transition-all"
                    >

                      <svg
                        viewBox="0 0 24 24"
                        className="w-[19px] h-[19px]"
                      >

                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          fill="#229ED9"
                        />

                        <path
                          d="M17.7 7.1L15.2 17.2c-.2.7-.6.9-1.2.6l-3.3-2.4-1.6 1.5c-.2.2-.4.4-.8.4l.2-3.3 6-5.4c.3-.3-.1-.4-.5-.1L6.6 13 3.4 12c-.7-.2-.7-.7.1-1l12.7-4.9c.6-.2 1.7.3 1.5 1z"
                          fill="white"
                        />

                      </svg>

                    </a>

                  </div>

                </div>

              </div>

            </div>

          </section>

        </div>

      </main>

    </div>
  )
}