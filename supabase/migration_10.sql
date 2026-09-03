-- Migration 10 — fixes a login-breaking bug from migration_9
--
-- migration_9.sql added a policy on group_members that checks group
-- membership by querying group_members from inside its own permission
-- rule. Postgres does not allow a Row-Level-Security-protected table to
-- safely check itself like that — it can end up needing to check itself
-- checking itself, and the database refuses ("infinite recursion
-- detected in policy"). Because the new profiles policy also depended
-- on that same group_members check, this broke normal profile loading
-- for EVERYONE, teacher included, which is why the app started showing
-- "Waiting for approval" even for already-approved accounts.
--
-- The fix: move the "does this person share a group with me" check into
-- its own function that runs with elevated privileges (SECURITY
-- DEFINER), so it can read group_members directly without re-triggering
-- group_members' own permission rules. The four policies from
-- migration_9 are dropped and recreated using that function — same
-- end result (students can see their groupmates on the leaderboard),
-- just without the self-referencing check that broke login.
--
-- Safe to run more than once.

drop policy if exists leaderboard_view_groupmate_profiles on profiles;
drop policy if exists leaderboard_view_groupmate_memberships on group_members;
drop policy if exists leaderboard_view_groupmate_submissions on submissions;
drop policy if exists leaderboard_view_groupmate_completions on homework_completions;

-- Returns true if the currently logged-in user is a member of the
-- given group. SECURITY DEFINER makes this function read group_members
-- with its own (elevated) privileges instead of the caller's, so it
-- does not re-trigger group_members' own row-level security policies
-- — which is what avoids the recursion.
create or replace function public.is_member_of_group(target_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from group_members gm
    where gm.group_id = target_group_id
      and gm.student_id = auth.uid()
  );
$$;

-- Returns true if the currently logged-in user shares at least one
-- group with the given person. Same reasoning as above.
create or replace function public.shares_group_with(other_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id
    where gm1.student_id = auth.uid()
      and gm2.student_id = other_user_id
  );
$$;

create policy leaderboard_view_groupmate_profiles
on profiles
for select
using ( public.shares_group_with(profiles.id) );

create policy leaderboard_view_groupmate_memberships
on group_members
for select
using ( public.is_member_of_group(group_members.group_id) );

create policy leaderboard_view_groupmate_submissions
on submissions
for select
using ( public.is_member_of_group(submissions.group_id) );

create policy leaderboard_view_groupmate_completions
on homework_completions
for select
using ( public.is_member_of_group(homework_completions.group_id) );
