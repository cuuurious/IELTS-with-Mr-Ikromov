-- migration_115_site_homework_auto_done.sql (2026-11-07)
-- Homework with tasks in the site needs no screenshots or pictures:
--   * finishing every task marks the homework DONE right away — done by
--     the database itself, so it works on every phone and browser;
--   * old homework that still asked for pictures but has site tasks
--     stops asking (min files = 0);
--   * students who already finished every task of such a homework, but
--     were stuck because pictures were required, are marked done now
--     (at the time they finished the last task).
-- Coins and the leaderboard follow automatically (their own triggers).
-- Safe to run more than once.

set lock_timeout = '8s';

-- 1. Old homework with site tasks: no pictures needed.
update public.homeworks h
   set min_submission_files = 0
 where h.min_submission_files > 0
   and exists (select 1 from public.homework_tasks t where t.homework_id = h.id);

-- 2. From now on: the last task finished → homework done.
create or replace function public.site_homework_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_hw public.homeworks%rowtype;
  v_hw_id uuid;
begin
  if new.submitted_at is null or new.task_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.submitted_at is not null then
    return new;
  end if;

  select t.homework_id into v_hw_id from public.homework_tasks t where t.id = new.task_id;
  if v_hw_id is null then
    return new;
  end if;
  select * into v_hw from public.homeworks where id = v_hw_id;
  -- Writing mocks and the old "record your speaking" homework keep their own hand-in.
  if v_hw.id is null or coalesce(v_hw.enable_speaking, false) or coalesce(v_hw.homework_type, 'standard') <> 'standard' then
    return new;
  end if;

  -- Every task of this homework handed in at least once?
  if exists (
    select 1 from public.homework_tasks t
     where t.homework_id = v_hw.id
       and not exists (
         select 1 from public.homework_attempts a
          where a.task_id = t.id and a.user_id = new.user_id and a.submitted_at is not null
       )
  ) then
    return new;
  end if;

  insert into public.submissions (homework_id, student_id, group_id, status, submitted_at)
  values (v_hw.id, new.user_id, v_hw.group_id, 'done', new.submitted_at)
  on conflict (homework_id, student_id) do update
    set status = 'done',
        submitted_at = coalesce(public.submissions.submitted_at, excluded.submitted_at),
        updated_at = now()
    where public.submissions.status is distinct from 'done';
  return new;
end;
$function$;

drop trigger if exists trg_site_homework_done on public.homework_attempts;
create trigger trg_site_homework_done
  after insert or update of submitted_at on public.homework_attempts
  for each row execute function public.site_homework_done();

-- 3. Catch up: students who already finished every task.
with need as (
  select h.id as homework_id, h.group_id, a.user_id, max(a.submitted_at) as last_at
    from public.homeworks h
    join public.homework_tasks t on t.homework_id = h.id
    join public.homework_attempts a on a.task_id = t.id and a.submitted_at is not null
   where not coalesce(h.enable_speaking, false)
     and coalesce(h.homework_type, 'standard') = 'standard'
   group by h.id, h.group_id, a.user_id
  having count(distinct a.task_id) = (select count(*) from public.homework_tasks t2 where t2.homework_id = h.id)
)
insert into public.submissions (homework_id, student_id, group_id, status, submitted_at)
select n.homework_id, n.user_id, n.group_id, 'done', n.last_at from need n
on conflict (homework_id, student_id) do update
  set status = 'done',
      submitted_at = coalesce(public.submissions.submitted_at, excluded.submitted_at),
      updated_at = now()
  where public.submissions.status is distinct from 'done';

-- Check: homework with site tasks that still ask for pictures (expect 0),
-- and students who finished every task but are not marked done (expect 0).
select
  (select count(*) from public.homeworks h
    where h.min_submission_files > 0
      and exists (select 1 from public.homework_tasks t where t.homework_id = h.id)) as still_asking_for_pictures,
  (select count(*) from (
     select h.id, a.user_id
       from public.homeworks h
       join public.homework_tasks t on t.homework_id = h.id
       join public.homework_attempts a on a.task_id = t.id and a.submitted_at is not null
      where not coalesce(h.enable_speaking, false) and coalesce(h.homework_type, 'standard') = 'standard'
      group by h.id, a.user_id
     having count(distinct a.task_id) = (select count(*) from public.homework_tasks t2 where t2.homework_id = h.id)
   ) x
   where not exists (select 1 from public.submissions s where s.homework_id = x.id and s.student_id = x.user_id and s.status = 'done')
  ) as finished_but_not_done;
