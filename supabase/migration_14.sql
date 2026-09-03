-- Migration 14 — Profiles: avatar photo, bio, and a real username
-- uniqueness guarantee
--
-- Adds the fields the new profile popup (opened by tapping someone's
-- name or avatar in either chat) needs, plus lets people change their
-- own avatar photo, bio, and username from Account Settings.
--
-- Run this AFTER migrations 10-13. Additive only, safe to run more
-- than once — except the very last step (the username uniqueness
-- index), which is explained below.

-- ---------------------------------------------------------------
-- New profile fields
-- ---------------------------------------------------------------

alter table profiles add column if not exists bio text;
alter table profiles add column if not exists avatar_url text;

alter table profiles drop constraint if exists profiles_bio_length_check;
alter table profiles
  add constraint profiles_bio_length_check
  check (bio is null or char_length(bio) <= 300);

-- ---------------------------------------------------------------
-- Avatar storage
-- ---------------------------------------------------------------
-- A new public bucket, separate from the existing chat-upload
-- buckets, just for profile photos. Anyone can view an avatar (they
-- show up in chat), but a person can only upload/replace/remove the
-- one filed under their own user id — enforced by requiring the
-- first folder in the file's path to equal their own auth id, e.g.
-- avatars/<user id>/photo.jpg.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
create policy "Avatar images are publicly accessible"
on storage.objects
for select
using ( bucket_id = 'avatars' );

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects
for insert
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
on storage.objects
for update
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
on storage.objects
for delete
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------
-- Username uniqueness
-- ---------------------------------------------------------------
-- The new "change username" option in Account Settings checks
-- availability before saving, but that check-then-save has a race
-- window without a real database constraint backing it up. This adds
-- one.
--
-- IMPORTANT: if any two accounts already share a username today, this
-- one statement will fail with a "duplicate key" error and nothing
-- above it will be undone (everything above already succeeded before
-- this line runs). That would be unexpected — usernames have always
-- been assigned at registration — but if it does happen, stop here
-- and let me know the error message so I can help find and fix the
-- duplicate before re-running just this last line.

create unique index if not exists profiles_username_unique_idx
  on profiles (username);
