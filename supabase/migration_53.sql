-- ============================================================
-- Migration 53 — run this once in Supabase SQL Editor, after 29-52
--
-- Question-type mistake analytics. Another of the ~15 convenience
-- suggestions from the 2026-09-26 brainstorm, folded into "build
-- everything you suggested." The per-attempt mistake breakdown
-- (migration_50's get_mock_answer_breakdown) already shows a teacher
-- "this student got question 7 wrong" one attempt at a time. This adds
-- the aggregate view across every attempt ever submitted: which
-- question TYPES trip students up the most (e.g. "matching" gets
-- missed far more than "multiple_choice" across the board), and which
-- SPECIFIC questions have an unusually high wrong-rate — a strong
-- signal that either the teaching needs to focus there, or the
-- question itself is ambiguously worded and worth a second look.
--
-- Security-definer, same reasoning as get_mock_answer_breakdown:
-- rather than loosening mock_questions'/mock_answers' RLS (which
-- exists specifically to keep correct_answer and other students'
-- answers away from a student), this is a narrow, teacher-only door
-- that does its own authorization check inside the function body.
-- Aggregates only — no student_id anywhere in the result, so this
-- can't be (mis)used to look up what one particular student answered;
-- that's still get_mock_answer_breakdown's job, scoped to one attempt.
-- ============================================================

create or replace function public.get_mock_question_stats()
returns table (
  question_id uuid,
  exam_id uuid,
  exam_title text,
  module text,
  section_id uuid,
  section_title text,
  type text,
  prompt text,
  total_answers bigint,
  wrong_answers bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can view question analytics.';
  end if;

  return query
    select
      q.id as question_id,
      e.id as exam_id,
      e.title as exam_title,
      e.module,
      s.id as section_id,
      s.title as section_title,
      q.type,
      q.prompt,
      count(a.id) as total_answers,
      count(a.id) filter (where coalesce(a.is_correct, false) = false) as wrong_answers
    from public.mock_questions q
    join public.mock_sections s on s.id = q.section_id
    join public.mock_exams e on e.id = s.exam_id
    left join public.mock_answers a on a.question_id = q.id
    group by q.id, e.id, e.title, e.module, s.id, s.title, q.type, q.prompt;
end;
$$;

grant execute on function public.get_mock_question_stats() to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEP — after running this migration: nothing else to
-- do. The Teacher Mock Center has a new "Analytics" tab (top-level, next
-- to Results) that calls this function directly — no new table, no new
-- RLS policy, no Edge Function.
-- ---------------------------------------------------------------------
