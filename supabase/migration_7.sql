-- Migration 7 — homework submission rules, group-chat moderation/audit,
-- message editing/deletion, and storage cleanup permissions.

alter table public.homeworks
  add column if not exists allowed_submission_types text[] not null default array['image']::text[],
  add column if not exists min_submission_files int not null default 1,
  add column if not exists max_submission_files int not null default 10;

alter table public.submissions
  add column if not exists submission_files jsonb not null default '[]'::jsonb;

-- Group-chat editing/deletion audit trail. Message IDs are deliberately not
-- foreign keys because deleted messages must leave their audit record behind.
create table if not exists public.group_message_actions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  message_id uuid,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  target_sender_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('edited','deleted')),
  old_content text,
  new_content text,
  created_at timestamptz not null default now()
);

create index if not exists group_message_actions_group_created_idx
  on public.group_message_actions(group_id, created_at desc);

alter table public.group_message_actions enable row level security;

create policy "group_message_actions_select_teacher"
  on public.group_message_actions for select using (public.is_teacher());

create or replace function public.audit_group_message_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.group_message_actions
      (group_id, message_id, actor_id, target_sender_id, action, old_content, new_content)
    values
      (old.group_id, old.id, auth.uid(), old.sender_id, 'deleted', old.content, null);
    return old;
  elsif tg_op = 'UPDATE' then
    if old.content is distinct from new.content
       or old.media_url is distinct from new.media_url
       or old.media_type is distinct from new.media_type then
      insert into public.group_message_actions
        (group_id, message_id, actor_id, target_sender_id, action, old_content, new_content)
      values
        (new.group_id, new.id, auth.uid(), old.sender_id, 'edited', old.content, new.content);
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_group_message_change on public.group_messages;
create trigger trg_audit_group_message_change
after update or delete on public.group_messages
for each row execute function public.audit_group_message_change();

-- Students can edit/delete only their own messages; teachers can moderate any.
drop policy if exists "group_messages_delete_own" on public.group_messages;
create policy "group_messages_delete_own"
  on public.group_messages for delete
  using (sender_id = auth.uid() or public.is_teacher());

drop policy if exists "group_messages_update_own" on public.group_messages;
create policy "group_messages_update_own"
  on public.group_messages for update
  using (sender_id = auth.uid() or public.is_teacher())
  with check (sender_id = auth.uid() or public.is_teacher());

-- Teacher can remove homework/submission files during a true homework delete.
drop policy if exists "homework_storage_delete_teacher" on storage.objects;
create policy "homework_storage_delete_teacher"
  on storage.objects for delete
  using (bucket_id = 'homework-files' and public.is_teacher());

drop policy if exists "submissions_storage_delete_teacher" on storage.objects;
create policy "submissions_storage_delete_teacher"
  on storage.objects for delete
  using (bucket_id = 'submissions' and public.is_teacher());

alter publication supabase_realtime add table public.group_message_actions;

-- Guaranteed in-app notification for every new group message. This runs as
-- the database owner, so students do not need direct INSERT permission on
-- the notifications table.
create or replace function public.notify_group_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications(user_id, type, title, body, link)
  select p.id,
         'group_message',
         coalesce(sender.full_name, 'New group message'),
         case
           when new.media_type = 'image' then '📷 Photo'
           when new.media_type = 'video' then '🎥 Video'
           when new.media_type = 'audio' then '🎵 Audio message'
           else left(coalesce(new.content, 'New group message'), 120)
         end,
         '/app'
  from (
    select gm.student_id as id from public.group_members gm
    join public.profiles gp on gp.id = gm.student_id and gp.status = 'approved'
    where gm.group_id = new.group_id
    union
    select p2.id from public.profiles p2 where p2.role = 'teacher' and p2.status = 'approved'
  ) recipients
  join public.profiles p on p.id = recipients.id
  left join public.profiles sender on sender.id = new.sender_id
  where p.id <> new.sender_id;
  return new;
end;
$$;

drop trigger if exists trg_notify_group_message on public.group_messages;
create trigger trg_notify_group_message
after insert on public.group_messages
for each row execute function public.notify_group_message();

-- Use the real recovery email for Supabase Auth when one is supplied, while
-- keeping username-based login in the UI.
create or replace function public.sync_profile_auth_email()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.contact_email is not null and btrim(new.contact_email) <> '' then
    update auth.users set email = lower(btrim(new.contact_email)), email_confirmed_at = coalesce(email_confirmed_at, now()) where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_profile_auth_email on public.profiles;
create trigger trg_sync_profile_auth_email
after insert or update of contact_email on public.profiles
for each row execute function public.sync_profile_auth_email();

create or replace function public.auth_email_for_username(p_username text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = lower(trim(p_username))
  limit 1;
$$;
grant execute on function public.auth_email_for_username(text) to anon, authenticated;

alter table public.group_messages replica identity full;

-- Students in the same group may see each other's display names/roles, which
-- is required for a readable group chat.
drop policy if exists "profiles_select_group_peers" on public.profiles;
create policy "profiles_select_group_peers" on public.profiles
  for select using (
    exists (
      select 1
      from public.group_members target_member
      join public.group_members my_member on my_member.group_id = target_member.group_id
      where target_member.student_id = profiles.id
        and my_member.student_id = auth.uid()
    )
  );
