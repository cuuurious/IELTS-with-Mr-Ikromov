-- migration_86_coins_and_courses.sql (2026-11-02)
--
-- Coins and video courses.
--
-- Earning (only earned, never bought or given by hand):
--   * homework handed in on time 5 coins, late 1 (once per homework);
--   * every 7 homeworks in a row on time: +10;
--   * every member of the week's top group (average season points per
--     student): +20, paid the first time anyone opens the site after
--     the week ends (claim_weekly_prizes()).
-- Spending:
--   * a full mock request (100): coins are held when the student asks,
--     given back if the teacher declines or the request is removed;
--   * a video course (price per course): unlocks its lessons for good.
-- Lesson videos are unlisted YouTube links, shown only after unlocking.
--
-- Needs migrations 84 and 85. Safe to run more than once.

-- ---------------------------------------------------------------
-- 1. Settings (one row) and the coin ledger
-- ---------------------------------------------------------------
create table if not exists public.coin_settings (
  id integer primary key default 1 check (id = 1),
  homework_on_time integer not null default 5,
  homework_late integer not null default 1,
  streak_bonus integer not null default 10,
  streak_length integer not null default 7,
  top_group_bonus integer not null default 20,
  mock_slot_price integer not null default 100,
  updated_at timestamptz not null default now()
);
insert into public.coin_settings (id) values (1) on conflict (id) do nothing;

alter table public.coin_settings enable row level security;
drop policy if exists coin_settings_read on public.coin_settings;
create policy coin_settings_read on public.coin_settings for select using ((select auth.role()) = 'authenticated');
drop policy if exists coin_settings_teacher on public.coin_settings;
create policy coin_settings_teacher on public.coin_settings for update using ((select public.is_teacher())) with check ((select public.is_teacher()));

create table if not exists public.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  reason text not null,
  ref_type text not null,
  ref_key text not null,
  created_at timestamptz not null default now(),
  constraint coin_ledger_once unique (user_id, ref_type, ref_key)
);
create index if not exists coin_ledger_user_idx on public.coin_ledger (user_id, created_at desc);

alter table public.coin_ledger enable row level security;
drop policy if exists coin_ledger_read on public.coin_ledger;
create policy coin_ledger_read on public.coin_ledger
  for select using (user_id = (select auth.uid()) or (select public.is_teacher()));
-- No insert/update/delete policies: coins only move through the
-- functions below.

