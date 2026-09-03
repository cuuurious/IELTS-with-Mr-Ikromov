-- Migration 9 — students can see the leaderboard
--
-- The leaderboard used to be powered by database functions (RPCs) that
-- ran with elevated privileges, so they could freely read every
-- student's submissions and completions to build the list. When the
-- leaderboard was rewritten to fix a streak/percentage mismatch bug, it
-- switched to normal table queries from the browser instead — which is
-- safer, but those queries are subject to Row Level Security (RLS) like
-- everything else. Students only ever had permission to read their OWN
-- profile / submissions / completions, so the leaderboard silently came
-- back empty (or showing only themselves) for every student.
--
-- This migration adds four narrow, additive read policies: a student
-- (or teacher) may read another person's profile / group membership /
-- submissions / homework completions ONLY when they share at least one
-- group. It does not remove or change any existing policy — it only
-- grants this one extra kind of access, scoped to groupmates.
--
-- Safe to run more than once.

drop policy if exists leaderboard_view_groupmate_profiles on profiles;
create policy leaderboard_view_groupmate_profiles
on profiles
for select
using (
  exists (
    select 1
    from group_members gm1
    join group_members gm2 on gm2.group_id = gm1.group_id
    where gm1.student_id = auth.uid()
      and gm2.student_id = profiles.id
  )
);

drop policy if exists leaderboard_view_groupmate_memberships on group_members;
create policy leaderboard_view_groupmate_memberships
on group_members
for select
using (
  exists (
    select 1
    from group_members gm
    where gm.group_id = group_members.group_id
      and gm.student_id = auth.uid()
  )
);

drop policy if exists leaderboard_view_groupmate_submissions on submissions;
create policy leaderboard_view_groupmate_submissions
on submissions
for select
using (
  exists (
    select 1
    from group_members gm
    where gm.group_id = submissions.group_id
      and gm.student_id = auth.uid()
  )
);

drop policy if exists leaderboard_view_groupmate_completions on homework_completions;
create policy leaderboard_view_groupmate_completions
on homework_completions
for select
using (
  exists (
    select 1
    from group_members gm
    where gm.group_id = homework_completions.group_id
      and gm.student_id = auth.uid()
  )
);
