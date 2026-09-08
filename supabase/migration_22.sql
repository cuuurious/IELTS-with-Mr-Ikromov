-- MIGRATION 22: GROUP MESSAGE READ RECEIPTS

create table if not exists public.group_message_reads (
  message_id uuid not null references public.group_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists group_message_reads_message_id_idx
  on public.group_message_reads(message_id);

create index if not exists group_message_reads_user_id_idx
  on public.group_message_reads(user_id);

alter table public.group_message_reads enable row level security;

drop policy if exists "Group members can view message reads"
on public.group_message_reads;

create policy "Group members can view message reads"
on public.group_message_reads
for select to authenticated
using (
  exists (
    select 1
    from public.group_messages gm
    where gm.id = group_message_reads.message_id
      and (
        gm.sender_id = auth.uid()
        or exists (
          select 1
          from public.group_members gmem
          where gmem.group_id = gm.group_id
            and gmem.student_id = auth.uid()
        )
        or exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.role = 'teacher'
        )
      )
  )
);

drop policy if exists "Users can mark messages as read"
on public.group_message_reads;

create policy "Users can mark messages as read"
on public.group_message_reads
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update their own read receipts"
on public.group_message_reads;

create policy "Users can update their own read receipts"
on public.group_message_reads
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
