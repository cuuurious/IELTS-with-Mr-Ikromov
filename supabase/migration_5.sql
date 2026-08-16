-- Migration 5 — run in Supabase SQL Editor.
-- Adds a Telegram-style group chat: one shared thread per group, visible
-- to every approved student in that group plus the teacher. Separate from
-- the existing 1:1 `messages` table (teacher <-> individual student DMs).
-- Also supports sending photos, videos, and voice/audio messages.

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text,
  media_url text,
  media_type text check (media_type in ('image','video','audio')),
  created_at timestamptz not null default now(),
  constraint group_messages_has_body check (content is not null or media_url is not null)
);

create index if not exists group_messages_group_id_idx
  on public.group_messages (group_id, created_at);

alter table public.group_messages enable row level security;

-- Read: group members (students) or the teacher.
create policy "group_messages_select" on public.group_messages
  for select using (public.is_group_member(group_id) or public.is_teacher());

-- Send: same rule, and you can only send as yourself.
create policy "group_messages_insert" on public.group_messages
  for insert with check (
    sender_id = auth.uid()
    and (public.is_group_member(group_id) or public.is_teacher())
  );

-- Let people delete their own messages (optional, mirrors normal chat apps).
create policy "group_messages_delete_own" on public.group_messages
  for delete using (sender_id = auth.uid());

-- Enable realtime so new messages appear instantly for everyone in the group.
alter publication supabase_realtime add table public.group_messages;

-- ---------- Storage bucket for photos / videos / voice messages ----------
insert into storage.buckets (id, name, public)
values ('group-chat', 'group-chat', true)
on conflict (id) do nothing;

-- Files are stored under {user_id}/{group_id}/filename, same convention
-- as the existing homework-files / submissions buckets.
create policy "group_chat_storage_read"
  on storage.objects for select
  using (bucket_id = 'group-chat' and auth.role() = 'authenticated');

create policy "group_chat_storage_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'group-chat'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "group_chat_storage_delete"
  on storage.objects for delete
  using (
    bucket_id = 'group-chat'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
