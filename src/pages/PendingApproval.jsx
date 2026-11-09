import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import AuthShell, { AuthNotice, authPrimaryButtonClass } from '../components/AuthShell'

/*
 * WAITING FOR APPROVAL (redesigned 2026-11-09) — same frame as Sign in /
 * Create account (AuthShell), so a new student never feels they left the
 * site. Shows three steps (account made → Mr Ikromov approves → you're in),
 * checks again by itself every 30 seconds, and gives a direct Telegram
 * link if it takes long.
 */

const TELEGRAM = 'https://t.me/TeamMrIkromov'

function Step({ n, title, text, state }) {
  // state: 'done' | 'now' | 'next'
  const badge =
    state === 'done'
      ? 'bg-sage text-white'
      : state === 'now'
        ? 'bg-saffron text-[#17213a]'
        : 'bg-panel-2 text-mist'
  return (
    <li className="flex gap-3.5">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] font-brand text-[14px] font-semibold ${badge}`}>
        {state === 'done' ? '✓' : n}
      </span>
      <div className="min-w-0">
        <p className={`text-[15px] font-extrabold ${state === 'next' ? 'text-mist' : 'text-paper'}`}>{title}</p>
        <p className="text-[13px] font-semibold leading-snug text-mist">{text}</p>
      </div>
    </li>
  )
}

export default function PendingApproval() {
  const { profile, signOut, refreshProfile } = useAuth()
  const rejected = profile?.status === 'rejected'
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || 'there'
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState(null)

  const check = async () => {
    setChecking(true)
    try {
      await refreshProfile?.()
    } finally {
      setChecking(false)
      setCheckedAt(new Date())
    }
  }

  // Look again by itself every 30 seconds while the page is open.
  useEffect(() => {
    if (rejected) return undefined
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refreshProfile?.()
    }, 30000)
    return () => clearInterval(t)
  }, [rejected, refreshProfile])

  const logOut = (
    <button type="button" onClick={signOut} className="focus-ring rounded font-semibold text-paper hover:underline">
      Log out
    </button>
  )

  if (rejected) {
    return (
      <AuthShell
        title="Your IELTS study room with Mr Jasur Ikromov."
        subtitle="Homework, word lists, full mock exams and your teacher's feedback, all in one place."
        cardTitle="Account not approved"
        cardSubtitle={`Sorry, ${firstName}.`}
        footer={<>Wrong account? {logOut}</>}
      >
        <div className="flex flex-col gap-4">
          <AuthNotice>
            Mr Ikromov did not approve this account. If you think this is a mistake, message him in Telegram.
          </AuthNotice>
          <a href={TELEGRAM} target="_blank" rel="noopener noreferrer" className={authPrimaryButtonClass}>
            Message Mr Ikromov
          </a>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Your IELTS study room with Mr Jasur Ikromov."
      subtitle="Homework, word lists, full mock exams and your teacher's feedback, all in one place."
      cardTitle="Almost there"
      cardSubtitle={`Hi ${firstName}, your account is waiting for approval.`}
      footer={<>Signed in as <span className="font-semibold text-paper">{profile?.username || 'you'}</span> · {logOut}</>}
    >
      <div className="flex flex-col gap-5">
        <ol className="flex flex-col gap-4">
          <Step n={1} state="done" title="Account created" text="Your name, group and target band are saved." />
          <Step n={2} state="now" title="Mr Ikromov approves it" text="Usually the same day. This page checks by itself." />
          <Step n={3} state="next" title="You're in" text="Your homework, tests and group open here." />
        </ol>

        <div className="flex flex-col gap-2">
          <button type="button" onClick={check} disabled={checking} className={authPrimaryButtonClass}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
          <p className="min-h-[18px] text-center text-[13px] font-semibold text-mist" aria-live="polite">
            {checkedAt && !checking
              ? `Still waiting — checked at ${checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
              : ''}
          </p>
        </div>

        <a
          href={TELEGRAM}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring flex items-center justify-center gap-2 rounded-[14px] border border-line px-4 py-3 text-[14px] font-extrabold text-brass hover:bg-[color-mix(in_srgb,var(--color-brass)_8%,transparent)]"
        >
          Taking long? Message Mr Ikromov in Telegram
        </a>
      </div>
    </AuthShell>
  )
}
