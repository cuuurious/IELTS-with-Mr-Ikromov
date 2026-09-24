-- MIGRATION 28: FIX — audio/video message send blocked by RLS for staff
--
-- Jasur hit "new row violates row-level security policy" trying to send a
-- voice message in group chat. Root cause: migration_25's
-- group_message_allowed() only exempted staff via is_group_admin(group_id).
-- GroupChat.jsx's own client-side button gating exempts any teacher
-- account unconditionally (selfRole === 'teacher'), independent of
-- is_group_admin's specific per-group logic — so the mic/video buttons
-- stayed visible and clickable for a teacher exactly as intended, but the
-- database's check didn't carry the same unconditional guarantee, and
-- rejected the insert.
--
-- migration_25's own header comment already stated the intent ("Staff can
-- always send any message type, regardless of these settings") — this
-- just actually wires that guarantee into the function directly instead
-- of relying on is_group_admin() to imply it. Belt-and-suspenders: a
-- group's real owner/admin still passes via is_group_admin as before,
-- and now any teacher account passes unconditionally too, matching every
-- other staff exemption already in this app (is_teacher() is OR'd into
-- the RLS/helper pattern everywhere else).
--
-- No RLS/table shape changes beyond replacing this one function. Safe to
-- run more than once.

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
    or public.is_teacher()
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

notify pgrst, 'reload schema';
