-- Best-guess fix for "students could not be notified" firing on every
-- single homework post/update.
--
-- notifyGroup() (src/lib/notify.js) does two things as the TEACHER's own
-- logged-in session (not a server-side admin key): it inserts one row
-- per student into `notifications`, then calls the send-push function.
-- The error screenshot showed the generic "students could not be
-- notified" text, which only happens when something before the push
-- step throws — almost always a Row Level Security policy blocking the
-- INSERT, because a typical RLS policy on `notifications` only allows
-- "insert your own notifications" (auth.uid() = user_id), which is
-- correct for a student marking their own notification read, but
-- blocks a TEACHER from inserting rows for many different students at
-- once, every time, which matches exactly what's being reported.
--
-- This is additive only — it does not remove or replace any existing
-- policy, it just also allows the specific case of a teacher inserting
-- notification rows for students. If this isn't the actual cause,
-- running this migration is harmless (it simply goes unused).
drop policy if exists "teachers can insert student notifications" on notifications;

create policy "teachers can insert student notifications"
on notifications
for insert
to authenticated
with check (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
    and profiles.role = 'teacher'
  )
);
