-- ============================================================
-- Migration 31 — run this once in Supabase SQL Editor, after 29 & 30
--
-- migration_29 let an examiner SEE the student roster
-- (profiles_select_examiner_students). This is the missing other
-- direction: a STUDENT needs to see the two examiner profiles
-- (speaking_examiner / writing_examiner) too — to list them under
-- "Message Examiners" in the new Mock Test Center, to show an
-- examiner's name on a booked speaking slot, and so on.
--
-- Mirrors the existing "profiles_select_teacher_public" policy
-- exactly (same shape: public role+status check, no auth.uid()
-- needed) — additive only, nothing existing changes.
-- ============================================================

drop policy if exists "profiles_select_examiner_public" on public.profiles;
create policy "profiles_select_examiner_public" on public.profiles
  for select using (
    role in ('speaking_examiner', 'writing_examiner') and status = 'approved'
  );

-- ------------------------------------------------------------
-- Bug fix: migration_29's three writing-examiner policies checked
-- homeworks.homework_type = 'mock', but the Writing Mock Test system
-- (migration_19, HomeworkCard.jsx / GroupWorkspace.jsx) actually
-- stores it as 'writing_mock'. That typo meant those policies never
-- matched a single real row — a writing examiner's queries would
-- have silently come back empty instead of erroring, which is why
-- it's being caught and fixed here rather than surfacing on its own.
-- Re-created with the correct value; everything else about them is
-- unchanged from migration_29.
-- ------------------------------------------------------------
drop policy if exists "submissions_select_writing_examiner" on public.submissions;
create policy "submissions_select_writing_examiner" on public.submissions
  for select using (
    public.is_writing_examiner()
    and exists (
      select 1 from public.homeworks h
      where h.id = submissions.homework_id and h.homework_type = 'writing_mock'
    )
  );

drop policy if exists "submissions_update_writing_examiner" on public.submissions;
create policy "submissions_update_writing_examiner" on public.submissions
  for update using (
    public.is_writing_examiner()
    and exists (
      select 1 from public.homeworks h
      where h.id = submissions.homework_id and h.homework_type = 'writing_mock'
    )
  );

drop policy if exists "homeworks_select_writing_examiner" on public.homeworks;
create policy "homeworks_select_writing_examiner" on public.homeworks
  for select using (
    public.is_writing_examiner() and homework_type = 'writing_mock'
  );

notify pgrst, 'reload schema';
