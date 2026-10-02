# Moving the database from Sydney to Frankfurt

Prepared 2026-10-02. **Nothing here has been run yet — Jasur picks the night.**

Why: the database lives in Sydney (`ap-southeast-2`). Every click on the site goes Tashkent → Sydney → Tashkent (~250–300 ms each way). Frankfurt (`eu-central-1`) is ~80–100 ms away, so every page, chat message and homework upload gets roughly 2–3× faster. Supabase can't move a project; you create a new project in Frankfurt and copy everything into it.

What gets copied: 309 user accounts (with their passwords), all tables, all files (~1,230 files, ~0.8 GB), 20 server functions, 1 scheduled job, 2 Vault secrets.

**Side effect:** everyone is logged out once and has to log in again (the new project signs logins with a new key). Passwords stay the same. Students who turned on phone notifications keep them.

## Before the night (15 min, any day)

1. Install on the laptop: **Supabase CLI**, **Docker Desktop** (the CLI uses it to dump the database), and **psql** (PostgreSQL 17 client tools).
2. Create the new project yourself in the Supabase dashboard → New project → Region **Central EU (Frankfurt)**, same organization and same plan as the current one. Save its database password somewhere safe. Note its **ref** (`https://<ref>.supabase.co`) — below it's called `NEWREF`.
3. Make sure you have your own copies of the function secrets (the dashboard hides their values): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, the VAPID push keys, `SITE_URL`, `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` (if set), `CLEANUP_TOKEN` (same value as the Vault `cleanup_token`). Check the full list with: `supabase secrets list --project-ref grdfwleehlgoooizyowz`.
   ⚠️ The VAPID push keys **must be the same** in the new project, or everyone's phone notifications stop working.
4. Copy the two Vault values from the old project (SQL Editor):
   `select name, decrypted_secret from vault.decrypted_secrets;`

## The night (about 1 hour; pick a quiet time, e.g. 02:00 Tashkent)

Tell students the day before: "The site will be offline ~1 hour tonight for an upgrade; afterwards log in again."

### 1. Dump the old database (PowerShell, in the ielts-app folder)

Connection strings: dashboard → **Connect** → Session pooler.

```
supabase db dump --db-url "OLD_CONNECTION_STRING" -f roles.sql --role-only
supabase db dump --db-url "OLD_CONNECTION_STRING" -f schema.sql
supabase db dump --db-url "OLD_CONNECTION_STRING" -f data.sql --use-copy --data-only
```

### 2. Restore into the new project

```
psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command "SET session_replication_role = replica" --file data.sql --dbname "NEW_CONNECTION_STRING"
```

If it stops on an error, it rolls back completely — send the error message to Claude.

### 3. Fix addresses, secrets, scheduled job

Open `supabase/frankfurt/after-restore.sql`, replace every `NEWREF` with the new ref and the two `<...>` placeholders with the Vault values from step 4 above, then run it in the **new** project's SQL Editor. The last query must return no rows.

### 4. Copy the files

```
$env:OLD_URL="https://grdfwleehlgoooizyowz.supabase.co"
$env:OLD_SERVICE_KEY="old service_role key"
$env:NEW_URL="https://NEWREF.supabase.co"
$env:NEW_SERVICE_KEY="new service_role key"
node supabase/frankfurt/copy-storage.mjs
```

### 5. Server functions

Download the exact deployed code from the old project and deploy it to the new one:

```
$fns = "cleanup-submission-storage","define-words","send-push","daily-reminders","delete-student","reset-student-password","change-password","delete-group","rollback-failed-signup","ai-grading","delete-teacher","create-student-account","create-staff-account","delete-staff-account","telegram-webhook","exam-reminders","mock-content-import","run-scheduled-mock-sessions","teacher-needs-attention-digest","send-mock-access-codes","notify-telegram"
$noJwt = "cleanup-submission-storage","delete-student","reset-student-password","change-password","delete-group","rollback-failed-signup","create-student-account","telegram-webhook","notify-telegram"
foreach ($f in $fns) {
  supabase functions download $f --project-ref grdfwleehlgoooizyowz
  if ($noJwt -contains $f) { supabase functions deploy $f --project-ref NEWREF --no-verify-jwt }
  else { supabase functions deploy $f --project-ref NEWREF }
}
```

Then set the secrets on the new project (same values as the old one):
`supabase secrets set --project-ref NEWREF TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... OPENAI_API_KEY=... (etc.)`

### 6. Point everything at the new project

- **Telegram bot** — tell Telegram the new address:
  `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://NEWREF.supabase.co/functions/v1/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
- **Auth settings** (new project → Authentication → URL configuration): Site URL `https://ieltswithmrikromov.com`, same redirect URLs as the old project. Copy SMTP / email templates if you customised them.
- **Website** — in `.env` change `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the new project's values, then `npm run deploy`.
- **GitHub → Settings → Secrets → Actions**: update `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (used by the reminder / digest workflows).

### 7. Check (10 min)

- Log in as teacher and as a test student; open a homework with photos; play a speaking audio; open a chat with images.
- Send yourself a test notification (post a small homework to a test group) → arrives on phone and in Telegram.
- Teacher dashboard → Errors: nothing new.

### 8. Afterwards

Keep the old Sydney project **paused, not deleted**, for 2 weeks as a backup. Then delete it (it stops costing money once deleted).

## If something goes wrong

Until step 6, the live site still uses Sydney — just stop and nothing changed for students. After step 6, roll back by putting the old `VITE_SUPABASE_URL` / key back in `.env`, `npm run deploy`, and re-pointing the Telegram webhook to the old address.
