-- Migration 8: student-chosen target band
--
-- Adds a target_band column to profiles so each student can set their
-- own IELTS target (7.0-9.0, half-point steps) instead of the app
-- assuming everyone is aiming for the same score. Existing students
-- default to 7.5 and can change it anytime from Account Settings.
--
-- Run this once in Supabase -> SQL Editor -> New query, after
-- migrations 2-7.

alter table profiles
  add column if not exists target_band numeric(2, 1);

-- Half-point steps only, 7.0-9.0. Using a CHECK constraint (rather
-- than only validating in the app) means even a direct database edit
-- can't leave a student with an invalid target.
alter table profiles
  drop constraint if exists profiles_target_band_check;

alter table profiles
  add constraint profiles_target_band_check
  check (
    target_band is null
    or (
      target_band >= 7.0
      and target_band <= 9.0
      and (target_band * 2) = round(target_band * 2)
    )
  );

-- Every current student gets a sensible default so nothing in the
-- app has to handle "no target set yet" as a special case. Teachers
-- don't have a target band at all -- it isn't meaningful for them.
update profiles
set target_band = 7.5
where role = 'student'
  and target_band is null;
