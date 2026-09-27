-- ============================================================
-- Migration 61 — run this once in Supabase SQL Editor, after 29-60
--
-- New feature, scoped 2026-09-27 from Jasur's own suggestion after asking
-- why the Issue Codes student picker was empty: "maybe we have to add smth
-- like request teacher to start mock and then teacher is able to accept
-- one by one or all at the same time??" Three decisions locked with Jasur
-- (AskUserQuestion, same day):
--   1. Students discover mocks to request from a new "Available mocks"
--      list on their own Take a Test tab (MockCheckIn.jsx) — every
--      published (is_active) Full Mock set, not just ones tied to their
--      group.
--   2. Approving a request auto-generates + sends the access code
--      immediately (reusing the exact same generateAccessCodeBatch /
--      send-mock-access-codes path "Issue codes" already uses) — one
--      click, same convenience as today's manual flow.
--   3. Bulk actions from day one — a teacher can approve/reject several
--      pending requests at once, not just one at a time.
--
-- Separately, this migration's sibling code change also fixes a real gap
-- found while investigating this: the Issue Codes student picker
-- (TeacherMockCenter.jsx's initial load query) selected every
-- profiles row with role='student', with NO status filter — so a
-- still-pending signup (not yet approved via Pending Approvals) was
-- already selectable there, even though they can't log in yet. Fixed by
-- adding .eq('status', 'approved'), matching the exact filter
-- teacher-needs-attention-digest's own Edge Function already uses for
-- the same query shape. That's a pure app-code change, no SQL needed —
-- noted here only so both fixes from this conversation are documented
-- together.
-- ============================================================

create table if not exists public.mock_access_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  full_mock_set_id uuid not null references public.full_mock_sets(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  access_code_id uuid references public.mock_access_codes(id),
  created_at timestamptz not null default now()
);

create index if not exists mock_access_requests_student_idx
  on public.mock_access_requests(student_id, requested_at desc);
create index if not exists mock_access_requests_set_idx
  on public.mock_access_requests(full_mock_set_id);
create index if not exists mock_access_requests_status_idx
  on public.mock_access_requests(status);

-- One pending request per student per set at a time — clicking "Request
-- access" twice, or requesting the same set again while already waiting
-- on a decision, just hits this instead of piling up duplicate rows. A
-- REJECTED request doesn't block a fresh one — a student can always ask
-- again after being turned down.
create unique index if not exists mock_access_requests_one_pending
  on public.mock_access_requests (student_id, full_mock_set_id)
  where status = 'pending';

alter table public.mock_access_requests enable row level security;

drop policy if exists "mock_access_requests_select_own" on public.mock_access_requests;
create policy "mock_access_requests_select_own" on public.mock_access_requests
  for select using (student_id = auth.uid());

drop policy if exists "mock_access_requests_select_teacher" on public.mock_access_requests;
create policy "mock_access_requests_select_teacher" on public.mock_access_requests
  for select using (public.is_teacher());

-- A student can only ever request for THEMSELVES, only in the fresh
-- 'pending' state (never insert their own way into 'approved'), and only
-- for a set that's actually published right now — mirrors
-- full_mock_sets_select's own "is_active or is_teacher()" rule, so a
-- student can't request a Draft set they were never meant to see either.
drop policy if exists "mock_access_requests_insert_own" on public.mock_access_requests;
create policy "mock_access_requests_insert_own" on public.mock_access_requests
  for insert with check (
    student_id = auth.uid()
    and status = 'pending'
    and decided_at is null
    and decided_by is null
    and access_code_id is null
    and exists (
      select 1 from public.full_mock_sets s
      where s.id = full_mock_set_id and s.is_active
    )
  );

-- Deciding a request (approve/reject, plus stamping the generated code)
-- is teacher-only — a student has no update access at all here, so
-- there's no column-lockdown trigger needed the way the other
-- audited tables required (this table just never grants the student
-- write access in the first place, the simpler version of the same
-- protection).
drop policy if exists "mock_access_requests_update_teacher" on public.mock_access_requests;
create policy "mock_access_requests_update_teacher" on public.mock_access_requests
  for update using (public.is_teacher());

notify pgrst, 'reload schema';

-- ============================================================
-- After running this, students will see an "Available mocks" list on
-- their Take a Test tab with a "Request access" button per published
-- Full Mock. You'll see a new "Requests" panel in the Full Mocks tab,
-- above Access codes, with checkboxes + Approve selected/Approve all/
-- Reject selected — approving generates and sends the code the same way
-- Issue Codes already does today.
-- ============================================================
