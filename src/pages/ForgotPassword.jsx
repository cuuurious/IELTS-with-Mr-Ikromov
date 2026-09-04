import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth()

  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()

    setLoading(true)
    setError('')
    setMessage('')

    try {
      await sendPasswordReset(email)

      setMessage(
        'If this email belongs to an account, a password reset link has been sent. Please check your inbox and spam folder.'
      )
    } catch (err) {
      console.error('Password reset request failed:', err)

      setError(
        err?.message ||
          'Could not send the password reset email.'
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
          Same visual language as Login.jsx
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

        {/* Soft glass square */}
        <div
          className="absolute top-[20%] left-[4%] w-24 h-24 rounded-[27px] rotate-[-18deg] hidden lg:block"
          style={{
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.88), rgba(225,227,247,0.34))',
            border: '1px solid rgba(255,255,255,0.95)',
            boxShadow:
              '0 20px 60px rgba(53,58,100,0.07)',
          }}
        />

        {/* Purple tile */}
        <div
          className="absolute top-[12%] right-[9%] w-14 h-14 rounded-[18px] rotate-[12deg] hidden lg:block"
          style={{
            background:
              'linear-gradient(145deg, #918BFF, #6258E8)',
            boxShadow:
              '0 18px 45px rgba(91,82,220,0.18)',
          }}
        />

        {/* Teal tile */}
        <div
          className="absolute bottom-[14%] left-[43%] w-12 h-12 rounded-[16px] rotate-[25deg] hidden lg:block"
          style={{
            background:
              'linear-gradient(145deg, #67E2DB, #3ACBC2)',
            boxShadow:
              '0 16px 40px rgba(45,185,177,0.16)',
          }}
        />

        {/* Coral tile */}
        <div
          className="absolute bottom-[11%] right-[7%] w-20 h-20 rounded-[25px] rotate-[-20deg] hidden lg:block"
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
            alt="IELTS with Mr Ikromov"
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-[16px] object-cover shadow-[0_8px_25px_rgba(30,35,70,0.12)]"
          />

          <div>

            <div className="text-[16px] sm:text-[18px] font-semibold tracking-[-0.02em]">
              IELTS with Mr Ikromov
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

        <div className="w-full max-w-[1050px] mx-auto grid lg:grid-cols-[1fr_440px] gap-10 lg:gap-20 items-center">


          {/* =====================================================
              LEFT SIDE
              ===================================================== */}

          <section className="max-w-[580px] lg:pl-8">

            {/* Label */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/75 border border-[#DCDFF0] shadow-[0_6px_25px_rgba(40,45,90,0.05)]">

              <span className="w-2 h-2 rounded-full bg-[#6C63FF]" />

              <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.16em] font-bold text-[#555C79]">
                Account recovery
              </span>

            </div>


            {/* Heading */}
            <h1 className="mt-5 text-[45px] sm:text-[56px] lg:text-[64px] leading-[0.96] tracking-[-0.055em] font-bold text-[#15182D]">

              Reset your
              <br />

              <span className="relative inline-block">

                password.

                <span
                  className="absolute -bottom-2 left-1 w-[76px] h-[7px] rounded-full rotate-[-2deg]"
                  style={{
                    background:
                      'linear-gradient(90deg, #6C63FF, #45D6D0)',
                  }}
                />

              </span>

            </h1>


            {/* Supporting copy */}
            <p className="mt-6 max-w-[530px] text-[16px] sm:text-[18px] leading-[1.55] text-[#626981] font-medium">
              Forgot your password? No problem.
              Enter the recovery email connected to your account
              and we'll help you get back to your preparation.
            </p>


            {/* Small reassurance */}
            <div className="mt-7 flex items-center gap-4">

              <div
                className="w-[58px] h-[58px] rounded-[18px] flex items-center justify-center shrink-0"
                style={{
                  background:
                    'linear-gradient(145deg, #171C3A, #252C55)',
                  boxShadow:
                    '0 15px 35px rgba(27,32,75,0.14)',
                }}
              >

                <svg
                  viewBox="0 0 24 24"
                  className="w-6 h-6 text-[#8BEAE0]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="5" y="10" width="14" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  <path d="M12 14v2" />
                </svg>

              </div>


              <div>

                <p className="text-[15px] sm:text-[16px] font-bold text-[#343951]">
                  A secure reset link
                </p>

                <p className="text-xs sm:text-sm text-[#7C8297] mt-1">
                  We'll send instructions directly to your email.
                </p>

              </div>

            </div>


            {/* Motivation */}
            <div className="mt-7 flex items-center gap-3">

              <div className="w-1 h-10 rounded-full bg-[#FF6B6B]" />

              <p className="text-[15px] sm:text-[16px] font-semibold text-[#343951]">
                Keep moving towards your target band.
              </p>

            </div>

          </section>


          {/* =====================================================
              FORM CARD
              ===================================================== */}

          <section className="w-full max-w-[440px] mx-auto lg:mx-0">

            <div
              className="rounded-[27px] bg-white/95 backdrop-blur-xl overflow-hidden"
              style={{
                border:
                  '1px solid rgba(214,217,234,0.9)',
                boxShadow:
                  '0 25px 75px rgba(39,44,82,0.13), 0 8px 25px rgba(39,44,82,0.05)',
              }}
            >

              {/* Card heading */}
              <div className="px-6 sm:px-8 pt-7 pb-6">

                <div className="flex items-start justify-between gap-4">

                  <div>

                    <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-[#6C63FF]">
                      Password recovery
                    </p>

                    <h2 className="text-[29px] sm:text-[32px] leading-none tracking-[-0.04em] font-bold text-[#171A31] mt-3">
                      Enter your email
                    </h2>

                    <p className="text-sm leading-relaxed text-[#777D92] mt-3 max-w-[330px]">
                      We'll send a secure link to reset your password.
                    </p>

                  </div>


                  {/* Lock tile */}
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
                      strokeLinejoin="round"
                    >
                      <rect x="5" y="10" width="14" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>

                  </div>

                </div>

              </div>


              <div className="border-t border-[#E7E8EF]" />


              {/* Form */}
              <form
                onSubmit={submit}
                className="px-6 sm:px-8 py-6 flex flex-col gap-5"
              >

                {/* Email */}
                <div>

                  <label className="block text-sm font-bold text-[#30354D]">
                    Recovery email
                  </label>

                  <div className="relative mt-2">

                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA2B4]">

                      <svg
                        viewBox="0 0 24 24"
                        className="w-[17px] h-[17px]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect
                          x="3"
                          y="5"
                          width="18"
                          height="14"
                          rx="2"
                        />

                        <path d="M3 7l9 6 9-6" />
                      </svg>

                    </span>

                    <input
                      autoFocus
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      autoComplete="email"
                      className="w-full bg-[#F8F9FC] border border-[#D9DCE8] rounded-[14px] pl-11 pr-4 py-3.5 text-[#171A31] placeholder:text-[#AAB0C0] outline-none focus:border-[#6C63FF] focus:ring-4 focus:ring-[#6C63FF]/10 transition"
                      required
                    />

                  </div>

                </div>


                {/* Success */}
                {message && (
                  <div className="rounded-[13px] border border-[#A9DDD7] bg-[#EAF9F7] px-4 py-3">

                    <div className="flex items-start gap-2.5">

                      <div className="mt-0.5 w-5 h-5 rounded-full bg-[#45BDB4] text-white flex items-center justify-center shrink-0">

                        <svg
                          viewBox="0 0 24 24"
                          className="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12l4 4L19 6" />
                        </svg>

                      </div>

                      <p className="text-sm leading-relaxed text-[#267B75]">
                        {message}
                      </p>

                    </div>

                  </div>
                )}


                {/* Error */}
                {error && (
                  <div className="rounded-[13px] border border-[#F0C4C1] bg-[#FFF1F0] px-4 py-3">

                    <p className="text-sm text-[#B64D46] font-medium">
                      {error}
                    </p>

                  </div>
                )}


                {/* CTA */}
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
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>


                {/* Back to login */}
                <div className="text-center">

                  <Link
                    to="/login"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-[#555E91] hover:text-[#4038B8] hover:underline underline-offset-4 transition"
                  >

                    <svg
                      viewBox="0 0 24 24"
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M19 12H5" />
                      <path d="M12 19l-7-7 7-7" />
                    </svg>

                    Back to sign in

                  </Link>

                </div>

              </form>


              {/* Security footer */}
              <div className="border-t border-[#E5E6ED] bg-[#F7F8FB] px-6 sm:px-8 py-3.5">

                <div className="flex items-center justify-center gap-2 text-[#8A8FA2]">

                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect
                      x="5"
                      y="10"
                      width="14"
                      height="10"
                      rx="2"
                    />

                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>

                  <span className="text-[11px] font-semibold">
                    Your account recovery is secure
                  </span>

                </div>

              </div>

            </div>

          </section>

        </div>

      </main>

    </div>
  )
}