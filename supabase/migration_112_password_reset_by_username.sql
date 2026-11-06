-- migration_112_password_reset_by_username.sql (2026-11-06)
-- "Forgot password" now finds the STUDENT'S OWN account from the username
-- (or the email) they type, so the reset link always goes to the account
-- they sign in with.
--
-- Why: some students have a second, empty account (an email sign-up that
-- never finished — no profile). Resetting by email reset THAT account, so
-- signing in with their username still said "wrong password".
--
-- Returns, for a username or an email:
--   the email to send the link to   — a real student/teacher account
--   'no-email'                      — the account signs in with a username only
--   null                            — no such account (or an empty one)
-- Safe to run more than once.

set lock_timeout = '8s';

create or replace function public.password_reset_target(p_login text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_login text := lower(trim(coalesce(p_login, '')));
  v_email text;
begin
  if v_login = '' then
    return null;
  end if;

  if position('@' in v_login) > 0 then
    -- An email: only an account that has a profile counts.
    select u.email into v_email
      from auth.users u
      join public.profiles p on p.id = u.id
     where lower(u.email) = v_login
     limit 1;
  else
    select u.email into v_email
      from public.profiles p
      join auth.users u on u.id = p.id
     where lower(trim(p.username)) = v_login
     limit 1;
  end if;

  if v_email is null then
    return null;
  end if;
  if v_email like '%@users.ielts-mrikromov.app' then
    return 'no-email';
  end if;
  return v_email;
end;
$function$;

revoke all on function public.password_reset_target(text) from public;
grant execute on function public.password_reset_target(text) to anon, authenticated;

-- Check: how many student accounts can reset by email, and how many need
-- Mr Ikromov (username-only), plus the empty accounts (no profile).
select
  count(*) filter (where p.id is not null and u.email not like '%@users.ielts-mrikromov.app') as can_reset_by_email,
  count(*) filter (where p.id is not null and u.email like '%@users.ielts-mrikromov.app') as username_only,
  count(*) filter (where p.id is null) as empty_accounts
from auth.users u
left join public.profiles p on p.id = u.id;

notify pgrst, 'reload schema';
