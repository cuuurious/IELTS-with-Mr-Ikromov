-- ============================================================
-- Migration 3 — run this once in Supabase SQL Editor
-- Adds: leaderboard/streak function, word lists + AI vocab game,
--       notifications, teacher-deletable student profiles.
-- ============================================================

-- ---------- Let the teacher delete a student's profile ----------
create policy "profiles_delete_teacher" on public.profiles
  for delete using (public.is_teacher());

-- ============================================================
-- WORD LISTS + VOCAB GAME
-- ============================================================
create table if not exists public.wordlists (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.wordlist_items (
  id uuid primary key default gen_random_uuid(),
  wordlist_id uuid not null references public.wordlists(id) on delete cascade,
  word text not null,
  definition text,
  uzbek_translation text,
  example_sentence text,
  position int not null default 0
);

create table if not exists public.wordlist_attempts (
  id uuid primary key default gen_random_uuid(),
  wordlist_id uuid not null references public.wordlists(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score int not null,
  total int not null,
  percentage numeric not null,
  detail jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create or replace function public.is_wordlist_group_member(p_wordlist_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.wordlists w
    join public.group_members gm on gm.group_id = w.group_id
    where w.id = p_wordlist_id and gm.student_id = auth.uid()
  );
$$;

alter table public.wordlists enable row level security;
alter table public.wordlist_items enable row level security;
alter table public.wordlist_attempts enable row level security;

create policy "wl_select_teacher" on public.wordlists for select using (public.is_teacher());
create policy "wl_select_member" on public.wordlists for select using (public.is_group_member(group_id));
create policy "wl_insert_teacher" on public.wordlists for insert with check (public.is_teacher());
create policy "wl_update_teacher" on public.wordlists for update using (public.is_teacher());
create policy "wl_delete_teacher" on public.wordlists for delete using (public.is_teacher());

create policy "wli_select_teacher" on public.wordlist_items for select using (public.is_teacher());
create policy "wli_select_member" on public.wordlist_items for select using (public.is_wordlist_group_member(wordlist_id));
create policy "wli_insert_teacher" on public.wordlist_items for insert with check (public.is_teacher());
create policy "wli_update_teacher" on public.wordlist_items for update using (public.is_teacher());
create policy "wli_delete_teacher" on public.wordlist_items for delete using (public.is_teacher());

create policy "wla_select_teacher" on public.wordlist_attempts for select using (public.is_teacher());
create policy "wla_select_own" on public.wordlist_attempts for select using (student_id = auth.uid());
create policy "wla_insert_own" on public.wordlist_attempts for insert with check (student_id = auth.uid());

-- ============================================================
-- LEADERBOARD (percentage + streak), safe to expose to group members
-- without leaking each other's actual uploaded files/comments.
-- ============================================================
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
    student_id, full_name, username,
    (hw_done + wl_done)::int as completed,
    (select n from total_tasks)::int as total,
    case when (select n from total_tasks) = 0 then 0::numeric
      else round((hw_done + wl_done)::numeric / (select n from total_tasks) * 100, 1)
    end as percentage,
    streak::int
  from stats
  order by percentage desc, full_name asc;
end;
$$;

grant execute on function public.group_leaderboard(uuid) to authenticated;

-- ============================================================
-- NOTIFICATIONS (in-app bell + daily/deadline reminders)
-- ============================================================
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read boolean not null default false
);

alter table public.notifications enable row level security;

create policy "notif_select_own" on public.notifications
  for select using (user_id = auth.uid());
create policy "notif_update_own" on public.notifications
  for update using (user_id = auth.uid());
create policy "notif_insert_teacher" on public.notifications
  for insert with check (public.is_teacher());

alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.wordlist_attempts;