create or replace function public.coin_balance_of(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce(sum(amount), 0)::integer from public.coin_ledger where user_id = p_user;
$function$;

create or replace function public.my_coins()
returns integer
language sql
stable
security definer
set search_path = public
as $function$
  select public.coin_balance_of(auth.uid());
$function$;

-- Teacher overview: every student's balance and what they earned.
create or replace function public.coin_balances()
returns table(user_id uuid, full_name text, avatar_url text, balance integer, earned integer, spent integer)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public.is_teacher() then
    raise exception 'Teachers only.';
  end if;
  return query
  select p.id, p.full_name, p.avatar_url,
         coalesce(sum(l.amount), 0)::integer,
         coalesce(sum(l.amount) filter (where l.amount > 0), 0)::integer,
         coalesce(-sum(l.amount) filter (where l.amount < 0), 0)::integer
    from public.profiles p
    left join public.coin_ledger l on l.user_id = p.id
   where p.role = 'student' and p.status = 'approved'
   group by p.id, p.full_name, p.avatar_url
   order by 4 desc, p.full_name;
end;
$function$;

-- Internal: add a ledger row once (the unique key makes it safe to call twice).
create or replace function public.coin_add(p_user uuid, p_amount integer, p_reason text, p_ref_type text, p_ref_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rows integer;
begin
  if p_amount = 0 then
    return false;
  end if;
  insert into public.coin_ledger (user_id, amount, reason, ref_type, ref_key)
  values (p_user, p_amount, p_reason, p_ref_type, p_ref_key)
  on conflict on constraint coin_ledger_once do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;
revoke all on function public.coin_add(uuid, integer, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 2. Earning from homework
-- ---------------------------------------------------------------
create or replace function public.coins_for_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  s public.coin_settings%rowtype;
  v_hw record;
  v_on_time boolean;
  v_streak integer := 0;
  r record;
begin
  if new.status is distinct from 'done' or new.submitted_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'done' then
    return new;
  end if;

  select * into s from public.coin_settings where id = 1;
  select h.id, h.title, h.due_date, h.group_id into v_hw from public.homeworks h where h.id = new.homework_id;
  if v_hw.id is null then
    return new;
  end if;

  v_on_time := v_hw.due_date is null or new.submitted_at <= v_hw.due_date;
  perform public.coin_add(
    new.student_id,
    case when v_on_time then s.homework_on_time else s.homework_late end,
    case when v_on_time then 'Homework on time: ' else 'Homework (late): ' end || coalesce(v_hw.title, ''),
    'homework',
    new.homework_id::text
  );

  -- Streak: homeworks of this group with a deadline, newest first, that
  -- are already due or already handed in — count the run of on-time ones.
  if v_on_time and v_hw.due_date is not null and s.streak_length > 0 then
    for r in
      select h.id, h.due_date, sub.status, sub.submitted_at
        from public.homeworks h
        left join public.submissions sub on sub.homework_id = h.id and sub.student_id = new.student_id
       where h.group_id = v_hw.group_id
         and h.due_date is not null
         and h.created_at >= coalesce((select min(gm.created_at) from public.group_members gm where gm.group_id = v_hw.group_id and gm.student_id = new.student_id), '-infinity'::timestamptz)
         and (h.due_date <= now() or (sub.status = 'done'))
       order by h.due_date desc
    loop
      exit when not coalesce(r.status = 'done' and r.submitted_at is not null and r.submitted_at <= r.due_date, false);
      v_streak := v_streak + 1;
    end loop;
    if v_streak > 0 and v_streak % s.streak_length = 0 then
      perform public.coin_add(new.student_id, s.streak_bonus, v_streak || ' homeworks in a row on time', 'streak', new.homework_id::text);
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_coins_for_submission on public.submissions;
create trigger trg_coins_for_submission
  after insert or update of status, submitted_at on public.submissions
  for each row execute function public.coins_for_submission();

-- ---------------------------------------------------------------
-- 3. Weekly group race (top group's members get coins)
-- ---------------------------------------------------------------
-- Season points without the "is this your group" check (used inside
-- other functions only).
create or replace function public.weekly_points(p_group_id uuid, p_week_start date)
returns table(user_id uuid, full_name text, avatar_url text, points integer, homework_points integer, task_points integer, marathon_points integer, word_points integer)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_from timestamptz := (p_week_start::timestamp) at time zone 'Asia/Tashkent';
  v_to timestamptz := ((p_week_start + 7)::timestamp) at time zone 'Asia/Tashkent';
begin
  return query
  with members as (
    select gm.student_id as uid from public.group_members gm where gm.group_id = p_group_id
  ),
  hw as (
    select s.student_id as uid,
           sum(case when h.due_date is null or s.submitted_at <= h.due_date then 10 else 5 end)::integer as pts
      from public.submissions s
      join public.homeworks h on h.id = s.homework_id
     where s.status = 'done' and h.group_id = p_group_id
       and s.submitted_at >= v_from and s.submitted_at < v_to
     group by s.student_id
  ),
  tasks as (
    select a.user_id as uid,
           sum(case when a.max_score > 0 then round(10.0 * a.score / a.max_score) else 10 end)::integer as pts
      from public.homework_attempts a
      join public.homeworks h on h.id = a.homework_id
     where a.attempt_no = 1 and a.submitted_at is not null and h.group_id = p_group_id
       and a.submitted_at >= v_from and a.submitted_at < v_to
     group by a.user_id
  ),
  mar as (
    select m.user_id as uid, sum(m.score)::integer as pts
      from public.marathon_results m
     where m.day >= p_week_start and m.day < p_week_start + 7
     group by m.user_id
  ),
  words as (
    select x.uid, least(20, floor(sum(x.n) / 10.0))::integer as pts
      from (
        select w.student_id as uid, coalesce(w.total, 0) as n
          from public.wordlist_attempts w where w.created_at >= v_from and w.created_at < v_to
        union all
        select r.student_id, r.total
          from public.word_review_sessions r where r.created_at >= v_from and r.created_at < v_to
      ) x
     group by x.uid
  )
  select m.uid, p.full_name, p.avatar_url,
         (coalesce(hw.pts, 0) + coalesce(tasks.pts, 0) + coalesce(mar.pts, 0) + coalesce(words.pts, 0))::integer,
         coalesce(hw.pts, 0)::integer, coalesce(tasks.pts, 0)::integer,
         coalesce(mar.pts, 0)::integer, coalesce(words.pts, 0)::integer
    from members m
    join public.profiles p on p.id = m.uid
    left join hw on hw.uid = m.uid
    left join tasks on tasks.uid = m.uid
    left join mar on mar.uid = m.uid
    left join words on words.uid = m.uid
   where p.role = 'student'
   order by 4 desc, p.full_name;
end;
$function$;
revoke all on function public.weekly_points(uuid, date) from public, anon, authenticated;

create or replace function public.weekly_leaderboard(p_group_id uuid, p_week_start date default null)
returns table(user_id uuid, full_name text, avatar_url text, points integer, homework_points integer, task_points integer, marathon_points integer, word_points integer)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not (public.is_teacher() or public.is_group_member(p_group_id)) then
    raise exception 'Not your group.';
  end if;
  return query
  select * from public.weekly_points(p_group_id, coalesce(p_week_start, date_trunc('week', (now() at time zone 'Asia/Tashkent'))::date));
end;
$function$;

-- Every group's average season points per student for one week.
create or replace function public.group_race(p_week_start date default null)
returns table(group_id uuid, name text, students integer, average numeric, total integer)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_week date := coalesce(p_week_start, date_trunc('week', (now() at time zone 'Asia/Tashkent'))::date);
  g record;
  v_n integer;
  v_total integer;
begin
  for g in select gr.id, gr.name from public.groups gr loop
    select count(*), coalesce(sum(w.points), 0) into v_n, v_total from public.weekly_points(g.id, v_week) w;
    if v_n > 0 then
      group_id := g.id;
      name := g.name;
      students := v_n;
      total := v_total;
      average := round(v_total::numeric / v_n, 1);
      return next;
    end if;
  end loop;
end;
$function$;
revoke all on function public.group_race(date) from public, anon;
grant execute on function public.group_race(date) to authenticated;

-- Pays last week's top group, once. Called when anyone opens the
-- leaderboard or the Courses page; does nothing if already paid.
create or replace function public.claim_weekly_prizes()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_week date := (date_trunc('week', (now() at time zone 'Asia/Tashkent'))::date) - 7;
  v_bonus integer;
  v_top record;
  m record;
begin
  if exists (select 1 from public.coin_ledger where ref_type = 'group_prize' and ref_key = v_week::text) then
    return;
  end if;
  select top_group_bonus into v_bonus from public.coin_settings where id = 1;
  select * into v_top from public.group_race(v_week) r where r.average > 0 order by r.average desc, r.total desc limit 1;
  if v_top.group_id is null then
    return;
  end if;
  for m in select gm.student_id from public.group_members gm join public.profiles p on p.id = gm.student_id
            where gm.group_id = v_top.group_id and p.role = 'student' loop
    perform public.coin_add(m.student_id, v_bonus, 'Your group ' || v_top.name || ' won the week', 'group_prize', v_week::text);
  end loop;
end;
$function$;
revoke all on function public.claim_weekly_prizes() from public, anon;
grant execute on function public.claim_weekly_prizes() to authenticated;

-- ---------------------------------------------------------------
-- 4. Full mock requests cost coins (held, given back if declined)
-- ---------------------------------------------------------------
create or replace function public.mock_request_coins_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_price integer;
begin
  if public.is_teacher() then
    return new;
  end if;
  select mock_slot_price into v_price from public.coin_settings where id = 1;
  if coalesce(v_price, 0) <= 0 then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('coins:' || new.student_id::text));
  if public.coin_balance_of(new.student_id) < v_price then
    raise exception 'You need % coins for a full mock. Hand homework in on time to earn more.', v_price
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

create or replace function public.mock_request_coins_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_price integer;
  v_title text;
begin
  select mock_slot_price into v_price from public.coin_settings where id = 1;
  if tg_op = 'INSERT' then
    if public.is_teacher() or coalesce(v_price, 0) <= 0 then
      return null;
    end if;
    select title into v_title from public.full_mock_sets where id = new.full_mock_set_id;
    perform public.coin_add(new.student_id, -v_price, 'Full mock: ' || coalesce(v_title, 'request'), 'mock_request', new.id::text);
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status = 'rejected' and old.status is distinct from 'rejected' then
    perform public.coin_refund_request(new.id, new.student_id);
  end if;
  if tg_op = 'DELETE' and old.status = 'pending' then
    perform public.coin_refund_request(old.id, old.student_id);
  end if;
  return null;
end;
$function$;

create or replace function public.coin_refund_request(p_request uuid, p_student uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_paid integer;
begin
  select -amount into v_paid from public.coin_ledger
   where user_id = p_student and ref_type = 'mock_request' and ref_key = p_request::text;
  if coalesce(v_paid, 0) > 0 then
    perform public.coin_add(p_student, v_paid, 'Full mock request declined — coins back', 'mock_refund', p_request::text);
  end if;
end;
$function$;
revoke all on function public.coin_refund_request(uuid, uuid) from public, anon, authenticated;

drop trigger if exists trg_mock_request_coins_before on public.mock_access_requests;
create trigger trg_mock_request_coins_before
  before insert on public.mock_access_requests
  for each row execute function public.mock_request_coins_before();

drop trigger if exists trg_mock_request_coins_after on public.mock_access_requests;
create trigger trg_mock_request_coins_after
  after insert or update of status or delete on public.mock_access_requests
  for each row execute function public.mock_request_coins_after();

-- ---------------------------------------------------------------
-- 5. Video courses
-- ---------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  skill text not null default 'general' check (skill in ('listening', 'reading', 'writing', 'speaking', 'vocab', 'general')),
  price integer not null default 150 check (price >= 0),
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  position integer not null default 0,
  title text not null,
  youtube_url text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists course_lessons_course_idx on public.course_lessons (course_id, position);

create table if not exists public.course_unlocks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table if not exists public.lesson_progress (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.course_lessons(id) on delete cascade,
  done_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

alter table public.courses enable row level security;
alter table public.course_lessons enable row level security;
alter table public.course_unlocks enable row level security;
alter table public.lesson_progress enable row level security;

drop policy if exists courses_teacher on public.courses;
create policy courses_teacher on public.courses for all using ((select public.is_teacher())) with check ((select public.is_teacher()));
drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses for select using (is_published);

drop policy if exists course_lessons_teacher on public.course_lessons;
create policy course_lessons_teacher on public.course_lessons for all using ((select public.is_teacher())) with check ((select public.is_teacher()));
drop policy if exists course_lessons_unlocked on public.course_lessons;
create policy course_lessons_unlocked on public.course_lessons for select using (
  exists (select 1 from public.course_unlocks u where u.course_id = course_lessons.course_id and u.user_id = (select auth.uid()))
);

drop policy if exists course_unlocks_read on public.course_unlocks;
create policy course_unlocks_read on public.course_unlocks for select using (user_id = (select auth.uid()) or (select public.is_teacher()));

drop policy if exists lesson_progress_own on public.lesson_progress;
create policy lesson_progress_own on public.lesson_progress for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists lesson_progress_teacher on public.lesson_progress;
create policy lesson_progress_teacher on public.lesson_progress for select using ((select public.is_teacher()));

-- Lesson titles of a published course (no video links) for the shop.
create or replace function public.course_outline(p_course_id uuid)
returns table(lesson_id uuid, "position" integer, title text)
language sql
stable
security definer
set search_path = public
as $function$
  select l.id, l.position, l.title
    from public.course_lessons l
    join public.courses c on c.id = l.course_id
   where l.course_id = p_course_id and (c.is_published or public.is_teacher())
   order by l.position;
$function$;
revoke all on function public.course_outline(uuid) from public, anon;
grant execute on function public.course_outline(uuid) to authenticated;

create or replace function public.buy_course(p_course_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_course public.courses%rowtype;
  v_uid uuid := auth.uid();
begin
  select * into v_course from public.courses where id = p_course_id and is_published;
  if v_course.id is null then
    raise exception 'This course is not available.';
  end if;
  if exists (select 1 from public.course_unlocks where user_id = v_uid and course_id = p_course_id) then
    return public.coin_balance_of(v_uid);
  end if;
  perform pg_advisory_xact_lock(hashtext('coins:' || v_uid::text));
  if public.coin_balance_of(v_uid) < v_course.price then
    raise exception 'You need % coins for this course.', v_course.price using errcode = 'P0001';
  end if;
  perform public.coin_add(v_uid, -v_course.price, 'Course: ' || v_course.title, 'course', p_course_id::text);
  insert into public.course_unlocks (user_id, course_id) values (v_uid, p_course_id) on conflict do nothing;
  return public.coin_balance_of(v_uid);
end;
$function$;
revoke all on function public.buy_course(uuid) from public, anon;
grant execute on function public.buy_course(uuid) to authenticated;

grant execute on function public.my_coins() to authenticated;
grant execute on function public.coin_balances() to authenticated;
grant select on public.coin_settings, public.coin_ledger, public.courses, public.course_lessons, public.course_unlocks to authenticated;
grant update on public.coin_settings to authenticated;
grant insert, update, delete on public.courses, public.course_lessons to authenticated;
grant select, insert, delete on public.lesson_progress to authenticated;

notify pgrst, 'reload schema';
