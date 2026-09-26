import { useState } from 'react'

/*
 * ================================================================
 * HOW TO USE — student onboarding guide, built from real screenshots
 * ================================================================
 * Shared between StudentDashboard.jsx (its own 'howto' tab) and
 * TeacherDashboard.jsx (so a teacher can see exactly what students
 * see, and hand this same page to new students). Every screenshot
 * below is a real capture of the live site, supplied by Jasur and
 * saved to public/how-to-use/ — this component is just the
 * explanatory text wrapped around them.
 *
 * Section order (per Jasur): the general site walkthrough first
 * (signin → register → homework → wordlists → leaderboard →
 * groupchat → chats → account), then the Mock Test Center sections,
 * then Forgot Password last — it's a "good to know", not a numbered
 * first step, so it's deliberately de-emphasized at the very end.
 *
 * A matching static HTML/PDF version of this same content lives in
 * scripts/how-to-use-pdf (see that folder) — keep both in sync when
 * this file changes, and when new screenshots are added, add both
 * the image file (public/how-to-use/) and a matching <Shot> here.
 * ================================================================
 */

const SECTIONS = [
  { key: 'signin', label: 'Signing in' },
  { key: 'register', label: 'Creating an account' },
  { key: 'homework', label: 'Homework' },
  { key: 'wordlists', label: 'Word Lists' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'groupchat', label: 'Group Chat' },
  { key: 'chats', label: 'Chats' },
  { key: 'account', label: 'Account settings' },
  { key: 'mock-overview', label: 'Mock Test Center — Overview' },
  { key: 'mock-checkin', label: 'Mock Test Center — Take a Test' },
  { key: 'mock-speaking', label: 'Mock Test Center — Speaking Exam' },
  { key: 'mock-examiners', label: 'Mock Test Center — Message Examiners' },
  { key: 'forgot-password', label: 'Forgot password' },
]

// Static, literal class names (so Tailwind's scanner picks them up even
// though they're chosen dynamically at runtime via this lookup table).
const EYEBROW_STYLES = {
  brass: 'text-brass',
  lavender: 'text-lavender',
  amber: 'text-amber',
}

const STEP_STYLES = {
  brass: 'bg-brass/15 text-brass',
  lavender: 'bg-lavender/15 text-lavender',
  amber: 'bg-amber/15 text-amber',
}

function Shot({ src, alt, wide }) {
  return (
    <img
      src={src}
      alt={alt}
      className={`w-full rounded-xl border border-line shadow-sm ${wide ? '' : 'max-w-[360px]'}`}
      loading="lazy"
    />
  )
}

