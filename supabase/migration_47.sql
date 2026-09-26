-- ============================================================
-- Migration 47 — run this once in Supabase SQL Editor, after 46
--
-- Part of the Reading/Listening exam-screen rebuild (2026-09-26),
-- Jasur's "every single thing, no matter how much time it takes"
-- request: timer polish, question navigator + flagging, Reading
-- highlight/notes tool, and the 2-minute Listening review window are
-- all pure front-end (MockExams.jsx) and need no schema change. The
-- one piece that DOES need the database is the quiet tab-switch
-- integrity log, ported from Writing's own writing_mock_attempts.
-- tab_switch_count (migration_34) onto the Reading/Listening table —
-- never shown to or enforced against the student, saved only for a
-- teacher's future reference, exactly like Writing's version.
--
-- mock_attempts predates this project's own migration files (see
-- migration_32's header comment — it was created directly in Supabase
-- by the original standalone ielts-mock-tests app), so unlike
-- writing_mock_attempts there's no guarantee a student-own-row UPDATE
-- policy already exists here: the app has only ever INSERTed a new
-- attempt and left every column alone until submit_mock_attempt()
-- (a security-definer RPC, which bypasses RLS entirely) filled in the
-- score. MockExams.jsx's new periodic/final integrity-log save is the
-- first time the browser itself ever needs to UPDATE its own
-- mock_attempts row directly, so this adds that policy rather than
-- assuming it. Harmless if one already exists under a different name —
-- Postgres just OR's permissive policies together.
-- ============================================================

alter table public.mock_attempts
  add column if not exists tab_switch_count int not null default 0;

drop policy if exists "mock_attempts_update_own" on public.mock_attempts;
create policy "mock_attempts_update_own" on public.mock_attempts
  for update using (user_id = auth.uid());

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEP — after running this migration:
--
-- Nothing else to do — Reading/Listening mock attempts will start
-- logging a quiet tab-switch count the moment this ships, same as
-- Writing already does. It's never shown to the student and doesn't
-- affect their score; it just gives you the same integrity signal on
-- Reading/Listening that Writing mocks have had since migration_34.
-- ---------------------------------------------------------------------
