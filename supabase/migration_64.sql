-- ============================================================
-- Migration 64 — speed-up (2026-09-30). Safe to run more than once.
--
-- Jasur: "why the website is working very slowly, check for the bugs
-- and optimize". What the database itself showed:
--   * Every query is fast on the server (2–45 ms), so this migration is
--     the smaller half of the fix — most of the wait is the distance to
--     the database (see the note at the bottom) and the app making too
--     many requests one after another (fixed in the app code).
--   * notifications has 33,000+ rows and NO index on user_id, so every
--     bell refresh / "mark read" scanned the whole table (~20–30 ms,
--     up to 2 s under load, 55,000+ times so far).
--   * 50+ foreign-key columns the app filters on have no index
--     (submissions.group_id / student_id, homeworks.group_id,
--     group_members.student_id, messages sender/receiver, …).
--   * 80 security (RLS) rules call auth.uid() / is_teacher() once PER
--     ROW instead of once per query.
--   * profiles has the same username index twice (slows every write).
--   * 9 tables are broadcast over Realtime although nothing in the app
--     listens to them — every write to them (e.g. full-mock progress,
--     word-list attempts) was being decoded for nothing.
-- Nothing here changes who can see or edit what.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Indexes for the columns the app actually filters/sorts on
-- ------------------------------------------------------------

-- Notification bell: "my unread notifications, newest first".
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read = false;
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- Homework & submissions.
create index if not exists homeworks_group_created_idx
  on public.homeworks (group_id, created_at desc);
create index if not exists submissions_group_idx
  on public.submissions (group_id);
create index if not exists submissions_student_group_idx
  on public.submissions (student_id, group_id);
create index if not exists homework_completions_homework_idx
  on public.homework_completions (homework_id);
create index if not exists homework_completions_group_idx
  on public.homework_completions (group_id);

-- Group membership lookups by student (used by almost every security
-- rule a student hits: is_group_member / shares_group_with / peers).
create index if not exists group_members_student_idx
  on public.group_members (student_id);

-- Private chat.
create index if not exists messages_sender_created_idx
  on public.messages (sender_id, created_at desc);
create index if not exists messages_receiver_created_idx
  on public.messages (receiver_id, created_at desc);
create index if not exists private_chat_reads_peer_idx
  on public.private_chat_reads (peer_id);

-- Group chat.
create index if not exists group_messages_sender_idx
  on public.group_messages (sender_id);
create index if not exists group_message_pins_group_idx
  on public.group_message_pins (group_id);
create index if not exists group_message_reactions_user_idx
  on public.group_message_reactions (user_id);
create index if not exists group_message_deletions_user_idx
  on public.group_message_deletions (user_id);
create index if not exists message_reactions_user_idx
  on public.message_reactions (user_id);
create index if not exists message_deletions_user_idx
  on public.message_deletions (user_id);

-- Word lists.
create index if not exists wordlists_group_idx
  on public.wordlists (group_id);
create index if not exists wordlist_items_wordlist_idx
  on public.wordlist_items (wordlist_id);
create index if not exists wordlist_attempts_wordlist_idx
  on public.wordlist_attempts (wordlist_id);
create index if not exists wordlist_attempts_student_created_idx
  on public.wordlist_attempts (student_id, created_at desc);

-- Mock Center.
create index if not exists mock_answers_question_idx
  on public.mock_answers (question_id);
create index if not exists full_mock_attempts_listening_idx
  on public.full_mock_attempts (listening_attempt_id);
create index if not exists full_mock_attempts_reading_idx
  on public.full_mock_attempts (reading_attempt_id);
create index if not exists full_mock_attempts_writing_idx
  on public.full_mock_attempts (writing_attempt_id);
create index if not exists mock_access_requests_code_idx
  on public.mock_access_requests (access_code_id);
create index if not exists mock_scheduled_sessions_set_idx
  on public.mock_scheduled_sessions (full_mock_set_id);


