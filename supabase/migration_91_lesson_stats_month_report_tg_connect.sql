-- migration_91_lesson_stats_month_report_tg_connect.sql (2026-11-02)
--
-- 1. Per-lesson stats: for every numbered lesson of a group, who came,
--    who did its homework and the average in-site score.
-- 2. Monthly parent report: one month at a glance for each student
--    (attendance, homework, scores, coins, mock bands, weak and strong
--    question types, and a note from the teacher). Parents open it with
--    their existing report link; the teacher sees the whole group.
-- 3. One-tap Telegram connect: the group page makes a short-lived code
--    and opens Telegram; adding the bot to the chat links it at once.
--
-- Safe to run more than once.

-- ─── 1. Per-lesson stats ────────────────────────────────────────────────
create or replace function public.group_lesson_stats(p_group_id uuid)
returns table(group_lesson_id uuid, members integer, marked integer, came integer, absent integer,
              hw_done integer, hw_late integer, avg_pct numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can see lesson stats.';
  end if;
  return query
  with mem as (
    select gm.student_id
      from public.group_members gm
      join public.profiles p on p.id = gm.student_id and p.status = 'approved'
     where gm.group_id = p_group_id
  ),
  gl as (
    select l.id, l.homework_id
      from public.group_lessons l
     where l.group_id = p_group_id and l.starts_at <= now()
  ),
  att as (
    select la.group_lesson_id,
           count(*)::int as marked,
           count(*) filter (where la.status in ('present', 'late'))::int as came,
           count(*) filter (where la.status = 'absent')::int as absent
      from public.lesson_attendance la
     where la.group_lesson_id in (select id from gl)
     group by la.group_lesson_id
  ),
  hw as (
    select gl.id as glid,
           count(distinct m.student_id) filter (where d.done_at is not null)::int as done,
           count(distinct m.student_id) filter (where d.done_at > h.due_date)::int as late
      from gl
      join public.homeworks h on h.id = gl.homework_id
      cross join mem m
      left join lateral (
        select coalesce(
                 (select min(c.completed_at) from public.homework_completions c where c.homework_id = h.id and c.student_id = m.student_id),
                 (select s.submitted_at from public.submissions s where s.homework_id = h.id and s.student_id = m.student_id and s.status = 'done' limit 1)
               ) as done_at
      ) d on true
     group by gl.id
  ),
  sc as (
    select gl.id as glid, round(avg(100.0 * a.score / a.max_score), 0) as pct
      from gl
      join public.homework_tasks t on t.homework_id = gl.homework_id
      join public.homework_attempts a on a.task_id = t.id and a.attempt_no = 1
     where a.submitted_at is not null and a.score is not null and a.max_score > 0
     group by gl.id
  )
  select gl.id, (select count(*)::int from mem), coalesce(att.marked, 0), coalesce(att.came, 0), coalesce(att.absent, 0),
         coalesce(hw.done, 0), coalesce(hw.late, 0), sc.pct
    from gl
    left join att on att.group_lesson_id = gl.id
    left join hw on hw.glid = gl.id
    left join sc on sc.glid = gl.id;
end;
$$;
revoke all on function public.group_lesson_stats(uuid) from public, anon;
grant execute on function public.group_lesson_stats(uuid) to authenticated;

-- One lesson, student by student.
create or replace function public.lesson_student_stats(p_group_lesson_id uuid)
returns table(student_id uuid, full_name text, attendance text, hw_state text, avg_pct numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lesson record;
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can see lesson stats.';
  end if;
  select l.*, h.due_date into v_lesson
    from public.group_lessons l
    left join public.homeworks h on h.id = l.homework_id
   where l.id = p_group_lesson_id;
  if v_lesson.id is null then
    raise exception 'Lesson not found.';
  end if;
  return query
  select p.id, coalesce(nullif(p.full_name, ''), p.username, 'Student'),
         la.status,
         case
           when v_lesson.homework_id is null then null
           when d.done_at is null and v_lesson.due_date is not null and v_lesson.due_date < now() then 'missed'
           when d.done_at is null then 'open'
           when v_lesson.due_date is not null and d.done_at > v_lesson.due_date then 'late'
           else 'done'
         end,
         (select round(avg(100.0 * a.score / a.max_score), 0)
            from public.homework_tasks t
            join public.homework_attempts a on a.task_id = t.id and a.user_id = p.id and a.attempt_no = 1
           where t.homework_id = v_lesson.homework_id
             and a.submitted_at is not null and a.score is not null and a.max_score > 0)
    from public.group_members gm
    join public.profiles p on p.id = gm.student_id and p.status = 'approved'
    left join public.lesson_attendance la on la.group_lesson_id = v_lesson.id and la.student_id = p.id
    left join lateral (
      select coalesce(
               (select min(c.completed_at) from public.homework_completions c where c.homework_id = v_lesson.homework_id and c.student_id = p.id),
               (select s.submitted_at from public.submissions s where s.homework_id = v_lesson.homework_id and s.student_id = p.id and s.status = 'done' limit 1)
             ) as done_at
    ) d on true
   where gm.group_id = v_lesson.group_id
   order by 2;
end;
$$;
revoke all on function public.lesson_student_stats(uuid) from public, anon;
grant execute on function public.lesson_student_stats(uuid) to authenticated;

-- ─── 2. Monthly parent report ───────────────────────────────────────────
create table if not exists public.parent_month_notes (
  student_id uuid not null references public.profiles(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  note text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (student_id, month)
);
alter table public.parent_month_notes enable row level security;
drop policy if exists parent_month_notes_teacher on public.parent_month_notes;
create policy parent_month_notes_teacher on public.parent_month_notes
  for all using ((select public.is_teacher())) with check ((select public.is_teacher()));

-- The month that "now" is in, in Tashkent.
create or replace function public.tashkent_month(p_at timestamptz default now())
returns date
language sql
stable
as $$ select date_trunc('month', p_at at time zone 'Asia/Tashkent')::date $$;

-- Internal: one student's month as JSON. Callers check who may see it.
create or replace function public._month_report(p_student uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := (p_month::timestamp) at time zone 'Asia/Tashkent';
  v_to timestamptz := ((p_month + interval '1 month')::timestamp) at time zone 'Asia/Tashkent';
  v_out jsonb;
begin
  with my_groups as (
    select gm.group_id, gm.created_at as joined_at from public.group_members gm where gm.student_id = p_student
  ),
  att as (
    select count(*) filter (where la.status = 'present')::int as present,
           count(*) filter (where la.status = 'late')::int as late,
           count(*) filter (where la.status = 'absent')::int as absent,
           count(*) filter (where la.status = 'excused')::int as excused,
           count(*)::int as marked
      from public.lesson_attendance la
      join public.group_lessons gl on gl.id = la.group_lesson_id
     where la.student_id = p_student and gl.starts_at >= v_from and gl.starts_at < v_to
  ),
  hw_base as (
    select h.id, h.due_date,
           coalesce(
             (select min(c.completed_at) from public.homework_completions c where c.homework_id = h.id and c.student_id = p_student),
             (select s.submitted_at from public.submissions s where s.homework_id = h.id and s.student_id = p_student and s.status = 'done' limit 1)
           ) as done_at
      from public.homeworks h
      join my_groups g on g.group_id = h.group_id
     where h.created_at >= v_from and h.created_at < v_to
       and h.created_at >= g.joined_at - interval '1 day'
  ),
  hw as (
    select count(*)::int as assigned,
           count(*) filter (where done_at is not null)::int as done,
           count(*) filter (where done_at is not null and due_date is not null and done_at > due_date)::int as late,
           count(*) filter (where done_at is null and due_date is not null and due_date < now())::int as missed
      from hw_base
  ),
  sc as (
    select count(*)::int as tasks, round(avg(100.0 * a.score / a.max_score), 0) as avg_pct
      from public.homework_attempts a
     where a.user_id = p_student and a.attempt_no = 1 and a.submitted_at >= v_from and a.submitted_at < v_to
       and a.score is not null and a.max_score > 0
  ),
  spots as (
    select r.skill, r.qtype, sum(r.correct)::int as correct, sum(r.total)::int as total
      from public._weak_spot_rows(array[p_student]) r
     group by r.skill, r.qtype
    having sum(r.total) >= 5
  )
  select jsonb_build_object(
    'month', to_char(p_month, 'YYYY-MM-DD'),
    'attendance', (select to_jsonb(att) from att),
    'homework', (select to_jsonb(hw) from hw),
    'scores', (select to_jsonb(sc) from sc),
    'coins', coalesce((select sum(c.amount) from public.coin_ledger c where c.user_id = p_student and c.amount > 0 and c.created_at >= v_from and c.created_at < v_to), 0),
    'marathon_days', (select count(*) from public.marathon_results m where m.user_id = p_student and m.day >= p_month and m.day < (p_month + interval '1 month')::date),
    'mocks', coalesce((select jsonb_agg(jsonb_build_object('module', e.module, 'band', a.band, 'date', a.submitted_at) order by a.submitted_at)
                         from public.mock_attempts a join public.mock_exams e on e.id = a.exam_id
                        where a.user_id = p_student and a.band is not null and a.released_at is not null
                          and a.submitted_at >= v_from and a.submitted_at < v_to), '[]'::jsonb),
    'strong', coalesce((select jsonb_agg(x) from (select jsonb_build_object('skill', skill, 'qtype', qtype, 'pct', round(100.0 * correct / total)) as x
                                                    from spots where 1.0 * correct / total >= 0.75 order by 1.0 * correct / total desc limit 2) s), '[]'::jsonb),
    'weak', coalesce((select jsonb_agg(x) from (select jsonb_build_object('skill', skill, 'qtype', qtype, 'pct', round(100.0 * correct / total)) as x
                                                  from spots where 1.0 * correct / total < 0.75 order by 1.0 * correct / total asc limit 2) w), '[]'::jsonb),
    'note', (select n.note from public.parent_month_notes n where n.student_id = p_student and n.month = p_month)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public._month_report(uuid, date) from public, anon, authenticated;

-- Parents: by their report link. Month defaults to this month.
create or replace function public.get_parent_month_report(p_token uuid, p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student uuid;
  v_month date := coalesce(date_trunc('month', p_month)::date, public.tashkent_month());
  v_first date;
begin
  select l.student_id into v_student from public.parent_report_links l where l.token = p_token and l.enabled;
  if v_student is null then
    return null;
  end if;
  select public.tashkent_month(min(gm.created_at)) into v_first from public.group_members gm where gm.student_id = v_student;
  return public._month_report(v_student, v_month) || jsonb_build_object(
    'months', coalesce((select jsonb_agg(to_char(m, 'YYYY-MM-DD') order by m desc)
                          from generate_series(greatest(coalesce(v_first, public.tashkent_month()), (public.tashkent_month() - interval '11 months')::date),
                                               public.tashkent_month(), interval '1 month') m), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_parent_month_report(uuid, date) from public;
grant execute on function public.get_parent_month_report(uuid, date) to anon, authenticated;

-- Teacher: the whole group for one month, with each student's report
-- link (made here for students who don't have one yet).
create or replace function public.group_month_report(p_group_id uuid, p_month date default null)
returns table(student_id uuid, full_name text, token uuid, link_enabled boolean, report jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := coalesce(date_trunc('month', p_month)::date, public.tashkent_month());
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can see monthly reports.';
  end if;
  insert into public.parent_report_links (student_id, token, enabled, created_by)
  select gm.student_id, gen_random_uuid(), true, auth.uid()
    from public.group_members gm
    join public.profiles p on p.id = gm.student_id and p.status = 'approved'
   where gm.group_id = p_group_id
     and not exists (select 1 from public.parent_report_links l where l.student_id = gm.student_id)
  on conflict do nothing;

  return query
  select p.id, coalesce(nullif(p.full_name, ''), p.username, 'Student'), l.token, l.enabled, public._month_report(p.id, v_month)
    from public.group_members gm
    join public.profiles p on p.id = gm.student_id and p.status = 'approved'
    left join public.parent_report_links l on l.student_id = p.id
   where gm.group_id = p_group_id
   order by 2;
end;
$$;
revoke all on function public.group_month_report(uuid, date) from public, anon;
grant execute on function public.group_month_report(uuid, date) to authenticated;

-- ─── 3. One-tap Telegram group connect ──────────────────────────────────
-- Kept out of `groups` (which anyone can read).
create table if not exists public.telegram_group_connect (
  code text primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default now() + interval '30 minutes'
);
alter table public.telegram_group_connect enable row level security;
drop policy if exists telegram_group_connect_teacher on public.telegram_group_connect;
create policy telegram_group_connect_teacher on public.telegram_group_connect
  for all using ((select public.is_teacher())) with check ((select public.is_teacher()));

-- Returns a code for t.me/<bot>?startgroup=<code> (letters and digits only).
create or replace function public.telegram_group_connect_code(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := 'g' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can connect Telegram groups.';
  end if;
  delete from public.telegram_group_connect where expires_at < now() or group_id = p_group_id;
  insert into public.telegram_group_connect (code, group_id, created_by) values (v_code, p_group_id, auth.uid());
  return v_code;
end;
$$;
revoke all on function public.telegram_group_connect_code(uuid) from public, anon;
grant execute on function public.telegram_group_connect_code(uuid) to authenticated;
