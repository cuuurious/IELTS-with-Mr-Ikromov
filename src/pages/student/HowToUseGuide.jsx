import { useState } from 'react'

/*
 * ================================================================
 * HOW TO USE — student onboarding guide
 * ================================================================
 * A self-contained walkthrough of every corner of the student
 * portal, built for brand-new students. Lives as its own sidebar
 * tab ('howto') in StudentDashboard.jsx.
 *
 * The little screen illustrations below are NOT screenshots — they
 * are drawn with the app's own Tailwind classes and CSS color
 * tokens (bg-panel, bg-panel-2, border-line, text-mist, bg-brass,
 * etc. — see src/index.css) so they look like the real thing
 * without needing a live screenshot pipeline. If the real UI's
 * copy or layout changes, update the matching <Mock… /> component
 * below to match.
 *
 * A matching static HTML/PDF version of this same content lives in
 * scripts/how-to-use-pdf (see that folder's README) — keep both in
 * sync when this file changes.
 * ================================================================
 */

const SECTIONS = [
  { key: 'welcome', label: 'Signing in' },
  { key: 'dashboard', label: 'Your dashboard' },
  { key: 'homework', label: 'Homework' },
  { key: 'wordlists', label: 'Word Lists' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'chat', label: 'Group Chat & Chats' },
  { key: 'mock', label: 'Mock Test Center' },
  { key: 'account', label: 'Account settings' },
]

/* ---------------------------------------------------------------
   Shared little building blocks for the illustrations
   --------------------------------------------------------------- */

