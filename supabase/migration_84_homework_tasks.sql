-- migration_84_homework_tasks.sql (2026-11-02)
--
-- Homework done inside the site, step 1.
--
--   * Homework bank: Reading/Listening tests made with the same Mock
--     Center tools, marked bank = 'homework' so they never show up as
--     mocks. They can be one passage / one part or a full test.
--   * homework_tasks: what a homework asks for (a bank test now; word
--     lists and HTML workshops next).
--   * homework_attempts: every try a student makes. Practice mode has no
--     clock; exam mode has the real-test clock. The first attempt is the
--     one that counts; retakes are kept too.
--   * submit_homework_attempt(): marks it on the server and returns the
--     score plus the right answers straight away.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------
-- 1. Homework bank flag on tests
-- ---------------------------------------------------------------
alter table public.mock_exams
  add column if not exists bank text not null default 'mock';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mock_exams_bank_check') then
    alter table public.mock_exams
      add constraint mock_exams_bank_check check (bank in ('mock', 'homework'));
  end if;
end $$;

create index if not exists mock_exams_bank_idx on public.mock_exams (bank);

-- ---------------------------------------------------------------
-- 2. Tasks inside a homework
-- ---------------------------------------------------------------
create table if not exists public.homework_tasks (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homeworks(id) on delete cascade,
  position integer not null default 0,
  kind text not null check (kind in ('reading', 'listening', 'wordlist', 'html')),
  exam_id uuid references public.mock_exams(id) on delete restrict,
  wordlist_id uuid references public.wordlists(id) on delete set null,
  html_url text,
  title text,
  created_at timestamptz not null default now(),
  constraint homework_tasks_exam_kind check ((kind in ('reading', 'listening')) = (exam_id is not null))
);

create index if not exists homework_tasks_homework_idx on public.homework_tasks (homework_id, position);
create index if not exists homework_tasks_exam_idx on public.homework_tasks (exam_id);

alter table public.homework_tasks enable row level security;

drop policy if exists homework_tasks_teacher_all on public.homework_tasks;
create policy homework_tasks_teacher_all on public.homework_tasks
  for all using ((select public.is_teacher())) with check ((select public.is_teacher()));

drop policy if exists homework_tasks_member_read on public.homework_tasks;
create policy homework_tasks_member_read on public.homework_tasks
  for select using (
    exists (select 1 from public.homeworks h where h.id = homework_id and public.is_group_member(h.group_id))
  );

-- Is this bank test set as homework for a group the current student is in?
create or replace function public.homework_exam_visible(p_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
      from public.homework_tasks t
      join public.homeworks h on h.id = t.homework_id
     where t.exam_id = p_exam_id
       and public.is_group_member(h.group_id)
  );
$function$;

-- Students may read the test and its passages/parts once it is their homework.
drop policy if exists "students read their homework tests" on public.mock_exams;
create policy "students read their homework tests" on public.mock_exams
  for select using (bank = 'homework' and public.homework_exam_visible(id));

drop policy if exists "students read sections of their homework tests" on public.mock_sections;
create policy "students read sections of their homework tests" on public.mock_sections
  for select using (
    exists (select 1 from public.mock_exams e where e.id = exam_id and e.bank = 'homework')
    and public.homework_exam_visible(exam_id)
  );

