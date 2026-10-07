-- migration_77_message_notifications.sql (2026-10-07)
-- 1. Deleting a chat message now also deletes the notification it made
--    (private and group chats). Before, the student's bell kept showing
--    "hi" and the rest after the teacher deleted the messages.
-- 2. Voice notes, round videos, photos and files sent in PRIVATE chats
--    showed as raw code in the bell and in Telegram
--    ({"type":"video_note","url":"https://…"}). They now read
--    "Voice message", "Video message", "Photo", "Video" or the file name,
--    like the chat list does.
-- 3. Editing a private message updates its notification text too.
-- 4. TELEGRAM: the bot now remembers which Telegram message it sent for
--    each notification. When the chat message is deleted, the bot
--    deletes its Telegram message as well; when it's edited, the bot
--    edits it. (Telegram lets a bot delete its own messages for 48
--    hours. Messages sent BEFORE this migration can't be found, so they
--    stay in Telegram.)
-- 5. One-off clean-up: removes notifications for messages that were
--    already deleted, and fixes the old raw-code ones.
-- Needs the new notify-telegram function (deployed 2026-10-07).
-- Safe to run more than once.

alter table public.notifications add column if not exists telegram_chat_id bigint;
alter table public.notifications add column if not exists telegram_message_id bigint;

-- The bot is told which notification each message is for, so it can
-- save the Telegram message id back.
create or replace function public.notifications_to_telegram()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_rows jsonb;
  v_secret text;
begin
  -- daily_reminder: motivational spam stays push/bell only.
  -- speaking_reminder: exam-reminders already messages Telegram itself.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'user_id', n.user_id, 'title', n.title, 'body', n.body, 'link', n.link, 'type', n.type)), '[]'::jsonb)
    into v_rows
    from new_rows n
   where coalesce(n.type, '') not in ('daily_reminder', 'speaking_reminder')
     and exists (select 1 from public.telegram_links t where t.user_id = n.user_id);

  if jsonb_array_length(v_rows) = 0 then
    return null;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_telegram_secret';

  perform net.http_post(
    url := 'https://grdfwleehlgoooizyowz.supabase.co/functions/v1/notify-telegram',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := jsonb_build_object('rows', v_rows),
    timeout_milliseconds := 10000
  );
  return null;
exception when others then
  -- Never let a Telegram problem stop a notification from being saved.
  raise warning 'notifications_to_telegram failed: %', sqlerrm;
  return null;
end;
$function$;

