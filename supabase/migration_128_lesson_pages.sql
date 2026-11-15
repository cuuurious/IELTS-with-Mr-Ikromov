-- migration_128_lesson_pages.sql (2026-11-15)
-- LESSON PAGES. Every lesson in a course plan gets a page the teacher
-- builds himself: it starts empty and he drops in, pastes, or picks from
-- the Materials Library his own text, headings, pictures, files and video
-- links (plan_lessons.page, a list of blocks). He shows it on the board in
-- class; students of a group that follows the course can open the page of
-- every lesson that has started, to revise.
-- Safe to run more than once.

set lock_timeout = '8s';

alter table public.plan_lessons
  add column if not exists page jsonb not null default '[]'::jsonb;

-- One lesson's page. Teachers: any lesson. Students: only a lesson of a
-- course their group follows, and only once that lesson has started.
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
            and gl.starts_at <= now()
            and public.is_group_member(gl.group_id)
       )
     );
$function$;

revoke all on function public.lesson_page(uuid, integer) from public, anon;
grant execute on function public.lesson_page(uuid, integer) to authenticated;

-- "My course" now says which lessons have a page (has_page) and gives the
-- plan id, so the student's card can open it. The return type changes, so
-- the old function is dropped first.
drop function if exists public.my_course_lessons(uuid);
create function public.my_course_lessons(p_group_id uuid)
returns table(number integer, total integer, plan_title text, title text, goal text, slides_url text, slides_name text, starts_at timestamp with time zone, status text, plan_id uuid, has_page boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select gl.number,
         (select count(*)::integer from public.plan_lessons x where x.plan_id = gl.plan_id),
         cp.title,
         coalesce(gl.override->>'title', pl.title),
         coalesce(gl.override->>'goal', pl.goal),
         coalesce(gl.override->>'slides_url', pl.slides_url),
         coalesce(gl.override->>'slides_name', pl.slides_name),
         gl.starts_at,
         gl.status,
         gl.plan_id,
         jsonb_array_length(coalesce(pl.page, '[]'::jsonb)) > 0
    from public.group_lessons gl
    join public.course_plans cp on cp.id = gl.plan_id
    left join public.plan_lessons pl on pl.plan_id = gl.plan_id and pl.number = gl.number
   where gl.group_id = p_group_id
     and (public.is_teacher() or public.is_group_member(p_group_id))
     and gl.starts_at <= now() + interval '7 days'
   order by gl.starts_at;
$function$;

revoke all on function public.my_course_lessons(uuid) from public, anon;
grant execute on function public.my_course_lessons(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Check: expect page_column = true and functions = 2.
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plan_lessons' and column_name = 'page') as page_column,
  (select count(*) from pg_proc where proname in ('lesson_page', 'my_course_lessons') and pronamespace = 'public'::regnamespace) as functions;
