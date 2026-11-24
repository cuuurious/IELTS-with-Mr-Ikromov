-- Migration 145: homework drafts (2026-11-24).
-- A student's unfinished practice page (writing paragraphs, reading answers, timer, Workshop
-- progress...) is kept here as well as on the device, so it survives a break, a closed tab,
-- cleared browser data or a different phone. One row per student per homework task; the row
-- is deleted when the student hands in. Safe to run more than once.
set lock_timeout = '8s';

create table if not exists public.homework_drafts (
  student_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null,
  data text not null,
  updated_at timestamptz not null default now(),
  primary key (student_id, task_id)
);

alter table public.homework_drafts enable row level security;

drop policy if exists "own drafts" on public.homework_drafts;
create policy "own drafts" on public.homework_drafts
  for all to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

create index if not exists homework_drafts_updated_idx on public.homework_drafts (updated_at);

-- Old drafts (60 days untouched) are removed whenever someone saves a new one.
create or replace function public.homework_drafts_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.homework_drafts where updated_at < now() - interval '60 days';
  return null;
end $$;
drop trigger if exists homework_drafts_cleanup_trg on public.homework_drafts;
create trigger homework_drafts_cleanup_trg after insert on public.homework_drafts
  for each statement execute function public.homework_drafts_cleanup();

notify pgrst, 'reload schema';

-- Check: expect table_ok = 1, policy_ok = 1
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='homework_drafts') as table_ok,
  (select count(*) from pg_policies where tablename='homework_drafts' and policyname='own drafts') as policy_ok;
