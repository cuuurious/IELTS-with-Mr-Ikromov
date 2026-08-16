-- ============================================================
-- Migration 6 — run this once in Supabase SQL Editor
-- Fixes:
--  - "Clear content" now also resets status, without losing leaderboard
--    credit — a separate permanent log records completion forever.
--  - Streak is now based on distinct CALENDAR DAYS of activity, not a
--    simple count of homeworks in a row.
--  - Students can delete their own account.
--  - Teacher can clean up a student's storage files when clearing content.
-- ============================================================

-- ---------- Permanent completion log ----------
-- Written automatically by a trigger the moment a submission first becomes
-- "done". Later clearing/resetting the submission does NOT remove this
-- row, so leaderboard % and streaks stay accurate forever.
create table if not exists public.homework_completions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  homework_id uuid not null references public.homeworks(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (student_id, homework_id)
);

alter table public.homework_completions enable row level security;

create policy "hwc_select_own" on public.homework_completions
  for select using (student_id = auth.uid());
create policy "hwc_select_teacher" on public.homework_completions
  for select using (public.is_teacher());
-- No insert/update/delete policy for regular users — only the trigger
-- below writes to this table, running as its (security definer) owner.

create or replace function public.log_homework_completion()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    insert into public.homework_completions (student_id, homework_id, group_id, completed_at)
    values (new.student_id, new.homework_id, new.group_id, now())
    on conflict (student_id, homework_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_homework_completion on public.submissions;
create trigger trg_log_homework_completion
  after insert or update on public.submissions
  for each row execute function public.log_homework_completion();

-- ---------- Leaderboard v2: permanent completions + day-based streak ----------
create or replace function public.group_leaderboard(p_group_id uuid)
returns table (
  student_id uuid,
  full_name text,
  username text,
  completed int,
  total int,
  percentage numeric,
  streak int
)
language plpgsql
security definer
stable
as $$
begin
  if not (public.is_group_member(p_group_id) or public.is_teacher()) then
    return;
  end if;

  return query
  with hw as (
    select id from public.homeworks where group_id = p_group_id
  ),
  wl as (
    select id from public.wordlists where group_id = p_group_id
  ),
  total_tasks as (
    select (select count(*) from hw) + (select count(*) from wl) as n
  ),
  members as (
    select gm.student_id, p.full_name, p.username
    from public.group_members gm
    join public.profiles p on p.id = gm.student_id and p.status = 'approved'
    where gm.group_id = p_group_id
  ),
  stats as (
    select
      m.student_id, m.full_name, m.username,
      coalesce(hd.c, 0) as hw_done,
      coalesce(wd.c, 0) as wl_done,
      coalesce(st.streak_count, 0) as streak
    from members m
    left join lateral (
      select count(*) c from public.homework_completions hc
      join hw on hw.id = hc.homework_id
      where hc.student_id = m.student_id
    ) hd on true
    left join lateral (
      select count(distinct wa.wordlist_id) c from public.wordlist_attempts wa
      join wl on wl.id = wa.wordlist_id
      where wa.student_id = m.student_id
    ) wd on true
    left join lateral (
      -- Distinct calendar days this student did *something* (a homework or
      -- a word-list attempt) for this group, then find the length of the
      -- most recent unbroken run of consecutive days (classic
      -- gaps-and-islands: subtracting a same-sized, evenly-spaced offset
      -- from consecutive dates produces one identical value per island).
      with all_days as (
        select hc.completed_at as d
        from public.homework_completions hc
        join hw on hw.id = hc.homework_id
        where hc.student_id = m.student_id
        union all
        select wa.created_at as d
        from public.wordlist_attempts wa
        join wl on wl.id = wa.wordlist_id
        where wa.student_id = m.student_id
      ),
      distinct_days as (
        select distinct d::date as day from all_days
      ),
      islands as (
        select day, day - (row_number() over (order by day desc))::int * interval '1 day' as grp
        from distinct_days
      ),
      top_island as (
        select grp from islands order by day desc limit 1
      )
      select count(*) as streak_count from islands
      where grp = (select grp from top_island)
    ) st on true
  )
  select
    stats.student_id, stats.full_name, stats.username,
    (stats.hw_done + stats.wl_done)::int as completed,
    (select n from total_tasks)::int as total,
    case when (select n from total_tasks) = 0 then 0::numeric
      else round((stats.hw_done + stats.wl_done)::numeric / (select n from total_tasks) * 100, 1)
    end as percentage,
    stats.streak::int
  from stats
  order by percentage desc, stats.full_name asc;
end;
$$;

grant execute on function public.group_leaderboard(uuid) to authenticated;

-- ---------- Students can delete their own account ----------
create policy "profiles_delete_self" on public.profiles
  for delete using (id = auth.uid());

-- ---------- Let the teacher clean up storage when clearing content ----------
create policy "submissions_storage_delete_teacher"
  on storage.objects for delete
  using (bucket_id = 'submissions' and public.is_teacher());
