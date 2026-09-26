-- ============================================================
-- Migration 54 — run this once in Supabase SQL Editor, after 29-53
--
-- Bug fix found while building "frozen real-interface review of a
-- graded attempt" (one of the ~15 brainstormed suggestions): this
-- feature and the existing mistake breakdown ("mountin -> mountain")
-- both read from get_mock_answer_breakdown() (migration_50), which
-- selects `q.question_type` from mock_questions. Every other place in
-- this codebase that reads or writes that table's type column —
-- TeacherMockCenter.jsx's saveListeningWizard/saveReadingWizard/
-- saveQuestion, all three inserting/updating a plain `type` field —
-- confirms the real column is named `type`, not `question_type`.
-- Postgres validates a plpgsql function's embedded queries against the
-- current schema at CREATE-time (check_function_bodies), so this
-- almost certainly means migration_50 itself failed to apply when
-- Jasur ran it (with a "column q.question_type does not exist" error
-- in the SQL Editor) rather than the function ever having been live
-- with a broken reference — but either way, this is the fix, and it's
-- worth Jasur trying "View mistakes" once after running this to
-- confirm it now returns rows instead of an error.
--
-- `create or replace function` is idempotent/safe to run whether or
-- not migration_50 actually succeeded the first time.
-- ============================================================

create or replace function public.get_mock_answer_breakdown(p_attempt_id uuid)
returns table (
  question_id uuid,
  section_title text,
  section_order int,
  question_order int,
  prompt text,
  question_type text,
  correct_answer text,
  student_answer text,
  is_correct boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_released timestamptz;
begin
  select user_id, released_at into v_owner, v_released
  from public.mock_attempts
  where id = p_attempt_id;

  if v_owner is null then
    raise exception 'Attempt not found';
  end if;

  if not (
    public.is_teacher()
    or (v_owner = auth.uid() and v_released is not null)
  ) then
    raise exception 'Not authorized to view this breakdown';
  end if;

  return query
    select
      q.id as question_id,
      s.title as section_title,
      s.order_index as section_order,
      q.order_index as question_order,
      q.prompt,
      q.type as question_type,
      q.correct_answer,
      a.student_answer,
      a.is_correct
    from public.mock_answers a
    join public.mock_questions q on q.id = a.question_id
    join public.mock_sections s on s.id = q.section_id
    where a.attempt_id = p_attempt_id
    order by s.order_index, q.order_index;
end;
$$;

grant execute on function public.get_mock_answer_breakdown(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEP — after running this migration: try "View
-- mistakes" once (Student Profile modal, or the student's own Overview
-- "Your attempts" list) to confirm it now returns rows. Nothing else to
-- wire up — same function name/signature, every existing caller is
-- unaffected.
-- ---------------------------------------------------------------------