-- ------------------------------------------------------------
-- 2. Duplicate username index on profiles (keep the constraint's one)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'profiles_username_unique_idx')
     and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'profiles_username_key')
     and not exists (
       select 1 from pg_constraint c
       join pg_class i on i.oid = c.conindid
       where i.relname = 'profiles_username_unique_idx'
     ) then
    execute 'drop index public.profiles_username_unique_idx';
  end if;
end $$;


-- ------------------------------------------------------------
-- 3. Security rules: evaluate "who am I / am I a teacher" ONCE per
--    query instead of once per row.
--
--    Every policy in `public` that calls auth.uid() or one of the
--    no-argument role helpers (is_teacher(), is_admin(), is_examiner(),
--    is_mock_test_admin(), is_speaking_examiner(),
--    is_writing_examiner()) gets that call wrapped as (SELECT …), the
--    exact fix Supabase recommends (lint 0003 "auth_rls_initplan").
--    The result is the same value for every row, so the rule means
--    exactly the same thing — Postgres just stops re-computing it.
--    Already-wrapped calls are left alone, so re-running is harmless.
-- ------------------------------------------------------------
do $$
declare
  p record;
  new_qual text;
  new_check text;
  -- A call NOT already written as "( SELECT <call> AS …)". Postgres
  -- stores a wrapped call exactly that way, so the "not preceded by
  -- 'SELECT '" check is what makes re-running this a no-op.
  uid_re constant text := '(?<!SELECT )(?<![A-Za-z0-9_.])auth\.uid\(\)';
  fn_re constant text := '(?<!SELECT )(?<![A-Za-z0-9_.])((public\.)?(is_teacher|is_admin|is_examiner|is_mock_test_admin|is_speaking_examiner|is_writing_examiner)\(\))';
  sql text;
  changed int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    new_qual := p.qual;
    new_check := p.with_check;

    if new_qual is not null then
      new_qual := regexp_replace(new_qual, uid_re, '(SELECT auth.uid())', 'g');
      new_qual := regexp_replace(new_qual, fn_re, '(SELECT \1)', 'g');
    end if;
    if new_check is not null then
      new_check := regexp_replace(new_check, uid_re, '(SELECT auth.uid())', 'g');
      new_check := regexp_replace(new_check, fn_re, '(SELECT \1)', 'g');
    end if;

    if new_qual is distinct from p.qual or new_check is distinct from p.with_check then
      sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
      if new_qual is not null then
        sql := sql || format(' using (%s)', new_qual);
      end if;
      if new_check is not null then
        sql := sql || format(' with check (%s)', new_check);
      end if;
      execute sql;
      changed := changed + 1;
    end if;
  end loop;
  raise notice 'migration_64: % security rules optimized', changed;
end $$;


-- ------------------------------------------------------------
-- 4. Stop broadcasting tables nobody listens to over Realtime.
--    (The app only listens to: messages, group_messages, the chat
--    pins/reactions/deletions tables, private_chat_reads,
--    notifications, profiles, submissions, writing_mock_attempts,
--    mock_speaking_slots.)
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'full_mock_attempts', 'full_mock_sets', 'group_message_actions',
    'group_message_reads', 'homeworks', 'mock_access_codes',
    'mock_scheduled_sessions', 'wordlist_attempts', 'writing_mock_exams'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;


-- Fresh statistics so the planner starts using the new indexes now.
analyze public.notifications;
analyze public.submissions;
analyze public.homeworks;
analyze public.group_members;
analyze public.messages;
analyze public.wordlist_attempts;
analyze public.wordlist_items;

notify pgrst, 'reload schema';

-- ============================================================
-- NOTE — the biggest remaining cause of slowness is NOT fixable in
-- SQL: this Supabase project lives in Sydney, Australia
-- (ap-southeast-2), while every student is in Uzbekistan. Each request
-- spends ~350–400 ms (p90 ~1.1 s) just travelling there and back; the
-- database work itself takes 2–45 ms. Moving the project to Frankfurt
-- (eu-central-1) would cut that to roughly 60–120 ms per request.
-- ============================================================