function Step({ n, children, accent = 'brass' }) {
  return (
    <li className="flex gap-3.5">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${STEP_STYLES[accent] || STEP_STYLES.brass}`}
      >
        {n}
      </span>
      <span className="pt-0.5 text-base leading-7 text-paper">{children}</span>
    </li>
  )
}

function GuideSection({ id, eyebrow, title, blurb, illustration, steps, tip, wide, accent = 'brass' }) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-2xl border border-line bg-panel shadow-sm"
    >
      <div
        className={`grid gap-8 p-6 sm:p-8 lg:items-start ${
          wide ? 'grid-cols-1' : 'lg:grid-cols-2'
        }`}
      >
        <div className={wide ? 'order-2' : ''}>
          <p
            className={`font-mono text-xs font-semibold uppercase tracking-[0.14em] ${
              EYEBROW_STYLES[accent] || EYEBROW_STYLES.brass
            }`}
          >
            {eyebrow}
          </p>
          <h2 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-paper sm:text-3xl">
            {title}
          </h2>
          <p className="mt-2.5 text-base leading-7 text-paper-dim">{blurb}</p>

          <ol className="mt-6 space-y-4">{steps}</ol>

          {tip && (
            <div className="mt-6 rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-3.5 text-base leading-7 text-paper">
              <span className="font-bold text-cyan">Tip. </span>
              {tip}
            </div>
          )}
        </div>

        <div className={`flex flex-col gap-3 ${wide ? 'order-1' : 'lg:sticky lg:top-24'}`}>
          {illustration}
        </div>
      </div>
    </section>
  )
}

export default function HowToUseGuide() {
  const [active, setActive] = useState('signin')

  const scrollTo = (key) => {
    setActive(key)
    document.getElementById(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-6">
      {/* Header / intro card */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-brass/10 blur-3xl" />
          <div className="absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-sage/10 blur-3xl" />
        </div>
        <div className="relative px-6 py-6 sm:px-8 sm:py-7">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-brass">
            New here?
          </p>
          <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-paper">
            How to use your portal
          </h1>
          <p className="mt-2.5 max-w-2xl text-base leading-7 text-paper-dim">
            A full walkthrough of every part of the site, with real screenshots — signing in,
            homework, word lists, the leaderboard, chat, and the Mock Test Center. Read it top to
            bottom the first time, then come back to any section whenever you need a reminder.
          </p>
          <a
            href="/how-to-use-ielts-portal.pdf"
            download
            className="focus-ring mt-5 inline-flex items-center gap-2 rounded-full bg-brass px-4 py-2.5 text-sm font-semibold text-onbrass shadow-sm transition-colors hover:brightness-105"
          >
            ⬇ Download as PDF
          </a>
        </div>
      </section>

      {/* Section nav */}
      <div className="flex flex-wrap gap-2 rounded-2xl border border-line bg-panel p-3 shadow-sm">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => scrollTo(s.key)}
            className={`focus-ring rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
              active === s.key
                ? 'border-brass/50 bg-brass/15 text-brass'
                : 'border-line text-mist hover:text-paper'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <GuideSection
        id="signin"
        eyebrow="Step 1"
        title="Signing in"
        blurb="This is the first thing you'll see when you open the site."
        illustration={<Shot src="/how-to-use/01-signin.png" alt="Sign in screen" wide />}
        wide
        steps={[
          <Step key={1} n={1}>
            Enter the <strong className="text-paper">username</strong> and{' '}
            <strong className="text-paper">password</strong> you picked when you created your
            account.
          </Step>,
          <Step key={2} n={2}>
            Tap <strong className="text-paper">Sign in</strong> to go straight to your dashboard.
          </Step>,
          <Step key={3} n={3}>
            Don't have an account yet? Tap{' '}
            <strong className="text-paper">Create an account</strong> below the form instead.
          </Step>,
        ]}
        tip="Forgot your password? Ask your teacher to reset it for you."
      />

      <GuideSection
        id="register"
        eyebrow="Step 2"
        title="Creating an account"
        blurb="New students register here — this is a one-time step."
        illustration={
          <>
            <Shot src="/how-to-use/02-register-top.png" alt="Create account form, top" />
            <Shot src="/how-to-use/03-register-bottom.png" alt="Create account form, bottom" />
          </>
        }
        steps={[
          <Step key={1} n={1}>
            Fill in your <strong className="text-paper">full name</strong>, pick a{' '}
            <strong className="text-paper">username</strong> and{' '}
            <strong className="text-paper">password</strong>, and optionally add a{' '}
            <strong className="text-paper">recovery email</strong> (only used if you forget your
            password).
          </Step>,
          <Step key={2} n={2}>
            Choose the <strong className="text-paper">group(s)</strong> your teacher told you to
            join — up to 2 — and pick your{' '}
            <strong className="text-paper">target IELTS band</strong>. You can change your target
            band anytime later in Account Settings.
          </Step>,
          <Step key={3} n={3}>
            Tap <strong className="text-paper">Create account</strong>.
          </Step>,
        ]}
        tip="Your account can't log in until Mr Ikromov approves it — let him know once you've signed up."
      />

      <GuideSection
        id="homework"
        eyebrow="Step 3"
        title="Homework"
        blurb="Your dashboard's Homework tab — every assignment your teacher posts shows up here."
        illustration={<Shot src="/how-to-use/04-homework.png" alt="Homework tab" wide />}
        wide
        steps={[
          <Step key={1} n={1}>
            Each card shows an assignment, when it was posted, and when it's due. A red{' '}
            <strong className="text-paper">Incomplete</strong> badge means you haven't submitted
            it yet.
          </Step>,
          <Step key={2} n={2}>
            Tap a card to open it, read the instructions, and upload your work.
          </Step>,
          <Step key={3} n={3}>
            The <strong className="text-paper">Current group</strong> and{' '}
            <strong className="text-paper">Tasks</strong> numbers at the top just show how many
            assignments are waiting for you.
          </Step>,
        ]}
        tip="Uploading a file doesn't submit it by itself — open the assignment and tap Submit when you're ready."
      />

      <GuideSection
        id="wordlists"
        eyebrow="Step 4"
        title="Word Lists"
        blurb="Vocabulary sets your teacher builds for your class, grouped into units."
        illustration={<Shot src="/how-to-use/05-wordlists.png" alt="Word Lists tab" wide />}
        wide
        steps={[
          <Step key={1} n={1}>
            Each unit shows how many items it has. Tap{' '}
            <strong className="text-paper">Start practice</strong> on any unit to work through
            its words.
          </Step>,
          <Step key={2} n={2}>
            Come back and repeat a unit anytime your teacher resets it.
          </Step>,
        ]}
      />

      <GuideSection
        id="leaderboard"
        eyebrow="Step 5"
        title="Leaderboard"
        blurb="See how you're ranked against the rest of your group."
        illustration={<Shot src="/how-to-use/06-leaderboard.png" alt="Leaderboard tab" wide />}
        wide
        steps={[
          <Step key={1} n={1}>
            Your position (1, 2, 3…) is based on tasks completed and your streak.
          </Step>,
          <Step key={2} n={2}>
            The percentage and purple bar show your overall progress; the badges under each name
            show tasks done (like 8/18) and a streak counter (🔥 2 days).
          </Step>,
          <Step key={3} n={3}>
            Tap any student to see their progress in more detail.
          </Step>,
        ]}
      />

      <GuideSection
        id="groupchat"
        eyebrow="Step 6"
        title="Group Chat"
        blurb="Where your whole class talks together."
        illustration={<Shot src="/how-to-use/07-groupchat.png" alt="Group Chat tab" wide />}
        wide
        steps={[
          <Step key={1} n={1}>
            The list on the left shows your groups — tap one to open its chat on the right.
          </Step>,
          <Step key={2} n={2}>
            Use this for anything the whole class should see: questions about homework,
            announcements from your teacher, and so on.
          </Step>,
        ]}
      />

      <GuideSection
        id="chats"
        eyebrow="Step 7"
        title="Chats"
        blurb="Private, one-on-one conversations — with your teacher or a classmate directly."
        illustration={<Shot src="/how-to-use/08-chats.png" alt="Chats tab" wide />}
        wide
        steps={[
          <Step key={1} n={1}>
            Search for a person's name, or pick from your existing conversations on the left.
          </Step>,
          <Step key={2} n={2}>
            Chat with them privately on the right — unlike Group Chat, no one else can see this
            conversation.
          </Step>,
        ]}
      />

      <GuideSection
        id="account"
        eyebrow="Step 8"
        title="Account settings"
        blurb="Open this from the gear icon in the top bar."
        illustration={
          <>
            <Shot src="/how-to-use/09-account-settings.png" alt="Account settings — profile" />
            <Shot src="/how-to-use/10-account-settings-2.png" alt="Account settings — password and notifications" />
            <Shot src="/how-to-use/11-account-settings-3.png" alt="Account settings — recovery email, target band, session" />
          </>
        }
        steps={[
          <Step key={1} n={1}>
            Change your <strong className="text-paper">profile photo, username, full name, or
            bio</strong> — each one saves separately with its own Save button next to it. Your
            full name is what teachers and classmates see instead of your username.
          </Step>,
          <Step key={2} n={2}>
            <strong className="text-paper">Change password</strong>: enter your current password,
            then a new one (at least 6 characters) twice, and tap Update password.
          </Step>,
          <Step key={3} n={3}>
            Turn on <strong className="text-paper">push notifications</strong> to get alerts for
            new homework and deadlines even when the site isn't open, and connect{' '}
            <strong className="text-paper">Telegram</strong> to also get a heads-up 5 minutes
            before your speaking exam.
          </Step>,
          <Step key={4} n={4}>
            Add a <strong className="text-paper">recovery email</strong> so a password-reset link
            can reach you, and set your <strong className="text-paper">target band</strong> —
            shown around the site, like the crown badge in the top bar.
          </Step>,
        ]}
        tip="Log out signs you out of this device. Delete my account (in the danger zone) permanently removes your account — only use it if you're sure, it can't be undone."
      />

      <GuideSection
        id="mock-overview"
        eyebrow="Mock Test Center · Overview"
        title="Mock Test Center"
        blurb="A separate, full-screen space just for exams — tap 'Mock Test Center' on your dashboard to open it, away from the rest of the site."
        illustration={<Shot src="/how-to-use/12-mocktestcenter-overview.png" alt="Mock Test Center Overview tab" wide />}
        wide
        accent="lavender"
        steps={[
          <Step key={1} n={1} accent="lavender">
            <strong className="text-paper">Overview</strong> shows your Reading and Listening
            results so far (or "No attempts yet" if you haven't sat one).
          </Step>,
          <Step key={2} n={2} accent="lavender">
            Download a one-page <strong className="text-paper">score report</strong> PDF once you
            have results, and see feedback once a Writing mock has been marked.
          </Step>,
          <Step key={3} n={3} accent="lavender">
            Your <strong className="text-paper">target band</strong> is shown and changeable
            here too. Use <strong className="text-paper">Exit to dashboard</strong> (top right)
            to leave and go back to the regular site.
          </Step>,
        ]}
      />

      <GuideSection
        id="mock-checkin"
        eyebrow="Mock Test Center · Take a Test"
        title="Starting a mock exam"
        blurb="This is where you actually start a mock — a candidate check-in, just like a real IELTS test."
        illustration={<Shot src="/how-to-use/13-mocktestcenter-checkin.png" alt="Mock Test Center check-in screen" wide />}
        wide
        accent="lavender"
        steps={[
          <Step key={1} n={1} accent="lavender">
            Your teacher gives you a one-time <strong className="text-paper">access code</strong>{' '}
            for each mock session.
          </Step>,
          <Step key={2} n={2} accent="lavender">
            Enter your <strong className="text-paper">full name</strong> exactly as your teacher
            has it, plus that code, then tap <strong className="text-paper">Continue</strong>.
          </Step>,
        ]}
        tip="No code yet? Ask your teacher — every mock attempt needs one now, the same way a real IELTS test checks you in before you start."
      />

      <GuideSection
        id="mock-speaking"
        eyebrow="Mock Test Center · Speaking Exam"
        title="Your speaking exam"
        blurb="Shows your booked speaking exam slot once a speaking examiner has scheduled one."
        illustration={<Shot src="/how-to-use/14-mocktestcenter-speaking.png" alt="Mock Test Center Speaking Exam tab" wide />}
        wide
        accent="lavender"
        steps={[
          <Step key={1} n={1} accent="lavender">
            Once booked, you'll see the time and join link here, plus your band and feedback once
            it's marked.
          </Step>,
          <Step key={2} n={2} accent="lavender">
            Nothing booked yet? It'll say so, like in the screenshot above — message the speaking
            examiner (next tab) to arrange a time.
          </Step>,
        ]}
      />

      <GuideSection
        id="mock-examiners"
        eyebrow="Mock Test Center · Message Examiners"
        title="Messaging your examiners"
        blurb="A direct line to your speaking and writing examiners, right from the Mock Test Center."
        illustration={<Shot src="/how-to-use/15-mocktestcenter-examiners.png" alt="Mock Test Center Message Examiners tab" wide />}
        wide
        accent="lavender"
        steps={[
          <Step key={1} n={1} accent="lavender">
            Pick an examiner from the list on the left, then type your message on the right.
          </Step>,
          <Step key={2} n={2} accent="lavender">
            Use this to arrange a speaking exam time, ask about feedback, or any other question
            for your examiners.
          </Step>,
        ]}
      />

      <GuideSection
        id="forgot-password"
        eyebrow="Good to know"
        title="Forgot password"
        blurb="Tap 'Forgot password?' on the sign in screen if you can't remember yours."
        illustration={
          <>
            <Shot src="/how-to-use/16-forgot-password.png" alt="Forgot password screen, showing the confirmation message after requesting a reset link" wide />
            <Shot src="/how-to-use/17-forgot-password-email.png" alt="The password reset email" wide />
            <Shot src="/how-to-use/18-forgot-password-newpassword.png" alt="Choose a new password screen" wide />
          </>
        }
        wide
        accent="amber"
        steps={[
          <Step key={1} n={1} accent="amber">
            Enter the <strong className="text-paper">recovery email</strong> connected to your
            account, then tap <strong className="text-paper">Send reset link</strong>. You'll see
            a confirmation message once it's sent.
          </Step>,
          <Step key={2} n={2} accent="amber">
            Check that email for a message titled <strong className="text-paper">Reset your
            password</strong>, and click the <strong className="text-paper">Reset password</strong>{' '}
            link inside it.
          </Step>,
          <Step key={3} n={3} accent="amber">
            On the <strong className="text-paper">Choose a new password</strong> screen, type your
            new password twice (at least 6 characters) and tap{' '}
            <strong className="text-paper">Update password</strong>.
          </Step>,
          <Step key={4} n={4} accent="amber">
            You'll be taken straight back to the <strong className="text-paper">Sign in</strong>{' '}
            screen — sign in with your new password.
          </Step>,
        ]}
        tip="This only works if you've already added a recovery email in Account Settings. If you haven't, ask your teacher to reset your password for you instead."
      />

      <div className="rounded-2xl border border-line bg-panel px-5 py-4 text-center text-base text-paper-dim shadow-sm">
        Still stuck on something? Message your teacher directly from{' '}
        <strong className="text-paper">Chats</strong> — that's the fastest way to get help.
      </div>
    </div>
  )
}
