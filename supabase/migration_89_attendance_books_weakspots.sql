-- migration_89_attendance_books_weakspots.sql (2026-11-02)
--
-- 1. Attendance per numbered lesson (group_lessons from migration_88).
--    The teacher ticks who came; absent students get a "study the slides"
--    notification once.
-- 2. Books: Materials Library files can carry a skill + question type and
--    be put on the students' Books shelf (Reading/Listening only — Writing
--    and Speaking stay homework-only). Practice scores go to book_practice.
--    Homework tasks copy the question type from the library file.
-- 3. Weak spots: accuracy per question type for a student (or a whole
--    group) from mocks, homework tests, workshop pages and book practice.
--
-- Safe to run more than once.

-- ─── 1. Attendance ──────────────────────────────────────────────────────
create table if not exists public.lesson_attendance (
  group_lesson_id uuid not null references public.group_lessons(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('present', 'late', 'absent', 'excused')),
  marked_by uuid references public.profiles(id) on delete set null,
  marked_at timestamptz not null default now(),
  notified_at timestamptz,
  primary key (group_lesson_id, student_id)
);
create index if not exists lesson_attendance_student_idx on public.lesson_attendance (student_id);

alter table public.lesson_attendance enable row level security;
drop policy if exists lesson_attendance_teacher on public.lesson_attendance;
create policy lesson_attendance_teacher on public.lesson_attendance
  for all using ((select public.is_teacher())) with check ((select public.is_teacher()));
drop policy if exists lesson_attendance_own on public.lesson_attendance;
create policy lesson_attendance_own on public.lesson_attendance
  for select using (student_id = (select auth.uid()));

-- p_rows: [{ "student_id": "...", "status": "present" | "late" | "absent" | "excused" }]
create or replace function public.mark_attendance(p_group_lesson_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson record;
  v_count integer := 0;
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can mark attendance.';
  end if;

  select gl.*, cp.title as plan_title
    into v_lesson
    from public.group_lessons gl
    join public.course_plans cp on cp.id = gl.plan_id
   where gl.id = p_group_lesson_id;
  if v_lesson.id is null then
    raise exception 'Lesson not found.';
  end if;

  insert into public.lesson_attendance (group_lesson_id, student_id, status, marked_by, marked_at)
  select p_group_lesson_id, (r ->> 'student_id')::uuid, r ->> 'status', auth.uid(), now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    join public.group_members gm
      on gm.group_id = v_lesson.group_id and gm.student_id = (r ->> 'student_id')::uuid
   where r ->> 'status' in ('present', 'late', 'absent', 'excused')
  on conflict (group_lesson_id, student_id) do update
     set status = excluded.status, marked_by = excluded.marked_by, marked_at = excluded.marked_at;
  get diagnostics v_count = row_count;

  -- One "you missed it" message per student per lesson.
  with fresh as (
    update public.lesson_attendance la
       set notified_at = now()
     where la.group_lesson_id = p_group_lesson_id
       and la.status = 'absent'
       and la.notified_at is null
    returning la.student_id
  )
  insert into public.notifications (user_id, type, title, body, link)
  select f.student_id, 'attendance',
         'You missed Lesson ' || v_lesson.number,
         v_lesson.plan_title || ' · Lesson ' || v_lesson.number || ': study the slides in My course and do the homework.',
         '/app'
    from fresh f;

  return v_count;
end;
$$;
revoke all on function public.mark_attendance(uuid, jsonb) from public, anon;
grant execute on function public.mark_attendance(uuid, jsonb) to authenticated;

-- Per-student totals for a group (teacher), or the caller's own row.
create or replace function public.attendance_summary(p_group_id uuid)
returns table(student_id uuid, present integer, late integer, absent integer, excused integer, marked integer)
language sql
stable
security definer
set search_path = public
as $$
  select la.student_id,
         count(*) filter (where la.status = 'present')::int,
         count(*) filter (where la.status = 'late')::int,
         count(*) filter (where la.status = 'absent')::int,
         count(*) filter (where la.status = 'excused')::int,
         count(*)::int
    from public.lesson_attendance la
    join public.group_lessons gl on gl.id = la.group_lesson_id
   where gl.group_id = p_group_id
     and (public.is_teacher() or la.student_id = auth.uid())
   group by la.student_id;
$$;
revoke all on function public.attendance_summary(uuid) from public, anon;
grant execute on function public.attendance_summary(uuid) to authenticated;

-- ─── 2. Books shelf ─────────────────────────────────────────────────────
alter table public.materials
  add column if not exists skill text,
  add column if not exists question_type text,
  add column if not exists on_shelf boolean not null default false,
  add column if not exists shelf_order integer;

alter table public.materials drop constraint if exists materials_skill_check;
alter table public.materials
  add constraint materials_skill_check check (skill is null or skill in ('reading', 'listening'));
alter table public.materials drop constraint if exists materials_shelf_skill_check;
alter table public.materials
  add constraint materials_shelf_skill_check check (not on_shelf or skill is not null);

create index if not exists materials_shelf_idx on public.materials (skill, question_type) where on_shelf;

drop policy if exists materials_shelf_read on public.materials;
create policy materials_shelf_read on public.materials
  for select to authenticated using (on_shelf);

alter table public.homework_tasks
  add column if not exists skill text,
  add column if not exists question_type text;

-- Workshop pages picked from the library carry its question type.
create or replace function public.homework_tasks_fill_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'html' and new.html_url is not null and new.question_type is null then
    select m.skill, m.question_type into new.skill, new.question_type
      from public.materials m
     where m.url = new.html_url and m.question_type is not null
     limit 1;
  end if;
  return new;
end;
$$;
drop trigger if exists homework_tasks_fill_type on public.homework_tasks;
create trigger homework_tasks_fill_type
  before insert or update of html_url on public.homework_tasks
  for each row execute function public.homework_tasks_fill_type();

create table if not exists public.book_practice (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  score integer not null check (score >= 0),
  max_score integer not null check (max_score > 0 and max_score <= 200),
  created_at timestamptz not null default now(),
  check (score <= max_score)
);
create index if not exists book_practice_user_idx on public.book_practice (user_id, material_id);

alter table public.book_practice enable row level security;
drop policy if exists book_practice_own_read on public.book_practice;
create policy book_practice_own_read on public.book_practice
  for select using (user_id = (select auth.uid()) or (select public.is_teacher()));
drop policy if exists book_practice_own_insert on public.book_practice;
create policy book_practice_own_insert on public.book_practice
  for insert with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.materials m where m.id = material_id and m.on_shelf)
  );

