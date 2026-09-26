-- ============================================================
-- Migration 51 — run this once in Supabase SQL Editor, after 29-50
--
-- Resume-on-refresh for Reading/Listening mock attempts — a real bug
-- found during the 2026-09-26 audit and picked by Jasur as a priority
-- fix: MockExams.jsx's ExamTaker used to unconditionally INSERT a brand
-- new mock_attempts row every time it mounted, with a fresh full-length
-- deadline computed from Date.now(). A dropped connection or an
-- accidental refresh/back-button mid-section silently orphaned whatever
-- was in progress and started over from a blank sheet with a brand new
-- clock — losing every answer, and (worse) letting a student reset their
-- own countdown just by refreshing the page.
--
-- Two columns needed for the fix in ExamTaker (MockExams.jsx):
--   - draft_answers jsonb: a periodically-autosaved (every 30s, same
--     interval that already saves tab_switch_count) snapshot shaped
--     { answers, audioEnded, reviewStartedAt } — answers-so-far, which
--     Listening sections' audio has already played all the way through
--     (so a resumed attempt can't replay audio the real exam only ever
--     plays once), and when the 2-minute Listening review window began
--     (so a resume restores the REMAINING review time, not a fresh 2
--     minutes). Read back to hydrate all three when an in-progress
--     attempt is resumed instead of starting a new one.
--   - started_at timestamptz: needed to recompute the ORIGINAL deadline
--     on resume (started_at + the module's time limit), not a fresh
--     one from "now" — this is what actually closes the "refresh to
--     reset the clock" loophole, not just the lost-answers part.
--
-- `add column if not exists` — mock_attempts predates this project's own
-- migration history entirely (created directly in the shared Supabase
-- project by the original standalone ielts-mock-tests app — see
-- migration_32's header comment), so its exact existing column set has
-- always had to be treated as partially unknown. If started_at already
-- exists under a default, this is a harmless no-op for that column;
-- either way, every currently-submitted (finished) attempt is completely
-- unaffected — the new resume logic only ever looks at rows where
-- submitted_at is still null.
-- ============================================================

alter table public.mock_attempts
  add column if not exists draft_answers jsonb,
  add column if not exists started_at timestamptz not null default now();

-- No RLS changes needed: migration_47 already added
-- `mock_attempts_update_own` (for update using (user_id = auth.uid())),
-- which covers writing these two new columns on a student's own row the
-- same as it already covers tab_switch_count; the existing student-owns-
-- their-own-attempts SELECT policy (pre-dating this project's migrations,
-- already relied on everywhere mock_attempts is read today) already
-- covers reading them back too.
