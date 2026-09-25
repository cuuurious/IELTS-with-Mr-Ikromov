-- ============================================================
-- Migration 37 — run this once in Supabase SQL Editor, after 29-36
--
-- Jasur, 2026-09-25, verbatim: "i dont want them to be able to do
-- watever test they want at anytime, once they start the mock they
-- have to solve listening first, reading and writing next but between
-- there should be instuction smth and confirming like in real exam."
--
-- Up to now, Reading/Listening (mock_exams/mock_attempts) and Writing
-- (writing_mock_exams/writing_mock_attempts) were three completely
-- separate, freely-pickable systems — a student could sit any exam,
-- in any order, as many times as they liked. This migration adds the
-- missing link: a "Full Mock" is one specific Listening exam + one
-- specific Reading exam + one specific Writing exam, bundled together
-- by a teacher, sat as a single continuous, ordered sitting
-- (Listening → Reading → Writing) — the sequencing/gating itself is
-- app-side (FullMockRunner.jsx), this just gives it somewhere to
-- record which exam sits with which, and where a student currently is
-- in that sequence.
--
-- Per Jasur's decision same day: this REPLACES free single-module
-- practice in the student's Mock Test Center — Take a Test now only
-- offers "Full Mock" sets, not individual Reading/Listening/Writing
-- exams anymore. The underlying mock_exams/writing_mock_exams tables
-- and their content editor are untouched — a teacher still authors
-- individual Listening/Reading/Writing exams exactly as before, then
-- bundles three of them into a set here.
-- ============================================================

-- ---------- 1. The bundle a teacher builds ----------
create table if not exists public.full_mock_sets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  listening_exam_id uuid not null references public.mock_exams(id) on delete restrict,
  reading_exam_id uuid not null references public.mock_exams(id) on delete restrict,
  writing_exam_id uuid not null references public.writing_mock_exams(id) on delete restrict,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.full_mock_sets enable row level security;

drop policy if exists "full_mock_sets_select" on public.full_mock_sets;
create policy "full_mock_sets_select" on public.full_mock_sets
  for select using (is_active or public.is_teacher());

drop policy if exists "full_mock_sets_insert_teacher" on public.full_mock_sets;
create policy "full_mock_sets_insert_teacher" on public.full_mock_sets
  for insert with check (public.is_teacher());

drop policy if exists "full_mock_sets_update_teacher" on public.full_mock_sets;
create policy "full_mock_sets_update_teacher" on public.full_mock_sets
  for update using (public.is_teacher());

drop policy if exists "full_mock_sets_delete_teacher" on public.full_mock_sets;
create policy "full_mock_sets_delete_teacher" on public.full_mock_sets
  for delete using (public.is_teacher());

-- ---------- 2. One student's progress through one sitting ----------
-- stage tracks where they currently are in the forced sequence.
-- listening/reading_attempt_id point at the ordinary mock_attempts
-- rows (same table Reading and Listening always used); writing_
-- attempt_id points at the ordinary writing_mock_attempts row — this
-- table doesn't duplicate any answer data, just threads the three
-- together and remembers the current stage so a refresh mid-sequence
-- resumes at the right gate instead of losing the student's place.
create table if not exists public.full_mock_attempts (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.full_mock_sets(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  stage text not null default 'listening'
    check (stage in ('listening', 'reading', 'writing', 'done')),
  listening_attempt_id uuid references public.mock_attempts(id) on delete set null,
  reading_attempt_id uuid references public.mock_attempts(id) on delete set null,
  writing_attempt_id uuid references public.writing_mock_attempts(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists full_mock_attempts_student_idx
  on public.full_mock_attempts(student_id, started_at);
create index if not exists full_mock_attempts_set_idx
  on public.full_mock_attempts(set_id);

alter table public.full_mock_attempts enable row level security;

drop policy if exists "full_mock_attempts_select_own" on public.full_mock_attempts;
create policy "full_mock_attempts_select_own" on public.full_mock_attempts
  for select using (student_id = auth.uid());

drop policy if exists "full_mock_attempts_select_teacher" on public.full_mock_attempts;
create policy "full_mock_attempts_select_teacher" on public.full_mock_attempts
  for select using (public.is_teacher());

drop policy if exists "full_mock_attempts_insert_own" on public.full_mock_attempts;
create policy "full_mock_attempts_insert_own" on public.full_mock_attempts
  for insert with check (student_id = auth.uid());

drop policy if exists "full_mock_attempts_update_own" on public.full_mock_attempts;
create policy "full_mock_attempts_update_own" on public.full_mock_attempts
  for update using (student_id = auth.uid());

drop policy if exists "full_mock_attempts_update_teacher" on public.full_mock_attempts;
create policy "full_mock_attempts_update_teacher" on public.full_mock_attempts
  for update using (public.is_teacher());

alter publication supabase_realtime add table public.full_mock_sets;
alter publication supabase_realtime add table public.full_mock_attempts;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEP — after running this migration:
--
-- There's no student-visible Full Mock until a teacher builds at least
-- one set. Do this from the Teacher Mock Center's Content tab → Full
-- Mocks (new sub-tab) → "+ Add full mock", picking one already-
-- published Listening exam, one Reading exam, and one Writing exam.
-- All three must already exist (Content tab's Listening/Reading/
-- Writing sub-tabs) before a set can be built.
-- ---------------------------------------------------------------------
