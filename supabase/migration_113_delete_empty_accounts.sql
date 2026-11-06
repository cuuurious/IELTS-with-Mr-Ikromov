-- migration_113_delete_empty_accounts.sql (2026-11-06)
-- Deletes the empty sign-in accounts: accounts with NO student/teacher
-- profile (sign-ups that never finished, Aug–Sep 2026). They have no
-- homework, no results, no messages — nothing else points to them.
-- Deleting them stops "Forgot password" from resetting the wrong account.
--
-- Kept on purpose:
--   * anything made in the last 2 days (someone may be signing up now);
--   * the mock-test admin login (you@example.com).
-- This cannot be undone. On 2026-11-06 it matched 46 accounts.

set lock_timeout = '8s';

-- 1. See what will be deleted (optional: run this part alone first).
select u.email, u.created_at::date as created, u.last_sign_in_at::date as last_sign_in
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
   and u.created_at < now() - interval '2 days'
   and not exists (select 1 from public.mock_test_admins a where a.user_id = u.id)
   and not exists (select 1 from public.speaking_spin_admins a where a.user_id = u.id)
   and not exists (select 1 from public.mock_attempts m where m.user_id = u.id)
   and not exists (select 1 from public.mock_exams m where m.created_by = u.id)
 order by u.created_at;

-- 2. Delete them.
with gone as (
  delete from auth.users u
   where not exists (select 1 from public.profiles p where p.id = u.id)
     and u.created_at < now() - interval '2 days'
     and not exists (select 1 from public.mock_test_admins a where a.user_id = u.id)
     and not exists (select 1 from public.speaking_spin_admins a where a.user_id = u.id)
     and not exists (select 1 from public.mock_attempts m where m.user_id = u.id)
     and not exists (select 1 from public.mock_exams m where m.created_by = u.id)
  returning 1
)
select count(*) as deleted_accounts from gone;
