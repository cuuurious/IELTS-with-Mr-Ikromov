-- migration_107_notebook_speaking_mock_reports.sql (2026-11-05)
--   A. Mistake notebook: every reading / listening question a student got
--      wrong on a practice page is kept until they answer it right.
--   B. Speaking mock: a full speaking test with an AI band. The student
--      asks Mr Ikromov to unlock it, or spends coins.
--   C. Monday report: every Monday 08:00 (Tashkent) each teacher gets a
--      short report per group (the bell + Telegram).
--   D. Monthly parent reports: a reminder on the 1st; the reports are sent
--      by SMS from the Monthly reports window (parent-sms kind 'report').
--   E. Weekly season: warm-up, Books page practice and speaking mocks
--      earn points for the student and the group race.
-- Needs migrations 95 (coins), 101 (speaking sets), 102 (shop).
-- Safe to run more than once.

-- =====================================================================
-- A. MISTAKE NOTEBOOK
-- =====================================================================
create table if not exists public.mistake_pages (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  url text not null,
  title text not null default '',
  skill text,
  question_type text,
  wrong integer[] not null default '{}',
  fixed integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, url)
);
alter table public.mistake_pages enable row level security;
drop policy if exists mistake_pages_read on public.mistake_pages;
create policy mistake_pages_read on public.mistake_pages
  for select using (user_id = (select auth.uid()) or (select public.is_teacher()));

-- Wrong answers go in, right answers come out. p_only: look only at these
-- question numbers (a notebook re-test).
create or replace function public.mistake_apply(p_user uuid, p_url text, p_title text, p_skill text, p_qtype text, p_qs jsonb, p_only integer[] default null)
returns integer[]
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_right integer[];
  v_wrong integer[];
  v_old integer[];
  v_new integer[];
  v_fixed integer;
begin
  if p_user is null or p_url is null or jsonb_typeof(p_qs) <> 'array' then
    return null;
  end if;
  select coalesce(array_agg(distinct (e->>'n')::int) filter (where (e->>'ok')::boolean), '{}'),
         coalesce(array_agg(distinct (e->>'n')::int) filter (where not (e->>'ok')::boolean), '{}')
    into v_right, v_wrong
    from jsonb_array_elements(p_qs) e
   where (e->>'n') ~ '^[0-9]{1,3}$'
     and (e->>'ok') in ('true', 'false')
     and (p_only is null or (e->>'n')::int = any (p_only));

  select wrong into v_old from public.mistake_pages where user_id = p_user and url = p_url;
  v_new := array(select distinct x from unnest(coalesce(v_old, '{}') || v_wrong) x where not (x = any (v_right)) order by x);
  v_fixed := cardinality(array(select x from unnest(coalesce(v_old, '{}')) x where x = any (v_right)));

  if v_old is null and cardinality(v_new) = 0 then
    return v_new;
  end if;
  insert into public.mistake_pages as m (user_id, url, title, skill, question_type, wrong, fixed, updated_at)
  values (p_user, p_url, coalesce(p_title, ''), p_skill, p_qtype, v_new, v_fixed, now())
  on conflict (user_id, url) do update
    set wrong = excluded.wrong,
        fixed = m.fixed + excluded.fixed,
        title = coalesce(nullif(excluded.title, ''), m.title),
        skill = coalesce(excluded.skill, m.skill),
        question_type = coalesce(excluded.question_type, m.question_type),
        updated_at = now();
  return v_new;
end;
$function$;
revoke all on function public.mistake_apply(uuid, text, text, text, text, jsonb, integer[]) from public, anon, authenticated;

-- The student's Books page (book_practice).
create or replace function public.mistakes_from_book()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  m record;
begin
  if new.details is null or jsonb_typeof(new.details->'qs') <> 'array' then
    return new;
  end if;
  select url, title, skill, question_type into m from public.materials where id = new.material_id;
  if m.url ~ '^/practice/(reading|listening)' then
    perform public.mistake_apply(new.user_id, m.url, m.title, m.skill, m.question_type, new.details->'qs', null);
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_mistakes_from_book on public.book_practice;
create trigger trg_mistakes_from_book after insert on public.book_practice
  for each row execute function public.mistakes_from_book();

