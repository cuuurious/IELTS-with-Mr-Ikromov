-- migration_123_disk_io_savers.sql (2026-11-10)
-- Supabase warned that the project is about to use up its Disk IO budget.
-- This lowers the database's disk work. Safe to run more than once.
--
-- 1. Live database feed (Realtime "postgres_changes"): take out the two
--    tables nobody needs live any more. The notification bell now checks
--    once a minute instead of listening (code change), and homework test
--    answers were never listened to. Fewer tables in the feed = less of
--    the change log to read and check.
-- 2. Notifications: indexes that match how the site actually asks
--    ("my unread ones, newest first" and "mark read by link").
-- 3. Word lists: a student's access to words is now worked out once per
--    request instead of once per word (it ran for all 1,600 words on
--    every Home visit).
-- 4. The Supabase dashboard's own "list functions" query sorts on disk
--    (8 GB so far) because the work memory is tiny (2 MB). Give the
--    dashboard's login (postgres) 16 MB; students' requests don't use it.

set lock_timeout = '8s';

-- 1. Realtime feed
do $$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime drop table public.notifications;
  end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'homework_attempts') then
    alter publication supabase_realtime drop table public.homework_attempts;
  end if;
end $$;

-- 2. Notifications indexes
create index if not exists notifications_user_read_created_idx
  on public.notifications (user_id, read, created_at desc);
create index if not exists notifications_user_link_idx
  on public.notifications (user_id, link);

-- 3. Word lists: the ids of the word lists this user may see, worked out once.
create or replace function public.my_wordlist_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $function$
  select wlg.wordlist_id
    from public.wordlist_groups wlg
    join public.group_members gm on gm.group_id = wlg.group_id
   where gm.student_id = auth.uid()
$function$;
revoke all on function public.my_wordlist_ids() from public, anon;
grant execute on function public.my_wordlist_ids() to authenticated;

drop policy if exists wli_select_member on public.wordlist_items;
create policy wli_select_member on public.wordlist_items
  for select using (wordlist_id in (select public.my_wordlist_ids()));

-- 4. More sort memory for the dashboard's login only.
alter role postgres set work_mem = '16MB';

notify pgrst, 'reload schema';

-- Check: expect notifications=false, homework_attempts=false, indexes=2, policy uses my_wordlist_ids
select
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') as notifications_in_feed,
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'homework_attempts') as homework_attempts_in_feed,
  (select count(*) from pg_indexes where indexname in ('notifications_user_read_created_idx', 'notifications_user_link_idx')) as new_indexes,
  (select qual from pg_policies where tablename = 'wordlist_items' and policyname = 'wli_select_member') as word_policy;
