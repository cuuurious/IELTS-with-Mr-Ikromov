-- migration_85_homework_tasks_more.sql (2026-11-02)
--
-- Homework done inside the site, step 2, plus the features adopted
-- from other IELTS sites.
--
--   1. Word list, HTML workshop and shadowing tasks can be homework too
--      (homework_tasks.kind) and are marked with submit_homework_score().
--   2. shadowing_clips: audio + transcript the teacher adds; students
--      listen line by line and record themselves.
--   3. student_words: words a student taps in a passage and saves, with
--      the same 6-box spaced repetition as word lists.
--   4. marathon_results: the Daily Marathon (one try a day) and
--      marathon_board() for today's board in the student's groups.
--   5. weekly_leaderboard(): points for one week (a "season") per group.
--
-- Needs migration_84. Safe to run more than once.

-- ---------------------------------------------------------------
-- 1. More task kinds
-- ---------------------------------------------------------------
create table if not exists public.shadowing_clips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  audio_url text not null,
  transcript text not null default '',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.shadowing_clips enable row level security;

drop policy if exists shadowing_clips_teacher_all on public.shadowing_clips;
create policy shadowing_clips_teacher_all on public.shadowing_clips
  for all using ((select public.is_teacher())) with check ((select public.is_teacher()));

drop policy if exists shadowing_clips_read on public.shadowing_clips;
create policy shadowing_clips_read on public.shadowing_clips
  for select using ((select auth.role()) = 'authenticated');

alter table public.homework_tasks
  add column if not exists shadowing_clip_id uuid references public.shadowing_clips(id) on delete set null;

alter table public.homework_tasks drop constraint if exists homework_tasks_kind_check;
alter table public.homework_tasks
  add constraint homework_tasks_kind_check check (kind in ('reading', 'listening', 'wordlist', 'html', 'shadowing'));

-- Starting an attempt: tests as before (practice/exam clock); the other
-- kinds have no clock and are handed in with submit_homework_score().
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
  if v_task.kind in ('reading', 'listening') and v_task.exam_id is null then
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
  if v_task.exam_id is null then
    new.mode := 'practice';
  end if;
  new.deadline_at := case
    when new.mode = 'exam' and v_task.exam_id is not null
      then now() + make_interval(mins => public.homework_time_limit_minutes(v_task.exam_id))
    else null
  end;
  return new;
end;
$function$;

-- Hand in a word list / HTML workshop / shadowing task. The score is
-- worked out in the browser (quiz, the workshop's own checker, or the
-- shadowing match), so this only checks it is sensible and saves it as
-- a new attempt. Returns the saved attempt.
create or replace function public.submit_homework_score(
  p_task_id uuid,
  p_score integer,
  p_max integer,
  p_details jsonb default null
)
returns setof public.homework_attempts
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_task record;
  v_id uuid;
begin
  select t.*, h.group_id, h.due_date into v_task
    from public.homework_tasks t
    join public.homeworks h on h.id = t.homework_id
   where t.id = p_task_id;

  if v_task.id is null then
    raise exception 'This homework task no longer exists.';
  end if;
  if v_task.kind in ('reading', 'listening') then
    raise exception 'Tests are marked with submit_homework_attempt().';
  end if;
  if not public.is_group_member(v_task.group_id) then
    raise exception 'This homework is not for your group.';
  end if;
  if p_max is not null and (p_max < 0 or p_max > 1000) then
    raise exception 'Bad maximum score.';
  end if;
  if p_score is not null and (p_score < 0 or (p_max is not null and p_score > p_max)) then
    raise exception 'Bad score.';
  end if;

  -- Close any unfinished attempt first (one open attempt per task).
  delete from public.homework_attempts
   where task_id = p_task_id and user_id = auth.uid() and submitted_at is null;

  insert into public.homework_attempts (task_id, user_id, mode)
  values (p_task_id, auth.uid(), 'practice')
  returning id into v_id;

  perform set_config('app.homework_grading', 'on', true);
  update public.homework_attempts a
     set submitted_at = now(),
         score = p_score,
         max_score = p_max,
         results = p_details,
         late = (v_task.due_date is not null and now() > v_task.due_date)
   where a.id = v_id;
  perform set_config('app.homework_grading', 'off', true);

  return query select * from public.homework_attempts where id = v_id;
