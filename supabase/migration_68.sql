-- ============================================================
-- Migration 68 — URGENT fix (2026-10-02). Already applied live.
--
-- The nightly cleanup (Edge Function cleanup-submission-storage, cron
-- "cleanup-homework-files", 03:00 UTC) deletes files older than 5 days
-- from the buckets it is given — which included `homework-files`, where
-- the TEACHER's files live (mock listening audio, Task 1 charts, homework
-- attachments), and it also matched private-chat photos/voice in the
-- `submissions` bucket. Those must never be auto-deleted.
--
-- Now only students' homework uploads in `submissions` are candidates,
-- and chat media (paths containing /chat/) are skipped. Also: only the
-- service role may call this helper (it used to be callable by anyone,
-- which exposed file names).
-- ============================================================

create or replace function public.get_old_storage_files(p_bucket text, p_cutoff timestamptz, p_limit integer default 500)
returns table(name text)
language sql
security definer
set search_path = public, storage
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = p_bucket
    and p_bucket = 'submissions'          -- never auto-delete teacher files
    and o.name not like '%/chat/%'        -- keep private-chat media
    and o.created_at < p_cutoff
  order by o.created_at asc
  limit least(greatest(p_limit, 1), 500);
$$;

revoke all on function public.get_old_storage_files(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_old_storage_files(text, timestamptz, integer) to service_role;
