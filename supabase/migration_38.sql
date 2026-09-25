-- ============================================================
-- Migration 38 — run this once in Supabase SQL Editor, after 29-37
--
-- Jasur hit this trying to delete a Reading exam from the Content tab:
--   "update or delete on table "mock_questions" violates foreign key
--   constraint "mock_answers_question_id_fkey" on table "mock_answers""
--
-- Root cause: mock_answers is a fourth table from the original
-- standalone ielts-mock-tests app (same origin as mock_exams/
-- mock_sections/mock_questions — see migration_36's own header comment)
-- that never got surfaced anywhere in this project before now. It holds
-- one row per student answer, with a foreign key straight at
-- mock_questions.id. Deleting a question (or a section/exam that
-- cascades down to one) that a student has ever answered fails outright
-- unless mock_answers' own rows are cleared first.
--
-- Two parts to the actual fix:
--   1. This migration — teachers had full CRUD on mock_exams/
--      mock_sections/mock_questions since migration_36, but nobody ever
--      granted the same on mock_answers, so even once the app tries to
--      clear a question's answers before deleting it, that delete would
--      itself be blocked by RLS. Mirrors migration_36's grant exactly.
--   2. TeacherMockCenter.jsx's deleteRlExam/deleteSection/deleteQuestion
--      now explicitly delete the relevant mock_answers rows first,
--      before deleting the mock_questions rows that reference them —
--      shipped alongside this migration.
--
-- Also folded in here: the raw Postgres error message Jasur saw
-- ("violates foreign key constraint...") was surfaced verbatim in a
-- plain browser window.confirm()/window.alert() dialog — both fixed to
-- use the app's own styled ConfirmModal, with foreign-key errors
-- translated into plain language ("a student has already answered one
-- of its questions — try un-publishing it instead").
-- ============================================================

drop policy if exists "mock_answers_select_teacher" on public.mock_answers;
create policy "mock_answers_select_teacher" on public.mock_answers
  for select using (public.is_teacher());

drop policy if exists "mock_answers_delete_teacher" on public.mock_answers;
create policy "mock_answers_delete_teacher" on public.mock_answers
  for delete using (public.is_teacher());

notify pgrst, 'reload schema';
