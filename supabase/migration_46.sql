-- ============================================================
-- Migration 46 — run this once in Supabase SQL Editor, after 45
--
-- Jasur, 2026-09-26, verbatim: "i want teacher to be able to
-- generate those codes for many students at once, for example by
-- ticking the students profiles that are gonna take the mock test he
-- will choose them and click generate password and then teacher sees
-- and checks whether every student he wants to take the test is here
-- and he confirms sending them to those students via telegrambot."
--
-- Two additions to mock_access_codes (migration_45), both purely
-- informational — RLS and the update-once-only policy from
-- migration_45 already cover these new columns, nothing to add there:
--
--   batch_id          groups every code issued together in one
--                      "Issue access codes" submission, so the Access
--                      codes list could show them as one batch later
--                      if needed. Null for any code issued the old
--                      one-at-a-time way before this migration.
--
--   telegram_sent_at  stamped by the new send-mock-access-codes Edge
--                      Function once a Telegram message for this code
--                      actually goes out. Null means "never sent" —
--                      either the teacher hasn't tried yet, or the
--                      student hasn't connected Telegram
--                      (AccountSettingsModal.jsx's "Connect Telegram").
-- ============================================================

alter table public.mock_access_codes
  add column if not exists batch_id uuid,
  add column if not exists telegram_sent_at timestamptz;

create index if not exists mock_access_codes_batch_idx
  on public.mock_access_codes(batch_id);

notify pgrst, 'reload schema';
