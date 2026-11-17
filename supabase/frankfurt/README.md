# Moving the database from Sydney to Frankfurt

Rewritten 2026-11-17 against the live project. **Nothing here has been run yet — Jasur picks the night.**

Why: the project lives in Sydney (`ap-southeast-2`). From Tashkent the route is long and unreliable: on 17 Nov the teacher's browser could not reach the database for 23, 45, 82 and 105 minutes, and students report the same "logged out / nothing works for ~10 minutes". Frankfurt (`eu-central-1`) is much closer. Supabase cannot move a project; you create a new one in Frankfurt and copy everything into it.

What gets copied today: 209 accounts (with passwords), all tables, 6,613 files / ~5.2 GB in 10 buckets, 24 server functions, 5 scheduled jobs, 3 Vault secrets, 24 storage access rules, 14 live-chat (realtime) tables.

**Side effect:** everyone is logged out once and logs in again (new project = new signing key). Passwords stay the same. Phone notifications keep working only if the VAPID keys are identical (step A3).

The old README was written on 2 Oct and was out of date (it knew 21 functions, 1 scheduled job, 2 secrets, 0.8 GB, and did not know the storage rules or realtime). This one replaces it. Files in this folder:

| file | what it does |
|---|---|
| `after-restore.sql` | secrets, links, scheduled jobs, realtime, checks (new project) |
| `storage-policies.sql` | the 24 file-access rules (new project) |
| `copy-storage.mjs` | copies the files; skips what is already there; verifies counts |
| `deploy-functions.ps1` | downloads the 24 functions from Sydney, deploys to Frankfurt |
| `compare-counts.sql` | row counts of every table, run on both projects and compared |

## Rule that avoids bugs

**Rehearse first, on a throw-away project.** Everything below is run twice: once on a rehearsal project (cost: a few cents, delete it afterwards) and once for real. If the rehearsal shows an error, nothing live was touched. Sydney stays the live site until step B7 (switch).

## Part A — before the night (about 1 hour, any day, no downtime)

**A1. Tools on the laptop:** Supabase CLI, Docker Desktop (the CLI uses it for the dump), psql (PostgreSQL 17 client tools), Node.

**A2. Create two projects** in the dashboard (same organization, same plan as now, region **Central EU (Frankfurt)**): `ielts-rehearsal` and `ielts-new` (the real one). Save both database passwords. Write down each **ref**.

**A3. Collect the secrets** (the dashboard hides function-secret values, so copy them from wherever you first saved them): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, VAPID keys (**must be identical**), `SITE_URL`, `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` if set, `CLEANUP_TOKEN`, anything else in `supabase secrets list --project-ref grdfwleehlgoooizyowz`. Check that none is missing: the **names** in the old list must all exist in the new one after step B5.
Vault values (old project SQL editor): `select name, decrypted_secret from vault.decrypted_secrets;` → `cleanup_token`, `notify_telegram_secret`, `parent_sms_secret`.

**A4. Look for hard-coded old addresses** (PowerShell, in the ielts-app folder). Both must print nothing except documentation files:
```
Select-String -Path src,public,supabase\functions -Pattern grdfwleehlgoooizyowz -Recurse
Select-String -Path .github -Pattern grdfwleehlgoooizyowz -Recurse
```
If something shows up in code, tell Claude before the night.

**A5. Rehearsal (the whole of Part B on `ielts-rehearsal`, except B7 and B8).** Use B1–B6 with the rehearsal's ref and keys, **but for the file copy (B4) just let the script run until the `avatars` bucket is done and stop it with Ctrl+C** (that proves it works without copying 5 GB twice). Then:
1. `compare-counts.sql` on old and rehearsal: every number must match.
2. Run the site on your laptop against the rehearsal (`.env` with the rehearsal URL + anon key, `npm run dev`), log in as teacher, as a test student, open a chat, post a homework.
3. Fix whatever broke, then delete the rehearsal project.

## Part B — the night (about 2–3 hours; pick e.g. 02:00 Tashkent)

