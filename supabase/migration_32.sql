-- ============================================================
-- Migration 32 — run this once in Supabase SQL Editor, after 29/30/31
--
-- Teacher-side mock progress view (Phase 7 of the examiner-platform
-- expansion plan). mock_exams / mock_attempts were originally created
-- directly in the shared Supabase project by the standalone
-- ielts-mock-tests app (see MockExams.jsx's own header comment) —
-- there's no local migration file for their original RLS, and their
-- select policy on mock_attempts is almost certainly "own rows only"
-- (user_id = auth.uid()), the same shape every other per-user table
-- in this project uses. Without an explicit teacher-visibility
-- policy, TeacherMockProgress.jsx's query would silently come back
-- empty for every student but the teacher's own account — exactly
-- the same class of invisible bug migration_31 caught and fixed for
-- the writing-examiner queue, caught here in advance instead.
--
-- Purely additive: doesn't touch or replace whatever policy already
-- exists, just adds an OR'd-in "teacher sees everything" policy, the
-- same pattern schema.sql already uses everywhere else
-- (sub_select_teacher, hw_select_teacher, etc.).
-- ============================================================

drop policy if exists "mock_attempts_select_teacher" on public.mock_attempts;
create policy "mock_attempts_select_teacher" on public.mock_attempts
  for select using (public.is_teacher());

notify pgrst, 'reload schema';
