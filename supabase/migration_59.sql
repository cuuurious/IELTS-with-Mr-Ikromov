-- ============================================================
-- Migration 59 — run this once in Supabase SQL Editor, after 29-58
--
-- Closes the last piece of the pre-test audit (migration_58's own
-- comments): the same "no column-level RLS" gap on mock_attempts itself
-- (Reading/Listening), left open in migration_58 specifically because
-- fixing it safely needed to see submit_mock_attempt()'s real source
-- first. Jasur pasted that source (2026-09-26/27):
--
--   create or replace function public.submit_mock_attempt(p_attempt_id
--   uuid, p_answers jsonb) returns table(score integer, max_score
--   integer) ... security definer ...
--     - checks v_owner = auth.uid() and raises if already submitted
--     - grades every mock_questions row for the exam, upserts mock_answers
--     - update public.mock_attempts set submitted_at = now(), score =
--       v_total_score, max_score = v_max_score where id = p_attempt_id;
--
-- So the ONLY columns this function ever writes on mock_attempts are
-- submitted_at/score/max_score, together, exactly once (it already
-- raises its own exception on a second submission — real grading was
-- never resubmittable even before this migration). Everything else a
-- student can currently do to their own mock_attempts row
-- (mock_attempts_update_own, migration_47 — no column restriction, same
-- as the writing_mock_attempts/full_mock_attempts gaps migration_58
-- already closed) is exactly what this migration locks down:
--
--   supabase.from('mock_attempts').update({
--     band: 9, released_at: new Date().toISOString()
--   }).eq('id', myAttemptId)
--
-- ...would currently hand a student a fake, released Reading/Listening
-- band with no teacher involved — the same shape of bug as the Writing
-- one migration_58 fixed, just not yet closed here. It would also let a
-- student edit draft_answers/tab_switch_count or reopen an already-
-- submitted attempt for further "editing" after the fact.
-- ============================================================

create or replace function public.enforce_mock_attempts_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_real_max_score integer;
begin
  -- Teachers are the trusted operators here, same as every other table
  -- this audit touched.
  if public.is_teacher() then
    return new;
  end if;

  -- Nobody else may ever move a row to a different exam/student, rewrite
  -- when it started, or touch the release gate (band/released_at/
  -- released_by) — that's the teacher's own action in
  -- TeacherMockCenter.jsx's Results tab, never the student's.
  if new.exam_id is distinct from old.exam_id
     or new.user_id is distinct from old.user_id
     or new.started_at is distinct from old.started_at
     or new.band is distinct from old.band
     or new.released_at is distinct from old.released_at
     or new.released_by is distinct from old.released_by then
    raise exception 'mock_attempts: exam_id/user_id/started_at/band/released_at/released_by cannot be changed directly.';
  end if;

  -- Once submitted, nothing writes to this row again from the student
  -- side — MockExams.jsx's own autosave effect stops the moment phase
  -- leaves 'in-progress', and submit_mock_attempt() itself already
  -- refuses a second submission internally. Enforcing it here too closes
  -- the direct-table-call version of the same thing (editing answers or
  -- resubmitting after the fact by calling .update() straight instead of
  -- going through the RPC).
  if old.submitted_at is not null then
    raise exception 'mock_attempts: this attempt has already been submitted.';
  end if;

  -- Pattern A: the periodic/integrity-log autosave (MockExams.jsx) —
  -- only tab_switch_count and/or draft_answers move, submission stays
  -- untouched. Covers all three real autosave call sites (the 30s
  -- interval, the immediate save when Listening's review window opens,
  -- and the one-last-save right before a real submit).
  if new.submitted_at is null
     and new.score is not distinct from old.score
     and new.max_score is not distinct from old.max_score then
    return new;
  end if;

  -- Pattern B: a real submission. submitted_at moves from null to a
  -- value, together with score/max_score. This can't re-run
  -- submit_mock_attempt()'s own per-question grading to verify the exact
  -- score — but it CAN verify max_score against the exam's real total
  -- points and keep score in a sane 0..max_score range, so a direct call
  -- can't hand itself an arbitrary or oversized score even if it mimics
  -- this shape.
  if new.submitted_at is not null then
    select coalesce(sum(q.points), 0)
      into v_real_max_score
      from public.mock_questions q
      join public.mock_sections s on s.id = q.section_id
      where s.exam_id = new.exam_id;

    if new.max_score is distinct from v_real_max_score then
      raise exception 'mock_attempts: max_score must match this exam''s real total points (%).', v_real_max_score;
    end if;
    if new.score is null or new.score < 0 or new.score > new.max_score then
      raise exception 'mock_attempts: score is out of range.';
    end if;
    return new;
  end if;

  raise exception 'mock_attempts: that combination of changes is not allowed.';
end;
$$;

drop trigger if exists trg_enforce_mock_attempts_update on public.mock_attempts;
create trigger trg_enforce_mock_attempts_update
  before update on public.mock_attempts
  for each row
  execute function public.enforce_mock_attempts_update();

notify pgrst, 'reload schema';

-- ============================================================
-- After running this, do one full Reading or Listening attempt end to
-- end (start, autosave a few answers, let it submit) and confirm it
-- still works normally — this now enforces rules the database never
-- checked before, same caution as migration_58. If the real submit
-- ever errors after this, send me the exact message; it most likely
-- means max_score doesn't match what mock_questions actually sums to
-- for that exam (e.g. a question with a null points value).
--
-- Not touched here, flagged for a separate decision, same as the
-- mock_questions_public writeup's own "lower priority" note:
-- mock_attempts_insert_own (migration_47) lets a student INSERT an
-- attempt row for any mock_exams.id, not only one reachable through a
-- checked-in Full Mock code — mirroring the full_mock_attempts insert
-- gap migration_58 closed, but for standalone Reading/Listening exams.
-- In practice this needs calling the API directly (there's no button in
-- the app for it), and get_mock_questions_public() already blocks
-- reading that exam's real questions without a valid code, so the worst
-- case is a technically-inclined student submitting blind/guessed
-- answers straight to submit_mock_attempt() to see a raw score outside
-- the normal flow — never a released, teacher-visible result. Lower
-- severity than everything fixed tonight; worth its own pass rather than
-- rushing a fourth trigger the night before the test.
-- ============================================================
