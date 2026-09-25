-- ============================================================
-- Migration 36 — run this once in Supabase SQL Editor, after 29-35
--
-- Two independent pieces, both part of the "next level" batch Jasur
-- asked for on 2026-09-25:
--
--   1. Teacher CRUD on mock_exams/mock_sections/mock_questions. These
--      three tables were originally created directly in the shared
--      Supabase project by the standalone ielts-mock-tests app (see
--      MockExams.jsx's own header comment) — there's no local
--      migration file for their original RLS, and it almost certainly
--      predates this project's is_teacher() concept entirely (the
--      standalone app used its own separate mock_test_admins
--      allow-list). Jasur's decision back on 2026-09-24 was "any
--      teacher account can manage exam content" — this is what
--      actually grants that, the same way migration_34 already grants
--      it on writing_mock_exams. Purely additive/OR'd-in, same as
--      every other "teacher sees/manages everything" policy in this
--      project — doesn't touch or replace whatever already exists.
--
--   2. No-show handling on mock_speaking_slots: an in-app notification
--      to every teacher account the moment a speaking examiner marks a
--      slot 'no_show' (the status value already existed from
--      migration_29 — nothing was wired to it yet).
-- ============================================================

-- ---------- 1. Teacher CRUD on the reading/listening exam-content tables
drop policy if exists "mock_exams_insert_teacher" on public.mock_exams;
create policy "mock_exams_insert_teacher" on public.mock_exams
  for insert with check (public.is_teacher());

drop policy if exists "mock_exams_update_teacher" on public.mock_exams;
create policy "mock_exams_update_teacher" on public.mock_exams
  for update using (public.is_teacher());

drop policy if exists "mock_exams_delete_teacher" on public.mock_exams;
create policy "mock_exams_delete_teacher" on public.mock_exams
  for delete using (public.is_teacher());

-- Teachers need to see inactive/draft exams too (not just is_active
-- ones a student sees) while editing — additive, doesn't touch
-- whatever select policy already exists.
drop policy if exists "mock_exams_select_teacher" on public.mock_exams;
create policy "mock_exams_select_teacher" on public.mock_exams
  for select using (public.is_teacher());

drop policy if exists "mock_sections_select_teacher" on public.mock_sections;
create policy "mock_sections_select_teacher" on public.mock_sections
  for select using (public.is_teacher());

drop policy if exists "mock_sections_insert_teacher" on public.mock_sections;
create policy "mock_sections_insert_teacher" on public.mock_sections
  for insert with check (public.is_teacher());

drop policy if exists "mock_sections_update_teacher" on public.mock_sections;
create policy "mock_sections_update_teacher" on public.mock_sections
  for update using (public.is_teacher());

drop policy if exists "mock_sections_delete_teacher" on public.mock_sections;
create policy "mock_sections_delete_teacher" on public.mock_sections
  for delete using (public.is_teacher());

-- mock_questions holds correct_answer directly (mock_questions_public
-- is the answer-free view students read from) — a teacher legitimately
-- needs to see/write the real table to author questions.
drop policy if exists "mock_questions_select_teacher" on public.mock_questions;
create policy "mock_questions_select_teacher" on public.mock_questions
  for select using (public.is_teacher());

drop policy if exists "mock_questions_insert_teacher" on public.mock_questions;
create policy "mock_questions_insert_teacher" on public.mock_questions
  for insert with check (public.is_teacher());

drop policy if exists "mock_questions_update_teacher" on public.mock_questions;
create policy "mock_questions_update_teacher" on public.mock_questions
  for update using (public.is_teacher());

drop policy if exists "mock_questions_delete_teacher" on public.mock_questions;
create policy "mock_questions_delete_teacher" on public.mock_questions
  for delete using (public.is_teacher());

-- ---------- 2. No-show notification ----------
create or replace function public.notify_speaking_no_show()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  student_name text;
  examiner_name text;
  teacher_row record;
begin
  if new.status = 'no_show' and old.status is distinct from 'no_show' then
    select coalesce(full_name, username) into student_name
    from public.profiles where id = new.student_id;

    select coalesce(full_name, username) into examiner_name
    from public.profiles where id = new.examiner_id;

    for teacher_row in
      select id from public.profiles where role = 'teacher' and status = 'approved'
    loop
      insert into public.notifications(user_id, type, title, body, link)
      values (
        teacher_row.id,
        'speaking_no_show',
        'Speaking exam no-show',
        format('%s did not attend the speaking exam scheduled with %s.',
          coalesce(student_name, 'A student'),
          coalesce(examiner_name, 'their examiner')),
        '/app'
      );
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_speaking_no_show on public.mock_speaking_slots;
create trigger trg_notify_speaking_no_show
after update on public.mock_speaking_slots
for each row execute function public.notify_speaking_no_show();

notify pgrst, 'reload schema';