Tell students the day before: "The site is closed tonight from 02:00 for about 3 hours. After that, log in again (same password)."

**B1. Freeze.** At the start, post in the groups that the site is closed. From the dump (B2) until the switch (B7), anything written in Sydney is lost, so no one should use it. Do not change anything in Sydney after the dump.

**B2. Dump Sydney** (PowerShell, ielts-app folder; connection strings: dashboard → Connect → Session pooler):
```
supabase db dump --db-url "OLD_CONNECTION_STRING" -f roles.sql --role-only
supabase db dump --db-url "OLD_CONNECTION_STRING" -f schema.sql
supabase db dump --db-url "OLD_CONNECTION_STRING" -f data.sql --use-copy --data-only -x storage.buckets -x storage.objects
```
(The file rows are left out on purpose: step B4 creates them by uploading the files, which avoids "duplicate key" errors.) Do not commit these three files.

**B3. Restore into `ielts-new`:**
```
psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command "SET session_replication_role = replica" --file data.sql --dbname "NEW_CONNECTION_STRING"
```
If it stops on an error it rolls back completely. Send Claude the message. Then in the **new** project's SQL editor run, in this order:
1. `after-restore.sql` (replace `NEWREF` and the three `<...>` secrets first). Last two checks: first returns no rows; second shows `209 / 209 / 5 / 3 / 14`.
2. `compare-counts.sql` here and in Sydney; the two lists must be identical.

**B4. Copy the files** (the long part, ~1–2 h; can also be started days before — it skips files already copied and verifies at the end):
```
$env:OLD_URL="https://grdfwleehlgoooizyowz.supabase.co"
$env:OLD_SERVICE_KEY="old service_role key"
$env:NEW_URL="https://NEWREF.supabase.co"
$env:NEW_SERVICE_KEY="new service_role key"
node supabase/frankfurt/copy-storage.mjs
```
It must end with `All files are in the new project.` (If it says NOT FINISHED, run it again.) Then run `storage-policies.sql` in the new project: it must return `24`.
If you start the copy early (recommended: a few days before), run it once more on the night so that files uploaded in between are included.

**B5. Server functions:**
```
.\supabase\frankfurt\deploy-functions.ps1 -NewRef NEWREF
supabase secrets set --project-ref NEWREF TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... OPENAI_API_KEY=... (and the rest from A3)
supabase secrets list --project-ref NEWREF
```
Compare the secret names with the old list. (The script downloads the code into `supabase/functions`; if GitHub Desktop then shows changes there, do not commit them unless you know why.)

**B6. Auth settings** (new project → Authentication → URL configuration): Site URL `https://ieltswithmrikromov.com` and the same redirect URLs as the old project; copy any SMTP / email template you customised.

**B7. Switch** (only now does the live site change):
1. Telegram bot: open `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://NEWREF.supabase.co/functions/v1/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
2. Cloudflare → Workers & Pages → **ielts-with-mr-ikromov** → Settings → build variables: change `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the new project's values (and your local `.env`). Redeploy (push any commit from GitHub Desktop, or Deployments → Retry). Do not use `npm run deploy`.
3. GitHub → Settings → Secrets → Actions: update `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

**B8. Check (15 min):** log in as teacher and as a test student; open a homework with photos; play a speaking audio; open a chat with images and send one message (live); post a small homework to a test group → notification on phone and in Telegram; send a test lesson via "Open lesson now"; teacher dashboard → Errors: nothing new. Then tell students the site is open.

**B9. Afterwards:** keep the Sydney project **paused, not deleted**, for 2 weeks. Then delete it.

## If something goes wrong

Until B7 the live site still uses Sydney: stop, nothing changed for students (just reopen the site). After B7, roll back by putting the old `VITE_SUPABASE_URL` / key back in Cloudflare and redeploying, and pointing the Telegram webhook back to the old address. Anything students wrote in Frankfurt after the switch would then be missing in Sydney, so roll back quickly or not at all.
