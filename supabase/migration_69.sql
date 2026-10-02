-- ============================================================
-- Migration 69 — "everything" batch (2026-10-02). Safe to run twice.
--
-- 1. Telegram delivery for notifications: every notification row (new
--    homework, deadline reminders, messages, results…) is now ALSO sent
--    by the bot to students who connected Telegram — before this only
--    phone/browser push existed, so connecting the bot did nothing for
--    notifications. Done with a statement trigger → one HTTP call per
--    insert batch → Edge Function `notify-telegram`. Daily motivational
--    nudges are not sent to Telegram (push/bell only) to avoid spam.
-- 2. Error reports from students' browsers (`client_errors`), readable
--    by teachers (dashboard → Errors).
-- 3. Word lists "smart review" (Leitner boxes): `word_progress` is
--    updated automatically from every finished word-list quiz (wrong →
--    comes back today, right → comes back later and later), plus a
--    review RPC and a log for streaks. Seeded from past quiz results.
-- 4. Parent report private links + a public read-only RPC.
-- 5. Housekeeping cron: old notifications and error reports.
--    ⚠ NOT applied yet — waiting for Jasur's OK (it deletes old rows).
--
-- Sections 1–4 were applied to the live project on 2026-10-02 in parts
-- through the SQL editor. This file matches what is live.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Notifications → Telegram
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notify_telegram_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'notify_telegram_secret');
  end if;
end $$;

-- Lets the Edge Function check the shared secret without it ever being
-- stored as an Edge Function setting. Service role only.
create or replace function public.check_notify_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, vault
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'notify_telegram_secret' and decrypted_secret = p_secret
  );
$$;
revoke all on function public.check_notify_secret(text) from public, anon, authenticated;
grant execute on function public.check_notify_secret(text) to service_role;

create or replace function public.notifications_to_telegram()
returns trigger
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_rows jsonb;
  v_secret text;
begin
  -- daily_reminder: motivational spam stays push/bell only.
  -- speaking_reminder: exam-reminders already messages Telegram itself.
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', n.user_id, 'title', n.title, 'body', n.body, 'link', n.link, 'type', n.type)), '[]'::jsonb)
    into v_rows
    from new_rows n
   where coalesce(n.type, '') not in ('daily_reminder', 'speaking_reminder')
     and exists (select 1 from public.telegram_links t where t.user_id = n.user_id);

  if jsonb_array_length(v_rows) = 0 then
    return null;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_telegram_secret';

  perform net.http_post(
    url := 'https://grdfwleehlgoooizyowz.supabase.co/functions/v1/notify-telegram',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object('rows', v_rows),
    timeout_milliseconds := 10000
  );
  return null;
