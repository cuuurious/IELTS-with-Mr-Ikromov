-- migration_76_parent_report_history.sql (2026-10-07)
-- 1. homework_history: when a teacher deletes a homework, each group
--    member's result for it (done / late / missed) is copied here first.
--    Deleting a homework cascades away its submissions and
--    homework_completions, which is why parents could only ever see the
--    homework that still exists. From now on nothing is lost.
-- 2. Parent report shows the WHOLE history since the student joined:
--    homework.since, homework.months (per month: assigned / done / late
--    / missed / open), homework.recent = every homework newest first
--    (up to 500) with done_at. Current homework + archived history.
--    Counting rules unchanged from migration_73 (a homework_completions
--    row counts as done even after a teacher reset).

create table if not exists public.homework_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid,
  homework_id uuid not null,
  title text,
  set_at timestamptz,
  due_date timestamptz,
  done_at timestamptz,
  state text not null check (state in ('done', 'late', 'missed', 'removed')),
  archived_at timestamptz not null default now(),
  unique (student_id, homework_id)
);
create index if not exists homework_history_student_idx on public.homework_history (student_id, due_date desc);

alter table public.homework_history enable row level security;
drop policy if exists "teachers read homework history" on public.homework_history;
create policy "teachers read homework history" on public.homework_history
  for select to authenticated using ((select public.is_teacher()));
drop policy if exists "students read own homework history" on public.homework_history;
create policy "students read own homework history" on public.homework_history
  for select to authenticated using (student_id = (select auth.uid()));

-- BEFORE DELETE: the submissions / completions still exist here (the
-- cascade runs after this trigger).
create or replace function public.archive_homework_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.homework_history (student_id, group_id, homework_id, title, set_at, due_date, done_at, state)
  select x.student_id, old.group_id, old.id, old.title, old.created_at, old.due_date, x.done_at,
         case when x.is_done and old.due_date is not null and x.done_at > old.due_date then 'late'
              when x.is_done then 'done'
              when old.due_date is not null and old.due_date < now() then 'missed'
              else 'removed' end
    from (
      select gm.student_id, gm.created_at as joined_at,
             (s.status = 'done' or c.completed_at is not null) as is_done,
             coalesce(case when s.status = 'done' then s.submitted_at end, c.completed_at, s.submitted_at) as done_at,
             s.status, s.submitted_at, c.completed_at
        from public.group_members gm
        left join public.submissions s on s.homework_id = old.id and s.student_id = gm.student_id
        left join lateral (
          select min(hc.completed_at) as completed_at from public.homework_completions hc
           where hc.homework_id = old.id and hc.student_id = gm.student_id
        ) c on true
       where gm.group_id = old.group_id
    ) x
   where old.created_at >= x.joined_at - interval '1 day'
      or x.status = 'done' or x.submitted_at is not null or x.completed_at is not null
  on conflict (student_id, homework_id) do nothing;
  return old;
exception when others then
  -- Never block a delete because of the archive.
  raise warning 'archive_homework_before_delete failed: %', sqlerrm;
  return old;
end;
$function$;

drop trigger if exists trg_archive_homework_before_delete on public.homeworks;
create trigger trg_archive_homework_before_delete
  before delete on public.homeworks
  for each row execute function public.archive_homework_before_delete();