-- Practice pages handed in as homework.
create or replace function public.mistakes_from_homework()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  t record;
begin
  if new.submitted_at is null or old.submitted_at is not null or new.task_id is null
     or new.results is null or jsonb_typeof(new.results->'qs') <> 'array' then
    return new;
  end if;
  select html_url, title, skill, question_type into t from public.homework_tasks where id = new.task_id;
  if t.html_url ~ '^/practice/(reading|listening)' then
    perform public.mistake_apply(new.user_id, t.html_url, t.title, t.skill, t.question_type, new.results->'qs', null);
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_mistakes_from_homework on public.homework_attempts;
create trigger trg_mistakes_from_homework after update of submitted_at on public.homework_attempts
  for each row execute function public.mistakes_from_homework();

-- A notebook re-test: only the questions in the notebook count.
create or replace function public.mistake_retest(p_url text, p_qs jsonb)
returns integer[]
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_old integer[];
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;
  select wrong into v_old from public.mistake_pages where user_id = auth.uid() and url = p_url;
  if v_old is null then
    raise exception 'This page is not in your mistake notebook.';
  end if;
  return public.mistake_apply(auth.uid(), p_url, null, null, null, p_qs, v_old);
end;
$function$;
revoke all on function public.mistake_retest(text, jsonb) from public, anon;
grant execute on function public.mistake_retest(text, jsonb) to authenticated;

-- =====================================================================
-- B. SPEAKING MOCK
-- =====================================================================
alter table public.coin_settings add column if not exists speaking_mock_price integer not null default 50;

create table if not exists public.speaking_mocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested', 'unlocked', 'done', 'declined')),
  source text not null default 'request' check (source in ('request', 'coins', 'teacher')),
  set_id uuid references public.speaking_sets(id) on delete set null,
  results jsonb,
  band numeric,
  created_at timestamptz not null default now(),
  unlocked_at timestamptz,
  unlocked_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz
);
create index if not exists speaking_mocks_user on public.speaking_mocks (user_id, created_at desc);
alter table public.speaking_mocks enable row level security;
drop policy if exists speaking_mocks_read on public.speaking_mocks;
create policy speaking_mocks_read on public.speaking_mocks
  for select using (user_id = (select auth.uid()) or (select public.is_teacher()));
-- Teachers write their own band and comment (results.teacher, band).
drop policy if exists speaking_mocks_teacher on public.speaking_mocks;
create policy speaking_mocks_teacher on public.speaking_mocks
  for update using ((select public.is_teacher())) with check ((select public.is_teacher()));

create or replace function public.request_speaking_mock()
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Please sign in again.';
  end if;
  if exists (select 1 from public.speaking_mocks where user_id = v_uid and status in ('requested', 'unlocked')) then
    raise exception 'You already have a speaking mock waiting.';
  end if;
  insert into public.speaking_mocks (user_id, status, source) values (v_uid, 'requested', 'request') returning id into v_id;
  select coalesce(full_name, 'A student') into v_name from public.profiles where id = v_uid;
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'speaking_mock', 'Speaking mock request', v_name || ' asks for a speaking mock. Unlock it in Review → Speaking mocks.', null
    from public.profiles p where p.role = 'teacher';
  return v_id;
end;
$function$;

create or replace function public.buy_speaking_mock()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_price integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in again.';
  end if;
  perform pg_advisory_xact_lock(hashtext('coins:' || v_uid::text));
  if exists (select 1 from public.speaking_mocks where user_id = v_uid and status = 'unlocked') then
    raise exception 'Your speaking mock is already open. Take it first.';
  end if;
  select coalesce(speaking_mock_price, 50) into v_price from public.coin_settings where id = 1;
  if public.coin_balance_of(v_uid) < v_price then
    raise exception 'You need % coins for a speaking mock.', v_price using errcode = 'P0001';
  end if;
  -- A request that is waiting becomes the paid mock.
  update public.speaking_mocks set status = 'unlocked', source = 'coins', unlocked_at = now()
   where id = (select id from public.speaking_mocks where user_id = v_uid and status = 'requested' order by created_at limit 1)
  returning id into v_id;
  if v_id is null then
    insert into public.speaking_mocks (user_id, status, source, unlocked_at) values (v_uid, 'unlocked', 'coins', now()) returning id into v_id;
  end if;
  perform public.coin_add(v_uid, -v_price, 'Speaking mock', 'speaking_mock', v_id::text);
  return public.coin_balance_of(v_uid);
end;
$function$;

