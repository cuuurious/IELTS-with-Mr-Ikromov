-- ============================================================
-- Migration 39 — run this once in Supabase SQL Editor, after 29-38
--
-- Follow-up to migration_38: clearing mock_answers (migration_38) was
-- only half of what was blocking "Delete" on a Reading/Listening exam.
-- Once a student has ever attempted an exam, mock_attempts.exam_id
-- (also from the original standalone ielts-mock-tests schema — see
-- migration_32's own header comment) points straight at mock_exams.id,
-- and a teacher never had delete rights on mock_attempts (migration_32
-- only ever granted SELECT, for the Teacher Mock Center's Student
-- Progress view). So even with mock_answers/mock_questions/mock_sections
-- all cleared, the final delete of mock_exams itself was still hitting
-- the exact same class of foreign-key wall, just one table over — which
-- is why Jasur kept seeing "Can't delete this — a student has already
-- answered one of its questions" even after migration_38 was confirmed
-- run.
--
-- This grants the missing delete right, mirroring migration_38's grant
-- on mock_answers. Shipped alongside a matching code change in
-- TeacherMockCenter.jsx's deleteRlExam: it now also deletes every
-- mock_attempts row for the exam (after mock_answers/mock_questions/
-- mock_sections are already gone) before deleting mock_exams itself —
-- same "delete the exam wipes its attempt history too" behavior the
-- Writing mock delete has always had.
-- ============================================================

drop policy if exists "mock_attempts_delete_teacher" on public.mock_attempts;
create policy "mock_attempts_delete_teacher" on public.mock_attempts
  for delete using (public.is_teacher());

notify pgrst, 'reload schema';
