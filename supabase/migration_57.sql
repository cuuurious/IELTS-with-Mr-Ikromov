-- ============================================================
-- Migration 57 — run this once in Supabase SQL Editor, after 29-56
--
-- Fixes the CRITICAL "Security Definer View" finding Jasur's Supabase
-- Security Advisor raised on public.mock_questions_public, 2026-09-26.
--
-- What the view actually did (confirmed by running
-- `select pg_get_viewdef('public.mock_questions_public', true)`):
--
--   SELECT q.id, q.section_id, q.order_index, q.type, q.prompt,
--          q.options, q.points
--   FROM mock_questions q
--   JOIN mock_sections s ON s.id = q.section_id
--   JOIN mock_exams e ON e.id = s.exam_id
--   WHERE e.is_active;
--
-- Good news: it already left out correct_answer, and it already
-- filtered to active exams only — that part was fine. The problem is
-- everything it DIDN'T check. It's a SECURITY DEFINER view, meaning it
-- runs with its own elevated permissions rather than the caller's —
-- that's WHY a student can read it at all (the real mock_questions
-- table is teacher-only, per migration_36). But the view itself has no
-- per-student check whatsoever, so ANY signed-in account — not just a
-- student who's actually been assigned this exam — can read the full
-- question set (prompts, choices, everything but the answer key) for
-- EVERY active exam, just by asking.
--
-- That's stricter than it sounds once you line it up against this
-- project's own history:
--   - migration_37 (2026-09-25): "Take a Test now only offers 'Full
--     Mock' sets, not individual Reading/Listening/Writing exams
--     anymore" — Jasur's own words: "i dont want them to be able to do
--     watever test they want at anytime."
--   - migration_45 (2026-09-26): "this REPLACES free self-practice
--     access entirely — every Full Mock attempt... now requires a
--     teacher-issued code."
-- Both of those are enforced by the APP's own navigation (which
-- screens it shows) — but the database itself, underneath the app,
-- never actually enforced either rule for reading question content.
-- Anyone with a logged-in session (any student account, whether or not
-- they've ever been issued a code for that particular Full Mock set)
-- could call `supabase.from('mock_questions_public').select('*')`
-- directly — bypassing the app entirely — and read every active exam's
-- questions. That's the real, concrete version of "can someone crack
-- our website": not a stranger with no account, but any logged-in
-- student seeing content they were never issued a code for.
--
-- Fix: replace the blanket view with a security-definer FUNCTION that
-- does its own per-caller check before returning anything — the same
-- pattern already used everywhere else in this project for exactly
-- this shape of problem (get_speaking_examiner_workload,
-- submit_mock_attempt). A caller only gets a section's questions if
-- they're a teacher, OR they hold a checked-in (used_at is not null),
-- non-revoked access code for the full_mock_sets bundle that this
-- Reading/Listening exam belongs to. used_at is stamped the moment
-- MockCheckIn.jsx's check-in succeeds — before a student ever needs to
-- read a single question — so this doesn't change the flow for anyone
-- following the real check-in process; it only blocks reading
-- questions for an exam nobody ever checked them into.
-- ============================================================

create or replace function public.get_mock_questions_public(p_section_ids uuid[])
returns table (
  id public.mock_questions.id%type,
  section_id public.mock_questions.section_id%type,
  order_index public.mock_questions.order_index%type,
  type public.mock_questions.type%type,
  prompt public.mock_questions.prompt%type,
  options public.mock_questions.options%type,
  points public.mock_questions.points%type
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  return query
    select q.id, q.section_id, q.order_index, q.type, q.prompt, q.options, q.points
    from public.mock_questions q
    join public.mock_sections s on s.id = q.section_id
    join public.mock_exams e on e.id = s.exam_id
    where q.section_id = any(p_section_ids)
      and e.is_active
      and (
        public.is_teacher()
        or exists (
          select 1
          from public.mock_access_codes ac
          join public.full_mock_sets fms on fms.id = ac.full_mock_set_id
          where ac.student_id = auth.uid()
            and ac.revoked = false
            and ac.used_at is not null
            and (fms.reading_exam_id = e.id or fms.listening_exam_id = e.id)
        )
      );
end;
$$;

grant execute on function public.get_mock_questions_public(uuid[]) to authenticated;

-- The actual fix is dropping this — leaving the old view in place,
-- even unused, would mean the hole is still open to anyone querying it
-- directly instead of going through the function above.
--
-- I checked every place in the app that reads from mock_questions_public
-- (MockExams.jsx and FullMockRunner.jsx — both updated alongside this
-- migration to call get_mock_questions_public() instead) — but I don't
-- have a way to grep your entire live repository from this session, so
-- if something else out there still queries mock_questions_public
-- directly, it'll start erroring with "relation does not exist" right
-- after this runs. If you see that error anywhere after deploying,
-- send it over and I'll find and fix that call site.
drop view if exists public.mock_questions_public;

notify pgrst, 'reload schema';
