-- ============================================================
-- Migration 58 — run this once in Supabase SQL Editor, after 29-57
--
-- Pre-test audit, 2026-09-26 (Jasur: "test everything u mentioned, avoid
-- anything that could interrupt exam environment like pausing
-- resubmitting or creating two tabs and etc, also autosubmission should
-- be present, students cant see anything (results/mistakes) unless
-- teacher approves... now start and fix any errors u come across with").
--
-- This project has "no column-level RLS anywhere" (migration_34/48's own
-- words) — every "update own row" policy lets a student rewrite ANY
-- column on that row, not just the ones the app's own UI ever touches.
-- That was a deliberate, accepted trade-off back when these tables only
-- held a student's own answers. It stopped being safe the moment later
-- migrations added GRADING and SEQUENCING columns onto those same
-- student-updatable rows:
--
--   1. writing_mock_attempts (migration_34 table, migration_48 columns):
--      a student can update their OWN row (writing_mock_attempts_update_own,
--      migration_34) — and that row now also holds examiner_band,
--      examiner_feedback, examiner_reviewed_by, examiner_reviewed_at,
--      released_at, released_by (migrations 34/48). Right now, from the
--      browser console, ANY student can run:
--
--        supabase.from('writing_mock_attempts').update({
--          examiner_band: 9, released_at: new Date().toISOString()
--        }).eq('id', myAttemptId)
--
--      ...and hand themselves a perfect Writing band, released, with no
--      examiner ever involved. This is the single most serious finding
--      of this audit — it defeats "students can't see results until
--      teacher approves" completely, not just partially. It also lets a
--      student edit task1_text/task2_text or flip submitted_at back to
--      null AFTER submitting, i.e. resubmit / keep editing after the
--      exam should be locked — exactly what Jasur asked to be prevented.
--
--   2. full_mock_attempts (migration_37): a student can update their own
--      row (full_mock_attempts_update_own) with no restriction on
--      `stage` or the three attempt-id columns. Today nothing stops a
--      student from posting stage: 'writing' straight from 'listening'
--      (skipping Reading entirely), or stage: 'listening' again after
--      finishing it (re-doing a module they already sat), or pointing
--      reading_attempt_id at a different attempt row than the one they
--      actually just sat. This is the "one to one replication of the
--      real exam flow" (Listening -> Reading -> Writing, in order, once)
--      that migration_37 was built for, currently unenforced below the
--      app layer.
--
-- mock_attempts has the exact same shape of problem (mock_attempts_update_own,
-- migration_47, plus band/released_at/released_by from migration_48) —
-- deliberately NOT touched here. Fixing it safely needs to know exactly
-- what submit_mock_attempt() itself writes to that table (it's a
-- security-definer RPC whose source isn't in any migration file — it
-- pre-dates this repo), so a trigger doesn't accidentally block your own
-- grading path. Asked you separately for that function's definition;
-- once I have it I'll ship the matching fix for mock_attempts as its own
-- migration. Everything below is safe to ship right now because both of
-- these tables are only ever written by ordinary client-side .update()
-- calls with a known, grep-confirmed set of columns — no RPC involved.
-- ============================================================

-- ---------- 1. writing_mock_attempts: lock down grading/release + post-submit edits ----------
create or replace function public.enforce_writing_mock_attempts_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Teachers are the trusted operators here (same as everywhere else in
  -- this project) — no restriction on what they can fix by hand.
  if public.is_teacher() then
    return new;
  end if;

  -- Nobody else may ever move a row to a different exam/student, or
  -- rewrite when it was started.
  if new.exam_id is distinct from old.exam_id
     or new.student_id is distinct from old.student_id
     or new.started_at is distinct from old.started_at then
    raise exception 'writing_mock_attempts: exam_id/student_id/started_at cannot be changed.';
  end if;

  if public.is_writing_examiner() then
    -- The examiner's own dashboard (WritingExaminerDashboard.jsx) only
    -- ever writes the four grading columns — never the student's answer
    -- text, never the release gate (that's the teacher's own action in
    -- TeacherMockCenter.jsx).
    if new.task1_text is distinct from old.task1_text
       or new.task2_text is distinct from old.task2_text
       or new.tab_switch_count is distinct from old.tab_switch_count
       or new.auto_submitted is distinct from old.auto_submitted
       or new.submitted_at is distinct from old.submitted_at
       or new.released_at is distinct from old.released_at
       or new.released_by is distinct from old.released_by then
      raise exception 'writing_mock_attempts: examiners can only set the grading fields.';
    end if;
    return new;
  end if;

  -- Everyone left falls through to here only because
  -- writing_mock_attempts_update_own already required student_id =
  -- auth.uid() to reach this row at all — this is the student marking
  -- their own attempt.
  if new.examiner_band is distinct from old.examiner_band
     or new.examiner_feedback is distinct from old.examiner_feedback
     or new.examiner_reviewed_by is distinct from old.examiner_reviewed_by
     or new.examiner_reviewed_at is distinct from old.examiner_reviewed_at
     or new.ta_band is distinct from old.ta_band
     or new.cc_band is distinct from old.cc_band
     or new.lr_band is distinct from old.lr_band
     or new.gra_band is distinct from old.gra_band
     or new.released_at is distinct from old.released_at
     or new.released_by is distinct from old.released_by then
    raise exception 'writing_mock_attempts: students cannot set grading or release fields.';
  end if;

  -- Once submitted, WritingMockExam.jsx never writes to this row again
  -- (submittedRef blocks it client-side) — enforce that server-side too,
  -- so a submitted attempt can't be edited, un-submitted, or resubmitted
  -- by calling the table directly.
  if old.submitted_at is not null then
    raise exception 'writing_mock_attempts: this attempt has already been submitted.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_writing_mock_attempts_update on public.writing_mock_attempts;
create trigger trg_enforce_writing_mock_attempts_update
  before update on public.writing_mock_attempts
  for each row
  execute function public.enforce_writing_mock_attempts_update();

-- ---------- 2. full_mock_attempts: enforce the Listening -> Reading -> Writing -> Done sequence ----------
create or replace function public.enforce_full_mock_attempts_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set public.full_mock_sets%rowtype;
begin
  if public.is_teacher() then
    return new;
  end if;

  if new.student_id is distinct from old.student_id
     or new.set_id is distinct from old.set_id
     or new.started_at is distinct from old.started_at then
    raise exception 'full_mock_attempts: student_id/set_id/started_at cannot be changed.';
  end if;

  -- Stage can only ever move forward exactly one step (FullMockRunner.jsx's
  -- own advanceStage never does anything else) — no skipping ahead, no
  -- going back to redo a module.
  if new.stage is distinct from old.stage then
    if not (
      (old.stage = 'listening' and new.stage = 'reading') or
      (old.stage = 'reading' and new.stage = 'writing') or
      (old.stage = 'writing' and new.stage = 'done')
    ) then
      raise exception 'full_mock_attempts: invalid stage transition % -> %.', old.stage, new.stage;
    end if;
  end if;

  -- Each stage's attempt id is a one-time write (set the moment that
  -- stage is exited) and immutable afterwards — a student can't swap in
  -- a different attempt later to paper over one they didn't actually sit.
  if old.listening_attempt_id is not null and new.listening_attempt_id is distinct from old.listening_attempt_id then
    raise exception 'full_mock_attempts: listening_attempt_id is already set.';
  end if;
  if old.reading_attempt_id is not null and new.reading_attempt_id is distinct from old.reading_attempt_id then
    raise exception 'full_mock_attempts: reading_attempt_id is already set.';
  end if;
  if old.writing_attempt_id is not null and new.writing_attempt_id is distinct from old.writing_attempt_id then
    raise exception 'full_mock_attempts: writing_attempt_id is already set.';
  end if;

  select * into v_set from public.full_mock_sets where id = new.set_id;

  -- And when one of those ids is being set for the first time, it has to
  -- actually be this student's own submitted attempt for the exact exam
  -- this set bundles — not just any attempt row they can guess/hold the
  -- id of.
  if new.listening_attempt_id is not null and old.listening_attempt_id is null then
    if not exists (
      select 1 from public.mock_attempts a
      where a.id = new.listening_attempt_id
        and a.user_id = auth.uid()
        and a.exam_id = v_set.listening_exam_id
        and a.submitted_at is not null
    ) then
      raise exception 'full_mock_attempts: listening_attempt_id must be your own submitted attempt for this set''s Listening exam.';
    end if;
  end if;

  if new.reading_attempt_id is not null and old.reading_attempt_id is null then
    if not exists (
      select 1 from public.mock_attempts a
      where a.id = new.reading_attempt_id
        and a.user_id = auth.uid()
        and a.exam_id = v_set.reading_exam_id
        and a.submitted_at is not null
    ) then
      raise exception 'full_mock_attempts: reading_attempt_id must be your own submitted attempt for this set''s Reading exam.';
    end if;
  end if;

  if new.writing_attempt_id is not null and old.writing_attempt_id is null then
    if not exists (
      select 1 from public.writing_mock_attempts a
      where a.id = new.writing_attempt_id
        and a.student_id = auth.uid()
        and a.exam_id = v_set.writing_exam_id
        and a.submitted_at is not null
    ) then
      raise exception 'full_mock_attempts: writing_attempt_id must be your own submitted attempt for this set''s Writing exam.';
    end if;
  end if;

  -- completed_at only ever moves alongside stage -> done (advanceStage
  -- sets both in the same call, never one without the other).
  if new.completed_at is distinct from old.completed_at and new.stage is distinct from 'done' then
    raise exception 'full_mock_attempts: completed_at can only be set together with stage = done.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_full_mock_attempts_update on public.full_mock_attempts;
