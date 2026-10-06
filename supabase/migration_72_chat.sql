-- ============================================================
-- Migration 72 — cheap chat lists (2026-10-06). Safe to run twice.
--
-- The private and group chat lists (PrivateChats.jsx / GroupChats.jsx)
-- used to download EVERY message the user had ever sent or received
-- (or every message of every group they're in) just to show one
-- preview line per conversation, and did it again on every new
-- message / read receipt anywhere. These two RPCs return just one row
-- per conversation: the last visible message (short preview only) and
-- the unread count.
--
-- Both are SECURITY INVOKER: they run with the caller's own rights, so
-- the existing RLS on messages / group_messages / private_chat_reads
-- still applies on top of the explicit auth.uid() scoping below — the
-- caller can only ever get their own conversations.
--
-- The client falls back to the old (slow) queries while this file is
-- not applied yet (PGRST202 "function not found"), so nothing breaks
-- in between.
--
-- Additive only: new functions, nothing existing is changed. The
-- indexes these rely on already exist (migration_5, migration_64).
-- ============================================================

-- ------------------------------------------------------------
-- Helper: turn a message `content` into (kind, short preview).
-- A private message's content is either plain text or a JSON blob
-- {"type":"image|video|video_note|audio|file","url":…,"name":…}
-- (see Chat.jsx parseMessage). Malformed JSON is treated as text,
-- never an error. Only ~140 chars of text ever leave the database.
-- ------------------------------------------------------------
create or replace function public.chat_content_preview(
  p_content text,
  out kind text,
  out preview text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  j jsonb;
begin
  if p_content is null then
    kind := null;
    preview := null;
    return;
  end if;

  if left(ltrim(p_content), 1) = '{' then
    begin
      j := p_content::jsonb;
      if jsonb_typeof(j) = 'object'
         and coalesce(j ->> 'type', '') <> ''
         and coalesce(j ->> 'url', '') <> '' then
        kind := j ->> 'type';
        preview := left(j ->> 'name', 140);
        return;
      end if;
    exception when others then
      -- Not JSON after all — plain text.
      null;
    end;
  end if;

  kind := 'text';
  preview := left(p_content, 140);
end;
$$;

revoke all on function public.chat_content_preview(text) from public, anon;
grant execute on function public.chat_content_preview(text) to authenticated;

-- ------------------------------------------------------------
-- Private chats: one row per peer the caller has a visible message
-- with. "Visible" = not hidden by the caller's own "Delete for me"
-- (message_deletions). unread_count = incoming messages newer than the
-- caller's private_chat_reads marker for that peer (no marker = all
-- unread), same rule PrivateChats.jsx used client-side. peer_read_at
-- = how far the PEER has read the caller's messages (the "seen" tick;
-- readable thanks to migration_26's policy).
-- ------------------------------------------------------------
create or replace function public.get_private_chat_list()
returns table (
  peer_id uuid,
  last_message_id uuid,
  last_sender_id uuid,
  last_kind text,
  last_preview text,
  last_created_at timestamptz,
  unread_count integer,
  peer_read_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select auth.uid() as id
  ),
  visible as (
    select
      m.id,
      m.sender_id,
      m.receiver_id,
      m.content,
      m.created_at,
      case when m.sender_id = me.id then m.receiver_id else m.sender_id end as peer_id
    from public.messages m
    cross join me
    where me.id is not null
      and (m.sender_id = me.id or m.receiver_id = me.id)
      and not exists (
        select 1
        from public.message_deletions d
        where d.message_id = m.id
          and d.user_id = me.id
      )
  ),
  last_msg as (
    select distinct on (v.peer_id) v.*
    from visible v, me
    where v.peer_id is not null
      and v.peer_id <> me.id
    order by v.peer_id, v.created_at desc, v.id desc
  ),
  unread as (
    select v.sender_id as peer_id, count(*)::integer as n
    from visible v
    cross join me
    left join public.private_chat_reads r
      on r.user_id = me.id
     and r.peer_id = v.sender_id
    where v.receiver_id = me.id
      and v.sender_id <> me.id
      and (r.last_read_at is null or v.created_at > r.last_read_at)
    group by v.sender_id
  )
  select
    l.peer_id,
    l.id,
    l.sender_id,
    p.kind,
    p.preview,
    l.created_at,
    coalesce(u.n, 0),
    (
      select pr.last_read_at
      from public.private_chat_reads pr, me
      where pr.user_id = l.peer_id
        and pr.peer_id = me.id
    )
  from last_msg l
  cross join lateral public.chat_content_preview(l.content) p
  left join unread u on u.peer_id = l.peer_id;
$$;

revoke all on function public.get_private_chat_list() from public, anon;
grant execute on function public.get_private_chat_list() to authenticated;

-- ------------------------------------------------------------
-- Group chats: one row per group the caller belongs to (every group
-- for a teacher — same as GroupChats.jsx and the group_messages RLS).
-- Groups with no visible message yet still get a row (last_* null).
-- unread_count = other people's visible messages with no
-- group_message_reads row for the caller (migration_22). Media lives
-- in media_type / media_name for group messages; `content` is the
-- caption/text.
-- ------------------------------------------------------------
create or replace function public.get_group_chat_list()
returns table (
  group_id uuid,
  last_message_id uuid,
  last_sender_id uuid,
  last_kind text,
  last_preview text,
  last_media_type text,
  last_media_name text,
  last_created_at timestamptz,
  unread_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select auth.uid() as id, public.is_teacher() as is_teacher
  ),
  my_groups as (
    select g.id
    from public.groups g, me
    where me.id is not null
      and (
        me.is_teacher
        or exists (
          select 1
          from public.group_members gm
          where gm.group_id = g.id
            and gm.student_id = me.id
        )
      )
  ),
  last_msg as (
    select g.id as group_id, lm.*
    from my_groups g
    cross join me
    left join lateral (
      select m.id, m.sender_id, m.content, m.media_type, m.media_name, m.created_at
      from public.group_messages m
      where m.group_id = g.id
        and not exists (
          select 1
          from public.group_message_deletions d
          where d.message_id = m.id
            and d.user_id = me.id
        )
      order by m.created_at desc, m.id desc
      limit 1
    ) lm on true
  ),
  unread as (
    select m.group_id, count(*)::integer as n
    from public.group_messages m
    join my_groups g on g.id = m.group_id
    cross join me
    where m.sender_id <> me.id
      and not exists (
        select 1
        from public.group_message_reads r
        where r.message_id = m.id
          and r.user_id = me.id
      )
      and not exists (
        select 1
        from public.group_message_deletions d
        where d.message_id = m.id
          and d.user_id = me.id
      )
    group by m.group_id
  )
  select
    l.group_id,
    l.id,
    l.sender_id,
    p.kind,
    p.preview,
    l.media_type,
    l.media_name,
    l.created_at,
    coalesce(u.n, 0)
  from last_msg l
  cross join lateral public.chat_content_preview(l.content) p
  left join unread u on u.group_id = l.group_id;
$$;

revoke all on function public.get_group_chat_list() from public, anon;
grant execute on function public.get_group_chat_list() to authenticated;

-- PostgREST caches the function list — make the new RPCs callable now.
notify pgrst, 'reload schema';
