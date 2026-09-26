-- ============================================================
-- Migration 45 — run this once in Supabase SQL Editor, after 29-44
--
-- Jasur, 2026-09-26, verbatim: "this confirming window has to be the
-- same as well, maybe we could add a window to login with their full
-- name and a special password or code or smth to login and start
-- close to real ielts style that password or code will be made up by
-- a teacher and assigned to a particular mock session, they will
-- login and see that window where they will see instrutcions and hear
-- them as well and confirm there."
--
-- Confirmed scope (AskUserQuestion, same day): one code per student
-- per attempt (never shared across a group/session), and this
-- REPLACES free self-practice access entirely — every Full Mock
-- attempt (which, since migration_37, is the only way a student sits
-- Listening/Reading/Writing at all) now requires a teacher-issued
-- code, mimicking a real IELTS candidate check-in.
--
-- One row = one ticket: a specific student, allowed into a specific
-- full_mock_sets bundle, once. used_at is stamped the moment the
-- student's check-in succeeds (MockCheckIn.jsx); a used or revoked
-- code can never be reused, enforced by the update policy below, not
-- just app code. entered_full_name records what the student actually
-- typed at check-in — cosmetic/audit only. The real access control is
-- student_id = auth.uid(): a student can never even see another
-- student's code row, same as every other per-student table here.
-- ============================================================

create table if not exists public.mock_access_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  student_id uuid not null references public.profiles(id) on delete cascade,
  full_mock_set_id uuid not null references public.full_mock_sets(id) on delete cascade,
  created_by uuid references public.profiles(id),
  entered_full_name text,
  used_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists mock_access_codes_student_idx
  on public.mock_access_codes(student_id, created_at);
create index if not exists mock_access_codes_set_idx
  on public.mock_access_codes(full_mock_set_id);

alter table public.mock_access_codes enable row level security;

drop policy if exists "mock_access_codes_teacher_all" on public.mock_access_codes;
create policy "mock_access_codes_teacher_all" on public.mock_access_codes
  for all using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists "mock_access_codes_select_own" on public.mock_access_codes;
create policy "mock_access_codes_select_own" on public.mock_access_codes
  for select using (student_id = auth.uid());

-- A student may only ever consume their own, still-unused, non-revoked
-- code. This "using" clause is checked against the row as it stands
-- BEFORE the update, so once used_at is set (or revoked flips true) no
-- further update from that student can touch the row again — not even
-- one that tries to null used_at back out to "unuse" it.
drop policy if exists "mock_access_codes_checkin_own" on public.mock_access_codes;
create policy "mock_access_codes_checkin_own" on public.mock_access_codes
  for update
  using (student_id = auth.uid() and used_at is null and revoked = false)
  with check (student_id = auth.uid());

alter publication supabase_realtime add table public.mock_access_codes;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ONE-TIME MANUAL STEP — after running this migration:
--
-- Nothing to do in the database — the Teacher Mock Center's Full Mocks
-- tab now has an "Access codes" section to issue one, per student, per
-- full mock set. Students can't start a Full Mock at all until they've
-- been issued one.
-- ---------------------------------------------------------------------
