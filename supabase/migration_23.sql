-- MIGRATION 23: TELEGRAM-STYLE GROUP PROFILES, MEMBER LIST, AND
-- PER-GROUP OWNER/ADMIN ROLES
--
-- Adds what a group needs to feel like a real Telegram group instead of
-- just a homework list with a chat bolted on: a photo + description for
-- the group itself, a per-member "muted" flag (so muting notifications
-- for one group doesn't touch any other group), and a real per-group
-- Owner/Admin model (group_admins) instead of the current all-or-nothing
-- "every teacher can do everything" — the group's creator becomes its
-- Owner automatically, and an Owner can later promote other staff to
-- Admin of that specific group once there's more than one staff account
-- to promote (see the site's redesign-direction notes — that part is
-- staged as "build now, adopt once staff accounts exist" on purpose).
--
-- Nothing here removes or narrows any existing access: every new
-- permission check ORs in is_teacher(), so today — with exactly one
-- teacher account — behavior is unchanged. The new tables/policies only
-- start doing real work once a second staff account exists and an Owner
-- chooses to promote someone to Admin of a specific group rather than
-- full teacher access.

-- ---------------------------------------------------------------------
-- GROUPS — photo + description
-- ---------------------------------------------------------------------
alter table public.groups
  add column if not exists photo_url text,
  add column if not exists description text;

-- ---------------------------------------------------------------------
-- GROUP MEMBERS — per-member, per-group mute flag
-- ---------------------------------------------------------------------
alter table public.group_members
  add column if not exists muted boolean not null default false;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- GROUP ADMINS — per-group Owner/Admin role
-- ---------------------------------------------------------------------
create table if not exists public.group_admins (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin')),
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists group_admins_group_id_idx
  on public.group_admins(group_id);

create index if not exists group_admins_user_id_idx
  on public.group_admins(user_id);

-- Backfill: every existing group's creator becomes its Owner. Data-driven
-- from groups.created_by — no guessing at a specific account.
insert into public.group_admins (group_id, user_id, role, granted_by)
select id, created_by, 'owner', created_by
from public.groups
where created_by is not null
on conflict (group_id, user_id) do nothing;

-- Every NEW group gets its creator marked as Owner automatically, so this
-- never has to be remembered as a manual follow-up step in the app code.
create or replace function public.handle_new_group_owner()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.created_by is not null then
    insert into public.group_admins (group_id, user_id, role, granted_by)
    values (new.id, new.created_by, 'owner', new.created_by)
    on conflict (group_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_new_group_owner on public.groups;

create trigger trg_new_group_owner
after insert on public.groups
for each row execute function public.handle_new_group_owner();

-- ---------------------------------------------------------------------
-- HELPER FUNCTIONS (security definer -> avoid RLS recursion), matching
-- the existing is_teacher() / is_group_member() pattern in schema.sql.
-- Both OR in is_teacher() so any teacher account keeps today's full
-- access no matter what group_admins says — this is additive, not a
-- replacement for the existing permission model.
-- ---------------------------------------------------------------------
create or replace function public.is_group_owner(check_group_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    exists (
      select 1 from public.group_admins
      where group_id = check_group_id
        and user_id = auth.uid()
        and role = 'owner'
    )
    or public.is_teacher();
$$;

create or replace function public.is_group_admin(check_group_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    exists (
      select 1 from public.group_admins
      where group_id = check_group_id
        and user_id = auth.uid()
        and role in ('owner', 'admin')
    )
    or public.is_teacher();
$$;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY — group_admins
-- ---------------------------------------------------------------------
alter table public.group_admins enable row level security;

drop policy if exists "ga_select_member_or_teacher" on public.group_admins;

create policy "ga_select_member_or_teacher"
on public.group_admins
for select
to authenticated
using (
  public.is_group_member(group_id)
  or public.is_teacher()
);

drop policy if exists "ga_insert_owner" on public.group_admins;

create policy "ga_insert_owner"
on public.group_admins
for insert
to authenticated
with check (public.is_group_owner(group_id));

drop policy if exists "ga_update_owner" on public.group_admins;

create policy "ga_update_owner"
on public.group_admins
for update
to authenticated
using (public.is_group_owner(group_id))
with check (public.is_group_owner(group_id));

drop policy if exists "ga_delete_owner" on public.group_admins;

create policy "ga_delete_owner"
on public.group_admins
for delete
to authenticated
using (public.is_group_owner(group_id));

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY — group_members gained a real column (muted) that
-- a student needs to update on their own row; schema.sql never had an
-- UPDATE policy on this table at all (only select/insert/delete), so
-- this is a new grant, not a change to an existing one.
-- ---------------------------------------------------------------------
drop policy if exists "gm_update_self" on public.group_members;

create policy "gm_update_self"
on public.group_members
for update
to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid());

drop policy if exists "gm_update_teacher" on public.group_members;

create policy "gm_update_teacher"
on public.group_members
for update
to authenticated
using (public.is_teacher())
with check (public.is_teacher());

-- ---------------------------------------------------------------------
-- STORAGE — group photos, same public-read / owner-folder-write shape
-- as the existing homework-files / submissions buckets.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('group-photos', 'group-photos', true)
on conflict (id) do nothing;

drop policy if exists "group_photos_read_all" on storage.objects;

create policy "group_photos_read_all"
on storage.objects
for select
to authenticated
using (bucket_id = 'group-photos');

drop policy if exists "group_photos_write_teacher" on storage.objects;

create policy "group_photos_write_teacher"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'group-photos'
  and public.is_teacher()
);

drop policy if exists "group_photos_update_teacher" on storage.objects;

create policy "group_photos_update_teacher"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'group-photos'
  and public.is_teacher()
);

drop policy if exists "group_photos_delete_teacher" on storage.objects;

create policy "group_photos_delete_teacher"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'group-photos'
  and public.is_teacher()
);

notify pgrst, 'reload schema';