create trigger trg_enforce_full_mock_attempts_update
  before update on public.full_mock_attempts
  for each row
  execute function public.enforce_full_mock_attempts_update();

-- ---------- 3. full_mock_attempts: creating one still needs a checked-in code ----------
-- Found while tracing this table: full_mock_attempts_insert_own
-- (migration_37) lets a student insert a row for ANY set_id they can see
-- (full_mock_sets_select shows every is_active set to every student) —
-- there was never a DB-level tie back to mock_access_codes. In practice
-- MockCheckIn.jsx (the only screen that renders FullMockRunner) always
-- passes the one set a verified, checked-in code was issued for, so this
-- was never reachable through the app's own UI — but migration_45's own
-- words were "every Full Mock attempt now requires a teacher-issued
-- code," and right now that's only true because of which screen happens
-- to call this insert, not because the database enforces it. Closing it
-- properly, the same way get_mock_questions_public() already checks this
-- exact condition (migration_57).
create or replace function public.enforce_full_mock_attempts_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_teacher() then
    return new;
  end if;

  if not exists (
    select 1
    from public.mock_access_codes ac
    where ac.student_id = auth.uid()
      and ac.full_mock_set_id = new.set_id
      and ac.used_at is not null
      and ac.revoked = false
  ) then
    raise exception 'full_mock_attempts: you need a checked-in access code for this Full Mock set.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_full_mock_attempts_insert on public.full_mock_attempts;
create trigger trg_enforce_full_mock_attempts_insert
  before insert on public.full_mock_attempts
  for each row
  execute function public.enforce_full_mock_attempts_insert();

notify pgrst, 'reload schema';

-- ============================================================
-- After running this, please re-test the full student flow once
-- end-to-end (Listening -> Reading -> Writing) before tomorrow, since
-- this is now enforcing rules the database never checked before. If any
-- legitimate step in that flow suddenly errors, send me the exact error
-- message and I'll adjust the trigger — it almost certainly means the
-- app writes a column in a way I didn't find when I grepped for every
-- .update() call site.
-- ============================================================
