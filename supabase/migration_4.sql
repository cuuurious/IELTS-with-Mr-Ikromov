-- ============================================================
-- Migration 4 — run this once in Supabase SQL Editor
-- Adds: web push subscriptions (real phone/desktop notifications,
--       even when the site is closed), and fixes the leaderboard
--       "column reference student_id is ambiguous" bug.
-- ============================================================

-- ---------- Push subscriptions ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "push_select_own" on public.push_subscriptions
  for select using (user_id = auth.uid());
create policy "push_insert_own" on public.push_subscriptions
  for insert with check (user_id = auth.uid());
create policy "push_delete_own" on public.push_subscriptions
  for delete using (user_id = auth.uid());
-- Netlify functions use the service role key, which bypasses RLS,
-- so they can read every subscription to deliver a push.

-- ---------- Fix: group_leaderboard "student_id is ambiguous" ----------
-- Root cause: this function's RETURNS TABLE declares an output column
-- called `student_id`, which becomes a plpgsql variable inside the
-- function body. The final `select student_id, ...` was unqualified,
-- so Postgres couldn't tell if it meant that variable or the `stats`
-- CTE's column — hence "ambiguous". Fix: qualify with `stats.`.
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
    select id, row_number() over (order by created_at desc) as rn
    from public.homeworks where group_id = p_group_id
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
      select count(*) c from public.submissions s
      join hw on hw.id = s.homework_id
      where s.student_id = m.student_id and s.status = 'done'
    ) hd on true
    left join lateral (
      select count(distinct wa.wordlist_id) c from public.wordlist_attempts wa
      join wl on wl.id = wa.wordlist_id
      where wa.student_id = m.student_id
    ) wd on true
    left join lateral (
      select count(*) streak_count from (
        select hw.rn,
               bool_and(coalesce(s.status, 'pending') = 'done')
                 over (order by hw.rn rows unbounded preceding) as ok
        from hw
        left join public.submissions s
          on s.homework_id = hw.id and s.student_id = m.student_id
      ) t
      where t.ok
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