function Dot({ className = '' }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${className}`} />
}

function MockFrame({ children, label }) {
  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-line bg-panel-2 px-3 py-2">
          <Dot className="bg-coral" />
          <Dot className="bg-amber" />
          <Dot className="bg-sage" />
          <span className="ml-2 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-mist">
            {label}
          </span>
        </div>
        <div className="p-3 sm:p-4">{children}</div>
      </div>
    </div>
  )
}

function MiniSidebar({ activeIndex }) {
  const items = ['Homework', 'Word Lists', 'Leaderboard', 'Group Chat', 'Chats']
  return (
    <div className="hidden w-28 shrink-0 flex-col gap-1 border-r border-line pr-2 sm:flex">
      {items.map((item, i) => (
        <div
          key={item}
          className={`truncate rounded-md px-2 py-1.5 text-[10px] ${
            i === activeIndex
              ? 'bg-brass/15 font-semibold text-brass'
              : 'text-mist'
          }`}
        >
          {item}
        </div>
      ))}
      <div className="mt-1 rounded-md border border-brass/30 bg-brass/10 px-2 py-1.5 text-[10px] font-semibold text-brass">
        Mock Test Center
      </div>
    </div>
  )
}

function Step({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brass/15 text-xs font-semibold text-brass">
        {n}
      </span>
      <span className="pt-0.5 text-sm leading-6 text-mist">{children}</span>
    </li>
  )
}

function GuideSection({ id, eyebrow, title, blurb, illustration, steps, tip }) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-2xl border border-line bg-panel shadow-sm"
    >
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-2 lg:items-start">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
            {eyebrow}
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold text-paper sm:text-2xl">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-mist">{blurb}</p>

          <ol className="mt-5 space-y-3">{steps}</ol>

          {tip && (
            <div className="mt-5 rounded-xl border border-cyan/30 bg-cyan/10 px-4 py-3 text-sm leading-6 text-paper">
              <span className="font-semibold text-cyan">Tip. </span>
              {tip}
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-24">{illustration}</div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------
   Illustrations, one per section — built from real copy & colors
   --------------------------------------------------------------- */

function IllustrationLogin() {
  return (
    <MockFrame label="Sign in">
      <div className="mx-auto max-w-[220px] py-2">
        <p className="text-center font-display text-base font-semibold text-paper">
          Sign in
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-mist">
              Username
            </p>
            <div className="mt-1 rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs text-paper-dim">
              e.g. aziz_08
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-mist">
              Password
            </p>
            <div className="mt-1 rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs text-paper-dim">
              ••••••••••
            </div>
          </div>
          <div className="rounded-full bg-brass px-3 py-2 text-center text-xs font-semibold text-onbrass">
            Sign in
          </div>
        </div>
      </div>
    </MockFrame>
  )
}

function IllustrationDashboard() {
  return (
    <MockFrame label="Candidate portal · Homework">
      <div className="flex gap-3">
        <MiniSidebar activeIndex={0} />
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-mist">
                Candidate portal
              </p>
              <p className="font-display text-sm font-semibold text-paper">
                Homework
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-md border border-line bg-panel-2 text-[10px] text-mist">
                ☾
              </span>
              <span className="flex h-6 w-6 items-center justify-center rounded-md border border-line bg-panel-2 text-[10px] text-mist">
                🔔
              </span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brass text-[10px] font-semibold text-onbrass">
                A
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-[10px] text-mist">
            Keep track of your assignments and submit your work on time.
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="h-10 rounded-lg border border-line bg-panel-2" />
            <div className="h-10 rounded-lg border border-line bg-panel-2" />
          </div>
        </div>
      </div>
    </MockFrame>
  )
}

function IllustrationHomework() {
  return (
    <MockFrame label="Homework">
      <div className="space-y-2.5">
        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-paper">Writing Task 2 — Practice 4</p>
            <span className="rounded-full bg-coral/15 px-2 py-0.5 text-[9px] font-semibold text-coral">
              Due tomorrow
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex h-7 flex-1 items-center rounded-md border border-dashed border-line px-2 text-[9px] text-mist">
              Drop a file or tap to upload
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-panel-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-paper">Listening Practice 12</p>
            <span className="rounded-full bg-sage/15 px-2 py-0.5 text-[9px] font-semibold text-sage">
              ✓ Submitted
            </span>
          </div>
        </div>
        <div className="rounded-full bg-brass px-3 py-1.5 text-center text-[11px] font-semibold text-onbrass">
          Submit Task
        </div>
      </div>
    </MockFrame>
  )
}

function IllustrationWordlists() {
  return (
    <MockFrame label="Word Lists">
      <div className="grid grid-cols-2 gap-2">
        {['Unit 4 · Environment', 'Unit 5 · Education', 'Unit 6 · Health', 'Unit 7 · Technology'].map(
          (name) => (
            <div key={name} className="rounded-lg border border-line bg-panel-2 p-2.5">
              <p className="truncate text-[10px] font-semibold text-paper">{name}</p>
              <div className="mt-2 h-1.5 w-full rounded-full bg-line">
                <div className="h-1.5 w-2/3 rounded-full bg-brass" />
              </div>
            </div>
          )
        )}
      </div>
    </MockFrame>
  )
}

function IllustrationLeaderboard() {
  const rows = [
    { name: 'Malika R.', pts: 1280, rank: 1 },
    { name: 'You', pts: 1140, rank: 2, me: true },
    { name: 'Jasur T.', pts: 980, rank: 3 },
  ]
  return (
    <MockFrame label="Leaderboard">
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.name}
            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
              r.me
                ? 'border-brass/40 bg-brass/10 text-paper'
                : 'border-line bg-panel-2 text-mist'
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-[10px]">#{r.rank}</span>
              {r.name}
            </span>
            <span className="font-semibold">{r.pts} pts</span>
          </div>
        ))}
      </div>
    </MockFrame>
  )
}

function IllustrationChat() {
  return (
    <MockFrame label="Group Chat">
      <div className="space-y-2">
        <div className="max-w-[75%] rounded-xl rounded-tl-sm bg-panel-2 px-3 py-2 text-[10px] text-paper-dim">
          Don't forget — mock speaking exam bookings open tonight!
        </div>
        <div className="ml-auto max-w-[75%] rounded-xl rounded-tr-sm bg-brass px-3 py-2 text-[10px] text-onbrass">
          Got it, thank you 🙏
        </div>
        <div className="mt-2 flex items-center gap-2 rounded-full border border-line bg-panel-2 px-3 py-1.5">
          <span className="flex-1 text-[10px] text-mist">Write a message…</span>
          <span className="text-[10px] text-brass">➤</span>
        </div>
      </div>
    </MockFrame>
  )
}

function IllustrationMockCheckIn() {
  return (
    <MockFrame label="Mock Test Center · Take a Test">
      <div className="mx-auto max-w-[220px] py-1">
        <p className="text-center font-mono text-[9px] uppercase tracking-[0.14em] text-mist">
          Candidate check-in
        </p>
        <div className="mt-3 space-y-2.5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-mist">
              Full name
            </p>
            <div className="mt-1 rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs text-paper-dim">
              Aziz Karimov
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-mist">
              Access code
            </p>
            <div className="mt-1 rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs tracking-[0.2em] text-paper-dim">
              7F3K92
            </div>
          </div>
          <div className="rounded-full bg-brass px-3 py-2 text-center text-xs font-semibold text-onbrass">
            Continue →
          </div>
        </div>
      </div>
    </MockFrame>
  )
}

function IllustrationAccount() {
  return (
    <MockFrame label="Account settings">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brass text-xs font-semibold text-onbrass">
            A
          </span>
          <span className="rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[10px] text-mist">
            Change photo
          </span>
        </div>
        {['Username', 'Full name', 'Bio'].map((f) => (
          <div key={f} className="flex items-center gap-2">
            <div className="flex-1 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[10px] text-paper-dim">
              {f}
            </div>
            <span className="rounded-full bg-brass px-2.5 py-1 text-[9px] font-semibold text-onbrass">
              Save
            </span>
          </div>
        ))}
        <div className="rounded-lg border border-line px-2.5 py-1.5 text-[10px] text-mist">
          Change password
        </div>
      </div>
    </MockFrame>
  )
}

/* ---------------------------------------------------------------
   Main component
   --------------------------------------------------------------- */

export default function HowToUseGuide() {
  const [active, setActive] = useState('welcome')

  const scrollTo = (key) => {
    setActive(key)
    document.getElementById(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-5">
      {/* Header / intro card */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-brass/10 blur-3xl" />
          <div className="absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-sage/10 blur-3xl" />
        </div>
        <div className="relative px-5 py-5 sm:px-7 sm:py-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mist">
            New here?
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-paper">
            How to use your portal
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-mist">
            A full walkthrough of every section of the site — homework, word lists, the
            leaderboard, chat, and the Mock Test Center. Read it top to bottom the first
            time, then come back to any section whenever you need a reminder.
          </p>
          <a
            href="/how-to-use-ielts-portal.pdf"
            download
            className="focus-ring mt-4 inline-flex items-center gap-2 rounded-full bg-brass px-4 py-2 text-sm font-semibold text-onbrass shadow-sm transition-colors hover:brightness-105"
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
            className={`focus-ring rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
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
        id="welcome"
        eyebrow="Step 1"
        title="Signing in"
        blurb="You'll get a username and password from your teacher — this account is set up for you, so there's no sign-up form to fill in yourself."
        illustration={<IllustrationLogin />}
        steps={[
          <Step key={1} n={1}>
            Open the site your teacher shared and find the <strong className="text-paper">Sign in</strong> card.
          </Step>,
          <Step key={2} n={2}>
            Enter the <strong className="text-paper">Username</strong> and{' '}
            <strong className="text-paper">Password</strong> your teacher gave you, exactly as sent —
            usernames are case-sensitive.
          </Step>,
          <Step key={3} n={3}>
            Tap <strong className="text-paper">Sign in</strong>. You'll land straight on your dashboard.
          </Step>,
        ]}
        tip="Lost your password? Ask your teacher to reset it — students can't self-recover an account from the sign-in screen."
      />

      <GuideSection
        id="dashboard"
        eyebrow="Step 2"
        title="Your dashboard"
        blurb="Everything lives behind the sidebar on the left. The top bar always shows where you are, plus quick access to dark mode, notifications, and your account."
        illustration={<IllustrationDashboard />}
        steps={[
          <Step key={1} n={1}>
            The sidebar lists <strong className="text-paper">Homework</strong>,{' '}
            <strong className="text-paper">Word Lists</strong>,{' '}
            <strong className="text-paper">Leaderboard</strong>,{' '}
            <strong className="text-paper">Group Chat</strong> and{' '}
            <strong className="text-paper">Chats</strong> — tap any of them to switch sections.
          </Step>,
          <Step key={2} n={2}>
            The highlighted <strong className="text-paper">Mock Test Center</strong> button opens a
            separate, full-screen exam environment — more on that below.
          </Step>,
          <Step key={3} n={3}>
            Top-right: the moon icon toggles light/dark mode, the bell shows notifications, and your
            initial opens account settings (gear icon on desktop).
          </Step>,
        ]}
      />

      <GuideSection
        id="homework"
        eyebrow="Step 3"
        title="Homework"
        blurb="Every assignment your teacher posts appears here as a card, with a due date and a place to upload your work."
        illustration={<IllustrationHomework />}
        steps={[
          <Step key={1} n={1}>
            Open a homework card to read the instructions. A red badge means it's due soon or overdue.
          </Step>,
          <Step key={2} n={2}>
            Upload your file (or record/write your answer, depending on the task) — uploading alone does{' '}
            <strong className="text-paper">not</strong> submit it yet.
          </Step>,
          <Step key={3} n={3}>
            When you're happy with it, tap <strong className="text-paper">Submit Task</strong>. Submitted
            work is marked with a green checkmark and the time you sent it.
          </Step>,
        ]}
        tip="You can keep re-uploading a file until you actually tap Submit Task — so double-check before you submit, since a submitted task is graded as-is."
      />

      <GuideSection
        id="wordlists"
        eyebrow="Step 4"
        title="Word Lists"
        blurb="Vocabulary sets your teacher builds for your class, grouped into units. Practicing them regularly is what moves the progress bar."
        illustration={<IllustrationWordlists />}
        steps={[
          <Step key={1} n={1}>
            Pick a unit from the grid — each one shows how far along you are.
          </Step>,
          <Step key={2} n={2}>
            Work through the words inside; right answers move the bar forward.
          </Step>,
          <Step key={3} n={3}>
            Come back anytime — your progress on every list is saved automatically.
          </Step>,
        ]}
      />

      <GuideSection
        id="leaderboard"
        eyebrow="Step 5"
        title="Leaderboard"
        blurb="A friendly ranking of you and your classmates, based on points earned from homework and practice."
        illustration={<IllustrationLeaderboard />}
        steps={[
          <Step key={1} n={1}>
            Find your row — it's highlighted so it's easy to spot among your classmates.
          </Step>,
          <Step key={2} n={2}>
            Submitting homework on time and practicing your word lists are what earn you points.
          </Step>,
        ]}
      />

      <GuideSection
        id="chat"
        eyebrow="Step 6"
        title="Group Chat & Chats"
        blurb="Group Chat is the shared space for your whole class and teacher. Chats is for one-on-one, private conversations."
        illustration={<IllustrationChat />}
        steps={[
          <Step key={1} n={1}>
            Use <strong className="text-paper">Group Chat</strong> for announcements and questions the
            whole class benefits from.
          </Step>,
          <Step key={2} n={2}>
            Use <strong className="text-paper">Chats</strong> when you need to message your teacher (or a
            classmate) privately.
          </Step>,
          <Step key={3} n={3}>
            Type your message in the box at the bottom and tap send — that's it.
          </Step>,
        ]}
      />

      <GuideSection
        id="mock"
        eyebrow="Step 7"
        title="Mock Test Center"
        blurb="A separate, focused environment for full timed practice exams — Reading, Listening, Writing and Speaking — that mirrors the real IELTS test day."
        illustration={<IllustrationMockCheckIn />}
        steps={[
          <Step key={1} n={1}>
            From the sidebar, tap <strong className="text-paper">Mock Test Center</strong>. It opens
            full-screen, separate from the rest of the site.
          </Step>,
          <Step key={2} n={2}>
            Inside, <strong className="text-paper">Overview</strong> shows what's available;{' '}
            <strong className="text-paper">Take a Test</strong> is where you check in with your{' '}
            <strong className="text-paper">full name</strong> and the{' '}
            <strong className="text-paper">access code</strong> your teacher gave you for that session.
          </Step>,
          <Step key={3} n={3}>
            <strong className="text-paper">Speaking Exam</strong> is where you book and take your speaking
            test with a real examiner; <strong className="text-paper">Message Examiners</strong> lets you
            reach them directly with questions.
          </Step>,
          <Step key={4} n={4}>
            Exit anytime with the on-screen exit control — you'll land back exactly where you left off on
            your dashboard.
          </Step>,
        ]}
        tip="Treat a mock test like the real thing once you check in — switching tabs or leaving mid-test can be flagged, just like it would be in an exam room."
      />

      <GuideSection
        id="account"
        eyebrow="Step 8"
        title="Account settings"
        blurb="Update your photo, name, bio and password any time from the gear icon in the top bar."
        illustration={<IllustrationAccount />}
        steps={[
          <Step key={1} n={1}>
            Tap the gear icon in the top bar (or your avatar on mobile) to open{' '}
            <strong className="text-paper">Account settings</strong>.
          </Step>,
          <Step key={2} n={2}>
            Update your profile photo, username, full name or bio — each field saves on its own with a{' '}
            <strong className="text-paper">Save</strong> button next to it.
          </Step>,
          <Step key={3} n={3}>
            Use <strong className="text-paper">Change password</strong> to set a new password, and add a
            recovery email so you can get back in if you ever forget it.
          </Step>,
        ]}
      />

      <div className="rounded-2xl border border-line bg-panel px-5 py-4 text-center text-sm text-mist shadow-sm">
        Still stuck on something? Message your teacher directly from{' '}
        <strong className="text-paper">Chats</strong> — that's the fastest way to get help.
      </div>
    </div>
  )
}
