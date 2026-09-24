-- ============================================================
-- Migration 34 — run this once in Supabase SQL Editor, after 29-33
--
-- Jasur's correction (2026-09-24), verbatim: "only when students take
-- the full mock which will be in a different dashboard not in a
-- homework, basically everything teacher posts is homework be it full
-- or not full writing they are separate."
--
-- This overturns the assumption migration_33 made (that a
-- mock_task_mode='full' homework counted as "the whole mock"). It
-- does not — ANY homework a teacher posts to a group, regardless of
-- task mode, is homework: AI-graded, teacher-reviewed, and now
-- PERMANENTLY off-limits to the writing examiner role. There is no
-- "whole mock" inside the homeworks/submissions system at all.
--
-- Instead, "the whole mock" is a brand new, wholly separate self-
-- service system — writing_mock_exams / writing_mock_attempts — that
-- a student sits from their OWN Mock Test Center (Take a Test tab),
-- the same way Reading/Listening mock_exams already work: pick an
-- exam, sit it, done. No teacher, no group, no homework row involved
-- anywhere. This is what the writing examiner's queue now reads from.
-- ============================================================

-- ---------- 1. Sever the writing examiner from homeworks/submissions
-- entirely. migration_29 and migration_33's policies granting a
-- writing examiner any visibility into homeworks/submissions were
-- built on the wrong assumption above — drop them completely.
drop policy if exists "submissions_select_writing_examiner" on public.submissions;
drop policy if exists "submissions_update_writing_examiner" on public.submissions;
drop policy if exists "homeworks_select_writing_examiner" on public.homeworks;

-- ---------- 2. The new self-service Writing Mock system ----------
create table if not exists public.writing_mock_exams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  task1_prompt text,
  task1_image_url text,
  task2_prompt text not null,
  time_limit_minutes int not null default 60,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.writing_mock_exams enable row level security;

drop policy if exists "writing_mock_exams_select" on public.writing_mock_exams;
create policy "writing_mock_exams_select" on public.writing_mock_exams
  for select using (
    is_active or public.is_teacher() or public.is_writing_examiner()
  );

drop policy if exists "writing_mock_exams_insert_teacher" on public.writing_mock_exams;
create policy "writing_mock_exams_insert_teacher" on public.writing_mock_exams
  for insert with check (public.is_teacher());

drop policy if exists "writing_mock_exams_update_teacher" on public.writing_mock_exams;
create policy "writing_mock_exams_update_teacher" on public.writing_mock_exams
  for update using (public.is_teacher());

drop policy if exists "writing_mock_exams_delete_teacher" on public.writing_mock_exams;
create policy "writing_mock_exams_delete_teacher" on public.writing_mock_exams
  for delete using (public.is_teacher());

create table if not exists public.writing_mock_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.writing_mock_exams(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  auto_submitted boolean not null default false,
  tab_switch_count int not null default 0,
  task1_text text not null default '',
  task2_text text not null default '',
  examiner_band numeric,
  examiner_feedback text,
  examiner_reviewed_by uuid references public.profiles(id) on delete set null,
  examiner_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists writing_mock_attempts_student_idx
  on public.writing_mock_attempts(student_id, started_at);
create index if not exists writing_mock_attempts_exam_idx
  on public.writing_mock_attempts(exam_id);

alter table public.writing_mock_attempts enable row level security;

drop policy if exists "writing_mock_attempts_select_own" on public.writing_mock_attempts;
create policy "writing_mock_attempts_select_own" on public.writing_mock_attempts
  for select using (student_id = auth.uid());

drop policy if exists "writing_mock_attempts_select_teacher" on public.writing_mock_attempts;
create policy "writing_mock_attempts_select_teacher" on public.writing_mock_attempts
  for select using (public.is_teacher());

drop policy if exists "writing_mock_attempts_select_writing_examiner" on public.writing_mock_attempts;
create policy "writing_mock_attempts_select_writing_examiner" on public.writing_mock_attempts
  for select using (public.is_writing_examiner());

drop policy if exists "writing_mock_attempts_insert_own" on public.writing_mock_attempts;
create policy "writing_mock_attempts_insert_own" on public.writing_mock_attempts
  for insert with check (student_id = auth.uid());

drop policy if exists "writing_mock_attempts_update_own" on public.writing_mock_attempts;
create policy "writing_mock_attempts_update_own" on public.writing_mock_attempts
  for update using (student_id = auth.uid());

drop policy if exists "writing_mock_attempts_update_teacher" on public.writing_mock_attempts;
create policy "writing_mock_attempts_update_teacher" on public.writing_mock_attempts
  for update using (public.is_teacher());

-- The app only ever writes examiner_band/examiner_feedback/
-- examiner_reviewed_by/examiner_reviewed_at from this role (same
-- trust model schema.sql already uses everywhere — e.g. sub_update_own
-- lets a student update any column of their own submissions row; no
-- column-level enforcement anywhere else in this project either).
drop policy if exists "writing_mock_attempts_update_writing_examiner" on public.writing_mock_attempts;
create policy "writing_mock_attempts_update_writing_examiner" on public.writing_mock_attempts
  for update using (public.is_writing_examiner());

alter publication supabase_realtime add table public.writing_mock_exams;
alter publication supabase_realtime add table public.writing_mock_attempts;

-- In-app notification the moment an examiner leaves a band/feedback —
-- same pattern as notify_writing_review() (migration_29), just aimed
-- at this new table instead of submissions/homeworks.
create or replace function public.notify_writing_mock_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.examiner_reviewed_at is not null
     and old.examiner_reviewed_at is distinct from new.examiner_reviewed_at then
    insert into public.notifications(user_id, type, title, body, link)
    values (
      new.student_id,
      'writing_mock_reviewed',
      'Your writing mock has been marked',
      case when new.examiner_band is not null
        then format('Band %s — feedback is ready to read.', new.examiner_band)
        else 'Feedback is ready to read.'
      end,
      '/app'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_writing_mock_review on public.writing_mock_attempts;
create trigger trg_notify_writing_mock_review
after update on public.writing_mock_attempts
for each row execute function public.notify_writing_mock_review();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEP — after running this migration:
--
-- There's no content-editor UI for writing_mock_exams yet (same as
-- the existing Reading/Listening mock_exams, which has never had one
-- either — see MockExams.jsx's own header comment). Insert your first
-- writing mock directly in the Supabase Table Editor:
--
--   insert into writing_mock_exams (title, task1_prompt, task2_prompt)
--   values (
--     'Writing Mock Test 1',
--     'The chart below shows ... Summarize the information...',
--     'Some people believe ... Discuss both views and give your opinion.'
--   );
--
-- Optionally set task1_image_url (a Task 1 chart/graph image URL,
-- e.g. uploaded to the existing "homework-files" storage bucket) and
-- time_limit_minutes (defaults to 60, matching the real exam).
-- ---------------------------------------------------------------------
