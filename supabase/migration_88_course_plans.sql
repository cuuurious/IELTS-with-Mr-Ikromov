-- migration_88_course_plans.sql (2026-11-02)
--
-- Course plans and automatic homework.
--
--   course_plans    a course (e.g. Foundation, 3 months) — lessons numbered 1..N.
--   plan_lessons    one lesson: title, goal, slides for self-study, teacher's
--                   class materials, and the homework (text + in-site tasks).
--   group_courses   which plan a group follows: start date, lesson days,
--                   start/end time (Tashkent), holidays.
--   group_lessons   the group's real lessons with dates; when a lesson ends,
--                   post_due_lessons() (every 5 minutes) posts its homework,
--                   due at the start of the next lesson.
--
-- Changing a plan later changes every lesson not yet posted, in every
-- group (a group can still change one lesson for itself: "override").
--
-- Needs migrations 84 and 85. Safe to run more than once.

-- ---------------------------------------------------------------
-- 1. Plans and lessons
-- ---------------------------------------------------------------
create table if not exists public.course_plans (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  weeks integer,
  next_plan_id uuid references public.course_plans(id) on delete set null,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.plan_lessons (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.course_plans(id) on delete cascade,
  number integer not null check (number > 0),
  title text not null default '',
  goal text not null default '',
  slides_url text,
  slides_name text,
  materials jsonb not null default '[]'::jsonb,       -- [{name, url}] for the teacher in class
  homework_title text not null default '',
  homework_text text not null default '',
  tasks jsonb not null default '[]'::jsonb,           -- [{kind, exam_id, wordlist_id, html_url, title, shadowing_clip_id}]
  upload_types text[] not null default array['image']::text[],
  min_files integer not null default 0,
  enable_speaking boolean not null default false,
  ai_eval boolean not null default false,
  created_at timestamptz not null default now(),
  constraint plan_lessons_number_unique unique (plan_id, number)
);

-- ---------------------------------------------------------------
-- 2. A group's course and its lessons
-- ---------------------------------------------------------------
create table if not exists public.group_courses (
  group_id uuid primary key references public.groups(id) on delete cascade,
  plan_id uuid not null references public.course_plans(id) on delete restrict,
  start_date date not null,
  days smallint[] not null default array[1,3,5]::smallint[],   -- 1 = Monday … 7 = Sunday
  start_time time not null default '15:00',
  end_time time not null default '16:30',
  first_lesson integer not null default 1,
  holidays date[] not null default '{}'::date[],
  auto_post boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.group_lessons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null references public.course_plans(id) on delete cascade,
  number integer not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'posted', 'skipped')),
  homework_id uuid references public.homeworks(id) on delete set null,
  posted_at timestamptz,
  override jsonb,                                  -- this group's own changes to the lesson
  created_at timestamptz not null default now(),
  constraint group_lessons_unique unique (group_id, plan_id, number)
);
create index if not exists group_lessons_due_idx on public.group_lessons (status, ends_at);
create index if not exists group_lessons_group_idx on public.group_lessons (group_id, starts_at);

alter table public.homeworks add column if not exists group_lesson_id uuid references public.group_lessons(id) on delete set null;

alter table public.course_plans enable row level security;
alter table public.plan_lessons enable row level security;
alter table public.group_courses enable row level security;
alter table public.group_lessons enable row level security;

drop policy if exists course_plans_teacher on public.course_plans;
create policy course_plans_teacher on public.course_plans for all using ((select public.is_teacher())) with check ((select public.is_teacher()));
drop policy if exists course_plans_member_read on public.course_plans;
create policy course_plans_member_read on public.course_plans for select using (
  exists (select 1 from public.group_courses gc where gc.plan_id = course_plans.id and public.is_group_member(gc.group_id))
);

drop policy if exists plan_lessons_teacher on public.plan_lessons;
create policy plan_lessons_teacher on public.plan_lessons for all using ((select public.is_teacher())) with check ((select public.is_teacher()));

drop policy if exists group_courses_teacher on public.group_courses;
create policy group_courses_teacher on public.group_courses for all using ((select public.is_teacher())) with check ((select public.is_teacher()));
drop policy if exists group_courses_member_read on public.group_courses;
create policy group_courses_member_read on public.group_courses for select using (public.is_group_member(group_id));