exception when others then
  -- Never let a Telegram problem stop a notification from being saved.
  raise warning 'notifications_to_telegram failed: %', sqlerrm;
  return null;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'notifications_to_telegram'
                  and tgrelid = 'public.notifications'::regclass) then
    create trigger notifications_to_telegram
      after insert on public.notifications
      referencing new table as new_rows
      for each statement execute function public.notifications_to_telegram();
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Client error reports
-- ------------------------------------------------------------
create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,  -- no FK on purpose: a report must never fail to save
  role text,
  message text not null check (char_length(message) <= 1000),
  stack text check (stack is null or char_length(stack) <= 4000),
  url text check (url is null or char_length(url) <= 500),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_errors' and policyname = 'client_errors_insert') then
    create policy client_errors_insert on public.client_errors
      for insert to anon, authenticated
      with check (user_id is null or user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_errors' and policyname = 'client_errors_select_teacher') then
    create policy client_errors_select_teacher on public.client_errors
      for select to authenticated
      using ((select public.is_teacher()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_errors' and policyname = 'client_errors_delete_teacher') then
    create policy client_errors_delete_teacher on public.client_errors
      for delete to authenticated
      using ((select public.is_teacher()));
  end if;
end $$;

grant select, insert, delete on public.client_errors to authenticated;
grant insert on public.client_errors to anon;

-- ------------------------------------------------------------
-- 3. Word lists: smart review
-- ------------------------------------------------------------
create table if not exists public.word_progress (
  student_id uuid not null,
  item_id uuid not null,
  wordlist_id uuid not null,
  box smallint not null default 0 check (box between 0 and 5),
  due_at timestamptz not null default now(),
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  last_seen_at timestamptz not null default now(),
  primary key (student_id, item_id)
);
create index if not exists word_progress_due_idx on public.word_progress (student_id, due_at);
create index if not exists word_progress_item_idx on public.word_progress (item_id);
create index if not exists word_progress_wordlist_idx on public.word_progress (wordlist_id);
alter table public.word_progress enable row level security;

create table if not exists public.word_review_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  total integer not null,
  correct integer not null,
  created_at timestamptz not null default now()
);
create index if not exists word_review_sessions_student_idx on public.word_review_sessions (student_id, created_at desc);
alter table public.word_review_sessions enable row level security;

-- Foreign keys (added after the seed): rows disappear together with the
-- student / word / list they belong to.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'word_progress_item_fk') then
    alter table public.word_progress
      add constraint word_progress_item_fk foreign key (item_id) references public.wordlist_items(id) on delete cascade,
      add constraint word_progress_wordlist_fk foreign key (wordlist_id) references public.wordlists(id) on delete cascade,
      add constraint word_progress_student_fk foreign key (student_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_review_sessions_student_fk') then
    alter table public.word_review_sessions
      add constraint word_review_sessions_student_fk foreign key (student_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'word_progress' and policyname = 'word_progress_select') then
    create policy word_progress_select on public.word_progress
      for select to authenticated
      using (student_id = (select auth.uid()) or (select public.is_teacher()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'word_review_sessions' and policyname = 'word_review_sessions_select') then
    create policy word_review_sessions_select on public.word_review_sessions
      for select to authenticated
      using (student_id = (select auth.uid()) or (select public.is_teacher()));
  end if;
end $$;
grant select on public.word_progress to authenticated;
grant select on public.word_review_sessions to authenticated;

-- Days until a word comes back, per box.
create or replace function public.word_box_interval(p_box int)
returns interval
language sql
immutable
as $$
  select case p_box
    when 0 then interval '0'
    when 1 then interval '1 day'
    when 2 then interval '3 days'
    when 3 then interval '7 days'
    when 4 then interval '14 days'
    else interval '30 days'
  end;
$$;

-- Apply one answer to a student's word (shared by quizzes and reviews).
create or replace function public.apply_word_answer(p_student uuid, p_item uuid, p_wordlist uuid, p_correct boolean, p_at timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_box int;
begin
  select box into v_box from public.word_progress where student_id = p_student and item_id = p_item;
  if not found then
    -- First time seen: right → comes back in 3 days, wrong → today.
    v_box := case when p_correct then 2 else 0 end;
    insert into public.word_progress (student_id, item_id, wordlist_id, box, due_at, correct_count, wrong_count, last_seen_at)
    values (p_student, p_item, p_wordlist, v_box, p_at + public.word_box_interval(v_box),
            case when p_correct then 1 else 0 end, case when p_correct then 0 else 1 end, p_at)
    on conflict (student_id, item_id) do nothing;
    return;
  end if;

  v_box := case when p_correct then least(v_box + 1, 5) else 0 end;
  update public.word_progress
     set box = v_box,
         due_at = p_at + public.word_box_interval(v_box),
         correct_count = correct_count + case when p_correct then 1 else 0 end,
         wrong_count = wrong_count + case when p_correct then 0 else 1 end,
         last_seen_at = p_at
   where student_id = p_student and item_id = p_item;
end;
$$;
revoke all on function public.apply_word_answer(uuid, uuid, uuid, boolean, timestamptz) from public, anon, authenticated;

-- Every finished word-list quiz updates the student's review boxes.
create or replace function public.word_progress_from_attempt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d jsonb;
  v_item uuid;
begin
  if jsonb_typeof(new.detail) <> 'array' then
    return new;
  end if;
  for d in select * from jsonb_array_elements(new.detail) loop
    v_item := null;
    select i.id into v_item from public.wordlist_items i
     where i.wordlist_id = new.wordlist_id and i.word = d->>'word' limit 1;
    if v_item is not null then
      perform public.apply_word_answer(new.student_id, v_item, new.wordlist_id,
        coalesce((d->>'isCorrect')::boolean, false), coalesce(new.created_at, now()));
    end if;
  end loop;
  return new;
exception when others then
  raise warning 'word_progress_from_attempt failed: %', sqlerrm;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'word_progress_from_attempt'
                  and tgrelid = 'public.wordlist_attempts'::regclass) then
    create trigger word_progress_from_attempt
      after insert on public.wordlist_attempts
      for each row execute function public.word_progress_from_attempt();
  end if;
end $$;

-- A student finishing a "Daily review": [{item_id, correct}]
create or replace function public.record_word_review(p_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r jsonb;
  v_total int := 0;
  v_correct int := 0;
  v_wordlist uuid;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 100 then
    raise exception 'Bad review data.';
  end if;
  for r in select * from jsonb_array_elements(p_results) loop
    v_wordlist := null;
    select wordlist_id into v_wordlist from public.word_progress
     where student_id = v_uid and item_id = (r->>'item_id')::uuid;
    if v_wordlist is not null then
      perform public.apply_word_answer(v_uid, (r->>'item_id')::uuid, v_wordlist, coalesce((r->>'correct')::boolean, false), now());
      v_total := v_total + 1;
      v_correct := v_correct + case when coalesce((r->>'correct')::boolean, false) then 1 else 0 end;
    end if;
  end loop;
  if v_total > 0 then
    insert into public.word_review_sessions (student_id, total, correct) values (v_uid, v_total, v_correct);
  end if;
  return jsonb_build_object('total', v_total, 'correct', v_correct);
end;
$$;
revoke all on function public.record_word_review(jsonb) from public, anon;
grant execute on function public.record_word_review(jsonb) to authenticated;

-- Seed from every past quiz (only when the table is empty): replays each
-- student's answers per word in time order. box = correct answers since
-- the last wrong one (+1 if the first answer was right and none were
-- wrong), capped at 5; due = last answer + that box's interval.
-- (Live seed on 2026-10-02: 58,314 rows for 188 students.)
do $$
begin
  if exists (select 1 from public.word_progress) then
    return;
  end if;
  with answers as (
    select a.student_id, i.id as item_id, a.wordlist_id, a.created_at,
           coalesce((d->>'isCorrect')::boolean, false) as ok
      from public.wordlist_attempts a
      cross join lateral jsonb_array_elements(case when jsonb_typeof(a.detail) = 'array' then a.detail else '[]'::jsonb end) d
      join lateral (select i.id from public.wordlist_items i
                     where i.wordlist_id = a.wordlist_id and i.word = d->>'word' limit 1) i on true
  ),
  marked as (
    select *, max(created_at) filter (where not ok) over (partition by student_id, item_id) as last_wrong,
              first_value(ok) over (partition by student_id, item_id order by created_at) as first_ok
      from answers
  ),
  summary as (
    select student_id, item_id, (array_agg(wordlist_id order by created_at desc))[1] as wordlist_id,
           max(created_at) as last_seen,
           count(*) filter (where ok) as n_ok,
           count(*) filter (where not ok) as n_wrong,
           bool_and(first_ok) as first_ok,
           max(last_wrong) as last_wrong,
           count(*) filter (where ok and (last_wrong is null or created_at > last_wrong)) as streak
      from marked
     group by student_id, item_id
  )
  insert into public.word_progress (student_id, item_id, wordlist_id, box, due_at, correct_count, wrong_count, last_seen_at)
  select s.student_id, s.item_id, s.wordlist_id, b.box,
         s.last_seen + public.word_box_interval(b.box), s.n_ok, s.n_wrong, s.last_seen
    from summary s
    cross join lateral (select (case
        when s.streak = 0 then 0
        when s.last_wrong is null and s.first_ok then least(s.streak + 1, 5)
        else least(s.streak, 5) end)::int as box) b
  on conflict (student_id, item_id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 4. Parent report links
-- ------------------------------------------------------------
create table if not exists public.parent_report_links (
  student_id uuid primary key,
  token uuid not null unique default gen_random_uuid(),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  last_viewed_at timestamptz
);
alter table public.parent_report_links enable row level security;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'parent_report_links_student_fk') then
    alter table public.parent_report_links
      add constraint parent_report_links_student_fk foreign key (student_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'parent_report_links' and policyname = 'parent_report_links_teacher') then
    create policy parent_report_links_teacher on public.parent_report_links
      for all to authenticated
      using ((select public.is_teacher()))
      with check ((select public.is_teacher()));
  end if;
end $$;
grant select, insert, update on public.parent_report_links to authenticated;

create or replace function public.get_parent_report(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
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
      with hw as (
        select h.id, h.title, h.due_date, h.created_at, s.status, s.submitted_at
          from public.homeworks h
          join public.group_members gm on gm.group_id = h.group_id and gm.student_id = v_student
          left join public.submissions s on s.homework_id = h.id and s.student_id = v_student
         where h.created_at > now() - interval '60 days'
           and h.created_at >= gm.created_at - interval '1 day'
      )
      select jsonb_build_object(
        'assigned', count(*),
        'done', count(*) filter (where status = 'done'),
        'late', count(*) filter (where status = 'done' and due_date is not null and submitted_at > due_date),
        'missed', count(*) filter (where coalesce(status, '') <> 'done' and due_date is not null and due_date < now()),
        'recent', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
            select jsonb_build_object('title', title, 'created_at', created_at, 'due_date', due_date,
                     'state', case when status = 'done' and due_date is not null and submitted_at > due_date then 'late'
                                   when status = 'done' then 'done'
                                   when due_date is not null and due_date < now() then 'missed'
                                   else 'open' end) as x
              from hw order by created_at desc limit 12) t), '[]'::jsonb)
      ) from hw
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
$$;
revoke all on function public.get_parent_report(uuid) from public;
grant execute on function public.get_parent_report(uuid) to anon, authenticated;

-- Separate tiny function so viewing can be logged without making the
-- report function itself non-read-only.
create or replace function public.touch_parent_report(p_token uuid)
returns void language sql security definer set search_path = public
as $$
  update public.parent_report_links set last_viewed_at = now() where token = p_token and enabled;
$$;
revoke all on function public.touch_parent_report(uuid) from public;
grant execute on function public.touch_parent_report(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 5. Housekeeping (daily 03:20 UTC) — NOT APPLIED YET.
--    Run this part only after Jasur says yes: it permanently removes
--    read notifications older than 60 days, all notifications older
--    than 120 days, and error reports older than 30 days.
-- ------------------------------------------------------------
-- select cron.schedule(
--   'housekeeping-notifications-errors',
--   '20 3 * * *',
--   $job$
--     delete from public.notifications where read = true and created_at < now() - interval '60 days';
--     delete from public.notifications where created_at < now() - interval '120 days';
--     delete from public.client_errors where created_at < now() - interval '30 days';
--   $job$
-- );

notify pgrst, 'reload schema';
