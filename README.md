# IELTS with Mr Ikromov

A homework, speaking-practice, and vocabulary portal that replaces the old
"screenshots + voice notes in one Telegram chat, marked in an Excel sheet"
workflow. React (Vite) frontend, Supabase backend, deployed on Netlify with
two serverless functions.

---

## What's in this project

- **Homework** — teacher posts per group, with an optional deadline and an
  optional "include speaking recording" toggle. Students upload screenshots
  (removable individually), record Speaking Part 1/2/3 (pause/resume/delete
  and re-record), and leave a comment. A homework is stamped **Done**
  automatically on upload, **Incomplete** (red) if the deadline passes with
  nothing submitted, otherwise **Not yet** (yellow).
- **Leaderboards** — one per group, showing completion % and a day-based
  streak (🔥 consecutive calendar days with at least one homework or word-list
  activity). Completion credit is permanent: once a student completes a task,
  it counts toward their percentage and streak forever, even if the teacher
  later resets that homework's content for a new lesson.
- **Word lists + vocab game** — teacher pastes plain words, the app looks up
  definitions/examples (dictionaryapi.dev) and Uzbek translations (MyMemory)
  automatically — both are free, keyless APIs, no paid AI key needed.
  Students get flip-flashcards to study, then a multiple-choice quiz; results
  (score, %, category, missed words) are saved and visible to the teacher.
  Completing a list counts as one task, equal weight to a homework.
- **Group chat** — one shared thread per group (students + teacher), supports
  text, photos, videos, and voice messages.
- **1:1 chat** — private thread between each student and the teacher.
- **Notifications** — in-app bell (instant), plus real push notifications to
  phone/desktop (even with the site closed) via a daily scheduled job for
  deadline/motivational reminders.
- **Accounts** — username + password login (no real email required), teacher
  approval required before login works, change password, optional recovery
  email, and self-service account deletion.
- **Day/night mode**, installable as a home-screen app (PWA manifest).

---

## 1. Database setup

Run these **in order**, every time, in Supabase → SQL Editor → New query.
If this is a brand new Supabase project, run `schema.sql` first, then every
`migration_*.sql` file in numeric order (2 → 6). If you already have this
project set up from before, you only need to run whichever migration files
you haven't run yet — `migration_6.sql` is the newest.

1. `schema.sql` (skip if already run)
2. `migration_2.sql` (skip if already run)
3. `migration_3.sql` (skip if already run)
4. `migration_4.sql` (skip if already run)
5. `migration_5.sql` (skip if already run)
6. `migration_6.sql` ← **run this one now** — adds the permanent completion
   log (so "reset homework" no longer costs students their leaderboard
   credit), day-based streaks, self-delete account, and lets the teacher
   clean up storage when resetting a homework.

Also in Supabase: **Authentication → Providers → Email → turn off "Confirm
email"** (only needs doing once, skip if already done).

## 2. Environment variables

Copy `.env.example` to `.env` for local dev, and set the same in **Netlify →
Site settings → Environment variables** for production. The `VAPID_*` keys
enable real push notifications — generate them with:

```bash
npx web-push generate-vapid-keys
```

| Variable | Where it's used | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | frontend + functions | from Supabase → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | frontend + functions | same page, the `anon public` key |
| `VITE_VAPID_PUBLIC_KEY` | frontend + functions | from `web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | functions only | **never** put this in the frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | functions only | Project Settings → API → legacy `service_role` key. **Never** expose this to the browser. |

No AI API key needed — word definitions/translations use free public APIs.

## 3. Deploying

Serverless functions (push notifications, daily reminders, word
definitions) **can't** be deployed by dragging the `dist` folder onto
Netlify — that only uploads static files. Use one of:

**Netlify CLI (no GitHub needed):**
```bash
npm install -g netlify-cli
netlify login
netlify link        # pick your existing site
netlify deploy --prod
```

**Or connect a GitHub repo** in Netlify → Add new site → Import an existing
project. Build command `npm run build`, publish directory `dist` (already
set in `netlify.toml`), functions directory `netlify/functions` (also
already set). Every push auto-deploys.

## 4. First-time run

```bash
npm install
npm run dev
```

Register once as **teacher** — this account starts `pending` too. Approve it
manually, once, in Supabase → Table editor → `profiles` → set `status` to
`approved`. Every other approval (students, additional teachers) can then be
done from inside the app's Approvals tab.

---

## Notes worth knowing

- **Storage cleanup**: "Reset homework" clears the database records of
  uploaded files but doesn't delete the actual files from storage (avoids
  extra complexity) — negligible on Supabase's free tier for a class this
  size.
- **Free translation/dictionary APIs** are rate-limited per IP (generous for
  a single class, but don't paste hundreds of words at once — 40 per list is
  the built-in cap).
- **Push notifications** require the site to be opened at least once after
  turning them on in Account settings (browsers require a user gesture to
  grant permission).


## Migration 7 — current feature update
Run `supabase/migration_7.sql` in the Supabase SQL Editor after migrations 2–6. It adds:

- complete teacher homework deletion + storage cleanup permissions
- teacher-configurable student upload types and min/max file counts
- document/file submissions alongside pictures
- group-message edit/delete permissions and a teacher audit trail
- guaranteed in-app notifications for group messages
- password-reset email routing through the account recovery email
- realtime delete/edit propagation in group chat

### Password reset email setup
In Supabase Dashboard → Authentication → URL Configuration, add the deployed site URL and `/reset-password` as an allowed redirect URL. Keep the standard Supabase recovery email template enabled. New registrations require a recovery email so password reset has a real destination.