drop policy if exists group_lessons_teacher on public.group_lessons;
create policy group_lessons_teacher on public.group_lessons for all using ((select public.is_teacher())) with check ((select public.is_teacher()));
drop policy if exists group_lessons_member_read on public.group_lessons;
create policy group_lessons_member_read on public.group_lessons for select using (public.is_group_member(group_id));

-- Students see the lessons their group has already had (title, goal,
-- slides) — never the teacher's class materials or future homework.
create or replace function public.my_course_lessons(p_group_id uuid)
returns table(number integer, total integer, plan_title text, title text, goal text, slides_url text, slides_name text, starts_at timestamptz, status text)
language sql
stable
security definer
set search_path = public
as $function$
  select gl.number,
         (select count(*)::integer from public.plan_lessons x where x.plan_id = gl.plan_id),
         cp.title,
         coalesce(gl.override->>'title', pl.title),
         coalesce(gl.override->>'goal', pl.goal),
         coalesce(gl.override->>'slides_url', pl.slides_url),
         coalesce(gl.override->>'slides_name', pl.slides_name),
         gl.starts_at,
         gl.status
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

-- ---------------------------------------------------------------
-- 3. Working out the dates
-- ---------------------------------------------------------------
-- (Re)dates every lesson of the group's course that hasn't been posted:
-- lesson days and times, skipping holidays, never before a lesson that
-- was already posted. Adds lesson rows for new plan lessons too.
create or replace function public.schedule_group_course(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  gc public.group_courses%rowtype;
  v_day date;
  v_last timestamptz;
  v_n integer;
  v_total integer;
  v_count integer := 0;
  v_start timestamptz;
  v_end timestamptz;
  v_guard integer := 0;
begin
  if not public.is_teacher() and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Teachers only.';
  end if;
  select * into gc from public.group_courses where group_id = p_group_id;
  if gc.group_id is null then
    return 0;
  end if;

  -- Lessons of another plan that never happened go away.
  delete from public.group_lessons
   where group_id = p_group_id and plan_id <> gc.plan_id and status = 'planned';

  select max(number) into v_total from public.plan_lessons where plan_id = gc.plan_id;
  if v_total is null then
    return 0;
  end if;

  -- Start after the last lesson that already happened (posted/skipped).
  select max(starts_at) into v_last from public.group_lessons
   where group_id = p_group_id and plan_id = gc.plan_id and status <> 'planned';
  select coalesce(max(number) + 1, gc.first_lesson) into v_n from public.group_lessons
   where group_id = p_group_id and plan_id = gc.plan_id and status <> 'planned';

  v_day := greatest(gc.start_date, coalesce((v_last at time zone 'Asia/Tashkent')::date + 1, gc.start_date));

  while v_n <= v_total and v_guard < 2000 loop
    v_guard := v_guard + 1;
    if extract(isodow from v_day)::smallint = any(gc.days) and not (v_day = any(gc.holidays)) then
      v_start := (v_day + gc.start_time) at time zone 'Asia/Tashkent';
      v_end := (v_day + gc.end_time) at time zone 'Asia/Tashkent';
      if v_end <= v_start then
        v_end := v_start + interval '90 minutes';
      end if;
      insert into public.group_lessons (group_id, plan_id, number, starts_at, ends_at, status)
      values (p_group_id, gc.plan_id, v_n, v_start, v_end, 'planned')
      on conflict (group_id, plan_id, number) do update
        set starts_at = excluded.starts_at, ends_at = excluded.ends_at
        where public.group_lessons.status = 'planned';
      v_count := v_count + 1;
      v_n := v_n + 1;
    end if;
    v_day := v_day + 1;
  end loop;

  -- Lessons removed from the plan.
  delete from public.group_lessons
   where group_id = p_group_id and plan_id = gc.plan_id and status = 'planned' and number > v_total;
  return v_count;
end;
$function$;
revoke all on function public.schedule_group_course(uuid) from public, anon;
grant execute on function public.schedule_group_course(uuid) to authenticated;

-- A holiday / missed day: that lesson and every later one move to the
-- next lesson day.
create or replace function public.postpone_group_lesson(p_group_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  gl public.group_lessons%rowtype;
begin
  if not public.is_teacher() then
    raise exception 'Teachers only.';
  end if;
  select * into gl from public.group_lessons where id = p_group_lesson_id;
  if gl.id is null or gl.status <> 'planned' then
    raise exception 'Only a lesson that has not happened yet can be moved.';
  end if;
  update public.group_courses
     set holidays = array(select distinct unnest(holidays || array[(gl.starts_at at time zone 'Asia/Tashkent')::date])),
         updated_at = now()
   where group_id = gl.group_id;
  perform public.schedule_group_course(gl.group_id);
end;
$function$;
revoke all on function public.postpone_group_lesson(uuid) from public, anon;
grant execute on function public.postpone_group_lesson(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 4. Posting the homework
-- ---------------------------------------------------------------
-- Posts one lesson's homework now (used by the 5-minute job and by
-- "Post now"). Returns the new homework id.
create or replace function public.post_group_lesson(p_group_lesson_id uuid, p_force boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  gl public.group_lessons%rowtype;
  pl public.plan_lessons%rowtype;
  cp public.course_plans%rowtype;
  ov jsonb;
  v_due timestamptz;
  v_hw uuid;
  v_title text;
  v_text text;
  v_tasks jsonb;
  v_total integer;
  t jsonb;
  i integer := 0;
  v_secret text;
begin
  if not public.is_teacher() and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Teachers only.';
  end if;
  select * into gl from public.group_lessons where id = p_group_lesson_id for update;
  if gl.id is null then
    raise exception 'Lesson not found.';
  end if;
  if gl.homework_id is not null and not p_force then
    return gl.homework_id;
  end if;
  select * into pl from public.plan_lessons where plan_id = gl.plan_id and number = gl.number;
  select * into cp from public.course_plans where id = gl.plan_id;
  select count(*) into v_total from public.plan_lessons where plan_id = gl.plan_id;
  ov := coalesce(gl.override, '{}'::jsonb);

  v_title := coalesce(nullif(ov->>'homework_title', ''), nullif(pl.homework_title, ''), coalesce(ov->>'title', pl.title));
  v_text := coalesce(ov->>'homework_text', pl.homework_text, '');
  v_tasks := coalesce(ov->'tasks', pl.tasks, '[]'::jsonb);

  -- Nothing to post for this lesson.
  if coalesce(trim(v_title), '') = '' and coalesce(trim(v_text), '') = '' and jsonb_array_length(v_tasks) = 0 then
    update public.group_lessons set status = 'posted', posted_at = now() where id = gl.id;
    return null;
  end if;

  -- Due at the start of the next lesson (or two days later if none).
  select min(starts_at) into v_due from public.group_lessons
   where group_id = gl.group_id and starts_at > gl.starts_at and status = 'planned';
  v_due := coalesce(v_due, gl.ends_at + interval '2 days');

  insert into public.homeworks (
    group_id, title, description, created_by, due_date, homework_type,
    allowed_submission_types, min_submission_files, max_submission_files,
    enable_speaking, ai_eval_enabled, lesson_number, lesson_date, group_lesson_id
  ) values (
    gl.group_id,
    cp.title || ' · Lesson ' || gl.number || ': ' || coalesce(nullif(v_title, ''), 'Homework'),
    nullif(v_text, ''),
    cp.created_by,
    v_due,
    'standard',
    coalesce(pl.upload_types, array['image']::text[]),
    case when jsonb_array_length(v_tasks) > 0 then coalesce(pl.min_files, 0) else greatest(coalesce(pl.min_files, 1), 1) end,
    10,
    coalesce(pl.enable_speaking, false),
    coalesce(pl.ai_eval, false),
    gl.number,
    (gl.starts_at at time zone 'Asia/Tashkent')::date,
    gl.id
  ) returning id into v_hw;

  -- Slides go with the homework so a student who missed the lesson can study.
  if coalesce(ov->>'slides_url', pl.slides_url) is not null then
    insert into public.homework_attachments (homework_id, url, name, sort_order)
    values (v_hw, coalesce(ov->>'slides_url', pl.slides_url), coalesce(ov->>'slides_name', pl.slides_name, 'Lesson ' || gl.number || ' slides'), 0);
  end if;

  for t in select * from jsonb_array_elements(v_tasks) loop
    insert into public.homework_tasks (homework_id, position, kind, exam_id, wordlist_id, html_url, title, shadowing_clip_id)
    values (
      v_hw, i, t->>'kind',
      nullif(t->>'exam_id', '')::uuid,
      nullif(t->>'wordlist_id', '')::uuid,
      nullif(t->>'html_url', ''),
      nullif(t->>'title', ''),
      nullif(t->>'shadowing_clip_id', '')::uuid
    );
    -- A word list from the plan becomes this group's list too.
    if t->>'kind' = 'wordlist' and nullif(t->>'wordlist_id', '') is not null then
      insert into public.wordlist_groups (wordlist_id, group_id)
      select (t->>'wordlist_id')::uuid, gl.group_id
       where not exists (select 1 from public.wordlist_groups w where w.wordlist_id = (t->>'wordlist_id')::uuid and w.group_id = gl.group_id);
    end if;
    i := i + 1;
  end loop;

  update public.group_lessons set status = 'posted', posted_at = now(), homework_id = v_hw where id = gl.id;

  -- Tell the students (bell, phone, Telegram).
  insert into public.notifications (user_id, type, title, body, link)
  select gm.student_id, 'homework', 'New homework', cp.title || ' · Lesson ' || gl.number || ': ' || coalesce(nullif(v_title, ''), 'Homework'), '/app'
    from public.group_members gm
    join public.profiles p on p.id = gm.student_id and p.status = 'approved'
   where gm.group_id = gl.group_id;

  -- Post it in the group's Telegram chat too (if linked).
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_telegram_secret';
    if v_secret is not null then
      perform net.http_post(
        url := 'https://grdfwleehlgoooizyowz.supabase.co/functions/v1/telegram-group-post',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
        body := jsonb_build_object('action', 'post', 'homework_id', v_hw),
        timeout_milliseconds := 10000
      );
    end if;
  exception when others then
    raise warning 'telegram-group-post call failed: %', sqlerrm;
  end;

  return v_hw;
end;
$function$;
revoke all on function public.post_group_lesson(uuid, boolean) from public, anon;
grant execute on function public.post_group_lesson(uuid, boolean) to authenticated;

-- Every 5 minutes: post the homework of every lesson that has just ended.
create or replace function public.post_due_lessons()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record;
  n integer := 0;
begin
  for r in
    select gl.id
      from public.group_lessons gl
      join public.group_courses gc on gc.group_id = gl.group_id and gc.plan_id = gl.plan_id
     where gl.status = 'planned'
       and gc.auto_post
       and gl.ends_at <= now()
       and gl.ends_at > now() - interval '2 days'
     order by gl.ends_at
     limit 50
  loop
    begin
      perform public.post_group_lesson(r.id, false);
      n := n + 1;
    exception when others then
      raise warning 'post_group_lesson % failed: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$function$;
revoke all on function public.post_due_lessons() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'post-lesson-homework') then
    perform cron.unschedule('post-lesson-homework');
  end if;
  perform cron.schedule('post-lesson-homework', '*/5 * * * *', 'select public.post_due_lessons()');
end $$;

-- Next lesson of a group (for the "Next lesson" deadline button).
create or replace function public.next_group_lesson(p_group_id uuid)
returns table(starts_at timestamptz, number integer)
language sql
stable
security definer
set search_path = public
as $function$
  select gl.starts_at, gl.number from public.group_lessons gl
   where gl.group_id = p_group_id and gl.status = 'planned' and gl.starts_at > now()
     and (public.is_teacher() or public.is_group_member(p_group_id))
   order by gl.starts_at limit 1;
$function$;
revoke all on function public.next_group_lesson(uuid) from public, anon;
grant execute on function public.next_group_lesson(uuid) to authenticated;

grant select, insert, update, delete on public.course_plans, public.plan_lessons, public.group_courses, public.group_lessons to authenticated;

notify pgrst, 'reload schema';
