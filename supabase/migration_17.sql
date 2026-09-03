-- Migration 17 — Emoji reactions for group chat
--
-- GroupChat.jsx already has the full reaction feature built and wired
-- up (tap an emoji, see who reacted, live updates for everyone in the
-- chat) — it talks to a `group_message_reactions` table. That table
-- was simply never created. Private chats got the equivalent
-- `message_reactions` table back in migration 11; this is the same
-- feature for group chats, which somehow got missed.
--
-- Same shape as message_reactions: no group_id column on the table
-- itself — membership is checked by joining through group_messages to
-- find its group_id, exactly like message_reactions joins through
-- messages. Visible to, and usable by, any member of the group OR the
-- teacher — reactions are an everyday chat feature for everyone, not
-- a moderation tool restricted to the teacher (unlike pins, which are
-- teacher-only per migration 13/15).
--
-- IMPORTANT: the policies below use "is_member_of_group(...) OR
-- is_teacher()", never AND — a teacher is never a row in
-- group_members, so an AND would silently lock every teacher out of
-- reacting in their own group's chat. This exact mistake is what
-- migration 15 had to fix for group_message_pins; not repeating it
-- here.
--
-- Additive only, safe to run more than once.

create table if not exists group_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references group_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, reaction)
);

alter table group_message_reactions enable row level security;

drop policy if exists group_message_reactions_select on group_message_reactions;
create policy group_message_reactions_select
on group_message_reactions
for select
using (
  exists (
    select 1 from group_messages gm
    where gm.id = group_message_reactions.message_id
      and (public.is_member_of_group(gm.group_id) or public.is_teacher())
  )
);

drop policy if exists group_message_reactions_insert on group_message_reactions;
create policy group_message_reactions_insert
on group_message_reactions
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from group_messages gm
    where gm.id = group_message_reactions.message_id
      and (public.is_member_of_group(gm.group_id) or public.is_teacher())
  )
);

-- Only the person who added a reaction can remove it — same rule as
-- private-chat message_reactions (no teacher override; a reaction
-- isn't a moderation concern the way a whole message can be).
drop policy if exists group_message_reactions_delete on group_message_reactions;
create policy group_message_reactions_delete
on group_message_reactions
for delete
using ( user_id = auth.uid() );

-- Brand new table, so (like message_reactions in migration 11) it
-- needs to be added to realtime explicitly, or reactions won't appear
-- live for other people in the chat without a manual refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'group_message_reactions'
  ) then
    alter publication supabase_realtime add table group_message_reactions;
  end if;
end $$;
