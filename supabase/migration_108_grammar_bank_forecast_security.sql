-- migration_108_grammar_bank_forecast_security.sql (2026-11-05)
--   A. Grammar mistakes bank: every correction the AI makes in a student's
--      writing or speaking becomes a card ("Which is right?") with the
--      same review boxes as words (today, tomorrow, 3 days, a week…).
--   B. Exam date on the profile (band forecast and countdown).
--   C. Common mistakes of a group (teacher; also the class screen).
--   D. Security clean-up from the Supabase security advisor.
-- Needs migrations 101 and 107. Safe to run more than once.

-- Run 2 (2026-11-06): the first run stopped on a "deadlock" with the live
-- site — nothing was saved. Changes to the busiest tables now come first,
-- and a short wait limit stops it politely instead. If it says
-- "lock timeout", just press Run again.
set lock_timeout = '8s';
alter table public.profiles add column if not exists exam_date date;

-- =====================================================================
-- A. GRAMMAR MISTAKES BANK
-- =====================================================================
create table if not exists public.grammar_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,              -- '<attempt or mock id>:<n>'
  kind text not null default 'writing' check (kind in ('writing', 'speaking')),
  original text not null,
  better text not null,
  why text not null default '',
  box smallint not null default 0,
  due_at timestamptz not null default now(),
  right_count integer not null default 0,
  wrong_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, source)
);
create index if not exists grammar_cards_due on public.grammar_cards (user_id, due_at);
alter table public.grammar_cards enable row level security;
drop policy if exists grammar_cards_read on public.grammar_cards;
create policy grammar_cards_read on public.grammar_cards
  for select using (user_id = (select auth.uid()) or (select public.is_teacher()));

