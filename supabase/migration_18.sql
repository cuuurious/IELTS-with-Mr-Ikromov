-- Migration 18 — Reply-to support for group chat
--
-- GroupChat.jsx already sends and reads a `reply_to_id` column on
-- every group message (swipe-to-reply, and the "Reply" menu item) —
-- migration_11's own notes assumed this column already existed on
-- group_messages from an earlier migration, but it turns out it never
-- actually got created there (only the private 1:1 `messages` table
-- got it). That's the exact cause of "Could not find the 'reply_to_id'
-- column of 'group_messages' in the schema cache" when replying in a
-- group chat. This migration just adds the missing column.
--
-- Only additive — safe to run more than once.

alter table group_messages
  add column if not exists reply_to_id uuid references group_messages(id) on delete set null;

-- PostgREST (what Supabase's client library talks to) caches the
-- table schema and only notices new columns after being told to
-- reload it — without this, the app can keep hitting the same
-- "could not find the column" error for a while even though the
-- column now exists.
notify pgrst, 'reload schema';
