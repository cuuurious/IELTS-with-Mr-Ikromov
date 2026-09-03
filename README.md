# IELTS with Mr Ikromov

A homework, speaking-practice, and vocabulary portal that replaces the old
"screenshots + voice notes in one Telegram chat, marked in an Excel sheet"
workflow. React (Vite) frontend deployed to Cloudflare Pages at
ieltswithmrikromov.com (connected to this GitHub repo — every push to
`main` triggers a new build automatically), Supabase backend (database,
auth, storage, and Edge Functions for anything that needs a service-role
key).

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

Copy `.env.example` to `.env` for local dev. In production, the frontend
and the Edge Functions get their variables from two completely different
places, and neither one reads your local `.env` file:

- **Frontend (Cloudflare Pages)** — Cloudflare builds the site itself on
  its own servers every time you push, so it needs its own copy of the
  `VITE_*` values, set once in Cloudflare dashboard → your Pages project
  → **Settings → Environment variables** (not from your local `.env`).
  Your local `.env` only matters for `npm run dev` on your own machine.
- **Edge Functions (Supabase)** — set with the Supabase CLI:
  `supabase secrets set VAPID_PRIVATE_KEY=... SUPABASE_SERVICE_ROLE_KEY=...`
  (or one at a time). These never touch the frontend build.
- **`daily-reminders.yml` (GitHub Actions)** — the one exception that does
  need GitHub repository secrets, since it's the only thing that runs on
  GitHub rather than Cloudflare or Supabase. See below.

The `VAPID_*` keys enable real push notifications — generate them with:

```bash
npx web-push generate-vapid-keys
```

| Variable | Where it's used | Set it in |
|---|---|---|
| `VITE_SUPABASE_URL` | frontend build + GitHub Actions | Cloudflare Pages env variable **and** a GitHub Actions repository secret |
| `VITE_SUPABASE_ANON_KEY` | frontend build | Cloudflare Pages env variable |
| `VITE_VAPID_PUBLIC_KEY` | frontend build | Cloudflare Pages env variable |
| `VAPID_PUBLIC_KEY` | functions | `supabase secrets set` (same value as `VITE_VAPID_PUBLIC_KEY` above) |
| `VAPID_PRIVATE_KEY` | functions only | `supabase secrets set` — **never** put this in the frontend build |
| `SUPABASE_SERVICE_ROLE_KEY` | functions only | `supabase secrets set` **and** a GitHub Actions repository secret (used by `daily-reminders.yml` to call the function) — **never** expose this to the browser |

No AI API key needed — word definitions/translations use free public APIs.

## 3. Deploying

**Frontend → Cloudflare Pages.** Fully automatic — commit and push to
`main` (e.g. via GitHub Desktop) and Cloudflare builds and deploys the new
version on its own within a minute or two. Nothing to run locally for a
normal deploy. Check progress, and roll back to any earlier build with one
click, in Cloudflare dashboard → your Pages project → **Deployments**.
`npm run build` is only for testing a production build locally before you
push — it doesn't deploy anything by itself.

**Edge Functions → Supabase.** Cloudflare Pages only serves static
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

## Migration 8 — student target bands
Run `supabase/migration_8.sql` in the Supabase SQL Editor after migrations 2–7. It adds a `target_band` column to `profiles` (7.0–9.0, half-point steps, enforced by a database check constraint) and defaults every existing student to 7.5. Students pick their own target during sign-up and can change it anytime from Account Settings — nothing is forced on anyone.

This also needs three new Edge Functions deployed (`npx supabase functions deploy` picks up all of them):
- `rollback-failed-signup` — cleans up a stranded auth account if the sign-up flow fails partway through, so a failed username never gets permanently stuck.
- `change-password` — the "change password" flow in Account Settings now runs this server-side instead of calling `signInWithPassword` from the browser, so confirming your current password no longer creates a second, unintended session.
- `send-push` was updated (not new) — it now checks the caller is actually a teacher before sending a push notification to anyone.

## Migration 9 — students can see the leaderboard, and deleting a group no longer wipes a student's other group
Run `supabase/migration_9.sql` in the Supabase SQL Editor after migration 8. It only adds new read permissions (Row Level Security policies) — it doesn't touch or remove anything that already exists, and it's safe to run more than once.

This fixes two bugs:
- **Students couldn't see the leaderboard at all.** The leaderboard reads student profiles/submissions/completions directly from the browser now (fixed a streak bug earlier), but the database's permission rules only ever let a student read their *own* data — so the leaderboard came back empty for students. This migration adds a narrow rule: a student (or teacher) can read another person's profile/membership/submissions/completions only when they share a group.
- **Deleting a group deleted a student's ENTIRE account, even if they were also in another group.** `delete-group` was updated so only a student whose *only* group is the one being deleted has their account deleted; a student in more than one group just gets removed from the deleted group and keeps their account and their other group untouched. This one needs the `delete-group` function redeployed (`npx supabase functions deploy` picks it up — no new function, just updated code).
