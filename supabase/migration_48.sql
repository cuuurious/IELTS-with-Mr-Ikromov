-- ============================================================
-- Migration 48 — run this once in Supabase SQL Editor, after 29-47
--
-- Jasur, 2026-09-26 (across three messages, verbatim gist): today
-- Listening/Reading score the instant a student submits, and Writing/
-- Speaking bands appear the instant an examiner marks them — nothing
-- holds any of it back. This adds one consistent release gate in front
-- of all four skills: a teacher has to explicitly confirm a result
-- (one student at a time, or many/all at once) before that student can
-- see it — score, band, or the mistake breakdown that's coming in a
-- follow-up migration once mock_answers' columns are confirmed.
--
-- Scoped and locked with Jasur the same day (AskUserQuestion): Reading/
-- Listening get a NEW `band` column, since today they only ever store a
-- raw score/max_score — a teacher will see a suggested band (from the
-- app's existing estimateBandFromPercent(), the same estimate already
-- used in the score report and Student Progress tiles) and can edit it
-- before releasing. Writing/Speaking already have a real examiner_band
-- and don't get a second one — releasing them is just a confirm, no
-- re-estimation.
--
-- No column-level RLS anywhere in this project (see migration_34's own
-- comment) — this doesn't change that. The release gate is enforced by
-- the APP's queries (only reading rows with released_at is not null are
-- ever fetched/shown to a student), the same trust model as everywhere
-- else here, not a new security mechanism.
-- ============================================================

-- ---------- 1. Release columns ----------
alter table public.mock_attempts
  add column if not exists band numeric,
  add column if not exists released_at timestamptz,
  add column if not exists released_by uuid references public.profiles(id) on delete set null;

alter table public.writing_mock_attempts
  add column if not exists released_at timestamptz,
  add column if not exists released_by uuid references public.profiles(id) on delete set null;

alter table public.mock_speaking_slots
  add column if not exists released_at timestamptz,
  add column if not exists released_by uuid references public.profiles(id) on delete set null;

-- ---------- 2. Teacher can release ----------
-- writing_mock_attempts already has "writing_mock_attempts_update_teacher"
-- (migration_34) and mock_speaking_slots already has "speaking_slots_update"
-- with is_teacher() in it (migration_29) — both already cover these new
-- columns, same as every other table here. mock_attempts, however, has
-- only ever had a teacher SELECT policy (migration_32) plus a student's
-- own-row UPDATE for the tab-switch log (migration_47) — nothing lets a
-- teacher UPDATE a mock_attempts row yet, so releasing/setting a band
-- would be silently blocked by RLS without this.
drop policy if exists "mock_attempts_update_teacher" on public.mock_attempts;
create policy "mock_attempts_update_teacher" on public.mock_attempts
  for update using (public.is_teacher());

-- ---------- 3. Notify the student the moment their result is released ----------
-- Same pattern as notify_writing_mock_review() / notify_speaking_review()
-- (migrations 34/35) — one per table, fires only on the released_at
-- transition (null -> not null), never on every update.
create or replace function public.notify_mock_attempt_released()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.released_at is not null
     and old.released_at is distinct from new.released_at then
    insert into public.notifications(user_id, type, title, body, link)
    values (
      new.user_id,
      'mock_result_released',
      'Your mock result is ready',
      case when new.band is not null
        then format('Band %s — check your results in the Mock Test Center.', new.band)
        else 'Check your results in the Mock Test Center.'
      end,
      '/app'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_mock_attempt_released on public.mock_attempts;
create trigger trg_notify_mock_attempt_released
after update on public.mock_attempts
for each row execute function public.notify_mock_attempt_released();

create or replace function public.notify_writing_mock_released()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.released_at is not null
     and old.released_at is distinct from new.released_at then
    insert into public.notifications(user_id, type, title, body, link)
    values (
      new.student_id,
      'mock_result_released',
      'Your writing mock result is ready',
      case when new.examiner_band is not null
        then format('Band %s — check your results in the Mock Test Center.', new.examiner_band)
        else 'Check your results in the Mock Test Center.'
      end,
      '/app'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_writing_mock_released on public.writing_mock_attempts;
create trigger trg_notify_writing_mock_released
after update on public.writing_mock_attempts
for each row execute function public.notify_writing_mock_released();

create or replace function public.notify_speaking_slot_released()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.released_at is not null
     and old.released_at is distinct from new.released_at then
    insert into public.notifications(user_id, type, title, body, link)
    values (
      new.student_id,
      'mock_result_released',
      'Your speaking mock result is ready',
      case when new.examiner_band is not null
        then format('Band %s — check your results in the Mock Test Center.', new.examiner_band)
        else 'Check your results in the Mock Test Center.'
      end,
      '/app'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_speaking_slot_released on public.mock_speaking_slots;
create trigger trg_notify_speaking_slot_released
after update on public.mock_speaking_slots
for each row execute function public.notify_speaking_slot_released();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEP — after running this migration:
--
-- Nothing else to do. Every EXISTING result (already-submitted mock
-- attempts, already-marked writing/speaking) has released_at = null, so
-- it will disappear from students' Overview the moment the matching app
-- code ships — that's expected, not a bug: you'll see them all show up
-- as "pending release" in the Mock Center's new Results tab, and can
-- bulk-release everything already-marked in one click if you don't want
-- students to notice a gap.
-- ---------------------------------------------------------------------
