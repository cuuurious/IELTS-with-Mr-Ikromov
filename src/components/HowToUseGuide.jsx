import { useEffect, useState } from 'react'

/*
 * ================================================================
 * HOW TO USE — the student guide (rewritten 2026-11-08)
 * ================================================================
 * Used by StudentDashboard.jsx ('howto' tab) and TeacherDashboard.jsx,
 * so a teacher sees exactly what students see.
 *
 * Four groups: Getting started · Every day · Your progress · Exams &
 * help. Screenshots live in public/how-to-use/ (WebP). The new ones
 * (v2-*) were taken from the current site with demo data; the sign-in,
 * register, account and forgot-password pictures are the older real
 * captures and still match those screens.
 *
 * "Save as PDF" prints this page (print styles below hide the rest of
 * the site), so the PDF can never be out of date.
 * When a screen changes, retake its picture and edit its section here.
 * ================================================================
 */

const GROUPS = [
  { key: 'start', n: 1, label: 'Getting started' },
  { key: 'daily', n: 2, label: 'Every day' },
  { key: 'progress', n: 3, label: 'Your progress' },
  { key: 'help', n: 4, label: 'Exams & help' },
]

const SECTIONS = [
  { id: 'signin', group: 'start', label: 'Sign in' },
  { id: 'register', group: 'start', label: 'Create an account' },
  { id: 'one-device', group: 'start', label: 'Phone + computer' },
  { id: 'forgot-password', group: 'start', label: 'Forgot password' },
  { id: 'home', group: 'daily', label: 'Home' },
  { id: 'homework', group: 'daily', label: 'Homework' },
  { id: 'practice', group: 'daily', label: 'Practice books' },
  { id: 'writing-lab', group: 'daily', label: 'Writing Lab' },
  { id: 'words', group: 'daily', label: 'Word lists' },
  { id: 'my-progress', group: 'progress', label: 'My progress' },
  { id: 'leaderboard', group: 'progress', label: 'Leaderboard' },
  { id: 'coins', group: 'progress', label: 'Coins & rewards' },
  { id: 'tests', group: 'help', label: 'Listening & Reading tests' },
  { id: 'mock-center', group: 'help', label: 'Mock Test Center' },
  { id: 'chats', group: 'help', label: 'Chats' },
  { id: 'account', group: 'help', label: 'Account' },
]

// Picture sizes, so the page doesn't jump while pictures load.
const DIMS = {
  '01-signin': [1440, 900],
  '02-register-top': [1440, 900],
  '03-register-bottom': [1440, 900],
  '09-account-settings': [1440, 900],
  '10-account-settings-2': [1440, 900],
  '11-account-settings-3': [1440, 900],
  '16-forgot-password': [1440, 900],
  '17-forgot-password-email': [1400, 668],
  '18-forgot-password-newpassword': [1440, 900],
  'v2-before-submit': [811, 795],
  'v2-chats': [1334, 670],
  'v2-coins': [1334, 670],
  'v2-highlight': [811, 750],
  'v2-home-phone': [811, 1275],
  'v2-home': [1334, 787],
  'v2-homework': [1334, 670],
  'v2-leaderboard': [1334, 670],
  'v2-practice': [1334, 670],
  'v2-progress': [1334, 670],
  'v2-receipt': [811, 480],
  'v2-wordlists': [1334, 670],
  'v2-writing-lab': [1366, 860],
}

const B = ({ children }) => <strong className="font-extrabold text-paper">{children}</strong>

function Shot({ src, alt, phone }) {
  const [w, h] = DIMS[src.split('/').pop().replace(/\.webp$/, '')] || []
  return (
    <img
      src={src}
      width={w}
      height={h}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`guide-shot block h-auto rounded-[14px] border border-line bg-panel-2 w-full`}
      style={{ maxWidth: phone ? 300 : 960 }}
    />
  )
}

function Steps({ items }) {
  return (
    <ol className="mt-4 space-y-3">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[12px] bg-panel-2 font-brand text-[13px] font-semibold text-brass">
            {i + 1}
          </span>
          <span className="text-[15px] leading-7 text-paper-dim">{t}</span>
        </li>
      ))}
    </ol>
  )
}

function Tip({ children, warn }) {
  return (
    <div
      className="mt-5 rounded-[14px] px-4 py-3 text-[14px] leading-6 text-paper"
      style={{
        background: `color-mix(in srgb, var(--color-${warn ? 'coral' : 'brass'}) 9%, transparent)`,
        boxShadow: `inset 3px 0 0 var(--color-${warn ? 'coral' : 'brass'})`,
      }}
    >
      <span className={`font-extrabold ${warn ? 'text-coral' : 'text-brass'}`}>{warn ? 'Careful. ' : 'Tip. '}</span>
      {children}
    </div>
  )
}

