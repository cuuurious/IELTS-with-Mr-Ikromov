-- migration_120_phone_plus_computer.sql (2026-11-09)
-- The one-device rule (migration_109) now allows ONE PHONE and ONE COMPUTER
-- at the same time. Most students do homework on their phone and tests on
-- the centre's computers; every switch used to sign the other device out
-- (66–89 students a day). Now:
--   * a phone (iPhone, iPad, Android) and a computer each have their own place;
--   * signing in on a SECOND phone (or a second computer) still signs the
--     old one out, so a shared login is still stopped and still reported;
--   * "Sign out everywhere" signs out both.
-- Safe to run more than once.

set lock_timeout = '8s';

-- Which place a device takes, from its label ("Android phone · Chrome").
create or replace function public.device_slot(p_label text)
returns text
language sql
immutable
as $$
  select case when coalesce(p_label, '') ~* '^(iphone|ipad|android)' then 'phone' else 'computer' end
$$;

alter table public.device_sessions add column if not exists slot text;
update public.device_sessions
   set slot = case when device_id = 'signed-out-by-teacher' then 'computer' else public.device_slot(label) end
 where slot is null;
alter table public.device_sessions alter column slot set not null;
alter table public.device_sessions alter column slot set default 'computer';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.device_sessions'::regclass and contype = 'p'
       and array_length(conkey, 1) = 1
  ) then
    alter table public.device_sessions drop constraint device_sessions_pkey;
    alter table public.device_sessions add constraint device_sessions_pkey primary key (user_id, slot);
  end if;
end $$;

-- After a successful sign-in: this device takes its place (phone or computer).
create or replace function public.claim_device(p_device_id text, p_label text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_slot text := public.device_slot(p_label);
  v_old public.device_sessions%rowtype;
begin
  if v_uid is null or coalesce(trim(p_device_id), '') = '' then
    return;
  end if;
  select * into v_old from public.device_sessions where user_id = v_uid and slot = v_slot for update;
  if v_old.user_id is not null and v_old.device_id is distinct from p_device_id
     and v_old.device_id <> 'signed-out-by-teacher' then
    insert into public.device_switches (user_id, from_device, from_label, to_device, to_label)
    values (v_uid, v_old.device_id, v_old.label, left(p_device_id, 80), left(coalesce(p_label, ''), 120));
  end if;
  insert into public.device_sessions (user_id, slot, device_id, label, claimed_at, last_seen_at)
  values (v_uid, v_slot, left(p_device_id, 80), left(coalesce(p_label, ''), 120), now(), now())
  on conflict (user_id, slot) do update
    set device_id = excluded.device_id, label = excluded.label, claimed_at = now(), last_seen_at = now();
end;
$function$;

-- Every minute while the site is open: does this device still hold its place?
-- Returns 'ok', or 'other:<label of the device that took over>'.
create or replace function public.check_device(p_device_id text, p_label text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_slot text := public.device_slot(p_label);
  v_row public.device_sessions%rowtype;
begin
  if v_uid is null or coalesce(trim(p_device_id), '') = '' then
    return 'ok';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = 'student') then
    return 'ok';
  end if;
  select * into v_row from public.device_sessions where user_id = v_uid and slot = v_slot;
  if v_row.user_id is null then
    -- First phone (or first computer) for this account: it takes the place.
    perform public.claim_device(p_device_id, p_label);
    return 'ok';
  end if;
  if v_row.device_id = p_device_id then
    if v_row.last_seen_at < now() - interval '5 minutes' then
      update public.device_sessions set last_seen_at = now() where user_id = v_uid and slot = v_slot;
    end if;
    return 'ok';
  end if;
  return 'other:' || coalesce(nullif(v_row.label, ''), 'another device');
end;
$function$;

-- Teacher: sign a student out on every device (phone and computer).
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
  insert into public.device_sessions (user_id, slot, device_id, label, claimed_at, last_seen_at)
  select p_user, s, 'signed-out-by-teacher', 'Mr Ikromov signed you out', now(), now()
    from unnest(array['phone', 'computer']) as s
  on conflict (user_id, slot) do update
    set device_id = 'signed-out-by-teacher', label = 'Mr Ikromov signed you out', claimed_at = now();
end;
$function$;

revoke all on function public.device_slot(text) from public, anon;
grant execute on function public.device_slot(text) to authenticated;
revoke all on function public.claim_device(text, text) from public, anon;
revoke all on function public.check_device(text, text) from public, anon;
revoke all on function public.sign_out_everywhere(uuid) from public, anon;
grant execute on function public.claim_device(text, text) to authenticated;
grant execute on function public.check_device(text, text) to authenticated;
grant execute on function public.sign_out_everywhere(uuid) to authenticated;

notify pgrst, 'reload schema';