-- ─── 3. Weak spots ──────────────────────────────────────────────────────
-- Same names everywhere: the question-group kinds (questionGroups.js);
-- plain mock question types without a group are mapped onto them.
create or replace function public.qtype_key(p text)
returns text
language sql
immutable
as $$
  select case p
    when 'true_false_ng' then 'tfng'
    when 'yes_no_ng' then 'ynng'
    when 'multiple_choice' then 'mcq_single'
    when 'multi_select' then 'mcq_multi'
    when 'short_answer' then 'completion'
    else coalesce(nullif(p, ''), 'other')
  end;
$$;

-- Every scored answer, one row per (user, skill, type, source item).
create or replace function public._weak_spot_rows(p_users uuid[])
returns table(user_id uuid, skill text, qtype text, correct integer, total integer, at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  -- Mock and homework-bank tests taken as mocks (released ones only for students).
  select a.user_id, e.module, coalesce(nullif(g.kind, 'other'), public.qtype_key(q.type)),
         count(*) filter (where ma.is_correct)::int, count(*)::int, max(a.submitted_at)
    from public.mock_attempts a
    join public.mock_exams e on e.id = a.exam_id and e.module in ('reading', 'listening')
    join public.mock_answers ma on ma.attempt_id = a.id
    join public.mock_questions q on q.id = ma.question_id
    left join public.mock_question_groups g on g.id = q.group_id
   where a.user_id = any(p_users) and a.submitted_at is not null
     and (a.released_at is not null or public.is_teacher())
   group by a.user_id, e.module, coalesce(nullif(g.kind, 'other'), public.qtype_key(q.type))
  union all
  -- Homework tests (results jsonb per question).
  select h.user_id, e.module, coalesce(nullif(g.kind, 'other'), public.qtype_key(q.type)),
         count(*) filter (where (r ->> 'is_correct')::boolean)::int, count(*)::int, max(h.submitted_at)
    from public.homework_attempts h
    join public.mock_exams e on e.id = h.exam_id and e.module in ('reading', 'listening')
    cross join lateral jsonb_array_elements(case when jsonb_typeof(h.results) = 'array' then h.results else '[]'::jsonb end) r
    join public.mock_questions q on q.id = (r ->> 'question_id')::uuid
    left join public.mock_question_groups g on g.id = q.group_id
   where h.user_id = any(p_users) and h.submitted_at is not null and h.exam_id is not null
   group by h.user_id, e.module, coalesce(nullif(g.kind, 'other'), public.qtype_key(q.type))
  union all
  -- Workshop pages in homework.
  select h.user_id, t.skill, t.question_type, sum(h.score)::int, sum(h.max_score)::int, max(h.submitted_at)
    from public.homework_attempts h
    join public.homework_tasks t on t.id = h.task_id
   where h.user_id = any(p_users) and h.submitted_at is not null
     and t.question_type is not null and t.skill is not null
     and h.score is not null and h.max_score > 0
   group by h.user_id, t.skill, t.question_type
  union all
  -- Books shelf practice.
  select b.user_id, m.skill, m.question_type, sum(b.score)::int, sum(b.max_score)::int, max(b.created_at)
    from public.book_practice b
    join public.materials m on m.id = b.material_id
   where b.user_id = any(p_users) and m.question_type is not null and m.skill is not null
   group by b.user_id, m.skill, m.question_type;
$$;
revoke all on function public._weak_spot_rows(uuid[]) from public, anon, authenticated;

create or replace function public.weak_spots(p_user_id uuid default null)
returns table(skill text, qtype text, correct integer, total integer, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
begin
  if v_user is null or (v_user <> auth.uid() and not public.is_teacher()) then
    raise exception 'Not allowed.';
  end if;
  return query
    select r.skill, r.qtype, sum(r.correct)::int, sum(r.total)::int, max(r.at)
      from public._weak_spot_rows(array[v_user]) r
     group by r.skill, r.qtype
     order by 1, 2;
end;
$$;
revoke all on function public.weak_spots(uuid) from public, anon;
grant execute on function public.weak_spots(uuid) to authenticated;

create or replace function public.group_weak_spots(p_group_id uuid)
returns table(skill text, qtype text, correct integer, total integer, students integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can see group weak spots.';
  end if;
  return query
    select r.skill, r.qtype, sum(r.correct)::int, sum(r.total)::int, count(distinct r.user_id)::int
      from public._weak_spot_rows(array(select gm.student_id from public.group_members gm where gm.group_id = p_group_id)) r
     group by r.skill, r.qtype
     order by 1, 2;
end;
$$;
revoke all on function public.group_weak_spots(uuid) from public, anon;
grant execute on function public.group_weak_spots(uuid) to authenticated;
