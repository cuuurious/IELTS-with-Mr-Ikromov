-- migration_131_lesson_timeline.sql (2026-11-17)
-- "By lesson" view on the student's Homework page: every lesson of the
-- group's course with its date, its homework and whether it is open or
-- still locked. A lesson is open once the teacher has posted its homework
-- (the "Post" button on the group's course panel, or automatically at the
-- end of the lesson). Students can then open it, finish it later, and do
-- the tasks again. Safe to run more than once.

set lock_timeout = '8s';

-- 1. The whole course of a group (titles of future lessons are visible,
--    their homework and pages are not until the teacher opens them).
drop function if exists public.my_lesson_timeline(uuid);
create function public.my_lesson_timeline(p_group_id uuid)
returns table(
  number integer,
  total integer,
  plan_id uuid,
  plan_title text,
  title text,
  goal text,
  starts_at timestamptz,
  status text,
  homework_id uuid,
  has_page boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select gl.number,
         (select count(*)::integer from public.plan_lessons x where x.plan_id = gl.plan_id),
         gl.plan_id,
         cp.title,
         coalesce(nullif(gl.override->>'title', ''), pl.title, ''),
         coalesce(nullif(gl.override->>'goal', ''), pl.goal, ''),
         gl.starts_at,
         gl.status,
         case when gl.status = 'posted' then gl.homework_id else null end,
         jsonb_array_length(coalesce(pl.page, '[]'::jsonb)) > 0
    from public.group_lessons gl
    join public.course_plans cp on cp.id = gl.plan_id
    left join public.plan_lessons pl on pl.plan_id = gl.plan_id and pl.number = gl.number
   where gl.group_id = p_group_id
     and (public.is_teacher() or public.is_group_member(p_group_id))
   order by gl.number;
$function$;

revoke all on function public.my_lesson_timeline(uuid) from public, anon;
grant execute on function public.my_lesson_timeline(uuid) to authenticated;

-- 2. A lesson page also opens when the teacher opened the lesson early
--    (its homework was posted before the lesson date).
create or replace function public.lesson_page(p_plan_id uuid, p_number integer)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
           'plan_title', cp.title,
           'number', pl.number,
           'title', pl.title,
           'goal', pl.goal,
           'page', coalesce(pl.page, '[]'::jsonb)
         )
    from public.plan_lessons pl
    join public.course_plans cp on cp.id = pl.plan_id
   where pl.plan_id = p_plan_id
     and pl.number = p_number
     and (
       public.is_teacher()
       or exists (
         select 1 from public.group_lessons gl
          where gl.plan_id = p_plan_id
            and gl.number = p_number
            and (gl.starts_at <= now() or gl.status = 'posted')
            and public.is_group_member(gl.group_id)
       )
     );
$function$;

revoke all on function public.lesson_page(uuid, integer) from public, anon;
grant execute on function public.lesson_page(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

-- Check: expect functions = 2.
select count(*) as functions from pg_proc
 where proname in ('my_lesson_timeline', 'lesson_page') and pronamespace = 'public'::regnamespace;
