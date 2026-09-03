-- Migration 13 — Pinned messages for private and group chats
--
-- Adds Telegram's "pin to top of chat" feature to both chat types.
-- A pinned message shows in a banner at the top of the conversation
-- that anyone in it can tap to jump straight to it. More than one
-- message can be pinned at a time (same as Telegram); the banner
-- always shows the most recently pinned one.
--
-- Who can pin:
--  - Private chat: either person, same as a real Telegram DM — there
--    is no "admin" in a 1:1 conversation.
--  - Group chat: the teacher only, same moderation role they already
--    have for deleting/removing messages.
--
-- Additive only, safe to run more than once.

-- ---------------------------------------------------------------
-- Private chats (messages)
-- ---------------------------------------------------------------

create table if not exists message_pins (
  message_id uuid primary key references messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  pinned_at timestamptz not null default now()
);

alter table message_pins enable row level security;

drop policy if exists message_pins_select on message_pins;
create policy message_pins_select
on message_pins
for select
using (
  exists (
    select 1 from messages m
    where m.id = message_pins.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);

drop policy if exists message_pins_insert on message_pins;
create policy message_pins_insert
on message_pins
for insert
with check (
  pinned_by = auth.uid()
  and exists (
    select 1 from messages m
    where m.id = message_pins.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);

drop policy if exists message_pins_delete on message_pins;
create policy message_pins_delete
on message_pins
for delete
using (
  exists (
    select 1 from messages m
    where m.id = message_pins.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);

-- ---------------------------------------------------------------
-- Group chats (group_messages)
-- ---------------------------------------------------------------

create table if not exists group_message_pins (
  message_id uuid primary key references group_messages(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  pinned_at timestamptz not null default now()
);

alter table group_message_pins enable row level security;

-- Visible to any member of the group, not just the teacher — a pin
-- is for everyone to see, unlike the per-user delete markers.
drop policy if exists group_message_pins_select on group_message_pins;
create policy group_message_pins_select
on group_message_pins
for select
using ( public.is_member_of_group(group_id) );

drop policy if exists group_message_pins_insert on group_message_pins;
create policy group_message_pins_insert
on group_message_pins
for insert
with check (
  pinned_by = auth.uid()
  and public.is_teacher()
  and public.is_member_of_group(group_id)
);

drop policy if exists group_message_pins_delete on group_message_pins;
create policy group_message_pins_delete
on group_message_pins
for delete
using (
  public.is_teacher()
  and public.is_member_of_group(group_id)
);

-- ---------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------
-- Both are brand new tables, so (like message_reactions in
-- migration_11) they need to be added to realtime explicitly, or the
-- pinned banner won't update live for anyone except the person who
-- pinned it. Guarded so running this twice doesn't error.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'message_pins'
  ) then
    alter publication supabase_realtime add table message_pins;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'group_message_pins'
  ) then
    alter publication supabase_realtime add table group_message_pins;
  end if;
end $$;