-- Questions and question groups (never the answers) go through the
-- existing public functions, which check mock_exam_readable().
create or replace function public.mock_exam_readable(p_exam_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select public.is_teacher()
      or exists (
        select 1
          from public.mock_access_codes ac
          join public.full_mock_sets fms on fms.id = ac.full_mock_set_id
         where ac.student_id = auth.uid()
           and ac.revoked = false
           and ac.used_at is not null
           and (fms.reading_exam_id = p_exam_id or fms.listening_exam_id = p_exam_id)
      )
      or public.homework_exam_visible(p_exam_id);
$function$;

create or replace function public.get_mock_questions_public(p_section_ids uuid[])
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
       and (e.is_active or e.bank = 'homework')
       and public.mock_exam_readable(e.id);
end;
$function$;

create or replace function public.get_mock_question_groups(p_section_ids uuid[])
returns table(id uuid, section_id uuid, order_index integer, kind text, word_limit text, title text, instruction text, options_reusable boolean, body text, image_url text, gap_positions jsonb)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  return query
    select g.id, g.section_id, g.order_index, g.kind, g.word_limit, g.title, g.instruction,
           g.options_reusable, g.body, g.image_url, g.gap_positions
      from public.mock_question_groups g
      join public.mock_sections s on s.id = g.section_id
      join public.mock_exams e on e.id = s.exam_id
     where g.section_id = any(p_section_ids)
       and (e.is_active or e.bank = 'homework')
       and public.mock_exam_readable(e.id)
     order by g.section_id, g.order_index;
end;
$function$;

-- ---------------------------------------------------------------
-- 3. Attempts
-- ---------------------------------------------------------------
create table if not exists public.homework_attempts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.homework_tasks(id) on delete cascade,
  homework_id uuid not null references public.homeworks(id) on delete cascade,
  exam_id uuid references public.mock_exams(id) on delete set null,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  mode text not null default 'practice' check (mode in ('practice', 'exam')),
  attempt_no integer not null default 1,
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  paused_at timestamptz,
  last_seen_at timestamptz,
  submitted_at timestamptz,
  draft_answers jsonb,
  tab_switch_count integer not null default 0,
  score integer,
  max_score integer,
  band numeric(2,1),
  results jsonb,
  late boolean
);

create index if not exists homework_attempts_task_user_idx on public.homework_attempts (task_id, user_id, attempt_no);
create index if not exists homework_attempts_homework_idx on public.homework_attempts (homework_id);
create index if not exists homework_attempts_user_idx on public.homework_attempts (user_id, submitted_at);
create unique index if not exists homework_attempts_one_open
  on public.homework_attempts (task_id, user_id) where submitted_at is null;

alter table public.homework_attempts enable row level security;

drop policy if exists homework_attempts_read_own on public.homework_attempts;
create policy homework_attempts_read_own on public.homework_attempts
  for select using (user_id = (select auth.uid()) or (select public.is_teacher()));

drop policy if exists homework_attempts_insert_own on public.homework_attempts;
create policy homework_attempts_insert_own on public.homework_attempts
  for insert with check (user_id = (select auth.uid()));

drop policy if exists homework_attempts_update_own on public.homework_attempts;
create policy homework_attempts_update_own on public.homework_attempts
  for update using (user_id = (select auth.uid()) or (select public.is_teacher()));

drop policy if exists homework_attempts_delete_teacher on public.homework_attempts;
create policy homework_attempts_delete_teacher on public.homework_attempts
  for delete using ((select public.is_teacher()));

