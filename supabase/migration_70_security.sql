-- ============================================================
-- Migration 70 — security + exam integrity fixes (2026-10-06 audit).
-- Safe to run twice. Changes rules and functions only; no data is
-- deleted or rewritten.
--
-- 1. Students could submit any Reading/Listening score themselves by
--    updating their own mock_attempts row. A submission is now only
--    accepted from inside submit_mock_attempt() (transaction flag).
-- 2. Exam time is enforced by the server clock: saves more than
--    2 minutes after deadline_at (when not paused) are ignored, a late
--    submit_mock_attempt grades the last saved answers instead of
--    whatever the browser sends, and writing submissions are stamped
--    with the server time.
-- 3. submit_mock_attempt no longer returns the score to students
--    (results are released by the teacher).
-- 4. Access-code check-in: students can only set used_at (forced to
--    the server time) and entered_full_name.
-- 5. Only ONE unsubmitted attempt per student + exam (a refresh can't
--    start a second attempt with a fresh clock).
-- 6. server_now() — the database clock for the exam timers.
-- 7. release_mock_results() — release many results in one transaction.
-- 8. delete_student_permanently() is removed (no permission check, not
--    used by the app); anonymous (logged-out) callers can no longer run
--    the internal functions — only the three used before sign-in.
-- ============================================================

-- 6. Database clock ------------------------------------------------
create or replace function public.server_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now() $$;
revoke all on function public.server_now() from public, anon;
grant execute on function public.server_now() to authenticated;

-- 5. One open attempt per student + exam ---------------------------
create unique index if not exists mock_attempts_one_open_per_exam
  on public.mock_attempts (user_id, exam_id) where submitted_at is null;
create unique index if not exists writing_mock_attempts_one_open_per_exam
  on public.writing_mock_attempts (student_id, exam_id) where submitted_at is null;

-- 1 + 2. mock_attempts update rules ---------------------------------
create or replace function public.enforce_mock_attempts_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_real_max_score integer;
  v_old_review text;
  v_new_review text;
  v_module text;
begin
  if public.is_teacher() then
    return new;
  end if;

  if new.exam_id is distinct from old.exam_id
     or new.user_id is distinct from old.user_id
     or new.started_at is distinct from old.started_at
     or new.band is distinct from old.band
     or new.released_at is distinct from old.released_at
     or new.released_by is distinct from old.released_by
     or new.deadline_at is distinct from old.deadline_at
     or new.paused_at is distinct from old.paused_at then
    raise exception 'mock_attempts: exam_id/user_id/started_at/band/release/deadline/pause fields cannot be changed directly.';
  end if;

  if old.submitted_at is not null then
    raise exception 'mock_attempts: this attempt has already been submitted.';
  end if;

  new.last_seen_at := now();

  -- Pattern A: autosave (tab_switch_count / draft_answers only).
  if new.submitted_at is null
     and new.score is not distinct from old.score
     and new.max_score is not distinct from old.max_score then

    -- Time is up (server clock, 2-minute grace, not paused): keep the
    -- last answers saved in time; only the integrity counter may move.
    if old.deadline_at is not null and old.paused_at is null
       and now() > old.deadline_at + interval '2 minutes' then
      new.draft_answers := old.draft_answers;
      return new;
    end if;

    v_old_review := nullif(old.draft_answers->>'reviewStartedAt', '');
    v_new_review := nullif(new.draft_answers->>'reviewStartedAt', '');

    if v_old_review is not null and v_new_review is distinct from v_old_review then
      new.draft_answers := jsonb_set(
        coalesce(new.draft_answers, '{}'::jsonb),
        '{reviewStartedAt}',
        old.draft_answers->'reviewStartedAt'
      );
    elsif v_old_review is null and v_new_review is not null then
      select module into v_module from public.mock_exams where id = new.exam_id;
      if v_module = 'listening' and old.paused_at is null then
        new.deadline_at := now() + interval '2 minutes';
      else
        new.draft_answers := new.draft_answers - 'reviewStartedAt';
      end if;
    end if;

    return new;
  end if;

  -- Pattern B: a real submission — ONLY from submit_mock_attempt().
  if new.submitted_at is not null then
    if coalesce(current_setting('app.mock_grading', true), '') <> 'on' then
      raise exception 'mock_attempts: answers can only be submitted through submit_mock_attempt().';
    end if;
    if old.paused_at is not null then
      raise exception 'mock_attempts: this test is paused by your teacher.';
    end if;

    select coalesce(sum(q.points), 0)
      into v_real_max_score
      from public.mock_questions q
      join public.mock_sections s on s.id = q.section_id
      where s.exam_id = new.exam_id;

    if new.max_score is distinct from v_real_max_score then
      raise exception 'mock_attempts: max_score must match this exam''s real total points (%).', v_real_max_score;
    end if;
    if new.score is null or new.score < 0 or new.score > new.max_score then
      raise exception 'mock_attempts: score is out of range.';
    end if;
    return new;
  end if;

  raise exception 'mock_attempts: that combination of changes is not allowed.';
