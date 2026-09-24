-- MIGRATION 27: FIX — "Seen" ticks never update live
--
-- Found while diagnosing Jasur's report that a sent message stayed on a
-- single tick even after the peer had clearly replied (so they must have
-- opened the chat and read it).
--
-- Root cause: migration_24 created private_chat_reads but never added it
-- to the `supabase_realtime` publication. Every other table this app
-- subscribes to live (messages, message_reactions, message_pins,
-- message_deletions) already is in that publication — this one new table
-- was simply missed. Without it, Postgres never broadcasts INSERT/UPDATE
-- events on private_chat_reads at all, so the realtime handler added for
-- read receipts in Chat.jsx/PrivateChats.jsx has nothing to ever receive:
-- the tick only reflects whatever was true the moment the chat was first
-- opened, and never updates again until it's closed and reopened.
--
-- This only adds the table to the publication — no RLS, columns, or
-- policies change. Safe to run more than once.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'private_chat_reads'
  ) then
    alter publication supabase_realtime add table public.private_chat_reads;
  end if;
end $$;
