-- Migration 15 — fixes the "can't pin a group message" bug
--
-- What was broken: migration_13's group-chat pin policies required
-- BOTH "is_teacher()" AND "is_member_of_group(group_id)". But
-- is_member_of_group only checks the group_members table, which
-- lists STUDENTS — the teacher who runs a group is never a row in
-- there. Every other teacher-moderation policy in this app (deleting
-- or editing any group message, for example) correctly uses
-- "is_group_member(...) OR is_teacher()" instead, precisely so the
-- teacher isn't blocked by a membership check that was never about
-- them. Because migration_13 used AND instead of OR (and left the
-- teacher out of the SELECT policy entirely), a teacher could never
-- pin a message, and would never even see the pinned-message banner,
-- in ANY group — which is exactly the
-- "new row violates row-level security policy for table
-- group_message_pins" error just reported.
--
-- This also adds the UPDATE policies migration_13 was missing on
-- both pin tables. Pinning is done as an upsert (insert, or update if
-- that message already has a pin row) — without an UPDATE policy,
-- re-pinning a message that already has a row hits the exact same
-- kind of RLS wall, in both group and private chats.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------
-- Group chats
-- ---------------------------------------------------------------

drop policy if exists group_message_pins_select on group_message_pins;
create policy group_message_pins_select
on group_message_pins
for select
using ( public.is_member_of_group(group_id) or public.is_teacher() );

drop policy if exists group_message_pins_insert on group_message_pins;
create policy group_message_pins_insert
on group_message_pins
for insert
with check (
  pinned_by = auth.uid()
  and public.is_teacher()
);

drop policy if exists group_message_pins_update on group_message_pins;
create policy group_message_pins_update
on group_message_pins
for update
using ( public.is_teacher() )
with check ( public.is_teacher() );

drop policy if exists group_message_pins_delete on group_message_pins;
create policy group_message_pins_delete
on group_message_pins
for delete
using ( public.is_teacher() );

-- ---------------------------------------------------------------
-- Private chats — same missing-UPDATE-policy problem, added
-- defensively so re-pinning never breaks there either.
-- ---------------------------------------------------------------

drop policy if exists message_pins_update on message_pins;
create policy message_pins_update
on message_pins
for update
using (
  exists (
    select 1 from messages m
    where m.id = message_pins.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
)
with check (
  pinned_by = auth.uid()
  and exists (
    select 1 from messages m
    where m.id = message_pins.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
  )
);