-- Ask the bot to delete or edit messages it already sent.
-- p_body: {"delete":[{chat_id,message_id}]} or {"edit":[{chat_id,message_id,title,body,link}]}
create or replace function public.telegram_bot_followup(p_body jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notify_telegram_secret';
  perform net.http_post(
    url := 'https://grdfwleehlgoooizyowz.supabase.co/functions/v1/notify-telegram',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body := p_body,
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'telegram_bot_followup failed: %', sqlerrm;
end;
$function$;
revoke all on function public.telegram_bot_followup(jsonb) from public, anon, authenticated;

-- Short, readable text for a private message (plain text or the JSON
-- the website stores for photos / voice / video / files).
create or replace function public.message_preview_text(p_content text)
returns text
language plpgsql
immutable
set search_path = public
as $function$
declare
  j jsonb;
  t text;
begin
  if p_content is null or btrim(p_content) = '' then
    return 'You received a new private message.';
  end if;
  if left(btrim(p_content), 1) = '{' then
    begin
      j := p_content::jsonb;
      t := j->>'type';
      if t is not null and j ? 'url' then
        return case t
          when 'image' then '📷 Photo'
          when 'video' then '🎥 Video'
          when 'video_note' then '⭕ Video message'
          when 'audio' then '🎤 Voice message'
          when 'file' then '📎 ' || coalesce(nullif(j->>'name', ''), 'File')
          else '📎 Attachment'
        end;
      end if;
    exception when others then
      -- Old notifications kept only the first 117 characters, so the
      -- JSON is cut off — read the type straight from the text.
      t := substring(p_content from '^\s*\{\s*"type"\s*:\s*"([a-z_]+)"');
      if t is not null and p_content ~ '"url"\s*:' then
        return case t
          when 'image' then '📷 Photo'
          when 'video' then '🎥 Video'
          when 'video_note' then '⭕ Video message'
          when 'audio' then '🎤 Voice message'
          when 'file' then '📎 File'
          else '📎 Attachment'
        end;
      end if;
    end;
  end if;
  if length(p_content) > 120 then
    return left(p_content, 117) || '...';
  end if;
  return p_content;
end;
$function$;

create or replace function public.notify_private_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  sender_name text;
begin
  select full_name into sender_name from public.profiles where id = new.sender_id;

  insert into public.notifications (user_id, type, title, body, link)
  values (
    new.receiver_id,
    'private_message',
    coalesce(sender_name, 'New message'),
    public.message_preview_text(new.content),
    'private-chat:' || new.sender_id::text || ':' || new.id::text
  );

  return new;
end;
$function$;

-- Message deleted → its notification goes too.
create or replace function public.delete_private_message_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tg jsonb;
begin
  with gone as (
    delete from public.notifications
     where type = 'private_message'
       and user_id = old.receiver_id
       and link = 'private-chat:' || old.sender_id::text || ':' || old.id::text
    returning telegram_chat_id, telegram_message_id
  )
  select jsonb_agg(jsonb_build_object('chat_id', telegram_chat_id, 'message_id', telegram_message_id))
    into v_tg
    from gone where telegram_message_id is not null;

  if v_tg is not null then
    perform public.telegram_bot_followup(jsonb_build_object('delete', v_tg));
  end if;
  return old;
end;
$function$;

drop trigger if exists trg_delete_private_message_notification on public.messages;
create trigger trg_delete_private_message_notification
  after delete on public.messages
  for each row execute function public.delete_private_message_notification();

-- Message edited → the notification shows the new text.
create or replace function public.update_private_message_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tg jsonb;
begin
  if new.content is distinct from old.content then
    with changed as (
      update public.notifications
         set body = public.message_preview_text(new.content)
       where type = 'private_message'
         and user_id = new.receiver_id
         and link = 'private-chat:' || new.sender_id::text || ':' || new.id::text
      returning telegram_chat_id, telegram_message_id, title, body, link
    )
    select jsonb_agg(jsonb_build_object('chat_id', telegram_chat_id, 'message_id', telegram_message_id,
                                        'title', title, 'body', body, 'link', link))
      into v_tg
      from changed where telegram_message_id is not null;

    if v_tg is not null then
      perform public.telegram_bot_followup(jsonb_build_object('edit', v_tg));
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_update_private_message_notification on public.messages;
create trigger trg_update_private_message_notification
  after update of content on public.messages
  for each row execute function public.update_private_message_notification();

-- Group message deleted → remove it from everyone's bell.
create or replace function public.delete_group_message_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tg jsonb;
begin
  with gone as (
    delete from public.notifications
     where type = 'group_message'
       and link = 'group-chat:' || old.group_id::text || ':' || old.id::text
    returning telegram_chat_id, telegram_message_id
  )
  select jsonb_agg(jsonb_build_object('chat_id', telegram_chat_id, 'message_id', telegram_message_id))
    into v_tg
    from gone where telegram_message_id is not null;

  if v_tg is not null then
    perform public.telegram_bot_followup(jsonb_build_object('delete', v_tg));
  end if;
  return old;
end;
$function$;

drop trigger if exists trg_delete_group_message_notification on public.group_messages;
create trigger trg_delete_group_message_notification
  after delete on public.group_messages
  for each row execute function public.delete_group_message_notification();

-- Group messages fan out to many people: index the link so the delete
-- above stays instant.
create index if not exists notifications_link_idx on public.notifications (link);

-- ---- one-off clean-up -------------------------------------------------
-- Notifications for private messages that no longer exist.
delete from public.notifications n
 where n.type = 'private_message'
   and n.link like 'private-chat:%:%'
   and not exists (
     select 1 from public.messages m
      where m.id::text = split_part(n.link, ':', 3)
   );

-- Notifications for group messages that no longer exist.
delete from public.notifications n
 where n.type = 'group_message'
   and n.link like 'group-chat:%:%'
   and not exists (
     select 1 from public.group_messages g
      where g.id::text = split_part(n.link, ':', 3)
   );

-- Old notifications that show raw code.
update public.notifications
   set body = public.message_preview_text(body)
 where type = 'private_message'
   and body like '{%';
