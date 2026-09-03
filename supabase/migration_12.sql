-- Migration 12 — "Delete for me" (Telegram-style) for private and
-- group chats
--
-- Both chats already support "delete for everyone" (a real DELETE,
-- only allowed for the sender, or the teacher moderating). This
-- migration adds the other half of Telegram's delete menu: "delete
-- for me" — any participant can hide any message from their OWN
-- view, without touching what anyone else sees.
--
-- That's implemented as a per-user marker row rather than an actual
-- delete: each table below just records "user X does not want to see
-- message Y anymore". The app filters those out client-side. Nothing
-- already working is touched — additive only, safe to run more than
-- once.

-- ---------------------------------------------------------------
-- Private chats (messages)
-- ---------------------------------------------------------------

create table if not exists message_deletions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table message_deletions enable row level security;

drop policy if exists message_deletions_select on message_deletions;
create policy message_deletions_select
on message_deletions
for select
using ( user_id = auth.uid() );

drop policy if exists message_deletions_insert on message_deletions;
create policy message_deletions_insert
on message_deletions
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from messages m
    where m.id = message_deletions.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);

drop policy if exists message_deletions_delete on message_deletions;
create policy message_deletions_delete
on message_deletions
for delete
using ( user_id = auth.uid() );

-- ---------------------------------------------------------------
-- Group chats (group_messages)
-- ---------------------------------------------------------------

create table if not exists group_message_deletions (
  message_id uuid not null references group_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table group_message_deletions enable row level security;

drop policy if exists group_message_deletions_select on group_message_deletions;
create policy group_message_deletions_select
on group_message_deletions
for select
using ( user_id = auth.uid() );

-- Reuses public.is_member_of_group() from migration_10 (the same
-- SECURITY DEFINER helper that avoids the RLS self-recursion bug
-- that broke login last time) instead of joining group_members
-- directly here.
drop policy if exists group_message_deletions_insert on group_message_deletions;
create policy group_message_deletions_insert
on group_message_deletions
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from group_messages gm
    where gm.id = group_message_deletions.message_id
      and public.is_member_of_group(gm.group_id)
  )
);

drop policy if exists group_message_deletions_delete on group_message_deletions;
create policy group_message_deletions_delete
on group_message_deletions
for delete
using ( user_id = auth.uid() );

-- ---------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------
-- Both are brand new tables, so (like message_reactions in
-- migration_11) they need to be added to realtime explicitly for the
-- app's "keep this in sync if the same account has the chat open
-- elsewhere" subscription to receive anything. Guarded so running
-- this twice doesn't error.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'message_deletions'
  ) then
    alter publication supabase_realtime add table message_deletions;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'group_message_deletions'
  ) then
    alter publication supabase_realtime add table group_message_deletions;
  end if;
end $$;
