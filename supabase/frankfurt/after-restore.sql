-- ============================================================
-- FRANKFURT MOVE — run on the NEW project after the restore
-- (SQL Editor of the new project). Updated 2026-11-17.
--
-- Before running, replace these placeholders (search for "NEWREF" and "<"):
--   NEWREF           -> the new project's ref (the part before .supabase.co)
--   <CLEANUP_TOKEN>  -> old project: select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_token';
--   <NOTIFY_SECRET>  -> same, name = 'notify_telegram_secret'
--   <PARENT_SMS_SECRET> -> same, name = 'parent_sms_secret'
--
-- Vault secrets are encrypted per project, so they never travel in the
-- dump — they are created again here. Safe to run again (it skips what exists).
-- ============================================================

-- 0. Stop here if a placeholder was forgotten.
do $$
begin
  if 'NEWREF' <> 'NEW' || 'REF' then
    null; -- placeholder was replaced, fine
  else
    raise exception 'Replace NEWREF with the new project ref first.';
  end if;
end $$;

-- 1. Vault secrets (only the ones that are missing)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cleanup_token') then
    perform vault.create_secret('<CLEANUP_TOKEN>', 'cleanup_token');
  end if;
  if not exists (select 1 from vault.secrets where name = 'notify_telegram_secret') then
    perform vault.create_secret('<NOTIFY_SECRET>', 'notify_telegram_secret');
  end if;
  if not exists (select 1 from vault.secrets where name = 'parent_sms_secret') then
    perform vault.create_secret('<PARENT_SMS_SECRET>', 'parent_sms_secret');
  end if;
end $$;

-- 2. Every saved link to a file (avatars, homework photos, audio, chat
--    media, attachments) contains the OLD project address. Rewrite it in
--    every text / jsonb / text[] column of the public schema.
do $$
declare
  c record;
  v_old text := 'grdfwleehlgoooizyowz.supabase.co';
  v_new text := 'NEWREF.supabase.co';
  n bigint;
begin
  if v_new = 'NEW' || 'REF.supabase.co' then
    raise exception 'Replace NEWREF with the new project ref first.';
  end if;
  for c in
    select table_name, column_name, data_type, udt_name
      from information_schema.columns
     where table_schema = 'public'
       and (data_type in ('text', 'character varying', 'jsonb') or udt_name = '_text')
       and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
  loop
    if c.data_type = 'jsonb' then
      execute format('update public.%I set %I = replace(%I::text, %L, %L)::jsonb where %I::text like %L',
                     c.table_name, c.column_name, c.column_name, v_old, v_new, c.column_name, '%' || v_old || '%');
    elsif c.udt_name = '_text' then
      execute format('update public.%I set %I = replace(%I::text, %L, %L)::text[] where %I::text like %L',
                     c.table_name, c.column_name, c.column_name, v_old, v_new, c.column_name, '%' || v_old || '%');
    else
      execute format('update public.%I set %I = replace(%I, %L, %L) where %I like %L',
                     c.table_name, c.column_name, c.column_name, v_old, v_new, c.column_name, '%' || v_old || '%');
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      raise notice '% rows updated in %.%', n, c.table_name, c.column_name;
    end if;
  end loop;
end $$;

-- 3. Functions that call the project by its address. Today:
--    post_group_lesson, notifications_to_telegram, telegram_bot_followup
--    (any new one is caught automatically).
do $$
declare
  f record;
  v_def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc ilike '%grdfwleehlgoooizyowz%'
  loop
    v_def := replace(pg_get_functiondef(f.oid), 'grdfwleehlgoooizyowz', 'NEWREF');
    execute v_def;
  end loop;
end $$;

-- 4. Scheduled jobs (pg_cron). The old project has five. Remove whatever
--    came across and create all five again with the new address.
do $$
declare j text;
begin
  foreach j in array array['cleanup-homework-files','parent-sms-daily','post-lesson-homework','weekly-teacher-report','monthly-report-reminder'] loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
    end if;
  end loop;
end $$;

select cron.schedule('cleanup-homework-files', '0 3 * * *', $job$
  select net.http_post(
    url := 'https://NEWREF.supabase.co/functions/v1/cleanup-submission-storage',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cleanup-token',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_token')
    ),
    body := '{"dry_run":false}'::jsonb,
    timeout_milliseconds := 10000
  ) as request_id;
$job$);

select cron.schedule('parent-sms-daily', '0 4 * * *', $job$
  select net.http_post(
    url := 'https://NEWREF.supabase.co/functions/v1/parent-sms',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'parent_sms_secret')
    ),
    body := '{"mode":"run"}'::jsonb,
    timeout_milliseconds := 150000
  );
$job$);

select cron.schedule('post-lesson-homework', '*/5 * * * *', 'select public.post_due_lessons()');
select cron.schedule('weekly-teacher-report', '0 3 * * 1', 'select public.weekly_teacher_report()');
select cron.schedule('monthly-report-reminder', '0 4 1 * *', 'select public.monthly_report_reminder()');

-- 5. Realtime (live chat). Must list these 14 tables; add any that is missing.
do $$
declare t text;
begin
  foreach t in array array['group_message_deletions','group_message_pins','group_message_reactions','group_messages','materials','message_deletions','message_pins','message_reactions','messages','mock_speaking_slots','private_chat_reads','profiles','submissions','writing_mock_attempts'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 6. CHECKS. Every line below must look as described.
-- 6a. Nothing may still point at the old project -> must return NO rows.
select 'function' as kind, proname::text as name from pg_proc where prosrc ilike '%grdfwleehlgoooizyowz%'
union all
select 'cron job', jobname from cron.job where command ilike '%grdfwleehlgoooizyowz%';

-- 6b. Counts to compare with the old project (old: 209 users, 209 identities, 5 cron jobs, 3 vault secrets, 14 realtime tables).
select (select count(*) from auth.users) users,
       (select count(*) from auth.identities) identities,
       (select count(*) from cron.job) cron_jobs,
       (select count(*) from vault.secrets) vault_secrets,
       (select count(*) from pg_publication_tables where pubname = 'supabase_realtime') realtime_tables;

notify pgrst, 'reload schema';