create or replace function public.get_parent_report(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_student uuid;
  v_result jsonb;
begin
  select student_id into v_student from public.parent_report_links where token = p_token and enabled;
  if v_student is null then
    return null;
  end if;

  select jsonb_build_object(
    'student', (select jsonb_build_object('full_name', p.full_name, 'target_band', p.target_band, 'avatar_url', p.avatar_url)
                  from public.profiles p where p.id = v_student),
    'groups', coalesce((select jsonb_agg(g.name order by g.name)
                  from public.group_members gm join public.groups g on g.id = gm.group_id
                 where gm.student_id = v_student), '[]'::jsonb),
    'homework', (
      with base as (
        select h.id, h.title, h.due_date, h.created_at, gm.created_at as joined_at,
               s.status, s.submitted_at,
               (select min(c.completed_at) from public.homework_completions c
                 where c.homework_id = h.id and c.student_id = v_student) as completed_at
          from public.homeworks h
          join public.group_members gm on gm.group_id = h.group_id and gm.student_id = v_student
          left join public.submissions s on s.homework_id = h.id and s.student_id = v_student
      ),
      hw as (
        select id, title, due_date, created_at,
               (status = 'done' or completed_at is not null) as is_done,
               coalesce(case when status = 'done' then submitted_at end, completed_at, submitted_at) as done_at
          from base
         where created_at >= joined_at - interval '1 day'
            or status = 'done' or submitted_at is not null or completed_at is not null
      ),
      live as (
        select title, due_date, created_at, done_at,
               case when is_done and due_date is not null and done_at > due_date then 'late'
                    when is_done then 'done'
                    when due_date is not null and due_date < now() then 'missed'
                    else 'open' end as state
          from hw
      ),
      archived as (
        select hh.title, hh.due_date, hh.set_at as created_at, hh.done_at, hh.state
          from public.homework_history hh
         where hh.student_id = v_student and hh.state <> 'removed'
           and not exists (select 1 from public.homeworks h2 where h2.id = hh.homework_id)
      ),
      st as (
        select *, date_trunc('month', coalesce(due_date, created_at)) as month
          from (select * from live union all select * from archived) u
      )
      select jsonb_build_object(
        'since', (select min(gm.created_at) from public.group_members gm where gm.student_id = v_student),
        'assigned', count(*),
        'done', count(*) filter (where state in ('done', 'late')),
        'late', count(*) filter (where state = 'late'),
        'missed', count(*) filter (where state = 'missed'),
        'months', coalesce((select jsonb_agg(m order by m->>'month') from (
            select jsonb_build_object(
                     'month', to_char(month, 'YYYY-MM-DD'),
                     'assigned', count(*),
                     'done', count(*) filter (where state = 'done'),
                     'late', count(*) filter (where state = 'late'),
                     'missed', count(*) filter (where state = 'missed'),
                     'open', count(*) filter (where state = 'open')) as m
              from st group by month) t), '[]'::jsonb),
        'recent', coalesce((select jsonb_agg(x order by x->>'sort' desc) from (
            select jsonb_build_object('title', title, 'created_at', created_at, 'due_date', due_date,
                     'done_at', done_at, 'state', state,
                     'sort', to_char(coalesce(due_date, created_at), 'YYYY-MM-DD"T"HH24:MI:SS')) as x
              from st order by coalesce(due_date, created_at) desc limit 500) t), '[]'::jsonb)
      ) from st
    ),
    'words', jsonb_build_object(
        'quizzes_30d', (select count(*) from public.wordlist_attempts where student_id = v_student and created_at > now() - interval '30 days'),
        'avg_score_30d', (select round(avg(percentage)) from public.wordlist_attempts where student_id = v_student and created_at > now() - interval '30 days'),
        'words_learned', (select count(*) from public.word_progress where student_id = v_student and box >= 3),
        'words_practised', (select count(*) from public.word_progress where student_id = v_student),
        'reviews_30d', (select count(*) from public.word_review_sessions where student_id = v_student and created_at > now() - interval '30 days')
    ),
    'mocks', jsonb_build_object(
        'listening', (select a.band from public.mock_attempts a join public.mock_exams e on e.id = a.exam_id
                       where a.user_id = v_student and e.module = 'listening' and a.released_at is not null and a.band is not null
                       order by a.submitted_at desc limit 1),
        'reading', (select a.band from public.mock_attempts a join public.mock_exams e on e.id = a.exam_id
                     where a.user_id = v_student and e.module = 'reading' and a.released_at is not null and a.band is not null
                     order by a.submitted_at desc limit 1),
        'writing', (select w.examiner_band from public.writing_mock_attempts w
                     where w.student_id = v_student and w.released_at is not null and w.examiner_band is not null
                     order by w.submitted_at desc limit 1),
        'speaking', (select s.examiner_band from public.mock_speaking_slots s
                      where s.student_id = v_student and s.released_at is not null and s.examiner_band is not null
                      order by s.scheduled_at desc limit 1)
    ),
    'generated_at', now()
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_parent_report(uuid) from public;
grant execute on function public.get_parent_report(uuid) to anon, authenticated;
