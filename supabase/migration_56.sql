-- ============================================================
-- Migration 56 — run this once in Supabase SQL Editor, after 29-55
--
-- Security check Jasur's teacher raised 2026-09-26: "can third parties
-- crack our website?" This migration is one concrete, defensive answer
-- to that — it does not change any behavior for a legitimate teacher
-- or student, it just makes sure a lock that should be on is actually
-- on.
--
-- mock_exams, mock_sections, mock_questions, mock_answers, and
-- mock_attempts are the five tables that came from the standalone
-- ielts-mock-tests app rather than being created by any migration in
-- this repo (migration_36's own header comment goes into this). Every
-- migration since (32, 36-39, 44, 47-50) has added policies to them —
-- "only a teacher can insert/update/delete", "a student can only see
-- their own attempt", and so on — but none of those migrations, and no
-- migration in this repo, ever runs `enable row level security` on
-- these five tables. That's almost certainly harmless: the standalone
-- app most likely turned RLS on itself when it created them (its own
-- policies wouldn't have worked otherwise), and this project's own
-- policies have clearly been taking effect all along (teachers see
-- teacher-only data, students don't see other students' attempts).
-- But "almost certainly" isn't the same as verified, and there's no
-- way to verify it from here — this Claude session has no database
-- credentials and no way to run a query against the live project, only
-- the ability to write SQL for Jasur to run himself.
--
-- If RLS were ever somehow off on one of these tables, every policy
-- ever written for it (all of migration_36's teacher-CRUD rules, every
-- "a student can only touch their own attempt" rule) would be silently
-- ignored, and the table would fall back to plain Postgres grants —
-- which on a fresh Supabase table usually means any logged-in
-- (authenticated) user can read or write every row, including
-- mock_questions.correct_answer (the answer key, meant to be
-- teacher-only — mock_questions_public is the answer-free view
-- students are supposed to read from instead) and every student's
-- mock_attempts/mock_answers.
--
-- `enable row level security` is idempotent — running it on a table
-- that already has RLS on is a harmless no-op, so this is safe to run
-- regardless of the actual current state. Think of it as a seatbelt
-- check: if it was already buckled, nothing changes; if it wasn't,
-- this is the fix.
-- ============================================================

alter table if exists public.mock_exams enable row level security;
alter table if exists public.mock_sections enable row level security;
alter table if exists public.mock_questions enable row level security;
alter table if exists public.mock_answers enable row level security;
alter table if exists public.mock_attempts enable row level security;

-- Jasur — two things worth doing yourself alongside this migration,
-- since neither is something this session can check or do from here:
--
-- 1. In the Supabase dashboard: Database → Tables → open each of
--    mock_exams / mock_sections / mock_questions / mock_answers /
--    mock_attempts and confirm "Row Level Security" shows as enabled
--    (it will now, once this migration runs, but seeing it toggled ON
--    there is the actual confirmation this fix took effect).
--
-- 2. Also in the dashboard: Advisors → Security Advisor. Supabase runs
--    an automated check across every table in the project for exactly
--    this kind of gap (RLS disabled, a table with policies but RLS
--    off, an overly permissive policy) — worth a look every so often,
--    not just after this migration.
notify pgrst, 'reload schema';
