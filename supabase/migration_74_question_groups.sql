-- migration_74_question_groups.sql (2026-10-06)
-- 1. Question groups: "Questions 11–15" with its title, task type, word
--    limit and instruction stored ONCE (plan Phase 1). mock_questions
--    stays one row per scored question and points at its group.
-- 2. Fairer marking: accepted answer variants, case/space/punctuation
--    tolerant comparison, word limit enforced, re-grade tool.

-- 1. Groups -----------------------------------------------------------
create table if not exists public.mock_question_groups (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.mock_sections(id) on delete cascade,
  order_index integer not null default 0,
  kind text not null default 'other' check (kind in (
    'note_completion', 'table_completion', 'form_completion', 'sentence_completion',
    'summary_completion', 'flow_chart', 'diagram_labelling', 'map_labelling', 'short_answer',
    'mcq_single', 'mcq_multi', 'tfng', 'ynng',
    'matching_headings', 'matching_info', 'matching_features', 'matching_sentence_endings',
    'other')),
  word_limit text check (word_limit in (
    'one_word', 'one_word_and_or_number', 'two_words', 'two_words_and_or_number',
    'three_words', 'three_words_and_or_number', 'number_only')),
  title text,
  instruction text,          -- optional: replaces the generated instruction
  options_reusable boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mock_question_groups_section_idx on public.mock_question_groups (section_id, order_index);

alter table public.mock_question_groups enable row level security;
drop policy if exists "mock admins manage question groups" on public.mock_question_groups;
create policy "mock admins manage question groups" on public.mock_question_groups
  for all to authenticated
  using ((select public.is_mock_test_admin()))
  with check ((select public.is_mock_test_admin()));

alter table public.mock_questions
  add column if not exists group_id uuid references public.mock_question_groups(id) on delete set null,
  add column if not exists accepted_answers text[] not null default '{}';
create index if not exists mock_questions_group_idx on public.mock_questions (group_id);

-- Students read questions + groups only through these functions (same
-- access rule as before: teacher, or a used access code for that exam).
create or replace function public.mock_exam_readable(p_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_teacher()
      or exists (
        select 1
          from public.mock_access_codes ac
          join public.full_mock_sets fms on fms.id = ac.full_mock_set_id
         where ac.student_id = auth.uid()
           and ac.revoked = false
           and ac.used_at is not null
           and (fms.reading_exam_id = p_exam_id or fms.listening_exam_id = p_exam_id)
      );
$$;
revoke all on function public.mock_exam_readable(uuid) from public, anon;
grant execute on function public.mock_exam_readable(uuid) to authenticated;

drop function if exists public.get_mock_questions_public(uuid[]);
create function public.get_mock_questions_public(p_section_ids uuid[])
returns table(id uuid, section_id uuid, order_index integer, type text, prompt text, options jsonb, points integer, group_id uuid)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  return query
    select q.id, q.section_id, q.order_index, q.type, q.prompt, q.options, q.points, q.group_id
      from public.mock_questions q
      join public.mock_sections s on s.id = q.section_id
      join public.mock_exams e on e.id = s.exam_id
     where q.section_id = any(p_section_ids)
       and e.is_active
       and public.mock_exam_readable(e.id);
end;
$function$;
revoke all on function public.get_mock_questions_public(uuid[]) from public, anon;
grant execute on function public.get_mock_questions_public(uuid[]) to authenticated;

create or replace function public.get_mock_question_groups(p_section_ids uuid[])
returns table(id uuid, section_id uuid, order_index integer, kind text, word_limit text, title text, instruction text, options_reusable boolean)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  return query
    select g.id, g.section_id, g.order_index, g.kind, g.word_limit, g.title, g.instruction, g.options_reusable
      from public.mock_question_groups g
      join public.mock_sections s on s.id = g.section_id
      join public.mock_exams e on e.id = s.exam_id
     where g.section_id = any(p_section_ids)
       and e.is_active
       and public.mock_exam_readable(e.id)
     order by g.section_id, g.order_index;
end;
$function$;
revoke all on function public.get_mock_question_groups(uuid[]) from public, anon;
grant execute on function public.get_mock_question_groups(uuid[]) to authenticated;

-- 2. Marking ----------------------------------------------------------
-- "  The Colour. " -> "the colour"; curly quotes/dashes made plain.
create or replace function public.mock_normalise_answer(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               lower(translate(coalesce(p, ''), '‘’“”–—', '''''""--')),
               '\s+', ' ', 'g'),
             '^[\s\.,;:!\?"''\(\)]+', ''),
           '[\s\.,;:!\?"''\(\)]+$', '');
$$;

create or replace function public.mock_answer_is_correct(
  p_answer text, p_correct text, p_accepted text[], p_word_limit text)
returns boolean
language plpgsql
immutable
set search_path = public
as $function$
declare
  v_answer text := public.mock_normalise_answer(p_answer);
  v_words integer;
  v_max integer;
  v_variant text;
begin
  if v_answer = '' then
    return false;
  end if;

  -- Real IELTS rule: an answer longer than the word limit is wrong.
  if p_word_limit is not null then
    v_words := coalesce(array_length(regexp_split_to_array(v_answer, ' '), 1), 0);
    v_max := case p_word_limit
      when 'one_word' then 1
      when 'number_only' then 1
      when 'one_word_and_or_number' then 2
      when 'two_words' then 2
      when 'two_words_and_or_number' then 3
      when 'three_words' then 3
      when 'three_words_and_or_number' then 4
      else null end;
    if v_max is not null and v_words > v_max then
      return false;
    end if;
  end if;

  if v_answer = public.mock_normalise_answer(p_correct) then
    return true;
  end if;
  foreach v_variant in array coalesce(p_accepted, '{}'::text[]) loop
    if public.mock_normalise_answer(v_variant) <> '' and v_answer = public.mock_normalise_answer(v_variant) then
      return true;
    end if;
  end loop;
  return false;
end;
$function$;

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
    select q.id, q.correct_answer, q.accepted_answers, q.points, g.word_limit
      from public.mock_questions q
      join public.mock_sections s on s.id = q.section_id
      left join public.mock_question_groups g on g.id = q.group_id
     where s.exam_id = v_exam_id
  loop
    v_student_answer := v_answers_by_question ->> v_question.id::text;
    v_is_correct := public.mock_answer_is_correct(
      v_student_answer, v_question.correct_answer, v_question.accepted_answers, v_question.word_limit);

    insert into public.mock_answers (attempt_id, question_id, student_answer, is_correct)
    values (p_attempt_id, v_question.id, v_student_answer, v_is_correct)
    on conflict (attempt_id, question_id)
    do update set student_answer = excluded.student_answer, is_correct = excluded.is_correct;

    v_max_score := v_max_score + v_question.points;
    if v_is_correct then
      v_total_score := v_total_score + v_question.points;
    end if;
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

-- Re-grade every submitted attempt of one exam after the answer key
-- changed. Teacher only. Returns the attempts whose score moved.
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
    insert into public.mock_answers (attempt_id, question_id, student_answer, is_correct)
    select v_attempt.id, q.id, null, false
      from public.mock_questions q join public.mock_sections s on s.id = q.section_id
     where s.exam_id = p_exam_id
    on conflict (attempt_id, question_id) do nothing;

    update public.mock_answers a
       set is_correct = public.mock_answer_is_correct(a.student_answer, q.correct_answer, q.accepted_answers, g.word_limit)
      from public.mock_questions q
      left join public.mock_question_groups g on g.id = q.group_id
     where a.attempt_id = v_attempt.id and q.id = a.question_id;

    select coalesce(sum(q.points), 0) into v_new
      from public.mock_answers a join public.mock_questions q on q.id = a.question_id
     where a.attempt_id = v_attempt.id and a.is_correct;

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

-- Breakdown shows the accepted variants too.
drop function if exists public.get_mock_answer_breakdown(uuid);
create function public.get_mock_answer_breakdown(p_attempt_id uuid)
returns table(question_id uuid, section_title text, section_order integer, question_order integer, prompt text,
              question_type text, correct_answer text, student_answer text, is_correct boolean, accepted_answers text[])
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner uuid;
  v_released timestamptz;
begin
  select user_id, released_at into v_owner, v_released from public.mock_attempts where id = p_attempt_id;
  if v_owner is null then
    raise exception 'Attempt not found';
  end if;
  if not (public.is_teacher() or (v_owner = auth.uid() and v_released is not null)) then
    raise exception 'Not authorized to view this breakdown';
  end if;

  return query
    select q.id, s.title, s.order_index, q.order_index, q.prompt, q.type, q.correct_answer,
           a.student_answer, a.is_correct, q.accepted_answers
      from public.mock_answers a
      join public.mock_questions q on q.id = a.question_id
      join public.mock_sections s on s.id = q.section_id
     where a.attempt_id = p_attempt_id
     order by s.order_index, q.order_index;
end;
$function$;
revoke all on function public.get_mock_answer_breakdown(uuid) from public, anon;
grant execute on function public.get_mock_answer_breakdown(uuid) to authenticated;

notify pgrst, 'reload schema';
