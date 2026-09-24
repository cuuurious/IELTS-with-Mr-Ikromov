-- ============================================================
-- Migration 33 — run this once in Supabase SQL Editor, after 29-32
--
-- Jasur's call (2026-09-24): a writing examiner should ONLY ever see
-- a student who sat the WHOLE writing mock (Task 1 + Task 2 together
-- in one timed sitting — homeworks.mock_task_mode = 'full'). A
-- task1-only or task2-only writing DRILL a teacher posts as ordinary
-- homework already has AI grading wired into the normal homework/
-- SubmissionPanel review flow, and that flow is explicitly untouched
-- by the writing-examiner dashboard — Jasur was clear he doesn't want
-- it touched at all.
--
-- migration_31 already fixed these three policies' homework_type
-- typo ('mock' -> 'writing_mock'). This migration narrows them
-- further, at the RLS layer (not just in WritingExaminerDashboard.jsx's
-- own query), so a writing examiner's account can never see or write
-- to a task1/task2-only homework submission no matter what UI queries
-- it in the future — the database itself enforces the boundary Jasur
-- described, not just today's one screen.
-- ============================================================

drop policy if exists "submissions_select_writing_examiner" on public.submissions;
create policy "submissions_select_writing_examiner" on public.submissions
  for select using (
    public.is_writing_examiner()
    and exists (
      select 1 from public.homeworks h
      where h.id = submissions.homework_id
        and h.homework_type = 'writing_mock'
        and h.mock_task_mode = 'full'
    )
  );

drop policy if exists "submissions_update_writing_examiner" on public.submissions;
create policy "submissions_update_writing_examiner" on public.submissions
  for update using (
    public.is_writing_examiner()
    and exists (
      select 1 from public.homeworks h
      where h.id = submissions.homework_id
        and h.homework_type = 'writing_mock'
        and h.mock_task_mode = 'full'
    )
  );

drop policy if exists "homeworks_select_writing_examiner" on public.homeworks;
create policy "homeworks_select_writing_examiner" on public.homeworks
  for select using (
    public.is_writing_examiner()
    and homework_type = 'writing_mock'
    and mock_task_mode = 'full'
  );

notify pgrst, 'reload schema';
