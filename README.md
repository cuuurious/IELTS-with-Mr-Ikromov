# IELTS with Mr Ikromov

A homework, speaking-practice, and vocabulary portal that replaces the old
"screenshots + voice notes in one Telegram chat, marked in an Excel sheet"
workflow. React (Vite) frontend deployed to a Cloudflare Worker at
ieltswithmrikromov.com, Supabase backend (database, auth, storage, and
Edge Functions for anything that needs a service-role key).

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

Copy `.env.example` to `.env` for local dev **and** before every production
build — the frontend and the Edge Functions get their variables from two
completely different places:

- **Frontend (Cloudflare Worker)** — there's no build server involved.
  `.env` on your own machine is read by `npm run build`, which bakes the
  `VITE_*` values straight into the static files in `dist/`. Whatever is in
  your local `.env` at build time is what ships — there's nowhere else to
  set these for the frontend.
- **Edge Functions (Supabase)** — set with the Supabase CLI:
  `supabase secrets set VAPID_PRIVATE_KEY=... SUPABASE_SERVICE_ROLE_KEY=...`
  (or one at a time). These never touch the frontend build.
- **`daily-reminders.yml` (GitHub Actions)** — the one exception that does
  need GitHub repository secrets, since it's the only thing that runs on
  GitHub rather than your machine or Supabase. See below.

The `VAPID_*` keys enable real push notifications — generate them with:

```bash
npx web-push generate-vapid-keys
```

| Variable | Where it's used | Set it in |
|---|---|---|
| `VITE_SUPABASE_URL` | frontend build + GitHub Actions | local `.env` **and** a GitHub Actions repository secret |
| `VITE_SUPABASE_ANON_KEY` | frontend build | local `.env` only |
| `VITE_VAPID_PUBLIC_KEY` | frontend build | local `.env` only |
| `VAPID_PUBLIC_KEY` | functions | `supabase secrets set` (same value as `VITE_VAPID_PUBLIC_KEY` above) |
| `VAPID_PRIVATE_KEY` | functions only | `supabase secrets set` — **never** put this in the frontend build |
| `SUPABASE_SERVICE_ROLE_KEY` | functions only | `supabase secrets set` **and** a GitHub Actions repository secret (used by `daily-reminders.yml` to call the function) — **never** expose this to the browser |

No AI API key needed — word definitions/translations use free public APIs.

## 3. Deploying

**Frontend → Cloudflare Worker.** There's no auto-deploy on push — build
locally and upload the result:

```bash
npm run build
```

Then go to Cloudflare dashboard → Workers & Pages → `ielts-with-mr-ikromov`
→ deploy/update → drag the whole `dist` folder onto the uploader → Deploy.
(A `wrangler.toml` plus `npx wrangler deploy` would let this run from a
terminal or even auto-deploy from GitHub Actions the same way
`daily-reminders.yml` does — worth setting up later if the manual upload
gets tedious, but not required.)

**Edge Functions → Supabase.** The Cloudflare Worker only serves static
files, so anything that needs the service-role key (push notifications,
daily reminders, word definitions, account admin actions) runs as a
Supabase Edge Function instead. Deploy them with the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase functions deploy          # deploys every function in supabase/functions
npx supabase secrets set \
  VAPID_PUBLIC_KEY=YOUR-VAPID-PUBLIC-KEY \
  VAPID_PRIVATE_KEY=YOUR-VAPID-PRIVATE-KEY \
  SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
```

(`SUPABASE_URL` is provided automatically inside every Edge Function — you
don't set it yourself.)

**Daily reminders → GitHub Actions cron.** Supabase Edge Functions don't
schedule themselves, so `.github/workflows/daily-reminders.yml` calls the
deployed `daily-reminders` function once a day (6:00 AM UTC by default —
edit the `cron:` line to change it). This is the one part of the whole
setup that still runs on GitHub — it needs two repository secrets under
**GitHub → repo → Settings → Secrets and variables → Actions**:
`VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. You can trigger it
manually any time from the Actions tab (`workflow_dispatch`) to test it
without waiting for the schedule.

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
