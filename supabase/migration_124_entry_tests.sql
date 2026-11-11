-- migration_124_entry_tests.sql (2026-11-11)
-- ENTRY TESTS — /entry, no account needed.
-- A new student types the 4-digit code Mr Ikromov gives out, their name,
-- phone, target band, exam date and how they heard about the center, then
-- takes one Listening Part 2 (10 questions) and one Reading Passage 2
-- (13 questions), each picked from a pool of 10 so people sitting side by
-- side get different tests. At the end they see an estimated band and
-- level; the teacher gets a Telegram message and an "Entry tests" tab.
--
-- People taking the test have no account, so they never touch the tables
-- directly: entry_start / entry_save check the code and a per-test secret.
-- Safe to run more than once.

set lock_timeout = '8s';

-- The code people must type (one row). Teachers see and change it.
create table if not exists public.entry_settings (
  id integer primary key default 1 check (id = 1),
  code text not null default lpad((floor(random() * 10000))::int::text, 4, '0'),
  updated_at timestamptz not null default now()
);
insert into public.entry_settings (id) values (1) on conflict (id) do nothing;
alter table public.entry_settings enable row level security;
drop policy if exists entry_settings_teacher on public.entry_settings;
create policy entry_settings_teacher on public.entry_settings
  for all using ((select public.is_teacher())) with check ((select public.is_teacher()));

create table if not exists public.entry_tests (
  id uuid primary key default gen_random_uuid(),
  secret uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null,
  phone text not null,
  target_band numeric,
  exam_date date,
  heard_from text,
  listening_url text not null,
  reading_url text not null,
  listening_score integer,
  listening_max integer,
  listening_qs jsonb,
  listening_at timestamptz,
  reading_score integer,
  reading_max integer,
  reading_qs jsonb,
  reading_at timestamptz,
  listening_band numeric,
  reading_band numeric,
  band numeric,
  level text,
  finished_at timestamptz,
  contacted boolean not null default false,
  note text,
  user_agent text
);
create index if not exists entry_tests_created on public.entry_tests (created_at desc);
alter table public.entry_tests enable row level security;
drop policy if exists entry_tests_teacher_read on public.entry_tests;
create policy entry_tests_teacher_read on public.entry_tests
  for select using ((select public.is_teacher()));
drop policy if exists entry_tests_teacher_update on public.entry_tests;
create policy entry_tests_teacher_update on public.entry_tests
  for update using ((select public.is_teacher())) with check ((select public.is_teacher()));
drop policy if exists entry_tests_teacher_delete on public.entry_tests;
create policy entry_tests_teacher_delete on public.entry_tests
  for delete using ((select public.is_teacher()));

-- Raw score out of 40 → IELTS band (Listening / Academic Reading tables).
create or replace function public.entry_band(p_skill text, p_score integer, p_max integer)
returns numeric
language sql
immutable
set search_path = public
as $function$
  select case
    when coalesce(p_max, 0) <= 0 then null
    else (
      with r as (select round(40.0 * greatest(0, least(p_score, p_max)) / p_max)::int as raw)
      select case
        when p_skill = 'listening' then
          case when raw >= 39 then 9 when raw >= 37 then 8.5 when raw >= 35 then 8 when raw >= 32 then 7.5
               when raw >= 30 then 7 when raw >= 26 then 6.5 when raw >= 23 then 6 when raw >= 18 then 5.5
               when raw >= 16 then 5 when raw >= 13 then 4.5 when raw >= 10 then 4 when raw >= 8 then 3.5
               when raw >= 6 then 3 when raw >= 4 then 2.5 else 2 end
        else
          case when raw >= 39 then 9 when raw >= 37 then 8.5 when raw >= 35 then 8 when raw >= 33 then 7.5
               when raw >= 30 then 7 when raw >= 27 then 6.5 when raw >= 23 then 6 when raw >= 19 then 5.5
               when raw >= 15 then 5 when raw >= 13 then 4.5 when raw >= 10 then 4 when raw >= 8 then 3.5
               when raw >= 6 then 3 when raw >= 4 then 2.5 else 2 end
      end from r
    )
  end
$function$;

create or replace function public.entry_level(p_band numeric)
returns text
language sql
immutable
as $function$
  select case
    when p_band is null then null
    when p_band >= 8 then 'Advanced (C2)'
    when p_band >= 7 then 'Advanced (C1)'
    when p_band >= 5.5 then 'Upper-intermediate (B2)'
    when p_band >= 4 then 'Intermediate (B1)'
    when p_band >= 3 then 'Pre-intermediate (A2)'
    else 'Elementary (A1–A2)'
  end
$function$;

-- Start: check the code, save the person's details, pick their tests.
-- The tests used least so far are picked first (random among equals), so
-- people starting at the same time get different ones.
create or replace function public.entry_start(
  p_code text,
  p_name text,
  p_phone text,
  p_target numeric default null,
  p_exam_date date default null,
  p_heard text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_listening text[] := array[
    '/practice/listening/part-2/test-1.html', '/practice/listening/part-2/test-2.html',
    '/practice/listening/part-2/test-3.html', '/practice/listening/part-2/test-4.html',
    '/practice/listening/part-2/test-5.html', '/practice/listening/part-2/test-6.html',
    '/practice/listening/part-2/test-7.html', '/practice/listening/part-2/test-8.html',
    '/practice/listening/part-2/test-9.html', '/practice/listening/part-2/test-10.html'
  ];
  v_reading text[] := array[
    '/practice/reading-full/test-01.html', '/practice/reading-full/test-02.html',
    '/practice/reading-full/test-03.html', '/practice/reading-full/test-04.html',
    '/practice/reading-full/test-05.html', '/practice/reading-full/test-06.html',
    '/practice/reading-full/test-07.html', '/practice/reading-full/test-08.html',
    '/practice/reading-full/test-10.html', '/practice/reading-full/test-11.html'
  ];
  v_name text := left(trim(coalesce(p_name, '')), 80);
  v_phone text := left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20);
  v_l text;
  v_r text;
  v_row public.entry_tests%rowtype;
