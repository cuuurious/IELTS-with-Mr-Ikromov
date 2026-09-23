-- MIGRATION 24: PRIVATE CHAT — UNREAD TRACKING
--
-- Group chat has known "who has read what" since migration 22
-- (group_message_reads). Private 1:1 chat never had an equivalent,
-- which is exactly why the private chat inbox has never been able to
-- show an unread dot/badge or bold an unread conversation — there was
-- nothing to compare a message's timestamp against.
--
-- Rather than per-message read receipts (double-check marks — not
-- part of this round, see main-site-redesign-direction.md), this adds
-- one lightweight "I've read this conversation up to this moment"
-- marker per (user, peer) pair. That's all an inbox unread badge
-- actually needs, and it's a lot cheaper to keep in sync than a row
-- per message.
--
-- Additive only — new table, new policies. Nothing already working
-- is touched. Safe to run more than once.

create table if not exists public.private_chat_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  peer_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);

create index if not exists private_chat_reads_user_id_idx
  on public.private_chat_reads(user_id);

alter table public.private_chat_reads enable row level security;

-- Strictly "your own rows only" — nobody needs to see or set anyone
-- else's read marker (this isn't building read-receipt ticks visible
-- to the other person, just this account's own inbox badge state).

drop policy if exists "Users can view their own read markers"
on public.private_chat_reads;

create policy "Users can view their own read markers"
on public.private_chat_reads
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can set their own read markers"
on public.private_chat_reads;

create policy "Users can set their own read markers"
on public.private_chat_reads
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update their own read markers"
on public.private_chat_reads;

create policy "Users can update their own read markers"
on public.private_chat_reads
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can clear their own read markers"
on public.private_chat_reads;

create policy "Users can clear their own read markers"
on public.private_chat_reads
for delete to authenticated
using (user_id = auth.uid());

notify pgrst, 'reload schema';