end;
$function$;

-- 2 + 3. Grading ----------------------------------------------------
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

  -- Late (server clock, 2-minute grace): grade what was saved in time,
  -- not what the browser sends now.
  if v_deadline is not null and v_paused is null and now() > v_deadline + interval '2 minutes' then
    v_answers_by_question := coalesce(v_draft->'answers', '{}'::jsonb);
  else
    select coalesce(jsonb_object_agg(elem ->> 'question_id', elem -> 'answer'), '{}'::jsonb)
      into v_answers_by_question
      from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) as elem
      where elem ->> 'question_id' is not null;
  end if;

  for v_question in
    select q.id, q.correct_answer, q.points
    from public.mock_questions q
    join public.mock_sections s on s.id = q.section_id
    where s.exam_id = v_exam_id
  loop
    v_student_answer := v_answers_by_question ->> v_question.id::text;
    v_is_correct := trim(lower(coalesce(v_student_answer, ''))) = trim(lower(v_question.correct_answer));

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

  -- Students don't see their score until the teacher releases it.
  if public.is_teacher() then
    return query select v_total_score, v_max_score;
  else
    return query select null::integer, null::integer;
  end if;
end;
$function$;

-- 2. Writing: server clock ----------------------------------------
create or replace function public.enforce_writing_mock_attempts_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if public.is_teacher() then
    return new;
  end if;

  if new.exam_id is distinct from old.exam_id
     or new.student_id is distinct from old.student_id
     or new.started_at is distinct from old.started_at
     or new.deadline_at is distinct from old.deadline_at
     or new.paused_at is distinct from old.paused_at then
    raise exception 'writing_mock_attempts: exam_id/student_id/started_at/deadline/pause cannot be changed.';
  end if;

  if public.is_writing_examiner() then
    if new.task1_text is distinct from old.task1_text
       or new.task2_text is distinct from old.task2_text
       or new.tab_switch_count is distinct from old.tab_switch_count
       or new.auto_submitted is distinct from old.auto_submitted
       or new.submitted_at is distinct from old.submitted_at
       or new.released_at is distinct from old.released_at
       or new.released_by is distinct from old.released_by then
      raise exception 'writing_mock_attempts: examiners can only set the grading fields.';
    end if;
    return new;
  end if;

  if new.examiner_band is distinct from old.examiner_band
     or new.examiner_feedback is distinct from old.examiner_feedback
     or new.examiner_reviewed_by is distinct from old.examiner_reviewed_by
     or new.examiner_reviewed_at is distinct from old.examiner_reviewed_at
     or new.ta_band is distinct from old.ta_band
     or new.cc_band is distinct from old.cc_band
     or new.lr_band is distinct from old.lr_band
     or new.gra_band is distinct from old.gra_band
     or new.released_at is distinct from old.released_at
     or new.released_by is distinct from old.released_by then
    raise exception 'writing_mock_attempts: students cannot set grading or release fields.';
  end if;

  if old.submitted_at is not null then
    raise exception 'writing_mock_attempts: this attempt has already been submitted.';
  end if;

  if new.submitted_at is not null and old.paused_at is not null then
    raise exception 'writing_mock_attempts: this test is paused by your teacher.';
  end if;

  -- Time is up (server clock, 2-minute grace): keep the essay as it was.
  if old.deadline_at is not null and old.paused_at is null
     and now() > old.deadline_at + interval '2 minutes' then
    new.task1_text := old.task1_text;
    new.task2_text := old.task2_text;
  end if;

  -- The server, not the browser, decides when it was submitted.
  if new.submitted_at is not null then
    new.submitted_at := now();
  end if;

  new.last_seen_at := now();
  return new;