-- Cards from one marked piece of work (results.ai).
create or replace function public.grammar_cards_from(p_user uuid, p_source uuid, p_ai jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n integer;
begin
  if p_user is null or p_ai is null or coalesce(p_ai->>'status', '') <> 'done' then
    return 0;
  end if;
  insert into public.grammar_cards (user_id, source, kind, original, better, why)
  select p_user, p_source::text || ':' || x.n,
         case when jsonb_typeof(p_ai->'say_it_better') = 'array' and jsonb_array_length(p_ai->'say_it_better') > 0 then 'speaking' else 'writing' end,
         left(trim(x.c->>'original'), 600), left(trim(x.c->>'better'), 600), left(coalesce(trim(x.c->>'why'), ''), 300)
    from (
      select e.value as c, e.ordinality as n
        from jsonb_array_elements(case
               when jsonb_typeof(p_ai->'corrections') = 'array' and jsonb_array_length(p_ai->'corrections') > 0 then p_ai->'corrections'
               when jsonb_typeof(p_ai->'say_it_better') = 'array' then p_ai->'say_it_better'
               else '[]'::jsonb end) with ordinality e
       limit 12
    ) x
   where coalesce(trim(x.c->>'original'), '') <> ''
     and coalesce(trim(x.c->>'better'), '') <> ''
     and lower(trim(x.c->>'original')) <> lower(trim(x.c->>'better'))
  on conflict (user_id, source) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.grammar_cards_from(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.grammar_cards_on_mark()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if (new.results->'ai'->>'status') = 'done'
     and (old.results is null or coalesce(old.results->'ai'->>'status', '') <> 'done' or old.results->'ai' is distinct from new.results->'ai') then
    perform public.grammar_cards_from(new.user_id, new.id, new.results->'ai');
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_grammar_cards_hw on public.homework_attempts;
create trigger trg_grammar_cards_hw after update of results on public.homework_attempts
  for each row execute function public.grammar_cards_on_mark();
drop trigger if exists trg_grammar_cards_mock on public.speaking_mocks;
create trigger trg_grammar_cards_mock after update of results on public.speaking_mocks
  for each row execute function public.grammar_cards_on_mark();

-- Work marked before today.
select public.grammar_cards_from(a.user_id, a.id, a.results->'ai')
  from public.homework_attempts a
 where a.results->'ai'->>'status' = 'done';
select public.grammar_cards_from(m.user_id, m.id, m.results->'ai')
  from public.speaking_mocks m
 where m.results->'ai'->>'status' = 'done';

-- One answer in the grammar quiz: right moves the card up a box, wrong
-- brings it back to today.
create or replace function public.review_grammar_card(p_id uuid, p_right boolean)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_box smallint;
begin
  select box into v_box from public.grammar_cards where id = p_id and user_id = auth.uid() for update;
  if v_box is null then
    raise exception 'Card not found.';
  end if;
  v_box := case when p_right then least(5, v_box + 1) else 0 end;
  update public.grammar_cards
     set box = v_box,
         due_at = now() + case v_box when 0 then interval '0' when 1 then interval '1 day' when 2 then interval '3 days'
                                     when 3 then interval '7 days' when 4 then interval '14 days' else interval '30 days' end,
         right_count = right_count + case when p_right then 1 else 0 end,
         wrong_count = wrong_count + case when p_right then 0 else 1 end
   where id = p_id;
end;
$function$;
revoke all on function public.review_grammar_card(uuid, boolean) from public, anon;
grant execute on function public.review_grammar_card(uuid, boolean) to authenticated;

-- =====================================================================
-- B. EXAM DATE
-- =====================================================================
-- (the exam_date column is added at the top of this file)

create or replace function public.set_my_exam_date(p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in again.';
  end if;
  if p_date is not null and (p_date < current_date - 1 or p_date > current_date + 730) then
    raise exception 'Pick a date within the next two years.';
  end if;
  update public.profiles set exam_date = p_date where id = auth.uid();
end;
$function$;
revoke all on function public.set_my_exam_date(date) from public, anon;
grant execute on function public.set_my_exam_date(date) to authenticated;

-- =====================================================================
-- C. COMMON MISTAKES OF A GROUP (teacher)
-- =====================================================================
create or replace function public.group_common_mistakes(p_group_id uuid, p_days integer default 14)
returns table(why text, kind text, total integer, students integer, examples jsonb)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public.is_teacher() then
    raise exception 'Only a teacher can see this.';
  end if;
  return query
  with cards as (
    select c.*, coalesce(nullif(lower(regexp_replace(c.why, '[^a-zA-Z ]', '', 'g')), ''), 'other') as wkey
      from public.grammar_cards c
      join public.group_members gm on gm.student_id = c.user_id and gm.group_id = p_group_id
     where c.created_at >= now() - make_interval(days => greatest(1, least(p_days, 120)))
  ), keyed as (
    select *, array_to_string((regexp_split_to_array(trim(wkey), '\s+'))[1:4], ' ') as k from cards
  )
  select (array_agg(k2.why order by length(k2.why)))[1] as why,
         (array_agg(k2.kind))[1] as kind,
         count(*)::integer as total,
         count(distinct k2.user_id)::integer as students,
         jsonb_path_query_array(jsonb_agg(jsonb_build_object('original', k2.original, 'better', k2.better) order by k2.created_at desc), '$[0 to 1]') as examples
    from keyed k2
   group by k2.k
   order by count(distinct k2.user_id) desc, count(*) desc
   limit 12;
end;
$function$;
revoke all on function public.group_common_mistakes(uuid, integer) from public, anon;
grant execute on function public.group_common_mistakes(uuid, integer) to authenticated;

-- A few cards from the group for a class quiz (teacher).
create or replace function public.group_quiz_cards(p_group_id uuid, p_n integer default 6)
returns table(original text, better text, why text)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public.is_teacher() then
    raise exception 'Only a teacher can see this.';
  end if;
  return query
  select c.original, c.better, c.why
    from public.grammar_cards c
    join public.group_members gm on gm.student_id = c.user_id and gm.group_id = p_group_id
   where c.created_at >= now() - interval '30 days'
     and length(c.original) <= 220
   order by random()
   limit greatest(1, least(p_n, 20));
end;
$function$;
revoke all on function public.group_quiz_cards(uuid, integer) from public, anon;
grant execute on function public.group_quiz_cards(uuid, integer) to authenticated;

-- =====================================================================
-- D. SECURITY CLEAN-UP (Supabase security advisor, 2026-11-05)
-- =====================================================================
-- 1. A fixed search_path on the functions that had none.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname in ('handle_new_group_owner', 'is_group_owner', 'is_group_admin', 'is_group_member', 'set_updated_at',
                         'log_homework_completion', 'is_speaking_examiner', 'is_writing_examiner', 'is_examiner',
                         'touch_mock_speaking_slot', 'trigger_set_updated_at', 'word_box_interval', '_full_mock_live_section',
                         'full_mock_first_stage', 'full_mock_next_stage', 'all_students_leaderboard', 'delete_my_account',
                         'group_leaderboard', 'qtype_key', 'ielts_band_from_raw', 'tashkent_month')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end;
$$;

-- 2. Signed-out visitors may not call security-definer functions, except
--    the few the public pages need (login by username, the parent report)
--    and any that a table's access rule uses. Trigger functions never need
--    to be called directly: closed for everyone.
do $$
declare
  f record;
  v_policies text;
begin
  select coalesce(string_agg(coalesce(qual, '') || ' ' || coalesce(with_check, ''), ' '), '') into v_policies from pg_policies;
  for f in
    select p.oid::regprocedure as sig, p.proname, t.typname as rettype,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
           has_function_privilege('service_role', p.oid, 'execute') as service_ok
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
  loop
    if f.rettype = 'trigger' then
      execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    elsif f.proname not in ('auth_email_for_username', 'get_parent_report', 'get_parent_month_report', 'touch_parent_report')
          and position(f.proname || '(' in v_policies) = 0 then
      -- Signed-in users and the server keep exactly the access they had.
      execute format('revoke execute on function %s from public, anon', f.sig);
      if f.auth_ok then execute format('grant execute on function %s to authenticated', f.sig); end if;
      if f.service_ok then execute format('grant execute on function %s to service_role', f.sig); end if;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
