-- migration_132_lesson_dashboard_recap.sql (2026-11-17)
-- Needs migration_131. Safe to run more than once.
--
-- 1. lesson_materials(): the files used in a lesson, for students of a
--    group whose lesson is open (opened by the teacher or already started).
-- 2. "Ask for the next lesson": a student who has finished every opened
--    homework asks for the next locked lesson; the teacher gets a
--    notification and a badge on that lesson, and opens it if he wants.
-- 3. my_recap(): this student's weekly "do this again" list from the
--    marks of their in-site homework tasks.
-- 4. group_repractice(): for the teacher, who practised old homework again.
-- 5. Coins for practising a task again (small, capped per week).

set lock_timeout = '8s';

-- ---------------------------------------------------------------
-- 1. Materials used in a lesson
-- ---------------------------------------------------------------
create or replace function public.lesson_materials(p_group_id uuid, p_number integer)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
           'goal', coalesce(nullif(gl.override->>'goal', ''), pl.goal, ''),
           'slides_url', coalesce(nullif(gl.override->>'slides_url', ''), pl.slides_url),
           'slides_name', coalesce(nullif(gl.override->>'slides_name', ''), pl.slides_name),
           'materials', coalesce(pl.materials, '[]'::jsonb)
         )
    from public.group_lessons gl
    left join public.plan_lessons pl on pl.plan_id = gl.plan_id and pl.number = gl.number
   where gl.group_id = p_group_id
     and gl.number = p_number
     and (
       public.is_teacher()
       or (public.is_group_member(p_group_id) and (gl.starts_at <= now() or gl.status = 'posted'))
     );
$function$;
revoke all on function public.lesson_materials(uuid, integer) from public, anon;
grant execute on function public.lesson_materials(uuid, integer) to authenticated;

-- ---------------------------------------------------------------
-- 2. Asking for the next lesson
-- ---------------------------------------------------------------
create table if not exists public.lesson_requests (
  group_lesson_id uuid not null references public.group_lessons(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_lesson_id, student_id)
);
alter table public.lesson_requests enable row level security;
drop policy if exists lesson_requests_teacher on public.lesson_requests;
create policy lesson_requests_teacher on public.lesson_requests
  for all to authenticated using ((select public.is_teacher())) with check ((select public.is_teacher()));

