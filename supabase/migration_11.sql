-- Migration 11 — Telegram-style features for private (1:1) chats
--
-- Group chat already supports replying, editing, deleting, and emoji
-- reactions (from migration_7 and later work). This migration brings
-- the same features to private chats between a student and their
-- teacher, using the same shape: a reply_to_id column, an edited_at
-- flag, and a reactions table.
--
-- Only additive changes here — new columns, a new table, and new
-- policies alongside whatever already exists. Nothing already working
-- (sending/reading messages) is touched. Safe to run more than once.

alter table messages add column if not exists reply_to_id uuid references messages(id) on delete set null;
alter table messages add column if not exists edited_at timestamptz;

create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, reaction)
);

alter table message_reactions enable row level security;

-- Lets a user check "am I a teacher" from inside another table's
-- policy without re-triggering profiles' own RLS — same pattern used
-- in migration_10 to avoid the recursion bug that broke login.
create or replace function public.is_teacher()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'teacher'
  );
$$;

-- A message can be edited or deleted by whoever sent it, or by the
-- teacher (for moderation) when they're the other side of that
-- conversation — mirrors the group chat's "sender or teacher" rule.
drop policy if exists messages_update_own_or_teacher on messages;
create policy messages_update_own_or_teacher
on messages
for update
using (
  sender_id = auth.uid()
  or (receiver_id = auth.uid() and public.is_teacher())
);

drop policy if exists messages_delete_own_or_teacher on messages;
create policy messages_delete_own_or_teacher
on messages
for delete
using (
  sender_id = auth.uid()
  or (receiver_id = auth.uid() and public.is_teacher())
);

-- Reactions: visible to, and manageable by, the two people in that
-- conversation only.
drop policy if exists message_reactions_select on message_reactions;
create policy message_reactions_select
on message_reactions
for select
using (
  exists (
    select 1 from messages m
    where m.id = message_reactions.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);

drop policy if exists message_reactions_insert on message_reactions;
create policy message_reactions_insert
on message_reactions
for insert
with check (
  user_id = auth.uid()
  and exists (
    select 1 from messages m
    where m.id = message_reactions.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);

drop policy if exists message_reactions_delete on message_reactions;
create policy message_reactions_delete
on message_reactions
for delete
using ( user_id = auth.uid() );

-- Reactions are a brand new table, so (unlike `messages`, which
-- already streams live updates) it needs to be added to realtime
-- explicitly. Guarded so running this twice doesn't error.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table message_reactions;
  end if;
end $$;
