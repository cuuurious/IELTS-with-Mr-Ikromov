import { Link } from 'react-router-dom'

/*
 * AUTH SHELL — one frame for Sign in, Create account, Forgot
 * password and Reset password (redesign approved 2026-11-01).
 *
 * Left: the lapis-to-turquoise band with Mr Ikromov's photo, three
 * facts about him and six tiles that show, as small drawings, what a
 * student gets on the site. Right: a soft blue panel with arch shapes
 * and the form card. Colours come from the tokens in index.css so
 * the frame follows light and dark mode.
 */

export const authInputClass =
  'focus-ring mt-1.5 h-12 w-full rounded-[14px] border border-line bg-[color-mix(in_srgb,var(--color-brass)_4%,var(--color-panel))] px-4 text-[15px] text-paper placeholder:text-mist outline-none transition focus:border-brass focus:ring-4 focus:ring-brass/15'

export const authPrimaryButtonClass =
  'focus-ring auth-cta inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] px-5 text-[16px] font-extrabold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60'

export function AuthField({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-extrabold text-paper">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs font-semibold text-mist">{hint}</span>}
    </label>
  )
}

export function AuthNotice({ tone = 'error', children }) {
  const styles =
    tone === 'success'
      ? 'bg-reading-tint text-reading'
      : 'bg-urgent-tint text-urgent'
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-[14px] px-4 py-3 text-sm font-semibold leading-relaxed ${styles}`}>
      {children}
    </p>
  )
}

function InstagramIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.2 6.8h.01" />
    </svg>
  )
}

function TelegramIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 4 3 11l6 2.5L19 7l-7.5 8L18 20z" />
    </svg>
  )
}

/* ---- the six drawings ---- */

function Tick() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" aria-hidden="true">
      <path d="M4 12l5 5L20 6" />
    </svg>
  )
}

function HomeworkArt() {
  const rows = [
    { t: 'Reading Test 14', done: true, due: 'Done', cls: 'bg-[#dcf2e6] text-[#17704a]' },
    { t: 'Writing Task 2', done: false, due: 'Thu', cls: 'bg-writing-tint text-writing' },
    { t: 'Speaking Part 2', done: false, due: 'Sat', cls: 'bg-speaking-tint text-speaking' },
  ]
  return (
    <div className="flex w-full max-w-[250px] flex-col gap-[7px] rounded-[14px] bg-panel px-3 py-2.5 shadow-[0_6px_16px_rgba(36,86,176,0.15)]">
      {rows.map((r) => (
        <div key={r.t} className="flex items-center gap-2 text-[12px] font-extrabold">
          <span className={`grid h-[18px] w-[18px] place-items-center rounded-[6px] ${r.done ? 'bg-[#1f8f5c]' : 'border-2 border-line'}`}>
            {r.done && <Tick />}
          </span>
          <span className={`flex-1 truncate ${r.done ? 'text-mist line-through' : 'text-paper'}`}>{r.t}</span>
          <span className={`rounded-[7px] px-[7px] py-0.5 text-[10px] ${r.cls}`}>{r.due}</span>
        </div>
      ))}
    </div>
  )
}

function MockArt() {
  return (
    <div className="w-full max-w-[250px] overflow-hidden rounded-xl bg-panel shadow-[0_6px_16px_rgba(31,78,140,0.18)]">
      <div className="flex justify-between bg-listening px-2.5 py-1.5 text-[11px] font-extrabold text-white">
        <span>Listening, Part 2</span>
        <span className="font-brand">28:41</span>
      </div>
      <div className="flex flex-col gap-[5px] px-2.5 py-2">
        <span className="h-[5px] w-[90%] rounded bg-listening-tint" />
        <span className="h-[5px] w-[70%] rounded bg-listening-tint" />
        <div className="mt-1 flex gap-[3px]">
          {Array.from({ length: 10 }, (_, i) => (
            <span
              key={i}
              className={`h-3.5 flex-1 rounded ${i < 6 ? 'bg-listening' : i === 6 ? 'border-[1.5px] border-listening bg-panel' : 'bg-listening-tint'}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function FeedbackArt() {
  return (
    <div className="relative w-full max-w-[250px]">
      <div className="flex flex-col gap-1.5 rounded-xl bg-panel px-3 py-2.5 shadow-[0_6px_16px_rgba(154,91,18,0.18)]">
        <span className="h-[5px] w-[80%] rounded bg-writing-tint" />
        <span className="h-[5px] w-[72%] rounded bg-[#f6d79c]" />
        <span className="h-[5px] w-[76%] rounded bg-writing-tint" />
        <span className="text-[10px] font-extrabold text-writing">Great linking. Vary your verbs.</span>
        <span className="inline-flex items-center gap-1 self-start rounded-[7px] bg-[#dcf2e6] px-[7px] py-[3px] text-[10px] font-extrabold text-[#17704a]">
          <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" aria-hidden="true"><path d="M4 12l5 5L20 6" /></svg>
          Approved by Mr Ikromov
        </span>
      </div>
      <div className="absolute -right-1.5 -top-2.5 rounded-xl bg-brass px-2 py-1 text-center text-white">
        <div className="font-brand text-[15px] font-bold leading-tight">7.5</div>
        <div className="text-[9px] font-extrabold">band</div>
      </div>
    </div>
  )
}

function LibraryArt() {
  const books = [
    { c: 'bg-reading', h: 84, n: 38, l: 'Reading' },
    { c: 'bg-listening', h: 74, n: 53, l: 'Listen' },
    { c: 'bg-writing', h: 66, n: 81, l: 'Task 1' },
    { c: 'bg-[#b8641a]', h: 78, n: 91, l: 'Task 2' },
  ]
  return (
    <div className="flex h-[84px] items-end gap-1.5">
      {books.map((b) => (
        <div key={b.l} style={{ height: b.h }} className={`flex w-[38px] flex-col items-center justify-end rounded-t-lg rounded-b pb-1.5 text-[9px] font-extrabold text-white ${b.c}`}>
          <span className="font-brand text-[11px] font-bold">{b.n}</span>
          {b.l}
        </div>
      ))}
    </div>
  )
}

function CoinsArt() {
  const coin = 'absolute grid h-11 w-11 place-items-center rounded-full border-[3px] border-[#f6c56b] bg-saffron font-brand text-sm font-bold text-[#7a4a0c]'
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[70px] w-[70px]">
        <span className={coin} style={{ left: 0, top: 22 }} />
        <span className={coin} style={{ left: 22, top: 0 }} />
        <span className={coin} style={{ left: 18, top: 24 }}>C</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="rounded-[9px] bg-[#dcf2e6] px-2 py-1 text-[12px] font-extrabold text-[#17704a]">+10 on time</span>
        <span className="rounded-[9px] bg-panel px-2 py-1 text-[12px] font-extrabold text-paper">Swap for a full mock</span>
      </div>
    </div>
  )
}

