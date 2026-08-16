-- ============================================================
-- Migration 2 — run this once in Supabase SQL Editor
-- Adds: homework deadlines, per-homework speaking toggle,
--       student comments on submissions, optional recovery email.
-- Safe to run even if some of these already exist.
-- ============================================================

alter table public.homeworks
  add column if not exists due_date timestamptz,
  add column if not exists enable_speaking boolean not null default false;

alter table public.submissions
  add column if not exists comment text;

alter table public.profiles
  add column if not exists contact_email text;

-- Widen the groups list to be visible to anyone, including visitors who
-- haven't registered yet (needed so the sign-up screen can show group
-- choices). Only needed once — skip if you already ran this earlier.
drop policy if exists "groups_select_authenticated" on public.groups;
drop policy if exists "groups_select_public" on public.groups;
create policy "groups_select_public" on public.groups for select using (true);

-- Allow the teacher (and the group's own creator) to rename a group.
drop policy if exists "groups_update_teacher" on public.groups;
create policy "groups_update_teacher" on public.groups
  for update using (public.is_teacher());
