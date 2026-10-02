-- ============================================================
-- Migration 66 — Materials Library + several files per homework
-- (2026-09-30). Safe to run more than once.
--
-- Jasur: "most of my files that i have to attach when i post homework
-- are in telegram … i want to fully switch to the website … i want my
-- telegram account to be used for my private life".
--
--   material_folders      — the teacher's folders (can be nested).
--   materials             — every saved file: uploaded on the website OR
--                           forwarded to the Telegram bot. Files live in
--                           the new public `materials` storage bucket.
--   homework_attachments  — any number of files on one homework (the old
--                           single homeworks.attachment_url keeps working).
--   material_inbox_state  — which folder the Telegram bot currently saves
--                           forwarded files into, per teacher.
--
-- Only teachers can see or change the library. Students only ever see
-- the files attached to homework in their own groups.
-- ============================================================

-- ---------- folders ----------
create table if not exists public.material_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  parent_id uuid references public.material_folders(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index if not exists material_folders_unique_name
  on public.material_folders (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index if not exists material_folders_parent_idx on public.material_folders (parent_id);

-- ---------- files ----------
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.material_folders(id) on delete set null,
  title text not null,
  file_name text not null,
  storage_path text not null unique,
  url text not null,
  mime_type text,
  size_bytes bigint,
  source text not null default 'upload' check (source in ('upload', 'telegram')),
  telegram_file_unique_id text,
  caption text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- The same Telegram file forwarded twice is only saved once.
create unique index if not exists materials_telegram_unique
  on public.materials (telegram_file_unique_id)
  where telegram_file_unique_id is not null;
create index if not exists materials_folder_created_idx on public.materials (folder_id, created_at desc);
create index if not exists materials_created_idx on public.materials (created_at desc);

-- ---------- several files per homework ----------
create table if not exists public.homework_attachments (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homeworks(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  url text not null,
  name text not null,
  mime_type text,
  size_bytes bigint,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists homework_attachments_homework_idx
  on public.homework_attachments (homework_id, sort_order);
create index if not exists homework_attachments_material_idx
  on public.homework_attachments (material_id);

-- ---------- Telegram bot state ----------
create table if not exists public.material_inbox_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  folder_id uuid references public.material_folders(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------- security ----------
alter table public.material_folders enable row level security;
alter table public.materials enable row level security;
alter table public.homework_attachments enable row level security;
alter table public.material_inbox_state enable row level security;

drop policy if exists material_folders_teacher_all on public.material_folders;
create policy material_folders_teacher_all on public.material_folders
  for all to authenticated
  using ((select public.is_teacher()))
  with check ((select public.is_teacher()));

drop policy if exists materials_teacher_all on public.materials;
create policy materials_teacher_all on public.materials
  for all to authenticated
  using ((select public.is_teacher()))
  with check ((select public.is_teacher()));

drop policy if exists homework_attachments_select on public.homework_attachments;
create policy homework_attachments_select on public.homework_attachments
  for select to authenticated
  using (
    (select public.is_teacher())
    or exists (
      select 1 from public.homeworks h
      where h.id = homework_attachments.homework_id
        and public.is_group_member(h.group_id)
    )
  );

drop policy if exists homework_attachments_teacher_write on public.homework_attachments;
create policy homework_attachments_teacher_write on public.homework_attachments
  for all to authenticated
  using ((select public.is_teacher()))
  with check ((select public.is_teacher()));

drop policy if exists material_inbox_state_own on public.material_inbox_state;
create policy material_inbox_state_own on public.material_inbox_state
  for all to authenticated
  using (user_id = (select auth.uid()) and (select public.is_teacher()))
  with check (user_id = (select auth.uid()) and (select public.is_teacher()));

grant select, insert, update, delete on public.material_folders, public.materials,
  public.homework_attachments, public.material_inbox_state to authenticated;

-- ---------- storage bucket ----------
-- Public (like homework-files) so attachment links open for students
-- without extra signing; file names are random and never listed.
insert into storage.buckets (id, name, public)
values ('materials', 'materials', true)
on conflict (id) do update set public = true;

drop policy if exists materials_storage_teacher_insert on storage.objects;
create policy materials_storage_teacher_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'materials' and (select public.is_teacher()));

drop policy if exists materials_storage_teacher_update on storage.objects;
create policy materials_storage_teacher_update on storage.objects
  for update to authenticated
  using (bucket_id = 'materials' and (select public.is_teacher()));

drop policy if exists materials_storage_teacher_delete on storage.objects;
create policy materials_storage_teacher_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'materials' and (select public.is_teacher()));

drop policy if exists materials_storage_read on storage.objects;
create policy materials_storage_read on storage.objects
  for select to authenticated
  using (bucket_id = 'materials');

-- Files forwarded to the Telegram bot pop into the open Library page
-- live (RLS still limits them to teachers).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'materials') then
    alter publication supabase_realtime add table public.materials;
  end if;
end $$;

notify pgrst, 'reload schema';