// One section: text first, pictures after. `side` puts one phone picture
// beside the text on wide screens; `shots` go full width underneath.
function Section({ id, title, intro, steps, tip, warn, side, shots, phones, cols }) {
  const group = GROUPS.find((g) => g.key === SECTIONS.find((s) => s.id === id)?.group)
  return (
    <section id={id} style={{ scrollMarginTop: 150 }} className="guide-section rounded-[20px] border border-line bg-panel p-5 sm:p-7">
      <div className={side ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start' : ''}>
        <div className="min-w-0">
          {group && (
            <p className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-mist">
              {group.n} · {group.label}
            </p>
          )}
          <h2 className="mt-1 font-brand text-[20px] font-semibold leading-tight tracking-[-0.01em] text-paper sm:text-[24px]">{title}</h2>
          {intro && <p className="mt-2 max-w-3xl text-[15px] leading-7 text-paper-dim">{intro}</p>}
          {steps && <Steps items={steps} />}
          {tip && <Tip warn={warn}>{tip}</Tip>}
        </div>
        {side && <div className="flex justify-center">{side}</div>}
      </div>
      {phones && <div className="mt-6 flex flex-wrap justify-center gap-4 sm:justify-start">{phones}</div>}
      {shots && <div className={`mt-6 grid gap-4 ${cols ? 'sm:grid-cols-2 lg:grid-cols-3' : ''}`}>{shots}</div>}
    </section>
  )
}

function GroupHead({ g }) {
  return (
    <div id={`group-${g.key}`} style={{ scrollMarginTop: 150 }} className="guide-group flex items-center gap-3 pt-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-brass font-brand text-[15px] font-semibold text-onbrass">{g.n}</span>
      <h2 className="font-brand text-[18px] font-semibold text-paper sm:text-[20px]">{g.label}</h2>
    </div>
  )
}

const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  body * { visibility: hidden !important; }
  #howto-guide, #howto-guide * { visibility: visible !important; }
  body > * header, body > * nav, body > * aside, .registan-band, section[aria-label="Exam countdown"] { display: none !important; }
  main, main > div { padding: 0 !important; margin: 0 !important; max-width: none !important; }
  #howto-guide .no-print { display: none !important; }
  #howto-guide * { color: #111827 !important; background: transparent !important; box-shadow: none !important; }
  #howto-guide .guide-section { border: 1px solid #d1d5db !important; margin-bottom: 8mm; }
  #howto-guide .guide-group { break-after: avoid; }
  #howto-guide .guide-shot { break-inside: avoid; max-height: 110mm; width: auto !important; max-width: 100% !important; border: 1px solid #d1d5db !important; }
}
`

export default function HowToUseGuide() {
  const [active, setActive] = useState(SECTIONS[0].id)

  // Light up the menu chip of the section on screen.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (seen[0]) setActive(seen[0].target.id)
      },
      { rootMargin: '-120px 0px -60% 0px' }
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  // Keep the active chip visible in the scrolling menu on phones.
  useEffect(() => {
    // Only the menu scrolls sideways; scrollIntoView here would also move the page.
    const chip = document.getElementById(`chip-${active}`)
    const row = chip?.parentElement
    if (row) row.scrollTo({ left: chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2, behavior: 'smooth' })
  }, [active])

  const go = (id) => {
    setActive(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const S = '/how-to-use/'

  return (
    <div id="howto-guide" className="space-y-5">
      <style>{PRINT_CSS}</style>

      {/* Intro + the four groups */}
      <section className="rounded-[20px] border border-line bg-panel p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-brand text-[20px] font-semibold text-paper sm:text-[24px]">Your site, step by step</h2>
            <p className="mt-2 max-w-2xl text-[15px] leading-7 text-paper-dim">
              Read it once from the top, then come back to any part when you need it. The pictures are from the real site.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="no-print focus-ring h-10 shrink-0 self-start rounded-[14px] border border-brass px-4 text-[14px] font-extrabold text-brass hover:bg-[color-mix(in_srgb,var(--color-brass)_10%,transparent)]"
          >
            Save as PDF
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {GROUPS.map((g) => (
            <div key={g.key} className="rounded-[14px] bg-panel-2 p-4">
              <button type="button" onClick={() => go(`group-${g.key}`)} className="focus-ring flex items-center gap-2 rounded-[12px] text-left">
                <span className="flex h-7 w-7 items-center justify-center rounded-[12px] bg-brass font-brand text-[13px] font-semibold text-onbrass">{g.n}</span>
                <span className="text-[15px] font-extrabold text-paper">{g.label}</span>
              </button>
              <ul className="mt-2 space-y-1">
                {SECTIONS.filter((s) => s.group === g.key).map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => go(s.id)} className="focus-ring rounded-[8px] text-left text-[14px] font-semibold text-paper-dim hover:text-brass">
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Section menu: sticks to the top while reading, swipes sideways on phones */}
      <nav aria-label="Guide sections" className="no-print sticky z-30 -mx-1 rounded-[20px] border border-line bg-panel p-2" style={{ top: 81 }}>
        <div className="relative flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              id={`chip-${s.id}`}
              type="button"
              onClick={() => go(s.id)}
              className={`focus-ring shrink-0 whitespace-nowrap rounded-[12px] px-3 py-1.5 text-[13px] font-extrabold transition-colors ${
                active === s.id ? 'bg-brass text-onbrass' : 'text-mist hover:bg-panel-2 hover:text-paper'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ---------------- 1 · GETTING STARTED ---------------- */}
      <GroupHead g={GROUPS[0]} />

      <Section
        id="signin"
        title="Sign in"
        intro="The first screen you see when you open the site."
        steps={[
          <>Type your <B>username</B> and <B>password</B>.</>,
          <>Tap <B>Sign in</B>. You land on your Home page.</>,
          <>No account yet? Tap <B>Create an account</B> under the form.</>,
        ]}
        shots={<Shot src={`${S}01-signin.webp`} alt="Sign in screen" />}
      />

      <Section
        id="register"
        title="Create an account"
        intro="You do this once, on your first day."
        steps={[
          <>Write your <B>full name</B>, pick a <B>username</B> and a <B>password</B>.</>,
          <>Add a <B>recovery email</B>. It is the only way to reset your password yourself later.</>,
          <>Choose the <B>group</B> your teacher told you and your <B>target band</B>, then tap <B>Create account</B>.</>,
        ]}
        tip="Your account opens after Mr Ikromov approves it. Tell him when you have signed up."
        cols
        shots={
          <>
            <Shot src={`${S}02-register-top.webp`} alt="Create account form, top" />
            <Shot src={`${S}03-register-bottom.webp`} alt="Create account form, bottom" />
          </>
        }
      />

      <Section
        id="one-device"
        title="One phone and one computer"
        intro="Your account can be open on one phone and one computer at the same time, for example your own phone and a computer at the centre."
        steps={[
          <>Sign in on a <B>second phone</B> (or a second computer) and the old one is signed out within a minute.</>,
          <>Signed out with a message about another device? Just sign in again on the device you are using now.</>,
          <>If it happens and you didn&apos;t sign in anywhere else, change your password in <B>Account</B> and tell your teacher.</>,
        ]}
        tip="Don't share your login. Your teacher sees when one account keeps switching between phones or computers."
        warn
      />

      <Section
        id="forgot-password"
        title="Forgot password"
        intro="Tap “Forgot your password?” under the sign-in form."
        steps={[
          <>Type your <B>username</B> (best) or your recovery email and tap <B>Send reset link</B>.</>,
          <>Open the email <B>Reset your password</B>. Open only the <B>newest</B> one: each new request cancels the older links. Check spam too.</>,
          <>Type a new password twice and tap <B>Update password</B>, then sign in with it.</>,
        ]}
        tip="No recovery email on your account? The site can't send you a link. Message Mr Ikromov in Telegram and he will set a new password for you."
        cols
        shots={
          <>
            <Shot src={`${S}16-forgot-password.webp`} alt="Forgot password screen" />
            <Shot src={`${S}17-forgot-password-email.webp`} alt="The reset email" />
            <Shot src={`${S}18-forgot-password-newpassword.webp`} alt="Choose a new password" />
          </>
        }
      />

      {/* ---------------- 2 · EVERY DAY ---------------- */}
      <GroupHead g={GROUPS[1]} />

      <Section
        id="home"
        title="Home"
        intro="Everything for today on one page."
        steps={[
          <>The bar on top counts the <B>days to your exam</B> and shows your <B>target</B> and <B>forecast</B> band. Its button gives you the one thing to do next. Tap the number of days to set or change your exam date.</>,
          <>The big card shows your <B>next homework</B>. A red line means a deadline passed: tap <B>Do it now</B>, you can still hand it in late.</>,
          <><B>Today&apos;s plan</B> is a short list for today, like a 3-minute speaking warm-up. Tap <B>Start</B>.</>,
          <><B>Band forecast</B> is your likely band from your recent scores. It gets more exact as you do more tasks.</>,
        ]}
        tip="After your real exam the bar asks for your result. Please add it: it helps your teacher a lot."
        side={<Shot phone src={`${S}v2-home-phone.webp`} alt="Home page on a phone" />}
        shots={<Shot src={`${S}v2-home.webp`} alt="Home page on a computer" />}
      />

      <Section
        id="homework"
        title="Homework"
        intro="Every task your teacher sets. Use the chips on top: To do, Handed in, Missed, All."
        steps={[
          <>Tap a homework card to open it. Under <B>Do it here</B> you see each part with its own button: <B>Start</B> for a new one, <B>Again</B> to try once more.</>,
          <>Tasks done on the site (tests, pages, speaking) mark themselves as done and send your score to your teacher. You don&apos;t upload anything.</>,
          <>Your <B>first try</B> is the score that counts. Later tries are practice.</>,
          <>In a practice page, finish all the parts and tap <B>Hand in</B> (top right). You get a <B>✓ All answers saved</B> message with the time it was received.</>,
        ]}
        tip="Internet cut out? Your work is kept on your phone and sent by itself when you are back online. Don't close the page before it says it is saved."
        shots={<Shot src={`${S}v2-homework.webp`} alt="Homework card opened" />}
      />

      <Section
        id="practice"
        title="Practice books"
        intro="Mr Ikromov's Reading and Listening pages, sorted by question type, to practise on your own."
        steps={[
          <><B>My weak spots</B> shows the question types where you lose the most points. Tap <B>Practise</B> to go straight to them.</>,
          <>Switch between <B>Reading</B> and <B>Listening</B> on the shelf, then open a book.</>,
          <>Every score is saved and appears in My progress.</>,
        ]}
        tip="Double-tap any word in a passage to see its meaning in Uzbek and Russian, and save it to My words."
        shots={<Shot src={`${S}v2-practice.webp`} alt="Practice books" />}
      />

      <Section
        id="writing-lab"
        title="Writing Lab"
        intro="Step-by-step Writing chapters your teacher gives as homework. A coach checks every sentence you write."
        steps={[
          <>Go through the parts at the top in order: <B>Learn</B> first, then the practice parts.</>,
          <>Write your sentence and tap <B>Check</B>. The coach marks <B>Structure, Facts, Grammar and Spelling</B> and shows what to fix first.</>,
          <>Stuck? Tap <B>Hint</B>. Fix it and check again until it is green.</>,
          <>Your work is saved as you go. When you are happy, tap <B>Hand in</B>.</>,
        ]}
        shots={<Shot src={`${S}v2-writing-lab.webp`} alt="Writing Lab with the coach's feedback" />}
      />

      <Section
        id="words"
        title="Word lists & My words"
        intro="Vocabulary from your teacher, plus the words you save yourself."
        steps={[
          <><B>Daily Marathon</B>: 15 words, one try each. Come back every day.</>,
          <><B>My words</B>: the words you saved by double-tapping them in tests and books. Right answers come back later (tomorrow, in 3 days, in a week); wrong ones come back today.</>,
          <>Word lists from your teacher appear below. Tap one to practise it.</>,
          <>Tap <B>Show in Uzbek / Russian</B> on a word card to see the translation.</>,
        ]}
        shots={<Shot src={`${S}v2-wordlists.webp`} alt="Word lists page" />}
      />

      {/* ---------------- 3 · YOUR PROGRESS ---------------- */}
      <GroupHead g={GROUPS[2]} />

      <Section
        id="my-progress"
        title="My progress"
        intro="Every score you get on the site, week by week."
        steps={[
          <>The top row shows tasks in the last 30 days, your average score, your days in a row and your strongest skill.</>,
          <><B>Writing band</B> and <B>Speaking band</B> show your marked work over time and what to work on next.</>,
          <><B>Last 10 weeks</B> shows if your Reading and Listening are going up.</>,
        ]}
        shots={<Shot src={`${S}v2-progress.webp`} alt="My progress" />}
      />

      <Section
        id="leaderboard"
        title="Leaderboard"
        intro="A weekly race inside your group. A new season starts every week."
        steps={[
          <>Your place depends on homework handed in and your days in a row (🔥). Tap <B>How points work</B> to see the rules.</>,
          <>Your own card shows your place and what to do to move up.</>,
          <>The group that wins the week gets bonus coins for everyone in it.</>,
        ]}
        shots={<Shot src={`${S}v2-leaderboard.webp`} alt="Leaderboard" />}
      />

      <Section
        id="coins"
        title="Coins & rewards"
        intro="You earn coins by doing your work well and on time, and spend them on real things."
        steps={[
          <>Earn coins for homework <B>on time</B>, several on-time homeworks <B>in a row</B>, high scores on your first try, good Writing or Speaking bands and your group winning the week.</>,
          <>Spend them in the <B>Rewards shop</B> (books, notebooks and more) or on Mr Ikromov&apos;s video courses and mock exams.</>,
          <>Ordering holds the coins. Mr Ikromov gives you the item in class. If he declines, the coins come back. Tap ☆ on a reward to save up for it: Home shows how many coins are left to go.</>,
        ]}
        shots={<Shot src={`${S}v2-coins.webp`} alt="Coins and rewards shop" />}
      />

      {/* ---------------- 4 · EXAMS & HELP ---------------- */}
      <GroupHead g={GROUPS[3]} />

      <Section
        id="tests"
        title="Listening & Reading tests"
        intro="Full tests look like the real computer IELTS. A few helpers make practice easier."
        steps={[
          <><B>Highlight</B>: select words with your finger or mouse and tap <B>Highlight</B>. Tap a highlight to remove it, or <B>Clear all</B>.</>,
          <>In Listening the audio plays <B>once</B>, like the real exam. You can&apos;t pause or rewind, so read the questions before each part starts.</>,
          <>Before you submit, the site shows <B>how many questions you answered</B>. Tap a red number to go back to it, or <B>Submit anyway</B>.</>,
          <>Then tap <B>Hand in</B>. The message <B>✓ All answers saved</B> with your score and the time means your teacher has it.</>,
        ]}
        phones={
          <>
            <Shot phone src={`${S}v2-highlight.webp`} alt="Highlight button on selected words" />
            <Shot phone src={`${S}v2-before-submit.webp`} alt="Answered-questions check before submit" />
            <Shot phone src={`${S}v2-receipt.webp`} alt="All answers saved message" />
          </>
        }
      />

      <Section
        id="mock-center"
        title="Mock Test Center"
        intro="Full mock exams in a separate, full-screen space, just like test day. Open it from Mocks in the menu."
        steps={[
          <>Each mock needs a one-time <B>access code</B> from your teacher. Type your full name and the code to check in.</>,
          <>Your Listening and Reading results appear in <B>Overview</B>, with a score report you can download. Writing and Speaking feedback appears there once they are marked.</>,
          <>Your <B>speaking exam</B> time and join link show up once an examiner books you. You can message your examiners from the same place.</>,
        ]}
        tip="During a mock, stay on the page: leaving the exam screen is reported to your teacher."
        warn
      />

      <Section
        id="chats"
        title="Chats"
        intro="Group chat for your whole class, and private chats with your teacher or classmates."
        steps={[
          <><B>Group chat</B>: questions everyone can see, and announcements from your teacher.</>,
          <><B>Chats</B>: search for a name and talk privately. Only the two of you see it.</>,
        ]}
        shots={<Shot src={`${S}v2-chats.webp`} alt="Chats page" />}
      />

      <Section
        id="account"
        title="Account"
        intro="Tap your initials in the top-right corner, then Account settings."
        steps={[
          <>Change your <B>photo, name and bio</B>. Your full name is what teachers and classmates see.</>,
          <>Change your <B>password</B> (at least 6 characters).</>,
          <>Turn on <B>notifications</B> and connect <B>Telegram</B> for homework reminders and a message before your speaking exam.</>,
          <>Add a <B>recovery email</B> and set your <B>target band</B>.</>,
        ]}
        tip="Delete my account removes everything for good. It can't be undone."
        warn
        cols
        shots={
          <>
            <Shot src={`${S}09-account-settings.webp`} alt="Account settings, profile" />
            <Shot src={`${S}10-account-settings-2.webp`} alt="Account settings, password and notifications" />
            <Shot src={`${S}11-account-settings-3.webp`} alt="Account settings, recovery email and target band" />
          </>
        }
      />

      <div className="rounded-[20px] border border-line bg-panel px-5 py-4 text-center text-[15px] text-paper-dim">
        Still stuck? Message your teacher in <B>Chats</B>. That is the fastest way to get help.
      </div>
    </div>
  )
}
