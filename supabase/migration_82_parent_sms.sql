-- migration_82_parent_sms.sql (2026-10-19)
-- SMS to parents when a student misses homework.
--   * The teacher stores each student's parent phone number. Only staff
--     with the teacher role can read or change it; students never see it.
--   * One settings row: on/off and the message text the teacher writes.
--   * A per-group switch (groups.parent_sms_enabled) and a per-student
--     switch (parent_phones.sms_enabled).
--   * A log of every SMS the site sends (or failed to send). The unique
--     index makes sure a parent gets at most one SMS per student per day,
--     even if the daily job runs twice.
-- The SMS itself is sent by the parent-sms Edge Function (Eskiz.uz).
-- Section 5 schedules it every morning at 9:00 Tashkent with pg_cron.
-- Safe to run more than once.

-- 1. Parent phone numbers ------------------------------------------------
create table if not exists public.parent_phones (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  -- Uzbek mobile number, stored as 998XXXXXXXXX (12 digits, no plus).
  phone text not null check (phone ~ '^998[0-9]{9}$'),
  parent_name text not null default '',
  sms_enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

create index if not exists parent_phones_updated_by_idx on public.parent_phones (updated_by);

create or replace function public.touch_parent_phone()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$function$;

drop trigger if exists trg_touch_parent_phone on public.parent_phones;
create trigger trg_touch_parent_phone
  before update on public.parent_phones
  for each row execute function public.touch_parent_phone();

alter table public.parent_phones enable row level security;

drop policy if exists parent_phones_teacher_all on public.parent_phones;
create policy parent_phones_teacher_all on public.parent_phones
  for all to authenticated
  using ((select public.is_teacher()))
  with check ((select public.is_teacher()));

grant select, insert, update, delete on public.parent_phones to authenticated;

-- 2. Settings (a single row, id = 1) ----------------------------------
create table if not exists public.parent_sms_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  template text not null default '',
  -- Weekdays the automatic SMS goes out (1 = Monday … 7 = Sunday).
  send_days smallint[] not null default '{1,2,3,4,5,6,7}'
    check (send_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  -- missed: only parents whose child missed homework since the last
  -- sending day. all: every parent whose student has automatic SMS on.
  audience text not null default 'missed' check (audience in ('missed', 'all')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.parent_sms_settings (id) values (1) on conflict (id) do nothing;

create index if not exists parent_sms_settings_updated_by_idx on public.parent_sms_settings (updated_by);

create or replace function public.touch_parent_sms_settings()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$function$;

drop trigger if exists trg_touch_parent_sms_settings on public.parent_sms_settings;
create trigger trg_touch_parent_sms_settings
  before update on public.parent_sms_settings
  for each row execute function public.touch_parent_sms_settings();

alter table public.parent_sms_settings enable row level security;

drop policy if exists parent_sms_settings_select on public.parent_sms_settings;
create policy parent_sms_settings_select on public.parent_sms_settings
  for select to authenticated using ((select public.is_teacher()));

drop policy if exists parent_sms_settings_update on public.parent_sms_settings;
create policy parent_sms_settings_update on public.parent_sms_settings
  for update to authenticated
  using ((select public.is_teacher()))
  with check ((select public.is_teacher()));

grant select, update on public.parent_sms_settings to authenticated;

-- 3. Per-group switch ----------------------------------------------------
alter table public.groups
  add column if not exists parent_sms_enabled boolean not null default true;

-- 4. Log -----------------------------------------------------------------
create table if not exists public.parent_sms_log (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles(id) on delete cascade,
  phone text not null,
  message text not null,
  homework_ids uuid[] not null default '{}',
  -- Tashkent date of the morning it was sent for.
  for_date date not null,
  -- auto = the 9:00 job, manual = teacher pressed Send now, test = test SMS
  kind text not null default 'auto' check (kind in ('auto', 'manual', 'test')),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);

-- One automatic SMS per student per day, whatever happens.
create unique index if not exists parent_sms_log_once_per_day
  on public.parent_sms_log (student_id, for_date)
  where kind = 'auto';
create index if not exists parent_sms_log_created_idx on public.parent_sms_log (created_at desc);

alter table public.parent_sms_log enable row level security;

-- Teachers read the log; only the Edge Function (service role) writes it.
drop policy if exists parent_sms_log_select on public.parent_sms_log;
create policy parent_sms_log_select on public.parent_sms_log
  for select to authenticated using ((select public.is_teacher()));

grant select on public.parent_sms_log to authenticated;

-- 5. Daily run at 9:00 Tashkent (04:00 UTC) ---------------------------
-- pg_cron calls the Edge Function with a random secret kept in the
-- vault; the function checks it with check_parent_sms_secret().
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'parent_sms_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'parent_sms_secret');
  end if;
end $$;

create or replace function public.check_parent_sms_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, vault
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'parent_sms_secret' and decrypted_secret = p_secret
  );
$$;

revoke all on function public.check_parent_sms_secret(text) from public, anon, authenticated;
grant execute on function public.check_parent_sms_secret(text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'parent-sms-daily';
select cron.schedule(
  'parent-sms-daily',
  '0 4 * * *',
  $job$
  select net.http_post(
    url := 'https://grdfwleehlgoooizyowz.supabase.co/functions/v1/parent-sms',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'parent_sms_secret')
    ),
    body := '{"mode":"run"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);

notify pgrst, 'reload schema';
