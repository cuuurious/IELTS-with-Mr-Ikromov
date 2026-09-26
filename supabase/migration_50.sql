-- ============================================================
-- Migration 50 — run this once in Supabase SQL Editor, after 29-49
--
-- Unblocks the mistake-breakdown sub-feature scoped in "Results
-- confirmation & release" (mock-test-site-concept.md): Jasur wants
-- Reading/Listening mistakes shown as "mountin -> mountain" (the
-- student's given answer next to the correct one). This was blocked on
-- confirming mock_answers' real columns — Jasur checked the Table
-- Editor's Definition tab (2026-09-26) and it's:
--
--   mock_answers(id, attempt_id, question_id, student_answer text,
--                 is_correct boolean)
--
-- (Both nullable — is_correct is only ever set by submit_mock_attempt()'s
-- own grading pass, same table that function already upserts into.)
--
-- Rather than granting students broader SELECT on mock_questions (which
-- holds correct_answer directly — see migration_36's own comment on
-- mock_questions_public existing specifically to keep that away from
-- students during an exam), this adds ONE security-definer function,
-- the same pattern submit_mock_attempt() already uses: it does its own
-- authorization check internally (teacher, OR the attempt's own student
-- once released_at is set) rather than relying on table-level RLS to get
-- it right. A student calling this for someone else's attempt, or their
-- own unreleased one, gets a clean error, not silently-empty rows.
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
      q.question_type,
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
-- ONE-TIME MANUAL STEP — after running this migration: none. The
-- Reading/Listening sections in the teacher's Student Profile window and
-- the student's own Overview tab both call this function directly —
-- nothing else to wire up or backfill.
-- ---------------------------------------------------------------------
