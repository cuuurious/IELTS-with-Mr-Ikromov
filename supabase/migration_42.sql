-- ============================================================
-- Migration 42 — run this once in Supabase SQL Editor, after 29-41
--
-- Randomized question bank — the last of the "next level" round-3
-- picks, scoped 2026-09-25 as "just shuffle": no skill/difficulty
-- tagging, a plain toggle on the exam (in the Content tab's existing
-- Reading exam form and the Listening Wizard) plus an optional
-- "questions per section" count. A teacher authors more questions in a
-- section's pool than a student actually needs to see; each attempt
-- then draws that many at random, in random order, from the pool
-- (src/components/MockExams.jsx's buildAttemptQuestions()) — so repeat
-- test-takers don't just memorize one fixed paper.
--
-- No RLS changes needed: these are two plain columns on mock_exams,
-- which already has full teacher CRUD (migration_36) and the existing
-- student SELECT policy already covers them since it's not
-- column-restricted.
-- ============================================================

alter table public.mock_exams
  add column if not exists randomize_questions boolean not null default false,
  add column if not exists questions_per_section integer;

notify pgrst, 'reload schema';