create or replace function public.request_next_lesson(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_open integer;
  v_gl public.group_lessons%rowtype;
  v_name text;
begin
  if v_uid is null or not public.is_group_member(p_group_id) then
    raise exception 'Not in this group.';
  end if;

  -- Every opened lesson homework must be handed in first.
  select count(*) into v_open
    from public.homeworks h
    join public.group_lessons g on g.id = h.group_lesson_id and g.group_id = p_group_id
   where h.group_id = p_group_id
     and not exists (
       select 1 from public.submissions s
        where s.homework_id = h.id and s.student_id = v_uid and s.status = 'done'
     );
  if v_open > 0 then
    return jsonb_build_object('ok', false, 'reason', 'unfinished', 'count', v_open);
  end if;

  select * into v_gl from public.group_lessons
   where group_id = p_group_id and status = 'planned'
   order by number limit 1;
  if v_gl.id is null then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;

  insert into public.lesson_requests (group_lesson_id, student_id)
  values (v_gl.id, v_uid)
  on conflict do nothing;

  if found then
    select coalesce(nullif(full_name, ''), username) into v_name from public.profiles where id = v_uid;
    insert into public.notifications (user_id, type, title, body, link)
    select p.id, 'homework', 'Asking for the next lesson',
           coalesce(v_name, 'A student') || ' finished all homework and asks to open Lesson ' || v_gl.number,
           '/app'
      from public.profiles p
     where p.role = 'teacher' and p.status = 'approved';
  end if;

  return jsonb_build_object('ok', true, 'number', v_gl.number);
end;
$function$;
revoke all on function public.request_next_lesson(uuid) from public, anon;
grant execute on function public.request_next_lesson(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 3. Weekly "do this again" list for a student
-- ---------------------------------------------------------------
create or replace function public.my_recap(p_group_id uuid)
returns table(kind text, lesson_number integer, plan_id uuid, task_id uuid, homework_id uuid, title text, pct integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with best as (
    select t.id as task_id, t.homework_id, gl.number as lesson_number, gl.plan_id,
           coalesce(nullif(t.title, ''), t.kind) as title,
           max(round(100.0 * a.score / a.max_score))::integer as pct
      from public.homework_attempts a
      join public.homework_tasks t on t.id = a.task_id
      join public.homeworks h on h.id = t.homework_id and h.group_id = p_group_id
      join public.group_lessons gl on gl.id = h.group_lesson_id
     where a.user_id = auth.uid()
       and a.submitted_at is not null
       and a.max_score > 0 and a.score is not null
       and public.is_group_member(p_group_id)
     group by t.id, t.homework_id, gl.number, gl.plan_id, t.title, t.kind
  ),
  weak as (select * from best where pct < 70),
  lessons as (
    select 'lesson'::text as kind, b.lesson_number, b.plan_id, null::uuid as task_id, null::uuid as homework_id,
           'Recap Lesson ' || b.lesson_number as title,
           round(avg(b.pct))::integer as pct
      from best b
     group by b.lesson_number, b.plan_id
    having count(*) filter (where b.pct < 70) >= 2 or avg(b.pct) < 60
     order by avg(b.pct) limit 3
  ),
  tasks as (
    select 'task'::text, w.lesson_number, w.plan_id, w.task_id, w.homework_id, w.title, w.pct
      from weak w order by w.pct, w.lesson_number desc limit 6
  )
  select * from lessons
  union all
  select * from tasks;
$function$;
revoke all on function public.my_recap(uuid) from public, anon;
grant execute on function public.my_recap(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 4. For the teacher: who practised old homework again
-- ---------------------------------------------------------------
create or replace function public.group_repractice(p_group_id uuid, p_days integer default 7)
returns table(student_id uuid, full_name text, repeats integer, tasks integer, improved integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_teacher() then
    raise exception 'Teachers only.';
  end if;
  return query
    select a.user_id,
           coalesce(nullif(p.full_name, ''), p.username),
           count(*)::integer,
           count(distinct a.task_id)::integer,
           count(*) filter (
             where a.score is not null and a.max_score > 0 and exists (
               select 1 from public.homework_attempts f
                where f.task_id = a.task_id and f.user_id = a.user_id and f.attempt_no = 1
                  and f.max_score > 0 and f.score is not null
                  and a.score::numeric / a.max_score > f.score::numeric / f.max_score
             )
           )::integer
      from public.homework_attempts a
      join public.homeworks h on h.id = a.homework_id and h.group_id = p_group_id
      join public.profiles p on p.id = a.user_id
     where a.attempt_no > 1
       and a.submitted_at is not null
       and a.submitted_at >= now() - make_interval(days => greatest(p_days, 1))
     group by a.user_id, p.full_name, p.username
     order by count(*) desc;
end;
$function$;
revoke all on function public.group_repractice(uuid, integer) from public, anon;
grant execute on function public.group_repractice(uuid, integer) to authenticated;

-- ---------------------------------------------------------------
-- 5. Coins for practising a task again (small, capped per week)
-- ---------------------------------------------------------------
alter table public.coin_settings add column if not exists repractice_coins integer not null default 1;
alter table public.coin_settings add column if not exists repractice_weekly_cap integer not null default 5;

create or replace function public.coins_for_repractice()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.coin_settings%rowtype;
  v_best numeric;
  v_week integer;
  v_title text;
  v_week_start timestamptz;
begin
  if new.submitted_at is null or old.submitted_at is not null then
    return new;
  end if;
  if coalesce(new.attempt_no, 1) <= 1 or new.score is null or coalesce(new.max_score, 0) <= 0 then
    return new;
  end if;

  select * into s from public.coin_settings where id = 1;
  if coalesce(s.repractice_coins, 0) <= 0 then
    return new;
  end if;

  -- Only when this try is not worse than the best earlier one.
  select max(a.score::numeric / a.max_score) into v_best
    from public.homework_attempts a
   where a.task_id = new.task_id and a.user_id = new.user_id and a.id <> new.id
     and a.submitted_at is not null and a.max_score > 0 and a.score is not null;
  if v_best is null or new.score::numeric / new.max_score < v_best then
    return new;
  end if;

  -- Weekly cap (week starts Monday, Tashkent time).
  v_week_start := date_trunc('week', now() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent';
  select coalesce(sum(amount), 0)::integer into v_week
    from public.coin_ledger
   where user_id = new.user_id and ref_type = 'repractice' and created_at >= v_week_start;
  if v_week + s.repractice_coins > coalesce(s.repractice_weekly_cap, 0) then
    return new;
  end if;

  select coalesce(nullif(t.title, ''), 'homework task') into v_title
    from public.homework_tasks t where t.id = new.task_id;

  -- One payment per task per day.
  perform public.coin_add(
    new.user_id,
    s.repractice_coins,
    'Practised again · ' || coalesce(v_title, 'homework task'),
    'repractice',
    new.task_id::text || ':' || to_char(now() at time zone 'Asia/Tashkent', 'YYYY-MM-DD')
  );
  return new;
end;
$function$;
revoke all on function public.coins_for_repractice() from public, anon, authenticated;

drop trigger if exists trg_coins_for_repractice on public.homework_attempts;
create trigger trg_coins_for_repractice
  after update of submitted_at on public.homework_attempts
  for each row execute function public.coins_for_repractice();

notify pgrst, 'reload schema';

-- Check: expect functions = 5, trigger = 1, table = 1.
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('lesson_materials', 'request_next_lesson', 'my_recap', 'group_repractice', 'coins_for_repractice')) as functions,
  (select count(*) from pg_trigger where tgname = 'trg_coins_for_repractice') as trigger,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'lesson_requests') as table;
