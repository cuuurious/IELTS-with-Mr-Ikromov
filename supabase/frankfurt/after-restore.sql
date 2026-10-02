-- ============================================================
-- FRANKFURT MOVE — run on the NEW project after the restore
-- (SQL Editor of the new project). Prepared 2026-10-02.
--
-- Before running, replace the three placeholders:
--   NEWREF            → the new project's ref (the part before .supabase.co)
--   <CLEANUP_TOKEN>   → same value as in the old project's Vault "cleanup_token"
--                       (old project → SQL: select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_token';)
--   <NOTIFY_SECRET>   → same for "notify_telegram_secret"
--
-- Vault secrets are encrypted per project, so they never travel in the
-- dump — they must be created again here.
-- ============================================================

-- 1. Vault secrets
select vault.create_secret('<CLEANUP_TOKEN>', 'cleanup_token');
select vault.create_secret('<NOTIFY_SECRET>', 'notify_telegram_secret');

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

-- 3. Functions that call the project by its address.
--    (Today only notifications_to_telegram; re-check with:
--     select proname from pg_proc where prosrc ilike '%grdfwleehlgoooizyowz%';)
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

-- 4. Scheduled jobs (pg_cron) — recreate with the new address.
--    Check what came across first:  select jobname, schedule, command from cron.job;
--    The old project has one job, "cleanup-homework-files" (03:00 UTC daily),
--    which calls the cleanup-submission-storage function. Recreated here
--    with the new address:
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cleanup-homework-files') then
    perform cron.unschedule('cleanup-homework-files');
  end if;
end $$;
select cron.schedule(
  'cleanup-homework-files',
  '0 3 * * *',
  $job$
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
  $job$
);

-- 5. Check nothing still points at the old project.
select 'function' as kind, proname as name from pg_proc where prosrc ilike '%grdfwleehlgoooizyowz%'
union all
select 'cron job', jobname from cron.job where command ilike '%grdfwleehlgoooizyowz%';
-- → should return no rows.

notify pgrst, 'reload schema';
