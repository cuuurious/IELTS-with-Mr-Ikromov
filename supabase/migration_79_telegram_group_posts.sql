-- migration_79_telegram_group_posts.sql (2026-10-08)
-- Homework posted on the website is also posted by the bot into the
-- group's Telegram chat, the way Jasur posts it by hand today:
--   "Assalomu aleykum. Lesson 4. October 8."
--   1. <homework title + task>        [Open on the website]
--      <the real files: PDF, audio, Word, HTML…>
--   2. …
-- Editing a homework edits the post; deleting it deletes the post
-- (Telegram lets a bot delete its messages for 48 hours).
--
-- 1. groups.telegram_chat_id — the Telegram group linked with /connect.
-- 2. homeworks.lesson_number / lesson_date — the "Lesson 4. October 8."
--    header; homework with the same lesson goes under one header.
-- 3. materials.telegram_file_id / telegram_file_kind — files that came
--    in through the bot can be re-sent to a group instantly, any size.
-- 4. homework_telegram_posts / group_lesson_posts — which Telegram
--    messages belong to which homework / lesson header.
-- 5. Deleting a homework deletes its Telegram messages (and the lesson
--    header once the lesson has no homework left).
-- Needs migration_77 (telegram_bot_followup). Safe to run more than once.

alter table public.groups add column if not exists telegram_chat_id bigint;
alter table public.groups add column if not exists telegram_chat_title text;
alter table public.groups add column if not exists telegram_linked_at timestamptz;
create unique index if not exists groups_telegram_chat_id_key on public.groups (telegram_chat_id) where telegram_chat_id is not null;

alter table public.homeworks add column if not exists lesson_number integer;
alter table public.homeworks add column if not exists lesson_date date;
create index if not exists homeworks_group_lesson_idx on public.homeworks (group_id, lesson_number, lesson_date);

alter table public.materials add column if not exists telegram_file_id text;
alter table public.materials add column if not exists telegram_file_kind text;

create table if not exists public.homework_telegram_posts (
  homework_id uuid primary key references public.homeworks(id) on delete cascade,
  group_id uuid not null,
  chat_id bigint not null,
  text_message_id bigint,
  file_message_ids bigint[] not null default '{}',
  attachment_keys text[] not null default '{}',
  posted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_lesson_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  chat_id bigint not null,
  lesson_number integer,
  lesson_date date,
  message_id bigint not null,
  posted_at timestamptz not null default now()
);
create unique index if not exists group_lesson_posts_key
  on public.group_lesson_posts (group_id, chat_id, coalesce(lesson_number, -1), coalesce(lesson_date, '1970-01-01'::date));

alter table public.homework_telegram_posts enable row level security;
alter table public.group_lesson_posts enable row level security;
drop policy if exists "teachers read homework telegram posts" on public.homework_telegram_posts;
create policy "teachers read homework telegram posts" on public.homework_telegram_posts
  for select to authenticated using ((select public.is_teacher()));
drop policy if exists "teachers read lesson posts" on public.group_lesson_posts;
create policy "teachers read lesson posts" on public.group_lesson_posts
  for select to authenticated using ((select public.is_teacher()));

-- Homework deleted → delete its Telegram messages (and the lesson header
-- when nothing else is left in that lesson).
create or replace function public.delete_homework_telegram_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_post record;
  v_items jsonb := '[]'::jsonb;
  v_header record;
  v_mid bigint;
begin
  select * into v_post from public.homework_telegram_posts where homework_id = old.id;
  if found then
    if v_post.text_message_id is not null then
      v_items := v_items || jsonb_build_array(jsonb_build_object('chat_id', v_post.chat_id, 'message_id', v_post.text_message_id));
    end if;
    foreach v_mid in array coalesce(v_post.file_message_ids, '{}') loop
      v_items := v_items || jsonb_build_array(jsonb_build_object('chat_id', v_post.chat_id, 'message_id', v_mid));
    end loop;

    if (old.lesson_number is not null or old.lesson_date is not null)
       and not exists (
         select 1 from public.homeworks h
          where h.group_id = old.group_id and h.id <> old.id
            and h.lesson_number is not distinct from old.lesson_number
            and h.lesson_date is not distinct from old.lesson_date
       ) then
      for v_header in
        delete from public.group_lesson_posts
         where group_id = old.group_id and chat_id = v_post.chat_id
           and lesson_number is not distinct from old.lesson_number
           and lesson_date is not distinct from old.lesson_date
        returning chat_id, message_id
      loop
        v_items := v_items || jsonb_build_array(jsonb_build_object('chat_id', v_header.chat_id, 'message_id', v_header.message_id));
      end loop;
    end if;

    if jsonb_array_length(v_items) > 0 then
      perform public.telegram_bot_followup(jsonb_build_object('delete', v_items));
    end if;
  end if;
  return old;
exception when others then
  -- Never block a delete because of Telegram.
  raise warning 'delete_homework_telegram_post failed: %', sqlerrm;
  return old;
end;
$function$;

drop trigger if exists trg_delete_homework_telegram_post on public.homeworks;
create trigger trg_delete_homework_telegram_post
  before delete on public.homeworks
  for each row execute function public.delete_homework_telegram_post();
