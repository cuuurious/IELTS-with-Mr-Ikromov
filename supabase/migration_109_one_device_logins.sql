-- migration_109_one_device_logins.sql (2026-11-06)
-- One device at a time for students (stops shared logins):
--   * signing in on a device makes it THE device for that account;
--   * any other device that is still open is signed out within a minute
--     ("Your account was opened on another device");
--   * every switch between devices is logged, and Mr Ikromov sees the
--     students whose account keeps jumping between devices, with a
--     "Sign out everywhere" button.
-- Teachers and examiners are not limited. Safe to run more than once.

set lock_timeout = '8s';

create table if not exists public.device_sessions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  device_id text not null,
  label text not null default '',
  claimed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.device_sessions enable row level security;
drop policy if exists device_sessions_read on public.device_sessions;
create policy device_sessions_read on public.device_sessions
  for select using (user_id = (select auth.uid()) or (select public.is_teacher()));

create table if not exists public.device_switches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_device text,
  from_label text,
  to_device text not null,
  to_label text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists device_switches_user on public.device_switches (user_id, created_at desc);
alter table public.device_switches enable row level security;
drop policy if exists device_switches_read on public.device_switches;
create policy device_switches_read on public.device_switches
  for select using ((select public.is_teacher()));

-- After a successful sign-in: this device becomes the account's device.
create or replace function public.claim_device(p_device_id text, p_label text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_old public.device_sessions%rowtype;
begin
  if v_uid is null or coalesce(trim(p_device_id), '') = '' then
    return;
  end if;
  select * into v_old from public.device_sessions where user_id = v_uid for update;
  if v_old.user_id is not null and v_old.device_id is distinct from p_device_id then
    insert into public.device_switches (user_id, from_device, from_label, to_device, to_label)
    values (v_uid, v_old.device_id, v_old.label, left(p_device_id, 80), left(coalesce(p_label, ''), 120));
  end if;
  insert into public.device_sessions (user_id, device_id, label, claimed_at, last_seen_at)
  values (v_uid, left(p_device_id, 80), left(coalesce(p_label, ''), 120), now(), now())
  on conflict (user_id) do update
    set device_id = excluded.device_id, label = excluded.label, claimed_at = now(), last_seen_at = now();
end;
$function$;

-- Every minute while the site is open: is this still the account's device?
-- Returns 'ok', or 'other:<label of the device that took over>'.
create or replace function public.check_device(p_device_id text, p_label text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_row public.device_sessions%rowtype;
begin
  if v_uid is null or coalesce(trim(p_device_id), '') = '' then
    return 'ok';
  end if;
  -- Only students are limited to one device.
  if not exists (select 1 from public.profiles where id = v_uid and role = 'student') then
    return 'ok';
  end if;
  select * into v_row from public.device_sessions where user_id = v_uid;
  if v_row.user_id is null then
    -- Signed in before this feature: this device becomes the account's device.
    perform public.claim_device(p_device_id, p_label);
    return 'ok';
  end if;
  if v_row.device_id = p_device_id then
    if v_row.last_seen_at < now() - interval '5 minutes' then
      update public.device_sessions set last_seen_at = now() where user_id = v_uid;
    end if;
    return 'ok';
  end if;
  return 'other:' || coalesce(nullif(v_row.label, ''), 'another device');
end;
$function$;

-- Teacher: students whose account moved between devices often.
create or replace function public.shared_login_report(p_days integer default 14)
returns table(user_id uuid, full_name text, switches integer, devices integer, labels text, last_switch timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if not public.is_teacher() then
    raise exception 'Only a teacher can see this.';
  end if;
  return query
  select s.user_id,
         coalesce(p.full_name, p.username, '')::text,
         count(*)::integer,
         count(distinct s.to_device)::integer,
         left(string_agg(distinct nullif(s.to_label, ''), ' · '), 200),
         max(s.created_at)
    from public.device_switches s
    join public.profiles p on p.id = s.user_id
   where s.created_at >= now() - make_interval(days => greatest(1, least(p_days, 90)))
     and p.role = 'student'
   group by s.user_id, p.full_name, p.username
  having count(*) >= 2
   order by count(*) desc, max(s.created_at) desc;
end;
$function$;

-- Teacher: sign a student out on every device (they sign in again).
create or replace function public.sign_out_everywhere(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.is_teacher() then
    raise exception 'Only a teacher can do this.';
  end if;
  insert into public.device_sessions (user_id, device_id, label, claimed_at, last_seen_at)
  values (p_user, 'signed-out-by-teacher', 'Mr Ikromov signed you out', now(), now())
  on conflict (user_id) do update
    set device_id = 'signed-out-by-teacher', label = 'Mr Ikromov signed you out', claimed_at = now();
end;
$function$;

revoke all on function public.claim_device(text, text) from public, anon;
revoke all on function public.check_device(text, text) from public, anon;
revoke all on function public.shared_login_report(integer) from public, anon;
revoke all on function public.sign_out_everywhere(uuid) from public, anon;
grant execute on function public.claim_device(text, text) to authenticated;
grant execute on function public.check_device(text, text) to authenticated;
grant execute on function public.shared_login_report(integer) to authenticated;
grant execute on function public.sign_out_everywhere(uuid) to authenticated;

notify pgrst, 'reload schema';