end;
$function$;

revoke all on function public.submit_homework_score(uuid, integer, integer, jsonb) from public, anon;
grant execute on function public.submit_homework_score(uuid, integer, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------
-- 2. Words a student saves from a passage ("tap a word")
-- ---------------------------------------------------------------
create table if not exists public.student_words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  word text not null,
  definition text,
  uzbek_translation text,
  example_sentence text,
  source text,
  box smallint not null default 0,
  due_at timestamptz not null default now(),
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- Words are saved in lower case, so a plain (user_id, word) key is enough.
create unique index if not exists student_words_user_word_idx on public.student_words (user_id, word);
create index if not exists student_words_due_idx on public.student_words (user_id, due_at);

alter table public.student_words enable row level security;

drop policy if exists student_words_own on public.student_words;
create policy student_words_own on public.student_words
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists student_words_teacher_read on public.student_words;
create policy student_words_teacher_read on public.student_words
  for select using ((select public.is_teacher()));

-- Move a saved word between boxes after a review answer (same intervals
-- as word lists: again today, 1, 3, 7, 14, 30 days).
create or replace function public.review_student_word(p_word_id uuid, p_correct boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_box smallint;
begin
  select box into v_box from public.student_words where id = p_word_id and user_id = auth.uid();
  if v_box is null then
    return;
  end if;
  v_box := case when p_correct then least(5, v_box + 1) else 0 end;
  update public.student_words
     set box = v_box,
         due_at = now() + case v_box
           when 0 then interval '0'
           when 1 then interval '1 day'
           when 2 then interval '3 days'
           when 3 then interval '7 days'
           when 4 then interval '14 days'
           else interval '30 days' end,
         correct_count = correct_count + case when p_correct then 1 else 0 end,
         wrong_count = wrong_count + case when p_correct then 0 else 1 end
   where id = p_word_id and user_id = auth.uid();
end;
$function$;

revoke all on function public.review_student_word(uuid, boolean) from public, anon;
grant execute on function public.review_student_word(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------
-- 3. Daily Marathon
-- ---------------------------------------------------------------
create table if not exists public.marathon_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  day date not null default ((now() at time zone 'Asia/Tashkent')::date),
  score integer not null check (score >= 0),
  total integer not null check (total > 0 and total <= 100),
  seconds integer not null default 0 check (seconds >= 0),
  created_at timestamptz not null default now(),
  constraint marathon_score_le_total check (score <= total)
);

create unique index if not exists marathon_results_user_day_idx on public.marathon_results (user_id, day);
create index if not exists marathon_results_day_idx on public.marathon_results (day);

alter table public.marathon_results enable row level security;

drop policy if exists marathon_results_read on public.marathon_results;
create policy marathon_results_read on public.marathon_results
  for select using (user_id = (select auth.uid()) or (select public.is_teacher()));

drop policy if exists marathon_results_insert_own on public.marathon_results;
create policy marathon_results_insert_own on public.marathon_results
  for insert with check (
    user_id = (select auth.uid())
    and day = ((now() at time zone 'Asia/Tashkent')::date)
  );

-- Today's (or any day's) results for everyone who shares a group with me.
create or replace function public.marathon_board(p_day date default null)
returns table(user_id uuid, full_name text, avatar_url text, score integer, total integer, seconds integer)
language sql
stable
security definer
set search_path = public
as $function$
  select m.user_id, p.full_name, p.avatar_url, m.score, m.total, m.seconds
    from public.marathon_results m
    join public.profiles p on p.id = m.user_id
   where m.day = coalesce(p_day, (now() at time zone 'Asia/Tashkent')::date)
     and (
       public.is_teacher()
       or m.user_id = auth.uid()
       or exists (
         select 1
           from public.group_members a
           join public.group_members b on b.group_id = a.group_id
          where a.student_id = auth.uid() and b.student_id = m.user_id
       )
     )
   order by m.score desc, m.seconds asc
   limit 100;
$function$;

revoke all on function public.marathon_board(date) from public, anon;
grant execute on function public.marathon_board(date) to authenticated;

-- ---------------------------------------------------------------
-- 4. Weekly seasons
-- ---------------------------------------------------------------
-- Points for one week (Monday 00:00 Tashkent time to the next Monday):
--   homework handed in on time 10, late 5;
--   first try of an in-site task: its percentage / 10 (0-10);
--   Daily Marathon: one point per right answer;
--   word quizzes and reviews: one point per 10 answers, up to 20.
create or replace function public.weekly_leaderboard(p_group_id uuid, p_week_start date default null)
returns table(
  user_id uuid,
  full_name text,
  avatar_url text,
  points integer,
  homework_points integer,
  task_points integer,
  marathon_points integer,
  word_points integer
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_start date := coalesce(p_week_start, date_trunc('week', (now() at time zone 'Asia/Tashkent'))::date);
  v_from timestamptz;
  v_to timestamptz;
begin
  if not (public.is_teacher() or public.is_group_member(p_group_id)) then
    raise exception 'Not your group.';
  end if;
  v_from := (v_start::timestamp) at time zone 'Asia/Tashkent';
  v_to := ((v_start + 7)::timestamp) at time zone 'Asia/Tashkent';

  return query
  with members as (
    select gm.student_id as uid
      from public.group_members gm
     where gm.group_id = p_group_id
  ),
  hw as (
    select s.student_id as uid,
           sum(case when h.due_date is null or s.submitted_at <= h.due_date then 10 else 5 end)::integer as pts
      from public.submissions s
      join public.homeworks h on h.id = s.homework_id
     where s.status = 'done'
       and h.group_id = p_group_id
       and s.submitted_at >= v_from and s.submitted_at < v_to
     group by s.student_id
  ),
  tasks as (
    select a.user_id as uid,
           sum(case when a.max_score > 0 then round(10.0 * a.score / a.max_score) else 10 end)::integer as pts
      from public.homework_attempts a
      join public.homeworks h on h.id = a.homework_id
     where a.attempt_no = 1
       and a.submitted_at is not null
       and h.group_id = p_group_id
       and a.submitted_at >= v_from and a.submitted_at < v_to
     group by a.user_id
  ),
  mar as (
    select m.user_id as uid, sum(m.score)::integer as pts
      from public.marathon_results m
     where m.day >= v_start and m.day < v_start + 7
     group by m.user_id
  ),
  words as (
    select x.uid, least(20, floor(sum(x.n) / 10.0))::integer as pts
      from (
        select w.student_id as uid, coalesce(w.total, 0) as n
          from public.wordlist_attempts w
         where w.created_at >= v_from and w.created_at < v_to
        union all
        select r.student_id, r.total
          from public.word_review_sessions r
         where r.created_at >= v_from and r.created_at < v_to
      ) x
     group by x.uid
  )
  select m.uid,
         p.full_name,
         p.avatar_url,
         (coalesce(hw.pts, 0) + coalesce(tasks.pts, 0) + coalesce(mar.pts, 0) + coalesce(words.pts, 0))::integer,
         coalesce(hw.pts, 0)::integer,
         coalesce(tasks.pts, 0)::integer,
         coalesce(mar.pts, 0)::integer,
         coalesce(words.pts, 0)::integer
    from members m
    join public.profiles p on p.id = m.uid
    left join hw on hw.uid = m.uid
    left join tasks on tasks.uid = m.uid
    left join mar on mar.uid = m.uid
    left join words on words.uid = m.uid
   where p.role = 'student'
   order by 4 desc, p.full_name;
end;
$function$;

revoke all on function public.weekly_leaderboard(uuid, date) from public, anon;
grant execute on function public.weekly_leaderboard(uuid, date) to authenticated;

grant select, insert, update, delete on public.student_words to authenticated;
grant select, insert on public.marathon_results to authenticated;
grant select, insert, update, delete on public.shadowing_clips to authenticated;

notify pgrst, 'reload schema';