-- Teacher: unlock or decline a request, or give a mock to a student.
create or replace function public.decide_speaking_mock(p_id uuid, p_unlock boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v public.speaking_mocks%rowtype;
begin
  if not public.is_teacher() then
    raise exception 'Only a teacher can do this.';
  end if;
  update public.speaking_mocks
     set status = case when p_unlock then 'unlocked' else 'declined' end,
         source = case when p_unlock then 'teacher' else source end,
         unlocked_at = now(), unlocked_by = auth.uid()
   where id = p_id and status = 'requested'
  returning * into v;
  if v.id is null then
    raise exception 'This request was already answered.';
  end if;
  insert into public.notifications (user_id, type, title, body, link)
  values (v.user_id, 'speaking_mock',
          case when p_unlock then 'Your speaking mock is open' else 'Speaking mock' end,
          case when p_unlock then 'Mr Ikromov unlocked a speaking mock for you. Open Courses → Speaking mock when you are ready.'
               else 'Mr Ikromov could not open a speaking mock for you this time.' end,
          null);
end;
$function$;

create or replace function public.give_speaking_mock(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
begin
  if not public.is_teacher() then
    raise exception 'Only a teacher can do this.';
  end if;
  if exists (select 1 from public.speaking_mocks where user_id = p_user and status = 'unlocked') then
    raise exception 'This student already has an open speaking mock.';
  end if;
  update public.speaking_mocks set status = 'unlocked', source = 'teacher', unlocked_at = now(), unlocked_by = auth.uid()
   where id = (select id from public.speaking_mocks where user_id = p_user and status = 'requested' order by created_at limit 1)
  returning id into v_id;
  if v_id is null then
    insert into public.speaking_mocks (user_id, status, source, unlocked_at, unlocked_by)
    values (p_user, 'unlocked', 'teacher', now(), auth.uid()) returning id into v_id;
  end if;
  insert into public.notifications (user_id, type, title, body, link)
  values (p_user, 'speaking_mock', 'Your speaking mock is open', 'Mr Ikromov unlocked a speaking mock for you. Open Courses → Speaking mock when you are ready.', null);
  return v_id;
end;
$function$;

-- Student: hand in the recordings (the site then asks the AI to mark it).
create or replace function public.submit_speaking_mock(p_id uuid, p_set uuid, p_details jsonb)
returns public.speaking_mocks
language plpgsql
security definer
set search_path = public
as $function$
declare
  v public.speaking_mocks%rowtype;
begin
  update public.speaking_mocks
     set status = 'done', set_id = p_set, results = p_details, submitted_at = now()
   where id = p_id and user_id = auth.uid() and status = 'unlocked'
  returning * into v;
  if v.id is null then
    raise exception 'This speaking mock is not open.';
  end if;
  return v;
end;
$function$;

-- The AI's marking (service role, from the ai-grading function). A band
-- Mr Ikromov already gave is kept.
create or replace function public.save_speaking_mock_feedback(p_mock_id uuid, p_band numeric, p_ai jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.speaking_mocks
     set results = coalesce(results, '{}'::jsonb) || jsonb_build_object('ai', p_ai),
         band = coalesce((results->'teacher'->>'band')::numeric, p_band, band)
   where id = p_mock_id;
end;
$function$;

revoke all on function public.request_speaking_mock() from public, anon;
revoke all on function public.buy_speaking_mock() from public, anon;
revoke all on function public.decide_speaking_mock(uuid, boolean) from public, anon;
revoke all on function public.give_speaking_mock(uuid) from public, anon;
revoke all on function public.submit_speaking_mock(uuid, uuid, jsonb) from public, anon;
grant execute on function public.request_speaking_mock() to authenticated;
grant execute on function public.buy_speaking_mock() to authenticated;
grant execute on function public.decide_speaking_mock(uuid, boolean) to authenticated;
grant execute on function public.give_speaking_mock(uuid) to authenticated;
grant execute on function public.submit_speaking_mock(uuid, uuid, jsonb) to authenticated;
revoke all on function public.save_speaking_mock_feedback(uuid, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.save_speaking_mock_feedback(uuid, numeric, jsonb) to service_role;

-- =====================================================================
-- C. MONDAY REPORT
-- =====================================================================
create or replace function public.weekly_teacher_report()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  t record;
  g record;
  v_body text;
  v_part text;
  v_since timestamptz := now() - interval '7 days';
  v_sent integer := 0;
  v_hw integer;
  v_rate integer;
  v_behind text;
  v_quiet text;
  v_weak text;
  v_w numeric;
  v_w0 numeric;
  v_s numeric;
  v_s0 numeric;
begin
  for t in select id from public.profiles where role = 'teacher' loop
    v_body := '';
    for g in
      select gr.id, gr.name from public.groups gr
       where gr.created_by = t.id
          or gr.created_by is null
          or not exists (select 1 from public.profiles p where p.id = gr.created_by and p.role = 'teacher')
       order by gr.created_at
    loop
      -- Homework due last week and who handed it in.
      with members as (
        select gm.student_id, coalesce(p.full_name, p.username, '') as name
          from public.group_members gm join public.profiles p on p.id = gm.student_id
         where gm.group_id = g.id
      ), hw as (
        select h.id from public.homeworks h
         where h.group_id = g.id and h.due_date >= v_since and h.due_date < now()
      ), done as (
        select distinct x.homework_id, x.student_id from (
          select s.homework_id, s.student_id from public.submissions s where s.status = 'done' and s.homework_id in (select id from hw)
          union all
          select c.homework_id, c.student_id from public.homework_completions c where c.homework_id in (select id from hw)
        ) x
      ), per as (
        select m.student_id, m.name, (select count(*) from hw) - (select count(*) from done d where d.student_id = m.student_id) as missing
          from members m
      )
      select (select count(*) from hw),
             case when (select count(*) from hw) * (select count(*) from members) = 0 then null
                  else round(100.0 * (select count(*) from done d where d.student_id in (select student_id from members))
                             / ((select count(*) from hw) * (select count(*) from members))) end,
             (select string_agg(name, ', ' order by missing desc, name) from (select name, missing from per where missing >= 2 order by missing desc, name limit 5) b)
        into v_hw, v_rate, v_behind;

      -- No practice at all for 7 days.
      select string_agg(n, ', ') into v_quiet from (
        select coalesce(p.full_name, p.username, '') n
          from public.group_members gm join public.profiles p on p.id = gm.student_id
         where gm.group_id = g.id
           and not exists (select 1 from public.homework_attempts a where a.user_id = gm.student_id and a.submitted_at >= v_since)
           and not exists (select 1 from public.book_practice b where b.user_id = gm.student_id and b.created_at >= v_since)
           and not exists (select 1 from public.submissions s where s.student_id = gm.student_id and s.submitted_at >= v_since)
         order by 1 limit 5
      ) q;

      -- Weakest question types in the last two weeks of homework pages.
      select string_agg(label || ' ' || pct || '%', ', ') into v_weak from (
        select replace(initcap(replace(ht.question_type, '_', ' ')), 'Tfng', 'TFNG') as label,
               round(100.0 * sum(a.score) / nullif(sum(a.max_score), 0)) as pct
          from public.homework_attempts a
          join public.homework_tasks ht on ht.id = a.task_id
          join public.homeworks h on h.id = ht.homework_id
         where h.group_id = g.id and a.submitted_at >= now() - interval '14 days'
           and a.max_score > 0 and ht.question_type is not null
           and ht.question_type not like 'writing%' and ht.question_type not like 'speaking%'
         group by ht.question_type
        having count(*) >= 3
         order by 2 asc limit 2
      ) w where pct < 70;

      -- Writing and speaking bands: this week and the week before.
      select avg(a.band) filter (where a.submitted_at >= v_since and ht.question_type like 'writing%'),
             avg(a.band) filter (where a.submitted_at < v_since and ht.question_type like 'writing%'),
             avg(a.band) filter (where a.submitted_at >= v_since and ht.question_type like 'speaking%'),
             avg(a.band) filter (where a.submitted_at < v_since and ht.question_type like 'speaking%')
        into v_w, v_w0, v_s, v_s0
        from public.homework_attempts a
        join public.homework_tasks ht on ht.id = a.task_id
        join public.homeworks h on h.id = ht.homework_id
       where h.group_id = g.id and a.band is not null and a.submitted_at >= now() - interval '14 days';

      v_part := 'Group ' || coalesce(nullif(regexp_replace(g.name, '^\s*group\s*', '', 'i'), ''), g.name) || E'\n';
      v_part := v_part || '• Homework: ' || case when v_hw = 0 then 'none due' else coalesce(v_rate, 0) || '% handed in (' || v_hw || ' due)' end || E'\n';
      if v_behind is not null then v_part := v_part || '• Behind: ' || v_behind || E'\n'; end if;
      if v_quiet is not null then v_part := v_part || '• Quiet all week: ' || v_quiet || E'\n'; end if;
      if v_weak is not null then v_part := v_part || '• Weakest: ' || v_weak || E'\n'; end if;
      if v_w is not null then
        v_part := v_part || '• Writing ' || to_char(round(v_w * 2) / 2, 'FM9.0')
               || case when v_w0 is not null then ' (' || case when v_w >= v_w0 then '+' else '' end || to_char(round((v_w - v_w0) * 2) / 2, 'FM90.0') || ')' else '' end || E'\n';
      end if;
      if v_s is not null then
        v_part := v_part || '• Speaking ' || to_char(round(v_s * 2) / 2, 'FM9.0')
               || case when v_s0 is not null then ' (' || case when v_s >= v_s0 then '+' else '' end || to_char(round((v_s - v_s0) * 2) / 2, 'FM90.0') || ')' else '' end || E'\n';
      end if;
      v_body := v_body || v_part || E'\n';
    end loop;

    if v_body <> '' then
      insert into public.notifications (user_id, type, title, body, link)
      values (t.id, 'weekly_report', 'Monday report', left(trim(v_body), 3500), null);
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end;
$function$;
revoke all on function public.weekly_teacher_report() from public, anon, authenticated;

-- =====================================================================
-- D. MONTHLY PARENT REPORTS
-- =====================================================================
alter table public.parent_sms_log drop constraint if exists parent_sms_log_kind_check;
alter table public.parent_sms_log add constraint parent_sms_log_kind_check
  check (kind = any (array['auto', 'manual', 'test', 'thanks', 'custom', 'report']));

create or replace function public.monthly_report_reminder()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_month text := to_char((now() at time zone 'Asia/Tashkent') - interval '1 month', 'FMMonth');
  v_n integer;
begin
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'monthly_reports', v_month || ' reports are ready',
         'Open a group → Monthly reports, check each student and add a note, then press “Send to parents”.', null
    from public.profiles p where p.role = 'teacher';
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.monthly_report_reminder() from public, anon, authenticated;

-- =====================================================================
-- E. WEEKLY SEASON: new practice counts for the group race too
--    warm-up 3 a day · Books page practice 2 a page (max 20) ·
--    speaking mock 10. Same columns as before; the extra is in points.
-- =====================================================================
create or replace function public.weekly_points(p_group_id uuid, p_week_start date)
 returns table(user_id uuid, full_name text, avatar_url text, points integer, homework_points integer, task_points integer, marathon_points integer, word_points integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
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
  ),
  extra as (
    select x.uid, sum(x.pts)::integer as pts
      from (
        select c.user_id as uid, 3 * count(*) as pts
          from public.coin_ledger c
         where c.ref_type = 'warmup' and c.created_at >= v_from and c.created_at < v_to
         group by c.user_id
        union all
        select b.user_id, least(20, 2 * count(distinct b.material_id))
          from public.book_practice b
         where b.created_at >= v_from and b.created_at < v_to
         group by b.user_id
        union all
        select sm.user_id, 10 * count(*)
          from public.speaking_mocks sm
         where sm.status = 'done' and sm.submitted_at >= v_from and sm.submitted_at < v_to
         group by sm.user_id
      ) x
     group by x.uid
  )
  select m.uid, p.full_name, p.avatar_url,
         (coalesce(hw.pts, 0) + coalesce(tasks.pts, 0) + coalesce(mar.pts, 0) + coalesce(words.pts, 0) + coalesce(extra.pts, 0))::integer,
         coalesce(hw.pts, 0)::integer, coalesce(tasks.pts, 0)::integer,
         coalesce(mar.pts, 0)::integer, coalesce(words.pts, 0)::integer
    from members m
    join public.profiles p on p.id = m.uid
    left join hw on hw.uid = m.uid
    left join tasks on tasks.uid = m.uid
    left join mar on mar.uid = m.uid
    left join words on words.uid = m.uid
    left join extra on extra.uid = m.uid
   where p.role = 'student'
   order by 4 desc, p.full_name;
end;
$function$;

-- Schedules (UTC): Monday 03:00 = 08:00 Tashkent; the 1st at 04:00 = 09:00.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('weekly-teacher-report', 'monthly-report-reminder');
    perform cron.schedule('weekly-teacher-report', '0 3 * * 1', 'select public.weekly_teacher_report()');
    perform cron.schedule('monthly-report-reminder', '0 4 1 * *', 'select public.monthly_report_reminder()');
  end if;
end;
$$;

notify pgrst, 'reload schema';
