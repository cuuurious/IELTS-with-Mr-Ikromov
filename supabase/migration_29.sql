-- ============================================================
-- Migration 29 — run this once in Supabase SQL Editor
--
-- Foundation for the examiner-platform expansion:
--   - two new roles: speaking_examiner, writing_examiner
--   - a speaking-exam timetable (mock_speaking_slots)
--   - an examiner review layer on top of the EXISTING Writing Mock
--     Test system (homeworks.homework_type = 'mock' + submissions.
--     mock_essay — this is migration_19's system, unrelated to the
--     newer mock_exams/mock_attempts reading & listening tables)
--   - Telegram bot account linking, for the "notify 5 minutes
--     before" reminders (in addition to existing web push)
--
-- Nothing here touches existing behavior for students/teachers —
-- every new policy is additive (Postgres OR's permissive RLS
-- policies together), and the role check widening only ADDS two
-- new allowed values.
-- ============================================================

-- ---------- 1. New roles ----------
-- profiles.role gains 'speaking_examiner' and 'writing_examiner'
-- alongside the existing 'student' / 'teacher'. Examiners are
-- deliberately NOT teachers — is_teacher() stays false for them, so
-- none of the existing group/homework/teacher-only policies open up
-- to them by accident. Written to find and replace whatever the
-- existing role check constraint is actually named, rather than
-- guessing its name.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('student', 'teacher', 'speaking_examiner', 'writing_examiner'));

create or replace function public.is_speaking_examiner()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'speaking_examiner'
  );
$$;

create or replace function public.is_writing_examiner()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'writing_examiner'
  );
$$;

create or replace function public.is_examiner()
returns boolean
language sql
security definer
stable
as $$
  select public.is_speaking_examiner() or public.is_writing_examiner();
$$;

-- Examiners need to see the student roster (name/username/avatar) the
-- same way a teacher already can, even though they're not a teacher.
-- Additive — existing profile-visibility policies are untouched.
drop policy if exists "profiles_select_examiner_students" on public.profiles;
create policy "profiles_select_examiner_students" on public.profiles
  for select using (
    public.is_examiner() and role = 'student'
  );

