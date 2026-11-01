-- migration_83_multi_select_marks.sql (2026-11-01, bug sweep)
--
-- "Choose TWO letters" questions were marked wrong. In the real test
-- "Questions 21–22: choose TWO" is worth 2 marks, one per correct letter.
-- Here it was ONE question worth 1 mark, and only if both letters were
-- right. So:
--   * a student with one of the two letters right got 0 instead of 1;
--   * the test totalled 39 instead of 40, which skews the band.
--
-- Fix:
--   1. A multi_select question is now worth as many marks as it has
--      correct letters (set automatically whenever it is saved).
--   2. Marking gives one mark per correct letter. Ticking more letters
--      than asked costs one mark per extra letter (so "tick everything"
--      never pays).
--   3. mock_answers.points_awarded records the marks each answer got;
--      submit and re-grade both use it.
-- Nothing changes for any other question type. Safe to run more than once.

alter table public.mock_answers
  add column if not exists points_awarded integer;

-- Marks for one multi_select answer. Answers are the chosen choices
-- joined by ", " (see canonicalizeMultiSelect in the app); a choice's own
-- text may contain commas, so membership is checked against the
-- question's own list of choices, not by splitting on commas.
create or replace function public.mock_multi_select_marks(p_answer text, p_correct text, p_options jsonb)
returns integer
language sql
immutable
set search_path = public
as $function$
  with ch as (
    select distinct public.mock_normalise_answer(replace(c, ',', ' , ')) v
      from jsonb_array_elements_text(coalesce(p_options -> 'choices', '[]'::jsonb)) c
     where public.mock_normalise_answer(c) <> ''
  ),
  picked as (
    select v from ch
     where (' , ' || public.mock_normalise_answer(replace(coalesce(p_answer, ''), ',', ' , ')) || ' , ')
           like ('% , ' || v || ' , %')
  ),
  correct as (
    select v from ch
     where (' , ' || public.mock_normalise_answer(replace(coalesce(p_correct, ''), ',', ' , ')) || ' , ')
           like ('% , ' || v || ' , %')
  )
  select greatest(
    0,
    (select count(*) from picked where v in (select v from correct))::integer
      - greatest(0, (select count(*) from picked)::integer - (select count(*) from correct)::integer)
  );
$function$;

-- A multi_select question is worth one mark per correct letter.
create or replace function public.mock_questions_set_points()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_n integer;
begin
  if new.type = 'multi_select' and coalesce(trim(new.correct_answer), '') <> '' then
    v_n := public.mock_multi_select_marks(new.correct_answer, new.correct_answer, new.options);
    if v_n > 0 then
      new.points := v_n;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_mock_questions_set_points on public.mock_questions;
create trigger trg_mock_questions_set_points
  before insert or update of type, correct_answer, options, points on public.mock_questions
  for each row execute function public.mock_questions_set_points();

-- Existing multi_select questions get their right worth now.
update public.mock_questions set points = points where type = 'multi_select';

