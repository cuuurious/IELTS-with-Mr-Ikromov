-- ============================================================
-- Migration 30 — run this once in Supabase SQL Editor
--
-- Small follow-up to migration_29, needed before the staff-account
-- creation/deletion flow below can safely delete a writing examiner:
-- lets that account be deleted later without being blocked by a
-- foreign key from submissions they've reviewed — the review itself
-- stays (band/feedback/reviewed_at untouched), only the "reviewed by
-- whom" link clears to null.
-- ============================================================

do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.submissions'::regclass
      and contype = 'f'
      and confrelid = 'public.profiles'::regclass
      and pg_get_constraintdef(oid) ilike '%examiner_reviewed_by%'
  loop
    execute format('alter table public.submissions drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.submissions
  add constraint submissions_examiner_reviewed_by_fkey
  foreign key (examiner_reviewed_by) references public.profiles(id) on delete set null;

notify pgrst, 'reload schema';
