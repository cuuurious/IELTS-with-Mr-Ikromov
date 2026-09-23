-- MIGRATION 25: GROUP CHAT — MEMBER SEND PERMISSIONS
--
-- Telegram's group "Permissions" screen lets an admin turn off which
-- kinds of messages ordinary members can send, without touching what
-- admins themselves can do. This adds the same idea, scoped to what
-- this app's group chat actually supports sending: photo/video
-- attachments, and voice/video note recordings.
--
-- Enforced in two places, same pattern as everything else in this
-- app: the client (GroupChat.jsx) hides the relevant button so a
-- restricted member never sees an option that won't work anyway, AND
-- the database rejects the insert regardless — a hidden button is not
-- security on its own. Staff (is_group_admin, which already always
-- includes any teacher account — see migration_23) are never
-- restricted by their own group's permission settings.

alter table public.groups
  add column if not exists allow_media boolean not null default true,
  add column if not exists allow_voice_video_notes boolean not null default true;

-- SECURITY DEFINER so the insert policy below can check this group's
-- settings without re-triggering RLS recursion, same pattern as
-- is_teacher()/is_group_member()/is_group_admin().
create or replace function public.group_message_allowed(
  check_group_id uuid,
  check_media_type text
)
returns boolean
language sql
security definer
stable
as $$
  select
    check_media_type is null
    or public.is_group_admin(check_group_id)
    or (
      check_media_type in ('image', 'video')
      and coalesce(
        (select allow_media from public.groups where id = check_group_id),
        true
      )
    )
    or (
      check_media_type in ('audio', 'video_note')
      and coalesce(
        (select allow_voice_video_notes from public.groups where id = check_group_id),
        true
      )
    );
$$;

drop policy if exists "group_messages_insert" on public.group_messages;

create policy "group_messages_insert" on public.group_messages
  for insert with check (
    sender_id = auth.uid()
    and (public.is_group_member(group_id) or public.is_teacher())
    and public.group_message_allowed(group_id, media_type)
  );

notify pgrst, 'reload schema';