-- Submit: same as migration_74, plus per-letter marks for multi_select.
create or replace function public.submit_mock_attempt(p_attempt_id uuid, p_answers jsonb)
returns table(score integer, max_score integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner uuid;
  v_exam_id uuid;
  v_already_submitted boolean;
  v_deadline timestamptz;
  v_paused timestamptz;
  v_draft jsonb;
  v_total_score integer := 0;
  v_max_score integer := 0;
  v_question record;
  v_student_answer text;
  v_is_correct boolean;
  v_marks integer;
  v_answers_by_question jsonb;
begin
  select a.user_id, a.exam_id, (a.submitted_at is not null), a.deadline_at, a.paused_at, a.draft_answers
    into v_owner, v_exam_id, v_already_submitted, v_deadline, v_paused, v_draft
    from public.mock_attempts a
    where a.id = p_attempt_id;

  if v_owner is null then
    raise exception 'Attempt not found.';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'Not your attempt.';
  end if;
  if v_already_submitted then
    raise exception 'Attempt already submitted.';
  end if;

  -- Late (server clock, 2-minute grace): grade what was saved in time.
  if v_deadline is not null and v_paused is null and now() > v_deadline + interval '2 minutes' then
    v_answers_by_question := coalesce(v_draft->'answers', '{}'::jsonb);
  else
    select coalesce(jsonb_object_agg(elem ->> 'question_id', elem -> 'answer'), '{}'::jsonb)
      into v_answers_by_question
      from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) as elem
      where elem ->> 'question_id' is not null;
  end if;

  for v_question in
    select q.id, q.type, q.correct_answer, q.accepted_answers, q.points, q.options, g.word_limit
      from public.mock_questions q
      join public.mock_sections s on s.id = q.section_id
      left join public.mock_question_groups g on g.id = q.group_id
     where s.exam_id = v_exam_id
  loop
    v_student_answer := v_answers_by_question ->> v_question.id::text;
    v_is_correct := public.mock_answer_is_correct(
      v_student_answer, v_question.correct_answer, v_question.accepted_answers, v_question.word_limit);

    if v_question.type = 'multi_select' then
      v_marks := least(v_question.points, public.mock_multi_select_marks(v_student_answer, v_question.correct_answer, v_question.options));
      v_is_correct := v_marks >= v_question.points;
    else
      v_marks := case when v_is_correct then v_question.points else 0 end;
    end if;

    insert into public.mock_answers (attempt_id, question_id, student_answer, is_correct, points_awarded)
    values (p_attempt_id, v_question.id, v_student_answer, v_is_correct, v_marks)
    on conflict (attempt_id, question_id)
    do update set student_answer = excluded.student_answer, is_correct = excluded.is_correct,
                  points_awarded = excluded.points_awarded;

    v_max_score := v_max_score + v_question.points;
    v_total_score := v_total_score + v_marks;
  end loop;

  perform set_config('app.mock_grading', 'on', true);
  update public.mock_attempts
    set submitted_at = now(), score = v_total_score, max_score = v_max_score
    where id = p_attempt_id;
  perform set_config('app.mock_grading', 'off', true);

  if public.is_teacher() then
    return query select v_total_score, v_max_score;
  else
    return query select null::integer, null::integer;
  end if;
end;
$function$;

-- Re-grade: same as migration_74, plus per-letter marks.
create or replace function public.regrade_mock_exam(p_exam_id uuid)
returns table(attempt_id uuid, old_score integer, new_score integer, max_score integer, released boolean)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_attempt record;
  v_new integer;
  v_max integer;
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can re-grade.';
  end if;

  select coalesce(sum(q.points), 0) into v_max
    from public.mock_questions q join public.mock_sections s on s.id = q.section_id
   where s.exam_id = p_exam_id;

  for v_attempt in
    select a.id, a.score, a.released_at from public.mock_attempts a
     where a.exam_id = p_exam_id and a.submitted_at is not null
  loop
    -- Questions added after the attempt count as unanswered.
    insert into public.mock_answers (attempt_id, question_id, student_answer, is_correct, points_awarded)
    select v_attempt.id, q.id, null, false, 0
      from public.mock_questions q join public.mock_sections s on s.id = q.section_id
     where s.exam_id = p_exam_id
    on conflict (attempt_id, question_id) do nothing;

    update public.mock_answers a
       set is_correct = public.mock_answer_is_correct(a.student_answer, q.correct_answer, q.accepted_answers, g.word_limit),
           points_awarded = case
             when q.type = 'multi_select'
               then least(q.points, public.mock_multi_select_marks(a.student_answer, q.correct_answer, q.options))
             when public.mock_answer_is_correct(a.student_answer, q.correct_answer, q.accepted_answers, g.word_limit)
               then q.points
             else 0 end
      from public.mock_questions q
      left join public.mock_question_groups g on g.id = q.group_id
     where a.attempt_id = v_attempt.id and q.id = a.question_id;

    update public.mock_answers a
       set is_correct = a.points_awarded >= q.points
      from public.mock_questions q
     where a.attempt_id = v_attempt.id and q.id = a.question_id and q.type = 'multi_select';

    select coalesce(sum(a.points_awarded), 0) into v_new
      from public.mock_answers a
     where a.attempt_id = v_attempt.id;

    if v_new is distinct from v_attempt.score then
      update public.mock_attempts set score = v_new, max_score = v_max where id = v_attempt.id;
      attempt_id := v_attempt.id;
      old_score := v_attempt.score;
      new_score := v_new;
      max_score := v_max;
      released := v_attempt.released_at is not null;
      return next;
    else
      update public.mock_attempts set max_score = v_max where id = v_attempt.id and max_score is distinct from v_max;
    end if;
  end loop;
end;
$function$;
revoke all on function public.regrade_mock_exam(uuid) from public, anon;
grant execute on function public.regrade_mock_exam(uuid) to authenticated;

notify pgrst, 'reload schema';