function VideoArt() {
  return (
    <div className="w-full max-w-[250px] overflow-hidden rounded-xl bg-[linear-gradient(135deg,#3b2a63,#6a3f99)] shadow-[0_6px_16px_rgba(106,63,153,0.25)]">
      <div className="flex h-[66px] items-center gap-2.5 px-2.5">
        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-white">
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="#6a3f99" /></svg>
        </span>
        <span className="text-[11px] font-extrabold leading-tight text-white">Reading marathon<br />Lesson 3</span>
      </div>
      <div className="h-[5px] bg-white/25"><div className="h-full w-2/5 bg-saffron" /></div>
    </div>
  )
}

const PERKS = [
  { art: HomeworkArt, bg: 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))]', title: 'All homework in one place', text: 'See what’s due and hand it in from your phone.' },
  { art: MockArt, bg: 'bg-listening-tint', title: 'Mocks like the real test', text: 'The real computer-test screen, timer and all.' },
  { art: FeedbackArt, bg: 'bg-writing-tint', title: 'Feedback from examiners', text: 'Mocks marked by examiners and approved by Mr Ikromov.' },
  { art: LibraryArt, bg: 'bg-reading-tint', title: 'Practice library', text: 'Hundreds of tests to practise on your own.' },
  { art: CoinsArt, bg: 'bg-[color-mix(in_srgb,var(--color-saffron)_18%,var(--color-panel))]', title: 'Coins for hard work', text: 'Earn coins for homework on time, spend them on mocks.' },
  { art: VideoArt, bg: 'bg-speaking-tint', title: 'Video lessons', text: 'Reading marathons and lessons to watch again.' },
]

const FACTS = [
  { value: '10,000+', label: 'students taught' },
  { value: '10 years', label: 'teaching IELTS' },
  { value: 'Band 9', label: 'in Reading, 3 times' },
]

const SKILL_LABELS = [
  { label: 'Listening', cls: 'text-listening' },
  { label: 'Reading', cls: 'text-reading' },
  { label: 'Writing', cls: 'text-writing' },
  { label: 'Speaking', cls: 'text-speaking' },
]

