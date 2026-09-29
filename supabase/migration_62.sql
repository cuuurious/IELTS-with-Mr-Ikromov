-- ============================================================
-- Migration 62 — run this once in Supabase SQL Editor, after 29-61
--
-- Teacher control over mocks (Jasur, 2026-09-29): "i want to be able to
-- delete the old mocks... i also want to be able to pause a mock for any
-- student... i also want to be able to skip some sections like listening
-- and reading for students if i want to test their writing only...
-- everything should be controllable."
--
-- Decisions confirmed with Jasur the same day:
--   * Delete = attempts/results (a sitting), not the mock content.
--   * Pause = freeze anytime: timer stops, resume later (even another day)
--     with exactly the time that was left.
--   * Skip = both: choose sections when issuing a code, AND skip / end a
--     section live from the dashboard.
--   * Extras: live monitor, extra time + end-section-now, void & retake,
--     retake limit per Full Mock.
--
-- What this adds:
--   1. deadline_at / paused_at / last_seen_at on mock_attempts and
--      writing_mock_attempts. The deadline is now a real server value
--      (set by trigger on insert, never by the student) instead of being
--      recomputed in the browser from started_at — that's what lets a
--      teacher pause (shift it forward on resume) or add time.
--   2. sections on mock_access_codes and full_mock_attempts (which of
--      Listening / Reading / Writing this sitting includes), paused_at on
--      full_mock_attempts, max_attempts on full_mock_sets.
--   3. Updated protection triggers (replacing migration_58/59's versions)
--      so students still can't touch any of the new columns, stage order
--      follows the sitting's own sections, and nothing can be submitted
--      while paused.
--   4. Teacher-only RPCs: pause, resume, add time, end/skip the current
--      section (grading whatever was autosaved), delete a sitting, delete
--      a single attempt.
-- ============================================================

-- ---------- 1. Columns ----------
alter table public.mock_attempts
  add column if not exists deadline_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists last_seen_at timestamptz;

alter table public.writing_mock_attempts
  add column if not exists deadline_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists last_seen_at timestamptz;

alter table public.full_mock_attempts
  add column if not exists sections text[] not null default array['listening', 'reading', 'writing'],
  add column if not exists paused_at timestamptz;

alter table public.mock_access_codes
  add column if not exists sections text[] not null default array['listening', 'reading', 'writing'];

alter table public.full_mock_sets
  add column if not exists max_attempts int;

do $$
begin
  alter table public.full_mock_attempts
    add constraint full_mock_attempts_sections_check
    check (cardinality(sections) >= 1 and sections <@ array['listening', 'reading', 'writing']);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.mock_access_codes
    add constraint mock_access_codes_sections_check
    check (cardinality(sections) >= 1 and sections <@ array['listening', 'reading', 'writing']);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.full_mock_sets
    add constraint full_mock_sets_max_attempts_check
    check (max_attempts is null or max_attempts > 0);
exception when duplicate_object then null;
end $$;

-- Backfill a deadline for anything still in progress right now, using
-- exactly the rule the browser used until today (so nobody's clock jumps).
-- Only unsubmitted rows — the migration_58/59 triggers refuse any update
-- to a submitted row from here, and submitted rows don't need one anyway.
update public.mock_attempts a
   set deadline_at = case
     when nullif(a.draft_answers->>'reviewStartedAt', '') is not null
       then (a.draft_answers->>'reviewStartedAt')::timestamptz + interval '2 minutes'
     else a.started_at + make_interval(mins => case e.module when 'reading' then 60 else 40 end)
   end
  from public.mock_exams e
 where e.id = a.exam_id
   and a.submitted_at is null
   and a.deadline_at is null;

update public.writing_mock_attempts w
   set deadline_at = w.started_at + make_interval(mins => coalesce(x.time_limit_minutes, 60))
  from public.writing_mock_exams x
 where x.id = w.exam_id
   and w.submitted_at is null
   and w.deadline_at is null;

-- ---------- 2. Stage helpers (Listening -> Reading -> Writing, skipping any not in `sections`) ----------
create or replace function public.full_mock_first_stage(p_sections text[])
returns text
language sql
immutable
as $$
  select coalesce(
    (select s from unnest(array['listening', 'reading', 'writing']) with ordinality as t(s, i)
      where s = any(p_sections) order by i limit 1),
    'done')
$$;

create or replace function public.full_mock_next_stage(p_stage text, p_sections text[])
returns text
language sql
immutable
as $$
  select case
    when p_stage = 'done' then 'done'
    else coalesce(
      (select s from unnest(array['listening', 'reading', 'writing']) with ordinality as t(s, i)
        where s = any(p_sections)
          and i > coalesce(array_position(array['listening', 'reading', 'writing'], p_stage), 0)
        order by i limit 1),
      'done')
  end
$$;

-- ---------- 3a. mock_attempts: server-set deadline on insert ----------
create or replace function public.enforce_mock_attempts_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_module text;
begin
  select module into v_module from public.mock_exams where id = new.exam_id;

  if not public.is_teacher() then
    new.started_at := now();
    new.submitted_at := null;
    new.paused_at := null;
    new.band := null;
    new.released_at := null;
    new.released_by := null;
    new.last_seen_at := now();
    new.deadline_at := null;
  end if;

  if new.deadline_at is null then
    new.deadline_at := coalesce(new.started_at, now())
      + make_interval(mins => case v_module when 'reading' then 60 else 40 end);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_mock_attempts_insert on public.mock_attempts;
create trigger trg_enforce_mock_attempts_insert
  before insert on public.mock_attempts
  for each row
  execute function public.enforce_mock_attempts_insert();

-- ---------- 3b. mock_attempts: update protection (replaces migration_59's) ----------
create or replace function public.enforce_mock_attempts_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_real_max_score integer;
  v_old_review text;
  v_new_review text;
  v_module text;
begin
  if public.is_teacher() then
    return new;
  end if;

  if new.exam_id is distinct from old.exam_id
     or new.user_id is distinct from old.user_id
     or new.started_at is distinct from old.started_at
     or new.band is distinct from old.band
     or new.released_at is distinct from old.released_at
     or new.released_by is distinct from old.released_by
     or new.deadline_at is distinct from old.deadline_at
     or new.paused_at is distinct from old.paused_at then
    raise exception 'mock_attempts: exam_id/user_id/started_at/band/release/deadline/pause fields cannot be changed directly.';
  end if;

  if old.submitted_at is not null then
    raise exception 'mock_attempts: this attempt has already been submitted.';
  end if;

  -- Server-side "last seen" for the teacher's live monitor — never
  -- trusted from the browser.
  new.last_seen_at := now();

  -- Pattern A: autosave (tab_switch_count / draft_answers only).
  if new.submitted_at is null
     and new.score is not distinct from old.score
     and new.max_score is not distinct from old.max_score then

    -- Listening's 2-minute review window: the browser marks the moment all
    -- audio has finished by writing draft_answers.reviewStartedAt. The
    -- FIRST time that appears, the server (not the browser) sets the new
    -- 2-minute deadline. Once set it can't be moved or cleared again, so
    -- it can't be re-triggered for a fresh 2 minutes.
    v_old_review := nullif(old.draft_answers->>'reviewStartedAt', '');
    v_new_review := nullif(new.draft_answers->>'reviewStartedAt', '');

    if v_old_review is not null and v_new_review is distinct from v_old_review then
      new.draft_answers := jsonb_set(
        coalesce(new.draft_answers, '{}'::jsonb),
        '{reviewStartedAt}',
        old.draft_answers->'reviewStartedAt'
      );
    elsif v_old_review is null and v_new_review is not null then
      select module into v_module from public.mock_exams where id = new.exam_id;
      if v_module = 'listening' and old.paused_at is null then
        new.deadline_at := now() + interval '2 minutes';
      else
        new.draft_answers := new.draft_answers - 'reviewStartedAt';
      end if;
    end if;

    return new;
  end if;

  -- Pattern B: a real submission (submit_mock_attempt()).
  if new.submitted_at is not null then
    if old.paused_at is not null then
      raise exception 'mock_attempts: this test is paused by your teacher.';
    end if;

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

-- ---------- 4a. writing_mock_attempts: server-set deadline on insert ----------
create or replace function public.enforce_writing_mock_attempts_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes int;
begin
  select time_limit_minutes into v_minutes from public.writing_mock_exams where id = new.exam_id;

  if not public.is_teacher() then
    new.started_at := now();
    new.submitted_at := null;
    new.paused_at := null;
    new.released_at := null;
    new.released_by := null;
    new.last_seen_at := now();
    new.deadline_at := null;
  end if;

  if new.deadline_at is null then
    new.deadline_at := coalesce(new.started_at, now()) + make_interval(mins => coalesce(v_minutes, 60));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_writing_mock_attempts_insert on public.writing_mock_attempts;
create trigger trg_enforce_writing_mock_attempts_insert
  before insert on public.writing_mock_attempts
  for each row
  execute function public.enforce_writing_mock_attempts_insert();

-- ---------- 4b. writing_mock_attempts: update protection (replaces migration_58's) ----------
create or replace function public.enforce_writing_mock_attempts_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_teacher() then
    return new;
  end if;

  if new.exam_id is distinct from old.exam_id
     or new.student_id is distinct from old.student_id
     or new.started_at is distinct from old.started_at
     or new.deadline_at is distinct from old.deadline_at
     or new.paused_at is distinct from old.paused_at then
    raise exception 'writing_mock_attempts: exam_id/student_id/started_at/deadline/pause cannot be changed.';
  end if;

  if public.is_writing_examiner() then
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

  if old.submitted_at is not null then
    raise exception 'writing_mock_attempts: this attempt has already been submitted.';
  end if;

  if new.submitted_at is not null and old.paused_at is not null then
    raise exception 'writing_mock_attempts: this test is paused by your teacher.';
  end if;

  new.last_seen_at := now();
  return new;
end;
$$;

drop trigger if exists trg_enforce_writing_mock_attempts_update on public.writing_mock_attempts;
create trigger trg_enforce_writing_mock_attempts_update
  before update on public.writing_mock_attempts
  for each row
  execute function public.enforce_writing_mock_attempts_update();

-- ---------- 5a. full_mock_attempts: insert (replaces migration_58's) ----------
-- Still requires a checked-in code; now also copies that code's sections
-- onto the sitting, starts it on the first included section, enforces the
-- set's retake limit, and lets one used code start only one sitting.
create or replace function public.enforce_full_mock_attempts_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.mock_access_codes%rowtype;
  v_max int;
  v_count int;
begin
  if public.is_teacher() then
    new.stage := public.full_mock_first_stage(new.sections);
    return new;
  end if;

  select * into v_code
    from public.mock_access_codes ac
   where ac.student_id = auth.uid()
     and ac.full_mock_set_id = new.set_id
     and ac.used_at is not null
     and ac.revoked = false
   order by ac.used_at desc
   limit 1;

  if not found then
    raise exception 'full_mock_attempts: you need a checked-in access code for this Full Mock set.';
  end if;

  if exists (
    select 1 from public.full_mock_attempts f
     where f.student_id = auth.uid()
       and f.set_id = new.set_id
       and f.started_at >= v_code.used_at
  ) then
    raise exception 'full_mock_attempts: this code has already been used to start a sitting. Ask your teacher for a new code.';
  end if;

  select max_attempts into v_max from public.full_mock_sets where id = new.set_id;
  if v_max is not null then
    select count(*) into v_count
      from public.full_mock_attempts f
     where f.student_id = auth.uid() and f.set_id = new.set_id;
    if v_count >= v_max then
      raise exception 'full_mock_attempts: you have already used all % sitting(s) allowed for this mock.', v_max;
    end if;
  end if;

  new.sections := coalesce(v_code.sections, array['listening', 'reading', 'writing']);
  new.stage := public.full_mock_first_stage(new.sections);
  new.paused_at := null;
  new.started_at := now();
  new.completed_at := null;
  new.listening_attempt_id := null;
  new.reading_attempt_id := null;
  new.writing_attempt_id := null;
  return new;
end;
$$;

drop trigger if exists trg_enforce_full_mock_attempts_insert on public.full_mock_attempts;
create trigger trg_enforce_full_mock_attempts_insert
  before insert on public.full_mock_attempts
  for each row
  execute function public.enforce_full_mock_attempts_insert();

-- ---------- 5b. full_mock_attempts: update (replaces migration_58's) ----------
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
     or new.started_at is distinct from old.started_at
     or new.sections is distinct from old.sections
     or new.paused_at is distinct from old.paused_at then
    raise exception 'full_mock_attempts: student_id/set_id/started_at/sections/paused_at cannot be changed.';
  end if;

  -- Stage only ever moves to the NEXT section this sitting includes.
  if new.stage is distinct from old.stage then
    if old.paused_at is not null then
      raise exception 'full_mock_attempts: this mock is paused by your teacher.';
    end if;
    if new.stage is distinct from public.full_mock_next_stage(old.stage, old.sections) then
      raise exception 'full_mock_attempts: invalid stage transition % -> %.', old.stage, new.stage;
    end if;
  end if;

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

-- ---------- 6. Teacher RPCs ----------

-- Which section attempt is running right now for a sitting: ('rl', id) for
-- Listening/Reading, ('w', id) for Writing, nothing if the student is at a
-- gate. Not callable directly — only from the teacher functions below.
create or replace function public._full_mock_live_section(p_full_id uuid)
returns table (kind text, attempt_id uuid)
language plpgsql
stable
as $$
declare
  v_full public.full_mock_attempts%rowtype;
  v_set public.full_mock_sets%rowtype;
begin
  select * into v_full from public.full_mock_attempts where id = p_full_id;
  if not found then
    return;
  end if;
  select * into v_set from public.full_mock_sets where id = v_full.set_id;

  if v_full.stage in ('listening', 'reading') then
    return query
      select 'rl'::text, a.id
        from public.mock_attempts a
       where a.user_id = v_full.student_id
         and a.exam_id = case v_full.stage when 'listening' then v_set.listening_exam_id else v_set.reading_exam_id end
         and a.submitted_at is null
       order by a.started_at desc
       limit 1;
  elsif v_full.stage = 'writing' then
    return query
      select 'w'::text, w.id
        from public.writing_mock_attempts w
       where w.student_id = v_full.student_id
         and w.exam_id = v_set.writing_exam_id
         and w.submitted_at is null
       order by w.started_at desc
       limit 1;
  end if;
end;
$$;

revoke all on function public._full_mock_live_section(uuid) from public, anon, authenticated;

-- Pause: freezes the sitting (gate screens show "paused") and the running
-- section's clock, if any.
create or replace function public.teacher_pause_full_mock(p_full_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_id uuid;
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can pause a mock.';
  end if;

  update public.full_mock_attempts
     set paused_at = now(), updated_at = now()
   where id = p_full_id and paused_at is null and stage <> 'done';

  select kind, attempt_id into v_kind, v_id from public._full_mock_live_section(p_full_id);

  if v_kind = 'rl' then
    update public.mock_attempts set paused_at = now() where id = v_id and paused_at is null;
  elsif v_kind = 'w' then
    update public.writing_mock_attempts set paused_at = now() where id = v_id and paused_at is null;
  end if;
end;
$$;

-- Resume: every paused, unsubmitted section attempt of this student for
-- this set gets its deadline pushed forward by exactly how long it was
-- paused — same time left as the moment it froze.
create or replace function public.teacher_resume_full_mock(p_full_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full public.full_mock_attempts%rowtype;
  v_set public.full_mock_sets%rowtype;
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can resume a mock.';
  end if;

  select * into v_full from public.full_mock_attempts where id = p_full_id for update;
  if not found then
    raise exception 'That sitting no longer exists.';
  end if;
  select * into v_set from public.full_mock_sets where id = v_full.set_id;

  update public.mock_attempts
     set deadline_at = deadline_at + (now() - paused_at),
         paused_at = null
   where user_id = v_full.student_id
     and exam_id in (v_set.listening_exam_id, v_set.reading_exam_id)
     and submitted_at is null
     and paused_at is not null;

  update public.writing_mock_attempts
     set deadline_at = deadline_at + (now() - paused_at),
         paused_at = null
   where student_id = v_full.student_id
     and exam_id = v_set.writing_exam_id
     and submitted_at is null
     and paused_at is not null;

  update public.full_mock_attempts
     set paused_at = null, updated_at = now()
   where id = p_full_id;
end;
$$;

-- Extra time on the section that's running right now.
create or replace function public.teacher_add_time_full_mock(p_full_id uuid, p_minutes int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_id uuid;
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can add time.';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 180 then
    raise exception 'Add between 1 and 180 minutes.';
  end if;

  select kind, attempt_id into v_kind, v_id from public._full_mock_live_section(p_full_id);

  if v_kind = 'rl' then
    update public.mock_attempts set deadline_at = deadline_at + make_interval(mins => p_minutes) where id = v_id;
  elsif v_kind = 'w' then
    update public.writing_mock_attempts set deadline_at = deadline_at + make_interval(mins => p_minutes) where id = v_id;
  else
    raise exception 'This student isn''t inside a timed section right now.';
  end if;
end;
$$;

-- End the current section now (grading whatever was last autosaved) and
-- move the sitting to its next section — or, if the student hasn't
-- started this section yet, skip it. Returns the new stage.
create or replace function public.teacher_advance_full_mock(p_full_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full public.full_mock_attempts%rowtype;
  v_set public.full_mock_sets%rowtype;
  v_kind text;
  v_id uuid;
  v_next text;
  v_exam uuid;
  v_answers jsonb;
  v_raw text;
  v_ok boolean;
  v_score int := 0;
  v_max int := 0;
  q record;
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can end a section.';
  end if;

  select * into v_full from public.full_mock_attempts where id = p_full_id for update;
  if not found then
    raise exception 'That sitting no longer exists.';
  end if;
  if v_full.stage = 'done' then
    raise exception 'This sitting is already finished.';
  end if;

  select kind, attempt_id into v_kind, v_id from public._full_mock_live_section(p_full_id);
  v_next := public.full_mock_next_stage(v_full.stage, v_full.sections);

  -- Nothing running: either the student hasn't started this section (a
  -- real skip), or they already finished it and are sitting on the "Test
  -- submitted" screen. In the second case, still link that attempt.
  if v_kind is null then
    select * into v_set from public.full_mock_sets where id = v_full.set_id;
    if v_full.stage in ('listening', 'reading') then
      select a.id into v_id
        from public.mock_attempts a
       where a.user_id = v_full.student_id
         and a.exam_id = case v_full.stage when 'listening' then v_set.listening_exam_id else v_set.reading_exam_id end
         and a.submitted_at is not null
         and a.started_at >= v_full.started_at
       order by a.submitted_at desc
       limit 1;
      if v_id is not null then
        v_kind := 'rl_done';
      end if;
    elsif v_full.stage = 'writing' then
      select w.id into v_id
        from public.writing_mock_attempts w
       where w.student_id = v_full.student_id
         and w.exam_id = v_set.writing_exam_id
         and w.submitted_at is not null
         and w.started_at >= v_full.started_at
       order by w.submitted_at desc
       limit 1;
      if v_id is not null then
        v_kind := 'w_done';
      end if;
    end if;
  end if;

  if v_kind = 'rl' then
    select exam_id, coalesce(draft_answers->'answers', '{}'::jsonb)
      into v_exam, v_answers
      from public.mock_attempts where id = v_id;

    -- Same rule as submit_mock_attempt(): exact text match, trimmed and
    -- case-insensitive, points per correct answer.
    delete from public.mock_answers where attempt_id = v_id;

    for q in
      select mq.id, coalesce(mq.points, 0) as points, mq.correct_answer
        from public.mock_questions mq
        join public.mock_sections ms on ms.id = mq.section_id
       where ms.exam_id = v_exam
    loop
      v_raw := v_answers->>(q.id::text);
      v_ok := nullif(trim(coalesce(v_raw, '')), '') is not null
              and trim(lower(v_raw)) = trim(lower(coalesce(q.correct_answer, '')));
      insert into public.mock_answers (attempt_id, question_id, student_answer, is_correct)
      values (v_id, q.id, coalesce(v_raw, ''), v_ok);
      v_max := v_max + q.points;
      if v_ok then
        v_score := v_score + q.points;
      end if;
    end loop;

    update public.mock_attempts
       set submitted_at = now(), score = v_score, max_score = v_max, paused_at = null
     where id = v_id;
  elsif v_kind = 'w' then
    update public.writing_mock_attempts
       set submitted_at = now(), auto_submitted = true, paused_at = null
     where id = v_id;
  end if;

  update public.full_mock_attempts
     set stage = v_next,
         listening_attempt_id = case when v_full.stage = 'listening' and v_kind in ('rl', 'rl_done') then v_id else listening_attempt_id end,
         reading_attempt_id = case when v_full.stage = 'reading' and v_kind in ('rl', 'rl_done') then v_id else reading_attempt_id end,
         writing_attempt_id = case when v_full.stage = 'writing' and v_kind in ('w', 'w_done') then v_id else writing_attempt_id end,
         completed_at = case when v_next = 'done' then now() else completed_at end,
         updated_at = now()
   where id = p_full_id;

  return v_next;
end;
$$;

-- Delete a whole sitting: the full_mock_attempts row plus every section
-- attempt it produced (answers included). Frees up a retake slot.
create or replace function public.teacher_delete_full_mock_attempt(p_full_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full public.full_mock_attempts%rowtype;
  v_set public.full_mock_sets%rowtype;
  v_rl uuid[];
  v_w uuid[];
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can delete a sitting.';
  end if;

  select * into v_full from public.full_mock_attempts where id = p_full_id;
  if not found then
    return;
  end if;
  select * into v_set from public.full_mock_sets where id = v_full.set_id;

  select coalesce(array_agg(a.id), '{}') into v_rl
    from public.mock_attempts a
   where a.user_id = v_full.student_id
     and (
       a.id = v_full.listening_attempt_id
       or a.id = v_full.reading_attempt_id
       or (a.submitted_at is null and a.exam_id in (v_set.listening_exam_id, v_set.reading_exam_id))
     );

  select coalesce(array_agg(w.id), '{}') into v_w
    from public.writing_mock_attempts w
   where w.student_id = v_full.student_id
     and (
       w.id = v_full.writing_attempt_id
       or (w.submitted_at is null and w.exam_id = v_set.writing_exam_id)
     );

  delete from public.full_mock_attempts where id = p_full_id;
  delete from public.mock_answers where attempt_id = any (v_rl);
  delete from public.mock_attempts where id = any (v_rl);
  delete from public.writing_mock_attempts where id = any (v_w);
end;
$$;

-- Delete one Reading/Listening attempt (e.g. an old test run outside any
-- Full Mock). Any sitting pointing at it just loses that link.
create or replace function public.teacher_delete_mock_attempt(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can delete an attempt.';
  end if;
  delete from public.mock_answers where attempt_id = p_attempt_id;
  delete from public.mock_attempts where id = p_attempt_id;
end;
$$;

create or replace function public.teacher_delete_writing_attempt(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_teacher() then
    raise exception 'Only teachers can delete an attempt.';
  end if;
  delete from public.writing_mock_attempts where id = p_attempt_id;
end;
$$;

grant execute on function public.teacher_pause_full_mock(uuid) to authenticated;
grant execute on function public.teacher_resume_full_mock(uuid) to authenticated;
grant execute on function public.teacher_add_time_full_mock(uuid, int) to authenticated;
grant execute on function public.teacher_advance_full_mock(uuid) to authenticated;
grant execute on function public.teacher_delete_full_mock_attempt(uuid) to authenticated;
grant execute on function public.teacher_delete_mock_attempt(uuid) to authenticated;
grant execute on function public.teacher_delete_writing_attempt(uuid) to authenticated;
grant execute on function public.full_mock_first_stage(text[]) to authenticated;
grant execute on function public.full_mock_next_stage(text, text[]) to authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- Run this BEFORE deploying the matching app update. Then, as a quick
-- check: start a Full Mock as a test student, pause it from Live Mocks,
-- confirm the student's screen shows "paused" and the clock stops,
-- resume it, and confirm the same time is left.
-- ============================================================