begin
  if coalesce(trim(p_code), '') is distinct from (select code from public.entry_settings where id = 1) then
    raise exception 'wrong_code';
  end if;
  if length(v_name) < 2 then
    raise exception 'name_needed';
  end if;
  if length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 then
    raise exception 'phone_needed';
  end if;
  -- Stop a flood (someone scripting the page): at most 40 starts in 10 minutes.
  if (select count(*) from public.entry_tests where created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'too_many';
  end if;

  select u into v_l from unnest(v_listening) u
   order by (select count(*) from public.entry_tests e where e.listening_url = u), random() limit 1;
  select u into v_r from unnest(v_reading) u
   order by (select count(*) from public.entry_tests e where e.reading_url = u), random() limit 1;

  insert into public.entry_tests (full_name, phone, target_band, exam_date, heard_from, listening_url, reading_url, user_agent)
  values (
    v_name, v_phone,
    case when p_target between 3 and 9 then p_target end,
    case when p_exam_date between current_date - 7 and current_date + 730 then p_exam_date end,
    left(nullif(trim(coalesce(p_heard, '')), ''), 60),
    v_l, v_r, left(p_user_agent, 200)
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'secret', v_row.secret,
    'listening_url', v_row.listening_url, 'reading_url', v_row.reading_url
  );
end;
$function$;

-- Save one section's result. Each section can be saved once. After both,
-- work out the band and level and tell the teachers (in-app + Telegram).
create or replace function public.entry_save(
  p_id uuid,
  p_secret uuid,
  p_section text,
  p_score integer,
  p_max integer,
  p_qs jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v public.entry_tests%rowtype;
  v_band numeric;
  v_level text;
  t record;
  v_body text;
begin
  select * into v from public.entry_tests where id = p_id and secret = p_secret for update;
  if v.id is null then
    raise exception 'not_found';
  end if;
  if p_section not in ('listening', 'reading') or coalesce(p_max, 0) <= 0 or p_max > 40
     or p_score is null or p_score < 0 or p_score > p_max then
    raise exception 'bad_result';
  end if;

  if p_section = 'listening' and v.listening_at is null then
    update public.entry_tests
       set listening_score = p_score, listening_max = p_max, listening_qs = p_qs, listening_at = now(),
           listening_band = public.entry_band('listening', p_score, p_max)
     where id = p_id returning * into v;
  elsif p_section = 'reading' and v.reading_at is null then
    update public.entry_tests
       set reading_score = p_score, reading_max = p_max, reading_qs = p_qs, reading_at = now(),
           reading_band = public.entry_band('reading', p_score, p_max)
     where id = p_id returning * into v;
  end if;

  if v.listening_at is not null and v.reading_at is not null and v.finished_at is null then
    -- Average of the two, rounded to the nearest half band (IELTS rounding).
    v_band := (floor((v.listening_band + v.reading_band) / 2 * 2 + 0.5) / 2)::numeric(3,1);
    v_level := public.entry_level(v_band);
    update public.entry_tests set band = v_band, level = v_level, finished_at = now()
     where id = p_id returning * into v;

    v_body := 'Phone: ' || v.phone
      || E'\nListening ' || v.listening_score || '/' || v.listening_max || ' (band ' || to_char(v.listening_band, 'FM9.0') || ')'
      || E'\nReading ' || v.reading_score || '/' || v.reading_max || ' (band ' || to_char(v.reading_band, 'FM9.0') || ')'
      || E'\nLevel: ' || v_level
      || coalesce(E'\nTarget: ' || to_char(v.target_band, 'FM9.0'), '')
      || coalesce(E'\nExam: ' || to_char(v.exam_date, 'DD Mon YYYY'), '')
      || coalesce(E'\nHeard from: ' || v.heard_from, '');
    for t in select id from public.profiles where role = 'teacher' and status = 'approved' loop
      insert into public.notifications (user_id, type, title, body, link)
      values (t.id, 'entry_test', 'Entry test: ' || v.full_name || ' — band ' || to_char(v_band, 'FM9.0'), v_body, 'entry-tests');
    end loop;
  end if;

  return jsonb_build_object(
    'listening_band', v.listening_band, 'reading_band', v.reading_band,
    'band', v.band, 'level', v.level, 'finished', v.finished_at is not null
  );
end;
$function$;

revoke all on function public.entry_start(text, text, text, numeric, date, text, text) from public;
revoke all on function public.entry_save(uuid, uuid, text, integer, integer, jsonb) from public;
grant execute on function public.entry_start(text, text, text, numeric, date, text, text) to anon, authenticated;
grant execute on function public.entry_save(uuid, uuid, text, integer, integer, jsonb) to anon, authenticated;
grant execute on function public.entry_band(text, integer, integer) to anon, authenticated;
grant execute on function public.entry_level(numeric) to anon, authenticated;
grant select, update, delete on public.entry_tests to authenticated;
grant select, update on public.entry_settings to authenticated;

notify pgrst, 'reload schema';

-- Check: expect the code (4 digits) and 0 tests.
select (select code from public.entry_settings) as entry_code, (select count(*) from public.entry_tests) as entry_tests;
