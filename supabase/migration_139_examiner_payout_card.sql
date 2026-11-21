-- Migration 139: examiner payout card (2026-11-21).
-- Examiners enter the card their pay goes to. The examiner, the admin
-- (profiles.is_admin, Jasur) and approved students (so they can pay for a
-- session or essay check) can read it. No CVV and no expiry date are stored.
-- Safe to run more than once.

create table if not exists public.examiner_payout_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  card_number text not null check (card_number ~ '^[0-9]{16}$'),
  card_holder text not null check (char_length(btrim(card_holder)) between 2 and 80),
  card_type text not null default 'Humo' check (card_type in ('Uzcard', 'Humo', 'Visa', 'Mastercard', 'Other')),
  updated_at timestamptz not null default now()
);

alter table public.examiner_payout_details enable row level security;

create or replace function public.is_site_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

drop policy if exists payout_select on public.examiner_payout_details;
create policy payout_select on public.examiner_payout_details
  for select using (
    user_id = auth.uid()
    or public.is_site_admin()
    or exists (select 1 from public.profiles s where s.id = auth.uid() and s.role = 'student' and s.status = 'approved')
  );

drop policy if exists payout_insert on public.examiner_payout_details;
create policy payout_insert on public.examiner_payout_details
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('speaking_examiner', 'writing_examiner'))
  );

drop policy if exists payout_update on public.examiner_payout_details;
create policy payout_update on public.examiner_payout_details
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists payout_delete on public.examiner_payout_details;
create policy payout_delete on public.examiner_payout_details
  for delete using (user_id = auth.uid());

notify pgrst, 'reload schema';

-- Check: expect table_found = 1, policies = 4
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'examiner_payout_details') as table_found,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'examiner_payout_details') as policies;
