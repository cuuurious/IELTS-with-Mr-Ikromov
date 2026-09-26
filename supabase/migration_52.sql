-- ============================================================
-- Migration 52 — run this once in Supabase SQL Editor, after 29-51
--
-- Group-scheduled mock sessions. One of the ~15 convenience
-- suggestions from the 2026-09-26 brainstorm, picked as a priority
-- item and then folded into "build everything you suggested."
--
-- Today, issuing access codes (migration_45/46) already lets a
-- teacher tick a whole group and generate+send codes for a Full Mock
-- in one go — but it's a manual action taken right now, in the
-- moment. This migration adds a lightweight "schedule it for later"
-- layer on top: a teacher picks a group, a Full Mock set, and a
-- date/time, and the access codes for every student currently in
-- that group get generated and sent automatically once that time
-- arrives — no need to remember to come back and click "Issue codes"
-- the morning of the session.
--
-- Deliberately NOT a live/synchronized session (no shared start
-- time the student is locked to, no waiting room) — Full Mock stays
-- exactly as self-paced as it already is once a student has a code;
-- "scheduled" here only controls WHEN the codes go out, mirroring
-- how a real school announces "next mock is Saturday 10am" without
-- literally forcing every candidate to click Start in the same
-- second.
--
-- codes_sent_at / cancelled_at are mutually exclusive in practice
-- (enforced app-side: the cron function that fires this — see
-- supabase/functions/run-scheduled-mock-sessions — only picks up
-- rows where both are still null) — no CHECK constraint added for
-- this since a teacher cancelling a split-second after the cron
-- claims a row is an acceptable, harmless race (worst case: codes
-- for a session go out despite a same-instant cancel click).
--
-- batch_id reuses the exact meaning migration_46 gave mock_access_
-- codes.batch_id — the cron function stamps the same value on both
-- this row and every code it generates, so "which session produced
-- this code" is answerable by a plain join, same as a teacher's own
-- manual batch today.
-- ============================================================

create table if not exists public.mock_scheduled_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  full_mock_set_id uuid not null references public.full_mock_sets(id) on delete cascade,
  scheduled_at timestamptz not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  codes_sent_at timestamptz,
  codes_issued_count int,
  cancelled_at timestamptz,
  batch_id uuid
);

create index if not exists mock_scheduled_sessions_due_idx
  on public.mock_scheduled_sessions(scheduled_at)
  where codes_sent_at is null and cancelled_at is null;

create index if not exists mock_scheduled_sessions_group_idx
  on public.mock_scheduled_sessions(group_id);

alter table public.mock_scheduled_sessions enable row level security;

-- Same shape as mock_access_codes' own teacher policy (migration_45):
-- one "for all" policy gated on is_teacher(), no separate student
-- access at all — a student never reads this table directly, they
-- just receive their code via Telegram (or from the teacher directly)
-- exactly like a manually-issued one, once the cron function runs.
drop policy if exists "mock_scheduled_sessions_teacher_all" on public.mock_scheduled_sessions;
create policy "mock_scheduled_sessions_teacher_all" on public.mock_scheduled_sessions
  for all using (public.is_teacher()) with check (public.is_teacher());

alter publication supabase_realtime add table public.mock_scheduled_sessions;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEPS — after running this migration:
--
-- 1. Deploy the new Edge Function:
--      npx supabase functions deploy run-scheduled-mock-sessions
--
-- 2. Add a GitHub Actions cron to actually call it on a schedule — see
--    .github/workflows/run-scheduled-mock-sessions.yml (new file,
--    delivered alongside this migration). It needs the same two repo
--    secrets the existing daily-reminders.yml workflow already uses
--    (VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) — if those are
--    already set up for daily-reminders, nothing further to add there.
--
-- Worth knowing: while auditing this area, found that
-- .github/workflows/exam-reminders.yml.txt (the speaking-exam
-- "starts in 5 minutes" reminder) is sitting there with a .txt
-- extension, not .yml — GitHub Actions only picks up files actually
-- named *.yml/*.yaml in that folder, so that workflow is NOT
-- currently running at all, meaning speaking-exam reminders have
-- never actually been firing. Not touched here since it's not part
-- of this feature and might be disabled on purpose (e.g. while VAPID
-- push keys weren't configured yet) — flagging it for Jasur to
-- decide, not assuming and renaming it myself.
-- ---------------------------------------------------------------------
