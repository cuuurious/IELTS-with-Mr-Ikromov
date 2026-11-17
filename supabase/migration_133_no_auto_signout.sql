-- migration_133_no_auto_signout.sql (2026-11-17)
-- Students are no longer signed out when they use a second device.
-- Tracking stays: every different device is still logged in device_switches
-- (once per 12 hours per device pair) and the teacher's "Sign out everywhere"
-- button (sign_out_everywhere) still works. Safe to run more than once.

create or replace function public.check_device(p_device_id text, p_label text)
returns text
language plpgsql
security definer
set search_path to 'public'
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
    perform public.claim_device(p_device_id, p_label);
    return 'ok';
  end if;
  if v_row.device_id = p_device_id then
    if v_row.last_seen_at < now() - interval '5 minutes' then
      update public.device_sessions set last_seen_at = now() where user_id = v_uid and slot = v_slot;
    end if;
    return 'ok';
  end if;
  -- The teacher signed this student out: stay signed out until the next login.
  if v_row.device_id = 'signed-out-by-teacher' then
    return 'other:' || coalesce(nullif(v_row.label, ''), 'another device');
  end if;
  -- A different device: keep working, but leave a track for the teacher.
  if not exists (
    select 1 from public.device_switches
     where user_id = v_uid and from_device = v_row.device_id
       and to_device = left(p_device_id, 80)
       and created_at > now() - interval '12 hours'
  ) then
    insert into public.device_switches (user_id, from_device, from_label, to_device, to_label)
    values (v_uid, v_row.device_id, v_row.label, left(p_device_id, 80), left(coalesce(p_label, ''), 120));
  end if;
  return 'ok';
end;
$function$;

notify pgrst, 'reload schema';
select 'ok' as done;