-- Minutes allowed in exam mode: 20 per Reading passage, 10 per
-- Listening part (the 2-minute review after the audio is added by the
-- update trigger, as in mocks).
create or replace function public.homework_time_limit_minutes(p_exam_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select case when e.module = 'listening' then 10 else 20 end
         * greatest(1, (select count(*) from public.mock_sections s where s.exam_id = e.id))::integer
    from public.mock_exams e
   where e.id = p_exam_id;
$function$;

create or replace function public.homework_attempts_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_task record;
begin
  select t.*, h.group_id into v_task
    from public.homework_tasks t
    join public.homeworks h on h.id = t.homework_id
   where t.id = new.task_id;

  if v_task.id is null then
    raise exception 'This homework task no longer exists.';
  end if;
  if v_task.exam_id is null then
    raise exception 'This task has no test to take.';
  end if;
  if not public.is_teacher() then
    if new.user_id is distinct from auth.uid() then
      raise exception 'Not your attempt.';
    end if;
    if not public.is_group_member(v_task.group_id) then
      raise exception 'This homework is not for your group.';
    end if;
  end if;

  new.homework_id := v_task.homework_id;
  new.exam_id := v_task.exam_id;
  new.started_at := now();
  new.submitted_at := null;
  new.score := null;
  new.max_score := null;
  new.band := null;
  new.results := null;
  new.late := null;
  new.paused_at := null;
  new.attempt_no := coalesce(
    (select max(a.attempt_no) from public.homework_attempts a where a.task_id = new.task_id and a.user_id = new.user_id), 0
  ) + 1;
  new.deadline_at := case
    when new.mode = 'exam' then now() + make_interval(mins => public.homework_time_limit_minutes(v_task.exam_id))
    else null
  end;
  return new;
end;
$function$;

drop trigger if exists trg_homework_attempts_before_insert on public.homework_attempts;
create trigger trg_homework_attempts_before_insert
  before insert on public.homework_attempts
  for each row execute function public.homework_attempts_before_insert();

-- Students may only autosave (draft_answers, tab_switch_count). Marks
-- come only from submit_homework_attempt().
create or replace function public.homework_attempts_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_module text;
begin
  if public.is_teacher() and coalesce(current_setting('app.homework_grading', true), '') <> 'on' then
    return new;
  end if;
  if coalesce(current_setting('app.homework_grading', true), '') = 'on' then
    return new;
  end if;

  if new.task_id is distinct from old.task_id
     or new.user_id is distinct from old.user_id
     or new.homework_id is distinct from old.homework_id
     or new.exam_id is distinct from old.exam_id
     or new.mode is distinct from old.mode
     or new.attempt_no is distinct from old.attempt_no
     or new.started_at is distinct from old.started_at
     or new.paused_at is distinct from old.paused_at
     or new.submitted_at is distinct from old.submitted_at
     or new.score is distinct from old.score
     or new.max_score is distinct from old.max_score
     or new.band is distinct from old.band
     or new.results is distinct from old.results
     or new.late is distinct from old.late then
    raise exception 'homework_attempts: only answers can be saved here.';
  end if;

  if old.submitted_at is not null then
    raise exception 'homework_attempts: this attempt has already been submitted.';
  end if;

  new.last_seen_at := now();

  -- Exam mode, time up (2-minute grace): keep what was saved in time.
  if old.deadline_at is not null and now() > old.deadline_at + interval '2 minutes' then
    new.draft_answers := old.draft_answers;
    new.deadline_at := old.deadline_at;
    return new;
  end if;

  -- Listening review window: the 2 minutes start once the audio ends.
  if new.deadline_at is distinct from old.deadline_at then
    new.deadline_at := old.deadline_at;
  end if;
  if old.deadline_at is not null
     and nullif(old.draft_answers->>'reviewStartedAt', '') is null
     and nullif(new.draft_answers->>'reviewStartedAt', '') is not null then
    select module into v_module from public.mock_exams where id = old.exam_id;
    if v_module = 'listening' then
      new.deadline_at := least(old.deadline_at, now() + interval '2 minutes');
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_homework_attempts_before_update on public.homework_attempts;
create trigger trg_homework_attempts_before_update
  before update on public.homework_attempts
  for each row execute function public.homework_attempts_before_update();

-- IELTS Academic raw score (out of 40) to band.
create or replace function public.ielts_band_from_raw(p_module text, p_raw integer)
returns numeric
language sql
immutable
as $function$
  select case
    when p_raw is null then null
    when p_module = 'listening' then
      case
        when p_raw >= 39 then 9.0 when p_raw >= 37 then 8.5 when p_raw >= 35 then 8.0
        when p_raw >= 32 then 7.5 when p_raw >= 30 then 7.0 when p_raw >= 26 then 6.5
        when p_raw >= 23 then 6.0 when p_raw >= 18 then 5.5 when p_raw >= 16 then 5.0
        when p_raw >= 13 then 4.5 when p_raw >= 10 then 4.0 when p_raw >= 8 then 3.5
        when p_raw >= 6 then 3.0 when p_raw >= 4 then 2.5 when p_raw >= 1 then 2.0 else 1.0
      end
    else
      case
        when p_raw >= 39 then 9.0 when p_raw >= 37 then 8.5 when p_raw >= 35 then 8.0
        when p_raw >= 33 then 7.5 when p_raw >= 30 then 7.0 when p_raw >= 27 then 6.5
        when p_raw >= 23 then 6.0 when p_raw >= 19 then 5.5 when p_raw >= 15 then 5.0
        when p_raw >= 13 then 4.5 when p_raw >= 10 then 4.0 when p_raw >= 8 then 3.5
        when p_raw >= 6 then 3.0 when p_raw >= 4 then 2.5 when p_raw >= 1 then 2.0 else 1.0
      end
  end;
$function$;

-- Mark an attempt. Returns the score and, per question, the student's
-- answer, the right answer and the marks, so the student sees them
-- straight away.
create or replace function public.submit_homework_attempt(p_attempt_id uuid, p_answers jsonb)
returns table(score integer, max_score integer, band numeric, results jsonb)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_attempt public.homework_attempts%rowtype;
  v_module text;
  v_due timestamptz;
  v_answers jsonb;
  v_total integer := 0;
  v_max integer := 0;
  v_marks integer;
  v_correct boolean;
  v_given text;
  v_results jsonb := '[]'::jsonb;
  v_band numeric;
  q record;
begin
  select * into v_attempt from public.homework_attempts a where a.id = p_attempt_id;
  if v_attempt.id is null then
    raise exception 'Attempt not found.';
  end if;
  if v_attempt.user_id <> auth.uid() then
    raise exception 'Not your attempt.';
  end if;
  if v_attempt.submitted_at is not null then
    raise exception 'Attempt already submitted.';
  end if;

  select e.module into v_module from public.mock_exams e where e.id = v_attempt.exam_id;
  select h.due_date into v_due from public.homeworks h where h.id = v_attempt.homework_id;

  if v_attempt.deadline_at is not null and now() > v_attempt.deadline_at + interval '2 minutes' then
    v_answers := coalesce(v_attempt.draft_answers->'answers', '{}'::jsonb);
  else
    select coalesce(jsonb_object_agg(elem ->> 'question_id', elem -> 'answer'), '{}'::jsonb)
      into v_answers
      from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) as elem
     where elem ->> 'question_id' is not null;
  end if;

  for q in
    select mq.id, mq.type, mq.correct_answer, mq.accepted_answers, mq.points, mq.options, g.word_limit
      from public.mock_questions mq
      join public.mock_sections s on s.id = mq.section_id
      left join public.mock_question_groups g on g.id = mq.group_id
     where s.exam_id = v_attempt.exam_id
     order by s.order_index, mq.order_index
  loop
    v_given := v_answers ->> q.id::text;
    if q.type = 'multi_select' then
      v_marks := least(q.points, public.mock_multi_select_marks(v_given, q.correct_answer, q.options));
      v_correct := v_marks >= q.points;
    else
      v_correct := public.mock_answer_is_correct(v_given, q.correct_answer, q.accepted_answers, q.word_limit);
      v_marks := case when v_correct then q.points else 0 end;
    end if;

    v_total := v_total + v_marks;
    v_max := v_max + q.points;
    v_results := v_results || jsonb_build_object(
      'question_id', q.id,
      'answer', coalesce(v_given, ''),
      'correct_answer', q.correct_answer,
      'is_correct', v_correct,
      'marks', v_marks,
      'points', q.points
    );
  end loop;

  v_band := case when v_max = 40 then public.ielts_band_from_raw(v_module, v_total) else null end;

  perform set_config('app.homework_grading', 'on', true);
  update public.homework_attempts a
     set submitted_at = now(),
         score = v_total,
         max_score = v_max,
         band = v_band,
         results = v_results,
         late = (v_due is not null and now() > v_due),
         draft_answers = jsonb_set(coalesce(a.draft_answers, '{}'::jsonb), '{answers}', v_answers)
   where a.id = p_attempt_id;
  perform set_config('app.homework_grading', 'off', true);

  return query select v_total, v_max, v_band, v_results;
end;
$function$;

revoke all on function public.submit_homework_attempt(uuid, jsonb) from public, anon;
grant execute on function public.submit_homework_attempt(uuid, jsonb) to authenticated;

-- Realtime for the teacher's grade grid.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'homework_attempts'
  ) then
    alter publication supabase_realtime add table public.homework_attempts;
  end if;
end $$;

notify pgrst, 'reload schema';