end;
$function$;

-- 4. Access-code check-in --------------------------------------------
create or replace function public.enforce_mock_access_code_checkin()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if public.is_teacher() then
    return new;
  end if;

  if new.code is distinct from old.code
     or new.student_id is distinct from old.student_id
     or new.full_mock_set_id is distinct from old.full_mock_set_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.batch_id is distinct from old.batch_id
     or new.revoked is distinct from old.revoked
     or new.sections is distinct from old.sections
     or new.telegram_sent_at is distinct from old.telegram_sent_at then
    raise exception 'mock_access_codes: only the check-in fields can be changed.';
  end if;

  if old.used_at is not null then
    raise exception 'mock_access_codes: this code has already been used.';
  end if;

  if new.used_at is not null then
    new.used_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_enforce_mock_access_code_checkin on public.mock_access_codes;
create trigger trg_enforce_mock_access_code_checkin
  before update on public.mock_access_codes
  for each row execute function public.enforce_mock_access_code_checkin();

-- 7. Release many results at once (teacher only) ----------------------
create or replace function public.release_mock_results(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_item jsonb;
  v_count integer := 0;
  v_n integer;
  v_id uuid;
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can release results.';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_id := (v_item->>'id')::uuid;
    if v_item->>'table' = 'mock_attempts' then
      update public.mock_attempts
        set released_at = now(),
            released_by = auth.uid(),
            band = case when v_item ? 'band' and v_item->>'band' is not null then (v_item->>'band')::numeric else band end
        where id = v_id;
    elsif v_item->>'table' = 'writing_mock_attempts' then
      update public.writing_mock_attempts set released_at = now(), released_by = auth.uid() where id = v_id;
    elsif v_item->>'table' = 'mock_speaking_slots' then
      update public.mock_speaking_slots set released_at = now(), released_by = auth.uid() where id = v_id;
    else
      raise exception 'Unknown results table: %', v_item->>'table';
    end if;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;

  return v_count;
end;
$function$;
revoke all on function public.release_mock_results(jsonb) from public, anon;
grant execute on function public.release_mock_results(jsonb) to authenticated;

-- 8. Remove the unguarded delete function; lock functions to signed-in users
drop function if exists public.delete_student_permanently(uuid);

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.all_students_leaderboard()',
    'public.delete_my_account()',
    'public.get_mock_answer_breakdown(uuid)',
    'public.get_mock_question_stats()',
    'public.get_mock_questions_public(uuid[])',
    'public.get_speaking_examiner_workload()',
    'public.group_leaderboard(uuid)',
    'public.is_group_admin(uuid)',
    'public.resolve_student_login_email(text)',
    'public.submit_mock_attempt(uuid, jsonb)',
    'public.teacher_add_time_full_mock(uuid, integer)',
    'public.teacher_advance_full_mock(uuid)',
    'public.teacher_delete_full_mock_attempt(uuid)',
    'public.teacher_delete_mock_attempt(uuid)',
    'public.teacher_delete_writing_attempt(uuid)',
    'public.teacher_pause_full_mock(uuid)',
    'public.teacher_resume_full_mock(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Only the server (Edge Functions / cron) needs this one.
revoke execute on function public.get_orphan_submission_paths(integer, integer) from public, anon, authenticated;

notify pgrst, 'reload schema';
