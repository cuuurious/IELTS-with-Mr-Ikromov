-- ============================================================
-- IELTS with Mr Ikromov — Supabase schema
-- Run this once in Supabase Dashboard → SQL Editor → New query
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- PROFILES ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  username text unique not null,
  role text not null check (role in ('student','teacher')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  contact_email text,
  created_at timestamptz not null default now()
);

-- ---------- GROUPS ----------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- GROUP MEMBERS ----------
create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, student_id)
);

-- ---------- HOMEWORKS (assigned by teacher to a group) ----------
create table if not exists public.homeworks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  description text,
  attachment_url text,
  attachment_name text,
  due_date timestamptz,
  enable_speaking boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- SUBMISSIONS (one per student per homework) ----------
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homeworks(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  screenshot_urls text[] not null default '{}',
  audio_part1_url text,
  audio_part2_url text,
  audio_part3_url text,
  comment text,
  status text not null default 'pending' check (status in ('pending','done')),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (homework_id, student_id)
);

-- ---------- MESSAGES (1:1 chat, student <-> teacher) ----------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  read boolean not null default false
);

create index if not exists messages_pair_idx on public.messages (least(sender_id, receiver_id), greatest(sender_id, receiver_id), created_at);

-- ============================================================
-- Helper functions (security definer -> avoid RLS recursion)
-- ============================================================
create or replace function public.is_teacher()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher' and status = 'approved'
  );
$$;

create or replace function public.is_group_member(check_group_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = check_group_id and student_id = auth.uid()
  );
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.homeworks enable row level security;
alter table public.submissions enable row level security;
alter table public.messages enable row level security;

-- PROFILES
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_select_teacher_sees_all" on public.profiles
  for select using (public.is_teacher());
-- Students need to see the teacher's name/id to start a chat with them.
create policy "profiles_select_teacher_public" on public.profiles
  for select using (role = 'teacher' and status = 'approved');
create policy "profiles_insert_self" on public.profiles
  for insert with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());
create policy "profiles_update_teacher" on public.profiles
  for update using (public.is_teacher());

-- GROUPS
-- Group names are not sensitive, and a visitor on the registration screen
-- has no session yet (they aren't a user until they sign up), so this must
-- be readable by anyone — not just logged-in users.
create policy "groups_select_public" on public.groups
  for select using (true);
create policy "groups_insert_teacher" on public.groups
  for insert with check (public.is_teacher());
create policy "groups_update_teacher" on public.groups
  for update using (public.is_teacher());
create policy "groups_delete_teacher" on public.groups
  for delete using (public.is_teacher());

-- GROUP MEMBERS
create policy "gm_select_teacher" on public.group_members
  for select using (public.is_teacher());
create policy "gm_select_self" on public.group_members
  for select using (student_id = auth.uid());
create policy "gm_insert_self" on public.group_members
  for insert with check (student_id = auth.uid());
create policy "gm_insert_teacher" on public.group_members
  for insert with check (public.is_teacher());
create policy "gm_delete_teacher" on public.group_members
  for delete using (public.is_teacher());
create policy "gm_delete_self" on public.group_members
  for delete using (student_id = auth.uid());

-- HOMEWORKS
create policy "hw_select_teacher" on public.homeworks
  for select using (public.is_teacher());
create policy "hw_select_member" on public.homeworks
  for select using (public.is_group_member(group_id));
create policy "hw_insert_teacher" on public.homeworks
  for insert with check (public.is_teacher());
create policy "hw_update_teacher" on public.homeworks
  for update using (public.is_teacher());
create policy "hw_delete_teacher" on public.homeworks
  for delete using (public.is_teacher());

-- SUBMISSIONS
create policy "sub_select_teacher" on public.submissions
  for select using (public.is_teacher());
create policy "sub_select_own" on public.submissions
  for select using (student_id = auth.uid());
create policy "sub_insert_own" on public.submissions
  for insert with check (student_id = auth.uid());
create policy "sub_update_own" on public.submissions
  for update using (student_id = auth.uid());
create policy "sub_update_teacher" on public.submissions
  for update using (public.is_teacher());

-- MESSAGES
create policy "msg_select_participant" on public.messages
  for select using (sender_id = auth.uid() or receiver_id = auth.uid());
create policy "msg_insert_participant" on public.messages
  for insert with check (sender_id = auth.uid());
create policy "msg_update_receiver" on public.messages
  for update using (receiver_id = auth.uid());

-- ============================================================
-- Storage buckets
-- ============================================================
insert into storage.buckets (id, name, public)
values ('homework-files', 'homework-files', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('submissions', 'submissions', true)
on conflict (id) do nothing;

-- Storage policies: files are stored under a path that starts with the
-- uploader's user id, e.g. {user_id}/filename.ext
create policy "storage_read_all_authenticated"
  on storage.objects for select
  using (bucket_id in ('homework-files','submissions') and auth.role() = 'authenticated');

create policy "storage_insert_own_folder"
  on storage.objects for insert
  with check (
    bucket_id in ('homework-files','submissions')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_update_own_folder"
  on storage.objects for update
  using (
    bucket_id in ('homework-files','submissions')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_delete_own_folder"
  on storage.objects for delete
  using (
    bucket_id in ('homework-files','submissions')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- Realtime (so chat + homework status updates live)
-- ============================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.submissions;
alter publication supabase_realtime add table public.homeworks;
alter publication supabase_realtime add table public.profiles;
