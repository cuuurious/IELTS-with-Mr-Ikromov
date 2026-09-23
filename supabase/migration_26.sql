-- MIGRATION 26: PRIVATE CHAT — READ RECEIPTS ("Seen" ticks)
--
-- migration_24 added private_chat_reads for one purpose only: the
-- inbox unread badge, which only ever needs an account to see its OWN
-- read marker for a peer — so its select policy was locked to
-- `user_id = auth.uid()` on purpose (see that file's comments).
--
-- Now that's not enough: a "Seen" checkmark and "Read HH:MM" text on
-- a message someone SENT needs to see how far the OTHER person has
-- read the conversation — i.e. the row where THEY are user_id and
-- THIS account is peer_id. This widens select (and only select —
-- insert/update/delete stay exactly as restrictive as before, an
-- account can still only ever write its own read marker) to also
-- allow seeing rows where you're the peer being read. That only ever
-- exposes a timestamp ("when did they last open this chat with me"),
-- never message content.
--
-- Safe to run more than once.

drop policy if exists "Users can view their own read markers"
on public.private_chat_reads;

create policy "Users can view their own read markers"
on public.private_chat_reads
for select to authenticated
using (user_id = auth.uid() or peer_id = auth.uid());

notify pgrst, 'reload schema';