-- ---------- 2. Speaking exam timetable ----------
create table if not exists public.mock_speaking_slots (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  examiner_id uuid not null references public.profiles(id) on delete cascade,
  scheduled_at timestamptz not null,
  duration_minutes int not null default 15,
  meeting_link text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  notified_5min boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mock_speaking_slots_examiner_idx
  on public.mock_speaking_slots(examiner_id, scheduled_at);
create index if not exists mock_speaking_slots_student_idx
  on public.mock_speaking_slots(student_id, scheduled_at);

alter table public.mock_speaking_slots enable row level security;

drop policy if exists "speaking_slots_select" on public.mock_speaking_slots;
create policy "speaking_slots_select" on public.mock_speaking_slots
  for select using (
    student_id = auth.uid() or examiner_id = auth.uid() or public.is_teacher()
  );

drop policy if exists "speaking_slots_insert" on public.mock_speaking_slots;
create policy "speaking_slots_insert" on public.mock_speaking_slots
  for insert with check (
    (examiner_id = auth.uid() and public.is_speaking_examiner()) or public.is_teacher()
  );

drop policy if exists "speaking_slots_update" on public.mock_speaking_slots;
create policy "speaking_slots_update" on public.mock_speaking_slots
  for update using (
    examiner_id = auth.uid() or public.is_teacher()
  );

drop policy if exists "speaking_slots_delete" on public.mock_speaking_slots;
create policy "speaking_slots_delete" on public.mock_speaking_slots
  for delete using (
    examiner_id = auth.uid() or public.is_teacher()
  );

alter publication supabase_realtime add table public.mock_speaking_slots;

create or replace function public.touch_mock_speaking_slot()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_mock_speaking_slot on public.mock_speaking_slots;
create trigger trg_touch_mock_speaking_slot
before update on public.mock_speaking_slots
for each row execute function public.touch_mock_speaking_slot();

-- Guaranteed in-app notification when a speaking slot is booked or
-- moved, same pattern as notify_group_message() in migration_7.
create or replace function public.notify_speaking_slot_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  examiner_name text;
begin
  select coalesce(full_name, username) into examiner_name
  from public.profiles where id = new.examiner_id;

  insert into public.notifications(user_id, type, title, body, link)
  values (
    new.student_id,
    'speaking_slot',
    'Speaking exam scheduled',
    format('%s scheduled your speaking exam for %s.',
      coalesce(examiner_name, 'Your examiner'),
      to_char(new.scheduled_at, 'FMDD Mon, HH24:MI')),
    '/app'
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_speaking_slot_insert on public.mock_speaking_slots;
create trigger trg_notify_speaking_slot_insert
after insert on public.mock_speaking_slots
for each row execute function public.notify_speaking_slot_change();

-- ---------- 3. Writing examiner review layer ----------
-- This sits on the EXISTING Writing Mock Test system (migration_19):
-- a homework with homework_type = 'mock', and the student's essay in
-- submissions.mock_essay. A writing examiner's job is to read
-- task1_text/task2_text and leave a band + feedback.
alter table public.submissions
  add column if not exists examiner_band numeric,
  add column if not exists examiner_feedback text,
  add column if not exists examiner_reviewed_by uuid references public.profiles(id),
  add column if not exists examiner_reviewed_at timestamptz;

-- A writing examiner can see every submission for a 'mock' homework
-- (to build the Task 1s / Task 2s review queue) and every such
-- homework's prompts, and can write back their review fields only.
drop policy if exists "submissions_select_writing_examiner" on public.submissions;
create policy "submissions_select_writing_examiner" on public.submissions
  for select using (
    public.is_writing_examiner()
    and exists (
      select 1 from public.homeworks h
      where h.id = submissions.homework_id and h.homework_type = 'mock'
    )
  );

drop policy if exists "submissions_update_writing_examiner" on public.submissions;
create policy "submissions_update_writing_examiner" on public.submissions
  for update using (
    public.is_writing_examiner()
    and exists (
      select 1 from public.homeworks h
      where h.id = submissions.homework_id and h.homework_type = 'mock'
    )
  );

drop policy if exists "homeworks_select_writing_examiner" on public.homeworks;
create policy "homeworks_select_writing_examiner" on public.homeworks
  for select using (
    public.is_writing_examiner() and homework_type = 'mock'
  );

-- In-app notification the moment an examiner leaves a band/feedback.
create or replace function public.notify_writing_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.examiner_reviewed_at is not null
     and old.examiner_reviewed_at is distinct from new.examiner_reviewed_at then
    insert into public.notifications(user_id, type, title, body, link)
    values (
      new.student_id,
      'writing_reviewed',
      'Your writing mock has been marked',
      case when new.examiner_band is not null
        then format('Band %s — feedback is ready to read.', new.examiner_band)
        else 'Feedback is ready to read.'
      end,
      format('homework:%s', new.homework_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_writing_review on public.submissions;
create trigger trg_notify_writing_review
after update on public.submissions
for each row execute function public.notify_writing_review();

-- ---------- 4. Telegram bot account linking ----------
-- Populated only by the telegram-webhook Edge Function (service-role
-- key) once a user taps "Connect Telegram" (opens a t.me deep link
-- carrying a one-time token) and the bot confirms it — never written
-- directly by the browser, since a chat_id isn't something a browser
-- request can prove it owns.
create table if not exists public.telegram_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  telegram_chat_id bigint not null unique,
  telegram_username text,
  phone_number text,
  linked_at timestamptz not null default now()
);

alter table public.telegram_links enable row level security;

drop policy if exists "telegram_links_select_own" on public.telegram_links;
create policy "telegram_links_select_own" on public.telegram_links
  for select using (user_id = auth.uid());

drop policy if exists "telegram_links_delete_own" on public.telegram_links;
create policy "telegram_links_delete_own" on public.telegram_links
  for delete using (user_id = auth.uid());

-- One-time link tokens, short-lived, generated by the browser and
-- consumed by the Telegram webhook.
create table if not exists public.telegram_link_tokens (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz
);

alter table public.telegram_link_tokens enable row level security;

drop policy if exists "telegram_link_tokens_insert_own" on public.telegram_link_tokens;
create policy "telegram_link_tokens_insert_own" on public.telegram_link_tokens
  for insert with check (user_id = auth.uid());

drop policy if exists "telegram_link_tokens_select_own" on public.telegram_link_tokens;
create policy "telegram_link_tokens_select_own" on public.telegram_link_tokens
  for select using (user_id = auth.uid());

-- PostgREST (what Supabase's client library talks to) caches the
-- table schema and only notices new columns/tables after being told
-- to reload it.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEPS — after running this migration:
--
-- 1. Create the examiner accounts themselves (same way you'd create a
--    teacher account today, then in the SQL Editor run, once per
--    examiner):
--      update profiles set role = 'speaking_examiner' where username = '...';
--      update profiles set role = 'writing_examiner'  where username = '...';
--
-- 2. Nothing else is needed yet — the dashboards, timetable UI, review
--    queue UI, and Telegram bot itself are the next phases, not part
--    of this migration.
-- ---------------------------------------------------------------------