export default function AuthShell({ title, subtitle, cardTitle, cardSubtitle, children, footer }) {
  return (
    <div className="min-h-screen bg-ink text-paper">
      <div className="mx-auto grid min-h-screen max-w-[1440px] grid-cols-1 gap-4 p-3 sm:gap-6 sm:p-6 lg:grid-cols-[1.15fr_1fr]">
        {/* LEFT — the school */}
        <section className="registan-band order-2 flex flex-col gap-6 rounded-[28px] px-5 py-7 sm:px-9 sm:py-9 lg:order-1">
          <Link to="/login" className="focus-ring flex w-fit items-center gap-3 rounded-xl text-onband">
            <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-[#ffffff] font-brand text-[15px] font-bold text-[#2456b0]">MI</span>
            <span className="flex flex-col leading-tight">
              <span className="text-[17px] font-extrabold">IELTS with Mr Ikromov</span>
              <span className="text-[13px] text-onband-dim">Mr Jasur Ikromov’s IELTS school</span>
            </span>
          </Link>

          <div className="grid items-end gap-6 sm:grid-cols-[170px_minmax(0,1fr)]">
            <div className="relative hidden h-[210px] w-[170px] sm:block">
              <div className="absolute inset-[14px_-14px_-8px_14px] rounded-[999px_999px_22px_22px] bg-white/15" aria-hidden="true" />
              <div className="absolute inset-0 overflow-hidden rounded-[999px_999px_22px_22px] border-[5px] border-white bg-listening-tint">
                <img src="/mrikromov.jpg" alt="Mr Jasur Ikromov" className="h-full w-full object-cover" />
              </div>
            </div>
            <div className="flex flex-col gap-2.5 pb-1">
              <h1 className="font-brand text-[28px] font-semibold leading-[1.15] sm:text-[32px]">{title}</h1>
              {subtitle && <p className="text-base leading-relaxed text-onband-dim">{subtitle}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {FACTS.map((f) => (
              <div key={f.label} className="rounded-2xl bg-white/15 px-2.5 py-3 sm:px-3.5">
                <div className="whitespace-nowrap font-brand text-[15px] font-semibold sm:text-[22px]">{f.value}</div>
                <div className="text-[12px] font-bold text-onband-dim sm:text-[13px]">{f.label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2.5">
            <h2 className="text-[13px] font-extrabold uppercase tracking-[0.06em] text-onband-dim">Everything you need to reach your band</h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {PERKS.map(({ art: Art, bg, title: t, text }) => (
                <div key={t} className="flex flex-col overflow-hidden rounded-[20px] bg-panel text-paper">
                  <div className={`flex min-h-[100px] flex-1 items-center justify-center p-3.5 ${bg}`} aria-hidden="true">
                    <Art />
                  </div>
                  <div className="px-3.5 pb-3.5 pt-3">
                    <div className="text-[15px] font-extrabold">{t}</div>
                    <div className="mt-0.5 text-[13px] font-semibold leading-snug text-mist">{text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto flex items-center gap-2.5">
            <span className="text-sm font-bold text-onband-dim">Follow Mr Ikromov</span>
            <a
              href="https://www.instagram.com/ustoz_jasur/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Mr Ikromov on Instagram"
              className="focus-ring flex h-11 w-11 items-center justify-center rounded-[14px] bg-white/15 text-white hover:bg-white/25"
            >
              <InstagramIcon />
            </a>
            <a
              href="https://t.me/TeamMrIkromov"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Mr Ikromov on Telegram"
              className="focus-ring flex h-11 w-11 items-center justify-center rounded-[14px] bg-white/15 text-white hover:bg-white/25"
            >
              <TelegramIcon />
            </a>
          </div>
        </section>

        {/* RIGHT — the form */}
        <section className="auth-side relative order-1 flex flex-col items-center justify-center gap-4 overflow-hidden rounded-[28px] px-3 py-8 sm:px-5 lg:order-2">
          <div className="auth-arch-a pointer-events-none absolute -bottom-10 -left-16 h-[340px] w-[260px] rounded-[999px_999px_0_0]" aria-hidden="true" />
          <div className="auth-arch-b pointer-events-none absolute -right-12 -top-8 h-[300px] w-[220px] rounded-[0_0_999px_999px]" aria-hidden="true" />
          <div className="pointer-events-none absolute bottom-12 right-14 h-[120px] w-[90px] rounded-[999px_999px_0_0] border-[3px] border-b-0 border-saffron/60" aria-hidden="true" />

          <div className="relative w-full max-w-[460px] overflow-hidden rounded-[22px] bg-panel shadow-[0_18px_40px_rgba(36,86,176,0.14)]">
            <div className="h-1.5 bg-[linear-gradient(90deg,#2456b0,#1a9bb5)]" aria-hidden="true" />
            {(cardTitle || cardSubtitle) && (
              <div className="flex items-center gap-3.5 px-6 pb-1.5 pt-7 sm:px-8">
                <img src="/mrikromov.jpg" alt="" className="h-12 w-12 shrink-0 rounded-[14px] object-cover" />
                <div>
                  {cardTitle && <h2 className="font-brand text-[22px] font-semibold leading-tight sm:text-[24px]">{cardTitle}</h2>}
                  {cardSubtitle && <p className="mt-1 text-sm leading-relaxed text-mist">{cardSubtitle}</p>}
                </div>
              </div>
            )}
            <div className="px-6 pb-7 pt-4 sm:px-8">{children}</div>
            {footer && (
              <div className="bg-[color-mix(in_srgb,var(--color-brass)_6%,var(--color-panel))] px-6 py-4 text-center text-sm text-paper-dim sm:px-8">
                {footer}
              </div>
            )}
          </div>

          <div className="relative flex flex-wrap justify-center gap-2" aria-hidden="true">
            {SKILL_LABELS.map((s) => (
              <span key={s.label} className={`rounded-[10px] bg-panel px-2.5 py-1.5 text-xs font-extrabold ${s.cls}`}>{s.label}</span>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
