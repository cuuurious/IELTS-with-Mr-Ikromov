-- ============================================================
-- Migration 65 — chat fixes (2026-09-30). Safe to run more than once.
--
-- Jasur: "chat updates are applied in groupchats only … audio and video
-- round sending, check for other features as well and apply to every
-- chat in the website".
--
-- 1. BUG: round video messages could never be sent in a GROUP chat.
--    group_messages only accepted media_type 'image' | 'video' | 'audio'
--    (migration_5), but the app sends 'video_note' for a recorded round
--    video, so the database rejected every one ("violates check
--    constraint group_messages_media_type_check"). Now allowed — plus
--    'file' so groups can share PDFs/Word/PowerPoint like private chats.
-- 2. group_messages gets `media_name` (a shared document's file name)
--    and `edited_at` (so edited group messages show "edited", same as
--    private chats). edited_at is set by the database whenever the text
--    changes, so nothing can fake or forget it.
-- 3. Members' "no photos/videos" group setting now also covers files.
-- 4. SECURITY: the "receiver can update" rule on private `messages`
--    (there so a message can be marked read) let the RECEIVER change
--    anything in a message sent to them — including its text. Now a
--    receiver who isn't also the sender can only change `read`.
-- ============================================================

-- 1. Allowed media types
alter table public.group_messages
  drop constraint if exists group_messages_media_type_check;
alter table public.group_messages
  add constraint group_messages_media_type_check
  check (media_type in ('image', 'video', 'audio', 'video_note', 'file'));

-- 2. New columns
alter table public.group_messages add column if not exists media_name text;
alter table public.group_messages add column if not exists edited_at timestamptz;

create or replace function public.group_messages_mark_edited()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.content is distinct from old.content then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

drop trigger if exists group_messages_mark_edited on public.group_messages;
create trigger group_messages_mark_edited
  before update on public.group_messages
  for each row execute function public.group_messages_mark_edited();

-- 3. Group media permission also covers shared files
create or replace function public.group_message_allowed(check_group_id uuid, check_media_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    check_media_type is null
    or public.is_teacher()
    or public.is_group_admin(check_group_id)
    or (
      check_media_type in ('image', 'video', 'file')
      and coalesce((select allow_media from public.groups where id = check_group_id), true)
    )
    or (
      check_media_type in ('audio', 'video_note')
      and coalesce((select allow_voice_video_notes from public.groups where id = check_group_id), true)
    );
$$;

-- 4. Receiver may only mark a private message read
create or replace function public.messages_guard_receiver_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null
     and auth.uid() = old.receiver_id
     and auth.uid() <> old.sender_id
     and not public.is_teacher() then
    if new.content is distinct from old.content
       or new.sender_id is distinct from old.sender_id
       or new.receiver_id is distinct from old.receiver_id
       or new.reply_to_id is distinct from old.reply_to_id
       or new.edited_at is distinct from old.edited_at
       or new.created_at is distinct from old.created_at then
      raise exception 'You can only mark this message as read.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_guard_receiver_update on public.messages;
create trigger messages_guard_receiver_update
  before update on public.messages
  for each row execute function public.messages_guard_receiver_update();

notify pgrst, 'reload schema';
