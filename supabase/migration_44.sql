-- ============================================================
-- Migration 44 — run this once in Supabase SQL Editor, after 29-43
--
-- Cleanup for the "Randomize questions from bank" scope fix (2026-09-26):
-- Jasur correctly caught that this feature can't work for Listening —
-- a Listening section has exactly one fixed audio track that narrates
-- in a set order, so shuffling questions or drawing a random subset
-- would desync what's on screen from what's playing. The feature is
-- now Reading-only in the app (UI hidden for Listening, and
-- buildAttemptQuestions in MockExams.jsx ignores it for Listening
-- regardless). This just makes sure no existing listening exam row is
-- left with it turned on, belt-and-braces with the app-side guard.
-- ============================================================

update public.mock_exams
set randomize_questions = false,
    questions_per_section = null
where module = 'listening'
  and (randomize_questions = true or questions_per_section is not null);

notify pgrst, 'reload schema';
